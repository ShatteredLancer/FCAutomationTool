import { contextKey } from '../../fc27/prelaunch-contract.js';
import { encodeGalleryCollectionCache } from './fc27-gallery-cache-codec.js';

const isCollectionKey = key => {
  if (typeof key !== 'string' || !key.startsWith('fcat:')) return false;
  try {
    const parts = JSON.parse(key.slice(5));
    return Array.isArray(parts) && parts.length === 5 && parts[0] === 1
      && parts[1] === '27' && parts[4] === 'gallery-collection';
  } catch { return false; }
};

// Storage-only startup maintenance. No login, EA requests or Journal access.
export async function compactGalleryCollectionCaches({ list, get, set, locks, onProgress } = {}) {
  const report = { status: 'running', total: 0, checked: 0, compacted: 0, failed: 0 };
  const notify = () => { try { onProgress?.({ ...report }); } catch { /* Diagnostics only. */ } };
  const run = async () => {
    notify();
    try {
      if (![list, get, set].every(value => typeof value === 'function')) throw Error('unavailable');
      const keys = await list();
      if (!Array.isArray(keys) || keys.length > 100000) throw Error('invalid keys');
      const selected = keys.filter(isCollectionKey);
      report.total = selected.length; notify();
      for (const key of selected) {
        try {
          const saved = await get(key, null);
          if (saved?.schema === 3 && Array.isArray(saved.concepts) && saved.concepts.length <= 100000
              && contextKey(saved.context, 'gallery-collection') === key) {
            const original = JSON.stringify(saved);
            const packed = await encodeGalleryCollectionCache(saved);
            if (packed.schema === 4) {
              // Do not overwrite a collection updated by another page.
              if (JSON.stringify(await get(key, null)) !== original) throw Error('changed');
              await set(key, packed);
              if (JSON.stringify(await get(key, null)) !== JSON.stringify(packed)) throw Error('write unverified');
              report.compacted++;
            } else if (original.length >= 128 * 1024) throw Error('not compacted');
          }
        } catch { report.failed++; }
        report.checked++; notify();
      }
      report.status = report.failed ? 'partial' : 'completed';
    } catch { report.status = 'failed'; report.failed++; }
    notify(); return { ...report };
  };
  try {
    return typeof locks?.request === 'function'
      ? await locks.request('fcat:gallery-collection-compaction', { mode: 'exclusive' }, run) : await run();
  } catch { report.status = 'failed'; report.failed++; notify(); return { ...report }; }
}
