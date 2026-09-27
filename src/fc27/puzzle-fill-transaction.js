import { submitSbcAttempt } from '../sbc/submit-attempt.js';
import { traditionalJournalScope } from './traditional-journal.js';
import { prepareFc27PuzzleFillPlan, validateFc27PuzzleFillPlan } from './puzzle-fill-plan.js';

const blocked = reason => ({ status: 'blocked', reason, saved: false, submitted: false });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameApproval = (actual, expected) => actual && typeof actual === 'object'
  && Object.keys(actual).length === Object.keys(expected).length
  && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
const safeReason = error => /^FC27_[A-Z0-9_]{1,100}$/.test(error?.message ?? '')
  ? error.message : 'FC27_PUZZLE_FILL_UNCONFIRMED';
const fail = reason => { throw new Error(reason); };

// Independent save-only transaction. Persistence must use the existing SBC
// exclusive lock and check both journals.
// There is deliberately no submit, move, market, retry or material-reselection seam.
export function createFc27PuzzleFillTransaction({ enabled = false, adapter, journal, exclusive,
  checkOtherTransactions, now = Date.now, createOperationId, shouldStop = () => false } = {}) {
  const plans = new WeakMap(); const permits = new WeakMap();
  let busy = false;
  const time = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) fail('FC27_PUZZLE_CLOCK_UNVERIFIED');
    return value;
  };
  const alive = created => {
    const age = time() - created;
    if (age < 0 || age > 60000) fail('FC27_PUZZLE_FILL_EXPIRED');
    if (shouldStop() !== false) fail('FC27_PUZZLE_FILL_STOPPED');
  };
  const evidence = (reply, plan) => {
    const age = time() - reply?.observedAt;
    if (!reply || reply.fresh !== true || !Number.isSafeInteger(reply.observedAt) || age < 0 || age > 15000
        || !same(reply.context, plan.context) || reply.setId !== plan.challenge.setId
        || reply.challengeId !== plan.challenge.id) fail('FC27_PUZZLE_FILL_EVIDENCE_UNVERIFIED');
  };
  const validate = result => {
    if (result.status !== 'verified') fail(result.reason);
    return result;
  };
  return Object.freeze({
    prepare(input, preview) {
      const plan = prepareFc27PuzzleFillPlan(input, preview);
      if (plan.status === 'prepared') plans.set(plan, { created: time(), used: false });
      return plan;
    },
    approve(plan, approval) {
      if (enabled !== true) return blocked('FC27_PUZZLE_FILL_DISABLED');
      const metadata = plans.get(plan);
      if (!metadata || metadata.used || !sameApproval(approval, { approved: true, action: 'fill-only',
        setId: plan.challenge.setId, challengeId: plan.challenge.id, count: 1,
        maxPlayers: plan.selected.length, maxRating: plan.policy.maxRating })) return blocked('FC27_PUZZLE_FILL_APPROVAL_INVALID');
      try { alive(metadata.created); }
      catch (error) { return blocked(safeReason(error)); }
      metadata.used = true;
      const permit = Object.freeze({}); permits.set(permit, { plan, created: metadata.created });
      return { status: 'approved', permit };
    },
    async execute(permit) {
      if (enabled !== true) return blocked('FC27_PUZZLE_FILL_DISABLED');
      const approved = permits.get(permit); permits.delete(permit);
      if (!approved) return blocked('FC27_PUZZLE_FILL_APPROVAL_INVALID');
      if (busy) return blocked('FC27_PUZZLE_FILL_BUSY');
      busy = true;
      let dispatched = false; let boundary = false;
      try {
        const { plan, created } = approved;
        alive(created);
        if (typeof exclusive !== 'function' || typeof journal?.read !== 'function' || typeof journal?.write !== 'function'
            || typeof checkOtherTransactions !== 'function' || typeof createOperationId !== 'function'
            || ['readInputs', 'validateItems', 'save', 'readSavedSquad', 'syncSavedSquad', 'assertCurrent'].some(key => typeof adapter?.[key] !== 'function')) {
          return blocked('FC27_PUZZLE_FILL_ADAPTER_UNAVAILABLE');
        }
        const scope = traditionalJournalScope(plan.context);
        let entered = false;
        return await exclusive(scope, async () => {
          if (entered) fail('FC27_EXCLUSIVE_ACCESS_LOST');
          entered = true;
          alive(created);
          if (await checkOtherTransactions(scope) !== true) fail('FC27_RECOVERY_REQUIRED');
          const previous = await journal.read(scope);
          if (previous && previous.phase !== 'saved') fail('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
          const operationId = createOperationId();
          if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) fail('FC27_PUZZLE_OPERATION_UNVERIFIED');
          const record = { schema: 2, kind: 'puzzle-fill', scope, operationId,
            brickIndices: [...plan.challenge.brickIndices],
            setId: plan.challenge.setId, challengeId: plan.challenge.id,
            itemRefs: plan.selected.map(({ id, definitionId, pile, slot }) => ({ id, definitionId, pile, slot })),
            phase: 'save-pending', submitted: false, updatedAt: time() };
          let current; let exact;
          await submitSbcAttempt({ prepareOnly: true,
            challengeProvider: async () => ({ set: { id: plan.challenge.setId }, challenge: { id: plan.challenge.id } }),
            squadProvider: async () => ({ ok: true, players: plan.items, itemRefs: [] }),
            preSaveValidators: [async () => {
              current = await adapter.readInputs(plan);
              evidence(current, plan);
              if (current.squadEmpty !== true) fail('FC27_PUZZLE_EXISTING_SQUAD_BLOCKED');
              exact = await adapter.validateItems(plan);
              evidence(exact, plan);
              validate(validateFc27PuzzleFillPlan(plan, current.input, exact.items));
              // Re-read conditions/configuration after the Club round-trip.
              const latest = await adapter.readInputs(plan);
              evidence(latest, plan);
              if (latest.squadEmpty !== true) fail('FC27_PUZZLE_EXISTING_SQUAD_BLOCKED');
              validate(validateFc27PuzzleFillPlan(plan, latest.input, exact.items));
              current = latest; evidence(exact, plan); alive(created);
            }],
            saveSquad: async () => {
              alive(created);
              const receipt = await adapter.save(plan, async () => {
                if (boundary) fail('FC27_PUZZLE_SAVE_UNCONFIRMED');
                alive(created); evidence(exact, plan); evidence(current, plan);
                if (adapter.assertCurrent(plan) !== true) fail('FC27_PUZZLE_FILL_INPUTS_CHANGED');
                boundary = true;
                await journal.write(scope, structuredClone(record));
                if (!same(await journal.read(scope), record)) fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED');
                alive(created); evidence(exact, plan); evidence(current, plan);
                if (adapter.assertCurrent(plan) !== true) fail('FC27_PUZZLE_FILL_INPUTS_CHANGED');
                dispatched = true;
              });
              if (!dispatched || receipt?.status !== 'confirmed' || receipt.setId !== record.setId || receipt.challengeId !== record.challengeId) {
                fail('FC27_PUZZLE_SAVE_UNCONFIRMED');
              }
            },
            readSavedPlayers: async () => {
              // A user stop after dispatch must not skip the write reconciliation.
              const saved = await adapter.readSavedSquad(plan);
              evidence(saved, plan);
              current = await adapter.readInputs(plan);
              evidence(current, plan);
              validate(validateFc27PuzzleFillPlan(plan, current.input, saved.items, { saved: true }));
              if ((await adapter.syncSavedSquad(plan))?.status !== 'synchronized') fail('FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED');
              return [];
            },
            postSaveValidators: [async () => {
              await journal.write(scope, { ...record, phase: 'saved', updatedAt: time() });
              const completed = await journal.read(scope);
              if (!completed || !same({ ...completed, phase: record.phase, updatedAt: record.updatedAt }, record)
                  || completed.phase !== 'saved') fail('FC27_PUZZLE_FILL_JOURNAL_UNCONFIRMED');
            }],
          });
          return { status: 'filled', reason: 'FC27_PUZZLE_SAVED_VERIFIED', saved: true, submitted: false,
            setId: record.setId, challengeId: record.challengeId, selectedCount: plan.selected.length };
        }) ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      } catch (error) {
        return { ...blocked(safeReason(error)), status: boundary ? 'recovery-required' : 'blocked',
          saved: dispatched ? null : false };
      } finally { busy = false; }
    },
  });
}
