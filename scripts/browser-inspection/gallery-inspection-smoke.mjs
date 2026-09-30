import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { readProductionGallery } from './agent-session.mjs';
import { inspectGalleryFallback } from './gallery-proxy-inspection.mjs';
import { clickPanelControl, panelCall } from './production-panel-inspection.mjs';
import { diffGalleryCatalog, normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { mergeGalleryAccountProgress } from '../../src/gallery/progress.js';
import { futggGallery, fodderGallery, futggGalleryPool } from '../../tests/fixtures/fc27-gallery.js';

// Use the real closed shadow root and native scrolling host. The earlier
// Gallery smoke only exercised open-shadow Playwright locators in a modal.
export async function exerciseGalleryInspection(context) {
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'GallerySmoke', target: 'chrome120' });
  const normalized = normalizeGalleryCatalog('futgg', futggGallery());
  const template = normalized.categories[0].sets[0];
  const catalog = Object.freeze({ ...normalized, categories: normalized.categories.map((category, categoryIndex) =>
    Object.freeze({ ...category, sets: categoryIndex === 0 ? Array.from({ length: 127 }, (_, index) => Object.freeze({ ...template,
      id: `futgg:${index + 1}`, name: index === 29 ? 'Arsenal' : `Fixture set ${index + 1}` })) : category.sets })) });
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
      const state = { status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() };
      globalThis.galleryPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({
        document: globalThis.document, hostId: 'fcat-fc27-production', targets: () => [],
        galleryAccountScope: () => 'fixture',
        galleryCatalog: { peek: async () => state, load: async () => state },
        gallerySetLoader: async args => { globalThis.gallerySetCalls++; globalThis.gallerySetArgs.push(args); return { status: 'observed', scope: 'fixture', progress }; },
      });
      globalThis.galleryPanel.open(globalThis.document.getElementById('native'));
    }, { catalog, progress });
    const report = await readProductionGallery(context, page, 'Arsenal');
    assert.equal(report.status, 'observed', JSON.stringify(report));
    assert.equal(report.detail.cards, 3);
    assert.equal(report.collected.cards, 1);
    assert.equal(report.returned, true);
    assert.equal(report.overview.categories, catalog.categories.length);
    assert.equal(report.overview.categoryButtons, catalog.categories.length + 1);
    assert.equal(await page.evaluate(() => globalThis.gallerySetCalls), 1);
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

    const transportBundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-gallery-catalog.js'],
      bundle: true, write: false, format: 'iife', globalName: 'GalleryTransportSmoke', target: 'chrome120' });
    await page.addScriptTag({ content: transportBundle.outputFiles[0].text });
    for (const failRestore of [false, true]) {
      await page.evaluate(({ futgg, fodder, failRestore }) => {
        globalThis.galleryPanel.close(); globalThis.galleryPanel.element.remove();
        const memory = new Map();
        globalThis.galleryProbeRequests = []; globalThis.galleryProxyWrites = [];
        let proxy = '';
        const transport = globalThis.GalleryTransportSmoke.createFc27GalleryTransport(options => {
          globalThis.galleryProbeRequests.push({ url: options.url, anonymous: options.anonymous, method: options.method });
          const failure = options.url.includes('fcat-gallery-probe-unavailable');
          options.onload({ status: failure ? 404 : 200, responseText: JSON.stringify(options.url.includes('fodder.gg') ? fodder : futgg) });
        }, { getProxy: () => proxy });
        const provider = globalThis.GalleryTransportSmoke.createFc27GalleryCatalogProvider({ http: transport,
          gmGetValue: (key, value) => memory.get(key) ?? value, gmSetValue: (key, value) => memory.set(key, value) });
        globalThis.galleryPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({ document: globalThis.document,
          hostId: 'fcat-fc27-production', targets: () => [], galleryCatalog: provider, galleryProxy: () => proxy,
          setGalleryProxy: async value => {
            globalThis.galleryProxyWrites.push(value);
            if (failRestore && value === '') throw new Error('FC27_GALLERY_TEST_RESTORE_FAILED');
            proxy = globalThis.GalleryTransportSmoke.normalizeFc27GalleryProxy(value);
            return { status: 'observed', proxy };
          } });
        globalThis.galleryPanel.open(globalThis.document.getElementById('native'));
        // Reproduce stale unrelated policy failure: this is not a proxy receipt.
        globalThis.galleryPanel.element.dataset.result = JSON.stringify({ status: 'blocked', reason: 'FC27_CONTEXT_UNAVAILABLE' });
        const shield = globalThis.document.createElement('div'); shield.id = 'inspection-shield';
        shield.style.cssText = 'position:fixed;inset:0;z-index:999999;background:transparent';
        globalThis.document.body.append(shield); setTimeout(() => shield.remove(), 250);
      }, { futgg: futggGallery(), fodder: fodderGallery(), failRestore });
      const probe = await inspectGalleryFallback(context, page);
      assert.equal(probe.fallbackObserved, true, JSON.stringify(probe));
      assert.equal(probe.stages.catalog.source, 'Fodder · 回退目录');
      assert.equal(probe.status, failRestore ? 'blocked' : 'observed');
      assert.equal(probe.restoration.confirmed, !failRestore);
      assert.equal(probe.restoration.persistedAcrossReload, false);
      assert.deepEqual(await page.evaluate(() => globalThis.galleryProxyWrites), ['https://www.fut.gg/fcat-gallery-probe-unavailable', '']);
      const reads = await page.evaluate(() => globalThis.galleryProbeRequests);
      assert.equal(reads.length, 2, JSON.stringify(reads));
      assert.ok(reads[0].url.includes('futggapi=gallery/fc27/'));
      assert.equal(reads[1].url, 'https://fodder.gg/api/gallery');
      assert.ok(reads.every(read => read.anonymous && read.method === 'GET'));
    }
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
    console.log('Offline Gallery fallback probe passed: trusted closed-shadow clicks, shield/hidden protection, exact save receipt, one fallback read, restoration failure preserves evidence.');
  } finally { await page.close(); }
}
