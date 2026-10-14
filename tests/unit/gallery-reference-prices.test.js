import { it, expect, vi } from 'vitest';
import { normalizeGalleryPricePolicy, galleryReferenceQuote, createGalleryReferencePrices } from '../../src/gallery/reference-prices.js';

it('returns a bounded immutable planning snapshot while retaining ownership of outstanding workers', async () => {
  vi.useFakeTimers();
  try {
    const start = Date.now(), finishes = new Map();
    const readFutbin = vi.fn(id => id === 1 ? Promise.resolve({ definitionId: id, price: 1000 })
      : new Promise(resolve => finishes.set(id, resolve)));
    const service = createGalleryReferencePrices({ readFutbin });
    const options = { platform: 'pc', sources: ['futbin'], policy: { source: 'futbin' } };
    const loading = service.load([1, 2, 3, 4, 5], { ...options, deadlineAt: start + 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const snapshot = await loading;
    expect(snapshot.budgetExpired).toBe(true);
    expect(snapshot.prices).toEqual({ 1: 1000 });
    expect(readFutbin).toHaveBeenCalledTimes(4); // Three held workers; no request #5 after the deadline.
    const later = service.load([9], options);
    await vi.advanceTimersByTimeAsync(10);
    expect(readFutbin).toHaveBeenCalledTimes(4);
    for (const [id, finish] of finishes) finish({ definitionId: id, price: 1100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(readFutbin).toHaveBeenCalledTimes(5);
    finishes.get(9)({ definitionId: 9, price: 1200 });
    expect((await later).prices).toEqual({ 9: 1200 });
    expect(snapshot.prices).toEqual({ 1: 1000 });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('does not turn a local deadline into a source cooldown or a reusable error cache', async () => {
  let time = 100;
  const readFutbin = vi.fn(async definitionId => {
    if (readFutbin.mock.calls.length === 1) { time = 200; throw Error('FC27_STREAMLINED_QUOTE_BUDGET'); }
    return { definitionId, price: 1000 };
  });
  const service = createGalleryReferencePrices({ readFutbin, now: () => time });
  const options = { platform: 'pc', sources: ['futbin'], policy: { source: 'futbin' } };
  expect(await service.load([1, 2], { ...options, deadlineAt: 150 })).toMatchObject({ prices: {}, budgetExpired: true });
  expect(readFutbin).toHaveBeenCalledTimes(1); // Synchronous cutoff prevents the other workers from starting.
  expect((await service.load([1], options)).prices[1]).toBe(1000);
  expect(readFutbin).toHaveBeenCalledTimes(2);
});

it('batches opt-in same-rating FUTBIN misses, individually resolves omitted versions and preserves page fetch times', async () => {
  let time = 1000;
  const readFutbin = vi.fn(async definitionId => ({ definitionId, price: 1050 }));
  const readFutbinBatch = vi.fn(async ids => {
    time = 1300;
    return { requests: 2, rows: ids.slice(0, -1).map(definitionId => ({ definitionId, price: 1000, fetchedAt: 1100 })) };
  });
  const service = createGalleryReferencePrices({ readFutbin, readFutbinBatch, now: () => time });
  const ids = Array.from({ length: 12 }, (_, i) => i + 1), rows = ids.map(definitionId => ({ definitionId, rating: 84 }));
  const options = { platform: 'pc', policy: { source: 'futbin' }, sources: ['futbin'], rows, futbinBatch: true };
  const result = await service.load(ids, options);
  expect(readFutbinBatch).toHaveBeenCalledTimes(1);
  expect(readFutbin).toHaveBeenCalledExactlyOnceWith(12, expect.any(Object), expect.any(Object));
  expect(result.references[1].quotes.futbin).toMatchObject({ fetchedAt: 1100, expiresAt: 301100, price: 1000 });
  expect(result.prices[12]).toBe(1050);
  await service.load(ids, options);
  expect(readFutbinBatch).toHaveBeenCalledTimes(1);
  expect(readFutbin).toHaveBeenCalledTimes(1);
});

it('does not enable FUTBIN batches for legacy callers or a disabled source', async () => {
  const readFutbin = vi.fn(async definitionId => ({ definitionId, price: 1000 })), readFutbinBatch = vi.fn();
  const ids = Array.from({ length: 12 }, (_, i) => i + 1), rows = ids.map(definitionId => ({ definitionId, rating: 84 }));
  const service = createGalleryReferencePrices({ readFutbin, readFutbinBatch,
    readFutgg: async ids => ids.map(definitionId => ({ definitionId, price: 1000 })) });
  await service.load(ids, { platform: 'pc', sources: ['futbin'], rows });
  expect(readFutbin).toHaveBeenCalledTimes(12);
  await service.load(ids, { platform: 'pc', rows, futbinBatch: true, policy: { readSources: 'futgg' } });
  expect(readFutbinBatch).not.toHaveBeenCalled();
});

it('never falls back after bulk 429 and drains a cancelled bulk before another caller runs', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => i + 1), rows = ids.map(definitionId => ({ definitionId, rating: 84 }));
  const options = { platform: 'pc', policy: { source: 'futbin' }, sources: ['futbin'], rows, futbinBatch: true };
  const readFutbin = vi.fn(), readFutbinBatch = vi.fn(async () => { throw Error('FC27_BUY_REFERENCE_HTTP_429'); });
  const service = createGalleryReferencePrices({ readFutbin, readFutbinBatch });
  const failed = await service.load(ids, options);
  expect(failed.references[1].quotes.futbin.error).toBe('FC27_BUY_REFERENCE_HTTP_429');
  expect(readFutbin).not.toHaveBeenCalled();
  let complete, active = true;
  const secondReader = vi.fn(() => new Promise(resolve => { complete = resolve; }));
  const second = createGalleryReferencePrices({ readFutbin: async definitionId => ({ definitionId, price: 1000 }), readFutbinBatch: secondReader });
  const pending = second.load(ids, { ...options, isCurrent: () => active });
  const rejected = expect(pending).rejects.toThrow('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
  const next = second.load([99], { ...options, rows: [] });
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  active = false;
  complete({ requests: 1, rows: ids.map(definitionId => ({ definitionId, price: 1000, fetchedAt: Date.now() })) });
  await rejected;
  expect((await next).prices[99]).toBe(1000);
});

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
  // Both versions started before either 429 was observed; forced reads still
  // respect the resulting shared source cooldown.
  expect(readFutbin).toHaveBeenCalledTimes(3);
  await service.load([1], { ...options, force: true }); expect(readFutbin).toHaveBeenCalledTimes(3);
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

it('reports completed FUTBIN progress monotonically and keeps caller edits out of the cache', async () => {
  const progress = [], readFutbin = vi.fn(async definitionId => ({ definitionId, price: 250 }));
  const service = createGalleryReferencePrices({ readFutbin,
    readFutgg: async ids => ids.map(definitionId => ({ definitionId, price: 200 })) });
  const first = await service.load([1,2,3], { platform: 'pc', onProgress: row => progress.push(row) });
  first.references[1].quotes.futgg.price = 999;
  expect((await service.load([1], { platform: 'pc' })).references[1].futgg).toBe(200);
  expect(readFutbin).toHaveBeenCalledTimes(3);
  expect(progress.filter(row => row.source === 'futbin').map(row => row.index)).toEqual([0, 0, 1, 2, 3, 3]);
});

it('bounds FUTBIN reads at three, preserves out-of-order identity and deduplicates overlapping requests', async () => {
  const pending = new Map(), calls = [], progress = [];
  const readFutbin = vi.fn(id => { calls.push(id); return new Promise(resolve => pending.set(id, resolve)); });
  const service = createGalleryReferencePrices({ readFutbin });
  const options = { platform: 'pc', sources: ['futbin'], policy: { source: 'futbin' } };
  const first = service.load([1, 2, 3, 4], { ...options, onProgress: row => progress.push(row.index) });
  const overlap = service.load([2, 4, 5], options);
  await vi.waitFor(() => expect(calls).toEqual([1, 2, 3]));
  pending.get(3)({ definitionId: 3, price: 350 });
  await vi.waitFor(() => expect(calls).toEqual([1, 2, 3, 4]));
  pending.get(4)({ definitionId: 4, price: 400 });
  pending.get(2)({ definitionId: 2, price: 300 });
  pending.get(1)({ definitionId: 1, price: 250 });
  expect((await first).prices).toEqual({ 1: 250, 2: 300, 3: 350, 4: 400 });
  await vi.waitFor(() => expect(calls).toEqual([1, 2, 3, 4, 5]));
  pending.get(5)({ definitionId: 5, price: 450 });
  expect((await overlap).prices).toEqual({ 2: 300, 4: 400, 5: 450 });
  expect(progress).toEqual([0, 0, 1, 2, 3, 4, 4]);
});

it('stops launching reads on cancellation and drains in-flight work before releasing the queue', async () => {
  const pending = new Map(), calls = []; let active = true;
  const service = createGalleryReferencePrices({ readFutbin: id => {
    calls.push(id); return new Promise(resolve => pending.set(id, resolve));
  } });
  const options = { platform: 'pc', sources: ['futbin'], policy: { source: 'futbin' } };
  const first = service.load([1, 2, 3, 4], { ...options, isCurrent: () => active });
  const rejected = expect(first).rejects.toThrow('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
  const next = service.load([5], options);
  await vi.waitFor(() => expect(calls).toEqual([1, 2, 3]));
  active = false;
  pending.get(1)({ definitionId: 1, price: 250 });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(calls).toEqual([1, 2, 3]);
  pending.get(2)({ definitionId: 2, price: 300 });
  pending.get(3)({ definitionId: 3, price: 350 });
  await rejected;
  await vi.waitFor(() => expect(calls).toEqual([1, 2, 3, 5]));
  pending.get(5)({ definitionId: 5, price: 450 });
  expect((await next).prices).toEqual({ 5: 450 });
});

it('stops new network reads after a source failure while settling at most two already in flight', async () => {
  const pending = new Map(), calls = [];
  const service = createGalleryReferencePrices({ readFutbin: id => {
    calls.push(id); return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  } });
  const result = service.load([1, 2, 3, 4, 5], { platform: 'pc', sources: ['futbin'], policy: { source: 'futbin' } });
  await vi.waitFor(() => expect(calls).toEqual([1, 2, 3]));
  pending.get(1).reject(Error('FC27_PUBLIC_PRICE_HTTP_429'));
  pending.get(2).resolve({ definitionId: 2, price: 250 });
  pending.get(3).resolve({ definitionId: 3, price: 300 });
  const snapshot = await result;
  expect(calls).toEqual([1, 2, 3]);
  for (const id of [1, 4, 5]) expect(snapshot.references[id].quotes.futbin.error).toBe('FC27_PUBLIC_PRICE_HTTP_429');
  await service.load([6], { platform: 'pc', sources: ['futbin'] });
  expect(calls).toEqual([1, 2, 3]);
});

it('reads a synthetic 74-version 544ms batch in 25 bounded waves and reuses all cached quotes', async () => {
  vi.useFakeTimers();
  try {
    let active = 0, maximum = 0;
    const readFutbin = vi.fn(async definitionId => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 544));
      active--; return { definitionId, price: 250 };
    });
    const service = createGalleryReferencePrices({ readFutbin });
    const ids = Array.from({ length: 74 }, (_, i) => i + 1);
    const options = { platform: 'pc', sources: ['futbin'], policy: { source: 'futbin' } };
    const start = Date.now(), result = service.load(ids, options);
    await vi.runAllTimersAsync();
    expect(Object.keys((await result).prices)).toHaveLength(74);
    expect(Date.now() - start).toBe(13600);
    expect(maximum).toBe(3);
    await service.load(ids, options);
    expect(readFutbin).toHaveBeenCalledTimes(74);
  } finally { vi.useRealTimers(); }
});

it('does not resume the same failed batch when its cooldown elapses while in-flight reads settle', async () => {
  let time = 1000, finishFailureWrite; const pending = new Map(), calls = [];
  const service = createGalleryReferencePrices({ now: () => time, failureTtlMs: 100,
    set: async (_key, row) => { if (row.definitionId === 1) await new Promise(resolve => { finishFailureWrite = resolve; }); },
    readFutbin: id => { calls.push(id); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); } });
  const result = service.load([1, 2, 3, 4, 5], { platform: 'pc', sources: ['futbin'], policy: { source: 'futbin' } });
  await vi.waitFor(() => expect(calls).toEqual([1, 2, 3]));
  pending.get(1).reject(Error('FC27_PUBLIC_PRICE_HTTP_429'));
  await vi.waitFor(() => expect(finishFailureWrite).toBeTypeOf('function'));
  time = 2000;
  for (const id of [2, 3]) pending.get(id).resolve({ definitionId: id, price: 250 });
  finishFailureWrite();
  const snapshot = await result;
  expect(calls).toEqual([1, 2, 3]);
  for (const id of [4, 5]) expect(snapshot.references[id].quotes.futbin).toMatchObject({
    error: 'FC27_PUBLIC_PRICE_HTTP_429', fetchedAt: 2000, expiresAt: 2001,
  });
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
