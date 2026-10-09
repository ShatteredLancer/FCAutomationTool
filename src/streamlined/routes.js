import { filterStreamlinedItems } from './eligibility.js';
import { integer, fail, deepFreeze } from './contract.js';
import { streamlinedProgress } from './contract.js';
import { splitStreamlinedBatches } from './planner.js';
import { compareStreamlinedPlans, streamlinedResourceCost } from './scoring.js';

// Keep both cheaper material and fewer-card paths; owned cards do not become
// economically free merely because purchaseCost is zero.
const dominates = (a, b, rank) => a.purchaseCost <= b.purchaseCost && a.unknownValue <= b.unknownValue
  && a.purchaseCost + a.materialValue <= b.purchaseCost + b.materialValue && a.count <= b.count
  && (a.purchaseCost !== b.purchaseCost || a.unknownValue !== b.unknownValue
    || a.materialValue !== b.materialValue || a.count !== b.count || rank(a, b) <= 0);
const empty = () => ({ score: 0, count: 0, purchaseCost: 0, materialValue: 0, unknownValue: 0, counts: [] });
const add = (state, group, index, count) => {
  const counts = state.counts.slice(); counts[index] = (counts[index] ?? 0) + count;
  return { score: state.score + group.item.points * count, count: state.count + count, counts,
    purchaseCost: state.purchaseCost + (group.source === 'market' ? group.item.price * count : 0),
    materialValue: state.materialValue + (group.source === 'inventory' ? (group.item.price ?? 0) * count : 0),
    unknownValue: state.unknownValue + (group.source === 'inventory' && group.item.price == null ? count : 0) };
};

// Quantities describe demand, never auction supply. A group retains its exact
// eligible versions; only the selected execution wave is turned into entities.
export function groupStreamlinedCandidates({ inventory = [], market = [], mode = 'inventory-market',
  challenge, eligibility, policy, quoteSource = 'futgg', quoteAt = Date.now() }) {
  if (!['inventory', 'inventory-market', 'market'].includes(mode) || !integer(challenge?.remainingScore, 1)
      || !['futgg', 'futbin'].includes(quoteSource) || !integer(quoteAt)) fail('ROUTE_INPUT_INVALID');
  const filtered = filterStreamlinedItems([...(mode === 'market' ? [] : inventory), ...(mode === 'inventory' ? [] : market)], { eligibility, policy });
  if (filtered.status !== 'observed') throw Error(filtered.reason);
  const groups = [], byKey = new Map(), excluded = { ...filtered.excluded };
  for (const item of filtered.items) {
    const q = item.quote;
    if (item.source === 'market' && (!integer(item.price, 1, 15000000) || q?.source !== quoteSource
        || q.definitionId !== item.definitionId || q.price !== item.price || !integer(q.fetchedAt)
        || q.fetchedAt > quoteAt || !integer(q.expiresAt) || q.expiresAt <= quoteAt)) {
      excluded['market-quote'] = (excluded['market-quote'] ?? 0) + 1; continue;
    }
    // Different prices remain separate: a cheap reference does not authorize
    // substituting a more expensive version or silently change the estimate.
    const key = JSON.stringify([item.source, item.points, item.rating, item.rarity ?? null, item.price, item.pile]);
    let group = byKey.get(key);
    if (!group) {
      group = { key, source: item.source, item, items: [], quantity: 0 };
      byKey.set(key, group); groups.push(group);
    }
    if (group.items.some(row => row.key === item.key || item.source === 'market' && row.definitionId === item.definitionId)) continue;
    group.items.push(item);
    group.quantity = item.source === 'inventory' ? group.items.length : Math.ceil(challenge.remainingScore / item.points);
  }
  return { groups, excluded };
}

export function* planStreamlinedRoutesSteps(input, { maxNodes = 300000, maxStates = 20000, maxMs = 4000,
  now = () => Date.now(), budget = null } = {}) {
  const { challenge, objective = 'lowest-value' } = input;
  if (!integer(maxNodes, 1, 5000000) || !integer(maxStates, 1, 100000) || !integer(maxMs, 1, 60000)
      || budget !== null && !integer(budget) || !integer(challenge?.selectionLimit, 1, 1000)
      || !['lowest-value', 'lowest-coins', 'fewest-cards'].includes(objective)) fail('ROUTE_INPUT_INVALID');
  const { groups, excluded } = groupStreamlinedCandidates(input);
  const rank = (a, b) => compareStreamlinedPlans(a, b, objective);
  const target = challenge.remainingScore, started = now(), frontier = [];
  let nodes = 0, stopped = null, labels = 1;
  const remember = state => {
    if (state.score < target || budget !== null && state.purchaseCost > budget) return;
    if (frontier.some(row => dominates(row, state, rank))) return;
    for (let i = frontier.length - 1; i >= 0; i--) {
      if (dominates(state, frontier[i], rank)) frontier.splice(i, 1);
    }
    frontier.push(state);
  };
  function* checkpoint() {
    if (nodes % 128 === 0) {
      const cancelled = yield { phase: 'routes', nodes, maxNodes, candidates: groups.length, elapsedMs: now() - started,
        routeCount: frontier.length, bestPurchaseCost: frontier.length ? Math.min(...frontier.map(r => r.purchaseCost)) : null };
      if (cancelled) stopped = 'cancelled';
      else if (now() - started >= maxMs) stopped = 'time';
    }
    if (nodes >= maxNodes) stopped ??= 'nodes';
    return !!stopped;
  }
  // Fast feasible seeds for large targets: zero/all eligible stock plus every
  // pair of priced score groups. No per-copy market objects are allocated.
  const stock = groups.map((g, i) => ({ g, i })).filter(v => v.g.source === 'inventory');
  const market = groups.map((g, i) => ({ g, i })).filter(v => v.g.source === 'market');
  const bases = [empty()];
  for (const order of [stock.slice().sort((a, b) => (a.g.item.price ?? Infinity) - (b.g.item.price ?? Infinity)
    || b.g.item.points - a.g.item.points),
    stock.slice().sort((a, b) => (a.g.item.price ?? Infinity) / a.g.item.points - (b.g.item.price ?? Infinity) / b.g.item.points),
    stock.slice().sort((a, b) => b.g.item.points - a.g.item.points)]) {
    let state = empty();
    for (const { g, i } of order) {
      if (state.score >= target) break;
      state = add(state, g, i, Math.min(g.quantity, Math.ceil((target - state.score) / g.item.points)));
    }
    remember(state); bases.push(state);
  }
  for (const base of bases) for (const { g, i } of market) {
    if (base.score < target) remember(add(base, g, i, Math.ceil((target - base.score) / g.item.points)));
  }
  seed: for (const base of bases) {
    if (base.score >= target) continue;
    for (let a = 0; a < market.length; a++) {
      const left = market[a];
      remember(add(base, left.g, left.i, Math.ceil((target - base.score) / left.g.item.points)));
      for (let b = a + 1; b < market.length; b++) {
        const right = market[b], count = Math.ceil((target - base.score) / left.g.item.points);
        for (let n = 0; n <= count; n++) {
          let state = add(base, left.g, left.i, n);
          if (state.score < target) state = add(state, right.g, right.i, Math.ceil((target - state.score) / right.g.item.points));
          remember(state); nodes++;
          if (yield* checkpoint()) break seed;
        }
      }
    }
  }
  // Exact bounded cover for the remaining budget. Binary count chunks avoid
  // 1,000 identical item nodes; Pareto labels retain cheap and fewer-card paths.
  const states = new Map([[0, [empty()]]]);
  search: for (let i = 0; i < groups.length && !stopped; i++) {
    const group = groups[i]; let remaining = group.quantity;
    for (let chunk = 1; remaining > 0; chunk *= 2) {
      const count = Math.min(chunk, remaining); remaining -= count;
      const before = [...states.values()].flat();
      for (const state of before) {
        const candidate = add(state, group, i, count); nodes++;
        if (candidate.score >= target) remember(candidate);
        else if (budget === null || candidate.purchaseCost <= budget) {
          const rows = states.get(candidate.score) ?? [];
          if (!rows.some(row => dominates(row, candidate, rank))) {
            const retained = rows.filter(row => !dominates(candidate, row, rank));
            labels += retained.length + 1 - rows.length;
            states.set(candidate.score, [...retained, candidate]);
          }
        }
        if (labels > maxStates) stopped = 'states';
        if (yield* checkpoint()) break search;
      }
    }
  }
  frontier.sort(rank);
  const routes = frontier.map((state, index) => ({ id: `route:${index}`, score: state.score, excess: state.score - target,
    count: state.count, purchaseCost: state.purchaseCost, materialValue: state.unknownValue ? null : state.materialValue,
    totalValue: state.unknownValue ? null : streamlinedResourceCost(state),
    unknownValueCount: state.unknownValue,
    inventoryCount: state.counts.reduce((sum, n, i) => sum + (groups[i].source === 'inventory' ? n : 0), 0),
    marketCount: state.counts.reduce((sum, n, i) => sum + (groups[i].source === 'market' ? n : 0), 0),
    minBatches: Math.ceil(state.count / challenge.selectionLimit),
    groups: state.counts.flatMap((count, i) => count ? [{ ...groups[i], quantity: count }] : []),
    searchComplete: stopped === null, supplyVerified: false }));
  // Present the cheapest plus a few explicit budget trade-offs and fewest.
  const selected = new Set();
  if (routes.length) {
    selected.add(routes[0]);
    for (const extra of [5, 10, 20, 30]) {
      const cost = r => objective === 'lowest-value' ? streamlinedResourceCost(r) : r.purchaseCost;
      const cap = Math.floor(cost(routes[0]) * (1 + extra / 100));
      const choice = routes.filter(r => cost(r) <= cap).sort((a, b) => a.count - b.count || rank(a, b))[0];
      if (choice) selected.add(choice);
    }
    selected.add(routes.slice().sort((a, b) => a.count - b.count || a.purchaseCost - b.purchaseCost)[0]);
    selected.add(routes.slice().sort((a, b) => compareStreamlinedPlans(a, b, 'lowest-coins'))[0]);
  }
  return deepFreeze({ status: stopped === 'cancelled' ? 'cancelled' : routes.length ? 'ready' : 'unavailable',
    reason: stopped ? `FC27_STREAMLINED_SEARCH_${stopped.toUpperCase()}` : 'FC27_STREAMLINED_ROUTES',
    routes: [...selected], excluded, nodes, searchComplete: stopped === null, candidateCount: groups.length,
    elapsedMs: now() - started, poolComplete: false, liveExecutionEnabled: false });
}

export async function runStreamlinedRoutes(input, { onProgress = () => {}, stopped = () => false,
  schedule = () => new Promise(resolve => setTimeout(resolve, 0)), ...options } = {}) {
  const iterator = planStreamlinedRoutesSteps(input, options);
  try {
    let step = iterator.next();
    while (!step.done) {
      try { onProgress(step.value); } catch { /* Display only. */ }
      await schedule(); step = iterator.next(stopped());
    }
    return step.value;
  } finally { iterator.return(); }
}

// Compatibility projection for the existing reviewed plan/Journal contract.
// Called only for a chosen route, never for every route while searching.
export function expandStreamlinedRoute(route, challenge) {
  if (!route || !integer(route.count, 1, 20000) || !Array.isArray(route.groups)) fail('ROUTE_INVALID');
  const items = [], copies = new Map();
  for (const group of route.groups.slice().sort((a,b) => Number(a.source === 'market') - Number(b.source === 'market'))) {
    if (!integer(group.quantity, 1, 20000) || !group.items?.length) fail('ROUTE_INVALID');
    for (let n = 0; n < group.quantity; n++) {
      if (group.source === 'inventory') {
        if (!group.items[n]) fail('ROUTE_INVALID'); items.push(group.items[n]);
      } else {
        const item = group.items[n % group.items.length], copy = copies.get(item.definitionId) ?? 0;
        copies.set(item.definitionId, copy + 1); items.push({ ...item, key: `market:${item.definitionId}:${copy}` });
      }
    }
  }
  if (items.length !== route.count) fail('ROUTE_INVALID');
  return { status: 'ready', items, batches: splitStreamlinedBatches(items, challenge.selectionLimit),
    score: route.score, purchaseCost: route.purchaseCost, materialValue: route.materialValue,
    progress: streamlinedProgress(challenge, route.score), searchComplete: route.searchComplete,
    unknownValueCount: items.filter(i => i.source === 'inventory' && i.price == null).length, poolComplete: false };
}
