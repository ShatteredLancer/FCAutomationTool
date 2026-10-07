import { createFc27StreamlinedValidator } from './fc27-streamlined-validation.js';
import { createFc27StreamlinedProgressReader } from './fc27-streamlined-progress.js';
import { createFc27StreamlinedContributionTransport } from './fc27-streamlined-contribution.js';
import { createFc27StreamlinedReconciler } from './fc27-streamlined-reconciliation.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge, readFc27StreamlinedPolicy } from './fc27-streamlined-read.js';
import { readFc27Context } from './fc27-local-read.js';
import { normalizeStreamlinedContributionReply } from '../../streamlined/contribution.js';
import { validateStreamlinedJournal } from '../../streamlined/journal.js';
import { integer, same, fail } from '../../streamlined/contract.js';

// Production composition for the transaction driver.
// Callers cannot dispatch by supplying a plan alone: a fresh validation lease,
// the matching durable pending batch and explicit write capability are required.
// Initiation and reward handling remain separate capabilities.
export function createFc27StreamlinedProvider(root, { journal, canWrite = () => false, now = () => Date.now(),
  createValidator = createFc27StreamlinedValidator, createProgress = createFc27StreamlinedProgressReader,
  createTransport = createFc27StreamlinedContributionTransport, createReconciler = createFc27StreamlinedReconciler,
  maintenance = null, checkOtherTransactions = async () => {} } = {}) {
  let lease = null, busy = false;
  const progress = createProgress(root, { now });
  const validator = createValidator(root, { now, readProgress: expected => progress.read(expected), nativeReauth: true });
  const reconciler = createReconciler(root, { now, nativeReauth: true });
  const binding = () => {
    const page = locateFc27StreamlinedPage(root);
    if (!page) fail('PAGE_UNAVAILABLE');
    const context = readFc27Context(root);
    return { controller: page.controller, context, challenge: projectFc27StreamlinedChallenge(page, context) };
  };
  const unchanged = (origin, plan) => {
    const current = binding();
    if (current.controller !== origin.controller || !same(current.context, plan.context)
        || !same(current.challenge, origin.challenge)) fail('CONTEXT_CHANGED');
    if (!same(readFc27StreamlinedPolicy(root, plan.policy.maxRating), plan.policy)) fail('POLICY_CHANGED');
    if (plan.challenge.endTime > 0 && plan.challenge.endTime * 1000 <= now()) fail('CHALLENGE_EXPIRED');
  };
  return Object.freeze({
    capabilities: Object.freeze({ get contributionVerified() { return canWrite() === true; } }),
    async verify(plan, batch, submittedScore) {
      if (busy) fail('BUSY');
      busy = true; lease = null;
      try {
        if (plan.challenge.status !== 'IN_PROGRESS') fail('INITIATION_UNVERIFIED');
        const origin = binding(); unchanged(origin, plan);
        await checkOtherTransactions(); unchanged(origin, plan);
        await maintenance?.prepare?.(batch.refs);
        const evidence = await validator.verify(plan, batch, submittedScore);
        unchanged(origin, plan);
        if (evidence?.fresh !== true || !integer(evidence.observedAt) || now() < evidence.observedAt
            || now() - evidence.observedAt > 15000 || evidence.count !== batch.refs.length
            || evidence.points !== batch.refs.reduce((sum, ref) => sum + ref.points, 0)) fail('MATERIAL_CHANGED');
        lease = { origin, fingerprint: plan.fingerprint, index: batch.index,
          refs: structuredClone(batch.refs), submittedScore, at: evidence.observedAt,
          timesCompleted: integer(evidence.timesCompleted) ? evidence.timesCompleted : null };
        return true;
      } finally { busy = false; }
    },
    async contribute(plan, batch) {
      if (busy) fail('BUSY');
      const approved = lease; lease = null;
      if (!approved || approved.fingerprint !== plan.fingerprint || approved.index !== batch.index
          || !same(approved.refs, batch.refs)) fail('VALIDATION_REQUIRED');
      busy = true; let sent = false;
      const assert = () => {
        unchanged(approved.origin, plan);
        if (!sent && (now() < approved.at || now() - approved.at > 15000)) fail('VALIDATION_EXPIRED');
      };
      try {
        assert();
        if (canWrite() !== true) fail('WRITE_CONTRACT_UNVERIFIED');
        const transport = await createTransport(root, { canWrite, assertCurrent: assert });
        const reply = await transport.request('contribute', { challengeId: plan.challenge.id,
          itemIds: batch.refs.map(ref => ref.id) }, async () => {
          assert();
          await checkOtherTransactions(); assert();
          const record = validateStreamlinedJournal(await journal.read(plan.context), plan.context);
          if (record.plan.fingerprint !== plan.fingerprint || record.submittedScore !== approved.submittedScore
              || !same(record.batches[batch.index], batch) || batch.state !== 'pending' || batch.receipt) fail('JOURNAL_CHANGED');
          assert(); await maintenance?.dirty?.(); assert(); sent = true;
        });
        return normalizeStreamlinedContributionReply(reply, { setId: plan.challenge.setId,
          challengeId: plan.challenge.id, previousScore: approved.submittedScore, itemIds: batch.refs.map(ref => ref.id),
          previousTimesCompleted: approved.timesCompleted });
      } catch (error) {
        // We know no request was handed to the transport yet. Do not leave a
        // pre-dispatch policy/cache/storage failure as an ambiguous consumption.
        if (!sent) return { status: 'rejected', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message)
          ? error.message : 'FC27_STREAMLINED_DISPATCH_BLOCKED' };
        throw error;
      } finally { busy = false; }
    },
    reconcile(record, batch) { lease = null; return reconciler.reconcile(record, batch); },
    async finalize(record, batch, evidence) {
      if (!maintenance) return true;
      if (await maintenance.apply(record, batch, evidence) !== true) fail('FINALIZATION_REQUIRED');
      return true;
    },
  });
}
