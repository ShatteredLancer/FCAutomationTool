import { createSeasonContext } from './prelaunch-contract.js';

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const identity = value => integer(value, 1, Number.MAX_SAFE_INTEGER);
const stop = reason => ({ status: 'blocked', reason, liveExecutionEnabled: false, selected: [] });

// Accept normalized, complete facts only. Passive samples and screenshot facts
// cannot supply identities, safety fields, or an authorization to use real cards.
export function previewTraditionalSquad({ context, challenge, inventory, policy } = {}) {
  let scope;
  try { scope = createSeasonContext(context); } catch { return stop('CONTEXT_UNAVAILABLE'); }
  if (scope.season !== '27') return stop('UNSUPPORTED_SEASON');
  for (const input of [challenge, inventory, policy]) {
    let other;
    try { other = createSeasonContext(input?.context); } catch { return stop('CONTEXT_UNAVAILABLE'); }
    if (['season', 'accountScope', 'platform'].some(key => other[key] !== scope[key])) return stop('CONTEXT_MISMATCH');
  }
  if (challenge.schema !== 1 || challenge.mechanism !== 'traditional'
      || challenge.requirementsOperation !== 'AND'
      || !identity(challenge.setId) || !identity(challenge.id) || challenge.completed !== false) {
    return stop('CHALLENGE_UNVERIFIED');
  }
  if (!Array.isArray(challenge.requirements) || !challenge.requirements.length || challenge.requirements.length > 16) {
    return stop('REQUIREMENTS_UNAVAILABLE');
  }
  const countRules = challenge.requirements.filter(rule => rule?.kind === 'player-count');
  const required = countRules[0]?.count;
  if (countRules.length !== 1 || !integer(required, 1, 11)) return stop('PLAYER_COUNT_UNVERIFIED');
  let minRating = 1;
  let maxRating = 99;
  for (const rule of challenge.requirements) {
    if (!rule || !['player-count', 'player-min-overall', 'player-max-overall'].includes(rule.kind)
        || rule.count !== required || Object.keys(rule).some(key => !['kind', 'count', 'value'].includes(key))) {
      return stop('UNSUPPORTED_REQUIREMENT');
    }
    if (rule.kind === 'player-count') {
      if (rule.value !== undefined) return stop('UNSUPPORTED_REQUIREMENT');
    } else {
      if (!integer(rule.value, 1, 99)) return stop('UNSUPPORTED_REQUIREMENT');
      if (rule.kind === 'player-min-overall') minRating = Math.max(minRating, rule.value);
      else maxRating = Math.min(maxRating, rule.value);
    }
  }
  if (minRating > maxRating) return stop('CONTRADICTORY_REQUIREMENTS');
  const { slotCount, brickIndices } = challenge;
  if (!integer(slotCount, 1, 11) || !Array.isArray(brickIndices)
      || brickIndices.some(index => !integer(index, 0, slotCount - 1))
      || new Set(brickIndices).size !== brickIndices.length || slotCount - brickIndices.length !== required) {
    return stop('SLOT_LAYOUT_UNVERIFIED');
  }
  if (policy.schema !== 1 || policy.reviewed !== true || !integer(policy.maxRating, 1, 99)
      || ['onlyUntradeable', 'protectFsuLockedPlayers', 'protectActiveSquad', 'storageFirst']
        .some(key => typeof policy[key] !== 'boolean')
      || !Array.isArray(policy.goldRange) || policy.goldRange.length !== 2
      || policy.goldRange.some(value => !integer(value, 75, 99)) || policy.goldRange[0] > policy.goldRange[1]
      || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.length > 200
      || policy.excludedLeagueIds.some(id => !identity(id))) return stop('PROTECTION_POLICY_UNVERIFIED');
  if (inventory.schema !== 1 || inventory.kind !== 'normalized-inventory'
      || !['ready', 'provisional'].includes(inventory.status)
      || !Array.isArray(inventory.items) || inventory.items.length > 20000) return stop('INVENTORY_UNVERIFIED');
  const seen = new Set();
  const candidates = [];
  let excluded = 0;
  for (const item of inventory.items) {
    if (!item || !identity(item.id) || !identity(item.definitionId) || seen.has(item.id)) return stop('INVENTORY_IDENTITY_CONFLICT');
    seen.add(item.id);
    const safe = item.type === 'player' && ['club', 'storage'].includes(item.pile)
      && integer(item.rating, minRating, Math.min(maxRating, policy.maxRating))
      && (item.rating < 75 || integer(item.rating, policy.goldRange[0], policy.goldRange[1]))
      && item.special === false && item.evolution === false && item.cosmetic === false
      && item.concept === false && item.academyEnrolled === false && item.activeTrade === false
      && item.limitedUse === false && item.loans === -1 && item.protected === false
      && typeof item.tradeable === 'boolean' && (!policy.onlyUntradeable || item.tradeable === false)
      && identity(item.leagueId) && !policy.excludedLeagueIds.includes(item.leagueId)
      && (!policy.protectFsuLockedPlayers || item.locked === false)
      && (!policy.protectActiveSquad || item.activeSquad === false);
    if (safe) candidates.push(item);
    else excluded++;
  }
  candidates.sort((a, b) => (policy.storageFirst ? Number(b.pile === 'storage') - Number(a.pile === 'storage') : 0)
    || a.rating - b.rating || a.id - b.id);
  const definitions = new Set();
  const selected = [];
  for (const item of candidates) {
    if (definitions.has(item.definitionId)) continue;
    definitions.add(item.definitionId);
    selected.push({ id: item.id, definitionId: item.definitionId, pile: item.pile, rating: item.rating });
    if (selected.length === required) break;
  }
  if (selected.length !== required) return { ...stop('SAFE_MATERIAL_SHORTAGE'), required,
    safeCandidates: candidates.length, uniqueDefinitions: definitions.size, excluded };
  const slots = Array.from({ length: slotCount }, (_, index) => index).filter(index => !brickIndices.includes(index));
  return { status: 'preview', reason: 'READ_ONLY_PLAN', liveExecutionEnabled: false,
    setId: challenge.setId, challengeId: challenge.id, required, minRating, maxRating,
    selected: selected.map((item, index) => ({ ...item, slot: slots[index] })),
    safeCandidates: candidates.length, excluded, inventoryStatus: inventory.status,
    pending: ['FC27_RUNTIME_CONTRACT', 'EXACT_ITEM_REVALIDATION', 'REWARD_IDENTITY', 'EXPLICIT_TRANSACTION_APPROVAL'] };
}
