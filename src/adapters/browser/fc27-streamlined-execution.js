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
import { createStreamlinedPurchaseJournal, verifyStreamlinedPurchasedItem, streamlinedPurchaseNeedsRecovery,
  streamlinedPurchaseAudit, canRetireStreamlinedPurchase } from '../../streamlined/purchase-journal.js';
import { createFc27StreamlinedPurchaseAdapter } from '../ea/fc27-streamlined-purchase.js';
import { createStreamlinedProcurement } from '../../streamlined/procurement.js';
import { createFc27StreamlinedMaterializationRecovery } from '../ea/fc27-streamlined-materialize.js';
import { createStreamlinedMaterializationJournal } from '../../streamlined/materialization-journal.js';
import { assertStreamlinedRecoveryIsolation, isStreamlinedStockPlan, streamlinedPurchaseContributionPlan } from '../../streamlined/recovery-isolation.js';
import { projectStreamlinedPurchaseHandoff } from '../../streamlined/purchase-handoff.js';
import { isUnsentStreamlinedJournal } from '../../streamlined/journal.js';

export async function assertStreamlinedOtherTransactions(get, context) {
  const scope = traditionalJournalScope(context), raw = await get(scope, null);
  if (raw !== null && !isTerminalTraditionalJournal(normalizeTraditionalJournal(scope, raw))) throw Error('FC27_RECOVERY_REQUIRED');
  await assertPuzzleBuyTargetAvailable(get, scope, null, context);
  if (await get(galleryPurchasePendingKey(scope), null) !== null) throw Error('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
  await assertGalleryRelistSettled(get, scope);
}

export async function createFc27StreamlinedExecution(root, { context, plan = null, get, set, lockManager, prices = null,
  canWrite = () => false, diagnosticLog = null, now = () => Date.now(), createMaintenance = createFc27StreamlinedPageMaintenance,
  createProvider = createFc27StreamlinedProvider, createPurchaseAdapter = createFc27StreamlinedPurchaseAdapter } = {}) {
  await maintainFc27PuzzlePurchases(root, { get, set });
  await assertStreamlinedOtherTransactions(get, context);
  if (!same(readFc27Context(root), context)) fail('CONTEXT_CHANGED');
  const persistence = createFc27StreamlinedPersistence({ context, get, set, lockManager,
    readContext: () => readFc27Context(root), now,
    isArchivedContribution: record => marketJournal.isRetiredContribution(record),
    beforeBegin: plan => marketJournal.assertPlanAvailable(plan),
    beforeReplace: async previous => {
      const saved = await marketJournal.read(context);
      if (saved && await marketJournal.isRetired(saved)) return;
      const settled = projectStreamlinedPurchaseHandoff(saved, previous);
      if (settled) await marketJournal.write(settled, saved.revision);
    } });
  const materializationStorage = { get, set: async (key, value) => {
    persistence.assertHeld();
    await set(key, value);
    persistence.assertHeld();
  } };
  const materializationJournal = createStreamlinedMaterializationJournal({ context, ...materializationStorage,
    assertCurrent: () => { if (!same(readFc27Context(root), context)) fail('CONTEXT_CHANGED'); } });
  const marketJournal = createStreamlinedPurchaseJournal({ get, set, assertHeld: persistence.assertHeld });
  const checkOtherTransactions = async (plan, batch) => {
    await assertStreamlinedOtherTransactions(get, context);
    await materializationJournal.assertSettled();
    await marketJournal.assertAvailable(context, plan.challenge, batch.refs);
    const saved = await marketJournal.read(context);
    if (saved && !await marketJournal.isRetired(saved)
        && (!activeProcurement || streamlinedPurchaseContributionPlan(saved)?.fingerprint !== plan.fingerprint)) {
      assertStreamlinedRecoveryIsolation(plan, batch.refs, saved);
    }
  };
  const maintenance = await createMaintenance(root, { now });
  const purchaseVerifier = async (item, proof, currentPlan = plan) => verifyStreamlinedPurchasedItem(get, context,
    { ...item, purchaseReceipt: proof },
    { id: currentPlan?.challenge?.id ?? 0, setId: currentPlan?.challenge?.setId ?? 0, targetScore: currentPlan?.challenge?.targetScore ?? 0 });
  let marketPurchase = null;
  let activeProcurement = null;
  let historyToArchive = null;
  const adapter = createProvider(root, { journal: persistence.journal, canWrite, now, maintenance,
    materializationStorage,
    checkOtherTransactions, purchaseVerifier });
  const contributionDiagnostic = row => {
    try { Promise.resolve(diagnosticLog?.record?.({ area: 'streamlined', event: 'contribution-transaction',
      phase: `contribution-${row.phase}`, status: row.status, reason: row.reason,
      localReason: row.localReason, attempt: row.attempt, attemptLimit: row.attemptLimit,
      methodPath: row.methodPath, observedHash: row.observedHash, expectedHash: row.expectedHash,
      mismatch: row.mismatch, cycleCountBefore: row.cycleCountBefore, cycleCountAfter: row.cycleCountAfter,
      httpStatus: row.httpStatus, count: row.count, currentScore: row.currentScore, targetScore: row.targetScore })).catch(() => {}); }
    catch { /* Diagnostic only. */ }
  };
  const transaction = createStreamlinedTransaction({ adapter, ...persistence, now, onDiagnostic: contributionDiagnostic });
  const createMarket = async plan => {
    if (!plan?.route?.groups?.some(group => group.source === 'market')) return null;
    await materializationJournal.assertSettled();
    const contribution = { adapter, journal: persistence.journal };
    const native = await createPurchaseAdapter(root, { plan, persistence, canWrite, get, set, now, prices, contributionAdapter: contribution,
      onEvent: row => { try { Promise.resolve(diagnosticLog?.record?.({ area: 'streamlined',
        event: row.stage?.startsWith('contribution-') ? 'contribution-transaction' : 'purchase-native',
        phase: row.stage, status: row.status, currentScore: row.currentScore, targetScore: row.targetScore,
        attempt: row.attempt, attemptLimit: row.attemptLimit,
        methodPath: row.methodPath, observedHash: row.observedHash, expectedHash: row.expectedHash,
        mismatch: row.mismatch, cycleCountBefore: row.cycleCountBefore, cycleCountAfter: row.cycleCountAfter,
        definitionId: row.definitionId, maxBuy: row.maxBuy,
        referencePrice: row.stage === 'reference' ? row.price : undefined,
        actualPrice: row.stage === 'bid' ? row.price : undefined,
        requestedCount: row.requestedCount, responseCount: row.responseCount, acceptedCount: row.acceptedCount,
        foreignCount: row.foreignCount, unknownCount: row.unknownCount, offset: row.offset, reason: row.reason,
        localReason: row.localReason ?? (Number.isSafeInteger(row.errorCode) ? `FC27_NATIVE_ERROR_${row.errorCode}` : undefined),
        httpStatus: row.httpStatus, count: row.count, skippedCount: row.skippedCount })).catch(() => {}); } catch { /* diagnostic only */ } } });
    return Object.freeze({ ...native, async assertCurrent(record) {
      const current = await persistence.journal.read(context);
      if (current && current.plan.fingerprint !== streamlinedPurchaseContributionPlan(record)?.fingerprint
          && !isUnsentStreamlinedJournal(current)) {
        if (current.batches.some(batch => ['pending', 'unknown'].includes(batch.state))) fail('RECOVERY_REQUIRED');
        if (current.batches.some(batch => batch.state === 'waiting')) fail('PURCHASE_REMAINDER_RECOVERY_REQUIRED');
      }
      await native.assertCurrent(record);
    } });
  };
  return Object.freeze({ transaction, journal: persistence.journal,
    async inspectInventoryRecovery(record) {
      const release = await persistence.lock.acquire(context);
      if (typeof release !== 'function') fail('BUSY');
      try {
        if (!same(record, await persistence.journal.read(context))) fail('JOURNAL_CHANGED');
        if (record.batches.some(batch => ['pending', 'unknown'].includes(batch.state))) fail('RECOVERY_REQUIRED');
        const refs = record.batches.filter(batch => batch.state === 'waiting').flatMap(batch => batch.refs);
        if (!refs.length) fail('RECOVERY_REQUIRED');
        await marketJournal.assertAvailable(context, record.plan.challenge, refs);
        const saved = await marketJournal.read(context);
        return saved && await marketJournal.isRetired(saved) ? true : assertStreamlinedRecoveryIsolation(record.plan, refs, saved);
      } finally { await release(); }
    },
    async recoverMaterialization() {
      const release = await persistence.lock.acquire(context);
      if (typeof release !== 'function') return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
      try {
        const recovery = await createFc27StreamlinedMaterializationRecovery(root, {
          context, ...materializationStorage, assertCurrent: persistence.assertHeld,
        });
        return await recovery.recover();
      } finally { await release(); }
    },
    async recoverPurchase(challenge) {
      historyToArchive = null;
      const saved = await marketJournal.read(context);
      if (!saved || await marketJournal.isRetired(saved)) return { status: 'absent' };
      const current = await persistence.journal.read(context);
      const sameTarget = saved.challenge.setId === challenge.setId && saved.challenge.id === challenge.id;
      const independentStock = sameTarget && current && current.plan.challenge.setId === challenge.setId
        && current.plan.challenge.id === challenge.id && isStreamlinedStockPlan(current.plan)
        && streamlinedPurchaseContributionPlan(saved)?.fingerprint !== current.plan.fingerprint;
      if (!sameTarget || saved.challenge.targetScore !== challenge.targetScore || independentStock) {
        // Completion is not the settlement predicate: a stopped, fully settled
        // run can remain incomplete. Leave its history untouched. Unknown buys,
        // moves, contributions and unconsumed purchases still need recovery.
        const pending = streamlinedPurchaseNeedsRecovery(saved), audit = streamlinedPurchaseAudit(saved);
        const recovery = { kind: 'streamlined-purchase', setId: saved.challenge.setId,
          challengeId: saved.challenge.id, name: saved.challenge.name, ...audit };
        try { Promise.resolve(diagnosticLog?.record?.({ area: 'streamlined', event: 'purchase-recovery-state',
          phase: pending ? independentStock ? 'same-target-history' : 'other-target-pending' : 'settled-history', status: pending ? 'recovery-required' : 'ignored',
          setId: recovery.setId, challengeId: recovery.challengeId, ...audit })).catch(() => {}); } catch { /* diagnostic only */ }
        if (!pending) return { status: 'absent' };
        // Explicit retirement is only for another target, never an in-flight
        // buy/move or an unrelated unresolved inner contribution. A precisely
        // matching old contribution may be archived as unknown, never settled.
        let canArchive = false;
        try { canArchive = !sameTarget && canRetireStreamlinedPurchase(saved, current); }
        catch { /* Incomplete evidence must not offer retirement. */ }
        if (canArchive) historyToArchive = { saved: structuredClone(saved), current: structuredClone(current) };
        return { status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_PURCHASE_RECOVERY_REQUIRED',
          recovery, historyAction: { canArchive } };
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
    async archivePurchaseHistory(challenge) {
      if (!historyToArchive) fail('PURCHASE_RECOVERY_REQUIRED');
      const release = await persistence.lock.acquire(context);
      if (typeof release !== 'function') fail('BUSY');
      try {
        await assertStreamlinedOtherTransactions(get, context); await materializationJournal.assertSettled();
        const current = await persistence.journal.read(context), { saved, current: expected } = historyToArchive;
        if (!same(current, expected)) fail('JOURNAL_CHANGED');
        if (saved.challenge.id === challenge.id && saved.challenge.setId === challenge.setId
            || !canRetireStreamlinedPurchase(saved, current)) fail('RECOVERY_REQUIRED');
        const ownInner = current?.plan.challenge.id === saved.challenge.id && current?.plan.challenge.setId === saved.challenge.setId;
        await marketJournal.retire(saved, ownInner ? current : null); historyToArchive = null;
        return { status: 'archived', reason: 'FC27_STREAMLINED_PURCHASE_HISTORY_ARCHIVED' };
      } finally { await release(); }
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
      if (plan.items.some(item => item.source === 'inventory'
          && (!['club', 'storage', 'unassigned', 'transfer'].includes(item.pile)
            || ['unassigned', 'transfer'].includes(item.pile) && item.executionPile !== 'club'))) fail('PILE_UNVERIFIED');
      if (plan.items.some(item => item.source === 'market') && !plan.route?.groups?.some(group => group.source === 'market')) fail('PURCHASE_ROUTE_UNVERIFIED');
      maintenance.prepare(plan.items.filter(item => item.source === 'inventory'));
      return true;
    },
    stop() { activeProcurement?.stop(); transaction.stop(); },
  });
}
