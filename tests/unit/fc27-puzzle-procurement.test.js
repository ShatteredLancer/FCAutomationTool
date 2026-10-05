import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { findFc27PuzzleRepairSeed, planFc27PuzzleRepairQueries, suggestFc27PuzzlePurchases,
  planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
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

it('plans missing bronze materials without requiring a complete owned near-solution', () => {
  const { input, card } = fixture();
  input.inventory.items.pop();
  input.challenge.rawRequirements = [marketRow(3, 1), marketRow(17, 2, 3), marketRow(35, 14)];
  input.inventory.items.slice(7).forEach(item => { item.rating = 68; });
  expect(findFc27PuzzleRepairSeed(input).status).toBe('blocked');
  const route = planFc27PuzzleShortageQueries(input);
  expect(route.status).toBe('ready');
  expect(route.queries.every(query => query.level === 'bronze')).toBe(true);
  const result = suggestFc27PuzzleJointPurchases(input, [card]);
  expect(result).toMatchObject({ status: 'suggested', plans: [{ purchaseCount: 1,
    selectedOwned: expect.any(Array), purchases: [{ definitionId: 901 }] }] });
  expect(result.plans[0].selectedOwned).toHaveLength(10);
  expect(result.plans[0].purchases[0]).not.toHaveProperty('id');
  expect(input.policy.onlyUntradeable).toBe(true);
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
