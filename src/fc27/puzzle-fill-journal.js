import { createSeasonContext, contextKey } from './prelaunch-contract.js';
import { traditionalJournalScope } from './traditional-journal.js';

const keyOf = context => `fcat-fc27-puzzle-fill:${contextKey(createSeasonContext(context), 'puzzle-fill')}`;
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
  return structuredClone(input);
}

export function createFc27PuzzleFillPersistence({ context, gmGetValue, gmSetValue, lock, lockScope = null } = {}) {
  if (typeof gmGetValue !== 'function' || typeof gmSetValue !== 'function' || typeof lock?.run !== 'function'
      || typeof lock?.hasExclusiveAccess !== 'function' || lockScope !== traditionalJournalScope(context)) {
    return fail('FC27_PUZZLE_FILL_STORAGE_UNAVAILABLE');
  }
  const storageKey = keyOf(context);
  const scope = lockScope;
  const nativeScope = scope;
  const exclusive = (requestedScope, task) => {
    if (requestedScope !== scope || typeof task !== 'function') return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
    return lock.run(nativeScope, task);
  };
  const held = requested => requested === scope && lock.hasExclusiveAccess(nativeScope) === true;
  const journal = Object.freeze({
    async read(requestedScope) {
      if (!held(requestedScope)) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      let raw;
      try { raw = await gmGetValue(storageKey, null); } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_READ_UNCONFIRMED'); }
      if (raw === null) return null;
      return normalize(scope, raw);
    },
    async write(requestedScope, value) {
      if (!held(requestedScope)) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      const next = normalize(scope, value);
      const previous = await journal.read(scope);
      if (previous && next.updatedAt < previous.updatedAt) return fail('FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED');
      if (!previous && next.phase !== 'save-pending') return fail('FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED');
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
        await gmSetValue(storageKey, next);
        if (!same(await journal.read(scope), next)) return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED');
      } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED'); }
    },
    async clear(requestedScope, expected) {
      if (!held(requestedScope)) return fail('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      const current = await journal.read(scope);
      if (!same(current, expected)) return fail('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
      try {
        await gmSetValue(storageKey, null);
        if (await journal.read(scope) !== null) return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED');
      } catch { return fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED'); }
    },
  });
  return Object.freeze({ scope, nativeScope, exclusive, journal, inspect: () => ({ active: held(scope) }) });
}
