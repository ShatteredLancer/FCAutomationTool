import { expect, it, vi } from 'vitest';
import { createFc27GallerySync } from '../../src/adapters/browser/fc27-gallery-sync.js';
import { createFc27GalleryCatalogProvider } from '../../src/adapters/browser/fc27-gallery-catalog.js';
import { futggGallery, futggGalleryPool } from '../fixtures/fc27-gallery.js';

function fixture() {
  const store = new Map(), coverage = new Map(), writes = [];
  let scope = 'account-a', time = 1000;
  const catalog = futggGallery();
  catalog.data.categories[0].sets.push({ ...structuredClone(catalog.data.categories[0].sets[0]), id: 31, slug: 'second' });
  const get = vi.fn(async () => ({ status: 200, text: JSON.stringify(catalog), headers: {} }));
  const getPool = vi.fn(async id => ({ status: 200, text: JSON.stringify(futggGalleryPool(id)), headers: { etag: `"${id}"` } }));
  const gmGetValue = async (key, fallback) => structuredClone(store.get(key) ?? fallback);
  const gmSetValue = async (key, value) => { writes.push(key); store.set(key, structuredClone(value)); };
  const project = vi.fn(async pool => ({ status: 'observed', scope, pool,
    progress: { complete: coverage.get(`${scope}:${pool.setId}`) === pool.revision, poolRevision: pool.revision } }));
  const reader = { scope: () => scope, syncState: () => ({ synced: true, needsRefresh: false }),
    subscribe: () => () => {}, stop: vi.fn(), project,
    sync: vi.fn(async () => ({ status: 'observed', scope })),
    load: vi.fn(async pool => { coverage.set(`${scope}:${pool.setId}`, pool.revision); return project(pool); }) };
  const provider = () => createFc27GalleryCatalogProvider({ http: { get, getPool }, gmGetValue, gmSetValue, now: () => time });
  const make = () => createFc27GallerySync({ provider: provider(), reader, gmGetValue, gmSetValue, now: () => time, wait: async () => {} });
  return { store, writes, coverage, get, getPool, reader, make, provider, catalog,
    advance: () => { time += 300001; }, switchAccount: () => { scope = 'account-b'; } };
}
it('restores mapping completion and skips the pool queue after a reload with valid caches', async () => {
  const f = fixture(); await f.make().sync({ source: 'futgg' });
  f.getPool.mockClear(); f.reader.load.mockClear();
  const resumed = f.make(), progress = [];
  await resumed.peekDetails('futgg');
  expect(resumed.state().synced).toBe(true);
  await resumed.sync({ source: 'futgg', onProgress: row => progress.push(row) });
  expect(f.getPool).not.toHaveBeenCalled(); expect(f.reader.load).not.toHaveBeenCalled();
  expect(progress.filter(row => row.phase === 'pools')).toEqual([]);
});
it('checks expired pools but remaps only a changed set, preserving other persisted payloads on 304', async () => {
  const f = fixture(); await f.make().sync({ source: 'futgg' });
  f.advance(); f.reader.load.mockClear(); f.writes.length = 0;
  f.getPool.mockImplementation(async id => {
    const pool = futggGalleryPool(id); pool.data.items[0].score++;
    return id === 30 ? { status: 304, headers: {} } : { status: 200, text: JSON.stringify(pool), headers: { etag: '"changed"' } };
  });
  await f.make().sync({ source: 'futgg' });
  expect(f.reader.load.mock.calls.map(([pool]) => pool.setId)).toEqual([31]);
  const base = f.provider().poolCacheKey;
  expect(f.writes).toContain(`${base}:set:31`);
  expect(f.writes).toContain(`${base}:set:31:checked`);
  expect(f.writes).toContain(`${base}:set:30:checked`);
  expect(f.writes).not.toContain(`${base}:set:30`);
  expect(f.writes).not.toContain(base);
  f.reader.load.mockClear(); f.getPool.mockClear();
  await f.make().sync({ source: 'futgg' });
  expect(f.getPool).not.toHaveBeenCalled(); expect(f.reader.load).not.toHaveBeenCalled();
});
it('keeps mappings on a 200 response with identical content and treats an account switch separately', async () => {
  const f = fixture(); await f.make().sync({ source: 'futgg' });
  f.advance(); f.reader.load.mockClear(); f.writes.length = 0;
  await f.make().sync({ source: 'futgg' });
  expect(f.reader.load).not.toHaveBeenCalled();
  expect(f.writes.filter(key => key.includes(':set:') && !key.endsWith(':checked'))).toHaveLength(0);
  expect(f.writes.filter(key => key.includes(':set:') && key.endsWith(':checked'))).toHaveLength(2);
  f.switchAccount(); const next = f.make(); await next.peekDetails('futgg');
  expect(next.state().synced).toBe(false);
  await next.sync({ source: 'futgg' }); expect(f.reader.load).toHaveBeenCalledTimes(2);
});
it('does not trust persisted completion when EA coverage is missing or a set is new', async () => {
  const f = fixture(); await f.make().sync({ source: 'futgg' });
  f.coverage.delete('account-a:30'); f.reader.load.mockClear();
  await f.make().sync({ source: 'futgg' }); expect(f.reader.load.mock.calls.map(([pool]) => pool.setId)).toEqual([30]);
  f.advance(); f.reader.load.mockClear();
  f.catalog.data.categories[0].sets.splice(0, 1, { ...f.catalog.data.categories[0].sets[0], id: 32, slug: 'new' });
  const result = await f.make().sync({ source: 'futgg' });
  expect(f.reader.load.mock.calls.map(([pool]) => pool.setId)).toEqual([32]);
  expect(result.details.map(row => row.pool.setId)).toEqual([31, 32]);
});
it('keeps failures pending across reload and never marks an interrupted sweep complete', async () => {
  const f = fixture();
  f.getPool.mockImplementation(async id => id === 31 ? { status: 429, headers: {} }
    : { status: 200, text: JSON.stringify(futggGalleryPool(id)), headers: {} });
  const sync = f.make(); expect((await sync.sync({ source: 'futgg' })).status).toBe('partial');
  const resumed = f.make(); await resumed.peekDetails('futgg'); expect(resumed.state().synced).toBe(false);
  f.getPool.mockImplementation(async id => ({ status: 200, text: JSON.stringify(futggGalleryPool(id)), headers: {} }));
  f.reader.load.mockClear(); await resumed.sync({ source: 'futgg' });
  expect(f.reader.load.mock.calls.map(([pool]) => pool.setId)).toEqual([31]);
});
