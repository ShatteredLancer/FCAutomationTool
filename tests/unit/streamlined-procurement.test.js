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

it('preserves confirmed contribution display evidence across purchase recovery without settling or resending', async () => {
  const stock = item(1, 201), plan = planFor({ inventory: [stock] }), { journal } = setup();
  const confirmation = { submittedScore: 20, targetScore: 20, completed: true, finalizationPending: true };
  const pending = { confirmed: false, reason: 'FC27_STREAMLINED_SET_CHANGED', confirmation };
  const adapter = baseAdapter([stock], { contribute: vi.fn(async () => pending), recoverContribution: vi.fn(async () => pending) });
  const driver = createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' });
  for (let i = 0; i < 2; i++) {
    const result = await driver.execute(plan, approval(plan));
    expect(result).toMatchObject({ status: 'recovery-required', reason: pending.reason, confirmation,
      record: { submittedScore: 0, consumedIds: [], completed: false } });
    expect(result.record.contribution).toBeTruthy();
  }
  expect(adapter.contribute).toHaveBeenCalledOnce();
  expect(adapter.recoverContribution).toHaveBeenCalledOnce();
  expect(adapter.buy).not.toHaveBeenCalled();
});

it.each([
  ['capacity', { freeSlots: 0 }, 'FC27_STREAMLINED_PURCHASE_CAPACITY_FULL'],
  ['held version', { heldDefinitions: [201] }, 'FC27_STREAMLINED_PURCHASE_VERSION_HELD'],
])('reports %s without pretending a market search found no supply', async (_label, state, reason) => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup();
  const adapter = baseAdapter([], { readState: vi.fn(async r => ({ submittedScore: r.submittedScore,
    freeSlots: 30, heldDefinitions: [], ...state })) });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result).toMatchObject({ status: 'paused', reason });
  expect(adapter.find).not.toHaveBeenCalled(); expect(adapter.buy).not.toHaveBeenCalled();
});

it('retains a known search rejection rather than reporting no affordable supply', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup();
  const adapter = baseAdapter([], { find: vi.fn(async () => ({ unavailable: true, reason: 'FC27_BUY_SEARCH_FAILED', code: 521 })) });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_BUY_SEARCH_FAILED' });
  expect(adapter.buy).not.toHaveBeenCalled();
});

it('pauses a read-only holdings failure and retries directly without making up a pending receipt', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market] }), { journal } = setup();
  const adapter = baseAdapter([], {
    find: vi.fn(async () => ({ definitionId: 201, itemId: 401, tradeId: '501', price: 200 })),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })), materialize: vi.fn(async () => [{ ...market, id: 401 }]),
  });
  adapter.readState.mockRejectedValueOnce(Error('FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED'));
  const driver = createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' });
  expect(await driver.execute(plan, approval(plan))).toMatchObject({ status: 'paused',
    reason: 'FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED', record: { spent: 0, entries: [], contribution: null } });
  for (const key of ['find', 'buy', 'move', 'contribute']) expect(adapter[key]).not.toHaveBeenCalled();
  expect(await driver.execute(plan, approval(plan))).toMatchObject({ status: 'completed', record: { spent: 200 } });
  expect(adapter.buy).toHaveBeenCalledOnce();
});

it('accepts an explicitly approved replacement plan when the previous run has zero effects', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup();
  const adapter = baseAdapter([], { find: vi.fn(async () => null) });
  const driver = createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' });
  expect((await driver.execute(plan, approval(plan))).status).toBe('paused');
  const next = planFor({ market: [item(0, 202, 20, 'market')] });
  expect((await driver.execute(next, approval(next))).status).toBe('paused');
  expect(adapter.find.mock.calls.map(([card]) => card.definitionId)).toEqual([201, 202]);
  expect(adapter.buy).not.toHaveBeenCalled();
});

it('searches within the remaining budget instead of skipping a cheaper offer because the original per-card cap is higher', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market] }), { journal } = setup();
  const adapter = baseAdapter([], { find: vi.fn(async () => ({ definitionId: 201, itemId: 401, tradeId: '501', price: 200 })),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })), materialize: vi.fn(async () => [{ ...market, id: 401 }]) });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' })
    .execute(plan, { ...approval(plan), budget: 200 });
  expect(result).toMatchObject({ status: 'completed', record: { spent: 200, budget: 200 } });
  expect(adapter.find).toHaveBeenCalledWith(market, 200, expect.any(Object));
  expect(result.record.entries[0].cap).toBe(200); expect(market.purchaseMaxBuy).toBe(250);
});

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

it('archives a completed target and starts a different target only under its new explicit approval', async () => {
  const firstCard = item(11, 101), nextCard = item(12, 102), first = planFor({ inventory: [firstCard] });
  const next = planFor({ inventory: [nextCard] }); next.challenge = { ...next.challenge, id: 3, setId: 4 };
  const { journal, values } = setup(), adapter = baseAdapter([firstCard, nextCard]);
  const driver = createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' });
  expect((await driver.execute(first, approval(first))).status).toBe('completed');
  expect((await driver.execute(next, { ...approval(next), approved: false })).status).toBe('recovery-required');
  expect(adapter.contribute).toHaveBeenCalledOnce();
  expect(await driver.execute(next, approval(next))).toMatchObject({ status: 'completed', record: { consumedIds: [12] } });
  expect(adapter.contribute).toHaveBeenCalledTimes(2);
  expect([...values.entries()].filter(([key]) => key.includes(':history:'))[0][1])
    .toMatchObject({ completed: true, consumedIds: [11], challenge: { id: 1, setId: 2 } });
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

it('does not downgrade an unresolved buy to a retryable holdings pause', async () => {
  const plan = planFor({ market: [item(0, 201, 20, 'market')] }), { journal } = setup(pendingRecord(plan));
  const adapter = baseAdapter([], { locate: vi.fn(async () => 'unknown'),
    readState: vi.fn(async () => { throw Error('FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED'); }) });
  const result = await createStreamlinedProcurement({ journal, lock, adapter }).execute(plan, approval(plan));
  expect(result).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_RECOVERY_REQUIRED' });
  expect(adapter.readState).not.toHaveBeenCalled(); expect(adapter.buy).not.toHaveBeenCalled();
  expect((await journal.read(context)).entries[0].state).toBe('buy-pending');
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
  const progress = [];
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
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' })
    .execute(plan, approval(plan), { onProgress: p => progress.push(p) });
  expect(result.status).toBe('completed'); expect(result.record.consumedIds).toEqual([401, 402]);
  expect(adapter.contribute.mock.calls.map(([p]) => p.material.length)).toEqual([1, 1]);
  expect(adapter.contribute.mock.invocationCallOrder[0]).toBeLessThan(adapter.buy.mock.invocationCallOrder[1]);
  expect(progress.some(p => p.phase === 'checking-state')).toBe(true);
  expect(progress.find(p => p.phase === 'search')).toMatchObject({ maxBuy: 250, attempt: 1, attemptLimit: 2 });
  expect(progress.find(p => p.phase === 'partial-ready').waitMs).toBe(0);
  expect(adapter.waitForPartial).not.toHaveBeenCalled();
});

it('skips a stale already-consumed auction and completes the next batch without a duplicate bid', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market], targetScore: 40 }), { journal } = setup();
  const first = { definitionId: 201, itemId: 401, tradeId: '501', price: 200 };
  const second = { definitionId: 201, itemId: 402, tradeId: '502', price: 200 };
  const offers = [first, first, second]; let at = 0, score = 0;
  const adapter = baseAdapter([], {
    find: vi.fn(async () => offers[Math.min(at++, offers.length - 1)]),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })),
    materialize: vi.fn(async entries => entries.map(e => ({ ...market, id: e.itemId }))),
    contribute: vi.fn(async batch => ({ confirmed: true, submittedScore: score += batch.material.length * 20 })),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result).toMatchObject({ status: 'completed', record: { spent: 400, submittedScore: 40, consumedIds: [401, 402] } });
  expect(adapter.buy.mock.calls.map(([entry]) => entry.tradeId)).toEqual(['501', '502']);
  expect(adapter.contribute).toHaveBeenCalledTimes(2);
});

it('treats exhausted known stale auctions as bounded scarcity, not an unknown transaction', async () => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market], targetScore: 40 }), { journal } = setup();
  const offer = { definitionId: 201, itemId: 401, tradeId: '501', price: 200 };
  const adapter = baseAdapter([], { find: vi.fn(async () => offer), buy: vi.fn(async entry => ({ ...entry, status: 'bought' })),
    materialize: vi.fn(async entries => entries.map(e => ({ ...market, id: e.itemId }))),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY',
    record: { spent: 200, submittedScore: 20, consumedIds: [401], contribution: null } });
  expect(adapter.buy).toHaveBeenCalledOnce(); expect(adapter.find).toHaveBeenCalledTimes(3);
});

it.each([
  ['definition', { definitionId: 999, itemId: 401, tradeId: '501', price: 200 }],
  ['price', { definitionId: 201, itemId: 401, tradeId: '501', price: 300 }],
  ['item', { definitionId: 201, itemId: null, tradeId: '501', price: 200 }],
  ['trade', { definitionId: 201, itemId: 401, tradeId: 'invalid', price: 200 }],
])('retains the %s offer guard with a redacted cause and no bid', async (mismatch, offer) => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market] }), { journal } = setup();
  const adapter = baseAdapter([], { find: vi.fn(async () => offer) });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_OFFER_CHANGED', mismatch });
  expect(adapter.buy).not.toHaveBeenCalled(); expect(adapter.move).not.toHaveBeenCalled();
});

it.each(['trade', 'item'])('does not disguise a changed %s identity on a settled listing as stale supply', async changed => {
  const market = item(0, 201, 20, 'market'), plan = planFor({ market: [market], targetScore: 40 }), { journal } = setup();
  const offer = { definitionId: 201, itemId: 401, tradeId: '501', price: 200 };
  const changedOffer = changed === 'trade' ? { ...offer, tradeId: '502' } : { ...offer, itemId: 402 };
  const adapter = baseAdapter([], { find: vi.fn().mockResolvedValueOnce(offer).mockResolvedValue(changedOffer),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })),
    materialize: vi.fn(async entries => entries.map(e => ({ ...market, id: e.itemId }))),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' }).execute(plan, approval(plan));
  expect(result).toMatchObject({ reason: 'FC27_STREAMLINED_PURCHASE_OFFER_CHANGED', mismatch: 'record-identity',
    record: { spent: 200, consumedIds: [401] } });
  expect(adapter.buy).toHaveBeenCalledOnce();
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
  expect(progress.find(p => p.phase === 'partial-ready').waitMs).toBe(0);
  expect(adapter.waitForPartial).not.toHaveBeenCalled();
});

it('uses a Club copy before an external copy of the same definition', async () => {
  const club = { ...item(11, 101, 20), pile: 'club' };
  const unassigned = { ...item(12, 101, 20), pile: 'unassigned', executionPile: 'club' };
  const plan = planFor({ inventory: [club, unassigned], targetScore: 40 });
  const { journal } = setup();
  let score = 0;
  const progress = [];
  const adapter = baseAdapter([club, unassigned], {
    materialize: vi.fn(async entries => entries.map(entry => ({ groupIndex: entry.groupIndex,
      item: [club, unassigned].find(row => row.id === entry.itemId) }))),
    contribute: vi.fn(async (batch, callbacks) => {
      const external = batch.material.find(row => row.item.pile === 'unassigned');
      if (external) callbacks.onProgress({ phase: 'materialize', stage: 'confirmed', completed: 1,
        materialTotal: 1, id: external.item.id, submittedScore: score });
      return { confirmed: true, submittedScore: score += batch.material.length * 20 };
    }),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' })
    .execute(plan, approval(plan), { onProgress: event => progress.push(event) });
  expect(result.status).toBe('completed');
  expect(result.record.consumedIds).toEqual([11, 12]);
  expect(adapter.contribute.mock.calls.map(([batch]) => batch.material.map(row => row.item.id))).toEqual([[11], [12]]);
  expect(progress).toContainEqual(expect.objectContaining({ phase: 'materialize', stage: 'confirmed',
    completed: 1, materialTotal: 1, id: 12, submittedScore: 20, batchNumber: 2 }));
  expect(adapter.find).not.toHaveBeenCalled();
});

it('does not contribute two external copies of one definition in one batch', async () => {
  const first = { ...item(21, 201, 20), pile: 'unassigned', executionPile: 'club' };
  const second = { ...item(22, 201, 20), pile: 'transfer', executionPile: 'club' };
  const plan = planFor({ inventory: [first, second], targetScore: 40 });
  const { journal } = setup();
  let score = 0;
  const adapter = baseAdapter([first, second], {
    materialize: vi.fn(async entries => entries.map(entry => ({ groupIndex: entry.groupIndex,
      item: [first, second].find(row => row.id === entry.itemId) }))),
    contribute: vi.fn(async batch => ({ confirmed: true, submittedScore: score += batch.material.length * 20 })),
  });
  const result = await createStreamlinedProcurement({ journal, lock, adapter, operationId: () => 'op' })
    .execute(plan, approval(plan));
  expect(result.status).toBe('completed');
  expect(result.record.consumedIds).toEqual([21, 22]);
  expect(adapter.contribute.mock.calls.map(([batch]) => batch.material.map(row => row.item.id))).toEqual([[21], [22]]);
});
