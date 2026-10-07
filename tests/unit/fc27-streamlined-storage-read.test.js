import { expect, it, vi } from 'vitest';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { addStorageRuntime } from '../helpers/fc27-storage-runtime.js';
import { createFc27StreamlinedStorageReader } from '../../src/adapters/ea/fc27-streamlined-storage-read.js';

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
