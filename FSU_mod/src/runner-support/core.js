import { BRIDGE_CAPABILITIES, contextKey, createSeasonContext, createRunnerBridgeDescriptor } from '../../../src/fc27/prelaunch-contract.js';
import { normalizeLockedPlayerIds, normalizeFsuSettings } from '../../../src/config/fsu-compat.js';

function sameScope(a, b) {
  try { return contextKey(a, 'scope') === contextKey(b, 'scope'); } catch { return false; }
}

function readJson(storage, key) {
  const text = storage.get(key);
  if (text == null) return null;
  if (typeof text !== 'string' || text.length > 65536) throw new Error('Invalid stored value');
  return JSON.parse(text);
}

function readPolicy(storage, context) {
  const value = readJson(storage, contextKey(context, 'fsu-policy'));
  if (value?.schema !== 1 || value?.reviewed !== true) return null;
  return normalizeReviewedPolicy(value.policy);
}

export function normalizeReviewedPolicy(policy) {
  if (!policy || ['onlyUntradeable', 'excludeEvolution', 'protectFsuLockedPlayers', 'protectActiveSquad', 'storageFirst']
    .some(key => typeof policy[key] !== 'boolean')) return null;
  if (!Number.isInteger(policy.maxRating) || policy.maxRating < 1 || policy.maxRating > 99
      || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200
      || policy.excludedLeagueIds.some(id => !Number.isSafeInteger(id) || id < 1)) return null;
  if (!Array.isArray(policy.goldRange) || policy.goldRange.length !== 2
      || policy.goldRange.some(value => !Number.isInteger(value) || value < 1 || value > 99)
      || policy.goldRange[0] > policy.goldRange[1]) return null;
  return Object.freeze({ onlyUntradeable: policy.onlyUntradeable, excludeEvolution: policy.excludeEvolution,
    protectFsuLockedPlayers: policy.protectFsuLockedPlayers, protectActiveSquad: policy.protectActiveSquad,
    storageFirst: policy.storageFirst, goldRange: Object.freeze([...policy.goldRange]),
    maxRating: policy.maxRating, excludedLeagueIds: Object.freeze([...new Set(policy.excludedLeagueIds)]) });
}

export function readLegacyPolicyReview(storage) {
  const build = readJson(storage, 'build');
  const set = readJson(storage, 'set');
  // Legacy aliases are useful for review only; never import lock_26 or activate defaults.
  const normalized = normalizeFsuSettings({ build, set }, 'legacy-review');
  return Object.freeze({ status: 'review-required', proposal: normalized ? {
    onlyUntradeable: normalized.onlyUntradeable, excludeEvolution: normalized.excludeEvolution,
    goldRange: [...normalized.goldRange], excludedLeagueIds: [...normalized.excludedLeagueIds],
  } : null });
}

export function createRunnerSupportCore({ readContext, storage, inventory, timeoutMs = 15000, refreshTimeoutMs = 180000 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Invalid timeout');
  if (!Number.isInteger(refreshTimeoutMs) || refreshTimeoutMs < 1 || refreshTimeoutMs > 300000) throw new TypeError('Invalid refresh timeout');
  let busy = false;
  function inspect() {
    let context;
    try {
      context = createSeasonContext(readContext());
      if (context.season !== '27') throw new Error('Unsupported season');
      const policy = readPolicy(storage, context);
      const lockData = readJson(storage, contextKey(context, 'fsu-locks'));
      if (lockData !== null && (lockData.schema !== 1 || !Array.isArray(lockData.ids) || lockData.ids.length > 1000
          || lockData.ids.some(id => !Number.isSafeInteger(id) || id < 1))) {
        throw new Error('Invalid locks');
      }
      const locks = normalizeLockedPlayerIds({ lockedItemIds: lockData?.ids ?? [] }, 'lock');
      const state = inventory?.describe?.();
      const usable = sameScope(context, state?.context) && ['ready', 'provisional'].includes(state?.status);
      const capabilities = { policy: policy !== null, locks: true,
        club: usable && typeof inventory?.refreshClub === 'function',
        targetedValidation: usable && typeof inventory?.validateClubPlayers === 'function' };
      const status = busy ? 'loading' : BRIDGE_CAPABILITIES.every(key => capabilities[key]) ? 'ready' : 'not-ready';
      return { descriptor: createRunnerBridgeDescriptor({ ...context, status, capabilities }), context, policy, locks, state: usable ? state : null };
    } catch {
      return { descriptor: Object.freeze({ bridgeSchema: 1, status: 'not-ready', reason: 'FSU_CONTEXT_OR_POLICY_UNAVAILABLE',
        capabilities: Object.freeze(Object.fromEntries(BRIDGE_CAPABILITIES.map(key => [key, false]))) }) };
    }
  }

  async function runRead(method, refs) {
    if (busy) throw new Error('FSU_BUSY');
    const initial = inspect();
    const coldRefresh = method === 'refreshClub' && initial.policy && initial.locks
      && typeof inventory?.refreshClub === 'function' && typeof inventory?.validateClubPlayers === 'function';
    if (initial.descriptor.status !== 'ready' && !coldRefresh) throw new Error('FSU_NOT_READY');
    busy = true;
    let timer;
    let timedOut = false;
    let pending;
    try {
      pending = Promise.resolve().then(() => {
        if (!sameScope(initial.context, readContext())) throw new Error('FSU_SCOPE_CHANGED');
        return inventory[method](refs);
      });
      const result = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new Error('FSU_READ_TIMEOUT')); },
          method === 'refreshClub' ? refreshTimeoutMs : timeoutMs);
      })]);
      if (!sameScope(initial.context, readContext()) || !sameScope(initial.context, result?.context)) {
        throw new Error('FSU_SCOPE_CHANGED');
      }
      if (!BRIDGE_CAPABILITIES.every(key => inspect().descriptor.capabilities[key])) throw new Error('FSU_CAPABILITY_CHANGED');
      const current = inspect();
      if (JSON.stringify({ policy: initial.policy, locks: initial.locks }) !== JSON.stringify({ policy: current.policy, locks: current.locks })) {
        throw new Error('FSU_POLICY_CHANGED');
      }
      if (method === 'refreshClub') {
        if (result.status !== 'refreshed') throw new Error('FSU_REFRESH_UNCONFIRMED');
        return Object.freeze({ status: 'refreshed' });
      }
      if (result.status !== 'validated' || !Array.isArray(result.items) || result.items.length !== refs.length) {
        throw new Error('FSU_VALIDATION_INCOMPLETE');
      }
      const used = new Set();
      for (const ref of refs) {
        const item = result.items.find(item => item.id === ref.id && item.definitionId === ref.definitionId);
        if (!item || item.safetyFingerprint !== ref.safetyFingerprint || used.has(item.id)) throw new Error('FSU_ITEM_CHANGED_OR_MISSING');
        used.add(item.id);
      }
      return Object.freeze({ status: 'validated', refs: Object.freeze(refs) });
    } finally {
      clearTimeout(timer);
      // A timed-out read may still touch the repository. Do not allow an overlapping retry.
      if (timedOut) pending.then(() => { busy = false; }, () => { busy = false; });
      else busy = false;
    }
  }

  return Object.freeze({
    describe: () => inspect().descriptor,
    getPolicy: () => inspect().policy ?? null,
    getLocks: () => inspect().locks ?? null,
    getClubSnapshot: () => inspect().descriptor.status === 'ready' ? inventory?.getSnapshot?.() ?? null : null,
    getClubState: () => {
      const value = inspect();
      return Object.freeze({ status: value.state?.status === 'ready' ? 'ready'
        : value.state?.status === 'provisional' ? 'provisional' : 'not-ready' });
    },
    refreshClub: () => runRead('refreshClub'),
    validateClubPlayers: refs => {
      if (!Array.isArray(refs) || !refs.length || refs.length > 50) throw new TypeError('Invalid refs');
      const safeRefs = refs.map(ref => {
        if (!Number.isSafeInteger(ref.id) || ref.id < 1 || !Number.isSafeInteger(ref.definitionId) || ref.definitionId < 1
            || typeof ref.safetyFingerprint !== 'string' || !ref.safetyFingerprint || ref.safetyFingerprint.length > 1024) {
          throw new TypeError('Incomplete validation identity');
        }
        return Object.freeze({ id: ref.id, definitionId: ref.definitionId, safetyFingerprint: ref.safetyFingerprint });
      });
      if (new Set(safeRefs.map(ref => ref.id)).size !== safeRefs.length) throw new TypeError('Duplicate item refs');
      return runRead('validateClubPlayers', safeRefs);
    },
  });
}

export function installRunnerSupportBridge(root, bridge) {
  const key = 'FSULocalRunnerBridge';
  const descriptor = Object.getOwnPropertyDescriptor(root, key);
  if (descriptor && descriptor.value !== bridge) throw new Error('FSU_BRIDGE_ALREADY_OWNED');
  if (!descriptor) Object.defineProperty(root, key, { configurable: true, value: bridge });
  return () => {
    if (Object.getOwnPropertyDescriptor(root, key)?.value === bridge) delete root[key];
  };
}
