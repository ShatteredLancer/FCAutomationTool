import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { addStorageRuntime } from '../helpers/fc27-storage-runtime.js';
import { createFc27StreamlinedStorageReader } from '../../src/adapters/ea/fc27-streamlined-storage-read.js';
import observation from '../fixtures/fc27-streamlined-storage-observation-2026-10-15.json';
import { webcrypto } from 'node:crypto';
import { verifyFc27Methods } from '../../src/adapters/ea/fc27-transaction-transport.js';
import { FC27_STREAMLINED_STORAGE_HASH } from '../../src/adapters/ea/fc27-streamlined-storage-read.js';
import { observedStorageFunction as nativeFunction, installObservedStorage } from '../helpers/fc27-observed-storage-runtime.js';

it('accepts the reviewed public Storage methods with real source hashes and one owned fresh read, not the cached DAO', async () => {
  const f = executionRuntime(); addStorageRuntime(f, { payload: [{ id: 501, resourceId: 101, pile: 8 }] });
  installObservedStorage(f);
  const reader = await createFc27StreamlinedStorageReader(f.root);
  expect(await reader.read()).toMatchObject([{ id: 501, definitionId: 101, pile: 'storage' }]);
  expect(f.calls).toEqual([{ kind: 'storage', method: 'GET', url: 'https://utas.test.ea.com/ut/game/fc27/storagepile?skuMode=FUT',
    cache: false, retry: false, reauth: false }]);
  // Scope the compatibility to the Storage reader, not the shared write verifier.
  await expect(verifyFc27Methods({ methods: { search: f.root.services.Item.itemDao.searchStorageItems }, crypto: webcrypto },
    [['methods.search', FC27_STREAMLINED_STORAGE_HASH]])).rejects.toThrow('METHOD_UNREVIEWED');
});

it('keeps unknown replacements blocked after a public Storage read has been reviewed', async () => {
  const f = executionRuntime(), state = addStorageRuntime(f); installObservedStorage(f);
  const reader = await createFc27StreamlinedStorageReader(f.root);
  f.root.services.Item.itemDao.searchStorageItems = () => {};
  await expect(reader.read()).rejects.toThrow('STORAGE_CONTEXT_CHANGED');
  expect(f.calls).toHaveLength(0); expect(state.request).toBeUndefined();
});

it('replays the public native Storage endpoint/query, local filtering and cached 304 branch without network', () => {
  const calls = [], notices = [], criteria = { rating: 82 }, items = [{ id: 501 }];
  const repo = { isDirty: vi.fn(() => true), searchStorage: vi.fn(() => items),
    setPileSize: vi.fn(), setStorageItems: vi.fn(), setCacheTimestamp: vi.fn() };
  const query = nativeFunction(observation.methods[1], { HttpUtils: { generateUrlParams: values => `?${new URLSearchParams(values)}` } });
  class Request { constructor() { this.requestType = 'GET'; } setPath(value) { this.url = value; } }
  Request.prototype.setUrlVariables = query;
  const search = nativeFunction(observation.methods[0], { EAObservable: class { notify(value) { notices.push(value); } },
    UTHttpResponseDTO: class {}, ItemPile: { STORAGE: 8 }, HttpStatusCode: { NOT_MODIFIED: 304 },
    UTHttpRequest: Request, GAME_NAME: 'fc27', Date: { now: () => 1000 },
    JSUtils: { assignPropertyValues: (source, target) => Object.assign(target, source), isObject: value => value !== null && typeof value === 'object' },
    factories: { Item: { generateItemsFromItemData: vi.fn(() => items) } },
    services: { UTUtasRequestQueue: { send: request => {
      calls.push({ method: request.requestType, path: request.url, query: request.urlVariables, cache: request.cache });
      return { observe: (_owner, callback) => callback({ unobserve() {} }, { success: true, status: 200,
        response: { itemData: items, maxSize: 100 } }) };
    } } } });
  const dao = { itemRepo: repo, authDelegate: {} };
  search.call(dao, criteria);
  expect(calls).toEqual([{ method: 'GET', path: '/ut/game/fc27/storagepile', query: '?skuMode=FUT', cache: false }]);
  expect(repo.searchStorage).toHaveBeenCalledWith(criteria); expect(repo.setStorageItems).toHaveBeenCalledWith(items);
  repo.isDirty.mockReturnValue(false); search.call(dao, criteria);
  expect(calls).toHaveLength(1); expect(notices.at(-1)).toMatchObject({ status: 304, response: { items, endOfList: true } });
});

it('reads Storage once without DAO cache or shared hydration and preserves duplicate versions', async () => {
  const f = executionRuntime(), state = addStorageRuntime(f, { payload: [
    { id: 501, resourceId: 101, pile: 8 }, { id: 502, resourceId: 101, pile: 8 }] });
  const before = JSON.stringify(f.root.repositories), entities = [];
  const reader = await createFc27StreamlinedStorageReader(f.root, { nativeReauth: true, onEntity: item => entities.push(item) });
  const rows = await reader.read();
  expect(rows.map(row => [row.id, row.definitionId, row.pile])).toEqual([[501, 101, 'storage'], [502, 101, 'storage']]);
  expect(entities).toHaveLength(2); expect(reader.getRequestCount()).toBe(1);
  expect(f.calls).toEqual([{ kind: 'storage', method: 'GET', url: 'https://utas.test.ea.com/ut/game/fc27/storagepile?skuMode=FUT',
    cache: false, retry: true, reauth: true }]);
  expect(JSON.stringify(f.root.repositories)).toBe(before);
  state.payload = [];
  await expect(reader.read()).resolves.toEqual([]);
});

it('refuses cached/failed responses and malformed, wrong-pile or repeated item IDs', async () => {
  for (const config of [{ status: 304 }, { status: 401 }, { status: 429 }, { payload: null },
    { payload: [{ id: 501, resourceId: 101, pile: 7 }] },
    { payload: [{ id: 501, resourceId: 101, pile: 8 }, { id: 501, resourceId: 101, pile: 8 }] },
    { payload: [{ id: 501, resourceId: 0, pile: 8 }] }]) {
    const f = executionRuntime(); addStorageRuntime(f, config);
    const reader = await createFc27StreamlinedStorageReader(f.root);
    await expect(reader.read()).rejects.toThrow();
    await expect(reader.read()).rejects.toThrow('STORAGE_READ_BLOCKED');
    expect(f.calls).toHaveLength(1);
  }
});

it('rejects changed methods, account changes, unrelated responses and concurrent reads', async () => {
  const f = executionRuntime(), state = addStorageRuntime(f);
  f.root.services.Item.itemDao.searchStorageItems = () => {};
  await expect(createFc27StreamlinedStorageReader(f.root)).rejects.toThrow('METHOD_UNREVIEWED');
  expect(f.calls).toHaveLength(0);
  const g = executionRuntime(), held = addStorageRuntime(g); held.hold = true;
  const reader = await createFc27StreamlinedStorageReader(g.root);
  const read = reader.read();
  await expect(reader.read()).rejects.toThrow('STORAGE_READ_BLOCKED');
  g.user.selectedPersona = 999;
  held.request.callback(held.request, { success: true, status: 200, response: { itemData: [] } });
  await expect(read).rejects.toThrow();
  const h = executionRuntime(); Object.assign(addStorageRuntime(h), { wrongOwner: true });
  await expect((await createFc27StreamlinedStorageReader(h.root)).read()).rejects.toThrow('RESPONSE_OWNER');
  expect(state.request).toBeUndefined();
});

it('disables native retries and aborts the owned request when it times out', async () => {
  vi.useFakeTimers();
  try {
    const f = executionRuntime(), state = addStorageRuntime(f); state.hold = true;
    const reader = await createFc27StreamlinedStorageReader(f.root, { nativeReauth: true });
    const read = reader.read(), rejected = expect(read).rejects.toThrow('STORAGE_READ_TIMEOUT');
    await vi.advanceTimersByTimeAsync(16000); await rejected;
    expect(state.request.doRetry).toBe(false); expect(state.request.doReauth).toBe(false);
    expect(f.calls.at(-1)).toEqual({ kind: 'abort' });
  } finally { vi.useRealTimers(); }
});

it('rejects a replaced query method before dispatch or before accepting the response', async () => {
  const f = executionRuntime(); addStorageRuntime(f);
  f.root.UTHttpRequest.prototype.setUrlVariables = () => {};
  await expect(createFc27StreamlinedStorageReader(f.root)).rejects.toThrow('METHOD_UNREVIEWED');
  expect(f.calls).toHaveLength(0);
  const g = executionRuntime(), state = addStorageRuntime(g); state.hold = true;
  const reader = await createFc27StreamlinedStorageReader(g.root), pending = reader.read();
  g.root.UTHttpRequest.prototype.setUrlVariables = () => {};
  state.request.callback(state.request, { success: true, status: 200, response: { itemData: [] } });
  await expect(pending).rejects.toThrow('STORAGE_CONTEXT_CHANGED');
});
