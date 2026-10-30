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
      export { suggestFc27PuzzleJointPurchases } from './src/fc27/puzzle-procurement.js';
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
    const cost = await page.evaluate(() => {
      const api = globalThis.MinimumQualitySmoke, { input, entries } = api.minimumQualityFixture(1);
      input.challenge.rawRequirements = input.challenge.rawRequirements.filter(rule => rule.pairs[0].key === 3);
      entries[0].rating = 60;
      const extra = { ...entries[1], definitionId: 6000, rating: 80 };
      const prices = new Map([...entries.map((row, i) => [row.definitionId, i ? 500 : 200]), [6000, 150]]);
      const result = api.suggestFc27PuzzleJointPurchases(input, [...entries, extra], { prices });
      const plan = result.plans[0], draft = api.prepareFc27PuzzleConceptDraft(input, { ...plan,
        purchases: plan.purchases.map(card => ({ ...card, estimatedUnitPrice: prices.get(card.definitionId) })) });
      return { status: result.status, nodes: result.nodes, price: plan.purchases.reduce((sum, card) => sum + prices.get(card.definitionId), 0),
        cheaperMix: plan.purchases.some(card => card.definitionId === 6000), draft: draft.status };
    });
    assert.equal(cost.status, 'suggested'); assert.equal(cost.price, 4850); assert.equal(cost.cheaperMix, true);
    assert.equal(cost.draft, 'prepared'); assert.ok(cost.nodes <= 50000);
    const mixedRoute = await page.evaluate(async () => {
      const api = globalThis.MinimumQualitySmoke, { input } = api.minimumQualityFixture(1), store = new Map(), queries = [];
      const row = (key, value, count = -1) => ({ count, scope: 0, pairs: [{ key, values: [value] }] });
      const club = row(12, 9, 2); club.pairs[0].values = [9, 1]; input.inventory.items = []; input.policy.maxRating = 82;
      input.challenge.id = 121; input.challenge.rawRequirements = [club, row(11, 13, 2), row(5, 4), row(6, 3), row(19, 75), row(35, 26)];
      const entries = Array.from({ length: 17 }, (_, i) => ({ definitionId: 9000 + i, rating: i < 11 ? 80 : 64,
        rarity: 0, nationId: 1, leagueId: 13, teamId: i < 11 ? 9 : 500, positions: [5], groups: [], special: false, evolution: false, cosmetic: false }));
      const result = await api.createFc27PuzzleProcurementSession({ now: () => input.now,
        get: async (key, fallback) => structuredClone(store.get(key) ?? fallback), set: async (key, value) => store.set(key, structuredClone(value)),
        createTransport: async () => ({ readCatalogPage: async query => { queries.push(query); return { status: 'observed', season: '27', source: 'ea-defid',
          query, observedAt: input.now, entries: entries.filter(card => query.level === (card.rating < 65 ? 'bronze' : 'gold')
            && (!query.team || card.teamId === query.team) && (!query.league || card.leagueId === query.league)
            && (!query.nation || card.nationId === query.nation)).slice(query.start, query.start + query.count) }; },
          buy: () => { throw Error('No writes in fixture'); } }),
        loadPublicPrices: async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
          { definitionId, season: '27', platform: input.context.platform, quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
            { schema: 2, source, definitionId, season: '27', platform: input.context.platform, price: definitionId < 9011 ? 800 : 200,
              fetchedAt: input.now, sourceUpdatedAt: null, expiresAt: input.now + 300000, error: null }])) }])) }),
      }).plan(input, { optimizeMaterialValue: true });
      return { status: result.status, cost: result.plans[0]?.estimatedCost, initial: result.diagnostics.initialEstimatedCost,
        bronze: result.plans[0]?.purchases.filter(card => card.rating < 65).length,
        facts: result.plans[0]?.teamFacts, nodes: result.diagnostics.nodes, queries };
    });
    assert.equal(mixedRoute.status, 'suggested'); assert.equal(mixedRoute.initial, 8800); assert.equal(mixedRoute.cost, 5200);
    assert.equal(mixedRoute.bronze, 6); assert.ok(mixedRoute.facts.teamRating >= 75 && mixedRoute.facts.chemistry >= 26);
    assert.ok(mixedRoute.nodes <= 50000 && mixedRoute.queries.length <= 3);
    assert.ok(mixedRoute.queries.some(query => query.level === 'bronze' && query.league === 13));
    console.log('Puzzle minimum-quality Chrome passed: two screenshot-shaped native-valid mixed squads, club/nation lanes, three-page/50k bounds, concept revalidation and cached repeat; synthetic only, no EA writes.');
    console.log('Puzzle monetary quality comparison Chrome passed: feasible 5200 low-tier incumbent improves to 4850 within the same node ceiling; no live price claim.');
    console.log('Puzzle rating-75 route Chrome passed: gold-only 8800 incumbent improves to 5200 via 5 gold/6 bronze, native full rating/chemistry, same three-page/50k budget; synthetic, no EA access.');
  } finally { await page.close(); }
}
