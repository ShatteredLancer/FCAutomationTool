const validPrice = value => Number.isSafeInteger(value) && value > 0;
const priceOf = candidate => validPrice(candidate.price) ? candidate.price : Number.POSITIVE_INFINITY;
const scoreOf = candidate => Number.isFinite(candidate.score) ? candidate.score : -Infinity;
const priceOrder = (a, b) => priceOf(a) - priceOf(b) || scoreOf(b) - scoreOf(a) || a.id - b.id;
const scoreOrder = (a, b) => Number.isFinite(priceOf(b)) - Number.isFinite(priceOf(a))
  || scoreOf(b) - scoreOf(a) || priceOf(a) - priceOf(b) || a.id - b.id;

// Rating-first slicing can discard affordable cards before the planner runs.
// Keep price, score and rule-diverse routes in the bounded pool.
export function selectGalleryCandidatePool(candidates, limit) {
  if (!Array.isArray(candidates) || !Number.isSafeInteger(limit) || limit < 1) return [];
  const selected = new Map();
  const add = candidate => { if (selected.size < limit) selected.set(candidate.id, candidate); };
  const byPrice = candidates.slice().sort(priceOrder);
  const byScore = candidates.slice().sort(scoreOrder);
  for (const candidate of byPrice.slice(0, Math.ceil(limit / 2))) add(candidate);
  for (const candidate of byScore.slice(0, Math.ceil(limit / 4))) add(candidate);
  const representatives = new Map();
  for (const candidate of byPrice) for (const key of candidate.diversityKeys ?? []) {
    if (!representatives.has(key)) representatives.set(key, candidate);
  }
  for (const candidate of [...representatives.values()].sort(priceOrder)) add(candidate);
  for (const candidate of byPrice) add(candidate);
  for (const candidate of byScore) add(candidate);
  return [...selected.values()];
}
