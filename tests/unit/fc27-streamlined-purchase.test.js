import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedPurchaseAdapter } from '../../src/adapters/ea/fc27-streamlined-purchase.js';
import { createStreamlinedPurchaseScope } from '../../src/streamlined/purchase-scope.js';
import { runStreamlinedRoutes, expandStreamlinedRoute } from '../../src/streamlined/routes.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createStreamlinedProcurement } from '../../src/streamlined/procurement.js';
import { createStreamlinedPurchaseJournal } from '../../src/streamlined/purchase-journal.js';

async function setup() {
  const f = streamlinedRuntime(), candidate = { ...f.plan.items[0], source: 'market', quote: {
    definitionId: f.plan.items[0].definitionId, source: 'futgg', price: 200, fetchedAt: 1, expiresAt: 10000 } };
  const buyer = { verifySquad: vi.fn(), find: vi.fn() };
  const plan = { ...f.plan, route: { groups: [{ source: 'market', quantity: 1, item: candidate, items: [candidate] }] } };
  const adapter = await createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: {}, canWrite: () => false,
    now: () => 1000, createBuyer: async () => buyer });
  return { f, plan, candidate, buyer, adapter };
}

it('accepts its own score progress but rejects native target/eligibility/limit changes before market search', async () => {
  const { f, adapter, candidate, buyer } = await setup();
  f.challenge.submittedScore = 20;
  await adapter.assertCurrent({}); expect(buyer.verifySquad).toHaveBeenCalledOnce();
  for (const change of [() => { f.challenge.scoreRequirement++; }, () => { f.set.endTime++; },
    () => { f.challenge.eligibilityRequirements[0].kvPairs._collection[40] = [60]; },
    () => { f.controller.workAreaController.viewModel.getSelectionLimit = () => 20; }]) {
    const oldScore = f.challenge.scoreRequirement, oldEnd = f.set.endTime;
    change(); await expect(adapter.find(candidate, 250)).rejects.toThrow('CONTEXT_CHANGED');
    f.challenge.scoreRequirement = oldScore; f.set.endTime = oldEnd;
    f.challenge.eligibilityRequirements[0].kvPairs._collection[40] = [45];
  }
  expect(buyer.find).not.toHaveBeenCalled();
});

it('does not send a market search with an expired reference', async () => {
  const { adapter, candidate, buyer } = await setup();
  await expect(adapter.find({ ...candidate, quote: { expiresAt: 999 } }, 250)).rejects.toThrow('PURCHASE_QUOTE_EXPIRED');
  expect(buyer.find).not.toHaveBeenCalled();
});

it('prepares an inventory-only first wave with its actual known material value', async () => {
  const { f, adapter } = await setup();
  const material = f.plan.items.map(item => ({ groupIndex: 0, item: { ...item, price: 200 } }));
  expect(await adapter.prepareContribution(material, { submittedScore: 0 })).toMatchObject({ purchaseCost: 0, materialValue: 1000 });
});

it('uses exact owned Club reads for the approved pool instead of stale cache membership, and wires native diagnostics', async () => {
  const { f, candidate } = await setup();
  const market = [candidate.definitionId, 999].map(definitionId => ({ ...candidate, definitionId, id: null,
    key: `market:${definitionId}:0`, price: 200, purchaseMaxBuy: 250,
    quote: { ...candidate.quote, definitionId } }));
  const scope = createStreamlinedPurchaseScope({ market, challenge: f.input.challenge, policy: f.input.policy,
    eligibility: { known: true, matches: () => ({ status: 'eligible' }) }, quoteSource: 'futgg', quoteAt: 1000 });
  expect(scope).not.toBeNull();
  const plan = { ...f.plan, execution: { purchaseScope: scope }, route: { groups: [{ ...scope.groups[0], quantity: 1 }] } };
  f.root.MAX_NEW_ITEMS = 100; f.root.repositories.Item.numItemsInCache = () => 0;
  const readPage = vi.fn(async () => [{ id: 9001, definitionId: 999, pile: 'club' }]);
  let options; const onEvent = vi.fn();
  const adapter = await createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: {}, canWrite: () => false,
    now: () => 1000, onEvent, createBuyer: async (_root, value) => { options = value; return { verifySquad() {} }; },
    createClubRead: async () => ({ readPage }) });
  expect(await adapter.readState({})).toMatchObject({ heldDefinitions: [999], freeSlots: 100 });
  expect(readPage).toHaveBeenCalledWith({ start: 0, count: 250, definitionIds: [candidate.definitionId, 999] });
  expect(options.playerDetails.has(999)).toBe(true); options.onEvent({ stage: 'search', definitionId: 999, count: 0 });
  expect(onEvent).toHaveBeenCalledWith({ stage: 'search', definitionId: 999, count: 0 });
  readPage.mockResolvedValue([{ id: 9001, definitionId: 888, pile: 'club' }]);
  expect(await adapter.readState({})).toMatchObject({ heldDefinitions: [] });
  readPage.mockResolvedValue([{ id: 0, definitionId: 888, pile: 'club' }]);
  await expect(adapter.readState({})).rejects.toThrow('PURCHASE_HOLDINGS_UNVERIFIED');
});

it('retains one owned transport across 50-version groups so native pacing is not reset', async () => {
  const { f, candidate } = await setup();
  const market = Array.from({ length: 51 }, (_, index) => {
    const definitionId = 1000 + index;
    return { ...candidate, definitionId, id: null, key: `market:${definitionId}:0`, price: 200, purchaseMaxBuy: 250,
      quote: { ...candidate.quote, definitionId } };
  });
  const scope = createStreamlinedPurchaseScope({ market, challenge: f.input.challenge, policy: f.input.policy,
    eligibility: { known: true, matches: () => ({ status: 'eligible' }) }, quoteSource: 'futgg', quoteAt: 1000 });
  const plan = { ...f.plan, execution: { purchaseScope: scope }, route: { groups: [{ ...scope.groups[0], quantity: 1 }] } };
  f.root.MAX_NEW_ITEMS = 100; f.root.repositories.Item.numItemsInCache = () => 0;
  const readPage = vi.fn(async ({ definitionIds }) => definitionIds.map(id => ({ id: id + 10000, definitionId: id, pile: null })));
  const createClubRead = vi.fn(async () => ({ readPage }));
  const adapter = await createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: {}, canWrite: () => false,
    now: () => 1000, createBuyer: async () => ({}), createClubRead });
  expect((await adapter.readState({})).heldDefinitions).toHaveLength(51);
  expect(createClubRead).toHaveBeenCalledOnce(); expect(readPage).toHaveBeenCalledTimes(2);
  expect(readPage.mock.calls.map(([page]) => page.definitionIds.length)).toEqual([50, 1]);
});

it.each(['missing-pile', 'expanded-family'])('reaches procurement after an owned Club response with %s without adopting an unrelated stock card', async mode => {
  const { f, candidate } = await setup();
  const market = { ...candidate, source: 'market', id: null, key: `market:${candidate.definitionId}:0`, price: 200, purchaseMaxBuy: 250 };
  const scope = createStreamlinedPurchaseScope({ market: [market], challenge: f.input.challenge, policy: f.input.policy,
    eligibility: { known: true, matches: () => ({ status: 'eligible' }) }, quoteSource: 'futgg', quoteAt: 1000 });
  const plan = { ...f.plan, execution: { purchaseScope: scope }, route: { groups: [{ ...scope.groups[0], quantity: 1 }] } };
  f.root.MAX_NEW_ITEMS = 100; f.root.repositories.Item.numItemsInCache = () => 0;
  f.state.filterClubQueries = mode === 'missing-pile';
  if (mode === 'missing-pile') f.state.playerFacts = { utasPile: undefined };
  const buyer = { verifySquad: vi.fn() };
  const adapter = await createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: {}, canWrite: () => false,
    now: () => 1000, createBuyer: async () => buyer });
  const result = await adapter.readState({});
  expect(result.heldDefinitions).toEqual([candidate.definitionId]);
  expect(f.calls.filter(call => call.kind === 'request')).toHaveLength(1);
  expect(f.calls.find(call => call.kind === 'request')).toMatchObject({ method: 'POST', body: {
    type: 'player', start: 0, count: 250, defId: String(candidate.definitionId) } });
});

it('runs the real plan/journal/driver through an expanded native Club read and reaches market search, without adopting foreign stock', async () => {
  const f = streamlinedRuntime({ targetScore: 20 });
  f.root.UTCurrencyInputControl = { PRICE_TIERS: [{ min: 0, inc: 50 }] };
  const market = { ...f.plan.items[0], source: 'market', id: null, definitionId: 999, key: 'market:999:0', price: 200,
    purchaseMaxBuy: 250, quote: { definitionId: 999, source: 'futgg', price: 200, fetchedAt: 1, expiresAt: 10000 } };
  const input = { ...f.input, inventory: [], market: [market], quoteSource: 'futgg', quoteAt: 1000,
    eligibility: { known: true, matches: () => ({ status: 'eligible' }) }, objective: 'lowest-value' };
  const routes = await runStreamlinedRoutes(input, { now: () => 1000, schedule: async () => {} });
  const route = routes.routes[0];
  const plan = createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy,
    result: { ...expandStreamlinedRoute(route, input.challenge), route },
    execution: { purchaseAttempts: 1, partialWaitMs: 0, purchaseScope: createStreamlinedPurchaseScope(input) } });
  f.root.MAX_NEW_ITEMS = 100; f.root.repositories.Item.numItemsInCache = () => 0;
  f.state.filterClubQueries = false; f.state.playerFacts = { utasPile: undefined, sbsScore: 20 };
  const buyer = { verifySquad: vi.fn(), find: vi.fn(async () => null), buy: vi.fn(), move: vi.fn() };
  const values = new Map(), journal = createStreamlinedPurchaseJournal({
    get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => values.set(key, structuredClone(value)) });
  const adapter = await createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: {}, canWrite: () => false,
    now: () => 1000, createBuyer: async () => buyer });
  const driver = createStreamlinedProcurement({ adapter, journal, operationId: () => 'fixture', now: () => 1000,
    lock: { acquire: async () => () => {} } });
  const result = await driver.execute(plan, { approved: true, fingerprint: plan.fingerprint, budget: 250, attempts: 1, expiresAt: 10000 });
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY',
    record: { spent: 0, entries: [], consumedIds: [] } });
  expect(buyer.find).toHaveBeenCalledWith(999, 250);
  expect(buyer.buy).not.toHaveBeenCalled(); expect(buyer.move).not.toHaveBeenCalled();
  expect(f.calls.filter(row => row.kind === 'request')).toHaveLength(1);
});

async function scopedSetup(options = {}) {
  const { f, candidate } = await setup();
  const market = { ...candidate, id: null, key: `market:${candidate.definitionId}:0`, price: 200, purchaseMaxBuy: 250 };
  const scope = createStreamlinedPurchaseScope({ market: [market], challenge: f.input.challenge, policy: f.input.policy,
    eligibility: { known: true, matches: () => ({ status: 'eligible' }) }, quoteSource: 'futgg', quoteAt: 1000 });
  const plan = { ...f.plan, execution: { purchaseScope: scope }, route: { groups: [{ ...scope.groups[0], quantity: 1 }] } };
  f.root.MAX_NEW_ITEMS = 100; f.root.repositories.Item.numItemsInCache = () => 0;
  const buyer = { verifySquad: vi.fn(), find: vi.fn(), buy: vi.fn(), move: vi.fn() };
  const events = [], adapter = await createFc27StreamlinedPurchaseAdapter(f.root, {
    plan, persistence: {}, canWrite: () => false, now: () => 1000, createBuyer: async () => buyer,
    onEvent: row => events.push(row), ...options,
  });
  return { f, plan, candidate, buyer, adapter, events };
}
const foreignPage = (start = 1000) => Array.from({ length: 250 }, (_, index) => ({ id: start + index, resourceId: 888 }));

it.each([true, false])('finishes paginating an expanded owned response before deciding exact-version presence=%s', async present => {
  const { f, candidate, adapter, events, buyer } = await scopedSetup();
  f.state.playerFacts = { utasPile: undefined, sbsScore: 20 };
  f.state.clubPages = { 0: foreignPage(), 250: [{ id: 9001, resourceId: present ? candidate.definitionId : 888 }] };
  const progress = [];
  expect(await adapter.readState({}, { onProgress: row => progress.push(row) }))
    .toMatchObject({ heldDefinitions: present ? [candidate.definitionId] : [] });
  expect(f.calls.filter(row => row.kind === 'request').map(row => row.body.start)).toEqual([0, 250]);
  expect(progress).toMatchObject([{ phase: 'checking-holdings', holdingsBatch: 1, holdingsBatchTotal: 1, offset: 0 },
    { phase: 'checking-holdings', holdingsBatch: 1, holdingsBatchTotal: 1, offset: 250 }]);
  expect(events[0]).toMatchObject({ responseCount: 250, acceptedCount: 0, foreignCount: 250 });
  expect(events[1]).toMatchObject({ responseCount: 1, acceptedCount: Number(present), unknownCount: Number(present) });
  expect(events.every(row => !('itemId' in row) && !('definitionId' in row))).toBe(true);
  expect(buyer.buy).not.toHaveBeenCalled(); expect(buyer.move).not.toHaveBeenCalled();
});

it('blocks a repeated full page instead of treating an incomplete read as absence', async () => {
  const { f, adapter, events } = await scopedSetup();
  f.state.clubPages = { 0: foreignPage(), 250: foreignPage() };
  await expect(adapter.readState({})).rejects.toThrow('PURCHASE_HOLDINGS_UNVERIFIED');
  expect(f.calls.filter(row => row.kind === 'request')).toHaveLength(2);
  expect(events.at(-1).reason).toBe('FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED');
});

it('bounds an ignored Club filter and never grants permission from an unfinished read', async () => {
  const readPage = vi.fn(async ({ start }) => Array.from({ length: 250 }, (_, i) => ({ id: start + i + 1, definitionId: 888, pile: 'club' })));
  const { adapter } = await scopedSetup({ createClubRead: async () => ({ readPage }) });
  await expect(adapter.readState({})).rejects.toThrow('PURCHASE_HOLDINGS_UNVERIFIED');
  expect(readPage).toHaveBeenCalledTimes(81);
  expect(readPage.mock.calls.at(-1)[0].start).toBe(20000);
});

it.each(['storage', undefined])('rejects an explicitly contradictory or malformed pile %s', async pile => {
  const readPage = vi.fn(async () => [{ id: 1, definitionId: 101, pile }]);
  const { adapter } = await scopedSetup({ createClubRead: async () => ({ readPage }) });
  await expect(adapter.readState({})).rejects.toThrow('PURCHASE_HOLDINGS_UNVERIFIED');
});

it('rejects native Storage pile even when the shared snapshot maps it to null', async () => {
  const { f, adapter } = await scopedSetup();
  f.root.ItemPile.STORAGE = 8; f.root.ItemPile.ANY = 0;
  f.state.playerFacts = { utasPile: 8, sbsScore: 20 };
  await expect(adapter.readState({})).rejects.toThrow('PURCHASE_HOLDINGS_UNVERIFIED');
});

it('counts native Evolution as Club ownership without adopting or materializing that protected card', async () => {
  const { f, adapter, plan, candidate } = await scopedSetup();
  f.state.playerFacts = { utasPile: 9, sbsScore: 20 };
  expect((await adapter.readState({})).heldDefinitions).toEqual([candidate.definitionId]);
  await expect(adapter.materialize([{ source: 'market', groupIndex: 0, itemId: 1, definitionId: candidate.definitionId,
    tradeId: '5001', price: 200 }], { route: plan.route, operationId: 'op' })).rejects.toThrow('PURCHASE_MATERIAL_UNKNOWN');
});

it('accepts the native ANY default only within the owned Club read and still materializes the exact receipt', async () => {
  const { f, adapter, plan, candidate } = await scopedSetup();
  f.root.ItemPile.ANY = 0; f.state.playerFacts = { utasPile: 0, sbsScore: 20 };
  expect((await adapter.readState({})).heldDefinitions).toEqual([candidate.definitionId]);
  expect(await adapter.materialize([{ source: 'market', groupIndex: 0, itemId: 1, definitionId: candidate.definitionId,
    tradeId: '5001', price: 200 }], { route: plan.route, operationId: 'op' })).toMatchObject([{ item: { id: 1, pile: 'club' } }]);
});

it('never projects an explicit Storage entity as a Club purchased material', async () => {
  const { f, adapter, plan, candidate } = await scopedSetup();
  f.root.ItemPile.ANY = 0; f.state.playerFacts = { utasPile: 8, sbsScore: 20 };
  await expect(adapter.materialize([{ source: 'market', groupIndex: 0, itemId: 1, definitionId: candidate.definitionId,
    tradeId: '5001', price: 200 }], { route: plan.route, operationId: 'op' })).rejects.toThrow('PURCHASE_HOLDINGS_UNVERIFIED');
});

it('honors stop during a read and before dispatching the first page', async () => {
  let stopped = false;
  const readPage = vi.fn(async () => { stopped = true; return foreignPage().map(row => ({ id: row.id, definitionId: row.resourceId, pile: 'club' })); });
  const { adapter } = await scopedSetup({ createClubRead: async () => ({ readPage }) });
  await expect(adapter.readState({}, { stopped: () => stopped })).rejects.toThrow('STOPPED');
  expect(readPage).toHaveBeenCalledOnce();
  stopped = false; readPage.mockClear();
  await expect(adapter.readState({}, { stopped: () => stopped, onProgress: () => { stopped = true; } })).rejects.toThrow('STOPPED');
  expect(readPage).not.toHaveBeenCalled();
});

it('materializes an exact purchased entity from its owned Club response with omitted pile and retains the receipt', async () => {
  const { f, plan, candidate, adapter } = await scopedSetup();
  f.state.playerFacts = { utasPile: undefined, sbsScore: 20 };
  const entry = { source: 'market', groupIndex: 0, itemId: 1, definitionId: candidate.definitionId, tradeId: '5001', price: 200 };
  const result = await adapter.materialize([entry], { route: plan.route, operationId: 'op' });
  expect(result).toMatchObject([{ groupIndex: 0, item: { id: 1, definitionId: candidate.definitionId, pile: 'club',
    purchaseReceipt: { operationId: 'op', itemId: 1, definitionId: candidate.definitionId, tradeId: '5001', price: 200 } } }]);
});

it.each([{ itemId: 9999, definitionId: 101 }, { itemId: 1, definitionId: 102 }])('never materializes a different physical copy or version: %o', async identity => {
  const { f, plan, adapter } = await scopedSetup();
  f.state.playerFacts = { utasPile: undefined, sbsScore: 20 };
  await expect(adapter.materialize([{ source: 'market', groupIndex: 0, ...identity, tradeId: '5001', price: 200 }],
    { route: plan.route, operationId: 'op' })).rejects.toThrow('PURCHASE_MATERIAL_UNKNOWN');
});
