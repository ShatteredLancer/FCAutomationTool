export const galleryTradePreferencesKey = scope => `fcat-fc27-gallery-trade-preferences-v1:${scope}`;
export function normalizeGalleryTradePreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('FC27_GALLERY_TRADE_SETTINGS_INVALID');
  const result = { destination: value?.destination ?? 'club', style: value?.style ?? 'enhancer' };
  if (!['club', 'unassigned'].includes(result.destination) || !['enhancer', 'fodder'].includes(result.style)) {
    throw Error('FC27_GALLERY_TRADE_SETTINGS_INVALID');
  }
  return Object.freeze(result);
}
export function createGalleryTradePreferences({ scope, get, set }) {
  const current = expected => { if (!expected || scope() !== expected) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); };
  return Object.freeze({ scope, async read() {
    const account = scope(); current(account);
    const saved = await get(galleryTradePreferencesKey(account), null); current(account);
    if (saved !== null && (saved.schema !== 1 || saved.scope !== account || !saved.value)) throw Error('FC27_GALLERY_TRADE_SETTINGS_INVALID');
    return normalizeGalleryTradePreferences(saved?.value);
  }, async save(value) {
    const account = scope(), normalized = normalizeGalleryTradePreferences(value); current(account);
    const record = { schema: 1, scope: account, value: normalized }, key = galleryTradePreferencesKey(account);
    await set(key, record); current(account);
    const stored = await get(key, null); current(account);
    if (JSON.stringify(stored) !== JSON.stringify(record)) throw Error('FC27_GALLERY_TRADE_SETTINGS_SAVE_FAILED');
    return normalized;
  } });
}
