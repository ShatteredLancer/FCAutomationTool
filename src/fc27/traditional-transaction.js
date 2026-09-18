import { createSeasonContext, contextKey } from './prelaunch-contract.js';
import { previewTraditionalSquad } from './traditional-preview.js';
import { isTerminalTraditionalJournal, normalizeTraditionalJournal } from './traditional-journal.js';
import { submitSbcAttempt } from '../sbc/submit-attempt.js';

const lifetime = 60000;
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const fail = reason => { throw new Error(reason); };
const blocked = reason => ({ status: 'blocked', reason, submitted: false, recoveryRequired: false });
const clone = value => globalThis.structuredClone(value);
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const refs = items => items.map(item => pick(item, ['id', 'definitionId', 'pile']));
const safetyKeys = ['id', 'definitionId', 'type', 'pile', 'rating', 'rarity', 'special', 'evolution', 'cosmetic',
  'concept', 'academyEnrolled', 'tradeable', 'loans', 'limitedUse', 'leagueId', 'state', 'activeTrade',
  'locked', 'activeSquad', 'protected'];
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function scopeMatches(left, right) {
  try { return same(createSeasonContext(left), createSeasonContext(right)); } catch { return false; }
}
function validReward(reward) {
  return ['set', 'challenge'].includes(reward?.scope) && reward.type === 'pack' && positive(reward.value)
    && positive(reward.count) && reward.count <= 10 && typeof reward.tradable === 'boolean';
}
function facts(contract, policy, now) {
  if (!nonnegative(now)) return fail('FC27_ATTEMPT_TIME_UNVERIFIED');
  const context = createSeasonContext(contract?.context);
  if (context.season !== '27' || contract.schema !== 1 || contract.source !== 'fresh-dao'
      || !nonnegative(contract.observedAt) || now < contract.observedAt || now - contract.observedAt > lifetime
      || !scopeMatches(context, contract.challenge?.context) || !scopeMatches(context, policy?.context)) {
    return fail('FC27_ATTEMPT_CONTEXT_UNVERIFIED');
  }
  const set = pick(contract.set, ['id', 'name', 'challengesCount', 'challengesCompletedCount', 'timesCompleted',
    'repeats', 'repeatabilityMode', 'startTime', 'endTime']);
  if (!positive(set.id) || set.id !== contract.challenge.setId || set.challengesCount !== 1 || set.challengesCompletedCount !== 0
      || typeof set.name !== 'string' || set.name.length > 160 || /[\u0000-\u001f]/.test(set.name)
      || ['timesCompleted', 'repeats', 'startTime', 'endTime'].some(key => !nonnegative(set[key]))
      || !['NON_REPEATABLE', 'UNLIMITED', 'LIMITED'].includes(set.repeatabilityMode)
      || set.repeatabilityMode === 'LIMITED' && set.timesCompleted >= set.repeats
      || set.repeatabilityMode === 'NON_REPEATABLE' && set.timesCompleted !== 0
      || set.startTime * 1000 > now || set.endTime !== 0 && set.endTime * 1000 <= now) return fail('FC27_ATTEMPT_SET_UNVERIFIED');
  if (!Array.isArray(contract.rewards) || contract.rewards.length !== 1) return fail('FC27_ATTEMPT_REWARD_UNVERIFIED');
  const reward = pick(contract.rewards[0], ['scope', 'type', 'value', 'count', 'tradable']);
  if (!validReward(reward)) return fail('FC27_ATTEMPT_REWARD_UNVERIFIED');
  if (!positive(policy.maxRating) || policy.maxRating > 83 || policy.onlyUntradeable !== true
      || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200
      || !Array.isArray(contract.challenge.requirements) || contract.challenge.requirements.length > 16
      || !Array.isArray(contract.challenge.brickIndices) || contract.challenge.brickIndices.length > 11) return fail('FC27_ATTEMPT_POLICY_UNVERIFIED');
  return clone({ context, set, rewards: [reward],
    challenge: { ...pick(contract.challenge, ['schema', 'mechanism', 'requirementsOperation', 'completed', 'setId', 'id',
      'slotCount', 'brickIndices', 'requirements']), context },
    policy: { ...pick(policy, ['schema', 'reviewed', 'maxRating', 'onlyUntradeable', 'goldRange', 'protectFsuLockedPlayers',
      'protectActiveSquad', 'storageFirst', 'excludedLeagueIds']), context } });
}

function prepare(input, now) {
  const bound = facts(input.contract, input.policy, now);
  const plan = previewTraditionalSquad({ ...bound, inventory: input.inventory });
  if (plan.status !== 'preview') return blocked(plan.reason);
  const byId = new Map(input.inventory.items.map(item => [item.id, item]));
  const selected = plan.selected.map(ref => ({ ...pick(byId.get(ref.id), safetyKeys), slot: ref.slot }));
  if (selected.some(item => item.pile !== 'club' || ![0, 1].includes(item.rarity) || item.state !== 'free')) {
    return blocked('FC27_ATTEMPT_ITEM_UNVERIFIED');
  }
  return freeze({ status: 'prepared', ...bound, createdAt: now, selected });
}
function validateItems(plan, snapshot, saved = false) {
  if (snapshot?.fresh !== true || !scopeMatches(snapshot.context, plan.context) || !Array.isArray(snapshot.items)
      || snapshot.items.length !== plan.selected.length) return fail('FC27_EXACT_ITEMS_CHANGED');
  if (saved && (snapshot.setId !== plan.set.id || snapshot.challengeId !== plan.challenge.id || snapshot.ready !== true)) {
    return fail('FC27_SAVED_SQUAD_UNVERIFIED');
  }
  const byId = new Map(snapshot.items.map(item => [item?.id, item]));
  if (byId.size !== plan.selected.length) return fail('FC27_EXACT_ITEMS_CHANGED');
  for (const expected of plan.selected) {
    const current = byId.get(expected.id);
    if (!same(pick(current, safetyKeys), pick(expected, safetyKeys)) || saved && current.slot !== expected.slot) {
      return fail('FC27_EXACT_ITEMS_CHANGED');
    }
  }
  const check = previewTraditionalSquad({ context: plan.context, challenge: plan.challenge, policy: plan.policy,
    inventory: { schema: 1, context: plan.context, kind: 'normalized-inventory', status: 'ready', items: snapshot.items } });
  if (check.status !== 'preview' || !same(check.selected, plan.selected.map(item => pick(item, ['id', 'definitionId', 'pile', 'rating', 'slot'])))) {
    return fail('FC27_EXACT_ITEMS_CHANGED');
  }
}
async function bounded(operation) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('FC27_OPERATION_TIMEOUT')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
function safeReason(error) {
  return /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_ATTEMPT_UNCONFIRMED';
}
function terminalRecord(record, scope) {
  try { return isTerminalTraditionalJournal(normalizeTraditionalJournal(scope, record)); }
  catch { return false; }
}

// No runtime or EA dependency. Only the isolated acceptance entry composes real effects.
export function createTraditionalTransaction({ enabled = false, adapter, journal, exclusive, now = Date.now,
  createOperationId, shouldStop = () => false } = {}) {
  const plans = new WeakSet();
  const approved = new WeakSet();
  const permits = new WeakMap();
  let busy = false;
  const api = {
    prepare(input) {
      try {
        const plan = prepare(input, now());
        if (plan.status === 'prepared') plans.add(plan);
        return plan;
      } catch (error) { return blocked(safeReason(error)); }
    },
    approve(plan, approval) {
      if (enabled !== true) return blocked('FC27_LIVE_DISABLED');
      if (!plans.has(plan) || approved.has(plan) || approval?.approved !== true || approval.count !== 1
          || approval.setId !== plan.set.id || approval.challengeId !== plan.challenge.id
          || approval.maxPlayers !== plan.selected.length || approval.maxRating !== plan.policy.maxRating) {
        return blocked('FC27_APPROVAL_INVALID');
      }
      if (now() < plan.createdAt || now() - plan.createdAt > lifetime) return blocked('FC27_APPROVAL_EXPIRED');
      const permit = Object.freeze({});
      approved.add(plan); permits.set(permit, plan);
      return { status: 'approved', permit };
    },
    async execute(permit) {
      if (enabled !== true) return blocked('FC27_LIVE_DISABLED');
      if (busy) return blocked('FC27_ATTEMPT_BUSY');
      const plan = permits.get(permit);
      if (!plan) return blocked('FC27_APPROVAL_INVALID');
      permits.delete(permit);
      if (now() < plan.createdAt || now() - plan.createdAt > lifetime) return blocked('FC27_APPROVAL_EXPIRED');
      const effects = ['readInputs', 'validateItems', 'readRewardBaseline', 'save', 'readSavedSquad', 'submit', 'reconcile'];
      if (adapter?.capabilities?.verified !== true || adapter.capabilities.submitWithoutSave !== true
          || effects.some(name => typeof adapter[name] !== 'function') || typeof exclusive !== 'function'
          || typeof createOperationId !== 'function' || typeof journal?.read !== 'function' || typeof journal.write !== 'function') {
        return blocked('FC27_TRANSACTION_ADAPTER_UNVERIFIED');
      }
      busy = true;
      const scope = contextKey(plan.context, 'traditional-sbc-journal');
      let entered = false;
      let held = false;
      let operation;
      let outcome;
      let lockFailed = false;
      try {
        try {
          await exclusive(scope, async () => {
            if (entered) return blocked('FC27_ATTEMPT_BUSY');
            entered = true; held = true;
            operation = executeLocked(plan, scope, () => held);
            outcome = await operation;
            return outcome;
          });
          if (entered && !outcome) lockFailed = true;
        } catch { lockFailed = true; }
        finally { held = false; }
        // A broken lock provider must not leave an unawaited operation that can write later.
        if (operation) outcome = await operation;
        if (lockFailed) return { ...blocked('FC27_EXCLUSIVE_ACCESS_LOST'), ...outcome,
          status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_LOST' };
        return outcome ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      } catch (error) { return { ...blocked(safeReason(error)), ...outcome, status: 'blocked', reason: safeReason(error) }; }
      finally { busy = false; }
    },
  };

  async function executeLocked(plan, scope, lockHeld) {
    let saveInvoked = false;
    let submitInvoked = false;
    let submitted = false;
    let rejected = false;
    let rejectionPersisted = false;
    let journalReadConfirmed = false;
    let completed = false;
    let journalFailed = false;
    let record;
    let baseline;
    let saved;
    let receipt;
    const target = result => result?.setId === plan.set.id && result?.challengeId === plan.challenge.id;
    const stopCheck = () => {
      if (!lockHeld()) return fail('FC27_EXCLUSIVE_ACCESS_LOST');
      if (shouldStop() === true) return fail('FC27_STOP_REQUESTED');
      if (now() < plan.createdAt || now() - plan.createdAt > lifetime) return fail('FC27_APPROVAL_EXPIRED');
    };
    const currentInputs = async () => {
      stopCheck();
      if (adapter.capabilities?.verified !== true || adapter.capabilities.submitWithoutSave !== true) {
        return fail('FC27_TRANSACTION_ADAPTER_UNVERIFIED');
      }
      const input = await bounded(() => adapter.readInputs(plan));
      const current = facts(input?.contract, input?.policy, now());
      if (input.unassignedClear !== true || !same(current, pick(plan, ['context', 'set', 'rewards', 'challenge', 'policy']))) {
        return fail('FC27_ATTEMPT_INPUTS_CHANGED');
      }
      stopCheck();
    };
    const persist = async phase => {
      record = normalizeTraditionalJournal(scope, { ...record, phase, updatedAt: now(), submitted: submitted ? true
        : phase === 'submit-pending' || submitInvoked && !rejected ? null : false });
      try {
        await bounded(() => journal.write(scope, clone(record)));
        if (!same(await bounded(() => journal.read(scope)), record)) return fail('FC27_JOURNAL_UNCONFIRMED');
      } catch { return fail('FC27_JOURNAL_UNCONFIRMED'); }
    };
    try {
      const previous = await bounded(() => journal.read(scope));
      journalReadConfirmed = true;
      if (previous !== null && !terminalRecord(previous, scope)) return fail('FC27_RECOVERY_REQUIRED');
      const operationId = createOperationId();
      if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) return fail('FC27_OPERATION_ID_UNVERIFIED');
      record = { schema: 2, scope, operationId, setId: plan.set.id, challengeId: plan.challenge.id,
        setTimesCompleted: plan.set.timesCompleted,
        itemRefs: refs(plan.selected), reward: plan.rewards[0] };
      await submitSbcAttempt({
        challengeProvider: async () => {
          await currentInputs();
          return { set: plan.set, challenge: plan.challenge };
        },
        squadProvider: async () => ({ ok: true, players: plan.selected, itemRefs: refs(plan.selected) }),
        prepareRuntimeAccess: async () => {
          const snapshot = await bounded(() => adapter.validateItems(plan));
          validateItems(plan, snapshot);
          return { ok: true, players: plan.selected };
        },
        preSaveValidators: [currentInputs],
        saveSquad: async () => {
          baseline = await bounded(() => adapter.readRewardBaseline(plan));
          if (baseline?.fresh !== true || !scopeMatches(baseline.context, plan.context)
              || baseline.packId !== plan.rewards[0].value || !nonnegative(baseline.count)) return fail('FC27_REWARD_BASELINE_UNVERIFIED');
          record.rewardBaselineCount = baseline.count;
          await persist('save-pending');
          await currentInputs();
          saveInvoked = true;
          const result = await bounded(() => adapter.save(plan));
          if (result?.status !== 'confirmed' || !target(result)) return fail('FC27_SAVE_UNCONFIRMED');
          await persist('saved');
        },
        reloadSquad: async () => { stopCheck(); saved = await bounded(() => adapter.readSavedSquad(plan)); },
        readSavedPlayers: async () => saved?.items,
        postSaveValidators: [() => validateItems(plan, saved, true)],
        isSubmitReady: async () => saved?.ready === true,
        readFinalPlayers: async () => {
          await currentInputs();
          saved = await bounded(() => adapter.readSavedSquad(plan));
          return saved?.items;
        },
        finalValidators: [() => validateItems(plan, saved, true)],
        submitTransport: async () => {
          await persist('submit-pending');
          await currentInputs();
          validateItems(plan, await bounded(() => adapter.validateItems(plan)));
          saved = await bounded(() => adapter.readSavedSquad(plan));
          validateItems(plan, saved, true);
          await currentInputs();
          stopCheck();
          submitInvoked = true;
          receipt = await bounded(() => adapter.submit(plan, { skipValidation: false }));
          if (receipt?.status === 'rejected' && target(receipt)) {
            rejected = true; await persist('rejected'); rejectionPersisted = true;
            return fail('FC27_SUBMIT_REJECTED');
          }
          if (receipt?.status !== 'confirmed' || !target(receipt)) return fail('FC27_SUBMIT_UNCONFIRMED');
          submitted = true;
          // Once EA confirms, journal trouble or Stop must not skip inventory/reward reconciliation.
          try { await persist('submitted'); } catch { journalFailed = true; }
          return { submitted: true, rewardPackId: plan.rewards[0].value };
        },
        afterSubmit: async () => {
          const result = await bounded(() => adapter.reconcile(plan, receipt, baseline));
          const consumed = Array.isArray(result?.consumed) ? [...result.consumed].sort((a, b) => a.id - b.id) : null;
          const expected = refs(plan.selected).sort((a, b) => a.id - b.id);
          if (!target(result) || result.fresh !== true || !scopeMatches(result.context, plan.context)
              || result.progressConfirmed !== true || !same(consumed, expected)
              || result.packId !== plan.rewards[0].value || result.packCount !== baseline.count + plan.rewards[0].count) {
            return fail('FC27_RECONCILIATION_UNCONFIRMED');
          }
          if (journalFailed) return fail('FC27_JOURNAL_UNCONFIRMED');
          await persist('completed'); completed = true;
        },
      });
      if (!completed) return fail('FC27_ATTEMPT_UNCONFIRMED');
      return { status: 'completed', submitted: true, recoveryRequired: false,
        consumedCount: plan.selected.length, rewardCount: plan.rewards[0].count };
    } catch (error) {
      const reason = safeReason(error);
      return { status: 'blocked', reason, submitted: submitted ? true : submitInvoked && !rejected ? null : false,
        recoveryRequired: !journalReadConfirmed || reason === 'FC27_RECOVERY_REQUIRED'
          || !completed && !rejectionPersisted && (saveInvoked || submitInvoked || !!record?.phase) };
    } finally {
      // Fence queued reads/pacing before releasing the lock. Abort never implies rollback.
      try { adapter.cancel?.(); } catch { /* The durable boundary still prevents replay. */ }
    }
  }
  return Object.freeze(api);
}
