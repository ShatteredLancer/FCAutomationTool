import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedPurchaseAdapter } from '../../src/adapters/ea/fc27-streamlined-purchase.js';
import { createStreamlinedPurchaseScope } from '../../src/streamlined/purchase-scope.js';

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
  await expect(adapter.readState({})).rejects.toThrow('PURCHASE_HOLDINGS_UNVERIFIED');
});
