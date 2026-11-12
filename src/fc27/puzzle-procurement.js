import { iterateFc27PuzzleSquad, iterateFc27PuzzleCandidateRoutes,
  finishPuzzleSearch, finishPuzzleSearchCooperatively, isFc27PuzzleSearchBudget } from './puzzle-preview.js';
import { planFc27MarketQueryRoute, allowedFc27MarketTiers } from './market-query-route.js';
import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { evaluateFc27PuzzleSquad, createFc27PuzzlePartialChemistryBound } from './puzzle-evaluator.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements, createFc27ClubResolver } from './sbc-requirements.js';
import { puzzleMaterialRules } from './puzzle-material-policy.js';
import { MAX_PUZZLE_QUOTE_PRICE } from './puzzle-procurement-policy.js';
import { planPuzzleNationalityAffinity,planPuzzleLeagueMinimumAffinity,planPuzzleNationalMinimumAffinity } from './puzzle-query-affinity.js';
import { planPuzzleCappedNationClubFillers } from './puzzle-club-diversity-route.js';
import { comparePuzzlePlans } from './puzzle-plan-ranking.js';

const seeds = new WeakMap();
const stop = reason => ({ status: 'blocked', reason, executable: false, plans: [] });
const positive = value => Number.isSafeInteger(value) && value > 0;
const signature = input => JSON.stringify([input.context, input.challenge, input.policy, input.inventory, input.chemistry, input.clubLinks]);
const required = input => input.challenge.slotCount - input.challenge.brickIndices.length;
const poolOf = input => collectSafeTraditionalCandidates({ ...input, challenge: { ...input.challenge,
  mechanism: 'traditional', requirements: [{ kind: 'player-count', count: required(input) }] } });
export const puzzleOwnedValueCandidates = input => {
  const pool = poolOf(input);
  return pool.status === 'candidates' ? priceEligiblePositions(input, pool.candidates) : [];
};
// With ordinary 3-point chemistry, e.g. 20/7, even ONE off-position card
// makes the native minimum unreachable (6*3 < 20). Only prune after the
// existing native-config validator can establish that bound; otherwise keep
// the original pool, including low-chemistry challenges and unknown profiles.
function priceEligiblePositions(input, candidates) {
  try {
    const count = required(input), parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, count);
    if (parsed.status !== 'observed') return candidates;
    const minimum = Math.max(0, ...parsed.rules.filter(rule => ['min-chemistry', 'exact-chemistry'].includes(rule.kind)).map(rule => rule.value));
    if (minimum <= 3 * (count - 1)) return candidates;
    const slots = input.challenge.formation.positions.flatMap((_position, index) => input.challenge.brickIndices.includes(index) ? [] : [index]);
    if (!createFc27PuzzlePartialChemistryBound({ candidates, slots, formation: input.challenge.formation, chemistry: input.chemistry })) return candidates;
    return candidates.filter(card => slots.some(slot => card.positions.includes(input.challenge.formation.positions[slot])));
  } catch { return candidates; }
}
export const puzzleMarketValueCandidates = (input, entries) => priceEligiblePositions(input, marketCandidates(input, entries));
const validValue = value => Number.isSafeInteger(value) && value >= 150 && value <= MAX_PUZZLE_QUOTE_PRICE;
const candidateKey = item => item.catalogRef ?? item.id;
// A Club item and a market concept can share the same definitionId while
// having different economic meaning.  Never collapse those prices into one
// definitionId map: an owned 84 is valued from inventory, whereas a market 84
// is valued from its purchase quote.
const priceFor = (prices, item) => {
  if (!prices || !item) return null;
  if (typeof prices === 'function') return prices(item);
  if (prices instanceof Map) {
    const byIdentity = prices.get(candidateKey(item));
    if (Number.isFinite(byIdentity)) return byIdentity;
    return prices.get(item.definitionId);
  }
  return null;
};
const qualityRank = rating => rating < 65 ? 1 : rating < 75 ? 2 : 3;
const sameCandidateRef = (candidate, ref) => candidate && ref
  && candidateKey(candidate) === candidateKey(ref)
  && candidate.definitionId === ref.definitionId
  && candidate.rating === ref.rating
  && (candidate.catalogRef || candidate.pile === ref.pile);
const selectedRef = (item, slot) => item.catalogRef ? { catalogRef: item.catalogRef,
  definitionId: item.definitionId, rating: item.rating, slot } : {
  id: item.id, definitionId: item.definitionId, pile: item.pile, rating: item.rating, slot };
function verifiedIncumbent(input, preview, candidates, prices, cashMode = false, onFailure = null) {
  const reject = reason => { try { onFailure?.(reason); } catch { /* diagnostics only */ } return null; };
  if (preview?.status !== 'preview' || !Array.isArray(preview.selected) || preview.selected.length !== required(input)) return reject('preview-shape');
  const squad = Array(input.challenge.slotCount).fill(null);
  for (const ref of preview.selected) {
    const item = candidates.find(candidate => sameCandidateRef(candidate, ref));
    if (!item) return reject('candidate-identity');
    if (!(validValue(priceFor(prices, item)) || cashMode && !item.catalogRef && priceFor(prices, item) === 0)) return reject('candidate-price');
    if (!Number.isInteger(ref.slot) || ref.slot < 0 || ref.slot >= squad.length
        || input.challenge.brickIndices.includes(ref.slot) || squad[ref.slot]) return reject('slot');
    squad[ref.slot] = { ...item, slot: ref.slot };
  }
  if (new Set(squad.filter(Boolean).map(item => item.definitionId)).size !== required(input)) return reject('duplicate-definition');
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
  let facts;
  try {
    // Puzzles without chemistry/rating requirements intentionally do not
    // expose an evaluator from the page reader.  Their incumbent is still
    // fully verifiable against the parsed player/quality rules; treating a
    // missing evaluator as an exception used to discard the owned baseline
    // and fall back to the 20k node market search.
    facts = typeof input.evaluateSquad === 'function'
      ? input.evaluateSquad(structuredClone(squad))
      : { status: 'observed', chemistry: null, teamRating: null };
  } catch { return reject('evaluate-error'); }
  const validation = parsed.status === 'observed' && facts?.status === 'observed'
    ? matchFc27SbcRequirements({ requirements: parsed.rules, squad: squad.filter(Boolean), chemistry: facts.chemistry,
      teamRating: facts.teamRating, groupMatcher: input.groupMatcher, clubLinks: input.clubLinks }) : null;
  if (validation?.status !== 'satisfied') return reject(validation?.status === 'unknown' ? 'validation-unknown' : 'validation-failed');
  return { status: 'preview', selected: squad.flatMap((item, slot) => item ? [selectedRef(item, slot)] : []),
    validation, teamFacts: { chemistry: facts.chemistry, teamRating: facts.teamRating } };
}
// Keep the feasible arrangement as an incumbent. Cheap single-slot changes
// should not depend on rediscovering the other ten cards in a global DFS.
function* iterateOwnedReplacements(input, preview, candidates, prices, onProgress, maxNodes = 4000, totalNodes = 20000,
  { allowEqualPriceQualityDowngrade = false, reuseOwnedOnly = false } = {}) {
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
  if (parsed.status !== 'observed') return { preview, nodes: 0 };
  let current = preview; let nodes = 0; let improved = true;
  const byId = new Map(candidates.map(item => [candidateKey(item), item]));
  const ordered = candidates.filter(item => !reuseOwnedOnly || !item.catalogRef).sort((a, b) => (allowEqualPriceQualityDowngrade
    ? qualityRank(a.rating) - qualityRank(b.rating) : 0)
    || priceFor(prices, a) - priceFor(prices, b) || a.definitionId - b.definitionId);
  // Compare a replacement against the current incumbent using the same
  // detached-plan ordering as the caller.  This matters for minimum-quality
  // SBCs: a silver can have the same reference value as a gold, so a strict
  // coin comparison would discard the lower-quality route even though it is
  // the material-value objective's preferred result.
  const metrics = selected => {
    const owned = selected.filter(ref => !ref.catalogRef);
    const purchases = selected.filter(ref => ref.catalogRef);
    const inventoryValue = owned.reduce((sum, ref) => sum + (priceFor(prices,
      byId.get(candidateKey(ref)) ?? ref) ?? 0), 0);
    const estimatedCost = purchases.reduce((sum, ref) => sum + (priceFor(prices,
      byId.get(candidateKey(ref)) ?? ref) ?? 0), 0);
    return { selectedOwned: owned, purchases, inventoryValue, estimatedCost,
      materialValue: inventoryValue + estimatedCost, purchaseCount: purchases.length };
  };
  // Reserve a portion of the local budget for chemistry-preserving two-card
  // exchanges. A wide pool could otherwise spend all nodes on single swaps,
  // never trying the silver-plus-gold pair that preserves chemistry.
  const singleNodeLimit = reuseOwnedOnly ? maxNodes : Math.min(maxNodes, Math.max(128, Math.floor(maxNodes * 0.4)));
  while (improved && nodes < maxNodes) {
    improved = false;
    const singleRefs = current.selected.filter(ref => !reuseOwnedOnly || ref.catalogRef)
      .sort((a, b) => priceFor(prices, b) - priceFor(prices, a));
    for (const [refIndex, ref] of singleRefs.entries()) {
      // Every slot gets a share before paired search. A wide cheap pool must
      // not spend the entire single-swap budget on the first few players.
      const slotLimit = nodes + Math.ceil((singleNodeLimit - nodes) / (singleRefs.length - refIndex));
      for (const candidate of ordered) {
        const candidatePrice = priceFor(prices, candidate), incumbentPrice = priceFor(prices,
          candidates.find(item => candidateKey(item) === candidateKey(ref)) ?? ref);
        // Equal total material value can still reduce cash spend by replacing
        // a concept with an owned card, even within the same quality tier.
        // The complete plan comparator below remains the authority for ties.
        if (candidatePrice > incumbentPrice) continue;
        if (candidatePrice === incumbentPrice && (!allowEqualPriceQualityDowngrade
            || !(ref.catalogRef && !candidate.catalogRef)
              && qualityRank(candidate.rating) >= qualityRank(ref.rating))) continue;
        if (nodes >= slotLimit) break;
        if (current.selected.some(other => other.definitionId === candidate.definitionId)) continue;
        nodes++;
        const selected = current.selected.map(other => other.slot === ref.slot
          ? selectedRef(candidate, ref.slot) : other);
        const squad = Array(input.challenge.slotCount).fill(null);
        for (const other of selected) squad[other.slot] = { ...byId.get(candidateKey(other)), slot: other.slot };
        let facts;
        try { facts = typeof input.evaluateSquad === 'function'
          ? input.evaluateSquad(structuredClone(squad))
          : { status: 'observed', chemistry: null, teamRating: null }; } catch { facts = null; }
        const validation = facts?.status === 'observed' ? matchFc27SbcRequirements({ requirements: parsed.rules,
          squad: squad.filter(Boolean), chemistry: facts.chemistry, teamRating: facts.teamRating,
          groupMatcher: input.groupMatcher, clubLinks: input.clubLinks }) : null;
        if (validation?.status === 'satisfied') {
          const candidatePlan = metrics(selected);
          const currentPlan = metrics(current.selected);
          if (comparePuzzlePlans(candidatePlan, currentPlan, allowEqualPriceQualityDowngrade
            ? 'material-value' : 'additional-coins') < 0) {
            current = { ...current, selected, validation, teamFacts: { chemistry: facts.chemistry, teamRating: facts.teamRating } };
            improved = true;
          }
        }
        if (nodes % 128 === 0) {
          try { onProgress?.({ phase: 'owned-value-search', nodes, maxNodes: totalNodes }); } catch { /* Presentation only. */ }
        }
        yield;
        if (improved) break;
      }
      if (improved || nodes >= singleNodeLimit) break;
    }
    // Chemistry and group constraints can make either half of a two-card
    // exchange invalid on its own. Try bounded paired replacements after the
    // single-card pass; each candidate squad still goes through the complete
    // EA requirement/evaluator contract before it can become the incumbent.
    if (!reuseOwnedOnly && !improved && nodes < maxNodes) {
      const refs = current.selected.slice().sort((a, b) => priceFor(prices, b) - priceFor(prices, a));
      function* assignments(first, second) {
        const currentCost = priceFor(prices, byId.get(candidateKey(first)) ?? first)
          + priceFor(prices, byId.get(candidateKey(second)) ?? second);
        const occupied = new Set(current.selected.filter(ref => ref.slot !== first.slot && ref.slot !== second.slot)
          .map(ref => ref.definitionId));
        const replacements = ordered.filter(candidate => !occupied.has(candidate.definitionId)
          && candidate.definitionId !== first.definitionId && candidate.definitionId !== second.definitionId);
        for (let a = 0; a < replacements.length; a++) {
          const candidateA = replacements[a], priceA = priceFor(prices, candidateA);
          if (priceA >= currentCost) continue;
          for (let b = a + 1; b < replacements.length; b++) {
            const candidateB = replacements[b], priceB = priceFor(prices, candidateB);
            if (priceA + priceB > currentCost || (!allowEqualPriceQualityDowngrade && priceA + priceB >= currentCost)
                || candidateA.definitionId === candidateB.definitionId) continue;
            for (const assignment of [[candidateA, candidateB], [candidateB, candidateA]]) {
              yield current.selected.map(ref => ref.slot === first.slot
                ? selectedRef(assignment[0], first.slot) : ref.slot === second.slot
                  ? selectedRef(assignment[1], second.slot) : ref);
            }
          }
        }
      }
      // Material-value refinement gives every slot pair a turn. Unused
      // capacity returns to exact cursors without repeating a check. Cash-only
      // search retains its established traversal and known purchase routes.
      const pairs = refs.flatMap((first, index) => refs.slice(index + 1).map(second => assignments(first, second)));
      try {
        while (pairs.length && nodes < maxNodes && !improved) {
          const quantum = allowEqualPriceQualityDowngrade
            ? Math.max(2, Math.floor((maxNodes - nodes) / pairs.length)) : maxNodes - nodes;
          for (let index = 0; index < pairs.length && nodes < maxNodes && !improved; index++) {
            const pair = pairs[index], limit = Math.min(maxNodes, nodes + quantum);
            while (nodes < limit && !improved) {
              const step = pair.next();
              if (step.done) { pairs.splice(index--, 1); break; }
              const selected = step.value, squad = Array(input.challenge.slotCount).fill(null);
              for (const ref of selected) squad[ref.slot] = { ...byId.get(candidateKey(ref)), slot: ref.slot };
              nodes++;
              let facts;
              try { facts = typeof input.evaluateSquad === 'function'
                ? input.evaluateSquad(structuredClone(squad))
                : { status: 'observed', chemistry: null, teamRating: null }; } catch { facts = null; }
              const validation = facts?.status === 'observed' ? matchFc27SbcRequirements({ requirements: parsed.rules,
                squad: squad.filter(Boolean), chemistry: facts.chemistry, teamRating: facts.teamRating,
                groupMatcher: input.groupMatcher, clubLinks: input.clubLinks }) : null;
              if (validation?.status === 'satisfied') {
                const candidatePlan = metrics(selected), currentPlan = metrics(current.selected);
                if (comparePuzzlePlans(candidatePlan, currentPlan, allowEqualPriceQualityDowngrade
                  ? 'material-value' : 'additional-coins') < 0) {
                  current = { ...current, selected, validation,
                    teamFacts: { chemistry: facts.chemistry, teamRating: facts.teamRating } };
                  improved = true;
                }
              }
              if (nodes % 128 === 0) {
                try { onProgress?.({ phase: 'owned-value-search', nodes, maxNodes: totalNodes }); } catch { /* Presentation only. */ }
              }
              yield;
            }
          }
        }
      } finally { for (const pair of pairs) pair.return?.(); }
    }
  }
  return { preview: current, nodes };
}
// Price refinement is detached planning only. Its budget is material value,
// never a purchase allowance, and the original feasible squad is an incumbent.
export async function refineFc27PuzzleOwnedValue(input, preview, materialPrices, options = {}) {
  const pool = poolOf(input);
  if (preview?.status !== 'preview' || pool.status !== 'candidates' || !(materialPrices instanceof Map)) return preview;
  // A preview may carry either a Club entity id or a catalog reference.  The
  // former implementation only looked at `id`, which silently discarded a
  // valid incumbent when the detached solver returned a catalog-shaped ref.
  // Resolve with the same identity contract used by the market incumbent and
  // replacement loop, including definition/rating/pile guards.
  const candidates = [...pool.candidates, ...(Array.isArray(options.candidates) ? options.candidates : [])];
  const selected = preview.selected.map(ref => candidates.find(item => sameCandidateRef(item, ref)));
  if (selected.some(item => !item || !validValue(materialPrices.get(item.definitionId)))) return { ...preview,
    materialValue: null, valueReason: 'FC27_PUZZLE_VALUE_INCOMPLETE' };
  const baselineValue = selected.reduce((sum, item) => sum + materialPrices.get(item.definitionId), 0);
  const objective = 'material-value';
  const pricedCandidates = candidates.filter(item => validValue(priceFor(materialPrices, item)));
  const localNodeLimit = Number.isSafeInteger(options.localNodeLimit) ? options.localNodeLimit : 4000;
  const local = await finishPuzzleSearchCooperatively(iterateOwnedReplacements(input, preview, pricedCandidates, materialPrices,
    options.onProgress, localNodeLimit, localNodeLimit, { allowEqualPriceQualityDowngrade: true }), options);
  const localValue = local.preview.selected.reduce((sum, item) => sum + priceFor(materialPrices,
    pricedCandidates.find(candidate => sameCandidateRef(candidate, item)) ?? item), 0);
  if (options.localOnly === true) return { ...preview, ...local.preview, materialValue: localValue,
    inventoryValue: localValue, initialMaterialValue: baselineValue, nodes: local.nodes, maxNodes: localNodeLimit,
    searchComplete: false, optimalWithinPool: false, valueSearchComplete: false,
    valueCandidateCount: pricedCandidates.length, valueReason: 'FC27_PUZZLE_MATERIAL_VALUE_LOCAL_REFINED' };
  const result = await finishPuzzleSearchCooperatively(iterateFc27PuzzleCandidateRoutes({ ...input,
    pool: { ...pool, candidates: pricedCandidates }, maxNodes: Math.max(1, 20000 - local.nodes),
    onProgress: value => options.onProgress?.({ ...value, nodes: local.nodes + value.nodes, maxNodes: 20000 }),
    procurement: { budget: localValue, maxPurchases: required(input), priceAware: true,
      objective,
      costOf: item => priceFor(materialPrices, item) } }), options);
  const better = result.status === 'preview' && result.materialValue < localValue;
  const { estimatedCost: ignoredEstimate, ...refined } = better ? result : local.preview;
  void ignoredEstimate;
  return { ...preview, ...refined, materialValue: better ? result.materialValue : localValue,
    inventoryValue: better ? result.materialValue : localValue, initialMaterialValue: baselineValue,
    nodes: local.nodes + (result.nodes ?? 0), maxNodes: 20000,
    search: { ...result.search, evaluations: local.nodes + (result.search?.evaluations ?? 0) },
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
  const candidates = prices instanceof Map ? puzzleMarketValueCandidates(input, entries) : marketCandidates(input, entries);
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
  // Keep an explicit identity requirement in the bounded market sample when
  // the safe inventory cannot satisfy it.  The previous chemistry branch
  // spent its second/third page on a dominant owned nation or league, even
  // when the challenge explicitly required a league (Marquee 121) or nation.
  // That made a valid market route look like a generic filler route.  This is
  // query prioritisation only; it does not claim that the sampled pages prove
  // a complete solution.
  const identityField = kind => ({ 'from-nations': 'nationId', 'from-leagues': 'leagueId', 'from-clubs': 'teamId' })[kind];
  const identityShortageQueries = (candidates, level, resolveClub) => {
    const rules = parsed.rules.filter(rule => rule.mode === 'min' && rule.count > 0
      && ['from-nations', 'from-leagues', 'from-clubs'].includes(rule.kind));
    const lanes = [];
    for (const rule of rules) {
      const field = identityField(rule.kind);
      const ids = [...new Set(rule.ids.filter(positive))];
      // EA club links apply to compulsory identities as well as chemistry.
      // Keep the original ID in the query, but count a linked club's safe
      // owned/public versions toward the same requirement.
      const identity = id => rule.kind === 'from-clubs' ? resolveClub(id) : id;
      const groups = new Set(ids.map(identity));
      const queryField = field.replace('Id', '');
      // The branch may already have reserved the best lane for this rule.
      // Do not spend another bounded page on the same identity merely because
      // the level differs (a common silver/gold duplication in Marquee 120).
      if (queries.some(query => positive(query?.[queryField]) && groups.has(identity(query[queryField])))) continue;
      const matching = candidates.filter(item => groups.has(identity(item[field])));
      const available = new Set(matching.map(item => item.definitionId)).size;
      if (available >= rule.count) continue;
      // Values in one rule are alternatives (for example either of the two
      // clubs in a Marquee fixture), so one bounded lane per rule is enough.
      // Prefer the alternative with the strongest observed support and move
      // to the next one on a continuation after its query has been used.
      const alternatives = ids.map(id => {
        const support = new Set(candidates.filter(item => identity(item[field]) === identity(id)).map(item => item.definitionId)).size;
        return { kind: rule.kind, id, support, deficit: Math.max(0, rule.count - available),
          query: { start: 0, count: 20, level, [queryField]: id } };
      }).sort((a, b) => b.support - a.support || a.id - b.id);
      const next = alternatives.find(lane => !usedQueries.some(used => JSON.stringify(used) === JSON.stringify(lane.query)))
        ?? alternatives[0];
      if (next) lanes.push(next);
    }
    return lanes.sort((a, b) => b.deficit - a.deficit || a.support - b.support
      || a.kind.localeCompare(b.kind) || a.id - b.id).map(lane => lane.query);
  };
  if (!cappedClubs && clubs.length && tiers.length === 1) {
    const resolveClub = createFc27ClubResolver(input.clubLinks);
    if (!resolveClub) return stop('FC27_PUZZLE_CLUB_LINKS_UNAVAILABLE');
    const permitted = allowedFc27MarketTiers(parsed.rules, input.policy).map(tier => tier.level).reverse();
    const candidates = [...pool.candidates, ...marketCandidates(input, entries)]
      .filter(item => permitted.includes(levelOf(quality(item.rating))));
    const unused = query => !usedQueries.some(used => JSON.stringify(used) === JSON.stringify(query));
    const push = query => { if (unused(query)) add(query); };
    // Missing-tier pages must not displace compulsory identities. Read a
    // wider allowed tier for a small club obligation, not for all fillers.
    for (const rule of clubs) {
      const groups = new Set(rule.ids.map(resolveClub));
      const matching = candidates.filter(item => groups.has(resolveClub(item.teamId)));
      if (new Set(matching.map(item => item.definitionId)).size >= rule.count) continue;
      const lane = permitted.flatMap(level => rule.ids.map(team => ({ start: 0, count: 20, level, team }))).find(unused);
      if (lane && queries.length < 2) add(lane);
    }
    // A two-club Marquee requirement is an OR identity, but either club may
    // be the only side represented by the first EA catalogue page. Reserve
    // the remaining identity lane before spending the sample on nationality
    // or chemistry fillers.  The route remains bounded to three pages.
    for (const query of identityShortageQueries(candidates, tiers[0], resolveClub)) {
      if (queries.length >= 3) break;
      add(query);
    }
    const diversified=planPuzzleCappedNationClubFillers({rules:parsed.rules,required:required(input),candidates,
      level:tiers[0],usedQueries,pendingQueries:queries,resolveClub,formation:input.challenge.formation,brickIndices:input.challenge.brickIndices});
    if(diversified){for(const query of diversified)push(query);return {status:'ready',executable:false,queries,complete:false};}
    const counts = new Map();
    for (const item of candidates) counts.set(item.nationId, (counts.get(item.nationId) ?? 0) + 1);
    const nation = nations[0] ?? [...counts].sort((a,b) => b[1]-a[1] || a[0]-b[0])[0]?.[0];
    const filler = { start: 0, count: 20, level: tiers[0], ...(positive(nation) ? { nation } : {}) };
    push(filler);
    const leagueIds = new Set(candidates.map(item => item.leagueId));
    const minimumLeagues = Math.max(0,...parsed.rules.filter(rule => rule.kind==='distinct-leagues' && rule.mode!=='max')
      .map(rule=>rule.value),...parsed.rules.filter(rule=>rule.kind==='same-league' && rule.mode==='max')
      .map(rule=>Math.ceil(required(input)/rule.value)));
    // Once the required nationality page has been covered, do not spend the
    // last page deepening a one-league pool that cannot meet diversity/caps.
    if (positive(nation) && usedQueries.some(query=>query.nation===nation && query.level===tiers[0])
        && leagueIds.size<minimumLeagues) push({start:0,count:20,level:tiers[0]});
    // Otherwise widen the same low-tier national pool. Three pages total.
    if (positive(nation)) push({ ...filler, start: 20 });
    else push({ start: 0, count: 20, level: tiers[0] });
    return { status: 'ready', executable: false, queries, complete: false };
  }
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
    // Explicit Marquee lanes take precedence over affinity fillers.  In the
    // Liverpool v Arsenal shape this reserves a page for the required league
    // after the club lane, rather than querying a dominant owned nation.
    for (const query of identityShortageQueries(candidates, level, resolveClub)) {
      if (queries.length >= 3) break;
      add(query);
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
    const dominant = parsed.rules.filter(rule => rule.kind === 'quality-count' && rule.mode !== 'max'
      && rule.qualities.length === 1 && rule.count > required(input) / 2)
      .sort((a, b) => b.count - a.count)[0];
    const leagueCap = Math.min(required(input), ...parsed.rules.filter(rule => rule.kind === 'same-league' && rule.mode !== 'min')
      .map(rule => rule.value));
    if (chemistryNeeded && dominant && leagueCap < dominant.count
        && !parsed.rules.some(rule => ['from-clubs', 'from-leagues', 'from-nations'].includes(rule.kind))) {
      // A dominant tier cannot all come from one league under its native cap.
      // Grow that tier across known dense clubs, including clubs currently
      // represented only by a lower tier. These are discovery hints, never
      // eligibility facts or proof of supply. Preserve all three read limits.
      const level = levelOf(dominant.qualities[0]);
      if (allowedFc27MarketTiers(parsed.rules, input.policy).some(tier => tier.level === level)) {
        const leagues = new Map(), groups = new Map();
        for (const item of candidates) {
          if (!positive(item.teamId) || !positive(item.leagueId)) continue;
          if (!groups.has(item.teamId)) groups.set(item.teamId, { team: item.teamId, league: item.leagueId, all: new Set(), tier: new Set() });
          const group = groups.get(item.teamId); group.all.add(item.definitionId);
          if (levelOf(quality(item.rating)) !== level) continue;
          group.tier.add(item.definitionId);
          if (!leagues.has(item.leagueId)) leagues.set(item.leagueId, new Set());
          leagues.get(item.leagueId).add(item.definitionId);
        }
        const unused = query => !usedQueries.some(used => JSON.stringify(used) === JSON.stringify(query));
        const ranked = [...groups.values()].sort((a, b) =>
          Number((leagues.get(a.league)?.size ?? 0) >= leagueCap) - Number((leagues.get(b.league)?.size ?? 0) >= leagueCap)
          || b.tier.size - a.tier.size || b.all.size - a.all.size || a.team - b.team);
        const otherMissing = missing.filter(rule => !rule.qualities.includes(dominant.qualities[0]));
        if (ranked.length && ranked.every(group => (leagues.get(group.league)?.size ?? 0) >= leagueCap)
            && [...leagues.values()].reduce((sum, ids) => sum + Math.min(leagueCap, ids.size), 0) < dominant.count) {
          const query = { start: 0, count: 20, level };
          if (unused(query)) add(query);
        }
        for (const group of ranked) {
          const query = { start: 0, count: 20, level, team: group.team };
          if (queries.length < 3 - Math.min(1, otherMissing.length) && unused(query)) add(query);
        }
        if (!queries.length) {
          const query = { start: 0, count: 20, level };
          if (unused(query)) add(query);
        }
        for (const rule of otherMissing) add({ start: 0, count: 20, level: levelOf(rule.qualities[0]) });
        if (queries.length) return { status: 'ready', executable: false, queries, complete: false };
      }
    }
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
  if(!cappedClubs && chemistryNeeded && !parsed.rules.some(rule=>['from-clubs','from-leagues','from-nations'].includes(rule.kind))){
    const nationalLane = planPuzzleNationalMinimumAffinity({ candidates: [...pool.candidates, ...marketCandidates(input, entries)],
      rules: parsed.rules, required: required(input), usedQueries,
      allowedLevels: allowedFc27MarketTiers(parsed.rules, input.policy).map(tier => tier.level),
      excludedLeagueIds: input.policy.excludedLeagueIds });
    if (nationalLane && tiers.length < 3) {
      for (const level of tiers) add({ start: 0, count: 20, level });
      add(nationalLane);
      return { status: 'ready', executable: false, queries, complete: false };
    }
    const lane=planPuzzleLeagueMinimumAffinity({candidates:[...pool.candidates,...marketCandidates(input,entries)],material,rules:parsed.rules,
      formation:input.challenge.formation,brickIndices:input.challenge.brickIndices,usedQueries,excludedLeagueIds:input.policy.excludedLeagueIds,
      resolveClub:createFc27ClubResolver(input.clubLinks)});
    if(lane){
      add({start:0,count:20,level:lane.level});add(lane);
      for(const level of tiers)if(level!==lane.level)add({start:0,count:20,level});
      return {status:'ready',executable:false,queries,complete:false};
    }
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
  costCeiling = null, incumbent = null, localOnly = false, localSearchBudget = 4000, onIncumbentCheck = null,
  searchBudget = null, reuseOwnedOnly = false } = {}) {
  if (!Array.isArray(entries) || entries.length > 60) return stop('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  if (materialPrices !== null && (!(materialPrices instanceof Map) || !(prices instanceof Map))) return stop('FC27_MARKET_POLICY_INVALID');
  if (searchBudget !== null && (!isFc27PuzzleSearchBudget(searchBudget) || incumbent || localOnly))
    return stop('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > (searchBudget?.cap ?? 50000)) return stop('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  if (!Number.isSafeInteger(localSearchBudget) || localSearchBudget < 1 || localSearchBudget > 4000)
    return stop('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  if (costCeiling !== null && (!positive(costCeiling) || costCeiling > required(input) * MAX_PUZZLE_QUOTE_PRICE))
    return stop('FC27_MARKET_POLICY_INVALID');
  const pool = poolOf(input);
  if (pool.status !== 'candidates') return stop(pool.reason);
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required(input));
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const market = prices instanceof Map ? puzzleMarketValueCandidates(input, entries) : marketCandidates(input, entries);
  // With no public candidate, only an explicitly supplied feasible incumbent
  // warrants an owned replacement pass. Ordinary shortage routes keep the
  // remote fast exit instead of repeating a futile full inventory search.
  if (!market.length && !incumbent) return { ...stop('FC27_PURCHASE_REPAIR_NO_PLAN'), marketCandidates: 0, nodes: 0,
    truncated: false, marketWideInfeasibilityProven: false };
  // Public quotes, when supplied, price the full eligible candidate pool.
  // The legacy inspection path keeps unit weights, never fabricated coins.
  const candidates = [...pool.candidates.filter(item => !materialPrices || validValue(materialPrices.get(item.definitionId))), ...market];
  // Price the exact detached candidate identity.  A market version and an
  // owned entity may share a definitionId, so a definition keyed map silently
  // overwrites the inventory value with the market quote (or vice versa).
  const allPrices = materialPrices || prices ? new Map(candidates.map(item => [candidateKey(item),
    item.catalogRef ? (prices?.get(item.definitionId) ?? null) : (materialPrices?.get(item.definitionId) ?? 0)])) : null;
  const objective = materialPrices ? 'material-value' : 'additional-coins';
  const planMetrics = plan => {
    const selected = Array.isArray(plan?.selected) ? plan.selected : [];
    const addedCost = selected.filter(ref => ref.catalogRef).reduce((sum, ref) =>
      sum + (prices?.get(ref.definitionId) ?? 0), 0);
    const inventoryValue = materialPrices ? selected.filter(ref => !ref.catalogRef).reduce((sum, ref) =>
      sum + (materialPrices.get(ref.definitionId) ?? 0), 0) : 0;
    return { estimatedCost: addedCost, purchaseCount: selected.filter(ref => ref.catalogRef).length,
      inventoryValue, ...(materialPrices ? { materialValue: addedCost + inventoryValue } : {}) };
  };
  let local = null; let localValue = Infinity; let localNodes = 0;
  if (incumbent && allPrices) {
    const verified = verifiedIncumbent(input, incumbent, candidates, allPrices, materialPrices === null,
      reason => onIncumbentCheck?.({ verified: false, reason, candidateCount: candidates.length,
        selectedCount: Array.isArray(incumbent?.selected) ? incumbent.selected.length : 0 }));
    if (verified) onIncumbentCheck?.({ verified: true, candidateCount: candidates.length,
      selectedCount: incumbent.selected.length });
    localNodes++;
    yield;
    if (verified) {
      local = yield* iterateOwnedReplacements(input, verified, candidates.filter(item => validValue(priceFor(allPrices, item))
        || !materialPrices && !item.catalogRef && priceFor(allPrices, item) === 0),
        allPrices, onProgress ? value => onProgress({ ...value, phase: 'local-market-search', nodes: value.nodes + 1 }) : null,
        Math.min(localSearchBudget, maxNodes - 1), Math.min(localSearchBudget, maxNodes - 1),
        { allowEqualPriceQualityDowngrade: Boolean(materialPrices), reuseOwnedOnly });
      localNodes += local.nodes;
      localValue = planMetrics(local.preview)[objective === 'material-value' ? 'materialValue' : 'estimatedCost'];
    }
  }
  if (localOnly && !local) {
    // This route is specifically chosen when the caller already has a native
    // verified feasible lineup. If that baseline cannot be revalidated for
    // bounded replacement, do not silently fall through to the expensive
    // 20k whole-squad DFS. The caller can retain its original verified plan;
    // diagnostics expose why replacement was skipped.
    return { ...stop('FC27_PURCHASE_INCUMBENT_UNVERIFIED'), marketCandidates: market.length,
      nodes: localNodes, localSearchNodes: 0, safeCandidates: candidates.length,
      priceSource, searchComplete: false, optimalWithinPool: false };
  }
  if (localOnly && local) {
    const plan = { ...local.preview, ...planMetrics(local.preview) };
    const squad = Array(input.challenge.slotCount).fill(null);
    for (const ref of plan.selected) squad[ref.slot] = ref.catalogRef
      ? market.find(item => item.catalogRef === ref.catalogRef)
      : pool.candidates.find(item => item.id === ref.id);
    const addedCost = prices ? squad.filter(item => item?.catalogRef)
      .reduce((sum, item) => sum + (prices.get(item.definitionId) ?? 0), 0) : plan.estimatedCost;
    const inventoryValue = materialPrices ? squad.filter(item => item && !item.catalogRef)
      .reduce((sum, item) => sum + (materialPrices.get(item.definitionId) ?? 0), 0) : null;
    const values = materialPrices ? { materialValue: addedCost + inventoryValue, inventoryValue } : {};
    return { status: 'suggested', reason: 'FC27_PURCHASE_LOCAL_REFINEMENT_READY', executable: false,
      plans: [{ ...projectSuggestion(squad, plan.teamFacts, parsed.rules.length), estimatedCost: addedCost, ...values }],
      marketCandidates: market.length, nodes: localNodes, localSearchNodes: local.nodes, truncated: true, searchComplete: false,
      optimalWithinPool: false, estimatedCost: addedCost, ...values, safeCandidates: candidates.length,
      search: { evaluations: localNodes }, priceSource, marketWideInfeasibilityProven: false };
  }
  const result = localNodes < maxNodes && localValue > 0 ? yield* iterateFc27PuzzleCandidateRoutes({ ...input, maxNodes: maxNodes - localNodes, searchBudget,
    pool: { ...pool, candidates },
    procurement: { budget: prices ? Math.min(required(input) * MAX_PUZZLE_QUOTE_PRICE,
      costCeiling === null ? Infinity : costCeiling - 1, localValue - 1) : required(input), maxPurchases: required(input),
      priceAware: prices instanceof Map, objective,
      costOf: item => item.catalogRef ? prices ? prices.get(item.definitionId) : 1
        : materialPrices ? materialPrices.get(item.definitionId) : 0 },
    onProgress: onProgress ? value => onProgress({ ...value, nodes: localNodes + value.nodes, maxNodes,
      ...(searchBudget?.snapshot() ?? {}) }) : null })
    : { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', nodes: 0 };
  const localPlan = local ? { ...local.preview, ...planMetrics(local.preview) } : null;
  const resultPlan = result.status === 'preview' ? { ...result, ...planMetrics(result) } : null;
  const useLocal = localPlan && localValue < (costCeiling ?? Infinity)
    && (!resultPlan || comparePuzzlePlans(localPlan, resultPlan, objective) <= 0);
  if (result.status !== 'preview' && !useLocal) return { ...stop(result.reason), marketCandidates: market.length,
    nodes: localNodes + (result.nodes ?? 0), localSearchNodes: local?.nodes ?? 0,
    truncated: result.reason === 'FC27_PUZZLE_SEARCH_LIMIT',
    localReason: result.reason, searchComplete: false, optimalWithinPool: false,
    safeCandidates: result.safeCandidates ?? null, search: result.search ?? null,
    priceSource };
  const winner = useLocal ? localPlan : resultPlan;
  const squad = Array(input.challenge.slotCount).fill(null);
  for (const ref of winner.selected) squad[ref.slot] = ref.catalogRef
    ? market.find(item => item.catalogRef === ref.catalogRef) : pool.candidates.find(item => item.id === ref.id);
  const addedCost = prices ? squad.filter(item => item?.catalogRef).reduce((sum, item) => sum + prices.get(item.definitionId), 0)
    : winner.estimatedCost;
  const inventoryValue = materialPrices ? squad.filter(item => item && !item.catalogRef)
    .reduce((sum, item) => sum + (materialPrices.get(item.definitionId) ?? 0), 0) : null;
  const values = materialPrices ? { materialValue: addedCost + inventoryValue, inventoryValue } : {};
  return { status: 'suggested', reason: 'FC27_PURCHASE_SUGGESTIONS_READY', executable: false,
    localSearchNodes: local?.nodes ?? 0,
    plans: [{ ...projectSuggestion(squad, winner.teamFacts, parsed.rules.length),
      estimatedCost: addedCost, ...values }], marketCandidates: market.length, nodes: localNodes + (result.nodes ?? 0),
    truncated: useLocal || result.searchComplete === false, searchComplete: !useLocal && result.searchComplete === true,
    optimalWithinPool: !useLocal && result.optimalWithinPool === true, estimatedCost: addedCost, ...values,
    safeCandidates: result.safeCandidates ?? null, routeBudgets: result.routeBudgets ?? null,
    search: { ...result.search, evaluations: localNodes + (result.search?.evaluations ?? 0) },
    priceSource, marketWideInfeasibilityProven: false };
}
