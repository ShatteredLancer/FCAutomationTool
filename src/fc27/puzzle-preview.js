import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { puzzleMaterialRules } from './puzzle-material-policy.js';
import { createFc27ClubResolver, matchFc27SbcItemRule, matchFc27SbcRequirements, parseFc27SbcRequirements } from './sbc-requirements.js';

const DEFAULT_MAX_NODES = 50000;
// EA amount domain only; keep the detached solver independent of procurement
// policy/transport dependencies. Priced-joint boundary tests lock agreement.
const MAX_PUZZLE_QUOTE_PRICE = 15000000;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const blocked = (reason, extra = {}) => ({ status: 'blocked', reason, liveExecutionEnabled: false, selected: [], ...extra });
export function finishPuzzleSearch(iterator) {
  let step;
  do { step = iterator.next(); } while (!step.done);
  return step.value;
}

// The same iterator drives synchronous callers and the native cooperative UI.
// A timer yields a browser task (a resolved Promise would not permit painting).
export async function finishPuzzleSearchCooperatively(iterator, { assertCurrent = () => {},
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), sliceMs = 8 } = {}) {
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

function evaluatePlacement({ chosen, slots, formation, evaluateSquad, takeNode, validate, searchPositions }) {
  let found = null; let unavailable = null; let exhausted = false;
  const evaluate = ordered => {
    if (!takeNode('evaluations')) { exhausted = true; return; }
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
    const augment = (itemIndex, visited) => {
      if (!takeNode('placementNodes')) { exhausted = true; return false; }
      for (let slot = 0; slot < slots.length; slot++) {
        if (visited.has(slot) || !fits(chosen[itemIndex], slot)) continue;
        visited.add(slot);
        if (assigned[slot] === -1 || augment(assigned[slot], visited)) {
          assigned[slot] = itemIndex; return true;
        }
        if (exhausted) return false;
      }
      return false;
    };
    for (let index = 0; index < chosen.length && !exhausted; index++) augment(index, new Set());
    if (exhausted) return { found, unavailable, exhausted };
    const used = new Set(assigned.filter(index => index !== -1));
    const fillers = chosen.filter((_item, index) => !used.has(index));
    assigned.forEach((itemIndex, slot) => { preferred[slot] = itemIndex === -1 ? fillers.shift() : chosen[itemIndex]; });
  }
  evaluate(preferred);
  if (found || unavailable || exhausted || !searchPositions) return { found, unavailable, exhausted };
  // Constrained positions first, preferred positions before off-position fillers.
  // Off-position is legal in SBCs and must never be pruned solely for being off.
  const order = slots.map((_slot, index) => index).sort((a, b) =>
    chosen.filter(item => fits(item, a)).length - chosen.filter(item => fits(item, b)).length || a - b);
  const arranged = Array(chosen.length); const used = new Set();
  const visit = depth => {
    if (found || unavailable || exhausted) return;
    if (!takeNode('placementNodes')) { exhausted = true; return; }
    if (depth === order.length) {
      if (!arranged.every((item, index) => item === preferred[index])) evaluate(arranged);
      return;
    }
    const slotIndex = order[depth];
    const choices = chosen.map((_item, index) => index).filter(index => !used.has(index))
      .sort((a, b) => Number(fits(chosen[b], slotIndex)) - Number(fits(chosen[a], slotIndex)) || a - b);
    for (const index of choices) {
      if (found || unavailable || exhausted) break;
      used.add(index); arranged[slotIndex] = chosen[index]; visit(depth + 1); used.delete(index);
    }
  };
  visit(0);
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

export function* iterateFc27PuzzleSquad({ context, challenge, inventory, policy, evaluateSquad, boundSquad, groupMatcher, clubLinks,
  maxNodes = DEFAULT_MAX_NODES, searchHint = null, onProgress = null } = {}) {
  if (!integer(maxNodes, 1, 250000)) return blocked('FC27_PUZZLE_BUDGET_INVALID');
  if (challenge?.mechanism !== 'traditional-puzzle') return blocked('CHALLENGE_UNVERIFIED');
  const required = challenge.slotCount - (challenge.brickIndices?.length ?? NaN);
  // Reuse the exact existing safety gates. This cardinality-only view is never
  // returned to the Live transaction; all Puzzle rules are checked separately.
  const pool = collectSafeTraditionalCandidates({ context, inventory, policy, challenge: {
    ...challenge, mechanism: 'traditional', requirements: [{ kind: 'player-count', count: required }],
  } });
  if (pool.status !== 'candidates') return pool;
  const options = { challenge, policy, evaluateSquad, boundSquad, groupMatcher, clubLinks, pool };
  return yield* iterateFc27PuzzleCandidateRoutes({ ...options, maxNodes, searchHint, onProgress });
}

export function* iterateFc27PuzzleCandidateRoutes({ maxNodes = DEFAULT_MAX_NODES, searchHint = null, onProgress = null, ...options }) {
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
    [...rules.rules, ...puzzleMaterialRules(rules.rules, required)].filter(rule => itemKinds.has(rule.kind)),
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
  let nodes = 0; let result; let bestResult = null; let hadTruncatedRoute = false;
  const search = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
  const reportProgress = progress => {
    if (typeof onProgress !== 'function') return;
    try { onProgress({ ...progress, nodes: nodes + progress.nodes,
      search: Object.fromEntries(Object.keys(search).map(key => [key, search[key] + (progress.search?.[key] ?? 0)])),
      maxNodes, safeCandidates: pool.candidates.length, required, attempt: progress.attempt,
      attempts: hints.length }); } catch { /* Progress presentation cannot affect the search. */ }
  };
  for (const [index, hint] of hints.entries()) {
    const budget = Math.floor((maxNodes - nodes) / (hints.length - index));
    result = yield* iterateFc27PuzzleCandidates({ ...options, maxNodes: budget, searchHint: hint,
      ...(bestResult && bestResult.estimatedCost > 0 ? { procurement: { ...options.procurement,
        budget: Math.min(options.procurement.budget, bestResult.estimatedCost - 1) } } : {}),
      onProgress: progress => reportProgress({ ...progress, attempt: index + 1 }) });
    nodes += result.nodes ?? 0;
    for (const key of Object.keys(search)) search[key] += result.search?.[key] ?? 0;
    // Procurement must compare every bounded route that can still improve the
    // known price. A route may return a valid plan together with
    // searchComplete:false; returning it immediately used to hide cheaper
    // combinations found by the next hint. Non-procurement previews retain
    // their original first-feasible behavior.
    if (procurementMode && result.status === 'preview') {
      if (!bestResult || result.estimatedCost < bestResult.estimatedCost) bestResult = result;
      if (result.searchComplete === false) hadTruncatedRoute = true;
      if (result.searchComplete !== false) {
        const selected = bestResult ?? result;
        return { ...selected, nodes, maxNodes, search, strategyAttempts: index + 1,
          searchComplete: selected.searchComplete === true && !hadTruncatedRoute,
          optimalWithinPool: selected.optimalWithinPool === true && !hadTruncatedRoute };
      }
      continue;
    }
    if (procurementMode && bestResult && result.reason !== 'FC27_PUZZLE_SEARCH_LIMIT') {
      return { ...bestResult, nodes, maxNodes, search, strategyAttempts: index + 1,
        searchComplete: false, optimalWithinPool: false };
    }
    // Only a budget-limited traversal needs another start. Proven shortage,
    // unsupported facts and complete no-plan results retain their cause.
    if (result.reason !== 'FC27_PUZZLE_SEARCH_LIMIT') {
      return { ...result, ...(result.nodes !== undefined ? { nodes, maxNodes, search, strategyAttempts: index + 1 } : {}) };
    }
    hadTruncatedRoute = true;
  }
  if (procurementMode && bestResult) {
    return { ...bestResult, nodes, maxNodes, search, strategyAttempts: hints.length,
      searchComplete: false, optimalWithinPool: false };
  }
  return { ...result, nodes, maxNodes, search, strategyAttempts: hints.length };
}

// Internal detached search seam shared by owned-only and procurement previews.
// Catalog candidates are not inventory entities. No result from this function
// is an executable transaction; callers must preserve that distinction.
export const searchFc27PuzzleCandidates = input => finishPuzzleSearch(iterateFc27PuzzleCandidates(input));

export function* iterateFc27PuzzleCandidates({ challenge, policy, evaluateSquad, boundSquad, groupMatcher, clubLinks,
  maxNodes = DEFAULT_MAX_NODES, searchHint = null, pool, procurement = null, onProgress = null } = {}) {
  if (!integer(maxNodes, 1, 250000)) return blocked('FC27_PUZZLE_BUDGET_INVALID');
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
  const materialRules = puzzleMaterialRules(parsed.rules, required);
  const itemRules = [...parsed.rules, ...materialRules].filter(rule => itemKinds.has(rule.kind));
  // Validate against the safe input pool, not the propagated pool: a known
  // traversal preference can lose all members without becoming malformed.
  if (!isFc27PuzzleSearchHintValid(searchHint, pool.candidates, clubLinks)) {
    return blocked('FC27_PUZZLE_STRATEGY_INVALID');
  }
  let candidates = filterUnaryCandidates(pool.candidates, itemRules, required, groupMatcher, resolveClub);
  let traversalScores = null;
  if (searchHint?.strategy !== 'low-rating' && parsed.rules.some(rule => ['min-chemistry', 'exact-chemistry'].includes(rule.kind) && rule.value > 0)) {
    // A traversal heuristic only: prefer connected groups, never filter by
    // this score or infer feasibility from it. Keep the configured pile order.
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
      || Number(group(b) === searchHint.groupId) - Number(group(a) === searchHint.groupId));
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
  if (forced.size && parsed.rules.some(rule => rule.kind.endsWith('-chemistry'))) {
    candidates = candidates.slice().sort((a, b) => Number(forced.has(b)) - Number(forced.has(a)));
  }
  const metrics = { safeCandidates: candidates.length, excluded: pool.excluded, excludedByReason: pool.excludedByReason };
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
      || Number(preferredGroup(b)) - Number(preferredGroup(a))
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
  const slots = Array.from({ length: challenge.slotCount }, (_, index) => index).filter(index => !challenge.brickIndices.includes(index));
  const chosen = []; const definitions = new Set(); let nodes = 0; let found = null; let unavailable = null; let exhausted = false;
  let deferredPlacements = false;
  let spent = 0; let purchases = 0; let best = null;
  // Optimistic suffix cost bounds ignore uniqueness and rule conflicts, so they
  // can only underestimate remaining spend. They never prove market shortage.
  const cheapest = procurement ? Array(candidates.length + 1) : null;
  if (procurement) cheapest[candidates.length] = [];
  if (procurement) for (let i = candidates.length - 1; i >= 0; i--) {
    cheapest[i] = [...cheapest[i + 1], costs[i]].sort((a, b) => a - b).slice(0, required);
  }
  const finished = () => found && !procurement || best?.cost === 0;
  const search = { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
  const reportProgress = (force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && (nodes % 256 !== 0 || now - lastProgressAt < 100)) return;
    lastProgressAt = now;
    try { onProgress({ phase: lastNodeKind, nodes, maxNodes, search: { ...search },
      safeCandidates: candidates.length, required }); } catch { /* Progress presentation cannot affect the search. */ }
  };
  let lastProgressAt = 0;
  let lastNodeKind = 'combination';
  const takeNode = kind => {
    if (nodes >= maxNodes) { exhausted = true; return false; }
    nodes++; search[kind]++; lastNodeKind = kind === 'combinationNodes' ? 'combination'
      : kind === 'placementNodes' ? 'placement' : kind === 'evaluations' ? 'evaluation' : 'bounds';
    reportProgress(); return true;
  };
  const needsFacts = ruleNeedsTeamFacts(parsed.rules);
  const searchPositions = parsed.rules.some(rule => rule.kind.endsWith('-chemistry'));
  const minimumChemistry = Math.max(0, ...parsed.rules.filter(rule => ['min-chemistry', 'exact-chemistry'].includes(rule.kind))
    .map(rule => rule.value));
  const visit = function* (start) {
    if (finished() || unavailable || exhausted || !takeNode('combinationNodes')) return;
    yield;
    const remaining = required - chosen.length;
    if (procurement) {
      if (purchases > procurement.maxPurchases || spent > procurement.budget) return;
      const floor = spent + cheapest[start].slice(0, remaining).reduce((sum, cost) => sum + cost, 0);
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
    }
    if (chosen.length === required) {
      const validate = facts => matchFc27SbcRequirements({ requirements: parsed.rules, squad: chosen,
        chemistry: facts?.chemistry, teamRating: facts?.teamRating, groupMatcher, clubLinks });
      if (needsFacts) {
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
        // Share the finite budget across combinations. A difficult arrangement
        // must not consume every node before later candidate groups are tried.
        // Skipped permutations mean search-limit, never proof of no solution.
        let placementNodes = 0;
        const placementNode = kind => {
          if (placementNodes >= 256) { deferredPlacements = true; return false; }
          placementNodes++; return takeNode(kind);
        };
        const result = evaluatePlacement({ chosen, slots,
          formation: { ...challenge.formation, slotCount: challenge.slotCount }, evaluateSquad,
          takeNode: placementNode, validate, searchPositions });
        found = result.found; unavailable = result.unavailable;
      } else {
        const validation = validate({});
        if (validation.status === 'blocked') unavailable = validation.reason;
        if (validation.status === 'satisfied') found = { items: chosen.slice(), facts: { chemistry: null, teamRating: null }, validation };
      }
      if (procurement && found) {
        if (!best || spent < best.cost) best = { ...found, cost: spent, purchases };
        found = null;
      }
      return;
    }
    for (let index = start; index <= candidates.length - remaining && !finished() && !unavailable && !exhausted; index++) {
      const item = candidates[index];
      if (definitions.has(item.definitionId)) continue;
      for (const entry of counted) entry.used += Number(entry.matches[index]);
      spent += costs[index]; purchases += Number(costs[index] > 0);
      chosen.push(item); definitions.add(item.definitionId); yield* visit(index + 1); definitions.delete(item.definitionId); chosen.pop();
      spent -= costs[index]; purchases -= Number(costs[index] > 0);
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
    ...metrics, ...(procurement ? { estimatedCost: found.cost, searchComplete: !exhausted && !deferredPlacements,
      optimalWithinPool: !exhausted && !deferredPlacements } : {}),
    pending: ['EXACT_ITEM_REVALIDATION', 'MARKET_RECEIPT_IF_NEEDED', 'EXPLICIT_TRANSACTION_APPROVAL'] };
}
