import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exercisePuzzleCoverage(context) {
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { default as observed } from './tests/fixtures/fc27-puzzle-catalog-coverage.json';
      export { puzzleFillFixture } from './tests/helpers/fc27-puzzle-fill-fixture.js';
      export { createFc27PuzzleProcurementSession } from './src/fc27/puzzle-procurement-session.js';
      export { prepareFc27PuzzleConceptDraft } from './src/fc27/puzzle-concept-draft.js';
      export { evaluateFc27PuzzleSquad, boundFc27PuzzleChemistry } from './src/fc27/puzzle-evaluator.js';
      export { traditionalJournalScope } from './src/fc27/traditional-journal.js';
      export { createGalleryReferencePrices } from './src/gallery/reference-prices.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'PuzzleCoverageSmoke', target: 'chrome120' });
    await page.setContent('<!doctype html><title>Puzzle coverage offline regression</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const api = globalThis.PuzzleCoverageSmoke, data = api.observed, input = api.puzzleFillFixture(), now = input.now;
      input.challenge = { ...data.challenge, context: input.context };
      input.chemistry = structuredClone(data.chemistry); input.clubLinks = structuredClone(data.clubLinks);
      Object.assign(input.policy, { maxRating: 85, goldRange: [75, 90], lockedItemIds: [], activeSquadItemIds: [] });
      input.inventory.items = structuredClone(data.owned);
      input.evaluateSquad = squad => api.evaluateFc27PuzzleSquad({ squad, formation: input.challenge.formation,
        chemistry: input.chemistry, rating: input.chemistry.rating });
      input.boundSquad = squad => api.boundFc27PuzzleChemistry({ squad, formation: input.challenge.formation,
        chemistry: input.chemistry, rating: input.chemistry.rating });
      const scope = api.traditionalJournalScope(input.context), store = new Map(), prices = new Map(data.prices), queries = [];
      const get = async (key, fallback) => structuredClone(store.get(key) ?? fallback);
      const set = async (key, value) => store.set(key, structuredClone(value));
      for (const page of data.pages) {
        const at = now - page.ageHours * 3600000;
        store.set(`fcat-fc27-puzzle-market:${scope}:catalog:${JSON.stringify(page.query)}`, {
          schema: 1, kind: 'catalog', query: page.query, at, state: 'observed', result: { status: 'observed', source: 'ea-defid',
            season: '27', query: page.query, observedAt: at, entries: page.entries, pageEndObserved: page.pageEndObserved } });
      }
      for (const [definitionId, price] of prices) store.set(`fcat-public-quotes-v2:27:pc:futbin:${definitionId}:ps`, {
        schema: 2, source: 'futbin', season: '27', platform: 'pc', futbinPlatform: 'ps', definitionId, price,
        fetchedAt: now - 86400000, expiresAt: now - 86400000 + 300000, sourceUpdatedAt: null, error: null,
      });
      const service = api.createGalleryReferencePrices({ get, set, now: () => now,
        readFutbin: async definitionId => ({ definitionId, price: prices.get(definitionId) ?? null }) });
      const result = await api.createFc27PuzzleProcurementSession({ get, set, list: async () => [...store.keys()], now: () => now,
        loadCachedPrices: (ids, options) => service.cachedEstimates(ids, { ...options, platform: 'pc' }),
        loadPublicPrices: (ids, options) => service.load(ids, { ...options, platform: 'pc', sources: ['futbin'],
          policy: options.policy ?? { source: 'futbin', futbinPlatform: 'ps' } }),
        createTransport: async () => ({ readCatalogPage: async query => {
          queries.push(query);
          const page = data.pages.find(page => JSON.stringify(page.query) === JSON.stringify(query));
          if (!page) throw Error('Unexpected offline native query');
          return { status: 'observed', source: 'ea-defid', season: '27', query, observedAt: now,
            entries: page.entries, pageEndObserved: page.pageEndObserved };
        } }),
      }).plan(input, { optimizeMaterialValue: true });
      const plan = result.plans?.[0];
      return { status: result.status, reason: result.reason, value: plan?.materialValue, chemistry: plan?.teamFacts.chemistry,
        draft: plan ? api.prepareFc27PuzzleConceptDraft(input, plan).status : null, queries: queries.length,
        nodes: result.diagnostics.nodes, hintNodes: result.diagnostics.hintNodes, globalMinimumProven: result.globalMinimumProven };
    });
    assert.equal(result.status, 'suggested', JSON.stringify(result));
    assert.ok(result.value <= 6000 && result.chemistry >= 20);
    assert.equal(result.draft, 'prepared'); assert.equal(result.queries, 2);
    assert.ok(result.nodes <= 70000 && result.hintNodes <= 24000); assert.equal(result.globalMinimumProven, false);
    console.log(`Puzzle catalogue coverage Chrome passed: frozen public-fact subset -> ${result.value}, chemistry ${result.chemistry}, 2 fresh-shaped reads, native concept validation; not live prices or exact full account replay.`);
  } finally { await page.close(); }
}
