import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function exercisePuzzleGroupCapacity(context) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
    export { puzzleGroupCapacityFixture } from './tests/helpers/fc27-puzzle-group-capacity-fixture.js';
    export { previewFc27PuzzleSquadCooperatively } from './src/fc27/puzzle-preview.js';
    export { suggestFc27PuzzleJointPurchasesCooperatively } from './src/fc27/puzzle-procurement.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'GroupCapacityFixture', target: 'chrome120' });
  const page = await context.newPage();
  let requests = 0;
  await page.route('**/*', route => { requests++; return route.abort(); });
  try {
    await page.setContent('<!doctype html><title>Offline group capacity control</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const evidence = await page.evaluate(async () => {
      const api = globalThis.GroupCapacityFixture, { input, known } = api.puzzleGroupCapacityFixture();
      const before = JSON.stringify(input.inventory), started = performance.now();
      const owned = await api.previewFc27PuzzleSquadCooperatively({ ...input, maxNodes: 50000 });
      const elapsedMs = performance.now() - started;
      const unchanged = JSON.stringify(input.inventory) === before;
      const missing = new Set(known.filter(item => item.teamId === 70).map(item => item.definitionId));
      input.inventory.items = input.inventory.items.filter(item => !missing.has(item.definitionId));
      const entries = known.filter(item => missing.has(item.definitionId)).map(({ definitionId, rating, nationId, teamId, leagueId, positions, rarity }) =>
        ({ definitionId, rating, nationId, teamId, leagueId, positions, rarity, special: false, cosmetic: false, evolution: false, groups: [] }));
      let ticks = 0;
      const timer = setInterval(() => { ticks++; }, 10), mixedStarted = performance.now();
      try {
        const mixed = await api.suggestFc27PuzzleJointPurchasesCooperatively(input, entries, { maxNodes: 50000,
          prices: new Map(entries.map(item => [item.definitionId, 200])), priceSource: 'futbin' });
        return { owned: { status: owned.status, nodes: owned.nodes, facts: owned.teamFacts, elapsedMs }, unchanged,
          mixed: { status: mixed.status, nodes: mixed.nodes, price: mixed.estimatedCost,
            facts: mixed.plans?.[0]?.teamFacts, elapsedMs: performance.now() - mixedStarted, executable: mixed.executable }, ticks };
      } finally { clearInterval(timer); }
    });
    assert.equal(evidence.owned.status, 'preview'); assert.ok(evidence.owned.nodes <= 50000);
    assert.ok(evidence.owned.facts.chemistry >= 26); assert.ok(evidence.owned.facts.teamRating >= 75);
    assert.equal(evidence.mixed.status, 'suggested'); assert.ok(evidence.mixed.nodes <= 50000);
    assert.ok(evidence.mixed.price <= 800); assert.ok(evidence.mixed.facts.chemistry >= 26);
    assert.ok(evidence.mixed.facts.teamRating >= 75); assert.equal(evidence.mixed.executable, false);
    assert.equal(evidence.unchanged, true); assert.ok(evidence.ticks > 0); assert.equal(requests, 0);
    console.log(`Puzzle group capacity Chrome passed: ${JSON.stringify(evidence)}; synthetic 291-card pool, no EA access.`);
  } finally { await page.close(); }
}
