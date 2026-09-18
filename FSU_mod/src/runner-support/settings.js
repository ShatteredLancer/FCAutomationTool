import { contextKey } from '../../../src/fc27/prelaunch-contract.js';
import { normalizeReviewedPolicy } from './core.js';

// This object stays in the userscript sandbox; the page bridge exposes no writes.
export function createFsuSettingsStore({ readContext, get, set }) {
  if (typeof get !== 'function' || typeof set !== 'function') throw new TypeError('FSU_GM_REQUIRED');
  function keyFor(context, name) {
    const key = contextKey(context, name);
    if (context.season !== '27' || key !== contextKey(readContext(), name)) throw new Error('FSU_SCOPE_CHANGED');
    return key;
  }
  function persist(context, name, value) {
    const key = keyFor(context, name);
    const text = JSON.stringify(value);
    set(key, text);
    if (get(key, null) !== text) throw new Error('FSU_GM_PERSISTENCE_UNCONFIRMED');
    keyFor(context, name);
  }
  return Object.freeze({
    savePolicy(context, input, approved) {
      if (approved !== true) throw new Error('FSU_POLICY_APPROVAL_REQUIRED');
      const policy = normalizeReviewedPolicy(input);
      if (!policy) throw new Error('FSU_POLICY_INVALID');
      persist(context, 'fsu-policy', { schema: 1, reviewed: true, policy });
    },
    setItemLock(context, id, locked) {
      if (!Number.isSafeInteger(id) || id < 1 || typeof locked !== 'boolean') throw new Error('FSU_LOCKS_INVALID');
      const raw = get(keyFor(context, 'fsu-locks'), null);
      let value;
      try { value = raw === null ? { schema: 1, ids: [] } : JSON.parse(raw); }
      catch { throw new Error('FSU_LOCKS_INVALID'); }
      if (value?.schema !== 1 || !Array.isArray(value.ids) || value.ids.length > 1000
          || value.ids.some(item => !Number.isSafeInteger(item) || item < 1)) throw new Error('FSU_LOCKS_INVALID');
      const ids = new Set(value.ids);
      if (locked) ids.add(id); else ids.delete(id);
      if (ids.size > 1000) throw new Error('FSU_LOCKS_LIMIT');
      persist(context, 'fsu-locks', { schema: 1, ids: [...ids].sort((a, b) => a - b) });
    },
  });
}
