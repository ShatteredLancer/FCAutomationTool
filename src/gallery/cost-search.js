import { galleryCostBundles, galleryBonusBundles } from './cost-bundles.js';

const bundleKey = ids => ids.slice().sort((a, b) => a - b).join(',');
const costOf = state => Number.isFinite(state.cost) ? state.cost : Infinity;

function candidateFrontier(candidates, limit) {
  const cheapest = candidates.slice().sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
    || (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);
  const picked = new Map();
  for (const candidate of cheapest.slice(0, Math.min(32, limit))) picked.set(candidate.id, candidate);
  const signatures = new Set([...picked.values()].map(row => (row.diversityKeys ?? []).join('|')));
  for (const candidate of cheapest) {
    if (picked.size >= limit) break;
    const signature = (candidate.diversityKeys ?? []).join('|');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    for (const peer of cheapest.filter(row => (row.diversityKeys ?? []).join('|') === signature).slice(0, 6)) {
      if (picked.size >= limit) break;
      picked.set(peer.id, peer);
    }
  }
  for (const candidate of cheapest.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)
    || (a.price ?? Infinity) - (b.price ?? Infinity) || a.id - b.id).slice(0, 8)) {
    if (picked.size >= limit) break;
    picked.set(candidate.id, candidate);
  }
  return [...picked.values()];
}

function frontier(states, width, measure) {
  const equivalent = new Map();
  for (const state of states) {
    // Equal current cost/score does not imply equal future bonus paths.
    const key = bundleKey(state.ids);
    if (!equivalent.has(key)) equivalent.set(key, state);
  }
  const rows = [...equivalent.values()].map(state => ({ state, cost: costOf(state), ...measure(state) }));
  const orderings = [rows.slice().sort((a, b) => a.cost - b.cost || b.progress - a.progress),
    rows.slice().sort((a, b) => b.progress - a.progress || a.cost - b.cost),
    rows.slice().sort((a, b) => Math.max(0, b.progress) / Math.max(1, b.cost)
      - Math.max(0, a.progress) / Math.max(1, a.cost) || a.cost - b.cost)];
  const chosen = new Set(), signatures = new Set(), offsets = [0, 0, 0];
  // Prefer varied paths, but never declare different version sets equivalent.
  while (chosen.size < width) {
    const before = chosen.size;
    for (let route = 0; route < orderings.length && chosen.size < width; route++) {
      const ordering = orderings[route];
      while (offsets[route] < ordering.length) {
        const row = ordering[offsets[route]++];
        const key = `${row.cost}:${row.progress}:${row.diversityKey ?? ''}`;
        if (chosen.has(row.state) || signatures.has(key)) continue;
        chosen.add(row.state); signatures.add(key); break;
      }
    }
    if (before === chosen.size) break;
  }
  for (const row of orderings[0]) { if (chosen.size >= width) break; chosen.add(row.state); }
  return [...chosen];
}

// Explore complete lineups by bounded replacement layers. Multiple paths are
// retained so a bonus that needs two or three coordinated replacements is not
// lost merely because its first replacement has lower score.
export function* refineGalleryCostSteps({ initial, candidates, evaluate, measure, maxEvaluations,
  beamWidth = 24, candidateLimit = 96, maxDepth = 12, seedSteps = null }) {
  let evaluations = 0, stopped = false, truncated = maxDepth < initial.ids.length;
  const plans = [], reached = new Map(), seen = new Set([bundleKey(initial.ids)]);
  if (!Number.isFinite(initial.cost) || initial.missingPrices) return { plans, evaluations, stopped };
  if (measure(initial).reached) reached.set(bundleKey(initial.ids), initial);
  let beam = [initial];
  const seedStates = [initial];
  // Cooperative scoring yields are not full purchase-plan evaluations. Both
  // work budgets are bounded; a deadline cancels the nested iterator too.
  if (seedSteps) {
    try {
      let step = seedSteps.next();
      while (!step.done && !stopped) {
        const ids = step.value.ids;
        if (ids && !seen.has(bundleKey(ids))) {
          if (evaluations >= maxEvaluations) { stopped = true; break; }
          seen.add(bundleKey(ids));
          const state = evaluate(ids); evaluations++;
          if (state && Number.isFinite(state.cost) && !state.missingPrices) {
            seedStates.push(state);
            if (measure(state).reached) reached.set(bundleKey(ids), state);
          }
        }
        if (yield { evaluations, seedWork: step.value.work }) { stopped = true; break; }
        step = seedSteps.next();
      }
    } finally {
      seedSteps.return();
    }
  }
  const seedLimit = Math.min(512, Math.floor(maxEvaluations / 4));
  const orderedLimit = Math.min(512, Math.floor(maxEvaluations / 4));
  const seedSources = [galleryBonusBundles(candidates, initial.ids.length, seedLimit),
    galleryCostBundles(candidates, initial.ids.length, orderedLimit)];
  for (const source of seedSources) {
    if (stopped) break;
    for (const ids of source) {
      const key = bundleKey(ids);
      if (seen.has(key)) continue;
      if (evaluations >= maxEvaluations) { stopped = true; break; }
      seen.add(key);
      const state = evaluate(ids); evaluations++;
      if (state && Number.isFinite(state.cost) && !state.missingPrices) {
        seedStates.push(state);
        if (measure(state).reached) reached.set(key, state);
      }
      if (yield { evaluations }) { stopped = true; break; }
    }
    if (stopped) break;
  }
  if (seedStates.length > beamWidth) truncated = true;
  beam = frontier(seedStates, beamWidth, measure);
  for (let depth = 0; depth < maxDepth && beam.length && evaluations < maxEvaluations && !stopped; depth++) {
    const next = [];
    expansion: for (const current of beam) {
      const selected = new Set(current.ids);
      const available = candidates.filter(candidate => !selected.has(candidate.id));
      if (available.length > candidateLimit) truncated = true;
      const alternatives = candidateFrontier(available, candidateLimit);
      for (let slot = 0; slot < current.ids.length; slot++) for (const candidate of alternatives) {
        if (evaluations >= maxEvaluations) { stopped = true; break expansion; }
        const ids = [...current.ids]; ids[slot] = candidate.id;
        const key = bundleKey(ids);
        if (seen.has(key)) continue;
        seen.add(key);
        const state = evaluate(ids); evaluations++;
        if (state && Number.isFinite(state.cost) && !state.missingPrices) {
          const value = measure(state);
          if (value.reached) {
            const previous = reached.get(key);
            if (!previous || state.cost < previous.cost) reached.set(key, state);
          }
          // Keep temporary score regressions. Gallery bonuses may require two
          // or more individually worse replacements before the combined path
          // becomes the cheapest reached lineup.
          next.push(state);
        }
        if (yield { evaluations }) { stopped = true; break expansion; }
      }
      if (stopped) break;
    }
    if (next.length > beamWidth) truncated = true;
    beam = frontier(next, beamWidth, measure);
  }
  if (beam.length && evaluations < maxEvaluations && maxDepth > 0) truncated = true;
  stopped ||= evaluations >= maxEvaluations;
  // Preserve the historical iterator contract: the best/cheapest reached
  // lineup is the final entry. Planner callers independently rank candidates.
  plans.push(...[...reached.values()].sort((a, b) => b.cost - a.cost || measure(a).progress - measure(b).progress));
  return { plans, evaluations, stopped, ...(truncated ? { truncated: true } : {}) };
}
