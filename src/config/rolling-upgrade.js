import { cloneLoopDef, isPlainObject } from '../domain/objects.js';
import {
  REQUIRED_SPECIAL_ALLOWANCE_MODES,
  REQUIRED_SPECIAL_ALLOWANCE_SOURCES,
  isRequiredSpecialEligibilityRequirement,
  requiredSpecialAllowanceMode,
  resolvedRequiredSpecialAllowanceMode,
} from '../domain/required-special.js';
import {
  createProvisionsUpgradePolicy,
  createTotwUpgradePolicy,
} from './upgrade-policies.js';
import { readPlayerPickRewardCounts } from './player-pick-discovery.js';

const ALL_INVENTORY_PILES = Object.freeze(['unassigned', 'storage', 'transfer', 'club']);

export const ROLLING_UPGRADE_STRATEGY = 'rollingUpgrade';

export function resolveRollingAutomaticUseMaxRating(loopDef = {}) {
  return Math.max(1, Math.min(99, Number(
    loopDef.runtimeProtectionRating
      || loopDef.runtimePickOptions?.protectionRating
      || loopDef.autoPickRatingThreshold
      || 90,
  ) || 90));
}

export function applyRollingAutomaticUseFodderPolicy(activeLoopDef = {}, parentLoopDef = activeLoopDef) {
  const result = clone(activeLoopDef);
  result.runtimeSbcFodderPolicy = {
    ...(result.runtimeSbcFodderPolicy || {}),
    mode: 'rating-constrained',
    ratingSbcMaxCardRating: resolveRollingAutomaticUseMaxRating(parentLoopDef),
  };
  return result;
}

export const ROLLING_RARE_GOLD_PICK_POLICY = Object.freeze({
  material: 'gold-with-required-rare',
  selectionCount: 1,
  maxChallenges: 1,
  repeatability: 'unlimited',
  preference: 'rare-cost-first',
});

export const ROLLING_PROVISIONS_RATING_RANGE = Object.freeze({
  min: 87,
  max: 91,
});

export const ROLLING_PROVISIONS_MAX_RATINGS = Object.freeze([88, 89, 90, 91]);
export const DEFAULT_ROLLING_PROVISIONS_MAX_RATING = 88;
export const ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES = Object.freeze([
  'unassigned',
  'storage',
  'transfer',
  'club',
]);
export const ROLLING_STORAGE_FIRST_RECOVERY_PILES = Object.freeze([
  'storage',
  'unassigned',
  'transfer',
  'club',
]);
export const DEFAULT_ROLLING_SHORTAGE_PROVISIONS_PACK_LIMIT = 2;
export const MAX_ROLLING_SHORTAGE_PROVISIONS_PACK_LIMIT = 30;
export const ROLLING_PRIMARY_RUNWAY_FORECAST_DEPTH = 3;

export const ROLLING_PROVISIONS_RECOVERY_MODES = Object.freeze({
  NORMAL: 'normal',
  PENDING_UNASSIGNED: 'pending-unassigned',
  STORAGE_PRESSURE: 'storage-pressure',
  RATING_EXCESS_STORAGE_PRESSURE: 'rating-excess-storage-pressure',
});

export function resolveRollingProvisionsRecoveryMode(input = {}) {
  const trigger = String(input.trigger || '');
  if (trigger === 'duplicate-reserve') {
    return ROLLING_PROVISIONS_RECOVERY_MODES.PENDING_UNASSIGNED;
  }
  if (trigger === 'storage-pressure') {
    return ROLLING_PROVISIONS_RECOVERY_MODES.STORAGE_PRESSURE;
  }
  const storageFree = input.storageFree === null || input.storageFree === undefined
    ? Number.NaN
    : Number(input.storageFree);
  const requiredCount = Math.max(1, Number(input.requiredCount || 4) || 4);
  if (trigger === 'primary-fodder-shortage'
    && ['SQUAD_RATING_EXCESS', 'PROVISIONS_LAST_BATCH_AT_RISK'].includes(String(input.reasonCode || ''))
    && Number.isFinite(storageFree)
    && storageFree < requiredCount) {
    return ROLLING_PROVISIONS_RECOVERY_MODES.RATING_EXCESS_STORAGE_PRESSURE;
  }
  return ROLLING_PROVISIONS_RECOVERY_MODES.NORMAL;
}

export function normalizeRollingProvisionsMaxRating(value) {
  const rating = Number(value);
  return ROLLING_PROVISIONS_MAX_RATINGS.includes(rating)
    ? rating
    : DEFAULT_ROLLING_PROVISIONS_MAX_RATING;
}

export function resolveRollingRecoveryPriorityPiles(loopDef = {}, options = {}) {
  const recoveryMode = String(options.recoveryMode || 'normal');
  const storageFirst = recoveryMode === 'storage-pressure'
    || (recoveryMode !== 'pending-unassigned' && (
      loopDef.runtimeRecoveryStorageFirst
        ?? loopDef.runtimePickOptions?.rollingRecoveryStorageFirst
        ?? loopDef.pickOptions?.rollingRecoveryStorageFirst
        ?? loopDef.rollingRecoveryStorageFirst
    ) === true);
  return [...(storageFirst
    ? ROLLING_STORAGE_FIRST_RECOVERY_PILES
    : ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES)];
}

export function normalizeRollingShortageProvisionsPackLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ROLLING_SHORTAGE_PROVISIONS_PACK_LIMIT;
  return Math.max(1, Math.min(
    MAX_ROLLING_SHORTAGE_PROVISIONS_PACK_LIMIT,
    Math.floor(parsed),
  ));
}

export function resolveRollingProvisionsReserveRatings(loopDef = {}) {
  const maxRating = normalizeRollingProvisionsMaxRating(
    loopDef.runtimeProvisionsMaxRating
      ?? loopDef.runtimePickOptions?.rollingProvisionsMaxRating
      ?? loopDef.pickOptions?.rollingProvisionsMaxRating
      ?? loopDef.rollingProvisionsMaxRating,
  );
  return Array.from(
    { length: maxRating - ROLLING_PROVISIONS_RATING_RANGE.min + 1 },
    (_, index) => ROLLING_PROVISIONS_RATING_RANGE.min + index,
  );
}

export function shouldQueueRollingProvisionsReward(trigger, loopDef = {}) {
  const reason = String(trigger || '');
  if (['primary-fodder-shortage', 'required-special-fodder-shortage'].includes(reason)) return true;
  return reason === 'duplicate-reserve'
    && loopDef.rollingOpenDuplicateProvisionsRewards === true;
}

export function evaluateRollingPrimaryRunway(selection = {}, options = {}) {
  const targetRating = Number(options.targetRating || 0);
  const maxAboveTarget = Math.max(0, Number(options.maxAboveTarget || 0) || 0);
  const reasonCode = selection.reasonCode || selection.missing?.code || null;
  if (selection.ok !== true) {
    return reasonCode === 'SQUAD_RATING_EXCESS'
      ? {
          status: 'recover',
          reasonCode,
          targetRating: targetRating || null,
          projectedRating: Number(selection.rating || 0) || null,
          maxAboveTarget,
        }
      : {
          status: 'diagnostic',
          reasonCode: reasonCode || 'PRIMARY_RUNWAY_UNKNOWN',
          targetRating: targetRating || null,
          projectedRating: Number(selection.rating || 0) || null,
          maxAboveTarget,
        };
  }
  const projectedRating = Number(selection.rating || 0);
  if (!targetRating || !projectedRating) {
    return {
      status: 'diagnostic',
      reasonCode: 'PRIMARY_RUNWAY_RATING_UNKNOWN',
      targetRating: targetRating || null,
      projectedRating: projectedRating || null,
      maxAboveTarget,
    };
  }
  return {
    status: projectedRating > targetRating + maxAboveTarget ? 'recover' : 'ready',
    reasonCode: projectedRating > targetRating + maxAboveTarget
      ? 'SQUAD_RATING_EXCESS'
      : null,
    targetRating,
    projectedRating,
    maxAboveTarget,
  };
}

export const ROLLING_STORAGE_SINK_PICK_SELECTOR = Object.freeze({
  rewardMinRating: 95,
  candidateCount: 3,
  selectionCount: 1,
  challengeRatings: Object.freeze([88, 89]),
});

export const ROLLING_STORAGE_SINK_MIN_CHALLENGE_RATING = 87;
const ROLLING_STORAGE_SINK_SUPPORTED_REQUIREMENTS = new Set([
  'TEAM_RATING',
  'PLAYER_QUALITY',
  'PLAYER_LEVEL',
  'PLAYER_RARITY',
  'PLAYER_RARITY_GROUP',
  'PLAYER_MIN_OVR',
  'PLAYER_EXACT_OVR',
  'CLUB_ID',
  'LEAGUE_ID',
  'NATION_ID',
]);

function clone(value) {
  return value === undefined ? undefined : cloneLoopDef(value);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizedText(value) {
  return String(value ?? '').trim();
}

function normalizedIdentityText(value) {
  return normalizedText(value)
    .toLowerCase()
    .replaceAll(/[\u2010-\u2015]/g, '-')
    .replaceAll(/[^a-z0-9+]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function pickReward(reward = {}) {
  const type = normalizedText(reward.type || reward.rewardType || reward.kind)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_');
  return reward.playerPick === true || ['PLAYER_PICK', 'PLAYERPICK'].includes(type);
}

function playerReward(reward = {}) {
  const type = normalizedText(reward.type || reward.rewardType || reward.kind)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_');
  return reward.player === true || ['PLAYER', 'PLAYER_ITEM', 'ITEM_PLAYER'].includes(type);
}

function rewardIdentity(reward = {}) {
  return normalizedText(
    reward.resourceId
      ?? reward.itemResourceId
      ?? reward.definitionId
      ?? reward.itemDefinitionId,
  );
}

function minimumRating(...values) {
  const match = /\b(\d{2})\+/.exec(values.map(normalizedText).filter(Boolean).join(' '));
  const rating = positiveInteger(match?.[1]);
  return rating && rating <= 99 ? rating : null;
}

function eligibilityKey(requirement = {}) {
  return normalizedText(requirement.key || requirement.keyName || requirement.type)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_');
}

function eligibilityValues(requirement = {}) {
  const values = requirement.values ?? requirement.value ?? requirement.scope;
  return Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
}

function challengeTargetRating(challenge = {}) {
  const requirement = (challenge.eligibilityRequirements || challenge.requirements || [])
    .find((entry) => eligibilityKey(entry) === 'TEAM_RATING');
  return positiveInteger(eligibilityValues(requirement)[0]);
}

function storageSinkNameMatches(set = {}, reward = {}) {
  const text = normalizedIdentityText([
    set.name,
    reward.name,
    reward.displayName,
    reward.description,
  ].filter(Boolean).join(' '));
  return /(?:^| )fof(?: |$)/.test(text)
    && /(?:^| )futties(?: |$)/.test(text)
    && /(?:^| )t1 t3(?: |$)/.test(text);
}

function challengeSnapshot(challenge = {}) {
  const requiredPlayerCount = positiveInteger(challenge.requiredPlayerCount);
  const eligibilityRequirements = (challenge.eligibilityRequirements || challenge.requirements || [])
    .map((requirement) => {
      const key = eligibilityKey(requirement);
      const values = eligibilityValues(requirement);
      const rawCount = Number(requirement?.count);
      const count = rawCount === -1 || !Number.isFinite(rawCount)
        ? requiredPlayerCount
        : Math.max(0, rawCount);
      return {
        ...clone(requirement),
        key,
        values,
        count,
      };
    });
  const requiredSpecialRequirements = eligibilityRequirements
    .filter(isRequiredSpecialEligibilityRequirement);
  const specialCount = requiredSpecialRequirements.reduce((total, requirement) => (
    total + Math.max(0, Number(requirement.count || 0) || 0)
  ), 0);
  const specialAllowanceMode = requiredSpecialAllowanceMode(eligibilityRequirements);
  return {
    ...clone(challenge),
    challengeId: positiveInteger(challenge.id),
    requiredPlayerCount,
    targetRating: challengeTargetRating(challenge),
    specialCount,
    requiredSpecialAllowanceMode: specialAllowanceMode,
    requiredSpecialAllowanceDecisionSource: specialAllowanceMode
      === REQUIRED_SPECIAL_ALLOWANCE_MODES.ALL_MATCHING_SPECIALS
      ? REQUIRED_SPECIAL_ALLOWANCE_SOURCES.EXPLICIT_METADATA
      : REQUIRED_SPECIAL_ALLOWANCE_SOURCES.FAIL_CLOSED,
    eligibilityRequirements,
  };
}

function completedChallenge(challenge = {}) {
  const status = normalizedText(challenge.status || challenge.state).toUpperCase();
  return challenge.completed === true || status === 'COMPLETED' || status === 'COMPLETE';
}

export function parseRollingStorageSinkPickSnapshot(input = {}) {
  const set = input.set || {};
  const selector = input.selector || ROLLING_STORAGE_SINK_PICK_SELECTOR;
  const rewards = (set.rewards || []).filter(pickReward);
  if (rewards.length !== 1) return { status: 'ignored', diagnostics: ['exactly one Player Pick reward is required'] };
  const reward = rewards[0];
  const counts = readPlayerPickRewardCounts(reward);
  const rewardMinRating = minimumRating(set.name, reward.name, reward.displayName, reward.description);
  if (rewardMinRating !== Number(selector.rewardMinRating)
    || counts.candidateCount !== Number(selector.candidateCount)
    || counts.selectionCount !== Number(selector.selectionCount)
    || !storageSinkNameMatches(set, reward)) {
    return { status: 'ignored', diagnostics: ['Player Pick does not match the Rolling Storage sink identity'] };
  }

  const setId = positiveInteger(set.id);
  const identity = rewardIdentity(reward);
  const challenges = (set.challenges || []).map(challengeSnapshot);
  const ratings = challenges.map((challenge) => challenge.targetRating).sort((left, right) => left - right);
  const expectedRatings = [...selector.challengeRatings].map(Number).sort((left, right) => left - right);
  const diagnostics = [];
  if (!setId) diagnostics.push('stable SBC Set id is missing');
  if (!identity) diagnostics.push('stable Player Pick reward identity is missing');
  if (challenges.length !== expectedRatings.length) {
    diagnostics.push(`expected ${expectedRatings.length} Challenge(s), found ${challenges.length}`);
  }
  if (ratings.join(',') !== expectedRatings.join(',')) {
    diagnostics.push(`expected Challenge ratings ${expectedRatings.join('/')}, found ${ratings.map((value) => value || '?').join('/')}`);
  }
  challenges.forEach((challenge, index) => {
    if (!challenge.challengeId) diagnostics.push(`challenge ${index + 1}: stable Challenge id is missing`);
    if (!challenge.requiredPlayerCount) diagnostics.push(`challenge ${index + 1}: required player count is missing`);
    if (!Array.isArray(challenge.eligibilityRequirements) || !challenge.eligibilityRequirements.length) {
      diagnostics.push(`challenge ${index + 1}: eligibility requirements are missing`);
    }
    const unsupported = (challenge.eligibilityRequirements || [])
      .map(eligibilityKey)
      .filter((key) => !ROLLING_STORAGE_SINK_SUPPORTED_REQUIREMENTS.has(key));
    if (unsupported.length) {
      diagnostics.push(`challenge ${index + 1}: unsupported requirements ${[...new Set(unsupported)].join(', ')}`);
    }
  });
  if (diagnostics.length) {
    return {
      status: 'unsupported',
      setId,
      rewardMinRating,
      pickCandidateCount: counts.candidateCount,
      pickCount: counts.selectionCount,
      diagnostics,
    };
  }

  const setName = normalizedText(set.name);
  const rewardName = normalizedText(reward.name || reward.displayName || reward.description);
  return {
    status: 'supported',
    setId,
    diagnostics: [],
    loop: {
      id: `rolling-storage-sink-pick-${setId}-${identity}`,
      name: setName,
      strategy: 'playerPickSbc',
      discovered: true,
      rollingStorageSink: true,
      sbcSetIds: [setId],
      sbcNames: [setName],
      pickItemResourceIds: [identity],
      pickItemNames: [rewardName],
      pickCandidateCount: counts.candidateCount,
      pickCount: counts.selectionCount,
      dynamicRewardMinRating: rewardMinRating,
      challengesPerPick: challenges.length,
      dynamicChallenges: challenges,
      maxCompletions: 1,
      pricePlatform: normalizedText(input.pricePlatform || 'pc').toLowerCase(),
    },
  };
}

export function resolveRollingStorageSinkPickCapability(
  sets = [],
  selector = ROLLING_STORAGE_SINK_PICK_SELECTOR,
) {
  const results = (sets || []).map((set) => parseRollingStorageSinkPickSnapshot({ set, selector }));
  const matches = results.filter((result) => result.status === 'supported');
  if (matches.length === 1) return { status: 'resolved', loop: matches[0].loop, matches, results };
  return {
    status: matches.length ? 'ambiguous' : 'unavailable',
    loop: null,
    matches,
    results,
  };
}

function genericStorageSinkReward(set = {}) {
  const rewards = set.rewards || [];
  const picks = rewards.filter(pickReward);
  if (picks.length === 1) return { kind: 'player-pick', reward: picks[0] };
  const players = rewards.filter(playerReward);
  if (players.length === 1) return { kind: 'player', reward: players[0] };
  return null;
}

function genericStorageSinkLoop(set, rewardKind, reward, challenges) {
  const setId = positiveInteger(set.id);
  const setName = normalizedText(set.name);
  const identity = rewardIdentity(reward);
  const common = {
    id: `rolling-storage-sink-${setId}-${identity || rewardKind}`,
    name: setName,
    strategy: rewardKind === 'player-pick' ? 'playerPickSbc' : 'storagePressureSbc',
    discovered: true,
    rollingStorageSink: true,
    sbcSetIds: [setId],
    sbcNames: [setName],
    dynamicChallenges: challenges,
    maxCompletions: 1,
    pricePlatform: 'pc',
  };
  if (rewardKind !== 'player-pick') {
    return {
      ...common,
      rewardItemResourceIds: identity ? [identity] : [],
      rewardItemNames: [normalizedText(reward.name || reward.displayName || reward.description)].filter(Boolean),
    };
  }
  const counts = readPlayerPickRewardCounts(reward);
  return {
    ...common,
    pickItemResourceIds: identity ? [identity] : [],
    pickItemNames: [normalizedText(reward.name || reward.displayName || reward.description)].filter(Boolean),
    pickCandidateCount: counts.candidateCount,
    pickCount: counts.selectionCount,
    dynamicRewardMinRating: minimumRating(set.name, reward.name, reward.displayName, reward.description),
    challengesPerPick: challenges.length,
  };
}

export function parseRollingStorageSinkSnapshot(input = {}) {
  const set = input.set || {};
  if (set.complete === true) return { status: 'ignored', diagnostics: ['SBC Set is complete'] };
  const rewardContract = genericStorageSinkReward(set);
  if (!rewardContract) {
    return { status: 'ignored', diagnostics: ['a Player Pick or direct Player reward is required'] };
  }
  const setId = positiveInteger(set.id);
  const minimumTarget = Math.max(1, Number(
    input.minimumChallengeRating || ROLLING_STORAGE_SINK_MIN_CHALLENGE_RATING,
  ) || ROLLING_STORAGE_SINK_MIN_CHALLENGE_RATING);
  const allChallenges = (set.challenges || []).map(challengeSnapshot);
  const qualifyingChallenges = allChallenges.filter(
    (challenge) => Number(challenge.targetRating || 0) >= minimumTarget,
  );
  if (!qualifyingChallenges.length) {
    return { status: 'ignored', setId, diagnostics: [`no Challenge has a target rating of ${minimumTarget}+`] };
  }
  // The threshold admits a Set as a Storage Sink. Once admitted, every remaining
  // rating squad in that Set must stay executable so a lower-rated final squad
  // cannot make a partially completed Set look exhausted.
  const challenges = allChallenges;
  const actionableChallenges = challenges.filter((challenge) => !completedChallenge(challenge));
  if (!actionableChallenges.length) {
    return { status: 'ignored', setId, diagnostics: ['no incomplete Challenge remains'] };
  }
  const diagnostics = [];
  if (!setId) diagnostics.push('stable SBC Set id is missing');
  challenges.forEach((challenge, index) => {
    if (completedChallenge(challenge)) return;
    if (!challenge.challengeId) diagnostics.push(`challenge ${index + 1}: stable Challenge id is missing`);
    if (!challenge.requiredPlayerCount) diagnostics.push(`challenge ${index + 1}: required player count is missing`);
    if (!challenge.targetRating) diagnostics.push(`challenge ${index + 1}: target rating is missing`);
    if (!Array.isArray(challenge.eligibilityRequirements) || !challenge.eligibilityRequirements.length) {
      diagnostics.push(`challenge ${index + 1}: eligibility requirements are missing`);
    }
    const unsupported = (challenge.eligibilityRequirements || [])
      .map(eligibilityKey)
      .filter((key) => !ROLLING_STORAGE_SINK_SUPPORTED_REQUIREMENTS.has(key));
    if (unsupported.length) {
      diagnostics.push(`challenge ${index + 1}: unsupported requirements ${[...new Set(unsupported)].join(', ')}`);
    }
  });
  if (rewardContract.kind === 'player-pick') {
    const counts = readPlayerPickRewardCounts(rewardContract.reward);
    if (!counts.candidateCount || !counts.selectionCount) {
      diagnostics.push('Player Pick candidate or selection count is missing');
    }
    if (!rewardIdentity(rewardContract.reward)) diagnostics.push('stable Player Pick reward identity is missing');
  }
  if (diagnostics.length) return { status: 'unsupported', setId, diagnostics };

  const legacy = parseRollingStorageSinkPickSnapshot({ set });
  const loop = genericStorageSinkLoop(
    set,
    rewardContract.kind,
    rewardContract.reward,
    challenges,
  );
  return {
    status: 'supported',
    diagnostics: [],
    capability: {
      setId,
      setName: normalizedText(set.name),
      rewardKind: rewardContract.kind,
      rewardReserveSlots: 1,
      challengeRatings: challenges.map((challenge) => challenge.targetRating).sort((a, b) => a - b),
      challenges,
      legacy95: legacy.status === 'supported',
      loop: legacy.status === 'supported' ? legacy.loop : loop,
    },
  };
}

function storageSinkCapabilityRank(left, right) {
  if (left.legacy95 !== right.legacy95) return left.legacy95 ? -1 : 1;
  const leftSlots = left.challenges.reduce((total, challenge) => total + Number(challenge.requiredPlayerCount || 0), 0);
  const rightSlots = right.challenges.reduce((total, challenge) => total + Number(challenge.requiredPlayerCount || 0), 0);
  return rightSlots - leftSlots
    || Math.max(...right.challengeRatings) - Math.max(...left.challengeRatings)
    || left.setId - right.setId;
}

export function resolveRollingStorageSinkCapability(sets = [], selection = {}) {
  const mode = ['off', 'automatic', 'selected'].includes(selection.mode)
    ? selection.mode
    : 'automatic';
  if (mode === 'off') return { status: 'disabled', mode, alternatives: [], results: [] };
  const selectedSetId = positiveInteger(selection.setId);
  const selectedSetName = normalizedText(selection.setName);
  const selectedIdentity = mode === 'selected'
    ? { selectedSetId, selectedSetName }
    : {};
  const sourceSets = mode === 'selected'
    ? (sets || []).filter((set) => positiveInteger(set?.id) === selectedSetId)
    : sets || [];
  const results = sourceSets.map((set) => parseRollingStorageSinkSnapshot({
    set,
    minimumChallengeRating: selection.minimumChallengeRating,
  }));
  const capabilities = results
    .filter((result) => result.status === 'supported')
    .map((result) => result.capability)
    .sort(storageSinkCapabilityRank);
  if (!capabilities.length) {
    return {
      status: 'unavailable',
      mode,
      ...selectedIdentity,
      alternatives: [],
      results,
    };
  }
  return {
    status: 'resolved',
    mode,
    ...selectedIdentity,
    capability: capabilities[0],
    alternatives: capabilities.slice(1),
    results,
  };
}

export function buildRollingStorageSinkCatalog(indexes = [], snapshots = []) {
  const snapshotById = new Map((snapshots || [])
    .map((snapshot) => [positiveInteger(snapshot?.id), snapshot])
    .filter(([setId]) => setId));
  return (indexes || []).map((index) => {
    const setId = positiveInteger(index?.id);
    const reward = genericStorageSinkReward(index);
    if (!setId || !reward || index?.complete === true) return null;
    const snapshot = snapshotById.get(setId);
    const parsed = snapshot ? parseRollingStorageSinkSnapshot({ set: snapshot }) : null;
    if (snapshot && parsed?.status !== 'supported') return null;
    if (!snapshot && reward.kind === 'player-pick') return null;
    return {
      setId,
      name: normalizedText(index.name),
      rewardKind: reward.kind,
      status: parsed?.status === 'supported' ? 'validated' : parsed?.status || 'indexed',
      challengeRatings: parsed?.capability?.challengeRatings || [],
      diagnostics: parsed?.diagnostics || [],
    };
  }).filter(Boolean).sort((left, right) => (
    left.name.localeCompare(right.name) || left.setId - right.setId
  ));
}

function requirementGroups(loop = {}) {
  if (Array.isArray(loop.challengeRequirements) && loop.challengeRequirements.length) {
    return loop.challengeRequirements;
  }
  return Array.isArray(loop.requirements) && loop.requirements.length ? [loop.requirements] : [];
}

function stablePlayerPickIdentity(loop = {}) {
  return (loop.sbcSetIds || []).some(positiveInteger)
    && (loop.pickItemResourceIds || []).some((value) => normalizedText(value));
}

function rollingRareGoldPickCandidate(loop = {}, policy = ROLLING_RARE_GOLD_PICK_POLICY) {
  if (loop.strategy !== 'playerPickSbc') return null;
  if (loop.discovered !== true && loop.scannedMetadata !== true) return null;
  if (!stablePlayerPickIdentity(loop)) return null;
  if (loop.repeatability !== policy.repeatability) return null;
  if (Number(loop.pickCount || 0) !== Number(policy.selectionCount)) return null;
  const candidateCount = positiveInteger(loop.pickCandidateCount);
  const rewardMinRating = positiveInteger(loop.dynamicRewardMinRating);
  if (!candidateCount || !rewardMinRating || candidateCount < Number(policy.selectionCount)) return null;
  const groups = requirementGroups(loop);
  if (groups.length !== Number(policy.maxChallenges) || !groups[0].length) return null;
  const requirements = groups[0];
  let minimumRareGoldCost = 0;
  let totalGoldCost = 0;
  for (const requirement of requirements) {
    const count = positiveInteger(requirement?.count);
    const rarity = normalizedText(requirement?.rarity).toLowerCase();
    const consumption = normalizedText(requirement?.goldConsumption).toLowerCase();
    if (!count
      || requirement?.tier !== 'gold'
      || requirement?.playerOnly !== true
      || requirement?.allowSpecial !== false
      || !['', 'common', 'rare'].includes(rarity)
      || (!rarity && consumption !== 'common-first')) return null;
    totalGoldCost += count;
    if (rarity === 'rare') minimumRareGoldCost += count;
  }
  if (!minimumRareGoldCost || totalGoldCost < minimumRareGoldCost) return null;
  return {
    loop,
    minimumRareGoldCost,
    totalGoldCost,
    flexibleGoldCost: totalGoldCost - minimumRareGoldCost,
    rewardMinRating,
    candidateCount,
    selectionCount: Number(loop.pickCount || 0),
  };
}

function compareRollingRareGoldPickCandidates(left, right) {
  return left.minimumRareGoldCost - right.minimumRareGoldCost
    || left.totalGoldCost - right.totalGoldCost
    || right.rewardMinRating - left.rewardMinRating
    || right.candidateCount - left.candidateCount;
}

function rollingRareGoldPickSelection(candidate) {
  if (!candidate) return null;
  return {
    minimumRareGoldCost: candidate.minimumRareGoldCost,
    totalGoldCost: candidate.totalGoldCost,
    flexibleGoldCost: candidate.flexibleGoldCost,
    rewardMinRating: candidate.rewardMinRating,
    candidateCount: candidate.candidateCount,
    selectionCount: candidate.selectionCount,
  };
}

export function resolveRollingPlayerPickCapability(
  loops = [],
  policy = ROLLING_RARE_GOLD_PICK_POLICY,
) {
  const candidates = (loops || [])
    .map((loop) => rollingRareGoldPickCandidate(loop, policy))
    .filter(Boolean)
    .sort(compareRollingRareGoldPickCandidates);
  const matches = candidates.map((candidate) => candidate.loop);
  if (candidates.length) {
    const best = candidates[0];
    const tied = candidates.filter((candidate) => compareRollingRareGoldPickCandidates(best, candidate) === 0);
    if (tied.length === 1) {
      return {
        status: 'resolved',
        loop: best.loop,
        alternatives: candidates.slice(1).map((candidate) => candidate.loop),
        selection: rollingRareGoldPickSelection(best),
        candidates: candidates.map((candidate) => ({
          loop: candidate.loop,
          selection: rollingRareGoldPickSelection(candidate),
        })),
        matches,
      };
    }
  }
  return {
    status: candidates.length ? 'ambiguous' : 'unavailable',
    loop: null,
    alternatives: [],
    selection: null,
    candidates: candidates.map((candidate) => ({
      loop: candidate.loop,
      selection: rollingRareGoldPickSelection(candidate),
    })),
    matches,
  };
}

export function createRollingPrimaryStage(loop = {}) {
  const setId = positiveInteger(loop.sbcSetIds?.[0]);
  const rating = Number(loop.dynamicRewardMinRating);
  const challenges = Array.isArray(loop.dynamicChallenges) ? loop.dynamicChallenges : [];
  const rewardPackIds = Array.isArray(loop.rewardPackIds) ? loop.rewardPackIds : [];
  const challengeIds = challenges.map((challenge) => positiveInteger(challenge?.challengeId));
  const packIds = rewardPackIds.map(positiveInteger);
  if (!setId || ![85, 86].includes(rating)
    || !challenges.length
    || !rewardPackIds.length
    || challengeIds.some((id) => !id)
    || new Set(challengeIds).size !== challengeIds.length
    || packIds.some((id) => !id)
    || new Set(packIds).size !== packIds.length) return null;
  return {
    key: String(rating),
    setId,
    setName: normalizedText(loop.sbcNames?.[0] || loop.name),
    challengeIds,
    rewardPackIds: packIds,
    rewardPackNames: [...(loop.rewardPackNames || [])],
    dynamicSbcFamily: loop.dynamicSbcFamily,
    dynamicRewardCount: loop.dynamicRewardCount,
    dynamicRewardMinRating: loop.dynamicRewardMinRating,
    dynamicChallengeCount: loop.dynamicChallengeCount,
    dynamicChallenges: clone(loop.dynamicChallenges || []),
    expectedPlayerCount: loop.expectedPlayerCount,
    requiredSpecialCount: loop.requiredSpecialCount,
    allowedSpecialCount: loop.allowedSpecialCount,
    repeatability: loop.repeatability || 'unknown',
    completionLimit: loop.completionLimit ?? null,
    remainingCompletions: loop.remainingCompletions ?? null,
  };
}

export function resolveRollingRequiredSpecialContract(value = {}) {
  const requiredSpecialCount = Number(value.requiredSpecialCount);
  const allowedSpecialCount = Number(value.allowedSpecialCount);
  if (!Number.isInteger(requiredSpecialCount) || ![0, 1].includes(requiredSpecialCount)) {
    return {
      valid: false,
      reason: 'supports only zero or one live Required Special slot',
    };
  }
  if (!Number.isInteger(allowedSpecialCount) || allowedSpecialCount < 0) {
    return {
      valid: false,
      reason: 'allowedSpecialCount must be a non-negative integer',
    };
  }
  if (requiredSpecialCount === 0) {
    return allowedSpecialCount === 0
      ? { valid: true, requiredSpecialCount, allowedSpecialCount, expectedAllowedSpecialCount: 0 }
      : {
          valid: false,
          reason: 'allows no special cards when the live Challenge requires none',
        };
  }
  const specialAllowanceModes = (value.dynamicChallenges || [])
    .map(resolvedRequiredSpecialAllowanceMode);
  const allowsAllSafeSpecials = specialAllowanceModes.length > 0
    && specialAllowanceModes.every((mode) => (
      mode === REQUIRED_SPECIAL_ALLOWANCE_MODES.ALL_MATCHING_SPECIALS
    ));
  const expectedAllowedSpecialCount = allowsAllSafeSpecials
    ? Number(value.expectedPlayerCount || 0)
    : 1;
  if (!Number.isInteger(expectedAllowedSpecialCount) || expectedAllowedSpecialCount < 1
    || allowedSpecialCount !== expectedAllowedSpecialCount) {
    return {
      valid: false,
      reason: allowsAllSafeSpecials
        ? `requires one live Required Special slot and allows up to ${expectedAllowedSpecialCount} safe special cards`
        : 'requires allowedSpecialCount to match its one live Required Special slot',
    };
  }
  return {
    valid: true,
    requiredSpecialCount,
    allowedSpecialCount,
    expectedAllowedSpecialCount,
  };
}

function validRollingPrimaryStage(stage = {}) {
  const rating = Number(stage.dynamicRewardMinRating);
  const setId = positiveInteger(stage.setId);
  const challengeIds = Array.isArray(stage.challengeIds)
    ? stage.challengeIds.map(positiveInteger).filter(Boolean)
    : [];
  const packIds = Array.isArray(stage.rewardPackIds)
    ? stage.rewardPackIds.map(positiveInteger).filter(Boolean)
    : [];
  if (!setId || ![85, 86].includes(rating)
    || String(stage.key || '') !== String(rating)
    || !challengeIds.length
    || new Set(challengeIds).size !== challengeIds.length
    || !packIds.length
    || new Set(packIds).size !== packIds.length) return false;
  if (!['unlimited', 'bounded'].includes(stage.repeatability)) return false;
  if (stage.repeatability === 'bounded'
    && (!Number.isInteger(Number(stage.completionLimit))
      || Number(stage.completionLimit) < 1
      || !Number.isInteger(Number(stage.remainingCompletions))
      || Number(stage.remainingCompletions) < 0)) return false;
  return resolveRollingRequiredSpecialContract(stage).valid;
}

export function createRollingUpgradeLoopDef(primaryLoop = {}, options = {}) {
  const specialContract = resolveRollingRequiredSpecialContract(primaryLoop);
  if (primaryLoop.dynamicSbcFamily !== 'high-rated-x10'
    || Number(primaryLoop.dynamicRewardCount || 0) !== 10
    || ![85, 86].includes(Number(primaryLoop.dynamicRewardMinRating || 0))
    || !specialContract.valid) return null;
  const setId = positiveInteger(primaryLoop.sbcSetIds?.[0]);
  if (!setId) return null;
  const composite = options.composite === true;
  const inferredStage = createRollingPrimaryStage(primaryLoop);
  const stages = Array.isArray(options.stages) && options.stages.length
    ? options.stages.map(clone)
    : [inferredStage].filter(Boolean);
  // Keep the historical factory contract for callers that only provide the
  // primary Set identity. Live discovery always supplies a fully validated
  // stage, while minimal programmatic definitions may omit stage metadata.
  if ((composite && stages.length !== 2) || (!composite && stages.length > 1)
    || stages.some((stage) => !validRollingPrimaryStage(stage))) return null;
  if (composite && (
    Number(stages[0].dynamicRewardMinRating) !== 86
    || Number(stages[1].dynamicRewardMinRating) !== 85
    || stages[0].repeatability !== 'bounded'
    || Number(stages[0].remainingCompletions) <= 0
    || stages[1].repeatability !== 'unlimited'
  )) return null;
  const result = {
    ...clone(primaryLoop),
    id: composite
      ? `rolling-upgrade-composite-${stages[0].setId}-${stages[1].setId}`
      : `rolling-upgrade-${setId}-${Number(primaryLoop.dynamicRewardMinRating || 0) || 'x'}`,
    name: composite
      ? `${stages[0].setName} -> ${stages[1].setName} Rolling Loop`
      : `${primaryLoop.name} Rolling Loop`,
    strategy: ROLLING_UPGRADE_STRATEGY,
    hidden: false,
    mvp: false,
    rollingWorkflowEnabled: true,
    defaultOpenRewardPacksOnSelect: true,
    openRewardPacks: false,
    maxCompletions: 0,
    useRoundsAsCompletions: true,
    rollingPrimaryComposite: composite,
    ...(stages.length ? { rollingPrimaryStages: stages } : {}),
    runtimeQuantity: {
      mode: 'user',
      target: 'maxCompletions',
      default: 0,
      min: 0,
      max: 1000,
      allowZero: true,
      label: 'SBC completions',
    },
    rollingTotwUpgrade: {
      name: 'Scanned Required Special Recovery',
      activityBinding: {
        family: 'totw-upgrade',
        category: 'Upgrades',
        required: true,
      },
      ...createTotwUpgradePolicy({
        forceOpenRewardPacks: false,
        openRewardPacks: false,
        ratingSbcFill: { priorityPiles: [...ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES] },
      }),
    },
    rollingProvisionsUpgrade: {
      name: 'Scanned Provisions Recovery',
      activityBinding: {
        family: 'provisions-upgrade',
        category: 'Upgrades',
        required: true,
      },
      ...createProvisionsUpgradePolicy({
        ratingSbcFill: { priorityPiles: [...ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES] },
        requirements: [{
          tier: 'gold',
          count: 4,
          minRating: ROLLING_PROVISIONS_RATING_RANGE.min,
          maxRating: DEFAULT_ROLLING_PROVISIONS_MAX_RATING,
          playerOnly: true,
          allowSpecial: true,
          priorityPiles: [...ROLLING_UNASSIGNED_FIRST_RECOVERY_PILES],
        }],
      }),
    },
    rollingPlayerPick: {
      status: 'unavailable',
      required: true,
      selector: clone(ROLLING_RARE_GOLD_PICK_POLICY),
    },
    rollingStorageSinkPick: {
      status: 'unavailable',
      required: false,
      selector: clone(ROLLING_STORAGE_SINK_PICK_SELECTOR),
    },
    rollingStorageSink: {
      status: 'disabled',
      required: false,
      mode: 'off',
    },
    rollingGoldSinkUpgrade: {
      name: 'Scanned Gold Duplicate Sink',
      strategy: 'fillAndVerifySbc',
      activityBinding: {
        family: '5x80-upgrade',
        category: 'Upgrades',
        required: true,
      },
      requirements: [{
        tier: 'gold',
        count: 1,
        goldConsumption: 'common-first',
        playerOnly: true,
        allowSpecial: false,
        priorityPiles: [...ALL_INVENTORY_PILES],
      }],
      priorityPiles: [...ALL_INVENTORY_PILES],
      blockSpecial: true,
      blockTradeable: false,
      openRewardPacks: false,
    },
  };
  delete result.autoTotwUpgrade;
  delete result.autoFodderUpgrade;
  return result;
}

export function bindRollingPlayerPickCapability(loopDef = {}, loopDefs = []) {
  if (loopDef.strategy !== ROLLING_UPGRADE_STRATEGY) return clone(loopDef);
  const result = clone(loopDef);
  const configured = isPlainObject(result.rollingPlayerPick) ? result.rollingPlayerPick : {};
  const selector = isPlainObject(configured.selector)
    ? configured.selector
    : ROLLING_RARE_GOLD_PICK_POLICY;
  const resolution = resolveRollingPlayerPickCapability(loopDefs, selector);
  result.rollingPlayerPick = {
    ...configured,
    status: resolution.status,
  };
  delete result.rollingPlayerPick.loop;
  delete result.rollingPlayerPick.alternatives;
  delete result.rollingPlayerPick.selection;
  if (resolution.loop) result.rollingPlayerPick.loop = clone(resolution.loop);
  if (resolution.alternatives?.length) {
    result.rollingPlayerPick.alternatives = resolution.alternatives.map(clone);
  }
  if (resolution.selection) result.rollingPlayerPick.selection = clone(resolution.selection);
  return result;
}

export function bindRollingStorageSinkPickCapability(loopDef = {}, sets = []) {
  if (loopDef.strategy !== ROLLING_UPGRADE_STRATEGY) return clone(loopDef);
  const result = clone(loopDef);
  const configured = isPlainObject(result.rollingStorageSinkPick)
    ? result.rollingStorageSinkPick
    : {};
  const selector = isPlainObject(configured.selector)
    ? configured.selector
    : ROLLING_STORAGE_SINK_PICK_SELECTOR;
  const resolution = resolveRollingStorageSinkPickCapability(sets, selector);
  result.rollingStorageSinkPick = {
    ...configured,
    status: resolution.status,
  };
  delete result.rollingStorageSinkPick.loop;
  if (resolution.loop) result.rollingStorageSinkPick.loop = clone(resolution.loop);
  return result;
}

export function bindRollingStorageSinkCapability(loopDef = {}, sets = [], selection = {}) {
  if (loopDef.strategy !== ROLLING_UPGRADE_STRATEGY) return clone(loopDef);
  const result = clone(loopDef);
  const resolution = resolveRollingStorageSinkCapability(sets, selection);
  result.rollingStorageSink = {
    status: resolution.status,
    required: false,
    mode: resolution.mode,
    ...(resolution.mode === 'selected' ? {
      selectedSetId: resolution.selectedSetId,
      selectedSetName: resolution.selectedSetName,
    } : {}),
  };
  if (resolution.capability) result.rollingStorageSink.capability = clone(resolution.capability);
  if (resolution.alternatives?.length) {
    result.rollingStorageSink.alternatives = resolution.alternatives.map(clone);
  }
  return result;
}

export function bindRollingPlayerPickCapabilities(rollingLoops = [], loopDefs = [], options = {}) {
  return (rollingLoops || []).map((loopDef) => bindRollingStorageSinkCapability(
    bindRollingStorageSinkPickCapability(
      bindRollingPlayerPickCapability(loopDef, loopDefs),
      options.storageSinkSets || [],
    ),
    options.storageSinkSets || [],
    options.storageSinkSelection || {},
  ));
}
