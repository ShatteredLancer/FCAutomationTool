import { expect, it, vi } from 'vitest';
import { galleryListingEvidence, reconcileGalleryListings } from '../../src/gallery/listing-readback.js';
import { createEaTradeAdapter } from '../../src/adapters/ea/trade.js';
import { assertNoGalleryListingPending, createGalleryBulkListSession, galleryBulkListKey } from '../../src/gallery/bulk-list-session.js';

const entry = () => ({ item: { id: 1, definitionId: 101, pile: 'club' }, startPrice: 150, buyNow: 200,
  durationSeconds: 3600, status: 'unknown', reason: 'unconfirmed', response: { success: true, status: 200 } });
const seen = () => ({ status: 'loaded', candidate: { item: { id: 1, definitionId: 101, pile: 'transfer' },
  auction: { state: 'active', startingBid: 150, buyNowPrice: 200, tradeId: '901' } } });
const harness = () => ({ refreshTransferItems: vi.fn(async () => ({ status: 'completed' })),
  inspectListingItem: vi.fn(() => seen()), listItem: vi.fn(() => { throw Error('must not list'); }),
  routePurchasedItem: vi.fn(() => { throw Error('must not move'); }), acquireRequestPermit: vi.fn(() => { throw Error('must not acquire'); }) });

it.each(['id', 'definitionId', 'pile', 'startingBid', 'buyNowPrice', 'tradeId', 'state'])('preserves an unknown when %s does not match', async field => {
  const adapter = harness(), value = seen(), record = entry();
  if (['id', 'definitionId'].includes(field)) value.candidate.item[field]++;
  else if (field === 'pile') value.candidate.item.pile = 'club';
  else value.candidate.auction[field] = field === 'state' ? 'inactive' : field === 'tradeId' ? 'invalid' : 999;
  adapter.inspectListingItem.mockReturnValue(value);
  const before = structuredClone(record), checks = [];
  expect(await reconcileGalleryListings([record], { adapter, sleep: async () => {}, onCheck: row => checks.push(row) })).toMatchObject({ complete: false });
  expect(record).toEqual(before); expect(adapter.refreshTransferItems.mock.calls.length).toBeLessThanOrEqual(3);
  expect(adapter.listItem).not.toHaveBeenCalled(); expect(adapter.routePurchasedItem).not.toHaveBeenCalled();
  expect(JSON.stringify(checks)).not.toMatch(/definitionId|account|tradeId|fingerprint/);
});
it.each([null, { success: false, status: 500 }, { success: true, status: 403 }])('does not clear a closed auction without an accepted 2xx receipt: %j', response => {
  const record = { ...entry(), response }, value = seen(); value.candidate.auction.state = 'closed';
  expect(galleryListingEvidence(record, value)).toMatchObject({ mismatch: 'auction-closed' });
});
it.each([408, 429, 500, 503])('does not accept HTTP %i as fresh evidence even when cached data matches', async code => {
  const adapter = harness(), record = entry();
  adapter.refreshTransferItems.mockResolvedValue({ status: 'completed', response: { status: code } });
  expect(await reconcileGalleryListings([record], { adapter, sleep: async () => {} })).toMatchObject({ complete: false });
  expect(adapter.refreshTransferItems).toHaveBeenCalledTimes(code === 429 ? 1 : 3);
  expect(adapter.inspectListingItem).not.toHaveBeenCalled(); expect(record.status).toBe('unknown');
});
it.each([401, 403, 427, 429])('stops readonly recovery immediately for HTTP %i', async code => {
  const adapter = harness(), sleep = vi.fn(), record = entry();
  adapter.refreshTransferItems.mockResolvedValue({ status: 'rejected', error: { code } });
  expect(await reconcileGalleryListings([record], { adapter, sleep })).toMatchObject({ complete: false });
  expect(adapter.refreshTransferItems).toHaveBeenCalledOnce(); expect(sleep).not.toHaveBeenCalled();
  expect(record.status).toBe('unknown'); expect(adapter.listItem).not.toHaveBeenCalled();
});
it('uses at most three refreshes across all pending entries, not three per card', async () => {
  const adapter = harness(), waits = [], records = Array.from({ length: 10 }, () => entry());
  adapter.inspectListingItem.mockReturnValue({ status: 'not-found' });
  expect(await reconcileGalleryListings(records, { adapter, sleep: async ms => waits.push(ms) })).toEqual({ complete: false, confirmed: 0 });
  expect(waits).toEqual([1000, 2000]); expect(adapter.refreshTransferItems).toHaveBeenCalledTimes(3);
  expect(records.every(e => e.status === 'unknown')).toBe(true);
});
it('keeps Stop and changed-account boundaries during the retry wait', async () => {
  const adapter = harness(); adapter.inspectListingItem.mockReturnValue({ status: 'not-found' });
  let stopped = false;
  expect(await reconcileGalleryListings([entry()], { adapter, shouldStop: () => stopped, sleep: async () => { stopped = true; } }))
    .toMatchObject({ complete: false });
  expect(adapter.refreshTransferItems).toHaveBeenCalledOnce();
  let changed = false; adapter.refreshTransferItems.mockClear();
  await expect(reconcileGalleryListings([entry()], { adapter, assertCurrent: () => { if (changed) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); },
    sleep: async () => { changed = true; } })).rejects.toThrow('FC27_GALLERY_CONTEXT_CHANGED');
  expect(adapter.refreshTransferItems).toHaveBeenCalledOnce(); expect(adapter.listItem).not.toHaveBeenCalled();
});
it('retries transient refresh errors as reads, retaining the exact acknowledgement and prices', async () => {
  const adapter = harness(), record = entry();
  adapter.refreshTransferItems.mockRejectedValueOnce(Object.assign(Error('network'), { status: 503 }));
  expect(await reconcileGalleryListings([record], { adapter, sleep: async () => {} })).toEqual({ complete: true, confirmed: 1 });
  expect(record).toMatchObject({ status: 'accepted', listingTradeId: '901', startPrice: 150, buyNow: 200, response: { success: true, status: 200 } });
  expect(adapter.refreshTransferItems).toHaveBeenCalledTimes(2); expect(adapter.listItem).not.toHaveBeenCalled();
});
it.each([true, false])('reconciles old-batch evidence together and preserves unresolved entries: allVisible=%s', async allVisible => {
  const adapter = harness(), context = { account: 'synthetic' }, scope = 'old-batch', key = galleryBulkListKey(scope);
  let stored = { schema: 1, scope, context, runId: 'old-run', binding: 'old-purchase', status: 'recovery-required', delaySeconds: [3, 5],
    entries: [1, 2].map(id => ({ ...entry(), item: { id, definitionId: 100 + id, pile: 'club' }, purchaseTradeId: String(5000 + id) })) };
  const before = structuredClone(stored), waits = [];
  adapter.inspectListingItem.mockImplementation(ref => adapter.refreshTransferItems.mock.calls.length === 1 || !allVisible && ref.id === 2
    ? { status: 'not-found' } : { status: 'loaded', candidate: { ...seen().candidate, item: ref,
      auction: { ...seen().candidate.auction, state: 'closed', tradeId: String(9000 + ref.id) } } });
  const get = async (requestedKey, fallback) => requestedKey === key ? structuredClone(stored) : fallback;
  const options = { set: async (requestedKey, value) => { expect(requestedKey).toBe(key); stored = structuredClone(value); },
    context, assertCurrent: () => {}, createAdapter: () => adapter, sleep: async ms => waits.push(ms) };
  const recovery = assertNoGalleryListingPending(get, scope, options);
  if (allVisible) await expect(recovery).resolves.toBeUndefined();
  else await expect(recovery).rejects.toThrow('FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED');
  expect(adapter.refreshTransferItems).toHaveBeenCalledTimes(allVisible ? 2 : 3);
  expect(waits).toEqual(allVisible ? [1000] : [1000, 2000]);
  expect(stored.entries[0]).toMatchObject({ status: 'accepted', listingState: 'closed', listingTradeId: '9001', response: before.entries[0].response });
  expect(stored.entries[1]).toMatchObject(allVisible ? { status: 'accepted' } : before.entries[1]);
  expect(stored.status).toBe(allVisible ? 'completed' : 'recovery-required');
  expect(adapter.listItem).not.toHaveBeenCalled(); expect(adapter.routePurchasedItem).not.toHaveBeenCalled();
  expect(adapter.acquireRequestPermit).not.toHaveBeenCalled();
});
it('runs delayed visibility through the actual EA trade adapter and durable Session, then reloads without a second list call', async () => {
  let listed = false, refreshes = 0;
  const item = { id: 1, definitionId: 101, type: 'player', tradeable: true, loans: -1,
    _itemPriceLimits: { minimum: 150, maximum: 1000 },
    getAuctionData: () => listed ? { tradeState: 'active', startingBid: 150, buyNowPrice: 200, tradeId: '901' } : null };
  const list = vi.fn(async () => ({ success: true, status: 200 }));
  const runtime = { repositories: { Item: { club: { items: { _collection: [item] } },
    getTransferItems: () => listed ? [item] : [], getPileSize: () => 100, numItemsInCache: () => listed ? 1 : 0 } },
    services: { Item: { list, requestTransferItems: async () => { if (++refreshes >= 2) listed = true; return { success: true, status: 200 }; } } } };
  const values = new Map(), io = { get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => values.set(key, structuredClone(value)), exclusive: async (_scope, task) => task(),
    scope: 'fixture', context: { account: 'fixture' }, sleep: async () => {} };
  const first = createGalleryBulkListSession({ ...io, tradeAdapter: createEaTradeAdapter(runtime) });
  const selected = { ...entry(), purchase: { tradeId: 1001 } };
  const result = await first.execute({ approved: true, binding: 'fixture', entries: [selected] });
  expect(result).toMatchObject({ status: 'completed', accepted: 1 }); expect(refreshes).toBe(2); expect(list).toHaveBeenCalledOnce();
  const reloaded = createGalleryBulkListSession({ ...io, tradeAdapter: createEaTradeAdapter(runtime) });
  expect(await reloaded.execute({ approved: true, resume: true, expectedRunId: result.runId })).toMatchObject({ status: 'completed', accepted: 1 });
  expect(list).toHaveBeenCalledOnce(); expect(refreshes).toBe(2);
});
