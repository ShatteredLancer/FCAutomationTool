import { expect, it, vi } from 'vitest';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';
import { runStreamlinedRoutes, expandStreamlinedRoute } from '../../src/streamlined/routes.js';
import { createStreamlinedPlan, assertStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createStreamlinedPurchaseScope, approvedStreamlinedPurchaseRoute } from '../../src/streamlined/purchase-scope.js';
import { createStreamlinedProcurement } from '../../src/streamlined/procurement.js';
import { createStreamlinedPurchaseJournal, validateStreamlinedPurchase } from '../../src/streamlined/purchase-journal.js';

const card = (id, points, price) => ({ ...safeItem({ source: 'market', definitionId: id, points, price,
  quote: { source: 'futgg', definitionId: id, price, fetchedAt: 1, expiresAt: 10000 } }), purchaseMaxBuy: price });
async function fixture({ inventory = [], market = [card(201, 20, 200), card(202, 100, 1100)], submittedScore = 0 } = {}) {
  const c = challenge({ scoreRequirement: 100, submittedScore, selectionLimit: 5 });
  const input = { challenge: c, inventory, market, policy, eligibility, quoteSource: 'futgg', quoteAt: 100, objective: 'lowest-value' };
  const result = await runStreamlinedRoutes(input, { now: () => 100, schedule: async () => {} });
  const route = result.routes[0], scope = createStreamlinedPurchaseScope(input);
  const plan = createStreamlinedPlan({ context: c.context, challenge: c, policy, result: { ...expandStreamlinedRoute(route, c), route },
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

it('returns to the cheaper approved version after a settled fallback batch when its supply returns', async () => {
  const f = await fixture({ market: [card(201, 20, 200), card(202, 50, 650)] });
  const find = f.adapter.find.getMockImplementation(); let cheapReads = 0;
  f.adapter.find.mockImplementation(async item => item.definitionId === 201 && ++cheapReads === 1 ? null : find(item));
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: 1300 });
  expect(result).toMatchObject({ status: 'completed', record: { spent: 1250, submittedScore: 110 } });
  expect(f.adapter.buy.mock.calls.map(([entry]) => entry.definitionId)).toEqual([202, 201, 201, 201]);
});

it('never increases the total budget to buy a premium substitute; retries scarcity twice without manual recovery', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue(null);
  const result = await f.driver.execute(f.plan, { ...f.approval, budget: 1000 });
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', record: { budget: 1000, spent: 0 } });
  expect(f.adapter.find.mock.calls.map(([item]) => item.definitionId)).toEqual([201, 201, 201]);
  expect(f.adapter.waitForPartial.mock.calls).toEqual([[15000, expect.any(Function)], [15000, expect.any(Function)]]);
  expect(f.adapter.buy).not.toHaveBeenCalled();
});

it('continues a normal scarcity pause with one new execution click, without a recovery action', async () => {
  const f = await fixture(), found = f.adapter.find.getMockImplementation();
  f.adapter.find.mockResolvedValue(null);
  expect((await f.driver.execute(f.plan, f.approval)).status).toBe('paused');
  f.adapter.find.mockImplementation(found);
  expect((await f.driver.execute(f.plan, f.approval)).status).toBe('completed');
});

it('stops during scarcity backoff without buying, contributing or automatically continuing', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue(null);
  f.adapter.waitForPartial.mockImplementation(async () => f.driver.stop());
  expect((await f.driver.execute(f.plan, f.approval)).status).toBe('stopped');
  expect(f.adapter.find).toHaveBeenCalledTimes(2); expect(f.adapter.buy).not.toHaveBeenCalled();
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

it('does not turn an expired approval during a scarcity wait into a fictitious unknown trade', async () => {
  const f = await fixture(); f.adapter.find.mockResolvedValue(null);
  let at = 100;
  const driver = createStreamlinedProcurement({ journal: f.journal, lock: { acquire: async () => () => {} },
    adapter: f.adapter, operationId: () => 'expired', now: () => at });
  f.adapter.waitForPartial.mockImplementation(async () => { at = f.approval.expiresAt; });
  expect(await driver.execute(f.plan, f.approval)).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED' });
  expect(f.adapter.buy).not.toHaveBeenCalled();
});
