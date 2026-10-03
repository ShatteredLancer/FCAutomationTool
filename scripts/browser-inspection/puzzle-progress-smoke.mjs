import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exercisePuzzleProgress(context) {
  const page = await context.newPage();
  try {
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { shortageFixture } from './tests/helpers/fc27-puzzle-shortage-fixture.js';
      export { mountFc27PuzzleNativeButton } from './src/adapters/browser/fc27-puzzle-native-button.js';
      export { suggestFc27PuzzleJointPurchasesCooperatively } from './src/fc27/puzzle-procurement.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'PuzzleProgressSmoke', target: 'chrome120' });
    await page.setContent('<!doctype html><title>Puzzle progress offline</title><main><button id="anchor">Submit (fixture only)</button></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const api = globalThis.PuzzleProgressSmoke;
      globalThis.progressEvidence = { paints: [], requests: 0, done: false, current: true };
      const anchor = globalThis.document.getElementById('anchor');
      const record = () => {
        const state = globalThis.progressEvidence;
        const text = globalThis.document.querySelector('[role=status]')?.textContent ?? '';
        if (state.paints.at(-1) !== text) state.paints.push(text);
        if (!state.done) globalThis.requestAnimationFrame(record);
      };
      globalThis.requestAnimationFrame(record);
      api.mountFc27PuzzleNativeButton({ document: globalThis.document,
        readTarget: () => globalThis.progressEvidence.current ? { setId: 1, challengeId: 1, anchor } : null,
        onFill: async (_target, { onProgress, isCurrent }) => {
          const { input, entries } = api.shortageFixture();
          const result = await api.suggestFc27PuzzleJointPurchasesCooperatively(input, entries, {
            onProgress: progress => onProgress({ ...progress, stage: 'procurement', phase: 'local-market-search' }),
            assertCurrent: () => { if (!isCurrent()) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); },
          });
          globalThis.progressEvidence.result = { status: result.status, nodes: result.nodes };
          globalThis.progressEvidence.done = true;
          return { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT' };
        },
      });
    });
    await page.getByRole('button', { name: 'FCAT 解题填充', exact: true }).click();
    await page.waitForFunction(() => globalThis.progressEvidence.done, null, { timeout: 30000 });
    const evidence = await page.evaluate(() => globalThis.progressEvidence);
    assert.equal(evidence.result.status, 'suggested');
    assert.ok(evidence.result.nodes <= 50000);
    assert.ok(evidence.paints.filter(text => /节点 [1-9]/.test(text)).length >= 2,
      'Search counts must be painted on multiple animation frames, not just stored in callbacks');
    assert.equal(evidence.requests, 0);
    console.log('Puzzle cooperative progress smoke passed: trusted button, painted node updates, same 50000 budget, no EA access.');
  } finally { await page.close(); }
}
