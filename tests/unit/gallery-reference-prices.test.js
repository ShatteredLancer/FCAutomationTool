import { it, expect, vi } from 'vitest';
import { normalizeGalleryPricePolicy, galleryReferenceQuote, createGalleryReferencePrices } from '../../src/gallery/reference-prices.js';

it('projects each requested TTL from original fetch time without mutating prior snapshots or failure cooldowns', async () => {
  let time = 1000;
  const readFutgg = vi.fn(async ids => ids.map(definitionId => ({ definitionId, price: 200 })));
  const service = createGalleryReferencePrices({ readFutgg, readFutbin: async () => null, now: () => time });
  const options = { platform: 'pc', sources: ['futgg'] };
  const first = await service.load([1], { ...options, quoteTtlMs: 60000 });
  time += 90000;
  const extended = await service.load([1], { ...options, quoteTtlMs: 600000 });
  expect(readFutgg).toHaveBeenCalledTimes(1);
  expect(extended.references[1].quotes.futgg).toMatchObject({ fetchedAt: 1000, expiresAt: 601000 });
  expect(first.expiresAt).toBe(61000);
  const shorter = await service.load([1], { ...options, quoteTtlMs: 60000 });
  expect(readFutgg).toHaveBeenCalledTimes(2);
  expect(shorter.expiresAt).toBe(time + 60000);
  readFutgg.mockRejectedValue(Error('offline'));
  const failed = await service.load([2], { ...options, quoteTtlMs: 1800000 });
  expect(failed.references[2].quotes.futgg.expiresAt).toBe(time + 30000);
  time += 10000;
  await service.load([2], { ...options, quoteTtlMs: 60000 });
  expect(readFutgg).toHaveBeenCalledTimes(3);
});

it('uses only the configured public source and computes fixed/percentage ceilings without rounding up', () => {
  expect(galleryReferenceQuote({ futgg: 200, futbin: 250, ea: 900 })).toMatchObject({ estimate: 200, maxBuy: 200 });
  expect(galleryReferenceQuote({ futgg: 200, futbin: 250 }, { source: 'futbin', premiumMode: 'fixed', premium: 75 })).toMatchObject({ estimate: 250, maxBuy: 325 });
  expect(galleryReferenceQuote({ futgg: 200, futbin: 250 }, { source: 'futgg', premiumMode: 'percent', premium: 12 })).toMatchObject({ estimate: 200, maxBuy: 224 });
  expect(galleryReferenceQuote({ futgg: 200, futbin: 250 }, { source: 'futbin', premiumMode: 'percent', premium: 10 })).toMatchObject({ estimate: 250, maxBuy: 275 });
  expect(galleryReferenceQuote({ futbin: 250, ea: 200 })).toMatchObject({ estimate: null, maxBuy: null });
  expect(normalizeGalleryPricePolicy()).toEqual({ source: 'futgg', premiumMode: 'fixed', premium: 0, purchaseAttempts: 3, futbinEnabled: true, futbinRefresh: 'cache', readSources: 'both', listingSource: 'futgg', quoteValidityMinutes: 5 });
  expect(() => normalizeGalleryPricePolicy({ source: 'lower' })).toThrow();
  expect(() => normalizeGalleryPricePolicy({ source: 'higher' })).toThrow();
  expect(normalizeGalleryPricePolicy({ purchaseAttempts: 21 }).purchaseAttempts).toBe(21);
  expect(() => normalizeGalleryPricePolicy({ source: 'ea' })).toThrow();
  expect(() => normalizeGalleryPricePolicy({ premium: -1 })).toThrow();
});

it('caches public references by platform/version, exposes both prices and never reads EA', async () => {
  let time = 1000;
  const readFutbin = vi.fn(async definitionId => ({ definitionId, price: 250, sourceUpdatedAt: null }));
  const readFutgg = vi.fn(async ids => ids.map(definitionId => ({ definitionId, price: 200, sourceUpdatedAt: 500 })));
  const get = vi.fn(async (_k, fallback) => fallback), set = vi.fn(async () => {});
  const service = createGalleryReferencePrices({ readFutbin, readFutgg, get, set, now: () => time, ttlMs: 1000 });
  const options = { season: '27', platform: 'pc', rows: [{ eaId: 1, overall: 80, nationEaId: 1, leagueEaId: 2, clubEaId: 3, positions: ['ST'] }] };
  const [a, b] = await Promise.all([service.load([1], options), service.load([1], options)]);
  expect(a.references[1]).toMatchObject({ futgg: 200, futbin: 250, estimate: 200, maxBuy: 200 });
  expect(b.freshPrices).toEqual({ 1: 200 }); expect(readFutbin).toHaveBeenCalledTimes(1);
  await service.load([1], options); expect(readFutbin).toHaveBeenCalledTimes(1);
  await service.load([1], { ...options, platform: 'console' }); expect(readFutbin).toHaveBeenCalledTimes(2);
  time += 1001; await service.load([1], options); expect(readFutbin).toHaveBeenCalledTimes(3);
});

it('does not replace an unavailable selected source with EA or the other source; respects cancellation', async () => {
  const readFutbin = vi.fn(async () => { throw Error('offline'); });
  const service = createGalleryReferencePrices({ readFutbin, readFutgg: async ids => ids.map(definitionId => ({ definitionId, price: 200 })) });
  const options = { season: '27', platform: 'pc', policy: { source: 'futbin' }, rows: [{ eaId: 1 }] };
  expect((await service.load([1], options)).freshPrices).toEqual({});
  expect((await service.load([1], options)).references[1]).toMatchObject({ futgg: 200, futbin: null });
  expect(readFutbin).toHaveBeenCalledTimes(1);
  await expect(service.load([2], { ...options, isCurrent: () => false })).rejects.toThrow('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
});

it('deduplicates overlapping sets, splits FUT.GG at 50 and reuses persisted exact-version quotes', async () => {
  const storage = new Map(), get = async (key, fallback) => storage.get(key) ?? fallback, set = async (key, row) => storage.set(key, row);
  const readFutbin = vi.fn(async definitionId => ({ definitionId, price: 250 }));
  const readFutgg = vi.fn(async ids => ids.map(definitionId => ({ definitionId, price: 200 })));
  const options = { platform: 'pc' }, args = { get, set, readFutbin, readFutgg, now: () => 1000 };
  const service = createGalleryReferencePrices(args), ids = Array.from({ length: 52 }, (_, i) => i + 1);
  await Promise.all([service.load(ids, options), service.load([1, 2, 53], options)]);
  expect(readFutgg.mock.calls.map(call => call[0].length)).toEqual([50, 2, 1]);
  expect(readFutbin).toHaveBeenCalledTimes(53);
  const restored = await createGalleryReferencePrices(args).load([1, 53], options);
  expect(restored.references[1].quotes.futgg).toMatchObject({ season: '27', platform: 'pc', fetchedAt: 1000, sourceUpdatedAt: null });
  expect(readFutbin).toHaveBeenCalledTimes(53);
  expect(readFutgg).toHaveBeenCalledTimes(3);
});

it('never renews an old price after a missing version, respects failure cooldown and rejects cache identity mismatch', async () => {
  let time = 1000;
  const data = new Map(), options = { platform: 'pc' };
  const readFutgg = vi.fn().mockResolvedValueOnce([{ definitionId: 1, price: 200 }]).mockResolvedValue([]);
  const readFutbin = vi.fn().mockResolvedValueOnce({ definitionId: 1, price: 250 })
    .mockRejectedValue(Object.assign(Error('FC27_PUBLIC_PRICE_HTTP_429'), { retryAt: 9000 }));
  const service = createGalleryReferencePrices({ readFutgg, readFutbin, now: () => time, ttlMs: 1000, failureTtlMs: 100,
    get: async (key, fallback) => data.get(key) ?? fallback, set: async (key, row) => data.set(key, row) });
  await service.load([1], options); time = 2001;
  const expired = await service.load([1, 2], options);
  expect(expired.freshPrices).toEqual({});
  expect(expired.references[1]).toMatchObject({ futgg: null, futbin: null, estimate: null });
  expect(readFutbin).toHaveBeenCalledTimes(2);
  await service.load([1], { ...options, force: true }); expect(readFutbin).toHaveBeenCalledTimes(2);
  expect(expired.references[1].quotes.futbin.expiresAt).toBe(9000);
  const bad = createGalleryReferencePrices({ readFutgg, readFutbin, now: () => time,
    get: async () => ({ schema: 2, source: 'futgg', season: '27', platform: 'console', definitionId: 1,
      price: 999, fetchedAt: 1900, expiresAt: 3000, error: null, sourceUpdatedAt: null }) });
  expect((await bad.load([1], options)).references[1].futgg).toBeNull();
});

it('cancels queued reads without treating cancellation as a missing quote', async () => {
  let active = true;
  const readFutgg = vi.fn(async ids => { active = false; return ids.map(definitionId => ({ definitionId, price: 200 })); });
  const readFutbin = vi.fn();
  const service = createGalleryReferencePrices({ readFutgg, readFutbin });
  await expect(service.load([1], { platform: 'pc', isCurrent: () => active })).rejects.toThrow('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
  expect(readFutbin).not.toHaveBeenCalled();
});

it('treats conflicting versions, duplicate rows and future timestamps as invalid instead of prices', async () => {
  for (const rows of [[{ definitionId: 99, price: 200 }], [{ definitionId: 1, price: 200 }, { definitionId: 1, price: 500 }],
    [{ definitionId: 1, price: 200, sourceUpdatedAt: 2000 }]]) {
    const service = createGalleryReferencePrices({ readFutgg: async () => rows, readFutbin: async () => null, now: () => 1000 });
    expect((await service.load([1], { platform: 'pc' })).references[1].quotes.futgg.error).toBe('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
  }
});

it('reports serial FUTBIN progress while reading and keeps caller edits out of the cache', async () => {
  const progress = [], readFutbin = vi.fn(async definitionId => {
    if (definitionId === 3) expect(progress).toContainEqual({ source: 'futbin', index: 2, total: 3 });
    return { definitionId, price: 250 };
  });
  const service = createGalleryReferencePrices({ readFutbin,
    readFutgg: async ids => ids.map(definitionId => ({ definitionId, price: 200 })) });
  const first = await service.load([1,2,3], { platform: 'pc', onProgress: row => progress.push(row) });
  first.references[1].quotes.futgg.price = 999;
  expect((await service.load([1], { platform: 'pc' })).references[1].futgg).toBe(200);
  expect(readFutbin).toHaveBeenCalledTimes(3);
});

it('ignores legacy forced FUTBIN preference, reuses cache and still permits explicit refresh', async () => {
  let time = 1000;
  const readFutgg = vi.fn(async ids => ids.map(definitionId => ({ definitionId, price: 200 })));
  const readFutbin = vi.fn(async definitionId => ({ definitionId, price: 250 }));
  const service = createGalleryReferencePrices({ readFutgg, readFutbin, now: () => time, ttlMs: 10000 });
  const base = { season: '27', platform: 'pc', rows: [{ eaId: 1 }] };
  const first = await service.load([1], { ...base, sources: ['futgg'] });
  expect(readFutgg).toHaveBeenCalledTimes(1); expect(readFutbin).not.toHaveBeenCalled();
  expect(first.references[1].quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_SOURCE_NOT_REQUESTED');
  await service.load([1], { ...base, sources: ['futbin'], policy: { source: 'futbin', futbinRefresh: 'force' } });
  expect(readFutbin).toHaveBeenCalledTimes(1);
  time += 1;
  await service.load([1], { ...base, sources: ['futbin'], policy: { source: 'futbin', futbinRefresh: 'force' } });
  expect(readFutbin).toHaveBeenCalledTimes(1);
  await service.load([1], { ...base, sources: ['futbin'], force: true });
  expect(readFutbin).toHaveBeenCalledTimes(2);
  expect(readFutgg).toHaveBeenCalledTimes(1);
});

it('projects concurrent and restored cache reads using each caller lifetime', async () => {
  const data = new Map();
  const readFutgg = vi.fn(async ids => ids.map(definitionId => ({ definitionId, price: 200 })));
  const args = { readFutgg, now: () => 1000, get: async key => data.get(key),
    set: async (key, row) => data.set(key, structuredClone(row)) };
  const service = createGalleryReferencePrices(args), base = { platform: 'pc', sources: ['futgg'] };
  const [long, short] = await Promise.all([
    service.load([1], { ...base, quoteTtlMs: 1800000 }),
    service.load([1], { ...base, quoteTtlMs: 60000 }),
  ]);
  expect(long.expiresAt).toBe(1801000);
  expect(short.expiresAt).toBe(61000);
  const restored = await createGalleryReferencePrices({ ...args, now: () => 62000 })
    .load([1], { ...base, quoteTtlMs: 300000 });
  expect(restored.expiresAt).toBe(301000);
  expect(restored.references[1].quotes.futgg.fetchedAt).toBe(1000);
  expect(readFutgg).toHaveBeenCalledTimes(1);
  expect(long.expiresAt).toBe(1801000);
  expect(short.expiresAt).toBe(61000);
});

it('does not read FUTBIN when the account policy disables it', async () => {
  const readFutbin = vi.fn(async id => ({ definitionId: id, price: 250 }));
  const readFutgg = vi.fn(async ids => ids.map(definitionId => ({ definitionId, price: 200 })));
  const service = createGalleryReferencePrices({ readFutgg, readFutbin });
  const result = await service.load([1], { platform: 'pc', policy: { futbinEnabled: false } });
  expect(readFutgg).toHaveBeenCalledTimes(1);
  expect(readFutbin).not.toHaveBeenCalled();
  expect(result.requestedSources).toEqual(['futgg']);
  expect(result.references[1].quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_SOURCE_NOT_REQUESTED');
});
