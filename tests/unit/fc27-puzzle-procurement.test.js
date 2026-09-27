import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { findFc27PuzzleRepairSeed, planFc27PuzzleRepairQueries, suggestFc27PuzzlePurchases } from '../../src/fc27/puzzle-procurement.js';

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
