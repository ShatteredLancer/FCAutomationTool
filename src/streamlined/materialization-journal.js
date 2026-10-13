import { contextKey } from '../fc27/prelaunch-contract.js';
import { integer, same, fail } from './contract.js';

export function streamlinedMaterializationRecovery(record) {
  const pending = record.entries.filter(entry => entry.state === 'pending');
  const targets = [];
  for (const entry of pending) {
    let target = targets.find(row => row.setId === entry.setId && row.challengeId === entry.challengeId);
    if (!target) { target = { setId: entry.setId, challengeId: entry.challengeId, pendingCount: 0 }; targets.push(target); }
    target.pendingCount++;
  }
  return { kind: 'streamlined-materialization', ...targets[0], pendingCount: pending.length, targets };
}

export function createStreamlinedMaterializationJournal({ context, get, set, assertCurrent = () => {} }) {
  if (typeof get !== 'function' || typeof set !== 'function') fail('MATERIALIZE_JOURNAL_UNAVAILABLE');
  const key = contextKey(context, 'streamlined-materialization');
  const read = async () => {
    assertCurrent();
    let record;
    try { record = await get(key, null); } catch { fail('MATERIALIZE_JOURNAL_READ_FAILED'); }
    assertCurrent();
    if (record === null) return { schema: 1, entries: [] };
    if (record?.schema !== 1 || !Array.isArray(record.entries) || record.entries.length > 20000
        || new Set(record.entries.map(entry => entry?.id)).size !== record.entries.length
        || record.entries.some(entry => !integer(entry?.id, 1) || !integer(entry?.definitionId, 1)
          || !['unassigned', 'transfer'].includes(entry.pile) || !['pending', 'confirmed', 'rejected'].includes(entry.state)
          || !integer(entry.setId, 1) || !integer(entry.challengeId, 1))) fail('MATERIALIZE_JOURNAL_INVALID');
    return structuredClone(record);
  };
  const save = async record => {
    assertCurrent();
    try {
      await set(key, record);
      assertCurrent();
      if (!same(await get(key, null), record)) fail('MATERIALIZE_JOURNAL_WRITE_FAILED');
    } catch { fail('MATERIALIZE_JOURNAL_WRITE_FAILED'); }
    assertCurrent();
  };
  return Object.freeze({ read, save, async assertSettled() {
    const record = await read();
    if (record.entries.some(entry => entry.state === 'pending')) {
      throw Object.assign(Error('FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED'), {
        recovery: streamlinedMaterializationRecovery(record) });
    }
  } });
}
