import { compileGalleryScoringRules, summarizeGalleryScore } from './scoring.js';

// Gallery planning is deliberately bounded and read only.  A plan is a
// proposal for the UI; it never reserves coins, creates EA entities or starts
// a market request.  Missing public/EA fields remain explicit in the result.
const validId = value => Number.isSafeInteger(value) && value > 0;
const validScore = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
const validPrice = value => Number.isSafeInteger(value) && value > 0 && value <= 15000000;
const asPrice = (prices, id) => {
  const value = prices?.[String(id)] ?? prices?.[id];
  return validPrice(value) ? value : null;
};
const candidateScore = row => validScore(row?.gradingScore)
  ? { value: row.gradingScore, source: 'ea' }
  : validScore(row?.galleryScore) ? { value: row.galleryScore, source: 'catalog' } : null;
const scoreOf = state => state.summary?.low?.total ?? -Infinity;

function targetThreshold(set, targetGrade) {
  if (Number.isSafeInteger(targetGrade) && targetGrade >= 0) return targetGrade;
  if (typeof targetGrade !== 'string') return null;
  const grade = set?.grades?.find(row => String(row.name).toLowerCase() === targetGrade.toLowerCase());
  return Number.isSafeInteger(grade?.threshold) && grade.threshold >= 0 ? grade.threshold : null;
}

function comparableRows(rows) {
  return rows.map(row => ({ ...row, collected: true }));
}

function summarize(set, catalog, existing, selected) {
  const rows = comparableRows([...existing, ...selected]);
  try {
    return summarizeGalleryScore({ set, catalog, progress: {
      season: '27', setId: Number(String(set.id).split(':').at(-1)), complete: true, rows,
    } });
  } catch {
    return { status: 'unavailable', reason: 'input-invalid' };
  }
}

function rank(a, b, threshold) {
  const aReached = a.summary?.full === true && scoreOf(a) >= threshold;
  const bReached = b.summary?.full === true && scoreOf(b) >= threshold;
  if (aReached !== bReached) return aReached ? -1 : 1;
  if (aReached && bReached) {
    const aCost = a.unknownPrice ? Number.POSITIVE_INFINITY : a.price;
    const bCost = b.unknownPrice ? Number.POSITIVE_INFINITY : b.price;
    if (aCost !== bCost) return aCost - bCost;
  }
  return scoreOf(b) - scoreOf(a) || a.ids.length - b.ids.length || a.price - b.price;
}

function materialize(state, targetGrade, threshold) {
  const missingPriceIds = state.items.filter(item => item.price == null).map(item => item.eaId);
  const estimated = state.items.some(item => item.scoreSource !== 'ea');
  const reached = state.summary?.full === true && scoreOf(state) >= threshold;
  return {
    targetGrade, threshold, reached, score: Number.isFinite(scoreOf(state)) ? scoreOf(state) : null,
    items: state.items.map(item => ({ ...item })),
    totalPrice: missingPriceIds.length ? null : state.price,
    missingPriceIds, estimated,
    confidence: estimated ? 'catalog-estimate' : 'ea-score-input',
    scoreHigh: state.summary?.high?.total ?? null,
    unknownFields: [...(state.summary?.unknownFields ?? [])],
  };
}

export function* planGalleryGradeSteps({ set, catalog, progress, prices = {}, targetGrade,
  maxPlans = 3, beamWidth = 96, maxCandidates = 128, maxEvaluations = 6000 } = {}) {
  if (![maxPlans, beamWidth, maxCandidates, maxEvaluations].every(value => Number.isSafeInteger(value) && value > 0)
      || maxPlans > 10 || beamWidth > 512 || maxCandidates > 250 || maxEvaluations > 100000) {
    return { status: 'unavailable', reason: 'search-options-invalid' };
  }
  if (!set || !Array.isArray(set.grades) || !Number.isSafeInteger(set.requiredCards) || set.requiredCards < 1
      || !catalog || catalog.source !== 'futgg' || !progress || !Array.isArray(progress.rows)) {
    return { status: 'unavailable', reason: 'input-invalid' };
  }
  const threshold = targetThreshold(set, targetGrade);
  if (threshold == null) return { status: 'unavailable', reason: 'target-grade-unknown' };
  const compiled = compileGalleryScoringRules(catalog);
  if (compiled.status !== 'ready') return { status: 'unavailable', reason: compiled.reason };
  const rows = progress.rows.filter(row => validId(row?.eaId));
  if (rows.length !== progress.rows.length) return { status: 'unavailable', reason: 'input-invalid' };
  if (new Set(rows.map(row => row.eaId)).size !== rows.length) return { status: 'unavailable', reason: 'duplicate-version' };
  if (progress.complete === false || rows.some(row => typeof row.collected !== 'boolean')) {
    return { status: 'partial', reason: 'collection-status-unknown', targetGrade, threshold, plans: [] };
  }
  const existing = rows.filter(row => row.collected === true && validScore(row.gradingScore));
  const incompleteExisting = rows.filter(row => row.collected === true && !validScore(row.gradingScore));
  const candidates = rows.filter(row => row.collected !== true).map(row => {
    const score = candidateScore(row);
    return score ? { row, score } : null;
  }).filter(Boolean).sort((a, b) => b.score.value - a.score.value || a.row.eaId - b.row.eaId).slice(0, maxCandidates);
  const omittedCandidates = rows.filter(row => row.collected !== true).length - candidates.length;
  if (incompleteExisting.length) return { status: 'partial', reason: 'existing-score-unknown', targetGrade, threshold,
    candidateCount: candidates.length, omittedCandidates, plans: [] };
  const base = { ids: [], items: [], selected: [], price: 0, unknownPrice: false,
    nextIndex: 0, summary: summarize(set, catalog, existing, []) };
  if (!base.summary?.low) return { status: 'unavailable', reason: base.summary?.reason ?? 'input-invalid', plans: [] };
  if (base.summary?.full === true && scoreOf(base) >= threshold) {
    return { status: 'achieved', targetGrade, threshold, currentScore: scoreOf(base), candidateCount: candidates.length,
      omittedCandidates, plans: [] };
  }
  let states = [base]; let evaluations = 1; const plans = []; let bestSeen = base;
  let budgetExhausted = false, beamTruncated = false, timeExhausted = false;
  let scoringBounded = base.summary.selection === 'bounded-search';
  let scoreUncertain = base.summary.low.total !== base.summary.high.total || base.summary.ruleDifference;
  for (let depth = 0; depth < set.requiredCards && states.length && evaluations < maxEvaluations; depth++) {
    const next = [];
    expansion: for (const state of states) for (let index = state.nextIndex; index < candidates.length; index++) {
      if (evaluations >= maxEvaluations) { budgetExhausted = true; break expansion; }
      const candidate = candidates[index];
      const price = asPrice(prices, candidate.row.eaId);
      const item = { ...candidate.row, score: candidate.score.value, scoreSource: candidate.score.source, price };
      // Use the EA score when present; otherwise the public Gallery score is
      // only an explicitly provisional estimate for the local planner.
      const selectedRow = { ...candidate.row, gradingScore: candidate.score.value };
      const selected = [...state.selected, selectedRow];
      const nextState = { ids: [...state.ids, candidate.row.eaId], items: [...state.items, item], selected,
        nextIndex: index + 1,
        price: state.price + (price ?? 0), unknownPrice: state.unknownPrice || price == null,
        summary: summarize(set, catalog, existing, selected) };
      next.push(nextState); evaluations++;
      scoringBounded ||= nextState.summary.selection === 'bounded-search';
      scoreUncertain ||= nextState.summary.low?.total !== nextState.summary.high?.total || nextState.summary.ruleDifference;
      if (rank(nextState, bestSeen, threshold) < 0 || scoreOf(nextState) > scoreOf(bestSeen)) bestSeen = nextState;
      if (nextState.summary?.full === true && scoreOf(nextState) >= threshold) plans.push(nextState);
      if (yield { evaluations }) { timeExhausted = true; break expansion; }
    }
    next.sort((a, b) => rank(a, b, threshold));
    beamTruncated ||= next.length > beamWidth;
    states = next.slice(0, beamWidth);
    if (budgetExhausted || timeExhausted) break;
  }
  budgetExhausted ||= evaluations >= maxEvaluations && states.some(state => state.ids.length < set.requiredCards && state.nextIndex < candidates.length);
  const scopeTruncated = progress.candidateOnly === true || progress.poolComplete === false;
  const searchComplete = !scopeTruncated && !timeExhausted && !budgetExhausted && !beamTruncated && omittedCandidates === 0 && !scoringBounded && !scoreUncertain;
  const unique = new Map();
  for (const state of plans.sort((a, b) => rank(a, b, threshold))) {
    const key = state.ids.slice().sort((a, b) => a - b).join(',');
    if (!unique.has(key)) unique.set(key, materialize(state, targetGrade, threshold));
    if (unique.size >= Math.max(1, Math.min(10, maxPlans))) break;
  }
  const output = [...unique.values()];
  if (!output.length) {
    const best = [bestSeen, ...states].sort((a, b) => rank(a, b, threshold))[0];
    const reason = timeExhausted ? 'search-time-exhausted' : budgetExhausted ? 'search-budget-exhausted' : omittedCandidates > 0 ? 'candidate-search-truncated'
      : beamTruncated ? 'beam-search-truncated' : scoreUncertain ? 'score-conditions-unknown'
        : scoringBounded ? 'score-selection-bounded' : 'target-unreachable';
    return { status: searchComplete ? 'no-plan' : 'partial', reason: scopeTruncated ? 'candidate-search-truncated' : reason,
      targetGrade, threshold, currentScore: scoreOf(base), bestScore: best ? scoreOf(best) : null,
      candidateCount: candidates.length, omittedCandidates, evaluations, searchComplete, plans: [] };
  }
  return { status: 'ready', targetGrade, threshold, currentScore: scoreOf(base), candidateCount: candidates.length,
    omittedCandidates, evaluations, searchComplete, scopeTruncated, timeExhausted, plans: output };
}

export function planGalleryGrade(input) {
  const steps = planGalleryGradeSteps(input);
  let next;
  do { next = steps.next(); } while (!next.done);
  return next.value;
}
