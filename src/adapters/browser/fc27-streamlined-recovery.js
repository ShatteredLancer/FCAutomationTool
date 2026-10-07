import { readFc27Context } from '../ea/fc27-local-read.js';
import { createFc27StreamlinedPersistence } from './fc27-streamlined-persistence.js';
import { createFc27StreamlinedReconciler } from '../ea/fc27-streamlined-reconciliation.js';
import { createFc27StreamlinedCache } from '../ea/fc27-streamlined-cache.js';
import { createStreamlinedTransaction } from '../../streamlined/transaction.js';

// Login recovery is read-only at EA. No writer, initiation, purchase or reward
// claim exists in this composition. It also works after EA locks the completed
// work area. Exact absence plus the durable receipt and fresh score are required.
export async function recoverFc27Streamlined(root, { get, set, lockManager, now = () => Date.now(),
  createPersistence = createFc27StreamlinedPersistence, createReconciler = createFc27StreamlinedReconciler,
  createCache = createFc27StreamlinedCache } = {}) {
  try {
    const context = readFc27Context(root);
    const persistence = createPersistence({ context, get, set, lockManager, now, readContext: () => readFc27Context(root) });
    const record = await persistence.journal.read(context);
    if (!record?.batches.some(batch => ['pending', 'unknown'].includes(batch.state))) return { status: 'absent' };
    const reconciler = createReconciler(root, { now, nativeReauth: true, requirePage: false });
    const cache = await createCache(root, { now });
    const transaction = createStreamlinedTransaction({ ...persistence, now, adapter: {
      reconcile: (record, batch) => reconciler.reconcile(record, batch),
      finalize: (record, batch, evidence) => cache.apply(record, batch, evidence),
    } });
    const result = await transaction.recover(context);
    return { status: result.status, reason: result.reason, setId: record.plan.challenge.setId,
      challengeId: record.plan.challenge.id, currentScore: result.record?.submittedScore,
      targetScore: record.plan.challenge.targetScore };
  } catch (error) {
    return { status: 'recovery-required', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message)
      ? error.message : 'FC27_STREAMLINED_RECOVERY_UNCONFIRMED' };
  }
}
