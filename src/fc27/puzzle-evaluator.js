// Detached ordinary-card SBC evaluation. Runtime evidence is supplied by the
// caller; absent feature flags, identities or profiles never imply defaults.
import { createFc27ClubResolver } from './sbc-requirements.js';

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const positive = value => integer(value, 1, Number.MAX_SAFE_INTEGER);
const fail = reason => ({ status: 'blocked', reason, chemistry: null, teamRating: null });

export function evaluateFc27PuzzleRating({ squad, rating } = {}) {
  if (!Array.isArray(squad) || !squad.length || squad.length > 11
      || Array.from(squad).some(item => !integer(item?.rating, 1, 99))) return fail('FC27_PUZZLE_RATING_ITEMS_UNAVAILABLE');
  if (typeof rating?.floatCalculationEnabled !== 'boolean') return fail('FC27_PUZZLE_RATING_CONFIG_UNAVAILABLE');
  let total = squad.reduce((sum, item) => sum + item.rating, 0);
  const average = Math.min(rating.floatCalculationEnabled ? total / 11 : Math.floor(total / 11), 99);
  // Preserve EA's sequential accumulation, including floating-point rounding.
  for (const item of squad) if (item.rating > average) total += item.rating - average;
  if (rating.floatCalculationEnabled) total = Math.round(total);
  return { status: 'observed', teamRating: Math.min(Math.max(Math.floor(total / 11), 0), 99),
    ratingMode: rating.floatCalculationEnabled ? 'float' : 'integer' };
}

function parametersOf(parameters) {
  if (!Array.isArray(parameters) || parameters.length !== 3) return null;
  const map = new Map();
  for (const parameter of parameters) {
    if (!integer(parameter?.id, 1, 3) || map.has(parameter.id) || !Array.isArray(parameter.thresholds)
        || !parameter.thresholds.length || parameter.thresholds.length > 8) return null;
    const thresholds = Array.from(parameter.thresholds);
    if (thresholds.some(value => !integer(value?.requirement, 1, 99) || !integer(value?.points, 0, 3))
        || thresholds.some((value, index) => index && value.requirement <= thresholds[index - 1].requirement)) return null;
    map.set(parameter.id, thresholds);
  }
  return map;
}

function profilesOf(chemistry) {
  if (chemistry.profilesEnabled === false) return [];
  const snapshot = chemistry.profiles;
  if (snapshot?.complete !== true || !Array.isArray(snapshot.entries)
      || !snapshot.entries.length || snapshot.entries.length > 128) return null;
  const ids = new Set(); const rarities = new Set();
  for (const profile of snapshot.entries) {
    if (!positive(profile?.id) || ids.has(profile.id) || !Array.isArray(profile.applicableRarityIds)
        || profile.applicableRarityIds.length > 10001) return null;
    ids.add(profile.id);
    for (const rarity of profile.applicableRarityIds) {
      if (!integer(rarity, 0, 10000) || rarities.has(rarity)) return null;
      rarities.add(rarity);
    }
  }
  return ids.has(1) ? snapshot.entries : null;
}

function ordinaryProfile(profile) {
  return profile?.maxChem === false && Array.isArray(profile.rules) && profile.rules.length === 3
    && new Set(profile.rules.map(rule => rule?.parameterId)).size === 3
    && profile.rules.every(rule => integer(rule?.parameterId, 1, 3) && rule.calculationType === 1 && rule.contribution === 1);
}

// Necessary (not sufficient) chemistry bound for a partial card combination.
// A selected field's count cannot exceed its already selected cards plus the
// remaining candidates in that group. Ignore position eligibility for group
// counts, physical duplicates in the suffix, and slot conflicts for flexible
// cards; these relaxations can only overestimate achievable chemistry.
export function createFc27PuzzlePartialChemistryBound({ candidates, slots, formation, chemistry } = {}) {
  if (!Array.isArray(candidates) || !Array.isArray(slots) || !Array.isArray(formation?.positions)
      || formation.positions.length !== 11 || formation.positions.some(position => !integer(position, 0, 27))
      || slots.some(slot => !integer(slot, 0, 10)) || new Set(slots).size !== slots.length
      || chemistry?.maxChemistryPerPlayer !== 3) return null;
  const parameters = parametersOf(chemistry.parameters);
  const profiles = profilesOf(chemistry);
  const resolveClub = createFc27ClubResolver(chemistry.links);
  if (parameters?.size !== 3 || !profiles || !resolveClub
      || typeof chemistry.profilesEnabled !== 'boolean') return null;
  // Special-card profiles may coexist in EA's complete snapshot, but the safe
  // candidate pool contains only normal rarities. Match the evaluator's exact
  // per-rarity profile selection rather than rejecting unrelated profiles.
  if (chemistry.profilesEnabled && [...new Set(candidates.map(item => item?.rarity))].some(rarity => {
    const profile = profiles.find(value => value.applicableRarityIds.includes(rarity))
      ?? profiles.find(value => value.id === 1);
    return !ordinaryProfile(profile);
  })) return null;
  const identities = chemistry.identities;
  const excluded = [identities?.legendClubId, identities?.heroClubId, identities?.hallOfFutClubId];
  if (!excluded.every(positive) || !positive(identities?.legendLeagueId)
      || !Array.isArray(chemistry.superChemRarityIds)
      || chemistry.superChemRarityIds.some(rarity => !integer(rarity, 0, 10000))) return null;
  const fields = [item => item.nationId, item => item.leagueId, item => resolveClub(item.teamId)];
  const groups = fields.map(() => new Map());
  const keys = new Map();
  for (const [candidateIndex, item] of candidates.entries()) {
    if (!positive(item?.definitionId) || !positive(item.nationId) || !positive(item.leagueId)
        || !positive(item.teamId) || !Array.isArray(item.positions) || !item.positions.length
        || item.positions.some(position => !integer(position, 0, 27))
        || ![0, 1].includes(item.rarity) || excluded.includes(item.teamId)
        || item.leagueId === identities.legendLeagueId || chemistry.superChemRarityIds.includes(item.rarity)) return null;
    const itemKeys = fields.map(read => read(item));
    keys.set(item, itemKeys);
    for (const [index, key] of itemKeys.entries()) {
      if (!positive(key)) return null;
      if (!groups[index].has(key)) groups[index].set(key, { definitions: new Set(), indices: [] });
      const group = groups[index].get(key);
      group.definitions.add(item.definitionId);
      group.indices.push(candidateIndex);
    }
  }
  const suffixCount = (indices, start) => {
    let low = 0; let high = indices.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (indices[middle] < start) low = middle + 1;
      else high = middle;
    }
    return indices.length - low;
  };
  const pointsFor = (itemKeys, countOf) => Math.min(3, itemKeys.reduce((sum, key, index) => {
    const count = countOf(index, key);
    return sum + parameters.get(index + 1).reduce((points, threshold) =>
      points + (count >= threshold.requirement ? threshold.points : 0), 0);
  }, 0));
  const caps = new Map(); const compatible = new Map();
  for (const item of candidates) {
    caps.set(item, pointsFor(keys.get(item), (index, key) => groups[index].get(key).definitions.size));
    compatible.set(item, slots.flatMap((slot, index) => item.positions.includes(formation.positions[slot]) ? [index] : []));
  }
  const suffix = Array.from({ length: candidates.length + 1 }, () => Array(slots.length).fill(0));
  for (let index = candidates.length - 1; index >= 0; index--) {
    suffix[index] = suffix[index + 1].slice();
    for (const slot of compatible.get(candidates[index])) suffix[index][slot] = Math.max(suffix[index][slot], caps.get(candidates[index]));
  }
  return (chosen, start, remaining) => {
    const singleton = Array(slots.length).fill(0);
    let selected = 0;
    const selectedGroups = fields.map(() => new Map());
    for (const item of chosen) keys.get(item)?.forEach((key, index) => {
      const counts = selectedGroups[index]; counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    for (const item of chosen) {
      const fits = compatible.get(item);
      const cap = pointsFor(keys.get(item), (index, key) => (selectedGroups[index].get(key) ?? 0)
        + Math.min(remaining, suffixCount(groups[index].get(key).indices, start)));
      if (fits?.length === 1) singleton[fits[0]] = Math.max(singleton[fits[0]], cap);
      else if (fits?.length > 1) selected += cap;
    }
    selected += singleton.reduce((sum, score) => sum + score, 0);
    const future = suffix[start].slice().sort((a, b) => b - a).slice(0, remaining)
      .reduce((sum, score) => sum + score, 0);
    // Even flexible cards cannot all score when their compatible positions
    // overlap. Each future card may add at most one new occupied slot; matching
    // only the already selected cards therefore remains an optimistic bound.
    const assigned = Array(slots.length).fill(-1);
    const augment = (itemIndex, visited) => {
      for (const slot of compatible.get(chosen[itemIndex]) ?? []) {
        if (visited[slot]) continue;
        visited[slot] = true;
        if (assigned[slot] === -1 || augment(assigned[slot], visited)) {
          assigned[slot] = itemIndex; return true;
        }
      }
      return false;
    };
    let matched = 0;
    for (let index = 0; index < chosen.length; index++) if (augment(index, Array(slots.length).fill(false))) matched++;
    return Math.min(selected + future, 3 * (matched + remaining));
  };
}

// Ordinary profiles only add nonnegative contributions from in-position players.
// Each player's chemistry with everyone in position is an upper bound. Combine
// those weights with an injective matching to actual positions: two players
// cannot both contribute through the same slot. Unmatched players can be legal
// off-position fillers and contribute zero. This remains an optimistic bound.
export function boundFc27PuzzleChemistry({ squad, formation, chemistry, rating } = {}) {
  if (!Array.isArray(squad) || !Array.isArray(formation?.positions)
      || squad.length !== 11 || formation.positions.length !== 11) return fail('FC27_PUZZLE_FORMATION_UNAVAILABLE');
  const actual = evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating });
  if (actual.status !== 'observed') return actual;
  const optimistic = { ...formation, positions: squad.map((item, index) => item === null
    ? formation.positions[index] : item.positions[0]) };
  const result = evaluateFc27PuzzleSquad({ squad, formation: optimistic, chemistry, rating });
  if (result.status !== 'observed') return result;
  const playable = squad.flatMap((item, index) => item === null ? [] : [index]);
  let scores = new Map([[0, 0]]);
  squad.forEach((item, index) => {
    if (item === null || result.slotChemistry[index] === 0) return;
    const compatible = playable.filter(slot => item.positions.includes(formation.positions[slot]));
    const next = new Map(scores); // Keep the option of an off-position filler.
    for (const [mask, score] of scores) for (const slot of compatible) {
      const bit = 1 << slot;
      if (mask & bit) continue;
      const value = score + result.slotChemistry[index];
      if (value > (next.get(mask | bit) ?? -1)) next.set(mask | bit, value);
    }
    scores = next;
  });
  return { status: 'observed', maxChemistry: Math.max(...scores.values()) };
}

export function evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating } = {}) {
  // null denotes a simple brick; custom bricks and managers are unsupported.
  if (!Array.isArray(squad) || squad.length !== 11 || Array.from(squad).some(item => item === undefined)) return fail('FC27_PUZZLE_SQUAD_SIZE_UNAVAILABLE');
  if (!Array.isArray(formation?.positions) || formation.positions.length !== 11
      || Array.from(formation.positions).some(position => !integer(position, 0, 27))) return fail('FC27_PUZZLE_FORMATION_UNAVAILABLE');
  if (typeof chemistry?.profilesEnabled !== 'boolean') return fail('FC27_PUZZLE_CHEMISTRY_FEATURE_UNVERIFIED');
  const resolveClub = createFc27ClubResolver(chemistry.links);
  const parameters = parametersOf(chemistry.parameters);
  const profiles = profilesOf(chemistry);
  const identities = chemistry.identities;
  const identityKeys = ['legendClubId', 'legendLeagueId', 'heroClubId', 'hallOfFutClubId'];
  if (!resolveClub || !parameters || chemistry.maxChemistryPerPlayer !== 3
      || !identityKeys.every(key => positive(identities?.[key]))
      || !Array.isArray(chemistry.superChemRarityIds) || chemistry.superChemRarityIds.length > 10001
      || Array.from(chemistry.superChemRarityIds).some(value => !integer(value, 0, 10000))) return fail('FC27_PUZZLE_CHEMISTRY_CONFIG_UNAVAILABLE');
  if (!profiles) return fail('FC27_PUZZLE_CHEMISTRY_FEATURE_UNVERIFIED');
  const players = squad.filter(item => item !== null);
  for (const item of players) {
    if (!item || item.type !== 'player' || !integer(item.rating, 1, 99)
        || !positive(item.nationId) || !positive(item.teamId) || !positive(item.leagueId)
        || !Array.isArray(item.positions) || !item.positions.length || item.positions.length > 28
        || Array.from(item.positions).some(value => !integer(value, 0, 27))
        || ![0, 1].includes(item.rarity) || item.special !== false || item.evolution !== false
        || item.cosmetic !== false || item.concept !== false || item.academyEnrolled !== false) return fail('FC27_PUZZLE_POSITION_OR_ITEM_FACTS_UNAVAILABLE');
    if ([identities.legendClubId, identities.heroClubId, identities.hallOfFutClubId].includes(item.teamId)
        || item.leagueId === identities.legendLeagueId || chemistry.superChemRarityIds.includes(item.rarity)) return fail('FC27_PUZZLE_SPECIAL_CHEMISTRY_UNSUPPORTED');
    if (chemistry.profilesEnabled) {
      // Safe snapshots exclude upgrades, so base rarity equals current rarity.
      const profile = profiles.find(value => value.applicableRarityIds.includes(item.rarity)) ?? profiles.find(value => value.id === 1);
      if (!ordinaryProfile(profile)) return fail('FC27_PUZZLE_CHEMISTRY_PROFILE_UNSUPPORTED');
    }
  }
  const fields = [{ id: 1, value: item => item.nationId }, { id: 2, value: item => item.leagueId },
    { id: 3, value: item => resolveClub(item.teamId) }];
  const counts = fields.map(() => new Map());
  const eligible = squad.map((item, slot) => item !== null && item.positions.includes(formation.positions[slot]));
  squad.forEach((item, slot) => {
    if (eligible[slot]) fields.forEach((field, index) => {
      const id = field.value(item); counts[index].set(id, (counts[index].get(id) ?? 0) + 1);
    });
  });
  const slotChemistry = squad.map((item, slot) => eligible[slot] ? Math.min(3, fields.reduce((total, field, index) => {
    const count = counts[index].get(field.value(item)) ?? 0;
    return total + parameters.get(field.id).reduce((points, threshold) => points + (count >= threshold.requirement ? threshold.points : 0), 0);
  }, 0)) : 0);
  const ratingResult = evaluateFc27PuzzleRating({ squad: players, rating });
  return { status: 'observed', reason: 'FC27_PUZZLE_FACTS_EVALUATED',
    chemistry: slotChemistry.reduce((sum, value) => sum + value, 0), slotChemistry,
    teamRating: ratingResult.teamRating, ratingMode: ratingResult.ratingMode ?? null };
}
