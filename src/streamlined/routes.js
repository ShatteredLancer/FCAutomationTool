import { filterStreamlinedItems } from './eligibility.js';
import { integer, fail, deepFreeze } from './contract.js';
import { streamlinedProgress } from './contract.js';
import { compareStreamlinedPlans, streamlinedResourceCost } from './scoring.js';
import { runStreamlinedSteps } from './scheduling.js';

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
      || !['inventory-first', 'lowest-value', 'lowest-coins', 'fewest-cards'].includes(objective)) fail('ROUTE_INPUT_INVALID');
  const { groups, excluded } = groupStreamlinedCandidates(input);
  if (objective === 'inventory-first') return yield* planInventoryFirstRoutesSteps(input, groups, excluded,
    { maxNodes, maxStates, maxMs, now, budget });
  const rank = (a, b) => compareStreamlinedPlans(a, b, objective);
  const target = challenge.remainingScore, started = now(), frontier = [];
  const stock = groups.map((g, i) => ({ g, i })).filter(v => v.g.source === 'inventory');
  const marketEntries = groups.map((g, i) => ({ g, i })).filter(v => v.g.source === 'market');
  const stockByScore = new Map();
  for (const entry of stock) {
    const rows = stockByScore.get(entry.g.item.points) ?? [];
    rows.push(entry); stockByScore.set(entry.g.item.points, rows);
  }
  for (const rows of stockByScore.values()) rows.sort((a, b) => (a.g.item.price ?? Infinity) - (b.g.item.price ?? Infinity)
    || Number(b.g.item.pile === 'storage' && input.policy.storageFirst) - Number(a.g.item.pile === 'storage' && input.policy.storageFirst));
  let nodes = 0, stopped = null, labels = 1;
  const remember = state => {
    if (state.score < target) return;
    // Every feasible recipe, including later pair/DP results, reuses known
    // equal-score stock before pruning. This never increases material value.
    if (state.purchaseCost && stock.length) for (const { g, i } of marketEntries) {
      let pending = state.counts[i] ?? 0;
      if (!pending) continue;
      for (const entry of stockByScore.get(g.item.points) ?? []) {
        if (!pending || entry.g.item.price == null || entry.g.item.price > g.item.price) break;
        const count = Math.min(pending, entry.g.quantity - (state.counts[entry.i] ?? 0));
        if (count <= 0) continue;
        state = add(add(state, g, i, -count), entry.g, entry.i, count); pending -= count;
      }
    }
    if (budget !== null && state.purchaseCost > budget) return;
    if (frontier.some(row => dominates(row, state, rank))) return;
    for (let i = frontier.length - 1; i >= 0; i--) {
      if (dominates(state, frontier[i], rank)) frontier.splice(i, 1);
    }
    frontier.push(state);
  };
  function* checkpoint(force = false) {
    if (force || nodes % 128 === 0) {
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
  // Same-score expensive buckets cannot improve a market cover. Keep the
  // original groups for exact search/execution, but avoid wasting seed time
  // enumerating their equivalent quantities before cheap pairs are visited.
  const cheapest = new Map();
  for (const [i, g] of groups.entries()) if (g.source === 'market') {
    const old = cheapest.get(g.item.points);
    if (!old || g.item.price < old.g.item.price) cheapest.set(g.item.points, { g, i });
  }
  const market = [...cheapest.values()].sort((a, b) => a.g.item.price / a.g.item.points - b.g.item.price / b.g.item.points
    || b.g.item.points - a.g.item.points);
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
  // Cheap bulk plus every one-bucket tail in BOTH directions must be tried
  // before low-score stock prefixes or exhaustive pairs consume the budget.
  fast: for (const left of market) {
    remember(add(empty(), left.g, left.i, Math.ceil(target / left.g.item.points)));
    const bulk = add(empty(), left.g, left.i, Math.floor(target / left.g.item.points));
    for (const right of market) {
      remember(bulk.score >= target ? bulk : add(bulk, right.g, right.i,
        Math.ceil((target - bulk.score) / right.g.item.points)));
      nodes++;
    }
    // Bucket counts need not divide 128; still yield after each tail sweep.
    if (yield* checkpoint(true)) break fast;
  }
  // Seed partial-stock covers before market pair enumeration or exact search
  // can exhaust the budget. Full-stock seeds alone miss cheap owned prefixes.
  mixed: for (const order of [stock.slice().sort((a, b) => (a.g.item.price ?? Infinity) / a.g.item.points
    - (b.g.item.price ?? Infinity) / b.g.item.points || b.g.item.points - a.g.item.points),
    stock.slice().sort((a, b) => (a.g.item.price ?? Infinity) - (b.g.item.price ?? Infinity)
      || b.g.item.points - a.g.item.points)]) {
    if (stopped) break;
    let base = empty();
    for (const { g, i } of order) {
      for (let n = 0; n < g.quantity && base.score < target; n++) {
        base = add(base, g, i, 1);
        if (base.score >= target) { remember(base); break; }
        for (const version of market) {
          remember(add(base, version.g, version.i, Math.ceil((target - base.score) / version.g.item.points)));
          nodes++;
          if (yield* checkpoint()) break mixed;
        }
      }
      if (base.score >= target) break;
    }
  }
  seed: for (const base of bases) {
    if (stopped) break;
    if (base.score >= target) continue;
    for (let a = 0; a < market.length; a++) {
      const left = market[a];
      remember(add(base, left.g, left.i, Math.ceil((target - base.score) / left.g.item.points)));
      for (let b = a + 1; b < market.length; b++) {
        const right = market[b], count = Math.ceil((target - base.score) / left.g.item.points);
        // Seed the cheap bulk plus its small tail before any bounded enumeration.
        const bulk = add(base, left.g, left.i, Math.floor((target - base.score) / left.g.item.points));
        remember(bulk.score >= target ? bulk : add(bulk, right.g, right.i, Math.ceil((target - bulk.score) / right.g.item.points)));
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
  // A repeated cheapest version is a valid multi-wave demand, not an auction
  // supply guarantee. Keep that optimum and add bounded, explicitly priced
  // alternatives using distinct equal-score versions; never raise its caps.
  const diversified = [];
  const familyKey = g => JSON.stringify([g.item.points, g.item.rating, g.item.rarity ?? null]);
  const families = new Map();
  for (const entry of marketEntries) {
    const key = familyKey(entry.g), family = families.get(key) ?? [];
    family.push(entry); families.set(key, family);
  }
  for (const family of families.values()) family.sort((a, b) => a.g.item.price - b.g.item.price);
  for (const base of frontier.slice(0, 8)) {
    if (!base.purchaseCost || base.unknownValue) continue;
    const demands = new Map(); let upper = 1;
    let owned = base;
    for (const { g, i } of marketEntries) {
      const count = base.counts[i] ?? 0;
      if (!count) continue;
      demands.set(familyKey(g), (demands.get(familyKey(g)) ?? 0) + count);
      upper = Math.max(upper, Math.ceil(count / g.items.length));
      owned = add(owned, g, i, -count);
    }
    if (upper <= 1) continue;
    let lower = Math.ceil(base.count / challenge.selectionLimit);
    for (const [key, count] of demands) lower = Math.max(lower,
      Math.ceil(count / families.get(key).reduce((sum, entry) => sum + entry.g.items.length, 0)));
    const cover = waves => {
      let state = owned;
      for (const [key, count] of demands) {
        let remaining = count;
        for (const { g, i } of families.get(key)) {
          const quantity = Math.min(remaining, waves * g.items.length);
          if (quantity) state = add(state, g, i, quantity);
          remaining -= quantity;
          if (!remaining) break;
        }
        if (remaining) return null;
      }
      return state;
    };
    const cost = state => objective === 'lowest-value' ? streamlinedResourceCost(state) : state.purchaseCost;
    for (const premium of [5, 10, 20, 30]) {
      const cap = Math.floor(cost(base) * (1 + premium / 100));
      const within = state => state && cost(state) <= cap && (budget === null || state.purchaseCost <= budget);
      let lo = lower, hi = upper - 1, choice = null;
      // Increasing wave capacity can only reduce this cheapest-first cost.
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2), state = cover(mid);
        if (within(state)) { choice = state; hi = mid - 1; } else lo = mid + 1;
      }
      if (choice && !diversified.some(row => JSON.stringify(row.counts) === JSON.stringify(choice.counts))) diversified.push(choice);
    }
  }
  const routeStates = [...frontier, ...diversified].sort(rank);
  const routes = routeStates.map((state, index) => {
    const selectedGroups = state.counts.flatMap((count, i) => count ? [{ ...groups[i], quantity: count }] : []);
    const marketGroups = selectedGroups.filter(g => g.source === 'market');
    const repeatPurchaseCount = marketGroups.reduce((sum, g) => sum + Math.max(0, g.quantity - g.items.length), 0);
    return { id: `route:${index}`, score: state.score, excess: state.score - target,
    count: state.count, purchaseCost: state.purchaseCost, materialValue: state.unknownValue ? null : state.materialValue,
    totalValue: state.unknownValue ? null : streamlinedResourceCost(state),
    unknownValueCount: state.unknownValue,
    inventoryCount: state.counts.reduce((sum, n, i) => sum + (groups[i].source === 'inventory' ? n : 0), 0),
    marketCount: state.counts.reduce((sum, n, i) => sum + (groups[i].source === 'market' ? n : 0), 0),
    minBatches: Math.max(Math.ceil(state.count / challenge.selectionLimit),
      ...marketGroups.map(g => Math.ceil(g.quantity / g.items.length))), repeatPurchaseCount,
    groups: selectedGroups,
    searchComplete: stopped === null, supplyVerified: false };
  });
  // Present the cheapest plus a few explicit budget trade-offs and fewest.
  const selected = new Set();
  if (routes.length) {
    selected.add(routes[0]);
    for (const extra of [5, 10, 20, 30]) {
      const cost = r => objective === 'lowest-value' ? streamlinedResourceCost(r) : r.purchaseCost;
      const cap = Math.floor(cost(routes[0]) * (1 + extra / 100));
      const choice = routes.filter(r => cost(r) <= cap).sort((a, b) => a.minBatches - b.minBatches || a.count - b.count || rank(a, b))[0];
      if (choice) selected.add(choice);
    }
    selected.add(routes.slice().sort((a, b) => a.count - b.count || a.purchaseCost - b.purchaseCost)[0]);
    selected.add(routes.slice().sort((a, b) => compareStreamlinedPlans(a, b, 'lowest-coins'))[0]);
    // Keep the materially different lanes visible even when the default
    // objective ranks one lane far above the others.  This is a presentation
    // contract, not a change to the selected default: users must be able to
    // compare pure market, pure inventory and mixed routes when each exists.
    const addLane = predicate => {
      const lane = routes.filter(predicate).sort(rank)[0];
      if (lane) selected.add(lane);
    };
    addLane(route => route.inventoryCount === 0 && route.marketCount > 0);
    addLane(route => route.inventoryCount > 0 && route.marketCount === 0);
    addLane(route => route.inventoryCount > 0 && route.marketCount > 0);
    const practicalStates = new Set(diversified);
    const practical = routes.filter((_route, index) => practicalStates.has(routeStates[index]))
      .sort((a, b) => a.minBatches - b.minBatches || rank(a, b))[0];
    if (practical) selected.add(practical);
  }
  return deepFreeze({ status: stopped === 'cancelled' ? 'cancelled' : routes.length ? 'ready' : 'unavailable',
    reason: stopped ? `FC27_STREAMLINED_SEARCH_${stopped.toUpperCase()}` : 'FC27_STREAMLINED_ROUTES',
    routes: [...selected], excluded, nodes, searchComplete: stopped === null, candidateCount: groups.length,
    elapsedMs: now() - started, poolComplete: false, liveExecutionEnabled: false });
}

// Source priority is a constraint, not a cheap-price tie-break. Freeze every
// eligible card in an insufficient tier; solve only the final tier/deficit.
// Legacy economic objectives and already frozen plans keep their old meaning.
function* planInventoryFirstRoutesSteps(input, groups, excluded, options) {
  const { challenge } = input, required = [];
  const cancelled = yield { phase: 'search', nodes: 0, maxNodes: options.maxNodes, candidates: groups.length, elapsedMs: 0 };
  if (cancelled) return { status: 'cancelled', reason: 'FC27_STREAMLINED_SEARCH_CANCELLED', routes: [], excluded,
    nodes: 0, searchComplete: false, liveExecutionEnabled: false };
  let remainingScore = challenge.remainingScore, finalTier = [];
  for (const pile of ['storage', 'club', 'unassigned', 'transfer']) {
    const tier = groups.filter(g => g.source === 'inventory' && g.item.pile === pile);
    const score = tier.reduce((sum, g) => sum + g.quantity * g.item.points, 0);
    if (score >= remainingScore) { finalTier = tier; break; }
    required.push(...tier); remainingScore -= score;
  }
  if (!finalTier.length) finalTier = groups.filter(g => g.source === 'market');
  const prefixScore = required.reduce((sum, g) => sum + g.quantity * g.item.points, 0);
  let result = { routes: [], nodes: 0, searchComplete: true, elapsedMs: 0 };
  if (finalTier.length) {
    const inventory = finalTier.filter(g => g.source === 'inventory').flatMap(g => g.items);
    const market = finalTier.filter(g => g.source === 'market').flatMap(g => g.items);
    result = yield* planStreamlinedRoutesSteps({ ...input, inventory, market,
      challenge: { ...challenge, remainingScore }, mode: market.length ? 'market' : 'inventory',
      objective: market.length ? 'lowest-value' : 'lowest-coins' }, options);
  }
  const tails = result.routes.length ? result.routes : required.length && result.status !== 'cancelled'
    ? [{ groups: [], score: 0, count: 0, purchaseCost: 0, inventoryCount: 0, marketCount: 0,
      minBatches: 0, repeatPurchaseCount: 0, searchComplete: result.searchComplete }] : [];
  const routes = tails.map((tail, index) => {
    const selected = [...required, ...tail.groups], count = selected.reduce((sum, g) => sum + g.quantity, 0);
    const unknown = selected.filter(g => g.source === 'inventory' && g.item.price == null).reduce((sum, g) => sum + g.quantity, 0);
    const materialValue = unknown ? null : selected.filter(g => g.source === 'inventory')
      .reduce((sum, g) => sum + g.quantity * g.item.price, 0);
    return { ...tail, id: `inventory-first:${index}`, groups: selected,
      score: prefixScore + tail.score, excess: prefixScore + tail.score - challenge.remainingScore, count,
      materialValue, totalValue: unknown ? null : materialValue + tail.purchaseCost, unknownValueCount: unknown,
      inventoryCount: selected.filter(g => g.source === 'inventory').reduce((sum, g) => sum + g.quantity, 0),
      minBatches: Math.max(tail.minBatches, Math.ceil(count / challenge.selectionLimit)), supplyVerified: false };
  });
  return deepFreeze({ ...result, routes, excluded, candidateCount: groups.length, poolComplete: false, liveExecutionEnabled: false,
    status: result.status === 'cancelled' ? 'cancelled' : routes[0]?.score >= challenge.remainingScore ? 'ready' : routes.length ? 'partial' : 'unavailable',
    reason: result.reason ?? (routes[0]?.score >= challenge.remainingScore ? 'FC27_STREAMLINED_LOCAL_PLAN' : 'FC27_STREAMLINED_POOL_SHORTAGE') });
}

export async function runStreamlinedRoutes(input, { onProgress = () => {}, stopped = () => false,
  schedule, metricsNow, ...options } = {}) {
  return runStreamlinedSteps(planStreamlinedRoutesSteps(input, options), { onProgress, stopped, schedule, metricsNow });
}

// Compatibility projection for the existing reviewed plan/Journal contract.
// Called only for a chosen route, never for every route while searching.
export function expandStreamlinedRoute(route, challenge) {
  if (!route || !integer(route.count, 1, 20000) || !Array.isArray(route.groups)) fail('ROUTE_INVALID');
  const items = [], copies = new Map();
  for (const group of route.groups.slice().sort((a,b) => Number(a.source === 'market') - Number(b.source === 'market')
    || Number(['unassigned', 'transfer'].includes(a.item.pile)) - Number(['unassigned', 'transfer'].includes(b.item.pile)))) {
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
  // Informational purchase waves use the same distinct-version restriction as
  // procurement. Existing physical copies are not traditional squad slots.
  const batches = [], nextByDefinition = new Map();
  let firstOpen = 0;
  for (const item of items) {
    let index = item.source === 'market' || ['unassigned', 'transfer'].includes(item.pile)
      ? Math.max(firstOpen, nextByDefinition.get(item.definitionId) ?? 0) : firstOpen;
    while (batches[index]?.length >= challenge.selectionLimit) index++;
    (batches[index] ??= []).push(item);
    nextByDefinition.set(item.definitionId, index + 1);
    while (batches[firstOpen]?.length >= challenge.selectionLimit) firstOpen++;
  }
  return { status: route.score >= challenge.remainingScore ? 'ready' : 'partial', items: batches.flat(), batches,
    score: route.score, purchaseCost: route.purchaseCost, materialValue: route.materialValue,
    progress: streamlinedProgress(challenge, route.score), searchComplete: route.searchComplete,
    unknownValueCount: items.filter(i => i.source === 'inventory' && i.price == null).length, poolComplete: false };
}
