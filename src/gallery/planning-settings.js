export const galleryPlanningSettingsKey = scope => `fcat-fc27-gallery-planning-settings-v1:${scope}`;

export const DEFAULT_GALLERY_PLANNING_TIMEOUT_MS = 30000;
export const MIN_GALLERY_PLANNING_TIMEOUT_MS = 5000;
export const MAX_GALLERY_PLANNING_TIMEOUT_MS = 300000;

export function normalizeGalleryPlanningSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('FC27_GALLERY_PLANNING_SETTINGS_INVALID');
  const timeoutMs = value.timeoutMs ?? DEFAULT_GALLERY_PLANNING_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_GALLERY_PLANNING_TIMEOUT_MS || timeoutMs > MAX_GALLERY_PLANNING_TIMEOUT_MS) {
    throw Error('FC27_GALLERY_PLANNING_SETTINGS_INVALID');
  }
  return Object.freeze({ timeoutMs });
}

export function createGalleryPlanningSettings({ scope, get, set }) {
  const current = expected => { if (!expected || scope() !== expected) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); };
  return Object.freeze({
    scope,
    async read() {
      const account = scope(); current(account);
      const saved = await get(galleryPlanningSettingsKey(account), null); current(account);
      if (saved !== null && (saved.schema !== 1 || saved.scope !== account || !saved.value)) {
        throw Error('FC27_GALLERY_PLANNING_SETTINGS_INVALID');
      }
      return normalizeGalleryPlanningSettings(saved?.value);
    },
    async save(value) {
      const account = scope(), normalized = normalizeGalleryPlanningSettings(value); current(account);
      const record = { schema: 1, scope: account, value: normalized }, key = galleryPlanningSettingsKey(account);
      await set(key, record); current(account);
      const stored = await get(key, null); current(account);
      if (JSON.stringify(stored) !== JSON.stringify(record)) throw Error('FC27_GALLERY_PLANNING_SETTINGS_SAVE_FAILED');
      return normalized;
    },
  });
}
