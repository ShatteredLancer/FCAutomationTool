import { compileGalleryScoringRules, createGalleryScoreSummarizer } from './scoring.js';
import { isGalleryOwned, galleryCostSearchKeys } from './planner.js';
import { refineGalleryCostSteps } from './cost-search.js';
import { selectGalleryCandidatePool } from './candidate-pool.js';
import { galleryPriceBandSeedSteps } from './price-band-seeds.js';
import { trimGalleryPlanSteps } from './trim-plan.js';
import { galleryRewardOptions, galleryCumulativeRewardQuantity, galleryCatalogGrade, galleryCatalogRewardSnapshot } from './catalog-rewards.js';

const validId = value => Number.isSafeInteger(value) && value > 0;
const validScore = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
const validPrice = value => Number.isSafeInteger(value) && value > 0 && value <= 15000000;
const score = row => validScore(row.gradingScore) ? row.gradingScore : validScore(row.galleryScore) ? row.galleryScore : null;
const fail = (status, reason, extra = {}) => ({ status, reason, plans: [], ...extra });

function* evaluate(targets, selected) {
  const results = [];
  for (const target of targets) {
    const key = target.progress.rows.filter(row => selected.has(row.eaId) && !isGalleryOwned(row)).map(row => row.eaId).sort((a, b) => a - b).join(',');
    let summary = target.summaries.get(key);
    if (!summary) {
      summary = yield* target.summarize.steps({ set: target.set, catalog: target.catalog, progress: {
      ...target.progress, season: '27', setId: target.catalog.source === 'fodder' ? target.set.id : Number(target.set.id.slice(6)), complete: true,
      rows: target.progress.rows.filter(row => isGalleryOwned(row) || row.collected === false).map(row => isGalleryOwned(row) ? { ...row, collected: true }
        : selected.has(row.eaId) ? { ...row, collected: true, gradingScore: score(row), firstOwned: false } : row),
      } });
      target.summaries.set(key, summary);
    }
    results.push({ target, summary, reached: summary.full === true && summary.low?.total >= target.threshold });
  }
  return results;
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

function materialize(state, candidates, budget, rewardObjective = null) {
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
    targets: state.results.map(({ target, summary, reached }) => {
      if (rewardObjective) {
        const grade = galleryCatalogGrade(target.set, summary);
        return { setId: target.set.id, name: target.set.name, targetGrade: grade?.name ?? null,
          threshold: grade?.threshold ?? null, reached: !!grade, score: summary.low?.total ?? null,
          scoreHigh: summary.high?.total ?? null, pointsMissing: 0, unknownFields: summary.unknownFields ?? [],
          rewards: grade?.rewards ?? [], rewardStatus: 'catalog-only' };
      }
      return ({ setId: target.set.id, name: target.set.name,
      targetGrade: target.targetGrade, threshold: target.threshold, reached, score: summary.low?.total ?? null,
      scoreHigh: summary.high?.total ?? null, pointsMissing: Math.max(0, target.threshold - (summary.low?.total ?? 0)),
      unknownFields: summary.unknownFields ?? [],
      // Fixed-grade targets display the selected tier. Cumulative catalogue
      // quantities are exposed separately by rewardEstimate.
      rewards: (target.grade.rewards ?? []).map(reward => ({ ...reward })), rewardStatus: 'catalog-only',
    }); }),
    ...(rewardObjective ? { rewardEstimate: { key: rewardObjective.key, label: rewardObjective.label,
      baselineQuantity: rewardObjective.baseline.quantity,
      projectedQuantity: state.reward.quantity, change: state.reward.quantity - rewardObjective.baseline.quantity,
      baselineTargets: rewardObjective.baseline.targets, projectedTargets: state.reward.targets,
      gradeRule: 'cumulative-tiers', claimState: 'unknown', status: 'catalog-only' } } : {}),
    estimated: state.results.some(({ target, summary }) => summary.lineup?.some(row =>
      !validScore(target.progress.rows.find(original => original.eaId === row.eaId)?.gradingScore))),
  };
}

// Search the shared version pool directly, retaining cross-set alternatives.
// This module is pure: a plan never reads providers or authorizes a purchase.
export function* planGalleryJointSteps({ targets, budget = null, maxPlans = 3, maxCandidates = 192,
  maxEvaluations = 3000, beamWidth = 64, catalogRewardKey = null } = {}) {
  if (!Array.isArray(targets) || !targets.length) return fail('unavailable', 'targets-invalid');
  if (catalogRewardKey !== null && (budget === null || !galleryRewardOptions(targets).some(row => row.key === catalogRewardKey))) {
    return fail('unavailable', budget === null ? 'reward-budget-required' : 'reward-type-unknown');
  }
  if (budget != null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 1000000000)) return fail('unavailable', 'budget-invalid');
  if (![maxPlans, maxCandidates, maxEvaluations, beamWidth].every(value => Number.isSafeInteger(value) && value > 0)
      || maxPlans > 10 || maxCandidates > 512 || maxEvaluations > 20000 || beamWidth > 256) return fail('unavailable', 'search-options-invalid');
  const targetIds = new Set(), identities = new Map(), allCandidates = new Map(), prepared = [], ownedIds = new Set();
  const collectionUnknown = new Map();
  // A catalogue version may belong to more than one target. Report the
  // unknown state once per exact EA version, while retaining the per-target
  // map internally for diagnostics and search completeness.
  const unknownSummary = () => {
    const ids = [...new Set([...collectionUnknown.values()].flat())]
      .sort((a, b) => Number(a) - Number(b));
    return { collectionUnknownCount: ids.length, collectionUnknownIds: ids };
  };
  const scopes = new Set(targets.map(target => target.scope).filter(value => value != null));
  const platforms = new Set(targets.map(target => target.platform).filter(value => value != null));
  if (scopes.size > 1 || platforms.size > 1) return fail('unavailable', 'target-context-mismatch');
  for (const target of targets) {
    const { set, catalog, progress } = target;
    if (!/^(futgg:[1-9]\d*|fodder:[a-z0-9-]+\/[a-z0-9-]+)$/.test(set?.id) || targetIds.has(set.id) || !Array.isArray(set.grades)
        || !validId(set.requiredCards) || set.requiredCards > 256 || !['futgg', 'fodder'].includes(catalog?.source)
        || !Array.isArray(progress?.rows) || progress.rows.length > 2000
        || progress.season != null && progress.season !== '27'
        || progress.setId != null && progress.setId !== (catalog.source === 'fodder' ? set.id : Number(set.id.slice(6)))) return fail('unavailable', 'target-input-invalid');
    targetIds.add(set.id);
    const grade = set.grades.find(row => row.name === target.targetGrade);
    if (!grade || !Number.isSafeInteger(grade.threshold) || grade.threshold < 0) return fail('unavailable', 'target-grade-unknown');
    const compiled = compileGalleryScoringRules(catalog);
    if (compiled.status !== 'ready') return fail('unavailable', compiled.reason);
    if (progress.rows.some(row => !row || row.collected != null && typeof row.collected !== 'boolean')) return fail('unavailable', 'target-input-invalid');
    if (progress.complete === false || progress.rows.some(row => isGalleryOwned(row) && !validScore(row.gradingScore))) return fail('partial', 'target-state-unknown');
    const unknownRows = progress.rows.filter(row => row.collected == null && !isGalleryOwned(row));
    if (unknownRows.length) collectionUnknown.set(set.id, unknownRows.map(row => row.eaId));
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
      if (isGalleryOwned(row)) { ownedIds.add(row.eaId); continue; }
      // Only explicit missing answers are market candidates. Unknown exact
      // versions stay out of both score and purchase planning.
      if (row.collected !== false) continue;
      const quote = target.prices?.[row.eaId], price = validPrice(quote) ? quote : null;
      const existing = allCandidates.get(row.eaId);
      if (existing) {
        existing.memberships++;
        existing.diversityKeys.push(...galleryCostSearchKeys(row, compiled.tags).map(key => `${set.id}:${key}`));
        if (existing.price != null && price != null && existing.price !== price) existing.priceConflict = true;
        existing.price = existing.priceConflict ? null : price ?? existing.price;
      } else allCandidates.set(row.eaId, { row, price, memberships: 1,
        diversityKeys: galleryCostSearchKeys(row, compiled.tags).map(key => `${set.id}:${key}`) });
    }
    prepared.push({ ...target, grade, threshold: grade.threshold, summaries: new Map(), summarize: createGalleryScoreSummarizer(catalog) });
  }
  // Ownership is account-wide, while per-set observations can arrive at
  // different times. Project positive exact-version evidence across targets
  // without changing the caller's collection facts or granting FO credit.
  for (const id of ownedIds) allCandidates.delete(id);
  for (const target of prepared) target.progress = { ...target.progress, rows: target.progress.rows.map(row =>
    ownedIds.has(row.eaId) && !isGalleryOwned(row) ? { ...row, held: true } : row) };
  const candidateRows = [...allCandidates.values()].filter(candidate => score(candidate.row) != null)
    .map(candidate => ({ ...candidate, id: candidate.row.eaId, score: score(candidate.row) }));
  const selectedCandidates = selectGalleryCandidatePool(candidateRows, maxCandidates);
  const omittedCandidates = allCandidates.size - selectedCandidates.length;
  const candidateMap = new Map(selectedCandidates.map(candidate => [candidate.row.eaId, candidate]));
  let scoringWork = 0, scoreDeadline = false;
  const resultsFor = function* (selected) {
    const steps = evaluate(prepared, selected);
    let next;
    try {
      next = steps.next();
      while (!next.done) {
        const stop = yield { evaluations: 0, scoringWork: ++scoringWork };
        scoreDeadline ||= stop === true;
        next = steps.next();
      }
    } finally { steps.return(); }
    return next.value;
  };
  const base = { ids: [], nextIndex: 0, cost: 0, missingPrices: false, results: yield* resultsFor(new Set()) };
  if (base.results.some(result => !result.summary.low)) return fail('unavailable', 'scoring-unavailable');
  const rewardObjective = catalogRewardKey === null ? null : { ...galleryRewardOptions(targets).find(row => row.key === catalogRewardKey),
    baseline: galleryCatalogRewardSnapshot(base.results, catalogRewardKey) };
  const annotate = state => {
    if (rewardObjective && !state.reward) state.reward = galleryCatalogRewardSnapshot(state.results, catalogRewardKey);
    return state;
  };
  annotate(base);
  const complete = state => rewardObjective ? !state.missingPrices && annotate(state).reward.quantity > rewardObjective.baseline.quantity
    : state.results.every(result => result.reached);
  const rewardProgress = state => state.results.reduce((sum, { target, summary }, index) => {
    const baseline = rewardObjective.baseline.targets[index].quantity;
    const nextGrade = target.set.grades.find(grade => galleryCumulativeRewardQuantity(target.set, grade.threshold, catalogRewardKey) > baseline
      && grade.threshold > (summary.low?.total ?? 0));
    if (!nextGrade) return sum;
    return sum + Math.min(1, (summary.low?.total ?? 0) / Math.max(1, nextGrade.threshold))
      + Math.min(1, (summary.lineup?.length ?? 0) / target.set.requiredCards);
  }, 0);
  const compare = (a, b) => {
    if (!rewardObjective) return rank(a, b, prepared.length);
    const difference = annotate(b).reward.quantity - annotate(a).reward.quantity;
    if (difference) return difference;
    if (complete(a)) return a.cost - b.cost || a.ids.length - b.ids.length;
    return rewardProgress(b) - rewardProgress(a) || a.cost - b.cost || a.ids.length - b.ids.length;
  };
  if (!rewardObjective && base.results.every(result => result.reached)) return { status: 'achieved', plans: [], targets: materialize(base, candidateMap, budget).targets,
    searchComplete: collectionUnknown.size === 0,
    ...unknownSummary() };
  if (rewardObjective && prepared.reduce((sum, target) => sum + Math.max(0, ...target.set.grades.map(grade =>
    galleryCumulativeRewardQuantity(target.set, grade.threshold, catalogRewardKey))), 0) <= base.reward.quantity) {
    return { status: 'achieved', plans: [], budget, searchComplete: false,
      ...unknownSummary(),
      rewardEstimate: materialize(base, candidateMap, budget, rewardObjective).rewardEstimate };
  }
  let states = [base], evaluations = 1, budgetExhausted = false, beamTruncated = false, timeExhausted = scoreDeadline;
  let bestSeen = base;
  let scoringBounded = base.results.some(result => result.summary.selection === 'bounded-search');
  let uncertain = base.results.some(result => result.summary.status === 'uncertain'), missingPrice = false, overBudget = false;
  const plans = [], depthLimit = prepared.reduce((sum, target) => sum + target.set.requiredCards, 0);
  let cheapestComplete = null;
  // Construct complete cheap/high-score bundles before beam expansion. A wide
  // pool can exhaust the beam budget at depth two while twelve slots are empty.
  // These remain candidates, not a proof of optimality; all targets and the
  // shared exact-version budget are evaluated again before exposing them.
  for (const mode of ['price', 'score']) {
    if (evaluations >= maxEvaluations) break;
    const selected = new Set();
    for (const target of prepared) {
      const missingSlots = Math.max(0, target.set.requiredCards - target.progress.rows.filter(isGalleryOwned).length);
      const candidates = target.progress.rows.filter(row => !isGalleryOwned(row) && candidateMap.has(row.eaId))
        .map(row => candidateMap.get(row.eaId)).sort((a, b) => {
          const price = (a.price ?? Infinity) - (b.price ?? Infinity);
          return (mode === 'price' ? price : score(b.row) - score(a.row))
            || score(b.row) - score(a.row) || a.row.eaId - b.row.eaId;
        });
      for (const candidate of candidates.slice(0, Math.max(1, missingSlots))) selected.add(candidate.row.eaId);
    }
    if (!selected.size) continue;
    const ids = [...selected], cost = ids.reduce((sum, id) => sum + (candidateMap.get(id).price ?? 0), 0);
    const missingPrices = ids.some(id => candidateMap.get(id).price == null);
    if (budget != null && (missingPrices || cost > budget)) continue;
    const results = yield* resultsFor(selected); evaluations++;
    const value = { ids, nextIndex: selectedCandidates.length, cost, missingPrices, results };
    if (!missingPrices && !results.every(result => result.reached)
        && (!cheapestComplete || cost < cheapestComplete.cost)) cheapestComplete = value;
    if (compare(value, bestSeen) < 0) bestSeen = value;
    if (complete(value)) plans.push(value);
    if ((yield { evaluations }) || scoreDeadline) { timeExhausted = true; break; }
    if (!rewardObjective && mode === 'price' && !missingPrices && !results.every(result => result.reached)) {
      const refinement = refineGalleryCostSteps({ initial: value,
        seedSteps: galleryPriceBandSeedSteps({ targets: prepared,
          candidates: selectedCandidates.map(candidate => ({ id: candidate.row.eaId, price: candidate.price, score: score(candidate.row) })) }),
        candidates: selectedCandidates.map(candidate => ({ id: candidate.row.eaId, price: candidate.price,
          score: score(candidate.row), diversityKeys: candidate.diversityKeys })),
        maxEvaluations: maxEvaluations - evaluations,
        measure: state => ({ reached: state.results.every(result => result.reached),
          progress: state.results.reduce((sum, result) => sum + Math.min(1,
            (result.summary.low?.total ?? 0) / Math.max(1, result.target.threshold)), 0),
          diversityKey: state.results.map(result => (result.summary.low?.tags ?? [])
            .map(tag => `${result.target.set.id}:${tag.id}:${tag.count}:${tag.pct}`).join('|')).join(';') }),
        evaluate: function* (ids) {
          const cost = ids.reduce((sum, id) => sum + (candidateMap.get(id).price ?? 0), 0);
          if (budget != null && cost > budget) return null;
          return { ids, nextIndex: selectedCandidates.length, cost,
            missingPrices: ids.some(id => candidateMap.get(id).price == null), results: yield* resultsFor(new Set(ids)) };
        } });
      let step = refinement.next();
      while (!step.done) {
        const stop = yield { evaluations: evaluations + step.value.evaluations, scoringWork: step.value.scoringWork };
        if (stop || scoreDeadline) timeExhausted = true;
        step = refinement.next(stop || scoreDeadline);
      }
      evaluations += step.value.evaluations; plans.push(...step.value.plans);
      // Refinement can discover a better partial lineup before its bounded
      // search reaches a complete target. Preserve that witness for the
      // partial result; otherwise a timeout reports the older seed and makes
      // a reachable target look as if no progress was made.
      if (step.value.bestState && compare(step.value.bestState, bestSeen) < 0) {
        bestSeen = step.value.bestState;
      }
      beamTruncated ||= step.value.truncated === true;
      if (timeExhausted) break;
    }
  }
  for (let depth = 0; depth < depthLimit && states.length && !timeExhausted; depth++) {
    const next = [];
    expansion: for (const state of states) for (let index = state.nextIndex; index < selectedCandidates.length; index++) {
      if (evaluations >= maxEvaluations) { budgetExhausted = true; break expansion; }
      const candidate = selectedCandidates[index];
      if (budget != null && candidate.price == null) { missingPrice = true; continue; }
      const cost = state.cost + (candidate.price ?? 0);
      if (budget != null && cost > budget) { overBudget = true; continue; }
      const ids = [...state.ids, candidate.row.eaId];
      const results = yield* resultsFor(new Set(ids)); evaluations++;
      const value = { ids, nextIndex: index + 1, cost, missingPrices: state.missingPrices || candidate.price == null, results };
      if (compare(value, bestSeen) < 0) bestSeen = value;
      scoringBounded ||= results.some(result => result.summary.selection === 'bounded-search');
      uncertain ||= results.some(result => result.summary.status === 'uncertain');
      if (complete(value)) plans.push(value);
      next.push(value);
      if ((yield { evaluations }) || scoreDeadline) { timeExhausted = true; break expansion; }
    }
    next.sort(compare);
    beamTruncated ||= next.length > beamWidth;
    states = next.slice(0, beamWidth);
    if (budgetExhausted || timeExhausted) break;
  }
  const scopeTruncated = prepared.some(target => target.progress.candidateOnly === true || target.progress.poolComplete === false);
  let removedPurchases = 0;
  if (plans.length && !timeExhausted && evaluations < maxEvaluations) {
    const initial = plans.slice().sort(compare)[0];
    const trim = trimGalleryPlanSteps({ initial, maxEvaluations: Math.min(64, maxEvaluations - evaluations),
      price: id => candidateMap.get(id).price ?? 0,
      reached: state => rewardObjective ? annotate(state).reward.quantity >= annotate(initial).reward.quantity
        : state.results.every(result => result.reached),
      evaluate: function* (ids) {
        return { ...initial, reward: undefined, ids, cost: ids.reduce((sum, id) => sum + (candidateMap.get(id).price ?? 0), 0),
          missingPrices: ids.some(id => candidateMap.get(id).price == null), results: yield* resultsFor(new Set(ids)) };
      } });
    let step;
    try {
      step = trim.next();
      while (!step.done) {
        const stop = yield { ...step.value, evaluations: evaluations + (step.value.evaluations ?? 0) };
        timeExhausted ||= stop === true || scoreDeadline;
        step = trim.next(stop || scoreDeadline);
      }
    } finally { trim.return(); }
    evaluations += step.value.evaluations;
    removedPurchases = initial.ids.length - step.value.state.ids.length;
    if (removedPurchases) plans.push(step.value.state);
  }
  const proofInputsKnown = candidateRows.every(candidate => validScore(candidate.row.gradingScore) && candidate.price != null)
    && plans.every(state => state.results.every(result => result.summary.selection !== 'bounded-search'
      && !result.summary.ruleDifference && result.summary.low?.total === result.summary.high?.total));
  const searchComplete = !rewardObjective && collectionUnknown.size === 0 && !scopeTruncated && !timeExhausted && !budgetExhausted && !beamTruncated && !omittedCandidates
    && !scoringBounded && !uncertain && !missingPrice && proofInputsKnown;
  const common = { budget, evaluations, searchComplete, scopeTruncated, timeExhausted, beamTruncated, budgetExhausted,
    candidateCount: selectedCandidates.length, omittedCandidates, requestedCandidates: allCandidates.size,
    quotedCandidateCount: candidateRows.filter(candidate => candidate.price != null).length, removedPurchases,
    ...unknownSummary(),
    ...(rewardObjective ? { rewardEstimate: materialize(base, candidateMap, budget, rewardObjective).rewardEstimate } : {}) };
  const unique = new Set();
  const output = plans.sort(compare).filter(state => {
    if (!rewardObjective) return true;
    const key = state.ids.slice().sort((a, b) => a - b).join(',');
    if (unique.has(key)) return false;
    unique.add(key); return true;
  }).slice(0, maxPlans).map(state => materialize(state, candidateMap, budget, rewardObjective));
  const costAudit = cheapestComplete ? { totalPrice: cheapestComplete.cost,
    score: Math.min(...cheapestComplete.results.map(result => result.summary.low?.total ?? 0)),
    target: Math.max(...prepared.map(target => target.threshold)), reached: false } : null;
  if (output.length) return { status: 'ready', ...common, costAudit, plans: output };
  const reason = timeExhausted ? 'search-time-exhausted' : budgetExhausted ? 'search-budget-exhausted' : omittedCandidates ? 'candidate-search-truncated'
    : beamTruncated ? 'beam-search-truncated' : missingPrice ? 'price-unknown'
      : uncertain ? 'score-conditions-unknown' : scoringBounded ? 'score-selection-bounded'
        : collectionUnknown.size ? 'collection-status-unknown' : overBudget ? 'budget-unreachable' : rewardObjective ? 'reward-improvement-not-found' : 'target-unreachable';
  return fail(searchComplete ? 'no-plan' : 'partial', scopeTruncated ? 'candidate-search-truncated' : reason,
    { ...common, targets: materialize(bestSeen, candidateMap, budget).targets });
}

export function planGalleryJoint(input) {
  const steps = planGalleryJointSteps(input);
  let next;
  do { next = steps.next(); } while (!next.done);
  return next.value;
}
