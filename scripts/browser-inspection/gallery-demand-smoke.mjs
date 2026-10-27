import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

export async function exerciseGalleryDemand(context, directory) {
  const observed = JSON.parse(await readFile(new URL('../../tests/fixtures/gallery-demand-pricing-2026-10-27.json', import.meta.url), 'utf8'));
  assert.ok(observed.timing.pricingMs > 80 * 60000 && observed.collections === 196);
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/adapters/browser/fc27-gallery-roadmap.js'], bundle: true, write: false,
    format: 'iife', globalName: 'DemandFixture', target: 'chrome120' });
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><button id="open">Open</button>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      globalThis.demandKnobs = { scope: 'fixture', hold: false, material: 'stable', offset: 0, deadlineOnce: false };
      const realNow = performance.now.bind(performance); performance.now = () => realNow() + globalThis.demandKnobs.offset;
      const set = { id: 'futgg:1', categoryId: 'cat', name: 'Demand fixture', slug: 'demand', requiredCards: 1,
        grades: ['D','C','B','A','S'].map((name, i) => ({ name, threshold: 10 * (i + 1),
          rewards: [{ type: 'event_token_1', count: 1, value: [0,0,5,8,15][i] }] })) };
      const catalog = { source: 'futgg', revision: 'fixture', categories: [{ id: 'cat', sets: [set] }],
        tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
          rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 1 }] }] };
      const target = { set, catalog, status: 'observed', progressKey: 'stable',
        progress: { season: '27', setId: 1, complete: true, poolComplete: true,
          rows: Array.from({ length: 300 }, (_, i) => ({ eaId: i + 1, playerEaId: i + 1,
            gradingScore: 100, galleryScore: 100, collected: false, firstOwned: false, overall: 80, rarityEaId: 1 })) } };
      globalThis.demandCalls = []; globalThis.demandEvents = []; globalThis.demandSync = 0;
      globalThis.DemandFixture.mountGalleryRoadmap({ document: globalThis.document, parent: globalThis.document.body,
        button: globalThis.document.querySelector('#open'), read: () => { target.progressKey = globalThis.demandKnobs.material;
          return { active: true, scope: globalThis.demandKnobs.scope, catalog, targets: [target] }; },
        prepare: async () => { globalThis.demandSync++; }, readTimeout: async () => 1000,
        onDiagnostic: row => globalThis.demandEvents.push(row), openSet: (...args) => { globalThis.demandHandoff = args; },
        referenceService: { load: async () => ({ source: 'fodder', basis: 'empty-collection-public-reference', platform: 'console',
          fetchedAt: Date.now(), expiresAt: Date.now() + 300000,
          sets: [{ set, grades: set.grades.map(grade => ({ grade: grade.name, cost: 1000, ids: [1], prices: [1000] })) }] }) },
        loadPrices: async (ids, options) => {
          globalThis.demandCalls.push({ ids, deadline: options.deadlineAt,
            previewVisible: globalThis.document.querySelector('.gallery-roadmap-preview')?.textContent.includes('28') === true });
          if (globalThis.demandKnobs.hold) await new Promise(resolve => { globalThis.releaseDemand = resolve; });
          if (globalThis.demandKnobs.deadlineOnce) { globalThis.demandKnobs.deadlineOnce = false; globalThis.demandKnobs.offset += 2000; }
          options.onProgress?.({ source: 'fixture', index: ids.length, total: ids.length });
          return { source: 'public-references', policy: { source: 'futbin' }, expiresAt: Date.now() + 300000,
            prices: Object.fromEntries(ids.map(id => [id, 500])), freshPrices: Object.fromEntries(ids.map(id => [id, 500])), references: {} };
        },
      });
    });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: '生成整体方案', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
    const calls = await page.evaluate(() => globalThis.demandCalls);
    assert.ok(calls.length > 0);
    assert.equal(calls[0].previewVisible, true, 'Publish the locally verified reference overview BEFORE the first independent quote');
    assert.ok(calls.every(call => call.ids.length <= 24 && Number.isSafeInteger(call.deadline)), 'Demand quotes must be small and time bounded, not catalog-wide');
    assert.ok(new Set(calls.flatMap(call => call.ids)).size <= 96, 'Explicit bounded coverage, never silently query 300 candidates');
    assert.ok((await page.locator('.gallery-roadmap-dialog').innerText()).includes('按需深度'));
    await page.screenshot({ path: path.join(directory, 'gallery-demand-desktop.png') });
    await page.setViewportSize({ width: 420, height: 800 });
    assert.ok(await page.locator('.gallery-roadmap-dialog').evaluate(node => node.getBoundingClientRect().width <= 420));
    await page.screenshot({ path: path.join(directory, 'gallery-demand-mobile.png') });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => { globalThis.demandCalls = []; globalThis.demandKnobs.deadlineOnce = true; });
    await page.getByRole('button', { name: '重新生成整体方案', exact: true }).click();
    await page.getByRole('button', { name: '继续分析剩余', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.demandCalls.length), 1);
    const syncBefore = await page.evaluate(() => globalThis.demandSync);
    await page.getByRole('button', { name: '继续分析剩余', exact: true }).click();
    await page.getByRole('button', { name: '重新生成整体方案', exact: true }).waitFor();
    const resumed = await page.evaluate(() => ({ calls: globalThis.demandCalls, sync: globalThis.demandSync }));
    assert.equal(resumed.sync, syncBefore, 'Same-page continuation must not synchronize again');
    assert.equal(resumed.calls.flatMap(call => call.ids).length, new Set(resumed.calls.flatMap(call => call.ids)).size,
      'Confirmed still-fresh versions must not be requested again on continuation');
    for (const change of ['stop', 'scope', 'material']) {
      await page.evaluate(() => { globalThis.demandKnobs.hold = true; globalThis.releaseDemand = null; });
      await page.getByRole('button', { name: '重新生成整体方案', exact: true }).click();
      await page.waitForFunction(() => typeof globalThis.releaseDemand === 'function');
      if (change === 'stop') await page.getByRole('button', { name: '停止分析', exact: true }).click();
      await page.evaluate(change => {
        if (change === 'scope') globalThis.demandKnobs.scope = 'different';
        if (change === 'material') globalThis.demandKnobs.material = 'changed';
        globalThis.demandKnobs.hold = false; globalThis.releaseDemand();
      }, change);
      await page.waitForFunction(() => !globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
      assert.equal(await page.locator('.gallery-roadmap-dialog > div[aria-live=polite]').getByRole('button', { name: '进入俱乐部 / 合集', exact: true }).count(), 0);
      if (change !== 'stop') assert.equal(await page.locator('.gallery-roadmap-preview').getByRole('button', { name: '进入俱乐部 / 合集', includeHidden: true }).count(), 0);
      await page.evaluate(() => { globalThis.demandKnobs.scope = 'fixture'; globalThis.demandKnobs.material = 'stable'; });
      // Restore a completed analysis before the next independent scenario.
      await page.getByRole('button', { name: change === 'stop' ? '继续分析剩余' : '生成整体方案', exact: true }).click();
      await page.getByRole('button', { name: '重新生成整体方案', exact: true }).waitFor();
    }
    console.log('Gallery demand Chrome passed: overview before quotes, 24/48/96 scoped reads, quote-inclusive deadline, no-repeat continuation, Stop/account/material isolation, desktop/mobile; no EA access.');
  } finally { await page.close(); }
}
