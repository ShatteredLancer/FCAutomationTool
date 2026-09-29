import { prepareFc27PuzzleConceptDraft, validateFc27PuzzleConceptDraft } from './puzzle-concept-draft.js';

const fail = reason => { throw new Error(reason); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const reasonOf = error => /^FC27_[A-Z0-9_]{1,100}$/.test(error?.message ?? '') ? error.message : 'FC27_CONCEPT_UNCONFIRMED';
const blocked = reason => ({ status: 'blocked', reason, saved: false, submitted: false });
export const fc27ConceptPendingKey = (scope, target = null) => `fcat-fc27-concept-pending:${scope}${target ? `:${target.setId}:${target.challengeId}` : ''}`;
const keyOf = (scope, target) => `fcat-fc27-concept-draft:${scope}:${target.setId}:${target.challengeId}`;
const indexKeyOf = scope => `${fc27ConceptPendingKey(scope)}:index`;
const sameTarget = (a, b) => a?.setId === b?.setId && a?.challengeId === b?.challengeId;
const validTarget = target => [target?.setId, target?.challengeId].every(id => Number.isSafeInteger(id) && id > 0);
const accountOf = context => ({ accountScope: context?.accountScope, platform: context?.platform });
const accountMatches = (record, context) => !record?.account
  || record.account.accountScope === context?.accountScope && record.account.platform === context?.platform;

export async function readFc27ConceptPending(get, scope, target = null) {
  if (target && !validTarget(target)) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
  if (target) {
    const current = await get(fc27ConceptPendingKey(scope, target), null);
    if (current !== null) {
      if (!sameTarget(current, target)) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
      return current;
    }
  }
  const legacy = await get(fc27ConceptPendingKey(scope), null);
  if (legacy !== null && !validTarget(legacy)) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
  if (target) return sameTarget(legacy, target) ? legacy : null;
  if (legacy !== null) return legacy;
  const targets = await get(indexKeyOf(scope), []);
  if (!Array.isArray(targets) || targets.some(entry => !validTarget(entry))) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
  for (const entry of targets) {
    const pending = await readFc27ConceptPending(get, scope, entry);
    if (pending !== null) return pending;
  }
  return null;
}

// Runs under the SAME account lock as traditional and owned-only Puzzle writes.
// Durable dispatch marker is written only after the provider checks the server
// squad. An interrupted save can be read back, never automatically sent again.
export function createFc27PuzzleConceptSession({ scope, context, get, set, exclusive, checkOtherTransactions,
  createProvider, readCurrent, assertCurrent, now = Date.now, operationId } = {}) {
  const store = async (key, value) => {
    await set(key, structuredClone(value));
    if (!same(await get(key, null), value)) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
  };
  const evidence = (reply, plan) => {
    if (!reply?.fresh || !Number.isSafeInteger(reply.observedAt) || now() - reply.observedAt < 0 || now() - reply.observedAt > 15000
        || !same(reply.context, plan.context)) fail('FC27_CONCEPT_EVIDENCE_UNVERIFIED');
  };
  const validate = (plan, current, owned) => {
    const result = validateFc27PuzzleConceptDraft(plan, current, owned);
    if (result.status !== 'verified') fail(result.reason);
  };
  const targetOf = plan => ({ setId: plan.challenge.setId, challengeId: plan.challenge.id });
  const pendingOf = (target, context, identifier) => ({ ...target, operationId: identifier, account: accountOf(context) });
  const clearPending = async target => {
    await store(fc27ConceptPendingKey(scope, target), null);
    const legacy = await get(fc27ConceptPendingKey(scope), null);
    if (sameTarget(legacy, target)) await store(fc27ConceptPendingKey(scope), null);
    const targets = await get(indexKeyOf(scope), []);
    if (!Array.isArray(targets)) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
    await store(indexKeyOf(scope), targets.filter(entry => !sameTarget(entry, target)));
  };
  const abandon = async (target) => {
    await store(keyOf(scope, target), null);
    await clearPending(target);
    return { status: 'reset', reason: 'FC27_CONCEPT_SQUAD_CLEARED', ...target, saved: false, submitted: false };
  };
  const readback = async (provider, record) => {
    const { plan } = record; const saved = await provider.readConceptDraft(plan);
    evidence(saved, plan);
    if (saved.setId !== plan.challenge.setId || saved.challengeId !== plan.challenge.id) fail('FC27_CONCEPT_READBACK_UNVERIFIED');
    validate(plan, await readCurrent(plan, { afterSave: true }), saved.owned);
    if ((await provider.syncConceptDraft(plan))?.status !== 'synchronized') fail('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED');
    await store(keyOf(scope, targetOf(plan)), { ...record, phase: 'saved', updatedAt: now() });
    await clearPending(targetOf(plan));
    return { status: 'concept-filled', reason: 'FC27_CONCEPT_SAVED_VERIFIED', saved: true, submitted: false,
      ...targetOf(plan), purchaseCount: plan.purchaseCount, estimatedCost: plan.estimatedCost };
  };
  return Object.freeze({
    async save(input, suggestion) {
      const plan = prepareFc27PuzzleConceptDraft(input, suggestion);
      if (plan.status !== 'prepared') return plan;
      let boundary = false; let provider;
      try {
        return await exclusive(scope, async () => {
          assertCurrent();
          if (!same(plan.context, context)) fail('FC27_CONCEPT_INPUTS_CHANGED');
          const target = targetOf(plan);
          if (await checkOtherTransactions() !== true
              || await readFc27ConceptPending(get, scope, target) !== null) fail('FC27_CONCEPT_RECOVERY_REQUIRED');
          const previous = await get(keyOf(scope, target), null);
          if (previous?.phase === 'save-pending') fail('FC27_CONCEPT_RECOVERY_REQUIRED');
          provider = await createProvider();
          const current = await readCurrent(plan);
          if (current.squadEmpty !== true) fail('FC27_PUZZLE_EXISTING_SQUAD_BLOCKED');
          const replaceBaseline = typeof provider.readPuzzleBaseline === 'function'
            ? await provider.readPuzzleBaseline(plan) : null;
          const selected = plan.slots.filter(ref => ref?.kind === 'owned');
          const fresh = selected.length ? await provider.validateItems({ selected })
            : { context: plan.context, fresh: true, observedAt: now(), items: [] };
          evidence(fresh, plan);
          validate(plan, await readCurrent(plan), fresh.items);
          const identifier = operationId();
          if (typeof identifier !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(identifier)) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
          const record = { schema: 1, scope, operationId: identifier,
            account: { accountScope: plan.context.accountScope, platform: plan.context.platform },
            phase: 'save-pending', plan, updatedAt: now(), submitted: false };
          const receipt = await provider.saveConceptDraft(plan, () => { assertCurrent(); return true; }, async () => {
            assertCurrent(); evidence(fresh, plan);
            const latest = await readCurrent(plan);
            if (latest.squadEmpty !== true) fail('FC27_PUZZLE_EXISTING_SQUAD_BLOCKED');
            validate(plan, latest, fresh.items);
            boundary = true;
            const pending = pendingOf(target, plan.context, record.operationId);
            const targets = await get(indexKeyOf(scope), []);
            if (!Array.isArray(targets) || targets.some(entry => !validTarget(entry))) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
            await store(indexKeyOf(scope), [...targets.filter(entry => !sameTarget(entry, target)), target]);
            await store(fc27ConceptPendingKey(scope, target), pending);
            await store(keyOf(scope, target), record);
            assertCurrent(); evidence(fresh, plan);
          }, { replaceBaseline });
          if (receipt?.status !== 'confirmed' || !same({ setId: receipt.setId, challengeId: receipt.challengeId }, targetOf(plan))) fail('FC27_CONCEPT_SAVE_UNCONFIRMED');
          return readback(provider, record);
        }) ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      } catch (error) { return { ...blocked(reasonOf(error)), status: boundary ? 'recovery-required' : 'blocked', saved: boundary ? null : false }; }
      finally { provider?.cancel(); }
    },
    async recover(target, { restartIfEmpty = false } = {}) {
      let provider;
      try {
        const result = await exclusive(scope, async () => {
          if (await checkOtherTransactions() !== true) fail('FC27_RECOVERY_REQUIRED');
          assertCurrent();
          const pending = await readFc27ConceptPending(get, scope, target);
          const record = await get(keyOf(scope, target), null);
          if (!pending && !record) return { status: 'absent' };
          if (pending && (pending.setId !== target.setId || pending.challengeId !== target.challengeId)) {
            return { ...blocked('FC27_CONCEPT_RECOVERY_REQUIRED'), recoverySetId: pending.setId, recoveryChallengeId: pending.challengeId };
          }
          if (!record || record.schema !== 1 || record.scope !== scope || record.submitted !== false
              || !same(targetOf(record.plan), target) || !['saved', 'save-pending'].includes(record.phase)
              || typeof record.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(record.operationId)
              || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0 || record.updatedAt > now()
              || !same(record.plan?.context, context)
              || !accountMatches(record, record.plan?.context)
              || pending?.account && !accountMatches(pending, record.plan?.context)
              || pending && pending.operationId !== record.operationId) fail('FC27_CONCEPT_JOURNAL_UNCONFIRMED');
          validate(record.plan, record.plan, record.plan.owned);
          if (restartIfEmpty && !pending && record.phase === 'saved'
              && (await readCurrent(record.plan)).squadEmpty === true) {
            assertCurrent();
            return { status: 'reset', reason: 'FC27_PUZZLE_LOCAL_SQUAD_CLEARED', ...target, saved: false, submitted: false };
          }
          assertCurrent(); provider = await createProvider();
          try {
            return { ...await readback(provider, record), restored: true };
          } catch (error) {
            if (error?.message === 'FC27_CONCEPT_SQUAD_CLEARED') {
              if (pending || record.phase === 'save-pending') fail('FC27_CONCEPT_RECOVERY_REQUIRED');
              return abandon(target);
            }
            throw error;
          }
        });
        return result?.status === 'absent' ? null : result ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      } catch (error) { return blocked(reasonOf(error)); }
      finally { provider?.cancel(); }
    },
  });
}
