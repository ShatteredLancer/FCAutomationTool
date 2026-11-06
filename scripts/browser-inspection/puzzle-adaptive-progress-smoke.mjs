import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function exercisePuzzleAdaptiveProgress(context) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
    export { puzzleBudgetFixture } from './tests/helpers/fc27-puzzle-budget-fixture.js';
    export { mountFc27PuzzleNativeButton } from './src/adapters/browser/fc27-puzzle-native-button.js';
    export { createFc27PuzzleSearchBudget } from './src/fc27/puzzle-preview.js';
    export { suggestFc27PuzzleJointPurchasesCooperatively } from './src/fc27/puzzle-procurement.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'BudgetFixture', target: 'chrome120' });
  const page = await context.newPage();
  let requests = 0;
  await page.route('**/*', route => { requests++; return route.abort(); });
  try {
    await page.setContent('<!doctype html><style>.btn-standard{display:block}</style><title>Offline budget control</title><button id="anchor">Fixture submit anchor</button>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const api = globalThis.BudgetFixture, anchor = globalThis.document.getElementById('anchor');
      const state = globalThis.budgetEvidence = { stages: [], nodes: 0, done: false, saves: 0, frames: 0, ticks: 0 };
      const paint = () => { state.frames++; if (!state.done) globalThis.requestAnimationFrame(paint); };
      globalThis.requestAnimationFrame(paint);
      state.timer = setInterval(() => { state.ticks++; }, 10);
      api.mountFc27PuzzleNativeButton({ document: globalThis.document, readTarget: () => ({ setId: 1, challengeId: 1, anchor }),
        onFill: async (_target, { onProgress, isCurrent }) => {
          const { input, entries } = api.puzzleBudgetFixture(), budget = api.createFc27PuzzleSearchBudget();
          try {
            await api.suggestFc27PuzzleJointPurchasesCooperatively(input, entries, { maxNodes: 200000, searchBudget: budget,
              assertCurrent: () => { if (!isCurrent()) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); },
              onProgress: value => {
                const snapshot = budget.snapshot(); state.nodes = snapshot.budgetNodes;
                if (!state.stages.includes(snapshot.budgetStage)) state.stages.push(snapshot.budgetStage);
                onProgress({ ...value, ...snapshot, nodes: snapshot.budgetNodes, stage: 'procurement' });
              },
            });
            if (!isCurrent()) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED');
            state.saves++;
          } catch (error) { state.reason = error.message; }
          finally { state.nodes = budget.snapshot().budgetNodes; state.done = true; clearInterval(state.timer); }
          return { status: 'blocked', reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED' };
        },
      });
    });
    await page.getByRole('button', { name: 'FCAT 解题填充', exact: true }).click();
    await page.waitForFunction(() => globalThis.budgetEvidence.nodes > 100000, null, { timeout: 30000 });
    await page.getByRole('button', { name: '取消计算', exact: true }).click({ timeout: 3000 });
    await page.waitForFunction(() => globalThis.budgetEvidence.done);
    await page.waitForFunction(() => globalThis.document.getElementById('fcat-fc27-puzzle-status')?.textContent.includes('已取消计算'));
    const evidence = await page.evaluate(() => globalThis.budgetEvidence);
    assert.deepEqual(evidence.stages, [1, 2, 3]);
    assert.equal(evidence.saves, 0); assert.equal(evidence.reason, 'FC27_PUZZLE_FILL_TARGET_CHANGED');
    assert.ok(evidence.nodes > 100000 && evidence.nodes < 200000);
    assert.ok(evidence.frames > 2 && evidence.ticks > 2);
    assert.equal(await page.getByRole('button', { name: 'FCAT 解题填充', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: '取消计算', exact: true }).count(), 0);
    assert.equal(requests, 0);

    // A second isolated run tests the irreversible read/validation boundary.
    await page.setContent('<!doctype html><style>.btn-standard{display:block}</style><button id="anchor">Fixture submit anchor</button>');
    await page.evaluate(() => {
      const state = globalThis.boundaryEvidence = { current: null, done: false };
      const anchor = globalThis.document.getElementById('anchor');
      globalThis.BudgetFixture.mountFc27PuzzleNativeButton({ document: globalThis.document, readTarget: () => ({ setId: 2, challengeId: 2, anchor }),
        onFill: async (_target, { onProgress, isCurrent }) => {
          onProgress('validating'); onProgress('planning');
          await new Promise(resolve => { globalThis.finishBoundary = resolve; });
          state.current = isCurrent(); state.done = true;
          return { status: 'blocked', reason: 'FC27_PUZZLE_NO_PLAN_FOUND' };
        },
      });
    });
    await page.getByRole('button', { name: 'FCAT 解题填充', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '取消计算', exact: true }).count(), 0);
    assert.equal(await page.locator('#fcat-fc27-puzzle-cancel').isVisible(), false);
    assert.equal(await page.locator('#fcat-fc27-puzzle-cancel').isEnabled(), false);
    await page.evaluate(() => globalThis.finishBoundary());
    await page.waitForFunction(() => globalThis.boundaryEvidence.done);
    assert.equal(await page.evaluate(() => globalThis.boundaryEvidence.current), true);
    await page.setContent('<!doctype html><style>.btn-standard{display:block}</style><button id="anchor">Fixture submit anchor</button>');
    await page.evaluate(() => {
      const anchor = globalThis.document.getElementById('anchor');
      const state = globalThis.cleanupEvidence = { challengeId: 3, done: false, current: null, saves: 0 };
      globalThis.disposeBudgetButton = globalThis.BudgetFixture.mountFc27PuzzleNativeButton({ document: globalThis.document,
        readTarget: () => ({ setId: 3, challengeId: state.challengeId, anchor }),
        schedule: update => { globalThis.refreshBudgetButton = update; return 1; }, unschedule: () => {},
        onFill: async (_target, { isCurrent }) => {
          await new Promise(resolve => { globalThis.finishCleanup = resolve; });
          state.current = isCurrent();
          if (state.current) state.saves++;
          state.done = true;
          return { status: 'blocked', reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED' };
        },
      });
    });
    await page.getByRole('button', { name: 'FCAT 解题填充', exact: true }).click();
    await page.evaluate(() => { globalThis.cleanupEvidence.challengeId = 4; globalThis.refreshBudgetButton(); });
    assert.equal(await page.getByRole('button', { name: '取消计算', exact: true }).count(), 0);
    // Returning to the old target must not revive the cancelled/stale run.
    await page.evaluate(() => {
      globalThis.cleanupEvidence.challengeId = 3; globalThis.refreshBudgetButton();
      globalThis.disposeBudgetButton(); globalThis.finishCleanup();
    });
    await page.waitForFunction(() => globalThis.cleanupEvidence.done);
    assert.deepEqual(await page.evaluate(() => ({ current: globalThis.cleanupEvidence.current, saves: globalThis.cleanupEvidence.saves })),
      { current: false, saves: 0 });
    assert.equal(await page.locator('#fcat-fc27-puzzle-cancel').count(), 0);
    assert.equal(await page.locator('#fcat-fc27-puzzle-native').count(), 0);
    console.log(`Puzzle adaptive browser passed: cancelled at ${evidence.nodes} nodes after stage 100k; ${evidence.frames} frames, ${evidence.ticks} timer ticks; zero saves/requests; validation sealed.`);
  } finally { await page.close(); }
}
