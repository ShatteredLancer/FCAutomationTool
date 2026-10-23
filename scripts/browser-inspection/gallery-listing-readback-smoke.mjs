import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { priceTiers } from '../../tests/fixtures/enhancer-listing-price-reference.js';

// Offline mock EA and mock GM only. The durable store/server survive page reload;
// real Session + view + trusted Stop/Continue clicks must not duplicate a list.
export async function exerciseGalleryListingReadback(context, directory) {
  const root = path.resolve(import.meta.dirname, '../..'), page = await context.newPage();
  const bundle = await build({ absWorkingDir: root, stdin: { contents: `
    export { createGalleryBulkListSession } from './src/gallery/bulk-list-session.js';
    export { mountFc27BulkListView } from './src/adapters/browser/fc27-bulk-list-view.js';
    export { planGalleryListingPrices } from './src/gallery/listing-candidates.js';
  `, resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'ReadbackSmoke' });
  const values = new Map(), server = new Map(); let listCalls = 0, refreshCalls = 0, delayed = true, external = 0;
  const url = 'https://fcat-offline.invalid/listing-readback';
  await page.route('**/*', route => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline listing readback</title><main></main>' })
    : (external++, route.abort()));
  await page.exposeFunction('readbackStoreGet', (key, fallback) => structuredClone(values.get(key) ?? fallback));
  await page.exposeFunction('readbackStoreSet', (key, value) => { values.set(key, structuredClone(value)); });
  await page.exposeFunction('readbackList', (item, params) => {
    listCalls++; assert.equal(server.has(item.id), false, 'No exact item is listed twice');
    server.set(item.id, { item: { ...item, pile: 'transfer' }, auction: { state: 'active',
      startingBid: params.startPrice, buyNowPrice: params.buyNow, tradeId: String(9000 + item.id) } });
    return { status: 'accepted', response: { success: true, status: 200 } };
  });
  await page.exposeFunction('readbackRefresh', () => { refreshCalls++; return delayed ? [] : [...server.values()]; });
  const install = async () => {
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async priceTiers => {
      const host = globalThis.document.querySelector('main'), shadow = host.attachShadow({ mode: 'open' });
      const candidates = [1, 2].map(id => ({ item: { id, definitionId: 100 + id, pile: 'club' }, name: `Fixture ${id}`, purchase: { tradeId: String(5000 + id) } }));
      let current = [], stopped = false, progress = () => {};
      const adapter = {
        inspectListingItem(ref) { return { status: 'loaded', candidate: ref.pile === 'transfer'
          ? current.find(row => row.item.id === ref.id) ?? null
          : { item: ref, auction: { state: 'none' }, tradeable: true, evolution: false, limitedUse: false, concept: false, academyEnrolled: false } }; },
        inspectCapabilities: () => ({ transferCapacity: { free: 100 } }),
        inspectPriceLimits: async () => ({ status: 'loaded', after: { minimum: 150, maximum: 1000 } }),
        acquireRequestPermit: async () => ({ status: 'acquired', permit: {} }),
        listItem: (item, params) => globalThis.readbackList(item, params),
        refreshTransferItems: async () => { current = await globalThis.readbackRefresh(); return { status: 'completed' }; },
      };
      const session = globalThis.readbackSession = globalThis.ReadbackSmoke.createGalleryBulkListSession({
        scope: 'offline', context: { account: 'synthetic' }, operationId: () => 'offline-run', tradeAdapter: adapter,
        get: globalThis.readbackStoreGet, set: globalThis.readbackStoreSet, exclusive: async (_scope, task) => task(),
        shouldStop: () => stopped, onProgress: row => progress(row), sleep: async ms => {
          if (ms < 3000) await new Promise(resolve => { globalThis.releaseReadbackWait = resolve; });
        },
      });
      const settings = { priceMode: 'fixed', fixedPrice: 200, fixedStartPrice: 150, durationSeconds: 3600, delaySeconds: [3, 5] };
      const service = {
        readSettings: async () => settings, writeSettings: async () => {},
        prepare: async () => {
          const saved = await session.inspect();
          return saved.status === 'observed' && saved.state !== 'completed'
            ? { ...saved, status: 'resume-required' }
            : { status: 'ready', candidates, prices: { 101: 200, 102: 200 }, priceTiers, source: 'FUT.GG', liveEnabled: true };
        },
        plan: ({ selectedIds, settings }) => globalThis.ReadbackSmoke.planGalleryListingPrices({
          candidates: candidates.filter(row => selectedIds.includes(row.item.id)), settings, marketPrices: { 101: 200, 102: 200 }, priceTiers,
          limitsByItem: { 1: { status: 'loaded', minimum: 150, maximum: 1000 }, 2: { status: 'loaded', minimum: 150, maximum: 1000 } } }),
        execute: args => { stopped = false; progress = args.onProgress;
          return session.execute({ ...args, binding: 'offline-batch', entries: args.plan?.entries }); },
        inspect: () => session.inspect(), stop: () => { stopped = true; },
      };
      globalThis.readbackView = globalThis.ReadbackSmoke.mountFc27BulkListView({ document: globalThis.document, parent: shadow, host, service, accountScope: () => 'synthetic' });
      await globalThis.readbackView.open();
    }, priceTiers);
  };
  try {
    await page.goto(url); await install();
    await page.getByRole('button', { name: '挂牌 2 张', exact: true }).click();
    await page.getByText(/只读核对 1\/3，不会重复挂牌/).waitFor();
    assert.equal(listCalls, 1); assert.equal(refreshCalls, 1);
    await page.screenshot({ path: path.join(directory, 'listing-readback-checking.png') });
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.evaluate(() => globalThis.releaseReadbackWait());
    await page.getByRole('button', { name: '核对并继续', exact: true }).waitFor();
    assert.equal(listCalls, 1);
    assert.equal([...values.values()][0].entries[0].status, 'unknown');
    assert.equal([...values.values()][0].entries[0].response.success, true);
    delayed = false; server.get(1).auction.state = 'closed';
    await page.reload(); await install();
    await page.getByRole('button', { name: '核对并继续', exact: true }).click();
    await page.getByRole('button', { name: '已完成', exact: true }).waitFor();
    assert.equal(listCalls, 2); assert.equal(refreshCalls, 3);
    assert.ok((await page.locator('#gallery-bulk-list-dialog').innerText()).includes('已挂牌（拍卖已结束）'));
    assert.equal([...values.values()][0].entries.every(row => row.status === 'accepted'), true);
    await page.screenshot({ path: path.join(directory, 'listing-readback-recovered.png') });
    assert.equal((await page.evaluate(() => globalThis.readbackSession.execute({ approved: true, resume: true, expectedRunId: 'offline-run' }))).status, 'completed');
    assert.equal(listCalls, 2); assert.equal(external, 0);
    console.log('Gallery listing readback Chrome passed: visible read-only progress, Stop, durable reload, closed acknowledgement, no duplicate listing; synthetic only.');
  } finally { await page.close(); }
}
