import { createSeasonContext } from '../../fc27/prelaunch-contract.js';
import { createTraditionalExclusive } from '../../fc27/traditional-lock.js';
import { traditionalJournalScope } from '../../fc27/traditional-journal.js';
import { createStreamlinedJournal } from '../../streamlined/journal.js';
import { same, fail } from '../../streamlined/contract.js';

// Share the existing cross-tab mutation lock with traditional SBC, Puzzle and
// Gallery. The transaction owns it through receipt persistence and reconciliation.
export function createFc27StreamlinedPersistence({ context, get, set, lockManager,
  readContext = () => context, now = () => Date.now(), beforeReplace = async () => {}, isArchivedContribution = async () => false,
  beforeBegin = async () => {} } = {}) {
  const bound = createSeasonContext(context), scope = traditionalJournalScope(bound);
  const exclusive = createTraditionalExclusive({ context: bound, lockManager });
  const pending = new Set();
  const assertContext = requested => {
    if (!same(createSeasonContext(requested), bound) || !same(createSeasonContext(readContext()), bound)) fail('CONTEXT_CHANGED');
  };
  const assertHeld = () => {
    assertContext(bound);
    if (!exclusive.hasExclusiveAccess(scope)) fail('EXCLUSIVE_ACCESS_REQUIRED');
  };
  const raw = createStreamlinedJournal({ now, canReplaceArchived: isArchivedContribution,
    get: async (key, fallback) => {
      assertContext(bound);
      const value = await get(key, fallback);
      assertContext(bound); return value;
    },
    set: async (key, value) => {
      assertHeld();
      const write = Promise.resolve().then(() => { assertHeld(); return set(key, value); });
      pending.add(write);
      try { await write; assertHeld(); } finally { pending.delete(write); }
    },
  });
  const journal = Object.freeze({
    read: requested => { assertContext(requested); return (async () => { const record = await raw.read(bound);
      return record && await isArchivedContribution(record) ? null : record; })(); },
    write: (requested, record, revision) => { assertContext(requested); assertHeld(); return (async () => {
      const prior = await raw.read(bound);
      if (prior && await isArchivedContribution(prior)) fail('PURCHASE_HISTORY_RETIRED');
      return raw.write(bound, record, revision); })(); },
    begin: (plan, options) => {
      assertContext(plan.context); assertHeld();
      return (async () => {
        await beforeBegin(plan); assertHeld();
        const previous = await raw.read(bound);
        if (previous && previous.plan.fingerprint !== plan.fingerprint) {
          await beforeReplace(previous, plan); assertHeld();
          if (!same(previous, await raw.read(bound))) fail('JOURNAL_CHANGED');
        }
        return raw.begin(plan, options);
      })();
    },
  });
  const lock = Object.freeze({ async acquire(requested) {
    assertContext(requested);
    let acquired, denied, unlock;
    const ready = new Promise((resolve, reject) => { acquired = resolve; denied = reject; });
    const held = new Promise(resolve => { unlock = resolve; });
    const completion = exclusive.run(scope, async () => {
      assertContext(requested);
      let released = false;
      acquired(async () => {
        if (!released) { released = true; unlock(); }
        await completion;
      });
      await held;
      while (pending.size) await Promise.allSettled([...pending]);
    });
    // Handle early rejection as well as unsupported/busy locks; never leave an
    // acquire promise hanging or a rejected Web Lock request unobserved.
    completion.then(() => acquired(null), denied);
    return ready;
  } });
  return Object.freeze({ journal, lock, inspect: exclusive.inspect, assertHeld });
}
