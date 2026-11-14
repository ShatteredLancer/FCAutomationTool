import { describe, it, expect, vi } from 'vitest';
import { createMarketTaskScheduler } from '../../src/trading/market-task-scheduler.js';
import { createTradingTaskStore, tradingTaskKey } from '../../src/adapters/browser/fc27-trading-task-store.js';
import { createMarketCoordinator, marketCoordinationKey } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { defaultTradingTaskSettings } from '../../src/trading/task-model.js';
import { marketTaskEvidence } from '../../src/trading/market-coordination.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(options = {}) {
  const data = new Map([['old-journal', { unknown: true }]]), held = new Map(), events = [], statuses = [], diagnostics = [];
  let account = { scope: 'A', season: '27', platform: 'console' }, clock = 1000, serial = 0, taskSerial = 0;
  const locks = { async request(name, config, callback) {
    while (held.has(name)) {
      if (config.ifAvailable) return callback(null);
      await held.get(name).promise;
    }
    const pending = deferred(); held.set(name, pending);
    try { return await callback({ name, mode: 'exclusive' }); }
    finally { held.delete(name); pending.resolve(); }
  } };
  const get = async (key, fallback) => structuredClone(data.get(key) ?? fallback);
  const hooks = {};
  const set = async (key, value) => { if (hooks.write) await hooks.write(key, value); data.set(key, structuredClone(value)); };
  const coordinator = createMarketCoordinator({ context: () => account, get, set, locks });
  const taskStore = createTradingTaskStore({ context: () => account, get, set, locks, now: () => clock, id: () => `task-${++taskSerial}`,
    readEvidence: async taskId => marketTaskEvidence((await coordinator.inspect()).ledger, taskId) });
  const input = name => ({ name, mode: 'fixed', settings: { ...defaultTradingTaskSettings(), buyRule: 'fixed', buyValue: 800,
    sellRule: 'fixed', sellValue: 700 }, players: [{ name: 'Test', definitionId: 1001, rating: 84, version: 'gold', cap: null, qty: null }], owned: [], excluded: [] });
  let snapshot = await taskStore.saveTask({ ...await taskStore.read(), input: input('A') });
  snapshot = await taskStore.saveTask({ ...snapshot, input: input('B') });
  const ids = snapshot.store.tasks.map(task => task.id), queues = new Map(ids.map(taskId => [taskId, []]));
  const provider = {
    prepare: vi.fn(async ({ task }) => ({ expiresAt: clock + 100000, task: task.id, ...(queues.get(task.id)?.[0] ?? { kind: 'done' }) })),
    preflight: vi.fn(async () => ({ ready: true, balance: 10000, freeSlots: 10 })),
    send: vi.fn(async ({ action }) => {
      events.push({ task: action.task, kind: action.kind, at: clock });
      if (action.kind === 'search') return { sent: true, status: 'confirmed' };
      return { status: 'confirmed', receipt: { itemId: action.itemId, definitionId: action.definitionId,
        tradeId: action.kind === 'list' ? 'new-list-' + action.itemId : action.tradeId ?? null, coins: action.coins } };
    }),
    accept: vi.fn(async ({ action }) => { queues.get(action.task).shift(); }),
    reconcile: vi.fn(async () => ({ status: 'unknown', receipt: null })),
    verifySession: vi.fn(async () => ({ ready: true })),
  };
  const scheduler = createMarketTaskScheduler({ taskStore, coordinator, provider, enabled: true, now: () => clock, random: () => 0,
    id: () => `request-${++serial}`, wait: async (ms, signal) => { if (!signal.aborted) clock += ms; if (hooks.wait) await hooks.wait(); },
    onStatus: status => statuses.push(status), onDiagnostic: event => diagnostics.push(event), ...options });
  return { data, account, coordinator, taskStore, scheduler, provider, queues, ids, events, statuses, diagnostics, hooks, input,
    snapshot, now: () => clock, advance: ms => { clock += ms; }, run: () => scheduler.run({ approved: true, snapshot, taskIds: ids }),
    changeAccount: () => { account = { ...account, scope: 'B' }; } };
}
const search = { kind: 'search' };
const buy = (itemId = '100') => ({ kind: 'buy', definitionId: 1001, itemId, tradeId: 'offer-' + itemId, coins: 800 });

describe('approved task scheduler with simulated providers', () => {
  it('persists elapsed time across a normal pause and a new scheduler; the original duration still applies', async () => {
    const f = await fixture(); const input = f.input('Limited'); input.settings.runMinutes = 1;
    const snapshot = await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[0], input });
    f.provider.prepare.mockImplementation(async () => { f.advance(20000); f.scheduler.pauseAll(); return { kind: 'done' }; });
    await f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
    expect((await f.coordinator.inspect()).ledger.clocks[0]).toMatchObject({ elapsedMs: 20000, lease: null });
    f.advance(3600000);
    const next = createMarketTaskScheduler({ taskStore: f.taskStore, coordinator: f.coordinator, provider: f.provider, enabled: true, now: f.now });
    f.provider.dispatchBoundary = true;
    f.provider.prepare.mockImplementation(async () => { f.advance(45000); return { kind: 'search', expiresAt: f.now() + 10000 }; });
    f.provider.send.mockImplementation(async ({ beforeDispatch }) => { beforeDispatch(); throw Error('must not dispatch'); });
    await next.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
    expect((await f.coordinator.inspect()).ledger.clocks[0].elapsedMs).toBe(60000);
    expect((await f.coordinator.inspect()).ledger.searches.every(s => s.status === 'not-sent')).toBe(true);
    f.provider.prepare.mockClear(); await next.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
    expect(f.provider.prepare).not.toHaveBeenCalled(); expect(next.inspect().tasks[0].state).toBe('stopped');
  });
  it('keeps stop terminal after an unknown receipt is recovered and acknowledged', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]); f.provider.dispatchBoundary = true;
    f.provider.send.mockImplementation(async ({ beforeDispatch }) => { beforeDispatch(); f.scheduler.stop(f.ids[0]); throw Error('lost response'); });
    await f.run();
    let snapshot = await f.taskStore.action({ ...await f.taskStore.read(), id: f.ids[0], action: 'stop' });
    expect(snapshot.store.tasks[0]).toMatchObject({ state: 'review', stopRequested: true });
    expect((await f.coordinator.inspect()).ledger.clocks.find(c => c.taskId === f.ids[0]).stopped).toBe(true);
    f.provider.reconcile.mockImplementation(async i => ({ status: 'confirmed', receipt: { itemId: i.itemId, definitionId: i.definitionId, tradeId: i.tradeId, coins: i.coins } }));
    await f.scheduler.recover();
    snapshot = await f.taskStore.action({ ...snapshot, id: f.ids[0], action: 'acknowledge' });
    expect(snapshot.store.tasks[0].state).toBe('stopped');
    await expect(f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] })).rejects.toThrow('TASK_SELECTION_INVALID');
  });
  async function handoffFixture() {
    const f = await fixture(), item = { itemId: '201', definitionId: 1001, name: 'Owned', pile: 'transfer' };
    await f.coordinator.withOwner(s => s.control(t => t.checkpoint(ledger => {
      ledger.holdings.push({ taskId: f.ids[0], itemId: item.itemId, definitionId: item.definitionId,
        phase: 'transfer', cost: 650, listingTradeId: null, salePrice: null });
    })));
    const input = f.input('Recipient'); input.mode = 'sell'; input.owned = [item];
    let snapshot = await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[1], input });
    snapshot = await f.taskStore.action({ ...snapshot, id: f.ids[0], action: 'stop' });
    f.provider.inspectHolding = vi.fn(async h => ({ eligible: true, itemId: h.itemId, definitionId: h.definitionId, pile: 'transfer' }));
    return { ...f, options: { approved: true, snapshot, fromTaskId: f.ids[0], toTaskId: f.ids[1], itemIds: ['201'] } };
  }
  it('explicitly transfers exact remaining holdings without buying, moving, starting or resetting costs', async () => {
    const f = await handoffFixture(); await f.scheduler.handoff(f.options);
    const ledger = (await f.coordinator.inspect()).ledger;
    expect(ledger.holdings[0]).toMatchObject({ taskId: f.ids[1], cost: 650, phase: 'transfer' });
    expect(ledger.handoffs[0]).toMatchObject({ fromTaskId: f.ids[0], toTaskId: f.ids[1], itemId: '201', cost: 650 });
    expect(f.provider.send).not.toHaveBeenCalled(); expect(f.provider.prepare).not.toHaveBeenCalled();
    await expect(f.scheduler.handoff(f.options)).rejects.toThrow('HANDOFF_INVALID');
  });
  it.each(['unapproved', 'active', 'missing', 'cancelled', 'stale'])('does not hand off when %s', async reason => {
    const f = await handoffFixture();
    if (reason === 'unapproved') f.options.approved = false;
    if (reason === 'active') await f.coordinator.withOwner(s => s.control(t => t.checkpoint(ledger => {
      ledger.holdings[0].phase = 'listed'; ledger.holdings[0].listingTradeId = '900';
    })));
    if (reason === 'missing') f.provider.inspectHolding.mockResolvedValue({ eligible: false });
    if (reason === 'cancelled') f.provider.inspectHolding.mockImplementation(async () => { f.scheduler.pauseAll(); return {}; });
    if (reason === 'stale') await f.taskStore.action({ ...f.options.snapshot, id: f.ids[1], action: 'pause' });
    await expect(f.scheduler.handoff(f.options)).rejects.toThrow();
    expect((await f.coordinator.inspect()).ledger.holdings[0].taskId).toBe(f.ids[0]);
    expect((await f.coordinator.inspect()).ledger.handoffs).toBeUndefined();
    expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('does not restart a stopped task; a copied configuration has a fresh task identity', async () => {
    const f = await fixture();
    let snapshot = await f.taskStore.action({ ...await f.taskStore.read(), id: f.ids[0], action: 'stop' });
    await expect(f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] })).rejects.toThrow('TASK_SELECTION_INVALID');
    snapshot = await f.taskStore.action({ ...snapshot, id: f.ids[0], action: 'copy' });
    await f.scheduler.run({ approved: true, snapshot, taskIds: [snapshot.store.tasks.at(-1).id] });
    expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('imports only the explicitly selected exact holding and never sends a fake buy or move for Transfer', async () => {
    const f = await fixture(), input = f.input('Sell'); input.mode = 'sell';
    input.owned = [{ itemId: '201', definitionId: 1001, name: 'Owned', pile: 'transfer' }];
    const snapshot = await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[0], input });
    let claimed = false;
    f.provider.prepare.mockImplementation(async () => claimed ? { kind: 'done' }
      : { kind: 'claim', itemId: '201', definitionId: 1001, expiresAt: 100000 });
    f.provider.preflight.mockImplementation(async () => {
      claimed = true; return { ready: true, holdingPhase: 'transfer', holding: { taskId: f.ids[0], itemId: '201', definitionId: 1001, cost: null } };
    });
    await f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
    const ledger = (await f.coordinator.inspect()).ledger;
    expect(ledger.holdings[0]).toMatchObject({ itemId: '201', phase: 'transfer', cost: null });
    expect(ledger.intents).toEqual([]); expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('persists an authentication stop from a preflight read exception before any dispatch', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]);
    f.provider.preflight.mockRejectedValue(Object.assign(Error('MARKET_READ_UNCONFIRMED'), { code: 401 }));
    await f.run(); const ledger = (await f.coordinator.inspect()).ledger;
    expect(ledger.stopped).toBe('authentication'); expect(ledger.intents).toEqual([]);
    expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('revokes a native dispatch while its adapter is awaiting pacing, without leaving a false unknown buy', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]);
    f.provider.dispatchBoundary = true;
    f.provider.send.mockImplementation(async ({ beforeDispatch }) => {
      await Promise.resolve(); f.scheduler.pause(f.ids[0]); beforeDispatch();
      throw Error('must never reach native write');
    });
    await f.run();
    const ledger = (await f.coordinator.inspect()).ledger;
    expect(ledger.intents[0].phase).toBe('rejected');
    expect(ledger.stopped).toBeNull(); expect(ledger.holdings).toEqual([]);
  });
  it('retains an unknown intent when native dispatch began before cancellation', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]); f.provider.dispatchBoundary = true;
    f.provider.send.mockImplementation(async ({ beforeDispatch }) => {
      beforeDispatch(); f.scheduler.pause(f.ids[0]); throw Error('lost reply');
    });
    await f.run();
    expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
  });
  it('checks expiry again at the actual native boundary after provider pacing', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [search]); f.provider.dispatchBoundary = true;
    f.provider.send.mockImplementation(async ({ beforeDispatch }) => {
      f.advance(100001); beforeDispatch(); return { sent: true, status: 'confirmed' };
    });
    await f.run();
    expect((await f.coordinator.inspect()).ledger.searches[0].status).toBe('not-sent');
  });
  it('requires a live provider and explicit approval; loading never resumes', async () => {
    const f = await fixture();
    await expect(f.scheduler.run({ snapshot: f.snapshot, taskIds: f.ids })).rejects.toThrow('MARKET_APPROVAL_REQUIRED');
    expect(f.provider.prepare).not.toHaveBeenCalled(); expect(f.provider.send).not.toHaveBeenCalled();
    const disabled = createMarketTaskScheduler({ taskStore: f.taskStore, coordinator: f.coordinator });
    await expect(disabled.run({ approved: true })).rejects.toThrow('TASKS_EXECUTION_UNAVAILABLE');
  });
  it('runs bounded rounds across tasks, sharing cooldown while completing held-card actions', async () => {
    const f = await fixture();
    for (let index = 0; index < f.ids.length; index++) {
      const itemId = String(100 + index);
      f.queues.set(f.ids[index], [search, buy(itemId), { kind: 'move', itemId, definitionId: 1001, coins: 0 },
        { kind: 'list', itemId, definitionId: 1001, coins: 700 }]);
    }
    const result = await f.run();
    expect(result.tasks.map(t => t.state)).toEqual(['completed', 'completed']);
    expect(f.events.filter(e => e.kind === 'search').map(e => e.at)).toEqual([1000, 8000]);
    expect(f.events.slice(0, 4).map(e => e.kind)).toEqual(['search', 'buy', 'move', 'list']);
    const ledger = (await f.coordinator.inspect()).ledger;
    expect(ledger.holdings.map(h => [h.phase, h.cost, h.salePrice])).toEqual([['listed', 800, null], ['listed', 800, null]]);
    expect(f.data.get('old-journal')).toEqual({ unknown: true });
    expect(JSON.stringify(f.diagnostics)).not.toMatch(/offer-|itemId|tradeId|task-1/);
  });
  it('pausing A during preparation does not pause B or send A', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [search]); f.queues.set(f.ids[1], [search]);
    const prepare = f.provider.prepare.getMockImplementation();
    f.provider.prepare.mockImplementation(async args => {
      if (args.task.id === f.ids[0]) f.scheduler.pause(f.ids[0]); return prepare(args);
    });
    const result = await f.run();
    expect(result.tasks.map(t => t.state)).toEqual(['paused', 'completed']);
    expect(f.events.map(e => e.task)).toEqual([f.ids[1]]);
  });
  it('explicit per-card caps override the common buy rule but never the absolute hard cap', async () => {
    for (const hardCap of [null, 850]) {
      const f = await fixture(), input = f.input('A');
      input.players[0].cap = 1000; input.settings.hardCap = hardCap;
      const snapshot = await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[0], input });
      f.queues.set(f.ids[0], [{ ...buy(), coins: 900 }]);
      await f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
      expect(f.provider.send).toHaveBeenCalledTimes(hardCap === null ? 1 : 0);
    }
  });
  it('a provider cannot raise the fixed selling price to cover its purchase cost', async () => {
    const f = await fixture();
    f.queues.set(f.ids[0], [buy(), { kind: 'move', itemId: '100', definitionId: 1001, coins: 0 },
      { kind: 'list', itemId: '100', definitionId: 1001, coins: 850 }]);
    const result = await f.run(); expect(result.reason).toBe('MARKET_SELL_RULE_CHANGED');
    expect(f.diagnostics).toContainEqual(expect.objectContaining({ event: 'task-scheduler', reason: 'MARKET_SELL_RULE_CHANGED', status: 'blocked' }));
    expect(f.events.map(e => e.kind)).toEqual(['buy', 'move']);
    expect((await f.coordinator.inspect()).ledger.holdings[0].phase).toBe('transfer');
  });
  it('task revision cancels a cross-tab edit between preparation and dispatch, without cancelling B', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [search]); f.queues.set(f.ids[1], [search]);
    const prepare = f.provider.prepare.getMockImplementation();
    f.provider.prepare.mockImplementation(async args => {
      if (args.task.id === f.ids[0]) await f.taskStore.saveTask({ ...await f.taskStore.read(), id: args.task.id, input: f.input('A changed') });
      return prepare(args);
    });
    const result = await f.run();
    expect(result.tasks.map(t => t.state)).toEqual(['paused', 'completed']); expect(f.events.map(e => e.task)).toEqual([f.ids[1]]);
  });
  it('an unrelated new task does not revoke an existing task approval', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [search]);
    await f.taskStore.saveTask({ ...await f.taskStore.read(), input: f.input('C') });
    await f.run(); expect(f.events).toHaveLength(1);
  });
  it('a separately approved task can join the current owner queue', async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    f.queues.set(f.ids[0], [search]); f.queues.set(f.ids[1], [search]);
    const prepare = f.provider.prepare.getMockImplementation();
    f.provider.prepare.mockImplementation(async args => {
      if (args.task.id === f.ids[0]) { entered.resolve(); await release.promise; }
      return prepare(args);
    });
    const running = f.scheduler.run({ approved: true, snapshot: f.snapshot, taskIds: [f.ids[0]] });
    await entered.promise;
    await f.scheduler.enqueue({ approved: true, snapshot: f.snapshot, taskIds: [f.ids[1]] });
    release.resolve(); const result = await running;
    expect(result.tasks.map(t => t.state)).toEqual(['completed', 'completed']);
    expect(f.events.map(e => e.task)).toEqual(f.ids);
  });
  it('public settings save revokes all prior approvals even if values are identical', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [search]); f.queues.set(f.ids[1], [search]);
    await f.taskStore.saveSettings({ ...await f.taskStore.read(), settings: f.snapshot.store.settings });
    const result = await f.run(); expect(result.tasks.map(t => t.state)).toEqual(['paused', 'paused']); expect(f.events).toEqual([]);
  });
  it('stop during pending-intent persistence records definite no-send and releases reserved funds', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]);
    f.hooks.write = (_key, value) => { if (value.ledger?.intents.some(i => i.phase === 'pending')) f.scheduler.stop(f.ids[0]); };
    const result = await f.run(); expect(result.tasks[0].state).toBe('stopped'); expect(f.provider.send).not.toHaveBeenCalled();
    expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('rejected');
  });
  it('pause while a sent purchase completes preserves the receipt and does not send the next action', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy(), { kind: 'move', itemId: '100', definitionId: 1001, coins: 0 }]);
    const send = f.provider.send.getMockImplementation();
    f.provider.send.mockImplementation(async args => { f.scheduler.pauseAll(); return send(args); });
    await f.run(); expect(f.events).toHaveLength(1);
    expect((await f.coordinator.inspect()).ledger.holdings[0]).toMatchObject({ phase: 'held', cost: 800 });
  });
  it('unknown buy is never resent; recovery and acknowledgement do not send or restart', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]); f.provider.send.mockRejectedValue(Error('private transport detail'));
    await f.run(); await f.run(); expect(f.provider.send).toHaveBeenCalledTimes(1);
    expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
    await expect(f.scheduler.acknowledgeStop({ approved: true })).rejects.toThrow('MARKET_RECOVERY_REQUIRED');
    f.provider.reconcile.mockResolvedValue({ status: 'confirmed', receipt: { itemId: '100', definitionId: 1001, tradeId: 'offer-100', coins: 800 } });
    await f.scheduler.recover();
    expect((await f.coordinator.inspect()).ledger.stopped).toBe('unknown-write');
    f.provider.verifySession.mockResolvedValue({ ready: false });
    await expect(f.scheduler.acknowledgeStop({ approved: true })).rejects.toThrow('MARKET_SESSION_UNVERIFIED');
    f.provider.verifySession.mockResolvedValue({ ready: true }); await f.scheduler.acknowledgeStop({ approved: true });
    expect((await f.coordinator.inspect()).ledger.stopped).toBeNull(); expect(f.provider.send).toHaveBeenCalledTimes(1);
  });
  it('authentication stops all tasks, counts sent search and preserves pending paid evidence', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [search]); f.queues.set(f.ids[1], [search]);
    f.provider.send.mockResolvedValue({ status: 'rejected', sent: true, code: 401 });
    const result = await f.run(); expect(result.tasks.map(t => t.state)).toEqual(['paused', 'paused']);
    expect(f.provider.send).toHaveBeenCalledTimes(1); expect((await f.coordinator.inspect()).ledger.stopped).toBe('authentication');
  });
  it('optional error limit counts each selected code separately, across tasks', async () => {
    const f = await fixture({ errorPolicy: { codes: [500, 502], count: 2 } });
    f.queues.set(f.ids[0], [search, search]); f.queues.set(f.ids[1], [search, search]);
    f.provider.send.mockResolvedValueOnce({ status: 'rejected', sent: true, code: 500 })
      .mockResolvedValueOnce({ status: 'rejected', sent: true, code: 502 }).mockResolvedValueOnce({ status: 'rejected', sent: true, code: 500 });
    const result = await f.run();
    expect(result.errors).toEqual([{ code: 500, count: 2 }, { code: 502, count: 1 }]); expect(result.reason).toBe('MARKET_ERROR_LIMIT');
    expect(f.provider.send).toHaveBeenCalledTimes(3);
  });
  it('switching account during preflight sends nothing and never writes the new account', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]);
    f.provider.preflight.mockImplementation(async () => { f.changeAccount(); return { ready: true, balance: 10000, freeSlots: 10 }; });
    await f.run(); expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.data.has(marketCoordinationKey({ ...f.account, scope: 'B' }))).toBe(false);
  });
  it('rechecks expiry after preflight; never silently extends an offer', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [{ ...buy(), expiresAt: 1001 }]);
    f.provider.preflight.mockImplementation(async () => { f.advance(2); return { ready: true, balance: 10000, freeSlots: 10 }; });
    const result = await f.run(); expect(result.tasks[0].reason).toBe('MARKET_ACTION_EXPIRED_OR_INVALID'); expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('restored P1 records get revision zero without discarding activity evidence', async () => {
    const f = await fixture(), raw = f.data.get(tradingTaskKey(f.account));
    delete raw.tasks[0].revision; raw.tasks[0].activity.receipts.push({ kind: 'bought', itemId: '9', definitionId: 1001, coins: 500, at: 1 });
    const read = await f.taskStore.read(); expect(read.store.tasks[0].revision).toBe(0); expect(read.store.tasks[0].activity.receipts).toHaveLength(1);
    const next = await f.taskStore.action({ ...read, id: f.ids[0], action: 'copy' });
    expect(next.store.tasks[2].activity.receipts).toEqual([]); expect(next.store.tasks[2].revision).toBe(0);
  });
  it('task deletion consults the independent execution ledger rather than empty P1 activity', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]); await f.run();
    let saved = await f.taskStore.action({ ...await f.taskStore.read(), id: f.ids[0], action: 'delete' });
    expect(saved.store.tasks[0].state).toBe('archived'); expect((await f.coordinator.inspect()).ledger.holdings).toHaveLength(1);
    const g = await fixture(); g.queues.set(g.ids[0], [buy()]); g.provider.send.mockRejectedValue(Error('lost')); await g.run();
    await expect(g.taskStore.action({ ...await g.taskStore.read(), id: g.ids[0], action: 'delete' })).rejects.toThrow('TASKS_UNRESOLVED');
    saved = await g.taskStore.action({ ...await g.taskStore.read(), id: g.ids[0], action: 'stop' });
    expect(saved.store.tasks[0].state).toBe('review'); expect((await g.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
  });
});
