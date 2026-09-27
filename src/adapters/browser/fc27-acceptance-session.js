import { readFc27Context } from '../ea/fc27-local-read.js';
import { inspectFc27ChallengeCatalog } from '../ea/fc27-challenge-catalog.js';
import { createFc27TraditionalProvider } from '../ea/fc27-traditional-provider.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';
import { createTraditionalTransaction } from '../../fc27/traditional-transaction.js';
import { traditionalJournalScope, isTerminalTraditionalJournal, assessTraditionalRecovery } from '../../fc27/traditional-journal.js';
import { inspectFc27VerifiedPuzzlePlan } from '../ea/fc27-puzzle-verify.js';
import { inspectFc27PuzzlePlan, readFc27PuzzleClubLinks, readFc27PuzzleChemistry } from '../ea/fc27-puzzle-read.js';
import { readFc27PuzzlePageSnapshot, readFc27CurrentPuzzleChallenge } from '../ea/fc27-puzzle-page.js';
import { previewFc27PuzzleSquad } from '../../fc27/puzzle-preview.js';
import { DEFAULT_PUZZLE_MAX_RATING } from '../../fc27/puzzle-material-policy.js';
import { readFc27PuzzlePolicy } from '../ea/fc27-fsu-read.js';
import { createFc27PuzzleFillPersistence } from '../../fc27/puzzle-fill-journal.js';
import { createFc27PuzzleFillTransaction } from '../../fc27/puzzle-fill-transaction.js';
import { createFc27PuzzleProcurementSession } from '../../fc27/puzzle-procurement-session.js';
import { createFc27MarketReadTransport, readFc27MarketPlayerName } from '../ea/fc27-market-read.js';

const blocked = reason => ({ status: 'blocked', reason });
const safeReason = error => /^FC27_[A-Z0-9_]{1,100}$/.test(error?.message) ? error.message : 'FC27_ACCEPTANCE_UNCONFIRMED';
const puzzleInput = input => ({ context: input.context, challenge: input.challenge,
  inventory: input.inventory, policy: input.policy, clubLinks: input.clubLinks, chemistry: input.chemistry,
  squadEmpty: input.squadEmpty });

// Catalog reads are deliberately single shot per account/Set. The stored value
// contains only the reviewed, serializable challenge projection; it never
// contains EA entities, Club items, or request/response objects.
const puzzleCatalogCacheKey = (scope, setId, challengeId = 'all') => `fcat-fc27-puzzle-catalog:${scope}:${setId}:${challengeId}`;
const cacheCatalogProjection = (catalog, scope, setId, reasonOverride = undefined) => ({
  schema: 1, scope, setId, challengeId: null, attemptedAt: Date.now(),
  result: structuredClone({
    status: catalog?.status, reason: reasonOverride ?? catalog?.reason, httpStatus: catalog?.httpStatus,
    liveExecutionEnabled: false, setId: catalog?.setId ?? setId, setName: catalog?.setName,
    setRewards: catalog?.setRewards, challengeRewardsSource: catalog?.challengeRewardsSource,
    rewardIdentityVerified: catalog?.rewardIdentityVerified,
    challenges: Array.isArray(catalog?.challenges) ? catalog.challenges
      .map(challenge => ({ id: challenge.id, setId: challenge.setId, name: challenge.name,
        status: challenge.status, type: challenge.type, eligibilityOperation: challenge.eligibilityOperation,
        requirements: challenge.requirements, rewards: challenge.rewards })) : [],
  }),
});
const readCachedCatalog = async (gmGetValue, scope, setId, challengeId = undefined) => {
  try {
    // Challenge id is intentionally ignored for storage. EA returns a complete
    // Set catalog and the one durable record is shared by every Challenge.
    const cached = await gmGetValue(puzzleCatalogCacheKey(scope, setId), null);
    if (!cached) return null;
    if (cached.schema !== 1 || cached.scope !== scope || cached.setId !== setId
        || cached.challengeId !== null
        || !cached.result || cached.result.setId !== setId || !Number.isSafeInteger(cached.attemptedAt)
        || !['observed', 'blocked'].includes(cached.result.status)
        || !Array.isArray(cached.result.challenges)) {
      return { status: 'blocked', reason: 'FC27_CATALOG_CACHE_UNVERIFIED', liveExecutionEnabled: false, setId };
    }
    return structuredClone(cached.result);
  } catch {
    // A storage read failure must not turn a recorded/unknown attempt into a
    // fresh EA request. Fail closed until the user explicitly clears the
    // scoped record.
    return { status: 'blocked', reason: 'FC27_CATALOG_CACHE_UNVERIFIED', liveExecutionEnabled: false, setId };
  }
};

// Kept in the userscript sandbox. No page-global command, permit or GM bridge.
export function createFc27AcceptanceSession({ root, gmGetValue, gmSetValue, lockManager, liveEnabled = false }) {
  const context = readFc27Context(root);
  const scope = traditionalJournalScope(context);
  const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
  const puzzlePersistence = createFc27PuzzleFillPersistence({ context, gmGetValue, gmSetValue,
    lock: persistence.lock, lockScope: scope });
  let prepared = null;
  let preparedPuzzle = null;
  let recovery = null;
  let armed = false;
  let busy = false;
  const catalogMemo = new Map();
  const puzzlePolicyKey = `fcat-fc27-puzzle-policy:${scope}`;
  const procurement = createFc27PuzzleProcurementSession({ createTransport: () => createFc27MarketReadTransport(root),
    get: gmGetValue, set: gmSetValue });
  const readPuzzleMaxRating = async () => {
    const value = await gmGetValue(puzzlePolicyKey, null);
    if (value === null) return DEFAULT_PUZZLE_MAX_RATING;
    if (value?.schema !== 1 || !Number.isSafeInteger(value.maxRating) || value.maxRating < 1 || value.maxRating > 99) {
      throw new Error('FC27_PUZZLE_POLICY_INVALID');
    }
    return value.maxRating;
  };
  const invalidate = () => {
    prepared?.adapter.cancel(); prepared = null;
    preparedPuzzle?.adapter.cancel(); preparedPuzzle = null;
  };
  const traditionalExclusive = (requestedScope, task) => persistence.exclusive(requestedScope, async () => {
    if ((await puzzlePersistence.journal.read(requestedScope))?.phase === 'save-pending') throw new Error('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
    return task();
  });
  const unchanged = () => {
    if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error('FC27_TRANSACTION_CONTEXT_CHANGED');
  };
  const readPuzzleCatalog = async (setId, challengeId = undefined) => {
    if (!Number.isSafeInteger(setId) || setId <= 0) return { result: blocked('FC27_CATALOG_SET_UNVERIFIED'), source: 'none' };
    const memoKey = `${setId}:${challengeId ?? 'all'}`;
    if (catalogMemo.has(memoKey)) return { ...catalogMemo.get(memoKey), source: 'memoized' };
    // Every catalog request is keyed by Set. A Set response contains all
    // Challenges, so a later native click must reuse that same projection.
    let cached = await readCachedCatalog(gmGetValue, scope, setId);
    if (cached) {
      const value = { result: cached, source: 'cached' };
      catalogMemo.set(memoKey, value);
      return value;
    }
    // Serialize the marker, request, and final projection under the existing
    // account lock. A second tab therefore observes the marker/cache instead
    // of issuing a concurrent GET. Storage failure is fail-closed: without a
    // durable marker we cannot promise that the next click will be single-shot.
    const value = await persistence.exclusive(scope, async () => {
      const again = await readCachedCatalog(gmGetValue, scope, setId);
      if (again) return { result: again, source: 'cached' };
      try {
        await gmSetValue(puzzleCatalogCacheKey(scope, setId), cacheCatalogProjection(
          { status: 'blocked', reason: 'FC27_CATALOG_READ_IN_PROGRESS', setId }, scope, setId));
      } catch { throw new Error('FC27_CATALOG_CACHE_UNAVAILABLE'); }
      const observed = await inspectFc27ChallengeCatalog(root, { setId });
      try { await gmSetValue(puzzleCatalogCacheKey(scope, setId), cacheCatalogProjection(observed, scope, setId)); }
      catch { throw new Error('FC27_CATALOG_CACHE_UNAVAILABLE'); }
      return { result: observed, source: 'single-read' };
    });
    catalogMemo.set(memoKey, value);
    return value;
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
    recovery = null;
    const puzzleRecord = await puzzlePersistence.journal.read(scope);
    if (puzzleRecord?.phase === 'save-pending') {
      const evidence = await observePuzzleRecovery(puzzleRecord);
      if (evidence) recovery = { kind: 'puzzle-fill', record: puzzleRecord, outcome: evidence };
      return { kind: 'puzzle-fill', status: recovery ? 'recoverable' : 'blocked',
        reason: recovery ? 'FC27_PUZZLE_RECOVERY_CONFIRMATION_REQUIRED' : 'FC27_PUZZLE_FILL_RECOVERY_REQUIRED',
        phase: puzzleRecord.phase, outcome: evidence, setId: puzzleRecord.setId,
        challengeId: puzzleRecord.challengeId, selectedCount: puzzleRecord.itemRefs.length, submitted: false };
    }
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
  const observePuzzleRecovery = async (record, { synchronize = false } = {}) => {
    const current = readFc27CurrentPuzzleChallenge(root, record);
    if (!current || current.status !== 'IN_PROGRESS') return null;
    const adapter = await provider();
    const plan = { kind: 'puzzle-fill-recovery', set: { id: record.setId }, challenge: { id: record.challengeId, setId: record.setId,
      brickIndices: record.schema === 2 ? record.brickIndices : [] },
      selected: record.itemRefs };
    try {
      const saved = await adapter.readSavedSquad(plan);
      if (saved.squadEmpty === true) {
        const current = await adapter.validateItems({ selected: record.itemRefs });
        return current.items.length === record.itemRefs.length && record.itemRefs.every(ref => current.items.some(item =>
          item.id === ref.id && item.definitionId === ref.definitionId && item.pile === ref.pile)) ? 'empty' : null;
      }
      if (saved.items.length === record.itemRefs.length && record.itemRefs.every(ref => saved.items.some(item =>
        item.id === ref.id && item.definitionId === ref.definitionId && item.pile === ref.pile && item.slot === ref.slot))) {
        if (synchronize && (await adapter.syncSavedSquad(plan))?.status !== 'synchronized') return null;
        return 'saved';
      }
      return null;
    } finally { adapter.cancel(); }
  };
  const preparePuzzle = async ({ setId, challengeId } = {}, assertTarget = () => true, progress = () => {}, nativeOnly = false) => {
      invalidate();
      assertTarget();
      const available = await persistence.exclusive(scope, async () => {
        const record = await persistence.journal.read(scope);
        if (record && !isTerminalTraditionalJournal(record)) throw new Error('FC27_RECOVERY_REQUIRED');
        if ((await puzzlePersistence.journal.read(scope))?.phase === 'save-pending') throw new Error('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
        return true;
      });
      if (available !== true) return blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
      // The native SBC detail panel already owns the exact Challenge and its
      // current squad. Reuse that local projection for the one-click action;
      // a second Set catalog GET is both redundant and prone to EA 429.
      const pageSnapshot = nativeOnly ? readFc27PuzzlePageSnapshot(root, { setId, challengeId }) : null;
      if (nativeOnly && !pageSnapshot) return blocked('FC27_PUZZLE_FILL_TARGET_CHANGED');
      const catalogRead = pageSnapshot
        ? { source: 'native-page', result: { status: 'observed', reason: 'FC27_NATIVE_PUZZLE_READ',
          liveExecutionEnabled: false, setId, challenges: [pageSnapshot.challenge] } }
        : await readPuzzleCatalog(setId, challengeId);
      const catalog = catalogRead.result;
      if (catalog.status !== 'observed') return { ...catalog, catalogSource: catalogRead.source };
      // A native click is bound to the Challenge visible beside the button.
      // A completed page stays bound to that target; do not pick another
      // IN_PROGRESS Challenge from the catalog.
      if (nativeOnly && pageSnapshot.challenge.status !== 'IN_PROGRESS') {
        return blocked(pageSnapshot.challenge.status === 'COMPLETED'
          ? 'FC27_PUZZLE_CHALLENGE_COMPLETED' : 'FC27_PUZZLE_CHALLENGE_NOT_IN_PROGRESS');
      }
      const candidates = catalog.challenges.filter(challenge => challenge.status === 'IN_PROGRESS'
        && challenge.eligibilityOperation === 'AND' && (challengeId === undefined || challenge.id === challengeId));
      if (candidates.length !== 1) return blocked('FC27_PUZZLE_CHALLENGE_AMBIGUOUS');
      let privateData = null;
      const requestedMaxRating = await readPuzzleMaxRating();
      const puzzleOptions = { setId, challengeId: candidates[0].id, maxRating: requestedMaxRating,
        catalog, layout: pageSnapshot?.layout };
      const report = nativeOnly ? await inspectFc27PuzzlePlan(root, puzzleOptions, async inputs => {
        const preview = previewFc27PuzzleSquad(inputs);
        privateData = { inputs, preview };
        if (inputs.squadEmpty === true && ['SAFE_MATERIAL_SHORTAGE', 'FC27_PUZZLE_CONSTRAINT_SHORTAGE',
          'FC27_PUZZLE_SEARCH_LIMIT', 'FC27_PUZZLE_NO_PLAN_FOUND'].includes(preview.reason)) {
          progress('procurement');
          const purchaseSuggestion = await persistence.exclusive(scope, () => procurement.plan(inputs, { assertCurrent: () => {
            assertTarget(); unchanged();
            const latest = readFc27PuzzlePageSnapshot(root, { setId, challengeId: candidates[0].id });
            if (!latest?.layout?.squadEmpty || JSON.stringify(latest.challenge.requirements) !== JSON.stringify(inputs.challenge.rawRequirements)
                || JSON.stringify(readFc27PuzzlePolicy(root, requestedMaxRating)) !== JSON.stringify(inputs.policy)) {
              throw new Error('FC27_PUZZLE_FILL_INPUTS_CHANGED');
            }
          } })) ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
          for (const plan of purchaseSuggestion.plans ?? []) for (const item of plan.purchases) {
            const name = readFc27MarketPlayerName(root, item.definitionId);
            if (name) item.displayName = name;
          }
          return { ...preview, purchaseSuggestion };
        }
        return preview;
      }) : await inspectFc27VerifiedPuzzlePlan(root, puzzleOptions,
        async (_projection, data) => { privateData = data; });
      if (report.status === 'preview' && privateData && (nativeOnly || privateData.fillPlan?.status === 'prepared')) {
        const baseInput = structuredClone(puzzleInput(privateData.inputs));
        const basePreview = structuredClone(privateData.preview);
        const planTarget = { setId, challengeId: candidates[0].id };
        const assertChallenge = challenge => {
          if (!challenge || challenge.id !== planTarget.challengeId || challenge.setId !== planTarget.setId
              || challenge.status !== 'IN_PROGRESS' || challenge.eligibilityOperation !== 'AND'
              || JSON.stringify(challenge.requirements) !== JSON.stringify(baseInput.challenge.rawRequirements)) {
            throw new Error('FC27_PUZZLE_FILL_INPUTS_CHANGED');
          }
        };
        let assertPuzzleCurrent = () => false;
        const native = await createFc27TraditionalProvider(root, { canWrite: () => {
          unchanged(); return liveEnabled === true && armed && persistence.inspect().active && assertPuzzleCurrent();
        }});
        const assertPuzzleEnvironment = () => {
          unchanged();
          native.assertCurrent();
          assertChallenge(readFc27CurrentPuzzleChallenge(root, planTarget));
          const links = readFc27PuzzleClubLinks(root);
          if (JSON.stringify(readFc27PuzzlePolicy(root, requestedMaxRating)) !== JSON.stringify(baseInput.policy)
              || JSON.stringify(links) !== JSON.stringify(baseInput.clubLinks)
              || baseInput.chemistry && JSON.stringify(readFc27PuzzleChemistry(root, links)) !== JSON.stringify(baseInput.chemistry)) {
            throw new Error('FC27_PUZZLE_FILL_INPUTS_CHANGED');
          }
          return true;
        };
        assertPuzzleCurrent = () => {
          assertTarget(); assertPuzzleEnvironment();
          if (nativeOnly) {
            const snapshot = readFc27PuzzlePageSnapshot(root, planTarget);
            if (!snapshot) throw new Error('FC27_PUZZLE_FILL_TARGET_CHANGED');
            assertChallenge(snapshot.challenge);
            if (!snapshot.layout.squadEmpty) throw new Error('FC27_PUZZLE_EXISTING_SQUAD_BLOCKED');
            if (JSON.stringify(currentInput(snapshot.challenge, snapshot.layout).challenge)
                !== JSON.stringify(baseInput.challenge)) throw new Error('FC27_PUZZLE_FILL_INPUTS_CHANGED');
          }
          return true;
        };
        let savedLayout = null;
        const currentInput = (challenge, layout) => {
          assertChallenge(challenge);
          if (!layout || layout.setId !== planTarget.setId || layout.challengeId !== planTarget.challengeId
              || layout.slotCount !== baseInput.challenge.slotCount || layout.customBrickIndices.length
              || JSON.stringify(layout.simpleBrickIndices) !== JSON.stringify(baseInput.challenge.brickIndices)) {
            throw new Error('FC27_PUZZLE_FILL_INPUTS_CHANGED');
          }
          return { ...structuredClone(baseInput), challenge: { ...structuredClone(baseInput.challenge),
            rawRequirements: challenge.requirements, formation: layout.formation } };
        };
        const adapter = {
          async readInputs(plan) {
            if (await readPuzzleMaxRating() !== requestedMaxRating) throw new Error('FC27_PUZZLE_FILL_INPUTS_CHANGED');
            assertPuzzleEnvironment();
            if (savedLayout) {
              const challenge = readFc27CurrentPuzzleChallenge(root, planTarget);
              return { context: baseInput.context, fresh: true, observedAt: Date.now(), ...planTarget,
                squadEmpty: savedLayout.squadEmpty, input: currentInput(challenge, savedLayout) };
            }
            if (!nativeOnly) {
              const state = await native.readSquadState(plan);
              return { ...state, input: currentInput(readFc27CurrentPuzzleChallenge(root, planTarget), state.layout) };
            }
            assertTarget();
            const snapshot = readFc27PuzzlePageSnapshot(root, planTarget);
            if (!snapshot) throw new Error('FC27_PUZZLE_FILL_TARGET_CHANGED');
            return { context: baseInput.context, fresh: true, observedAt: Date.now(), ...planTarget,
              squadEmpty: snapshot.layout.squadEmpty,
              input: currentInput(snapshot.challenge, snapshot.layout) };
          },
          async validateItems(plan) {
            const result = await native.validateItems({ selected: plan.selected });
            return { ...result, setId: plan.challenge.setId, challengeId: plan.challenge.id };
          },
          assertCurrent: assertPuzzleCurrent,
          save: (plan, beforeDispatch) => { progress('saving'); return native.save({ ...plan, set: { id: plan.challenge.setId } }, assertPuzzleCurrent, beforeDispatch); },
          syncSavedSquad: plan => native.syncSavedSquad({ ...plan, set: { id: plan.challenge.setId } }),
          readSavedSquad: async plan => {
            progress('verifying');
            const saved = await native.readSavedSquad({ ...plan, set: { id: plan.challenge.setId } });
            savedLayout = saved.layout;
            if (!savedLayout) throw new Error('FC27_PUZZLE_FILL_LAYOUT_UNVERIFIED');
            return saved;
          },
          cancel: () => native.cancel(),
        };
        const engine = createFc27PuzzleFillTransaction({ enabled: liveEnabled === true, adapter,
          journal: puzzlePersistence.journal, exclusive: puzzlePersistence.exclusive,
          checkOtherTransactions: async activeScope => {
            const record = await persistence.journal.read(activeScope);
            return !record || isTerminalTraditionalJournal(record);
          }, createOperationId: () => root.crypto.randomUUID() });
        const plan = engine.prepare(baseInput, basePreview);
        if (plan.status === 'prepared') preparedPuzzle = { engine, plan, adapter };
        else native.cancel();
      }
      return { ...report, catalogSource: catalogRead.source,
        policy: { ...report.policy, maxRating: privateData?.inputs?.policy?.maxRating ?? report.policy?.maxRating },
        fillReady: liveEnabled === true && preparedPuzzle?.plan?.status === 'prepared',
        fillLiveEnabled: liveEnabled === true };
  };
  const executePuzzle = async approval => {
    if (!preparedPuzzle || liveEnabled !== true) return blocked('FC27_PUZZLE_FILL_DISABLED');
    const current = preparedPuzzle; preparedPuzzle = null;
    const result = current.engine.approve(current.plan, approval);
    if (result.status !== 'approved') { current.adapter.cancel(); return result; }
    armed = true;
    try { return await current.engine.execute(result.permit); }
    finally { current.adapter.cancel(); }
  };
  return Object.freeze({
    inspectPuzzlePolicy: () => run(async () => ({ status: 'observed', maxRating: await readPuzzleMaxRating() })),
    setPuzzleMaxRating: maxRating => run(async () => {
      if (!Number.isSafeInteger(maxRating) || maxRating < 1 || maxRating > 99) return blocked('FC27_PUZZLE_POLICY_INVALID');
      return persistence.exclusive(scope, async () => {
        invalidate();
        await gmSetValue(puzzlePolicyKey, { schema: 1, maxRating });
        if (await readPuzzleMaxRating() !== maxRating) return blocked('FC27_PUZZLE_POLICY_UNCONFIRMED');
        return { status: 'observed', reason: 'FC27_PUZZLE_POLICY_SAVED', maxRating };
      });
    }),
    inspectCatalog: ({ setId } = {}) => run(async () => {
      invalidate();
      const catalogRead = await readPuzzleCatalog(setId);
      return { ...catalogRead.result, catalogSource: catalogRead.source };
    }),
    inspectPuzzle: options => run(() => preparePuzzle(options)),
    solveAndFillPuzzle: (target, { isCurrent, onProgress } = {}) => run(async () => {
      if (liveEnabled !== true) return blocked('FC27_PUZZLE_FILL_DISABLED');
      if (!Number.isSafeInteger(target?.setId) || target.setId <= 0
          || !Number.isSafeInteger(target?.challengeId) || target.challengeId <= 0
          || typeof isCurrent !== 'function') return blocked('FC27_PUZZLE_FILL_TARGET_CHANGED');
      const assertTarget = () => {
        if (isCurrent() !== true) throw new Error('FC27_PUZZLE_FILL_TARGET_CHANGED');
        return true;
      };
      // Private diagnostics, never a permit or a substitute for the journal.
      const log = { schema: 1, setId: target.setId, challengeId: target.challengeId,
        startedAt: Date.now(), action: 'fill-only', stages: [], submitted: false };
      const progress = stage => {
        log.stages.push({ stage, at: Date.now() }); log.stages = log.stages.slice(-20);
        try { onProgress?.(stage); } catch { /* Presentation cannot change a transaction. */ }
      };
      const persistLog = async () => {
        try { await gmSetValue(`fcat-fc27-puzzle-last:${scope}`, structuredClone(log)); }
        catch { /* Mandatory recovery evidence is stored by the separate journal. */ }
      };
      let result;
      try {
        progress('planning'); await persistLog();
        // The same native click may reconcile this target's interrupted save.
        // Only an exact server match is restored, never another Challenge or a
        // new save. Keep the account lock until local sync and journal settle.
        result = await persistence.exclusive(scope, async () => {
          const other = await persistence.journal.read(scope);
          if (other && !isTerminalTraditionalJournal(other)) return blocked('FC27_RECOVERY_REQUIRED');
          const record = await puzzlePersistence.journal.read(scope);
          if (record?.phase !== 'save-pending') return null;
          if (record.setId !== target.setId || record.challengeId !== target.challengeId) {
            return { ...blocked('FC27_PUZZLE_FILL_RECOVERY_REQUIRED'), recoverySetId: record.setId, recoveryChallengeId: record.challengeId };
          }
          progress('recovering'); assertTarget();
          if (await observePuzzleRecovery(record, { synchronize: true }) !== 'saved') return blocked('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
          unchanged();
          await puzzlePersistence.journal.write(scope, { ...record, phase: 'saved', updatedAt: Date.now() });
          return { status: 'filled', reason: 'FC27_PUZZLE_SAVED_RESTORED', saved: true, submitted: false,
            setId: record.setId, challengeId: record.challengeId, selectedCount: record.itemRefs.length, restored: true };
        });
        if (!result) {
          const preview = await preparePuzzle(target, assertTarget, progress, true);
          log.preview = preview;
          log.catalogSource = preview.catalogSource ?? 'unknown';
          if (preview.fillReady !== true) result = preview.status === 'preview'
            ? blocked('FC27_PUZZLE_FILL_PLAN_UNVERIFIED') : preview;
          else {
            assertTarget();
            log.plan = { selected: structuredClone(preparedPuzzle.plan.selected),
              rules: structuredClone(preparedPuzzle.plan.challenge.rawRequirements),
              validation: structuredClone(preparedPuzzle.plan.validation) };
            progress('validating'); await persistLog(); assertTarget();
            // The native trusted click authorizes one save for this exact target.
            result = await executePuzzle({ approved: true, action: 'fill-only', count: 1,
              setId: target.setId, challengeId: target.challengeId, maxPlayers: preparedPuzzle.plan.selected.length,
              maxRating: preparedPuzzle.plan.policy.maxRating });
          }
        }
      } catch (error) { result = blocked(safeReason(error)); }
      finally { invalidate(); }
      log.result = result; log.finishedAt = Date.now(); await persistLog();
      if (result?.status === 'recovery-required') {
        // Later blocked clicks may replace last-attempt, never this first write failure.
        try { await gmSetValue(`fcat-fc27-puzzle-write-failure:${scope}`, structuredClone(log)); }
        catch { /* The mandatory journal still owns recovery. */ }
      }
      return result;
    }),
    prepare: options => run(async () => {
      invalidate();
      return await traditionalExclusive(scope, async () => {
        const record = await persistence.journal.read(scope);
        if (record && !isTerminalTraditionalJournal(record)) return blocked('FC27_RECOVERY_REQUIRED');
        const adapter = await provider();
        try {
          const input = await adapter.prepareInputs(options);
          if (input.contract.challenge.brickIndices.length) return blocked('FC27_ACCEPTANCE_BRICKS_UNSUPPORTED');
          const engine = createTraditionalTransaction({ enabled: liveEnabled, adapter, ...persistence,
            exclusive: traditionalExclusive,
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
            ratings: plan.selected.map(item => item.rating),
            selected: plan.selected.map(item => ({ slot: item.slot, rating: item.rating, pile: item.pile })),
            requirements: plan.challenge.requirements.map(rule => ({ ...rule })),
            packId: baseline.packId, packCount: baseline.count };
        } catch (error) { adapter.cancel(); throw error; }
      }) ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
    }),
    execute: approval => run(async () => {
      if (!prepared || liveEnabled !== true) return blocked('FC27_LIVE_DISABLED');
      const current = prepared; prepared = null;
      const result = current.engine.approve(current.plan, approval);
      if (result.status !== 'approved') { current.adapter.cancel(); return result; }
      armed = true;
      try { return await current.engine.execute(result.permit); }
      finally { current.adapter.cancel(); }
    }),
    fillPuzzle: approval => run(() => executePuzzle(approval)),
    inspectRecovery: () => run(async () => { invalidate(); return await inspect() ?? blocked('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE'); }),
    resolveRecovery: approved => run(async () => {
      if (approved !== true || !recovery) return blocked('FC27_RECOVERY_APPROVAL_INVALID');
      const expected = recovery; recovery = null;
      return await persistence.exclusive(scope, async () => {
        if (expected.kind === 'puzzle-fill') {
          const record = await puzzlePersistence.journal.read(scope);
          if (JSON.stringify(record) !== JSON.stringify(expected.record)
              || await observePuzzleRecovery(record, { synchronize: expected.outcome === 'saved' }) !== expected.outcome) return blocked('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
          unchanged(); await puzzlePersistence.journal.clear(scope, record);
          return { status: 'resolved', reason: 'FC27_PUZZLE_RECOVERY_RESOLVED', outcome: expected.outcome,
            saved: expected.outcome === 'saved', submitted: false };
        }
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
