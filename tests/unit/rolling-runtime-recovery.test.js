import { describe, expect, it, vi } from 'vitest';
import { loadUserscript, makePlayer } from '../helpers/load-userscript.js';
import { createInventorySnapshot } from '../../src/domain/contracts.js';
import {
  createDuplicateSubmissionManifest,
  createDuplicateMaterializationTransaction,
  materializeDuplicateTransaction,
  transitionDuplicateMaterializationTransaction,
  validateDuplicateSubmissionManifest,
} from '../../src/inventory/duplicate-materialization-transaction.js';
import { submitSbcAttempt } from '../../src/sbc/submit-attempt.js';
import {
  ROLLING_DUPLICATE_TRANSACTION_KEY,
  ROLLING_PENDING_PRIMARY_REWARD_KEY,
  ROLLING_PENDING_PRIMARY_REWARD_MAX_AGE_MS,
  ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY,
  ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_MAX_AGE_MS,
} from '../../src/config/runtime.js';

function materializedDuplicateTransaction() {
  const source = {
    id: 101,
    definitionId: 7001,
    rating: 95,
    rareflag: 64,
    pile: 'unassigned',
  };
  const counterpart = {
    id: 102,
    definitionId: 7001,
    rating: 95,
    rareflag: 64,
    pile: 'club',
  };
  const consume = { ...source, id: 103, pile: 'club' };
  const displaced = { ...counterpart, pile: 'unassigned' };
  const planned = createDuplicateMaterializationTransaction({
    transactionId: 'tx-persist-recovery',
    challengeRef: { setId: 500, challengeId: 501 },
    beforeInventoryVersion: 8,
    pairs: [{ sourceSignal: source, protectedCounterpart: counterpart }],
  });
  const result = materializeDuplicateTransaction(planned, {
    replacements: [{ signalId: 101, targetId: 102, newItemId: 103 }],
    afterInventoryVersion: 9,
    resolveItem: (id, pile) => [consume, displaced]
      .find((item) => item.id === id && item.pile === pile) || null,
  });
  return { transaction: result.transaction, consume, displaced };
}

function interruptedUnrecordedDuplicateTransaction() {
  const source = {
    id: 101,
    definitionId: 7001,
    rating: 95,
    rareflag: 64,
    tradeable: false,
    pile: 'unassigned',
    playStyle: 250,
    cosmetics: null,
  };
  const counterpart = {
    ...source,
    id: 102,
    pile: 'club',
    playStyle: 268,
    cosmetics: [{ id: 7 }],
  };
  const transaction = createDuplicateMaterializationTransaction({
    transactionId: 'tx-interrupted-unrecorded',
    challengeRef: { setId: 500, challengeId: 501 },
    beforeInventoryVersion: 8,
    pairs: [{ sourceSignal: source, protectedCounterpart: counterpart }],
  });
  return {
    transaction,
    source,
    materializedConsume: { ...source, id: 103, pile: 'club' },
    displacedCounterpart: { ...counterpart, pile: 'unassigned' },
  };
}

function successfulObservable(result = { success: true, status: 200 }) {
  return {
    observe(controller, callback) { callback(this, result); },
    unobserve() {},
  };
}

function installInventoryRecoveryService(window, inventoryPiles, onMove) {
  window.services.Item.requestUnassignedItems = () => successfulObservable();
  window.services.Item.requestClubItems = () => ({ success: true });
  window.services.Item.move = (item, destination) => {
    onMove(item, destination);
    return successfulObservable();
  };
  return window.services.Item;
}

describe('Rolling runtime recovery helpers', () => {
  it.each(['selected', 'missing', 'blocked'])('observes the final Pick after a repeatable Set resets (%s)', async (pickStatus) => {
    const { api, window } = await loadUserscript({ pageReady: true, fastTimers: true });
    window.services.SBC.requestChallengesForSet = () => successfulObservable({
      success: true, data: { challenges: [{ id: 501, completed: false }] },
    });
    const context = { set: { id: 500 }, challengeId: 501, targetRating: 89, model: { constraints: [] } };
    const selectPending = vi.fn()
      .mockResolvedValueOnce({ status: 'missing' })
      .mockResolvedValueOnce({ status: pickStatus });
    const submitSquad = vi.fn(async () => ({ status: 'submitted', submitted: true }));
    const retryStorage = vi.fn(async () => ({ status: 'ready' }));
    const runtime = { coordinator: {
      reconcile: async () => ({ ok: true }),
      getLedger: () => ({
        classifiedEntries: () => [],
        summary: () => ({ capacities: { storage: { free: 0 } } }),
      }),
    } };
    const result = await api.runRollingGenericStorageSinkRecovery({ name: 'Rolling' }, runtime, {
      rewardKind: 'player-pick', loop: { name: 'Pressure Pick' },
    }, {
      selectPending, submitSquad, retryStorage,
      loadContexts: async () => ({
        status: 'ready', sinkDef: { name: 'Pressure Pick' }, contexts: [context],
        incompleteCount: 1, totalChallengeCount: 1, completedCount: 0,
      }),
      planSquad: async () => ({
        ok: true, plans: [{ selection: { selected: [], stats: {} } }], pileCounts: {},
        storageItemsConsumed: 11, details: { sourceOrder: ['storage'], maxClubPerSquad: 3 },
      }),
      validateHeadroom: () => ({ ok: true, projectedFree: 11, requiredFree: 1 }),
    });
    expect(submitSquad).toHaveBeenCalledOnce();
    expect(selectPending).toHaveBeenCalledTimes(2);
    expect(selectPending.mock.calls[1][3]).toMatchObject({ forceFresh: true, failOnUnexpected: true });
    expect(result.status).toBe(pickStatus === 'blocked' ? 'blocked' : 'submitted');
    expect(retryStorage).toHaveBeenCalledTimes(pickStatus === 'selected' ? 1 : 0);
  });

  it('invalidates Unassigned before discovering a delayed Storage sink Pick', async () => {
    const { api, window, inventoryPiles } = await loadUserscript({ pageReady: true, fastTimers: true });
    const pick = { id: 901, resourceId: 902, name: 'Item Pick', isPlayerPickItem: () => true };
    const reset = vi.fn(() => { inventoryPiles.unassigned.splice(0, 0, pick); });
    window.repositories.Item.unassigned = { reset };
    window.services.Item.requestUnassignedItems = () => successfulObservable();
    const result = await api.selectPendingRollingStorageSinkPick({ dryRun: true }, {}, {
      status: 'resolved',
      loop: { name: 'Pressure Pick', sbcSetIds: [903], pickItemResourceIds: [902] },
    }, { forceFresh: true, attempts: 1 });
    expect(reset).toHaveBeenCalled();
    expect(result.status).toBe('planned');
  });

  it.each([
    [4, 3, 'recover'],
    [8, 4, 'ready'],
    [3, 2, 'ready'],
    [4, 4, 'ready'],
  ])('checks the last Provisions batch before the main squad (%i -> %i)', async (before, after, status) => {
    const { api } = await loadUserscript();
    const items = Array.from({ length: before }, (_, index) => ({
      id: 100 + index, definitionId: 200 + index, rating: 87, rareflag: 1,
      type: 'player', tier: 'gold', rare: true, special: false, pile: 'club', endTime: -1,
    }));
    const snapshot = (club) => createInventorySnapshot({ piles: { club } });
    const runtime = { coordinator: { getLedger: () => ({
      classifiedEntries: () => items.map((item) => ({ item, pile: 'club', classification: {} })),
    }) } };
    const loop = {
      rollingProvisionsShortageRecoveryEnabled: true,
      rollingProvisionsUpgrade: {
        name: 'Provisions', activityResolved: true, sbcSetIds: [1300],
        requirements: [{ count: 4, tier: 'gold', playerOnly: true }],
      },
    };
    expect(api.forecastRollingProvisionsSupply(loop, runtime, snapshot(items), snapshot(items.slice(0, after))))
      .toMatchObject({ status, beforeCount: Math.min(4, before), afterCount: Math.min(4, after), requiredCount: 4 });
  });

  it('runs the last-batch check before the rating forecast without mutating inventory', async () => {
    const { api } = await loadUserscript();
    const snapshot = createInventorySnapshot({ piles: { club: Array.from({ length: 4 }, (_, index) => ({
      id: 100 + index, definitionId: 200 + index, rating: 87, type: 'player', rareflag: 1,
    })) } });
    const before = JSON.stringify(snapshot);
    const result = await api.forecastRollingPrimaryRunway({
      name: 'Rolling', rollingProvisionsShortageRecoveryEnabled: true,
      rollingProvisionsUpgrade: {
        name: 'Provisions', activityResolved: true, sbcSetIds: [1300],
        requirements: [{ count: 4, tier: 'gold', playerOnly: true }],
      },
    }, { coordinator: { getLedger: () => ({
      inventorySnapshot: () => snapshot,
      classifiedEntries: () => snapshot.piles.club.map((item) => ({ item, pile: 'club', classification: {} })),
    }) } }, {
      activeLoopDef: {}, fill: { model: { targetRating: 84 }, selection: { selected: [snapshot.piles.club[0]] } },
    });
    expect(result).toMatchObject({ status: 'recover', reasonCode: 'PROVISIONS_LAST_BATCH_AT_RISK', beforeCount: 4, afterCount: 3 });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it.each(['protected', 'required-special', 'other-special', 'duplicate-definition', 'over-cap', 'pending-signal'])('does not count %s as a fourth Provisions card', async (rejection) => {
    const { api } = await loadUserscript();
    const cards = Array.from({ length: 4 }, (_, index) => ({
      id: 100 + index, definitionId: 200 + index, rating: 87, type: 'player', rareflag: 1,
    }));
    if (rejection === 'duplicate-definition') cards[3].definitionId = cards[0].definitionId;
    if (rejection === 'over-cap') cards[3].rating = 89;
    if (rejection === 'required-special') cards[3].rareflag = 3;
    const snapshot = createInventorySnapshot({ piles: { club: cards } });
    const runtime = {
      primaryDuplicateRefs: rejection === 'pending-signal' ? [snapshot.piles.club[3].ref] : [],
      coordinator: { getLedger: () => ({ classifiedEntries: () => snapshot.piles.club.map((item, index) => ({
        item, pile: 'club', classification: {
          protected: index === 3 && rejection === 'protected',
          requiredSpecial: index === 3 && rejection === 'required-special',
          otherSpecial: index === 3 && rejection === 'other-special',
        },
      })) }) },
    };
    const result = api.forecastRollingProvisionsSupply({
      rollingProvisionsShortageRecoveryEnabled: true,
      rollingProvisionsUpgrade: {
        activityResolved: true, sbcSetIds: [1300],
        requirements: [{ count: 4, tier: 'gold', playerOnly: true, allowSpecial: true }],
      },
    }, runtime, snapshot, createInventorySnapshot({ piles: { club: cards.slice(1) } }));
    expect(result).toMatchObject({ status: 'ready', beforeCount: 3 });
  });

  function primaryLoop(overrides = {}) {
    return {
      id: 'rolling-upgrade-composite-860-850',
      name: '86x10 -> 85x10 Rolling Loop',
      rollingPrimaryComposite: true,
      rollingPrimaryStages: [
        {
          key: '86',
          setId: 860,
          challengeIds: [1861, 1862],
          rewardPackIds: [3860],
          dynamicRewardMinRating: 86,
        },
        {
          key: '85',
          setId: 850,
          challengeIds: [1851],
          rewardPackIds: [3850],
          dynamicRewardMinRating: 85,
          repeatability: 'unlimited',
        },
      ],
      ...overrides,
    };
  }

  it('persists only an exact primary reward journal with stable stage and Pack identity', async () => {
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const runtime = { activeRollingStageKey: '86' };
    const loop = primaryLoop();
    const result = api.queueRollingPendingPrimaryReward(
      runtime,
      loop,
      { submitted: true, rewardPackId: 3860, challengeRef: { id: 1862 } },
    );

    expect(result).toMatchObject({ submitted: true });
    expect(runtime.pendingPrimaryRewardJournal).toMatchObject({
      loopId: loop.id,
      stageKey: '86',
      setId: 860,
      challengeId: 1862,
      challengeIds: [1861, 1862],
      rewardPackId: 3860,
      persisted: true,
    });
    expect(userscriptValues.get(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toMatchObject({
      version: 1,
      loopId: loop.id,
      stageKey: '86',
      setId: 860,
      challengeId: 1862,
      challengeIds: [1861, 1862],
      rewardPackId: 3860,
    });
  });

  it('does not create a restart journal when the submit response has no stable Pack id', async () => {
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const runtime = { activeRollingStageKey: '86' };
    const loop = primaryLoop();
    api.queueRollingPendingPrimaryReward(runtime, loop, { submitted: true, rewardPackId: null });

    expect(runtime.pendingPrimaryRewardJournal.persisted).toBe(false);
    expect(userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(false);
  });

  it('restores a matching journal and rejects loop, stage, and Pack identity mismatches', async () => {
    const loop = primaryLoop();
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: {
        [ROLLING_PENDING_PRIMARY_REWARD_KEY]: {
          version: 1,
          loopId: loop.id,
          stageKey: '86',
          setId: 860,
          challengeId: 1862,
          challengeIds: [1861, 1862],
          rewardPackId: 3860,
          queuedAt: Date.now(),
        },
      },
    });

    expect(api.restoreRollingPendingPrimaryReward(loop)).toMatchObject({
      status: 'ready',
      stage: expect.objectContaining({ key: '86', setId: 860 }),
      journal: expect.objectContaining({ rewardPackId: 3860 }),
    });

    const wrongLoop = api.restoreRollingPendingPrimaryReward({ ...loop, id: 'other-loop' });
    expect(wrongLoop).toMatchObject({ status: 'blocked', reasonCode: 'PRIMARY_REWARD_JOURNAL_LOOP_MISMATCH' });
    expect(userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(false);

    userscriptValues.set(ROLLING_PENDING_PRIMARY_REWARD_KEY, {
      version: 1,
      loopId: loop.id,
      stageKey: '86',
      setId: 850,
      challengeId: 1862,
      challengeIds: [1861, 1862],
      rewardPackId: 3860,
      queuedAt: Date.now(),
    });
    expect(api.restoreRollingPendingPrimaryReward(loop)).toMatchObject({
      status: 'blocked',
      reasonCode: 'PRIMARY_REWARD_JOURNAL_STAGE_MISMATCH',
    });
  });

  it('fails closed and clears malformed or expired journals', async () => {
    const loop = primaryLoop();
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: {
        [ROLLING_PENDING_PRIMARY_REWARD_KEY]: { broken: true },
      },
    });
    expect(api.restoreRollingPendingPrimaryReward(loop)).toMatchObject({
      status: 'blocked',
      reasonCode: 'PRIMARY_REWARD_JOURNAL_INVALID',
    });
    expect(userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(false);

    userscriptValues.set(ROLLING_PENDING_PRIMARY_REWARD_KEY, {
      version: 1,
      loopId: loop.id,
      stageKey: '86',
      setId: 860,
      challengeId: 1862,
      challengeIds: [1861, 1862],
      rewardPackId: 3860,
      queuedAt: Date.now() - ROLLING_PENDING_PRIMARY_REWARD_MAX_AGE_MS - 1,
    });
    expect(api.restoreRollingPendingPrimaryReward(loop)).toMatchObject({
      status: 'blocked',
      reasonCode: 'PRIMARY_REWARD_JOURNAL_EXPIRED',
    });
    expect(userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(false);
  });

  it('clears the primary reward journal only after the exact reward is opened', async () => {
    const loop = primaryLoop();
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const runtime = {
      activeRollingStageKey: '86',
      pendingPrimaryReward: true,
      pendingRewardPackId: 3860,
      pendingRewardPackDefinition: loop,
    };
    api.queueRollingPendingPrimaryReward(runtime, loop, {
      submitted: true,
      rewardPackId: 3860,
      challengeRef: { id: 1862 },
    });
    expect(userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(true);
    expect(api.clearRollingPendingPrimaryReward(runtime)).toBe(true);
    expect(runtime).toMatchObject({
      pendingPrimaryReward: false,
      pendingRewardPackId: null,
      pendingRewardPackDefinition: null,
    });
    expect(userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(false);
  });

  it('clears an absent primary reward journal only after the user confirms the exact Pack is gone', async () => {
    const loop = primaryLoop();
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: {
        [ROLLING_PENDING_PRIMARY_REWARD_KEY]: {
          version: 1,
          loopId: loop.id,
          stageKey: '86',
          setId: 860,
          challengeId: 1862,
          challengeIds: [1861, 1862],
          rewardPackId: 3860,
          queuedAt: Date.now(),
        },
      },
    });
    const findRewardPack = vi.fn(async () => null);
    const confirm = vi.fn(async () => true);

    await expect(api.resolveRollingPendingPrimaryRewardJournal(loop, {
      findRewardPack,
      confirm,
    })).resolves.toMatchObject({ status: 'cleared', rewardPackId: 3860 });

    expect(findRewardPack).toHaveBeenCalledWith(expect.objectContaining({
      rewardPackIds: [3860],
    }), 3860, expect.objectContaining({
      attempts: 6,
      requireExactPackId: true,
    }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(false);
  });

  it('retains the primary reward journal when the exact Pack remains visible or confirmation is declined', async () => {
    const loop = primaryLoop();
    const journal = {
      version: 1,
      loopId: loop.id,
      stageKey: '86',
      setId: 860,
      challengeId: 1862,
      challengeIds: [1861, 1862],
      rewardPackId: 3860,
      queuedAt: Date.now(),
    };
    const first = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_PENDING_PRIMARY_REWARD_KEY]: journal },
    });
    const visiblePack = { id: 3860, name: '10x 86+ Rare Gold Players Pack' };

    await expect(first.api.resolveRollingPendingPrimaryRewardJournal(loop, {
      findRewardPack: vi.fn(async () => visiblePack),
      confirm: vi.fn(async () => true),
    })).resolves.toMatchObject({ status: 'preserved', rewardPackId: 3860 });
    expect(first.userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(true);

    const second = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_PENDING_PRIMARY_REWARD_KEY]: journal },
    });
    await expect(second.api.resolveRollingPendingPrimaryRewardJournal(loop, {
      findRewardPack: vi.fn(async () => null),
      confirm: vi.fn(async () => false),
    })).resolves.toMatchObject({ status: 'cancelled', rewardPackId: 3860 });
    expect(second.userscriptValues.has(ROLLING_PENDING_PRIMARY_REWARD_KEY)).toBe(true);
  });

  it('settles a deferred primary duplicate already normalized to Club', async () => {
    const normalizedClubItem = makePlayer({
      id: 931725349159,
      definitionId: 50564491,
      rating: 76,
      rareflag: 1,
      duplicate: false,
      name: 'Rahman Baba',
    });
    normalizedClubItem.pile = 'club';
    const { api, window, inventoryPiles } = await loadUserscript({
      club: [normalizedClubItem],
      pageReady: true,
      fastTimers: true,
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const deferredRef = {
      id: normalizedClubItem.id,
      definitionId: normalizedClubItem.definitionId,
      pile: 'unassigned',
    };
    const runtime = {
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };

    const result = await api.routeRollingDeferredPrimaryStorage(
      { name: '10x 85+ Upgrade Rolling Loop' },
      runtime,
      [deferredRef],
    );

    expect(result).toMatchObject({ status: 'ready', moved: 0 });
    expect(move).not.toHaveBeenCalled();
    expect(runtime.coordinator.reconcile).toHaveBeenCalledTimes(1);
  });

  it('keeps blocking a deferred primary duplicate that is still duplicate in Club', async () => {
    const unresolvedClubItem = makePlayer({
      id: 931725349159,
      definitionId: 50564491,
      rating: 76,
      rareflag: 1,
      duplicateId: 731725349159,
      name: 'Rahman Baba',
    });
    unresolvedClubItem.pile = 'club';
    const { api, window, inventoryPiles } = await loadUserscript({
      club: [unresolvedClubItem],
      pageReady: true,
      fastTimers: true,
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };

    const result = await api.routeRollingDeferredPrimaryStorage(
      { name: '10x 85+ Upgrade Rolling Loop' },
      runtime,
      [{
        id: unresolvedClubItem.id,
        definitionId: unresolvedClubItem.definitionId,
        pile: 'unassigned',
      }],
    );

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'OPENED_ITEM_ROUTING_PENDING',
    });
    expect(move).not.toHaveBeenCalled();
    expect(runtime.coordinator.reconcile).not.toHaveBeenCalled();
  });

  it('keeps blocking a normalized Club item while its definition still has an Unassigned duplicate', async () => {
    const normalizedClubItem = makePlayer({
      id: 931725349159,
      definitionId: 50564491,
      rating: 76,
      rareflag: 1,
      name: 'Rahman Baba',
    });
    normalizedClubItem.pile = 'club';
    const remainingDuplicate = makePlayer({
      id: 931725349171,
      definitionId: normalizedClubItem.definitionId,
      rating: 76,
      rareflag: 1,
      duplicateId: normalizedClubItem.id,
      name: 'Rahman Baba',
    });
    remainingDuplicate.pile = 'unassigned';
    const { api, window, inventoryPiles } = await loadUserscript({
      club: [normalizedClubItem],
      unassigned: [remainingDuplicate],
      pageReady: true,
      fastTimers: true,
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };

    const result = await api.routeRollingDeferredPrimaryStorage(
      { name: '10x 85+ Upgrade Rolling Loop' },
      runtime,
      [{
        id: normalizedClubItem.id,
        definitionId: normalizedClubItem.definitionId,
        pile: 'unassigned',
      }],
    );

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'OPENED_ITEM_ROUTING_PENDING',
    });
    expect(move).not.toHaveBeenCalled();
    expect(runtime.coordinator.reconcile).not.toHaveBeenCalled();
  });

  it('counts only confirmed Storage Pressure and TOTW SBC submissions', async () => {
    const { api } = await loadUserscript({ pageReady: true, fastTimers: true });
    const runtime = {
      telemetryActive: false,
      storagePressureSbcCount: 0,
      totwSbcCount: 0,
    };
    const loopDef = { maxCompletions: 0, name: '10x85+ Rolling Loop' };

    expect(api.recordRollingSbcSubmissionResult(
      runtime,
      loopDef,
      'storage-pressure',
      { status: 'planned', submitted: false },
    )).toBe(0);
    expect(runtime.storagePressureSbcCount).toBe(0);
    expect(api.recordRollingSbcSubmissionResult(
      runtime,
      loopDef,
      'storage-pressure',
      { status: 'submitted', submitted: true },
    )).toBe(1);
    expect(api.recordRollingSbcSubmissionResult(
      runtime,
      loopDef,
      'storage-pressure',
      { status: 'submitted', submitted: true },
    )).toBe(2);
    expect(api.recordRollingSbcSubmissionResult(
      runtime,
      loopDef,
      'totw',
      { status: 'submitted', submitted: true },
    )).toBe(1);
    expect(api.recordRollingSbcSubmissionResult(
      runtime,
      loopDef,
      'totw',
      { status: 'blocked', submitted: false },
    )).toBe(1);
    expect(runtime).toMatchObject({ storagePressureSbcCount: 2, totwSbcCount: 1 });
  });

  it('persists a submitted TOTW recovery reward so restart can open it before the primary loop', async () => {
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const runtime = { pendingRecoveryReward: null };
    const loopDef = { id: 'rolling-upgrade-900-85', name: '10x85+ Rolling Loop' };
    const definition = {
      name: '84+ TOTW Upgrade',
      dynamicSbcFamily: 'totw-upgrade',
    };

    const result = api.queueRollingPendingRequiredSpecialReward(
      runtime,
      loopDef,
      definition,
      { status: 'submitted', submitted: true, rewardPackId: 20707 },
    );

    expect(result).toMatchObject({ submitted: true });
    expect(runtime.pendingRecoveryReward).toMatchObject({
      rewardPackId: 20707,
      loopId: loopDef.id,
      persisted: true,
    });
    expect(userscriptValues.get(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY)).toMatchObject({
      version: 1,
      loopId: loopDef.id,
      rewardPackId: 20707,
    });

    api.clearRollingPendingRequiredSpecialReward(runtime);
    expect(runtime.pendingRecoveryReward).toBeNull();
    expect(userscriptValues.has(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY)).toBe(false);
  });

  it('detects one pre-journal TOTW reward from the live My Packs repository on startup', async () => {
    const rewardPack = { id: 20707, name: '84+ TOTW Player Pack' };
    const { api } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      packs: [rewardPack],
    });
    const runtime = { pendingRecoveryReward: null };
    const loopDef = {
      id: 'rolling-upgrade-900-85',
      name: '10x85+ Rolling Loop',
      rollingTotwUpgrade: {
        name: '84+ TOTW Upgrade',
        dynamicSbcFamily: 'totw-upgrade',
        activityResolved: true,
        sbcSetIds: [20841],
        rewardPackIds: [20707],
      },
    };

    expect(await api.detectRollingPendingRequiredSpecialReward(loopDef, runtime)).toBe(true);
    expect(runtime.pendingRecoveryReward).toMatchObject({
      definition: expect.objectContaining({ dynamicSbcFamily: 'totw-upgrade' }),
      rewardPackId: null,
      detectedExisting: true,
    });

  });

  it('clears a stale Required Special reward journal when reconciled Storage already has eligible material', async () => {
    const requiredSpecial = makePlayer({
      id: 8101,
      definitionId: 98101,
      rating: 87,
      rareflag: 120,
      groups: [44, 83],
      name: 'Recovered TOTW',
    });
    requiredSpecial.pile = 'storage';
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const loopDef = { id: 'rolling-upgrade-900-85', name: '10x85+ Rolling Loop' };
    const definition = { name: '84+ TOTW Upgrade', dynamicSbcFamily: 'totw-upgrade' };
    const reconcile = vi.fn(async () => ({ ok: true }));
    const runtime = {
      pendingRecoveryReward: null,
      coordinator: {
        reconcile,
        getLedger: () => ({
          classifiedEntries: () => [{
            item: requiredSpecial,
            pile: 'storage',
            classification: { requiredSpecial: true, protected: false },
          }],
        }),
      },
    };
    api.queueRollingPendingRequiredSpecialReward(
      runtime,
      loopDef,
      definition,
      { status: 'submitted', submitted: true, rewardPackId: 20707 },
    );

    await expect(api.reconcileRollingPendingRequiredSpecialReward(
      loopDef,
      runtime,
    )).resolves.toMatchObject({
      status: 'skipped',
      reasonCode: 'RECOVERY_REWARD_ALREADY_MATERIALIZED',
      details: { eligibleRequiredSpecialCount: 1 },
    });
    expect(reconcile).toHaveBeenCalledWith(
      '10x85+ Rolling Loop pending Required Special reward inventory check',
      { refreshUnassigned: true },
    );
    expect(runtime.pendingRecoveryReward).toBeNull();
    expect(userscriptValues.has(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY)).toBe(false);
  });

  it('keeps a recent Required Special reward journal when reconciliation finds only protected material', async () => {
    const protectedSpecial = makePlayer({
      id: 8102,
      definitionId: 98102,
      rating: 97,
      rareflag: 120,
      groups: [44, 83],
    });
    protectedSpecial.pile = 'storage';
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const loopDef = { id: 'rolling-upgrade-900-85', name: '10x85+ Rolling Loop' };
    const definition = { name: '84+ TOTW Upgrade', dynamicSbcFamily: 'totw-upgrade' };
    const runtime = {
      pendingRecoveryReward: null,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          classifiedEntries: () => [{
            item: protectedSpecial,
            pile: 'storage',
            classification: { requiredSpecial: true, protected: true },
          }],
        }),
      },
    };
    api.queueRollingPendingRequiredSpecialReward(
      runtime,
      loopDef,
      definition,
      { status: 'submitted', submitted: true, rewardPackId: 20707 },
    );

    await expect(api.reconcileRollingPendingRequiredSpecialReward(
      loopDef,
      runtime,
    )).resolves.toBeNull();
    expect(runtime.pendingRecoveryReward).toMatchObject({ rewardPackId: 20707 });
    expect(userscriptValues.has(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY)).toBe(true);
  });

  it('expires a persisted Required Special reward journal after 24 hours with no pack or eligible material', async () => {
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const loopDef = { id: 'rolling-upgrade-900-85', name: '10x85+ Rolling Loop' };
    const definition = { name: '84+ TOTW Upgrade', dynamicSbcFamily: 'totw-upgrade' };
    const queuedAt = Date.now() - ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_MAX_AGE_MS - 1000;
    const runtime = {
      pendingRecoveryReward: {
        definition,
        rewardPackId: 20707,
        loopId: loopDef.id,
        queuedAt,
        persisted: true,
      },
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };
    userscriptValues.set(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY, {
      version: 1,
      loopId: loopDef.id,
      rewardPackId: 20707,
      queuedAt,
    });

    await expect(api.reconcileRollingPendingRequiredSpecialReward(
      loopDef,
      runtime,
    )).resolves.toMatchObject({
      status: 'replan',
      reasonCode: 'RECOVERY_REWARD_JOURNAL_EXPIRED',
      details: {
        maxAgeSeconds: ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_MAX_AGE_MS / 1000,
      },
    });
    expect(runtime.pendingRecoveryReward).toBeNull();
    expect(userscriptValues.has(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY)).toBe(false);
  });

  it('keeps a recent persisted Required Special reward journal when the pack and material are not visible yet', async () => {
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const loopDef = { id: 'rolling-upgrade-900-85', name: '10x85+ Rolling Loop' };
    const definition = { name: '84+ TOTW Upgrade', dynamicSbcFamily: 'totw-upgrade' };
    const queuedAt = Date.now() - ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_MAX_AGE_MS + 1000;
    const runtime = {
      pendingRecoveryReward: {
        definition,
        rewardPackId: 20707,
        loopId: loopDef.id,
        queuedAt,
        persisted: true,
      },
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };
    userscriptValues.set(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY, {
      version: 1,
      loopId: loopDef.id,
      rewardPackId: 20707,
      queuedAt,
    });

    await expect(api.reconcileRollingPendingRequiredSpecialReward(
      loopDef,
      runtime,
    )).resolves.toBeNull();
    expect(runtime.pendingRecoveryReward).toMatchObject({ queuedAt, persisted: true });
    expect(userscriptValues.has(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY)).toBe(true);
  });

  it('keeps an expired Required Special reward journal when live inventory reconciliation fails', async () => {
    const { api, userscriptValues } = await loadUserscript({ pageReady: true, fastTimers: true });
    const loopDef = { id: 'rolling-upgrade-900-85', name: '10x85+ Rolling Loop' };
    const definition = { name: '84+ TOTW Upgrade', dynamicSbcFamily: 'totw-upgrade' };
    const queuedAt = Date.now() - ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_MAX_AGE_MS - 1000;
    const runtime = {
      pendingRecoveryReward: {
        definition,
        rewardPackId: 20707,
        loopId: loopDef.id,
        queuedAt,
        persisted: true,
      },
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: false, reason: 'inventory unavailable' })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };
    userscriptValues.set(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY, {
      version: 1,
      loopId: loopDef.id,
      rewardPackId: 20707,
      queuedAt,
    });

    await expect(api.reconcileRollingPendingRequiredSpecialReward(
      loopDef,
      runtime,
    )).resolves.toBeNull();
    expect(runtime.pendingRecoveryReward).toMatchObject({ queuedAt, persisted: true });
    expect(userscriptValues.has(ROLLING_PENDING_REQUIRED_SPECIAL_REWARD_KEY)).toBe(true);
  });

  it('blocks an overlooked duplicate before any native move or journal when swaps are disabled', async () => {
    const signal = makePlayer({
      id: 91,
      definitionId: 9091,
      rating: 87,
      rareflag: 1,
      duplicate: true,
      duplicateId: 92,
      untradeable: true,
    });
    signal.pile = 'unassigned';
    const counterpart = makePlayer({
      id: 92,
      definitionId: 9091,
      rating: 87,
      rareflag: 1,
      untradeable: true,
    });
    counterpart.pile = 'club';
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [counterpart],
      unassigned: [signal],
    });
    const move = vi.fn(() => successfulObservable());
    window.services = { Item: { move } };
    const runtime = {
      duplicateSwapEnabled: false,
      duplicateMaterializationTransaction: null,
    };

    const result = await api.prepareRollingUntradeableDuplicateSwaps({
      label: 'Rolling duplicate switch guard',
      players: [counterpart],
      squadPlan: {
        selection: {
          entries: [{ pileName: 'unassigned', signal, item: counterpart }],
        },
      },
    }, runtime);

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'DUPLICATE_SWAP_DISABLED',
    });
    expect(move).not.toHaveBeenCalled();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(inventoryPiles.club).toEqual([counterpart]);
    expect(inventoryPiles.unassigned).toEqual([signal]);
  });

  it('directly consumes only an exact authorized Pressure Provisions counterpart when swaps are disabled', async () => {
    const signal = makePlayer({
      id: 93,
      definitionId: 9093,
      rating: 88,
      rareflag: 1,
      duplicate: true,
      duplicateId: 94,
    });
    signal.pile = 'unassigned';
    const counterpart = makePlayer({
      id: 94,
      definitionId: 9093,
      rating: 88,
      rareflag: 1,
    });
    counterpart.pile = 'club';
    const { api, window, userscriptValues } = await loadUserscript({
      club: [counterpart],
      unassigned: [signal],
    });
    const move = vi.fn(() => successfulObservable());
    window.services = { Item: { move } };
    const runtime = {
      duplicateSwapEnabled: false,
      duplicateMaterializationTransaction: null,
      openRouting: { storageItems: [signal] },
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [{
            item: counterpart,
            pile: 'club',
            classification: { protected: false, requiredSpecial: false },
          }],
        }),
      },
    };

    const result = await api.prepareRollingUntradeableDuplicateSwaps({
      label: 'Pressure Provisions authorized duplicate',
      players: [counterpart],
      squadPlan: {
        selection: {
          entries: [{ pileName: 'unassigned', signal, item: counterpart }],
        },
      },
    }, runtime, {
      allowAuthorizedPendingDuplicateConsumption: true,
      allowedPendingUnassignedRefs: [signal],
      allowedRatings: [87, 88],
      loopDef: { name: 'Pressure Provisions', runtimeProtectionRating: 95 },
    });

    expect(result).toMatchObject({ ok: true, swaps: [] });
    expect(move).not.toHaveBeenCalled();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
  });

  it.each([
    ['rating outside the configured reserve range', { targetRating: 89 }],
    ['special-card identity', { rareflag: 22 }],
    ['different card version', { definitionId: 9995 }],
    ['protected Club counterpart', { protected: true }],
    ['Evolution state', { evolutionId: 9 }],
    ['cosmetic state', { cosmetics: [{ id: 7 }] }],
    ['missing live signal', { removeSignal: true }],
    ['changed duplicate target identity', { duplicateId: 9996 }],
  ])('blocks authorized Pressure Provisions consumption with %s', async (_label, mutation) => {
    const signal = makePlayer({
      id: 95,
      definitionId: 9095,
      rating: 88,
      rareflag: mutation.rareflag || 1,
      duplicate: true,
      duplicateId: mutation.duplicateId || 96,
    });
    signal.pile = 'unassigned';
    const counterpart = makePlayer({
      id: 96,
      definitionId: mutation.definitionId || 9095,
      rating: mutation.targetRating || 88,
      rareflag: mutation.rareflag || 1,
      evolutionId: mutation.evolutionId,
      cosmetics: mutation.cosmetics,
    });
    counterpart.pile = 'club';
    const { api, window } = await loadUserscript({
      club: [counterpart],
      unassigned: mutation.removeSignal ? [] : [signal],
    });
    const move = vi.fn(() => successfulObservable());
    window.services = { Item: { move } };
    const runtime = {
      duplicateSwapEnabled: false,
      duplicateMaterializationTransaction: null,
      openRouting: { storageItems: [signal] },
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [{
            item: counterpart,
            pile: 'club',
            classification: {
              protected: mutation.protected === true,
              requiredSpecial: false,
            },
          }],
        }),
      },
    };

    const result = await api.prepareRollingUntradeableDuplicateSwaps({
      label: 'Pressure Provisions invalid authorized duplicate',
      players: [counterpart],
      squadPlan: {
        selection: {
          entries: [{ pileName: 'unassigned', signal, item: counterpart }],
        },
      },
    }, runtime, {
      allowAuthorizedPendingDuplicateConsumption: true,
      allowedPendingUnassignedRefs: [signal],
      allowedRatings: [87, 88],
      loopDef: { name: 'Pressure Provisions', runtimeProtectionRating: 95 },
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'AUTHORIZED_PENDING_DUPLICATE_INVALID',
    });
    expect(move).not.toHaveBeenCalled();
  });

  it('keeps native swap eligibility checks active when the experimental swap switch is enabled', async () => {
    const signal = makePlayer({
      id: 101,
      definitionId: 9101,
      rating: 88,
      rareflag: 1,
      duplicate: true,
      duplicateId: 102,
    });
    signal.pile = 'unassigned';
    const counterpart = makePlayer({ id: 102, definitionId: 9101, rating: 88, rareflag: 1 });
    counterpart.pile = 'club';
    const { api, window } = await loadUserscript({ club: [counterpart], unassigned: [signal] });
    const move = vi.fn(() => successfulObservable());
    window.services.Item.move = move;
    const runtime = {
      duplicateSwapEnabled: true,
      duplicateSwapMode: 'safe-only',
      duplicateMaterializationTransaction: null,
      openRouting: { storageItems: [signal] },
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          classifiedEntries: () => [{
            item: counterpart,
            pile: 'club',
            classification: { protected: false, requiredSpecial: false },
          }],
          summary: () => ({ inventoryVersion: 1 }),
        }),
      },
    };

    const result = await api.prepareRollingUntradeableDuplicateSwaps({
      label: 'Pressure Provisions swap-enabled duplicate',
      players: [counterpart],
      set: { id: 200 },
      challenge: { id: 201 },
      squadPlan: {
        selection: {
          entries: [{ pileName: 'unassigned', signal, item: counterpart }],
        },
      },
    }, runtime, {
      allowAuthorizedPendingDuplicateConsumption: true,
      allowedPendingUnassignedRefs: [signal],
      allowedRatings: [87, 88],
      loopDef: { name: 'Pressure Provisions', runtimeProtectionRating: 95 },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'controlled duplicate swap value fingerprint is incomplete',
    });
    expect(move).not.toHaveBeenCalled();
  });

  it('still blocks a mixed unauthorized duplicate while allowing no partial bypass', async () => {
    const allowedSignal = makePlayer({
      id: 97,
      definitionId: 9097,
      rating: 87,
      rareflag: 1,
      duplicate: true,
      duplicateId: 98,
    });
    allowedSignal.pile = 'unassigned';
    const allowedTarget = makePlayer({ id: 98, definitionId: 9097, rating: 87, rareflag: 1 });
    allowedTarget.pile = 'club';
    const blockedSignal = makePlayer({
      id: 99,
      definitionId: 9099,
      rating: 87,
      rareflag: 1,
      duplicate: true,
      duplicateId: 100,
    });
    blockedSignal.pile = 'unassigned';
    const blockedTarget = makePlayer({ id: 100, definitionId: 9099, rating: 87, rareflag: 1 });
    blockedTarget.pile = 'club';
    const { api, window, userscriptValues } = await loadUserscript({
      club: [allowedTarget, blockedTarget],
      unassigned: [allowedSignal, blockedSignal],
    });
    const move = vi.fn(() => successfulObservable());
    window.services = { Item: { move } };
    const runtime = {
      duplicateSwapEnabled: false,
      duplicateMaterializationTransaction: null,
      openRouting: { storageItems: [allowedSignal, blockedSignal] },
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [allowedTarget, blockedTarget].map((item) => ({
            item,
            pile: 'club',
            classification: { protected: false, requiredSpecial: false },
          })),
        }),
      },
    };

    const result = await api.prepareRollingUntradeableDuplicateSwaps({
      label: 'Pressure Provisions mixed duplicate authorization',
      players: [allowedTarget, blockedTarget],
      squadPlan: {
        selection: {
          entries: [
            { pileName: 'unassigned', signal: allowedSignal, item: allowedTarget },
            { pileName: 'unassigned', signal: blockedSignal, item: blockedTarget },
          ],
        },
      },
    }, runtime, {
      allowAuthorizedPendingDuplicateConsumption: true,
      allowedPendingUnassignedRefs: [allowedSignal],
      allowedRatings: [87, 88],
      loopDef: { name: 'Pressure Provisions', runtimeProtectionRating: 95 },
    });

    expect(result).toMatchObject({ ok: false, reasonCode: 'DUPLICATE_SWAP_DISABLED' });
    expect(move).not.toHaveBeenCalled();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('reuses the exact reverse duplicate signal after native swap without starting another swap', async () => {
    const { transaction, consume, displaced } = materializedDuplicateTransaction();
    consume.tradeable = false;
    displaced.tradeable = false;
    displaced.duplicateId = consume.id;
    const { api } = await loadUserscript({
      club: [consume],
      unassigned: [displaced],
    });
    const runtime = {
      duplicateSwapEnabled: true,
      duplicateMaterializationTransaction: transaction,
    };

    const result = await api.prepareRollingUntradeableDuplicateSwaps({
      label: 'Rolling reverse signal replan',
      players: [consume],
      squadPlan: {
        selection: {
          entries: [{ pileName: 'unassigned', signal: displaced, item: consume }],
        },
      },
    }, runtime);

    expect(result).toMatchObject({
      ok: true,
      changed: false,
      transactionReused: true,
      details: { matchedSwapCount: 1 },
    });
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
  });

  it('starts ready without a persisted duplicate journal', async () => {
    const { api } = await loadUserscript({ pageReady: true, fastTimers: true });
    const runtime = {
      duplicateMaterializationTransaction: api.readPersistedRollingDuplicateTransaction(),
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: () => null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'No journal');

    expect(result).toEqual({ status: 'ready' });
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(runtime.coordinator.reconcile).not.toHaveBeenCalled();
  });

  it('recovers an interrupted unrecorded swap from one exact Unassigned fingerprint match', async () => {
    const { transaction, materializedConsume, displacedCounterpart } = interruptedUnrecordedDuplicateTransaction();
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [materializedConsume],
      unassigned: [displacedCounterpart],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const moves = [];
    installInventoryRecoveryService(window, inventoryPiles, (item, destination) => {
      moves.push({ id: item.id, destination });
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displacedCounterpart), 1);
      inventoryPiles.club.splice(inventoryPiles.club.indexOf(materializedConsume), 1);
      displacedCounterpart.pile = 'club';
      materializedConsume.pile = 'unassigned';
      inventoryPiles.club.push(displacedCounterpart);
      inventoryPiles.unassigned.push(materializedConsume);
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: { reconcile: vi.fn(async () => ({ ok: true })) },
    };

    const result = await api.recoverPersistedRollingDuplicateTransaction(runtime, 'Interrupted swap');

    expect(result).toEqual({ status: 'ready' });
    expect(moves).toEqual([{ id: 102, destination: 'club' }]);
    expect(inventoryPiles.club).toEqual([displacedCounterpart]);
    expect(inventoryPiles.unassigned).toEqual([materializedConsume]);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('clears the legacy ambiguous journal after the protected card was already restored exactly', async () => {
    const { transaction, materializedConsume, displacedCounterpart } = interruptedUnrecordedDuplicateTransaction();
    const legacyAmbiguous = transitionDuplicateMaterializationTransaction(
      transaction,
      'ambiguous',
      { reason: 'interrupted swap was restored without a confirmed materialized consume item identity' },
    );
    displacedCounterpart.pile = 'club';
    materializedConsume.pile = 'unassigned';
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [displacedCounterpart],
      unassigned: [materializedConsume],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: legacyAmbiguous },
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      duplicateMaterializationTransaction: legacyAmbiguous,
      coordinator: { reconcile: vi.fn(async () => ({ ok: true })) },
    };

    const result = await api.recoverPersistedRollingDuplicateTransaction(runtime, 'Legacy restored swap');

    expect(result).toEqual({ status: 'ready' });
    expect(move).not.toHaveBeenCalled();
    expect(inventoryPiles.club).toEqual([displacedCounterpart]);
    expect(inventoryPiles.unassigned).toEqual([materializedConsume]);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('clears a legacy ambiguous journal after the exact source was safely routed to Storage', async () => {
    const { transaction, source, displacedCounterpart } = interruptedUnrecordedDuplicateTransaction();
    const legacyAmbiguous = transitionDuplicateMaterializationTransaction(
      transaction,
      'ambiguous',
      { reason: 'planned duplicate materialization journal has ambiguous inventory state' },
    );
    source.pile = 'storage';
    displacedCounterpart.pile = 'club';
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [displacedCounterpart],
      storage: [source],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: legacyAmbiguous },
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      duplicateMaterializationTransaction: legacyAmbiguous,
      coordinator: { reconcile: vi.fn(async () => ({ ok: true })) },
    };

    const result = await api.recoverPersistedRollingDuplicateTransaction(runtime, 'Safely stored source');

    expect(result).toEqual({ status: 'ready' });
    expect(move).not.toHaveBeenCalled();
    expect(inventoryPiles.club).toEqual([displacedCounterpart]);
    expect(inventoryPiles.storage).toEqual([source]);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('clears the safely stored legacy source when EA normalized only its loyalty bonus', async () => {
    const { transaction, source, displacedCounterpart } = interruptedUnrecordedDuplicateTransaction();
    source.loyaltyBonus = 1;
    const journalWithLoyalty = createDuplicateMaterializationTransaction({
      ...transaction,
      pairs: [{ sourceSignal: source, protectedCounterpart: displacedCounterpart }],
    });
    const legacyAmbiguous = transitionDuplicateMaterializationTransaction(
      journalWithLoyalty,
      'ambiguous',
      { reason: 'planned duplicate materialization journal has ambiguous inventory state' },
    );
    source.pile = 'storage';
    source.loyaltyBonus = 0;
    displacedCounterpart.pile = 'club';
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [displacedCounterpart],
      storage: [source],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: legacyAmbiguous },
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      duplicateMaterializationTransaction: legacyAmbiguous,
      coordinator: { reconcile: vi.fn(async () => ({ ok: true })) },
    };

    const result = await api.recoverPersistedRollingDuplicateTransaction(
      runtime,
      'Loyalty-normalized stored source',
    );

    expect(result).toEqual({ status: 'ready' });
    expect(move).not.toHaveBeenCalled();
    expect(inventoryPiles.club).toEqual([displacedCounterpart]);
    expect(inventoryPiles.storage).toEqual([source]);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('keeps the journal blocked when an interrupted unrecorded swap has two fingerprint matches', async () => {
    const { transaction, materializedConsume, displacedCounterpart } = interruptedUnrecordedDuplicateTransaction();
    const secondCandidate = { ...materializedConsume, id: 104, pile: 'unassigned' };
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [materializedConsume],
      unassigned: [displacedCounterpart, secondCandidate],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    installInventoryRecoveryService(window, inventoryPiles, () => {
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displacedCounterpart), 1);
      inventoryPiles.club.splice(inventoryPiles.club.indexOf(materializedConsume), 1);
      displacedCounterpart.pile = 'club';
      materializedConsume.pile = 'unassigned';
      inventoryPiles.club.push(displacedCounterpart);
      inventoryPiles.unassigned.push(materializedConsume);
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: { reconcile: vi.fn(async () => ({ ok: true })) },
    };

    const result = await api.recoverPersistedRollingDuplicateTransaction(runtime, 'Ambiguous swap');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_MATERIALIZATION_COMPENSATION_BLOCKED',
    });
    expect(result.reason).toContain('could not uniquely identify');
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'recovery-required' });
    expect(userscriptValues.get(ROLLING_DUPLICATE_TRANSACTION_KEY)).toMatchObject({ status: 'recovery-required' });
  });

  it('does not restore an interrupted protected counterpart whose value fingerprint changed', async () => {
    const { transaction, materializedConsume, displacedCounterpart } = interruptedUnrecordedDuplicateTransaction();
    displacedCounterpart.playStyle = 250;
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [materializedConsume],
      unassigned: [displacedCounterpart],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: { reconcile: vi.fn(async () => ({ ok: true })) },
    };

    const result = await api.recoverPersistedRollingDuplicateTransaction(runtime, 'Changed protected card');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS',
    });
    expect(result.reason).toContain('changed value identity');
    expect(move).not.toHaveBeenCalled();
    expect(userscriptValues.get(ROLLING_DUPLICATE_TRANSACTION_KEY)).toMatchObject({ status: 'ambiguous' });
  });

  it('cancels a prior-run transaction even when new duplicate swaps are disabled', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [],
      unassigned: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    installInventoryRecoveryService(window, inventoryPiles, () => {
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displaced), 1);
      displaced.pile = 'club';
      inventoryPiles.club.push(displaced);
    });
    const runtime = {
      duplicateSwapEnabled: false,
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: ({ id }) => id === displaced.id ? displaced : null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Unknown submission');

    expect(result).toEqual({ status: 'ready' });
    expect(inventoryPiles.club).toEqual([displaced]);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('clears an ambiguous prior-run journal from reconciled Ledger when Repository omits the restored Club card', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    const ambiguous = transitionDuplicateMaterializationTransaction(transaction, 'ambiguous', {
      reason: 'submission outcome is unknown from a prior run',
    });
    displaced.pile = 'club';
    const { api, userscriptValues } = await loadUserscript({
      club: [],
      unassigned: [],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: ambiguous },
    });
    const runtime = {
      duplicateMaterializationTransaction: ambiguous,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          resolveItem: ({ id }) => id === displaced.id ? displaced : null,
        }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Ledger-only restored transaction');

    expect(result).toEqual({ status: 'ready' });
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it.each(['storage', 'transfer'])('keeps a prior-run protected ID in %s and clears the journal', async (pile) => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    displaced.pile = pile;
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      [pile]: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: ({ id }) => id === displaced.id ? displaced : null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, `Protected in ${pile}`);

    expect(result).toEqual({ status: 'ready' });
    expect(move).not.toHaveBeenCalled();
    expect(displaced.pile).toBe(pile);
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('warns and clears when a prior-run protected ID no longer exists in any pile', async () => {
    const { transaction } = materializedDuplicateTransaction();
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: () => null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Missing protected identity');

    expect(result).toEqual({ status: 'ready' });
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('restores an exact prior-run protected ID even when its definition changed', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    displaced.definitionId = 7999;
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      unassigned: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    installInventoryRecoveryService(window, inventoryPiles, () => {
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displaced), 1);
      displaced.pile = 'club';
      inventoryPiles.club.push(displaced);
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: ({ id }) => id === displaced.id ? displaced : null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Changed definition');

    expect(result).toEqual({ status: 'ready' });
    expect(displaced).toMatchObject({ id: 102, definitionId: 7999, pile: 'club' });
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('clears a malformed persisted journal instead of retrying it forever', async () => {
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: { broken: true } },
    });
    const invalid = api.readPersistedRollingDuplicateTransaction();
    const runtime = {
      duplicateMaterializationTransaction: invalid,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: () => null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Malformed journal');

    expect(invalid).toMatchObject({ status: 'invalid', pairs: [] });
    expect(result).toEqual({ status: 'ready' });
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('discards a malformed journal before inventory reconciliation', async () => {
    const { api } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: { broken: true } },
    });
    const runtime = {
      duplicateMaterializationTransaction: api.readPersistedRollingDuplicateTransaction(),
      coordinator: { reconcile: vi.fn(async () => ({ ok: false, reason: 'inventory unavailable' })) },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Malformed before inventory');

    expect(result).toEqual({ status: 'ready' });
    expect(runtime.coordinator.reconcile).not.toHaveBeenCalled();
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
  });

  it('blocks a valid prior-run journal when initial inventory reconciliation fails', async () => {
    const { transaction } = materializedDuplicateTransaction();
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: { reconcile: vi.fn(async () => ({ ok: false, reason: 'inventory unavailable' })) },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Inventory unavailable');

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'inventory unavailable',
      reasonCode: 'INVENTORY_RECONCILIATION_FAILED',
    });
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('blocks and retains a valid journal when initial inventory reconciliation throws', async () => {
    const { transaction } = materializedDuplicateTransaction();
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: { reconcile: vi.fn(async () => { throw new Error('ledger crashed'); }) },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Inventory exception');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'INVENTORY_RECONCILIATION_FAILED',
    });
    expect(result.reason).toContain('ledger crashed');
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('blocks when reconciled inventory returns a different item for the protected ID', async () => {
    const { transaction } = materializedDuplicateTransaction();
    const wrongItem = { id: 999, definitionId: 7001, pile: 'club' };
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: () => wrongItem }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Untrusted inventory');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_STARTUP_INVENTORY_UNTRUSTWORTHY',
    });
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('blocks and retains the journal when reconciliation returns without a usable Ledger', async () => {
    const { transaction } = materializedDuplicateTransaction();
    const { api, userscriptValues } = await loadUserscript({
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => null,
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Missing Ledger');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_STARTUP_INVENTORY_UNTRUSTWORTHY',
    });
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('blocks when Ledger sees the protected ID in Unassigned but its live EA entity is unavailable', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    const { api, userscriptValues } = await loadUserscript({
      unassigned: [],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: ({ id }) => id === displaced.id ? displaced : null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Missing live entity');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_STARTUP_PROTECTED_ENTITY_UNAVAILABLE',
    });
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('blocks and retains the journal when prior-run protected restoration throws', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      unassigned: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    installInventoryRecoveryService(window, inventoryPiles, () => {
      throw new Error('EA move rejected');
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: ({ id }) => id === displaced.id ? displaced : null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Restore rejected');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_STARTUP_PROTECTED_RESTORE_FAILED',
    });
    expect(result.reason).toContain('EA move rejected');
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('blocks when a prior-run restoration cannot be reconciled in Club', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    const staleLedgerItem = { ...displaced };
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      unassigned: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    installInventoryRecoveryService(window, inventoryPiles, () => {
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displaced), 1);
      displaced.pile = 'club';
      inventoryPiles.club.push(displaced);
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: ({ id }) => id === staleLedgerItem.id ? staleLedgerItem : null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Unverified restore');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_STARTUP_PROTECTED_RESTORE_UNVERIFIED',
    });
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('blocks after safe startup classification when journal deletion is unavailable', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    displaced.pile = 'club';
    const { api, userscriptValues } = await loadUserscript({
      club: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
      gmDeleteValue: null,
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ resolveItem: ({ id }) => id === displaced.id ? displaced : null }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Journal deletion unavailable');

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_JOURNAL_CLEAR_FAILED',
    });
    expect(runtime.duplicateMaterializationTransaction).toBe(transaction);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('restores only Unassigned protected IDs in a mixed multi-pair prior run and then clears it', async () => {
    const makePair = (sourceId, protectedId, definitionId) => ({
      sourceSignal: {
        id: sourceId,
        definitionId,
        rating: 90,
        rareflag: 64,
        pile: 'unassigned',
      },
      protectedCounterpart: {
        id: protectedId,
        definitionId,
        rating: 90,
        rareflag: 64,
        pile: 'club',
      },
    });
    const transaction = createDuplicateMaterializationTransaction({
      transactionId: 'tx-startup-mixed-runtime',
      challengeRef: { setId: 500, challengeId: 501 },
      pairs: [
        makePair(101, 102, 7001),
        makePair(201, 202, 7002),
        makePair(301, 302, 7003),
        makePair(401, 402, 7004),
      ],
    });
    const inClub = { id: 102, definitionId: 7001, pile: 'club' };
    const inUnassigned = { id: 202, definitionId: 7002, pile: 'unassigned' };
    const inStorage = { id: 302, definitionId: 7003, pile: 'storage' };
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [inClub],
      unassigned: [inUnassigned],
      storage: [inStorage],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const move = vi.fn((item) => {
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(item), 1);
      item.pile = 'club';
      inventoryPiles.club.push(item);
    });
    installInventoryRecoveryService(window, inventoryPiles, move);
    const items = [inClub, inUnassigned, inStorage];
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          resolveItem: ({ id }) => items.find((item) => item.id === id) || null,
        }),
      },
    };

    const result = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Mixed prior run');

    expect(result).toEqual({ status: 'ready' });
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0][0]).toBe(inUnassigned);
    expect(inClub.pile).toBe('club');
    expect(inUnassigned.pile).toBe('club');
    expect(inStorage.pile).toBe('storage');
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('resumes a partially restored multi-pair cancellation from actual piles on the next run', async () => {
    const makePair = (sourceId, protectedId, definitionId) => ({
      sourceSignal: { id: sourceId, definitionId, rating: 90, rareflag: 64, pile: 'unassigned' },
      protectedCounterpart: { id: protectedId, definitionId, rating: 90, rareflag: 64, pile: 'club' },
    });
    const transaction = createDuplicateMaterializationTransaction({
      transactionId: 'tx-startup-partial-restore',
      challengeRef: { setId: 500, challengeId: 501 },
      pairs: [makePair(101, 102, 7001), makePair(201, 202, 7002)],
    });
    const firstProtected = { id: 102, definitionId: 7001, pile: 'unassigned' };
    const secondProtected = { id: 202, definitionId: 7002, pile: 'unassigned' };
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      unassigned: [firstProtected, secondProtected],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const moveToClub = (item) => {
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(item), 1);
      item.pile = 'club';
      inventoryPiles.club.push(item);
    };
    let moveAttempts = 0;
    installInventoryRecoveryService(window, inventoryPiles, (item) => {
      moveAttempts++;
      if (moveAttempts === 2) throw new Error('second restore interrupted');
      moveToClub(item);
    });
    const protectedItems = [firstProtected, secondProtected];
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          resolveItem: ({ id }) => protectedItems.find((item) => item.id === id) || null,
        }),
      },
    };

    const interrupted = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Partial restore');

    expect(interrupted).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_STARTUP_PROTECTED_RESTORE_FAILED',
    });
    expect(firstProtected.pile).toBe('club');
    expect(secondProtected.pile).toBe('unassigned');
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);

    installInventoryRecoveryService(window, inventoryPiles, moveToClub);
    const resumed = await api.cancelPriorRunRollingDuplicateTransaction(runtime, 'Partial restore retry');

    expect(resumed).toEqual({ status: 'ready' });
    expect(firstProtected.pile).toBe('club');
    expect(secondProtected.pile).toBe('club');
    expect(runtime.duplicateMaterializationTransaction).toBeNull();
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('accepts a newer normalized Ledger snapshot when exact materialized identities and piles remain bound', async () => {
    const { transaction, consume, displaced } = materializedDuplicateTransaction();
    const { api } = await loadUserscript({
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        getLedger: () => ({
          summary: () => ({ inventoryVersion: 10 }),
          resolveItem: ({ id }) => [consume, displaced].find((item) => item.id === id) || null,
        }),
      },
    };

    const result = api.rollingDuplicateTransactionPlanningContext(
      runtime,
      { id: 500 },
      { id: 501 },
    );

    expect(result).toMatchObject({
      ok: true,
      inventoryVersion: 10,
      consumeRefs: [{ id: consume.id, pile: 'club' }],
      protectedRefs: [{ id: displaced.id, pile: 'unassigned' }],
    });
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'materialized' });
  });

  it('persists recovery-required before returning an exact Ledger identity or pile block', async () => {
    const { transaction, consume, displaced } = materializedDuplicateTransaction();
    displaced.pile = 'club';
    const { api, userscriptValues } = await loadUserscript({
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        getLedger: () => ({
          summary: () => ({ inventoryVersion: 10 }),
          resolveItem: ({ id }) => [consume, displaced].find((item) => item.id === id) || null,
        }),
      },
    };

    const result = api.rollingDuplicateTransactionPlanningContext(
      runtime,
      { id: 500 },
      { id: 501 },
    );

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'DUPLICATE_MATERIALIZATION_IDENTITY_CHANGED',
    });
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'recovery-required' });
    expect(userscriptValues.get(ROLLING_DUPLICATE_TRANSACTION_KEY)).toMatchObject({ status: 'recovery-required' });
  });

  it('compensates a materialized duplicate transaction when submission blocks', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'materialized' } };
    const finalize = vi.fn(async () => ({ ok: true }));

    const result = await api.runRollingDuplicateSubmissionAttempt(
      runtime,
      'Rolling main',
      async () => ({ status: 'blocked', submitted: false, reason: 'saved squad changed' }),
      { finalize },
    );

    expect(result).toMatchObject({ status: 'blocked', submitted: false });
    expect(finalize).toHaveBeenCalledWith(
      runtime,
      'Rolling main pre-submit compensation',
      { submissionConfirmed: false },
    );
  });

  it('clears an untouched planned journal immediately when swap preparation blocks', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'planned' } };
    const finalize = vi.fn();
    const recover = vi.fn(async () => {
      runtime.duplicateMaterializationTransaction = null;
      return { status: 'ready' };
    });

    const result = await api.runRollingDuplicateSubmissionAttempt(
      runtime,
      'Rolling swap',
      async () => ({ status: 'blocked', submitted: false, reason: 'swap response incomplete' }),
      { finalize, recover },
    );

    expect(result).toMatchObject({ status: 'blocked', reason: 'swap response incomplete' });
    expect(recover).toHaveBeenCalledWith(runtime, 'Rolling swap pre-submit compensation');
    expect(finalize).not.toHaveBeenCalled();
  });

  it('surfaces ambiguous immediate recovery after an interrupted unrecorded swap', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'recovery-required' } };
    const recover = vi.fn(async () => ({
      status: 'blocked',
      reason: 'protected counterpart restored but consume identity is unknown',
      reasonCode: 'DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS',
    }));

    const result = await api.runRollingDuplicateSubmissionAttempt(
      runtime,
      'Rolling swap',
      async () => ({ status: 'blocked', submitted: false, reason: 'reconcile failed' }),
      { recover },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS',
      details: { originalFailure: { reason: 'reconcile failed' } },
    });
  });

  it('compensates a materialized duplicate transaction when validation throws', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'materialized' } };
    const finalize = vi.fn(async () => ({ ok: true }));

    await expect(api.runRollingDuplicateSubmissionAttempt(
      runtime,
      'Rolling main',
      async () => { throw new Error('final squad identity drift'); },
      { finalize },
    )).rejects.toThrow('final squad identity drift');
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('rolls back and preserves the transport timeout when A prime is still recoverable', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'materialized' } };
    const finalize = vi.fn(async () => {
      runtime.duplicateMaterializationTransaction = { status: 'completed' };
      return { ok: true };
    });

    await expect(api.runRollingDuplicateSubmissionAttempt(
      runtime,
      'Rolling timeout',
      async () => { throw new Error('transport timeout'); },
      { finalize },
    )).rejects.toThrow('transport timeout');
    expect(finalize).toHaveBeenCalledOnce();
    expect(runtime.duplicateMaterializationTransaction.status).toBe('completed');
  });

  it('reports an ambiguous transport timeout when A prime disappeared', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'materialized' } };
    const finalize = vi.fn(async () => ({
      ok: false,
      reason: 'materialized consume item disappeared before outcome confirmation',
      reasonCode: 'DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS',
    }));

    let caught = null;
    try {
      await api.runRollingDuplicateSubmissionAttempt(
        runtime,
        'Rolling timeout',
        async () => { throw new Error('transport timeout'); },
        { finalize },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ reasonCode: 'DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS' });
    expect(caught.message).toContain('transport timeout');
    expect(caught.message).toContain('materialized consume item disappeared');
  });

  it('preserves a materialized transaction when submission requests a replan', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'materialized' } };
    const finalize = vi.fn(async () => ({ ok: true }));

    const result = await api.runRollingDuplicateSubmissionAttempt(
      runtime,
      'Rolling main',
      async () => ({ status: 'replan', submitted: false }),
      { finalize },
    );

    expect(result).toMatchObject({ status: 'replan', submitted: false });
    expect(finalize).not.toHaveBeenCalled();
  });

  it('keeps duplicate and Active Squad replans inside one bounded transaction attempt', async () => {
    const { api } = await loadUserscript();
    const runtime = {};
    const attempt = vi.fn()
      .mockImplementationOnce(async () => {
        runtime.duplicateMaterializationTransaction = {
          status: 'materialized',
          transactionId: 'tx-local-replan',
        };
        return { status: 'replan', submitted: false, reasonCode: 'DUPLICATE_MATERIALIZED_REPLAN' };
      })
      .mockResolvedValueOnce({
        status: 'replan',
        submitted: false,
        reasonCode: 'ACTIVE_SQUAD_CONFLICT_REPLAN',
      })
      .mockImplementationOnce(async () => {
        runtime.duplicateMaterializationTransaction = { status: 'completed' };
        return { status: 'submitted', submitted: true };
      });
    const finalize = vi.fn();

    const result = await api.runBoundedRollingDuplicateTransactionReplans(
      runtime,
      'same Challenge',
      attempt,
      { maxReplans: 3, finalize },
    );

    expect(result).toMatchObject({ status: 'submitted', submitted: true });
    expect(attempt.mock.calls.map(([context]) => context.replan)).toEqual([0, 1, 2]);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('rolls back when transaction-local replanning becomes infeasible', async () => {
    const { api } = await loadUserscript();
    const runtime = {};
    const attempt = vi.fn()
      .mockImplementationOnce(async () => {
        runtime.duplicateMaterializationTransaction = {
          status: 'materialized',
          transactionId: 'tx-shortage',
        };
        return { status: 'replan', submitted: false, reasonCode: 'DUPLICATE_MATERIALIZED_REPLAN' };
      })
      .mockResolvedValueOnce({
        status: 'blocked',
        submitted: false,
        reason: 'required material disappeared after swap',
        reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
      });
    const finalize = vi.fn(async () => {
      runtime.duplicateMaterializationTransaction = { status: 'completed' };
      return { ok: true };
    });

    const result = await api.runBoundedRollingDuplicateTransactionReplans(
      runtime,
      'same Challenge',
      attempt,
      { finalize },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      submitted: false,
      reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
      details: { transactionReplanStopped: true, compensationSucceeded: true },
    });
    expect(finalize).toHaveBeenCalledWith(
      runtime,
      'same Challenge transaction replan compensation',
      { submissionConfirmed: false },
    );
  });

  it('does not capture an ordinary Active Squad replan without a duplicate transaction', async () => {
    const { api } = await loadUserscript();
    const attempt = vi.fn(async () => ({
      status: 'replan',
      submitted: false,
      reasonCode: 'ACTIVE_SQUAD_CONFLICT_REPLAN',
    }));
    const finalize = vi.fn();

    const result = await api.runBoundedRollingDuplicateTransactionReplans(
      {},
      'ordinary replan',
      attempt,
      { finalize },
    );

    expect(result).toMatchObject({ status: 'replan', reasonCode: 'ACTIVE_SQUAD_CONFLICT_REPLAN' });
    expect(attempt).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('fails closed and compensates when transaction-local replans exceed the limit', async () => {
    const { api } = await loadUserscript();
    const runtime = {
      duplicateMaterializationTransaction: { status: 'materialized', transactionId: 'tx-loop' },
    };
    const attempt = vi.fn(async () => ({ status: 'replan', submitted: false }));
    const finalize = vi.fn(async () => ({ ok: true }));

    const result = await api.runBoundedRollingDuplicateTransactionReplans(
      runtime,
      'bounded Challenge',
      attempt,
      { maxReplans: 2, finalize },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_TRANSACTION_REPLAN_LIMIT',
      details: { compensationSucceeded: true },
    });
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('surfaces a failed compensation instead of the original submission block', async () => {
    const { api } = await loadUserscript();
    const runtime = { duplicateMaterializationTransaction: { status: 'materialized' } };
    const finalize = vi.fn(async () => ({
      ok: false,
      reason: 'materialized consume item disappeared',
      reasonCode: 'DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS',
    }));

    const result = await api.runRollingDuplicateSubmissionAttempt(
      runtime,
      'Rolling main',
      async () => ({ status: 'blocked', submitted: false, reason: 'saved squad changed' }),
      { finalize },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      submitted: false,
      reasonCode: 'DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS',
      details: { originalFailure: { reason: 'saved squad changed' } },
    });
    expect(result.reason).toContain('materialized consume item disappeared');
  });

  it('completes compensation from reconciled Ledger when Club Repository briefly omits restored cards', async () => {
    const { transaction, consume, displaced } = materializedDuplicateTransaction();
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [consume],
      unassigned: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const moves = [];
    installInventoryRecoveryService(window, inventoryPiles, (item, destination) => {
      moves.push({ id: item.id, destination });
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displaced), 1);
      inventoryPiles.club.splice(inventoryPiles.club.indexOf(consume), 1);
      displaced.pile = 'club';
      consume.pile = 'unassigned';
      inventoryPiles.unassigned.push(consume);
      // Intentionally leave the restored card out of the Club Repository.
      // The post-move Ledger snapshot is the authoritative identity/pile view.
    });
    const ledger = {
      resolveItem: ({ id }) => [consume, displaced].find((item) => item.id === id) || null,
    };
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ledger,
      },
    };

    const result = await api.finalizeRollingDuplicateMaterialization(
      runtime,
      'Repository-lag compensation',
      { submissionConfirmed: false },
    );

    expect(result).toEqual({ ok: true });
    expect(moves).toEqual([{ id: displaced.id, destination: 'club' }]);
    expect(inventoryPiles.club).not.toContain(displaced);
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'completed' });
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('completes a confirmed duplicate transaction when the protected counterpart is already back in Club', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    displaced.pile = 'club';
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [displaced],
      unassigned: [],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          resolveItem: ({ id }) => id === displaced.id ? displaced : null,
        }),
      },
    };

    const result = await api.finalizeRollingDuplicateMaterialization(
      runtime,
      'Already restored protected counterpart',
      { submissionConfirmed: true },
    );

    expect(result).toEqual({ ok: true });
    expect(move).not.toHaveBeenCalled();
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'completed' });
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('uses reconciled Club state when the protected counterpart is absent from stale Repositories', async () => {
    const { transaction, displaced } = materializedDuplicateTransaction();
    displaced.pile = 'club';
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [],
      unassigned: [],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const move = vi.fn();
    installInventoryRecoveryService(window, inventoryPiles, move);
    const reconcile = vi.fn(async () => ({ ok: true }));
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile,
        getLedger: () => ({
          resolveItem: ({ id }) => id === displaced.id ? displaced : null,
        }),
      },
    };

    const result = await api.finalizeRollingDuplicateMaterialization(
      runtime,
      'Reconciled restored protected counterpart',
      { submissionConfirmed: true },
    );

    expect(result).toEqual({ ok: true });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(move).not.toHaveBeenCalled();
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'completed' });
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('restores a protected counterpart from the Unassigned Repository when its EA pile scalar is stale', async () => {
    const { transaction, consume, displaced } = materializedDuplicateTransaction();
    displaced.pile = 'club';
    const { api, window, userscriptValues, inventoryPiles } = await loadUserscript({
      club: [consume],
      unassigned: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    const moves = [];
    installInventoryRecoveryService(window, inventoryPiles, (item, destination) => {
      moves.push({ id: item.id, destination });
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displaced), 1);
      inventoryPiles.club.splice(inventoryPiles.club.indexOf(consume), 1);
      displaced.pile = 'club';
      consume.pile = 'unassigned';
      inventoryPiles.club.push(displaced);
      inventoryPiles.unassigned.push(consume);
    });
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          resolveItem: ({ id }) => [consume, displaced].find((item) => item.id === id) || null,
        }),
      },
    };

    const result = await api.finalizeRollingDuplicateMaterialization(
      runtime,
      'Stale protected pile scalar',
      { submissionConfirmed: false },
    );

    expect(result).toEqual({ ok: true });
    expect(moves).toEqual([{ id: displaced.id, destination: 'club' }]);
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'completed' });
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(false);
  });

  it('fails closed after compensation when reconciled Ledger reports the wrong restored definition', async () => {
    const { transaction, consume, displaced } = materializedDuplicateTransaction();
    const { api, window, inventoryPiles } = await loadUserscript({
      club: [consume],
      unassigned: [displaced],
      pageReady: true,
      fastTimers: true,
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
    });
    installInventoryRecoveryService(window, inventoryPiles, () => {
      inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(displaced), 1);
      inventoryPiles.club.splice(inventoryPiles.club.indexOf(consume), 1);
      displaced.pile = 'club';
      consume.pile = 'unassigned';
      inventoryPiles.unassigned.push(consume);
    });
    const wrongProtectedSnapshot = { ...displaced, definitionId: 7999, pile: 'club' };
    const runtime = {
      duplicateMaterializationTransaction: transaction,
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({
          resolveItem: ({ id }) => id === displaced.id ? wrongProtectedSnapshot : consume,
        }),
      },
    };

    const result = await api.finalizeRollingDuplicateMaterialization(
      runtime,
      'Wrong Ledger identity',
      { submissionConfirmed: false },
    );

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'DUPLICATE_COUNTERPART_IDENTITY_CHANGED',
    });
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({ status: 'recovery-required' });
  });

  it('runs swap, local replan, all identity guards, transport, and B restoration in order', async () => {
    const { api } = await loadUserscript();
    const { transaction, consume, displaced } = materializedDuplicateTransaction();
    const ordinary = { id: 201, definitionId: 7201, rating: 84, pile: 'club' };
    const runtime = { duplicateMaterializationTransaction: null };
    const events = [];
    const attempt = vi.fn(async ({ replan }) => {
      if (replan === 0) {
        events.push('swap');
        runtime.duplicateMaterializationTransaction = transaction;
        return {
          status: 'replan',
          submitted: false,
          reasonCode: 'DUPLICATE_MATERIALIZED_REPLAN',
        };
      }
      events.push('replan');
      const players = [consume, ordinary];
      const created = createDuplicateSubmissionManifest({
        transaction: runtime.duplicateMaterializationTransaction,
        inventoryVersion: 9,
        players,
      });
      expect(created.ok).toBe(true);
      const validate = (phase, actual) => {
        events.push(phase);
        expect(validateDuplicateSubmissionManifest(created.manifest, actual, {
          inventoryVersion: 9,
        })).toMatchObject({ ok: true });
      };
      return submitSbcAttempt({
        label: 'duplicate identity transaction',
        challengeProvider: async () => ({ set: { id: 500 }, challenge: { id: 501 } }),
        squadProvider: async () => ({ ok: true, players, itemRefs: players }),
        preSaveValidators: [({ players: actual }) => validate('pre-save', actual)],
        saveSquad: async () => { events.push('save'); },
        readSavedPlayers: async () => players,
        postSaveValidators: [({ savedPlayers }) => validate('post-save', savedPlayers)],
        readFinalPlayers: async () => players,
        finalValidators: [({ finalPlayers }) => validate('final', finalPlayers)],
        submitTransport: async ({ finalPlayers }) => {
          validate('transport', finalPlayers);
          return { submitted: true };
        },
        afterSubmit: async () => {
          events.push('restore-b');
          displaced.pile = 'club';
          runtime.duplicateMaterializationTransaction = transitionDuplicateMaterializationTransaction(
            runtime.duplicateMaterializationTransaction,
            'completed',
          );
          return { ok: true };
        },
      });
    });

    const result = await api.runBoundedRollingDuplicateTransactionReplans(
      runtime,
      'same exact Challenge',
      attempt,
    );

    expect(result).toMatchObject({ status: 'submitted', submitted: true });
    expect(events).toEqual([
      'swap',
      'replan',
      'pre-save',
      'save',
      'post-save',
      'final',
      'transport',
      'restore-b',
    ]);
    expect(displaced.pile).toBe('club');
    expect(runtime.duplicateMaterializationTransaction.status).toBe('completed');
  });

  it('compensates and blocks when the materialized journal cannot be persisted', async () => {
    const { api } = await loadUserscript({
      gmSetValue: () => { throw new Error('journal quota exceeded'); },
    });
    const { transaction } = materializedDuplicateTransaction();
    const runtime = { duplicateMaterializationTransaction: transaction };
    const finalize = vi.fn(async () => ({ ok: true }));

    const result = await api.persistMaterializedRollingDuplicateTransaction(
      runtime,
      'Rolling persistence failure',
      { finalize },
    );

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'DUPLICATE_JOURNAL_WRITE_FAILED',
      details: { compensationSucceeded: true },
    });
    expect(finalize).toHaveBeenCalledWith(
      runtime,
      'Rolling persistence failure journal-write compensation',
      { submissionConfirmed: false },
    );
  });

  it('does not report a cleared journal when userscript deletion is unavailable', async () => {
    const { api, userscriptValues } = await loadUserscript({
      userscriptStorage: {
        [ROLLING_DUPLICATE_TRANSACTION_KEY]: { transactionId: 'tx-still-present', status: 'planned' },
      },
      gmDeleteValue: null,
    });

    expect(api.persistRollingDuplicateTransaction(null)).toBe(false);
    expect(userscriptValues.has(ROLLING_DUPLICATE_TRANSACTION_KEY)).toBe(true);
  });

  it('keeps recovery-required when physical restoration succeeds but journal clearing fails', async () => {
    const { transaction } = materializedDuplicateTransaction();
    const { api } = await loadUserscript({
      userscriptStorage: { [ROLLING_DUPLICATE_TRANSACTION_KEY]: transaction },
      gmDeleteValue: null,
    });
    const runtime = { duplicateMaterializationTransaction: transaction };

    const result = api.completeRollingDuplicateTransaction(runtime, transaction);

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'DUPLICATE_JOURNAL_CLEAR_FAILED',
      details: { physicalRestorationSucceeded: true },
    });
    expect(runtime.duplicateMaterializationTransaction).toMatchObject({
      status: 'recovery-required',
    });
  });

  it('compensates an unsupported Requirements recovery replan and stops', async () => {
    const { api } = await loadUserscript();
    const runtime = {};
    const submitAttempt = vi.fn(async () => {
      runtime.duplicateMaterializationTransaction = {
        status: 'materialized',
        transactionId: 'tx-requirements-unsupported',
      };
      return {
        status: 'replan',
        submitted: false,
        reasonCode: 'DUPLICATE_MATERIALIZED_REPLAN',
      };
    });
    const finalize = vi.fn(async () => {
      runtime.duplicateMaterializationTransaction = { status: 'completed' };
      return { ok: true };
    });

    const result = await api.submitRollingRequirementRecovery(
      { name: 'Rolling main' },
      runtime,
      { name: 'Requirements Recovery' },
      { submitAttempt, finalize },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      submitted: false,
      reasonCode: 'DUPLICATE_REQUIREMENTS_REPLAN_UNSUPPORTED',
      details: { compensationSucceeded: true },
    });
    expect(submitAttempt).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('does not enter the legacy 88 squad after the 89 transaction replan fails', async () => {
    const { api } = await loadUserscript();
    const contexts = [
      { targetRating: 89, model: { targetRating: 89 } },
      { targetRating: 88, model: { targetRating: 88 } },
    ];
    const plannedRatings = [];
    const runtime = {
      coordinator: { reconcile: vi.fn(async () => ({ ok: true })) },
    };
    const planSquad = vi.fn(async (_loopDef, _runtime, context) => {
      plannedRatings.push(context.targetRating);
      return {
        ok: true,
        plans: [{ selection: { selected: [] }, signalRefs: [] }],
        pileCounts: { storage: 11 },
        storageItemsConsumed: 11,
        details: { sourceOrder: ['storage'], maxClubPerSquad: 0 },
      };
    });
    const runReplans = vi.fn(async () => ({
      status: 'blocked',
      submitted: false,
      reason: '89 transaction-local replanning became infeasible',
      reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
      details: { compensationSucceeded: true },
    }));

    const result = await api.runRollingLegacyStorageSinkRecovery(
      { name: 'Rolling main', runtimeProtectionRating: 95 },
      runtime,
      { status: 'resolved', loop: { name: 'Legacy 95+ Pick', setId: 500 } },
      {
        selectPending: vi.fn(async () => ({ status: 'missing' })),
        refreshCaches: vi.fn(async () => {}),
        loadContexts: vi.fn(async () => ({
          status: 'ready',
          contexts,
          completedCount: 0,
        })),
        planSquad,
        validateHeadroom: vi.fn(() => ({ ok: true, projectedFree: 11, requiredFree: 1 })),
        runReplans,
        submitSquad: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      submitted: false,
      reasonCode: 'RECOVERY_MATERIAL_SHORTAGE',
    });
    expect(plannedRatings).toEqual([89]);
    expect(runReplans).toHaveBeenCalledOnce();
  });

  it('refreshes Storage before a final fresh Unassigned read during protected routing', async () => {
    const { api } = await loadUserscript();
    const events = [];
    const refreshStorage = vi.fn(async () => { events.push('refresh-storage'); });
    const states = [
      { mergedCount: 2, mergedItemIds: [101, 102] },
      { mergedCount: 0, mergedItemIds: [] },
      { mergedCount: 2, mergedItemIds: [101, 102] },
    ];
    const invalidatePurchased = vi.fn(async () => {
      events.push('invalidate-unassigned');
      return { invalidated: true };
    });
    const refreshPurchased = vi.fn(async () => {
      events.push('refresh-unassigned');
      return { success: true, response: { items: [{ id: 101 }, { id: 102 }] } };
    });
    const readPurchasedState = vi.fn(() => states.shift());
    const refreshTransfer = vi.fn(async () => { events.push('refresh-transfer'); });

    const result = await api.refreshRollingProtectedStorageCaches({
      refreshStorage,
      invalidatePurchased,
      refreshPurchased,
      readPurchasedState,
      onStage: (stage) => { events.push(`stage-${stage}`); },
    });

    expect(result).toMatchObject({
      purchasedResult: { success: true },
      evidence: {
        beforeInvalidation: { mergedItemIds: [101, 102] },
        invalidation: { invalidated: true },
        afterInvalidation: { mergedItemIds: [] },
        response: {
          itemArrays: [{ source: 'response.items', count: 2 }],
        },
        afterRequest: { mergedItemIds: [101, 102] },
      },
    });
    expect(events).toEqual([
      'refresh-storage',
      'stage-storage',
      'invalidate-unassigned',
      'refresh-unassigned',
      'stage-unassigned',
    ]);
    expect(refreshStorage).toHaveBeenCalledOnce();
    expect(invalidatePurchased).toHaveBeenCalledOnce();
    expect(refreshPurchased).toHaveBeenCalledOnce();
    expect(readPurchasedState).toHaveBeenCalledTimes(3);
    expect(refreshTransfer).not.toHaveBeenCalled();
  });

  it('fails the protected Storage refresh before routing when fresh Unassigned evidence is unavailable', async () => {
    const { api } = await loadUserscript();
    const events = [];

    await expect(api.refreshRollingProtectedStorageCaches({
      refreshStorage: async () => { events.push('refresh-storage'); },
      invalidatePurchased: async () => {
        events.push('invalidate-unassigned');
        return { invalidated: true };
      },
      refreshPurchased: async () => {
        events.push('refresh-unassigned');
        throw new Error('Purchased request failed');
      },
      readPurchasedState: () => ({ mergedCount: 0, mergedItemIds: [] }),
      onStage: (stage) => { events.push(`stage-${stage}`); },
    })).rejects.toThrow('Purchased request failed');
    expect(events).toEqual([
      'refresh-storage',
      'stage-storage',
      'invalidate-unassigned',
      'refresh-unassigned',
    ]);
  });

  it('classifies an explicitly empty Purchased response as absent from the response', async () => {
    const { api } = await loadUserscript();
    const result = api.classifyRollingProtectedRefreshEvidence([
      { id: 101, definitionId: 1001, pile: 'unassigned' },
    ], {
      response: { itemArrays: [{ source: 'response.items', count: 0, items: [] }] },
      afterRequest: { mergedItemIds: [] },
    });

    expect(result).toEqual([expect.objectContaining({
      outcome: 'absent-from-response',
      responseHasExactId: false,
      repositoryHasExactId: false,
    })]);
  });

  it('distinguishes an EA response item that the Purchased repository did not materialize', async () => {
    const { api } = await loadUserscript();
    const ref = { id: 101, definitionId: 1001, pile: 'unassigned' };
    const evidence = {
      response: {
        itemArrays: [{
          source: 'response.items',
          count: 1,
          items: [{ id: 101, definitionId: 1001, rating: 95, pile: 'unassigned' }],
        }],
      },
      afterRequest: { mergedItemIds: [] },
    };

    expect(api.classifyRollingProtectedRefreshEvidence([ref], evidence)).toEqual([
      expect.objectContaining({
        outcome: 'response-not-materialized',
        responseHasExactId: true,
        repositoryHasExactId: false,
        sameDefinitionResponseIds: [101],
      }),
    ]);

    evidence.afterRequest.mergedItemIds = [101];
    expect(api.classifyRollingProtectedRefreshEvidence([ref], evidence)).toEqual([
      expect.objectContaining({
        outcome: 'verified',
        responseHasExactId: true,
        repositoryHasExactId: true,
      }),
    ]);
  });

  it('counts duplicate players from both selected arrays and selection objects', async () => {
    const duplicate = makePlayer({ id: 1, duplicate: true });
    const ordinary = makePlayer({ id: 2 });
    const { api } = await loadUserscript();

    expect(api.rollingDuplicatePlayerCount([duplicate, ordinary])).toBe(1);
    expect(api.rollingDuplicatePlayerCount({ selected: [duplicate, ordinary] })).toBe(1);
    expect(api.rollingDuplicatePlayerCount({
      selected: [ordinary],
      entries: [{ pileName: 'unassigned', signal: duplicate, item: ordinary }],
    })).toBe(1);
    expect(api.rollingDuplicatePlayerCount({ status: 'submitted' })).toBe(0);
  });

  it('does not treat configured Provisions reserve ratings as Rare Gold Pick triggers', async () => {
    const { api } = await loadUserscript();
    const permissiveRolling = {
      runtimeProvisionsMaxRating: 91,
      runtimePickOptions: { protectionRating: 97 },
    };
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 86, rating: 86, rareflag: 1, duplicate: true }), {})).toBe(true);
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 87, rating: 87, rareflag: 1, duplicate: true }), permissiveRolling)).toBe(false);
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 88, rating: 88, rareflag: 1, duplicate: true }), permissiveRolling)).toBe(false);
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 89, rating: 89, rareflag: 1, duplicate: true }), permissiveRolling)).toBe(false);
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 90, rating: 90, rareflag: 1, duplicate: true }), permissiveRolling)).toBe(false);
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 91, rating: 91, rareflag: 1, duplicate: true }), permissiveRolling)).toBe(false);
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 92, rating: 92, rareflag: 1, duplicate: true }), permissiveRolling)).toBe(true);
    expect(api.rollingOrdinaryGoldDuplicate(
      makePlayer({ id: 189, rating: 89, rareflag: 1, duplicate: true }),
      { runtimePickOptions: { protectionRating: 97 } },
    )).toBe(true);
    expect(api.rollingOrdinaryGoldDuplicate(
      makePlayer({ id: 190, rating: 90, rareflag: 1, duplicate: true }),
      { runtimeProvisionsMaxRating: 89, runtimePickOptions: { protectionRating: 97 } },
    )).toBe(true);
    expect(api.rollingOrdinaryGoldDuplicate(makePlayer({ id: 90, rating: 90, rareflag: 2, duplicate: true }), {})).toBe(false);
  });

  it('ignores unsupported Player Item subtype methods and reads event names only from EA rarity metadata', async () => {
    const ordinaryClubGold = makePlayer({
      id: 191,
      definitionId: 9191,
      rating: 77,
      rareflag: 0,
      name: 'Ordinary first-owner Gold',
    });
    ordinaryClubGold.isFOF = () => true;
    ordinaryClubGold.isTOTW = () => true;
    ordinaryClubGold.isTOTS = () => true;
    ordinaryClubGold.isFUTTIES = () => true;
    const actualFof = makePlayer({
      id: 192,
      definitionId: 9192,
      rating: 95,
      rareflag: 117,
      name: 'Actual event player',
      rarityName: 'Festival of Football',
    });
    const methodOnlySpecial = makePlayer({
      id: 196,
      definitionId: 9196,
      rating: 95,
      rareflag: 118,
      name: 'Method-only special',
    });
    methodOnlySpecial.isFOF = () => true;
    const repositoryFutties = makePlayer({
      id: 197,
      definitionId: 9197,
      rating: 96,
      rareflag: 120,
      name: 'Repository event player',
    });
    const { api } = await loadUserscript({
      club: [ordinaryClubGold, actualFof, methodOnlySpecial, repositoryFutties],
      rarities: { 120: { name: 'FUTTIES' } },
    });
    const loopDef = {
      name: 'Rolling Gold recovery',
      runtimeProtectionRating: 95,
    };
    const runtime = {
      primaryContext: { activeLoopDef: loopDef },
      coordinator: { getLedger: () => null },
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [],
    };

    expect([
      api.isTotwItem(ordinaryClubGold),
      api.isTotsItem(ordinaryClubGold),
      api.isFofItem(ordinaryClubGold),
      api.isFuttiesItem(ordinaryClubGold),
    ]).toEqual([false, false, false, false]);
    expect(api.isSbcSpecialItem(ordinaryClubGold)).toBe(false);
    expect(api.assertRollingRecoveryItems(loopDef, runtime, [ordinaryClubGold], {
      allowProvisionsReserve: true,
    })).toBe(true);
    expect(api.isFofItem(actualFof)).toBe(true);
    expect(api.isFofItem(methodOnlySpecial)).toBe(false);
    expect(api.isFuttiesItem(repositoryFutties)).toBe(true);
    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [actualFof], {
      allowProvisionsReserve: true,
    })).toThrow(/special/);
  });

  it('does not block Player Pick fodder when EA isSpecial contradicts explicit normal rarity', async () => {
    const common = makePlayer({ id: 193, definitionId: 9193, rating: 75, rareflag: 0 });
    const rare = makePlayer({ id: 194, definitionId: 9194, rating: 81, rareflag: 1 });
    common.isSpecial = () => true;
    rare.isSpecial = () => true;
    const actualSpecial = makePlayer({ id: 195, definitionId: 9195, rating: 88, rareflag: 97 });
    actualSpecial.isSpecial = () => false;
    const { api } = await loadUserscript();
    const pickDef = {
      name: 'Rare Gold Player Pick',
      blockSpecial: true,
      expectedPlayerCount: 2,
      requirements: [{ count: 2, tier: 'gold' }],
    };

    expect(api.inspectSbcItems(pickDef, [common, rare])).toMatchObject({
      specialCount: 0,
      blocked: [],
    });
    expect(api.inspectSbcItems(pickDef, [rare, actualSpecial])).toMatchObject({
      specialCount: 1,
      blocked: [expect.objectContaining({
        item: actualSpecial,
        reasons: expect.arrayContaining(['special-blocked']),
      })],
    });
  });

  it('detects a pending Player Pick from its exact live entity instead of the ledger snapshot', async () => {
    const livePick = makePlayer({ id: 501, definitionId: 9501 });
    livePick.isPlayerPickItem = () => true;
    const snapshot = { type: 'misc', id: 501, definitionId: 9501 };
    const { api } = await loadUserscript({ unassigned: [livePick] });

    expect(api.inspectRollingLiveUnassignedEntries([{ item: snapshot, pile: 'unassigned' }]))
      .toMatchObject({ ok: true, playerPickCount: 1, playerPickIds: [501] });
  });

  it('fails closed when a reconciled Unassigned snapshot has no exact live item', async () => {
    const { api } = await loadUserscript();

    expect(api.inspectRollingLiveUnassignedEntries([{
      item: { type: 'player', id: 502, definitionId: 9502 },
      pile: 'unassigned',
    }])).toMatchObject({
      ok: false,
      reasonCode: 'UNASSIGNED_RESUME_IDENTITY_CHANGED',
    });
  });

  it('refreshes pending Rolling refs from current Unassigned players only', async () => {
    const { api } = await loadUserscript();
    const runtime = {
      pendingUnassignedRefs: [{ id: 999, definitionId: 999, pile: 'unassigned' }],
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [
            { item: { type: 'player', id: 601, definitionId: 9601 }, pile: 'unassigned' },
            { item: { type: 'player', id: 602, definitionId: 9602 }, pile: 'storage' },
            { item: { type: 'consumable', id: 603, definitionId: 9603 }, pile: 'unassigned' },
          ],
        }),
      },
    };

    expect(api.refreshRollingPendingUnassignedRefs(runtime)).toEqual([
      { id: 601, definitionId: 9601, pile: 'unassigned' },
    ]);
    expect(runtime.pendingUnassignedRefs).toEqual([
      { id: 601, definitionId: 9601, pile: 'unassigned' },
    ]);
  });

  it('preserves materialized primary duplicates while protected Storage routing is blocked', async () => {
    const primaryDuplicates = Array.from({ length: 7 }, (_, index) => makePlayer({
      id: 650 + index,
      definitionId: 9650 + index,
      rating: 85 + (index % 3),
      duplicate: true,
      duplicateId: 1650 + index,
    }));
    const protectedDuplicate = makePlayer({
      id: 699,
      definitionId: 9699,
      rating: 96,
      duplicate: true,
      duplicateId: 1699,
    });
    const runtime = { primaryDuplicateRefs: [] };
    const routing = {
      status: 'blocked',
      reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      counts: { unresolved: 0 },
      reservedItems: primaryDuplicates,
      storageItems: [protectedDuplicate],
    };
    const { api } = await loadUserscript();

    expect(api.preserveRollingPrimaryDuplicateRefs(runtime, routing, { replace: true }))
      .toMatchObject({ captured: true, count: 7 });
    expect(runtime.primaryDuplicateRefs.map((ref) => ref.id))
      .toEqual(primaryDuplicates.map((item) => item.id));
    expect(runtime.primaryDuplicateRefs.map((ref) => ref.id)).not.toContain(protectedDuplicate.id);
  });

  it('marks live resumed duplicates resolved before protected Storage recovery', async () => {
    const primaryDuplicates = Array.from({ length: 5 }, (_, index) => makePlayer({
      id: 710 + index,
      definitionId: 9710 + index,
      rating: 85 + index,
      duplicate: true,
      duplicateId: 1710 + index,
    }));
    const storageDuplicates = Array.from({ length: 4 }, (_, index) => makePlayer({
      id: 720 + index,
      definitionId: 9720 + index,
      rating: 96 + index,
      duplicate: true,
      duplicateId: 1720 + index,
    }));
    const pendingRefs = [...primaryDuplicates, ...storageDuplicates]
      .map((item) => ({ id: item.id, definitionId: item.definitionId, pile: 'unassigned' }));
    const { api } = await loadUserscript();
    const routing = api.buildRollingResumedRouting({
      status: 'blocked',
      reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      reservedItems: primaryDuplicates,
      storageItems: storageDuplicates,
      pendingItems: storageDuplicates,
      counts: {
        duplicates: 9,
        primaryDuplicates: 5,
        storageRequired: 4,
      },
    }, 9, pendingRefs);
    const runtime = { primaryDuplicateRefs: [] };

    expect(routing).toMatchObject({
      status: 'blocked',
      reasonCode: 'PROTECTED_STORAGE_BLOCKED',
      counts: { unresolved: 0, resumed: 9, pending: 9 },
    });
    expect(api.preserveRollingPrimaryDuplicateRefs(runtime, routing, { replace: true }))
      .toMatchObject({ captured: true, count: 5, recoveredFromBlockedStorage: true });
    expect(runtime.primaryDuplicateRefs.map((ref) => ref.id))
      .toEqual(primaryDuplicates.map((item) => item.id));
  });

  it('retries disabled-swap routing after recovery creates enough Storage headroom', async () => {
    const duplicate = makePlayer({
      id: 725,
      definitionId: 9725,
      rating: 95,
      duplicate: true,
      duplicateId: 1725,
    });
    duplicate.pile = 'unassigned';
    const { api, window, inventoryPiles } = await loadUserscript({
      unassigned: [duplicate],
      pileSizes: { storage: 100 },
      pileCounts: { storage: 99 },
      pageReady: true,
      fastTimers: true,
    });
    window.services.Item.requestUnassignedItems = () => successfulObservable();
    window.services.Item.requestStorageItems = () => successfulObservable();
    window.services.Item.move = (items, destination) => {
      for (const item of items) {
        inventoryPiles.unassigned.splice(inventoryPiles.unassigned.indexOf(item), 1);
        item.pile = 'storage';
        inventoryPiles.storage.push(item);
      }
      return successfulObservable();
    };
    const runtime = {
      duplicateSwapEnabled: false,
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [duplicate],
      openRouting: {
        status: 'blocked',
        reason: 'native duplicate swaps are disabled and SBC storage needs one slot',
        reasonCode: 'DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED',
        reservedItems: [],
        storageItems: [duplicate],
        deferredPrimaryRefs: [],
      },
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };

    const result = await api.retryRollingProtectedStorage(
      { name: 'Disabled swap Storage retry' },
      runtime,
    );

    expect(result).toMatchObject({ status: 'ready' });
    expect(inventoryPiles.unassigned).toEqual([]);
    expect(inventoryPiles.storage).toContain(duplicate);
    expect(runtime.openRouting).toMatchObject({ status: 'ready', reasonCode: null });
  });

  it('keeps exact pending refs blocked when EA accepts only a partial Storage move', async () => {
    const duplicates = Array.from({ length: 5 }, (_, index) => {
      const item = makePlayer({
        id: 800 + index,
        definitionId: 9800 + index,
        rating: 88,
        duplicate: true,
        duplicateId: 1800 + index,
      });
      item.pile = 'unassigned';
      return item;
    });
    const counterparts = duplicates.map((item) => {
      const counterpart = makePlayer({
        id: item.duplicateId,
        definitionId: item.definitionId,
        rating: item.rating,
      });
      counterpart.pile = 'club';
      return counterpart;
    });
    const { api, window, inventoryPiles } = await loadUserscript({
      unassigned: duplicates,
      club: counterparts,
      pileSizes: { storage: 100 },
      pileCounts: { storage: 95 },
      pageReady: true,
      fastTimers: true,
    });
    window.services.Item.requestUnassignedItems = () => successfulObservable();
    window.services.Item.requestStorageItems = () => successfulObservable();
    window.services.Item.requestClubItems = () => successfulObservable();
    window.services.Item.move = (items, destination) => {
      const accepted = destination === 'storage' ? items.slice(0, 4) : items;
      for (const item of accepted) {
        const index = inventoryPiles.unassigned.indexOf(item);
        if (index >= 0) inventoryPiles.unassigned.splice(index, 1);
        item.pile = destination;
        inventoryPiles[destination].push(item);
      }
      return successfulObservable();
    };
    const runtime = {
      duplicateSwapEnabled: false,
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: duplicates.map((item) => item),
      openRouting: {
        status: 'blocked',
        reason: 'native duplicate swaps are disabled and SBC storage needs five slots',
        reasonCode: 'DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED',
        reservedItems: [],
        storageItems: duplicates,
        deferredPrimaryRefs: [],
      },
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };

    const result = await api.retryRollingProtectedStorage(
      { name: 'Partial Storage retry' },
      runtime,
    );

    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'PROTECTED_STORAGE_BLOCKED' });
    expect(result.details.unsettled).toEqual([
      expect.objectContaining({ id: 804, definitionId: 9804, pile: 'unassigned' }),
    ]);
    expect(inventoryPiles.storage.map((item) => item.id)).toEqual([800, 801, 802, 803]);
    expect(inventoryPiles.unassigned.map((item) => item.id)).toEqual([804]);
    expect(runtime.openRouting).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED',
    });
  });

  it('does not resurrect stale pack duplicate metadata after fresh EA evidence clears it', async () => {
    const clubCounterpart = makePlayer({
      id: 926618404280,
      definitionId: 50565379,
      rating: 88,
    });
    clubCounterpart.pile = 'club';
    const live = makePlayer({
      id: 928735985049,
      definitionId: 50565379,
      rating: 88,
      duplicate: false,
      duplicateId: 0,
    });
    live.pile = 'unassigned';
    const response = makePlayer({
      id: live.id,
      definitionId: live.definitionId,
      rating: live.rating,
      duplicate: true,
      duplicateId: clubCounterpart.id,
    });
    response.pile = 'unassigned';
    const { api } = await loadUserscript({
      unassigned: [live],
      club: [clubCounterpart],
    });

    const restored = api.restoreOpenedUnassignedDuplicateMetadata(
      [response],
      'Fresh non-duplicate Isak',
      {
        authoritativeMaterialization: {
          matches: [{ opened: response, live, via: 'id' }],
        },
      },
    );

    expect(restored).toBe(0);
    expect(live.duplicateId).toBe(0);
    expect(live.isDuplicate()).toBe(false);
    expect(api.predictUnassignedDestination(live)).toBe('club');
  });

  it('keeps disabled-swap startup duplicates pending so the main workflow can recover Storage', async () => {
    const duplicates = [makePlayer({
      id: 726,
      definitionId: 9726,
      rating: 95,
      duplicate: true,
      duplicateId: 1726,
    }), makePlayer({
      id: 727,
      definitionId: 9727,
      rating: 94,
      duplicate: true,
      duplicateId: 1727,
    })];
    duplicates.forEach((duplicate) => {
      duplicate.pile = 'unassigned';
      duplicate.duplicate = true;
    });
    const { api, window } = await loadUserscript({
      unassigned: duplicates,
      pileSizes: { storage: 100 },
      pileCounts: { storage: 99 },
      pageReady: true,
      fastTimers: true,
    });
    window.services.Item.requestUnassignedItems = () => successfulObservable();
    window.services.Item.requestStorageItems = () => successfulObservable();
    const ledger = {
      classifiedEntries: () => duplicates.map((item) => ({
        item,
        pile: 'unassigned',
        classification: { duplicate: true },
      })),
      summary: () => ({ inventoryVersion: 1 }),
    };
    const runtime = {
      primaryContext: { model: {} },
      coordinator: {
        reconcile: vi.fn(async () => ({ ok: true })),
        getLedger: () => ledger,
      },
    };

    const result = await api.resumeRollingPendingUnassigned({
      name: 'Disabled swap startup',
      rollingDuplicateSwapEnabled: false,
      rollingDuplicateSwapMode: 'off',
      rollingSurplusCraftingEnabled: false,
      rollingProvisionsUpgrade: null,
      rollingProtectAllClubNonTotwSpecials: false,
    }, runtime);

    expect(result).toMatchObject({ status: 'ready', primaryPending: true });
    expect(runtime.openRouting).toMatchObject({
      status: 'blocked',
      reasonCode: 'DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED',
    });
    expect(runtime.pendingUnassignedRefs).toHaveLength(2);
    expect(runtime.pendingUnassignedRefs.map((ref) => ref.id)).toEqual([726, 727]);
  });

  it('preserves the existing primary duplicate behavior for a ready route', async () => {
    const duplicate = makePlayer({
      id: 660,
      definitionId: 9660,
      rating: 86,
      duplicate: true,
      duplicateId: 1660,
    });
    const runtime = { primaryDuplicateRefs: [{ id: 999, definitionId: 9999, pile: 'unassigned' }] };
    const { api } = await loadUserscript();

    expect(api.preserveRollingPrimaryDuplicateRefs(runtime, {
      status: 'ready',
      reasonCode: null,
      counts: { unresolved: 0 },
      reservedItems: [duplicate],
      storageItems: [],
    }, { replace: true })).toMatchObject({ captured: true, count: 1 });
    expect(runtime.primaryDuplicateRefs).toMatchObject([{
      id: duplicate.id,
      definitionId: duplicate.definitionId,
      pile: 'unassigned',
    }]);
  });

  it('does not preserve primary refs from unresolved or unrelated blocked routing', async () => {
    const duplicate = makePlayer({
      id: 670,
      definitionId: 9670,
      rating: 88,
      duplicate: true,
      duplicateId: 1670,
    });
    const { api } = await loadUserscript();

    for (const routing of [
      {
        status: 'blocked',
        reasonCode: 'PROTECTED_STORAGE_BLOCKED',
        counts: { unresolved: 1 },
        reservedItems: [duplicate],
      },
      {
        status: 'blocked',
        reasonCode: 'OPENED_DUPLICATE_NOT_MATERIALIZED',
        counts: { unresolved: 0 },
        reservedItems: [duplicate],
      },
    ]) {
      const runtime = { primaryDuplicateRefs: [] };
      expect(api.preserveRollingPrimaryDuplicateRefs(runtime, routing, { replace: true }))
        .toMatchObject({ captured: false, count: 0 });
      expect(runtime.primaryDuplicateRefs).toEqual([]);
    }
  });

  it('rejects emergency Provisions unless actual Storage consumption fits every pending card', async () => {
    const pendingOne = makePlayer({ id: 701, definitionId: 9701, duplicate: true });
    const pendingTwo = makePlayer({ id: 702, definitionId: 9702, duplicate: true });
    const { api } = await loadUserscript({ unassigned: [pendingOne, pendingTwo] });
    const runtime = {
      openRouting: { storageItems: [pendingOne, pendingTwo] },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 0 } } }),
        }),
      },
    };

    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 0)).toMatchObject({
      ok: false,
      reasonCode: 'RECOVERY_STORAGE_HEADROOM_INSUFFICIENT',
      details: { projectedFree: 0, requiredFree: 2 },
    });
    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 1)).toMatchObject({
      ok: false,
      reasonCode: 'RECOVERY_STORAGE_HEADROOM_INSUFFICIENT',
      details: { projectedFree: 1, requiredFree: 2 },
    });
    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 2)).toMatchObject({
      ok: true,
      projectedFree: 2,
      requiredFree: 2,
    });
  });

  it('accepts an incremental Provisions release when one batch frees four of eight pending cards', async () => {
    const pending = Array.from({ length: 8 }, (_, index) => makePlayer({
      id: 705 + index,
      definitionId: 9705 + index,
      duplicate: true,
    }));
    const { api } = await loadUserscript({ unassigned: pending });
    const runtime = {
      openRouting: { storageItems: pending },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 0 } } }),
        }),
      },
    };

    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 3, {
      allowIncremental: true,
      maximumRelease: 4,
    })).toMatchObject({
      ok: false,
      reasonCode: 'RECOVERY_STORAGE_HEADROOM_INSUFFICIENT',
      details: { requiredRelease: 4, storageItemsConsumed: 3 },
    });
    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 4, {
      allowIncremental: true,
      maximumRelease: 4,
    })).toMatchObject({
      ok: true,
      incremental: true,
      requiredRelease: 4,
      requiredFree: 8,
      projectedFree: 4,
    });
  });

  it('allows an explicitly bounded partial rating-excess release and preserves the full pressure requirement', async () => {
    const { api } = await loadUserscript();
    const runtime = {
      openRouting: { storageItems: [] },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 0 } } }),
        }),
      },
    };

    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 1, {
      allowIncremental: true,
      allowPartialIncremental: true,
      maximumRelease: 2,
      minimumConsumption: 1,
      totalMinimumConsumption: 2,
    })).toMatchObject({
      ok: true,
      incremental: true,
      requiredRelease: 1,
      fullRequiredRelease: 2,
      storageItemsConsumed: 1,
    });
  });

  it('reserves the full Provisions batch before dismissing rating-excess Storage pressure', async () => {
    const { api } = await loadUserscript();
    const runtime = {
      openRouting: { storageItems: [] },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 3 } } }),
        }),
      },
    };
    const loopDef = {
      rollingProvisionsShortageRecoveryEnabled: true,
      rollingProvisionsUpgrade: {
        activityResolved: true,
        sbcSetIds: [1300],
        challengeIds: [2300],
        requirements: [{ count: 4 }],
      },
    };

    expect(api.rollingRatingExcessStorageRequirement(loopDef, runtime)).toMatchObject({
      ok: true,
      currentFree: 3,
      reserveSlots: 4,
      minimumConsumption: 1,
    });
    expect(api.rollingRatingExcessStorageRequirement({
      ...loopDef,
      rollingProvisionsShortageRecoveryEnabled: false,
    }, runtime)).toMatchObject({
      ok: true,
      currentFree: 3,
      reserveSlots: 1,
      minimumConsumption: 0,
    });
  });

  it('counts an authorized pending Unassigned duplicate as pressure progress alongside Storage consumption', async () => {
    const pending = Array.from({ length: 2 }, (_, index) => makePlayer({
      id: 709 + index,
      definitionId: 9709 + index,
      duplicate: true,
    }));
    const { api } = await loadUserscript({ unassigned: pending });
    const runtime = {
      openRouting: { storageItems: pending },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 0 } } }),
        }),
      },
    };

    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 1, {
      allowIncremental: true,
      maximumRelease: 2,
      consumedPendingRefs: [pending[0]],
    })).toMatchObject({
      ok: true,
      requiredRelease: 2,
      storageItemsConsumed: 1,
      pendingSignalsConsumed: 1,
      effectiveRelease: 2,
    });
  });

  it('enforces the minimum real Storage release requested by rating-excess recovery', async () => {
    const { api } = await loadUserscript();
    const runtime = {
      openRouting: { storageItems: [] },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 1 } } }),
        }),
      },
    };

    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 2, {
      allowIncremental: true,
      maximumRelease: 4,
      minimumConsumption: 3,
    })).toMatchObject({
      ok: false,
      reasonCode: 'RECOVERY_STORAGE_HEADROOM_INSUFFICIENT',
      details: { requiredRelease: 3, storageItemsConsumed: 2 },
    });
    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 3, {
      allowIncremental: true,
      maximumRelease: 4,
      minimumConsumption: 3,
    })).toMatchObject({
      ok: true,
      requiredRelease: 3,
      projectedFree: 4,
    });
  });

  it('does not require Storage headroom for pending cards consumed by the recovery squad', async () => {
    const pendingOne = makePlayer({ id: 711, definitionId: 9711, duplicate: true });
    const pendingTwo = makePlayer({ id: 712, definitionId: 9712, duplicate: true });
    const { api } = await loadUserscript({ unassigned: [pendingOne, pendingTwo] });
    const runtime = {
      openRouting: { storageItems: [pendingOne, pendingTwo] },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 0 } } }),
        }),
      },
    };

    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 0, {
      consumedPendingRefs: [pendingOne, pendingTwo],
    })).toMatchObject({
      ok: true,
      projectedFree: 0,
      requiredFree: 0,
    });
    expect(api.validateRollingEmergencyProvisionsSelection(runtime, 1, {
      consumedPendingRefs: [pendingOne],
    })).toMatchObject({
      ok: true,
      projectedFree: 1,
      requiredFree: 1,
    });
  });

  it('turns pending Storage headroom into a pre-plan real-Storage role', async () => {
    const primary = Array.from({ length: 5 }, (_, index) => makePlayer({
      id: 731 + index,
      definitionId: 9731 + index,
      rating: 85 + index,
      duplicate: true,
    }));
    const pending = Array.from({ length: 4 }, (_, index) => makePlayer({
      id: 741 + index,
      definitionId: 9741 + index,
      rating: 90 + index,
      duplicate: true,
    }));
    const storage = [
      makePlayer({ id: 751, definitionId: 9751, rating: 87, pile: 'storage' }),
      makePlayer({ id: 752, definitionId: 9752, rating: 89, pile: 'storage' }),
      makePlayer({ id: 753, definitionId: 9753, rating: 97, pile: 'storage' }),
    ];
    const { api } = await loadUserscript({ unassigned: [...primary, ...pending], storage });
    const runtime = {
      openRouting: { storageItems: pending },
      coordinator: {
        getLedger: () => ({
          summary: () => ({ capacities: { storage: { free: 2 } } }),
          classifiedEntries: () => storage.map((item) => ({
            item,
            pile: 'storage',
            classification: { requiredSpecial: false, protected: false },
          })),
        }),
      },
    };

    const pressure = api.rollingRatingRecoveryStoragePressure(runtime, {
      consumedPendingRefs: primary,
      maxRating: 96,
      maxCount: 11,
    });

    expect(pressure).toMatchObject({
      ok: true,
      currentFree: 2,
      pendingStorageItems: 4,
      minimumConsumption: 2,
      pressureItemRefs: [
        expect.objectContaining({ id: 751, pile: 'storage' }),
        expect.objectContaining({ id: 752, pile: 'storage' }),
      ],
      role: expect.objectContaining({
        id: 'storage-pressure-release',
        minCount: 2,
        maxCount: 11,
      }),
    });
    expect(pressure.role.matches(storage[0])).toBe(true);
    expect(pressure.role.matches(storage[2])).toBe(false);
  });

  it('keeps pending Unassigned duplicates protected from Storage Sink while swaps are disabled', async () => {
    const pending = [
      { id: 761, definitionId: 9761, pile: 'unassigned' },
      { id: 762, definitionId: 9762, pile: 'unassigned' },
    ];
    const { api } = await loadUserscript();

    expect(api.rollingStorageSinkConsumablePendingRefs({
      duplicateSwapEnabled: false,
    }, pending)).toEqual([]);
    expect(api.rollingStorageSinkConsumablePendingRefs({
      duplicateSwapEnabled: true,
      duplicateSwapMode: 'all-eligible',
    }, pending)).toEqual(pending);
    expect(api.rollingStorageSinkConsumablePendingRefs({
      duplicateSwapEnabled: true,
      duplicateSwapMode: 'special-only',
    }, pending)).toEqual([]);
  });

  it('protects every pending emergency Provisions item while swaps are disabled', async () => {
    const reserve = makePlayer({ id: 763, definitionId: 9763, rating: 88, duplicate: true });
    const ordinary = makePlayer({ id: 764, definitionId: 9764, rating: 86, duplicate: true });
    const reserveIds = new Set([reserve.id]);
    const { api } = await loadUserscript();

    expect(api.rollingEmergencyProvisionsProtectedRefs({
      duplicateSwapEnabled: false,
      openRouting: { storageItems: [reserve, ordinary] },
    }, reserveIds)).toEqual([
      expect.objectContaining({ id: reserve.id, pile: 'unassigned' }),
      expect.objectContaining({ id: ordinary.id, pile: 'unassigned' }),
    ]);
    expect(api.rollingEmergencyProvisionsProtectedRefs({
      duplicateSwapEnabled: true,
      openRouting: { storageItems: [reserve, ordinary] },
    }, reserveIds)).toEqual([
      expect.objectContaining({ id: ordinary.id, pile: 'unassigned' }),
    ]);
  });

  it('uses the configured Provision reserve range for safe pressure duplicate signals', async () => {
    const safeSignal = makePlayer({
      id: 771,
      definitionId: 9771,
      rating: 88,
      duplicate: true,
      duplicateId: 1771,
    });
    const safeTarget = makePlayer({ id: 1771, definitionId: 9771, rating: 88 });
    const highSignal = makePlayer({
      id: 772,
      definitionId: 9772,
      rating: 89,
      duplicate: true,
      duplicateId: 1772,
    });
    const highTarget = makePlayer({ id: 1772, definitionId: 9772, rating: 89 });
    const lowSignal = makePlayer({
      id: 776,
      definitionId: 9776,
      rating: 86,
      duplicate: true,
      duplicateId: 1776,
    });
    const lowTarget = makePlayer({ id: 1776, definitionId: 9776, rating: 86 });
    const overSignal = makePlayer({
      id: 777,
      definitionId: 9777,
      rating: 90,
      duplicate: true,
      duplicateId: 1777,
    });
    const overTarget = makePlayer({ id: 1777, definitionId: 9777, rating: 90 });
    const specialSignal = makePlayer({
      id: 773,
      definitionId: 9773,
      rating: 88,
      rareflag: 22,
      duplicate: true,
      duplicateId: 1773,
    });
    const specialTarget = makePlayer({ id: 1773, definitionId: 9773, rating: 88, rareflag: 22 });
    const { api } = await loadUserscript({
      unassigned: [safeSignal, highSignal, lowSignal, overSignal, specialSignal],
      club: [safeTarget, highTarget, lowTarget, overTarget, specialTarget],
    });
    const runtime = {
      duplicateSwapEnabled: false,
      pendingUnassignedRefs: [safeSignal, highSignal, lowSignal, overSignal, specialSignal],
      openRouting: {
        storageItems: [safeSignal, highSignal, lowSignal, overSignal, specialSignal],
      },
      primaryDuplicateRefs: [],
    };
    const loopDef = { name: 'pressure provisions', runtimeProtectionRating: 95 };

    expect(api.rollingStoragePressureConsumablePendingRefs(runtime, loopDef)).toEqual([
      expect.objectContaining({ id: safeSignal.id, definitionId: safeSignal.definitionId, pile: 'unassigned' }),
    ]);
    const expandedLoopDef = {
      ...loopDef,
      runtimeProvisionsMaxRating: 89,
    };
    expect(api.rollingStoragePressureConsumablePendingRefs(runtime, expandedLoopDef)).toEqual([
      expect.objectContaining({ id: safeSignal.id }),
      expect.objectContaining({ id: highSignal.id }),
    ]);
    expect(api.assertRollingRecoveryItems(expandedLoopDef, runtime, [highTarget], {
      allowProvisionsReserve: true,
      allowSpecial: true,
      allowedPendingUnassignedRefs: [highSignal],
      allowedRatings: [87, 88, 89],
      minRating: 87,
      maxRating: 89,
      selection: {
        entries: [{ pileName: 'unassigned', signal: highSignal, item: highTarget }],
      },
    })).toBe(true);
    expect(api.rollingEmergencyProvisionsProtectedRefs(
      runtime,
      new Set(),
      [{ id: safeSignal.id, definitionId: safeSignal.definitionId, pile: 'unassigned' }],
    )).toEqual([
      expect.objectContaining({ id: highSignal.id }),
      expect.objectContaining({ id: lowSignal.id }),
      expect.objectContaining({ id: overSignal.id }),
      expect.objectContaining({ id: specialSignal.id }),
    ]);
  });

  it('does not authorize a safe-looking duplicate when its target is protected or has a different card version', async () => {
    const protectedSignal = makePlayer({
      id: 774,
      definitionId: 9774,
      rating: 88,
      duplicate: true,
      duplicateId: 1774,
    });
    const protectedTarget = makePlayer({ id: 1774, definitionId: 9774, rating: 88, evolutionId: 9 });
    const mismatchedSignal = makePlayer({
      id: 775,
      definitionId: 9775,
      rating: 88,
      duplicate: true,
      duplicateId: 1775,
    });
    const mismatchedTarget = makePlayer({ id: 1775, definitionId: 9775, rating: 88, rareflag: 22 });
    const { api } = await loadUserscript({
      unassigned: [protectedSignal, mismatchedSignal],
      club: [protectedTarget, mismatchedTarget],
    });
    const runtime = {
      pendingUnassignedRefs: [protectedSignal, mismatchedSignal],
      openRouting: { storageItems: [protectedSignal, mismatchedSignal] },
      primaryDuplicateRefs: [],
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [{
            item: protectedTarget,
            pile: 'club',
            classification: { protected: true },
          }],
        }),
      },
    };
    expect(api.rollingStoragePressureConsumablePendingRefs(runtime, {
      name: 'pressure provisions',
      runtimeProtectionRating: 95,
    })).toEqual([]);
  });

  it('releases only explicitly eligible pending Storage cards from Sink protection', async () => {
    const pending = makePlayer({
      id: 721,
      definitionId: 9721,
      rating: 91,
      duplicate: true,
      duplicateId: 1721,
    });
    const counterpart = makePlayer({ id: 1721, definitionId: 9721, rating: 91 });
    const stillProtected = makePlayer({ id: 1722, definitionId: 9722, rating: 92 });
    const { api } = await loadUserscript({ unassigned: [pending] });
    const ledger = {
      classifiedEntries: () => [
        { item: counterpart, pile: 'club', classification: { protected: true } },
        { item: stillProtected, pile: 'club', classification: { protected: true } },
      ],
    };
    const runtime = {
      pendingUnassignedRefs: [pending],
      primaryDuplicateRefs: [],
      coordinator: { getLedger: () => ledger },
    };

    const policy = api.rollingStorageSinkSelectionPolicy({}, runtime, {
      model: { constraints: [] },
      consumablePendingRefs: [pending],
      consumableItemRefs: [counterpart],
      additionalRoles: [{
        id: 'storage-pressure-release',
        itemRefs: [counterpart],
        minCount: 1,
        maxCount: 1,
      }],
    });

    expect(policy.protectedItems).toEqual([
      expect.objectContaining({ id: stillProtected.id }),
    ]);
    expect(policy.exclusiveRoles).toEqual([
      expect.objectContaining({ id: 'storage-pressure-release', minCount: 1 }),
    ]);
  });

  it('allows only an explicitly selected primary duplicate to bypass reserve-rating protection', async () => {
    const primarySignal = makePlayer({
      id: 721,
      definitionId: 9721,
      rating: 88,
      duplicate: true,
      duplicateId: 1721,
    });
    const primarySubmission = makePlayer({ id: 1721, definitionId: 9721, rating: 88 });
    const sameDefinitionClubCard = makePlayer({ id: 1723, definitionId: 9721, rating: 88 });
    const unrelatedReserve = makePlayer({ id: 1722, definitionId: 9722, rating: 88 });
    const { api } = await loadUserscript();
    const runtime = {
      primaryDuplicateRefs: [{ id: primarySignal.id, definitionId: primarySignal.definitionId }],
      pendingUnassignedRefs: [{ id: primarySignal.id, definitionId: primarySignal.definitionId }],
      primaryContext: {},
      coordinator: {
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };
    const loopDef = {
      name: 'Rolling reserve recovery',
      runtimeProtectionRating: 95,
      runtimeProvisionsMaxRating: 88,
    };

    expect(api.assertRollingRecoveryItems(loopDef, runtime, [primarySubmission], {
      allowPrimaryDuplicates: true,
      allowSpecial: true,
      allowedPrimaryDuplicateRefs: [{
        id: primarySubmission.id,
        definitionId: primarySubmission.definitionId,
      }],
    })).toBe(true);
    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [sameDefinitionClubCard], {
      allowPrimaryDuplicates: true,
      allowSpecial: true,
      allowedPrimaryDuplicateRefs: [{
        id: primarySubmission.id,
        definitionId: primarySubmission.definitionId,
      }],
    })).toThrow('recovery squad attempted to consume a reserved 88 card');
    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [unrelatedReserve], {
      allowPrimaryDuplicates: true,
      allowSpecial: true,
      allowedPrimaryDuplicateRefs: [{
        id: primarySubmission.id,
        definitionId: primarySubmission.definitionId,
      }],
    })).toThrow('recovery squad attempted to consume a reserved 88 card');
  });

  it('allows only the exact Storage-pressure selection to bypass reserve-rating protection', async () => {
    const selectedReserve = makePlayer({ id: 1731, definitionId: 9731, rating: 87, rareflag: 22 });
    const unrelatedReserve = makePlayer({ id: 1732, definitionId: 9732, rating: 87, rareflag: 22 });
    const protectedReserve = makePlayer({ id: 1733, definitionId: 9733, rating: 87, rareflag: 22 });
    const { api } = await loadUserscript();
    const runtime = {
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [],
      primaryContext: {},
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [{
            item: protectedReserve,
            pile: 'storage',
            classification: { requiredSpecial: false, protected: true },
          }],
        }),
      },
    };
    const loopDef = {
      name: 'Rolling Storage-pressure reserve recovery',
      runtimeProtectionRating: 95,
      runtimeProvisionsMaxRating: 88,
      blockSpecial: false,
    };

    expect(api.assertRollingRecoveryItems(loopDef, runtime, [selectedReserve], {
      allowSpecial: true,
      allowedProvisionsReserveItems: [{
        id: selectedReserve.id,
        definitionId: selectedReserve.definitionId,
      }],
    })).toBe(true);
    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [unrelatedReserve], {
      allowSpecial: true,
      allowedProvisionsReserveItems: [{
        id: selectedReserve.id,
        definitionId: selectedReserve.definitionId,
      }],
    })).toThrow('recovery squad attempted to consume a reserved 87 card');
    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [protectedReserve], {
      allowSpecial: true,
      allowedProvisionsReserveItems: [{
        id: protectedReserve.id,
        definitionId: protectedReserve.definitionId,
      }],
    })).toThrow('recovery squad attempted to consume a protected card');
  });

  it('rejects a pending Storage signal at final recovery validation while swaps are disabled', async () => {
    const pendingSignal = makePlayer({
      id: 1741,
      definitionId: 9741,
      rating: 86,
      duplicate: true,
      duplicateId: 2741,
    });
    const clubCounterpart = makePlayer({
      id: 2741,
      definitionId: 9741,
      rating: 86,
    });
    const { api } = await loadUserscript();
    const runtime = {
      duplicateSwapEnabled: false,
      openRouting: { storageItems: [pendingSignal] },
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [],
      primaryContext: {},
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [{
            item: clubCounterpart,
            pile: 'club',
            classification: { requiredSpecial: false, protected: false },
          }],
        }),
      },
    };
    const loopDef = {
      name: 'Rolling disabled-swap emergency Provisions',
      runtimeProtectionRating: 95,
      runtimeProvisionsMaxRating: 88,
    };
    const selection = {
      entries: [{
        pileName: 'unassigned',
        signal: pendingSignal,
        item: clubCounterpart,
      }],
    };

    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [clubCounterpart], {
      allowProvisionsReserve: true,
      allowSpecial: true,
      selection,
      rejectPendingStorageSignals: true,
    })).toThrow('recovery squad attempted to consume a pending Storage-routed duplicate signal');
  });

  it('does not transfer protected-item authorization to same-definition B or C cards', async () => {
    const allowedA = makePlayer({ id: 1801, definitionId: 9801, rating: 86 });
    const protectedB = makePlayer({ id: 1802, definitionId: 9801, rating: 86 });
    const protectedC = makePlayer({ id: 1803, definitionId: 9801, rating: 86 });
    const { api } = await loadUserscript();
    const runtime = {
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [],
      primaryContext: {},
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [allowedA, protectedB, protectedC].map((item) => ({
            item,
            pile: 'club',
            classification: { requiredSpecial: false, protected: true },
          })),
        }),
      },
    };
    const loopDef = {
      name: 'Rolling exact protected authorization',
      runtimeProtectionRating: 95,
      blockSpecial: false,
    };

    expect(api.assertRollingRecoveryItems(loopDef, runtime, [allowedA], {
      allowSpecial: true,
      allowedProtectedItems: [{ id: allowedA.id, definitionId: allowedA.definitionId }],
    })).toBe(true);
    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [protectedB], {
      allowSpecial: true,
      allowedProtectedItems: [{ id: allowedA.id, definitionId: allowedA.definitionId }],
    })).toThrow('recovery squad attempted to consume a protected card');
    expect(() => api.assertRollingRecoveryItems(loopDef, runtime, [protectedC], {
      allowSpecial: true,
      allowedProtectedItems: [{ id: allowedA.id, definitionId: allowedA.definitionId }],
    })).toThrow('recovery squad attempted to consume a protected card');
  });

  it('checks EA Storage Sink challenge readiness only after the selected squad is saved', async () => {
    const { api } = await loadUserscript();
    const players = Array.from({ length: 11 }, (_, index) => makePlayer({
      id: 800 + index,
      definitionId: 9800 + index,
      rating: 89,
      rareflag: 1,
    }));
    let readinessChecks = 0;
    let squadSaved = false;
    const context = {
      model: {
        requiredPlayerCount: 11,
        targetRating: 89,
        constraints: [],
        maxSpecialCount: 11,
      },
      challenge: {
        meetsRequirements() {
          readinessChecks++;
          return squadSaved;
        },
      },
    };
    const runtime = {
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [],
      primaryContext: {},
      coordinator: {
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };
    const loopDef = {
      name: 'Rolling Storage Sink',
      runtimeProtectionRating: 95,
      expectedPlayerCount: 11,
    };

    const validators = api.createRollingStorageSinkSubmissionValidators(
      loopDef,
      runtime,
      context,
      'Storage Sink test',
    );

    expect(validators.validatePlannedPlayers(players)).toBe(true);
    expect(validators.preSave({ players })).toBe(true);
    expect(readinessChecks).toBe(0);

    squadSaved = true;
    expect(validators.postSave({ players, savedPlayers: players })).toBe(true);
    expect(readinessChecks).toBe(1);
  });

  it('treats a completed Storage Sink as unavailable with an explicit exhaustion reason', async () => {
    const { api } = await loadUserscript();
    const sinkDef = { name: '1 of 4 95+ Player Pick', setId: 1400 };
    const set = { id: 1400 };

    expect(api.completedRollingStorageSinkUnavailable(sinkDef, set, [{ id: 1 }, { id: 2 }]))
      .toMatchObject({
        status: 'unavailable',
        reason: '1 of 4 95+ Player Pick is already complete and has no incomplete Storage pressure challenge',
        reasonCode: 'STORAGE_SINK_COMPLETED',
        sinkDef,
        set,
        contexts: [],
        completedCount: 2,
        incompleteCount: 0,
        details: {
          setId: 1400,
          completedCount: 2,
          totalChallengeCount: 2,
        },
      });
  });

  it('treats a submitted Storage Sink Pick without an observable reward as progress', async () => {
    const { api } = await loadUserscript();

    expect(api.rollingStorageSinkMissingPlayerPickResult(
      { name: '1 of 4 95+ FOF or FUTTIES T1-T4 Player Pick' },
      { status: 'missing', reasonCode: 'STORAGE_SINK_REWARD_NOT_FOUND' },
      { targetRating: 90 },
      { projectedFree: 14, requiredFree: 9 },
    )).toEqual({
      status: 'submitted',
      submitted: true,
      reason: '1 of 4 95+ FOF or FUTTIES T1-T4 Player Pick challenge submitted; Player Pick reward was not observed, continuing Rolling',
      reasonCode: 'STORAGE_SINK_REWARD_NOT_FOUND_SKIPPED',
      details: {
        rewardMissing: true,
        submittedRating: 90,
        headroom: { projectedFree: 14, requiredFree: 9 },
      },
    });
  });

  it('does not assume the final challenge completed the Pick Set when live challenge state disagrees', async () => {
    const { api, window } = await loadUserscript({ pageReady: true, fastTimers: true });
    window.services.SBC.requestChallengesForSet = vi.fn(() => successfulObservable({
      success: true,
      status: 200,
      data: {
        challenges: [
          { id: 3932, completed: true },
          { id: 3933, completed: false },
        ],
      },
    }));

    await expect(api.confirmRollingStorageSinkSetCompletion(
      { id: 1378 },
      'Storage Sink completion confirmation',
      2,
    )).resolves.toMatchObject({
      confirmed: false,
      challengeCount: 2,
      expectedChallengeCount: 2,
      incompleteChallengeIds: [3933],
    });
  });

  it('selects Cornet 86 from live state when the cached 87 squad is already complete', async () => {
    const { api, window } = await loadUserscript({ pageReady: true, fastTimers: true });
    const set = { id: 1382, name: 'Maxwel Cornet' };
    const challenges = [{
      id: 3939,
      status: 'COMPLETED',
      completed: true,
      requiredPlayerCount: 11,
      eligibilityRequirements: [{ key: 'TEAM_RATING', values: [87], count: -1 }],
    }, {
      id: 3938,
      status: 'IN_PROGRESS',
      completed: false,
      requiredPlayerCount: 11,
      eligibilityRequirements: [
        { key: 'PLAYER_RARITY_GROUP', values: [83], count: 1 },
        { key: 'TEAM_RATING', values: [86], count: -1 },
      ],
    }];
    window.services.SBC.repository = { sets: { _collection: [set] } };
    window.services.SBC.requestChallengesForSet = vi.fn(() => successfulObservable({
      success: true,
      status: 200,
      data: { challenges },
    }));

    const loaded = await api.loadRollingGenericStorageSinkContexts(
      { name: '10x85+ Rolling Loop', dryRun: true },
      {
        setId: 1382,
        setName: 'Maxwel Cornet',
        loop: {
          name: 'Maxwel Cornet',
          strategy: 'storagePressureSbc',
          sbcSetIds: [1382],
          sbcNames: ['Maxwel Cornet'],
        },
      },
    );

    expect(loaded).toMatchObject({
      status: 'ready',
      totalChallengeCount: 2,
      completedCount: 1,
      incompleteCount: 1,
      contexts: [{ challengeId: 3938, targetRating: 86 }],
    });
  });

  it('loads a fresh DAO Challenge before planning a live generic Storage Sink', async () => {
    const { api, window } = await loadUserscript({ pageReady: true, fastTimers: true });
    const set = { id: 1419, name: '1 of 4 96+ FUTTIES Player Pick' };
    const staleChallenge = {
      id: 4115,
      status: 'NOT_STARTED',
      requiredPlayerCount: 11,
      eligibilityRequirements: [{ key: 'TEAM_RATING', values: [89], count: -1 }],
      isInProgress: () => false,
    };
    const freshChallenge = {
      id: 4115,
      status: 'IN_PROGRESS',
      requiredPlayerCount: 11,
      eligibilityRequirements: [{ key: 'TEAM_RATING', values: [89], count: -1 }],
      isInProgress: () => true,
    };
    const squad = { getPlayers: () => [] };
    const requestChallengesForSet = vi.fn(() => successfulObservable({
      success: true,
      status: 200,
      data: { challenges: [staleChallenge] },
    }));
    const getChallengesForSet = vi.fn(() => successfulObservable({
      success: true,
      status: 200,
      response: { challenges: [freshChallenge] },
    }));
    const loadChallenge = vi.fn((challengeId, inProgress) => successfulObservable({
      success: true,
      status: 200,
      response: { squad },
    }));
    window.services.SBC.repository = { sets: { _collection: [set] } };
    window.services.SBC.requestChallengesForSet = requestChallengesForSet;
    window.services.SBC.sbcDAO = { getChallengesForSet, loadChallenge };

    const loaded = await api.loadRollingGenericStorageSinkContexts(
      { name: '10x85+ Rolling Loop', dryRun: false },
      {
        setId: 1419,
        setName: set.name,
        loop: {
          name: set.name,
          strategy: 'storagePressureSbc',
          sbcSetIds: [1419],
          sbcNames: [set.name],
        },
      },
    );

    expect(loaded).toMatchObject({
      status: 'ready',
      contexts: [{ challenge: freshChallenge, challengeId: 4115, targetRating: 89 }],
    });
    expect(requestChallengesForSet).not.toHaveBeenCalled();
    expect(getChallengesForSet).toHaveBeenCalledWith(1419);
    expect(loadChallenge).toHaveBeenCalledWith(4115, true);
  });

  it('marks Cornet exhausted only when both live challenges are complete', async () => {
    const { api, window } = await loadUserscript({ pageReady: true, fastTimers: true });
    const set = { id: 1382, name: 'Maxwel Cornet' };
    window.services.SBC.repository = { sets: { _collection: [set] } };
    window.services.SBC.requestChallengesForSet = vi.fn(() => successfulObservable({
      success: true,
      status: 200,
      data: {
        challenges: [
          { id: 3938, status: 'COMPLETED', completed: true },
          { id: 3939, status: 'COMPLETED', completed: true },
        ],
      },
    }));

    await expect(api.loadRollingGenericStorageSinkContexts(
      { name: '10x85+ Rolling Loop', dryRun: true },
      {
        loop: {
          name: 'Maxwel Cornet',
          strategy: 'storagePressureSbc',
          sbcSetIds: [1382],
          sbcNames: ['Maxwel Cornet'],
        },
      },
    )).resolves.toMatchObject({
      status: 'unavailable',
      reasonCode: 'STORAGE_SINK_COMPLETED',
      completedCount: 2,
      incompleteCount: 0,
    });
  });

  it('falls back from an exhausted automatic Storage Sink to the next cached candidate', async () => {
    const { api } = await loadUserscript();
    const first = { setId: 1401, setName: 'Limited 95+ Pick', loop: {} };
    const second = { setId: 1402, setName: 'Player SBC', loop: {} };
    const runCapability = vi.fn(async (capability) => (
      capability.setId === first.setId
        ? {
            status: 'unavailable',
            reason: 'Limited 95+ Pick is already complete',
            reasonCode: 'STORAGE_SINK_COMPLETED',
          }
        : { status: 'submitted', submitted: true }
    ));
    const runtime = {};

    expect(await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      runtime,
      { mode: 'automatic', capability: first, alternatives: [second] },
      { runCapability, refreshCapabilities: vi.fn() },
    )).toMatchObject({ status: 'submitted', submitted: true });
    expect(runCapability.mock.calls.map(([capability]) => capability.setId)).toEqual([1401, 1402]);
    expect([...runtime.storageSinkExhaustedSetIds]).toEqual([1401]);
  });

  it('does not rerun an infeasible Storage Sink until inventory or pending state changes', async () => {
    const { api } = await loadUserscript();
    let inventoryVersion = 10;
    const candidate = { setId: 1405, setName: 'Large Player SBC', loop: {} };
    const runCapability = vi.fn(async () => ({
      status: 'unavailable',
      reason: 'no exact 89-rated squad can release the required Storage cards',
      reasonCode: 'RECOVERY_STORAGE_PRESSURE_INFEASIBLE',
    }));
    const runtime = {
      openRouting: { storageItems: [{ id: 9001, definitionId: 8001 }] },
      primaryDuplicateRefs: [{ id: 9001, definitionId: 8001 }],
      coordinator: {
        getLedger: () => ({
          summary: () => ({
            inventoryVersion,
            capacities: { storage: { free: 2 } },
          }),
        }),
      },
    };
    const definition = { mode: 'automatic', capability: candidate, alternatives: [] };

    await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      runtime,
      definition,
      { runCapability, allowRefresh: false },
    );
    const unchanged = await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      runtime,
      definition,
      { runCapability, allowRefresh: false },
    );
    expect(runCapability).toHaveBeenCalledOnce();
    expect(unchanged).toMatchObject({
      status: 'unavailable',
      details: {
        capabilityFailures: [{
          setId: 1405,
          reasonCode: 'STORAGE_SINK_STATE_UNCHANGED',
        }],
      },
    });

    inventoryVersion = 11;
    await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      runtime,
      definition,
      { runCapability, allowRefresh: false },
    );
    expect(runCapability).toHaveBeenCalledTimes(2);
  });

  it('skips session-exhausted candidates and retries once with a newly scanned automatic Sink', async () => {
    const { api } = await loadUserscript();
    const exhausted = { setId: 1411, setName: 'Completed Pick', loop: {} };
    const stale = { setId: 1412, setName: 'Expired Player SBC', loop: {} };
    const fresh = { setId: 1413, setName: 'Fresh Player SBC', loop: {} };
    const runtime = { storageSinkExhaustedSetIds: new Set([exhausted.setId]) };
    const runCapability = vi.fn(async (capability) => (
      capability.setId === stale.setId
        ? { status: 'unavailable', reason: 'expired', reasonCode: 'LIVE_REQUIREMENT_UNAVAILABLE' }
        : { status: 'submitted', submitted: true }
    ));
    const refreshCapabilities = vi.fn(async () => ({
      status: 'ready',
      definition: { mode: 'automatic', capability: fresh, alternatives: [] },
    }));

    expect(await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      runtime,
      { mode: 'automatic', capability: exhausted, alternatives: [stale] },
      { runCapability, refreshCapabilities },
    )).toMatchObject({ status: 'submitted', submitted: true });
    expect(runCapability.mock.calls.map(([capability]) => capability.setId)).toEqual([1412, 1413]);
    expect(refreshCapabilities).toHaveBeenCalledOnce();
    expect(runtime.storageSinkRefreshAttempted).toBe(true);
  });

  it('requires a new user selection when an explicitly selected Storage Sink is exhausted', async () => {
    const { api } = await loadUserscript();
    const selected = { setId: 1421, setName: 'Selected Limited Pick', loop: {} };
    const refreshCapabilities = vi.fn();

    expect(await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      {},
      { mode: 'selected', capability: selected, alternatives: [] },
      {
        runCapability: vi.fn(async () => ({
          status: 'unavailable',
          reason: 'Selected Limited Pick is already complete',
          reasonCode: 'STORAGE_SINK_COMPLETED',
        })),
        refreshCapabilities,
      },
    )).toMatchObject({
      status: 'blocked',
      reason: expect.stringContaining('choose another Storage pressure SBC'),
      reasonCode: 'STORAGE_SINK_SELECTION_REQUIRED',
      details: {
        exhaustedSetIds: [1421],
        runtimeRefreshAttempted: false,
        selectedSetId: 1421,
        selectedSetName: 'Selected Limited Pick',
        previousReasonCode: 'STORAGE_SINK_COMPLETED',
      },
    });
    expect(refreshCapabilities).not.toHaveBeenCalled();
  });

  it('requires a new user selection when the selected Sink has no executable live challenge', async () => {
    const { api } = await loadUserscript();
    const selected = { setId: 1422, setName: 'Stale Selected Pick', loop: {} };
    const refreshCapabilities = vi.fn();

    expect(await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      {},
      { mode: 'selected', capability: selected, alternatives: [] },
      {
        runCapability: vi.fn(async () => ({
          status: 'unavailable',
          reason: 'Stale Selected Pick has no incomplete 85+ rating squad',
          reasonCode: 'LIVE_REQUIREMENT_UNAVAILABLE',
        })),
        refreshCapabilities,
      },
    )).toMatchObject({
      status: 'blocked',
      reason: expect.stringContaining('choose another Storage pressure SBC'),
      reasonCode: 'STORAGE_SINK_SELECTION_REQUIRED',
      details: {
        exhaustedSetIds: [],
        runtimeRefreshAttempted: false,
        selectedSetId: 1422,
        selectedSetName: 'Stale Selected Pick',
        previousReason: 'Stale Selected Pick has no incomplete 85+ rating squad',
        previousReasonCode: 'LIVE_REQUIREMENT_UNAVAILABLE',
      },
    });
    expect(refreshCapabilities).not.toHaveBeenCalled();
  });

  it('refreshes an unbound selected Sink once and stops without falling back anonymously', async () => {
    const { api } = await loadUserscript();
    const refreshCapabilities = vi.fn(async () => ({
      status: 'unavailable',
      reason: 'selected Set is absent from the current live scan',
      reasonCode: 'NO_STORAGE_SINK_AVAILABLE',
    }));

    expect(await api.runRollingStorageSinkRecovery(
      {
        name: 'Rolling Loop',
        rollingStorageSinkMode: 'selected',
        rollingStorageSinkSetId: 1382,
        rollingStorageSinkSetName: 'Maxwel Cornet',
      },
      {},
      {
        mode: 'selected',
        status: 'unavailable',
        selectedSetId: 1382,
        selectedSetName: 'Maxwel Cornet',
      },
      { refreshCapabilities },
    )).toMatchObject({
      status: 'blocked',
      reason: expect.stringContaining('Maxwel Cornet (Set #1382)'),
      reasonCode: 'STORAGE_SINK_SELECTION_REQUIRED',
      details: {
        selectedSetId: 1382,
        selectedSetName: 'Maxwel Cornet',
        boundCapabilities: [],
        previousReasonCode: 'NO_STORAGE_SINK_AVAILABLE',
        runtimeRefreshAttempted: true,
      },
    });
    expect(refreshCapabilities).toHaveBeenCalledOnce();
  });

  it('rejects a stale Nkunku binding when Cornet is the selected Storage Sink', async () => {
    const { api } = await loadUserscript();
    const runCapability = vi.fn();
    const refreshCapabilities = vi.fn(async () => ({
      status: 'unavailable',
      reason: 'live binding still does not match',
      reasonCode: 'STORAGE_SINK_BINDING_MISMATCH',
    }));

    expect(await api.runRollingStorageSinkRecovery(
      {
        name: 'Rolling Loop',
        rollingStorageSinkMode: 'selected',
        rollingStorageSinkSetId: 1382,
        rollingStorageSinkSetName: 'Maxwel Cornet',
      },
      {},
      {
        mode: 'selected',
        status: 'resolved',
        selectedSetId: 1381,
        selectedSetName: 'Christopher Nkunku',
        capability: { setId: 1381, setName: 'Christopher Nkunku', loop: {} },
      },
      { runCapability, refreshCapabilities },
    )).toMatchObject({
      status: 'blocked',
      reasonCode: 'STORAGE_SINK_SELECTION_REQUIRED',
      details: {
        selectedSetId: 1382,
        selectedSetName: 'Maxwel Cornet',
        boundCapabilities: [{ setId: 1381, setName: 'Christopher Nkunku' }],
        previousReasonCode: 'STORAGE_SINK_BINDING_MISMATCH',
      },
    });
    expect(runCapability).not.toHaveBeenCalled();
    expect(refreshCapabilities).toHaveBeenCalledOnce();
  });

  it('stops automatic recovery explicitly after its one live refresh finds no Sink', async () => {
    const { api } = await loadUserscript();
    const completed = { setId: 1431, setName: 'Completed Pick', loop: {} };
    const refreshCapabilities = vi.fn(async () => ({
      status: 'unavailable',
      reason: 'live scan found no candidate',
      reasonCode: 'NO_STORAGE_SINK_AVAILABLE',
    }));
    const runtime = {};

    expect(await api.runRollingStorageSinkRecovery(
      { name: 'Rolling Loop' },
      runtime,
      { mode: 'automatic', capability: completed, alternatives: [] },
      {
        runCapability: vi.fn(async () => ({
          status: 'unavailable',
          reason: 'Completed Pick is already complete',
          reasonCode: 'STORAGE_SINK_COMPLETED',
        })),
        refreshCapabilities,
      },
    )).toMatchObject({
      status: 'unavailable',
      reasonCode: 'NO_STORAGE_SINK_AVAILABLE',
      details: {
        exhaustedSetIds: [1431],
        runtimeRefreshAttempted: true,
        refreshReasonCode: 'NO_STORAGE_SINK_AVAILABLE',
      },
    });
    expect(refreshCapabilities).toHaveBeenCalledOnce();
    expect(runtime.storageSinkRefreshAttempted).toBe(true);
  });

  it('allows exactly one Required Special through final Storage Sink validation', async () => {
    const requiredSpecial = makePlayer({
      id: 900,
      definitionId: 9900,
      rating: 95,
      rareflag: 120,
      groups: [19, 33, 44, 83],
    });
    requiredSpecial.pile = 'club';
    const ordinary = Array.from({ length: 10 }, (_, index) => makePlayer({
      id: 901 + index,
      definitionId: 9901 + index,
      rating: 89,
      rareflag: 1,
    }));
    const groupConstraint = {
      source: 'ea',
      keyName: 'PLAYER_RARITY_GROUP',
      label: 'PLAYER_RARITY_GROUP 83 x1',
      count: 1,
      matches: (item) => (item.groups || []).includes(83),
    };
    const context = {
      model: {
        requiredPlayerCount: 11,
        targetRating: 88,
        constraints: [groupConstraint],
        maxSpecialCount: 1,
      },
    };
    const runtime = {
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [],
      primaryContext: { model: context.model },
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [{
            item: requiredSpecial,
            pile: 'club',
            classification: { requiredSpecial: true, protected: false },
          }],
        }),
      },
    };
    const loopDef = {
      name: 'Rolling Storage Sink',
      runtimeProtectionRating: 95,
      expectedPlayerCount: 11,
    };
    const { api } = await loadUserscript({ club: [requiredSpecial] });
    const validators = api.createRollingStorageSinkSubmissionValidators(
      loopDef,
      runtime,
      context,
      'Storage Sink exact-one test',
    );

    expect(validators.validatePlannedPlayers([requiredSpecial, ...ordinary])).toBe(true);

    const secondRequiredSpecial = makePlayer({
      id: 920,
      definitionId: 9920,
      rating: 89,
      rareflag: 120,
      groups: [44, 83],
    });
    expect(() => validators.validatePlannedPlayers([
      requiredSpecial,
      secondRequiredSpecial,
      ...ordinary.slice(1),
    ])).toThrow(/role-count 2\/1-1/);
  });

  it('keeps Required Special protection when a Storage Sink squad has no explicit role', async () => {
    const requiredSpecial = makePlayer({
      id: 930,
      definitionId: 9930,
      rating: 91,
      rareflag: 120,
      groups: [44, 83],
    });
    const ordinary = Array.from({ length: 10 }, (_, index) => makePlayer({
      id: 931 + index,
      definitionId: 9931 + index,
      rating: 89,
      rareflag: 1,
    }));
    const primaryModel = {
      constraints: [{
        source: 'ea',
        keyName: 'PLAYER_RARITY_GROUP',
        count: 1,
        matches: (item) => (item.groups || []).includes(83),
      }],
    };
    const context = {
      model: {
        requiredPlayerCount: 11,
        targetRating: 88,
        constraints: [],
        maxSpecialCount: 11,
      },
    };
    const runtime = {
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [],
      primaryContext: { model: primaryModel },
      coordinator: {
        getLedger: () => ({ classifiedEntries: () => [] }),
      },
    };
    const { api } = await loadUserscript();
    const validators = api.createRollingStorageSinkSubmissionValidators(
      { name: 'Rolling Storage Sink', runtimeProtectionRating: 95, expectedPlayerCount: 11 },
      runtime,
      context,
      'Storage Sink protected-special test',
    );

    expect(() => validators.validatePlannedPlayers([requiredSpecial, ...ordinary]))
      .toThrow(/attempted to consume a Required Special card/);
  });

  it('validates a threshold-safe pending Unassigned special selected for Storage pressure', async () => {
    const pending = makePlayer({
      id: 950,
      definitionId: 9950,
      rating: 88,
      rareflag: 120,
      duplicate: true,
      duplicateId: 1950,
    });
    const counterpart = makePlayer({
      id: 1950,
      definitionId: 9950,
      rating: 88,
      rareflag: 120,
    });
    const ordinary = Array.from({ length: 10 }, (_, index) => makePlayer({
      id: 1960 + index,
      definitionId: 9960 + index,
      rating: 88,
      rareflag: 1,
    }));
    const loopDef = {
      name: 'Rolling Storage pressure',
      runtimeProtectionRating: 95,
      expectedPlayerCount: 11,
      rollingProtectAllClubNonTotwSpecials: true,
    };
    const context = {
      model: {
        requiredPlayerCount: 11,
        targetRating: 88,
        constraints: [],
        maxSpecialCount: 11,
      },
    };
    const runtime = {
      primaryDuplicateRefs: [],
      pendingUnassignedRefs: [pending],
      openRouting: { storageItems: [pending] },
      primaryContext: { activeLoopDef: loopDef, model: { constraints: [] } },
      coordinator: {
        getLedger: () => ({
          classifiedEntries: () => [{
            item: counterpart,
            pile: 'club',
            classification: { protected: true, otherSpecial: true },
          }],
        }),
      },
    };
    const selection = {
      entries: [{
        item: counterpart,
        signal: pending,
        pileName: 'unassigned',
        submissionPileName: 'club',
      }],
    };
    const { api } = await loadUserscript({
      unassigned: [pending],
      club: [counterpart, ...ordinary],
    });
    const validators = api.createRollingStorageSinkSubmissionValidators(
      loopDef,
      runtime,
      context,
      'Storage pressure pending-special test',
    );

    expect(validators.validatePlannedPlayers([counterpart, ...ordinary], selection)).toBe(true);
  });

  it('reuses an already loaded Set challenge squad without replacing fresh metadata', async () => {
    const { api } = await loadUserscript();
    const cachedSquad = { id: 'cached-squad' };
    const cachedChallenge = { id: 3870, squad: cachedSquad, eligibilityRequirements: ['stale'] };
    const freshChallenge = { id: 3870, squad: null, eligibilityRequirements: ['fresh'] };
    const set = { challenges: { _collection: [cachedChallenge] } };

    expect(api.synchronizeCachedSbcChallengeSquad(set, freshChallenge)).toBe(freshChallenge);
    expect(freshChallenge.squad).toBe(cachedSquad);
    expect(freshChallenge.eligibilityRequirements).toEqual(['fresh']);

    const newlyLoadedSquad = { id: 'newly-loaded-squad' };
    freshChallenge.squad = newlyLoadedSquad;
    cachedChallenge.squad = null;
    api.synchronizeCachedSbcChallengeSquad(set, freshChallenge);
    expect(cachedChallenge.squad).toBe(newlyLoadedSquad);
  });
});
