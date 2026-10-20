import { createFc27StreamlinedValidator } from './fc27-streamlined-validation.js';
import { createFc27StreamlinedProgressReader } from './fc27-streamlined-progress.js';
import { createFc27StreamlinedContributionTransport } from './fc27-streamlined-contribution.js';
import { createFc27StreamlinedReconciler } from './fc27-streamlined-reconciliation.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge, assertFc27StreamlinedPolicy } from './fc27-streamlined-read.js';
import { readFc27Context } from './fc27-local-read.js';
import { normalizeStreamlinedContributionReply } from '../../streamlined/contribution.js';
import { validateStreamlinedJournal } from '../../streamlined/journal.js';
import { integer, same, fail } from '../../streamlined/contract.js';
import { createFc27StreamlinedMaterializer } from './fc27-streamlined-materialize.js';

const confirmedCooldown = new WeakMap();

// Production composition for the transaction driver.
// Callers cannot dispatch by supplying a plan alone: a fresh validation lease,
// the matching durable pending batch and explicit write capability are required.
// Initiation and reward handling remain separate capabilities.
export function createFc27StreamlinedProvider(root, { journal, canWrite = () => false, now = () => Date.now(),
  createValidator = createFc27StreamlinedValidator, createProgress = createFc27StreamlinedProgressReader,
  createTransport = createFc27StreamlinedContributionTransport, createReconciler = createFc27StreamlinedReconciler,
  createMaterializer = createFc27StreamlinedMaterializer, materializationStorage = {}, maintenance = null,
  checkOtherTransactions = async () => {}, purchaseVerifier = null, onDiagnostic = () => {} } = {}) {
  let lease = null, busy = false;
  const progress = createProgress(root, { now, onDiagnostic });
  const validator = createValidator(root, { now, readProgress: (expected, options) => progress.read(expected, options), nativeReauth: true, purchaseVerifier });
  const reconciler = createReconciler(root, { now, nativeReauth: true,
    createProgress: (root, options) => createProgress(root, { ...options, onDiagnostic }) });
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
    assertFc27StreamlinedPolicy(root, plan.policy, plan.items);
    if (plan.challenge.endTime > 0 && plan.challenge.endTime * 1000 <= now()) fail('CHALLENGE_EXPIRED');
  };
  return Object.freeze({
    capabilities: Object.freeze({ get contributionVerified() { return canWrite() === true; } }),
    async verify(plan, batch, submittedScore, { onProgress = () => {}, stopped = () => false } = {}) {
      if (busy) fail('BUSY');
      busy = true; lease = null;
      try {
        if (plan.challenge.status !== 'IN_PROGRESS') fail('INITIATION_UNVERIFIED');
        const origin = binding(); unchanged(origin, plan);
        const prior = await journal?.read?.(plan.context), recent = confirmedCooldown.get(root), at = now();
        const times = [same(recent?.context, plan.context) ? recent.at : null,
          same(prior?.context, plan.context) && prior.batches.some(row => row.state === 'confirmed') ? prior.updatedAt : null]
          .filter(time => integer(time) && time <= at);
        const waitMs = times.length ? Math.max(0, Math.max(...times) + 3000 - at) : 0;
        if (waitMs > 0) {
          try { onProgress({ phase: 'batch-cooldown', waitMs, submittedScore, targetScore: plan.challenge.targetScore }); } catch { /* Display only. */ }
          const check = () => { unchanged(origin, plan); if (stopped()) fail('CANCELLED'); };
          check();
          await new Promise((resolve, reject) => {
            let timer, poll;
            const finish = error => { clearTimeout(timer); clearInterval(poll); if (error) reject(error); else resolve(); };
            poll = setInterval(() => { try { check(); } catch (error) { finish(error); } }, 100);
            timer = setTimeout(() => { try { check(); finish(); } catch (error) { finish(error); } }, waitMs);
          });
          unchanged(origin, plan);
        }
        await checkOtherTransactions(plan, batch); unchanged(origin, plan);
        await maintenance?.prepare?.(batch.refs);
        if (batch.refs.some(ref => ['unassigned', 'transfer'].includes(ref.pile))) {
          if (canWrite() !== true) fail('WRITE_CONTRACT_UNVERIFIED');
          const materializer = await createMaterializer(root, { canWrite, plan, ...materializationStorage,
            assertCurrent: () => { unchanged(origin, plan); if (stopped()) fail('CANCELLED'); },
            onProgress: progressEvent => {
              // Keep the materialization phase visible to the same transaction
              // progress stream as validation/contribution. The score is the
              // score before this batch, since moving a card cannot award SBC
              // points by itself.
              try { onProgress({ ...progressEvent, submittedScore }); } catch { /* display only */ }
            } });
          await materializer.prepare(batch.refs);
          unchanged(origin, plan);
        }
        const evidence = await validator.verify(plan, batch, submittedScore, {
          onProgress: row => onProgress({ ...row, submittedScore, targetScore: plan.challenge.targetScore }), stopped });
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
          await checkOtherTransactions(plan, batch); assert();
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
      if (maintenance && await maintenance.apply(record, batch, evidence) !== true) fail('FINALIZATION_REQUIRED');
      confirmedCooldown.set(root, { context: record.context, at: now() });
      return true;
    },
  });
}
