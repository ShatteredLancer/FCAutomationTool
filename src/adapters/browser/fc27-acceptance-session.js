import { readFc27Context } from '../ea/fc27-local-read.js';
import { createFc27TraditionalProvider } from '../ea/fc27-traditional-provider.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';
import { createTraditionalTransaction } from '../../fc27/traditional-transaction.js';
import { traditionalJournalScope, isTerminalTraditionalJournal, assessTraditionalRecovery } from '../../fc27/traditional-journal.js';

const blocked = reason => ({ status: 'blocked', reason });
const safeReason = error => /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_ACCEPTANCE_UNCONFIRMED';

// Kept in the userscript sandbox. No page-global command, permit or GM bridge.
export function createFc27AcceptanceSession({ root, gmGetValue, gmSetValue, lockManager, liveEnabled = false }) {
  const context = readFc27Context(root);
  const scope = traditionalJournalScope(context);
  const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
  let prepared = null;
  let recovery = null;
  let armed = false;
  let busy = false;
  const unchanged = () => {
    if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error('FC27_TRANSACTION_CONTEXT_CHANGED');
  };
  const provider = () => createFc27TraditionalProvider(root, { canWrite: () => {
    unchanged(); return liveEnabled === true && armed && persistence.inspect().active;
  } });
  const run = async task => {
    if (busy) return blocked('FC27_ATTEMPT_BUSY');
    busy = true;
    try { unchanged(); return await task(); }
    catch (error) { return blocked(safeReason(error)); }
    finally { busy = false; armed = false; }
  };
  const inspect = async () => persistence.exclusive(scope, async () => {
    const record = await persistence.journal.read(scope);
    recovery = null;
    if (!record || isTerminalTraditionalJournal(record)) return { status: 'idle', phase: record?.phase ?? null };
    const adapter = await provider();
    try {
      const evidence = await adapter.observeRecovery(record);
      const outcome = assessTraditionalRecovery(scope, record, evidence);
      if (['abandoned', 'completed'].includes(outcome)) recovery = { record, outcome };
      return { status: recovery ? 'recoverable' : 'blocked', reason: recovery ? 'FC27_RECOVERY_CONFIRMATION_REQUIRED' : 'FC27_RECOVERY_REQUIRED',
        phase: record.phase, outcome, submitted: record.submitted, setId: record.setId, challengeId: record.challengeId,
        selectedCount: record.itemRefs.length, presentCount: evidence.present.length, packCount: evidence.packCount };
    } finally { adapter.cancel(); }
  });
  return Object.freeze({
    prepare: options => run(async () => {
      prepared?.adapter.cancel(); prepared = null;
      return await persistence.exclusive(scope, async () => {
        const record = await persistence.journal.read(scope);
        if (record && !isTerminalTraditionalJournal(record)) return blocked('FC27_RECOVERY_REQUIRED');
        const adapter = await provider();
        try {
          const input = await adapter.prepareInputs(options);
          if (input.contract.challenge.brickIndices.length) return blocked('FC27_ACCEPTANCE_BRICKS_UNSUPPORTED');
          const engine = createTraditionalTransaction({ enabled: liveEnabled, adapter, ...persistence,
            createOperationId: () => root.crypto.randomUUID() });
          const plan = engine.prepare(input);
          if (plan.status !== 'prepared') { adapter.cancel(); return plan; }
          // Read-only verification is identical to the transaction's entire selected squad query.
          const exact = await adapter.validateItems(plan);
          if (exact.items.length !== plan.selected.length || !plan.selected.every(item => exact.items.some(current =>
            current.id === item.id && current.definitionId === item.definitionId
            && Object.keys(item).filter(key => key !== 'slot').every(key => item[key] === current[key])))) {
            adapter.cancel(); return blocked('FC27_EXACT_ITEMS_CHANGED');
          }
          const baseline = await adapter.readRewardBaseline(plan);
          unchanged(); prepared = { engine, plan, adapter };
          return { status: 'prepared', liveEnabled: liveEnabled === true, setId: plan.set.id, challengeId: plan.challenge.id,
            setName: plan.set.name, maxRating: plan.policy.maxRating, selectedCount: plan.selected.length,
            ratings: plan.selected.map(item => item.rating), packId: baseline.packId, packCount: baseline.count };
        } catch (error) { adapter.cancel(); throw error; }
      }) ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
    }),
    execute: approval => run(async () => {
      if (!prepared || liveEnabled !== true) return blocked('FC27_LIVE_DISABLED');
      const current = prepared; prepared = null;
      const result = current.engine.approve(current.plan, approval);
      if (result.status !== 'approved') { current.adapter.cancel(); return result; }
      armed = true;
      return current.engine.execute(result.permit);
    }),
    inspectRecovery: () => run(async () => await inspect() ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE')),
    resolveRecovery: approved => run(async () => {
      if (approved !== true || !recovery) return blocked('FC27_RECOVERY_APPROVAL_INVALID');
      const expected = recovery; recovery = null;
      return await persistence.exclusive(scope, async () => {
        const record = await persistence.journal.read(scope);
        if (JSON.stringify(record) !== JSON.stringify(expected.record)) return blocked('FC27_RECOVERY_REQUIRED');
        const adapter = await provider();
        try {
          const evidence = await adapter.observeRecovery(record);
          unchanged();
          if (expected.outcome === 'completed') {
            if (assessTraditionalRecovery(scope, record, evidence) !== 'completed') return blocked('FC27_RECOVERY_REQUIRED');
            await adapter.reconcileRecoveredCache(record, evidence);
          }
          return await persistence.journal.resolve(scope, record, evidence,
            { approved: true, operationId: record.operationId, outcome: expected.outcome });
        } finally { adapter.cancel(); }
      }) ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
    }),
  });
}

export async function checkFc27GmInstallation({ gmGetValue, gmSetValue, lockManager, hold = false }) {
  // Deliberately synthetic and disjoint from every real EA account journal.
  const context = { season: '27', accountScope: 'acceptance-self-test', platform: 'local' };
  const scope = traditionalJournalScope(context);
  const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
  const result = await persistence.exclusive(scope, async () => {
    const previous = await persistence.journal.read(scope);
    if (!previous) await persistence.journal.write(scope, { schema: 2, scope, operationId: 'installation-probe',
      setId: 1, challengeId: 1, itemRefs: [{ id: 1, definitionId: 1, pile: 'club' }],
      reward: { scope: 'set', type: 'pack', value: 1, count: 1, tradable: false }, rewardBaselineCount: 0,
      phase: 'save-pending', updatedAt: Date.now(), submitted: false, setTimesCompleted: 0 });
    if (hold === true) await new Promise(resolve => setTimeout(resolve, 4000));
    const record = await persistence.journal.read(scope);
    return { status: 'verified', persistedPreviously: !!previous, phase: record.phase, synthetic: true, eaRequests: 0 };
  });
  return result ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
}
