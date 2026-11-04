import { expect, it, vi } from 'vitest';
import data from '../fixtures/fc27-puzzle-incumbent-cost.json';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { runRatingPruneSession } from '../helpers/fc27-puzzle-rating-fixture.js';
import * as procurement from '../../src/fc27/puzzle-procurement.js';
import { evaluateFc27PuzzleSquad, boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';
import { prepareFc27PuzzleConceptDraft } from '../../src/fc27/puzzle-concept-draft.js';

it('improves the frozen public cost cohort through incumbent replacements, not a fresh whole-squad search',()=>{
  const input=puzzleFillFixture();input.challenge={...data.challenge,context:input.context};
  Object.assign(input.policy,data.policy);input.chemistry=structuredClone(data.chemistry);input.clubLinks=structuredClone(data.clubLinks);
  input.policy.lockedItemIds=[];input.policy.activeSquadItemIds=[];
  input.inventory.items=structuredClone(data.owned);
  input.evaluateSquad=squad=>evaluateFc27PuzzleSquad({squad,formation:input.challenge.formation,chemistry:input.chemistry,rating:input.chemistry.rating});
  input.boundSquad=squad=>boundFc27PuzzleChemistry({squad,formation:input.challenge.formation,chemistry:input.chemistry,rating:input.chemistry.rating});
  const prices=new Map(data.prices),entries=data.entries.filter(c=>prices.has(c.definitionId)),before=JSON.stringify(input);
  const cold=procurement.suggestFc27PuzzleJointPurchases(input,entries,{prices,maxNodes:20000,costCeiling:data.baseline});
  const warm=procurement.suggestFc27PuzzleJointPurchases(input,entries,{prices,maxNodes:20000,costCeiling:data.baseline,incumbent:data.incumbent});
  expect(warm.plans[0].estimatedCost).toBeLessThanOrEqual(cold.plans[0].estimatedCost);
  expect(warm.plans[0].estimatedCost).toBeLessThanOrEqual(18300);expect(warm.nodes).toBeLessThanOrEqual(20000);
  expect(warm.localSearchNodes).toBeGreaterThan(0);
  const plan=warm.plans[0];expect(plan.teamFacts).toEqual({chemistry:24,teamRating:72});
  expect(prepareFc27PuzzleConceptDraft(input,{...plan,purchases:plan.purchases.map(c=>({...c,estimatedUnitPrice:prices.get(c.definitionId)}))}).status).toBe('prepared');
  expect(JSON.stringify(input)).toBe(before);
});

it('passes the verified scaffold into the actual Session coverage call instead of silently dropping it',async()=>{
  const spy=vi.spyOn(procurement,'suggestFc27PuzzleJointPurchasesCooperatively');
  try {
    const x=await runRatingPruneSession(false);
    expect(x.result.status).toBe('suggested');
    expect(x.result.diagnostics.localSearchNodes).toBeGreaterThan(0);
    const calls=spy.mock.calls.filter(([, ,options])=>typeof options?.yieldControl==='function');
    expect(calls.length).toBeGreaterThan(0);
    for(const[, ,options]of calls){expect(options.incumbent?.status).toBe('preview');expect(options.incumbent?.selected).toHaveLength(9);}
    expect(x.writes).toEqual([]);
  } finally {spy.mockRestore();}
});
