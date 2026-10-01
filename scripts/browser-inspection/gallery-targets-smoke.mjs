import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery, fodderGallery } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryTargets(context, directory) {
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents:
    'export { mountFc27AcceptancePanel } from "./src/adapters/browser/fc27-acceptance-panel.js";\n'
    + 'export { createGalleryTargetStore } from "./src/gallery/targets.js";' }, bundle: true, write: false,
  format: 'iife', globalName: 'GalleryTargetsSmoke', target: 'chrome120' });
  const input = futggGallery();
  const second = structuredClone(input.data.categories[0].sets[0]); second.id = 31; second.name = 'Another Club'; second.slug = 'another-club';
  input.data.categories[0].sets.push(second);
  const catalog = normalizeGalleryCatalog('futgg', input), fallback = normalizeGalleryCatalog('fodder', fodderGallery());
  const requests = []; page.on('request', request => requests.push(request.url()));
  try {
    await page.setContent('<!doctype html><title>Gallery target persistence fixture</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ catalog, fallback }) => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      globalThis.targetData = new Map(); globalThis.targetScope = 'fixture-account-a'; globalThis.targetReads = 0;
      globalThis.catalogReads = 0; globalThis.holdReads = false; globalThis.heldReads = [];
      globalThis.failTargetRead = false; globalThis.failTargetWrite = false;
      globalThis.targetState = { status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now(), cached: false };
      globalThis.targetFallback = { status: 'observed', source: 'fodder', catalog: fallback, fetchedAt: Date.now(), cached: false };
      globalThis.mountTargets = () => {
        globalThis.targetPanel?.close(); globalThis.document.getElementById('gallery-target-test')?.remove();
        const store = globalThis.GalleryTargetsSmoke.createGalleryTargetStore({
          get: async key => {
            if (globalThis.failTargetRead) throw new Error('fixture read failure');
            const value = structuredClone(globalThis.targetData.get(key) ?? null);
            if (globalThis.holdReads) await new Promise(resolve => globalThis.heldReads.push(resolve));
            return value;
          },
          set: async (key, value) => {
            if (globalThis.failTargetWrite) throw new Error('fixture write failure');
            globalThis.targetData.set(key, structuredClone(value));
          },
        });
        globalThis.targetPanel = globalThis.GalleryTargetsSmoke.mountFc27AcceptancePanel({ document: globalThis.document,
          hostId: 'gallery-target-test', targets: () => [], galleryAccountScope: () => globalThis.targetScope,
          galleryTargetStore: store,
          galleryCatalog: { peek: async () => null, load: async () => { globalThis.catalogReads++; return globalThis.targetState; },
            refresh: async () => { globalThis.catalogReads++; return globalThis.targetState; } },
          gallerySetLoader: async () => { globalThis.targetReads++; return { status: 'blocked', reason: 'FC27_GALLERY_PROGRESS_UNAVAILABLE' }; },
        }); globalThis.targetPanel.open();
      }; globalThis.mountTargets();
    }, { catalog, fallback });
    const host = page.locator('#gallery-target-test');
    const settled = () => page.waitForFunction(() => !globalThis.document.getElementById('gallery-target-test').shadowRoot.getElementById('gallery-joint-budget').disabled);
    const remount = async () => { await page.evaluate(() => globalThis.mountTargets()); await host.locator('#tab-gallery').click(); await settled(); };
    await host.locator('#tab-gallery').click(); await settled();
    await host.locator('#gallery-categories button').first().click();
    const reads = await page.evaluate(() => globalThis.catalogReads);
    await host.locator('.gallery-browse-tools > summary').click();
    await host.locator('#gallery-search').fill('example');
    assert.equal(await host.locator('.gallery-set').count(), 1);
    await host.locator('#gallery-search').fill('no matching collection');
    assert.match(await host.locator('#gallery-set-list').innerText(), /没有匹配/);
    await host.locator('#gallery-search').fill('');
    await host.locator('#gallery-sort').selectOption('name');
    assert.equal(await host.locator('.gallery-set h4').first().innerText(), 'Another Club');
    await host.getByRole('button', { name: '关注集合 Example Club', exact: true }).click();
    await host.locator('#gallery-followed').check();
    assert.equal(await host.locator('.gallery-set').count(), 1);
    await host.locator('#gallery-mode-joint').click();
    await host.locator('.gallery-joint-target select').selectOption('C');
    await host.locator('#gallery-joint-budget').fill('0');
    await page.waitForFunction(() => [...globalThis.targetData.values()].some(row => row.budget === 0 && row.targets[0]?.grade === 'C'));
    assert.equal(await page.evaluate(() => globalThis.catalogReads), reads);
    assert.equal(await page.evaluate(() => globalThis.targetReads), 0, 'local target/search actions must not read EA');
    await remount(); await host.locator('#gallery-mode-joint').click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 1);
    assert.equal(await host.locator('.gallery-joint-target select').inputValue(), 'C');
    assert.equal(await host.locator('#gallery-joint-budget').inputValue(), '0');
    assert.equal(await page.evaluate(() => globalThis.targetReads), 0, 'restoration must not read card pools');
    await host.locator('#gallery-joint-plan').click();
    assert.match(await host.locator('#gallery-joint-output').innerText(), /集合状态待更新/);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await host.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      await page.screenshot({ path: path.join(directory, `gallery-targets-${width}.png`) });
    }
    await host.locator('.gallery-target-open').click();
    assert.match(await host.locator('#gallery-set-detail').innerText(), /FC27_GALLERY_PROGRESS_UNAVAILABLE/);
    assert.equal(await page.evaluate(() => globalThis.targetReads), 1, 'read the chosen set only on explicit open');
    await host.getByRole('button', { name: '返回集合', exact: true }).click();
    await host.locator('#gallery-mode-joint').click();

    // A different account cannot inherit goals or budget; returning restores
    // the old account's own preferences, not a purchase permit or live plan.
    await page.evaluate(() => { globalThis.targetScope = 'fixture-account-b'; });
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-target-test').shadowRoot.querySelectorAll('.gallery-joint-target').length === 0);
    await settled();
    assert.equal(await host.locator('.gallery-joint-target').count(), 0);
    assert.equal(await host.locator('#gallery-joint-budget').inputValue(), '');
    await page.evaluate(() => { globalThis.targetScope = 'fixture-account-a'; });
    await remount(); await host.locator('#gallery-mode-joint').click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 1);

    await page.evaluate(() => { globalThis.savedFutggState = globalThis.targetState; globalThis.targetState = globalThis.targetFallback; });
    await host.locator('#gallery-refresh').click(); await settled();
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-target-test').shadowRoot.getElementById('gallery-source').textContent.includes('Fodder'));
    assert.equal(await host.locator('.gallery-joint-target').count(), 0);
    await page.evaluate(() => { globalThis.targetState = globalThis.savedFutggState; });
    await host.locator('#gallery-refresh').click(); await settled();
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-target-test').shadowRoot.querySelectorAll('.gallery-joint-target').length === 1);
    assert.equal(await host.locator('.gallery-joint-target select').inputValue(), 'C');

    await host.getByRole('button', { name: '移除 Example Club', exact: true }).click();
    await page.waitForFunction(() => [...globalThis.targetData.values()].filter(row => row.source === 'futgg').every(row => row.targets.length === 0));
    await remount(); await host.locator('#gallery-mode-joint').click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 0, 'removed targets stay removed on reload');
    await host.locator('#gallery-mode-browse').click();
    await host.locator('#gallery-categories button').first().click();
    await host.getByRole('button', { name: '关注集合 Example Club', exact: true }).click();
    await host.locator('#gallery-mode-joint').click();
    await host.locator('.gallery-joint-target select').selectOption('C');
    await page.waitForFunction(() => [...globalThis.targetData.values()].some(row => row.targets[0]?.grade === 'C'));
    await page.evaluate(() => {
      globalThis.targetState = structuredClone(globalThis.savedFutggState);
      globalThis.targetState.catalog.categories[0].sets[0].grades = globalThis.targetState.catalog.categories[0].sets[0].grades.filter(row => row.name !== 'C');
    });
    await host.locator('#gallery-refresh').click();
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-target-test').shadowRoot.querySelectorAll('.gallery-joint-target').length === 0);
    assert.equal(await host.locator('.gallery-joint-target').count(), 0, 'invalid grade is retired on a fresh catalogue');
    await page.evaluate(() => { globalThis.targetState = globalThis.savedFutggState; });
    await host.locator('#gallery-refresh').click();
    await host.locator('#gallery-mode-browse').click();
    await host.getByRole('button', { name: '关注集合 Example Club', exact: true }).click();
    await host.locator('#gallery-mode-joint').click();

    await page.evaluate(() => { globalThis.failTargetWrite = true; });
    await host.locator('#gallery-joint-budget').fill('123');
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-target-test').shadowRoot.getElementById('gallery-target-status').textContent.includes('保存失败'));
    assert.equal(await host.locator('.gallery-joint-target').count(), 1, 'write failure does not discard current preferences');
    await page.evaluate(() => { globalThis.failTargetWrite = false; });
    await host.locator('#gallery-joint-budget').fill('124');
    await page.waitForFunction(() => [...globalThis.targetData.values()].some(row => row.budget === 124));
    await page.evaluate(() => { globalThis.failTargetRead = true; });
    await remount(); await host.locator('#gallery-mode-joint').click();
    assert.match(await host.locator('#gallery-target-status').innerText(), /恢复失败/);
    assert.equal(await host.locator('.gallery-joint-target').count(), 0);
    await page.evaluate(() => { globalThis.failTargetRead = false; });
    await remount(); await host.locator('#gallery-mode-joint').click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 1);
    assert.equal(await host.locator('#gallery-joint-budget').inputValue(), '124');

    // A stale/failed directory omits a set but must retain saved preferences.
    await page.evaluate(() => { globalThis.targetState = structuredClone(globalThis.targetState);
      globalThis.targetState.catalog.categories[0].sets = []; globalThis.targetState.stale = true; globalThis.targetState.cached = true; });
    await host.locator('#gallery-refresh').click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 1);
    await page.evaluate(() => { globalThis.targetState.stale = false; globalThis.targetState.cached = false; });
    await host.locator('#gallery-refresh').click();
    await page.waitForFunction(() => [...globalThis.targetData.values()].filter(row => row.scope === 'fixture-account-a' && row.source === 'futgg').every(row => row.targets.length === 0));
    assert.equal(await host.locator('.gallery-joint-target').count(), 0);

    // Delayed old-account restore cannot overwrite a newer active account.
    await page.evaluate(() => { globalThis.targetState = globalThis.savedFutggState;
      for (const [key, row] of globalThis.targetData) if (row.scope === 'fixture-account-a') globalThis.targetData.set(key, { ...row, targets: [{ setId: 'futgg:30', grade: 'D' }] });
      globalThis.holdReads = true; });
    await page.evaluate(() => globalThis.mountTargets()); await host.locator('#tab-gallery').click();
    await page.waitForFunction(() => globalThis.heldReads.length > 0);
    await host.locator('#gallery-categories button').first().click();
    assert.equal(await host.getByRole('button', { name: '关注集合 Example Club', exact: true }).isDisabled(), true);
    await page.evaluate(() => { globalThis.targetScope = 'fixture-account-b'; globalThis.holdReads = false; });
    await host.locator('#gallery-refresh').click();
    // Scope polling uses the same production check, no private command.
    await settled();
    await page.evaluate(() => { for (const release of globalThis.heldReads.splice(0)) release(); });
    await host.locator('#gallery-mode-joint').click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 0);
    assert.equal(await host.locator('#gallery-joint-budget').inputValue(), '');
    assert.equal(await page.evaluate(() => globalThis.targetReads), 1);
    assert.deepEqual(requests, []);
    console.log('Offline Gallery targets smoke passed: search/sort, scoped restore/removal, GM failures, no auto reads, grade/retirement, source/account isolation, delayed restore and desktop/mobile.');
  } catch (error) {
    console.log('Gallery targets synthetic failure state:', await page.evaluate(() => ({
      records: [...globalThis.targetData.values()], status: globalThis.document.getElementById('gallery-target-test')?.shadowRoot.getElementById('gallery-target-status').textContent,
      goals: globalThis.document.getElementById('gallery-target-test')?.shadowRoot.getElementById('gallery-joint-targets').textContent,
    })));
    throw error;
  } finally { await page.close(); }
}
