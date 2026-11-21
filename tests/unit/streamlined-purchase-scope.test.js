import { expect, it, vi } from 'vitest';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';
import { runStreamlinedRoutes, expandStreamlinedRoute } from '../../src/streamlined/routes.js';
import { createStreamlinedPlan, assertStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createStreamlinedPurchaseScope, approvedStreamlinedPurchaseRoute, replanStreamlinedPurchaseDemand } from '../../src/streamlined/purchase-scope.js';
import { createStreamlinedProcurement } from '../../src/streamlined/procurement.js';
import { createStreamlinedPurchaseJournal, validateStreamlinedPurchase } from '../../src/streamlined/purchase-journal.js';
import { streamlinedPurchaseBudgetPreview } from '../../src/adapters/browser/fc27-streamlined-panel.js';
import { decodeStoredValue } from '../../src/runtime/compact-storage.js';

const card = (id, points, price, cap = price) => ({ ...safeItem({ source: 'market', definitionId: id, points, price,
  quote: { source: 'futgg', definitionId: id, price, fetchedAt: 1, expiresAt: 10000 } }), purchaseMaxBuy: cap });
async function fixture({ inventory = [], market = [card(201, 20, 200), card(202, 100, 1100)], submittedScore = 0,
  targetScore = 100, selectionLimit = 5, target = {}, objective = 'lowest-value' } = {}) {
  const c = challenge({ ...target, scoreRequirement: targetScore, submittedScore, selectionLimit });
  const input = { challenge: c, inventory, market, policy, eligibility, quoteSource: 'futgg', quoteAt: 100, objective };
  const result = await runStreamlinedRoutes(input, { now: () => 100, schedule: async () => {} });
  const route = result.routes[0], scope = createStreamlinedPurchaseScope(input);
  const plan = createStreamlinedPlan({ context: c.context, challenge: c, policy, objective, result: { ...expandStreamlinedRoute(route, c), route },
    execution: { purchaseAttempts: 2, partialWaitMs: 1000, purchaseScope: scope, scarcityRetries: 2, retryWaitMs: 15000 } });
  const values = new Map();
  const journal = createStreamlinedPurchaseJournal({ get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => values.set(key, structuredClone(value)) });
  let score = submittedScore, id = 400;
  const adapter = { assertCurrent: vi.fn(async () => {}), locate: vi.fn(async () => 'club'),
    readState: vi.fn(async () => ({ submittedScore: score, freeSlots: 30, heldDefinitions: [], blockedDefinitions: [] })),
    materialize: vi.fn(async entries => entries.map(entry => ({ ...market.find(item => item.definitionId === entry.definitionId),
      ...inventory.find(item => item.id === entry.itemId), id: entry.itemId }))),
    find: vi.fn(async candidate => ({ definitionId: candidate.definitionId, itemId: ++id, tradeId: String(id + 100), price: candidate.price })),
    buy: vi.fn(async entry => ({ ...entry, status: 'bought' })), move: vi.fn(async () => ({ status: 'bought' })),
    waitForPartial: vi.fn(async () => {}), prepareContribution: vi.fn(async material => ({ material })),
    contribute: vi.fn(async batch => ({ confirmed: true, submittedScore: score += batch.material.reduce((sum, row) => sum + row.item.points, 0) })) };
  const driver = createStreamlinedProcurement({ journal, lock: { acquire: async () => () => {} }, adapter, operationId: () => 'fixture', now: () => 100 });
  const approval = { approved: true, fingerprint: plan.fingerprint, budget: 1100, attempts: 2, expiresAt: 10000, idleMs: 1000 };
  return { plan, scope, adapter, driver, approval, journal, values };
}

// Real 191/264 progress/budget and empty-search limits, synthetic prior
// receipts and pool. Start from a settled .125 journal without miss history.
async function settled191264() {
  const stock = Array.from({ length: 27 }, (_v, i) => safeItem({ id: 100 + i, definitionId: 1100 + i, points: 700 }));
  const f = await fixture({ target: { setId: 191, id: 264 }, targetScore: 40000, selectionLimit: 30,
    inventory: stock, objective: 'inventory-first',
    market: [card(210676, 830, 750, 800), card(230142, 1185, 750, 900), card(230999, 830, 900)] });
  const route = approvedStreamlinedPurchaseRoute(f.plan);
  const priorPurchases = [...Array(7).fill(210676), 230142];
  const entries = [
    ...stock.map(item => ({ source: 'inventory', groupIndex: route.groups.findIndex(g => g.items.some(i => i.id === item.id)),
      definitionId: item.definitionId, itemId: item.id, key: `stock:${item.id}`, price: null, cap: null, tradeId: null, state: 'consumed' })),
    ...priorPurchases.map((definitionId, i) => ({ source: 'market', definitionId, itemId: 300 + i,
      groupIndex: route.groups.findIndex(g => g.items.some(item => item.definitionId === definitionId)),
      key: `paid:${i}`, tradeId: String(600 + i), cap: definitionId === 210676 ? 800 : 900, price: 750, state: 'consumed' })),
  ];
  const fulfilled = route.groups.map((_g, i) => entries.filter(entry => entry.groupIndex === i).length);
  const record = await f.journal.write({ schema: 2, context: f.plan.context, operationId: '191-264', revision: 0,
    fingerprint: f.plan.fingerprint, plan: f.plan, challenge: f.plan.challenge, policy: f.plan.policy, route,
    demand: route.groups.map((group, i) => Math.max(fulfilled[i], f.plan.route.groups.find(g => g.key === group.key)?.quantity ?? 0)),
    budget: 22080, spent: 6000, submittedScore: 25895, consumedIds: entries.map(e => e.itemId),
    fulfilled, confirmedBatches: 8, contribution: null, completed: false, entries });
  let score = record.submittedScore;
  f.adapter.readState.mockImplementation(async () => ({ submittedScore: score, freeSlots: 30, heldDefinitions: [], blockedDefinitions: [] }));
  f.adapter.contribute.mockImplementation(async batch => ({ confirmed: true,
    submittedScore: score += batch.material.reduce((sum, row) => sum + row.item.points, 0) }));
  const find = f.adapter.find.getMockImplementation();
  f.adapter.find.mockImplementation(async (item, cap) => {
    if (item.definitionId === 210676 || item.definitionId === 230142) return null;
    return find(item, cap);
  });
  return { ...f, record, approval: { ...f.approval, budget: 22080 } };
}

it('191/264 replans from 25,895 confirmed points once per empty version and keeps the original ledger and caps', async () => {
  const f = await settled191264();
  const progress = [];
  const result = await f.driver.execute(f.plan, f.approval, { onProgress: row => progress.push(row) });
  expect(result).toMatchObject({ status: 'completed', record: {
    submittedScore: 40005, spent: 21300, budget: 22080, confirmedBatches: 25, operationId: '191-264',
  } });
  expect(f.adapter.find.mock.calls.filter(([item]) => item.definitionId !== 230999)
    .map(([item, cap]) => [item.definitionId, cap]).sort()).toEqual([[210676, 800], [230142, 900]]);
  expect(f.adapter.buy).toHaveBeenCalledTimes(17);
  expect(f.adapter.buy.mock.calls.every(([row]) => row.definitionId === 230999 && row.cap <= 900)).toBe(true);
  const contributed = f.adapter.contribute.mock.calls.flatMap(([batch]) => batch.material.map(row => row.item.id));
  expect(new Set(contributed).size).toBe(17);
  expect(contributed.some(id => f.record.consumedIds.includes(id))).toBe(false);
  expect(result.record.consumedIds).toEqual([...f.record.consumedIds, ...contributed]);
  expect(progress).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'replanning', remainingScore: 14105 })]));
  expect(f.adapter.waitForPartial).not.toHaveBeenCalled();
});

it('191/264 stops if no approved substitute has supply and skips those versions after reload', async () => {
  const f = await settled191264();
  f.adapter.find.mockResolvedValue(null);
  const expected = { status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY',
    record: { submittedScore: 25895, spent: 6000, budget: 22080, confirmedBatches: 8, consumedIds: f.record.consumedIds } };
  expect(await f.driver.execute(f.plan, f.approval)).toMatchObject(expected);
  expect(f.adapter.find).toHaveBeenCalledTimes(3);
  const reload = createStreamlinedProcurement({ journal: f.journal, lock: { acquire: async () => () => {} },
    adapter: f.adapter, operationId: () => 'new-id', now: () => 100 });
  expect(await reload.execute(f.plan, null, { reconcileOnly: true })).toMatchObject({ status: 'recovered',
    record: { supplyMisses: expect.arrayContaining([210676, 230142, 230999]) } });
  expect(await reload.execute(f.plan, f.approval)).toMatchObject(expected);
  expect(f.adapter.find).toHaveBeenCalledTimes(3);
  for (const fn of ['buy', 'move', 'contribute', 'waitForPartial']) expect(f.adapter[fn]).not.toHaveBeenCalled();
});

it('191/264 never sends a bid for an alternative offered above its own frozen cap', async () => {
  const f = await settled191264();
  const find = f.adapter.find.getMockImplementation();
  f.adapter.find.mockImplementation(async (...args) => {
    const offer = await find(...args);
    return offer ? { ...offer, price: 950 } : null;
  });
  expect(await f.driver.execute(f.plan, f.approval)).toMatchObject({
    status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_OFFER_CHANGED', mismatch: 'price',
    record: { submittedScore: 25895, spent: 6000, consumedIds: f.record.consumedIds },
  });
  for (const fn of ['buy', 'move', 'contribute']) expect(f.adapter[fn]).not.toHaveBeenCalled();
});

async function shortageFixture() {
  const stock = safeItem({ id: 11, definitionId: 101, rating: 84, points: 830, price: 1100 });
  const f = await fixture({ inventory: [stock], market: [card(201, 830, 1100), card(202, 830, 1200)],
    submittedScore: 1660, targetScore: 34000, selectionLimit: 30 });
  const find = f.adapter.find.getMockImplementation();
  f.adapter.find.mockImplementation(async item => item.definitionId === 201 ? null : find(item));
  return f;
}

it('reproduces the reported stock-first stop when the cheapest version is absent and the exact 41800 budget excludes alternatives', async () => {
  const f = await shortageFixture();
  expect(f.plan.route.purchaseCost).toBe(41800);
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: 41800 });
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY',
    record: { submittedScore: 2490, spent: 0, consumedIds: [11] } });
  expect(f.adapter.find.mock.calls.map(([item]) => item.definitionId)).toEqual([201]);
  expect(f.adapter.buy).not.toHaveBeenCalled();
});

it('uses the displayed 15% reserve to complete the same shortage through approved alternatives without raising card caps', async () => {
  const f = await shortageFixture();
  const proposal = streamlinedPurchaseBudgetPreview(f.plan);
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: proposal.budget });
  expect(result).toMatchObject({ status: 'completed', record: { submittedScore: 34030, spent: 45600, budget: 48070 } });
  expect(proposal).toEqual({ base: 41800, reserve: 6270, budget: 48070 });
  expect(f.adapter.buy).toHaveBeenCalledTimes(38);
  expect(f.adapter.buy.mock.calls.every(([entry]) => entry.definitionId === 202 && entry.price === 1200 && entry.cap === 1200)).toBe(true);
  expect(result.record.consumedIds).toContain(11);
});

it('finishes stock plus 38 repeat purchases within one ten-minute approval without pointless 60-second partial waits', async () => {
  const f = await shortageFixture(); let at = 100;
  for (const key of ['readState', 'find', 'buy', 'move', 'locate', 'contribute']) {
    const original = f.adapter[key].getMockImplementation();
    f.adapter[key].mockImplementation(async (...args) => { at += 500; return original(...args); });
  }
  f.adapter.waitForPartial.mockImplementation(async ms => { at += ms; });
  const driver = createStreamlinedProcurement({ adapter: f.adapter, journal: f.journal, operationId: () => 'timed',
    lock: { acquire: async () => () => {} }, now: () => at });
  const result = await driver.execute(f.plan, { ...f.approval, budget: streamlinedPurchaseBudgetPreview(f.plan).budget,
    idleMs: 60000, expiresAt: 600100 });
  expect(result).toMatchObject({ status: 'completed', record: { submittedScore: 34030, spent: 45600 } });
  expect(at).toBeLessThan(600100);
  expect(f.adapter.waitForPartial).not.toHaveBeenCalled();
  expect(f.adapter.contribute).toHaveBeenCalledTimes(38);
  expect(f.adapter.contribute.mock.calls[0][0].material).toHaveLength(2);
});

it('does not spend the reserve when the cheaper version is available', async () => {
  const f = await fixture();
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: streamlinedPurchaseBudgetPreview(f.plan).budget });
  expect(result).toMatchObject({ status: 'completed', record: { budget: 1150, spent: 1000 } });
  expect(f.adapter.buy.mock.calls.every(([entry]) => entry.definitionId === 201 && entry.cap === 200)).toBe(true);
});

it('never applies the new default reserve to an existing frozen execution record', async () => {
  const f = await shortageFixture();
  expect((await f.driver.execute(f.plan, { ...f.approval, budget: 41800 })).status).toBe('paused');
  const reads = f.adapter.find.mock.calls.length;
  expect(await f.driver.execute(f.plan, { ...f.approval, budget: streamlinedPurchaseBudgetPreview(f.plan).budget }))
    .toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_APPROVAL_CHANGED', record: { budget: 41800, spent: 0 } });
  expect(f.adapter.find).toHaveBeenCalledTimes(reads); expect(f.adapter.buy).not.toHaveBeenCalled();
});

it('replaces the settled tight-budget run through a regenerated explicit approval, archives its stock consumption and continues without recovery clicks', async () => {
  const f = await shortageFixture();
  expect(await f.driver.execute(f.plan, { ...f.approval, budget: 41800 })).toMatchObject({ record: { submittedScore: 2490, consumedIds: [11] } });
  const next = await fixture({ submittedScore: 2490, targetScore: 34000, selectionLimit: 30,
    market: [card(201, 830, 1100), card(202, 830, 1200)] });
  expect(await f.driver.execute(next.plan, { ...next.approval, budget: streamlinedPurchaseBudgetPreview(next.plan).budget }))
    .toMatchObject({ status: 'completed', record: { spent: 45600, submittedScore: 34030, budget: 48070 } });
  const history = await Promise.all([...f.values].filter(([key]) => key.includes(':history:')).map(([, record]) => decodeStoredValue(record)));
  expect(history).toContainEqual(expect.objectContaining({ budget: 41800, consumedIds: [11], submittedScore: 2490 }));
  expect(f.adapter.contribute.mock.calls.filter(([batch]) => batch.material.some(row => row.item.id === 11))).toHaveLength(1);
});

it('keeps the cheap repeat recipe instead of buying the faster premium version', async () => {
  const f = await fixture(), progress = [];
  const result = await f.driver.execute(f.plan, f.approval, { onProgress: row => progress.push(row) });
  expect(result).toMatchObject({ status: 'completed', record: { schema: 2, spent: 1000, submittedScore: 100 } });
  expect(f.adapter.buy).toHaveBeenCalledTimes(5);
  expect(f.adapter.find.mock.calls.map(([item]) => item.definitionId)).toEqual([201, 201, 201, 201, 201]);
  expect(f.adapter.contribute).toHaveBeenCalledTimes(5);
  expect(progress.some(row => row.phase === 'replanning')).toBe(false);
});

it('replans to the cheapest approved feasible substitute only after the selected version has no supply', async () => {
  const f = await fixture(), originalFind = f.adapter.find.getMockImplementation();
  f.adapter.find.mockImplementation(async item => item.definitionId === 201 ? null : originalFind(item));
  const result = await f.driver.execute(f.plan, f.approval);
  expect(result).toMatchObject({ status: 'completed', record: { spent: 1100, submittedScore: 100 } });
  expect(f.adapter.find.mock.calls.map(([item]) => item.definitionId)).toEqual([201, 202]);
  expect(f.adapter.buy).toHaveBeenCalledOnce(); expect(result.record.fingerprint).toBe(f.plan.fingerprint);
  expect(validateStreamlinedPurchase(result.record, f.plan.context)).toBe(result.record);
});

it('keeps the replacement after a settled fallback batch rather than probing the empty version again', async () => {
  const f = await fixture({ market: [card(201, 20, 200), card(202, 50, 650)] });
  const find = f.adapter.find.getMockImplementation(); let cheapReads = 0;
  f.adapter.find.mockImplementation(async item => item.definitionId === 201 && ++cheapReads === 1 ? null : find(item));
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: 1300 });
  expect(result).toMatchObject({ status: 'completed', record: { spent: 1300, submittedScore: 100, supplyMisses: [201] } });
  expect(f.adapter.find.mock.calls.map(([item]) => item.definitionId)).toEqual([201, 202, 202]);
  expect(f.adapter.buy.mock.calls.map(([entry]) => entry.definitionId)).toEqual([202, 202]);
  expect(cheapReads).toBe(1);
});

it('continues multi-version purchases within budget when an isolated 700 quote has no supply', async () => {
  const market = [card(200, 830, 700), ...Array.from({ length: 8 }, (_, i) => card(201 + i, 830, 850))];
  const f = await fixture({ market, targetScore: 20 * 830, selectionLimit: 30 });
  const find = f.adapter.find.getMockImplementation();
  f.adapter.find.mockImplementation(item => item.definitionId === 200 ? null : find(item));
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: 20 * 850 });
  expect(result).toMatchObject({ status: 'completed', record: { spent: 17000, submittedScore: 16600 } });
  expect(f.adapter.find.mock.calls.filter(([item]) => item.definitionId === 200)).toHaveLength(1);
  const batches = f.adapter.contribute.mock.calls.map(([batch]) => batch.material.map(row => row.item.definitionId));
  expect(batches.map(ids => ids.length)).toEqual([8, 8, 4]);
  expect(batches.every(ids => new Set(ids).size === ids.length)).toBe(true);
});

it('buys each isolated version only once across single-slot batches when the two lowest quotes tie', async () => {
  const market = [card(200, 830, 700), card(201, 830, 700), card(202, 830, 850)];
  const f = await fixture({ market, targetScore: 3 * 830, selectionLimit: 1 });
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: 2250 });
  expect(result).toMatchObject({ status: 'completed', record: { spent: 2250 } });
  expect(f.adapter.buy.mock.calls.map(([entry]) => entry.definitionId)).toEqual([200, 201, 202]);
});

it('does not turn the lone low quote into bulk supply when its peers disappear during replanning', async () => {
  const market = [card(200, 830, 700), card(201, 830, 850), card(202, 830, 850)];
  const f = await fixture({ market, targetScore: 1660 });
  const route = approvedStreamlinedPurchaseRoute(f.plan);
  const record = { plan: f.plan, policy, route, challenge: f.plan.challenge, submittedScore: 0, entries: [],
    fulfilled: route.groups.map(() => 0), spent: 0, budget: 2000 };
  const options = { blockedDefinitions: [201, 202], now: () => 100 };
  expect(await replanStreamlinedPurchaseDemand(record, options)).toBeNull();
  record.submittedScore = 830;
  expect(await replanStreamlinedPurchaseDemand(record, options)).toEqual([1, 0]);
  record.entries.push({ source: 'market', definitionId: 200, state: 'consumed' });
  record.fulfilled[0] = 1;
  expect(await replanStreamlinedPurchaseDemand(record, options)).toBeNull();
});

it('never increases the total budget to buy a premium substitute or repeats an empty search', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue(null);
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: 1000 });
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', record: { budget: 1000, spent: 0 } });
  expect(f.adapter.find.mock.calls.map(([item]) => item.definitionId)).toEqual([201]);
  expect(f.adapter.waitForPartial).not.toHaveBeenCalled();
  expect(f.adapter.buy).not.toHaveBeenCalled();
});

it('can check restored supply with a freshly generated and explicitly approved plan, not by replaying the old plan', async () => {
  const f = await fixture(), found = f.adapter.find.getMockImplementation();
  f.adapter.find.mockResolvedValue(null);
  expect((await f.driver.execute(f.plan, f.approval)).status).toBe('paused');
  f.adapter.find.mockImplementation(found);
  const alternate = createStreamlinedPlan({ context: f.plan.context, challenge: f.plan.challenge,
    policy: f.plan.policy, result: f.plan, execution: { ...f.plan.execution, purchaseAttempts: 3 } });
  expect(await f.driver.execute(alternate, f.approval)).toMatchObject({ reason: 'FC27_STREAMLINED_PURCHASE_APPROVAL_REQUIRED' });
  expect(f.adapter.find).toHaveBeenCalledTimes(2);
  expect((await f.driver.execute(alternate, { ...f.approval, fingerprint: alternate.fingerprint })).status).toBe('completed');
});

it('stops during scarcity replanning without buying, contributing or automatically continuing', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue(null);
  expect((await f.driver.execute(f.plan, f.approval, { onProgress: row => {
    if (row.phase === 'replanning') f.driver.stop();
  } })).status).toBe('stopped');
  expect(f.adapter.find).toHaveBeenCalledTimes(1); expect(f.adapter.buy).not.toHaveBeenCalled();
  expect(f.adapter.contribute).not.toHaveBeenCalled();
});

it('does not retry a rejected native search as normal scarcity', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue({ unavailable: true, reason: 'FC27_BUY_SEARCH_FAILED' });
  expect(await f.driver.execute(f.plan, f.approval)).toMatchObject({ status: 'paused', reason: 'FC27_BUY_SEARCH_FAILED' });
  expect(f.adapter.waitForPartial).not.toHaveBeenCalled(); expect(f.adapter.buy).not.toHaveBeenCalled();
});

it('does not disguise a known purchase rejection as missing market supply or an unknown receipt', async () => {
  const f = await fixture(); f.adapter.buy.mockResolvedValue({ status: 'rejected', reason: 'FC27_BUY_INSUFFICIENT_COINS' });
  const result = await f.driver.execute(f.plan, f.approval);
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_BUY_INSUFFICIENT_COINS', record: { spent: 0 } });
  expect(result.record.entries.every(entry => entry.state === 'rejected')).toBe(true);
  expect(f.adapter.waitForPartial).not.toHaveBeenCalled(); expect(f.adapter.move).not.toHaveBeenCalled();
  expect(f.adapter.contribute).not.toHaveBeenCalled();
});

it('cannot expand inventory consumption from the market authorization pool', async () => {
  const chosen = safeItem({ id: 11, definitionId: 101, points: 20, price: 100 });
  const expensive = safeItem({ id: 12, definitionId: 102, points: 100, price: 2000 });
  const f = await fixture({ inventory: [chosen, expensive] });
  expect(approvedStreamlinedPurchaseRoute(f.plan).groups.filter(group => group.source === 'inventory').flatMap(group => group.items).map(item => item.id)).toEqual([11]);
  const result = await f.driver.execute(f.plan, f.approval);
  expect(result.record.consumedIds).toContain(11); expect(result.record.consumedIds).not.toContain(12);
});

it.each(['purchaseMaxBuy', 'points', 'definitionId'])('binds %s of every pool version to the approved plan fingerprint', async key => {
  const f = await fixture(), changed = structuredClone(f.plan);
  changed.execution.purchaseScope.groups[1].items[0][key]++;
  expect(() => assertStreamlinedPlan(changed)).toThrow('PLAN_CHANGED');
});

it('rejects an injected runtime pool or quantity beyond the approved journal envelope', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue(null);
  const result = await f.driver.execute(f.plan, f.approval);
  const changed = structuredClone(result.record); changed.route.groups[1].items.push(card(999, 100, 1100));
  expect(() => validateStreamlinedPurchase(changed, f.plan.context)).toThrow('PURCHASE_JOURNAL_INVALID');
  const demand = structuredClone(result.record); demand.demand[0] = demand.route.groups[0].quantity + 1;
  expect(() => validateStreamlinedPurchase(demand, f.plan.context)).toThrow('PURCHASE_JOURNAL_INVALID');
  for (const supplyMisses of [[999], [201,201]]) expect(() =>
    validateStreamlinedPurchase({ ...result.record, supplyMisses }, f.plan.context)).toThrow('PURCHASE_JOURNAL_INVALID');
});

it('does not require a plan recovery for settled contributions; archives receipts before a new explicit approval', async () => {
  const f = await fixture();
  f.adapter.contribute.mockImplementationOnce(async batch => { f.driver.stop(); return { confirmed: true, submittedScore: batch.material.reduce((sum, row) => sum + row.item.points, 0) }; });
  const stopped = await f.driver.execute(f.plan, f.approval);
  expect(stopped.record.entries.every(entry => entry.state === 'consumed')).toBe(true);
  const next = await fixture({ submittedScore: 20 });
  f.adapter.readState.mockImplementation(async r => ({ submittedScore: r.submittedScore, freeSlots: 30, heldDefinitions: [], blockedDefinitions: [] }));
  f.adapter.find.mockResolvedValue(null);
  expect((await f.driver.execute(next.plan, next.approval)).status).toBe('paused');
  expect([...f.values.keys()].some(key => key.includes(':history:'))).toBe(true);
});

it('retains an unknown buy in the new scope journal and neither replans nor bids again', async () => {
  const f = await fixture(); f.adapter.buy.mockResolvedValue(undefined);
  const first = await f.driver.execute(f.plan, f.approval);
  expect(first).toMatchObject({ status: 'recovery-required', record: { spent: 0, entries: [{ state: 'buy-pending' }] } });
  const alternate = structuredClone(f.plan); alternate.fingerprint += ':changed';
  expect((await f.driver.execute(alternate, { ...f.approval, fingerprint: alternate.fingerprint })).status).toBe('recovery-required');
  f.adapter.locate.mockResolvedValue('unknown');
  expect((await f.driver.execute(f.plan, f.approval)).status).toBe('recovery-required');
  expect(f.adapter.buy).toHaveBeenCalledOnce(); expect(f.adapter.move).not.toHaveBeenCalled();
  expect(f.adapter.contribute).not.toHaveBeenCalled();
  expect([...f.values.keys()].some(key => key.includes(':history:'))).toBe(false);
  expect((await f.journal.read(f.plan.context)).entries[0].state).toBe('buy-pending');
});

it('does not turn an expired approval during scarcity replanning into a fictitious unknown trade', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue(null);
  let at = 100;
  const driver = createStreamlinedProcurement({ journal: f.journal, lock: { acquire: async () => () => {} },
    adapter: f.adapter, operationId: () => 'expired', now: () => at });
  expect(await driver.execute(f.plan, f.approval, { onProgress: row => {
    if (row.phase === 'replanning') at = f.approval.expiresAt;
  } })).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED' });
  expect(f.adapter.buy).not.toHaveBeenCalled();
});
