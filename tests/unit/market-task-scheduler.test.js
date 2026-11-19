import { describe, it, expect, vi } from 'vitest';
import { createMarketTaskScheduler } from '../../src/trading/market-task-scheduler.js';
import { createTradingTaskStore, tradingTaskKey } from '../../src/adapters/browser/fc27-trading-task-store.js';
import { createMarketCoordinator, marketCoordinationKey } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { defaultTradingTaskSettings } from '../../src/trading/task-model.js';
import { marketTaskEvidence } from '../../src/trading/market-coordination.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
it('stops after a definite move rejection without dropping the purchased holding',async()=>{
 const f=await fixture();f.queues.set(f.ids[0],[buy(),{kind:'move',itemId:'100',definitionId:1001,coins:0}]);
 const send=f.provider.send.getMockImplementation();
 f.provider.send.mockImplementation(args=>args.action.kind==='move'?{status:'rejected',receipt:null,code:400}:send(args));
 await f.run();
 expect(f.scheduler.inspect().tasks[0]).toMatchObject({state:'paused',reason:'MARKET_MOVE_REJECTED'});
 const ledger=(await f.coordinator.inspect()).ledger;
 expect(ledger.intents.map(i=>[i.kind,i.phase])).toEqual([['buy','confirmed'],['move','rejected']]);
 expect(ledger.holdings[0]).toMatchObject({itemId:'100',phase:'held',cost:800});
});
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

describe('explicit unresolved transaction isolation',()=>{
  async function pending(){
    const f=await fixture();f.queues.set(f.ids[0],[buy()]);
    f.provider.send.mockResolvedValue({status:'unknown',receipt:null});await f.run();f.advance(60000);
    const record=await f.coordinator.inspect();
    return {...f,record,request:{approved:true,context:record.context,revision:record.ledger.revision,requestId:record.ledger.intents[0].id,action:'isolate'}};
  }
  it('retains funds and the old task, allows an unrelated task only after separate release, and later resolves exact evidence',async()=>{
    const f=await pending();const writes=f.provider.send.mock.calls.length;
    const isolated=await f.scheduler.manageRecovery(f.request);
    expect(isolated.stopped).toBe('unknown-write');expect(isolated.intents[0].phase).toBe('isolated');
    expect(f.provider.send).toHaveBeenCalledTimes(writes);expect(f.provider.reconcile).not.toHaveBeenCalled();
    expect(f.scheduler.inspect().evidence.find(e=>e.taskId===f.ids[0]).unresolved).toBe(true);
    await f.scheduler.recover();expect(f.scheduler.inspect().reason).toBe('MARKET_RECOVERY_ISOLATED');
    await f.scheduler.acknowledgeStop({approved:true});
    f.provider.prepare.mockClear();await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:[f.ids[0]]});
    expect(f.provider.prepare).not.toHaveBeenCalled();expect(f.provider.send).toHaveBeenCalledTimes(writes);
    await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:[f.ids[1]]});
    expect(f.provider.prepare).toHaveBeenCalledTimes(1);
    f.provider.reconcile.mockResolvedValue({status:'confirmed',receipt:{itemId:'100',definitionId:1001,tradeId:'offer-100',coins:800}});
    await f.scheduler.recover();const settled=(await f.coordinator.inspect()).ledger;
    expect(settled.intents[0]).toMatchObject({phase:'confirmed',isolation:{source:'user'}});
    expect(settled.holdings[0]).toMatchObject({cost:800,itemId:'100'});
    expect(f.scheduler.inspect().evidence.find(e=>e.taskId===f.ids[0]).unresolved).toBe(false);
    expect(f.provider.send).toHaveBeenCalledTimes(writes);
  });
  it('requires approval, current context and revision, and persists manual notes without settlement',async()=>{
    const f=await pending();
    for(const patch of [{approved:false},{context:{...f.account,scope:'other'}},{revision:0}])await expect(f.scheduler.manageRecovery({...f.request,...patch})).rejects.toThrow();
    await f.scheduler.manageRecovery(f.request);
    await expect(f.scheduler.manageRecovery(f.request)).rejects.toThrow('MARKET_STALE');
    const before=(await f.coordinator.inspect()).ledger;f.advance(1000);
    const note=await f.scheduler.manageRecovery({...f.request,revision:before.revision,action:'handled'});
    expect(note.intents[0]).toMatchObject({phase:'isolated',receipt:null,isolation:{handledAt:f.now()}});
    expect(note.holdings).toEqual(before.holdings);expect(note.stopped).toBe(before.stopped);
  });
  it('does not mutate when a different owner holds the lock or storage fails',async()=>{
    const f=await pending();
    await f.coordinator.withOwner(async()=>{await expect(f.scheduler.manageRecovery(f.request)).rejects.toThrow('MARKET_BUSY');});
    f.hooks.write=()=>{throw Error('disk failed');};
    await expect(f.scheduler.manageRecovery(f.request)).rejects.toThrow('disk failed');
    expect((await f.coordinator.inspect()).ledger).toEqual(f.record.ledger);
  });
  it('does not isolate after a stop during checkpoint read',async()=>{
    const f=await pending();f.scheduler.pauseAll();
    // A disposed owner cannot be revived by an outstanding recovery confirmation.
    f.scheduler.dispose();await expect(f.scheduler.manageRecovery(f.request)).rejects.toThrow('MARKET_OWNER_CLOSED');
    expect((await f.coordinator.inspect()).ledger).toEqual(f.record.ledger);
  });
});

describe('shared session maintenance during approved scheduled waiting', () => {
  async function waiting() {
    const f = await fixture(); let snapshot = f.snapshot;
    for (const id of f.ids) snapshot = await f.taskStore.saveTask({ ...snapshot, id, input: {
      ...f.input('Future'), schedule: { repeat: 'once', zone: 'UTC', start: '2026-11-16T08:00', end: null, sell: '2026-11-16T14:00' }
    } });
    f.provider.maintainSession = vi.fn(async ({ beforeDispatch }) => { beforeDispatch(); return { status: 'online' }; });
    return { ...f, run: () => f.scheduler.run({ approved: true, snapshot, taskIds: f.ids }) };
  }
  it('checks once per account every three minutes while two future tasks wait, with zero trading', async () => {
    const f = await waiting(), start = f.now();
    f.hooks.wait = () => { if (f.now() - start >= 361000) f.scheduler.pauseAll(); };
    await f.run(); expect(f.provider.maintainSession).toHaveBeenCalledTimes(3);
    expect(f.provider.prepare).not.toHaveBeenCalled(); expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.scheduler.inspect().sessionHealth).toEqual({ state: 'idle', lastOnlineAt: start + 360000 });
    expect((await f.coordinator.inspect()).ledger.intents).toHaveLength(0);
    expect(f.data.get('old-journal')).toEqual({ unknown: true });
  });
  it.each([false, true])('projects recovery without trading and keeps waiting (failure=%s)', async fails => {
    const f = await waiting(), start = f.now();
    f.provider.maintainSession.mockImplementation(async ({ beforeDispatch, onProgress }) => {
      for (const state of ['retry-wait', 'retrying']) {
        beforeDispatch(); onProgress({ state, reason: 'FC27_MARKET_READ_TIMEOUT' });
        expect(f.scheduler.inspect().sessionHealth).toMatchObject({ state, lastOnlineAt: null });
        expect(f.scheduler.inspect().tasks.every(t => !['paused', 'stopped'].includes(t.state))).toBe(true);
        expect(f.provider.prepare).not.toHaveBeenCalled(); expect(f.provider.send).not.toHaveBeenCalled();
      }
      f.advance(5000);
      if (fails) throw Error('MARKET_SESSION_UNVERIFIED');
      return { status: 'online' };
    });
    f.hooks.wait = () => {
      expect(f.scheduler.inspect().sessionHealth).toMatchObject({ state: fails ? 'failed' : 'online', lastOnlineAt: fails ? null : start + 5000 });
      expect(f.scheduler.inspect().tasks.every(t => t.state === 'waiting')).toBe(true);
      f.scheduler.pauseAll();
    };
    await f.run(); expect(f.provider.maintainSession).toHaveBeenCalledTimes(1);
    expect(f.scheduler.inspect().sessionHealth.state).toBe(fails ? 'failed' : 'idle');
    expect(f.provider.send).not.toHaveBeenCalled(); expect(f.data.get('old-journal')).toEqual({ unknown: true });
  });
  it('uses recent verified activity and never issues catch-up bursts after a long suspension', async () => {
    const f = await waiting(), start = f.now();
    f.provider.sessionHealth = () => ({ lastOnlineAt: start });
    let waits = 0;
    f.hooks.wait = () => { if (++waits === 1) f.advance(3600000); else f.scheduler.pauseAll(); };
    await f.run(); expect(f.provider.maintainSession).toHaveBeenCalledTimes(1);
  });
  it.each([0, 401, 403, 429, 500, 512])('keeps tasks waiting after maintenance %s without altering old journals', async code => {
    const f = await waiting(); f.provider.maintainSession.mockRejectedValue(Object.assign(Error('MARKET_SESSION_UNVERIFIED'), { code }));
    f.provider.stopTraffic = vi.fn();
    const start = f.now();
    f.hooks.wait = () => {
      expect(f.scheduler.inspect().tasks.every(t => t.state === 'waiting')).toBe(true);
      if (f.now() - start >= 361000) f.scheduler.pauseAll();
    };
    await f.run(); expect(f.provider.maintainSession).toHaveBeenCalledTimes(3);
    expect(f.scheduler.inspect().tasks.every(t => t.reason === 'MARKET_USER_STOP')).toBe(true);
    expect(f.scheduler.inspect().sessionHealth.state).toBe('failed');
    expect((await f.coordinator.inspect()).ledger.stopped).toBeNull();
    expect(f.provider.stopTraffic).not.toHaveBeenCalled(); expect(f.scheduler.inspect().errors).toEqual([]);
    expect(f.provider.prepare).not.toHaveBeenCalled(); expect(f.data.get('old-journal')).toEqual({ unknown: true });
  });
  it('pauses only when the first real execution fails after an unsuccessful health probe', async () => {
    const f = await fixture(), taskId = f.ids[0];
    f.queues.set(taskId, [{ kind: 'search' }]);
    // Make the task immediately eligible and then fail its actual preparation.
    const snapshot = f.snapshot;
    f.provider.maintainSession = vi.fn(async () => { throw Object.assign(Error('MARKET_SESSION_UNVERIFIED'), { code: 0 }); });
    f.provider.prepare.mockRejectedValueOnce(Error('MARKET_SEARCH_FAILED'));
    await f.scheduler.run({ approved: true, snapshot, taskIds: [taskId] });
    expect(f.provider.maintainSession).toHaveBeenCalled();
    expect(f.provider.prepare).toHaveBeenCalledTimes(1);
    expect(f.scheduler.inspect().tasks.find(t => t.id === taskId)).toMatchObject({ state: 'paused', reason: 'MARKET_SEARCH_FAILED' });
  });
  it.each([false, true])('reaches the scheduled execution despite failed maintenance (actual failure=%s)', async fails => {
    const f = await waiting(), executionAt = Date.UTC(2026, 10, 16, 8);
    f.advance(executionAt - 60000 - f.now());
    f.provider.maintainSession.mockRejectedValue(Object.assign(Error('MARKET_SESSION_UNVERIFIED'), { code: 401 }));
    f.provider.stopTraffic = vi.fn();
    for (const id of f.ids) f.queues.set(id, [search]);
    const send = f.provider.send.getMockImplementation();
    f.provider.send.mockImplementation(async args => {
      expect(f.now()).toBeGreaterThanOrEqual(executionAt);
      if (fails) return { status: 'rejected', sent: true, code: 401 };
      return send(args);
    });
    const states = await f.run();
    expect(f.provider.maintainSession).toHaveBeenCalledTimes(1);
    expect(f.provider.send).toHaveBeenCalledTimes(fails ? 1 : 2);
    expect(states.tasks.every(t => t.state === (fails ? 'paused' : 'completed'))).toBe(true);
    expect((await f.coordinator.inspect()).ledger.stopped).toBe(fails ? 'authentication' : null);
    expect(f.provider.stopTraffic).toHaveBeenCalledTimes(fails ? 1 : 0);
  });
  it('clears only the health warning when a later maintenance succeeds', async () => {
    const f = await waiting(), start = f.now();
    f.provider.maintainSession.mockRejectedValueOnce(Error('MARKET_SESSION_UNVERIFIED')).mockResolvedValue({ status: 'online' });
    f.hooks.wait = () => {
      if (f.now() - start < 180001) return;
      expect(f.scheduler.inspect().sessionHealth).toEqual({ state: 'online', lastOnlineAt: start + 180000 });
      expect(f.scheduler.inspect().tasks.every(t => t.state === 'waiting')).toBe(true);
      f.scheduler.pauseAll();
    };
    await f.run(); expect(f.provider.maintainSession).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('keeps two timed sell tasks armed after failed health reads (listing failure=%s)', async fails => {
    const f = await fixture(), sellAt = Date.UTC(2026, 10, 19, 1, 20);
    f.advance(sellAt - 600000 - f.now());
    let snapshot = f.snapshot;
    for (const [index, taskId] of f.ids.entries()) {
      const itemId = String(201 + index), input = f.input('Timed sale');
      input.mode = 'sell'; input.owned = [{ itemId, definitionId: 1001, name: 'Owned', pile: 'transfer' }];
      input.schedule = { repeat: 'once', zone: 'UTC', start: '2026-11-19T01:20', end: null, sell: null };
      snapshot = await f.taskStore.saveTask({ ...snapshot, id: taskId, input });
      await f.coordinator.withOwner(s => s.control(turn => turn.checkpoint(ledger => {
        ledger.holdings.push({ taskId, itemId, definitionId: 1001, phase: 'transfer', cost: 600, listingTradeId: null, salePrice: null });
      })));
      f.queues.set(taskId, [{ kind: 'list', itemId, definitionId: 1001, coins: 700 }]);
    }
    f.provider.maintainSession = vi.fn(async () => { throw Object.assign(Error('MARKET_SESSION_UNVERIFIED'), { code: 401 }); });
    const send = f.provider.send.getMockImplementation();
    f.provider.send.mockImplementation(args => {
      expect(f.now()).toBeGreaterThanOrEqual(sellAt);
      return fails ? { status: 'unknown', code: 401 } : send(args);
    });
    await f.scheduler.run({ approved: true, snapshot, taskIds: f.ids });
    expect(f.provider.maintainSession).toHaveBeenCalledTimes(4);
    expect(f.provider.send).toHaveBeenCalledTimes(fails ? 1 : 2);
    const ledger = (await f.coordinator.inspect()).ledger;
    expect(ledger.intents.every(i => i.kind === 'list' && i.phase === (fails ? 'pending' : 'confirmed'))).toBe(true);
    expect(ledger.holdings.every(h => h.cost === 600 && h.phase === (fails ? 'transfer' : 'listed'))).toBe(true);
    expect(f.scheduler.inspect().tasks.every(t => t.state === (fails ? 'paused' : 'completed'))).toBe(true);
  });
  it('still stops on account change during failed maintenance', async () => {
    const f = await waiting();
    f.provider.maintainSession.mockImplementation(async () => { f.changeAccount(); throw Error('MARKET_SESSION_UNVERIFIED'); });
    await f.run();
    expect(f.scheduler.inspect().tasks.every(t => t.state === 'paused' && t.reason === 'TASKS_CONTEXT_CHANGED')).toBe(true);
    expect(f.provider.prepare).not.toHaveBeenCalled(); expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('cancels before dispatch and does not undo a user stop after an awaited check', async () => {
    const f = await waiting(), sent = vi.fn();
    f.provider.maintainSession.mockImplementation(async ({ beforeDispatch }) => { await Promise.resolve(); f.scheduler.pauseAll(); beforeDispatch(); sent(); });
    await f.run(); expect(sent).not.toHaveBeenCalled(); expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.scheduler.inspect().tasks.every(t => t.reason === 'MARKET_USER_STOP')).toBe(true);
  });
  it('does not probe when settings were edited or shared traffic already stopped', async () => {
    for (const shared of [false, true]) {
      const f = await waiting();
      if (shared) f.provider.traffic = async () => ({ ledger: { stopped: 'authentication' } });
      else await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[0], input: f.input('Changed') });
      if (!shared) await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[1], input: f.input('Changed') });
      await f.run(); expect(f.provider.maintainSession).not.toHaveBeenCalled();
    }
  });
});

describe('approved task scheduler with simulated providers', () => {
  it('explicitly reopens the same stopped task without losing holdings, spend or elapsed time', async () => {
    const f = await fixture(); f.queues.set(f.ids[0], [buy()]); await f.run();
    const snapshot = await f.taskStore.action({ ...await f.taskStore.read(), id: f.ids[0], action: 'stop' });
    await f.coordinator.withOwner(s => s.control(t => t.checkpoint(l => {
      Object.assign(l.clocks.find(c => c.taskId === f.ids[0]), { stopped: true, elapsedMs: 23000 });
    })));
    const before = (await f.coordinator.inspect()).ledger;
    const next = await f.scheduler.reopen({ approved: true, snapshot, taskId: f.ids[0] });
    expect(next.store.tasks[0]).toMatchObject({ id: f.ids[0], state: 'paused' });
    expect(next.store.tasks[0].stopRequested).toBeUndefined();
    const after = (await f.coordinator.inspect()).ledger;
    expect(after.holdings).toEqual(before.holdings); expect(after.intents).toEqual(before.intents);
    expect(after.clocks.find(c => c.taskId === f.ids[0])).toMatchObject({ stopped: false, elapsedMs: 23000 });
    expect(f.provider.send).toHaveBeenCalledTimes(1);
    f.queues.set(f.ids[0], [search]);
    await f.scheduler.run({ approved: true, snapshot: next, taskIds: [f.ids[0]] });
    expect(f.events.map(e => e.kind)).toEqual(['buy', 'search']);
  });
  it('allows a stopped task to edit its time limit but only explicit reopen clears its clock', async () => {
    const f = await fixture();
    await f.coordinator.withOwner(s => s.control(t => t.checkpoint(l => {
      l.clocks = [{ taskId: f.ids[0], stopped: true, elapsedMs: 60000, lease: null }];
    })));
    const input = f.input('More time'); input.settings.runMinutes = 2;
    const snapshot = await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[0], input });
    expect((await f.coordinator.inspect()).ledger.clocks[0].stopped).toBe(true);
    const next = await f.scheduler.reopen({ approved: true, snapshot, taskId: f.ids[0] });
    expect((await f.coordinator.inspect()).ledger.clocks[0]).toMatchObject({ elapsedMs: 60000, stopped: false });
    expect(next.store.tasks[0].settings.runMinutes).toBe(2);
    await expect(f.scheduler.reopen({ approved: true, snapshot: next, taskId: f.ids[0] })).rejects.toThrow('TASK_SELECTION_INVALID');
    expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('reopens and enqueues a stopped task while another task owns the scheduler', async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    const snapshot = await f.taskStore.action({ ...await f.taskStore.read(), id: f.ids[1], action: 'stop' });
    f.hooks.wait = async () => { entered.resolve(); await release.promise; };
    f.provider.prepare.mockImplementation(async ({ task }) => task.id === f.ids[0]
      ? { kind: 'wait', until: f.now() + 1000 }
      : { kind: 'done' });
    const running = f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
    await entered.promise;
    const reopened = await f.scheduler.reopen({ approved: true, snapshot, taskId: f.ids[1] });
    await f.scheduler.enqueue({ approved: true, snapshot: reopened, taskIds: [f.ids[1]] });
    expect(f.scheduler.inspect().tasks.find(t => t.id === f.ids[1]).state).toBe('queued');
    f.scheduler.pause(f.ids[0]); release.resolve(); await running;
    expect(f.scheduler.inspect().tasks.find(t => t.id === f.ids[1]).state).toBe('completed');
    expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('retains the original cumulative spending cap after restart', async () => {
    const f = await fixture(), input = f.input('Capped'); input.settings.spendCap = 800;
    let snapshot = await f.taskStore.saveTask({ ...await f.taskStore.read(), id: f.ids[0], input });
    f.queues.set(f.ids[0], [buy()]);
    await f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
    snapshot = await f.taskStore.action({ ...await f.taskStore.read(), id: f.ids[0], action: 'stop' });
    snapshot = await f.scheduler.reopen({ approved: true, snapshot, taskId: f.ids[0] });
    f.queues.set(f.ids[0], [buy('101')]);
    await f.scheduler.run({ approved: true, snapshot, taskIds: [f.ids[0]] });
    expect(f.provider.send).toHaveBeenCalledTimes(1);
    expect(f.scheduler.inspect().tasks[0].reason).toBe('MARKET_SPEND_CAP');
    expect((await f.coordinator.inspect()).ledger.holdings).toHaveLength(1);
  });
  it.each(['unapproved', 'shared', 'pending', 'elapsed', 'stale', 'cancelled', 'save-failed'])('does not restart or send on %s recovery', async reason => {
    const f = await fixture(); let snapshot = await f.taskStore.action({ ...await f.taskStore.read(), id: f.ids[0], action: 'stop' });
    if (reason === 'elapsed') {
      const input = f.input('Limited'); input.settings.runMinutes = 1;
      snapshot = await f.taskStore.saveTask({ ...snapshot, id: f.ids[0], input });
    }
    await f.coordinator.withOwner(s => s.control(t => t.checkpoint(l => {
      l.clocks = [{ taskId: f.ids[0], stopped: true, elapsedMs: 60000, lease: null }];
      if (reason === 'shared') l.stopped = 'throttle';
      if (reason === 'pending') l.intents.push({ id: 'pending', taskId: f.ids[1], kind: 'buy', itemId: '100', definitionId: 1001, tradeId: '200', coins: 800, at: 1000, phase: 'pending', receipt: null });
    })));
    if (reason === 'stale') await f.taskStore.action({ ...snapshot, id: f.ids[1], action: 'pause' });
    if (reason === 'cancelled') f.provider.traffic = async () => { f.scheduler.pauseAll(); return null; };
    if (reason === 'save-failed') f.hooks.write = key => { if (key === tradingTaskKey(f.account)) throw Error('storage failed'); };
    await expect(f.scheduler.reopen({ approved: reason !== 'unapproved', snapshot, taskId: f.ids[0] })).rejects.toThrow();
    expect((await f.taskStore.read()).store.tasks[0].state).toBe('stopped');
    expect(f.provider.send).not.toHaveBeenCalled();
  });
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
  it('applies the recipient scheduled sale time during explicit holding handoff',async()=>{
    const f=await handoffFixture(),t=f.options.snapshot.store.tasks[1];
    const snapshot=await f.taskStore.saveTask({...f.options.snapshot,id:t.id,input:{name:t.name,mode:t.mode,settings:t.settings,players:t.players,owned:t.owned,excluded:t.excluded,
      schedule:{repeat:'once',zone:'UTC',start:'2026-11-16T14:00',end:null,sell:null}}});
    await f.scheduler.handoff({...f.options,snapshot});
    expect((await f.coordinator.inspect()).ledger.holdings[0]).toMatchObject({sellAt:Date.parse('2026-11-16T14:00Z'),cost:650});
    expect(f.provider.send).not.toHaveBeenCalled();
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
