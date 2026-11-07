import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exercisePuzzleRatingFeasibility(context) {
  const page=await context.newPage();
  try {
    await page.route('**/*',route=>route.abort());
    const root=path.resolve(import.meta.dirname,'../..');
    const bundle=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`
      export { runRatingPruneSession } from './tests/helpers/fc27-puzzle-rating-fixture.js';
    `},bundle:true,write:false,format:'iife',globalName:'PuzzleRatingSmoke',target:'chrome120'});
    await page.setContent('<!doctype html><title>Puzzle rating feasibility offline regression</title>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    for(const mode of [false,true]) {
      const proof=await page.evaluate(async mode=>{
        const x=await globalThis.PuzzleRatingSmoke.runRatingPruneSession(mode),plan=x.result.plans?.[0];
        return {status:x.result.status,reason:x.result.reason,facts:plan?.teamFacts,
          count:plan?plan.selectedOwned.length+plan.purchases.length:0,price:plan?.estimatedCost,
          nodes:x.result.diagnostics.nodes,queries:x.reads.length,writes:x.writes.length,unchanged:x.inputUnchanged};
      },mode);
      assert.equal(proof.status,'suggested',JSON.stringify(proof));
      assert.equal(proof.count,9);assert.ok(proof.facts.teamRating>=70&&proof.facts.chemistry>=24);
      assert.ok(proof.nodes<=70000&&proof.queries<=5);assert.equal(proof.writes,0);assert.equal(proof.unchanged,true);
      console.log(`Puzzle rating feasibility Chrome passed (${mode?'material-value':'additional-coins'}): ${JSON.stringify(proof)}; synthetic, no EA access.`);
    }
  } finally {await page.close();}
}

export async function exercisePuzzleIncumbentCost(context) {
  const page=await context.newPage();
  try {
    await page.route('**/*',route=>route.abort());
    const root=path.resolve(import.meta.dirname,'../..');
    const bundle=await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`
      export { default as data } from './tests/fixtures/fc27-puzzle-incumbent-cost.json';
      export { puzzleFillFixture } from './tests/helpers/fc27-puzzle-fill-fixture.js';
      export { suggestFc27PuzzleJointPurchasesCooperatively } from './src/fc27/puzzle-procurement.js';
      export { evaluateFc27PuzzleSquad,boundFc27PuzzleChemistry,createFc27PuzzleEvaluator } from './src/fc27/puzzle-evaluator.js';
      export { prepareFc27PuzzleConceptDraft } from './src/fc27/puzzle-concept-draft.js';
    `},bundle:true,write:false,format:'iife',globalName:'PuzzleIncumbentSmoke',target:'chrome120'});
    await page.setContent('<!doctype html><title>Puzzle incumbent cost offline regression</title>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const proof=await page.evaluate(async()=>{
      const a=globalThis.PuzzleIncumbentSmoke,d=a.data,input=a.puzzleFillFixture();
      input.challenge={...d.challenge,context:input.context};Object.assign(input.policy,d.policy,{lockedItemIds:[],activeSquadItemIds:[]});
      input.chemistry=structuredClone(d.chemistry);input.clubLinks=structuredClone(d.clubLinks);input.inventory.items=structuredClone(d.owned);
      input.evaluateSquad=squad=>a.evaluateFc27PuzzleSquad({squad,formation:input.challenge.formation,chemistry:input.chemistry,rating:input.chemistry.rating});
      input.boundSquad=squad=>a.boundFc27PuzzleChemistry({squad,formation:input.challenge.formation,chemistry:input.chemistry,rating:input.chemistry.rating});
      const prices=new Map(d.prices),entries=d.entries.filter(c=>prices.has(c.definitionId));
      let beforeCalls=0;
      const evaluate=input.evaluateSquad;
      input.evaluateSquad=squad=>{beforeCalls++;return evaluate(squad);};
      const beforeStarted=performance.now();
      const result=await a.suggestFc27PuzzleJointPurchasesCooperatively(input,entries,{prices,maxNodes:20000,costCeiling:d.baseline,incumbent:d.incumbent});
      const beforeMs=performance.now()-beforeStarted;
      const compiled=a.createFc27PuzzleEvaluator({formation:input.challenge.formation,chemistry:input.chemistry,rating:input.chemistry.rating});
      let afterCalls=0;
      input.evaluateSquad=squad=>{afterCalls++;return compiled.evaluateSquad(squad);};input.boundSquad=compiled.boundSquad;
      const afterStarted=performance.now();
      const repeated=await a.suggestFc27PuzzleJointPurchasesCooperatively(input,entries,{prices,maxNodes:20000,costCeiling:d.baseline,incumbent:d.incumbent});
      const afterMs=performance.now()-afterStarted;
      const plan=result.plans?.[0],draft=plan?a.prepareFc27PuzzleConceptDraft(input,{...plan,purchases:plan.purchases.map(c=>({...c,estimatedUnitPrice:prices.get(c.definitionId)}))}):null;
      return {status:result.status,cost:plan?.estimatedCost,nodes:result.nodes,localNodes:result.localSearchNodes,facts:plan?.teamFacts,draft:draft?.status,
        compiled:{beforeMs:Math.round(beforeMs),afterMs:Math.round(afterMs),beforeCalls,afterCalls,
          sameResult:JSON.stringify(repeated)===JSON.stringify(result)}};
    });
    assert.equal(proof.status,'suggested',JSON.stringify(proof));assert.ok(proof.cost<=18300,JSON.stringify(proof));
    assert.ok(proof.nodes<=20000&&proof.localNodes>0);assert.deepEqual(proof.facts,{chemistry:24,teamRating:72});assert.equal(proof.draft,'prepared');
    assert.equal(proof.compiled.sameResult,true);assert.equal(proof.compiled.beforeCalls,proof.compiled.afterCalls);
    console.log(`Puzzle incumbent cost Chrome passed: ${JSON.stringify(proof)}; frozen public facts/prices, synthetic ownership, not live offers.`);
  } finally {await page.close();}
}
