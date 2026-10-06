import { expect, it } from 'vitest';
import {
  createGalleryNetCostLedger, galleryNetSale, normalizeGalleryNetCostLedger,
  recordGalleryPurchase, recordGallerySale, summarizeGalleryNetCost,
} from '../../src/gallery/net-cost.js';

const receipt = (itemId = 11, price = 200) => ({ itemId, definitionId: itemId + 100, tradeId: String(itemId + 1000), purchasePrice: price });

it('keeps exact purchase identity and is idempotent', () => {
  let ledger = createGalleryNetCostLedger({ scope: 'account-a' });
  const first = recordGalleryPurchase(ledger, receipt()); expect(first.status).toBe('recorded'); ledger = first.ledger;
  expect(recordGalleryPurchase(ledger, receipt()).status).toBe('unchanged');
  expect(recordGalleryPurchase(ledger, { ...receipt(), purchasePrice: 300 }).reason).toBe('FC27_GALLERY_NET_COST_IDENTITY_CONFLICT');
});

it('does not count a listing as revenue until an exact sold receipt arrives', () => {
  let ledger = createGalleryNetCostLedger(); ledger = recordGalleryPurchase(ledger, receipt()).ledger;
  ledger = recordGallerySale(ledger, { itemId: 11, state: 'listed', listedPrice: 1000 }).ledger;
  expect(summarizeGalleryNetCost(ledger)).toMatchObject({ spent: 200, grossRevenue: 0, netCost: 200, held: 1 });
  ledger = recordGallerySale(ledger, { itemId: 11, state: 'sold', soldPrice: 1000, soldAt: 20 }).ledger;
  expect(summarizeGalleryNetCost(ledger)).toMatchObject({ spent: 200, grossRevenue: 1000, tax: 50, netRevenue: 950, netCost: -750, heldCost: 0 });
});

it('rejects unknown or ambiguous sale identities and preserves unsold cost', () => {
  const ledger = createGalleryNetCostLedger({ entries: [receipt()] });
  expect(recordGallerySale(ledger, { itemId: 99, state: 'sold', soldPrice: 500 }).reason).toBe('FC27_GALLERY_NET_COST_IDENTITY_UNKNOWN');
  expect(recordGallerySale(ledger, { itemId: 11, state: 'sold' }).reason).toBe('FC27_GALLERY_NET_COST_SALE_INVALID');
  const result = recordGallerySale(ledger, { itemId: 11, state: 'unsold', listedPrice: 500 });
  expect(summarizeGalleryNetCost(result.ledger)).toMatchObject({ netCost: 200, heldCost: 200 });
});

it('uses configurable tax basis points and rejects malformed ledgers', () => {
  expect(galleryNetSale(1000, 750)).toBe(925);
  expect(normalizeGalleryNetCostLedger({ schema: 1, taxBps: 500, entries: [{ ...receipt(), itemId: 1 }, { ...receipt(), itemId: 1 }] })).toBeNull();
  expect(summarizeGalleryNetCost({ schema: 1, taxBps: 500, entries: [] })).toMatchObject({ status: 'observed', netCost: 0 });
  expect(normalizeGalleryNetCostLedger({ schema: 1, entries: [{ ...receipt(), state: 'sold' }] })).toBeNull();
});

it('preserves confirmed sold receipts against later stale snapshots and rejects conflicting resale facts', () => {
  const ledger = createGalleryNetCostLedger({ entries: [receipt()] });
  const sold = recordGallerySale(ledger, { itemId: 11, definitionId: 111, state: 'sold', soldPrice: 500, listingTradeId: '999' }).ledger;
  expect(recordGallerySale(sold, { itemId: 11, definitionId: 111, state: 'listed', listedPrice: 200 })).toMatchObject({ status: 'unchanged' });
  expect(recordGallerySale(sold, { itemId: 11, definitionId: 111, state: 'sold', soldPrice: 600 })).toMatchObject({ status: 'blocked' });
  expect(recordGallerySale(sold, { itemId: 11, definitionId: 222, state: 'sold', soldPrice: 500 })).toMatchObject({ status: 'blocked' });
});
