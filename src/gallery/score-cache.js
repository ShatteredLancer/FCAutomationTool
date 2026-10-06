// Presentation cache only. Neither a saved score nor a cache hit authorizes EA writes.
const schema = 1;
const engine = 1;
const maxBytes = 2000000;
const validScope = scope => typeof scope === 'string' && scope.length > 0 && scope.length <= 2048
  && !/[\u0000-\u001f]/.test(scope);
const clone = value => structuredClone(value);
const valid = row => row && typeof row.id === 'string' && typeof row.key === 'string'
  && row.key.length <= 500000 && ['calculated', 'uncertain'].includes(row.summary?.status)
  && Array.isArray(row.summary.lineup) && row.summary.lineup.length <= 256
  && [row.summary.low?.total, row.summary.high?.total].every(value => Number.isSafeInteger(value) && value >= 0);

export function createGalleryScoreCache({ get, set } = {}) {
  const buckets = new Map();
  let tail = Promise.resolve();
  const storageKey = scope => `fcat-fc27-gallery-score:${JSON.stringify(scope)}`;
  const load = async scope => {
    if (!validScope(scope)) return null;
    if (!buckets.has(scope)) {
      const task = (async () => {
        try {
          const value = await get(storageKey(scope), null);
          if (!value || value.schema !== schema || value.engine !== engine || value.scope !== scope
            || !Array.isArray(value.entries) || value.entries.length > 256 || JSON.stringify(value).length > maxBytes
            || !value.entries.every(valid)) return new Map();
          return new Map(value.entries.map(row => [row.id, clone(row)]));
        } catch { return new Map(); }
      })();
      buckets.set(scope, task);
      while (buckets.size > 4) buckets.delete(buckets.keys().next().value);
    }
    return buckets.get(scope);
  };
  return Object.freeze({
    async read(scope, id, key) {
      const bucket = await load(scope), row = bucket?.get(id);
      return row?.key === key ? clone(row.summary) : null;
    },
    write(scope, rows) {
      const task = tail.then(async () => {
        try {
          const bucket = await load(scope);
          if (!bucket) return false;
          for (const row of rows) if (valid(row)) { bucket.delete(row.id); bucket.set(row.id, clone(row)); }
          const record = { schema, engine, scope, entries: [...bucket.values()] };
          while (record.entries.length > 256 || JSON.stringify(record).length > maxBytes) {
            const first = record.entries.shift(); if (!first) break; bucket.delete(first.id);
          }
          await set(storageKey(scope), record); return true;
        } catch { return false; }
      });
      tail = task.catch(() => {}); return task;
    },
  });
}
