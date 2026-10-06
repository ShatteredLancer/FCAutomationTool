import { createGalleryNetCostStore } from '../../gallery/net-cost-store.js';
import { galleryPurchaseKey, validateGalleryPurchaseRecord } from '../../gallery/purchase-session.js';
import { createFc27GallerySaleReader } from '../ea/fc27-gallery-sales.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { traditionalJournalScope } from '../../fc27/traditional-journal.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../fc27/traditional-lock.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createFc27GalleryAccounting({ root, get, set, adapterFactory = createFc27GallerySaleReader }) {
  const store = createGalleryNetCostStore({ get, set, exclusive: async (scope, task) => {
    if (typeof root.navigator?.locks?.request !== 'function') throw Error('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
    return root.navigator.locks.request(`${FC27_TRADITIONAL_WEB_LOCK}:gallery-accounting:${scope}`, { mode: 'exclusive' }, task);
  } });
  const environment = () => {
    const context = readFc27Context(root), scope = traditionalJournalScope(context);
    const assert = () => { if (!same(context, readFc27Context(root))) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); };
    return { context, scope, assert };
  };
  const observed = async task => {
    try { return await task(); }
    catch (error) { return { status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error.message) ? error.message : 'FC27_GALLERY_ACCOUNTING_UNAVAILABLE' }; }
  };
  const ingest = async (env, record) => {
    env.assert(); validateGalleryPurchaseRecord(record, env.scope, env.context);
    const receipts = record.entries.filter(row => ['bought', 'move-pending', 'move-rejected', 'club'].includes(row.state))
      .map(row => ({ itemId: row.itemId, definitionId: row.definitionId, tradeId: row.tradeId,
        purchasePrice: row.price, operationId: record.operationId }));
    const result = await store.ingest(env.scope, receipts); env.assert(); return result;
  };
  return Object.freeze({
    recordPurchase: record => observed(() => ingest(environment(), record)),
    recordListings: receipts => observed(async () => {
      const env = environment(); env.assert();
      const rows = Array.isArray(receipts) ? receipts.map(row => ({
        itemId: row.item?.id ?? row.itemId, definitionId: row.item?.definitionId ?? row.definitionId,
        listingTradeId: row.listingTradeId, listedPrice: row.buyNow,
      })) : receipts;
      const result = await store.markListed(env.scope, rows); env.assert(); return result;
    }),
    inspect: () => observed(async () => {
      const env = environment(), result = await store.read(env.scope); env.assert(); return result;
    }),
    reconcile: () => observed(async () => {
      const env = environment();
      const persistence = createFc27TransactionPersistence({ context: env.context, gmGetValue: get, gmSetValue: set, lockManager: root.navigator?.locks });
      return persistence.exclusive(env.scope, async () => {
        env.assert();
        const record = await get(galleryPurchaseKey(env.scope), null); env.assert();
        if (record) { const saved = await ingest(env, record); if (saved.status !== 'observed') return saved; }
        const ledger = await store.read(env.scope); env.assert();
        if (ledger.status !== 'observed' || !ledger.entries) return ledger;
        const snapshot = await adapterFactory(root).refreshGallerySaleReceipts(); env.assert();
        const result = await store.reconcile(env.scope, snapshot); env.assert(); return result;
      });
    }),
  });
}
