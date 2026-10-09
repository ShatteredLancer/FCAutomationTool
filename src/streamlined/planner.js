import { filterStreamlinedItems } from './eligibility.js';
import { compareStreamlinedPlans } from './scoring.js';
import { integer, streamlinedProgress } from './contract.js';

export function splitStreamlinedBatches(items, limit) {
  if (!integer(limit, 1, 1000)) throw Error('FC27_STREAMLINED_BATCH_LIMIT_UNKNOWN');
  return Array.from({ length: Math.ceil(items.length / limit) }, (_, index) => items.slice(index * limit, (index + 1) * limit));
}

// Sparse 0/1 integer cover. Immutable back-links avoid copying complete card
// lists at every node. Yields inside hot loops keep progress and Stop usable.
export function* planStreamlinedSteps({ challenge, inventory = [], market = [], eligibility, policy,
  objective = 'lowest-value', mode = 'inventory-market', maxNodes = 250000, maxStates = 50000,
  allowPartial = true, now = () => Date.now(), maxMs = 4000, quoteSource = 'futgg', quoteAt = now(),
  inventoryComplete = false, marketComplete = false } = {}) {
  const blocked = reason => ({ status: 'blocked', reason: `FC27_STREAMLINED_${reason}`, liveExecutionEnabled: false });
  if (challenge?.mechanism !== 'streamlined' || !integer(challenge.remainingScore)
      || !['lowest-value', 'lowest-coins', 'fewest-cards'].includes(objective) || !['inventory', 'inventory-market', 'market'].includes(mode)
      || !integer(maxNodes, 1, 5000000) || !integer(maxStates, 1, 100000) || !integer(maxMs, 1, 60000)
      || !integer(quoteAt) || !['futgg', 'futbin'].includes(quoteSource)) return blocked('PLAN_INPUT_INVALID');
  if (!challenge.remainingScore || challenge.status === 'COMPLETED') return { status: 'completed', items: [], batches: [], liveExecutionEnabled: false };
  if (!integer(challenge.selectionLimit, 1, 1000)) return blocked('BATCH_LIMIT_UNKNOWN');
  const filtered = filterStreamlinedItems([...(mode === 'market' ? [] : inventory), ...(mode === 'inventory' ? [] : market)], { eligibility, policy });
  if (filtered.status !== 'observed') return filtered;
  const excluded = { ...filtered.excluded };
  const candidates = filtered.items.filter(item => {
    if (item.source !== 'market') return true;
    const q = item.quote;
    const valid = integer(item.price, 1, 15000000) && q?.source === quoteSource && q?.definitionId === item.definitionId
      && q.price === item.price && integer(q.fetchedAt) && q.fetchedAt <= quoteAt && integer(q.expiresAt) && q.expiresAt > quoteAt;
    if (!valid) excluded['market-quote'] = (excluded['market-quote'] ?? 0) + 1;
    return valid;
  }).sort((a, b) => Number(a.source === 'market') - Number(b.source === 'market')
    || Number(a.price == null) - Number(b.price == null)
    || (a.price ?? 0) / a.points - (b.price ?? 0) / b.points || b.points - a.points || a.key.localeCompare(b.key));
  const target = challenge.remainingScore, started = now();
  let nodes = 0, processed = 0, budget = null, best = null;
  const empty = { score: 0, purchaseCost: 0, materialValue: 0, unknownValue: 0, count: 0, storagePenalty: 0, prev: null, item: null };
  let partial = empty;
  const rank = (a, b) => compareStreamlinedPlans(a, b, objective);
  const append = (prev, item) => ({ score: prev.score + item.points,
    purchaseCost: prev.purchaseCost + (item.source === 'market' ? item.price : 0),
    materialValue: prev.materialValue + (item.source === 'inventory' ? item.price ?? 0 : 0),
    unknownValue: prev.unknownValue + Number(item.source === 'inventory' && item.price == null),
    storagePenalty: prev.storagePenalty + Number(policy.storageFirst && item.pile !== 'storage'), count: prev.count + 1, prev, item });
  const remember = state => {
    if (state.score >= target) { if (!best || rank(state, best) < 0) best = state; }
    else if (state.score > partial.score || state.score === partial.score && rank(state, partial) < 0) partial = state;
  };
  // A feasible seed survives exhausted search. It is never labelled optimal.
  for (const order of [candidates, candidates.slice().sort((a, b) => Number(a.source === 'market') - Number(b.source === 'market')
    || (a.price ?? Infinity) - (b.price ?? Infinity) || b.points - a.points)]) {
    let seed = empty;
    for (const item of order) { seed = append(seed, item); remember(seed); if (seed.score >= target) break; }
  }
  const states = new Map([[0, empty]]);
  outer: for (const item of candidates) {
    const before = [...states.values()];
    for (const state of before) {
      if (nodes >= maxNodes) { budget = 'nodes'; break outer; }
      const candidate = append(state, item); nodes++; remember(candidate);
      if (candidate.score < target) {
        const previous = states.get(candidate.score);
        if (!previous || rank(candidate, previous) < 0) states.set(candidate.score, candidate);
      }
      if (nodes % 256 === 0) {
        const cancelled = yield { phase: 'search', nodes, maxNodes, processed, candidates: candidates.length, elapsedMs: now() - started,
          bestScore: best?.score ?? partial.score, bestPurchaseCost: best?.purchaseCost ?? null };
        if (cancelled) { budget = 'cancelled'; break outer; }
        if (now() - started >= maxMs) { budget = 'time'; break outer; }
      }
      if (states.size > maxStates) { budget = 'states'; break outer; }
    }
    processed++;
  }
  const chosen = best ?? partial, items = [];
  for (let state = chosen; state.item; state = state.prev) items.push(state.item);
  items.reverse();
  const reached = !!best, searchComplete = budget === null;
  return { status: budget === 'cancelled' ? 'cancelled' : reached ? 'ready' : allowPartial && items.length ? 'partial' : 'unavailable',
    reason: budget ? `FC27_STREAMLINED_SEARCH_${budget.toUpperCase()}` : reached ? 'FC27_STREAMLINED_LOCAL_PLAN' : 'FC27_STREAMLINED_POOL_SHORTAGE',
    items, batches: splitStreamlinedBatches(items, challenge.selectionLimit), score: chosen.score,
    purchaseCost: chosen.purchaseCost, materialValue: chosen.unknownValue ? null : chosen.materialValue,
    unknownValueCount: chosen.unknownValue, progress: streamlinedProgress(challenge, chosen.score),
    nodes, maxNodes, elapsedMs: now() - started, searchComplete, optimalWithinPricedPool: searchComplete && !chosen.unknownValue,
    poolComplete: inventoryComplete && (mode === 'inventory' || marketComplete),
    candidateCount: candidates.length, excluded, liveExecutionEnabled: false };
}

export function planStreamlined(input) {
  const iterator = planStreamlinedSteps(input); let step;
  do { step = iterator.next(); } while (!step.done);
  return step.value;
}

export async function runStreamlinedPlan(input, { onProgress = () => {}, stopped = () => false,
  schedule = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const iterator = planStreamlinedSteps(input);
  try {
    let step = iterator.next();
    while (!step.done) {
      try { onProgress(step.value); } catch { /* Diagnostics cannot change planning. */ }
      await schedule(); step = iterator.next(stopped());
    }
    return step.value;
  } finally { iterator.return(); }
}
