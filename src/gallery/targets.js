const sources = new Set(['futgg', 'fodder']);
const grades = new Set(['D', 'C', 'B', 'A', 'S']);
const validScope = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
const validId = (id, source) => typeof id === 'string' && id.length <= 330 && id.startsWith(`${source}:`)
  && (source === 'futgg' ? /^futgg:[1-9]\d{0,15}$/.test(id) : /^fodder:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(id));
export const emptyGalleryTargets = () => ({ targets: [], budget: null });

export function normalizeGalleryTargets(value, source) {
  if (!sources.has(source) || !Array.isArray(value?.targets) || value.targets.length > 1024
      || value.targets.some(row => !validId(row?.setId, source) || !grades.has(row?.grade))
      || new Set(value.targets.map(row => row.setId)).size !== value.targets.length
      || value.budget !== null && (!Number.isSafeInteger(value.budget) || value.budget < 0)) {
    throw new Error('FC27_GALLERY_TARGETS_INVALID');
  }
  return { targets: value.targets.map(({ setId, grade }) => ({ setId, grade })), budget: value.budget };
}

// Only a fresh, successfully verified catalogue may retire saved goals. A
// fallback/old snapshot must not silently remove an account's preferences.
export function reconcileGalleryTargets(value, catalog) {
  const clean = normalizeGalleryTargets(value, catalog?.source);
  const sets = new Map(catalog.categories.flatMap(category => category.sets).map(set => [set.id, set]));
  return { ...clean, targets: clean.targets.filter(row => sets.get(row.setId)?.grades.some(grade => grade.name === row.grade)) };
}

export function createGalleryTargetStore({ get, set } = {}) {
  let tail = Promise.resolve();
  const key = (scope, source) => {
    if (!validScope(scope) || !sources.has(source)) throw new Error('FC27_GALLERY_TARGETS_SCOPE_INVALID');
    return `fcat-fc27-gallery-targets:${JSON.stringify([scope, source])}`;
  };
  return Object.freeze({
    async load(scope, source) {
      try {
        await tail;
        const stored = await get(key(scope, source), null);
        if (stored === null || stored === undefined) return { status: 'observed', ...emptyGalleryTargets() };
        if (stored.schema !== 1 || stored.scope !== scope || stored.source !== source) throw new Error();
        return { status: 'observed', ...normalizeGalleryTargets(stored, source) };
      } catch { return { status: 'unavailable', reason: 'FC27_GALLERY_TARGETS_READ_FAILED', ...emptyGalleryTargets() }; }
    },
    save(scope, source, value) {
      let record, storageKey;
      try { storageKey = key(scope, source); record = { schema: 1, scope, source, ...normalizeGalleryTargets(value, source) }; }
      catch { return Promise.resolve({ status: 'unavailable', reason: 'FC27_GALLERY_TARGETS_INVALID' }); }
      // Capture the scope and value now; a later account change cannot send
      // an old queued preference write into the new account's key.
      const task = tail.then(async () => {
        try { await set(storageKey, record); return { status: 'observed' }; }
        catch { return { status: 'unavailable', reason: 'FC27_GALLERY_TARGETS_SAVE_FAILED' }; }
      });
      tail = task; return task;
    },
  });
}
