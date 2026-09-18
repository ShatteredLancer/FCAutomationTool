import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, readFc27CachedClub } from './fc27-local-read.js';
import { listFc27InProgressChallenges, normalizeFc27TraditionalChallenge } from './fc27-traditional-read.js';
import { inspectFc27ChallengeCatalog } from './fc27-challenge-catalog.js';
import { inspectInProgressSquad } from './fc27-sbc-read.js';
import { previewTraditionalSquad } from '../../fc27/traditional-preview.js';
export { inspectFc27ChallengeCatalog } from './fc27-challenge-catalog.js';
export { inspectFc27FsuSupport, inspectFc27FsuSettings, validateFc27FsuSample } from './fc27-fsu-diagnostics.js';

export function readFc27RunnerPolicy(root, maxRating = 74) {
  if (![74, 83].includes(maxRating)) throw new Error('FC27_PREVIEW_POLICY_UNAPPROVED');
  const report = inspectFc27RunnerInputs(root);
  if (report.status !== 'observed') throw new Error(report.reason);
  const leagues = ownData(ownData(ownData(root, 'info'), 'set'), 'shield_league');
  return { schema: 1, context: readFc27Context(root), reviewed: true,
    maxRating: Math.min(maxRating, report.fsu.policy.goldRange[1]), onlyUntradeable: true,
    protectFsuLockedPlayers: false, protectActiveSquad: false, storageFirst: report.fsu.policy.storageFirst,
    goldRange: report.fsu.policy.goldRange,
    excludedLeagueIds: report.fsu.policy.excludeDesignatedLeagues
      ? Array.from({ length: leagues.length }, (_, index) => ownData(leagues, String(index))) : [] };
}

export function readFc27RunnerPanel(root) {
  const inputs = inspectFc27RunnerInputs(root);
  if (inputs.status !== 'observed') return { inputs, targets: [] };
  try {
    const sets = ownData(ownData(ownData(ownData(root, 'services'), 'SBC'), 'repository'), 'sets');
    const collection = ownData(sets, '_collection');
    if (!collection || typeof collection !== 'object') throw new Error();
    const keys = Object.getOwnPropertyNames(collection);
    if (keys.length > 500) throw new Error();
    const targets = keys.map(key => {
      const set = ownData(collection, key);
      const setId = ownData(set, 'id');
      const name = ownData(set, 'name');
      if (!Number.isSafeInteger(setId) || setId <= 0 || setId >= 1e9 || typeof name !== 'string'
          || !name.trim() || name.length > 160 || /[\u0000-\u001f]/.test(name)) throw new Error();
      return { setId, name };
    });
    if (new Set(targets.map(target => target.setId)).size !== targets.length) throw new Error();
    return { inputs, targets };
  } catch {
    return { inputs: { ...inputs, status: 'blocked', reason: 'FC27_CATALOG_SET_UNVERIFIED' }, targets: [] };
  }
}

// Diagnostic projection only: do not invoke FSU methods, expose identities or promote cached inventory.
export function inspectFc27RunnerInputs(root) {
  const report = { schema: 1, status: 'blocked', reason: 'FC27_CONTEXT_UNAVAILABLE',
    liveExecutionEnabled: false, contextVerified: false, fsu: null, club: null, inProgressChallenges: null };
  try {
    const context = readFc27Context(root);
    report.contextVerified = true;
    const info = ownData(root, 'info');
    const base = ownData(info, 'base');
    const build = ownData(info, 'build');
    const set = ownData(info, 'set');
    const events = ownData(root, 'events');
    const cache = ownData(ownData(base, 'clubCache'), 'status');
    const initialized = ownData(base, 'initialized') === true;
    const provisional = ['trusted-provisional', 'validating', 'validation-failed'].includes(cache);
    const ready = ownData(base, 'state') === true && ['ready', 'finalizing'].includes(cache);
    report.fsu = { initialized, readiness: initialized && provisional ? 'provisional' : initialized && ready ? 'ready' : 'not-ready',
      targetedValidationAvailable: typeof ownData(events, 'validateClubPlayers') === 'function', policy: null };
    if (![27, '27'].includes(ownData(base, 'year'))) throw new Error('FC27_FSU_SEASON_MISMATCH');
    if (report.fsu.readiness === 'not-ready') throw new Error('FC27_FSU_NOT_READY');
    const flags = ['untradeable', 'academy', 'league', 'firststorage'].map(key => ownData(build, key));
    const goldenMax = ownData(set, 'goldenrange');
    const rawLeagues = ownData(set, 'shield_league');
    const leagues = Array.isArray(rawLeagues) && rawLeagues.length <= 200
      ? Array.from({ length: rawLeagues.length }, (_, index) => ownData(rawLeagues, String(index))) : null;
    if (flags.some(value => typeof value !== 'boolean') || !Number.isInteger(goldenMax) || goldenMax < 75 || goldenMax > 99
        || !leagues || leagues.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('FC27_FSU_POLICY_UNVERIFIED');
    report.fsu.policy = { onlyUntradeable: flags[0], excludeEvolution: flags[1], excludeDesignatedLeagues: flags[2],
      storageFirst: flags[3], goldRange: [75, goldenMax], excludedLeagueCount: flags[2] ? new Set(leagues).size : 0 };
    if (!report.fsu.targetedValidationAvailable) throw new Error('FC27_FSU_VALIDATION_UNAVAILABLE');
    const club = readFc27CachedClub(root);
    report.club = { status: club.status, complete: club.complete, cachedEntries: club.cachedEntries, cachedPlayers: club.items.length };
    report.inProgressChallenges = listFc27InProgressChallenges(root).length;
    if (JSON.stringify(readFc27Context(root)) !== JSON.stringify(context)) throw new Error('FC27_CONTEXT_CHANGED');
    return { ...report, status: 'observed', reason: 'FC27_TRANSACTION_UNVERIFIED',
      pending: ['REVIEWED_RUNNER_POLICY', 'EXACT_ITEM_VALIDATION', 'SBC_PLAN_AND_REWARD', 'LIVE_TRANSACTION_ACCEPTANCE'] };
  } catch (error) {
    return { ...report, reason: /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_RUNNER_INSPECTION_UNAVAILABLE' };
  }
}

// Diagnostic-only authorization from the reviewed low-value preview: no settings are persisted.
export async function previewFc27RunnerSquad(root, { setId, maxRating = 74 } = {}) {
  const stop = reason => ({ status: 'blocked', reason, liveExecutionEnabled: false });
  try {
    if (![74, 83].includes(maxRating)) return stop('FC27_PREVIEW_POLICY_UNAPPROVED');
    const initial = inspectFc27RunnerInputs(root);
    if (initial.status !== 'observed') return stop(initial.reason);
    const readPolicy = () => {
      const report = inspectFc27RunnerInputs(root);
      if (report.status !== 'observed') throw new Error('FC27_RUNNER_INPUTS_CHANGED');
      const context = readFc27Context(root);
      const leagues = ownData(ownData(ownData(root, 'info'), 'set'), 'shield_league');
      return { schema: 1, context, reviewed: true, maxRating: Math.min(maxRating, report.fsu.policy.goldRange[1]), onlyUntradeable: true,
        protectFsuLockedPlayers: false, protectActiveSquad: false, storageFirst: report.fsu.policy.storageFirst,
        goldRange: report.fsu.policy.goldRange,
        excludedLeagueIds: report.fsu.policy.excludeDesignatedLeagues
          ? Array.from({ length: leagues.length }, (_, index) => ownData(leagues, String(index))) : [] };
    };
    const policy = readPolicy();
    const unchanged = () => {
      try { return JSON.stringify(policy) === JSON.stringify(readPolicy()); } catch { return false; }
    };
    const startedAt = Date.now();
    const catalog = await inspectFc27ChallengeCatalog(root, { setId });
    if (catalog.status !== 'observed') return catalog;
    if (!unchanged()) return stop('FC27_RUNNER_INPUTS_CHANGED');
    if (catalog.challenges.length !== 1 || catalog.challenges[0].status !== 'IN_PROGRESS') {
      return stop('FC27_SINGLE_IN_PROGRESS_CHALLENGE_REQUIRED');
    }
    const observed = catalog.challenges[0];
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 800 - (Date.now() - startedAt))));
    if (!unchanged()) return stop('FC27_RUNNER_INPUTS_CHANGED');
    const layout = await inspectInProgressSquad({ setId, challengeId: observed.id }, root, observed);
    if (layout.status !== 'observed') return layout;
    if (!unchanged()) return stop('FC27_RUNNER_INPUTS_CHANGED');
    // Restore only the public requirement DTO shape; the values all come from this catalog GET.
    const challenge = normalizeFc27TraditionalChallenge({ context: policy.context, setId, layout,
      challenge: { ...observed, eligibilityRequirements: observed.requirements.map(rule => ({
        count: rule.count, scope: rule.scope, kvPairs: { _collection: Object.fromEntries(rule.pairs.map(pair => [pair.key, pair.values])) },
      })) }, keys: ownData(root, 'SBCEligibilityKey'), scopes: ownData(root, 'SBCEligibilityScope'),
      qualities: ownData(root, 'SBCEligibilityQualityType') });
    const cached = readFc27CachedClub(root);
    const inventory = { schema: 1, context: cached.context, kind: 'normalized-inventory', status: 'provisional',
      // The preview has no extra protected-ID list; unknown/special/upgraded cards remain protected.
      items: cached.items.map(item => ({ ...item, protected: item.special !== false || item.evolution !== false || item.cosmetic !== false })) };
    const plan = previewTraditionalSquad({ context: policy.context, challenge, inventory, policy });
    if (!unchanged()) return stop('FC27_RUNNER_INPUTS_CHANGED');
    return { status: plan.status, reason: plan.reason, liveExecutionEnabled: false,
      setId, challengeId: observed.id, setName: catalog.setName,
      requirements: observed.requirements, layout: { slotCount: layout.slotCount, requiredPlayerCount: layout.requiredPlayerCount,
        simpleBrickIndices: layout.simpleBrickIndices, customBrickIndices: layout.customBrickIndices },
      policy: { maxRating: policy.maxRating, onlyUntradeable: policy.onlyUntradeable, excludeEvolution: true,
        excludeSpecial: true, excludedLeagueCount: new Set(policy.excludedLeagueIds).size,
        protectFsuLockedPlayers: policy.protectFsuLockedPlayers, protectActiveSquad: policy.protectActiveSquad },
      inventory: { status: 'provisional', complete: false, cachedPlayers: cached.items.length, scope: 'club-only' },
      plan: { required: layout.requiredPlayerCount, selectedCount: plan.selected.length,
        ratings: plan.selected.map(item => item.rating), slots: plan.selected.map(item => item.slot),
        uniqueDefinitions: new Set(plan.selected.map(item => item.definitionId)).size === plan.selected.length,
        safeCandidates: plan.safeCandidates ?? null, excluded: plan.excluded ?? null,
        excludedByReason: plan.excludedByReason ?? null },
      pending: ['EXACT_ITEM_VALIDATION', 'SET_AND_CHALLENGE_REWARD_IDENTITY', 'EXPLICIT_TRANSACTION_APPROVAL', 'LIVE_TRANSACTION_ACCEPTANCE'] };
  } catch (error) {
    return stop(/^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_RUNNER_PREVIEW_UNAVAILABLE');
  }
}
