import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { assessTraditionalRecovery, createTraditionalJournal, traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { checkFc27GmInstallation, createFc27AcceptanceSession } from '../../src/adapters/browser/fc27-acceptance-session.js';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';

const context = { schema: 1, season: '27', accountScope: 'synthetic-recovery', platform: 'pc' };
const scope = traditionalJournalScope(context);
const record = (phase = 'saved') => ({ schema: 2, scope, operationId: 'recovery-1', setId: 4, challengeId: 16,
  itemRefs: [{ id: 1, definitionId: 101, pile: 'club' }], reward: { scope: 'set', type: 'pack', value: 509, count: 1, tradable: false },
  rewardBaselineCount: 3, phase, updatedAt: 900, submitted: phase === 'submitted' ? true : phase === 'submit-pending' ? null : false,
  setTimesCompleted: 0 });
const evidence = () => ({ context, fresh: true, observedAt: 1000, setId: 4, challengeId: 16,
  present: record().itemRefs, setTimesCompleted: 0, packId: 509, packCount: 3, unassignedClear: true });
const lockManager = () => {
  let held = false;
  return { request: async (name, _options, task) => {
    if (held) return task(null);
    held = true; try { return await task({ name, mode: 'exclusive' }); } finally { held = false; }
  } };
};
const storage = () => {
  const values = new Map();
  return { values, gmGetValue: (key, fallback) => values.get(key) ?? fallback,
    gmSetValue: vi.fn((key, value) => values.set(key, structuredClone(value))) };
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => vi.useRealTimers());

it.each(['save-pending', 'saved'])('offers to abandon %s only with all original items and unchanged progress and reward', phase => {
  expect(assessTraditionalRecovery(scope, record(phase), evidence(), 1000)).toBe('abandoned');
});
it.each(['submit-pending', 'submitted'])('does not infer non-submission for %s from unchanged inventory', phase => {
  expect(assessTraditionalRecovery(scope, record(phase), evidence(), 1000)).toBe('unresolved');
  expect(assessTraditionalRecovery(scope, record(phase), { ...evidence(), present: [], setTimesCompleted: 1, packCount: 4 }, 1000)).toBe('completed');
});
it.each([
  ['cache-only', { fresh: false }], ['wrong-target', { challengeId: 99 }], ['expired', { observedAt: 0 }],
  ['wrong-pack', { packId: 510 }], ['partial-consumption', { present: [] }], ['reward-changed', { packCount: 4 }],
  ['progress-changed', { setTimesCompleted: 1 }], ['unassigned', { unassignedClear: false }],
])('retains the original record for %s evidence', (kind, change) => {
  expect(assessTraditionalRecovery(scope, record(), { ...evidence(), ...change }, kind === 'expired' ? 16001 : 1000)).toBe('unresolved');
});
it('does not silently upgrade a schema 1 journal lacking the progress baseline', () => {
  const old = record(); old.schema = 1; delete old.setTimesCompleted;
  expect(assessTraditionalRecovery(scope, old, evidence(), 1000)).toBe('unresolved');
});
it('requires explicit approval and the unchanged original record to persist a recovery terminal state', async () => {
  const store = storage(); store.values.set(scope, record());
  const journal = createTraditionalJournal({ context, ...store, hasExclusiveAccess: () => true });
  await expect(journal.resolve(scope, record(), evidence(), {})).rejects.toThrow('APPROVAL_INVALID');
  await expect(journal.resolve(scope, record(), evidence(), { approved: true, operationId: 'different', outcome: 'abandoned' })).rejects.toThrow('APPROVAL_INVALID');
  await expect(journal.resolve(scope, record(), { ...evidence(), present: [] }, { approved: true, operationId: 'recovery-1', outcome: 'abandoned' })).rejects.toThrow('RECOVERY_REQUIRED');
  expect(store.gmSetValue).not.toHaveBeenCalled();
  expect(await journal.resolve(scope, record(), evidence(), { approved: true, operationId: 'recovery-1', outcome: 'abandoned' }))
    .toEqual({ status: 'resolved', outcome: 'abandoned', submitted: false });
  expect(await journal.read(scope)).toMatchObject({ phase: 'abandoned', itemRefs: record().itemRefs, updatedAt: 1000 });
});
it('retains evidence if the resolved terminal state cannot be persisted', async () => {
  const store = storage(); store.values.set(scope, record()); store.gmSetValue.mockImplementation(() => {});
  const journal = createTraditionalJournal({ context, ...store, hasExclusiveAccess: () => true });
  await expect(journal.resolve(scope, record(), evidence(), { approved: true, operationId: 'recovery-1', outcome: 'abandoned' })).rejects.toThrow('JOURNAL_UNCONFIRMED');
  expect(await journal.read(scope)).toEqual(record());
});
it('GM installation check survives recreation in a separate synthetic key and respects the real shared lock', async () => {
  const store = storage(); const locks = lockManager(); const options = { ...store, lockManager: locks };
  expect(await checkFc27GmInstallation(options)).toMatchObject({ status: 'verified', persistedPreviously: false, synthetic: true, eaRequests: 0 });
  const pending = checkFc27GmInstallation({ ...options, hold: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(await checkFc27GmInstallation(options)).toMatchObject({ status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE' });
  await vi.advanceTimersByTimeAsync(4000);
  expect(await pending).toMatchObject({ persistedPreviously: true, phase: 'save-pending' });
  expect(store.values.size).toBe(1); expect(store.values.has(scope)).toBe(false);
});
it('composes a default read-only session with genuine providers and no page-global authorization', async () => {
  const x = executionRuntime(); const store = storage();
  const session = createFc27AcceptanceSession({ root: x.root, ...store, lockManager: lockManager() });
  const pending = session.prepare({ setId: 4, maxRating: 74 }); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ status: 'prepared', liveEnabled: false, selectedCount: 11 });
  expect(await session.execute({ approved: true })).toMatchObject({ reason: 'FC27_LIVE_DISABLED' });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  expect(store.gmSetValue).not.toHaveBeenCalled();
  expect(await session.inspectRecovery()).toMatchObject({ status: 'idle' });
});

async function liveSession() {
  const x = executionRuntime(); const store = storage();
  x.root.crypto.randomUUID = () => 'synthetic-live-session';
  const session = createFc27AcceptanceSession({ root: x.root, ...store, lockManager: lockManager(), liveEnabled: true });
  const pending = session.prepare({ setId: 4, maxRating: 74 }); await vi.runAllTimersAsync();
  const plan = await pending;
  const approval = { approved: true, count: 1, setId: plan.setId, challengeId: plan.challengeId,
    maxRating: plan.maxRating, maxPlayers: plan.selectedCount };
  return { ...x, store, session, plan, approval };
}

it('enables one explicitly confirmed Live transaction without any write during preparation or replay', async () => {
  const x = await liveSession();
  expect(x.plan).toMatchObject({ status: 'prepared', liveEnabled: true, selectedCount: 11 });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  expect(x.store.gmSetValue).not.toHaveBeenCalled();
  const executing = x.session.execute(x.approval); await vi.runAllTimersAsync();
  expect(await executing).toMatchObject({ status: 'completed', submitted: true, consumedCount: 11 });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(2);
  expect([...x.store.values.values()][0].phase).toBe('completed');
  expect(await x.session.execute(x.approval)).toMatchObject({ status: 'blocked' });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(2);
});

it.each([{ approved: false }, { count: 2 }, { maxRating: 99 }, { challengeId: 999 }])(
  'rejects invalid Live confirmation %j without saving', async change => {
    const x = await liveSession();
    expect(await x.session.execute({ ...x.approval, ...change })).toMatchObject({ reason: 'FC27_APPROVAL_INVALID' });
    expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
    expect(x.store.gmSetValue).not.toHaveBeenCalled();
  });

it('keeps a confirmed Live request blocked when the exact material changes', async () => {
  const x = await liveSession(); x.state.players = x.state.players.slice(1);
  const executing = x.session.execute(x.approval); await vi.runAllTimersAsync();
  expect(await executing).toMatchObject({ status: 'blocked', reason: 'FC27_EXACT_ITEMS_CHANGED', submitted: false });
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
});

it.each(['saved', 'submit-pending'])('resolves %s through real provider composition only after explicit confirmation', async phase => {
  const x = executionRuntime(); const store = storage();
  const account = readFc27Context(x.root); const key = traditionalJournalScope(account);
  const pendingRecord = { ...record(phase), scope: key,
    itemRefs: x.state.players.map(item => ({ id: item.id, definitionId: item.resourceId, pile: 'club' })) };
  store.values.set(key, pendingRecord);
  if (phase === 'submit-pending') { x.state.players = []; x.set.timesCompleted = 1; x.state.packCount = 4; }
  const session = createFc27AcceptanceSession({ root: x.root, ...store, lockManager: lockManager() });
  const inspecting = session.inspectRecovery(); await vi.runAllTimersAsync();
  const outcome = phase === 'saved' ? 'abandoned' : 'completed';
  expect(await inspecting).toMatchObject({ status: 'recoverable', outcome });
  expect(store.gmSetValue).not.toHaveBeenCalled();
  expect(Object.keys(x.root.repositories.Item.club.items._collection)).toHaveLength(11);
  const resolving = session.resolveRecovery(true); await vi.runAllTimersAsync();
  expect(await resolving).toMatchObject({ status: 'resolved', outcome });
  expect(store.values.get(key).phase).toBe(outcome);
  expect(Object.keys(x.root.repositories.Item.club.items._collection)).toHaveLength(outcome === 'completed' ? 0 : 11);
  expect(x.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
});
