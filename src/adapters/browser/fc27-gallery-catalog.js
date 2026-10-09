import { diffGalleryCatalog, galleryCachePayload, normalizeGalleryCatalog } from '../../gallery/catalog.js';
import { galleryPoolCachePayload, normalizeGalleryPool } from '../../gallery/pool.js';
import { parseGalleryPriceResponse } from '../../gallery/prices.js';
import { decodeGalleryCacheValue, encodeGalleryCacheValue } from './fc27-gallery-cache-codec.js';

export const FC27_GALLERY_URLS = Object.freeze({
  futgg: 'https://www.fut.gg/api/fut/gallery/fc27/',
  fodder: 'https://fodder.gg/api/gallery',
});
const FUTGG_POOL_URL = setId => `https://www.fut.gg/api/fut/gallery/fc27/sets/${setId}/pool/`;
const FUTGG_PRICE_URL = (ids, platform) => `https://www.fut.gg/api/fut/player-prices/27/?ids=${ids.join(',')}&platform=${platform}`;
const FUTGG_PRICE_SIGN_URL = 'https://www.fut.gg/api/fut/price-access/sign/';
const FUTGG_PRICE_BATCH_SIZE = 50;
export const GALLERY_TTL_MS = 5 * 60 * 1000;
const validScope = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(value);
const validator = value => typeof value === 'string' && value.length <= 300 && !/[\r\n]/.test(value) ? value : null;

// Dedicated anonymous public transport: no EA headers, credentials, cache busting or arbitrary URLs.
export function createFc27GalleryTransport(gmRequest, { diagnosticLog = null } = {}) {
  const record = fields => {
    try { Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', event: 'transport-request', ...fields })).catch(() => undefined); }
    catch { /* Logging cannot alter public requests or callbacks. */ }
  };
  const parseResponseHeaders = response => {
    const parsed = {};
    for (const line of String(response.responseHeaders ?? '').split(/\r?\n/)) {
      const index = line.indexOf(':');
      const key = line.slice(0, index).trim().toLowerCase();
      if (index > 0 && ['etag', 'last-modified', 'retry-after', 'cache-control'].includes(key)) parsed[key] = line.slice(index + 1).trim();
    }
    return parsed;
  };
  const request = (url, headers = {}, phase = 'catalog', source = 'futgg') => new Promise((resolve, reject) => {
    const route = 'direct';
    const fail = reason => { record({ source, phase, route, status: 'failed', reason }); reject(new Error(reason)); };
    if (typeof gmRequest !== 'function') {
      fail('FC27_GALLERY_TRANSPORT_UNAVAILABLE'); return;
    }
    const requestUrl = url;
    record({ source, phase, route, status: 'started' });
    const conditional = Object.fromEntries(['If-None-Match', 'If-Modified-Since']
      .filter(key => validator(headers[key])).map(key => [key, headers[key]]));
    gmRequest({ method: 'GET', url: requestUrl, anonymous: true, timeout: 15000,
      headers: conditional,
      onload: response => {
        const parsed = parseResponseHeaders(response);
        if (response.finalUrl && response.finalUrl !== requestUrl) { fail('FC27_GALLERY_REDIRECT'); return; }
        record({ source, phase, route, status: 'received', httpStatus: response.status });
        resolve({ status: response.status, text: response.responseText, headers: parsed });
      }, onerror: () => fail('FC27_GALLERY_NETWORK_FAILED'),
      ontimeout: () => fail('FC27_GALLERY_TIMEOUT'),
    });
  });
  const postJson = (url, payload) => new Promise((resolve, reject) => {
    const route = 'direct';
    const fail = reason => { record({ source: 'futgg', phase: 'price-sign', route, status: 'failed', reason }); reject(new Error(reason)); };
    if (typeof gmRequest !== 'function') { fail('FC27_GALLERY_TRANSPORT_UNAVAILABLE'); return; }
    const requestUrl = url;
    record({ source: 'futgg', phase: 'price-sign', route, status: 'started' });
    gmRequest({ method: 'POST', url: requestUrl, anonymous: true, timeout: 15000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: JSON.stringify(payload),
      onload: response => {
        if (response.finalUrl && response.finalUrl !== requestUrl) { fail('FC27_GALLERY_REDIRECT'); return; }
        record({ source: 'futgg', phase: 'price-sign', route, status: 'received', httpStatus: response.status });
        resolve({ status: response.status, text: response.responseText, headers: parseResponseHeaders(response) });
      },
      onerror: () => fail('FC27_GALLERY_NETWORK_FAILED'),
      ontimeout: () => fail('FC27_GALLERY_TIMEOUT'),
    });
  });
  return Object.freeze({
    get: (source, headers = {}) => {
      if (!Object.hasOwn(FC27_GALLERY_URLS, source)) return Promise.reject(new Error('FC27_GALLERY_TRANSPORT_UNAVAILABLE'));
      return request(FC27_GALLERY_URLS[source], headers, 'catalog', source);
    },
    getPool: (setId, headers = {}) => {
      if (!Number.isSafeInteger(setId) || setId < 1 || setId > 1000000) {
        return Promise.reject(new Error('FC27_GALLERY_POOL_ID_INVALID'));
      }
      return request(FUTGG_POOL_URL(setId), headers, 'pool');
    },
    getPrices: async (ids, { platform = 'pc' } = {}) => {
      const values = [...new Set((ids ?? []).map(Number).filter(value => Number.isSafeInteger(value) && value > 0))];
      if (!values.length || values.length > FUTGG_PRICE_BATCH_SIZE || !['pc', 'console'].includes(platform)) {
        return Promise.reject(new Error('FC27_GALLERY_PRICE_IDS_INVALID'));
      }
      // FUT.GG protects market data behind a short-lived signed URL.  Keep
      // the public batch contract (one call for all cards) while performing
      // the required anonymous sign step before the actual price read.
      // FUT.GG calls the console market `ps5`; FCAT keeps `console` as its
      // account-level platform label for compatibility with other adapters.
      const target = new URL(FUTGG_PRICE_URL(values, platform === 'console' ? 'ps5' : platform));
      const relative = `${target.pathname}${target.search}`;
      const signed = await postJson(FUTGG_PRICE_SIGN_URL, { url: relative });
      if (signed.status !== 200) return signed;
      let payload;
      try { payload = JSON.parse(signed.text); } catch { throw new Error('FC27_GALLERY_PRICE_SIGN_INVALID'); }
      const signedPath = payload?.data?.url;
      if (typeof signedPath !== 'string' || !signedPath.startsWith('/api/fut/player-prices/27/')) {
        throw new Error('FC27_GALLERY_PRICE_SIGN_INVALID');
      }
      return request(new URL(signedPath, 'https://www.fut.gg').href, {}, 'price-read');
    },
  });
}

export function createFc27GalleryCatalogProvider({ http, gmGetValue, gmSetValue, scope = 'public',
  season = '27', now = () => Date.now(), ttlMs = GALLERY_TTL_MS, diagnosticLog = null, cacheMigration = null } = {}) {
  if (typeof http?.get !== 'function' || !validScope(scope) || season !== '27'
      || !Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new TypeError('FC27_GALLERY_PROVIDER_INVALID');
  const cacheKey = `fcat-fc27-gallery-catalog:${season}:${scope}`;
  const poolCacheKey = `fcat-fc27-gallery-pools:${season}:${scope}`;
  const poolEntryKey = setId => `${poolCacheKey}:set:${setId}`;
  const entries = new Map(); let active = null; let inFlight = null; let reading = null;
  // Keep only bounded, normalized source errors for the visible fallback
  // diagnosis. Response bodies, URLs and account data never enter this state.
  let lastSourceErrors = Object.freeze({});
  const pools = new Map(); let poolsReading = null;
  const poolReads = new Map();
  const poolInFlight = new Map(); const poolRetryAt = new Map();
  const priceInFlight = new Map(); const priceMemory = new Map(); const priceErrors = new Map();
  const retryAt = new Map();
  const record = (event, fields = {}) => {
    try {
      const result = diagnosticLog?.record?.({ area: 'gallery', event, ...fields });
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch { /* Diagnostics must never affect Gallery behavior. */ }
  };
  const statusCode = reason => {
    const match = /^HTTP (\d{3})$/.exec(String(reason ?? ''));
    return match ? Number(match[1]) : undefined;
  };
  const safeReason = error => /^(HTTP \d{3}|FC27_GALLERY_[A-Z_]+)$/.test(error?.message) ? error.message : 'request-failed';
  const observe = (entry, reason, extra = {}) => ({ status: 'observed', reason, source: entry.source,
    catalog: entry.catalog, fetchedAt: entry.fetchedAt, revision: entry.catalog.revision,
    fallback: entry.source === 'fodder', sourceErrors: lastSourceErrors, ...extra });
  const read = () => reading ??= (async () => {
    await cacheMigration;
    if (typeof gmGetValue !== 'function') return;
    try {
      const saved = await decodeGalleryCacheValue(await gmGetValue(cacheKey, null));
      if (saved?.schema !== 2 || saved.season !== season || saved.scope !== scope || !Array.isArray(saved.entries)) return;
      for (const row of saved.entries.slice(0, 2)) try {
        if (!Number.isSafeInteger(row.fetchedAt) || row.fetchedAt < 0 || row.fetchedAt > now()) continue;
        const catalog = normalizeGalleryCatalog(row.source, row.payload, season);
        entries.set(row.source, { source: row.source, catalog, fetchedAt: row.fetchedAt, etag: validator(row.etag), modified: validator(row.modified) });
      } catch { /* Invalid public snapshot is discarded only. */ }
      active = entries.get(saved.active) ?? null;
    } catch { /* Cache is optional. */ }
  })();
  const readPools = () => poolsReading ??= (async () => {
    await cacheMigration;
    if (typeof gmGetValue !== 'function') return;
    try {
      const saved = await decodeGalleryCacheValue(await gmGetValue(poolCacheKey, null));
      if (saved?.schema !== 1 || saved.season !== season || saved.scope !== scope || !Array.isArray(saved.entries)) return;
      for (const row of saved.entries.slice(0, 256)) try {
        if (!Number.isSafeInteger(row.setId) || row.setId < 1 || !Number.isSafeInteger(row.fetchedAt)
            || row.fetchedAt < 0 || row.fetchedAt > now()) continue;
        const pool = normalizeGalleryPool('futgg', row.payload, row.setId, season);
        pools.set(row.setId, { source: 'futgg', setId: row.setId, pool, fetchedAt: row.fetchedAt,
          etag: validator(row.etag), modified: validator(row.modified) });
      } catch { /* Corrupt pool snapshots are discarded individually. */ }
    } catch { /* Pool cache is optional. */ }
  })();
  const readPool = setId => {
    const numericId = poolInput(setId);
    if (numericId === null || typeof gmGetValue !== 'function') return Promise.resolve();
    if (poolReads.has(numericId)) return poolReads.get(numericId);
    const task = (async () => {
      await readPools();
      const valid = row => row?.schema === 1 && row.season === season && row.scope === scope
        && row.setId === numericId && Number.isSafeInteger(row.fetchedAt)
        && row.fetchedAt >= 0 && row.fetchedAt <= now();
      try {
        const row = await decodeGalleryCacheValue(await gmGetValue(poolEntryKey(numericId), null));
        if (valid(row)) {
          const pool = normalizeGalleryPool('futgg', row.payload, numericId, season);
          if (row.revision === pool.revision) pools.set(numericId, { source: 'futgg', setId: numericId,
            pool, fetchedAt: row.fetchedAt, etag: validator(row.etag), modified: validator(row.modified) });
        }
      } catch { /* The legacy snapshot remains an optional migration fallback. */ }
      try {
        const meta = await gmGetValue(`${poolEntryKey(numericId)}:checked`, null);
        const entry = pools.get(numericId);
        // Freshness can only extend the exact payload that was checked. This
        // also supports legacy payloads without rewriting them after a 304.
        if (entry && valid(meta) && meta.revision === entry.pool.revision && meta.fetchedAt >= entry.fetchedAt) {
          pools.set(numericId, { ...entry, fetchedAt: meta.fetchedAt,
            etag: validator(meta.etag), modified: validator(meta.modified) });
        }
      } catch { /* Missing freshness means a conservative conditional request. */ }
    })();
    poolReads.set(numericId, task); return task;
  };
  const persist = async () => {
    if (typeof gmSetValue !== 'function') return;
    const records = [...entries.values()].map(({ catalog, ...entry }) => ({ ...entry, payload: galleryCachePayload(catalog) }));
    try { await gmSetValue(cacheKey, await encodeGalleryCacheValue({ schema: 2, season, scope, active: active?.source, entries: records })); } catch { /* Memory snapshot remains usable. */ }
  };
  const persistPool = async entry => {
    if (typeof gmSetValue !== 'function') return;
    const meta = { schema: 1, season, scope, setId: entry.setId, revision: entry.pool.revision,
      fetchedAt: entry.fetchedAt, etag: entry.etag, modified: entry.modified };
    try {
      if (!entry.unchanged) await gmSetValue(poolEntryKey(entry.setId), await encodeGalleryCacheValue({
        ...meta, payload: galleryPoolCachePayload(entry.pool),
      }));
      await gmSetValue(`${poolEntryKey(entry.setId)}:checked`, meta);
    } catch { /* Keep memory usable; a failed write cannot certify a different saved revision. */ }
  };
  const peek = async () => { await read(); return active ? observe(active, 'FC27_GALLERY_CATALOG_CACHE', { cached: true, stale: now() - active.fetchedAt >= ttlMs }) : null; };
  const request = async source => {
    if (now() < (retryAt.get(source) ?? 0)) throw new Error('FC27_GALLERY_BACKOFF');
    record('catalog-request', { source, phase: 'request', status: 'started', cached: entries.has(source) });
    const previous = entries.get(source); const headers = {};
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    else if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
    const response = await http.get(source, headers); const h = response.headers ?? {};
    if (response.status !== 200 && response.status !== 304) {
      const retry = /^\d+$/.test(h['retry-after']) ? Number(h['retry-after']) * 1000 : Date.parse(h['retry-after']) - now();
      if (Number.isFinite(retry) && retry > 0) retryAt.set(source, now() + Math.max(ttlMs, retry));
      throw new Error(`HTTP ${response.status}`);
    }
    if (response.status === 304 && !previous) throw new Error('FC27_GALLERY_304_WITHOUT_CACHE');
    let catalog;
    try { catalog = response.status === 304 ? previous.catalog : normalizeGalleryCatalog(source, JSON.parse(response.text), season); }
    catch { throw new Error('FC27_GALLERY_PAYLOAD_INVALID'); }
    const current = { source, catalog, fetchedAt: now(),
      etag: validator(h.etag) ?? (response.status === 304 ? previous.etag : null),
      modified: validator(h['last-modified']) ?? (response.status === 304 ? previous.modified : null) };
    entries.set(source, current); active = current; await persist();
    record('catalog-request', { source, phase: 'request', status: 'success', httpStatus: response.status,
      count: catalog.categories.reduce((total, category) => total + category.sets.length, 0), cached: response.status === 304 });
    return current;
  };
  const observePool = (entry, reason, extra = {}) => ({ status: 'observed', reason, source: entry.source,
    setId: entry.setId, pool: entry.pool, fetchedAt: entry.fetchedAt, revision: entry.pool.revision, ...extra });
  const poolInput = value => {
    if (Number.isSafeInteger(value) && value > 0 && value <= 1000000) return value;
    if (typeof value === 'string' && /^futgg:[1-9]\d{0,6}$/.test(value) && Number(value.slice(6)) <= 1000000) return Number(value.slice(6));
    return null;
  };
  const requestPool = async setId => {
    if (now() < (poolRetryAt.get(setId) ?? 0)) throw new Error('FC27_GALLERY_BACKOFF');
    record('pool-request', { source: 'futgg', phase: 'request', status: 'started' });
    if (typeof http.getPool !== 'function') throw new Error('FC27_GALLERY_POOL_TRANSPORT_UNAVAILABLE');
    const previous = pools.get(setId); const headers = {};
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    else if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
    const response = await http.getPool(setId, headers); const h = response.headers ?? {};
    if (response.status !== 200 && response.status !== 304) {
      const retryAfter = /^\d+$/.test(h['retry-after']) ? Number(h['retry-after']) * 1000 : Date.parse(h['retry-after']) - now();
      if (Number.isFinite(retryAfter) && retryAfter > 0) poolRetryAt.set(setId, now() + Math.max(ttlMs, retryAfter));
      throw new Error(`HTTP ${response.status}`);
    }
    if (response.status === 304 && !previous) throw new Error('FC27_GALLERY_304_WITHOUT_CACHE');
    let pool;
    try { pool = response.status === 304 ? previous.pool : normalizeGalleryPool('futgg', JSON.parse(response.text), setId, season); }
    catch { throw new Error('FC27_GALLERY_POOL_PAYLOAD_INVALID'); }
    const entry = { source: 'futgg', setId, pool, fetchedAt: now(),
      unchanged: response.status === 304 || previous?.pool?.revision === pool.revision,
      etag: validator(h.etag) ?? (response.status === 304 ? previous.etag : null),
      modified: validator(h['last-modified']) ?? (response.status === 304 ? previous.modified : null) };
    pools.set(setId, entry);
    // Persist only this Set. A 304 or an identical 200 updates its freshness
    // checkpoint without rewriting the other 126 pools.
    await persistPool(entry);
    record('pool-request', { source: 'futgg', phase: 'request', status: 'success', count: pool.items.length,
      httpStatus: response.status, cached: response.status === 304 });
    return entry;
  };
  const loadPool = ({ source = 'futgg', setId, force = false } = {}) => {
    const numericId = poolInput(setId);
    if (source !== 'futgg' || numericId === null) return Promise.resolve({ status: 'blocked', reason: 'FC27_GALLERY_POOL_UNAVAILABLE' });
    const current = poolInFlight.get(numericId);
    if (current) return current;
    const task = (async () => {
      await readPools(); await readPool(numericId);
      const previous = pools.get(numericId);
      if (!force && previous && now() - previous.fetchedAt < ttlMs) {
        record('pool-cache', { source: 'futgg', status: 'success', cached: true, count: previous.pool.items.length });
        return observePool(previous, 'FC27_GALLERY_POOL_CACHE', { cached: true });
      }
      try {
        const updated = await requestPool(numericId);
        // Unchanged public data can reuse mapping when account EA coverage is
        // also intact. Public cache identity alone is not ownership evidence.
        return observePool(updated, updated.unchanged ? 'FC27_GALLERY_POOL_UNCHANGED' : 'FC27_GALLERY_POOL_UPDATED',
          { cached: !!updated.unchanged, unchanged: !!updated.unchanged });
      }
      catch (error) {
        if (error?.message !== 'FC27_GALLERY_BACKOFF') poolRetryAt.set(numericId, Math.max(poolRetryAt.get(numericId) ?? 0, now() + ttlMs));
        const errorReason = safeReason(error);
        record('pool-request', { source: 'futgg', phase: 'request', status: 'failed', reason: errorReason,
          httpStatus: statusCode(errorReason), count: 1, cached: !!previous, stale: !!previous,
          retryAt: poolRetryAt.get(numericId) ?? null });
        const extra = { cached: !!previous, stale: !!previous, error: errorReason,
          retryAt: poolRetryAt.get(numericId) ?? null };
        return previous ? observePool(previous, 'FC27_GALLERY_POOL_REFRESH_FAILED', extra)
          : { status: 'blocked', reason: error.message.startsWith('FC27_') ? error.message : 'FC27_GALLERY_POOL_UNAVAILABLE', ...extra };
      }
    })().finally(() => poolInFlight.delete(numericId));
    poolInFlight.set(numericId, task); return task;
  };
  const peekPool = async ({ source = 'futgg', setId } = {}) => {
    const numericId = poolInput(setId);
    if (source !== 'futgg' || numericId === null) return null;
    await readPools(); await readPool(numericId); const entry = pools.get(numericId);
    return entry ? observePool(entry, 'FC27_GALLERY_POOL_CACHE', { cached: true, stale: now() - entry.fetchedAt >= ttlMs }) : null;
  };
  const priceIds = ids => [...new Set((ids ?? []).map(Number).filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
  const priceKey = (ids, platform) => `${platform}:${ids.join(',')}`;
  const priceReason = error => /^(HTTP \d{3}|FC27_GALLERY_[A-Z_]+)$/.test(error?.message)
    ? error.message : 'FC27_GALLERY_PRICE_UNAVAILABLE';
  const priceReads = new Map(), priceLegacyReads = new Map(), priceBatchInFlight = new Map();
  const freshPriceBatch = entry => Number.isSafeInteger(entry?.fetchedAt) && entry.fetchedAt >= 0
    && entry.fetchedAt <= now() && now() - entry.fetchedAt < ttlMs;
  const readPriceBatch = (batch, platform) => {
    const key = priceKey(batch, platform);
    if (priceReads.has(key)) return priceReads.get(key);
    const task = (async () => {
      if (typeof gmGetValue !== 'function') return;
      try {
        const cached = await gmGetValue(`${cacheKey}:prices:${key}`, null);
        if (![1, 2].includes(cached?.schema) || cached.season !== season || cached.platform !== platform
            || !Array.isArray(cached.ids) || cached.ids.join(',') !== batch.join(',')) return;
        if (cached.schema === 2 && cached.fetchedAt != null && (!Number.isSafeInteger(cached.fetchedAt)
            || cached.fetchedAt < 0 || cached.fetchedAt > now())) return;
        const prices = parseGalleryPriceResponse(JSON.stringify({ data: batch.map(eaId => ({ eaId, price: cached.prices?.[eaId] })) }));
        priceMemory.set(key, { prices, fetchedAt: cached.schema === 2 ? cached.fetchedAt ?? null : null,
          retryAt: Number.isSafeInteger(cached.retryAt) && cached.retryAt > now() ? cached.retryAt : null,
          error: typeof cached.error === 'string' ? priceReason({ message: cached.error }) : null });
      } catch { /* Corrupt or unavailable price cache does not prevent a read. */ }
    })();
    priceReads.set(key, task); return task;
  };
  const requestPriceBatch = (batch, platform) => {
    const key = priceKey(batch, platform);
    if (priceBatchInFlight.has(key)) return priceBatchInFlight.get(key);
    const task = (async () => {
      await readPriceBatch(batch, platform);
      const previous = priceMemory.get(key);
      if (freshPriceBatch(previous) || now() < (previous?.retryAt ?? 0)) {
        record('price-cache', { source: 'futgg', status: previous?.error ? 'failed' : 'success',
          reason: previous?.error ?? undefined, batchSize: batch.length, cached: true, stale: !freshPriceBatch(previous),
          retryAt: previous?.retryAt ?? undefined });
        return previous;
      }
      let entry;
      record('price-request', { source: 'futgg', phase: 'request', status: 'started', batchSize: batch.length });
      try {
        if (typeof http.getPrices !== 'function') throw new Error('FC27_GALLERY_PRICE_TRANSPORT_UNAVAILABLE');
        const response = await http.getPrices(batch, { platform });
        if (response.status !== 200) {
          const value = response.headers?.['retry-after'];
          const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now();
          entry = { prices: previous?.prices ?? {}, fetchedAt: previous?.fetchedAt ?? null,
            error: `HTTP ${response.status}`, retryAt: now() + Math.max(ttlMs, Number.isFinite(delay) ? delay : 0) };
        } else {
          let payload;
          try { payload = JSON.parse(response.text); } catch { throw new Error('FC27_GALLERY_PRICE_PAYLOAD_INVALID'); }
          if (!Array.isArray(payload?.data)) throw new Error('FC27_GALLERY_PRICE_PAYLOAD_INVALID');
          const parsed = parseGalleryPriceResponse(response.text);
          const prices = Object.fromEntries(batch.filter(id => Object.hasOwn(parsed, id)).map(id => [id, parsed[id]]));
          entry = { prices, fetchedAt: now(), retryAt: null, error: null };
        }
      } catch (error) {
        entry = { prices: previous?.prices ?? {}, fetchedAt: previous?.fetchedAt ?? null,
          error: priceReason(error), retryAt: now() + ttlMs };
      }
      record('price-request', { source: 'futgg', phase: 'request', status: entry?.error ? 'failed' : 'success',
        reason: entry?.error ?? undefined, httpStatus: statusCode(entry?.error), batchSize: batch.length,
        cached: !!previous?.fetchedAt, count: Object.keys(entry.prices).length, retryAt: entry.retryAt ?? undefined });
      priceMemory.set(key, entry);
      try { await gmSetValue?.(`${cacheKey}:prices:${key}`, { schema: 2, season, platform, ids: batch, ...entry }); }
      catch { /* A failed persistent write leaves the memory result usable. */ }
      return entry;
    })().finally(() => priceBatchInFlight.delete(key));
    priceBatchInFlight.set(key, task); return task;
  };
  const loadPriceSnapshot = (ids, { platform = 'pc' } = {}) => {
    const values = priceIds(ids);
    if (!values.length || values.length > 250 || !['pc', 'console'].includes(platform)) return Promise.resolve(Object.freeze({
      prices: Object.freeze({}), freshPrices: Object.freeze({}), missingIds: values, staleIds: [], stale: true,
      error: 'FC27_GALLERY_PRICE_IDS_INVALID', retryAt: null, expiresAt: null,
    }));
    const key = priceKey(values, platform);
    if (priceInFlight.has(key)) return priceInFlight.get(key);
    const task = (async () => {
      const batches = [];
      for (let start = 0; start < values.length; start += FUTGG_PRICE_BATCH_SIZE) batches.push(values.slice(start, start + FUTGG_PRICE_BATCH_SIZE));
      // Older builds persisted an entire collection without timestamps.
      // Retain that snapshot for display only, never as a fresh quote.
      if (batches.length > 1 && !priceLegacyReads.has(key)) priceLegacyReads.set(key, (async () => {
        try {
          const cached = await gmGetValue?.(`${cacheKey}:prices:${key}`, null);
          if (cached?.schema !== 1 || cached.season !== season || cached.platform !== platform
              || cached.ids?.join(',') !== values.join(',')) return;
          for (const batch of batches) {
            const batchKey = priceKey(batch, platform);
            if (!priceMemory.has(batchKey)) priceMemory.set(batchKey, { fetchedAt: null, retryAt: null, error: null,
              prices: parseGalleryPriceResponse({ data: batch.map(eaId => ({ eaId, price: cached.prices?.[eaId] })) }) });
          }
        } catch { /* Legacy snapshots are optional. */ }
      })());
      await priceLegacyReads.get(key);
      // Read every saved batch first so a failure cannot hide later snapshots.
      for (const batch of batches) await readPriceBatch(batch, platform);
      for (const batch of batches) {
        const entry = await requestPriceBatch(batch, platform);
        if (entry?.error) break;
      }
      const prices = {}, freshPrices = {}, staleIds = [], missingIds = [];
      let error = null, retryAt = null, stale = false, expiresAt = null;
      for (const batch of batches) {
        const entry = priceMemory.get(priceKey(batch, platform)), fresh = freshPriceBatch(entry);
        if (!fresh) stale = true;
        if (entry?.error) error ??= entry.error;
        if (entry?.retryAt > now()) retryAt = Math.max(retryAt ?? 0, entry.retryAt);
        if (fresh) expiresAt = Math.min(expiresAt ?? Infinity, entry.fetchedAt + ttlMs);
        for (const id of batch) {
          const price = entry?.prices?.[id];
          if (price == null) { missingIds.push(id); continue; }
          prices[id] = price;
          if (fresh) freshPrices[id] = price; else staleIds.push(id);
        }
      }
      if (error) priceErrors.set(key, error); else priceErrors.delete(key);
      return Object.freeze({ prices: Object.freeze(prices), freshPrices: Object.freeze(freshPrices),
        missingIds: Object.freeze(missingIds), staleIds: Object.freeze(staleIds), stale, error, retryAt, expiresAt });
    })().finally(() => priceInFlight.delete(key));
    priceInFlight.set(key, task); return task;
  };
  const loadPrices = async (ids, options) => (await loadPriceSnapshot(ids, options)).prices;
  const priceError = (ids, { platform = 'pc' } = {}) => {
    const values = [...new Set((ids ?? []).map(Number).filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
    return priceErrors.get(`${platform}:${values.join(',')}`) ?? null;
  };
  const refresh = async force => {
    await read(); const previous = active;
    if (!force && active && now() - active.fetchedAt < ttlMs) {
      record('catalog-cache', { source: active.source, status: 'success', cached: true });
      return observe(active, 'FC27_GALLERY_CATALOG_CACHE', { cached: true });
    }
    const errors = {};
    for (const source of ['futgg', 'fodder']) try {
      const current = await request(source);
      lastSourceErrors = Object.freeze(errors);
      return observe(current, 'FC27_GALLERY_CATALOG_UPDATED', { cached: false, changes: diffGalleryCatalog(previous?.catalog, current.catalog) });
    } catch (error) {
      errors[source] = safeReason(error);
      if (error?.message !== 'FC27_GALLERY_BACKOFF') retryAt.set(source, Math.max(retryAt.get(source) ?? 0, now() + ttlMs));
      record('catalog-request', { source, phase: 'request', status: 'failed', reason: errors[source],
        httpStatus: statusCode(errors[source]), cached: !!entries.get(source), retryAt: retryAt.get(source) ?? undefined });
    }
    lastSourceErrors = Object.freeze(errors);
    const extra = { errors, retryAt: Math.min(...retryAt.values()) };
    return active ? observe(active, 'FC27_GALLERY_CATALOG_REFRESH_FAILED', { cached: true, stale: true, ...extra }) : { status: 'blocked', reason: 'FC27_GALLERY_CATALOG_UNAVAILABLE', ...extra };
  };
  const load = ({ force = false } = {}) => inFlight ??= refresh(force).finally(() => { inFlight = null; });
  return Object.freeze({ load, refresh: () => load({ force: true }), peek, loadPool, peekPool, loadPrices, loadPriceSnapshot, priceError, cacheKey, poolCacheKey });
}
