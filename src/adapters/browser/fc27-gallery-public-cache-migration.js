import { normalizeGalleryCatalog } from '../../gallery/catalog.js';
import { normalizeGalleryPool } from '../../gallery/pool.js';
import { decodeGalleryCacheValue, encodeGalleryCacheValue } from './fc27-gallery-cache-codec.js';

const keyParts = key => typeof key === 'string' && !key.endsWith(':checked')
  ? /^fcat-fc27-gallery-(catalog|pools):27:([A-Za-z0-9:_-]{1,120}?)(?::set:([1-9]\d*))?$/.exec(key) : null;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= Date.now();

// Public snapshots only. Aggregate removal follows durable, lossless per-set copies.
export async function compactGalleryPublicCaches({ list, get, set, locks } = {}) {
  const report = { status: 'running', checked: 0, compacted: 0, migrated: 0, failed: 0 };
  const run = async () => {
    try {
      const keys = await list();
      if (!Array.isArray(keys) || keys.length > 100000) throw Error('invalid keys');
      for (const key of keys) {
        const parts = keyParts(key);
        if (!parts) continue;
        report.checked++;
        try {
          const original = await get(key, null);
          if (!original) continue;
          const saved = await decodeGalleryCacheValue(original);
          if (saved.season !== '27' || saved.scope !== parts[2]) throw Error('scope');
          const snapshot = JSON.stringify(original);
          if (parts[1] === 'catalog') {
            if (saved.schema !== 2 || !Array.isArray(saved.entries) || saved.entries.length > 2) throw Error('catalog');
            for (const row of saved.entries) {
              if (!validTime(row.fetchedAt)) throw Error('time');
              normalizeGalleryCatalog(row.source, row.payload, '27');
            }
          } else if (parts[3]) {
            if (saved.schema !== 1 || saved.setId !== Number(parts[3]) || !validTime(saved.fetchedAt)) throw Error('pool');
            const pool = normalizeGalleryPool('futgg', saved.payload, saved.setId, '27');
            if (saved.revision !== pool.revision) throw Error('revision');
          } else {
            if (saved.schema !== 1 || !Array.isArray(saved.entries) || saved.entries.length > 256) throw Error('aggregate');
            const seen = new Set();
            for (const row of saved.entries) {
              if (!validTime(row.fetchedAt) || seen.has(row.setId)) throw Error('entry');
              seen.add(row.setId);
              const pool = normalizeGalleryPool('futgg', row.payload, row.setId, '27');
              const targetKey = `${key}:set:${row.setId}`;
              const targetRaw = await get(targetKey, null);
              const target = await decodeGalleryCacheValue(targetRaw);
              // Provider gives a valid per-set snapshot precedence over the legacy fallback.
              let validTarget = false;
              try {
                validTarget = target?.schema === 1 && target.season === '27' && target.scope === saved.scope
                  && target.setId === row.setId && validTime(target.fetchedAt)
                  && target.revision === normalizeGalleryPool('futgg', target.payload, row.setId, '27').revision;
              } catch { /* Repair invalid/missing optional snapshots from the intact legacy record. */ }
              if (validTarget) continue;
              const copy = { ...row, schema: 1, season: '27', scope: saved.scope, revision: pool.revision };
              const packed = await encodeGalleryCacheValue(copy);
              if (JSON.stringify(await get(targetKey, null)) !== JSON.stringify(targetRaw)) throw Error('changed');
              await set(targetKey, packed);
              if (JSON.stringify(await decodeGalleryCacheValue(await get(targetKey, null))) !== JSON.stringify(copy)) throw Error('write');
            }
            if (JSON.stringify(await get(key, null)) !== snapshot) throw Error('changed');
            await set(key, null);
            if (await get(key, null) !== null) throw Error('clear');
            report.migrated++;
            continue;
          }
          const packed = await encodeGalleryCacheValue(saved);
          if (packed.format && !original.format) {
            if (JSON.stringify(await get(key, null)) !== snapshot) throw Error('changed');
            await set(key, packed);
            if (JSON.stringify(await get(key, null)) !== JSON.stringify(packed)) throw Error('write');
            report.compacted++;
          }
        } catch { report.failed++; }
      }
      report.status = report.failed ? 'partial' : 'completed';
    } catch { report.failed++; report.status = 'failed'; }
    return { ...report };
  };
  try {
    return typeof locks?.request === 'function'
      ? await locks.request('fcat:gallery-public-cache-compaction', { mode: 'exclusive' }, run) : await run();
  } catch { return { ...report, status: 'failed', failed: report.failed + 1 }; }
}
