import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exercisePuzzleAffinity(context) {
  const page = await context.newPage();
  try {
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { default as replay } from './tests/fixtures/fc27-puzzle-chemistry-affinity-2026-10-26.json';
      export { createFc27PuzzleProcurementSession } from './src/fc27/puzzle-procurement-session.js';
      export { nationalMinimumFixture } from './tests/helpers/fc27-puzzle-national-minimum-fixture.js';
      export { evaluateFc27PuzzleSquad } from './src/fc27/puzzle-evaluator.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'PuzzleAffinitySmoke', target: 'chrome120' });
    await page.setContent('<!doctype html><title>Puzzle affinity offline replay</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const evidence = await page.evaluate(async () => {
      const { replay, createFc27PuzzleProcurementSession, evaluateFc27PuzzleSquad } = globalThis.PuzzleAffinitySmoke;
      const input = structuredClone(replay.input), values = new Map(), queries = [];
      input.evaluateSquad = squad => evaluateFc27PuzzleSquad({ squad, formation: input.challenge.formation,
        chemistry: input.chemistry, rating: input.chemistry.rating });
      const options = { now: () => input.now,
        get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
        set: async (key, value) => values.set(key, structuredClone(value)),
        createTransport: async () => ({ readCatalogPage: async query => {
          queries.push(query);
          const page = replay.pages.find(page => Object.keys(page.query).length === Object.keys(query).length
            && Object.keys(query).every(key => page.query[key] === query[key]));
          if (!page) throw Error('Unexpected offline query');
          return { status: 'observed', source: 'ea-defid', season: '27', observedAt: input.now, query, entries: page.entries };
        } }),
        loadPublicPrices: async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId =>
          [definitionId, { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futbin', 'futgg'].map(source =>
            [source, { schema: 2, source, definitionId, season: '27', platform: 'pc', price: 300,
              fetchedAt: input.now, sourceUpdatedAt: null, expiresAt: input.now + 300000, error: null }])) }])) }),
      };
      const run = () => createFc27PuzzleProcurementSession(options).plan(input, { optimizeMaterialValue: true, quoteCeiling: 300 });
      const first = await run(), second = await run();
      return { status: first.status, resumed: second.status, chemistry: first.plans?.[0]?.teamFacts.chemistry,
        nodes: first.diagnostics.nodes, queries, secondRequests: second.requests };
    });
    assert.equal(evidence.status, 'suggested');
    assert.equal(evidence.resumed, 'suggested');
    assert.ok(evidence.chemistry >= 16);
    assert.ok(evidence.nodes <= 50000);
    assert.equal(evidence.queries.length, 3);
    assert.deepEqual(evidence.queries[2], { start: 0, count: 20, level: 'gold', nation: 21 });
    assert.equal(evidence.secondRequests, 0);
    console.log('Puzzle chemistry-affinity offline replay passed: six native open positions, three pages, 50k budget, cached repeat; no EA access.');

    const national = await page.evaluate(async () => {
      const { nationalMinimumFixture, createFc27PuzzleProcurementSession } = globalThis.PuzzleAffinitySmoke;
      const f = nationalMinimumFixture(), { input } = f, memory = new Map(), queries = []; let writes = 0;
      const mutation = () => { writes++; throw Error('Unexpected offline mutation'); };
      const options = { now: () => input.now,
        get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
        set: async (key, value) => memory.set(key, structuredClone(value)),
        createTransport: async () => ({ readCatalogPage: async query => {
          queries.push(query); return { status: 'observed', source: 'ea-defid', season: '27', query, observedAt: input.now,
            entries: (query.level==='bronze' ? f.bronze : query.nation===1 ? f.target : f.silver)
              .filter(row => !query.nation || row.nationId===query.nation).slice(query.start,query.start+query.count) };
        }, buy: mutation, move: mutation, save: mutation, submit: mutation, readQuotePage: mutation }),
        loadPublicPrices: async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
          { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futbin','futgg'].map(source => [source,
            { schema: 2, source, definitionId, season: '27', platform: 'pc', price: 200, fetchedAt: input.now,
              expiresAt: input.now+300000, sourceUpdatedAt: null, error: null }])) }])) }) };
      const run = () => createFc27PuzzleProcurementSession(options).plan(input);
      const first = await run(), second = await run(), plan = first.plans?.[0];
      return { status: first.status, repeated: second.status, queries, writes, secondRequests: second.requests,
        chemistry: plan?.teamFacts.chemistry, count: plan?.purchases.length + plan?.selectedOwned.length, nodes: first.diagnostics.nodes };
    });
    assert.equal(national.status, 'suggested'); assert.equal(national.repeated, 'suggested');
    assert.equal(national.count, 11); assert.ok(national.chemistry >= 16); assert.ok(national.nodes <= 200000);
    assert.equal(national.queries.length, 3); assert.deepEqual(national.queries[2], { start: 0, count: 20, level: 'silver', nation: 1 });
    assert.equal(national.writes, 0); assert.equal(national.secondRequests, 0);
    console.log('Puzzle national-minimum Chrome passed: 5 same nation, 5 silver, league cap 3, 4+ leagues, 11 cards/16+ chemistry, three pages and cached repeat; synthetic, no EA access.');
  } finally { await page.close(); }
}
