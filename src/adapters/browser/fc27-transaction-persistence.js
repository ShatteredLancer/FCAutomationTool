import { createTraditionalJournal } from '../../fc27/traditional-journal.js';
import { createTraditionalExclusive } from '../../fc27/traditional-lock.js';

// Not installed by either userscript. The future entry must inject its own GM APIs.
export function createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager } = {}) {
  const lock = createTraditionalExclusive({ context, lockManager });
  const pendingWrites = new Set();
  const write = async (key, value) => {
    const pending = Promise.resolve().then(() => gmSetValue(key, value));
    pendingWrites.add(pending);
    try { return await pending; } finally { pendingWrites.delete(pending); }
  };
  const journal = createTraditionalJournal({ context, gmGetValue,
    gmSetValue: typeof gmSetValue === 'function' ? write : gmSetValue, hasExclusiveAccess: lock.hasExclusiveAccess });
  const exclusive = (scope, task) => lock.run(scope, async () => {
    try { return await task(); }
    // A timeout cannot cancel a dispatched GM write. Keep the native lock until it settles.
    finally { while (pendingWrites.size) await Promise.allSettled([...pendingWrites]); }
  });
  return Object.freeze({ journal, exclusive, inspect: () => {
    const state = lock.inspect();
    return { storageAvailable: true, lockSupported: state.supported, active: state.active };
  } });
}
