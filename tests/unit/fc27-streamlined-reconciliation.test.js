import { expect, it, vi } from 'vitest';
import { streamlinedRuntime, pendingContribution } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedReconciler } from '../../src/adapters/ea/fc27-streamlined-reconciliation.js';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';
import nativeObservation from '../fixtures/fc27-streamlined-reset-observation-2026-10-16.json';
import { createHash } from 'node:crypto';

async function setup(options) {
  const f = streamlinedRuntime(options), pending = await pendingContribution(f);
  f.state.players = f.state.players.filter(item => !f.selected.some(selected => selected.id === item.id));
  if (f.storage) f.storage.payload = [];
  return { ...f, ...pending };
}

it.each([0, undefined])('confirms exact completed consumption after a repeat reset with native child counter %s', async timesCompleted => {
  const f = await setup({ targetScore: 100 });
  f.batch.receipt = normalizeStreamlinedContributionReply({ success: true, status: 200, response: {
    setId: 31, challengeId: 61, submittedScore: 100, grantedChallengeAwards: [{ type: 'pack' }] } },
  { setId: 31, challengeId: 61, previousScore: 0, previousTimesCompleted: 0, itemIds: f.batch.refs.map(ref => ref.id) });
  for (const method of nativeObservation.methods) expect(createHash('sha256').update(method.source).digest('hex')).toBe(method.sha256);
  const factory = new Function('JSUtils', 'UTSBCChallengeEntity', 'Date',
    `return (${nativeObservation.methods.find(row => row.name === 'createChallenge').source})`)(
    { isNumber: value => typeof value === 'number', isEmpty: value => value == null || value === '' },
    class { constructor(data) { Object.assign(this, data); } }, { now: () => 1000 });
  const native = factory.call({ createRequirements: () => [] }, { challengeId: 61, setId: 31,
    elgOperation: 'AND', submittedScore: 0, status: 'NOT_STARTED', ...(timesCompleted === undefined ? {} : { timesCompleted }) });
  Object.assign(f.replies.rows[0], { submittedScore: native.submittedScore, status: native.status, timesCompleted: native.timesCompleted });
  await expect(createFc27StreamlinedReconciler(f.root, { now: () => 1000 }).reconcile(f.record, f.batch))
    .resolves.toMatchObject({ operationConfirmed: true, cycleResetConfirmed: true, submittedScore: 0 });
  expect(f.record.batches[0].state).toBe('pending');
  expect(f.calls.map(row => row.kind)).toEqual(['request', 'progress']);
});

it('requires durable receipt, exact Club absence and fresh progress without editing shared repositories', async () => {
  const f = await setup(), before = JSON.stringify(f.root.repositories);
  const result = await createFc27StreamlinedReconciler(f.root, { now: () => 1000 }).reconcile(f.record, f.batch);
  expect(result).toMatchObject({ fresh: true, operationConfirmed: true, submittedScore: 100,
    absent: f.batch.refs, requests: 2, rewardConfirmed: false, cycleResetConfirmed: false });
  expect(f.calls.map(call => call.kind)).toEqual(['request', 'progress']);
  expect(JSON.stringify(f.root.repositories)).toBe(before);
  expect(f.record.batches[0].state).toBe('pending');
});

it('recovers a completed locked work area using the durable target, never a different visible SBC', async () => {
  const f = await setup({ targetScore: 100 });
  f.batch.receipt.challengeCompleted = true; f.batch.receipt.challengeAwardCount = 1;
  f.replies.rows[0].status = 'COMPLETED'; f.replies.rows[0].timesCompleted = 1;
  f.root.getAppMain = () => null;
  const reader = createFc27StreamlinedReconciler(f.root, { requirePage: false, now: () => 1000 });
  await expect(reader.reconcile(f.record, f.batch)).resolves.toMatchObject({ operationConfirmed: true, submittedScore: 100 });
  expect(f.calls.map(call => call.kind)).toEqual(['request', 'progress']);
  f.replies.rows[0].id = 99;
  await expect(reader.reconcile(f.record, f.batch)).rejects.toThrow('PROGRESS_READ_UNVERIFIED');
});

it('checks both piles and permits another Storage copy, but never the original consumed entity', async () => {
  const f = await setup({ mixedStorage: true });
  f.storage.payload = [{ id: 502, resourceId: 101, pile: 8 }];
  const before = JSON.stringify(f.root.repositories);
  const reader = createFc27StreamlinedReconciler(f.root);
  await expect(reader.reconcile(f.record, f.batch)).resolves.toMatchObject({ operationConfirmed: true, requests: 3 });
  expect(f.calls.map(call => call.kind)).toEqual(['request', 'storage', 'progress']);
  expect(JSON.stringify(f.root.repositories)).toBe(before);
  f.storage.payload.push({ id: 501, resourceId: 101, pile: 8 });
  await expect(reader.reconcile(f.record, f.batch)).rejects.toThrow('MATERIAL_STILL_PRESENT');
  expect(f.record.batches[0].state).toBe('pending');
});

it('distinguishes an old submitted entity from another copy of the same version', async () => {
  const f = await setup(); f.state.players.push({ id: 900, resourceId: 101 });
  await expect(createFc27StreamlinedReconciler(f.root).reconcile(f.record, f.batch)).resolves.toMatchObject({ operationConfirmed: true });
  f.state.players.push({ id: 1, resourceId: 101 });
  await expect(createFc27StreamlinedReconciler(f.root).reconcile(f.record, f.batch)).rejects.toThrow('MATERIAL_STILL_PRESENT');
});

it('does not read without a receipt or when journal batch identity differs', async () => {
  const f = await setup(), createTransport = vi.fn();
  const reader = createFc27StreamlinedReconciler(f.root, { createTransport });
  await expect(reader.reconcile(f.record, { ...f.batch, index: 1 })).rejects.toThrow('JOURNAL_INVALID');
  delete f.batch.receipt;
  await expect(reader.reconcile(f.record, f.batch)).rejects.toThrow('RECEIPT_REQUIRED');
  expect(createTransport).not.toHaveBeenCalled();
});

it('classifies malformed, duplicate and wrong-version readback without inferring absence', async () => {
  for (const rows of [[null], [{ id: 1, definitionId: 999, pile: 'club' }],
    [{ id: 900, definitionId: 101, pile: 'club' }, { id: 900, definitionId: 101, pile: 'club' }]]) {
    const f = await setup();
    const createTransport = async () => ({ readPage: async () => rows, getRequestCount: () => 1 });
    await expect(createFc27StreamlinedReconciler(f.root, { createTransport }).reconcile(f.record, f.batch))
      .rejects.toThrow('FRESH_ENTITY_UNVERIFIED');
  }
});

it.each([null, 'storage', 'club'])('requires the exact consumed entity to be absent regardless of returned pile %s', async pile => {
  for (const originalPresent of [true, false]) {
    const f = await setup();
    const createTransport = async () => ({ readPage: async () => [
      { id: originalPresent ? 1 : 900, definitionId: 101, pile }], getRequestCount: () => 1 });
    const result = createFc27StreamlinedReconciler(f.root, { createTransport }).reconcile(f.record, f.batch);
    if (originalPresent) await expect(result).rejects.toThrow('MATERIAL_STILL_PRESENT');
    else await expect(result).resolves.toMatchObject({ operationConfirmed: true, absent: f.batch.refs });
  }
});

it('refuses stale/future progress, rule changes and completed-cycle resets', async () => {
  for (const observedAt of [0, 20001]) {
    const f = await setup();
    const createProgress = () => ({ read: async () => ({ fresh: true, observedAt, challenge: f.input.challenge }) });
    await expect(createFc27StreamlinedReconciler(f.root, { now: () => 20000, createProgress }).reconcile(f.record, f.batch))
      .rejects.toThrow('PROGRESS_READ_UNVERIFIED');
  }
  for (const change of [f => { f.replies.rows[0].submittedScore = 99; },
    f => { f.replies.rows[0].scoreRequirement = 201; },
    f => { f.replies.rows[0].eligibilityOperation = 'OR'; }]) {
    const f = await setup(); change(f);
    await expect(createFc27StreamlinedReconciler(f.root).reconcile(f.record, f.batch)).rejects.toThrow('PROGRESS_CHANGED');
  }
  const f = await setup();
  f.batch.receipt.challengeCompleted = true; f.batch.receipt.challengeAwardCount = 1;
  f.replies.rows[0].submittedScore = 0;
  await expect(createFc27StreamlinedReconciler(f.root).reconcile(f.record, f.batch)).rejects.toThrow('CYCLE_RESET_UNVERIFIED');
});

it('serializes readback and stops when the account changes mid-read', async () => {
  const f = await setup(); let release;
  const createTransport = async () => ({ readPage: () => new Promise(resolve => { release = resolve; }), getRequestCount: () => 1 });
  const reader = createFc27StreamlinedReconciler(f.root, { createTransport });
  const pending = reader.reconcile(f.record, f.batch);
  await Promise.resolve();
  await expect(reader.reconcile(f.record, f.batch)).rejects.toThrow('BUSY');
  f.user.selectedPersona = 444; release([]);
  await expect(pending).rejects.toThrow();
  f.user.selectedPersona = 902;
  const retry = reader.reconcile(f.record, f.batch);
  await Promise.resolve(); release([]);
  await expect(retry).resolves.toMatchObject({ operationConfirmed: true });
});

it('keeps one-step counter proof and accepts valid reset state, but rejects known conflicting counters', async () => {
  for (const timesCompleted of [0, 1, 2, null]) {
    const f = streamlinedRuntime({ targetScore: 100 });
    const { record, batch } = await pendingContribution(f);
    batch.receipt = normalizeStreamlinedContributionReply({ success: true, status: 200, response: {
      setId: 31, challengeId: 61, submittedScore: 100, grantedChallengeAwards: [{ type: 'pack' }], grantedSetAwards: [] } },
    { setId: 31, challengeId: 61, previousScore: 0, previousTimesCompleted: 0, itemIds: batch.refs.map(ref => ref.id) });
    f.state.players = []; f.replies.rows[0].submittedScore = 0; f.replies.rows[0].timesCompleted = timesCompleted;
    const result = createFc27StreamlinedReconciler(f.root).reconcile(record, batch);
    if (timesCompleted !== 2) await expect(result).resolves.toMatchObject({ cycleResetConfirmed: true,
      operationConfirmed: true, submittedScore: 0, rewardConfirmed: false });
    else await expect(result).rejects.toThrow('CYCLE_RESET_UNVERIFIED');
  }
});
