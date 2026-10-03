// Durable, account and provider scoped Gallery planning results.
// The store contains only serializable read-only planning output. It never
// reserves coins, creates EA entities, or authorizes a purchase.
export const GALLERY_PLAN_SCHEMA = 1;

const sourceOf = value => value === 'futgg' || value === 'fodder' ? value : null;
const scopeOf = value => typeof value === 'string' && value.length > 0 && value.length <= 2048
  && !/[\u0000-\u001f]/.test(value) ? value : null;
const setOf = value => typeof value === 'string' && value.length > 0 && value.length <= 330
  && /^(?:futgg:[1-9]\d{0,15}|fodder:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/.test(value) ? value : null;
const clone = value => {
  try { return structuredClone(value); } catch { return null; }
};

function normalizeRecord(value, scope, source, setId) {
  if (!value || value.schema !== GALLERY_PLAN_SCHEMA || value.scope !== scope
      || value.source !== source || value.setId !== setId
      || typeof value.binding !== 'string' || value.binding.length < 1 || value.binding.length > 500000
      || !Number.isSafeInteger(value.savedAt) || value.savedAt < 0 || value.savedAt > Date.now() + 60000) return null;
  const plan = value.plan == null ? null : clone(value.plan), overview = value.overview == null ? null : clone(value.overview);
  if (plan === null && overview === null || plan !== null && (typeof plan !== 'object' || Array.isArray(plan)) || overview !== null
      && (typeof overview !== 'object' || Array.isArray(overview))) return null;
  const overviewBinding = value.overviewBinding ?? value.binding;
  if (typeof overviewBinding !== 'string' || !overviewBinding.length || overviewBinding.length > 500000) return null;
  return { schema: GALLERY_PLAN_SCHEMA, scope, source, setId, binding: value.binding,
    overviewBinding, plan, overview, savedAt: value.savedAt };
}

export function galleryPlanKey(scope, source, setId) {
  const validScope = scopeOf(scope), validSource = sourceOf(source), validSet = setOf(setId);
  if (!validScope || !validSource || !validSet) throw new Error('FC27_GALLERY_PLAN_SCOPE_INVALID');
  return `fcat-fc27-gallery-plan:${JSON.stringify([validScope, validSource, validSet])}`;
}

export function createGalleryPlanStore({ get, set, now = () => Date.now() } = {}) {
  let tail = Promise.resolve();
  const load = async (scope, source, setId) => {
    try {
      await tail;
      const value = await get(galleryPlanKey(scope, source, setId), null);
      if (value == null) return { status: 'absent' };
      const record = normalizeRecord(value, scope, source, setId);
      return record ? { status: 'observed', record } : { status: 'blocked', reason: 'FC27_GALLERY_PLAN_CACHE_INVALID' };
    } catch { return { status: 'blocked', reason: 'FC27_GALLERY_PLAN_CACHE_READ_FAILED' }; }
  };
  const save = (scope, source, setId, value) => {
    let record, key;
    try {
      key = galleryPlanKey(scope, source, setId);
      record = normalizeRecord({ schema: GALLERY_PLAN_SCHEMA, scope, source, setId,
        binding: value?.binding, overviewBinding: value?.overviewBinding, plan: value?.plan, overview: value?.overview ?? null, savedAt: now() }, scope, source, setId);
      if (!record) throw new Error();
    } catch { return Promise.resolve({ status: 'blocked', reason: 'FC27_GALLERY_PLAN_CACHE_INVALID' }); }
    const task = tail.then(async () => {
      try { await set(key, record); return { status: 'observed', record }; }
      catch { return { status: 'blocked', reason: 'FC27_GALLERY_PLAN_CACHE_WRITE_FAILED' }; }
    });
    tail = task.catch(() => {});
    return task;
  };
  const clear = (scope, source, setId) => {
    let key;
    try { key = galleryPlanKey(scope, source, setId); } catch {
      return Promise.resolve({ status: 'blocked', reason: 'FC27_GALLERY_PLAN_SCOPE_INVALID' });
    }
    const task = tail.then(async () => {
      try { await set(key, null); return { status: 'observed' }; }
      catch { return { status: 'blocked', reason: 'FC27_GALLERY_PLAN_CACHE_WRITE_FAILED' }; }
    });
    tail = task.catch(() => {});
    return task;
  };
  return Object.freeze({ load, save, clear });
}
