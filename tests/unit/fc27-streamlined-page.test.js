import { expect, it } from 'vitest';
import { streamlinedRuntime, pendingContribution } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedPageMaintenance } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { projectStreamlinedReceipt } from '../../src/streamlined/contribution.js';

async function fixture(targetScore = 200) {
  const f = streamlinedRuntime({ targetScore }), p = await pendingContribution(f);
  const maintenance = await createFc27StreamlinedPageMaintenance(f.root, { now: () => 1000 });
  const evidence = { fresh: true, operationConfirmed: true, context: f.plan.context, setId: 31, challengeId: 61,
    absent: p.batch.refs, submittedScore: 100, observedAt: 1000, timesCompleted: 0,
    challenge: { ...f.plan.challenge, submittedScore: 100, remainingScore: 100 } };
  return { ...f, ...p, maintenance, evidence };
}

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
