import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { exerciseGalleryBulkList } from './gallery-bulk-list-smoke.mjs';
import { exercisePublicPriceSettings } from './public-price-settings-smoke.mjs';
import { exerciseGalleryRelistControls } from './gallery-relist-controls-smoke.mjs';
import { readProductionGallery } from './agent-session.mjs';
import { clickPanelControl, panelCall, selectPanelTab } from './production-panel-inspection.mjs';
import { diffGalleryCatalog, normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { mergeGalleryAccountProgress } from '../../src/gallery/progress.js';
import { futggGallery, futggGalleryPool } from '../../tests/fixtures/fc27-gallery.js';

// Use the real closed shadow root and native scrolling host. The earlier
// Gallery smoke only exercised open-shadow Playwright locators in a modal.
export async function exerciseGalleryInspection(context) {
  await exercisePublicPriceSettings(context);
  await exerciseGalleryRelistControls(context, path.resolve(import.meta.dirname, '../..'));
  await exerciseGalleryBulkList(context);
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'GallerySmoke', target: 'chrome120' });
  const normalized = normalizeGalleryCatalog('futgg', futggGallery());
  const template = normalized.categories[0].sets[0];
  const catalog = Object.freeze({ ...normalized, categories: [Object.freeze({ ...normalized.categories[0],
    id: 'futgg:other', name: 'Other category', sets: [Object.freeze({ ...template, id: 'futgg:999', name: 'Other set' })] }),
    ...normalized.categories.map((category, categoryIndex) =>
    Object.freeze({ ...category, sets: categoryIndex === 0 ? Array.from({ length: 127 }, (_, index) => Object.freeze({ ...template,
      id: `futgg:${index + 1}`, name: index === 29 ? 'Arsenal' : `Fixture set ${index + 1}` })) : category.sets }))] });
  const progress = mergeGalleryAccountProgress(normalizeGalleryPool('futgg', futggGalleryPool(), 30), {
    conceptItems: [{ definitionId: 900001, isCollected: true, gradingScore: 100 }, { definitionId: 900002, isCollected: false }],
  });
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(`<!doctype html><style>
      body{margin:0}header{height:100px}#native{position:absolute;top:100px;left:90px;right:0;bottom:0;overflow:auto}
    </style><header>Native header fixture</header><main id="native"></main>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ catalog, progress }) => {
      globalThis.gallerySetCalls = 0;
      globalThis.gallerySetArgs = [];
      globalThis.galleryListingOpens = 0;
      const state = { status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() };
      globalThis.galleryPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({
        document: globalThis.document, hostId: 'fcat-fc27-production', targets: () => [],
        galleryAccountScope: () => 'fixture',
        galleryCatalog: { peek: async () => state, load: async () => state },
        gallerySetLoader: async args => { globalThis.gallerySetCalls++; globalThis.gallerySetArgs.push(args); return { status: 'observed', scope: 'fixture', progress }; },
        galleryListing: {
          prepare: async () => { globalThis.galleryListingOpens++; return { status: 'ready', candidates: [], prices: {}, liveEnabled: false }; },
          plan: () => ({ status: 'observed', entries: [], skipped: [] }),
          execute: async () => ({ status: 'completed', entries: [] }), inspect: async () => ({ status: 'absent' }),
          dispose() {}, stop() {},
        },
      });
      globalThis.galleryPanel.open(globalThis.document.getElementById('native'));
    }, { catalog, progress });
    const report = await readProductionGallery(context, page, 'Arsenal');
    assert.equal(report.status, 'observed', JSON.stringify(report));
    assert.equal(report.detail.cards, 3);
    assert.equal(report.collected.cards, 1);
    assert.equal(report.returned, true);
    assert.equal(report.overview.categories, catalog.categories.length);
    assert.equal(report.overview.categoryButtons, catalog.categories.length);
    assert.equal(await page.evaluate(() => globalThis.gallerySetCalls), 1);
    const listingControl = await panelCall(context, page, function () {
      const button = this.getElementById('gallery-list-purchased');
      return button ? { hidden: button.hidden, disabled: button.disabled, visible: button.checkVisibility?.() ?? false } : null;
    });
    assert.deepEqual(listingControl, { hidden: false, disabled: false, visible: true });
    const assertListingHidden = async () => assert.deepEqual(await panelCall(context, page, function () {
      const dialog = this.getElementById('gallery-bulk-list-dialog');
      return { open: dialog.open, display: globalThis.getComputedStyle(dialog).display, boxes: dialog.getClientRects().length };
    }), { open: false, display: 'none', boxes: 0 });
    await assertListingHidden();
    await selectPanelTab(context, page, 'settings');
    await assertListingHidden();
    await selectPanelTab(context, page, 'gallery');
    await clickPanelControl(context, page, '#gallery-list-purchased');
    assert.equal(await page.evaluate(() => globalThis.galleryListingOpens), 1);
    await clickPanelControl(context, page, '#gallery-bulk-list-dialog button[aria-label="关闭"]');
    await assertListingHidden();
    await selectPanelTab(context, page, 'settings');
    await assertListingHidden();
    assert.deepEqual(requests.filter(url=>!url.startsWith('https://game-assets.fut.gg/')), []);
    console.log('Offline Gallery inspection smoke passed: closed shadow, 127 sets, native scroll, filter/back, one set read.');

    // Regression fixture: cached cards are visible while a catalog refresh is
    // still running. A refresh that reports a real set change must not race the
    // trusted set click and silently hide the detail view.
    await page.evaluate(() => { globalThis.galleryPanel.close(); globalThis.galleryPanel.element.remove(); });
    const changed = Object.freeze({ ...catalog, revision: `${catalog.revision}-refresh`, categories: catalog.categories.map(category =>
      Object.freeze({ ...category, sets: category.sets.map(set => set.id === 'futgg:30' ? Object.freeze({ ...set, requiredCards: set.requiredCards + 1 }) : set) })) });
    const changes = diffGalleryCatalog(catalog, changed);
    assert.deepEqual(changes.requirements, ['futgg:30']);
    await page.evaluate(({ catalog, changed, changes, progress }) => {
      globalThis.galleryRelease = null;
      globalThis.gallerySetCalls = 0;
      globalThis.gallerySetArgs = [];
      globalThis.galleryPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({
        document: globalThis.document, hostId: 'fcat-fc27-production', targets: () => [],
        galleryAccountScope: () => 'fixture',
        galleryCatalog: {
          peek: async () => ({ status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() }),
          load: async () => new Promise(resolve => { globalThis.galleryRelease = () => resolve({
            status: 'observed', source: 'futgg', catalog: changed, fetchedAt: Date.now(),
            changes,
          }); }),
        },
        gallerySetLoader: async args => {
          globalThis.gallerySetArgs.push(args);
          await new Promise(resolve => setTimeout(resolve, 400));
          globalThis.gallerySetCalls++;
          return { status: 'observed', scope: 'fixture', progress };
        },
      });
      globalThis.galleryPanel.open(globalThis.document.getElementById('native'));
    }, { catalog, changed, changes, progress });
    const pendingRead = readProductionGallery(context, page, 'Arsenal');
    await page.waitForFunction(() => typeof globalThis.galleryRelease === 'function' && globalThis.gallerySetArgs.length === 1);
    await page.evaluate(() => globalThis.galleryRelease());
    const refreshed = await pendingRead;
    assert.equal(refreshed.status, 'observed', JSON.stringify(refreshed));
    assert.equal(refreshed.detail.cards, 3);
    assert.equal(await page.evaluate(() => globalThis.gallerySetCalls), 2);
    assert.deepEqual(await page.evaluate(() => globalThis.gallerySetArgs.map(value => value.force)), [false, true]);
    console.log('Offline Gallery refresh-race regression passed: cached view, changed catalog and detail click.');

    // Capture the test root without changing its closed-shadow semantics.
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.galleryRoots = new WeakMap();
      globalThis.Element.prototype.attachShadow = function (options) {
        const shadow = attach.call(this, options); globalThis.galleryRoots.set(this, shadow); return shadow;
      };
    });
    const click = async selector => {
      const point = await page.evaluate(selector => {
        const shadow = globalThis.galleryRoots.get(globalThis.galleryPanel.element);
        const button = shadow.querySelector(selector); button.scrollIntoView({ block: 'center' });
        const rect = button.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, selector);
      await page.mouse.click(point.x, point.y);
    };
    for (const scenario of ['unrelated-change', 'unrelated-removal', 'selected-removal', 'source-change', 'rename', 'selected-change']) {
      const updated = { ...catalog, categories: catalog.categories.map(category => ({ ...category, sets: category.sets
        .filter(set => set.id !== (scenario === 'selected-removal' ? 'futgg:30' : scenario === 'unrelated-removal' ? 'futgg:31' : ''))
        .map(set => set.id === (scenario === 'unrelated-change' ? 'futgg:31' : 'futgg:30')
          ? { ...set, ...(scenario.endsWith('-change') && scenario !== 'source-change' ? { requiredCards: set.requiredCards + 1 } : {}),
            ...(scenario === 'rename' ? { name: 'Renamed Arsenal' } : {}) } : set) })) };
      const source = scenario === 'source-change' ? 'fodder' : 'futgg';
      await page.evaluate(({ catalog, updated, source, progress }) => {
        globalThis.galleryPanel.close(); globalThis.galleryPanel.element.remove();
        globalThis.gallerySetArgs = []; globalThis.galleryReads = [];
        let state = { status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() };
        const refresh = { status: 'observed', source, catalog: updated, fetchedAt: Date.now() };
        let initial = true;
        globalThis.galleryPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({
          document: globalThis.document, hostId: 'fcat-fc27-production', targets: () => [], galleryAccountScope: () => 'fixture',
          galleryCatalog: { peek: async () => state, load: async () => {
            if (!initial) return state;
            initial = false;
            return new Promise(resolve => { globalThis.galleryRelease = () => { state = refresh; resolve(state); }; });
          }, refresh: async () => state },
          gallerySetLoader: args => {
            globalThis.gallerySetArgs.push(args);
            return new Promise(resolve => { globalThis.galleryReads.push(() => resolve({ status: 'observed', scope: 'fixture', progress })); });
          },
        });
        globalThis.galleryPanel.open(globalThis.document.getElementById('native'));
      }, { catalog, updated, source, progress });
      await click('#tab-gallery');
      await page.waitForFunction(() => globalThis.galleryRoots.get(globalThis.galleryPanel.element).querySelector('#gallery-categories [data-category-id]'));
      await click('#gallery-categories [data-category-id="futgg:1"]');
      await page.waitForFunction(() => globalThis.galleryRoots.get(globalThis.galleryPanel.element).querySelector('.gallery-open-set'));
      await click('[data-set-id="futgg:30"] .gallery-open-set');
      await page.waitForFunction(() => globalThis.gallerySetArgs.length === 1);
      await page.evaluate(() => globalThis.galleryRelease());
      await page.waitForFunction(() => !globalThis.galleryRoots.get(globalThis.galleryPanel.element).getElementById('gallery-refresh').disabled);
      // The replacement must wait for the pre-change read, then bypass cache.
      assert.equal(await page.evaluate(() => globalThis.gallerySetArgs.length), 1, scenario);
      await page.evaluate(() => globalThis.galleryReads[0]());
      if (scenario === 'selected-change') {
        await page.waitForFunction(() => globalThis.gallerySetArgs.length === 2);
        assert.equal(await page.evaluate(() => globalThis.gallerySetArgs[1].force), true);
        await page.evaluate(() => globalThis.galleryReads[1]());
      }
      const hidden = ['selected-removal', 'source-change'].includes(scenario);
      await page.waitForFunction(hidden => {
        const root = globalThis.galleryRoots.get(globalThis.galleryPanel.element).getElementById('gallery-set-detail');
        return hidden ? root.hidden : !root.hidden && root.querySelectorAll('.gallery-card').length === 3;
      }, hidden);
      if (scenario === 'rename') assert.equal(await page.evaluate(() =>
        globalThis.galleryRoots.get(globalThis.galleryPanel.element).querySelector('#gallery-set-detail h3').textContent), 'Renamed Arsenal');
      await click('#gallery-refresh');
      await page.waitForFunction(() => !globalThis.galleryRoots.get(globalThis.galleryPanel.element).getElementById('gallery-refresh').disabled);
      assert.equal(await page.evaluate(() => globalThis.gallerySetArgs.length), scenario === 'selected-change' ? 2 : 1, scenario);
    }
    assert.deepEqual(requests.filter(url=>!url.startsWith('https://game-assets.fut.gg/')), []);
    console.log('Offline Gallery invalidation regressions passed: unrelated changes/removals, selected removal, source switch, rename, refresh replay, serialized forced read.');

    assert.equal(await panelCall(context, page, function () { return this.querySelectorAll('[id^="gallery-proxy"]').length; }), 0);
    await page.evaluate(() => {
      globalThis.inspectionUnintendedClicks = 0;
      const shield = globalThis.document.createElement('button'); shield.id = 'inspection-shield';
      shield.style.cssText = 'position:fixed;inset:0;z-index:999999';
      shield.onclick = () => globalThis.inspectionUnintendedClicks++;
      globalThis.document.body.append(shield);
    });
    await assert.rejects(clickPanelControl(context, page, '#tab-settings', 200), /FC27_INSPECTION_PANEL_TIMEOUT/);
    assert.equal(await page.evaluate(() => globalThis.inspectionUnintendedClicks), 0);
    await page.locator('#inspection-shield').evaluate(node => node.remove());
    await panelCall(context, page, function () { this.host.style.display = 'none'; });
    await assert.rejects(clickPanelControl(context, page, '#tab-settings', 200), /FC27_INSPECTION_PANEL_TIMEOUT/);
    assert.deepEqual(requests.filter(url=>!url.startsWith('https://game-assets.fut.gg/')), []);
    console.log('Offline Gallery settings passed: no proxy controls, trusted closed-shadow clicks and shield/hidden protection.');
  } finally { await page.close(); }
}
