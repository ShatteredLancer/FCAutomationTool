import { expect, it, vi } from 'vitest';
import { createFc27GalleryCatalogProvider, createFc27GalleryTransport } from '../../src/adapters/browser/fc27-gallery-catalog.js';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';
import { futggGallery, fodderGallery } from '../fixtures/fc27-gallery.js';

function harness() {
  let time = 1000000;
  const store = new Map(); const calls = [];
  const get = vi.fn(async (source, headers) => {
    calls.push({ source, headers });
    if (source === 'futgg') return { status: 200, text: JSON.stringify(futggGallery()), headers: { etag: '"v1"' } };
    return { status: 200, text: JSON.stringify(fodderGallery()), headers: {} };
  });
  const provider = options => createFc27GalleryCatalogProvider({ http: { get },
    gmGetValue: key => store.get(key), gmSetValue: (key, value) => { store.set(key, value); },
    now: () => time, ...options });
  return { provider, get, calls, store, advance: ms => { time += ms; } };
}

it('uses FUT.GG, a five-minute cache, 304 and conditional requests', async () => {
  const t = harness(), p = t.provider();
  const first = await p.load();
  expect(first).toMatchObject({ source: 'futgg', cached: false, fallback: false });
  expect((await p.load()).reason).toBe('FC27_GALLERY_CATALOG_CACHE');
  expect(t.calls).toHaveLength(1);
  t.advance(300001);
  t.get.mockResolvedValueOnce({ status: 304, headers: {} });
  const second = await p.load();
  expect(second.revision).toBe(first.revision);
  expect(t.get.mock.calls[1]).toEqual(['futgg', { 'If-None-Match': '"v1"' }]);
  expect(second.changes.added).toEqual([]);
});

it('restores a persisted source and can validate it with 304 without a payload', async () => {
  const t = harness();
  const first = t.provider();
  const original = await first.load();
  t.advance(300001);
  const restored = t.provider();
  t.get.mockResolvedValueOnce({ status: 304, text: '', headers: {} });
  const result = await restored.load();
  expect(result).toMatchObject({ source: 'futgg', revision: original.revision, cached: false });
  expect(t.get.mock.calls.at(-1)).toEqual(['futgg', { 'If-None-Match': '"v1"' }]);
  expect((await restored.peek()).catalog.revision).toBe(original.revision);
});

it('falls back to Fodder without conflating source IDs and preserves old verified snapshots', async () => {
  const t = harness();
  t.get.mockRejectedValueOnce(new Error('HTTP 403'));
  const p = t.provider();
  const fallback = await p.load();
  expect(fallback).toMatchObject({ source: 'fodder', fallback: true, sourceErrors: { futgg: 'HTTP 403' } });
  expect(fallback.catalog.categories[0].sets[0].id).toBe('fodder:league/example-club');
  t.advance(300001);
  t.get.mockResolvedValueOnce({ status: 200, text: JSON.stringify(futggGallery()), headers: {} });
  const gg = await p.load();
  expect(gg.source).toBe('futgg');
  expect(gg.changes.comparable).toBe(false);
  t.advance(300001);
  t.get.mockResolvedValueOnce({ status: 200, text: '{bad json', headers: {} });
  t.get.mockResolvedValueOnce({ status: 429, text: '', headers: { 'retry-after': '120' } });
  const failed = await p.load();
  expect(failed).toMatchObject({ source: 'futgg', stale: true, reason: 'FC27_GALLERY_CATALOG_REFRESH_FAILED' });
  expect((await p.peek()).catalog.revision).toBe(gg.catalog.revision);
});

it('rejects empty/duplicate/unknown schema without replacing a good cache', async () => {
  const t = harness(), p = t.provider();
  const original = await p.load(); t.advance(300001);
  const empty = futggGallery(); empty.data.categories = [];
  t.get.mockResolvedValueOnce({ status: 200, text: JSON.stringify(empty), headers: {} });
  const duplicate = fodderGallery(); duplicate.categories.push(duplicate.categories[0]);
  t.get.mockResolvedValueOnce({ status: 200, text: JSON.stringify(duplicate), headers: {} });
  expect((await p.load()).catalog.revision).toBe(original.revision);
  expect((await p.peek()).source).toBe('futgg');
});

it('honors Retry-After and does not extend backoff or issue duplicate requests', async () => {
  const t = harness();
  const p = t.provider();
  const original = await p.load();
  t.advance(300001);
  t.get.mockResolvedValueOnce({ status: 429, text: '', headers: { 'retry-after': '600' } });
  t.get.mockResolvedValueOnce({ status: 503, text: '', headers: {} });
  const failed = await p.load();
  expect(failed).toMatchObject({ source: 'futgg', stale: true, reason: 'FC27_GALLERY_CATALOG_REFRESH_FAILED' });
  expect(failed.retryAt).toBeGreaterThan(1000000 + 300001);
  const callsAfterFailure = t.get.mock.calls.length;
  const blocked = await p.refresh();
  expect(blocked.reason).toBe('FC27_GALLERY_CATALOG_REFRESH_FAILED');
  expect(blocked.errors).toEqual({ futgg: 'FC27_GALLERY_BACKOFF', fodder: 'FC27_GALLERY_BACKOFF' });
  expect(t.get.mock.calls).toHaveLength(callsAfterFailure);
  expect((await p.peek()).catalog.revision).toBe(original.revision);
  t.advance(blocked.retryAt - 1000000 - 300001);
  const fallback = await p.refresh();
  expect(fallback).toMatchObject({ reason: 'FC27_GALLERY_CATALOG_UPDATED', source: 'fodder' });
  expect(t.get.mock.calls).toHaveLength(callsAfterFailure + 1);
  expect(t.get.mock.calls.at(-1)[0]).toBe('fodder');
  t.advance(300000);
  expect((await p.refresh()).source).toBe('futgg');
  expect(t.get.mock.calls).toHaveLength(callsAfterFailure + 2);
});

it('accepts HTTP-date retry deadlines and does not reuse an ETag after a new untagged 200', async () => {
  const t = harness(), p = t.provider();
  await p.load();
  t.advance(300000);
  t.get.mockResolvedValueOnce({ status: 200, text: JSON.stringify(futggGallery()), headers: {} });
  await p.refresh();
  t.get.mockResolvedValueOnce({ status: 503, headers: { 'retry-after': new Date(2200000).toUTCString() } });
  t.get.mockRejectedValueOnce(new Error('timeout'));
  await p.refresh();
  expect(t.get.mock.calls[2]).toEqual(['futgg', {}]);
  t.advance(899999);
  await p.refresh();
  expect(t.get.mock.calls.filter(([source]) => source === 'futgg')).toHaveLength(3);
  t.advance(1);
  expect((await p.refresh()).source).toBe('futgg');
});

it('keeps refreshes coalesced while the persistent write is pending', async () => {
  const t = harness(); let finishWrite;
  const p = t.provider({ gmSetValue: () => new Promise(resolve => { finishWrite = resolve; }) });
  const first = p.load();
  await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'), { interval: 1 });
  const second = p.refresh();
  expect(t.get).toHaveBeenCalledTimes(1);
  finishWrite();
  expect(await second).toEqual(await first);
});

it('coalesces concurrent refreshes, including persistence, so old work cannot overwrite new data', async () => {
  const t = harness(); let release;
  t.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const p = t.provider();
  const a = p.load(), b = p.refresh();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'), { interval: 1 });
  expect(t.get).toHaveBeenCalledTimes(1);
  release({ status: 200, text: JSON.stringify(futggGallery()), headers: {} });
  expect(await a).toEqual(await b);
  expect((await p.peek()).source).toBe('futgg');
});

it('isolates source records and scope, and rejects corrupt persisted snapshots', async () => {
  const t = harness(), first = t.provider({ scope: 'public' });
  await first.load();
  const other = t.provider({ scope: 'other' });
  expect(await other.peek()).toBeNull();
  const restored = t.provider({ scope: 'public' });
  expect((await restored.peek()).source).toBe('futgg');
  t.store.set(restored.cacheKey, { schema: 2, season: '26', scope: 'public', active: 'futgg', entries: [] });
  expect(await t.provider({ scope: 'public' }).peek()).toBeNull();
});

it('sends only anonymous GET to exact public URLs and rejects redirected responses', async () => {
  let request; const transport = createFc27GalleryTransport(value => { request = value; });
  const pending = transport.get('futgg', { 'If-None-Match': '"v1"', Authorization: 'private' });
  expect(request).toMatchObject({ method: 'GET', anonymous: true,
    url: 'https://www.fut.gg/api/fut/gallery/fc27/', headers: { 'If-None-Match': '"v1"' } });
  expect(request.headers.Authorization).toBeUndefined();
  request.onload({ status: 200, responseText: '{}', responseHeaders: 'ETag: "v2"', finalUrl: 'https://example.org/' });
  await expect(pending).rejects.toThrow('FC27_GALLERY_REDIRECT');
  const timeout = transport.get('futgg');
  request.ontimeout();
  await expect(timeout).rejects.toThrow('FC27_GALLERY_TIMEOUT');
  await expect(transport.get('unknown')).rejects.toThrow('FC27_GALLERY_TRANSPORT_UNAVAILABLE');
});

it('uses the exact anonymous FUT.GG FC27 price route', async () => {
  const requests = [];
  const transport = createFc27GalleryTransport(value => { requests.push(value); });
  const pending = transport.getPrices([900003, 900001, 900003], { platform: 'pc' });
  expect(requests[0]).toMatchObject({ method: 'POST', anonymous: true,
    url: 'https://www.fut.gg/api/fut/price-access/sign/', data: JSON.stringify({
      url: '/api/fut/player-prices/27/?ids=900003,900001&platform=pc',
    }) });
  requests[0].onload({ status: 200, responseText: JSON.stringify({ data: {
    url: '/api/fut/player-prices/27/?ids=900003,900001&platform=pc&verify=test',
  } }), responseHeaders: '', finalUrl: requests[0].url });
  await vi.waitFor(() => expect(requests[1]).toBeDefined(), { interval: 1 });
  expect(requests[1]).toMatchObject({ method: 'GET', anonymous: true,
    url: 'https://www.fut.gg/api/fut/player-prices/27/?ids=900003,900001&platform=pc&verify=test' });
  requests[1].onload({ status: 200, responseText: JSON.stringify({ data: [] }), responseHeaders: '', finalUrl: requests[1].url });
  await expect(pending).resolves.toMatchObject({ status: 200 });
});

it('maps the FCAT console platform label to FUT.GG ps5 prices', async () => {
  const requests = [];
  const transport = createFc27GalleryTransport(value => { requests.push(value); });
  const pending = transport.getPrices([900001], { platform: 'console' });
  expect(requests[0].data).toBe(JSON.stringify({
    url: '/api/fut/player-prices/27/?ids=900001&platform=ps5',
  }));
  requests[0].onload({ status: 200, responseText: JSON.stringify({ data: {
    url: '/api/fut/player-prices/27/?ids=900001&platform=ps5&verify=test',
  } }), responseHeaders: '', finalUrl: requests[0].url });
  await vi.waitFor(() => expect(requests[1]).toBeDefined(), { interval: 1 });
  expect(requests[1].url).toContain('platform=ps5');
  requests[1].onload({ status: 200, responseText: JSON.stringify({ data: [{ eaId: 900001, price: 200 }] }), responseHeaders: '', finalUrl: requests[1].url });
  await expect(pending).resolves.toMatchObject({ status: 200 });
});

it('reads FC27 prices in one de-duplicated batch and reuses the persisted result', async () => {
  const calls = []; const store = new Map();
  const http = { get: vi.fn(), getPrices: vi.fn(async ids => {
    calls.push([...ids]);
    return { status: 200, text: JSON.stringify({ data: ids.map(eaId => ({ eaId, price: eaId * 10 })) }) };
  }) };
  const provider = createFc27GalleryCatalogProvider({ http, gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, value) });
  await expect(provider.loadPrices([900003, 900001, 900003], { platform: 'pc' }))
    .resolves.toEqual({ '900001': 9000010, '900003': 9000030 });
  await expect(provider.loadPrices([900001, 900003], { platform: 'pc' }))
    .resolves.toEqual({ '900001': 9000010, '900003': 9000030 });
  expect(calls).toEqual([[900001, 900003]]);
  expect(http.getPrices).toHaveBeenCalledTimes(1);
});

it('preserves a safe price failure reason without blocking collection reads or exposing raw errors', async () => {
  let time = 1000000;
  const http = { get: vi.fn(), getPrices: vi.fn()
    .mockRejectedValueOnce(new Error('FC27_GALLERY_PRICE_SIGN_INVALID'))
    .mockRejectedValueOnce(new Error('private response content'))
    .mockResolvedValueOnce({ status: 403, text: 'private response content' })
    .mockResolvedValueOnce({ status: 200, text: JSON.stringify({ data: [{ eaId: 1, price: 200 }] }) }) };
  const provider = createFc27GalleryCatalogProvider({ http, now: () => time });
  await expect(provider.loadPrices([1], { platform: 'console' })).resolves.toEqual({});
  expect(provider.priceError([1], { platform: 'console' })).toBe('FC27_GALLERY_PRICE_SIGN_INVALID');
  expect(provider.priceError([1], { platform: 'pc' })).toBeNull();
  await provider.loadPrices([1], { platform: 'console' });
  expect(http.getPrices).toHaveBeenCalledTimes(1);
  time += 300000;
  await provider.loadPrices([1], { platform: 'console' });
  expect(provider.priceError([1], { platform: 'console' })).toBe('FC27_GALLERY_PRICE_UNAVAILABLE');
  time += 300000;
  await provider.loadPrices([1], { platform: 'console' });
  expect(provider.priceError([1], { platform: 'console' })).toBe('HTTP 403');
  time += 300000;
  await expect(provider.loadPrices([1], { platform: 'console' })).resolves.toEqual({ '1': 200 });
  expect(provider.priceError([1], { platform: 'console' })).toBeNull();
});

it('splits a 56-version collection at the observed FUT.GG 50-id limit, serially and only once', async () => {
  const ids = Array.from({ length: 56 }, (_, index) => index + 1), store = new Map();
  let active = 0, maxActive = 0;
  const http = { get: vi.fn(), getPrices: vi.fn(async batch => {
    active++; maxActive = Math.max(maxActive, active);
    await Promise.resolve(); active--;
    if (batch.length > 50) return { status: 400, text: JSON.stringify({ data: { message: 'ids may contain at most 50 ids' } }) };
    return { status: 200, text: JSON.stringify({ data: batch.map(eaId => ({ eaId, price: eaId * 100 })) }) };
  }) };
  const options = { http, gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, value) };
  const provider = createFc27GalleryCatalogProvider(options);
  const a = provider.loadPrices([...ids, 1], { platform: 'console' });
  const b = provider.loadPrices(ids, { platform: 'console' });
  expect(await a).toEqual(await b);
  expect(Object.keys(await a)).toHaveLength(56);
  expect(http.getPrices.mock.calls.map(([batch]) => batch.length)).toEqual([50, 6]);
  expect(maxActive).toBe(1);
  await createFc27GalleryCatalogProvider(options).loadPrices(ids, { platform: 'console' });
  expect(http.getPrices).toHaveBeenCalledTimes(2);
});

it('rejects an oversized direct price request before signing', async () => {
  const gm = vi.fn(), transport = createFc27GalleryTransport(gm);
  await expect(transport.getPrices(Array.from({ length: 51 }, (_, index) => index + 1)))
    .rejects.toThrow('FC27_GALLERY_PRICE_IDS_INVALID');
  expect(gm).not.toHaveBeenCalled();
});

it('expires price batches after five minutes and treats a restored legacy cache as stale', async () => {
  const ids = [101, 102], store = new Map(), calls = [];
  let time = 1000000;
  const http = { get: vi.fn(), getPrices: vi.fn(async batch => {
    calls.push([...batch]);
    return { status: 200, text: JSON.stringify({ data: batch.map(eaId => ({ eaId, price: eaId * 10 })) }) };
  }) };
  const options = { http, now: () => time, gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, value) };
  const provider = createFc27GalleryCatalogProvider(options);
  await expect(provider.loadPrices(ids, { platform: 'pc' })).resolves.toEqual({ '101': 1010, '102': 1020 });
  expect(calls).toHaveLength(1);
  time += 299999;
  await provider.loadPriceSnapshot(ids, { platform: 'pc' });
  expect(calls).toHaveLength(1);
  time += 1;
  const refreshed = await provider.loadPriceSnapshot(ids, { platform: 'pc' });
  expect(calls).toHaveLength(2);
  expect(refreshed.stale).toBe(false);

  const legacy = createFc27GalleryCatalogProvider({ ...options, gmGetValue: () => ({
    schema: 1, season: '27', platform: 'pc', ids, prices: { 101: 1010, 102: 1020 },
  }) });
  http.getPrices.mockRejectedValueOnce(new Error('timeout'));
  const stale = await legacy.loadPriceSnapshot(ids, { platform: 'pc' });
  expect(stale.prices).toEqual({ '101': 1010, '102': 1020 });
  expect(stale.stale).toBe(true);
  expect(stale.missingIds).toEqual([]);
});

it('persists partial batches and retries only the failed batch after its deadline', async () => {
  let time = 1000000;
  const ids = Array.from({ length: 56 }, (_, index) => index + 1), store = new Map();
  const http = { get: vi.fn(), getPrices: vi.fn(async batch => {
    if (batch[0] === 51 && time === 1000000) { time += 200000; return { status: 429, headers: { 'retry-after': '1' } }; }
    return { status: 200, text: JSON.stringify({ data: batch.map(eaId => ({ eaId, price: 200 })) }) };
  }) };
  const options = { http, now: () => time, ttlMs: 300000,
    gmGetValue: key => store.get(key), gmSetValue: (key, value) => store.set(key, value) };
  const first = createFc27GalleryCatalogProvider(options);
  const partial = await first.loadPriceSnapshot(ids);
  expect(partial).toMatchObject({ error: 'HTTP 429', retryAt: 1500000 });
  const restored = createFc27GalleryCatalogProvider(options);
  await restored.loadPriceSnapshot(ids);
  expect(http.getPrices).toHaveBeenCalledTimes(2);
  time = 1300000;
  // Another collection shares this exact first batch and refreshes it.
  await restored.loadPrices(ids.slice(0, 50));
  time = 1500000;
  const resumed = await createFc27GalleryCatalogProvider(options).loadPriceSnapshot(ids);
  expect(http.getPrices.mock.calls.map(([batch]) => batch.length)).toEqual([50, 6, 50, 6]);
  expect(resumed).toMatchObject({ stale: false, error: null, missingIds: [] });
  expect(Object.keys(resumed.freshPrices)).toHaveLength(56);
});

it.each(['600', new Date(1600000).toUTCString()])('honors price Retry-After %s without extending it', async retry => {
  let time = 1000000;
  const http = { get: vi.fn(), getPrices: vi.fn().mockResolvedValueOnce({ status: 429, headers: { 'retry-after': retry } })
    .mockResolvedValue({ status: 200, text: '{"data":[{"eaId":1,"price":300}]}' }) };
  const provider = createFc27GalleryCatalogProvider({ http, now: () => time });
  expect((await provider.loadPriceSnapshot([1])).retryAt).toBe(1600000);
  time = 1599999;
  expect((await provider.loadPriceSnapshot([1])).retryAt).toBe(1600000);
  expect(http.getPrices).toHaveBeenCalledTimes(1);
  time++;
  expect((await provider.loadPriceSnapshot([1])).freshPrices).toEqual({ 1: 300 });
  expect(http.getPrices).toHaveBeenCalledTimes(2);
});

it('retains stale quotes after failure but excludes them from fresh planning prices', async () => {
  let time = 1000000;
  const http = { get: vi.fn(), getPrices: vi.fn().mockResolvedValueOnce({ status: 200, text: '{"data":[{"eaId":1,"price":200}]}' })
    .mockRejectedValue(new Error('private timeout details')) };
  const provider = createFc27GalleryCatalogProvider({ http, now: () => time });
  await provider.loadPrices([1, 2]); time += 300000;
  expect(await provider.loadPriceSnapshot([1, 2])).toMatchObject({ prices: { 1: 200 }, freshPrices: {}, staleIds: [1],
    missingIds: [2], stale: true, error: 'FC27_GALLERY_PRICE_UNAVAILABLE' });
});

it('does not use corrupt or future-dated persisted prices and isolates platforms', async () => {
  let time = 1000000;
  const http = { get: vi.fn(), getPrices: vi.fn().mockResolvedValue({ status: 200, text: '{"data":[{"eaId":1,"price":300}]}' }) };
  const provider = createFc27GalleryCatalogProvider({ http, now: () => time, gmGetValue: () => ({
    schema: 2, season: '27', platform: 'pc', ids: [1], fetchedAt: time + 1, prices: { 1: -1, 2: 0 },
  }) });
  expect((await provider.loadPriceSnapshot([1])).prices).toEqual({ 1: 300 });
  expect((await provider.loadPriceSnapshot([1], { platform: 'console' })).prices).toEqual({ 1: 300 });
  expect(http.getPrices).toHaveBeenCalledTimes(2);
});

it('coalesces overlapping batch reads until the persistent write completes', async () => {
  let finishWrite;
  const http = { get: vi.fn(), getPrices: vi.fn().mockResolvedValue({ status: 200, text: '{"data":[{"eaId":1,"price":200}]}' }) };
  const provider = createFc27GalleryCatalogProvider({ http, gmSetValue: () => new Promise(resolve => { finishWrite = resolve; }) });
  const first = provider.loadPrices([1]);
  await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'), { interval: 1 });
  const second = provider.loadPrices([1]);
  expect(http.getPrices).toHaveBeenCalledTimes(1);
  finishWrite();
  expect(await first).toEqual(await second);
});

it('retains an old whole-collection snapshot as stale without making it permanent again', async () => {
  const ids = Array.from({ length: 56 }, (_, index) => index + 1);
  const http = { get: vi.fn(), getPrices: vi.fn().mockRejectedValue(new Error('offline')) };
  const provider = createFc27GalleryCatalogProvider({ http, gmGetValue: key => key.endsWith(ids.join(',')) ? {
    schema: 1, season: '27', platform: 'pc', ids, prices: Object.fromEntries(ids.map(id => [id, 200])),
  } : null });
  const snapshot = await provider.loadPriceSnapshot(ids);
  expect(Object.keys(snapshot.prices)).toHaveLength(56);
  expect(snapshot.freshPrices).toEqual({});
  expect(snapshot.staleIds).toEqual(ids);
  expect(http.getPrices).toHaveBeenCalledTimes(1);
});

it('treats a successful missing quote as unknown and does not repeatedly reread it', async () => {
  const http = { get: vi.fn(), getPrices: vi.fn().mockResolvedValue({ status: 200, text: '{"data":[]}' }) };
  const provider = createFc27GalleryCatalogProvider({ http });
  expect(await provider.loadPriceSnapshot([1, 2])).toMatchObject({ prices: {}, missingIds: [1, 2], stale: false, error: null });
  await provider.loadPriceSnapshot([1, 2]);
  expect(http.getPrices).toHaveBeenCalledTimes(1);
});

it('does not replace a valid snapshot with malformed successful price data', async () => {
  let time = 1000000;
  const http = { get: vi.fn(), getPrices: vi.fn().mockResolvedValueOnce({ status: 200, text: '{"data":[{"eaId":1,"price":200}]}' })
    .mockResolvedValue({ status: 200, text: '{"data":{"private":"details"}}' }) };
  const provider = createFc27GalleryCatalogProvider({ http, now: () => time });
  await provider.loadPriceSnapshot([1]); time += 300000;
  expect(await provider.loadPriceSnapshot([1])).toMatchObject({ prices: { 1: 200 }, freshPrices: {},
    stale: true, error: 'FC27_GALLERY_PRICE_PAYLOAD_INVALID' });
});

it('keeps signing failure Retry-After available to the provider', async () => {
  const requests = [];
  const transport = createFc27GalleryTransport(value => { requests.push(value); });
  const pending = transport.getPrices([1]);
  requests[0].onload({ status: 429, responseText: '', responseHeaders: 'Retry-After: 600', finalUrl: requests[0].url });
  expect(await pending).toMatchObject({ status: 429, headers: { 'retry-after': '600' } });
  expect(requests).toHaveLength(1);
});

it('keeps successful price batches when a later batch fails', async () => {
  const ids = Array.from({ length: 56 }, (_, index) => index + 1);
  const calls = [];
  const http = { get: vi.fn(), getPrices: vi.fn(async batch => {
    calls.push([...batch]);
    if (batch[0] === 51) return { status: 503, text: '' };
    return { status: 200, text: JSON.stringify({ data: batch.map(eaId => ({ eaId, price: 200 })) }) };
  }) };
  const provider = createFc27GalleryCatalogProvider({ http });
  const snapshot = await provider.loadPriceSnapshot(ids, { platform: 'pc' });
  expect(calls.map(batch => batch.length)).toEqual([50, 6]);
  expect(Object.keys(snapshot.prices)).toHaveLength(50);
  expect(snapshot.missingIds).toEqual(ids.slice(50));
  expect(snapshot.stale).toBe(true);
});

it('records only bounded Gallery request outcomes for offline export', async () => {
  const t = harness();
  const log = createFcatDiagnosticLog({ gmGetValue: key => t.store.get(key), gmSetValue: (key, value) => t.store.set(key, value) });
  t.get.mockRejectedValueOnce(new Error('HTTP 403'));
  await t.provider({ diagnosticLog: log }).load();
  const entries = await log.snapshot();
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ area: 'gallery', event: 'catalog-request', source: 'futgg', status: 'started' }),
    expect.objectContaining({ area: 'gallery', event: 'catalog-request', source: 'futgg', status: 'failed', reason: 'HTTP 403', httpStatus: 403 }),
  ]));
  expect(JSON.stringify(entries)).not.toContain('https://');
});

it('logs transport phase and forwarding mode without persisting signed URLs or proxy settings', async () => {
  const events = [], requests = [];
  const transport = createFc27GalleryTransport(value => requests.push(value), {
    proxy: 'https://proxy.example/?private=secret', diagnosticLog: { record: event => events.push(event) },
  });
  const pending = transport.getPrices([1]);
  requests[0].onload({ status: 200, responseText: JSON.stringify({ data: {
    url: '/api/fut/player-prices/27/?ids=1&verify=private-signature',
  } }), finalUrl: requests[0].url });
  await vi.waitFor(() => expect(requests).toHaveLength(2), { interval: 1 });
  requests[1].onload({ status: 403, responseText: 'private response body', finalUrl: requests[1].url });
  expect(await pending).toMatchObject({ status: 403 });
  expect(events).toEqual([
    { area: 'gallery', event: 'transport-request', source: 'futgg', phase: 'price-sign', route: 'forwarding', status: 'started' },
    { area: 'gallery', event: 'transport-request', source: 'futgg', phase: 'price-sign', route: 'forwarding', status: 'received', httpStatus: 200 },
    { area: 'gallery', event: 'transport-request', source: 'futgg', phase: 'price-read', route: 'forwarding', status: 'started' },
    { area: 'gallery', event: 'transport-request', source: 'futgg', phase: 'price-read', route: 'forwarding', status: 'received', httpStatus: 403 },
  ]);
  expect(JSON.stringify(events)).not.toMatch(/private|proxy\.example|signature/);
});

it('records network/timeout stages and isolates rejected or throwing log callbacks', async () => {
  const requests = [], events = [];
  const transport = createFc27GalleryTransport(value => requests.push(value), { diagnosticLog: { record: event => {
    events.push(event); return Promise.reject(new Error('diagnostic-only'));
  } } });
  const pending = transport.get('futgg'); requests[0].onerror();
  await expect(pending).rejects.toThrow('FC27_GALLERY_NETWORK_FAILED');
  expect(events.at(-1)).toMatchObject({ phase: 'catalog', route: 'direct', status: 'failed', reason: 'FC27_GALLERY_NETWORK_FAILED' });
  const throwing = createFc27GalleryTransport(value => requests.push(value), {
    diagnosticLog: { record: () => { throw new Error('log unavailable'); } },
  });
  const timeout = throwing.getPool(1); requests.at(-1).ontimeout();
  await expect(timeout).rejects.toThrow('FC27_GALLERY_TIMEOUT');
  const t = harness();
  expect((await t.provider({ diagnosticLog: { record: () => { throw new Error('log unavailable'); } } }).load()).source).toBe('futgg');
  expect(t.get).toHaveBeenCalledTimes(1);
});

it('logs cache/backoff reuse without reporting a new network dispatch', async () => {
  const events = [], t = harness();
  const p = t.provider({ diagnosticLog: { record: event => events.push(event) } });
  await p.load(); await p.load();
  expect(events.at(-1)).toMatchObject({ event: 'catalog-cache', cached: true });
  t.advance(300000);
  t.get.mockResolvedValueOnce({ status: 429, headers: { 'retry-after': '600' } });
  t.get.mockResolvedValueOnce({ status: 503 });
  await p.refresh();
  events.length = 0;
  const calls = t.get.mock.calls.length;
  await p.refresh();
  expect(t.get).toHaveBeenCalledTimes(calls);
  expect(events).toHaveLength(2);
  expect(events.every(event => event.status === 'failed' && event.reason === 'FC27_GALLERY_BACKOFF')).toBe(true);
});
