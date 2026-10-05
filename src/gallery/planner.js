import { compileGalleryScoringRules, createGalleryScoreSummarizer, galleryRuleKeys } from './scoring.js';
import { refineGalleryCostSteps } from './cost-search.js';
import { selectGalleryCandidatePool } from './candidate-pool.js';
import { galleryPriceBandSeedSteps } from './price-band-seeds.js';

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
// A version already held by the account must never be proposed for purchase.
// Gallery's native collection flag can lag Club/Storage reads, so ownership
// evidence is intentionally broader than `collected === true`.
export const isGalleryOwned = row => row?.collected === true || row?.inClub === true || row?.held === true;
const scoreOf = state => state.summary?.low?.total ?? -Infinity;
export const galleryCostSearchKeys = (row, tags) => galleryRuleKeys({ ...row, firstOwned: false }, tags);

function targetThreshold(set, targetGrade) {
  if (Number.isSafeInteger(targetGrade) && targetGrade >= 0) return targetGrade;
  if (typeof targetGrade !== 'string') return null;
  const grade = set?.grades?.find(row => String(row.name).toLowerCase() === targetGrade.toLowerCase());
  return Number.isSafeInteger(grade?.threshold) && grade.threshold >= 0 ? grade.threshold : null;
}

function comparableRows(rows) {
  return rows.map(row => ({ ...row, collected: true }));
}

function summarize(set, catalog, existing, selected, score) {
  const rows = comparableRows([...existing, ...selected]);
  try {
    return score({ set, catalog, progress: {
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

function priceOf(state) {
  return state.unknownPrice ? Number.POSITIVE_INFINITY : state.price;
}

function cheaperState(a, b) {
  return priceOf(a) - priceOf(b)
    || scoreOf(b) - scoreOf(a)
    || a.ids.length - b.ids.length;
}

function materialize(state, targetGrade, threshold, currentScore = 0) {
  const missingPriceIds = state.items.filter(item => item.price == null).map(item => item.eaId);
  const estimated = state.items.some(item => item.scoreSource !== 'ea');
  const reached = scoreOf(state) >= threshold;
  return {
    targetGrade, threshold, reached, currentScore, addedScore: Number.isFinite(scoreOf(state)) ? scoreOf(state) - currentScore : null,
    score: Number.isFinite(scoreOf(state)) ? scoreOf(state) : null,
    items: state.items.map(item => ({ ...item })),
    totalPrice: missingPriceIds.length ? null : state.price,
    missingPriceIds, estimated,
    confidence: estimated ? 'catalog-estimate' : 'ea-score-input',
    scoreHigh: state.summary?.high?.total ?? null,
    unknownFields: [...(state.summary?.unknownFields ?? [])],
  };
}

export function* planGalleryGradeSteps({ set, catalog, progress, prices = {}, targetGrade,
  maxPlans = 3, beamWidth = 96, maxCandidates = 250, maxEvaluations = 30000 } = {}) {
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
  const score = createGalleryScoreSummarizer(catalog), summaries = new Map();
  const summaryFor = selected => {
    // Inputs are fixed for this generator. Preserve selected order so the
    // reference selection's tie-breaking stays identical.
    const key = selected.map(row => row.eaId).join(',');
    if (!summaries.has(key)) {
      if (summaries.size >= 4096) summaries.clear();
      summaries.set(key, summarize(set, catalog, existing, selected, score));
    }
    return summaries.get(key);
  };
  const rows = progress.rows.filter(row => validId(row?.eaId));
  if (rows.length !== progress.rows.length) return { status: 'unavailable', reason: 'input-invalid' };
  if (new Set(rows.map(row => row.eaId)).size !== rows.length) return { status: 'unavailable', reason: 'duplicate-version' };
  if (progress.complete === false || rows.some(row => typeof row.collected !== 'boolean')) {
    return { status: 'partial', reason: 'collection-status-unknown', targetGrade, threshold, plans: [] };
  }
  const existing = rows.filter(row => isGalleryOwned(row) && validScore(row.gradingScore));
  const incompleteExisting = rows.filter(row => isGalleryOwned(row) && !validScore(row.gradingScore));
  const requiredSlots = Math.max(1, set.requiredCards - existing.length);
  const eligibleCandidates = rows.filter(row => !isGalleryOwned(row)).map(row => {
    const score = candidateScore(row);
    return score ? { row, score, id: row.eaId, price: asPrice(prices, row.eaId),
      diversityKeys: galleryCostSearchKeys(row, compiled.tags) } : null;
  }).filter(Boolean);
  const eligibleById = new Map(eligibleCandidates.map(candidate => [candidate.row.eaId, candidate]));
  const candidates = selectGalleryCandidatePool(eligibleCandidates.map(candidate => ({
    ...candidate, score: candidate.score.value,
  })), maxCandidates).map(candidate => eligibleById.get(candidate.id));
  const omittedCandidates = rows.filter(row => !isGalleryOwned(row)).length - candidates.length;
  const requestedCandidates = rows.filter(row => !isGalleryOwned(row)).length;
  const quotedCandidateCount = eligibleCandidates.filter(candidate => candidate.price != null).length;
  const scoreSourceCounts = eligibleCandidates.reduce((counts, candidate) => {
    counts[candidate.score.source]++;
    return counts;
  }, { ea: 0, catalog: 0 });
  if (incompleteExisting.length) return { status: 'partial', reason: 'existing-score-unknown', targetGrade, threshold,
    candidateCount: candidates.length, omittedCandidates, requestedCandidates, quotedCandidateCount, scoreSourceCounts, plans: [] };
  const base = { ids: [], items: [], selected: [], price: 0, unknownPrice: false,
    nextIndex: 0, summary: summaryFor([]) };
  if (!base.summary?.low) return { status: 'unavailable', reason: base.summary?.reason ?? 'input-invalid', plans: [] };
  if (scoreOf(base) >= threshold) {
    return { status: 'achieved', targetGrade, threshold, currentScore: scoreOf(base), candidateCount: candidates.length,
      omittedCandidates, requestedCandidates, quotedCandidateCount, scoreSourceCounts, plans: [] };
  }
  // Seed the bounded search with the highest-scoring complete lineup. Gallery
  // sets often expose hundreds of versions; this gives easy grades an
  // immediate valid candidate while the normal beam search still explores
  // cheaper/bonus-aware alternatives afterward.
  let states = [base]; let evaluations = 1; const plans = []; let bestSeen = base;
  let cheapestSeed = null;
  const canEvaluateComplete = maxEvaluations >= requiredSlots + 1;
  if (canEvaluateComplete && candidates.length >= requiredSlots && requiredSlots > 0) {
    const greedyCandidates = candidates.slice().sort((a, b) => b.score.value - a.score.value
      || a.row.eaId - b.row.eaId).slice(0, requiredSlots);
    const greedySelected = greedyCandidates.map(candidate => ({ ...candidate.row, gradingScore: candidate.score.value, firstOwned: false }));
    const greedy = { ids: greedyCandidates.map(candidate => candidate.row.eaId),
      items: greedyCandidates.map(candidate => ({ ...candidate.row, score: candidate.score.value,
        scoreSource: candidate.score.source, price: asPrice(prices, candidate.row.eaId) })),
      selected: greedySelected, nextIndex: candidates.length,
      price: greedyCandidates.reduce((sum, candidate) => sum + (asPrice(prices, candidate.row.eaId) ?? 0), 0),
      unknownPrice: greedyCandidates.some(candidate => asPrice(prices, candidate.row.eaId) == null),
      summary: summaryFor(greedySelected) };
    if (greedy.summary?.full === true && scoreOf(greedy) >= threshold) plans.push(greedy);
    if (rank(greedy, bestSeen, threshold) < 0) bestSeen = greedy;
  }
  // Always test a cheapest complete lineup independently of score order. The
  // normal beam is score-first while it is below the target, so a high-priced
  // high-score card can otherwise evict the inexpensive path before the last
  // slot is evaluated. A valid cheap lineup is the primary Gallery planning
  // objective once the requested grade is reachable.
  if (canEvaluateComplete && candidates.length >= requiredSlots && requiredSlots > 0) {
    const cheapestCandidates = candidates.slice().sort((a, b) => {
      const aPrice = asPrice(prices, a.row.eaId), bPrice = asPrice(prices, b.row.eaId);
      return (aPrice == null ? Number.POSITIVE_INFINITY : aPrice)
        - (bPrice == null ? Number.POSITIVE_INFINITY : bPrice)
        || b.score.value - a.score.value || a.row.eaId - b.row.eaId;
    }).slice(0, requiredSlots);
    const selected = cheapestCandidates.map(candidate => ({ ...candidate.row,
      gradingScore: candidate.score.value, firstOwned: false }));
    const cheapest = { ids: cheapestCandidates.map(candidate => candidate.row.eaId),
      items: cheapestCandidates.map(candidate => ({ ...candidate.row, score: candidate.score.value,
        scoreSource: candidate.score.source, price: asPrice(prices, candidate.row.eaId) })),
      selected, nextIndex: candidates.length,
      price: cheapestCandidates.reduce((sum, candidate) => sum + (asPrice(prices, candidate.row.eaId) ?? 0), 0),
      unknownPrice: cheapestCandidates.some(candidate => asPrice(prices, candidate.row.eaId) == null),
      summary: summaryFor(selected) };
    cheapestSeed = cheapest;
    if (rank(cheapest, bestSeen, threshold) < 0) bestSeen = cheapest;
    if (cheapest.summary?.full === true && scoreOf(cheapest) >= threshold) plans.push(cheapest);
  }
  let budgetExhausted = false, beamTruncated = false, timeExhausted = false;
  if (cheapestSeed && !cheapestSeed.unknownPrice && candidates.length > requiredSlots
      && !timeExhausted && !(cheapestSeed.summary?.full && scoreOf(cheapestSeed) >= threshold)) {
    const byId = new Map(candidates.map(candidate => [candidate.row.eaId, candidate]));
    const refinement = refineGalleryCostSteps({ initial: { ...cheapestSeed, cost: cheapestSeed.price, missingPrices: false },
      seedSteps: galleryPriceBandSeedSteps({ targets: [{ set, catalog, progress }],
        candidates: candidates.map(candidate => ({ id: candidate.row.eaId, price: asPrice(prices, candidate.row.eaId), score: candidate.score.value })) }),
      candidates: candidates.map(candidate => ({ id: candidate.row.eaId, price: asPrice(prices, candidate.row.eaId),
        score: candidate.score.value, diversityKeys: galleryCostSearchKeys(candidate.row, compiled.tags) })),
      maxEvaluations: maxEvaluations - evaluations,
      measure: state => ({ reached: state.summary?.full === true && scoreOf(state) >= threshold,
        progress: Math.min(1, scoreOf(state) / Math.max(1, threshold)),
        diversityKey: (state.summary?.low?.tags ?? []).map(tag => `${tag.id}:${tag.count}:${tag.pct}`).join('|') }),
      evaluate: ids => {
        const picked = ids.map(id => byId.get(id));
        const selected = picked.map(candidate => ({ ...candidate.row, gradingScore: candidate.score.value, firstOwned: false }));
        const items = picked.map(candidate => ({ ...candidate.row, score: candidate.score.value,
          scoreSource: candidate.score.source, price: asPrice(prices, candidate.row.eaId) }));
        const price = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
        return { ids, items, selected, nextIndex: candidates.length, price, cost: price,
          unknownPrice: items.some(item => item.price == null), missingPrices: items.some(item => item.price == null),
          summary: summaryFor(selected) };
      } });
    let step = refinement.next();
    while (!step.done) {
      const stop = yield { evaluations: evaluations + step.value.evaluations };
      if (stop) timeExhausted = true;
      step = refinement.next(stop);
    }
    evaluations += step.value.evaluations; plans.push(...step.value.plans);
    if (step.value.bestState && rank(step.value.bestState, bestSeen, threshold) < 0) bestSeen = step.value.bestState;
    beamTruncated ||= step.value.truncated === true;
  }
  let scoringBounded = base.summary.selection === 'bounded-search';
  let scoreUncertain = base.summary.low.total !== base.summary.high.total || base.summary.ruleDifference;
  // Filling the missing slots is the cheap starting point, not a purchase
  // ceiling: a full low-score collection can still need lineup upgrades.
  for (let depth = 0; depth < set.requiredCards && states.length && evaluations < maxEvaluations
      && !timeExhausted; depth++) {
    const next = [];
    expansion: for (const state of states) for (let index = state.nextIndex; index < candidates.length; index++) {
      if (evaluations >= maxEvaluations) { budgetExhausted = true; break expansion; }
      const candidate = candidates[index];
      const price = asPrice(prices, candidate.row.eaId);
      const item = { ...candidate.row, score: candidate.score.value, scoreSource: candidate.score.source, price };
      // Use the EA score when present; otherwise the public Gallery score is
      // only an explicitly provisional estimate for the local planner.
      const selectedRow = { ...candidate.row, gradingScore: candidate.score.value, firstOwned: false };
      const selected = [...state.selected, selectedRow];
      const nextState = { ids: [...state.ids, candidate.row.eaId], items: [...state.items, item], selected,
        nextIndex: index + 1,
        price: state.price + (price ?? 0), unknownPrice: state.unknownPrice || price == null,
        summary: summaryFor(selected) };
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
    // Keep one lowest-cost partial path alive at every depth. This preserves
    // a cheap combination for nonlinear bonus rules without replacing the
    // score-ranked beam used to find bonus-aware solutions.
    if (next.length > beamWidth && beamWidth > 1) {
      const cheapest = next.slice().sort(cheaperState)[0];
      if (cheapest && !states.includes(cheapest)) states[states.length - 1] = cheapest;
    }
    if (budgetExhausted || timeExhausted) break;
  }
  budgetExhausted ||= evaluations >= maxEvaluations && states.some(state => state.ids.length < set.requiredCards && state.nextIndex < candidates.length);
  const scopeTruncated = progress.candidateOnly === true || progress.poolComplete === false;
  const proofInputsKnown = candidates.every(candidate => candidate.score.source === 'ea' && candidate.price != null)
    && plans.every(state => !state.summary?.ruleDifference && state.summary?.low?.total === state.summary?.high?.total
      && state.summary?.selection !== 'bounded-search');
  const searchComplete = !scopeTruncated && !timeExhausted && !budgetExhausted && !beamTruncated
    && omittedCandidates === 0 && !scoringBounded && !scoreUncertain && proofInputsKnown;
  const unique = new Map();
  for (const state of plans.sort((a, b) => rank(a, b, threshold))) {
    const key = state.ids.slice().sort((a, b) => a - b).join(',');
    if (!unique.has(key)) unique.set(key, materialize(state, targetGrade, threshold, scoreOf(base)));
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
      distanceToTarget: best ? Math.max(0, threshold - scoreOf(best)) : null,
      bestCandidate: best ? { ids: [...best.ids], score: scoreOf(best),
        totalPrice: best.unknownPrice ? null : best.price, missingCards: best.ids.length,
        items: best.items.map(item => ({ eaId: item.eaId, name: item.name ?? null,
          score: item.score ?? item.gradingScore ?? null, price: item.price ?? null })) } : null,
      missingPriceCount: requestedCandidates - quotedCandidateCount,
      candidateCount: candidates.length, omittedCandidates, requestedCandidates, quotedCandidateCount,
      scoreSourceCounts, evaluations, searchComplete, scopeTruncated, timeExhausted, beamTruncated, budgetExhausted, plans: [] };
  }
  const costAudit = cheapestSeed && !cheapestSeed.unknownPrice && !(cheapestSeed.summary?.full === true && scoreOf(cheapestSeed) >= threshold)
    ? { totalPrice: cheapestSeed.price, score: scoreOf(cheapestSeed), missingCards: cheapestSeed.items.length,
      target: threshold, reached: false } : null;
  return { status: 'ready', targetGrade, threshold, currentScore: scoreOf(base), candidateCount: candidates.length,
    omittedCandidates, requestedCandidates, quotedCandidateCount, scoreSourceCounts,
    evaluations, searchComplete, scopeTruncated, timeExhausted, costAudit,
    beamTruncated, budgetExhausted, plans: output };
}

export function planGalleryGrade(input) {
  const steps = planGalleryGradeSteps(input);
  let next;
  do { next = steps.next(); } while (!next.done);
  return next.value;
}
