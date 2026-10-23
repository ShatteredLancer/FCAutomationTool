import { contextKey } from '../../fc27/prelaunch-contract.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../fc27/traditional-lock.js';
import { decodeStoredValue, encodeStoredValue, storedJsonBytes } from '../../runtime/compact-storage.js';
import { galleryDerivedCacheKey, trimGalleryDerivedCaches } from '../../gallery/cache-budget.js';

export function streamlinedStorageKey(key) {
  if (typeof key !== 'string') return null;
  const match = /^fcat:(\[[\s\S]*\])((?::history:[^:]+(?::[1-9]\d*)?)|:retired)?$/.exec(key);
  if (!match) return null;
  try {
    const parts = JSON.parse(match[1]), suffix = match[2] ?? '';
    if (!Array.isArray(parts) || parts.length !== 5 || parts[0] !== 1 || parts[1] !== '27'
        || !['streamlined-market-run', 'streamlined-contribution'].includes(parts[4])) return null;
    if (parts[4] === 'streamlined-contribution' && suffix && !/^:history:[1-9]\d*$/.test(suffix)) return null;
    if (parts[4] === 'streamlined-market-run' && suffix && suffix !== ':retired'
        && !/^:history:[^:]+:[1-9]\d*$/.test(suffix)) return null;
    const context = { schema: 1, season: parts[1], accountScope: parts[2], platform: parts[3] };
    return contextKey(context, parts[4]) === `fcat:${match[1]}` ? { context, retired: suffix === ':retired' } : null;
  } catch { return null; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const scopedRecord = (value, meta) => value && typeof value === 'object' && same(value.context, meta.context);

// Full journals are NEVER expired, pruned, or reclassified as confirmed here.
// This owns the SAME global mutation lock as EA transaction persistence, so a
// delayed compression cannot overwrite a newer pending marker or receipt.
export async function compactFc27Storage({ list, get, set, locks, onProgress } = {}) {
  const report = { status: 'running', checked: 0, compacted: 0, failed: 0, deferred: 0,
    cacheEvicted: 0, beforeBytes: 0, afterBytes: 0 };
  const notify = () => { try { onProgress?.({ ...report }); } catch { /* Counts only. */ } };
  const compact = async (key, meta) => {
    report.checked++;
    try {
      const raw = await get(key, null); if (raw == null) return;
      const value = await decodeStoredValue(raw);
      if (meta.kind ? value?.schema !== 1 || value.scope !== meta.scope
          || meta.kind === 'score' && !Array.isArray(value.entries)
          || meta.kind === 'mapping' && (value.season !== '27' || value.source !== meta.source || !Array.isArray(value.rows))
        : meta.retired ? !Array.isArray(value) || value.some(row => !scopedRecord(row?.record, meta)
          || row.contributionJournal != null && !scopedRecord(row.contributionJournal, meta)) : !scopedRecord(value, meta)) return;
      const beforeBytes = storedJsonBytes(raw);
      const packed = raw?.fcatStorage ? raw : await encodeStoredValue(value);
      if (!same(await decodeStoredValue(packed), value)) throw Error('roundtrip');
      if (!same(raw, packed)) {
        if (!same(await get(key, null), raw)) throw Error('changed');
        await set(key, packed);
        if (!same(await get(key, null), packed)) throw Error('write unverified');
        report.compacted++;
      }
      report.beforeBytes += beforeBytes; report.afterBytes += storedJsonBytes(packed);
    } catch { report.failed++; }
    finally { notify(); }
  };
  notify();
  try {
    if (![list, get, set].every(fn => typeof fn === 'function')) throw Error('unavailable');
    const keys = await list();
    if (!Array.isArray(keys) || keys.length > 100000) throw Error('invalid keys');
    const journalKeys = keys.map(key => [key, streamlinedStorageKey(key)]).filter(([, meta]) => meta);
    const cacheKeys = keys.map(key => [key, galleryDerivedCacheKey(key)]).filter(([, meta]) => meta);
    if (journalKeys.length) {
      let entered = false;
      if (typeof locks?.request === 'function') {
        await locks.request(FC27_TRADITIONAL_WEB_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (!lock) return;
          if (entered || lock.name !== FC27_TRADITIONAL_WEB_LOCK || lock.mode !== 'exclusive') throw Error('lock');
          entered = true;
          for (const [key, meta] of journalKeys) await compact(key, meta);
        });
      }
      if (!entered) report.deferred = journalKeys.length;
    }
    for (const [key, meta] of cacheKeys) await compact(key, meta);
    report.cacheEvicted = await trimGalleryDerivedCaches({ list, get, set });
    report.status = report.failed ? 'partial' : report.deferred ? 'deferred' : 'completed';
  } catch { report.status = 'failed'; report.failed++; }
  notify(); return { ...report };
}
