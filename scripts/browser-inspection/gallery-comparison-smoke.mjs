import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { mergeGalleryAccountProgress } from '../../src/gallery/progress.js';
import { futggGallery, futggGalleryPool } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryComparison(context) {
  const bundle = await build({ entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'ComparisonSmoke' });
  const catalog = normalizeGalleryCatalog('futgg', futggGallery());
  const progress = mergeGalleryAccountProgress(normalizeGalleryPool('futgg', futggGalleryPool(), 30), {
    conceptItems: [{ definitionId: 900001, isCollected: true, gradingScore: 100 },
      { definitionId: 900002, isCollected: false }, { definitionId: 900003, isCollected: false }],
  });
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><body></body>');
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ catalog, progress }) => {
      globalThis.compareCalls = 0; globalThis.comparisonScope = 'one';
      const state = { status: 'observed', source: 'futgg', catalog };
      globalThis.comparisonPanel = globalThis.ComparisonSmoke.mountFc27AcceptancePanel({
        document: globalThis.document, hostId: 'comparison-test', targets: () => [],
        galleryAccountScope: () => globalThis.comparisonScope,
        galleryCatalog: { peek: async () => state, load: async () => state, refresh: async () => state },
        gallerySetLoader: async () => ({ status: 'observed', scope: globalThis.comparisonScope,
          progress: structuredClone(progress) }),
        galleryMarketCompare: id => {
          globalThis.compareCalls++;
          return new Promise(resolve => { globalThis.finishComparison = failure => resolve(failure
            ? { status: 'blocked', reason: 'FC27_MARKET_HTTP_429' }
            : { status: 'observed', definitionId: id, price: 250, listings: [{ buyNow: 250, expires: 60 }] }); });
        },
      });
      globalThis.comparisonPanel.open();
    }, { catalog, progress });
    const host = page.locator('#comparison-test');
    const openSet = async () => {
      await host.locator('#tab-gallery').click();
      await host.locator('#gallery-categories button').first().click();
      await host.locator('.gallery-open-set').first().click();
      await host.locator('.gallery-card[data-definition-id="900002"]').waitFor({ state: 'visible' });
    };
    const card = host.locator('.gallery-card[data-definition-id="900002"]');
    const compare = card.locator('.gallery-card-compare');
    const output = card.locator('.gallery-market-comparison');
    const refresh = async () => {
      await host.locator('#gallery-refresh').click();
      await page.waitForFunction(() => !globalThis.document.getElementById('comparison-test').shadowRoot.getElementById('gallery-refresh').disabled);
    };
    await openSet();
    await compare.click();
    await refresh();
    assert.equal(await compare.isDisabled(), true, 'rerender preserves pending comparison');
    assert.match(await output.innerText(), /读取 EA/);
    assert.equal(await page.evaluate(() => globalThis.compareCalls), 1);
    await page.evaluate(() => globalThis.finishComparison(false));
    await output.filter({ hasText: 'EA 250' }).waitFor();
    assert.equal(await compare.isDisabled(), false);
    await refresh();
    assert.match(await output.innerText(), /EA 250/,'completed comparison survives refresh');
    await host.locator('#gallery-back').click();
    await host.locator('.gallery-open-set').first().click();
    await output.filter({ hasText: 'EA 250' }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.compareCalls), 1, 'reentry makes no market request');
    await compare.click();
    await refresh();
    await page.evaluate(() => globalThis.finishComparison(true));
    await output.filter({ hasText: 'FC27_MARKET_HTTP_429' }).waitFor();
    await refresh();
    assert.match(await output.innerText(), /FC27_MARKET_HTTP_429/);
    await compare.click();
    await host.locator('#tab-settings').click();
    await page.evaluate(() => { globalThis.comparisonScope = 'two'; globalThis.finishComparison(false); });
    await openSet();
    assert.equal(await output.innerText(), '', 'old account reply cannot appear in new account');
    assert.equal(await compare.isDisabled(), false);
    assert.equal(await page.evaluate(() => globalThis.compareCalls), 3);
    console.log('Offline Gallery comparison passed: pending/completed/error redraw, return, exact version and account isolation.');
  } finally { await page.close(); }
}
