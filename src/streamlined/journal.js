import { contextKey, createSeasonContext } from '../fc27/prelaunch-contract.js';
import { assertStreamlinedPlan } from './plan.js';
import { same, integer, fail } from './contract.js';
import { projectStreamlinedReceipt } from './contribution.js';

export const STREAMLINED_JOURNAL_SCHEMA = 1;
// A waiting-only journal is a reservation created before any contribution
// request. Its captured score may be stale after native/manual progress, so
// score equality cannot turn it into a recovery record. Any dispatch marker,
// receipt, or progress change keeps the journal recoverable.
export const isUnsentStreamlinedJournal = record => record?.batches?.length > 0
  && record.batches.every(batch => batch.state === 'waiting' && batch.startingScore === undefined
    && batch.receipt === undefined && batch.progressChanged !== true);
const states = ['waiting', 'pending', 'confirmed', 'rejected', 'unknown'];
export function streamlinedJournalKey(context) { return contextKey(context, 'streamlined-contribution'); }
export function validateStreamlinedJournal(record, context) {
  if (record?.schema !== 1 || !same(record.context, createSeasonContext(context)) || !integer(record.revision, 1)
      || !integer(record.updatedAt) || !integer(record.submittedScore)
      || !Array.isArray(record.batches) || !integer(record.plan?.challenge?.selectionLimit, 1, 1000)) fail('JOURNAL_INVALID');
  assertStreamlinedPlan(record.plan);
  if (!same(record.context, record.plan.context) || record.batches.length !== record.plan.batches.length
      || record.batches.some((batch, i) => !states.includes(batch.state) || batch.index !== i
        || !same(batch.refs, record.plan.batches[i].map(item => ({ id: item.id, definitionId: item.definitionId, points: item.points, pile: item.pile }))))
      || record.batches.filter(b => ['pending', 'unknown'].includes(b.state)).length > 1) fail('JOURNAL_INVALID');
  let previousScore = record.plan.challenge.submittedScore;
  for (const batch of record.batches) {
    // Selected batches can be executed out of plan order across approvals.
    // Bind each receipt to its durable pre-dispatch score, not its UI index.
    if (batch.startingScore !== undefined && (!integer(batch.startingScore, record.plan.challenge.submittedScore,
      record.submittedScore) || batch.state === 'waiting')) fail('JOURNAL_INVALID');
    const start = batch.startingScore ?? previousScore;
    const maxScore = start + batch.refs.reduce((sum, ref) => sum + ref.points, 0);
    if (batch.receipt !== undefined) {
      const projected = projectStreamlinedReceipt(batch.receipt, { challengeId: record.plan.challenge.id,
        setId: record.plan.challenge.setId, previousScore: start, maxScore, itemIds: batch.refs.map(ref => ref.id) });
      if (!['pending', 'unknown', 'confirmed'].includes(batch.state) || !same(projected, batch.receipt)) fail('JOURNAL_INVALID');
    }
    if (batch.state === 'confirmed') previousScore = batch.receipt?.submittedScore ?? maxScore;
  }
  return record;
}

export function createStreamlinedJournal({ get, set, now = () => Date.now() } = {}) {
  let tail = Promise.resolve();
  const read = async context => {
    let record;
    try { record = await get(streamlinedJournalKey(context), null); } catch { fail('JOURNAL_READ_FAILED'); }
    return record == null ? null : structuredClone(validateStreamlinedJournal(record, context));
  };
  const write = (context, record, previousRevision = 0) => {
    const task = tail.then(async () => {
      const current = await read(context);
      if ((current?.revision ?? 0) !== previousRevision) fail('JOURNAL_CHANGED');
      const next = validateStreamlinedJournal({ ...structuredClone(record), revision: previousRevision + 1, updatedAt: now() }, context);
      try {
        await set(streamlinedJournalKey(context), next);
        if (!same(await get(streamlinedJournalKey(context), null), next)) fail('JOURNAL_READBACK_FAILED');
      } catch { fail('JOURNAL_WRITE_FAILED'); }
      return structuredClone(next);
    });
    tail = task.catch(() => {}); return task;
  };
  return Object.freeze({ read, write, async begin(plan) {
    assertStreamlinedPlan(plan);
    if (plan.items.some(item => item.source !== 'inventory')) fail('PURCHASE_PENDING');
    const prior = await read(plan.context);
    if (prior && !isUnsentStreamlinedJournal(prior)
        && prior.batches.some(b => ['pending', 'unknown', 'waiting'].includes(b.state))) fail('RECOVERY_REQUIRED');
    return write(plan.context, { schema: 1, context: plan.context, plan, submittedScore: plan.challenge.submittedScore,
      rewardState: 'unknown', batches: plan.batches.map((batch, index) => ({ index, state: 'waiting',
        refs: batch.map(item => ({ id: item.id, definitionId: item.definitionId, points: item.points, pile: item.pile })) })) }, prior?.revision ?? 0);
  } });
}
