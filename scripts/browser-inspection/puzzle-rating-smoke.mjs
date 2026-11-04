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
