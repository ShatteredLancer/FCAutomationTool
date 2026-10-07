import { expect, it, vi } from 'vitest';
import { streamlinedRuntime, pendingContribution } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedCache, FC27_STREAMLINED_CACHE_METHODS } from '../../src/adapters/ea/fc27-streamlined-cache.js';

async function fixture(options) {
  const f = streamlinedRuntime(options), p = await pendingContribution(f), root = f.root;
  const removed = vi.fn(), reset = vi.fn();
  root.services.Squad = { resetSquadsCache() { reset(); } };
  root.services.SBC.removeItemsById = function(ids) { removed(ids); };
  root.services.SBC._evictSubmittedItems = function(ids) {
    ids.forEach(id => {
      if (root.repositories.Item.storage?._collection[id]) delete root.repositories.Item.storage._collection[id];
      else root.repositories.Item.club.items.remove(id);
    });
    this.removeItemsById(ids); root.services.Squad.resetSquadsCache();
  };
  const functions = [root.services.SBC._evictSubmittedItems, root.services.SBC.removeItemsById,
    root.services.Squad.resetSquadsCache, root.events.markClubCacheDirty];
  const hashes = new Map(functions.map((fn, i) => [String(fn).replace(/\r\n/g, '\n'), FC27_STREAMLINED_CACHE_METHODS[i][1]]));
  root.crypto.subtle.digest = async (_alg, bytes) => Uint8Array.from(Buffer.from(hashes.get(new TextDecoder().decode(bytes)) ?? '0'.repeat(64), 'hex')).buffer;
  const cache = await createFc27StreamlinedCache(root, { now: () => 1000 });
  const evidence = { fresh: true, operationConfirmed: true, context: f.plan.context, setId: 31, challengeId: 61,
    absent: p.batch.refs, submittedScore: 100, observedAt: 1000 };
  return { ...f, ...p, cache, evidence, removed, reset };
}

it('evicts only confirmed exact IDs through the native path and is repeatable after persistence failure', async () => {
  const f = await fixture(), collection = f.root.repositories.Item.club.items._collection;
  collection[100] = { ...collection[1], id: 100 }; // another copy of the same version
  f.cache.prepare(f.batch.refs);
  expect(collection[1]).toBeDefined(); expect(f.removed).not.toHaveBeenCalled();
  expect(f.cache.apply(f.record, f.batch, f.evidence)).toBe(true);
  expect(f.cache.apply(f.record, f.batch, f.evidence)).toBe(true);
  expect(collection[100]).toBeDefined(); expect(collection[6]).toBeDefined(); expect(collection[1]).toBeUndefined();
  expect(f.root.info.base.clubCache.localDirty).toBe(true);
  expect(f.removed).toHaveBeenCalledWith([1, 2, 3, 4, 5]); expect(f.reset).toHaveBeenCalledTimes(2);
});

it('evicts only the submitted Storage copy and rejects identity reuse before touching either pile', async () => {
  for (const changed of [false, true]) {
    const f = await fixture({ mixedStorage: true }), club = f.root.repositories.Item.club.items._collection;
    const storage = f.root.repositories.Item.storage._collection;
    club[900] = { ...club[1], id: 900 };
    storage[502] = { ...storage[501], id: 502 };
    if (changed) storage[501].definitionId = 999;
    if (changed) {
      expect(() => f.cache.apply(f.record, f.batch, f.evidence)).toThrow('CACHE_IDENTITY_CHANGED');
      expect(f.removed).not.toHaveBeenCalled(); expect(club[1]).toBeDefined();
    } else {
      expect(f.cache.apply(f.record, f.batch, f.evidence)).toBe(true);
      expect(f.cache.apply(f.record, f.batch, f.evidence)).toBe(true);
      expect(storage[501]).toBeUndefined(); expect(club[1]).toBeUndefined();
    }
    expect(storage[502]).toBeDefined(); expect(club[900]).toBeDefined();
  }
});

it('does not mutate anything without a durable receipt and fresh matching absence evidence', async () => {
  for (const patch of [{ observedAt: 0 }, { absent: [] }, { operationConfirmed: false }, { submittedScore: 101 }, { challengeId: 62 }]) {
    const f = await fixture();
    expect(() => f.cache.apply(f.record, f.batch, { ...f.evidence, ...patch, observedAt: patch.observedAt === 0 ? -1 : 1000 })).toThrow();
    expect(f.removed).not.toHaveBeenCalled(); expect(f.root.info.base.clubCache.localDirty).not.toBe(true);
  }
  const f = await fixture(); delete f.record.batches[0].receipt;
  expect(() => f.cache.apply(f.record, f.record.batches[0], f.evidence)).toThrow('CACHE_EVIDENCE_REQUIRED');
});

it('prevalidates the entire batch and refuses ID reuse, wrong pile and runtime replacement', async () => {
  for (const kind of ['identity', 'storage', 'runtime']) {
    const f = await fixture();
    if (kind === 'identity') f.root.repositories.Item.club.items._collection[5].definitionId++;
    if (kind === 'storage') f.root.repositories.Item.storage = { _collection: { 5: { id: 5 } } };
    if (kind === 'runtime') f.root.services.SBC.removeItemsById = () => {};
    expect(() => f.cache.apply(f.record, f.batch, f.evidence)).toThrow();
    expect(f.root.repositories.Item.club.items._collection[1]).toBeDefined(); expect(f.removed).not.toHaveBeenCalled();
  }
});
