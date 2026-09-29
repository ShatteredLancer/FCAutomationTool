import { createSeasonContext, contextKey } from './prelaunch-contract.js';
import { traditionalJournalScope } from './traditional-journal.js';

const keyOf = context => `fcat-fc27-puzzle-fill:${contextKey(createSeasonContext(context), 'puzzle-fill')}`;
const targetKeyOf = (base, setId, challengeId) => `${base}:${setId}:${challengeId}`;
const indexKeyOf = base => `${base}:index`;
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw new Error(reason); };

function normalize(scope, input) {
  const bricks = input?.schema === 2 ? input.brickIndices : [];
  const required = Array.isArray(bricks) ? 11 - bricks.length : 0;
  if (!input || ![1, 2].includes(input.schema) || input.kind !== 'puzzle-fill'
      || required < 1 || required > 11 || new Set(bricks).size !== bricks.length
      || bricks.some(index => !Number.isInteger(index) || index < 0 || index > 10)
      || input.scope !== scope || typeof input.operationId !== 'string'
      || !/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId)
      || !positive(input.setId) || !positive(input.challengeId)
      || !['save-pending', 'saved'].includes(input.phase)
      || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0
      || input.submitted !== false || !Array.isArray(input.itemRefs)
      || input.itemRefs.length !== required
      || input.itemRefs.some(ref => !ref || !positive(ref.id) || !positive(ref.definitionId)
        || ref.pile !== 'club' || !Number.isInteger(ref.slot) || ref.slot < 0 || ref.slot > 10 || bricks.includes(ref.slot))
      || new Set(input.itemRefs.map(ref => ref.id)).size !== required
      || new Set(input.itemRefs.map(ref => ref.definitionId)).size !== required
      || new Set(input.itemRefs.map(ref => ref.slot)).size !== required) {
    return fail('FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED');
  }
  if (input.account !== undefined && (!input.account || typeof input.account !== 'object'
      || typeof input.account.accountScope !== 'string' || typeof input.account.platform !== 'string'
      || input.account.accountScope.length > 200 || input.account.platform.length > 80)) {
    return fail('FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED');
  }
  return structuredClone(input);
}

export function createFc27PuzzleFillPersistence({ context, gmGetValue, gmSetValue, lock, lockScope = null } = {}) {
  if (typeof gmGetValue !== 'function' || typeof gmSetValue !== 'function' || typeof lock?.run !== 'function'
      || typeof lock?.hasExclusiveAccess !== 'function' || lockScope !== traditionalJournalScope(context)) {
    return fail('FC27_PUZZLE_FILL_STORAGE_UNAVAILABLE');
  }
  const storageKey = keyOf(context);
  const indexKey = indexKeyOf(storageKey);
  const accountContext = createSeasonContext(context);
  const sameAccount = record => !record.account
    || record.account.accountScope === accountContext.accountScope
      && record.account.platform === accountContext.platform;
  const scope = lockScope;
  const nativeScope = scope;
  const exclusive = (requestedScope, task) => {
    if (requestedScope !== scope || typeof task !== 'function') return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
    return lock.run(nativeScope, task);
  };
  const held = requested => requested === scope && lock.hasExclusiveAccess(nativeScope) === true;
  const journal = Object.freeze({
    async read(requestedScope, target = null) {
      if (!held(requestedScope)) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      const key = target && positive(target.setId) && positive(target.challengeId)
        ? targetKeyOf(storageKey, target.setId, target.challengeId) : storageKey;
      let raw;
      try {
        raw = await gmGetValue(key, null);
        if (raw === null && target) raw = await gmGetValue(storageKey, null);
      } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED'); }
      if (raw === null && !target) {
        let targets = [];
        try { targets = await gmGetValue(indexKey, []); } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED'); }
        if (Array.isArray(targets) && targets.length) {
          const records = [];
          for (const entry of targets) {
            if (!positive(entry?.setId) || !positive(entry?.challengeId)) continue;
            const candidate = await gmGetValue(targetKeyOf(storageKey, entry.setId, entry.challengeId), null);
            if (candidate !== null) {
              const record = normalize(scope, candidate);
              if (!sameAccount(record)) return fail('FC27_PUZZLE_FILL_JOURNAL_ACCOUNT_CONFLICT');
              records.push(record);
            }
          }
          records.sort((a, b) => b.updatedAt - a.updatedAt);
          return records[0] ?? null;
        }
      }
      if (raw === null) return null;
      const record = normalize(scope, raw);
      if (record.account && (record.account.accountScope !== accountContext.accountScope
          || record.account.platform !== accountContext.platform)) return fail('FC27_PUZZLE_FILL_JOURNAL_ACCOUNT_CONFLICT');
      if (target && (record.setId !== target.setId || record.challengeId !== target.challengeId)) return null;
      return record;
    },
    async list(requestedScope) {
      if (!held(requestedScope)) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      let targets;
      try { targets = await gmGetValue(indexKey, []); } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED'); }
      if (!Array.isArray(targets)) return fail('FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED');
      const result = [];
      for (const target of targets) {
        if (!positive(target?.setId) || !positive(target?.challengeId)) continue;
        const record = await journal.read(scope, target);
        if (record) result.push(record);
      }
      // Read the pre-target-key legacy slot during migration. It is never used
      // for a different target's transaction, but remains visible for recovery.
      const legacy = await journal.read(scope);
      if (legacy && !result.some(record => record.setId === legacy.setId && record.challengeId === legacy.challengeId)) result.push(legacy);
      return result;
    },
    async write(requestedScope, value) {
      if (!held(requestedScope)) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      const next = normalize(scope, value);
      const key = targetKeyOf(storageKey, next.setId, next.challengeId);
      const previous = await journal.read(scope, { setId: next.setId, challengeId: next.challengeId });
      if (previous && next.updatedAt < previous.updatedAt) return fail('FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED');
      if (!previous && next.phase !== 'save-pending') return fail('FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED');
      if (!sameAccount(next)) return fail('FC27_PUZZLE_FILL_JOURNAL_ACCOUNT_CONFLICT');
      const newOperation = previous?.phase === 'saved' && next.phase === 'save-pending'
        && previous.operationId !== next.operationId;
      if (previous && !newOperation && (previous.operationId !== next.operationId
        || previous.schema !== next.schema || !same(previous.brickIndices, next.brickIndices)
        || next.updatedAt < previous.updatedAt
        || previous.setId !== next.setId || previous.challengeId !== next.challengeId
        || !same(previous.itemRefs, next.itemRefs)
        || previous.phase === 'saved' && next.phase !== 'saved'
        || previous.phase === 'save-pending' && !['save-pending', 'saved'].includes(next.phase))) {
        return fail('FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED');
      }
      try {
        await gmSetValue(key, next);
        const targets = await gmGetValue(indexKey, []);
        const nextTargets = Array.isArray(targets) ? targets.filter(target => target?.setId !== next.setId || target?.challengeId !== next.challengeId) : [];
        nextTargets.push({ setId: next.setId, challengeId: next.challengeId });
        await gmSetValue(indexKey, nextTargets);
        if (!same(await journal.read(scope, { setId: next.setId, challengeId: next.challengeId }), next)) return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED');
        // A valid legacy record is migrated only when it belongs to this target.
        const legacy = await gmGetValue(storageKey, null);
        if (legacy && legacy.setId === next.setId && legacy.challengeId === next.challengeId) await gmSetValue(storageKey, null);
      } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED'); }
    },
    async clear(requestedScope, expected) {
      if (!held(requestedScope)) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      normalize(scope, expected);
      const target = { setId: expected.setId, challengeId: expected.challengeId };
      const key = targetKeyOf(storageKey, target.setId, target.challengeId);
      const current = await journal.read(scope, target);
      if (!same(current, expected)) return fail('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
      try {
        await gmSetValue(key, null);
        const legacy = await gmGetValue(storageKey, null);
        if (same(legacy, expected)) await gmSetValue(storageKey, null);
        const targets = await gmGetValue(indexKey, []);
        await gmSetValue(indexKey, Array.isArray(targets) ? targets.filter(item => item?.setId !== target.setId || item?.challengeId !== target.challengeId) : []);
        if (await journal.read(scope, target) !== null) return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED');
      } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED'); }
    },
  });
  return Object.freeze({ scope, nativeScope, exclusive, journal, inspect: () => ({ active: held(scope) }) });
}
