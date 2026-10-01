import { compileGalleryScoringRules, summarizeGalleryScore } from './scoring.js';

const validId = value => Number.isSafeInteger(value) && value > 0;
const validScore = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
const validPrice = value => Number.isSafeInteger(value) && value > 0 && value <= 15000000;
const score = row => validScore(row.gradingScore) ? row.gradingScore : validScore(row.galleryScore) ? row.galleryScore : null;
const fail = (status, reason, extra = {}) => ({ status, reason, plans: [], ...extra });

function evaluate(targets, selected) {
  return targets.map(target => {
    const key = target.progress.rows.filter(row => selected.has(row.eaId) && !row.collected).map(row => row.eaId).sort((a, b) => a - b).join(',');
    let summary = target.summaries.get(key);
    if (!summary) {
      summary = summarizeGalleryScore({ set: target.set, catalog: target.catalog, progress: {
      ...target.progress, season: '27', setId: Number(target.set.id.slice(6)), complete: true,
      rows: target.progress.rows.map(row => selected.has(row.eaId) && !row.collected
        ? { ...row, collected: true, gradingScore: score(row), firstOwned: false } : row),
      } });
      target.summaries.set(key, summary);
    }
    return { target, summary, reached: summary.full === true && summary.low?.total >= target.threshold };
  });
}

function rank(a, b, total) {
  const reached = state => state.results.filter(result => result.reached).length;
  const ar = reached(a), br = reached(b);
  if (ar !== br) return br - ar;
  const cost = state => state.missingPrices ? Infinity : state.cost;
  if (ar === total) return cost(a) - cost(b) || a.ids.length - b.ids.length;
  const progress = state => state.results.reduce((sum, result) => sum
    + Math.min(1, (result.summary.low?.total ?? 0) / Math.max(1, result.target.threshold))
    + Math.min(1, (result.summary.lineup?.length ?? 0) / result.target.set.requiredCards), 0);
  return progress(b) - progress(a) || cost(a) - cost(b) || a.ids.length - b.ids.length;
}

function materialize(state, candidates, budget) {
  const missingPriceIds = state.ids.filter(id => candidates.get(id).price == null);
  return {
    totalPrice: missingPriceIds.length ? null : state.cost, missingPriceIds,
    remainingBudget: budget == null || missingPriceIds.length ? null : budget - state.cost,
    items: state.ids.map(id => {
      const candidate = candidates.get(id);
      return { ...candidate.row, price: candidate.price,
        scoreSource: validScore(candidate.row.gradingScore) ? 'ea' : 'catalog',
        targetIds: state.results.filter(result => result.summary.lineup?.some(row => row.eaId === id)).map(result => result.target.set.id) };
    }),
    targets: state.results.map(({ target, summary, reached }) => ({ setId: target.set.id, name: target.set.name,
      targetGrade: target.targetGrade, threshold: target.threshold, reached, score: summary.low?.total ?? null,
      scoreHigh: summary.high?.total ?? null, pointsMissing: Math.max(0, target.threshold - (summary.low?.total ?? 0)),
      unknownFields: summary.unknownFields ?? [],
      // Directory rewards are not EA claim receipts and are not summed.
      rewards: (target.grade.rewards ?? []).map(reward => ({ ...reward })), rewardStatus: 'catalog-only',
    })),
    estimated: state.results.some(({ target, summary }) => summary.lineup?.some(row =>
      !validScore(target.progress.rows.find(original => original.eaId === row.eaId)?.gradingScore))),
  };
}

// Search the shared version pool directly, retaining cross-set alternatives.
// This module is pure: a plan never reads providers or authorizes a purchase.
export function* planGalleryJointSteps({ targets, budget = null, maxPlans = 3, maxCandidates = 192,
  maxEvaluations = 3000, beamWidth = 64 } = {}) {
  if (!Array.isArray(targets) || !targets.length) return fail('unavailable', 'targets-invalid');
  if (budget != null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 1000000000)) return fail('unavailable', 'budget-invalid');
  if (![maxPlans, maxCandidates, maxEvaluations, beamWidth].every(value => Number.isSafeInteger(value) && value > 0)
      || maxPlans > 10 || maxCandidates > 512 || maxEvaluations > 20000 || beamWidth > 256) return fail('unavailable', 'search-options-invalid');
  const targetIds = new Set(), identities = new Map(), allCandidates = new Map(), prepared = [];
  const scopes = new Set(targets.map(target => target.scope).filter(value => value != null));
  const platforms = new Set(targets.map(target => target.platform).filter(value => value != null));
  if (scopes.size > 1 || platforms.size > 1) return fail('unavailable', 'target-context-mismatch');
  for (const target of targets) {
    const { set, catalog, progress } = target;
    if (!/^futgg:[1-9]\d*$/.test(set?.id) || targetIds.has(set.id) || !Array.isArray(set.grades)
        || !validId(set.requiredCards) || set.requiredCards > 256 || catalog?.source !== 'futgg'
        || !Array.isArray(progress?.rows) || progress.rows.length > 2000
        || progress.season != null && progress.season !== '27'
        || progress.setId != null && progress.setId !== Number(set.id.slice(6))) return fail('unavailable', 'target-input-invalid');
    targetIds.add(set.id);
    const grade = set.grades.find(row => row.name === target.targetGrade);
    if (!grade || !Number.isSafeInteger(grade.threshold) || grade.threshold < 0) return fail('unavailable', 'target-grade-unknown');
    const compiled = compileGalleryScoringRules(catalog);
    if (compiled.status !== 'ready') return fail('unavailable', compiled.reason);
    if (progress.complete === false || progress.rows.some(row => typeof row.collected !== 'boolean'
        || row.collected && !validScore(row.gradingScore))) return fail('partial', 'target-state-unknown');
    const seen = new Set();
    for (const row of progress.rows) {
      if (!validId(row.eaId) || seen.has(row.eaId)) return fail('unavailable', 'duplicate-version');
      seen.add(row.eaId);
      const previous = identities.get(row.eaId);
      // A shared version cannot be collected in only one complete snapshot.
      if (previous && ['collected', 'gradingScore', 'galleryScore', 'playerEaId', 'firstOwned', 'holographic', 'rarityEaId',
        'clubEaId', 'leagueEaId', 'nationEaId', 'overall', 'weakFoot', 'skillMoves', 'positions'].some(key =>
        JSON.stringify(previous[key] ?? null) !== JSON.stringify(row[key] ?? null))) return fail('partial', 'version-facts-conflict');
      identities.set(row.eaId, row);
      if (row.collected) continue;
      const quote = target.prices?.[row.eaId], price = validPrice(quote) ? quote : null;
      const existing = allCandidates.get(row.eaId);
      if (existing) {
        existing.memberships++;
        if (existing.price != null && price != null && existing.price !== price) existing.priceConflict = true;
        existing.price = existing.priceConflict ? null : price ?? existing.price;
      } else allCandidates.set(row.eaId, { row, price, memberships: 1 });
    }
    prepared.push({ ...target, grade, threshold: grade.threshold, summaries: new Map() });
  }
  const candidateRows = [...allCandidates.values()].filter(candidate => score(candidate.row) != null)
    .sort((a, b) => b.memberships - a.memberships || score(b.row) - score(a.row) || a.row.eaId - b.row.eaId);
  const omittedCandidates = allCandidates.size - Math.min(candidateRows.length, maxCandidates);
  const selectedCandidates = candidateRows.slice(0, maxCandidates);
  const candidateMap = new Map(selectedCandidates.map(candidate => [candidate.row.eaId, candidate]));
  const base = { ids: [], nextIndex: 0, cost: 0, missingPrices: false, results: evaluate(prepared, new Set()) };
  if (base.results.some(result => !result.summary.low)) return fail('unavailable', 'scoring-unavailable');
  if (base.results.every(result => result.reached)) return { status: 'achieved', plans: [], targets: materialize(base, candidateMap, budget).targets };
  let states = [base], evaluations = 1, budgetExhausted = false, beamTruncated = false, timeExhausted = false;
  let bestSeen = base;
  let scoringBounded = base.results.some(result => result.summary.selection === 'bounded-search');
  let uncertain = base.results.some(result => result.summary.status === 'uncertain'), missingPrice = false, overBudget = false;
  const plans = [], depthLimit = prepared.reduce((sum, target) => sum + target.set.requiredCards, 0);
  for (let depth = 0; depth < depthLimit && states.length; depth++) {
    const next = [];
    expansion: for (const state of states) for (let index = state.nextIndex; index < selectedCandidates.length; index++) {
      if (evaluations >= maxEvaluations) { budgetExhausted = true; break expansion; }
      const candidate = selectedCandidates[index];
      if (budget != null && candidate.price == null) { missingPrice = true; continue; }
      const cost = state.cost + (candidate.price ?? 0);
      if (budget != null && cost > budget) { overBudget = true; continue; }
      const ids = [...state.ids, candidate.row.eaId];
      const results = evaluate(prepared, new Set(ids)); evaluations++;
      const value = { ids, nextIndex: index + 1, cost, missingPrices: state.missingPrices || candidate.price == null, results };
      if (rank(value, bestSeen, prepared.length) < 0) bestSeen = value;
      scoringBounded ||= results.some(result => result.summary.selection === 'bounded-search');
      uncertain ||= results.some(result => result.summary.status === 'uncertain');
      if (results.every(result => result.reached)) plans.push(value);
      next.push(value);
      if (yield { evaluations }) { timeExhausted = true; break expansion; }
    }
    next.sort((a, b) => rank(a, b, prepared.length));
    beamTruncated ||= next.length > beamWidth;
    states = next.slice(0, beamWidth);
    if (budgetExhausted || timeExhausted) break;
  }
  const scopeTruncated = prepared.some(target => target.progress.candidateOnly === true || target.progress.poolComplete === false);
  const searchComplete = !scopeTruncated && !timeExhausted && !budgetExhausted && !beamTruncated && !omittedCandidates && !scoringBounded && !uncertain && !missingPrice;
  const common = { budget, evaluations, searchComplete, scopeTruncated, timeExhausted, candidateCount: selectedCandidates.length, omittedCandidates };
  const output = plans.sort((a, b) => rank(a, b, prepared.length)).slice(0, maxPlans)
    .map(state => materialize(state, candidateMap, budget));
  if (output.length) return { status: 'ready', ...common, plans: output };
  const reason = timeExhausted ? 'search-time-exhausted' : budgetExhausted ? 'search-budget-exhausted' : omittedCandidates ? 'candidate-search-truncated'
    : beamTruncated ? 'beam-search-truncated' : missingPrice ? 'price-unknown'
      : uncertain ? 'score-conditions-unknown' : scoringBounded ? 'score-selection-bounded'
        : overBudget ? 'budget-unreachable' : 'target-unreachable';
  return fail(searchComplete ? 'no-plan' : 'partial', scopeTruncated ? 'candidate-search-truncated' : reason,
    { ...common, targets: materialize(bestSeen, candidateMap, budget).targets });
}

export function planGalleryJoint(input) {
  const steps = planGalleryJointSteps(input);
  let next;
  do { next = steps.next(); } while (!next.done);
  return next.value;
}
