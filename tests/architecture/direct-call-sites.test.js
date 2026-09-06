import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTotwUpgradePolicy } from '../../src/config/upgrade-policies.js';
import { STRATEGY_RUNNER_KEYS } from '../../src/workflows/dispatch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('current direct side-effect call baseline', () => {
  it('routes every runtime rating-SBC model through the live allowance resolver', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source.match(/\bparseRatingSbcChallenge\(/g) || []).toHaveLength(2);
    const resolverStart = source.indexOf('function resolveRatingSbcChallenge');
    const resolverEnd = source.indexOf('function validateRatingSbcModelAgainstItems', resolverStart);
    const resolver = source.slice(resolverStart, resolverEnd);
    expect(resolver).toContain('const model = parseRatingSbcChallenge(loopDef, challenge)');
    expect(resolver).toContain('applyRequiredSpecialAllowanceModel(loopDef, model)');
    expect(source.match(/\bresolveRatingSbcChallenge\(/g) || []).toHaveLength(7);
  });

  it('uses the current product name for Console logging', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).toContain("const CONSOLE_PREFIX = '[DailyLoopRunner]';");
    expect(source).not.toContain('[BronzeLoop]');
  });

  it('keeps every Trade service call inside the EA Trade Adapter', async () => {
    const tradeAdapter = await readFile(path.join(root, 'src', 'adapters', 'ea', 'trade.js'), 'utf8');
    const tradeDirectory = path.join(root, 'src', 'trade');
    const tradeFiles = await Promise.all((await readdir(tradeDirectory))
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFile(path.join(tradeDirectory, name), 'utf8')));
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    for (const checked of [source, ...tradeFiles]) {
      expect(checked).not.toMatch(/\bservices\.Item\.(?:searchTransferMarket|bid|list|requestMarketData|relistExpiredAuctions)\s*\(/);
    }
    expect(tradeAdapter.match(/\bservice\.requestMarketData\s*\(/g) || []).toHaveLength(1);
    expect(tradeAdapter.match(/\bservice\.list\s*\(/g) || []).toHaveLength(1);
    expect(tradeAdapter.match(/\bservice\.requestTransferItems\s*\(/g) || []).toHaveLength(1);
    expect(tradeAdapter.match(/\bservice\.searchTransferMarket\s*\(/g) || []).toHaveLength(1);
    expect(tradeAdapter.match(/\bservice\.bid\s*\(/g) || []).toHaveLength(1);
    expect(tradeAdapter.match(/\bservice\.move\s*\(/g) || []).toHaveLength(1);
    expect(tradeAdapter.match(/\bservice\[method\]\s*\(/g) || []).toHaveLength(1);
    expect(tradeAdapter.match(/requestPacingError\('(?:price-limits|transfer-refresh|market-search|purchase-refresh)'/g) || []).toHaveLength(4);
    const tradePermitCallSites = [source, ...tradeFiles].join('\n');
    expect(tradePermitCallSites.match(/adapter\.acquireRequestPermit\('(buy|list|purchase-route)'/g) || []).toHaveLength(3);
    expect(tradeAdapter).toContain("['requestUnassignedItems', 'requestTransferItems', 'requestClubItems', 'requestWatchlist', 'requestWatchedItems']");
      expect(tradeAdapter.match(/\bservice\.relistExpiredAuctions\s*\(/g) || []).toHaveLength(1);
  });

  it('keeps pack.open and low-level SBC save/submit calls inside EA Adapters', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const packAdapter = await readFile(path.join(root, 'src', 'adapters', 'ea', 'pack.js'), 'utf8');
    const playerPickAdapter = await readFile(path.join(root, 'src', 'adapters', 'ea', 'player-pick.js'), 'utf8');
    const sbcAdapter = await readFile(path.join(root, 'src', 'adapters', 'ea', 'sbc.js'), 'utf8');
    expect(source.match(/\bpackAdapter\.open\s*\(/g) || []).toHaveLength(1);
    expect(source.match(/\b(?:currentPack|selectedPack|pack)\.open\s*\(/g) || []).toHaveLength(0);
    expect(packAdapter.match(/\bpack\.open\s*\(/g) || []).toHaveLength(1);
    expect(source.match(/\bW\.services\.SBC\.saveChallenge\s*\(/g) || []).toHaveLength(0);
    expect(source.match(/\bW\.services\.SBC\.submitChallenge\s*\(/g) || []).toHaveLength(0);
    expect(sbcAdapter.match(/\bservice\.saveChallenge\s*\(/g) || []).toHaveLength(1);
    expect(sbcAdapter.match(/\bservice\.submitChallenge\s*\(/g) || []).toHaveLength(1);
    expect(source.match(/\bW\.services\.Item\.redeem\s*\(/g) || []).toHaveLength(0);
    expect(source.match(/\bW\.services\.Item\.confirmPlayerPickItemSelection\s*\(/g) || []).toHaveLength(0);
    expect(playerPickAdapter.match(/\bservice\.redeem\s*\(/g) || []).toHaveLength(1);
    expect(playerPickAdapter.match(/\bservice\.confirmPlayerPickItemSelection\s*\(/g) || []).toHaveLength(1);
    expect(source.match(/\bsaveChallengeSquad\s*\(/g) || []).toHaveLength(6);
    expect(source).toMatch(/function\s+prepareSbcSquad\s*\(/);
    expect(source).toContain('prepareOnly: true');
    expect(source.match(/\bsubmitSbcAttempt\s*\(\{/g) || []).toHaveLength(7);
    expect(source.match(/prepareRuntimeAccess:\s*prepareFsuRuntimeAccess/g) || []).toHaveLength(7);
    expect(source.match(/if \(!selection && !runtimeAccess\?\.refreshedClubPlayers\) return;/g) || []).toHaveLength(1);
    expect(source.match(/if \(ratingSbcFill \|\| !runtimeAccess\?\.refreshedClubPlayers\) return;/g) || []).toHaveLength(1);
    expect(source.match(/applying freshly validated Club entities before submit/g) || []).toHaveLength(2);
    expect(source).toContain("from './sbc/fsu-runtime-access.js'");
  });

  it('keeps item-violation confirmation bounded to Rolling submissions without a Challenge reload', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source.match(/allowItemViolationOverride:\s*true/g) || []).toHaveLength(4);
    expect(source.match(/validateItemViolationOverride:\s*\(conflict\)\s*=>\s*validateRollingItemViolationOverride/g) || []).toHaveLength(4);
    expect(source.match(/revalidateSubmission:\s*(?:context|submitContext)\.revalidateSubmission/g) || []).toHaveLength(4);
    const protectedConflictStart = source.indexOf('if (shouldStopForProtectedItemViolation({');
    const overrideStart = source.indexOf('if (overridePlan.retry) {');
    const ordinaryRetryStart = source.indexOf('const plan = planBackgroundSubmitRetry({', overrideStart);
    expect(protectedConflictStart).toBeGreaterThan(-1);
    expect(protectedConflictStart).toBeLessThan(overrideStart);
    expect(source.slice(protectedConflictStart, overrideStart)).toContain('resolveProtectedItemViolation');
    expect(source.slice(protectedConflictStart, overrideStart)).toContain('inspected.activeSquadItemIds');
    expect(source.slice(protectedConflictStart, overrideStart)).toContain('inspected.unknownItemIds');
    expect(source.slice(protectedConflictStart, overrideStart)).toContain("status: 'replan'");
    expect(source.slice(protectedConflictStart, overrideStart)).toContain("action !== 'override'");
    expect(source).toContain('resolveProtectedItemViolation: (conflict) => configuredConflictResolver(conflict, context)');
    expect(source).toContain('selection: submitContext?.squadPlan?.selection || selection');
    expect(overrideStart).toBeGreaterThan(-1);
    expect(ordinaryRetryStart).toBeGreaterThan(overrideStart);
    const overrideBlock = source.slice(overrideStart, ordinaryRetryStart);
    expect(overrideBlock).toContain('await options.revalidateSubmission()');
    expect(overrideBlock).toContain('await options.validateItemViolationOverride({');
    expect(overrideBlock).toContain('const forcedOptions = { skipValidation: true, chemistryEnabled };');
    expect(overrideBlock).toContain('eaSbcAdapter().submitChallenge(currentChallenge, set, forcedOptions)');
    expect(overrideBlock).not.toContain('loadRatingSbcChallenge');
    expect(overrideBlock).not.toContain('findAvailableRatingSbcChallenge');
    expect(overrideBlock).toContain('background submit validation override failed');
  });

  it('records the special workflow functions that still require migration', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).toContain("from './adapters/index.js'");
    expect(source).not.toMatch(/from\s+['"]\.\/adapters\/ea\//);
    expect(source).not.toMatch(/\bwindow\.(?:localStorage|sessionStorage)\b/);
    expect(source).not.toMatch(/\b(?:W\.)?(?:repositories|services)[^\n;]*\.myPacks\b/);
    expect(source).not.toMatch(/\bW\.services\.Store\.getPacks\s*\(/);
    expect(source).not.toMatch(/\bW\.getAppMain\s*\(/);
    expect(source).not.toMatch(/function\s+(?:areFutServicesReady|hasFutMainDom|isMainFutControllerName)\s*\(/);
    expect(source).not.toMatch(/\bW\.g(?:ClickShield|PopupClickShield)\b/);
    expect(source).not.toMatch(/\bW\.repositories\.Item\.(?:getPileSize|numItemsInCache)\s*\(/);
    expect(source).not.toMatch(/\bW\.services\.Item\.(?:requestUnassignedItems|move)\s*\(/);
    expect(source).not.toMatch(/\bW\.services\.Localization\.localize\s*\(/);
    expect(source).not.toMatch(/\bW\.(?:services\.SBC|repositories\.Squad)\b/);
    expect(source).not.toMatch(/\bW\.services\.(?:UserSettings|Chemistry)\b/);
    expect(source).not.toMatch(/\bW\.(?:ItemPile|PlayerInjury)\b/);
    expect(source).not.toMatch(/\bW\.[A-Za-z_$][A-Za-z0-9_$]*/);
    expect(source).toContain("const inventoryPile = (pileName) => eaInventoryAdapter().pileValue(pileName);");
    expect(source).toContain('eaInventoryAdapter().preparePurchasedItem(item);');
    expect(source).toContain('eaInventoryAdapter().capacity(pileName).free');
    expect(source).toContain('eaInventoryAdapter().requestUnassigned()');
    expect(source).toContain('eaInventoryAdapter().refreshActions(pileName)');
    expect(source).toContain('eaInventoryAdapter().move(items, pile, allowStorage)');
    expect(source).toContain('return localizationAdapter.localize(value);');
    expect(source).toContain('const pageRuntime = adapters.page;');
    expect(source).toContain('return pageRuntime.currentController();');
    expect(source).toContain('return pageRuntime.isReady();');
    expect(source).toContain('return pageRuntime.navigationController();');
    expect(source).toContain('pageRuntime.popupShieldShowing()');
    expect(source).toContain('return eaPackAdapter().list();');
    expect(source).toContain('eaPackAdapter().refreshAll()');
    expect(source).toMatch(/function\s+readInventoryPile\s*\([^)]+\)[\s\S]*?eaInventoryAdapter\(\)\.readPile\(pileName\)/);
    expect(source.match(/return readInventoryPile\('(unassigned|storage|transfer|club)'\);/g) || []).toHaveLength(4);
    expect(source).not.toMatch(/(^|[^.\w])localStorage\.(?:getItem|setItem|removeItem)\s*\(/m);
    expect(source).not.toMatch(/\bGM_xmlhttpRequest\s*\(/);
    expect(source).not.toMatch(/(^|[^.\w])fetch\s*\(/m);
    expect(source).not.toMatch(/function\s+request(?:Price)?Text\s*\(/);
    expect(source).toContain('adapters.http.getText');
    expect(source).not.toMatch(/function\s+normalizeFsuSettings\s*\(/);
    expect(source).not.toMatch(/function\s+normalizeLockedPlayerIds\s*\(/);
    expect(source).not.toMatch(/function\s+readFsuSettingsFromStorage\s*\(/);
    expect(source).not.toMatch(/function\s+readFsuLockedPlayersFromStorage\s*\(/);
    expect(source).not.toMatch(/function\s+(?:readFsuSettingsFromInfo|readFsuSettingsFromWindow|readFsuLockedPlayersFromWindow|readFsuLockedPlayers)\s*\(/);
    expect(source).not.toMatch(/\bW\.info\b/);
    expect(source).toContain('fsuAdapter().snapshot(state.fsuSettingsOverride)');
    expect(source).toContain("from './config/fsu-compat.js'");
    expect(source).not.toMatch(/function\s+runInventoryMixedUpgrade(?:DryRun)?\s*\(/);
    expect(source).toMatch(/function\s+runSupplyAndCraftLoop\s*\(/);
    expect(source).not.toMatch(/function\s+runDailySingleCardRecycle(?:DryRun)?\s*\(/);
    expect(source).toMatch(/function\s+runRecycleLoop\s*\(/);
    expect(source).not.toMatch(/function\s+runCommonGoldToRareUpgrade(?:DryRun)?\s*\(/);
    expect(source).not.toMatch(/function\s+runRarePackTo84Upgrade(?:DryRun)?\s*\(/);
    expect(source).toMatch(/function\s+runRarePackCraftLoop\s*\(/);
    expect(source).not.toMatch(/function\s+runPlayerPickSbc(?:DryRun)?\s*\(/);
    expect(source).toMatch(/function\s+runPlayerPickLoop\s*\(/);
    expect(source).not.toMatch(/function\s+runProvisionPackCrafting(?:DryRun)?\s*\(/);
    expect(source).toMatch(/function\s+runProvisionCraftLoop\s*\(/);
    expect(source).not.toMatch(/function\s+runFillAndVerifySbc\s*\(/);
    expect(source).not.toMatch(/\brunFillAndVerifySbc\s*\(/);
    expect(source).toMatch(/function\s+runFillAndVerifyLoop\s*\(/);
    expect(source).not.toMatch(/function\s+runDryRunLoop\s*\(/);
    expect(source).not.toMatch(/function\s+runValidationBronzeUpgradeDryRun\s*\(/);
    expect(source).not.toMatch(/function\s+runReservedDuplicateUpgradeDryRun\s*\(/);
    expect(source).not.toMatch(/function\s+submitReservedDuplicateUpgrade\s*\(/);
    expect(source).toMatch(/function\s+runReservedDuplicateCraftingStage\s*\(/);
    expect(source).toMatch(/function\s+reconcileSubmittedDuplicateSignals\s*\(/);
    expect(source).toMatch(/function\s+finalizeSubmittedInventorySelection\s*\(/);
    expect(source).toContain('await reconcileSubmittedDuplicateSignals(selection, label, submittedPlayers);');
    expect(source).toMatch(/submitConfiguredSbc[\s\S]*?finalizeSubmittedInventorySelection\(\s*squadPlan\?\.selection \|\| selection,\s*loopDef\.name,\s*savedPlayers\?\.length \? savedPlayers : players,\s*\)/);
    expect(source).toMatch(/submitTransport:[\s\S]*?emitDiagnostic\(log, \(\) => \{[\s\S]*?return `\$\{loopDef\.name\}: submit squad for/);
    expect(source).not.toContain('`${label}: submit squad for ${signalCount} Unassigned signal(s)');
    expect(source).toMatch(/consumeTarget[\s\S]*?selectInventoryPlayers\([\s\S]*?priorityPiles:\s*\['unassigned'\][\s\S]*?submitConfiguredSbc\(loopDef, \{ returnNullIfComplete: true, selection \}\)/);
    expect(source).toMatch(/runFillAndVerifyLoop[\s\S]*?finalizeSubmittedInventorySelection\([\s\S]*?configuredFill\.selection/);
    expect(source).toMatch(/submitInventorySbcAttempt[\s\S]*?finalizeSubmittedInventorySelection\(\s*squadPlan\?\.selection \|\| selection/);
    expect(source).not.toContain('markConsumed: true');
    expect(source).toContain('selectedSignalCount < expectedSelectedSignalCount');
    expect(source).toContain('refusing a fallback that skips Unassigned cards');
    expect(source).toContain('options.requireFullSignalCoverage === true');
    expect(source).toMatch(/const repositorySignals[\s\S]*?const signalById[\s\S]*?preferredSignalRefs:\s*signalRefs/);
    expect(source).toMatch(/runRarePackCraftLoop[\s\S]*?requireFullSignalCoverage:\s*true/);
    expect(source).toMatch(/runProvisionCraftLoop[\s\S]*?runReservedDuplicateCraftingStage\([\s\S]*?requireFullSignalCoverage:\s*true/);
    expect(source).toMatch(/const runProvisionMaterialStages[\s\S]*?runProvisionPreCraftPlayerPick\([\s\S]*?for \(let index = 0; index < craftingUpgrades\.length; index\+\+\)/);
    expect(source).toMatch(/runProvisionCraftLoop[\s\S]*?afterStages:[\s\S]*?enableRecovery:\s*false[\s\S]*?reserveItem:\s*isReservedDuplicate/);
    expect(source).toMatch(/runProvisionCraftLoop[\s\S]*?finalize:[\s\S]*?runProvisionMaterialStages\('final-cleanup'\)[\s\S]*?enableRecovery:\s*false/);
    expect(source).toMatch(/runProvisionCraftLoop[\s\S]*?beforePack:[\s\S]*?runProvisionMaterialStages\('pre-open'\)[\s\S]*?if \(!dryRun\)/);
    expect(source).toContain('effective material routing:');
    expect(source).toMatch(/const materialTypes[\s\S]*?materialTypes\.length[\s\S]*?material/);
    expect(source).toMatch(/const preOpenUnassignedOptions = options\.preOpenUnassignedOptions \|\| \{\}/);
    expect(source).toMatch(/preOpenResolver:\s*\(\)\s*=>\s*resolveRuntimeUnassigned\([\s\S]*?preOpenUnassignedOptions/);
    expect(source).toMatch(/pack-open recovery cleanup`,\s*preOpenUnassignedOptions/);
    expect(source).toMatch(/openRollingRecoveryReward[\s\S]*?preOpenUnassignedOptions:\s*\{\s*returnBlockedResult:\s*true\s*\}/);
    expect(source).toMatch(/runProvisionCraftLoop[\s\S]*?preOpenUnassignedOptions:\s*\{[\s\S]*?enableRecovery:\s*false[\s\S]*?reserveItem:\s*isReservedDuplicate/);
    expect(source).toMatch(/createProvisionPackPolicy[\s\S]*?blockedPolicy:\s*'preserve'[\s\S]*?enableRecovery:\s*false[\s\S]*?isReservedDuplicate/);
    expect(source).toMatch(/if \(stageResult\.status === 'blocked' \|\| stageResult\.status === 'planned'\)/);
    expect(source).not.toMatch(/function\s+rankPlayerPickCandidates\s*\(/);
    expect(source).not.toMatch(/function\s+capturePlayerPickSelections\s*\(/);
    expect(source).not.toMatch(/function\s+getManualPickReason\s*\(/);
    expect(source).not.toMatch(/function\s+waitForManualPlayerPick\s*\(/);
    expect(source).toContain('const parentPickOptions = parentLoopDef.runtimePickOptions || {};');
    expect(source).toContain('result.pickSelectionMode = parentPickOptions.pickSelectionMode');
    expect(source).not.toMatch(/function\s+(?:getPanelDefaultSize|resetPanelSize|makePanelDraggable|makePanelResizable|savePanelPos|getSavedPanelPos)\s*\(/);
    expect(source).toContain("from './ui/main-panel-geometry.js'");
    expect(source).toContain('createMainPanelGeometry({');
    expect(source).toContain("from './ui/main-panel-view.js'");
    expect(source).toContain("from './ui/main-panel-bindings.js'");
    expect(source).toContain("from './ui/main-panel-commands.js'");
    expect(source).toContain("from './ui/main-panel-state.js'");
    expect(source).toContain('startupHidden: true,');
    expect(source).toContain('setMainPanelStartupHidden(panel, false);');
    expect(source).toContain('hydrateMainPanelOptions({');
    expect(source).toContain('const panelCommands = createMainPanelCommands({');
    expect(source).toContain('openBatch: openBatchOpenDialogModal,');
    expect(source).toContain('reopenRecap: reopenLastRecap,');
    expect(source).toContain('bindMainPanelCommands({');
    expect(source).toContain('commands: panelCommands,');
    const cacheRestoreIndex = source.indexOf('await scanAvailableDynamicSbcs({ cacheOnly: true });');
    const scanStartIndex = source.indexOf('const scanPromise = panelCommands.scanPicks();', cacheRestoreIndex);
    const panelRevealIndex = source.indexOf('setMainPanelStartupHidden(panel, false);', scanStartIndex);
    const scanAwaitIndex = source.indexOf('await scanPromise;', panelRevealIndex);
    expect(cacheRestoreIndex).toBeGreaterThan(-1);
    expect(scanStartIndex).toBeGreaterThan(cacheRestoreIndex);
    expect(panelRevealIndex).toBeGreaterThan(scanStartIndex);
    expect(scanAwaitIndex).toBeGreaterThan(panelRevealIndex);
    expect(source).toContain('renderMainPanelRuntimeState({');
    expect(source).not.toContain('style.textContent = `');
    expect(source).not.toContain('panel.innerHTML = `');
    expect(source).not.toMatch(/function\s+(?:isPlayerPickItem|pickItemName|playerPickMatchesLoop|getPlayerPickOwnedItems|sameLimitedUseType)\s*\(/);
    expect(source).toContain('eaPlayerPickAdapter().listUnassignedPlayerPicks()');
    expect(source).toContain('eaPlayerPickAdapter().isOwnedDuplicate(item)');
    expect(source).toContain("from './ui/player-pick-modal.js'");
    expect(source).toContain("from './ui/player-pick-recap.js'");
    expect(source).toContain("from './ui/sbc-reward-overlay.js'");
    expect(source).toContain('return showPlayerPickRecap({');
    expect(source).not.toMatch(/function\s+triggerRecapFireworks\s*\(/);
    expect(source).not.toContain("overlay.id = 'bronze-loop-recap-modal'");
    expect(source).toContain('const waitAdapter = adapters.wait({ sleep, stopPoint, log });');
    expect(source).toContain('return waitAdapter.observableOnce(observable, controller, timeoutMs, label);');
    expect(source).not.toMatch(/function\s+observeOnce\([^)]*\)\s*\{\s*return\s+new\s+Promise/);
    expect(source).not.toMatch(/\bnavigator\.clipboard\b|\bnew\s+Blob\b|\bURL\.(?:createObjectURL|revokeObjectURL)\b/);
    expect(source).not.toMatch(/\bnew\s+(?:PointerEvent|MouseEvent|KeyboardEvent)\s*\(/);
    expect(source).toContain('return adapters.dom.click(el);');
    expect(source).toContain("from './selection/rating-model.js'");
    expect(source).toContain("from './selection/rating-candidates.js'");
    expect(source).toContain('buildRatingSbcCandidateEntries(loopDef, model, selectionPolicy)');
    expect(source).toContain('...(selectionPolicy ? { selectionPolicy } : {})');
    expect(source).toContain('roleAware: selectionPolicy !== null');
    expect(source).toContain('return parseRatingSbcChallengePure({');
    expect(source).not.toMatch(/function\s+(?:requirementFirstKey|flattenRequirementValues|requirementValues|itemMatchesDynamicRequirement)\s*\(/);
    expect(source).not.toMatch(/function\s+(?:comparePileSelections|mergePileCounts|ratingGroupSelectionOptions|buildRatingMaterializationContext|materializeRatingVector)\s*\(/);
    expect(source).toContain("from './config/loop-schema.js'");
    expect(source).toContain("from './config/loops.js'");
    expect(source).toContain("from './config/run-limits.js'");
    expect(source).toContain("from './config/routine-steps.js'");
    expect(source).toContain("from './config/runtime-options.js'");
    expect(source).toMatch(/import\s*\{[^}]*\bapplyPickRuntimeOptions\b[^}]*\}\s*from '\.\/config\/runtime-options\.js'/s);
    expect(source).not.toMatch(/function\s+applyPickRuntimeOptions\s*\(/);
    expect(source).toContain('applyPickRuntimeOptions(pickDef, loopDef.runtimePickOptions || getPickRuntimeOptions());');
    expect(source).not.toMatch(/\bconst\s+LOOP_DEFS\s*=\s*\[/);
    expect(source).toContain('return claimSbcRewards({');
    expect(source).not.toMatch(/while\s*\(Date\.now\(\)\s*-\s*start\s*<\s*25000\)/);
    expect(source).not.toMatch(/function\s+(?:validateStringArray|validateNumberArray|validatePileList|validateCardSpec|validateRequirements|validateUpgradeDef|validateShortagePacks|validateRecoveryAction|validateRecoveryRecipeList|validateRecoveryPolicyList|validateRecoveryPolicyIds)\s*\(/);
    expect(source).toContain("from './sbc/navigation-sync.js'");
    expect(source).toContain("from './sbc/background-submit-retry.js'");
    expect(source).toContain("from './pack/retry-recovery.js'");
    expect(source).toContain("from './pack/stale-pack-tracker.js'");
    expect(source).toContain("from './unassigned/confirmation.js'");
    expect(source).not.toMatch(/www\.fut\.gg\/api\/fut\/player-prices/);
    expect(source).not.toMatch(/enhancer-api\.futnext\.com\/players\/prices/);
    expect(source).not.toMatch(/function\s+clear(?:MixedUpgrade)?Unassigned\s*\(/);
    expect(source).not.toMatch(/\bclear(?:MixedUpgrade)?Unassigned\s*\(/);
    expect(source).toMatch(/function\s+resolveRuntimeUnassigned\s*\(/);
    expect(source).not.toMatch(/function\s+runDailyRoutine\s*\(/);
    expect(source).toMatch(/function\s+runDailySequence\s*\(/);
    expect(source).toContain("from './workflows/dispatch.js'");
    const dispatchStart = source.indexOf('return await dispatchConfiguredWorkflow({');
    const dispatchEnd = source.indexOf('afterStandardRun:', dispatchStart);
    const dispatchRunnerBlock = source.slice(dispatchStart, dispatchEnd);
    for (const runnerKey of new Set(Object.values(STRATEGY_RUNNER_KEYS))) {
      expect(dispatchRunnerBlock, runnerKey).toMatch(new RegExp(`\\b${runnerKey}:\\s*`));
    }
    expect(source).not.toMatch(/function\s+executeConfiguredLoopInternal\s*\(/);
    expect(source).not.toMatch(/function\s+(?:setLoopDefs|getEditorLoopStrategy|findBronzeUpgradeSet|isEligibleTotwForLoop|getEligibleTotwEntries|summarizeTotwEntries|sortTotwEntriesForSubmit|isCommonGoldPlayer|isCommonGoldDuplicate|isLowCommonGoldDuplicate)\s*\(/);
  });

  it('logs rating shortage or submit-not-ready reasons before automatic Rare Gold recovery', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const shortageIdx = source.indexOf("configuredFill.ratingShortage && autoFodderAttempts < autoFodderLimit");
    const shortageCraftIdx = source.indexOf('craftAutoFodderUpgrade(activeLoopDef, nextAttempt, autoFodderLimit)', shortageIdx);
    expect(shortageIdx).toBeGreaterThan(-1);
    expect(shortageCraftIdx).toBeGreaterThan(shortageIdx);
    const shortageWindow = source.slice(shortageIdx, shortageCraftIdx);
    expect(shortageWindow).toContain('rating shortage before automatic Rare Gold recovery');
    expect(shortageWindow).toContain('configuredFill.reason');

    const submitIdx = source.indexOf('!fillResult.submitReady &&');
    const submitCraftIdx = source.indexOf('craftAutoFodderUpgrade(activeLoopDef, nextAttempt, autoFodderLimit)', submitIdx);
    expect(submitIdx).toBeGreaterThan(-1);
    expect(submitCraftIdx).toBeGreaterThan(submitIdx);
    const submitWindow = source.slice(submitIdx, submitCraftIdx);
    expect(submitWindow).toContain('submit not ready before automatic Rare Gold recovery');
  });

  it('requires every userscript pack call to provide an opened-item policy', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).not.toMatch(/const\s+items\s*=\s*await\s+openPack\s*\(/);
    expect(source).not.toMatch(/function\s+handle(?:Recycle|Provision|RarePackTo84|RareSource)PackItems\s*\(/);
    expect(source).toContain('Opened item policy is required for');
    expect(source).toMatch(/const retryCodes = \[\.\.\.new Set\(\[[\s\S]*?\.\.\.DEFAULT_PACK_OPEN_RETRY_CODES/);
    expect(source).toMatch(/onTransportFailure:[\s\S]*?emitDiagnostic\(log[\s\S]*?pack open transport attempt[\s\S]*?beforeRetry:[\s\S]*?isAmbiguousPackOpenFailure\(code\)/);
    expect(source).toMatch(/packSelector:[\s\S]*?captureStableRuntimePackOpenRetrySnapshot\(failedPack\)[\s\S]*?decidePackOpenRetry\(/);
    expect(source).toMatch(/packUnavailableResult:[\s\S]*?retryDecision\.reason[\s\S]*?retryEvidence/);
    expect(source).toMatch(/openTransport:[\s\S]*?retryBaseline = captureRuntimePackOpenRetrySnapshot\(selectedPack\)/);
    expect(source).not.toContain('findFreshPackInstance');
    const packCalls = source.match(/await\s+openPack\s*\(/g) || [];
    const explicitPolicies = source.split(/\r?\n/).filter((line) =>
      line.includes('openedItemPolicy:') && !line.includes('options.openedItemPolicy')
    );
    expect(packCalls).toHaveLength(10);
    expect(explicitPolicies).toHaveLength(packCalls.length);
    expect(source).toMatch(/function\s+openRollingRecoveryReward[\s\S]*?openedItemPolicy:\s*createRollingPrimaryPackPolicy/);
    expect(source).toContain('runBatchOpenWorkflow({');
    expect(source).toMatch(/runBatchOpenWorkflow\(\{[\s\S]*?openPack:\s*async[\s\S]*?openedItemPolicy:\s*createMaterializeAndResolvePolicy/);
    expect(source).toMatch(/Batch Open[\s\S]*?createMaterializeAndResolvePolicy\([\s\S]*?blockedPolicy:\s*['"]preserve['"]/);
    expect(source).toMatch(/Batch Open[\s\S]*?createMaterializeAndResolvePolicy\([\s\S]*?enableRecovery:\s*true/);
    expect(source).toMatch(/Batch Open[\s\S]*?createMaterializeAndResolvePolicy\([\s\S]*?directDuplicateFallback:\s*true/);
    expect(source).toMatch(/beforeStart:[\s\S]*?Batch Open preflight[\s\S]*?blockedPolicy:\s*['"]preserve['"][\s\S]*?enableRecovery:\s*true/);
    expect(source).not.toContain("resolveRuntimeUnassigned('Batch Open final cleanup')");
  });

  it('collects pack recap data once and keeps Rolling retention separate from ordinary Loop receipts', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).toContain('function recordLoopPackReceipt(receipt, sourceLabel = null)');
    expect(source).toMatch(/state\.lastOpenPackReceipt = receipt;\s*recordLoopPackReceipt\(receipt, purpose\);/);
    expect(source.match(/recordLoopPackReceipt\(receipt/g) || []).toHaveLength(2);
    expect(source).toContain('if (state.loopRecapSession.rollingAggregator)');
    expect(source).toContain('state.loopRecapSession.receipts.push(receipt);');
    expect(source).toMatch(/state\.running = true;[\s\S]*?beginLoopRecapSession\(loopDef\);/);
    expect(source).toMatch(/finally \{[\s\S]*?await finalizeLoopRecap\(loopDef, runStatus, runReason, runResult\);/);
    expect(source).toContain('if (!session || session.dedicatedRecap) return null;');
    expect(source).toContain('if (session.rollingAggregator)');
    expect(source).toContain('if (!hasRecapRareGoldOrAbove(openedItems))');
    expect(source).toMatch(/function recordRollingPlayerPickResult[\s\S]*?publishPackHighlight\(items,/);
    expect(source.match(/publishPackHighlight\(items,/g) || []).toHaveLength(1);
    expect(source).toContain('if (recapModel?.hasQualifyingCards) void showBatchRecapModal(recapModel);');
  });

  it('handles a completed Storage Sink reward before retrying deferred Storage routing', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const genericStart = source.indexOf('async function runRollingGenericStorageSinkRecovery');
    const genericEnd = source.indexOf('async function runRollingStorageSinkRecovery', genericStart);
    const generic = source.slice(genericStart, genericEnd);
    const postSubmitSelection = generic.lastIndexOf('await selectPending(');
    const directPlayerRouting = generic.lastIndexOf('await resumeRollingPendingUnassigned');
    const protectedStorageRetry = generic.lastIndexOf('await retryStorage(');
    const legacyStart = source.indexOf('async function runRollingLegacyStorageSinkRecovery');
    const legacyEnd = source.indexOf('async function loadRollingGenericStorageSinkContexts', legacyStart);
    const legacy = source.slice(legacyStart, legacyEnd);
    expect(genericStart).toBeGreaterThan(-1);
    expect(generic).toContain('const selectPending = options.selectPending || selectPendingRollingStorageSinkPick;');
    expect(generic).toContain('const retryStorage = options.retryStorage || retryRollingProtectedStorage;');
    expect(generic).toContain('nextGenericStorageSinkContext(loaded.contexts)');
    expect(generic).not.toContain('Number(right.targetRating || 0) - Number(left.targetRating || 0)');
    expect(postSubmitSelection).toBeGreaterThan(-1);
    expect(directPlayerRouting).toBeGreaterThan(-1);
    expect(protectedStorageRetry).toBeGreaterThan(postSubmitSelection);
    expect(protectedStorageRetry).toBeGreaterThan(directPlayerRouting);
    expect(legacy).toContain('pickSelected: true');
    expect(legacy).toMatch(/await selectPendingRollingStorageSinkPick\([\s\S]*?attempts: 10,[\s\S]*?forceFresh: true/);
    expect(generic).toMatch(/await selectPending\([\s\S]*?attempts: 10,[\s\S]*?forceFresh: true/);
    expect(legacy).toContain('const consumedRoutingRefs = rollingSubmissionConsumptionRefs(result, plan);');
    expect(generic).toContain('const consumedRoutingRefs = rollingSubmissionConsumptionRefs(result, plan);');
    expect(legacy).toContain('{ attempts: 1, forceFresh: true, quietMissing: true, failOnUnexpected: true }');
    expect(generic).toContain('{ attempts: 1, forceFresh: true, quietMissing: true, failOnUnexpected: true }');
    expect(source).toMatch(/async function resumePendingRollingStorageSinkReward[\s\S]*?attempts: 2, forceFresh: true/);
  });

  it('submits Rolling requirement recovery through the guarded background transport', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const loaderStart = source.indexOf('async function loadBackgroundInventorySbcContext');
    const loaderEnd = source.indexOf('async function submitInventorySbcAttempt', loaderStart);
    const loaderBlock = source.slice(loaderStart, loaderEnd);
    const inventoryStart = loaderEnd;
    const inventoryEnd = source.indexOf('async function submitInventorySelection', inventoryStart);
    const inventoryBlock = source.slice(inventoryStart, inventoryEnd);
    const start = source.indexOf('async function submitRollingRequirementRecovery');
    const end = source.indexOf('async function loadRollingRatingRecoveryContext', start);
    const block = source.slice(start, end);

    expect(loaderStart).toBeGreaterThan(-1);
    expect(loaderEnd).toBeGreaterThan(loaderStart);
    expect(loaderBlock).toContain('findAvailableRatingSbcChallengeContext');
    expect(loaderBlock).toContain('loadRatingSbcChallengeForSet');
    expect(loaderBlock).not.toContain('openSbcSet');
    expect(inventoryBlock).toMatch(/if \(useBackgroundSubmission\)[\s\S]*?loadBackgroundInventorySbcContext/);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("submissionMode: 'background'");
    expect(block).toContain('prepareRollingUntradeableDuplicateSwaps(context, runtime, {');
    expect(block).toContain('allowAuthorizedPendingDuplicateConsumption:');
    expect(source).toMatch(/allowedPendingUnassignedRefs: consumablePendingUnassignedRefs,[\s\S]*?allowAuthorizedPendingDuplicateConsumption: storagePressure/);
    expect(source.match(/allowAuthorizedPendingDuplicateConsumption: storagePressure/g)).toHaveLength(1);
    expect(block).toContain('allowItemViolationOverride: true');
    expect(block).toContain('protectActiveSquadPlayers:');
    expect(block).toContain('rollingBackgroundSubmitInventoryDiagnostic(runtime, players)');
    expect(block).not.toContain('submitSbcAndGetAwardPackId');
    expect(block).toMatch(/savedPlayers\?\.length \? savedPlayers : players/);
  });

  it('uses only the native single-entity contract for duplicate exchange and restoration', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const start = source.indexOf('async function compensateUnsubmittedDuplicateTransaction');
    const end = source.indexOf('function rollingDuplicateMaterializationPair', start);
    const duplicateBlock = source.slice(start, end);
    const finalizeStart = source.indexOf('async function finalizeRollingDuplicateMaterialization');
    const finalizeEnd = source.indexOf('async function runRollingDuplicateSubmissionAttempt', finalizeStart);
    const finalizeBlock = source.slice(finalizeStart, finalizeEnd);

    expect(start).toBeGreaterThan(-1);
    expect(duplicateBlock).toContain('moveSingleItem(signalItem, inventoryPile(\'club\'))');
    expect(duplicateBlock).not.toMatch(/moveItems\(signalItems/);
    expect(finalizeBlock).toContain('moveSingleItem(item, inventoryPile(\'club\'))');
    expect(finalizeBlock).not.toMatch(/moveItems\(liveProtectedItems/);
    expect(duplicateBlock).not.toContain("inventoryPile('storage')");
  });

  it('journals each duplicate pair before reconciling the refreshed Ledger', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const start = source.indexOf('async function prepareRollingUntradeableDuplicateSwaps');
    const end = source.indexOf('function rollingDuplicateMaterializationPair', start);
    const block = source.slice(start, end);
    const journal = block.indexOf('persistRollingDuplicateTransaction(progressed.transaction)');
    const reconcile = block.indexOf('post-untradeable-duplicate-swap');
    expect(journal).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(journal);
    expect(block).toContain('validateDuplicateMaterializationLedgerPair');
    expect(block).toContain('updateDuplicateMaterializationInventoryVersion');
  });

  it('keeps bounded candidate diagnostics on generic Storage Sink planning failures', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const genericStart = source.indexOf('async function selectRollingGenericStorageSinkSquad');
    const genericEnd = source.indexOf('async function planRollingGenericStorageSinkSquad', genericStart);
    const generic = source.slice(genericStart, genericEnd);

    expect(generic).toContain('generic Storage pressure raw player diagnostic');
    expect(generic).toContain('generic Storage pressure safe unique candidate diagnostic');
    expect(generic).toContain('generic Storage pressure Storage admission diagnostic');
    expect(generic).toContain('generic Storage pressure required Unassigned diagnostic');
    expect(generic).toContain('generic Storage pressure plan attempt');
    expect(generic).toContain('model: context.model');
    expect(generic).toContain('requiredConstraintIndexes: storageSinkRequiredSpecialRoles(context.model)');
    expect(generic.indexOf('if (pressureConsumed >= requestedPressure) return resolved;'))
      .toBeLessThan(generic.indexOf('generic Storage pressure raw player diagnostic'));
  });

  it('reuses preloaded legacy 95+ Storage Sink squads after the first submission', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const legacyStart = source.indexOf('async function runRollingLegacyStorageSinkRecovery');
    const legacyEnd = source.indexOf('async function loadRollingGenericStorageSinkContexts', legacyStart);
    const legacy = source.slice(legacyStart, legacyEnd);
    const loaderStart = source.indexOf('async function loadRollingStorageSinkContexts');
    const loaderEnd = source.indexOf('function rollingStorageSinkLoopDefForPiles', loaderStart);
    const loader = source.slice(loaderStart, loaderEnd);
    const contextLoad = legacy.indexOf('await loadRollingStorageSinkContexts(loopDef, pickDef)');
    const sequentialLoop = legacy.indexOf('while (pendingContexts.length)');

    expect(legacyStart).toBeGreaterThan(-1);
    expect(legacy.match(/await loadRollingStorageSinkContexts\(loopDef, pickDef\)/g) || []).toHaveLength(1);
    expect(contextLoad).toBeGreaterThan(-1);
    expect(sequentialLoop).toBeGreaterThan(contextLoad);
    expect(legacy).toContain('Number(loaded.completedCount || 0) + submitted');
    expect(legacy).toContain('reusing ${pendingContexts.length} preloaded remaining squad(s)');
    expect(loaderStart).toBeGreaterThan(-1);
    expect(loader).toContain('loadRatingSbcChallengeForSet(set, sourceChallenge, pickDef.name)');
    expect(loader).not.toContain('loadRatingSbcChallenge(sourceChallenge, pickDef.name, { force: true })');
  });

  it('synchronizes the loaded Rolling primary squad for reuse after recovery submissions', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const helperStart = source.indexOf('async function loadRatingSbcChallengeForSet');
    const helperEnd = source.indexOf('function hasRatingSbcChallengeRequirements', helperStart);
    const helper = source.slice(helperStart, helperEnd);
    const primaryStart = source.indexOf('async function loadRollingPrimaryContext');
    const primaryEnd = source.indexOf('function rollingRecoveryDef', primaryStart);
    const primary = source.slice(primaryStart, primaryEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helper).toContain('label, options = {}');
    expect(helper).toContain('loadRatingSbcChallenge(challenge, label, options)');
    expect(primaryStart).toBeGreaterThan(-1);
    expect(primary).toContain('loadRatingSbcChallengeForSet(set, resolvedChallenge, loopDef.name, {');
    expect(primary).not.toContain('loadRatingSbcChallenge(resolvedChallenge, loopDef.name, {');
    expect(primary).not.toContain('loadRatingSbcChallengeForSet(set, challengeContext.challenge, loopDef.name, {');
  });

  it('accepts a live Rolling primary with zero Required Special slots', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const primaryStart = source.indexOf('async function loadRollingPrimaryContext');
    const primaryEnd = source.indexOf('function rollingRecoveryDef', primaryStart);
    const primary = source.slice(primaryStart, primaryEnd);

    expect(primary).toContain('const roleCounts = roles.map(({ constraint }) => Number(constraint.count));');
    expect(primary).toContain('roleCount > 1');
    expect(primary).not.toContain('roleCount !== 1');
  });

  it('tries ordered unlimited Rare Gold Pick candidates before the Gold sink fallback', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const singleCandidateStart = source.indexOf('async function runRollingPlayerPickCandidate');
    const candidateStart = source.indexOf('async function runRollingPlayerPickRecovery');
    const storageSinkStart = source.indexOf('async function loadRollingStorageSinkContexts', candidateStart);
    const singleCandidateBlock = source.slice(singleCandidateStart, candidateStart);
    const candidateBlock = source.slice(candidateStart, storageSinkStart);
    const drainStart = source.indexOf('drainRecoveryDuplicates: async');
    const drainEnd = source.indexOf('recoverProvisions: async', drainStart);
    const drainBlock = source.slice(drainStart, drainEnd);

    expect(candidateStart).toBeGreaterThan(-1);
    expect(singleCandidateStart).toBeGreaterThan(-1);
    expect(singleCandidateBlock).toContain('findSbcSetForDefIfPresent(pickDef)');
    expect(singleCandidateBlock).toContain('classifyPlayerPickRepeatability(set)');
    expect(singleCandidateBlock).toContain("liveRepeatability.repeatability !== 'unlimited'");
    expect(candidateBlock).toContain('for (const candidate of candidates)');
    expect(candidateBlock).toContain("if (result?.status !== 'unavailable') return result;");
    expect(candidateBlock).toContain('trying the next dynamic Rare Gold Pick candidate');
    expect(drainBlock).toContain('ROLLING_UPGRADE_PHASES.REDEEM_RARE_GOLD_PICK');
    expect(drainBlock).toContain('resumePendingRollingStorageSinkReward');
    expect(drainBlock.indexOf('resumePendingRollingStorageSinkReward')).toBeLessThan(
      drainBlock.indexOf('findPendingRollingPlayerPickLoop'),
    );
    expect(drainBlock.indexOf('runRollingPlayerPickRecovery')).toBeLessThan(drainBlock.indexOf('submitRollingRequirementRecovery'));
    expect(drainBlock).not.toContain('85+ Pick');
  });

  it('wires startup Storage Sink Pick recovery before generic Unassigned recovery', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const pendingPickResume = source.indexOf('resumePendingPlayerPick: async () =>');
    const pendingUnassignedResume = source.indexOf('resumePendingUnassigned: async () =>', pendingPickResume);
    const workflowSource = await readFile(path.join(root, 'src', 'workflows', 'rolling-upgrade.js'), 'utf8');
    const workflowPickResume = workflowSource.indexOf("typeof options.resumePendingPlayerPick === 'function'");
    const workflowUnassignedResume = workflowSource.indexOf("typeof options.resumePendingUnassigned === 'function'");

    expect(pendingPickResume).toBeGreaterThan(-1);
    expect(pendingUnassignedResume).toBeGreaterThan(pendingPickResume);
    expect(source.slice(pendingPickResume, pendingUnassignedResume)).toContain('resumePendingRollingStorageSinkReward');
    expect(source).toMatch(/async function resumePendingRollingStorageSinkReward[\s\S]*?failOnUnexpected: false/);
    expect(workflowPickResume).toBeGreaterThan(-1);
    expect(workflowUnassignedResume).toBeGreaterThan(workflowPickResume);
  });

  it('deep-scans only an explicitly selected direct Player Storage sink and refreshes it after save', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).toContain("pickOptions.rollingStorageSinkMode === 'selected'");
    expect(source).toContain('Number(index.id || 0) === Number(pickOptions.rollingStorageSinkSetId || 0)');
    expect(source).toContain('isCandidate: (index) => dynamicSbcCandidate(index, activitySbcNames, pickOptions)');
    expect(source).toContain('buildRollingStorageSinkCatalog(');
    expect(source).toMatch(/storageSinkChanged[\s\S]*?await scanAvailableDynamicSbcs\(\);/);
  });

  it('reserves supply-and-craft Unassigned materials before pre-selection cleanup', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).toContain("const reservePrimaryUnassigned = primaryPiles.includes('unassigned')");
    expect(source).toMatch(/resolveRuntimeUnassigned\(`\$\{loopDef\.name\} pre-submit cleanup`, \{[\s\S]*?reserveItem: reservePrimaryUnassigned/);
    expect(source).toContain('const preserveSupply = cleanup.status === \'preserved\';');
  });

  it('forces fresh Repository evidence for all-duplicate pack responses', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).toContain('materializeFreshUnassigned({');
    expect(source).toContain('invalidate: () => inventoryAdapter.invalidateUnassigned()');
    expect(source).toContain("readRepositoryItems: () => inventoryAdapter.readPile('unassigned')");
    expect(source).toContain('readRepositoryState: () => inventoryAdapter.unassignedState()');
    expect(source).not.toContain('needsUnassignedViewMaterialization(materialized)');
    expect(source).not.toContain('all-duplicate materialization');
    expect(source).toContain('delayed materialization retry ${attempt + 1}/3');
  });

  it('keeps discovered Pick probe failures as structured recap results', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    expect(source).not.toContain('completed-status runtime probe failed');
    expect(source).toContain('showPickRecapModal(definition, pickResults, result)');
    expect(source).toContain('status: result.status');
    expect(source).toContain('reason: result.reason');
    expect(source).toMatch(/confirmSelection\(selected\)[\s\S]*?onSelectionConfirmed\?\.\(selectedCards\)[\s\S]*?invalidateUnassigned\(\)[\s\S]*?refreshUnassigned[\s\S]*?resolveRuntimeUnassigned/);
    expect(source).toMatch(/redeemPick: async \(\{ pickItem, resumed, onSelectionConfirmed \}\)[\s\S]*?redeemAndSelectPlayerPick\(pickItem, loopDef[\s\S]*?onSelectionConfirmed/);
    expect(source).toMatch(/recordPreCraftPick[\s\S]*?loopRecapSession\.dedicatedRecap = true/);
    expect(source).toMatch(/catch \(error\) \{[\s\S]*?publishPreCraftPickRecap\(failedResult\)[\s\S]*?throw error/);
  });

  it('marks the auto-crafted TOTW reward as known before 84x10 eligibility is rechecked', async () => {
    expect(createTotwUpgradePolicy()).toMatchObject({
      openRewardPacks: true,
      assumeTotwRewardPack: true,
    });
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const autoTotwStart = source.indexOf('function getAutoTotwUpgradeDef(loopDef = {})');
    const autoFodderStart = source.indexOf('function getAutoFodderUpgradeDef(loopDef = {})', autoTotwStart);
    expect(autoTotwStart).toBeGreaterThan(-1);
    expect(autoFodderStart).toBeGreaterThan(autoTotwStart);
    const autoTotwDefinition = source.slice(autoTotwStart, autoFodderStart);
    expect(autoTotwDefinition).toMatch(/\.\.\.createTotwUpgradePolicy\(\),[\s\S]*?\.\.\.override,/);
  });

  it('keeps Batch Open Rare Gold recovery bound to live dynamic Pick metadata and the triggering duplicate', async () => {
    const source = await readFile(path.join(root, 'src', 'userscript-entry.js'), 'utf8');
    const start = source.indexOf('async function trySubmitUnassignedRecoveryPlayerPick');
    const end = source.indexOf('function buildUnassignedRecoveryResolvers', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const recovery = source.slice(start, end);
    expect(recovery).toContain('resolveRareGoldPlayerPickCandidates(selector, scanned');
    expect(recovery).toContain('includeExhaustedBounded: true');
    expect(recovery).toContain('loadDynamicSbcDiscoveryChallenges(set, candidate, {');
    expect(recovery).toContain('cachedSnapshot: true');
    expect(recovery).toContain('snapshotDiscoverySet(set, challenges)');
    expect(recovery).toContain('preferredSignalRefs: triggerRefs');
    expect(recovery).toContain('requirePreferredSignal: true');
    expect(recovery).toContain('await openSbcSet(set, {');
    expect(recovery).toContain('challenge: incomplete[0].challenge');
    expect(recovery).toContain('ensureRegisteredChallenge: true');
    expect(recovery).toMatch(/submitPlayerPickChallenge\([\s\S]*?opened,/);
    expect(recovery).toMatch(/findUnassignedPlayerPick\(pickDef, 10, \{[\s\S]*?forceFresh: true/);
    expect(recovery).toMatch(/findUnassignedPlayerPick\(pendingDefinition, 1, \{[\s\S]*?forceFresh: true/);
    expect(recovery).toContain('redeemAndSelectPlayerPick(pickItem, pickDef');
    expect(recovery).toContain("enableRecovery: false");
  });

  it('keeps dynamic EA player groups opaque instead of expanding named card types', async () => {
    const discoverySource = await readFile(path.join(root, 'src', 'config', 'upgrade-discovery.js'), 'utf8');
    const policySource = await readFile(path.join(root, 'src', 'config', 'upgrade-policies.js'), 'utf8');
    const ratingSource = await readFile(path.join(root, 'src', 'selection', 'rating-model.js'), 'utf8');

    expect(discoverySource).not.toMatch(/unknown PLAYER_RARITY_GROUP encoding/);
    expect(policySource).not.toMatch(/requiredSpecialKind:\s*'totw-tots-fof'/);
    expect(ratingSource).toContain('matchesPlayerRarityGroup');
    expect(ratingSource).toContain('runtime adapter supplies');
  });
});
