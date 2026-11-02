import { afterEach, expect, it, vi } from 'vitest';
import * as search from '../../src/fc27/puzzle-preview.js';
import { refineFc27PuzzleOwnedValue, suggestFc27PuzzleJointPurchasesCooperatively } from '../../src/fc27/puzzle-procurement.js';
import { minimumQualityFixture } from '../helpers/fc27-puzzle-minimum-quality-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';

afterEach(() => vi.restoreAllMocks());

it('carries the feasible owned arrangement into market refinement instead of rediscovering ten unchanged cards', async () => {
  const x = fixture();
  x.input.inventory.items.pop();
  const card = { ...x.silver }; delete card.id; delete card.pile;
  const result = await suggestFc27PuzzleJointPurchasesCooperatively(x.input, [card], {
    incumbent: x.preview, maxNodes: 50, materialPrices: x.prices, prices: new Map([[card.definitionId, 200]]),
    costCeiling: 11000,
  });
  expect(result.status).toBe('suggested');
  expect(result.plans[0]).toMatchObject({ materialValue: 10200, inventoryValue: 10000,
    estimatedCost: 200, purchaseCount: 1 });
  expect(result.plans[0].selectedOwned).toHaveLength(10);
  expect(result.nodes).toBeLessThanOrEqual(50);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(22);
  expect(result.optimalWithinPool).toBe(false);
});

it.each(['locked', 'stale-definition', 'duplicate-slot', 'native-invalid', 'unknown-value'])('never seeds market refinement with an unverified incumbent: %s', async mode => {
  const x = fixture(); x.input.inventory.items.pop();
  const card = { ...x.silver }; delete card.id; delete card.pile;
  if (mode === 'locked') { x.input.policy.protectFsuLockedPlayers = true; x.input.inventory.items[0].locked = true; }
  if (mode === 'stale-definition') x.preview.selected[0].definitionId = 999999;
  if (mode === 'duplicate-slot') x.preview.selected[0].slot = x.preview.selected[1].slot;
  if (mode === 'native-invalid') x.input.challenge.rawRequirements.push(marketRow(3, 3));
  if (mode === 'unknown-value') x.prices.delete(x.preview.selected[0].definitionId);
  const result = await suggestFc27PuzzleJointPurchasesCooperatively(x.input, [card], {
    incumbent: x.preview, maxNodes: 50, materialPrices: x.prices, prices: new Map([[card.definitionId, 200]]), costCeiling: 11000,
  });
  expect(result.status).toBe('blocked');
});
function fixture() {
  const { input, owned } = minimumQualityFixture(2);
  input.inventory.items = owned().map(item => ({ ...item, rating: 80 }));
  const preview = search.previewFc27PuzzleSquad(input);
  expect(preview.status).toBe('preview');
  const silver = { ...input.inventory.items[2], id: 1001, definitionId: 9001, rating: 73 };
  input.inventory.items.push(silver);
  const prices = new Map(input.inventory.items.map(item => [item.definitionId, item.id === silver.id ? 200 : 1000]));
  const route = vi.spyOn(search, 'iterateFc27PuzzleCandidateRoutes').mockImplementation(function* () {
    yield; return { status: 'blocked', nodes: 10, searchComplete: false };
  });
  return { input, preview, silver, prices, route };
}

it('finds a cheap same-slot native-verified silver replacement before bounded whole-squad search', async () => {
  const x = fixture();
  const result = await refineFc27PuzzleOwnedValue(x.input, x.preview, x.prices);
  expect(result.materialValue).toBe(10200);
  expect(result.initialMaterialValue).toBe(11000);
  expect(result.selected).toContainEqual(expect.objectContaining({ id: x.silver.id }));
  const changed = result.selected.filter(ref => x.preview.selected.find(old => old.slot === ref.slot)?.id !== ref.id);
  expect(changed).toHaveLength(1);
  expect(result.teamFacts.chemistry).toBeGreaterThanOrEqual(22);
  expect(result.nodes).toBeLessThanOrEqual(20000);
  expect(result.maxNodes).toBe(20000);
  expect(x.route.mock.calls[0][0].maxNodes).toBeLessThan(20000);
});

it('uses an equal-valued silver card when a minimum-silver incumbent is all gold', async () => {
  const x = fixture();
  // Build the real failure shape: the first pass found an all-gold incumbent,
  // while a safe silver Club card is available at the same public value.
  x.preview.selected = x.preview.selected.map(ref => ({ ...ref, rating: 80 }));
  x.input.inventory.items.forEach(item => { item.rating = 80; });
  x.silver.rating = 74;
  x.prices = new Map(x.input.inventory.items.map(item => [item.definitionId, 1000]));
  const result = await refineFc27PuzzleOwnedValue(x.input, x.preview, x.prices);
  expect(result.materialValue).toBe(11000);
  expect(result.selected).toContainEqual(expect.objectContaining({ id: x.silver.id, rating: 74 }));
  expect(result.selected.filter(item => item.rating < 75)).toHaveLength(1);
});

it('keeps a verified incumbent and performs bounded material refinement when EA has no team evaluator', async () => {
  const x = fixture();
  // Pure player-count/quality puzzles do not need team facts, so the EA reader
  // deliberately omits evaluateSquad. The old market refinement treated that
  // as an evaluator failure and fell through to the 20k whole-squad search.
  x.input.challenge.rawRequirements = [marketRow(3, 2)];
  x.input.evaluateSquad = undefined;
  x.preview.selected = x.preview.selected.map(ref => ({ ...ref, rating: 80 }));
  x.input.inventory.items.forEach(item => { item.rating = 80; });
  x.silver.rating = 74;
  x.prices = new Map(x.input.inventory.items.map(item => [item.definitionId, 1000]));
  const result = await suggestFc27PuzzleJointPurchasesCooperatively(x.input, [], {
    incumbent: x.preview, maxNodes: 100, materialPrices: x.prices, prices: new Map(),
    localOnly: true, localSearchBudget: 40,
  });
  expect(result.status, JSON.stringify(result)).toBe('suggested');
  expect(result.plans[0].materialValue).toBe(11000);
  expect(result.plans[0].selectedOwned.some(item => item.id === x.silver.id)).toBe(true);
  expect(result.nodes).toBeLessThanOrEqual(40);
  expect(result.reason).toBe('FC27_PURCHASE_LOCAL_REFINEMENT_READY');
});

it('keeps exact version uniqueness when a cheaper physical copy already occurs in the squad', async () => {
  const x = fixture();
  x.silver.definitionId = x.preview.selected[0].definitionId;
  x.prices.set(x.silver.definitionId, 200);
  const result = await refineFc27PuzzleOwnedValue(x.input, x.preview, x.prices);
  expect(result.selected).toEqual(x.preview.selected);
  expect(new Set(result.selected.map(item => item.definitionId)).size).toBe(11);
});

it('checks cancellation across cooperative replacement slices and never returns a stale improved squad', async () => {
  const x = fixture(); let yields = 0;
  await expect(refineFc27PuzzleOwnedValue(x.input, x.preview, x.prices, { sliceMs: 0,
    yieldControl: async () => { yields++; },
    assertCurrent: () => { if (yields >= 2) throw Error('FC27_CONTEXT_CHANGED'); },
  })).rejects.toThrow('FC27_CONTEXT_CHANGED');
});

it.each(['higher', 'missing', 'locked', 'native-gold', 'club-required', 'chemistry'])('rejects unsafe or non-improving same-slot replacements: %s', async mode => {
  const x = fixture();
  if (mode === 'higher') x.prices.set(x.silver.definitionId, 1200);
  if (mode === 'missing') x.prices.delete(x.silver.definitionId);
  if (mode === 'locked') { x.input.policy.protectFsuLockedPlayers = true; x.silver.locked = true; }
  if (mode === 'native-gold') x.input.challenge.rawRequirements.push(marketRow(3, 3));
  if (mode === 'club-required') {
    x.input.challenge.rawRequirements.push(marketRow(12, x.input.inventory.items[2].teamId, 1));
    x.silver.teamId = 9999;
  }
  if (mode === 'chemistry') x.silver.positions = [0];
  // Make every other slot indispensable so a candidate cannot move elsewhere.
  x.input.evaluateSquad = squad => ({ status: 'observed', chemistry:
    squad.every((item, slot) => item?.id === x.preview.selected.find(ref => ref.slot === slot)?.id
      || item?.id === x.silver.id && slot === x.preview.selected.find(ref => ref.id === 3)?.slot
        && mode !== 'chemistry') ? 22 : 0, teamRating: 80 });
  const result = await refineFc27PuzzleOwnedValue(x.input, x.preview, x.prices);
  expect(result.materialValue).toBe(11000);
  expect(result.selected).toEqual(x.preview.selected);
});

it('reuses a priced cash incumbent with zero-cost owned cards when whole-squad search has no result', async () => {
  const x = fixture();
  const old = x.input.inventory.items[0];
  const market = { ...old, definitionId: 9999, catalogRef: 'fc27:9999' }; delete market.id; delete market.pile;
  const preview = x.preview;
  const result = await suggestFc27PuzzleJointPurchasesCooperatively(x.input, [market], {
    incumbent: preview, maxNodes: 50, prices: new Map([[market.definitionId, 900]]), costCeiling: 1000,
  });
  expect(result.status).toBe('suggested');
  expect(result.plans[0]).toMatchObject({ estimatedCost: 0, purchaseCount: 0 });
  expect(result.plans[0].selectedOwned).toHaveLength(11);
  expect(result.nodes).toBeLessThanOrEqual(50);
  expect(result.materialValue).toBeUndefined();
});

it('does not downgrade an owned gold card to an equal-cash silver card in cash-first mode', async () => {
  const x = fixture();
  const card = { ...x.silver }; delete card.id; delete card.pile;
  const result = await suggestFc27PuzzleJointPurchasesCooperatively(x.input, [card], {
    incumbent: x.preview, maxNodes: 100, prices: new Map([[card.definitionId, 900]]), costCeiling: 1000,
  });
  expect(result.status).toBe('suggested');
  expect(result.plans[0]).toMatchObject({ estimatedCost: 0, purchaseCount: 0 });
  expect(result.plans[0].selectedOwned).toEqual(x.preview.selected);
});

it('finds a two-card owned exchange when neither single replacement preserves chemistry', async () => {
  const x = fixture();
  const original = x.preview.selected;
  x.input.challenge.rawRequirements = [marketRow(35, 22)];
  const firstOwned = { ...x.input.inventory.items[0], id: 7001, definitionId: 9701 };
  const secondOwned = { ...x.input.inventory.items[1], id: 7002, definitionId: 9702 };
  x.input.inventory.items.push(firstOwned, secondOwned);
  const firstMarket = { ...firstOwned, definitionId: 9801, catalogRef: 'fc27:9801' };
  const secondMarket = { ...secondOwned, definitionId: 9802, catalogRef: 'fc27:9802' };
  delete firstMarket.id; delete firstMarket.pile;
  delete secondMarket.id; delete secondMarket.pile;
  const [firstSlot, secondSlot] = original.slice(0, 2).map(ref => ref.slot);
  const incumbent = { status: 'preview', selected: [
    ...original.filter(ref => ref.slot !== firstSlot && ref.slot !== secondSlot),
    { catalogRef: 'fc27:9801', definitionId: 9801, rating: firstMarket.rating, slot: firstSlot },
    { catalogRef: 'fc27:9802', definitionId: 9802, rating: secondMarket.rating, slot: secondSlot },
  ] };
  const conceptKeys = new Set([`fc27:9801`, `fc27:9802`]);
  x.input.evaluateSquad = squad => {
    const keys = new Set(squad.filter(Boolean).map(item => item.catalogRef ?? item.id));
    const marketValid = [...conceptKeys].every(key => keys.has(key));
    const pairedOwnedValid = keys.has(7001) && keys.has(7002);
    return { status: 'observed', chemistry: marketValid || pairedOwnedValid ? 22 : 0, teamRating: 80 };
  };
  const result = await suggestFc27PuzzleJointPurchasesCooperatively(x.input, [firstMarket, secondMarket], {
    incumbent, maxNodes: 500, prices: new Map([[9801, 500], [9802, 500]]), costCeiling: 1000,
  });
  expect(result.status, JSON.stringify(result)).toBe('suggested');
  expect(result.plans[0]).toMatchObject({ estimatedCost: 0, purchaseCount: 0 });
  expect(result.plans[0].selectedOwned).toHaveLength(11);
  expect(result.plans[0].selectedOwned.map(ref => ref.id)).toEqual(expect.arrayContaining([7001, 7002]));
  expect(result.nodes).toBeLessThanOrEqual(500);
});

it('prioritizes a feasible silver plus gold chemistry-preserving pair without whole-squad DFS', async () => {
  const x = fixture();
  const silver = x.silver;
  silver.rating = 74;
  const bridge = { ...x.input.inventory.items[0], id: 8001, definitionId: 9801, rating: 80 };
  x.input.inventory.items.push(bridge);
  x.input.challenge.rawRequirements = [marketRow(3, 2, -1, 0), marketRow(35, 22)];
  const allItems = x.input.inventory.items;
  x.input.inventory.items = allItems.filter(item => item.id !== silver.id && item.id !== bridge.id);
  x.preview = search.previewFc27PuzzleSquad(x.input);
  x.input.inventory.items = allItems;
  const originals = x.preview.selected.map(ref => ref.id);
  x.input.evaluateSquad = squad => {
    const ids = new Set(squad.filter(Boolean).map(item => item.id));
    const silverBridge = ids.has(silver.id) && ids.has(bridge.id);
    const baseline = originals.every(id => ids.has(id));
    return { status: 'observed', chemistry: baseline || silverBridge ? 22 : 18, teamRating: 80 };
  };
  for (const item of x.input.inventory.items) x.prices.set(item.definitionId, item.id === silver.id ? 200 : item.id === bridge.id ? 250 : 1000);
  const route = vi.spyOn(search, 'iterateFc27PuzzleCandidateRoutes');
  const result = await suggestFc27PuzzleJointPurchasesCooperatively(x.input, [], {
    incumbent: x.preview, maxNodes: 1000, prices: new Map(), materialPrices: x.prices,
    costCeiling: 11000, localOnly: true,
  });
  expect(route).not.toHaveBeenCalled();
  expect(result).toMatchObject({ status: 'suggested', searchComplete: false, optimalWithinPool: false });
  expect(result.plans[0].selectedOwned, JSON.stringify(result)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: silver.id, rating: 74 }), expect.objectContaining({ id: bridge.id }),
  ]));
  expect(result.plans[0].materialValue).toBe(9450);
  expect(result.nodes).toBeLessThanOrEqual(1000);
});
