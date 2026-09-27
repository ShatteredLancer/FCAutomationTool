import { previewFc27PuzzleMarket, prepareFc27MarketCandidates } from './puzzle-market.js';
import { parseFc27SbcRequirements, createFc27ClubResolver } from './sbc-requirements.js';

const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const stop = reason => ({ status: 'blocked', reason, liveExecutionEnabled: false });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function summarizeFc27MarketPlan(plan) {
  return { status: plan.status, reason: plan.reason, nodes: plan.nodes ?? 0,
    selectedCount: (plan.selectedOwned?.length ?? 0) + (plan.purchases?.length ?? 0),
    purchaseCount: plan.purchaseCount ?? null, estimatedCost: plan.estimatedCost ?? null,
    chemistry: plan.teamFacts?.chemistry ?? null, teamRating: plan.teamFacts?.teamRating ?? null,
    optimalWithinPool: plan.optimization?.optimalWithinPool === true };
}

// All precise owned refs remain in this closure. AI selects a bounded group
// query; the local planner alone selects versions and compares total cash spend.
export function createFc27PuzzleMarketSession(input, { nodesPerAttempt = 50000, totalNodes = 150000 } = {}) {
  if (!integer(nodesPerAttempt, 1, 50000) || !integer(totalNodes, nodesPerAttempt, 200000)) return stop('FC27_LLM_INPUT_INVALID');
  const { evaluateSquad, boundSquad, groupMatcher, ...data } = input;
  const snapshot = freeze(structuredClone(data));
  const prepared = prepareFc27MarketCandidates(snapshot);
  if (prepared.status !== 'ready') return prepared;
  const required = prepared.pool.required;
  const parsed = parseFc27SbcRequirements(snapshot.challenge.rawRequirements, required);
  if (parsed.status !== 'observed') return stop(parsed.reason);
  const resolveClub = createFc27ClubResolver(snapshot.clubLinks);
  const readers = { nation: item => item.nationId, league: item => item.leagueId, club: item => resolveClub?.(item.teamId) };
  const groups = {}; const lanes = {};
  for (const [name, read] of Object.entries(readers)) {
    const map = new Map(); const versions = new Map();
    for (const item of [...prepared.pool.candidates, ...prepared.queryCandidates]) {
      const id = read(item); if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) continue;
      if (!map.has(id)) { map.set(id, { id, owned: new Set(), market: new Set(), minPrice: null }); versions.set(id, []); }
      const group = map.get(id);
      if (item.catalogRef) {
        group.market.add(item.definitionId); group.minPrice = Math.min(group.minPrice ?? Infinity, item.quote.price);
        versions.get(id).push(item);
      } else group.owned.add(item.definitionId);
    }
    const entries = [...map.values()].map(g => ({ id: g.id, count: g.owned.size + g.market.size,
      ownedCount: g.owned.size, marketCount: g.market.size, minPrice: g.minPrice }))
      .sort((a, b) => b.ownedCount - a.ownedCount || (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity) || b.count - a.count || a.id - b.id);
    groups[name] = { entries: entries.slice(0, 32), truncated: entries.length > 32 };
    lanes[name] = versions;
  }
  const ratings = {};
  for (const item of prepared.pool.candidates) ratings[item.rating] = (ratings[item.rating] ?? 0) + 1;
  const attempts = []; let remaining = totalNodes; let best = null;
  const run = (hint = { strategy: 'balanced', groupId: 0 }) => {
    if (attempts.length >= 5 || remaining <= 0) return stop('FC27_PUZZLE_TOTAL_BUDGET');
    if (!hint || Object.keys(hint).sort().join() !== 'groupId,strategy'
        || !['balanced', 'low-rating', 'nation', 'league', 'club'].includes(hint.strategy)
        || (['balanced', 'low-rating'].includes(hint.strategy) ? hint.groupId !== 0
          : !groups[hint.strategy].entries.some(entry => entry.id === hint.groupId))) return stop('FC27_PUZZLE_STRATEGY_INVALID');
    if (attempts.some(attempt => attempt.strategy === hint.strategy && attempt.groupId === hint.groupId)) return stop('FC27_LLM_NO_PROGRESS');
    const preferredRefs = (lanes[hint.strategy]?.get(hint.groupId) ?? []).slice()
      .sort((a, b) => a.quote.price - b.quote.price || a.definitionId - b.definitionId).slice(0, 32).map(item => item.catalogRef);
    const plan = previewFc27PuzzleMarket({ ...snapshot, evaluateSquad, boundSquad, groupMatcher,
      preferredRefs, searchHint: hint, maxNodes: Math.min(nodesPerAttempt, remaining) });
    remaining -= plan.nodes ?? 0;
    if (!best || best.status !== 'preview' || plan.status === 'preview' && plan.estimatedCost < best.estimatedCost) best = plan;
    const summary = summarizeFc27MarketPlan(plan);
    attempts.push({ strategy: hint.strategy, groupId: hint.groupId, ...summary });
    return structuredClone(summary);
  };
  const session = { status: 'ready', run, result: () => structuredClone(best),
    observe: () => structuredClone({ schema: 1, season: '27', mode: 'market', required, rules: parsed.rules, groups, ratings,
      safeCandidates: prepared.pool.candidates.length, inventory: { status: snapshot.inventory.status,
        complete: snapshot.inventory.complete === true, scope: snapshot.inventory.scope }, remainingNodes: remaining, attempts,
      currentPlan: best ? summarizeFc27MarketPlan(best) : null,
      market: { eligible: prepared.coverage.eligible, priced: prepared.coverage.priced, poolSize: prepared.market.length,
        poolTruncated: prepared.coverage.truncated, catalogComplete: prepared.coverage.catalogComplete,
        budget: prepared.caps.effectiveBudget, maxPurchases: prepared.caps.maxPurchases,
        maxUnitPrice: prepared.caps.maxUnitPrice, canImprove: attempts.length < 5 && best?.estimatedCost !== 0 && remaining > 0
          && ['FC27_MARKET_PLAN_PREVIEW', 'FC27_MARKET_POOL_NO_PLAN', 'FC27_PUZZLE_SEARCH_LIMIT'].includes(best?.reason) } }),
  };
  run();
  return Object.freeze(session);
}
