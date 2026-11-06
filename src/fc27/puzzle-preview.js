import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { puzzleMaterialRules, puzzleMaterialRuleVectors, puzzleHasQualityAlternative } from './puzzle-material-policy.js';
import { createFc27ClubResolver, matchFc27SbcItemRule, matchFc27SbcRequirements, parseFc27SbcRequirements } from './sbc-requirements.js';
import { createFc27PuzzlePartialChemistryBound, evaluateFc27PuzzleRating } from './puzzle-evaluator.js';
import { pricedPuzzleGroupStarts } from './puzzle-price-starts.js';
import { comparePuzzlePlans } from './puzzle-plan-ranking.js';

const PUZZLE_SEARCH_STAGES = Object.freeze([50000, 100000, 200000]);
const searchBudgets = new WeakSet();

// One planning run owns this ledger. Traversals keep their own DFS stacks and
// fixed lane ceilings; only actual work advances the cumulative stage.
export function createFc27PuzzleSearchBudget() {
  let nodes = 0, stage = 0, feasible = false;
  const snapshot = () => ({ budgetNodes: nodes, maxNodes: PUZZLE_SEARCH_STAGES[stage],
    budgetStage: stage + 1, budgetStages: PUZZLE_SEARCH_STAGES.length, nodeCap: PUZZLE_SEARCH_STAGES.at(-1) });
  const budget = Object.freeze({
    cap: PUZZLE_SEARCH_STAGES.at(-1),
    snapshot,
    remaining: () => Math.max(0, (feasible ? PUZZLE_SEARCH_STAGES[stage] : PUZZLE_SEARCH_STAGES.at(-1)) - nodes),
    markFeasible: () => { feasible = true; },
    takeNode: () => {
      if (nodes === PUZZLE_SEARCH_STAGES[stage]) {
        if (feasible || stage === PUZZLE_SEARCH_STAGES.length - 1) return false;
        stage++;
      }
      nodes++;
      return true;
    },
    // Fixed refinement work shares the hard cap, never an adaptive allowance.
    // Callers first clamp their unchanged fixed limit to remaining capacity.
    accountFixed: count => {
      if (!Number.isSafeInteger(count) || count < 0 || nodes + count > (feasible ? PUZZLE_SEARCH_STAGES[stage] : PUZZLE_SEARCH_STAGES.at(-1)))
        throw new Error('FC27_PUZZLE_BUDGET_INVALID');
      nodes += count;
      while (stage < PUZZLE_SEARCH_STAGES.length - 1 && nodes > PUZZLE_SEARCH_STAGES[stage]) stage++;
    },
  });
  searchBudgets.add(budget);
  return budget;
}

const isFc27PuzzleSearchBudget = budget => searchBudgets.has(budget);
export { isFc27PuzzleSearchBudget };

const DEFAULT_MAX_NODES = 50000;
// EA amount domain only; keep the detached solver independent of procurement
// policy/transport dependencies. Priced-joint boundary tests lock agreement.
const MAX_PUZZLE_QUOTE_PRICE = 15000000;
// A lower bound for remaining purchase spend. Each requirement is considered
// independently, then the strongest bound is selected; overlapping rules are
// never added together, so this cannot overestimate a feasible completion.
export const createFc27PuzzleCostBound = (costs, counted, requiredCount, definitionIds = costs.map((_cost, index) => index)) => {
  const suffix = matches => {
    const rows = Array(costs.length + 1); rows[costs.length] = [0];
    const byDefinition = new Map();
    for (let i = costs.length - 1; i >= 0; i--) {
      if (!matches || matches[i]) {
        const definitionId = definitionIds[i] ?? i;
        const previous = byDefinition.get(definitionId);
        if (previous === undefined || costs[i] < previous) byDefinition.set(definitionId, costs[i]);
      }
      const cheapest = [...byDefinition.values()].sort((a, b) => a - b).slice(0, requiredCount);
      const sums = [0];
      for (const cost of cheapest) sums.push(sums.at(-1) + cost);
      rows[i] = sums;
    }
    return rows;
  };
  const all = suffix(null);
  const rules = counted.map(entry => ({ entry, yes: suffix(entry.matches), no: suffix(entry.matches.map(value => !value)) }));
  return (start, remaining) => {
    let bound = all[start][remaining] ?? Infinity;
    for (const { entry, yes, no } of rules) {
      const { rule, used } = entry, mode = rule.mode ?? 'min';
      const deficit = rule.count - used;
      const minimum = mode === 'max' ? 0 : Math.max(0, deficit);
      const maximum = mode === 'min' ? remaining : Math.min(remaining, deficit);
      let floor = Infinity;
      for (let count = minimum; count <= maximum; count++) {
        floor = Math.min(floor, (yes[start][count] ?? Infinity) + (no[start][remaining - count] ?? Infinity));
      }
      bound = Math.max(bound, floor);
    }
    return bound;
  };
};
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const objectiveValueOf = (plan, objective = 'additional-coins') => objective === 'material-value'
  ? Number.isFinite(plan?.materialValue) ? plan.materialValue : Infinity
  : Number.isFinite(plan?.estimatedCost) ? plan.estimatedCost : Infinity;
const qualityOf = rating => rating < 65 ? 'bronze' : rating < 75 ? 'silver' : 'gold';
const selectedQualityCounts = items => items.reduce((counts, item) => {
  const level = Number.isSafeInteger(item?.rating) && item.rating >= 1 && item.rating <= 99
    ? qualityOf(item.rating) : 'unknown';
  counts[level] = (counts[level] ?? 0) + 1;
  return counts;
}, { bronze: 0, silver: 0, gold: 0, unknown: 0 });
const blocked = (reason, extra = {}) => ({ status: 'blocked', reason, liveExecutionEnabled: false, selected: [], ...extra });
export function finishPuzzleSearch(iterator) {
  let step;
  do { step = iterator.next(); } while (!step.done);
  return step.value;
}

function yieldPuzzleTask() {
  // Ordinary browser message tasks avoid hidden-tab timer clamping without
  // using microtask/native-yield priority that can starve UI timers. Node and
  // hosts without channels retain the original timer path.
  if (globalThis.document && typeof globalThis.MessageChannel === 'function') return new Promise((resolve, reject) => {
    const channel = new globalThis.MessageChannel();
    const close = () => { channel.port1.close(); channel.port2.close(); };
    channel.port1.onmessage = () => { close(); resolve(); };
    try { channel.port2.postMessage(null); } catch (error) { close(); reject(error); }
  });
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Same iterator/evaluation order and native cancellation checks, only a
// different browser task primitive. No network or transaction pacing here.
export async function finishPuzzleSearchCooperatively(iterator, { assertCurrent = () => {},
  yieldControl = yieldPuzzleTask, sliceMs = 8 } = {}) {
  let deadline = 0;
  try {
    for (;;) {
      if (Date.now() >= deadline) { assertCurrent(); await yieldControl(); assertCurrent(); deadline = Date.now() + sliceMs; }
      const step = iterator.next();
      if (step.done) { assertCurrent(); return step.value; }
    }
  } finally { iterator.return?.(); }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function ruleNeedsTeamFacts(rules) {
  return rules.some(rule => ['min-team-rating', 'max-team-rating', 'exact-team-rating',
    'min-chemistry', 'max-chemistry', 'exact-chemistry'].includes(rule.kind));
}

function* evaluatePlacement({ chosen, slots, formation, evaluateSquad, takeNode, validate, searchPositions }) {
  let found = null; let unavailable = null; let exhausted = false;
  const evaluate = function* (ordered) {
    if (!takeNode('evaluations')) { exhausted = true; return; }
    yield;
    let facts;
    try {
      const brickIndices = Array.from({ length: formation?.slotCount ?? 0 }, (_, index) => index)
        .filter(index => !slots.includes(index));
      const detached = Array.from({ length: formation?.slotCount ?? ordered.length }, () => null);
      ordered.forEach((item, index) => { detached[slots[index]] = { ...item, slot: slots[index] }; });
      // The evaluator follows EA's complete eleven-slot contract. Bricks are
      // represented explicitly as null; they never become candidate items.
      if (brickIndices.some(index => detached[index] !== null)) {
        unavailable = 'FC27_PUZZLE_SLOT_LAYOUT_UNAVAILABLE'; return;
      }
      facts = evaluateSquad(freeze(globalThis.structuredClone(detached)));
    } catch { unavailable = 'FC27_PUZZLE_EVALUATOR_FAILED'; return; }
    if (!facts || facts.status !== undefined && facts.status !== 'observed') {
      unavailable = /^FC27_[A-Z_]{1,80}$/.test(facts?.reason) ? facts.reason : 'FC27_PUZZLE_EVALUATOR_FAILED'; return;
    }
    const validation = validate(facts);
    if (validation.status === 'blocked') unavailable = 'FC27_REQUIREMENT_VALUE_UNAVAILABLE';
    if (validation.status === 'satisfied') found = { items: ordered.slice(), validation,
      facts: { chemistry: facts.chemistry ?? null, teamRating: facts.teamRating ?? null } };
  };
  const fits = (item, index) => Array.isArray(item.positions) && item.positions.includes(formation?.positions?.[slots[index]]);
  // Try a maximum in-position matching before enumerating permutations. An
  // augmenting path moves flexible players aside for a constrained position;
  // unmatched players remain legal off-position fillers. The evaluator still
  // validates the actual final arrangement, including its chemistry.
  const preferred = chosen.slice();
  if (searchPositions) {
    const assigned = Array(slots.length).fill(-1);
    const augment = function* (itemIndex, visited) {
      if (!takeNode('placementNodes')) { exhausted = true; return false; }
      yield;
      for (let slot = 0; slot < slots.length; slot++) {
        if (visited.has(slot) || !fits(chosen[itemIndex], slot)) continue;
        visited.add(slot);
        if (assigned[slot] === -1 || (yield* augment(assigned[slot], visited))) {
          assigned[slot] = itemIndex; return true;
        }
        if (exhausted) return false;
      }
      return false;
    };
    for (let index = 0; index < chosen.length && !exhausted; index++) yield* augment(index, new Set());
    if (exhausted) return { found, unavailable, exhausted };
    const used = new Set(assigned.filter(index => index !== -1));
    const fillers = chosen.filter((_item, index) => !used.has(index));
    assigned.forEach((itemIndex, slot) => { preferred[slot] = itemIndex === -1 ? fillers.shift() : chosen[itemIndex]; });
  }
  yield* evaluate(preferred);
  if (found || unavailable || exhausted || !searchPositions) return { found, unavailable, exhausted };
  // Constrained positions first, preferred positions before off-position fillers.
  // Off-position is legal in SBCs and must never be pruned solely for being off.
  const order = slots.map((_slot, index) => index).sort((a, b) =>
    chosen.filter(item => fits(item, a)).length - chosen.filter(item => fits(item, b)).length || a - b);
  const arranged = Array(chosen.length); const used = new Set();
  const visit = function* (depth) {
    if (found || unavailable || exhausted) return;
    if (!takeNode('placementNodes')) { exhausted = true; return; }
    yield;
    if (depth === order.length) {
      if (!arranged.every((item, index) => item === preferred[index])) yield* evaluate(arranged);
      return;
    }
    const slotIndex = order[depth];
    const choices = chosen.map((_item, index) => index).filter(index => !used.has(index))
      .sort((a, b) => Number(fits(chosen[b], slotIndex)) - Number(fits(chosen[a], slotIndex)) || a - b);
    for (const index of choices) {
      if (found || unavailable || exhausted) break;
      used.add(index); arranged[slotIndex] = chosen[index]; yield* visit(depth + 1); used.delete(index);
    }
  };
  yield* visit(0);
  return { found, unavailable, exhausted };
}

const itemKinds = new Set(['all-quality', 'min-quality', 'max-quality', 'quality-count', 'player-min-overall',
  'player-exact-overall', 'player-max-overall', 'from-nations', 'from-leagues', 'from-clubs', 'rare', 'rarity-group']);
const relationField = rule => rule.kind.endsWith('nation') || rule.kind.endsWith('nations') ? 'nationId'
  : rule.kind.endsWith('league') || rule.kind.endsWith('leagues') ? 'leagueId' : 'teamId';
const relationValue = (rule, item, resolveClub) => relationField(rule) === 'teamId'
  ? resolveClub?.(item.teamId ?? item.clubId) ?? null : item[relationField(rule)];

// Sparse suffix index: total storage is linear in candidates per rule, not
// groups multiplied by candidates. Physical copies overestimate capacity;
// uniqueness and cross-rule conflicts can only reduce it, so pruning is safe.
function groupSuffixIndex(rule, candidates, resolveClub) {
  const groups = new Map();
  candidates.forEach((item, index) => {
    const value = relationValue(rule, item, resolveClub);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(index);
  });
  return groups;
}

function suffixSize(indices, start) {
  let low = 0; let high = indices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (indices[middle] < start) low = middle + 1;
    else high = middle;
  }
  return indices.length - low;
}

function remainingGroupCapacity(groups, used, start, freeGroups) {
  let existing = 0;
  const additional = [];
  for (const [key, indices] of groups) {
    const count = suffixSize(indices, start);
    if (used.has(key)) existing += count;
    else if (count) additional.push(count);
  }
  additional.sort((a, b) => b - a);
  return existing + additional.slice(0, freeGroups).reduce((sum, count) => sum + count, 0);
}

const hintGroup = (hint, item, resolveClub) => hint.strategy === 'club' ? resolveClub?.(item.teamId ?? item.clubId)
  : item[hint.strategy === 'nation' ? 'nationId' : 'leagueId'];

export function isFc27PuzzleSearchHintValid(hint, candidates, clubLinks) {
  if (hint === null) return true;
  if (!hint || Object.keys(hint).sort().join(',') !== 'groupId,strategy'
      || !['balanced', 'low-rating', 'nation', 'league', 'club'].includes(hint.strategy)
      || !integer(hint.groupId, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (['balanced', 'low-rating'].includes(hint.strategy)) return hint.groupId === 0;
  const resolveClub = createFc27ClubResolver(clubLinks);
  return hint.groupId > 0 && candidates.some(item => hintGroup(hint, item, resolveClub) === hint.groupId);
}

function filterUnaryCandidates(candidates, itemRules, required, groupMatcher, resolveClub) {
  // Apply only necessary per-card predicates. Unknown facts remain available
  // to the existing fail-closed checks; this is not a feasibility proof.
  return candidates.filter(item => itemRules.every(rule => {
    if (rule.count === required && rule.mode !== 'max') return matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== false;
    if (rule.count === 0 && ['max', 'exact'].includes(rule.mode)) return matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== true;
    return true;
  }));
}


// A bounded, deterministic first-feasible search. Not a minimum-cost proof. Team
// evaluators operate on detached immutable snapshots; this module cannot access EA.

export const previewFc27PuzzleSquad = input => finishPuzzleSearch(iterateFc27PuzzleSquad(input));
export const previewFc27PuzzleSquadCooperatively = (input, options) =>
  finishPuzzleSearchCooperatively(iterateFc27PuzzleSquad(input), options);

export function* iterateFc27PuzzleSquad({ context, challenge, inventory, policy, evaluateSquad, boundSquad, groupMatcher, clubLinks, chemistry,
  maxNodes = DEFAULT_MAX_NODES, searchHint = null, onProgress = null, searchBudget = null } = {}) {
  if (!integer(maxNodes, 1, 250000) || searchBudget !== null && !isFc27PuzzleSearchBudget(searchBudget)) return blocked('FC27_PUZZLE_BUDGET_INVALID');
  if (challenge?.mechanism !== 'traditional-puzzle') return blocked('CHALLENGE_UNVERIFIED');
  const required = challenge.slotCount - (challenge.brickIndices?.length ?? NaN);
  // Reuse the exact existing safety gates. This cardinality-only view is never
  // returned to the Live transaction; all Puzzle rules are checked separately.
  const pool = collectSafeTraditionalCandidates({ context, inventory, policy, challenge: {
    ...challenge, mechanism: 'traditional', requirements: [{ kind: 'player-count', count: required }],
  } });
  if (pool.status !== 'candidates') return pool;
  const options = { challenge, policy, evaluateSquad, boundSquad, groupMatcher, clubLinks, chemistry, pool };
  return yield* iterateFc27PuzzleCandidateRoutes({ ...options, maxNodes, searchHint, onProgress, searchBudget });
}

export function* iterateFc27PuzzleCandidateRoutes(input) {
  const maxNodes = input.maxNodes ?? DEFAULT_MAX_NODES;
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, input.pool.required);
  // Quality-count vectors are needed for the price-aware route. Keep the
  // inventory-only preview's established route unless the legacy explicit
  // minimum-quality rule is present, preserving its chemistry-bound budget.
  const qualityCount = parsed.rules.some(rule => rule.kind === 'quality-count');
  const preferred = parsed.status === 'observed'
    && (input.procurement?.priceAware || !qualityCount
      || parsed.rules.some(rule => rule.kind === 'min-quality'))
    ? puzzleMaterialRules(parsed.rules, input.pool.required) : [];
  const vectors = parsed.status === 'observed'
    ? puzzleMaterialRuleVectors(parsed.rules, input.pool.required) : [];
  const availableByQuality = [1, 2, 3].map(quality => new Set(input.pool.candidates
    .filter(item => (item.rating < 65 ? 1 : item.rating < 75 ? 2 : 3) === quality).map(item => item.definitionId)).size);
  const feasiblePreferred = preferred.length ? vectors.find(vector => vector.every(rule => {
    const quality = rule.qualities?.[0];
    return Number.isInteger(quality) && rule.mode === 'exact'
      && rule.count <= availableByQuality[quality - 1];
  })) : null;
  // The theoretical lowest-quality composition is often impossible in the
  // current safe inventory (for example, all silver with only one silver card).
  // Searching it first burns the node budget before falling back to all gold.
  // Start at the lowest composition the unique safe definitions can supply.
  const inventoryPreferred = feasiblePreferred ?? preferred;
  // Do not decide whether the preferred vector is useful from the current
  // Club pool alone.  Procurement adds market candidates after the initial
  // inventory snapshot; checking only this pool made a valid silver/gold
  // market route look unavailable and skipped it entirely.  Running the
  // bounded preferred pass is safe: an actual shortage returns immediately,
  // after which the native fallback retains the original behaviour.
  const canUpgrade = inventoryPreferred.length
    && puzzleHasQualityAlternative(parsed.rules, input.pool.required, input.pool.candidates, inventoryPreferred);
  if (!inventoryPreferred.length || !integer(maxNodes, 1, 250000))
    return yield* iteratePuzzleRoutes({ ...input, materialRules: inventoryPreferred });
  if (!canUpgrade) {
    // The preferred vector is only a traversal preference.  When the safe
    // inventory cannot provide that composition, carrying its exact rules
    // into the fallback turns a legal native all-gold (or mixed) squad into a
    // false shortage.  Drop the preference entirely and let the original EA
    // requirements decide the fallback route.
    const result = yield* iteratePuzzleRoutes({ ...input, materialRules: [], nativeQualityFallback: true });
    return { ...result, materialPreference: 'native-quality-fallback', qualityVectorAttempts: 1 };
  }
  // A preferred quality vector is the main cost-saving route.  Giving it only
  // one third of the budget made chemistry-heavy SBCs fall through to the
  // native fallback before the silver/gold composition could be completed;
  // the fallback then appeared cheaper simply because it was the only route
  // that reached a leaf.  Reserve a small slice for fallback, while allowing
  // the preferred route enough room to explore its full material vector.
  // Keep the native-valid fallback room.  The preference pass is an
  // optimization hint; it must never consume the budget that the historical
  // native route needed to find an all-gold solution.  Marquee challenges in
  // particular can spend many nodes proving a low-tier chemistry route before
  // the ordinary gold route is reached.
  const preferredBudget = input.procurement?.priceAware
    ? Math.max(1, Math.ceil(maxNodes * 0.6))
    : Math.max(1, Math.floor(maxNodes * 0.25));
  // `estimatedCost` is cash-only.  In material-value mode the traversal
  // budget is the complete objective (owned valuation plus purchases), so
  // using estimatedCost here silently rejected cheaper inventory/market
  // mixes whenever the first route used a few purchases.  Keep one helper
  // for every bounded-route comparison and budget hand-off.
  const objective = input.procurement?.objective ?? 'additional-coins';
  const objectiveValue = plan => objectiveValueOf(plan, objective);
  // Keep one feasible low-tier preference before the unrestricted native
  // fallback. Enumerating every quality vector consumed the price-led route
  // budget and regressed remote chemistry controls; mixed vectors remain
  // available to the full native search and bounded incumbent replacements.
  const materialVectors = [inventoryPreferred];
  const preferenceSearch = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
  let spent = 0; let first = null; let incumbent = null; let vectorAttempts = 0;
  for (let index = 0; index < materialVectors.length && spent < preferredBudget; index++) {
    const remainingVectors = materialVectors.length - index;
    const laneBudget = Math.max(1, Math.floor((preferredBudget - spent) / remainingVectors));
    const vectorResult = yield* iteratePuzzleRoutes({ ...input, maxNodes: laneBudget,
      materialRules: materialVectors[index],
      ...(incumbent && input.procurement ? { procurement: { ...input.procurement,
        budget: Math.min(input.procurement.budget, objectiveValue(incumbent)) } } : {}),
      onProgress: value => input.onProgress?.({ ...value, nodes: spent + value.nodes, maxNodes }) });
    vectorAttempts++;
    spent += vectorResult.nodes ?? 0;
    for (const key of Object.keys(preferenceSearch)) preferenceSearch[key] += vectorResult.search?.[key] ?? 0;
    if (!first) first = vectorResult;
    if (vectorResult.status === 'preview'
        && (!incumbent || comparePuzzlePlans(vectorResult, incumbent, objective) < 0)) incumbent = vectorResult;
    // A proven-complete route can still be beaten by another quality vector;
    // continue until all vectors or the shared preference slice are consumed.
  }
  first ??= yield* iteratePuzzleRoutes({ ...input, maxNodes: Math.max(1, preferredBudget), materialRules: inventoryPreferred,
    onProgress: value => input.onProgress?.({ ...value, nodes: value.nodes, maxNodes }) });
  if (!spent) spent = first.nodes ?? 0;
  if (!Object.keys(preferenceSearch).some(key => preferenceSearch[key] > 0)) {
    for (const key of Object.keys(preferenceSearch)) preferenceSearch[key] = first.search?.[key] ?? 0;
  }
  const incumbentResult = incumbent ?? first;
  const hasIncumbent = incumbent?.status === 'preview';
  // A zero-cash incumbent proves the additional-coins objective immediately.
  // For material-value we must continue: replacing an expensive owned card
  // with a cheap market card can lower the total value even when cash spend
  // on the incumbent is already zero.
  if (hasIncumbent && (!input.procurement?.priceAware || objective !== 'material-value' && objectiveValue(incumbent) === 0)) return { ...incumbent, maxNodes, nodes: spent,
    search: preferenceSearch, materialPreference: 'minimum-quality', qualityVectorAttempts: vectorAttempts,
    ...(input.procurement ? { searchComplete: false, optimalWithinPool: false } : {}) };
  if (!hasIncumbent && !['SAFE_MATERIAL_SHORTAGE','FC27_PUZZLE_CONSTRAINT_SHORTAGE','FC27_PUZZLE_NO_PLAN_FOUND','FC27_PUZZLE_SEARCH_LIMIT'].includes(first.reason)) return first;
  const remaining = maxNodes - spent;
  if (remaining < 1) return hasIncumbent ? { ...incumbent, maxNodes, nodes: spent,
    search: preferenceSearch, searchComplete: false, optimalWithinPool: false,
    materialPreference: 'minimum-quality', qualityVectorAttempts: vectorAttempts }
    : { ...first, maxNodes, nodes: spent, search: preferenceSearch };
  const sum = search => Object.fromEntries(['combinationNodes','placementNodes','evaluations','bounds']
    .map(key => [key, (preferenceSearch[key] ?? 0) + (search?.[key] ?? 0)]));
  const result = yield* iteratePuzzleRoutes({ ...input, maxNodes: remaining, materialRules: [], nativeQualityFallback: true,
    ratingFirstStart: !hasIncumbent,
    ...(hasIncumbent ? { procurement: { ...input.procurement,
      budget: Math.min(input.procurement.budget, Math.max(0, objectiveValue(incumbent))) } } : {}),
    onProgress: value => input.onProgress?.({ ...value, nodes: spent + value.nodes, maxNodes, search: sum(value.search) }) });
  // The low-quality vector is a tie-break, not permission to discard a
  // cheaper native-valid squad. Keep the known feasible incumbent if the
  // bounded monetary comparison cannot improve it; no extra node budget.
  const keepFirst = hasIncumbent && (result.status !== 'preview'
    || comparePuzzlePlans(incumbent, result, objective) <= 0);
  return { ...(keepFirst ? incumbentResult : result), maxNodes, nodes: spent + (result.nodes ?? 0), search: sum(result.search),
    routeBudgets: { preferred: preferredBudget, fallback: remaining, preferredNodes: spent,
      fallbackNodes: result.nodes ?? 0, preferredStatus: first.status, fallbackStatus: result.status,
      preferredEstimatedCost: incumbent?.estimatedCost ?? first.estimatedCost ?? null, fallbackEstimatedCost: result.estimatedCost ?? null,
      qualityVectorAttempts: vectorAttempts },
    ...(hasIncumbent ? { searchComplete: false, optimalWithinPool: false } : {}),
    materialPreference: keepFirst ? 'minimum-quality' : hasIncumbent ? 'native-cost-improvement' : 'native-quality-fallback',
    ...(input.searchHint === null || input.searchHint === undefined
      ? { strategyAttempts: (first.strategyAttempts ?? 1) + (result.strategyAttempts ?? 1) } : {}) };
}

function* iteratePuzzleRoutes({ maxNodes = DEFAULT_MAX_NODES, searchHint = null, onProgress = null, ...options }) {
  const { challenge, pool, groupMatcher, clubLinks } = options;
  const procurementMode = !!options.procurement;
  const required = pool.required;
  const rules = parseFc27SbcRequirements(challenge.rawRequirements, required);
  if (searchHint !== null || maxNodes < 1000 || pool.candidates.length <= required || rules.status !== 'observed'
      || !rules.rules.some(rule => ['min-chemistry', 'exact-chemistry'].includes(rule.kind) && rule.value > 0)) {
    return yield* iterateFc27PuzzleCandidates({ ...options, maxNodes, searchHint, onProgress });
  }
  // Deterministic multi-start traversal, not additional searches with a fresh
  // budget each time. Preserve every candidate and every protection. An
  // explicit caller/AI hint still selects exactly its requested traversal.
  const hints = [null];
  const hintCandidates = filterUnaryCandidates(pool.candidates,
    [...rules.rules, ...(options.materialRules ?? [])].filter(rule => itemKinds.has(rule.kind)),
    required, groupMatcher, createFc27ClubResolver(clubLinks));
  for (const [strategy, field] of [['league', 'leagueId'], ['nation', 'nationId']]) {
    const groups = new Map();
    for (const item of hintCandidates) {
      if (!integer(item[field], 1, Number.MAX_SAFE_INTEGER)) continue;
      if (!groups.has(item[field])) groups.set(item[field], new Set());
      groups.get(item[field]).add(item.definitionId);
    }
    hints.push(...[...groups].filter(([, ids]) => ids.size >= 2)
      .sort((a, b) => b[1].size - a[1].size || a[0] - b[0]).slice(0, 2)
      .map(([groupId]) => ({ strategy, groupId })));
  }
  // Monetary searches need a real price-led start. Every existing start
  // ranked connectivity/scarcity ahead of price and could spend its entire
  // share preserving the same expensive anchor. Keep those feasibility
  // starts, but share their original total budget with a cheap-first route
  // and at most two compulsory-group starts ranked by priced position cover.
  const pricedGroups = options.procurement?.priceAware ? pricedPuzzleGroupStarts({ candidates: hintCandidates,
    rules: rules.rules, formation: challenge.formation, brickIndices: challenge.brickIndices,
    costOf: options.procurement.costOf, resolveClub: createFc27ClubResolver(clubLinks) }) : [];
  // Without a feasible incumbent, cheap low-rated fillers can dominate every
  // price-led start. Reserve one original-budget slice for rating feasibility;
  // it is still fully validated and all results use the same monetary goal.
  const ratingStart = options.ratingFirstStart && options.procurement?.priceAware
    && rules.rules.some(rule => ['min-team-rating', 'exact-team-rating'].includes(rule.kind) && rule.value > 0);
  const routes = [...(ratingStart ? [{ hint: null, costFirst: false, ratingFirst: true }] : []),
    ...(options.procurement?.priceAware ? [{ hint: null, costFirst: true }] : []),
    ...pricedGroups,
    ...hints.map(hint => ({ hint, costFirst: false }))];
  let nodes = 0; let result; let bestResult = null; let hadTruncatedRoute = false;
  const search = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
  const reportProgress = progress => {
    if (typeof onProgress !== 'function') return;
    try { onProgress({ ...progress, nodes: nodes + progress.nodes,
      search: Object.fromEntries(Object.keys(search).map(key => [key, search[key] + (progress.search?.[key] ?? 0)])),
      maxNodes, safeCandidates: pool.candidates.length, required, attempt: progress.attempt,
      attempts: routes.length }); } catch { /* Progress presentation cannot affect the search. */ }
  };
  for (const [index, { hint, costFirst, ratingFirst = false }] of routes.entries()) {
    const budget = Math.floor((maxNodes - nodes) / (routes.length - index));
    result = yield* iterateFc27PuzzleCandidates({ ...options, maxNodes: budget, searchHint: hint, costFirst, ratingFirst,
      ...(bestResult && objectiveValueOf(bestResult, options.procurement?.objective) > 0 ? { procurement: { ...options.procurement,
        budget: Math.min(options.procurement.budget, objectiveValueOf(bestResult, options.procurement?.objective) - 1) } } : {}),
      onProgress: progress => reportProgress({ ...progress, attempt: index + 1 }) });
    nodes += result.nodes ?? 0;
    for (const key of Object.keys(search)) search[key] += result.search?.[key] ?? 0;
    // Procurement must compare every bounded route that can still improve the
    // known price. A route may return a valid plan together with
    // searchComplete:false; returning it immediately used to hide cheaper
    // combinations found by the next hint. Non-procurement previews retain
    // their original first-feasible behavior.
    if (procurementMode && result.status === 'preview') {
      if (!bestResult || comparePuzzlePlans(result, bestResult,
        options.procurement?.objective ?? 'additional-coins') < 0) bestResult = result;
      if (result.searchComplete === false) hadTruncatedRoute = true;
      if (result.searchComplete !== false) {
        const selected = bestResult ?? result;
        return { ...selected, nodes, maxNodes, search,
          ...(searchHint === null ? { strategyAttempts: index + 1 } : {}),
          searchComplete: selected.searchComplete === true && !hadTruncatedRoute,
          optimalWithinPool: selected.optimalWithinPool === true && !hadTruncatedRoute };
      }
      continue;
    }
    if (procurementMode && bestResult && result.reason !== 'FC27_PUZZLE_SEARCH_LIMIT') {
      return { ...bestResult, nodes, maxNodes, search,
        ...(searchHint === null ? { strategyAttempts: index + 1 } : {}),
        searchComplete: false, optimalWithinPool: false };
    }
    // Only a budget-limited traversal needs another start. Proven shortage,
    // unsupported facts and complete no-plan results retain their cause.
    if (result.reason !== 'FC27_PUZZLE_SEARCH_LIMIT') {
      return { ...result, ...(result.nodes !== undefined ? { nodes, maxNodes, search,
        ...(searchHint === null ? { strategyAttempts: index + 1 } : {}) } : {}) };
    }
    hadTruncatedRoute = true;
  }
  if (procurementMode && bestResult) {
    return { ...bestResult, nodes, maxNodes, search, strategyAttempts: routes.length,
      searchComplete: false, optimalWithinPool: false };
  }
  return { ...result, nodes, maxNodes, search, strategyAttempts: routes.length };
}

// Internal detached search seam shared by owned-only and procurement previews.
// Catalog candidates are not inventory entities. No result from this function
// is an executable transaction; callers must preserve that distinction.
export const searchFc27PuzzleCandidates = input => finishPuzzleSearch(iterateFc27PuzzleCandidates(input));

export function* iterateFc27PuzzleCandidates({ challenge, policy, evaluateSquad, boundSquad, groupMatcher, clubLinks, chemistry,
  maxNodes = DEFAULT_MAX_NODES, searchHint = null, pool, procurement = null, onProgress = null,
  materialRules = [], nativeQualityFallback = false, costFirst = false, ratingFirst = false, searchBudget = null } = {}) {
  if (!integer(maxNodes, 1, 250000) || searchBudget !== null && !isFc27PuzzleSearchBudget(searchBudget)) return blocked('FC27_PUZZLE_BUDGET_INVALID');
  const required = pool.required;
  // Planning amounts use the same public-price domain as procurement: at
  // most eleven slots, each up to EA's 15m ceiling. This is not spend approval.
  if (procurement && (!integer(procurement.budget, 0, 11 * MAX_PUZZLE_QUOTE_PRICE) || !integer(procurement.maxPurchases, 0, 11)
      || typeof procurement.costOf !== 'function')) return blocked('FC27_MARKET_POLICY_INVALID');
  const parsed = parseFc27SbcRequirements(challenge.rawRequirements, required);
  if (parsed.status === 'unsupported') return blocked('FC27_REQUIREMENT_UNSUPPORTED', { unsupported: parsed.unsupported });
  if (parsed.status !== 'observed') return blocked(parsed.reason);
  const resolveClub = createFc27ClubResolver(clubLinks);
  if (parsed.rules.some(rule => ['from-clubs', 'same-club', 'distinct-clubs'].includes(rule.kind)) && !resolveClub) {
    return blocked('FC27_PUZZLE_CLUB_LINKS_UNAVAILABLE');
  }
  const itemRules = [...parsed.rules, ...materialRules].filter(rule => itemKinds.has(rule.kind));
  // Validate against the safe input pool, not the propagated pool: a known
  // traversal preference can lose all members without becoming malformed.
  if (!isFc27PuzzleSearchHintValid(searchHint, pool.candidates, clubLinks)) {
    return blocked('FC27_PUZZLE_STRATEGY_INVALID');
  }
  let candidates = filterUnaryCandidates(pool.candidates, itemRules, required, groupMatcher, resolveClub);
  let traversalScores = null;
  // A high chemistry target needs in-position players. This is only an
  // ordering hint: off-position cards remain eligible and the detached EA
  // evaluator still decides whether the complete squad meets every rule.
  const chemistryTarget = searchHint?.strategy !== 'low-rating'
    && parsed.rules.some(rule => ['min-chemistry', 'exact-chemistry'].includes(rule.kind) && rule.value > 0);
  const openPositions = chemistryTarget && Array.isArray(challenge.formation?.positions) && Array.isArray(challenge.brickIndices)
    ? challenge.formation.positions.filter((_position, index) => !challenge.brickIndices.includes(index)) : null;
  const positionFit = item => Array.isArray(openPositions) && Array.isArray(item.positions)
    && item.positions.some(position => openPositions.includes(position));
  let positionScarcity = null;
  if (chemistryTarget) {
    // A traversal heuristic only: prefer connected groups, never filter by
    // this score or infer feasibility from it. Prefer cards covering scarce
    // formation slots before highly connected cards that all fit the same
    // common slot; keep the configured pile order.
    // Caller-selected hints retain their established deterministic traversal.
    // Scarcity is a default-route improvement, not a reinterpretation of an
    // explicit strategy or its bounded-node behavior.
    if (searchHint === null) {
      const support = openPositions?.map(position => new Set(candidates.filter(item =>
        Array.isArray(item.positions) && item.positions.includes(position)).map(item => item.definitionId)).size) ?? [];
      positionScarcity = new Map(candidates.map(item => [item, Math.max(0,
        ...(openPositions ?? []).map((position, index) => Array.isArray(item.positions)
          && item.positions.includes(position) && support[index]
          ? 1 / support[index] : 0))]));
    }
    const fields = [item => item.nationId, item => item.leagueId,
      item => resolveClub?.(item.teamId ?? item.clubId)];
    const frequencies = fields.map(read => {
      const groups = new Map();
      for (const item of candidates) {
        const key = read(item);
        if (!integer(key, 1, Number.MAX_SAFE_INTEGER)) continue;
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(item.definitionId);
      }
      return groups;
    });
    const scores = new Map(candidates.map(item => [item, fields.reduce((sum, read, index) =>
      sum + Math.min(required, frequencies[index].get(read(item))?.size ?? 0), 0)]));
    traversalScores = scores;
    candidates = candidates.slice().sort((a, b) =>
      (policy.storageFirst ? Number(b.pile === 'storage') - Number(a.pile === 'storage') : 0)
      || Number(positionFit(b)) - Number(positionFit(a))
      || (positionScarcity ? positionScarcity.get(b) - positionScarcity.get(a) : 0)
      // For an otherwise valid SBC, lower quality is the material-saving
      // route. Keep connectivity and position safety ahead of this only when
      // they are actually needed; EA's complete evaluator remains final.
      || scores.get(b) - scores.get(a) || a.rating - b.rating
      || (Number.isSafeInteger(a.id) && Number.isSafeInteger(b.id) ? a.id - b.id : a.definitionId - b.definitionId));
  }
  if (['nation', 'league', 'club'].includes(searchHint?.strategy)) {
    const group = item => hintGroup(searchHint, item, resolveClub);
    // With no remaining members this is a stable no-op, retaining the
    // balanced order. Never reintroduce excluded cards to satisfy a hint.
    // Hints change traversal only. All candidates, unique-definition checks,
    // Storage priority, safety gates and the full final validator remain intact.
    candidates = candidates.slice().sort((a, b) =>
      (policy.storageFirst ? Number(b.pile === 'storage') - Number(a.pile === 'storage') : 0)
      || Number(group(b) === searchHint.groupId) - Number(group(a) === searchHint.groupId)
      || Number(positionFit(b)) - Number(positionFit(a)));
  }
  // Put scarce compulsory groups first so skipping a required member is
  // rejected by suffix bounds immediately, rather than near the leaf.
  const scarce = itemRules.filter(rule => rule.mode !== 'max' && rule.count > 0).map(rule => ({
    minimum: rule.count, matching: candidates.filter(item => matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) === true),
  }));
  for (const rule of parsed.rules.filter(rule => rule.kind.startsWith('same-') && rule.mode !== 'max')) {
    const groups = new Map();
    for (const item of candidates) {
      const key = relationValue(rule, item, resolveClub);
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(item.definitionId);
    }
    scarce.push({ minimum: rule.value, matching: candidates.filter(item =>
      (groups.get(relationValue(rule, item, resolveClub))?.size ?? 0) >= rule.value) });
  }
  const forced = new Set(scarce.filter(entry => new Set(entry.matching.map(item => item.definitionId)).size === entry.minimum)
    .flatMap(entry => entry.matching));
  const mixedClubRequirements = (nativeQualityFallback || materialRules.filter(rule => rule.count > 0).length > 1)
    && parsed.rules.some(rule => rule.kind === 'from-clubs' && rule.mode !== 'max' && rule.count > 0);
  const compulsoryScores = new Map(candidates.map(item => [item, 0]));
  if (mixedClubRequirements && parsed.rules.some(rule => rule.kind.endsWith('-chemistry'))) {
    // Small mandatory subsets must be visited before unrestricted fillers.
    // Otherwise separate club/gold obligations can be individually reachable
    // but jointly impossible in the last slot, wasting the whole node budget.
    for (const entry of scarce.filter(entry => entry.minimum < required)) {
      const size = new Set(entry.matching.map(item => item.definitionId)).size;
      if (!size) continue;
      for (const item of entry.matching) compulsoryScores.set(item, compulsoryScores.get(item) + 1 / size);
    }
  }
  // Only propagate an upper bound when the compulsory definitions each have
  // one physical candidate. Alternate copies remain choices, not extra slots.
  const definitionCounts = new Map();
  for (const item of candidates) definitionCounts.set(item.definitionId, (definitionCounts.get(item.definitionId) ?? 0) + 1);
  const certain = [...forced].filter(item => definitionCounts.get(item.definitionId) === 1);
  for (const rule of itemRules.filter(rule => ['max', 'exact'].includes(rule.mode))) {
    const used = certain.filter(item => matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) === true).length;
    if (used === rule.count) candidates = candidates.filter(item => forced.has(item)
      || matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub) !== true);
  }
  if ((forced.size || mixedClubRequirements) && parsed.rules.some(rule => rule.kind.endsWith('-chemistry'))) {
    candidates = candidates.slice().sort((a, b) => Number(forced.has(b)) - Number(forced.has(a))
      || (policy.storageFirst ? Number(b.pile === 'storage') - Number(a.pile === 'storage') : 0)
      || compulsoryScores.get(b) - compulsoryScores.get(a)
      // Mandatory identity/chemistry ordering is only a traversal hint. Keep
      // each chemistry start and its position/connectivity priorities before
      // breaking otherwise equivalent candidates by material quality. Sorting
      // by rating alone here erased those starts and exhausted valid routes.
      || (['nation', 'league', 'club'].includes(searchHint?.strategy)
        ? Number(hintGroup(searchHint, b, resolveClub) === searchHint.groupId)
          - Number(hintGroup(searchHint, a, resolveClub) === searchHint.groupId) : 0)
      || Number(positionFit(b)) - Number(positionFit(a))
      || (positionScarcity ? positionScarcity.get(b) - positionScarcity.get(a) : 0)
      || (traversalScores ? traversalScores.get(b) - traversalScores.get(a) : 0)
      || a.rating - b.rating
      || (Number.isSafeInteger(a.id) && Number.isSafeInteger(b.id) ? a.id - b.id : a.definitionId - b.definitionId));
  }
  const metrics = { safeCandidates: candidates.length, excluded: pool.excluded, excludedByReason: pool.excludedByReason,
    qualityCounts: pool.qualityCounts, qualityDefinitionCounts: pool.qualityDefinitionCounts };
  let costs = procurement ? candidates.map(procurement.costOf) : candidates.map(() => 0);
  if (costs.some(cost => !integer(cost, 0, MAX_PUZZLE_QUOTE_PRICE))) return blocked('FC27_MARKET_QUOTE_INVALID');
  if (procurement?.priceAware) {
    // One transitive ordering: preserve compulsory groups, Storage and the
    // selected route before using cost within a connectivity band. Sorting
    // by connectivity again without the hint erased the different starts;
    // comparing price only for market/market pairs was non-transitive when
    // owned cards sat between them. Owned materials have zero added spend.
    const originalOrder = new Map(candidates.map((item, index) => [item, index]));
    const quoted = new Map(candidates.map((item, index) => [item, costs[index]]));
    const preferredGroup = item => ['nation', 'league', 'club'].includes(searchHint?.strategy)
      && hintGroup(searchHint, item, resolveClub) === searchHint.groupId;
    candidates = candidates.slice().sort((a, b) => Number(forced.has(b)) - Number(forced.has(a))
      || (policy.storageFirst ? Number(b.pile === 'storage') - Number(a.pile === 'storage') : 0)
      || compulsoryScores.get(b) - compulsoryScores.get(a)
      || Number(preferredGroup(b)) - Number(preferredGroup(a))
      || Number(positionFit(b)) - Number(positionFit(a))
      || (ratingFirst ? b.rating - a.rating : 0)
      || (costFirst ? quoted.get(a) - quoted.get(b) : 0)
      || (positionScarcity ? positionScarcity.get(b) - positionScarcity.get(a) : 0)
      || (traversalScores ? traversalScores.get(b) - traversalScores.get(a) : 0)
      || quoted.get(a) - quoted.get(b)
      || originalOrder.get(a) - originalOrder.get(b));
    costs = candidates.map(item => quoted.get(item));
  }
  const uniqueDefinitions = new Set(candidates.map(item => item.definitionId)).size;
  if (uniqueDefinitions < required) return blocked('SAFE_MATERIAL_SHORTAGE', { ...metrics, uniqueDefinitions, required });
  const counted = itemRules.map(rule => ({ rule,
    matches: candidates.map(item => matchFc27SbcItemRule(rule, item, groupMatcher, resolveClub)),
  }));
  const relations = parsed.rules.filter(rule => /^(same|distinct)-/.test(rule.kind));
  if (counted.some(({ matches }) => matches.includes(null))
      || relations.some(rule => candidates.some(item => !integer(relationValue(rule, item, resolveClub), 1, Number.MAX_SAFE_INTEGER)))) {
    return blocked('FC27_REQUIREMENT_VALUE_UNAVAILABLE', metrics);
  }
  const groupCaps = new Map(relations.filter(rule => rule.kind.startsWith('distinct-') && rule.mode !== 'min')
    .map(rule => [rule, groupSuffixIndex(rule, candidates, resolveClub)]));
  // A same-group minimum can only be met by groups with enough distinct
  // definitions. Their union is a necessary count predicate; with a sole
  // eligible group this propagates all of its required members immediately.
  for (const rule of relations.filter(rule => rule.kind.startsWith('same-') && rule.mode !== 'max')) {
    const groups = new Map();
    for (const item of candidates) {
      const key = relationValue(rule, item, resolveClub);
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(item.definitionId);
    }
    const viable = new Set([...groups].filter(([, ids]) => ids.size >= rule.value).map(([key]) => key));
    counted.push({ rule: { ...rule, count: rule.value, mode: 'min' },
      matches: candidates.map(item => viable.has(relationValue(rule, item, resolveClub))) });
  }
  const deficits = counted.flatMap(({ rule, matches }) => {
    if (rule.mode === 'max') return [];
    const available = new Set(candidates.filter((_item, index) => matches[index]).map(item => item.definitionId)).size;
    return available < rule.count ? [{ kind: rule.kind, minimumMissing: rule.count - available, source: rule.source }] : [];
  });
  if (deficits.length) return blocked('FC27_PUZZLE_CONSTRAINT_SHORTAGE', { ...metrics, deficits });
  if (ruleNeedsTeamFacts(parsed.rules) && typeof evaluateSquad !== 'function') return blocked('FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE', metrics);
  // Suffix counts are optimistic bounds (duplicates can only lower availability).
  for (const entry of counted) {
    entry.suffix = Array(candidates.length + 1).fill(0); entry.used = 0;
    for (let i = candidates.length - 1; i >= 0; i--) entry.suffix[i] = entry.suffix[i + 1] + Number(entry.matches[i]);
  }
  // Couple item minima (e.g. seven gold) to same-group upper bounds (e.g.
  // four per league). Plain suffix headcount counted unusable fifth/sixth
  // league members, leaving 50k dead combinations before any placement.
  // Group suffixes count physical copies and ignore other conflicts, so this
  // is an optimistic capacity bound, never a new material restriction.
  const sameCaps = new Map(relations.filter(rule => rule.kind.startsWith('same-') && rule.mode !== 'min')
    .map(rule => [rule, counted.filter(entry => entry.rule.mode !== 'max' && entry.rule.count > 0).map(entry => ({ entry,
      groups: groupSuffixIndex(rule, candidates, resolveClub),
    }))]));
  for (const predicates of sameCaps.values()) for (const predicate of predicates) {
    for (const [group, indices] of predicate.groups) {
      const matching = indices.filter(index => predicate.entry.matches[index]);
      if (matching.length) predicate.groups.set(group, matching); else predicate.groups.delete(group);
    }
  }
  const slots = Array.from({ length: challenge.slotCount }, (_, index) => index).filter(index => !challenge.brickIndices.includes(index));
  const chosen = []; const definitions = new Set(); let nodes = 0; let found = null; let unavailable = null; let exhausted = false;
  let deferredPlacements = false;
  let spent = 0; let purchases = 0; let best = null;
  // Optimistic suffix cost bounds ignore uniqueness and rule conflicts, so they
  // can only underestimate remaining spend. They never prove market shortage.
  const costBound = procurement ? createFc27PuzzleCostBound(costs, counted, required,
    candidates.map(item => item.definitionId)) : null;
  const finished = () => found && !procurement || best?.cost === 0;
  const search = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
  const reportProgress = (force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && (nodes % 256 !== 0 || now - lastProgressAt < 100)) return;
    lastProgressAt = now;
    try { onProgress({ phase: lastNodeKind, nodes, maxNodes, search: { ...search }, ...(searchBudget?.snapshot() ?? {}),
      safeCandidates: candidates.length, required }); } catch { /* Progress presentation cannot affect the search. */ }
  };
  let lastProgressAt = 0;
  let lastNodeKind = 'combination';
  const takeNode = kind => {
    const previousStage = searchBudget?.snapshot().budgetStage;
    if (nodes >= maxNodes || searchBudget && !searchBudget.takeNode()) { exhausted = true; return false; }
    nodes++; search[kind]++; lastNodeKind = kind === 'combinationNodes' ? 'combination'
      : kind === 'placementNodes' ? 'placement' : kind === 'evaluations' ? 'evaluation' : 'bounds';
    const budget = searchBudget?.snapshot();
    reportProgress(Boolean(budget && (budget.budgetStage !== previousStage || budget.budgetNodes === budget.maxNodes)));
    return true;
  };
  const needsFacts = ruleNeedsTeamFacts(parsed.rules);
  const ratingRules = parsed.rules.filter(rule => ['min-team-rating', 'max-team-rating', 'exact-team-rating'].includes(rule.kind));
  const searchPositions = parsed.rules.some(rule => rule.kind.endsWith('-chemistry'));
  const minimumChemistry = Math.max(0, ...parsed.rules.filter(rule => ['min-chemistry', 'exact-chemistry'].includes(rule.kind))
    .map(rule => rule.value));
  const partialChemistry = minimumChemistry > 0 ? createFc27PuzzlePartialChemistryBound({
    candidates, slots, formation: challenge.formation, chemistry }) : null;
  const visit = function* (start) {
    if (finished() || unavailable || exhausted || !takeNode('combinationNodes')) return;
    yield;
    const remaining = required - chosen.length;
    if (procurement) {
      if (purchases > procurement.maxPurchases || spent > procurement.budget) return;
      const floor = spent + costBound(start, remaining);
      if (floor > procurement.budget || best && floor >= best.cost) return;
    }
    for (const { rule, used, suffix } of counted) {
      const mode = rule.mode ?? 'min';
      if (mode !== 'min' && used > rule.count || mode !== 'max' && used + Math.min(remaining, suffix[start]) < rule.count) return;
    }
    for (const rule of relations) {
      const counts = new Map();
      for (const item of chosen) { const value = relationValue(rule, item, resolveClub); counts.set(value, (counts.get(value) ?? 0) + 1); }
      const actual = rule.kind.startsWith('distinct-') ? counts.size : Math.max(0, ...counts.values());
      if (rule.mode !== 'min' && actual > rule.value || rule.mode !== 'max' && actual + remaining < rule.value) return;
      // Even the largest still-available groups must be able to fill every
      // remaining slot within the distinct-group cap. Reject dead branches
      // before enumerating their combinations or expensive chemistry layouts.
      if (groupCaps.has(rule) && remainingGroupCapacity(groupCaps.get(rule), counts, start, rule.value - counts.size) < remaining) return;
      for (const { entry, groups } of sameCaps.get(rule) ?? []) {
        if (entry.used >= entry.rule.count) continue;
        let capacity = 0;
        for (const [group, indices] of groups) {
          capacity += Math.min(Math.max(0, rule.value - (counts.get(group) ?? 0)), suffixSize(indices, start));
          if (entry.used + Math.min(remaining, capacity) >= entry.rule.count) break;
        }
        if (entry.used + Math.min(remaining, capacity) < entry.rule.count) return;
      }
    }
    if (partialChemistry && partialChemistry(chosen, start, remaining) < minimumChemistry) return;
    if (chosen.length === required) {
      const validate = facts => matchFc27SbcRequirements({ requirements: parsed.rules, squad: chosen,
        chemistry: facts?.chemistry, teamRating: facts?.teamRating, groupMatcher, clubLinks });
      if (needsFacts) {
        // The ordinary-native proof gate already used by chemistry pruning
        // also permits the canonical rating calculation. Rating never changes
        // with position: reject it before expensive bounds/permutations.
        // Unknown profiles/configuration retain the original evaluator path.
        if (partialChemistry && ratingRules.length) {
          if (!takeNode('bounds')) return;
          const rating = evaluateFc27PuzzleRating({ squad: chosen, rating: chemistry?.rating });
          if (rating.status === 'observed' && matchFc27SbcRequirements({ requirements: ratingRules,
            squad: chosen, teamRating: rating.teamRating }).status === 'unsatisfied') return;
        }
        if (typeof boundSquad === 'function' && minimumChemistry > 0) {
          if (!takeNode('bounds')) return;
          let bound;
          try {
            const squad = Array(challenge.slotCount).fill(null);
            chosen.forEach((item, index) => { squad[slots[index]] = { ...item, slot: slots[index] }; });
            bound = boundSquad(freeze(globalThis.structuredClone(squad)));
          } catch { unavailable = 'FC27_PUZZLE_BOUND_UNAVAILABLE'; return; }
          if (bound?.status !== 'observed' || !integer(bound.maxChemistry, 0, 33)) {
            unavailable = 'FC27_PUZZLE_BOUND_UNAVAILABLE'; return;
          }
          if (bound.maxChemistry < minimumChemistry) return;
        }
        // Share the finite budget across combinations. The old fixed 256-node
        // cap made chemistry-heavy challenges with only a few candidates stop
        // before a legal arrangement could be evaluated. Keep a per-combination
        // guard, but scale it with the remaining global budget and candidate
        // fan-out; the global `maxNodes` remains the final hard limit.
        let placementNodes = 0;
        const remainingBudget = Math.max(0, maxNodes - nodes);
        const branchFanout = Math.max(1, candidates.length - chosen.length + 1);
        const placementCap = Math.max(256, Math.min(4096,
          Math.floor(remainingBudget / branchFanout) || 256));
        const placementNode = kind => {
          if (placementNodes >= placementCap) { deferredPlacements = true; return false; }
          placementNodes++; return takeNode(kind);
        };
        const result = yield* evaluatePlacement({ chosen, slots,
          formation: { ...challenge.formation, slotCount: challenge.slotCount }, evaluateSquad,
          takeNode: placementNode, validate, searchPositions });
        found = result.found; unavailable = result.unavailable;
      } else {
        const validation = validate({});
        if (validation.status === 'blocked') unavailable = validation.reason;
        if (validation.status === 'satisfied') found = { items: chosen.slice(), facts: { chemistry: null, teamRating: null }, validation };
      }
      if (found) searchBudget?.markFeasible();
      if (procurement && found) {
        // `spent` is the objective cost used by the branch bound.  In
        // material-value mode it includes the reference value of owned cards,
        // while `estimatedCost` must remain cash-only.  The old candidate
        // omitted `materialValue`, so comparePuzzlePlans treated every
        // material route as Infinity and fell back to comparing purchases;
        // that is why a full buy route could beat a cheaper inventory mix.
        const selectedOwned = found.items.filter(item => !item.catalogRef);
        const purchasesList = found.items.filter(item => item.catalogRef);
        const inventoryValue = selectedOwned.reduce((sum, item) => {
          const candidateIndex = candidates.indexOf(item);
          return sum + (candidateIndex >= 0 ? costs[candidateIndex] : 0);
        }, 0);
        const estimatedCost = purchasesList.reduce((sum, item) => {
          const candidateIndex = candidates.indexOf(item);
          return sum + (candidateIndex >= 0 ? costs[candidateIndex] : 0);
        }, 0);
        const candidate = { ...found, estimatedCost, purchaseCount: purchases,
          inventoryValue, materialValue: inventoryValue + estimatedCost,
          selectedOwned, purchases: purchasesList };
        if (!best || comparePuzzlePlans(candidate, best, procurement.objective ?? 'additional-coins') < 0) {
          best = { ...found, cost: spent, estimatedCost,
            purchaseCount: purchases, inventoryValue, materialValue: inventoryValue + estimatedCost,
            selectedOwned, purchases: purchasesList };
        }
        found = null;
      }
      return;
    }
    for (let index = start; index <= candidates.length - remaining && !finished() && !unavailable && !exhausted; index++) {
      const item = candidates[index];
      if (definitions.has(item.definitionId)) continue;
      for (const entry of counted) entry.used += Number(entry.matches[index]);
      // In material-value mode owned cards carry a reference value, but they
      // are still zero-cash materials.  Count purchases from the detached
      // market identity rather than from the objective cost, otherwise an
      // owned 84/85 consumes the purchase quota and distorts tie-breaks.
      spent += costs[index]; purchases += Number(Boolean(item.catalogRef));
      chosen.push(item); definitions.add(item.definitionId); yield* visit(index + 1); definitions.delete(item.definitionId); chosen.pop();
      spent -= costs[index]; purchases -= Number(Boolean(item.catalogRef));
      for (const entry of counted) entry.used -= Number(entry.matches[index]);
    }
  };
  yield* visit(0);
  reportProgress(true);
  if (procurement) found = best;
  if (unavailable) return blocked('FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE', { ...metrics, nodes, search, evaluatorReason: unavailable });
  if ((exhausted || deferredPlacements) && !found) return blocked('FC27_PUZZLE_SEARCH_LIMIT', { ...metrics, nodes, maxNodes, search });
  if (!found) return blocked('FC27_PUZZLE_NO_PLAN_FOUND', { ...metrics, nodes, maxNodes, search, deficits: [] });
  return { status: 'preview', reason: 'READ_ONLY_PLAN', liveExecutionEnabled: false, setId: challenge.setId,
    challengeId: challenge.id, required, selected: found.items.map((item, index) => ({ id: item.id,
      definitionId: item.definitionId, pile: item.pile, rating: item.rating, slot: slots[index],
      ...(item.catalogRef ? { catalogRef: item.catalogRef } : {}) })),
    validation: found.validation, teamFacts: found.facts, nodes, maxNodes, search,
    ...metrics, selectedQualityCounts: selectedQualityCounts(found.items),
    ...(procurement ? { estimatedCost: found.estimatedCost, purchaseCount: found.purchaseCount,
      ...(procurement.objective === 'material-value' ? { materialValue: found.cost, inventoryValue: found.inventoryValue } : {}),
      searchComplete: !exhausted && !deferredPlacements,
      optimalWithinPool: !exhausted && !deferredPlacements } : {}),
    pending: ['EXACT_ITEM_REVALIDATION', 'MARKET_RECEIPT_IF_NEEDED', 'EXPLICIT_TRANSACTION_APPROVAL'] };
}
