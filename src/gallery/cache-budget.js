import { createCompactStorage, decodeStoredValue, storedJsonBytes } from '../runtime/compact-storage.js';

export const GALLERY_DERIVED_MAX_BYTES = 2 * 1024 * 1024;
const TOTAL_BYTES = 8 * 1024 * 1024;
// Optional calculation checkpoints only. Collection/ever-owned history,
// preferences, locks, approvals and ALL transaction journals are excluded.
export function galleryDerivedCacheKey(key) {
  if (typeof key !== 'string') return null;
  const prefix = 'fcat-fc27-gallery-score:';
  if (key.startsWith(prefix)) {
    try { const scope = JSON.parse(key.slice(prefix.length));
      return typeof scope === 'string' && scope.length > 0 && scope.length <= 2048 ? { kind: 'score', scope } : null;
    } catch { return null; }
  }
  const match = /^fcat-fc27-gallery-mapping:27:(futgg|fodder):(.{1,2048})$/.exec(key);
  return match ? { kind: 'mapping', source: match[1], scope: match[2] } : null;
}
export function boundGalleryCache(record, field, maxCount) {
  const rows = record[field], sizes = rows.map(row => storedJsonBytes(row));
  const base = storedJsonBytes({ ...record, [field]: [] });
  if (base > GALLERY_DERIVED_MAX_BYTES) throw Error('FC27_GALLERY_CACHE_TOO_LARGE');
  let total = base + sizes.reduce((a, b) => a + b, 0) + Math.max(0, rows.length - 1);
  let start = 0;
  while (rows.length - start > maxCount || total > GALLERY_DERIVED_MAX_BYTES) {
    if (start === rows.length) break;
    total -= sizes[start++] + (start < rows.length ? 1 : 0);
  }
  record[field] = rows.slice(start);
  return rows.slice(0, start);
}
export async function trimGalleryDerivedCaches({ list, get, set, keepKey = null } = {}) {
  if (typeof list !== 'function') return 0;
  const keys = await list();
  if (!Array.isArray(keys) || keys.length > 100000) return 0;
  const candidates = [];
  for (const key of keys) {
    const meta = galleryDerivedCacheKey(key); if (!meta) continue;
    const raw = await get(key, null); if (raw == null) continue;
    let value;
    try { value = await decodeStoredValue(raw); } catch { continue; }
    if (value?.schema !== 1 || value.scope !== meta.scope
        || meta.kind === 'score' && (value.engine !== 1 || !Array.isArray(value.entries))
        || meta.kind === 'mapping' && (value.season !== '27' || value.source !== meta.source || !Array.isArray(value.rows))) continue;
    // Include the native Tampermonkey type tag and JSON escaping overhead.
    candidates.push({ key, raw, size: storedJsonBytes({ [key]: `o${JSON.stringify(raw)}` }) });
  }
  let total = candidates.reduce((sum, row) => sum + row.size, 0), count = candidates.length, removed = 0;
  for (const row of candidates) {
    if (total <= TOTAL_BYTES && count <= 8) break;
    if (row.key === keepKey) continue;
    // Concurrent cache updates can always be rebuilt, but do not erase a new
    // checkpoint merely because an older snapshot was selected for eviction.
    if (JSON.stringify(await get(row.key, null)) !== JSON.stringify(row.raw)) continue;
    await set(row.key, null); total -= row.size; count--; removed++;
  }
  return removed;
}
let tail = Promise.resolve();
export function createGalleryCacheStorage({ get, set, list }) {
  const compact = createCompactStorage({ get, set });
  return { get: compact.get, set: (key, value) => {
    const write = tail.catch(() => {}).then(async () => {
      await compact.set(key, value);
      try { await trimGalleryDerivedCaches({ get, set, list, keepKey: key }); } catch { /* Optional cache maintenance only. */ }
    });
    tail = write.catch(() => {}); return write;
  } };
}
