import { contextKey, createSeasonContext } from './prelaunch-contract.js';

const PREFERENCES = ['language', 'logLimit'];
const PROTECTIONS = ['onlyUntradeable', 'excludeEvolution', 'protectFsuLockedPlayers', 'protectActiveSquad', 'maxRating'];

function jsonObject(text) {
  if (typeof text !== 'string' || text.length > 65536) throw new TypeError('Invalid import size');
  const object = JSON.parse(text);
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new TypeError('Expected an object');
  return object;
}

export function planPreferenceImport(text) {
  const source = jsonObject(text);
  if (source.format !== 'fcat-preferences' || source.schema !== 1) throw new TypeError('Unsupported import schema');
  if (Object.keys(source).some(key => !['format', 'schema', 'preferences', 'protection'].includes(key))) {
    throw new TypeError('Unsupported import field');
  }
  const preferences = source.preferences ?? {};
  const protection = source.protection ?? {};
  if (!preferences || !protection || Array.isArray(preferences) || Array.isArray(protection)
      || typeof preferences !== 'object' || typeof protection !== 'object') throw new TypeError('Invalid preference sections');
  if (Object.keys(preferences).some(key => !PREFERENCES.includes(key))
      || Object.keys(protection).some(key => !PROTECTIONS.includes(key))) throw new TypeError('Unsupported preference field');
  if (preferences.language !== undefined && !['zh-CN', 'en'].includes(preferences.language)) throw new TypeError('Invalid language');
  if (preferences.logLimit !== undefined && (!Number.isInteger(preferences.logLimit)
      || preferences.logLimit < 50 || preferences.logLimit > 2000)) throw new TypeError('Invalid log limit');
  for (const [key, value] of Object.entries(protection)) {
    if (key === 'maxRating' ? !Number.isInteger(value) || value < 1 || value > 99 : typeof value !== 'boolean') {
      throw new TypeError('Invalid protection value');
    }
  }
  return Object.freeze({
    preferences: Object.freeze({ ...preferences }),
    protectionReview: Object.freeze({ ...protection }),
    // Imported protections are review proposals, never the effective policy.
    liveExecutionEnabled: false, tradeArmed: false,
  });
}

export function createPreferenceStore({ context, storage }) {
  const scope = createSeasonContext(context);
  if (scope.season !== '27') throw new TypeError('Unsupported season');
  const key = contextKey(scope, 'preferences');
  let busy = false;
  return Object.freeze({
    async import(text, { approved = false } = {}) {
      const plan = planPreferenceImport(text);
      if (approved !== true) throw new Error('Import approval required');
      if (busy) throw new Error('Preference import busy');
      busy = true;
      try {
        const canonical = JSON.stringify(plan);
        const previousText = await storage.get(key);
        const previous = previousText == null ? null : jsonObject(previousText);
        if (previous && (previous.schema !== 1 || typeof previous.current !== 'string'
            || (previous.lastKnownGood !== null && typeof previous.lastKnownGood !== 'string'))) {
          throw new Error('Invalid existing preference envelope');
        }
        if (previous?.current === canonical) return { status: 'unchanged', ...plan };
        const envelope = { schema: 1, current: canonical, lastKnownGood: previous?.current ?? null };
        // The injected storage must atomically replace one value or leave it unchanged.
        await storage.set(key, JSON.stringify(envelope));
        return { status: 'imported', ...plan };
      } finally { busy = false; }
    },
    key,
  });
}
