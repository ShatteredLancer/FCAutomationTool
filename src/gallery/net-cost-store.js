import { createGalleryNetCostLedger, normalizeGalleryNetCostLedger, recordGalleryPurchase,
  recordGallerySale, summarizeGalleryNetCost } from './net-cost.js';

export const galleryNetCostKey = scope => `fcat-fc27-gallery-net-cost-v1:${scope}`;
const fail = reason => { throw Error(reason); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createGalleryNetCostStore({ get, set, exclusive, now = () => Date.now() }) {
  const load = async scope => {
    let raw;
    try { raw = await get(galleryNetCostKey(scope), null); } catch { fail('FC27_GALLERY_ACCOUNTING_READ_FAILED'); }
    if (raw == null) return createGalleryNetCostLedger({ scope });
    const value = normalizeGalleryNetCostLedger(raw);
    if (!value || value.scope !== scope || value.entries.length > 5000) fail('FC27_GALLERY_ACCOUNTING_INVALID');
    return value;
  };
  const write = async (scope, ledger) => {
    if (ledger.entries.length > 5000) fail('FC27_GALLERY_ACCOUNTING_FULL');
    try {
      await set(galleryNetCostKey(scope), ledger);
      if (!same(await get(galleryNetCostKey(scope), null), ledger)) fail('FC27_GALLERY_ACCOUNTING_WRITE_FAILED');
    } catch { fail('FC27_GALLERY_ACCOUNTING_WRITE_FAILED'); }
  };
  const run = async (scope, task) => {
    try {
      if (typeof scope !== 'string' || !scope) fail('FC27_GALLERY_CONTEXT_CHANGED');
      return await exclusive(scope, async () => task(await load(scope)));
    } catch (error) { return { status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error.message) ? error.message : 'FC27_GALLERY_ACCOUNTING_UNAVAILABLE' }; }
  };
  return Object.freeze({
    read: scope => run(scope, async ledger => ({ ...summarizeGalleryNetCost(ledger), ledger })),
    ingest: (scope, receipts) => run(scope, async ledger => {
      let next = ledger;
      for (const receipt of receipts) {
        const result = recordGalleryPurchase(next, receipt);
        if (result.status === 'blocked') fail(result.reason);
        next = result.ledger;
      }
      if (!same(next, ledger)) await write(scope, next);
      return { ...summarizeGalleryNetCost(next), ledger: next };
    }),
    markListed: (scope, receipts) => run(scope, async ledger => {
      if (!Array.isArray(receipts)) fail('FC27_GALLERY_ACCOUNTING_LISTING_UNCONFIRMED');
      let next = ledger;
      for (const receipt of receipts) {
        const result = recordGallerySale(next, { ...receipt, state: 'listed' });
        if (result.status === 'blocked') fail(result.reason);
        next = result.ledger;
      }
      if (!same(next, ledger)) await write(scope, next);
      return { ...summarizeGalleryNetCost(next), ledger: next };
    }),
    reconcile: (scope, snapshot) => run(scope, async ledger => {
      if (snapshot?.status !== 'observed' || !Array.isArray(snapshot.receipts)
        || new Set(snapshot.receipts.map(row => row.itemId)).size !== snapshot.receipts.length) fail('FC27_GALLERY_SALES_UNCONFIRMED');
      let next = ledger, unknown = 0;
      const rows = new Map(snapshot.receipts.map(row => [row.itemId, row]));
      for (const entry of ledger.entries) {
        if (entry.state === 'sold') continue;
        const row = rows.get(entry.itemId);
        if (!row) { if (['listed', 'unsold', 'unknown'].includes(entry.state)) unknown++; continue; }
        if (row.definitionId !== entry.definitionId) fail('FC27_GALLERY_NET_COST_IDENTITY_CONFLICT');
        const sale = { itemId: entry.itemId, definitionId: entry.definitionId, listingTradeId: row.listingTradeId,
          listedPrice: row.listedPrice };
        if (row.sold === true && row.listingTradeId) Object.assign(sale, { state: 'sold', soldPrice: row.soldPrice, soldAt: now() });
        else if (row.sold === false && row.expired === true) sale.state = 'unsold';
        else if (row.sold === false && row.state === 'active') sale.state = 'listed';
        else { unknown++; continue; }
        const result = recordGallerySale(next, sale);
        if (result.status === 'blocked') fail(result.reason);
        next = result.ledger;
      }
      if (!same(next, ledger)) await write(scope, next);
      return { ...summarizeGalleryNetCost(next), ledger: next, unknown };
    }),
  });
}
