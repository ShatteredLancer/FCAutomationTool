import { expect, it, vi } from 'vitest';
import { createStreamlinedProcurement } from '../../src/streamlined/procurement.js';
import { createStreamlinedPurchaseJournal, streamlinedPurchaseKey } from '../../src/streamlined/purchase-journal.js';

const context = { schema: 1, season: '27', accountScope: 'p', platform: 'psn:test' };
const item = (id, definitionId, points = 20, source = 'inventory') => ({ id: source === 'inventory' ? id : null,
  definitionId, points, source, key: source === 'inventory' ? `item:${id}` : `market:${definitionId}:0`, price: source === 'market' ? 200 : null,
  purchaseMaxBuy: source === 'market' ? 250 : undefined });
const planFor = ({ inventory = [], market = [], targetScore = 20 } = {}) => ({
  context, challenge: { id: 1, setId: 2, targetScore, submittedScore: 0, selectionLimit: 30 },
  policy: {}, route: { groups: [
    ...(inventory.length ? [{ source: 'inventory', quantity: inventory.length, item: inventory[0], items: inventory }] : []),
    ...(market.length ? [{ source: 'market', quantity: Math.ceil(targetScore / market[0].points), item: market[0], items: market }] : []),
  ] },
});
const setup = (stored = null) => {
  const values = new Map(stored ? [[streamlinedPurchaseKey(context), stored]] : []);
  const journal = createStreamlinedPurchaseJournal({ get: async (key, fallback) => structuredClone(values.has(key) ? values.get(key) : fallback),
    set: async (key, value) => values.set(key, structuredClone(value)) });
  return { journal, values };
};
const baseAdapter = (rows, overrides = {}) => ({
  assertCurrent: vi.fn(async () => {}), locate: vi.fn(async () => 'club'),
  materialize: vi.fn(async entries => entries.map(entry => rows.find(row => row.id === entry.itemId)).filter(Boolean)),
  readState: vi.fn(async record => ({ submittedScore: record.submittedScore, freeSlots: 30, heldDefinitions: [], blockedDefinitions: [] })),
  find: vi.fn(), buy: vi.fn(), move: vi.fn(async () => ({ status: 'bought' })), afterPlayer: vi.fn(),
  prepareContribution: vi.fn(async material => ({ material })),
  contribute: vi.fn(async (_plan, _record) => ({ confirmed: true, submittedScore: 20 })),
  recoverContribution: vi.fn(async () => ({ confirmed: true, submittedScore: 20 })),
  ...overrides,
});
const approval = plan => ({ approved: true, fingerprint: plan.fingerprint ?? JSON.stringify(plan), budget: 5000, attempts: 2, expiresAt: Date.now() + 60000 });
const lock = { acquire: vi.fn(async () => () => {}) };

it('contributes approved inventory and persists exact consumed identity', async () => {
  const inv = item(11, 101), plan = planFor({ inventory: [inv] }), { journal } = setup();
  const adapter = baseAdapter([inv]);
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op', now: Date.now }).execute(plan, approval(plan));
  expect(result.status).toBe('completed');
  expect(result.record.consumedIds).toEqual([11]);
  expect(result.record.spent).toBe(0);
  expect(adapter.find).not.toHaveBeenCalled();
});

it('keeps rejected auction attempts out of spent totals and can try a replacement', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market] }), { journal } = setup();
  const offers = [{ definitionId: 201, itemId: 401, tradeId: '501', price: 200 }, { definitionId: 201, itemId: 402, tradeId: '502', price: 200 }];
  let findCount = 0; const adapter = baseAdapter([], {
    find: vi.fn(async () => offers[Math.min(findCount++, offers.length - 1)]),
    buy: vi.fn(async entry => entry.itemId === 401 ? { status: 'rejected' } : { status: 'bought', ...entry }),
    locate: vi.fn(async () => 'club'),
    materialize: vi.fn(async entries => entries.map(entry => ({ ...market, id: entry.itemId, key: `item:${entry.itemId}`, source: 'inventory', pile: 'club', tradeable: false }))),
    contribute: vi.fn(async () => ({ confirmed: true, submittedScore: 20 })),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op', now: Date.now }).execute(plan, approval(plan));
  expect(result.status).toBe('completed');
  expect(result.record.spent).toBe(200);
  expect(result.record.entries.filter(entry => entry.state === 'rejected')).toHaveLength(1);
});

it('allows expiry-time reconciliation of a pending buy but performs no new write', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market] }), { journal } = setup();
  const old = { schema: 1, context, operationId: 'op', revision: 1, fingerprint: JSON.stringify(plan), challenge: plan.challenge,
    policy: {}, route: plan.route, budget: 5000, spent: 0, submittedScore: 0, entries: [{ key: 'op:0', source: 'market', groupIndex: 0,
      definitionId: 201, itemId: 401, tradeId: '501', price: 200, cap: 250, state: 'buy-pending' }], consumedIds: [], fulfilled: [0], contribution: null, completed: false };
  const { journal: pendingJournal } = setup(old), adapter = baseAdapter([], { locate: vi.fn(async () => 'purchased') });
  const result = await createStreamlinedProcurement({ journal: pendingJournal, lock, adapter, operationId: () => 'new', now: () => 1000 }).execute(plan,
    { ...approval(plan), expiresAt: 999 });
  expect(result.status).toBe('paused');
  expect(result.reason).toBe('FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED');
  expect(result.record.entries[0].state).toBe('bought');
  expect(adapter.find).not.toHaveBeenCalled();
});

it('does not start a second run for the same completed approval', async () => {
  const inv = item(11, 101), plan = planFor({ inventory: [inv] }), { journal } = setup();
  const adapter = baseAdapter([inv]);
  const first = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op', now: Date.now }).execute(plan, approval(plan));
  const second = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'new', now: Date.now }).execute(plan, approval(plan));
  expect(first.status).toBe('completed'); expect(second.status).toBe('completed');
  expect(adapter.contribute).toHaveBeenCalledTimes(1);
});

const pendingRecord = (plan, state = 'buy-pending') => ({ schema: 1, context, operationId: 'op', revision: 1,
  fingerprint: JSON.stringify(plan), plan, challenge: plan.challenge, policy: plan.policy, route: plan.route,
  budget: 5000, spent: state === 'buy-pending' ? 0 : 200, submittedScore: 0,
  entries: [{ key: 'op:0', source: 'market', groupIndex: 0, definitionId: 201,
    itemId: 401, tradeId: '501', price: 200, cap: 250, state }],
  consumedIds: [], fulfilled: [0], contribution: null, completed: false });

it('read-only recovery without a journal never creates a purchase approval or record', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal, values } = setup();
  const adapter = baseAdapter([]);
  const result = await createStreamlinedProcurement({ journal, lock, adapter }).execute(plan, null, { reconcileOnly: true });
  expect(result.status).toBe('absent'); expect(values.size).toBe(0);
  expect(adapter.buy).not.toHaveBeenCalled(); expect(adapter.move).not.toHaveBeenCalled(); expect(adapter.contribute).not.toHaveBeenCalled();
});

it.each(['buy-pending', 'bought', 'move-pending', 'club'])('reconciles %s without purchase authorization or EA writes', async state => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup(pendingRecord(plan, state));
  const adapter = baseAdapter([]);
  const result = await createStreamlinedProcurement({ journal, lock, adapter, now: () => 999999 }).execute(plan, null, { reconcileOnly: true });
  expect(result).toMatchObject({ status: 'recovered', record: { spent: 200, entries: [{ state: 'club' }] } });
  for (const key of ['find', 'buy', 'move', 'prepareContribution', 'contribute']) expect(adapter[key]).not.toHaveBeenCalled();
});

it('does not interpret missing pending purchase identity as permission to buy again', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup(pendingRecord(plan));
  const adapter = baseAdapter([], { locate: vi.fn(async () => 'unknown') });
  const result = await createStreamlinedProcurement({ journal, lock, adapter }).execute(plan, null, { reconcileOnly: true });
  expect(result).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_RECOVERY_REQUIRED' });
  expect((await journal.read(context)).entries[0].state).toBe('buy-pending'); expect(adapter.buy).not.toHaveBeenCalled();
});

it('reconciles a last contribution to completed and never resubmits it', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), saved = pendingRecord(plan, 'club');
  saved.contribution = { material: [{ groupIndex: 0, item: { id: 401, definitionId: 201, points: 20 } }], batchPlan: {} };
  const { journal } = setup(saved), adapter = baseAdapter([], { locate: vi.fn(async () => 'absent') });
  const driver = createStreamlinedProcurement({ journal, lock, adapter });
  expect(await driver.execute(plan, null, { reconcileOnly: true })).toMatchObject({ status: 'completed', record: { completed: true, submittedScore: 20 } });
  expect(await driver.execute(plan, null, { reconcileOnly: true })).toMatchObject({ status: 'completed' });
  expect(adapter.recoverContribution).toHaveBeenCalledOnce(); expect(adapter.contribute).not.toHaveBeenCalled();
  expect(adapter.locate).not.toHaveBeenCalled();
});

it('checks an unconsumed Club receipt during read-only recovery', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup(pendingRecord(plan, 'club'));
  const adapter = baseAdapter([], { locate: vi.fn(async () => 'absent') });
  const result = await createStreamlinedProcurement({ journal, lock, adapter }).execute(plan, null, { reconcileOnly: true });
  expect(result.status).toBe('recovery-required'); expect(adapter.buy).not.toHaveBeenCalled();
});

it('tries approved alternative versions before pausing and does not buy beyond remaining points', async () => {
  const market = [201, 202, 203].map(id => item(0, id, 20, 'market')), plan = planFor({ market }), { journal } = setup();
  const adapter = baseAdapter([], {
    find: vi.fn(async candidate => candidate.definitionId === 201 ? null :
      { definitionId: candidate.definitionId, itemId: 401, tradeId: '501', price: 200 }),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })),
    materialize: vi.fn(async entries => entries.map(e => ({ ...market.find(i => i.definitionId === e.definitionId), id: e.itemId }))),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result.status).toBe('completed'); expect(result.record.spent).toBe(200);
  expect(adapter.find.mock.calls.map(([i]) => i.definitionId)).toEqual([201, 202]);
  expect(adapter.buy).toHaveBeenCalledOnce();
});

it('contributes partial supply, then repeats a version only after confirmed consumption', async () => {
  const market = [201, 202].map(id => item(0, id, 20, 'market')), plan = planFor({ market, targetScore: 40 }), { journal } = setup();
  let nextId = 400, score = 0;
  const adapter = baseAdapter([], {
    find: vi.fn(async candidate => candidate.definitionId === 202 ? null :
      { definitionId: 201, itemId: ++nextId, tradeId: String(nextId + 100), price: 200 }),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })),
    materialize: vi.fn(async entries => entries.map(e => ({ ...market[0], id: e.itemId }))),
    contribute: vi.fn(async batch => ({ confirmed: true, submittedScore: score += batch.material.length * 20 })),
    waitForPartial: vi.fn(),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result.status).toBe('completed'); expect(result.record.consumedIds).toEqual([401, 402]);
  expect(adapter.contribute.mock.calls.map(([p]) => p.material.length)).toEqual([1, 1]);
  expect(adapter.contribute.mock.invocationCallOrder[0]).toBeLessThan(adapter.buy.mock.invocationCallOrder[1]);
});

it('a lost receipt checkpoint stops and later reconciles without sending a second bid', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market] }), storage = setup();
  let rejectReceipt = true;
  const journal = { ...storage.journal, write: async (...args) => {
    if (rejectReceipt && args[0].entries.some(e => e.state === 'bought')) throw Error('FC27_STREAMLINED_PURCHASE_JOURNAL_WRITE_FAILED');
    return storage.journal.write(...args);
  } };
  const adapter = baseAdapter([], { find: vi.fn(async () => ({ definitionId: 201, itemId: 401, tradeId: '501', price: 200 })),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })) });
  const driver = createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' });
  expect(await driver.execute(plan, approval(plan))).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_JOURNAL_WRITE_FAILED' });
  expect((await journal.read(context)).entries[0].state).toBe('buy-pending');
  rejectReceipt = false;
  expect(await driver.execute(plan, null, { reconcileOnly: true })).toMatchObject({ status: 'recovered', record: { spent: 200 } });
  expect(adapter.buy).toHaveBeenCalledOnce(); expect(adapter.move).not.toHaveBeenCalled();
});

it('honors Stop during an in-flight buy after persisting its receipt', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup();
  let driver;
  const adapter = baseAdapter([], { find: vi.fn(async () => ({ definitionId: 201, itemId: 401, tradeId: '501', price: 200 })),
    buy: vi.fn(async entry => { driver.stop(); return { ...entry, status: 'bought' }; }) });
  driver = createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' });
  expect(await driver.execute(plan, approval(plan))).toMatchObject({ status: 'stopped', record: { spent: 200, entries: [{ state: 'bought' }] } });
  expect(adapter.move).not.toHaveBeenCalled(); expect(adapter.contribute).not.toHaveBeenCalled();
});

it('does not require a consumed receipt to remain in Club during ordinary resume', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market], targetScore: 40 });
  const saved = pendingRecord(plan, 'club'); saved.consumedIds = [401];
  saved.entries[0].state = 'consumed'; saved.spent = 200; saved.fulfilled = [1]; saved.submittedScore = 20;
  const { journal } = setup(saved), adapter = baseAdapter([], { locate: vi.fn(async () => 'absent') });
  const result = await createStreamlinedProcurement({ journal, lock, adapter }).execute(plan, null, { reconcileOnly: true });
  expect(result.status).toBe('recovered'); expect(adapter.locate).not.toHaveBeenCalled();
});

it('downgrades stale Club location during recovery without moving or spending', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup(pendingRecord(plan, 'club'));
  const adapter = baseAdapter([], { locate: vi.fn(async () => 'purchased') });
  const result = await createStreamlinedProcurement({ journal, lock, adapter }).execute(plan, null, { reconcileOnly: true });
  expect(result).toMatchObject({ status: 'recovered', record: { spent: 200, entries: [{ state: 'bought' }] } });
  expect(adapter.move).not.toHaveBeenCalled(); expect(adapter.contribute).not.toHaveBeenCalled();
});

it('skips held versions and uses each alternative frozen cap without raising it', async () => {
  const market = [201, 202, 203].map(id => ({ ...item(0, id, 20, 'market'), purchaseMaxBuy: id === 202 ? 300 : 250 }));
  const plan = planFor({ market }), { journal } = setup();
  const adapter = baseAdapter([], { readState: vi.fn(async () => ({ submittedScore: 0, freeSlots: 30, heldDefinitions: [201] })),
    find: vi.fn(async candidate => candidate.definitionId === 202 ? null : { definitionId: 203, itemId: 401, tradeId: '501', price: 300 }) });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(adapter.find.mock.calls.map(([i, cap]) => [i.definitionId, cap])).toEqual([[202, 300], [203, 250]]);
  expect(result.reason).toBe('FC27_STREAMLINED_PURCHASE_OFFER_CHANGED'); expect(adapter.buy).not.toHaveBeenCalled();
});

it.each(['no-supply', 'budget', 'capacity'])('pauses %s without any empty contribution', async reason => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup();
  const adapter = baseAdapter([], { readState: vi.fn(async () => ({ submittedScore: 0, freeSlots: reason === 'capacity' ? 0 : 30 })) });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan,
    { ...approval(plan), budget: reason === 'budget' ? 100 : 5000 });
  expect(result.status).toBe('paused'); expect(adapter.buy).not.toHaveBeenCalled(); expect(adapter.contribute).not.toHaveBeenCalled();
});

it('closes an 18/30 wave with visible ready progress, then pauses on zero supply', async () => {
  const market = Array.from({ length: 30 }, (_, i) => item(0, 201 + i, 20, 'market'));
  const plan = planFor({ market, targetScore: 600 }), { journal } = setup(); let score = 0;
  const progress = [], adapter = baseAdapter([], {
    find: vi.fn(async candidate => score || candidate.definitionId >= 219 ? null : {
      definitionId: candidate.definitionId, itemId: candidate.definitionId + 200, tradeId: String(candidate.definitionId + 400), price: 200 }),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })),
    materialize: vi.fn(async entries => entries.map(e => ({ ...market.find(i => i.definitionId === e.definitionId), id: e.itemId }))),
    waitForPartial: vi.fn(), contribute: vi.fn(async batch => ({ confirmed: true, submittedScore: score += batch.material.length * 20 })),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan,
    { ...approval(plan), budget: 10000, idleMs: 1234 }, { onProgress: row => progress.push(row) });
  expect(result).toMatchObject({ status: 'paused', record: { submittedScore: 360, spent: 3600 } });
  expect(adapter.contribute).toHaveBeenCalledOnce(); expect(adapter.buy).toHaveBeenCalledTimes(18);
  expect(progress).toContainEqual(expect.objectContaining({ phase: 'partial-ready', readyCount: 18, readyPoints: 360, selectionLimit: 30 }));
  expect(adapter.waitForPartial.mock.calls[0][0]).toBeLessThanOrEqual(1234);
});
