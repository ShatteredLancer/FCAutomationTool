// Remove redundant purchases only after rescoring the remaining exact versions.
// The caller supplies the remaining evaluation budget; no price/rule is relaxed.
export function* trimGalleryPlanSteps({ initial, price, evaluate, reached, maxEvaluations = 0 }) {
  let best = initial, evaluations = 0, stopped = false;
  if (!reached(initial)) return { state: best, evaluations, stopped };
  const ids = initial.ids.slice().sort((a, b) => price(b) - price(a) || a - b);
  for (const id of ids) {
    if (evaluations >= maxEvaluations) break;
    const remaining = best.ids.filter(value => value !== id);
    const candidate = yield* evaluate(remaining); evaluations++;
    if (candidate && reached(candidate)) best = candidate;
    if (yield { evaluations }) { stopped = true; break; }
  }
  return { state: best, evaluations, stopped };
}
