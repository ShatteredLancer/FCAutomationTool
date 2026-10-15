import { assertStreamlinedPlan } from './plan.js';
import { same, integer, fail } from './contract.js';
import { projectStreamlinedReceipt } from './contribution.js';
import { isUnsentStreamlinedJournal } from './journal.js';

// Adapter-neutral transaction driver. The production composition supplies a
// separately guarded writer; a read-only preview never grants approval.
export function createStreamlinedTransaction({ adapter, journal, lock, now = () => Date.now(), onDiagnostic = () => {} }) {
  let running = false, stopping = false;
  const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_TRANSACTION_UNCONFIRMED';
  const responseReason = reason => ['EA_CONTRIBUTION_RESPONSE_CONFLICT', 'EA_CONTRIBUTION_RESPONSE_UNVERIFIED',
    'EA_SQUAD_CONFLICT', 'EA_CONTRIBUTION_REJECTED'].includes(reason) ? `FC27_STREAMLINED_${reason}` : safeReason({ message: reason });
  const failureDetail = error => {
    const detail = { reason: safeReason(error) };
    if (typeof error?.methodPath === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,159}$/.test(error.methodPath)) detail.methodPath = error.methodPath;
    if (typeof error?.observedHash === 'string' && (/^[a-f0-9]{64}$/.test(error.observedHash) || error.observedHash === 'oversized')) detail.observedHash = error.observedHash;
    if (typeof error?.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(error.expectedHash)) detail.expectedHash = error.expectedHash;
    return detail;
  };
  const diagnose = (phase, status, record, batch, detail = {}) => {
    // Fixed stages, codes and arithmetic only. Never pass plans, receipts,
    // physical identities or arbitrary exception text to the diagnostic sink.
    try { Promise.resolve(onDiagnostic({ phase, status, count: batch?.refs?.length,
      currentScore: record?.submittedScore, targetScore: record?.plan?.challenge?.targetScore,
      ...(typeof detail === 'function' ? detail() : detail) })).catch(() => {}); } catch { /* Diagnostic failures do not affect transactions. */ }
  };
  const observe = async (record, batch) => {
    let phase = 'readback', confirmed;
    try {
      const evidence = await adapter.reconcile(record, batch);
      const receipt = batch.receipt;
      // A repeated Challenge can reset to zero after granting its award. Only
      // independently verified cycle change plus our durable receipt supports
      // this case; a zero cache/page score alone proves nothing.
      const reset = receipt?.challengeCompleted === true && receipt.submittedScore >= record.plan.challenge.targetScore
        && evidence?.cycleResetConfirmed === true && evidence.submittedScore === 0;
      const submittedScore = reset ? receipt.submittedScore : evidence?.submittedScore;
      if (evidence?.fresh !== true || !same(evidence.context, record.context)
          || evidence.setId !== record.plan.challenge.setId || evidence.challengeId !== record.plan.challenge.id
          || !integer(evidence.observedAt) || now() < evidence.observedAt || now() - evidence.observedAt > 15000
          || !Array.isArray(evidence.absent) || !same(evidence.absent, batch.refs)
          || !integer(submittedScore) || submittedScore <= record.submittedScore
          || submittedScore > record.submittedScore + batch.refs.reduce((sum, ref) => sum + ref.points, 0)
          || receipt && receipt.submittedScore !== submittedScore
          || evidence.operationConfirmed !== true) fail('RECONCILIATION_REQUIRED');
      confirmed = { ...evidence, submittedScore, finalizationReason: null };
      // Cache/page maintenance follows authoritative readback, never precedes it.
      // A failed finalizer leaves the durable receipt recoverable and prevents
      // another batch. Recovery repeats only idempotent local maintenance.
      diagnose('readback', 'verified', record, batch, { currentScore: submittedScore });
      phase = 'finalization';
      if (typeof adapter.finalize === 'function' && await adapter.finalize(record, batch, confirmed) !== true) fail('FINALIZATION_REQUIRED');
      return confirmed;
    } catch (error) {
      diagnose(phase, 'blocked', record, batch, () => ({ ...failureDetail(error),
        ...(confirmed ? { currentScore: confirmed.submittedScore } : {}) }));
      if (phase === 'finalization') return { ...confirmed, finalizationReason: safeReason(error) };
      throw error;
    }
  };
  const finalizationPending = (record, evidence) => ({
    status: 'recovery-required', reason: evidence.finalizationReason, record,
    // Display-only verified progress. The durable batch stays unknown until
    // local maintenance/checkpoint completes; this never authorizes more work.
    confirmation: { submittedScore: evidence.submittedScore, targetScore: record.plan.challenge.targetScore,
      completed: evidence.submittedScore >= record.plan.challenge.targetScore, finalizationPending: true },
  });
  const execute = async (plan, approval, { onProgress = () => {} } = {}) => {
    if (running) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
    running = true; stopping = false;
    let release, record, activeBatch, phase = 'preflight';
    const report = (phase, index) => { try { onProgress({ phase, index, total: approval.batchIndices.length,
      submittedScore: record?.submittedScore ?? plan.challenge.submittedScore }); } catch { /* display only */ } };
    try {
      assertStreamlinedPlan(plan);
      if (adapter?.capabilities?.contributionVerified !== true) fail('WRITE_CONTRACT_UNVERIFIED');
      if (approval?.approved !== true || approval.fingerprint !== plan.fingerprint
          || !Array.isArray(approval.batchIndices) || !approval.batchIndices.length
          || new Set(approval.batchIndices).size !== approval.batchIndices.length
          || approval.batchIndices.some((i, n) => !integer(i, 0, plan.batches.length - 1) || n && i <= approval.batchIndices[n - 1])
          || plan.status === 'partial' && approval.allowPartial !== true) fail('APPROVAL_REQUIRED');
      release = await lock.acquire(plan.context);
      if (typeof release !== 'function') fail('BUSY');
      record = await journal.read(plan.context);
      if (!record || record.plan.fingerprint !== plan.fingerprint
          && (isUnsentStreamlinedJournal(record) || record.batches.every(b => ['confirmed', 'rejected'].includes(b.state)))) record = await journal.begin(plan);
      if (record.plan.fingerprint !== plan.fingerprint) fail('RECOVERY_REQUIRED');
      if (record.batches.some(b => ['pending', 'unknown'].includes(b.state))) fail('RECOVERY_REQUIRED');
      if (record.batches.some(b => b.progressChanged) && record.submittedScore < plan.challenge.targetScore) fail('PROGRESS_CHANGED');
      for (const index of approval.batchIndices) {
        let batch = record.batches[index];
        activeBatch = batch;
        if (batch.state === 'confirmed') continue;
        if (batch.state !== 'waiting') fail('REPLAN_REQUIRED');
        if (stopping || record.submittedScore >= plan.challenge.targetScore) break;
        // verify must check exact current entities, guards, native rules, account,
        // expiry and progress after every batch. No save-squad operation exists.
        phase = 'validation';
        report('validation', index);
        if (await adapter.verify(plan, batch, record.submittedScore, {
          stopped: () => stopping, onProgress: row => { try { onProgress({ ...row, index, total: approval.batchIndices.length }); } catch { /* display only */ } },
        }) !== true) fail('MATERIAL_CHANGED');
        if (stopping) break;
        phase = 'checkpoint';
        record.batches[index].state = 'pending';
        record.batches[index].startingScore = record.submittedScore;
        record = await journal.write(plan.context, record, record.revision);
        batch = record.batches[index];
        let reply;
        report('contribution', index);
        phase = 'dispatch';
        try { reply = await adapter.contribute(plan, batch); }
        catch (error) {
          diagnose('dispatch', 'unknown', record, batch, () => failureDetail(error));
          reply = { status: 'unknown' };
        }
        diagnose('response', 'unknown', record, batch, () => ({
          status: ['accepted', 'rejected', 'unknown'].includes(reply?.status) ? reply.status : 'unknown',
          ...(integer(reply?.code, 100, 599) ? { httpStatus: reply.code } : {}),
          ...(reply?.reason ? { reason: responseReason(reply.reason) } : {}),
        }));
        if (reply?.status === 'rejected') {
          record.batches[index].state = 'rejected';
          record = await journal.write(plan.context, record, record.revision);
          return { status: 'rejected', reason: reply.reason, record };
        }
        // Save the accepted receipt before any readback which can time out.
        // Restart recovery can then distinguish a completed/reset cycle from
        // an uncommitted request. Persistence failure leaves pending, never retries.
        phase = 'receipt';
        if (reply?.status === 'accepted' && reply.schema !== undefined) {
          try {
            record.batches[index].receipt = projectStreamlinedReceipt(reply, {
              setId: plan.challenge.setId, challengeId: plan.challenge.id, previousScore: record.submittedScore,
              maxScore: record.submittedScore + batch.refs.reduce((sum, ref) => sum + ref.points, 0),
              itemIds: batch.refs.map(ref => ref.id) });
          } catch {
            diagnose('receipt', 'invalid', record, batch, { reason: 'FC27_STREAMLINED_RECEIPT_INVALID' });
            record.batches[index].state = 'unknown';
            record = await journal.write(plan.context, record, record.revision);
            return { status: 'recovery-required', reason: 'FC27_STREAMLINED_RECEIPT_INVALID', record };
          }
          diagnose('receipt', 'verified', record, batch, { httpStatus: record.batches[index].receipt.code });
          phase = 'checkpoint';
          record = await journal.write(plan.context, record, record.revision);
          batch = record.batches[index];
        }
        // Stop is deferred until this contribution's reconcile/writeback ends.
        phase = 'readback';
        try {
          report('reconciliation', index);
          const evidence = await observe(record, batch);
          if (evidence.finalizationReason) {
            record.batches[index].state = 'unknown';
            record = await journal.write(plan.context, record, record.revision);
            return finalizationPending(record, evidence);
          }
          const expected = record.submittedScore + batch.refs.reduce((sum, ref) => sum + ref.points, 0);
          record.batches[index].state = 'confirmed';
          record.batches[index].progressChanged = evidence.submittedScore !== expected;
          record.submittedScore = evidence.submittedScore;
          record.rewardState = evidence.rewardConfirmed === true ? 'confirmed' : 'unknown';
        } catch (error) {
          record.batches[index].state = 'unknown';
          record = await journal.write(plan.context, record, record.revision);
          return { status: 'recovery-required', reason: safeReason(error), record };
        }
        phase = 'checkpoint';
        record = await journal.write(plan.context, record, record.revision);
        report('confirmed', index);
        if (record.batches[index].progressChanged && record.submittedScore < plan.challenge.targetScore) {
          return { status: 'replan-required', reason: 'FC27_STREAMLINED_PROGRESS_CHANGED', record };
        }
      }
      return { status: stopping ? 'stopped' : record.submittedScore >= plan.challenge.targetScore ? 'completed' : 'partial', record };
    } catch (error) {
      diagnose(phase, 'blocked', record, activeBatch, () => failureDetail(error));
      return { status: 'blocked', reason: safeReason(error) };
    }
    finally { try { await release?.(); } finally { running = false; } }
  };
  const recover = async (context, target = null) => {
    if (running) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
    running = true; let release, record, batch;
    try {
      release = await lock.acquire(context);
      if (typeof release !== 'function') fail('BUSY');
      record = await journal.read(context);
      if (!record) return { status: 'absent' };
      if (target && (record.plan.challenge.setId !== target.setId || record.plan.challenge.id !== target.challengeId)) {
        // A page-local recovery must not reconcile or display another SBC's
        // account-wide journal. Login recovery has no target and can reconcile
        // that record with its own page-independent adapter.
        if (isUnsentStreamlinedJournal(record) || record.batches.every(b => ['confirmed', 'rejected'].includes(b.state))) {
          return { status: 'absent' };
        }
        return { status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED',
          recovery: { setId: record.plan.challenge.setId, challengeId: record.plan.challenge.id } };
      }
      batch = record.batches.find(b => ['pending', 'unknown'].includes(b.state));
      if (!batch) return { status: 'observed', record };
      const evidence = await observe(record, batch);
      if (evidence.finalizationReason) return finalizationPending(record, evidence);
      batch.progressChanged = evidence.submittedScore !== record.submittedScore + batch.refs.reduce((sum, ref) => sum + ref.points, 0);
      batch.state = 'confirmed'; record.submittedScore = evidence.submittedScore;
      if (batch.progressChanged && record.submittedScore < record.plan.challenge.targetScore) {
        const saved = await journal.write(context, record, record.revision);
        return { status: 'replan-required', reason: 'FC27_STREAMLINED_PROGRESS_CHANGED', record: saved };
      }
      record.rewardState = evidence.rewardConfirmed === true ? 'confirmed' : 'unknown';
      return { status: 'recovered', record: await journal.write(context, record, record.revision) };
    } catch (error) {
      diagnose('recovery', 'recovery-required', record, batch, () => failureDetail(error));
      return { status: 'recovery-required', reason: safeReason(error) };
    }
    finally { try { await release?.(); } finally { running = false; } }
  };
  return Object.freeze({ execute, recover, stop: () => { stopping = true; } });
}
