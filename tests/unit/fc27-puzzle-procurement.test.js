import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { findFc27PuzzleRepairSeed, planFc27PuzzleRepairQueries, suggestFc27PuzzlePurchases,
  planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';

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
