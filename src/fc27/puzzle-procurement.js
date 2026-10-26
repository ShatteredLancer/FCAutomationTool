import { iterateFc27PuzzleSquad, iterateFc27PuzzleCandidateRoutes,
  finishPuzzleSearch, finishPuzzleSearchCooperatively } from './puzzle-preview.js';
import { planFc27MarketQueryRoute } from './market-query-route.js';
import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { evaluateFc27PuzzleSquad } from './puzzle-evaluator.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements, createFc27ClubResolver } from './sbc-requirements.js';
import { puzzleMaterialRules } from './puzzle-material-policy.js';
import { MAX_PUZZLE_QUOTE_PRICE } from './puzzle-procurement-policy.js';
import { planPuzzleNationalityAffinity } from './puzzle-query-affinity.js';

const seeds = new WeakMap();
const stop = reason => ({ status: 'blocked', reason, executable: false, plans: [] });
const positive = value => Number.isSafeInteger(value) && value > 0;
const signature = input => JSON.stringify([input.context, input.challenge, input.policy, input.inventory, input.chemistry, input.clubLinks]);
const required = input => input.challenge.slotCount - input.challenge.brickIndices.length;
const poolOf = input => collectSafeTraditionalCandidates({ ...input, challenge: { ...input.challenge,
  mechanism: 'traditional', requirements: [{ kind: 'player-count', count: required(input) }] } });
export const puzzleOwnedValueCandidates = input => {
  const pool = poolOf(input);
  return pool.status === 'candidates' ? pool.candidates : [];
};
const validValue = value => Number.isSafeInteger(value) && value >= 150 && value <= MAX_PUZZLE_QUOTE_PRICE;
// Price refinement is detached planning only. Its budget is material value,
// never a purchase allowance, and the original feasible squad is an incumbent.
export async function refineFc27PuzzleOwnedValue(input, preview, materialPrices, options = {}) {
  const pool = poolOf(input);
  if (preview?.status !== 'preview' || pool.status !== 'candidates' || !(materialPrices instanceof Map)) return preview;
  const selected = preview.selected.map(ref => pool.candidates.find(item => item.id === ref.id));
  if (selected.some(item => !item || !validValue(materialPrices.get(item.definitionId)))) return { ...preview,
    materialValue: null, valueReason: 'FC27_PUZZLE_VALUE_INCOMPLETE' };
  const baselineValue = selected.reduce((sum, item) => sum + materialPrices.get(item.definitionId), 0);
  const candidates = pool.candidates.filter(item => validValue(materialPrices.get(item.definitionId)));
  const result = await finishPuzzleSearchCooperatively(iterateFc27PuzzleCandidateRoutes({ ...input,
    pool: { ...pool, candidates }, maxNodes: 20000, onProgress: options.onProgress,
    procurement: { budget: baselineValue, maxPurchases: required(input), priceAware: true,
      costOf: item => materialPrices.get(item.definitionId) } }), options);
  const better = result.status === 'preview' && result.estimatedCost < baselineValue;
  const { estimatedCost: ignoredEstimate, ...refined } = better ? result : {};
  void ignoredEstimate;
  return { ...preview, ...refined, materialValue: better ? result.estimatedCost : baselineValue,
    inventoryValue: better ? result.estimatedCost : baselineValue, initialMaterialValue: baselineValue,
    valueSearchComplete: result.searchComplete === true, valueCandidateCount: candidates.length,
    valueReason: 'FC27_PUZZLE_MATERIAL_VALUE_REFINED' };
}
const factsOf = (input, squad) => evaluateFc27PuzzleSquad({ squad, formation: input.challenge.formation,
  chemistry: input.chemistry, rating: input.chemistry?.rating });
const quality = rating => rating < 65 ? 1 : rating < 75 ? 2 : 3;
const validSeed = (input, seed) => seeds.get(seed) === signature(input);

// A search anchor is explicitly NOT an eligible squad or a fill plan. Relax
// only a detached chemistry minimum to locate a near-solution; preserve the
// actual Challenge and every material/quality rule for candidate verification.
export const findFc27PuzzleRepairSeed = (input, onProgress) => finishPuzzleSearch(iterateRepairSeed(input, onProgress));
export const findFc27PuzzleRepairSeedCooperatively = (input, onProgress, options) =>
  finishPuzzleSearchCooperatively(iterateRepairSeed(input, onProgress), options);
function* iterateRepairSeed(input, onProgress = null) {
  const parsed = parseFc27SbcRequirements(input?.challenge?.rawRequirements, required(input));
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const chemistry = parsed.rules.filter(rule => rule.kind.endsWith('-chemistry'));
  if (chemistry.length !== 1 || chemistry[0].kind !== 'min-chemistry') return stop('FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE');
  const original = chemistry[0].value;
  // Prefer a near-complete anchor as before, but share one 50k budget instead
  // of repeating four full 50k searches. A weaker anchor may require more than
  // the repair route's two replacements, so do not jump directly to minus four.
  const differences = Array.from({ length: Math.max(1, Math.min(4, original)) }, (_, index) => Math.min(index + 1, original));
  let nodes = 0;
  for (const [attempt, difference] of differences.entries()) {
    const challenge = structuredClone(input.challenge);
    const index = parsed.rules.indexOf(chemistry[0]);
    challenge.rawRequirements[index].pairs[0].values = [original - difference];
    const maxNodes = Math.floor((50000 - nodes) / (differences.length - attempt));
    const preview = yield* iterateFc27PuzzleSquad({ ...input, challenge, maxNodes,
      onProgress: typeof onProgress === 'function' ? value => onProgress({ ...value,
        nodes: nodes + value.nodes, maxNodes: 50000, repairAttempt: attempt + 1, repairAttempts: differences.length }) : null });
    nodes += preview.nodes ?? 0;
    if (preview.status !== 'preview') continue;
    const squad = Array(input.challenge.slotCount).fill(null);
    for (const ref of preview.selected) squad[ref.slot] = { ...structuredClone(input.inventory.items.find(item => item.id === ref.id)), slot: ref.slot };
    const facts = factsOf(input, squad);
    if (facts.status !== 'observed') return stop(facts.reason);
    const seed = { status: 'ready', executable: false, squad, teamFacts: facts, requiredChemistry: original };
    seeds.set(seed, signature(input));
    return seed;
  }
  return stop('FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE');
}

export function planFc27PuzzleRepairQueries(input, seed) {
  if (!validSeed(input, seed)) return stop('FC27_PURCHASE_REPAIR_INPUTS_CHANGED');
  const players = seed.squad.filter(Boolean);
  const resolveClub = createFc27ClubResolver(input.clubLinks);
  const count = read => {
    const counts = new Map();
    for (const item of players) { const key = read(item); counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  };
  const tier = count(item => quality(item.rating))[0]?.[0];
  const level = ({ 1: 'bronze', 2: 'silver', 3: 'gold' })[tier];
  const clubs = count(item => resolveClub?.(item.teamId));
  const leagues = count(item => item.leagueId);
  // A near-solution can be repaired by replacing a card in the minority
  // quality tier. Sampling only the largest tier (e.g. six gold vs five
  // silver) makes those legal repairs invisible. Reserve one of the same
  // three read-only pages for the weakest non-dominant tier and its league.
  const slotChemistry = seed.teamFacts?.slotChemistry ?? [];
  const otherTier = count(item => quality(item.rating)).filter(([candidate]) => candidate !== tier)
    .map(([candidate]) => ({ candidate, slots: seed.squad.flatMap((item, slot) => item && quality(item.rating) === candidate
      ? [{ item, slot, chemistry: slotChemistry[slot] ?? 3 }] : []) }))
    .sort((a, b) => Math.min(...a.slots.map(value => value.chemistry))
      - Math.min(...b.slots.map(value => value.chemistry)) || b.slots.length - a.slots.length)[0];
  const weakest = otherTier?.slots.sort((a, b) => a.chemistry - b.chemistry || a.slot - b.slot)[0];
  const secondary = weakest && positive(weakest.item.leagueId)
    && !input.policy.excludedLeagueIds.includes(weakest.item.leagueId)
    ? { start: 0, count: 20,
      level: ({ 1: 'bronze', 2: 'silver', 3: 'gold' })[otherTier.candidate], league: weakest.item.leagueId } : null;
  const queries = [];
  if (positive(clubs[0]?.[0]) && clubs[0][1] >= 2) queries.push({ start: 0, count: 20, level, team: clubs[0][0] });
  for (const [league] of leagues) {
    if (queries.length >= (secondary ? 2 : 3)) break;
    if (positive(league) && !input.policy.excludedLeagueIds.includes(league)) queries.push({ start: 0, count: 20, level, league });
  }
  if (secondary) queries.push(secondary);
  return { status: 'ready', executable: false, queries, complete: false };
}

// Public catalog cards are hypothetical replacements, never owned entities.
// Owned cards continue through the unchanged untradeable-only safety filter.
// A resulting suggestion still needs exact purchase/material approval and a
// new inventory plan; it cannot be passed to the save transaction.
export const suggestFc27PuzzlePurchases = (input, seed, entries, options) =>
  finishPuzzleSearch(iteratePurchases(input, seed, entries, options));
export const suggestFc27PuzzlePurchasesCooperatively = (input, seed, entries, options) =>
  finishPuzzleSearchCooperatively(iteratePurchases(input, seed, entries, options), options);
function* iteratePurchases(input, seed, entries, { maxChecks = 20000, onProgress = null, prices = null, costCeiling = null } = {}) {
  if (!validSeed(input, seed)) return stop('FC27_PURCHASE_REPAIR_INPUTS_CHANGED');
  if (costCeiling !== null && (!positive(costCeiling) || costCeiling > required(input) * MAX_PUZZLE_QUOTE_PRICE))
    return stop('FC27_MARKET_POLICY_INVALID');
  if (!Array.isArray(entries) || entries.length > 60 || !Number.isInteger(maxChecks) || maxChecks < 1 || maxChecks > 50000) return stop('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  const pool = poolOf(input);
  if (pool.status !== 'candidates') return stop(pool.reason);
  if (seed.squad.some(item => item && !pool.candidates.some(candidate => candidate.id === item.id
      && JSON.stringify({ ...candidate, slot: item.slot }) === JSON.stringify(item)))) return stop('FC27_PURCHASE_REPAIR_INPUTS_CHANGED');
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const material = puzzleMaterialRules(parsed.rules, required(input));
  const candidates = marketCandidates(input, entries);
  if (prices) candidates.sort((a, b) => prices.get(a.definitionId) - prices.get(b.definitionId));
  const slots = seed.squad.flatMap((item, index) => item ? [index] : []);
  const plans = []; const combinations = new Set(); let checks = 0; let lastProgressAt = 0;
  const cost = plan => prices ? plan.purchases.reduce((sum, item) => sum + prices.get(item.definitionId), 0) : 0;
  let bestCost = costCeiling ?? Infinity;
  const reportProgress = (force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && (checks % 256 !== 0 || now - lastProgressAt < 100)) return;
    lastProgressAt = now;
    try { onProgress({ phase: 'local-market-search', nodes: checks, maxNodes: maxChecks,
      checks, marketCandidates: candidates.length }); } catch { /* Presentation cannot affect planning. */ }
  };
  const assess = squad => {
    if (checks >= maxChecks) return;
    checks++; reportProgress();
    const players = squad.filter(Boolean);
    if (new Set(players.map(item => item.definitionId)).size !== players.length) return;
    if (material.length && matchFc27SbcRequirements({ requirements: material, squad: players }).status !== 'satisfied') return;
    const facts = factsOf(input, squad);
    if (facts.status !== 'observed') return;
    const validation = matchFc27SbcRequirements({ requirements: parsed.rules, squad: players,
      clubLinks: input.clubLinks, chemistry: facts.chemistry, teamRating: facts.teamRating });
    if (validation.status !== 'satisfied') return;
    const plan = projectSuggestion(squad, facts, parsed.rules.length);
    if (prices && costCeiling !== null && cost(plan) >= costCeiling) return;
    const key = plan.purchases.map(item => item.definitionId).sort((a, b) => a - b).join(',');
    if (combinations.has(key)) return;
    combinations.add(key);
    plans.push(plan);
    if (prices) bestCost = Math.min(bestCost, cost(plan));
  };
  for (const card of candidates) for (const removed of slots) for (const target of slots) {
    if (checks >= maxChecks) break;
    const squad = seed.squad.slice();
    squad[removed] = squad[target]; squad[target] = card;
    assess(squad);
    yield;
  }
  // A cheap pair can cost less than one replacement. Preserve the finite
  // sample/check budget and skip pairs that cannot improve added spend.
  // The unpriced inspection path retains its original fewest-card behavior.
  if (prices || !plans.length) for (let a = 0; a < Math.min(12, candidates.length); a++) for (let b = a + 1; b < Math.min(12, candidates.length); b++) {
    if (prices && prices.get(candidates[a].definitionId) + prices.get(candidates[b].definitionId) >= bestCost) continue;
    for (const first of slots) for (const second of slots) {
      if (first === second || checks >= maxChecks) continue;
      const squad = seed.squad.slice(); squad[first] = candidates[a]; squad[second] = candidates[b]; assess(squad);
      yield;
    }
  }
  reportProgress(true);
  plans.sort((a, b) => cost(a) - cost(b) || a.purchaseCount - b.purchaseCount || b.teamFacts.chemistry - a.teamFacts.chemistry
    || a.purchases.reduce((n, card) => n + card.rating, 0) - b.purchases.reduce((n, card) => n + card.rating, 0));
  return { status: plans.length ? 'suggested' : 'blocked', reason: plans.length ? 'FC27_PURCHASE_SUGGESTIONS_READY' : 'FC27_PURCHASE_REPAIR_NO_PLAN',
    executable: false, plans: plans.slice(0, 8), marketCandidates: candidates.length, checks, truncated: checks >= maxChecks || plans.length > 8,
    marketWideInfeasibilityProven: false };
}

export function marketCandidates(input, entries) {
  const owned = new Set(input.inventory.items.map(item => item.definitionId));
  const seen = new Set();
  return entries.filter(item => {
    if (!positive(item?.definitionId) || owned.has(item.definitionId) || seen.has(item.definitionId)) return false;
    seen.add(item.definitionId);
    return item.special === false && item.evolution === false && item.cosmetic === false && [0, 1].includes(item.rarity)
      && Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= input.policy.maxRating
      && (item.rating < 75 || item.rating >= input.policy.goldRange[0] && item.rating <= input.policy.goldRange[1])
      && [item.nationId, item.leagueId, item.teamId].every(positive) && !input.policy.excludedLeagueIds.includes(item.leagueId)
      && Array.isArray(item.positions) && item.positions.length > 0 && item.positions.every(position => Number.isInteger(position) && position >= 0 && position <= 27)
      && Array.isArray(item.groups) && item.groups.every(group => Number.isInteger(group) && group >= 0);
  }).map(item => ({ definitionId: item.definitionId, rating: item.rating, rarity: item.rarity, nationId: item.nationId,
    ...(typeof item.displayName === 'string' && item.displayName.length <= 201 && !/[\u0000-\u001f]/.test(item.displayName)
      ? { displayName: item.displayName } : {}),
    leagueId: item.leagueId, teamId: item.teamId, positions: [...item.positions], groups: [...item.groups],
    special: false, evolution: false, cosmetic: false, type: 'player', concept: false, academyEnrolled: false,
    catalogRef: `fc27:${item.definitionId}` }));
}

function projectSuggestion(squad, facts, requirementCount) {
    const purchases = squad.flatMap((item, slot) => item?.catalogRef ? [{ ...item, slot, quantity: 1 }] : []);
    return { executable: false, liveExecutionEnabled: false, purchaseCount: purchases.length,
      purchases, selectedOwned: squad.flatMap((item, slot) => item && !item.catalogRef ? [{ id: item.id,
        definitionId: item.definitionId, pile: item.pile, rating: item.rating, slot }] : []),
      teamFacts: { chemistry: facts.chemistry, teamRating: facts.teamRating },
      requirementCount, requiresPurchasedMaterialApproval: true, marketAvailabilityVerified: false };
}

// Missing quality/count materials cannot produce an eleven-player repair seed.
// Sample the actually missing tier first, preserving the same three-page bound.
export function planFc27PuzzleShortageQueries(input, entries = [], { usedQueries = [] } = {}) {
  const pool = poolOf(input);
  if (pool.status !== 'candidates') return stop(pool.reason);
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const material = puzzleMaterialRules(parsed.rules, required(input));
  const missing = material.filter(rule => rule.count > new Set(pool.candidates
    .filter(item => quality(item.rating) === rule.qualities[0]).map(item => item.definitionId)).size);
  const generic = planFc27MarketQueryRoute(input);
  if (generic.status !== 'ready') return generic;
  const levelOf = tier => ({ 1: 'bronze', 2: 'silver', 3: 'gold' })[tier];
  // A sufficient headcount does not remove the material composition contract.
  // Keep every page within a required tier, including affinity/fallback pages.
  const tiers = material.length ? material.filter(rule => rule.count > 0)
    .sort((a, b) => Number(missing.includes(b)) - Number(missing.includes(a)) || b.count - a.count)
    .map(rule => levelOf(rule.qualities[0])) : [...new Set(generic.queries.map(query => query.level))];
  const queries = [];
  const add = query => {
    if (queries.length < 3 && !queries.some(existing => JSON.stringify(existing) === JSON.stringify(query))) queries.push(query);
  };
  const cappedClubs = parsed.rules.some(rule => rule.kind === 'distinct-clubs' && rule.mode !== 'min' && rule.value < required(input));
  const chemistryNeeded = parsed.rules.some(rule => rule.kind === 'min-chemistry' && rule.value > 0);
  const nations = parsed.rules.filter(rule => rule.kind === 'from-nations' && rule.mode === 'min' && rule.count > 0)
    .flatMap(rule => rule.ids);
  const clubs = parsed.rules.filter(rule => rule.kind === 'from-clubs' && rule.mode === 'min' && rule.count > 0);
  if (!cappedClubs && chemistryNeeded && tiers.length > 1 && clubs.length) {
    const resolveClub = createFc27ClubResolver(input.clubLinks);
    if (!resolveClub) return stop('FC27_PUZZLE_CLUB_LINKS_UNAVAILABLE');
    const candidates = [...pool.candidates, ...marketCandidates(input, entries)]
      .filter(item => tiers.includes(levelOf(quality(item.rating))));
    const filler = material.filter(rule => rule.count > 0).sort((a, b) => b.count - a.count)[0];
    const level = levelOf(filler.qualities[0]);
    const anchors = [];
    for (const rule of clubs) {
      const ids = new Set(rule.ids.map(resolveClub));
      const matching = candidates.filter(item => ids.has(resolveClub(item.teamId)));
      anchors.push(...matching);
      if (new Set(matching.map(item => item.definitionId)).size < rule.count) {
        const identityLevel = generic.queries.find(query => rule.ids.includes(query.team))?.level ?? tiers[0];
        // Leave a page for the dominant filler tier even when several club
        // alternatives could otherwise consume all three identity queries.
        if (queries.length < 2) add({ start: 0, count: 20, level: identityLevel, team: rule.ids[0] });
      }
    }
    const counts = new Map();
    for (const item of anchors.length ? anchors : candidates.filter(item => levelOf(quality(item.rating)) === level)) {
      counts.set(item.nationId, (counts.get(item.nationId) ?? 0) + 1);
    }
    const nation = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    if (positive(nation)) add({ start: 0, count: 20, level, nation });
    const leagues = new Map();
    for (const item of candidates.filter(item => levelOf(quality(item.rating)) === level && item.nationId === nation)) {
      leagues.set(item.leagueId, (leagues.get(item.leagueId) ?? 0) + 1);
    }
    for (const [league] of [...leagues].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      add({ start: 0, count: 20, level, league });
    }
    add({ start: 0, count: 20, level });
    return { status: 'ready', executable: false, queries, complete: false };
  }
  if (!cappedClubs && chemistryNeeded && tiers.length > 1 && nations.length) {
    // All three old pages could be silver although eight bronze fillers were
    // mandatory. Cover the required tiers around one existing national link,
    // then widen its league. This is a bounded sample, never proof of no plan.
    const ranked = [...new Set(nations)].map(nation => ({ nation,
      items: pool.candidates.filter(item => item.nationId === nation && tiers.includes(levelOf(quality(item.rating)))) }))
      .sort((a, b) => b.items.filter(item => levelOf(quality(item.rating)) === tiers[0]).length
        - a.items.filter(item => levelOf(quality(item.rating)) === tiers[0]).length || b.items.length - a.items.length || a.nation - b.nation);
    const anchor = ranked[0];
    for (const level of tiers) add({ start: 0, count: 20, level, nation: anchor.nation });
    const leagues = new Map();
    for (const item of anchor.items) leagues.set(item.leagueId, (leagues.get(item.leagueId) ?? 0) + 1);
    const league = [...leagues].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    add({ start: 0, count: 20, level: tiers[0], ...(positive(league) ? { league } : {}) });
    return { status: 'ready', executable: false, queries, complete: false };
  }
  if (cappedClubs) {
    const resolveClub = createFc27ClubResolver(input.clubLinks);
    if (!resolveClub) return stop('FC27_PUZZLE_CLUB_LINKS_UNAVAILABLE');
    const candidates = [...pool.candidates, ...marketCandidates(input, entries)];
    if (clubs.length && tiers.length > 1) {
      const unused = query => !usedQueries.some(used => JSON.stringify(used) === JSON.stringify(query));
      // OR clubs share one requirement. Reserve one identity lane at a time;
      // after a successful anchor, spend the remaining pages on compatible
      // quality tiers of the same dense clubs, not the alternative OR club.
      for (const rule of clubs) {
        const ids = new Set(rule.ids.map(resolveClub));
        const matching = new Set(candidates.filter(item => ids.has(resolveClub(item.teamId))
          && tiers.includes(levelOf(quality(item.rating)))).map(item => item.definitionId));
        if (matching.size >= rule.count) continue;
        const lane = generic.queries.find(query => rule.ids.includes(query.team));
        const level = lane?.level ?? tiers[0];
        const query = rule.ids.map(team => ({ start: 0, count: 20, level, team })).find(unused);
        if (query) add(query);
      }
      const fillers = material.filter(rule => rule.count > 0).sort((a, b) => b.count - a.count);
      const groups = new Map();
      for (const item of candidates.filter(item => tiers.includes(levelOf(quality(item.rating))))) {
        const key = resolveClub(item.teamId);
        if (!positive(key)) continue;
        if (!groups.has(key)) groups.set(key, { team: item.teamId, ids: new Map() });
        groups.get(key).ids.set(item.definitionId, quality(item.rating));
      }
      const coverage = group => fillers.map(rule => Math.min(rule.count,
        [...group.ids.values()].filter(tier => tier === rule.qualities[0]).length));
      const ranked = [...groups.values()].map(group => ({ ...group, coverage: coverage(group) }))
        .sort((a, b) => b.coverage.reduce((n, count) => n + count, 0) - a.coverage.reduce((n, count) => n + count, 0)
          || b.coverage[0] - a.coverage[0] || a.team - b.team);
      if (!ranked.some(group => group.coverage[0] > 0)) {
        const query = { start: 0, count: 20, level: levelOf(fillers[0].qualities[0]) };
        if (unused(query)) add(query);
      }
      for (const group of ranked) for (const rule of fillers) {
        const query = { start: 0, count: 20, level: levelOf(rule.qualities[0]), team: group.team };
        if (unused(query)) add(query);
      }
      return { status: 'ready', executable: false, queries, complete: false };
    }
    const lanes = tiers.map(level => {
      const groups = new Map();
      for (const item of candidates.filter(item => levelOf(quality(item.rating)) === level)) {
        const team = item.teamId; const group = resolveClub(team);
        if (!positive(team) || !positive(group)) continue;
        if (!groups.has(group)) groups.set(group, { team, ids: new Set() });
        groups.get(group).ids.add(item.definitionId);
      }
      return [...groups.values()].sort((a, b) => b.ids.size - a.ids.size || a.team - b.team)
        .map(({ team }) => ({ start: 0, count: 20, level, team }));
    });
    // Preserve explicit identity lanes, then grow dense clubs instead of
    // collecting unrelated cards that cannot fit under the club-count cap.
    for (const query of generic.queries.filter(query => query.team || query.nation || query.league)) {
      if (tiers.includes(query.level)) add(query);
    }
    lanes.forEach((lane, index) => add(lane[0] ?? { start: 0, count: 20, level: tiers[index] }));
    for (let index = 1; index < 3; index++) for (const lane of lanes) if (lane[index]) add(lane[index]);
  }
  if (!missing.length) {
    for (const query of generic.queries) if (tiers.includes(query.level)) add(query);
  } else {
    for (const rule of missing) add({ start: 0, count: 20, level: levelOf(rule.qualities[0]) });
    // Headcount is not compatibility: existing gold/silver may violate other
    // Challenge rules. Cover every required tier before affinity pages consume
    // the remaining budget, while keeping the missing tier first.
    for (const level of tiers) add({ start: 0, count: 20, level });
  }
  if (!queries.length) for (const level of tiers) add({ start: 0, count: 20, level });
  if (!cappedClubs && queries.length < 3 && pool.candidates.length && chemistryNeeded && tiers.length > 1) {
    const affinity = planPuzzleNationalityAffinity({ candidates: [...pool.candidates, ...marketCandidates(input, entries)],
      material, formation: input.challenge.formation, brickIndices: input.challenge.brickIndices, usedQueries });
    if (affinity) add(affinity);
  }
  const baseQueries = queries.slice();
  // With no eligible owned anchors, two generic quality pages used to end
  // the route early. Spend the existing third page on a complementary tier
  // linked to safe public candidates; never promote protected owned cards.
  if (!pool.candidates.length && chemistryNeeded && tiers.length > 1) {
    const publicItems = marketCandidates(input, entries);
    const groups = new Map();
    for (const item of publicItems) {
      const level = levelOf(quality(item.rating));
      if (!tiers.includes(level)) continue;
      if (!groups.has(item.leagueId)) groups.set(item.leagueId, new Map());
      const counts = groups.get(item.leagueId);
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    const lanes = [...groups].flatMap(([league, counts]) => tiers.map(level => ({ league, level,
      support: [...counts].filter(([tier]) => tier !== level).reduce((n, [, count]) => n + count, 0),
      present: counts.get(level) ?? 0 })));
    lanes.sort((a, b) => b.support - a.support || a.present - b.present
      || a.league - b.league || tiers.indexOf(a.level) - tiers.indexOf(b.level));
    for (const lane of lanes) {
      if (!lane.support) continue;
      const query = { start: 0, count: 20, level: lane.level, league: lane.league };
      if (!usedQueries.some(used => JSON.stringify(used) === JSON.stringify(query))) add(query);
      if (queries.length === 3) break;
    }
  }
  const leagues = new Map();
  for (const item of pool.candidates) leagues.set(item.leagueId, (leagues.get(item.leagueId) ?? 0) + 1);
  for (const [league] of [...leagues].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    for (const query of baseQueries.filter(query => !query.team && !query.league && !query.nation)) add({ ...query, league });
    if (queries.length === 3) break;
  }
  return { status: 'ready', executable: false, queries, complete: false };
}

export const suggestFc27PuzzleJointPurchases = (input, entries, options) =>
  finishPuzzleSearch(iterateJointPurchases(input, entries, options));
export const suggestFc27PuzzleJointPurchasesCooperatively = (input, entries, options) =>
  finishPuzzleSearchCooperatively(iterateJointPurchases(input, entries, options), options);
function* iterateJointPurchases(input, entries, { maxNodes = 50000, onProgress = null, prices = null, priceSource = null, materialPrices = null,
  costCeiling = null } = {}) {
  if (!Array.isArray(entries) || entries.length > 60) return stop('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  if (materialPrices !== null && (!(materialPrices instanceof Map) || !(prices instanceof Map))) return stop('FC27_MARKET_POLICY_INVALID');
  if (costCeiling !== null && (!positive(costCeiling) || costCeiling > required(input) * MAX_PUZZLE_QUOTE_PRICE))
    return stop('FC27_MARKET_POLICY_INVALID');
  const pool = poolOf(input);
  if (pool.status !== 'candidates') return stop(pool.reason);
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const market = marketCandidates(input, entries);
  // A shortage route with no eligible public versions cannot produce a
  // purchase plan. Avoid running the bounded squad solver over the owned
  // inventory in this case; the caller will report the empty candidate pool
  // and may continue with its normal bounded catalog route.
  if (!market.length) return { ...stop('FC27_PURCHASE_REPAIR_NO_PLAN'), marketCandidates: 0, nodes: 0,
    truncated: false, marketWideInfeasibilityProven: false };
  // Public quotes, when supplied, price the full eligible candidate pool.
  // The legacy inspection path keeps unit weights, never fabricated coins.
  const result = yield* iterateFc27PuzzleCandidateRoutes({ ...input, maxNodes,
    pool: { ...pool, candidates: [...pool.candidates.filter(item => !materialPrices || validValue(materialPrices.get(item.definitionId))), ...market] },
    procurement: { budget: prices ? Math.min(required(input) * MAX_PUZZLE_QUOTE_PRICE,
      costCeiling === null ? Infinity : costCeiling - 1) : required(input), maxPurchases: required(input),
      priceAware: prices instanceof Map,
      costOf: item => item.catalogRef ? prices ? prices.get(item.definitionId) : 1
        : materialPrices ? materialPrices.get(item.definitionId) : 0 }, onProgress });
  if (result.status !== 'preview') return { ...stop(result.reason), marketCandidates: market.length,
    nodes: result.nodes ?? 0, truncated: result.reason === 'FC27_PUZZLE_SEARCH_LIMIT',
    localReason: result.reason, searchComplete: false, optimalWithinPool: false,
    safeCandidates: result.safeCandidates ?? null, search: result.search ?? null,
    priceSource };
  const squad = Array(input.challenge.slotCount).fill(null);
  for (const ref of result.selected) squad[ref.slot] = ref.catalogRef
    ? market.find(item => item.catalogRef === ref.catalogRef) : pool.candidates.find(item => item.id === ref.id);
  const addedCost = prices ? squad.filter(item => item?.catalogRef).reduce((sum, item) => sum + prices.get(item.definitionId), 0)
    : result.estimatedCost;
  const values = materialPrices ? { materialValue: result.estimatedCost, inventoryValue: result.estimatedCost - addedCost } : {};
  return { status: 'suggested', reason: 'FC27_PURCHASE_SUGGESTIONS_READY', executable: false,
    plans: [{ ...projectSuggestion(squad, result.teamFacts, parsed.rules.length),
      estimatedCost: addedCost, ...values }], marketCandidates: market.length, nodes: result.nodes,
    truncated: result.searchComplete === false, searchComplete: result.searchComplete === true,
    optimalWithinPool: result.optimalWithinPool === true, estimatedCost: addedCost, ...values,
    safeCandidates: result.safeCandidates ?? null, search: result.search ?? null,
    priceSource, marketWideInfeasibilityProven: false };
}
