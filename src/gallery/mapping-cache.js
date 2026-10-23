import { galleryCanonical } from './catalog.js';
import { storedJsonBytes } from '../runtime/compact-storage.js';
import { boundGalleryCache, createGalleryCacheStorage, GALLERY_DERIVED_MAX_BYTES } from './cache-budget.js';
const maxBytes = GALLERY_DERIVED_MAX_BYTES;

// Account mapping checkpoints contain public identities only, never EA cards.
// A checkpoint is usable only together with the restored pool and EA coverage.
export function createGalleryMappingCache({ get, set, list, now = () => Date.now() } = {}) {
  ({ get, set } = createGalleryCacheStorage({ get, set, list }));
  const states = new Map();
  const key = (scope, source) => `fcat-fc27-gallery-mapping:27:${source}:${scope}`;
  const read = (scope, source) => {
    const id = key(scope, source);
    if (!states.has(id)) states.set(id, (async () => {
      let saved;
      try { saved = await get?.(id, null); } catch { /* Rebuild from restored observations. */ }
      const rows = new Map();
      if (saved?.schema === 1 && saved.scope === scope && saved.source === source && saved.season === '27'
          && Array.isArray(saved.rows) && saved.rows.length <= 10000 && storedJsonBytes(saved) <= maxBytes) {
        for (const row of saved.rows) {
          if (typeof row?.setId === 'string' && row.setId.length <= 200
              && typeof row.signature === 'string' && row.signature.length <= 100000
              && typeof row.poolRevision === 'string' && row.poolRevision.length <= 100
              && Number.isSafeInteger(row.mappedAt) && row.mappedAt >= 0 && row.mappedAt <= now()) rows.set(row.setId, row);
        }
      }
      return { scope, source, rows };
    })());
    const state = states.get(id);
    while (states.size > 4) states.delete(states.keys().next().value);
    return state;
  };
  return { read,
    signature: (set, catalog) => galleryCanonical([set, catalog.tags ?? [], catalog.engine ?? null]),
    async save(state, catalogRevision) {
      try {
        const saved = { schema: 1, season: '27', scope: state.scope,
          source: state.source, catalogRevision: catalogRevision ?? null, rows: [...state.rows.values()] };
        for (const first of boundGalleryCache(saved, 'rows', 10000)) state.rows.delete(first.setId);
        await set?.(key(state.scope, state.source), saved);
      } catch { /* In-memory checkpoint remains usable; next session revalidates coverage. */ }
    },
  };
}
