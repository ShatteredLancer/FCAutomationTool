import { puzzleBuyKey, puzzleBuyPendingKey, puzzleBuyHistoryKey } from './puzzle-buy-session.js';
export { puzzleBuyHistoryKey } from './puzzle-buy-session.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = code => { throw Error(`FC27_BUY_${code}`); };
const id = value => Number.isSafeInteger(value) && value > 0;
const states = ['waiting', 'buy-pending', 'bought', 'move-pending', 'move-rejected', 'club'];

// Read only the exact same-account key. Never enumerate GM storage or trust a
// foreign marker, and never mistake corrupt storage for a settled transaction.
export async function readPuzzleBuyPending(get, scope, context = null) {
  const pending = await get(puzzleBuyPendingKey(scope), null);
  if (pending === null) return null;
  const prefix = `fcat-fc27-puzzle-buy:${scope}:`;
  const suffix = typeof pending?.key === 'string' && pending.key.startsWith(prefix) ? pending.key.slice(prefix.length) : '';
  if (!/^[1-9]\d{0,8}:[1-9]\d{0,8}$/.test(suffix) || typeof pending.operationId !== 'string') fail('JOURNAL_UNCONFIRMED');
  const [setId, challengeId] = suffix.split(':').map(Number), target = { setId, challengeId };
  let record;
  try { record = await get(puzzleBuyKey(scope, target), null); } catch { fail('JOURNAL_READ_FAILED'); }
  if (record?.schema !== 1 || record.scope !== scope || !same(record.target, target)
      || context && !same(record.context, context) || record.operationId !== pending.operationId
      || !['ready', 'save-pending', 'saved'].includes(record.phase)
      || !Array.isArray(record.entries) || record.entries.length > 32
      || record.entries.some(e => !states.includes(e?.state) || !id(e.definitionId)
        || !Number.isSafeInteger(e.slot) || e.slot < 0 || e.slot > 31
        || e.state !== 'waiting' && !id(e.itemId))
      || new Set(record.entries.map(e => e.slot)).size !== record.entries.length
      || !Array.isArray(record.applied)) fail('JOURNAL_UNCONFIRMED');
  return { pending, record, target };
}

export async function assertPuzzleBuyTargetAvailable(get, scope, target = null, context = null) {
  const active = await readPuzzleBuyPending(get, scope, context);
  if (active && !active.record.closure && target && same(active.target, { setId: target.setId, challengeId: target.challengeId })) {
    fail('RECOVERY_REQUIRED');
  }
}

// Caller holds the shared mutation lock. locate is read-only and bounded: it
// never buys/moves/saves, and missing entities never prove non-purchase.
export async function maintainPuzzleBuyLifecycle({ scope, context, get, set, assertCurrent,
  targetState, locate, requestedTarget = null, now = () => Date.now() }) {
  assertCurrent();
  const active = await readPuzzleBuyPending(get, scope, context);
  if (!active) return { status: 'absent' };
  const { pending, record, target } = active;
  const unchanged = async () => {
    assertCurrent();
    if (!same(await get(puzzleBuyPendingKey(scope), null), pending)
        || !same(await get(pending.key, null), record)) fail('JOURNAL_CHANGED');
    assertCurrent();
  };
  const store = async (key, value) => {
    assertCurrent();
    try { await set(key, structuredClone(value)); } catch { fail('JOURNAL_WRITE_FAILED'); }
    assertCurrent();
    if (!same(await get(key, null), value)) fail('JOURNAL_READBACK_FAILED');
  };
  const historyKey = puzzleBuyHistoryKey(scope, target), history = await get(historyKey, []);
  if (!Array.isArray(history)) fail('HISTORY_UNCONFIRMED');
  const prior = history.find(row => row.operationId === record.operationId);
  if (record.closure) {
    if (!Array.isArray(history) || !history.some(row => same(row, record))) fail('HISTORY_UNCONFIRMED');
    await unchanged(); await store(puzzleBuyPendingKey(scope), null);
    return { status: 'archived', reason: record.closure.reason, ...target };
  }
  if (prior) {
    const { closure, ...original } = prior;
    if (closure?.schema !== 1 || closure.autoRetryAllowed !== false || !same(original, record)) fail('HISTORY_UNCONFIRMED');
    await unchanged(); await store(pending.key, prior); await store(puzzleBuyPendingKey(scope), null);
    return { status: 'archived', reason: closure.reason, ...target };
  }
  const uncertain = record.entries.filter(e => ['buy-pending', 'bought', 'move-pending', 'move-rejected'].includes(e.state));
  const complete = record.entries.every(e => e.state === 'club') && record.phase !== 'save-pending'
    && same(record.entries, record.applied);
  const switched = requestedTarget && id(requestedTarget.setId) && id(requestedTarget.challengeId) && !same(target, requestedTarget);
  // A completed batch or an explicit target change needs no catalogue request.
  // Unknown receipts need their one bounded lookup regardless of target expiry.
  const state = complete || switched || uncertain.length ? 'unknown' : await targetState(target);
  assertCurrent();
  if (!complete && !uncertain.length && !switched && !['retired', 'completed'].includes(state)) return { status: 'target-recovery', ...target };
  const observations = [];
  for (const entry of uncertain) {
    await unchanged();
    let location = 'unknown';
    try { location = await locate(entry, uncertain); } catch { /* Preserve uncertainty, not permission to rebuy. */ }
    assertCurrent();
    observations.push({ slot: entry.slot, location: ['club', 'purchased'].includes(location) ? location : 'unknown' });
  }
  await unchanged();
  const reason = uncertain.length ? 'historical-unconfirmed' : complete ? 'settled' : switched ? 'target-changed' : 'target-ended';
  const closed = { ...record, closure: { schema: 1, reason, at: now(), targetState: state,
    autoRetryAllowed: false, observations } };
  await store(historyKey, [...history, closed]);
  await unchanged(); await store(pending.key, closed);
  // Archive and closed record are durable before releasing the marker. A crash
  // here resumes the exact archive, never dispatches the old purchase again.
  await store(puzzleBuyPendingKey(scope), null);
  return { status: 'archived', reason, ...target, count: record.entries.length,
    unknownCount: observations.filter(row => row.location === 'unknown').length };
}
