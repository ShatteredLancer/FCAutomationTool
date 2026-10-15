import { expect, it } from 'vitest';
import { streamlinedRuntime, pendingContribution } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedPageMaintenance } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { projectStreamlinedReceipt } from '../../src/streamlined/contribution.js';
import { observedSet } from '../helpers/fc27-observed-set-runtime.js';

async function fixture(targetScore = 200, options = {}) {
  const f = streamlinedRuntime({ targetScore, ...options }), p = await pendingContribution(f);
  const maintenance = await createFc27StreamlinedPageMaintenance(f.root, { now: () => 1000 });
  const evidence = { fresh: true, operationConfirmed: true, context: f.plan.context, setId: 31, challengeId: 61,
    absent: p.batch.refs, submittedScore: 100, observedAt: 1000, timesCompleted: 0,
    challenge: { ...f.plan.challenge, submittedScore: 100, remainingScore: 100 } };
  return { ...f, ...p, maintenance, evidence };
}

// Replay the actual public factory, not a synthetic expiry delta: EA receives
// remaining seconds and rounds the local clock anew for every hub projection.
it('settles a verified completed contribution when the native hub factory rebases expiry by one second', async () => {
  const original = observedSet(1000000);
  const f = await fixture(100, { endTime: original.endTime });
  f.batch.receipt.challengeCompleted = true; f.batch.receipt.challengeAwardCount = 1;
  f.evidence.challenge = { ...f.plan.challenge, submittedScore: 100, remainingScore: 0, status: 'COMPLETED' };
  f.evidence.timesCompleted = 1;
  f.replies.set = observedSet(1001501, { endTime: 3599, combinedSubmittedChallengeScore: 100,
    timesCompleted: 1, challengesCompletedCount: 1 });
  expect(f.replies.set.endTime).toBe(original.endTime + 1);
  await expect(f.maintenance.apply(f.record, f.batch, f.evidence)).resolves.toBe(true);
  expect(f.challenge.submittedScore).toBe(100); expect(f.set.totalSubmittedScore).toBe(100);
  expect(f.set.endTime).toBe(original.endTime); // Never extend the frozen execution expiry.
});

it.each([
  ['repeats', 9, 'SET_CHANGED'], ['repeatabilityMode', 'NON_REPEATABLE', 'SET_CHANGED'],
  ['endTime', null, 'SET_EXPIRY_UNVERIFIED'], ['endTime', 0, 'SET_EXPIRY_UNVERIFIED'],
  ['totalSubmittedScore', null, 'SET_SCORE_UNVERIFIED'],
  ['challengesCompletedCount', -1, 'SET_CHALLENGE_COUNT_UNVERIFIED'],
  ['timesCompleted', undefined, 'SET_CYCLE_COUNT_UNVERIFIED'],
])('keeps real metadata/counter failures blocked: %s = %s', async (field, value, reason) => {
  const f = await fixture(100, { endTime: 4600 });
  f.batch.receipt.challengeCompleted = true; f.batch.receipt.challengeAwardCount = 1;
  f.evidence.challenge = { ...f.plan.challenge, submittedScore: 100, remainingScore: 0 };
  f.replies.set = { ...f.set, totalSubmittedScore: 100, [field]: value };
  await expect(f.maintenance.apply(f.record, f.batch, f.evidence)).rejects.toThrow(`FC27_STREAMLINED_${reason}`);
  expect(f.root.repositories.Item.club.items._collection[1]).toBeDefined();
  expect(f.set.totalSubmittedScore).toBe(0); expect(f.set.endTime).toBe(4600);
});

it('allows a market-only preview to prepare no owned refs without weakening actual cache consumption', async () => {
  const f = await fixture();
  expect(() => f.maintenance.prepare([])).not.toThrow();
  expect(f.calls).toHaveLength(0);
  expect(f.root.repositories.Item.club.items._collection[1]).toBeDefined();
  expect(() => f.maintenance.prepare(null)).toThrow();
  expect(() => f.maintenance.prepare([{ id: null, definitionId: 100, pile: 'club' }])).toThrow();
  const record = structuredClone(f.record);
  record.batches[0].refs = [];
  await expect(f.maintenance.apply(record, record.batches[0], { ...f.evidence, absent: [] })).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
  expect(f.root.repositories.Item.club.items._collection[1]).toBeDefined();
});

it('updates partial progress and native caches once without reading the hub or creating rewards', async () => {
  const f = await fixture();
  f.maintenance.prepare(f.batch.refs);
  expect(f.calls).toHaveLength(0);
  expect(await f.maintenance.apply(f.record, f.batch, f.evidence)).toBe(true);
  expect(await f.maintenance.apply(f.record, f.batch, f.evidence)).toBe(true);
  expect(f.challenge.submittedScore).toBe(100); expect(f.set.totalSubmittedScore).toBe(100);
  expect(f.calls.filter(row => row.kind === 'hub')).toHaveLength(0);
  expect(f.calls.filter(row => row.kind === 'notify')).toHaveLength(2);
});

it('uses a fresh completed-cycle set snapshot and can repeat local maintenance after reset', async () => {
  const f = await fixture(100);
  f.record.batches[0].receipt.challengeCompleted = true;
  f.record.batches[0].receipt.challengeAwardCount = 1;
  f.record.batches[0].receipt.previousTimesCompleted = 0;
  f.record.batches[0].receipt = projectStreamlinedReceipt(f.record.batches[0].receipt, {
    setId: 31, challengeId: 61, previousScore: 0, maxScore: 100, itemIds: f.batch.refs.map(ref => ref.id) });
  f.evidence.challenge = { ...f.plan.challenge, submittedScore: 0, remainingScore: 100 };
  f.evidence.timesCompleted = 1; f.evidence.cycleResetConfirmed = true;
  f.replies.set = { ...f.set, timesCompleted: 1 };
  expect(await f.maintenance.apply(f.record, f.record.batches[0], f.evidence)).toBe(true);
  expect(await f.maintenance.apply(f.record, f.record.batches[0], f.evidence)).toBe(true);
  expect(f.challenge.submittedScore).toBe(0); expect(f.challenge.timesCompleted).toBe(1);
  expect(f.set.timesCompleted).toBe(1); expect(f.set.totalSubmittedScore).toBe(0);
  expect(f.calls.filter(row => row.kind === 'hub')).toEqual([{ kind: 'hub', options: undefined }, { kind: 'hub', options: undefined }]);
});

it('stops without evicting on changed page progress, malformed hub fields or non-writable native fields', async () => {
  for (const kind of ['progress', 'hub', 'writable']) {
    const f = await fixture();
    if (kind === 'progress') f.challenge.submittedScore = 20;
    if (kind === 'hub') { f.record.batches[0].receipt.challengeCompleted = true; f.record.batches[0].receipt.challengeAwardCount = 1; f.replies.set.timesCompleted = null; }
    if (kind === 'writable') Object.defineProperty(f.challenge, 'submittedScore', { writable: false });
    await expect(f.maintenance.apply(f.record, f.record.batches[0], f.evidence)).rejects.toThrow();
    expect(f.root.repositories.Item.club.items._collection[1]).toBeDefined();
  }
});
