import { forecastGalleryTurnover } from './turnover-budget.js';

// Select a read-only route from verified grade proposals, not raw web posts.
// The loss-per-added-token heuristic is bounded; no global optimum is claimed.
export function selectGalleryRoadmap(input) {
  const steps = selectGalleryRoadmapSteps(input); let step;
  do { step = steps.next(); } while (!step.done);
  return step.value;
}

export function* selectGalleryRoadmapSteps({ rows = [], capital = null, lossLimit = null, resaleDiscountBps = 0,
  previousSelection = [] } = {}) {
  if (!Array.isArray(rows) || lossLimit !== null && (!Number.isSafeInteger(lossLimit) || lossLimit < 0)) {
    return { status: 'unavailable', reason: 'input-invalid', route: [] };
  }
  const selected = new Map(), unavailable = [], skipped = new Map();
  let funding = forecastGalleryTurnover({ capital, resaleDiscountBps }), gain = 0;
  if (funding.status !== 'estimated') return { status: 'unavailable', reason: funding.reason, route: [] };
  for (const saved of previousSelection) {
    const row = rows.find(row => row.setId === saved.setId);
    const option = row?.options.find(option => JSON.stringify(option) === JSON.stringify(saved.option));
    if (option) selected.set(row.setId, { row, option });
  }
  if (selected.size) {
    funding = forecastGalleryTurnover({ capital, resaleDiscountBps,
      steps: [...selected].map(([setId, entry]) => ({ setId, items: entry.option.items })) });
    if (funding.status !== 'estimated' || funding.feasible === false || lossLimit !== null && funding.expectedNetLoss > lossLimit) {
      return { status: 'unavailable', reason: 'resume-input-invalid', route: [] };
    }
    gain = [...selected.values()].reduce((sum, entry) => sum + entry.option.projectedTokens - entry.row.baselineTokens, 0);
  }
  let selectionStopped = false, comparisons = 0;
  for (;;) {
    let best = null;
    search: for (const row of rows) for (const option of row.options ?? []) {
      const current = selected.get(row.setId);
      const added = option.projectedTokens - (current?.option.projectedTokens ?? row.baselineTokens);
      if (!(added > 0) || !Array.isArray(option.items)) continue;
      const trial = new Map(selected); trial.set(row.setId, { row, option });
      const estimate = forecastGalleryTurnover({ capital, resaleDiscountBps,
        steps: [...trial].map(([setId, entry]) => ({ setId, items: entry.option.items })) });
      if (estimate.status !== 'estimated' || estimate.feasible === false || lossLimit !== null && estimate.expectedNetLoss > lossLimit) {
        skipped.set(row.setId, { setId: row.setId, name: row.name,
          reason: estimate.status !== 'estimated' ? estimate.reason : estimate.feasible === false ? 'capital-gap' : 'loss-limit',
          requiredCapital: estimate.requiredCapital ?? null, capitalShortfall: estimate.capitalShortfall ?? null });
        comparisons++;
        if (yield { phase: 'route', completed: selected.size, total: rows.length, comparisons }) { selectionStopped = true; break search; }
        continue;
      }
      const incrementalLoss = estimate.expectedNetLoss - funding.expectedNetLoss;
      const value = { row, option, trial, estimate, added, ratio: incrementalLoss / added };
      if (!best || value.ratio < best.ratio || value.ratio === best.ratio
          && (estimate.requiredCapital < best.estimate.requiredCapital
            || estimate.requiredCapital === best.estimate.requiredCapital && row.setId.localeCompare(best.row.setId) < 0)) best = value;
      comparisons++;
      if (yield { phase: 'route', completed: selected.size, total: rows.length, comparisons }) { selectionStopped = true; break search; }
    }
    if (!best) break;
    selected.clear(); for (const entry of best.trial) selected.set(...entry);
    funding = best.estimate; gain += best.added;
    if (selectionStopped) break;
  }
  const route = funding.steps.map((step, index) => {
    const { row, option } = selected.get(step.setId);
    return { ...step, order: index + 1, name: row.name, categoryId: row.categoryId,
      currentGrade: row.currentGrade, targetGrade: option.grade, currentScore: row.currentScore,
      projectedScore: option.score, baselineTokens: row.baselineTokens, projectedTokens: option.projectedTokens,
      addedTokens: option.projectedTokens - row.baselineTokens, items: option.items,
      claimState: 'unknown', estimated: option.estimated !== false, searchComplete: option.searchComplete === true };
  });
  for (const row of rows) if (!(row.options?.length > 0) && row.reason) unavailable.push({ setId: row.setId, name: row.name, reason: row.reason });
  return { status: route.length ? 'ready' : 'no-route', objective: 'low-forecast-loss-per-added-token',
    claimState: 'unknown', tokenBasis: 'catalog-increase-not-unclaimed-balance',
    baselineTokens: rows.reduce((sum, row) => sum + (row.baselineTokens ?? 0), 0), addedTokens: gain,
    funding, route, selectedOptions: [...selected].map(([setId, entry]) => ({ setId, option: entry.option })),
    selectionStopped, comparisons, skipped: [...skipped.values()].filter(row => !selected.has(row.setId)), unavailable,
    freeCheck: rows.filter(row => row.currentGrade).map(row => ({ setId: row.setId, name: row.name,
      grade: row.currentGrade, catalogTokens: row.baselineTokens, claimState: 'unknown' })), searchComplete: false };
}
