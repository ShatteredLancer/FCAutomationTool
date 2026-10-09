import { expect, it, vi } from 'vitest';
import { compactGalleryPublicCaches } from '../../src/adapters/browser/fc27-gallery-public-cache-migration.js';
import { decodeGalleryCacheValue } from '../../src/adapters/browser/fc27-gallery-cache-codec.js';
import { createFc27GalleryCatalogProvider } from '../../src/adapters/browser/fc27-gallery-catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { futggGallery, futggGalleryPool } from '../fixtures/fc27-gallery.js';

const base = 'fcat-fc27-gallery-pools:27:public';
const row = setId => ({ setId, fetchedAt: 1000, etag: '"pool"', payload: futggGalleryPool(setId) });
const options = store => ({ list: () => [...store.keys()], get: key => structuredClone(store.get(key) ?? null),
  set: vi.fn((key, value) => store.set(key, structuredClone(value))) });

it('migrates every legacy pool durably before clearing the aggregate and preserves full DTOs', async () => {
  const rows = [row(30), row(31)]; rows[0].payload.extra = { retained: true };
  const store = new Map([[base, { schema: 1, season: '27', scope: 'public', entries: rows }], ['journal', { untouched: true }]]);
  const io = options(store);
  expect(await compactGalleryPublicCaches(io)).toMatchObject({ status: 'completed', migrated: 1, failed: 0 });
  expect(store.get(base)).toBeNull();
  expect(await decodeGalleryCacheValue(store.get(`${base}:set:30`))).toMatchObject(rows[0]);
  const getPool = vi.fn();
  const provider = createFc27GalleryCatalogProvider({ http: { get() {}, getPool }, now: () => 1000,
    gmGetValue: io.get, gmSetValue: io.set });
  expect(await provider.loadPool({ setId: 31 })).toMatchObject({ cached: true, pool: normalizeGalleryPool('futgg', rows[1].payload, 31) });
  expect(getPool).not.toHaveBeenCalled(); expect(store.get('journal')).toEqual({ untouched: true });
});

it('retains valid newer per-set data and independent checked metadata', async () => {
  const fresh = { ...row(30), schema: 1, season: '27', scope: 'public', fetchedAt: 2000,
    revision: normalizeGalleryPool('futgg', futggGalleryPool(30), 30).revision };
  const store = new Map([[base, { schema: 1, season: '27', scope: 'public', entries: [row(30)] }],
    [`${base}:set:30`, fresh], [`${base}:set:30:checked`, { fetchedAt: 3000 }]]);
  expect(await compactGalleryPublicCaches(options(store))).toMatchObject({ migrated: 1 });
  expect(store.get(`${base}:set:30`)).toEqual(fresh);
  expect(store.get(`${base}:set:30:checked`)).toEqual({ fetchedAt: 3000 });
});

it('does not parse freshness metadata as pool payloads or report false failures', async () => {
  const store = new Map([[`${base}:set:30:checked`, { schema: 1, season: '27', scope: 'public',
    setId: 30, fetchedAt: 1000, revision: 'exact' }], [`${base}:checked`, { checked: true }]]);
  const io = options(store);
  expect(await compactGalleryPublicCaches(io)).toMatchObject({ checked: 0, failed: 0, status: 'completed' });
  expect(io.set).not.toHaveBeenCalled();
});

it.each(['corrupt', 'dropped-write', 'changed-aggregate'])('retains the aggregate on %s', async kind => {
  const legacy = { schema: 1, season: '27', scope: 'public', entries: [row(30), row(31)] };
  if (kind === 'corrupt') legacy.entries[1].payload = {};
  const store = new Map([[base, legacy]]), io = options(store);
  if (kind === 'dropped-write') io.set.mockImplementation(() => {});
  if (kind === 'changed-aggregate') io.set.mockImplementation((key, value) => {
    store.set(key, value); store.set(base, { ...legacy, changed: true });
  });
  expect(await compactGalleryPublicCaches(io)).toMatchObject({ status: 'partial', migrated: 0, failed: 1 });
  expect(store.get(base)).toBeTruthy();
});

it('compresses catalog and pool snapshots and restores both without network reads', async () => {
  const payload = futggGalleryPool(); payload.padding = 'full DTO retained'.repeat(16000);
  const pool = { ...row(30), payload, schema: 1, season: '27', scope: 'public',
    revision: normalizeGalleryPool('futgg', payload, 30).revision };
  const catalogKey = 'fcat-fc27-gallery-catalog:27:public';
  const catalog = { schema: 2, season: '27', scope: 'public', active: 'futgg',
    entries: [{ source: 'futgg', fetchedAt: 1000, payload: { ...futggGallery(), padding: payload.padding } }] };
  const store = new Map([[`${base}:set:30`, pool], [catalogKey, catalog]]), io = options(store);
  expect(await compactGalleryPublicCaches(io)).toMatchObject({ compacted: 2, failed: 0 });
  expect(store.get(catalogKey).format).toBe('fcat-gallery-gzip-v1');
  expect(await decodeGalleryCacheValue(store.get(catalogKey))).toEqual(catalog);
  const get = vi.fn(), getPool = vi.fn();
  const provider = createFc27GalleryCatalogProvider({ http: { get, getPool }, now: () => 1000,
    gmGetValue: io.get, gmSetValue: io.set });
  expect(await provider.loadPool({ setId: 30 })).toMatchObject({ cached: true });
  expect(await provider.load()).toMatchObject({ cached: true });
  expect(get).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
});

it('waits for startup migration before restoring a pool', async () => {
  let finish;
  const cacheMigration = new Promise(resolve => { finish = resolve; });
  const get = vi.fn();
  const provider = createFc27GalleryCatalogProvider({ http: { get() {} }, cacheMigration, gmGetValue: get });
  const pending = provider.peekPool({ setId: 30 });
  await Promise.resolve(); expect(get).not.toHaveBeenCalled();
  finish(); await pending; expect(get).toHaveBeenCalled();
});
