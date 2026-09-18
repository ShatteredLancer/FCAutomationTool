import { traditionalJournalScope } from './traditional-journal.js';

export const FC27_TRADITIONAL_WEB_LOCK = 'fca-fc27-traditional-sbc-v1';
const fail = reason => { throw new Error(reason); };

export function createTraditionalExclusive({ context, lockManager } = {}) {
  const scope = traditionalJournalScope(context);
  let active = false;
  let held = false;
  const supported = () => typeof lockManager?.request === 'function';

  async function run(requestedScope, task) {
    if (requestedScope !== scope) return fail('FC27_JOURNAL_SCOPE_UNVERIFIED');
    if (typeof task !== 'function') return fail('FC27_EXCLUSIVE_TASK_UNVERIFIED');
    if (active || !supported()) return null;
    active = true;
    let accepting = true;
    let entered = false;
    let taskError;
    try {
      return await lockManager.request(FC27_TRADITIONAL_WEB_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!accepting || entered) return fail('FC27_EXCLUSIVE_ACCESS_LOST');
        entered = true;
        if (!lock) return null;
        if (lock.name !== FC27_TRADITIONAL_WEB_LOCK || lock.mode !== 'exclusive') return fail('FC27_EXCLUSIVE_ACCESS_LOST');
        held = true;
        try { return await task(); }
        catch (error) { taskError = error; throw error; }
        finally { held = false; }
      });
    } catch (error) {
      if (error === taskError) throw error;
      return fail('FC27_EXCLUSIVE_ACCESS_LOST');
    } finally { accepting = false; held = false; active = false; }
  }

  return Object.freeze({ run, hasExclusiveAccess: requestedScope => requestedScope === scope && held,
    inspect: () => ({ supported: supported(), active }) });
}
