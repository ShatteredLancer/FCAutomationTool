import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exercisePuzzleMinimumQuality(context) {
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { minimumQualityFixture } from './tests/helpers/fc27-puzzle-minimum-quality-fixture.js';
      export { createFc27PuzzleProcurementSession } from './src/fc27/puzzle-procurement-session.js';
      export { prepareFc27PuzzleConceptDraft, validateFc27PuzzleConceptDraft } from './src/fc27/puzzle-concept-draft.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'MinimumQualitySmoke', target: 'chrome120' });
    await page.setContent('<!doctype html><title>Puzzle minimum-quality offline regression</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const evidence = await page.evaluate(async () => {
      const api = globalThis.MinimumQualitySmoke, results = [];
      for (const tier of [1,2]) {
        const { input, entries, need, nation } = api.minimumQualityFixture(tier), store = new Map(), queries = [];
        let writes = 0;
        const write = () => { writes++; throw Error('Read-only fixture'); };
        const options = { now: () => input.now,
          get: async (key,fallback) => structuredClone(store.get(key) ?? fallback),
          set: async (key,value) => store.set(key,structuredClone(value)), createTransport: async () => ({
            readCatalogPage: async query => { queries.push(query); return { status:'observed',source:'ea-defid',season:'27',
              query,observedAt:input.now,entries:entries.filter(card => query.level === (card.rating<65?'bronze':card.rating<75?'silver':'gold')
                && (!query.team || query.team===card.teamId) && (!query.nation || query.nation===card.nationId))
                .slice(query.start,query.start+query.count) }; },
            readQuotePage: async query => ({status:'observed',source:'ea-visible-buy-now',season:'27',platform:input.context.platform,
              definitionId:query.definitionId,observedAt:input.now,eligible:1,price:200}),
            buy:write,move:write,save:write,submit:write,
          }) };
        const first = await api.createFc27PuzzleProcurementSession(options).plan(input,{quoteCeiling:250});
        const draft = first.plans?.[0] ? api.prepareFc27PuzzleConceptDraft(input,first.plans[0]) : null;
        const verified = draft?.status==='prepared' ? api.validateFc27PuzzleConceptDraft(draft,input,[]) : null;
        const second = await api.createFc27PuzzleProcurementSession(options).plan(input,{quoteCeiling:250});
        results.push({tier,need,nation,status:first.status,repeated:second.status,secondRequests:second.requests,
          gold:first.plans?.[0]?.purchases.filter(card=>card.rating>=75).length,chemistry:first.plans?.[0]?.teamFacts.chemistry,
          nodes:first.diagnostics.nodes,queries,draft:draft?.status,verified:verified?.status,writes});
      }
      return results;
    });
    for (const row of evidence) {
      assert.equal(row.status,'suggested'); assert.equal(row.repeated,'suggested'); assert.equal(row.secondRequests,0);
      assert.equal(row.gold,row.need); assert.ok(row.chemistry >= (row.tier===1?14:22)); assert.ok(row.nodes<=50000);
      assert.equal(row.draft,'prepared'); assert.equal(row.verified,'verified'); assert.equal(row.writes,0);
      assert.ok(row.queries.length<=3); assert.ok(row.queries.some(query=>query.team===1001));
      assert.ok(row.queries.some(query=>query.nation===row.nation));
    }
    console.log('Puzzle minimum-quality Chrome passed: two screenshot-shaped native-valid mixed squads, club/nation lanes, three-page/50k bounds, concept revalidation and cached repeat; synthetic only, no EA writes.');
  } finally { await page.close(); }
}
