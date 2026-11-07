import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function exercisePuzzleCostCheckpoint(context) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
    export { puzzleFillFixture } from './tests/helpers/fc27-puzzle-fill-fixture.js';
    export { previewFc27PuzzleSquad } from './src/fc27/puzzle-preview.js';
    export { createFc27PuzzleProcurementSession } from './src/fc27/puzzle-procurement-session.js';
    export { formatFc27PuzzleNativeResult } from './src/adapters/browser/fc27-puzzle-native-button.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'CostCheckpoint', target: 'chrome120' });
  const page = await context.newPage(); let requests = 0;
  await page.route('**/*', route => { requests++; return route.abort(); });
  try {
    await page.setContent('<!doctype html><title>Puzzle cost checkpoint offline</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const evidence = await page.evaluate(async () => {
      const api = globalThis.CostCheckpoint, results = [];
      for (const mode of ['deadline', 'expiry', 'increased', 'missing', 'cancel']) {
        const input = api.puzzleFillFixture(), baseline = api.previewFc27PuzzleSquad(input);
        input.inventory.items.push({ ...input.inventory.items[0], id: 9001, definitionId: 9001 });
        const before = JSON.stringify(input), cache = new Map(); let at = input.now, reads = 0, cancelled = false;
        const priceBatches = [];
        const session = api.createFc27PuzzleProcurementSession({ now: () => at,
          get: async (key, fallback) => cache.get(key) ?? fallback,
          set: async (key, value) => { cache.set(key, structuredClone(value)); },
          createTransport: async () => ({ readCatalogPage: async query => {
            reads++; at += mode === 'deadline' ? 30001 : 300001;
            if (mode === 'cancel') cancelled = true;
            return { status: 'observed', season: '27', source: 'ea-defid', query, observedAt: at, entries: [] };
          } }),
          loadPublicPrices: async ids => {
            priceBatches.push(ids.length);
            return { policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(definitionId => [definitionId, {
              definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, {
                schema: 2, source, definitionId, season: '27', platform: 'pc',
                price: source === 'futbin' ? null : definitionId !== 9001 ? 1000 : priceBatches.length > 1 && mode === 'increased' ? 2000
                  : priceBatches.length > 1 && mode === 'missing' ? null : 200,
                fetchedAt: at, expiresAt: at + 300000, sourceUpdatedAt: null, error: null,
              }])),
            }])) };
          },
        });
        const result = await session.plan(input, { optimizeMaterialValue: true, ownedIncumbent: baseline,
          assertCurrent: () => { if (cancelled) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); } });
        results.push({ mode, status: result.status, reason: result.reason, cost: result.plans[0]?.materialValue,
          count: result.plans[0]?.purchaseCount, diagnostics: result.diagnostics, reads, priceBatches, unchanged: before === JSON.stringify(input),
          fresh: result.valueExpiresAt > at && result.ownedBaseline?.valueExpiresAt > at,
          message: api.formatFc27PuzzleNativeResult({ status: 'filled', saved: true,
            materialValue: result.plans[0]?.materialValue, procurementSummary: result }) });
      }
      return results;
    });
    for (const result of evidence) {
      assert.equal(result.unchanged, true); assert.equal(result.reads, 1);
      if (['missing', 'cancel'].includes(result.mode)) assert.equal(result.status, 'blocked');
      else {
        assert.equal(result.status, 'suggested'); assert.equal(result.count, 0); assert.equal(result.fresh, true, JSON.stringify(result));
        assert.equal(result.cost, result.mode === 'increased' ? 11000 : 10200);
        assert.match(result.message, /尚未确认最低材料成本/);
      }
      assert.deepEqual(result.priceBatches, ['deadline', 'cancel'].includes(result.mode) ? [12] : [12, 12]);
    }
    assert.equal(requests, 0);
    console.log('Puzzle cost checkpoint Chrome passed: owned 11000->10200 retained across optional deadline/expiry, targeted 12-card renewal, price reversal/missing/cancel; synthetic, no EA access.');
  } finally { await page.close(); }
}
