import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { findFc27PuzzleRepairSeed, planFc27PuzzleRepairQueries, suggestFc27PuzzlePurchases,
  planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases, refineFc27PuzzleOwnedValue } from '../../src/fc27/puzzle-procurement.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { marketFixture, marketRow } from '../helpers/fc27-market-fixture.js';
import { puzzleCostFixture } from '../helpers/fc27-puzzle-cost-fixture.js';

it('keeps the cheap connected route under the same 50000-node budget with public quotes', () => {
  const { input, entries, prices } = puzzleCostFixture();
  const result = suggestFc27PuzzleJointPurchases(input, entries, { prices });
  expect(result.status).toBe('suggested');
  expect(result.estimatedCost).toBeLessThanOrEqual(1900);
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(result.plans[0].purchases.reduce((n, card) => n + prices.get(card.definitionId), 0)).toBe(result.estimatedCost);
});

it.each([5000, 300, 400])('compares total spend for one expensive card versus two 200-coin cards (single=%i)', single => {
  const { input, card } = fixture();
  input.challenge.rawRequirements[1].pairs[0].values = [31];
  const entries = [card, ...[902, 903].map(definitionId => ({ ...card, definitionId, nationId: 2, leagueId: 2, teamId: 22 }))];
  const prices = new Map([[901, single], [902, 200], [903, 200]]);
  const result = suggestFc27PuzzlePurchases(input, findFc27PuzzleRepairSeed(input), entries, { prices });
  const plan = result.plans[0];
  expect(plan.purchases.reduce((n, item) => n + prices.get(item.definitionId), 0)).toBe(Math.min(single, 400));
  expect(plan.purchaseCount).toBe(single > 400 ? 2 : 1);
  expect(plan.teamFacts.chemistry).toBeGreaterThanOrEqual(31);
  expect(result.checks).toBeLessThanOrEqual(20000);
});

function fixture() {
  const input = puzzleFillFixture();
  input.challenge.rawRequirements[1].pairs[0].values = [33];
  input.inventory.items[10].positions = [7];
  const card = {definitionId:901,rating:60,rarity:0,nationId:1,leagueId:1,teamId:11,
    positions:[5],groups:[],special:false,evolution:false,cosmetic:false};
  return {input,card};
}

it('compares owned market value plus added spend instead of treating a valuable owned card as free', () => {
  const input = marketFixture();
  const prices = new Map(input.catalog.entries.map(item => [item.definitionId, 200]));
  const materialPrices = new Map([[101, 10000], [102, 200]]);
  const result = suggestFc27PuzzleJointPurchases(input, input.catalog.entries, { prices, materialPrices });
  expect(result.status).toBe('suggested');
  expect(result.materialValue).toBe(600);
  expect(result.plans[0].selectedOwned.some(item => item.definitionId === 101)).toBe(false);
  expect(result.estimatedCost).toBe(result.plans[0].purchaseCount * 200);
  expect(result.materialValue).toBe(result.estimatedCost + result.plans[0].inventoryValue);
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(suggestFc27PuzzleJointPurchases(input, input.catalog.entries, { prices }).estimatedCost).toBe(200);
  materialPrices.delete(101);
  const missing = suggestFc27PuzzleJointPurchases(input, input.catalog.entries, { prices, materialPrices });
  expect(missing.plans[0].selectedOwned.some(item => item.definitionId === 101)).toBe(false);
  expect(missing.materialValue).toBe(600);
});

it('refines an owned-only feasible squad by material value without introducing purchases', async () => {
  const input = puzzleFillFixture();
  input.inventory.items.push({ ...input.inventory.items[0], id: 80, definitionId: 180 });
  const preview = previewFc27PuzzleSquad(input);
  const values = new Map(input.inventory.items.map(item => [item.definitionId, item.id === 1 ? 10000 : 200]));
  const result = await refineFc27PuzzleOwnedValue(input, preview, values);
  expect(result.status).toBe('preview');
  expect(result.initialMaterialValue).toBe(12000);
  expect(result.materialValue).toBe(2200);
  expect(result.selected).toHaveLength(11);
  expect(result.selected.every(item => !item.catalogRef && item.id !== 1)).toBe(true);
  expect(result.estimatedCost).toBeUndefined();
  values.delete(preview.selected[0].definitionId);
  expect(await refineFc27PuzzleOwnedValue(input, preview, values)).toMatchObject({
    selected: preview.selected, materialValue: null, valueReason: 'FC27_PUZZLE_VALUE_INCOMPLETE' });
});

it('uses public league links for a third mixed-quality lane when no owned card is eligible', () => {
  const { input, card } = fixture();
  input.policy.maxRating = 82;
  input.inventory.items = [];
  input.challenge.rawRequirements = [marketRow(3, 2), marketRow(17, 3, 6), marketRow(35, 22)];
  const usedQueries = ['silver', 'gold'].map(level => ({ start: 0, count: 20, level }));
  const entries = Array.from({ length: 40 }, (_, index) => ({ ...card,
    definitionId: 2000 + index, rating: index < 20 ? 70 : 78,
    leagueId: index < 20 ? 100 + index : index < 28 ? 99 : 200 + index }));
  const route = planFc27PuzzleShortageQueries(input, entries, { usedQueries });
  expect(route.queries).toHaveLength(3);
  expect(route.queries).toContainEqual({ start: 0, count: 20, level: 'silver', league: 99 });
  expect(input.inventory.items).toEqual([]);
});

it.each([false, true])('accepts only strictly cheaper plans under an incumbent cost ceiling (joint=%s)', joint => {
  const { input, card } = fixture();
  if (joint) input.inventory.items.pop();
  const prices = new Map([[901, 200]]);
  const solve = costCeiling => joint ? suggestFc27PuzzleJointPurchases(input, [card], { prices, costCeiling })
    : suggestFc27PuzzlePurchases(input, findFc27PuzzleRepairSeed(input), [card], { prices, costCeiling });
  expect(solve(201)).toMatchObject({ status: 'suggested', plans: [{ purchaseCount: 1 }] });
  expect(solve(200)).toMatchObject({ status: 'blocked', plans: [] });
});

it.each([0, -1, 1.5, NaN, Infinity, 165000001])('rejects invalid incumbent cost ceiling %s in both solvers', costCeiling => {
  const { input, card } = fixture(); const prices = new Map([[901, 200]]);
  expect(suggestFc27PuzzlePurchases(input, findFc27PuzzleRepairSeed(input), [card], { prices, costCeiling }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_POLICY_INVALID' });
  expect(suggestFc27PuzzleJointPurchases(input, [card], { prices, costCeiling }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_POLICY_INVALID' });
});

it('finds a detached near-solution without changing the real requirement or untradeable-only policy', () => {
  const {input} = fixture(); const original=structuredClone(input.challenge);
  const seed=findFc27PuzzleRepairSeed(input);
  expect(seed.status).toBe('ready'); expect(seed.teamFacts.chemistry).toBe(30);
  expect(input.challenge).toEqual(original);expect(input.policy.onlyUntradeable).toBe(true);
  expect(seed.executable).toBe(false);
});

it('validates the entire real squad before suggesting a public version and never fabricates an owned id', () => {
  const {input,card}=fixture(); const seed=findFc27PuzzleRepairSeed(input);
  const result=suggestFc27PuzzlePurchases(input,seed,[card]);
  expect(result.status).toBe('suggested');
  expect(result.plans[0]).toMatchObject({purchaseCount:1,teamFacts:{chemistry:33},executable:false});
  expect(result.plans[0].purchases[0]).toMatchObject({definitionId:901});
  expect(result.plans[0].purchases[0]).not.toHaveProperty('id');
  expect(input.policy.onlyUntradeable).toBe(true);
  expect(result.plans[0].requiresPurchasedMaterialApproval).toBe(true);
});

it.each(['special','evolution','cosmetic'])('never suggests %s market versions', key=>{
  const {input,card}=fixture(); card[key]=true;
  expect(suggestFc27PuzzlePurchases(input,findFc27PuzzleRepairSeed(input),[card]).plans).toEqual([]);
});

it('queries only bounded connected lanes and rejects stale or tampered seeds',()=>{
  const {input,card}=fixture(); const seed=findFc27PuzzleRepairSeed(input);
  const route=planFc27PuzzleRepairQueries(input,seed);
  expect(route.queries.length).toBeGreaterThan(0);expect(route.queries.length).toBeLessThanOrEqual(3);
  expect(route.queries.every(q=>q.level==='bronze'&&q.count===20)).toBe(true);
  input.challenge.rawRequirements[1].pairs[0].values=[32];
  expect(suggestFc27PuzzlePurchases(input,seed,[card]).status).toBe('blocked');
});

it('reserves a silver repair lane when a 5-silver/6-gold chemistry seed needs an in-position silver', () => {
  const input = puzzleFillFixture();
  input.policy.maxRating = 82;
  input.challenge.formation.positions = Array(11).fill(5);
  input.challenge.rawRequirements = [marketRow(5, 4, -1, 1), marketRow(4, 3), marketRow(8, 3),
    marketRow(3, 2), marketRow(17, 3, 6), marketRow(35, 22)];
  const base = input.inventory.items[0];
  input.inventory.items = Array.from({ length: 11 }, (_, index) => ({ ...base,
    id: index + 1, definitionId: 101 + index, rating: index < 5 ? 70 : 78,
    nationId: 1, leagueId: index < 4 ? 1 : index < 8 ? 2 : 3,
    teamId: 100 + index, positions: index < 4 ? [0] : [5],
  }));
  const seed = findFc27PuzzleRepairSeed(input);
  expect(seed).toMatchObject({ status: 'ready', teamFacts: { chemistry: 21 } });
  const silver = { ...base, id: undefined, definitionId: 901, rating: 70,
    nationId: 1, leagueId: 1, teamId: 901, positions: [5] };
  expect(suggestFc27PuzzlePurchases(input, seed, [silver])).toMatchObject({
    status: 'suggested', plans: [{ purchaseCount: 1, teamFacts: { chemistry: 24 } }],
  });
  const route = planFc27PuzzleRepairQueries(input, seed);
  expect(route.queries).toHaveLength(3);
  expect(route.queries.filter(query => query.level === 'silver')).toEqual([
    { start: 0, count: 20, level: 'silver', league: 1 },
  ]);
});

it('prioritizes missing bronze and covers required silver without requiring a complete owned near-solution', () => {
  const { input, card } = fixture();
  input.inventory.items.pop();
  input.challenge.rawRequirements = [marketRow(3, 1), marketRow(17, 2, 3), marketRow(35, 14)];
  input.inventory.items.slice(7).forEach(item => { item.rating = 68; });
  expect(findFc27PuzzleRepairSeed(input).status).toBe('blocked');
  const route = planFc27PuzzleShortageQueries(input);
  expect(route.status).toBe('ready');
  expect(route.queries[0].level).toBe('bronze');
  expect(new Set(route.queries.map(query => query.level))).toEqual(new Set(['bronze', 'silver']));
  const result = suggestFc27PuzzleJointPurchases(input, [card]);
  expect(result).toMatchObject({ status: 'suggested', plans: [{ purchaseCount: 1,
    selectedOwned: expect.any(Array), purchases: [{ definitionId: 901 }] }] });
  expect(result.plans[0].selectedOwned).toHaveLength(10);
  expect(result.plans[0].purchases[0]).not.toHaveProperty('id');
  expect(input.policy.onlyUntradeable).toBe(true);
  expect(suggestFc27PuzzleJointPurchases(input, [{ ...card, rating: 68 }]).status).toBe('suggested');
  input.challenge.rawRequirements.push(marketRow(17,2,3,1));
  expect(suggestFc27PuzzleJointPurchases(input, [{ ...card, rating: 68 }]).plans).toEqual([]);
});

it('does not exhaust a joint search without market candidates or claim market-wide infeasibility', () => {
  const { input } = fixture();
  expect(suggestFc27PuzzleJointPurchases(input, [], { maxNodes: 1 })).toMatchObject({
    status: 'blocked', reason: 'FC27_PURCHASE_REPAIR_NO_PLAN', marketCandidates: 0,
    nodes: 0, truncated: false, marketWideInfeasibilityProven: false, plans: [],
  });
});

it.each([200, 15000000])('searches priced joint candidates at a valid public price %s without treating planning bounds as approval', price => {
  const { input, card } = fixture(); input.inventory.items.pop();
  const result = suggestFc27PuzzleJointPurchases(input, [card], { prices: new Map([[901, price]]) });
  expect(result).toMatchObject({ status: 'suggested', executable: false,
    plans: [{ purchaseCount: 1, purchases: [{ definitionId: 901 }], requiresPurchasedMaterialApproval: true }] });
  expect(result.nodes).toBeGreaterThan(0);
});

it.each([15000001, -1, NaN])('continues rejecting malformed public cost %s before searching', price => {
  const { input, card } = fixture(); input.inventory.items.pop();
  expect(suggestFc27PuzzleJointPurchases(input, [card], { prices: new Map([[901, price]]) }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_QUOTE_INVALID', nodes: 0, plans: [] });
});

it('retains real joint search exhaustion when eligible market versions exist', () => {
  const { input, card } = fixture();
  expect(suggestFc27PuzzleJointPurchases(input, [card], { maxNodes: 1 })).toMatchObject({
    status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', marketCandidates: 1,
    truncated: true, plans: [],
  });
});

it('reaches the cheapest legal market combination before the bounded search stops', () => {
  const input = marketFixture();
  input.inventory.items = [];
  input.challenge.rawRequirements = [marketRow(3, 1)];
  const entries = [901, 902, 903, 904, 905].map((definitionId, index) => ({
    definitionId, rating: 60, rarity: 0, nationId: 2, leagueId: 2,
    teamId: index + 11, positions: [5], groups: [], special: false,
    evolution: false, cosmetic: false,
  }));
  const prices = new Map([[901, 5000], [902, 5000], [903, 5000], [904, 200], [905, 200]]);
  const result = suggestFc27PuzzleJointPurchases(input, entries, { prices, maxNodes: 6 });
  expect(result.status).toBe('suggested');
  expect(result.plans[0].purchases.map(item => item.definitionId).sort((a, b) => a - b))
    .toEqual([901, 904, 905]);
  expect(result.estimatedCost).toBe(5400);
  expect(result.nodes).toBeLessThanOrEqual(6);
  expect(result.truncated).toBe(true);
  expect(result.optimalWithinPool).toBe(false);
});

it('joint procurement also works without a chemistry requirement and retains owned protections', () => {
  const { input, card } = fixture();
  input.challenge.rawRequirements = [marketRow(3, 1, -1, 2)];
  input.inventory.items.pop();
  expect(suggestFc27PuzzleJointPurchases(input, [card]).status).toBe('suggested');
  input.inventory.items[0].locked = true;
  expect(suggestFc27PuzzleJointPurchases(input, [card]).status).toBe('blocked');
});

it('targets bronze clubs under a club cap even when bronze headcount alone is sufficient', () => {
  const { input } = fixture();
  input.challenge.rawRequirements = [marketRow(3, 1), marketRow(9, 4, -1, 1), marketRow(35, 14)];
  input.inventory.items.forEach((item, i) => { item.teamId = Math.floor(i / 2) + 1; });
  const route = planFc27PuzzleShortageQueries(input);
  expect(route.queries).toEqual([1, 2, 3].map(team => ({ start: 0, count: 20, level: 'bronze', team })));
});

it('uses safe public candidates to focus later pages without promoting protected owned cards', () => {
  const { input, card } = fixture();
  input.challenge.rawRequirements = [marketRow(3, 1), marketRow(9, 4, -1, 1)];
  input.inventory.items.forEach(item => { item.locked = true; });
  const entries = [0, 1, 2].map(i => ({ ...card, definitionId: 901 + i, teamId: 123 }));
  entries.push({ ...card, definitionId: 910, teamId: 321, special: true });
  const route = planFc27PuzzleShortageQueries(input, entries);
  expect(route.queries[0]).toEqual({ start: 0, count: 20, level: 'bronze', team: 123 });
  expect(route.queries.every(query => query.level === 'bronze' && query.team !== 321 && query.team !== 11)).toBe(true);
});

it('does not sample silver or gold when minimum bronze policy forbids their use', () => {
  const { input } = fixture(); input.challenge.rawRequirements = [marketRow(3, 1)];
  input.policy.maxRating = 82;
  expect(planFc27PuzzleShortageQueries(input).queries.every(query => query.level === 'bronze')).toBe(true);
});

it('expands bronze chemistry fillers rather than spending all pages on silver when the linked club silver is owned', () => {
  const { input } = fixture(); input.policy.maxRating = 82;
  input.clubLinks.links = [[116021, 112172]];
  input.challenge.rawRequirements = [marketRow(12, 112172, 1), marketRow(9, 4),
    marketRow(17, 2, 1), marketRow(3, 1), marketRow(35, 14)];
  Object.assign(input.inventory.items[0], { rating: 71, teamId: 116021, nationId: 34, leagueId: 2215 });
  const route = planFc27PuzzleShortageQueries(input);
  expect(route.queries[0]).toEqual({ start: 0, count: 20, level: 'bronze', nation: 34 });
  expect(route.queries.every(query => query.level === 'bronze')).toBe(true);
  const next = planFc27PuzzleShortageQueries(input, [{ definitionId: 901, rating: 60, rarity: 0,
    teamId: 99, nationId: 34, leagueId: 80, positions: [5], groups: [],
    special: false, evolution: false, cosmetic: false }]);
  expect(next.queries).toContainEqual({ start: 0, count: 20, level: 'bronze', league: 80 });
  expect(input.policy.onlyUntradeable).toBe(true);
});

it('reserves a club identity lane and bronze fillers when the compulsory silver is missing', () => {
  const { input } = fixture(); input.policy.maxRating = 82;
  input.challenge.rawRequirements = [marketRow(12, 112172, 1), marketRow(17, 2, 1), marketRow(3, 1), marketRow(35, 14)];
  const route = planFc27PuzzleShortageQueries(input);
  expect(route.queries).toHaveLength(3);
  expect(route.queries[0]).toMatchObject({ level: 'silver', team: 112172 });
  expect(route.queries.filter(query => query.level === 'bronze').length).toBe(2);
});

it('reserves a query for a missing required tier when only filler clubs are owned', () => {
  const { input } = fixture(); input.policy.maxRating = 82;
  input.challenge.rawRequirements = [marketRow(3, 2), marketRow(17, 3, 2), marketRow(9, 4, -1, 1)];
  input.inventory.items.forEach((item, i) => { item.rating = 70; item.teamId = Math.floor(i / 2) + 1; });
  const route = planFc27PuzzleShortageQueries(input);
  expect(route.queries).toHaveLength(3);
  expect(route.queries[0]).toMatchObject({ level: 'gold' });
  expect(route.queries.some(query => query.level === 'silver')).toBe(true);
  expect(route.queries.some(query => query.level === 'bronze')).toBe(false);
});
