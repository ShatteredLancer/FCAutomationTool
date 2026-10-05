import { galleryCanonical } from '../../gallery/catalog.js';

// Public definitions stay in the catalogue provider. Account observations and
// concept discovery stay in the EA reader; no private Fodder service is used.
export function withFodderGalleryPools(provider, reader, { now = () => Date.now(), ttlMs = 300000 } = {}) {
  const pools = new Map(), pending = new Map();
  const key = (scope, set, revision) => `${scope}:${revision}:${galleryCanonical(set)}`;
  const resolve = async (setId, cachedOnly) => {
    const value = cachedOnly ? await provider.peek() : await provider.load();
    const set = value?.source === 'fodder' ? value.catalog.categories.flatMap(category => category.sets).find(set => set.id === setId) : null;
    return set ? { set, key: key(reader.scope(), set, value.revision) } : null;
  };
  const loadPool = async (input = {}) => {
    if (input.source !== 'fodder') return provider.loadPool(input);
    try {
      const target = await resolve(input.setId, false);
      if (!target) return { status: 'blocked', reason: 'FC27_GALLERY_POOL_UNAVAILABLE' };
      const old = pools.get(target.key);
      if (!input.force && old && now() - old.fetchedAt < ttlMs) return { ...old, cached: true };
      if (pending.has(target.key)) return pending.get(target.key);
      const scope = reader.scope();
      const task = reader.discoverPool(target.set, { onProgress: input.onProgress }).then(result => {
        if (scope !== reader.scope()) return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' };
        if (result.status === 'observed') {
          pools.set(target.key, result);
          while (pools.size > 256) pools.delete(pools.keys().next().value);
        }
        return result;
      }).finally(() => pending.delete(target.key));
      pending.set(target.key, task); return task;
    } catch { return { status: 'blocked', reason: 'FC27_GALLERY_POOL_UNAVAILABLE' }; }
  };
  const peekPool = async (input = {}) => {
    if (input.source !== 'fodder') return provider.peekPool(input);
    const target = await resolve(input.setId, true), result = target && pools.get(target.key);
    return result ? { ...result, cached: true, stale: now() - result.fetchedAt >= ttlMs } : null;
  };
  return Object.freeze({ ...provider, loadPool, peekPool });
}
