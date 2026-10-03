import { expect, it, vi } from 'vitest';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { planGalleryListingPrices, projectGalleryListingCandidates, projectGalleryListingReceipts, readGalleryListingSource } from '../../src/gallery/listing-candidates.js';
import { galleryPurchaseKey, galleryPurchasePendingKey } from '../../src/gallery/purchase-session.js';

const context = { schema: 1, season: '27', accountScope: 'fixture-account', platform: 'pc:fixture' };
const scope = traditionalJournalScope(context);
const tiers = [
  { min: 100000, inc: 1000 }, { min: 50000, inc: 500 }, { min: 10000, inc: 250 },
  { min: 1000, inc: 100 }, { min: 150, inc: 50 },
];
const items = [
  { id: 11, definitionId: 101, pile: 'club', tradeable: true, eligibleForListing: true },
  { id: 12, definitionId: 102, pile: 'club', tradeable: true, eligibleForListing: true },
];
function journal() {
  const plan = [{ definitionId: 101, name: 'A' }, { definitionId: 102, name: 'B' }];
  return { schema: 1, scope, context, operationId: 'op-1', binding: 'set-revision', budget: null, plan,
    entries: [
      { itemId: 11, definitionId: 101, tradeId: '9001', price: 200, state: 'club' },
      { itemId: 12, definitionId: 102, tradeId: '9002', price: 250, state: 'club' },
    ], collection: { status: 'confirmed', confirmed: 2, total: 2 } };
}

it('projects only exact bought, moved and collection-confirmed purchase receipts', () => {
  const source = projectGalleryListingReceipts({ purchase: journal(), scope, context,
    expectedOperationId: 'op-1', expectedBinding: 'set-revision' });
  expect(source).toMatchObject({ status: 'observed', operationId: 'op-1', executionEnabled: false, entries: [
    { itemId: 11, definitionId: 101, tradeId: '9001', purchasePrice: 200 },
    { itemId: 12, definitionId: 102, tradeId: '9002', purchasePrice: 250 },
  ] });
  const candidates = projectGalleryListingCandidates({ source, items });
  expect(candidates).toMatchObject({ status: 'observed', count: 2, executionEnabled: false });
  expect(candidates.entries[0].item).toEqual({ id: 11, definitionId: 101, pile: 'club' });
});

it.each(['scope', 'context', 'operationId', 'binding', 'duplicate-item', 'duplicate-trade', 'string-id', 'missing-plan', 'oversized-price'])
('rejects %s receipt corruption without producing listing entries', kind => {
  const purchase = journal();
  if (kind === 'scope') purchase.scope = 'other';
  if (kind === 'context') purchase.context = { ...context, accountScope: 'other' };
  if (kind === 'operationId') purchase.operationId = 'other';
  if (kind === 'binding') purchase.binding = 'other';
  if (kind === 'duplicate-item') purchase.entries[1].itemId = purchase.entries[0].itemId;
  if (kind === 'duplicate-trade') purchase.entries[1].tradeId = purchase.entries[0].tradeId;
  if (kind === 'string-id') purchase.entries[0].itemId = '11';
  if (kind === 'missing-plan') delete purchase.plan;
  if (kind === 'oversized-price') purchase.entries[0].price = 15000001;
  expect(projectGalleryListingReceipts({ purchase, scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision' }))
    .toMatchObject({ status: 'blocked', entries: [] });
});

it.each(['buy-pending', 'bought', 'move-pending', 'move-rejected'])('blocks whole source with %s recovery outstanding', state => {
  const purchase = journal(); purchase.entries[1].state = state;
  expect(projectGalleryListingReceipts({ purchase, scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision' }))
    .toMatchObject({ reason: 'FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED', entries: [] });
});

it('reads the stable scoped journal under the shared lock without mutation, and supports repeated reads', async () => {
  const record = journal(), before = structuredClone(record), key = galleryPurchaseKey(scope), pendingKey = galleryPurchasePendingKey(scope);
  const get = vi.fn(async (storageKey, fallback) => storageKey === key ? record : fallback);
  const assertCurrent = vi.fn(), exclusive = vi.fn(async (_scope, task) => task());
  const args = { scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision', get, exclusive, assertCurrent };
  const first = await readGalleryListingSource(args);
  expect(first.status).toBe('observed');
  first.entries[0].itemId = 999;
  expect((await readGalleryListingSource(args)).entries[0].itemId).toBe(11);
  expect(record).toEqual(before);
  expect(exclusive).toHaveBeenCalledTimes(2);
  expect(get.mock.calls.map(([key]) => key)).toEqual([key, pendingKey, key, pendingKey, key, pendingKey, key, pendingKey]);
});

it.each(['account', 'journal', 'pending-marker', 'lock', 'storage'])('discards reads on %s changes/failure', async kind => {
  let reads = 0;
  const args = { scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision',
    get: async key => {
      reads++;
      if (kind === 'storage') throw Error('sensitive storage details');
      if (key === galleryPurchasePendingKey(scope)) return kind === 'pending-marker' ? { schema: 1, operationId: 'op-1' } : null;
      const record = journal(); if (kind === 'journal' && reads > 2) record.entries[0].price = 300;
      return record;
    }, exclusive: async (_scope, task) => kind === 'lock' ? null : task(),
    assertCurrent: () => { if (kind === 'account' && reads > 0) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); } };
  expect(await readGalleryListingSource(args)).toMatchObject({ status: 'blocked', entries: [] });
});

it('projects partial success without selling preexisting skipped cards or siblings', () => {
  const purchase = journal(); purchase.entries[1] = { definitionId: 102, state: 'waiting' };
  const source = projectGalleryListingReceipts({ purchase, scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision' });
  expect(source.entries).toHaveLength(1);
  expect(source.skipped).toEqual([{ definitionId: 102, reason: 'not-purchased' }]);
  expect(projectGalleryListingCandidates({ source, items: [{ ...items[0], id: 88 }] }).entries).toEqual([]);
  expect(projectGalleryListingCandidates({ source, items: [items[0], items[0]] }).status).toBe('blocked');
});

it('blocks foreign, changed, pending and unconfirmed purchase journals', () => {
  expect(projectGalleryListingReceipts({ purchase: journal(), scope, context, expectedOperationId: 'other', expectedBinding: 'set-revision' }).status).toBe('blocked');
  const pending = journal(); pending.entries[0].state = 'move-pending';
  expect(projectGalleryListingReceipts({ purchase: pending, scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision' }).reason).toBe('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
  const collected = journal(); collected.entries[0].state = 'collected';
  const result = projectGalleryListingReceipts({ purchase: collected, scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision' });
  expect(result.entries).toHaveLength(1);
  expect(result.skipped[0].reason).toBe('already-collected-not-purchased');
  const unconfirmed = journal(); unconfirmed.collection.status = 'pending';
  expect(projectGalleryListingReceipts({ purchase: unconfirmed, scope, context, expectedOperationId: 'op-1', expectedBinding: 'set-revision' }).reason).toBe('FC27_GALLERY_COLLECTION_UNCONFIRMED');
});

it('requires exact fresh Club identities and confirmed tradeability/protection facts', () => {
  const source = projectGalleryListingReceipts({ purchase: journal(), scope, context,
    expectedOperationId: 'op-1', expectedBinding: 'set-revision' });
  expect(projectGalleryListingCandidates({ source, items: [{ ...items[0], definitionId: 999 }, items[1]] }).skipped)
    .toContainEqual(expect.objectContaining({ itemId: 11, reason: 'purchased-item-not-found' }));
  expect(projectGalleryListingCandidates({ source, items: [{ ...items[0], eligibleForListing: false }, items[1]] }).skipped)
    .toContainEqual(expect.objectContaining({ itemId: 11, reason: 'listing-protection-unconfirmed' }));
  expect(projectGalleryListingCandidates({ source, items: [{ ...items[0], pile: 'transfer' }, items[1]] }).skipped)
    .toContainEqual(expect.objectContaining({ itemId: 11, reason: 'purchased-item-no-longer-in-club' }));
});

it('matches Enhancer percentage, fixed, step, Start Bid and duration behavior', () => {
  const source = projectGalleryListingReceipts({ purchase: journal(), scope, context,
    expectedOperationId: 'op-1', expectedBinding: 'set-revision' });
  const candidates = projectGalleryListingCandidates({ source, items }).entries;
  const quotes = new Map([[101, { price: 1000 }], [102, { price: 2000 }]]);
  const limits = new Map([[11, { status: 'loaded', minimum: 150, maximum: 10000 }], [12, { status: 'loaded', minimum: 150, maximum: 10000 }]]);
  const pct = planGalleryListingPrices({ candidates, marketPrices: quotes, limitsByItem: limits, priceTiers: tiers, random: () => 0 });
  expect(pct.entries.map(entry => [entry.startPrice, entry.buyNow, entry.durationSeconds])).toEqual([[950, 1000, 3600], [1900, 2000, 3600]]);
  const fixed = planGalleryListingPrices({ candidates, settings: { priceMode: 'fixed', fixedPrice: 777, fixedStartPrice: 700 }, marketPrices: quotes, limitsByItem: limits, priceTiers: tiers });
  expect(fixed.entries[0]).toMatchObject({ startPrice: 700, buyNow: 777 });
  const steps = planGalleryListingPrices({ candidates: candidates.slice(0, 1), marketPrices: quotes, settings: { priceMode: 'steps', steps: 1 }, limitsByItem: limits, priceTiers: tiers });
  expect(steps.entries[0]).toMatchObject({ startPrice: 1000, buyNow: 1100 });
  const randomPct = planGalleryListingPrices({ candidates: candidates.slice(0, 1), marketPrices: quotes,
    settings: { percentageRange: [99, 101], durationSeconds: 86400 }, limitsByItem: limits, priceTiers: tiers, random: () => 0.51 });
  expect(randomPct.entries[0]).toMatchObject({ buyNow: 1000, durationSeconds: 86400 });
});

it('skips absent market data, unknown EA limits and prices outside EA limits without clamping', () => {
  const source = projectGalleryListingReceipts({ purchase: journal(), scope, context,
    expectedOperationId: 'op-1', expectedBinding: 'set-revision' });
  const candidates = projectGalleryListingCandidates({ source, items }).entries;
  const quotes = new Map([[101, 1000], [102, 2000]]);
  expect(planGalleryListingPrices({ candidates, marketPrices: new Map(), limitsByItem: new Map(), priceTiers: tiers }).skipped)
    .toContainEqual(expect.objectContaining({ itemId: 11, reason: 'market-price-unavailable' }));
  expect(planGalleryListingPrices({ candidates, marketPrices: quotes, limitsByItem: new Map(), priceTiers: tiers }).skipped)
    .toContainEqual(expect.objectContaining({ itemId: 11, reason: 'price-limits-unavailable' }));
  const limited = new Map([[11, { status: 'loaded', minimum: 150, maximum: 500 }], [12, { status: 'loaded', minimum: 150, maximum: 10000 }]]);
  const outcome = planGalleryListingPrices({ candidates, marketPrices: quotes, limitsByItem: limited, priceTiers: tiers });
  expect(outcome.entries).toHaveLength(1);
  expect(outcome.skipped).toContainEqual(expect.objectContaining({ itemId: 11, reason: 'price-out-of-range' }));
});
