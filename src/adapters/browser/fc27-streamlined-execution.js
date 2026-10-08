import { createFc27StreamlinedPersistence } from './fc27-streamlined-persistence.js';
import { createFc27StreamlinedProvider } from '../ea/fc27-streamlined-provider.js';
import { createFc27StreamlinedPageMaintenance } from '../ea/fc27-streamlined-page.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { createStreamlinedTransaction } from '../../streamlined/transaction.js';
import { fail, same } from '../../streamlined/contract.js';
import { traditionalJournalScope, normalizeTraditionalJournal, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { assertPuzzleBuyTargetAvailable } from '../../fc27/puzzle-buy-lifecycle.js';
import { maintainFc27PuzzlePurchases } from './fc27-puzzle-buy-lifecycle.js';
import { galleryPurchasePendingKey } from '../../gallery/purchase-session.js';
import { assertGalleryRelistSettled } from '../../gallery/relist-recovery.js';
import { createStreamlinedPurchaseJournal, verifyStreamlinedPurchasedItem } from '../../streamlined/purchase-journal.js';
import { createFc27StreamlinedPurchaseAdapter } from '../ea/fc27-streamlined-purchase.js';
import { createStreamlinedProcurement } from '../../streamlined/procurement.js';

export async function assertStreamlinedOtherTransactions(get, context) {
  const scope = traditionalJournalScope(context), raw = await get(scope, null);
  if (raw !== null && !isTerminalTraditionalJournal(normalizeTraditionalJournal(scope, raw))) throw Error('FC27_RECOVERY_REQUIRED');
  await assertPuzzleBuyTargetAvailable(get, scope, null, context);
  if (await get(galleryPurchasePendingKey(scope), null) !== null) throw Error('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
  await assertGalleryRelistSettled(get, scope);
}

export async function createFc27StreamlinedExecution(root, { context, plan = null, get, set, lockManager, prices = null,
  canWrite = () => false, now = () => Date.now(), createMaintenance = createFc27StreamlinedPageMaintenance,
  createProvider = createFc27StreamlinedProvider, createPurchaseAdapter = createFc27StreamlinedPurchaseAdapter } = {}) {
  await maintainFc27PuzzlePurchases(root, { get, set });
  await assertStreamlinedOtherTransactions(get, context);
  if (!same(readFc27Context(root), context)) fail('CONTEXT_CHANGED');
  const persistence = createFc27StreamlinedPersistence({ context, get, set, lockManager,
    readContext: () => readFc27Context(root), now });
  const maintenance = await createMaintenance(root, { now });
  const marketJournal = createStreamlinedPurchaseJournal({ get, set, assertHeld: persistence.assertHeld });
  const purchaseVerifier = async (item, proof, currentPlan = plan) => verifyStreamlinedPurchasedItem(get, context,
    { ...item, purchaseReceipt: proof },
    { id: currentPlan?.challenge?.id ?? 0, setId: currentPlan?.challenge?.setId ?? 0, targetScore: currentPlan?.challenge?.targetScore ?? 0 });
  let marketPurchase = null;
  let activeProcurement = null;
  const adapter = createProvider(root, { journal: persistence.journal, canWrite, now, maintenance,
    checkOtherTransactions: () => assertStreamlinedOtherTransactions(get, context), purchaseVerifier });
  const transaction = createStreamlinedTransaction({ adapter, ...persistence, now });
  const createMarket = async plan => {
    if (!plan?.route?.groups?.some(group => group.source === 'market')) return null;
    const contribution = { adapter, journal: persistence.journal };
    return createPurchaseAdapter(root, { plan, persistence, canWrite, get, set, now, prices, contributionAdapter: contribution });
  };
  return Object.freeze({ transaction, journal: persistence.journal,
    async recoverPurchase(challenge) {
      const saved = await marketJournal.read(context);
      if (!saved) return { status: 'absent' };
      if (saved.challenge.setId !== challenge.setId || saved.challenge.id !== challenge.id) {
        if (saved.completed) return { status: 'absent' };
        return { status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_PURCHASE_RECOVERY_REQUIRED',
          recovery: { setId: saved.challenge.setId, challengeId: saved.challenge.id } };
      }
      if (saved.challenge.targetScore !== challenge.targetScore) fail('CONTEXT_CHANGED');
      if (!saved.plan) fail('PURCHASE_JOURNAL_INVALID');
      if (saved.completed) return { status: 'completed', record: saved };
      marketPurchase = await createMarket(saved.plan);
      if (!marketPurchase) fail('PURCHASE_ROUTE_UNVERIFIED');
      const driver = createStreamlinedProcurement({ journal: marketJournal, lock: persistence.lock, adapter: marketPurchase, now });
      // No fabricated approval: this path can only reconcile an existing
      // journal, persisting evidence locally without buy/move/contribution.
      activeProcurement = driver;
      try { return await driver.execute(saved.plan, null, { reconcileOnly: true }); }
      finally { activeProcurement = null; }
    },
    async purchase(plan, approval = {}, callbacks = {}) {
      // A purchase adapter owns request cancellation state. Recreate it for
      // every run so a stopped/recovered buyer cannot leak its closed state.
      marketPurchase = await createMarket(plan);
      if (!marketPurchase) fail('PURCHASE_ROUTE_UNVERIFIED');
      const runPlan = { ...plan, route: plan.route ?? { groups: [] } };
      const driver = createStreamlinedProcurement({ journal: marketJournal, lock: persistence.lock,
        adapter: marketPurchase, operationId: () => root.crypto.randomUUID(), now });
      activeProcurement = driver;
      try {
      return await driver.execute(runPlan, { ...approval,
          budget: approval.budget ?? runPlan.route.groups.filter(group => group.source === 'market').reduce((sum, group) => sum
            + group.quantity * Math.max(...group.items.map(item => item.purchaseMaxBuy ?? item.price)), 0),
          attempts: runPlan.execution?.purchaseAttempts ?? 3,
          idleMs: runPlan.execution?.partialWaitMs ?? 60000,
          expiresAt: approval.expiresAt ?? now() + 600000 }, callbacks);
      } finally { activeProcurement = null; }
    },
    prepare(plan) {
      if (canWrite() !== true) fail('WRITE_CONTRACT_UNVERIFIED');
      if (!persistence.inspect().supported) fail('EXCLUSIVE_ACCESS_REQUIRED');
      if (plan.challenge.status !== 'IN_PROGRESS') fail('INITIATION_UNVERIFIED');
      if (plan.items.some(item => item.source === 'inventory' && !['club', 'storage'].includes(item.pile))) fail('PILE_UNVERIFIED');
      if (plan.items.some(item => item.source === 'market') && !plan.route?.groups?.some(group => group.source === 'market')) fail('PURCHASE_ROUTE_UNVERIFIED');
      maintenance.prepare(plan.items.filter(item => item.source === 'inventory'));
      return true;
    },
    stop() { activeProcurement?.stop(); transaction.stop(); },
  });
}
