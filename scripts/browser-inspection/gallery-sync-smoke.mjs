import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { futggGallery, futggGalleryPool } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGallerySync(context, directory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ stdin: { contents: `
    export { mountFc27AcceptancePanel } from './src/adapters/browser/fc27-acceptance-panel.js';
    export { createFc27GallerySync } from './src/adapters/browser/fc27-gallery-sync.js';
    export { createFc27GalleryProgressReader } from './src/adapters/ea/fc27-gallery-progress.js';`, resolveDir: root },
    bundle: true, write: false, format: 'iife', globalName: 'SyncSmoke' });
  const input = futggGallery(), base = input.data.categories[0].sets[0];
  input.data.categories[0].sets = [{ ...base, id: 30, slug: 'collection-a', name: 'Collection A' },
    { ...base, id: 31, slug: 'collection-b', name: 'Collection B' }];
  const pool = normalizeGalleryPool('futgg', futggGalleryPool(), 30), catalog = normalizeGalleryCatalog('futgg', input);
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) {
        return attach.call(this, { ...options, mode: 'open' });
      };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ pool, catalog }) => {
      const store = new Map(), calls = []; globalThis.syncCalls = calls;
      const root = {
        APP_YEAR: 2027, APP_YEAR_SHORT: 27, GAME_NAME: 'fc27',
        SearchType: { PLAYER: 'player' }, SearchCategory: { ANY: 'any' },
        UTSearchCriteriaDTO: class { constructor() { this.sort = 'asc'; } },
        UTItemEntityFactory: class { createItem(raw) { return { definitionId: raw.resourceId, concept: true,
          isPlayer: () => true, getAuctionData: () => ({ isValid: () => false }) }; } },
        services: { User: { currentUserId: 1, repository: { _collection: { 1: { id: 1, selectedPersona: 2,
          _personas: { _collection: { 2: { id: 2, _sku: 'test', clubs: { _collection: { test: { sku: 'test', platform: 'pc', year: 2027 } } } } } } } } } }, Item: {} },
        repositories: { Item: { club: { items: { _collection: {} } }, getStaticData: () => pool.items.map(row => ({ id: row.eaId })) } },
      };
      const factory = new root.UTItemEntityFactory(); globalThis.syncFactory = factory;
      root.services.Item.searchConceptItems = criteria => {
        calls.push({ count: criteria.count, offset: criteria.offset, ids: [...criteria.defId] });
        const observable = { unobserve() {}, observe(owner, callback) {
          const reply = () => callback(observable, { success: true, status: 200,
            response: { endOfList: true, items: criteria.defId.map(resourceId => factory.createItem({ resourceId,
              isCollected: resourceId === 900001, gradingScore: 100 })) } });
          if (calls.length === 1) globalThis.releaseFirstSync = reply;
          else if (globalThis.holdNextSync) { globalThis.holdNextSync = false; globalThis.releaseForegroundSync = reply; }
          else queueMicrotask(reply);
        } }; return observable;
      };
      const poolFor = setId => ({ ...pool, setId: Number(String(setId).replace(/^futgg:/, '')) });
      const provider = {
        peek: async () => ({status:'observed',source:'futgg',catalog}), load: async () => ({status:'observed',source:'futgg',catalog}),
        refresh: async () => ({status:'observed',source:'futgg',catalog}), peekPool: async ({setId}) => ({pool:poolFor(setId)}),
        loadPool: async ({setId}) => ({status:'observed',cached:true,pool:poolFor(setId)}),
      };
      const reader = globalThis.SyncSmoke.createFc27GalleryProgressReader(root, {
        gmGetValue: key => store.get(key), gmSetValue: (key,value) => store.set(key,structuredClone(value)),
      });
      const sync = globalThis.SyncSmoke.createFc27GallerySync({provider,reader}); globalThis.nativeSync=sync;
      const make = () => {
        const panel = globalThis.SyncSmoke.mountFc27AcceptancePanel({document: globalThis.document,hostId:'gallery-sync-test',targets:()=>[],
          galleryCatalog:provider,galleryAccountScope:reader.scope,gallerySync:sync,
          gallerySetLoader:async ({setId, force = false, onProgress}) => reader.load(poolFor(setId), { force, onProgress }) });
        panel.open(); return panel;
      };
      globalThis.syncPanel = make(); globalThis.reopenSync = () => { globalThis.syncPanel.close(); globalThis.syncPanel.open(); };
    }, { pool, catalog });
    const host = page.locator('#gallery-sync-test');
    await host.locator('#tab-gallery').click();
    await host.locator('#gallery-sync').waitFor({ state: 'visible' });
    await host.locator('#gallery-background-progress').waitFor({ state: 'visible' });
    assert.equal(await host.locator('#gallery-sync').isDisabled(), true, 'an active sync disables a second request');
    assert.match(await host.locator('#gallery-progress-note').innerText(), /同步 EA 收集 1\/1/);
    await host.locator('#gallery-sync-dialog').waitFor({ state: 'hidden' });
    for (const width of [1280,390]) {
      await page.setViewportSize({width,height:800});
      assert.equal(await host.evaluate(el => el.scrollWidth > el.clientWidth + 1),false);
      await page.screenshot({path:path.join(directory,`gallery-sync-progress-${width}.png`)});
    }
    // Opening a collection while the optional all-set mapping is in flight
    // must cancel at the next safe boundary and read the selected pool first.
    await host.locator('#gallery-categories button').first().click();
    await host.getByRole('button', { name:'查看卡片', exact:true }).first().click();
    await host.getByRole('button', { name:'返回集合', exact:true }).click();
    await host.getByRole('button', { name:'查看卡片', exact:true }).last().click();
    await page.evaluate(() => globalThis.releaseFirstSync());
    await host.locator('.gallery-big-count').waitFor({ state: 'visible' });
    await page.waitForFunction(() => globalThis.nativeSync.state().synced);
    assert.equal(await host.locator('.gallery-set').count(), 2);
    for (const set of await host.locator('.gallery-set').all()) assert.equal(await set.locator('.gallery-collected').innerText(), '1 / 20');
    assert.equal(await page.evaluate(() => globalThis.syncCalls.length), 1,
      'one native request covers the static IDs; pool mapping does not reread covered versions');
    assert.equal(await host.locator('#gallery-sync').isDisabled(), false, 'completed sync permits explicit full review');
    assert.equal(await page.evaluate(() => globalThis.syncCalls.length), 1);
    await page.evaluate(() => { globalThis.holdNextSync = true; });
    await host.getByRole('button', { name:'同步当前集合',exact:true }).click();
    await page.waitForFunction(() => typeof globalThis.releaseForegroundSync === 'function');
    await host.locator('#gallery-background-progress').waitFor({state:'visible', timeout:3000});
    assert.match(await host.locator('#gallery-progress-note').innerText(), /Collection B/);
    assert.equal(await host.getByRole('button', {name:'同步当前集合',exact:true}).isDisabled(), true);
    await page.evaluate(() => globalThis.releaseForegroundSync());
    await host.locator('.gallery-big-count').waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => globalThis.syncCalls.length), 2);
    await host.getByRole('button',{name:'返回集合',exact:true}).click();
    await page.evaluate(() => globalThis.syncFactory.createItem({resourceId:900002,isCollected:true,gradingScore:100}));
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-sync-test').shadowRoot
      .getElementById('gallery-set-list').textContent.includes('2 / 20'));
    assert.equal(await page.evaluate(() => globalThis.syncCalls.length), 2);
    for (const width of [1280,390]) {
      await page.setViewportSize({width,height:800});
      assert.equal(await host.evaluate(el => el.scrollWidth > el.clientWidth + 1),false);
      await page.screenshot({path:path.join(directory,`gallery-sync-${width}.png`)});
    }
    await page.evaluate(() => globalThis.reopenSync());
    await host.locator('#tab-gallery').click();
    assert.equal(await host.locator('#gallery-summary').isVisible(), true, 'reopen starts at categories');
    await host.locator('#gallery-categories button').first().click();
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-sync-test').shadowRoot
      .getElementById('gallery-set-list').textContent.includes('2 / 20'));
    assert.equal(await page.evaluate(() => globalThis.syncCalls.length),2);
    console.log('Offline Gallery sync passed: one native all-sync, two collection progress, foreground/current sync, passive update, reopen and desktop/mobile.');
  } finally { await page.close(); }
}
