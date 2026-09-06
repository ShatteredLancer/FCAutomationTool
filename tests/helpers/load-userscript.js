import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    clear() { data.clear(); },
  };
}

function collection(items = []) {
  return { _collection: [...items] };
}

function createDocument() {
  return {
    body: null,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() {
      return {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        append() {},
        appendChild() {},
        remove() {},
        addEventListener() {},
        setAttribute() {},
      };
    },
  };
}

export function makePlayer(options = {}) {
  const rating = Number(options.rating ?? 75);
  const rareflag = Number(options.rareflag ?? 0);
  return {
    type: 'player',
    id: Number(options.id),
    definitionId: Number(options.definitionId ?? options.id),
    ...(options.databaseId !== undefined && options.databaseId !== null
      ? { databaseId: Number(options.databaseId) }
      : {}),
    rating,
    rareflag,
    duplicateId: Number(options.duplicateId || 0),
    untradeable: options.untradeable !== false,
    tradeable: options.untradeable === false,
    name: options.name || `Player ${options.id}`,
    rareName: options.rareName,
    rarityName: options.rarityName,
    leagueId: Number(options.leagueId || 0),
    evolutionId: options.evolutionId,
    upgrades: options.upgrades,
    cosmetics: options.cosmetics,
    loans: options.loans ?? -1,
    groups: options.groups || [],
    isDuplicate() { return options.duplicate === true || Number(this.duplicateId || 0) > 0; },
    isPlayer() { return true; },
    isRare() { return rareflag > 0; },
    isSpecial() { return rareflag > 1; },
    isUntradeable() { return options.untradeable !== false; },
    isBronzeRating() { return rating > 0 && rating <= 64; },
    isSilverRating() { return rating >= 65 && rating <= 74; },
    isGoldRating() { return rating >= 75; },
  };
}

export async function loadUserscript(options = {}) {
  const sourcePath = path.join(root, 'src', 'userscript-entry.js');
  const original = await readFile(sourcePath, 'utf8');
  const exportBlock = `
    W.__FCLoopRunnerTest = {
      LOOP_DEFS,
      RECOVERY_RECIPES,
      UNASSIGNED_RECOVERY_POLICIES,
      DEFAULT_UNASSIGNED_RECOVERY_POLICY_IDS,
      state,
      resetRunScopedSubmissionState,
      cloneLoopDef,
      validateLoopDef,
      validateLoopDefList,
      validateLoopConfig,
      normalizeLoopConfig,
      parseLoopConfig,
      getVisibleLoopDefs,
      setFsuSettingsOverride,
      clearFsuSettingsOverride,
      getFsuRejectReasons,
      getSubmittedRatingLimit,
      isDuplicate,
      getEligibleRequiredSpecialEntries,
      itemMatchesSpec,
      isSbcUsablePlayer,
      selectInventoryPlayers,
      calculateEaSquadRating,
      parseRatingSbcChallenge,
      resolveRatingSbcChallenge,
      buildRatingSbcCandidateEntries,
      findOptimalRatingSbcSelection,
      fillSbcSquadRatingOptimized,
      validateRatingSbcModelAgainstItems,
      inspectSbcItems,
      isRatingSbcCandidateSafe,
      validateRollingItemViolationOverride,
      rollingDuplicateMaterializationPair,
      duplicateSwapSelectionSnapshot,
      prepareRollingUntradeableDuplicateSwaps,
      runRollingDuplicateSubmissionAttempt,
      runBoundedRollingDuplicateTransactionReplans,
      submitRollingRequirementRecovery,
      runRollingLegacyStorageSinkRecovery,
      recordRollingSbcSubmissionResult,
      persistRollingDuplicateTransaction,
      persistRollingPendingRequiredSpecialReward,
      readPersistedRollingPendingRequiredSpecialReward,
      queueRollingPendingRequiredSpecialReward,
      clearRollingPendingRequiredSpecialReward,
      restoreRollingPendingRequiredSpecialReward,
      persistRollingPendingPrimaryReward,
      readPersistedRollingPendingPrimaryReward,
      queueRollingPendingPrimaryReward,
      clearRollingPendingPrimaryReward,
      restoreRollingPendingPrimaryReward,
      resolveRollingPendingPrimaryRewardJournal,
      detectRollingPendingRequiredSpecialReward,
      rollingMaterializedRequiredSpecialEntries,
      reconcileRollingPendingRequiredSpecialReward,
      persistMaterializedRollingDuplicateTransaction,
      completeRollingDuplicateTransaction,
      finalizeRollingDuplicateMaterialization,
      routeRollingDeferredPrimaryStorage,
      rollingDuplicateTransactionPlanningContext,
      readPersistedRollingDuplicateTransaction,
      cancelPriorRunRollingDuplicateTransaction,
      recoverPersistedRollingDuplicateTransaction,
      rollingDuplicatePlayerCount,
      rollingOrdinaryGoldDuplicate,
      rollingSnapshotRequiredSpecial,
      isSbcSpecialItem,
      isFofItem,
      isTotwItem,
      isTotsItem,
      isFuttiesItem,
      markAssumedTotwRewardItems,
      rollingBaseProtectionReasons,
      rollingOpenedDuplicateTargetProtectionReasons,
      rollingPrimaryReservesAllSpecialSlots,
      classifyRollingProtectedRefreshEvidence,
      refreshRollingProtectedStorageCaches,
      retryRollingProtectedStorage,
      assertRollingRecoveryItems,
      preserveRollingPrimaryDuplicateRefs,
      createRollingRequiredSpecialSourceFilter,
      inspectRollingLiveUnassignedEntries,
      refreshRollingPendingUnassignedRefs,
      resumeRollingPendingUnassigned,
      buildRollingResumedRouting,
      rollingPendingStorageRoutingState,
      rollingRatingExcessStorageRequirement,
      validateRollingEmergencyProvisionsSelection,
      rollingRatingRecoveryStoragePressure,
      rollingStorageSinkConsumablePendingRefs,
      rollingEmergencyProvisionsProtectedRefs,
      rollingStoragePressureConsumablePendingRefs,
      rollingStoragePressureProvisionsReserveEntries,
      rollingStoragePressureRequiredSpecialEntries,
      rollingStorageSinkSelectionPolicy,
      rollingStorageSinkLoopDefForPiles,
      selectRollingGenericStorageSinkSquad,
      validateRollingStorageSinkPlayers,
      createRollingStorageSinkSubmissionValidators,
      rollingStorageSinkMissingPlayerPickResult,
      confirmRollingStorageSinkSetCompletion,
      selectPendingRollingStorageSinkPick,
      forecastRollingProvisionsSupply,
      forecastRollingPrimaryRunway,
      runRollingGenericStorageSinkRecovery,
      completedRollingStorageSinkUnavailable,
      loadRollingGenericStorageSinkContexts,
      rollingStorageSinkFailure,
      runRollingStorageSinkRecovery,
      createRecapItemHydrator,
      synchronizeCachedSbcChallengeSquad,
      loadDynamicSbcDiscoveryChallenges,
      resolveSbcChallengeForScreen,
      getDailyChallengeRemaining,
      getDailySetRemaining,
      getPackInventorySnapshot,
      findRewardPackInCache,
      predictUnassignedDestination,
      restoreOpenedUnassignedDuplicateMetadata,
      getUnassignedStorageOverflow,
      getUnassignedCapacityOverflow,
      rememberConsumedDuplicateSignals,
      clearConsumedDuplicateSignals,
      duplicateSignalDiagnostic,
      getBoundRarePackFallbackDef,
      runRarePackCraftLoop,
      unresolvedRequiredMaterialActivities,
    };
  `;
  const instrumentedSource = original.replace(/\}\)\(\);\s*$/, `${exportBlock}\n})();`);
  if (instrumentedSource === original) throw new Error('Could not inject userscript test exports');
  const bundled = await build({
    stdin: {
      contents: instrumentedSource,
      resolveDir: path.dirname(sourcePath),
      sourcefile: 'userscript-entry.js',
      loader: 'js',
    },
    bundle: true,
    target: 'node20',
    format: 'iife',
    write: false,
  });
  const source = bundled.outputFiles[0].text;

  const document = createDocument();
  const userscriptValues = new Map(Object.entries(options.userscriptStorage || {}));
  const inventoryPiles = {
    club: [...(options.club || [])],
    storage: [...(options.storage || [])],
    transfer: [...(options.transfer || [])],
    unassigned: [...(options.unassigned || [])],
  };
  const itemRepository = {
    club: { items: { _collection: inventoryPiles.club } },
    storage: { _collection: inventoryPiles.storage },
    transfer: { _collection: inventoryPiles.transfer },
    getUnassignedItems: () => [...inventoryPiles.unassigned],
    getStorageItems: () => [...inventoryPiles.storage],
    getTransferItems: () => [...inventoryPiles.transfer],
    getPileSize: (pile) => Number(options.pileSizes?.[pile] ?? 100),
    numItemsInCache: (pile) => Number(options.pileCounts?.[pile] ?? 0),
  };
  const window = {
    document,
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    innerWidth: 1920,
    innerHeight: 1080,
    repositories: {
      Item: itemRepository,
      Store: { myPacks: collection(options.packs) },
      Rarity: {
        getRarity: (id) => options.rarities?.[Number(id)] || null,
        get: (id) => options.rarities?.[Number(id)] || null,
      },
    },
    services: {
      Item: { itemDao: { itemRepo: { club: { items: collection() } } } },
      Store: {},
      SBC: {},
      Configuration: {
        getItemRarity: (item) => options.rarities?.[Number(item?.rareflag)] || null,
      },
    },
    ItemPile: {
      CLUB: 'club',
      STORAGE: 'storage',
      TRANSFER: 'transfer',
      PURCHASED: 'unassigned',
    },
    console,
  };
  if (options.pageReady === true) {
    const controller = { className: 'UTHomeViewController' };
    window.getAppMain = () => ({
      getRootViewController: () => ({
        getPresentedViewController: () => ({
          getCurrentViewController: () => ({
            getCurrentController: () => controller,
          }),
        }),
      }),
    });
  }
  const sandboxSetTimeout = options.fastTimers === true
    ? ((callback, delay, ...args) => setTimeout(callback, Math.min(Number(delay) || 0, 1), ...args))
    : setTimeout;
  const sandbox = {
    window,
    unsafeWindow: window,
    document,
    console,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    GM_getValue: Object.hasOwn(options, 'gmGetValue') ? options.gmGetValue : ((key, fallback = null) => (
      userscriptValues.has(String(key)) ? userscriptValues.get(String(key)) : fallback
    )),
    GM_setValue: Object.hasOwn(options, 'gmSetValue') ? options.gmSetValue : ((key, value) => {
      userscriptValues.set(String(key), value);
    }),
    GM_deleteValue: Object.hasOwn(options, 'gmDeleteValue')
      ? options.gmDeleteValue
      : ((key) => userscriptValues.delete(String(key))),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: sandboxSetTimeout,
    clearTimeout,
    URL,
    Blob,
    Map,
    Set,
    WeakSet,
    WeakMap,
    Date,
    Math,
    JSON,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
  };
  window.window = window;
  window.setTimeout = sandboxSetTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = sandbox.setInterval;
  window.clearInterval = sandbox.clearInterval;

  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  const api = window.__FCLoopRunnerTest;
  if (!api) throw new Error('Userscript test API was not installed');

  api.setFsuSettingsOverride({
    ignorePlayerPosition: true,
    onlyUntradeable: false,
    excludeDesignatedLeagues: false,
    excludedLeagueIds: [],
    useRarityPlayer: true,
    excludeEvolution: false,
    playerPickStrictCommonRare: true,
    priorityRareWithinGoldRange: false,
    priorityNonSpecialPlayers: true,
    priorityStoragePlayers: false,
    silverBronzePrioritizeNormal: true,
    goldRange: [75, 99],
    lockedItemIds: [],
    lockedDefinitionIds: [],
  });

  return { api, window, sandbox, userscriptValues, inventoryPiles };
}
