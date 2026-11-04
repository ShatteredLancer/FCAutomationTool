import { expect, it, vi } from 'vitest';
import { ratingPruneFixture as fixture, runRatingPruneSession } from '../helpers/fc27-puzzle-rating-fixture.js';
import { suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
import { searchFc27PuzzleCandidates } from '../../src/fc27/puzzle-preview.js';

it('does not spend the 50k budget permuting nine-player combinations whose native team rating is already too low', () => {
  const x=fixture(),before=JSON.stringify(x.input);
  expect(x.verify(x.entries.slice(20,29)).validation.status).toBe('satisfied');
  expect(x.verify([...x.entries.slice(20,26),...x.entries.slice(0,3)]).facts.teamRating).toBeLessThan(70);
  const result=suggestFc27PuzzleJointPurchases(x.input,x.entries,{prices:x.prices});
  expect(result.status,JSON.stringify({reason:result.reason,search:result.search,nodes:result.nodes})).toBe('suggested');
  expect(result.plans[0].teamFacts.teamRating).toBeGreaterThanOrEqual(70);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(24);
  expect(result.nodes).toBeLessThanOrEqual(50000);expect(JSON.stringify(x.input)).toBe(before);
});

function fixedSquad(target = 70, scope = 0) {
  const x=fixture(),template=x.input.inventory.items[0];
  x.input.challenge.rawRequirements.find(row=>row.pairs[0].key===19).pairs[0].values=[target];
  x.input.challenge.rawRequirements.find(row=>row.pairs[0].key===19).scope=scope;
  const candidates=[...x.entries.slice(20,26),...x.entries.slice(0,3)].map(card=>({...template,...card}));
  return { ...x, pool:{status:'candidates',required:9,candidates} };
}

it.each([[70,0,false],[69,0,true],[68,1,false],[69,1,true],[70,2,false],[69,2,true]])(
  'checks native rating %i/scope %i before spending any permutation work', (target,scope,valid) => {
    const x=fixedSquad(target,scope),evaluate=vi.fn(x.input.evaluateSquad),bound=vi.fn(x.input.boundSquad);
    const result=searchFc27PuzzleCandidates({...x.input,pool:x.pool,evaluateSquad:evaluate,boundSquad:bound,maxNodes:500});
    expect(result.status).toBe(valid?'preview':'blocked');
    if(!valid){expect(evaluate).not.toHaveBeenCalled();expect(bound).not.toHaveBeenCalled();expect(result.search.evaluations).toBe(0);}
    expect(result.nodes).toBeLessThan(500);
  });

it.each(['unknown-profile','unknown-rating-config'])('retains the full evaluator path with %s rather than inferring native facts', mode=>{
  const x=fixedSquad(),evaluate=vi.fn(()=>({status:'observed',teamRating:75,chemistry:27}));
  if(mode==='unknown-profile')x.input.chemistry={...x.input.chemistry,profilesEnabled:true,profiles:{complete:false,entries:[]}};
  else delete x.input.chemistry.rating;
  const result=searchFc27PuzzleCandidates({...x.input,pool:x.pool,evaluateSquad:evaluate,boundSquad:null,maxNodes:500});
  expect(result.status).toBe('preview');expect(evaluate).toHaveBeenCalled();
});

it.each([false,true])('uses the supplied native integer/float rating mode (%s), not a guessed threshold', floatCalculationEnabled=>{
  const x=fixedSquad();x.input.chemistry.rating.floatCalculationEnabled=floatCalculationEnabled;
  const facts=x.input.evaluateSquad([...x.pool.candidates,null,null]);
  x.input.challenge.rawRequirements.find(row=>row.pairs[0].key===19).pairs[0].values=[facts.teamRating];
  expect(searchFc27PuzzleCandidates({...x.input,pool:x.pool,maxNodes:500}).status).toBe('preview');
  x.input.challenge.rawRequirements.find(row=>row.pairs[0].key===19).pairs[0].values=[facts.teamRating+1];
  expect(searchFc27PuzzleCandidates({...x.input,pool:x.pool,maxNodes:500}).search.evaluations).toBe(0);
});

it.each([false,true])('retains a verified feasible route across the complete paged/priced Session (materialValue=%s)',async mode=>{
  const x=await runRatingPruneSession(mode),plan=x.result.plans?.[0];
  expect(x.result.status,JSON.stringify({reason:x.result.reason,diagnostics:x.result.diagnostics})).toBe('suggested');
  expect(plan.teamFacts).toMatchObject({teamRating:expect.any(Number),chemistry:expect.any(Number)});
  expect(plan.teamFacts.teamRating).toBeGreaterThanOrEqual(70);expect(plan.teamFacts.chemistry).toBeGreaterThanOrEqual(24);
  expect(plan.purchases.length+plan.selectedOwned.length).toBe(9);
  expect(x.reads.length).toBeLessThanOrEqual(5);expect(x.result.diagnostics.nodes).toBeLessThanOrEqual(70000);
  expect(x.writes).toEqual([]);expect(x.inputUnchanged).toBe(true);
});
