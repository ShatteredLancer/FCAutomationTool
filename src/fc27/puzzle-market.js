import { collectSafeTraditionalCandidates } from './traditional-preview.js';
import { previewFc27PuzzleSquad, searchFc27PuzzleCandidates } from './puzzle-preview.js';
import { parseFc27SbcRequirements, matchFc27SbcItemRule, createFc27ClubResolver } from './sbc-requirements.js';
import { normalizeFc27PlayerCatalog, indexFc27MarketQuotes } from './market-catalog.js';

const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const stop = (reason, extra = {}) => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false,
  selected: [], selectedOwned: [], purchases: [], marketWideInfeasibilityProven: false, ...extra });
const recoverable = new Set(['SAFE_MATERIAL_SHORTAGE', 'FC27_PUZZLE_CONSTRAINT_SHORTAGE',
  'FC27_PUZZLE_SEARCH_LIMIT', 'FC27_PUZZLE_NO_PLAN_FOUND']);

export function normalizeFc27MarketPolicy(input) {
  const keys = ['budget', 'maxPurchases', 'maxUnitPrice', 'minimumRetainedCoins', 'availableCoins'];
  if (!input || Object.keys(input).sort().join() !== keys.sort().join()
      || !integer(input.budget, 0, 10000000) || !integer(input.maxPurchases, 0, 11)
      || !integer(input.maxUnitPrice, 0, 10000000) || !integer(input.minimumRetainedCoins, 0, 100000000)
      || !integer(input.availableCoins, 0, 100000000)) return null;
  return { ...input, effectiveBudget: Math.max(0, Math.min(input.budget, input.availableCoins - input.minimumRetainedCoins)) };
}

function diversePool(entries, { rules, required, owned, resolveClub, limit, preferredRefs }) {
  const byPrice = entries.slice().sort((a, b) => a.quote.price - b.quote.price || a.definitionId - b.definitionId);
  const lanes = [byPrice];
  if (preferredRefs.length) lanes.unshift(preferredRefs.map(ref => entries.find(entry => entry.catalogRef === ref)).filter(Boolean));
  // Include scarce predicates and connected routes without filtering fillers.
  for (const rule of rules) {
    const matches = byPrice.filter(item => matchFc27SbcItemRule(rule, item, undefined, resolveClub) === true);
    if (matches.length) lanes.push(matches);
  }
  for (const field of ['nationId', 'leagueId', 'teamId']) {
    const read = item => field === 'teamId' ? resolveClub?.(item.teamId) : item[field];
    const groups = new Map();
    for (const item of owned) { const key = read(item); groups.set(key, (groups.get(key) ?? 0) + 1); }
    const keys = [...groups].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8).map(([key]) => key);
    for (const key of keys) lanes.push(byPrice.filter(item => read(item) === key));
    // A new connected route may replace several owned cards at lower cost.
    const marketGroups = new Map();
    for (const item of byPrice) { const key = read(item); if (!marketGroups.has(key)) marketGroups.set(key, []); marketGroups.get(key).push(item); }
    lanes.push(...[...marketGroups.values()].sort((a, b) =>
      Math.min(required, b.length) - Math.min(required, a.length) || a[0].quote.price - b[0].quote.price).slice(0, 8));
  }
  for (let p = 0; p < 28; p++) { const lane = byPrice.filter(item => item.positions.includes(p)); if (lane.length) lanes.push(lane); }
  const selected = new Map();
  for (let depth = 0; depth < byPrice.length && selected.size < limit; depth++) {
    for (const lane of lanes) {
      if (selected.size >= limit) break;
      if (lane[depth]) selected.set(lane[depth].catalogRef, lane[depth]);
    }
  }
  return [...selected.values()];
}

export function prepareFc27MarketCandidates(input) {
  const { challenge, context, inventory, policy, now, catalog, quotes, marketPolicy, poolLimit = 96, preferredRefs = [] } = input;
  const required = challenge?.slotCount - (challenge?.brickIndices?.length ?? NaN);
  const pool = collectSafeTraditionalCandidates({ context, inventory, policy, challenge: { ...challenge,
    mechanism: 'traditional', requirements: [{ kind: 'player-count', count: required }] } });
  if (pool.status !== 'candidates') return pool;
  const caps = normalizeFc27MarketPolicy(marketPolicy);
  if (!caps || !integer(poolLimit, 1, 256) || !Array.isArray(preferredRefs) || preferredRefs.length > 32
      || new Set(preferredRefs).size !== preferredRefs.length) return stop('FC27_MARKET_POLICY_INVALID');
  if (policy.onlyUntradeable) return stop('FC27_MARKET_ONLY_UNTRADEABLE_POLICY');
  const normalized = normalizeFc27PlayerCatalog(catalog, now);
  if (normalized.status !== 'ready') return normalized;
  const parsed = parseFc27SbcRequirements(challenge.rawRequirements, required);
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const resolveClub = createFc27ClubResolver(input.clubLinks);
  const quoteIndex = indexFc27MarketQuotes(quotes, { now, platform: context.platform, maxUnitPrice: caps.maxUnitPrice });
  if (!quoteIndex) return stop('FC27_MARKET_QUOTES_UNAVAILABLE');
  const ownedDefinitions = new Set(inventory.items.map(item => item.definitionId));
  const eligible = normalized.catalog.entries.filter(item => item.marketable && !item.special && !item.evolution && !item.cosmetic
    && [0, 1].includes(item.rarity) && item.rating <= policy.maxRating
    && (item.rating < 75 || item.rating >= policy.goldRange[0] && item.rating <= policy.goldRange[1])
    && !policy.excludedLeagueIds.includes(item.leagueId) && !ownedDefinitions.has(item.definitionId));
  const priced = eligible.filter(item => quoteIndex.has(item.definitionId))
    .map(item => ({ ...item, type: 'player', source: 'catalog', concept: false, academyEnrolled: false,
      quote: quoteIndex.get(item.definitionId) }));
  // Unknown dynamic groups are not converted into false or an empty group list.
  const known = priced.filter(item => parsed.rules.every(rule => !['rarity-group'].includes(rule.kind) || item.groups !== null));
  if (preferredRefs.some(ref => !known.some(item => item.catalogRef === ref))) return stop('FC27_MARKET_CANDIDATE_REF_INVALID');
  if (!known.length) return stop(!eligible.length ? 'FC27_MARKET_NO_ELIGIBLE_CANDIDATES'
    : priced.length ? 'FC27_MARKET_CANDIDATE_FACTS_UNAVAILABLE' : 'FC27_MARKET_QUOTES_UNAVAILABLE');
  const market = diversePool(known, { rules: parsed.rules, required, owned: pool.candidates, resolveClub, limit: poolLimit, preferredRefs });
  return { status: 'ready', pool, caps, market, queryCandidates: known, catalog: normalized.catalog,
    coverage: { catalogEntries: normalized.catalog.entries.length, catalogComplete: normalized.catalog.complete,
      eligible: eligible.length, priced: priced.length, known: known.length, selectedCandidates: market.length,
      truncated: market.length < known.length, unavailableQuotes: eligible.length - priced.length } };
}

// Procurement is a hypothesis, never a fabricated InventorySnapshot. Its output
// deliberately has no executable selected array or EA item IDs for purchases.
export function previewFc27PuzzleMarket(input = {}) {
  const maxNodes = input.maxNodes ?? 50000;
  if (!integer(maxNodes, 1, 250000)) return stop('FC27_PUZZLE_BUDGET_INVALID');
  // Reserve search for the joint plan. Owned-only exhaustion proves neither
  // shortage nor that a purchase is needed, and must not starve procurement.
  const baseline = previewFc27PuzzleSquad({ ...input, maxNodes: Math.max(1, Math.floor(maxNodes / 3)) });
  if (baseline.status === 'preview') return { ...stop('FC27_MARKET_PLAN_PREVIEW'), status: 'preview',
    selectedOwned: baseline.selected, purchaseCount: 0, estimatedCost: 0, teamFacts: baseline.teamFacts,
    nodes: baseline.nodes, requiresPurchasedMaterialApproval: false, marketAvailabilityVerified: false,
    optimization: { objective: 'additional-coins', searchComplete: true, optimalWithinPool: true, globalMinimumProven: true }, baselineReason: baseline.reason };
  if (!recoverable.has(baseline.reason)) return stop(baseline.reason, { baselineReason: baseline.reason });
  const prepared = prepareFc27MarketCandidates(input);
  if (prepared.status !== 'ready') return stop(prepared.reason, { baselineReason: baseline.reason });
  const remaining = maxNodes - (baseline.nodes ?? 0);
  if (remaining <= 0) return stop('FC27_PUZZLE_SEARCH_LIMIT', { nodes: maxNodes, baselineReason: baseline.reason });
  const { pool, caps, market, coverage } = prepared;
  const costs = new Map(market.map(item => [item, item.quote.price]));
  const result = searchFc27PuzzleCandidates({ ...input, maxNodes: remaining,
    pool: { ...pool, candidates: [...pool.candidates, ...market] },
    procurement: { budget: caps.effectiveBudget, maxPurchases: caps.maxPurchases, costOf: item => costs.get(item) ?? 0 } });
  const nodes = (baseline.nodes ?? 0) + (result.nodes ?? 0);
  if (result.status !== 'preview') return stop(recoverable.has(result.reason) && result.reason !== 'FC27_PUZZLE_SEARCH_LIMIT'
    ? 'FC27_MARKET_POOL_NO_PLAN' : result.reason, { baselineReason: baseline.reason, searchReason: result.reason, coverage, nodes });
  const byRef = new Map(market.map(item => [item.catalogRef, item]));
  const purchases = result.selected.filter(item => item.catalogRef).map(ref => {
    const item = byRef.get(ref.catalogRef);
    return { catalogRef: item.catalogRef, definitionId: item.definitionId, season: '27', platform: input.context.platform,
      rating: item.rating, slot: ref.slot, quantity: 1, estimatedUnitPrice: item.quote.price,
      maxUnitPrice: item.quote.price, quoteSource: item.quote.source, quoteObservedAt: item.quote.observedAt };
  });
  return { ...stop('FC27_MARKET_PLAN_PREVIEW'), status: 'preview', setId: input.challenge.setId, challengeId: input.challenge.id,
    selectedOwned: result.selected.filter(item => !item.catalogRef), purchases, purchaseCount: purchases.length,
    estimatedCost: result.estimatedCost, budget: caps.effectiveBudget, minimumRetainedCoins: caps.minimumRetainedCoins,
    teamFacts: result.teamFacts, validation: result.validation, coverage, nodes, baselineReason: baseline.reason,
    requiresPurchasedMaterialApproval: purchases.length > 0, marketAvailabilityVerified: false,
    optimization: { objective: 'additional-coins', searchComplete: result.searchComplete, optimalWithinPool: result.optimalWithinPool, globalMinimumProven: result.estimatedCost === 0 },
    pending: ['LIVE_AUCTION_RECHECK', 'EXPLICIT_PURCHASE_AND_MATERIAL_APPROVAL', 'EXACT_PURCHASE_RECEIPTS',
      'FRESH_INVENTORY_REPLAN', 'EXACT_ITEM_REVALIDATION', 'EXPLICIT_SBC_APPROVAL'] };
}
