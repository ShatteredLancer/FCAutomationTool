import { createSeasonContext } from '../../fc27/prelaunch-contract.js';
import { createTraditionalExclusive } from '../../fc27/traditional-lock.js';
import { traditionalJournalScope } from '../../fc27/traditional-journal.js';
import { createStreamlinedJournal } from '../../streamlined/journal.js';
import { same, fail } from '../../streamlined/contract.js';

// Share the existing cross-tab mutation lock with traditional SBC, Puzzle and
// Gallery. The transaction owns it through receipt persistence and reconciliation.
export function createFc27StreamlinedPersistence({ context, get, set, lockManager,
  readContext = () => context, now = () => Date.now() } = {}) {
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
  const raw = createStreamlinedJournal({ now,
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
    read: requested => { assertContext(requested); return raw.read(bound); },
    write: (requested, record, revision) => { assertContext(requested); assertHeld(); return raw.write(bound, record, revision); },
    begin: plan => { assertContext(plan.context); assertHeld(); return raw.begin(plan); },
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
  return Object.freeze({ journal, lock, inspect: exclusive.inspect });
}
