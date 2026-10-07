import { contextKey } from '../fc27/prelaunch-contract.js';
import { deepFreeze, integer, same, fail } from './contract.js';

export function normalizeStreamlinedSettings(value = {}) {
  const result = { maxRating: value.maxRating ?? 99, objective: value.objective ?? 'lowest-coins',
    mode: value.mode ?? 'inventory-market', sources: value.sources ?? ['club', 'storage'] };
  if (!integer(result.maxRating, 1, 99) || !['lowest-coins', 'fewest-cards'].includes(result.objective)
      || !['inventory', 'inventory-market', 'market'].includes(result.mode)
      || !Array.isArray(result.sources) || !result.sources.length || result.sources.length > 2
      || result.sources.some(s => !['club', 'storage'].includes(s)) || new Set(result.sources).size !== result.sources.length) fail('SETTINGS_INVALID');
  return deepFreeze(structuredClone(result));
}

export function createStreamlinedSettings({ get, set }) {
  const key = (context, challengeId) => contextKey(context, `streamlined-settings:${challengeId ?? 'global'}`);
  const read = async (context, challengeId = null) => {
    if (challengeId !== null && !integer(challengeId, 1)) fail('SETTINGS_INVALID');
    let value;
    try { value = await get(key(context, challengeId), null); } catch { fail('SETTINGS_READ_FAILED'); }
    if (value === null) return challengeId === null ? normalizeStreamlinedSettings() : read(context);
    if (value?.schema !== 1 || !value.settings) fail('SETTINGS_INVALID');
    return normalizeStreamlinedSettings(value.settings);
  };
  return Object.freeze({ read, async save(context, challengeId, value) {
    if (challengeId !== null && !integer(challengeId, 1)) fail('SETTINGS_INVALID');
    const settings = normalizeStreamlinedSettings(value);
    try {
      await set(key(context, challengeId), { schema: 1, settings });
      if (!same(await read(context, challengeId), settings)) fail('SETTINGS_SAVE_FAILED');
    } catch { fail('SETTINGS_SAVE_FAILED'); }
    return settings;
  } });
}
