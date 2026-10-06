import { expect, it, vi } from 'vitest';
import { createGalleryNetCostStore, galleryNetCostKey } from '../../src/gallery/net-cost-store.js';
import { createFc27GalleryAccounting } from '../../src/adapters/browser/fc27-gallery-accounting.js';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { galleryPurchaseKey } from '../../src/gallery/purchase-session.js';

function fixture() {
  const data = new Map();
  const get = async (key, fallback) => structuredClone(data.get(key) ?? fallback);
  const set = async (key, value) => data.set(key, structuredClone(value));
  const store = createGalleryNetCostStore({ get, set, exclusive: async (_scope, task) => task(), now: () => 100 });
  const receipt = { itemId: 11, definitionId: 111, purchasePrice: 200, tradeId: '1111', operationId: 'batch-a' };
  return { data, get, set, store, receipt };
}

it('retains purchases across batches and reload, and deducts only native exact sold receipts', async () => {
  const f = fixture(); await f.store.ingest('a', [f.receipt]);
  await f.store.ingest('a', [{ ...f.receipt, itemId: 12, definitionId: 112, operationId: 'batch-b' }]);
  const snapshot = { status: 'observed', receipts: [{ itemId: 11, definitionId: 111,
    sold: true, soldPrice: 500, listingTradeId: '9999' }] };
  expect(await f.store.reconcile('a', snapshot)).toMatchObject({ spent: 400, grossRevenue: 500, tax: 25, netRevenue: 475, netCost: -75 });
  await f.store.reconcile('a', snapshot);
  const reloaded = createGalleryNetCostStore({ get: f.get, set: f.set, exclusive: async (_scope, task) => task() });
  expect(await reloaded.read('a')).toMatchObject({ entries: 2, sold: 1, netCost: -75 });
  expect(await reloaded.read('b')).toMatchObject({ spent: 0, entries: 0 });
});

it('records exact accepted listing receipts as listed without treating them as sales', async () => {
  const f = fixture();
  await f.store.ingest('a', [f.receipt]);
  expect(await f.store.markListed('a', [{ itemId: 11, definitionId: 111, listingTradeId: '2222', listedPrice: 350 }]))
    .toMatchObject({ status: 'observed', entries: 1, held: 1, sold: 0, spent: 200, grossRevenue: 0 });
  const ledger = await f.store.read('a');
  expect(ledger.ledger.entries[0]).toMatchObject({ state: 'listed', listingTradeId: '2222', listedPrice: 350 });
});

it('keeps missing, closed-without-isSold, and expired unsold items as cost', async () => {
  const f = fixture(); await f.store.ingest('a', [f.receipt]);
  for (const row of [null, { sold: null, state: 'closed', soldPrice: 900 }, { sold: false, expired: true, listedPrice: 900 }]) {
    const result = await f.store.reconcile('a', { status: 'observed', receipts: row ? [{ ...row, itemId: 11, definitionId: 111 }] : [] });
    expect(result).toMatchObject({ netRevenue: 0, netCost: 200 });
  }
});

it('rejects wrong versions, duplicate receipts, price conflicts and corrupt ledgers without overwriting evidence', async () => {
  const f = fixture(); await f.store.ingest('a', [f.receipt]); const before = structuredClone([...f.data]);
  expect(await f.store.reconcile('a', { status: 'observed', receipts: [{ itemId: 11, definitionId: 222, sold: true, soldPrice: 500 }] }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_NET_COST_IDENTITY_CONFLICT' });
  expect(await f.store.ingest('a', [{ ...f.receipt, purchasePrice: 300 }])).toMatchObject({ status: 'blocked' });
  expect([...f.data]).toEqual(before);
  f.data.set(galleryNetCostKey('a'), { schema: 0 });
  expect(await f.store.ingest('a', [f.receipt])).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_ACCOUNTING_INVALID' });
  expect(f.data.get(galleryNetCostKey('a'))).toEqual({ schema: 0 });
});

it('reports read and write failures distinctly and never reports unconfirmed persistence as income', async () => {
  const unavailable = createGalleryNetCostStore({ get: async () => { throw Error(); }, set: async () => {}, exclusive: async (_scope, task) => task() });
  expect(await unavailable.read('a')).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_ACCOUNTING_READ_FAILED' });
  const brokenWrite = createGalleryNetCostStore({ get: async () => null, set: async () => {}, exclusive: async (_scope, task) => task() });
  expect(await brokenWrite.ingest('a', [fixture().receipt])).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_ACCOUNTING_WRITE_FAILED' });
});

it('preserves long account scopes and rejects malformed entries instead of replacing them with an empty ledger', async () => {
  const f = fixture(), scope = `fcat:${'account-platform'.repeat(25)}`;
  expect(await f.store.ingest(scope, [f.receipt])).toMatchObject({ entries: 1, spent: 200 });
  expect(await f.store.read(scope)).toMatchObject({ ledger: { scope }, entries: 1 });
  const corrupt = { schema: 1, scope: 'a', entries: {} };
  f.data.set(galleryNetCostKey('a'), corrupt);
  expect(await f.store.ingest('a', [f.receipt])).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_ACCOUNTING_INVALID' });
  expect(f.data.get(galleryNetCostKey('a'))).toEqual(corrupt);
});

it('migrates the current validated purchase journal and uses one read-only sale refresh', async () => {
  const f = fixture(), { root } = executionRuntime();
  root.navigator = { locks: { request: async (name, _options, task) => task({ name, mode: 'exclusive' }) } };
  const context = readFc27Context(root), scope = traditionalJournalScope(context);
  const record = { schema: 1, scope, context, operationId: 'batch-a', binding: 'binding', plan: [{ definitionId: 111 }],
    entries: [{ definitionId: 111, itemId: 11, tradeId: '1111', price: 200, state: 'club' }] };
  f.data.set(galleryPurchaseKey(scope), record);
  const refresh = vi.fn(async () => ({ status: 'observed', receipts: [{ itemId: 11, definitionId: 111, sold: true, soldPrice: 500, listingTradeId: '9999' }] }));
  const service = createFc27GalleryAccounting({ root, get: f.get, set: f.set, adapterFactory: () => ({ refreshGallerySaleReceipts: refresh }) });
  expect(await service.inspect()).toMatchObject({ spent: 0 }); expect(refresh).not.toHaveBeenCalled();
  expect(await service.reconcile()).toMatchObject({ spent: 200, netCost: -275 }); expect(refresh).toHaveBeenCalledOnce();
  expect(await service.inspect()).toMatchObject({ sold: 1, netCost: -275 }); expect(refresh).toHaveBeenCalledOnce();
});
