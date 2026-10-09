import { afterEach, expect, it, vi } from 'vitest';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { compactGalleryCollectionCaches } from '../../src/adapters/browser/fc27-gallery-cache-migration.js';
import { decodeGalleryCollectionCache } from '../../src/adapters/browser/fc27-gallery-cache-codec.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(accountScope = 'fixture-account') {
  const context = { schema: 1, season: '27', accountScope, platform: 'pc' };
  return { key: contextKey(context, 'gallery-collection'), value: { schema: 3, context,
    concepts: Array.from({ length: 1500 }, (_, index) => ({ definitionId: index + 1,
      isCollected: true, gradingScore: 100, readAt: 1000,
      cardData: { rating: 80, rareflag: 200, attributeArray: [80, 80, 80, 80, 80, 80],
        statsList: Array(30).fill(0), hyperCosmetics: { 1: 3 } } })),
    fullSyncAt: 1000, firstOwnerHistory: [{ definitionId: 1, firstOwned: true }], coveredDefinitionIds: [1, 2] } };
}

function storeOptions(store) {
  return { list: () => [...store.keys()], get: vi.fn(key => structuredClone(store.get(key))),
    set: vi.fn((key, value) => store.set(key, structuredClone(value))) };
}

it('compacts all account collections without login and never reads Journals or other caches', async () => {
  const a = fixture(), b = fixture('other-account');
  const store = new Map([[a.key, a.value], [b.key, b.value], ['gallery-purchase-journal', { unknownReceipt: true }],
    [contextKey({ ...a.value.context, season: '26' }, 'gallery-collection'), a.value]]);
  const options = storeOptions(store);
  expect(await compactGalleryCollectionCaches(options)).toEqual({ status: 'completed', total: 2, checked: 2, compacted: 2, failed: 0 });
  expect(await decodeGalleryCollectionCache(store.get(a.key))).toEqual(a.value);
  expect(await decodeGalleryCollectionCache(store.get(b.key))).toEqual(b.value);
  expect(options.get.mock.calls.every(([key]) => [a.key, b.key].includes(key))).toBe(true);
  options.set.mockClear();
  expect(await compactGalleryCollectionCaches(options)).toMatchObject({ status: 'completed', compacted: 0 });
  expect(options.set).not.toHaveBeenCalled();
});

it('does not change a cache whose stored account does not match its key', async () => {
  const a = fixture(), b = fixture('other-account');
  const store = new Map([[a.key, b.value]]), options = storeOptions(store);
  expect(await compactGalleryCollectionCaches(options)).toMatchObject({ compacted: 0 });
  expect(options.set).not.toHaveBeenCalled(); expect(store.get(a.key)).toEqual(b.value);
});

it('retains a concurrently updated collection instead of overwriting it', async () => {
  const a = fixture(), changed = { ...a.value, fetchedAt: 2000 };
  const store = new Map([[a.key, a.value]]), options = storeOptions(store);
  options.get.mockImplementationOnce(() => structuredClone(a.value)).mockImplementation(() => changed);
  expect(await compactGalleryCollectionCaches(options)).toMatchObject({ status: 'partial', compacted: 0, failed: 1 });
  expect(options.set).not.toHaveBeenCalled();
});

it('reports failed reads/writes and continues independent accounts', async () => {
  const a = fixture(), b = fixture('other-account');
  const store = new Map([[a.key, a.value], [b.key, b.value]]), options = storeOptions(store);
  options.get.mockImplementation(key => { if (key === a.key) throw Error('private error'); return store.get(key); });
  const result = await compactGalleryCollectionCaches(options);
  expect(result).toMatchObject({ status: 'partial', checked: 2, compacted: 1, failed: 1 });
  expect(JSON.stringify(result)).not.toContain('private'); expect(store.get(a.key)).toEqual(a.value);
  options.set.mockImplementation(() => { throw Error('write failed'); });
  options.get.mockImplementation(key => store.get(key));
  expect(await compactGalleryCollectionCaches(options)).toMatchObject({ status: 'partial', compacted: 0, failed: 1 });
});

it('does not report a dropped GM write as completed compaction', async () => {
  const a = fixture(), options = storeOptions(new Map([[a.key, a.value]]));
  options.set.mockImplementation(() => {});
  expect(await compactGalleryCollectionCaches(options)).toMatchObject({ status: 'partial', compacted: 0, failed: 1 });
});

it('reports unavailable compression and never discards the original data', async () => {
  vi.stubGlobal('CompressionStream', undefined);
  const a = fixture(), options = storeOptions(new Map([[a.key, a.value]]));
  expect(await compactGalleryCollectionCaches(options)).toMatchObject({ status: 'partial', compacted: 0, failed: 1 });
  expect(options.set).not.toHaveBeenCalled();
});

it('uses a storage maintenance lock and emits counts without account identifiers', async () => {
  const a = fixture(), progress = [], options = storeOptions(new Map([[a.key, a.value]]));
  const locks = { request: vi.fn(async (name, flags, run) => run()) };
  const result = await compactGalleryCollectionCaches({ ...options, locks, onProgress: report => progress.push(report) });
  expect(locks.request).toHaveBeenCalledWith('fcat:gallery-collection-compaction', { mode: 'exclusive' }, expect.any(Function));
  expect(progress[0].status).toBe('running'); expect(progress.at(-1)).toEqual(result);
  expect(JSON.stringify(progress)).not.toContain(a.value.context.accountScope);
});

it('returns a sanitized failure when storage enumeration is unavailable', async () => {
  expect(await compactGalleryCollectionCaches()).toMatchObject({ status: 'failed', failed: 1 });
  expect(await compactGalleryCollectionCaches({ list: () => { throw Error('private'); }, get() {}, set() {} }))
    .toMatchObject({ status: 'failed', failed: 1 });
});
