import { createGalleryScoreSummarizer } from './scoring.js';
import { planGalleryGradeSteps, isGalleryOwned } from './planner.js';
import { galleryCatalogGrade, galleryCumulativeRewardQuantity } from './catalog-rewards.js';
import { selectGalleryRoadmapSteps } from './roadmap-selection.js';
import { verifyGalleryReferenceSteps } from './verify-reference-plan.js';
import { createGalleryRoadmapWork } from './roadmap-work.js';
import { galleryPlanSlots } from './plan-slots.js';

// Reuse the existing scorer and grade planner over every catalogue target.
// A deadline keeps the completed rows, explicitly identifying unfinished work.
export function* planGalleryRoadmapSteps({ targets = [], capital = null, lossLimit = null, resaleDiscountBps = 0,
  gradePlanner = planGalleryGradeSteps, previousRows = [], previousSelection = [], fastReferences = false,
  work = createGalleryRoadmapWork(), rowsOnly = false, referenceRefine = true, retainWork = false, objective = 'tokens' } = {}) {
  work.bind(targets, capital, gradePlanner, fastReferences);
  const rows = [], key = 'event_token_1';
  const scoreMode = objective === 'score';
  const previous = new Map(previousRows.map(row => [row.setId, structuredClone(row)]));
  let stopped = false, gradesChecked = 0;
  for (const [index, target] of targets.entries()) {
    const { set, catalog, progress } = target;
    if (previous.get(set.id)?.analysisComplete) {
      rows.push(previous.get(set.id)); continue;
    }
    const row = { setId: set.id, name: set.name, categoryId: set.categoryId,
      currentGrade: null, currentScore: null, baselineTokens: 0, options: [], reason: null, checkedGrades: [],
      ...previous.get(set.id) };
    rows.push(row);
    if (row.reason === 'search-time-exhausted') row.reason = null;
    if (!progress?.rows || target.stale || target.poolStale || target.status && target.status !== 'observed') {
      row.reason = 'progress-unavailable'; row.analysisComplete = true; continue;
    }
    const scorer = work.memo(target, 'scorer', () => createGalleryScoreSummarizer(catalog, { summaryCacheSize: 64,fastTotals:true }));
    const baseline = yield* work.run(target, 'baseline', () => scorer.steps({ set, progress: { ...progress,
      rows: progress.rows.map(card => !scoreMode && isGalleryOwned(card) ? { ...card, collected: true } : card) } }));
    if (!baseline.complete) { row.reason = 'search-time-exhausted'; row.analysisComplete = false; stopped = true; break; }
    const base = baseline.value;
    if (!base?.low) { row.reason = base?.reason ?? 'score-unavailable'; row.analysisComplete = true; work.release(target); continue; }
    const currentGrade = galleryCatalogGrade(set, base);
    row.currentGrade = currentGrade?.name ?? null; row.currentScore = base.low.total;
    row.baselineTokens = currentGrade ? galleryCumulativeRewardQuantity(set, base.low.total, key) : 0;
    row.collectionUnknown = !!base.collectionUnknown;
    if(scoreMode){
      // A known complete lineup may still have an uncertain First Owner bonus.
      // Compare the new low bound with the old high bound, not two optimistic deltas.
      row.scoreBaseline=base.collectionUnknown?null:base.full?(base.high?.total ?? base.low.total):0;
      row.scoreUncertain=base.low.total!==base.high?.total;
      row.pendingCollectionCount=progress.rows.filter(card=>isGalleryOwned(card) && card.collected!==true).length;
    }
    row.candidateOnly = progress.candidateOnly === true || progress.poolComplete === false;
    const grades = set.grades.filter(grade => scoreMode ? grade.threshold>(row.scoreBaseline ?? Infinity)
      : galleryCumulativeRewardQuantity(set, grade.threshold, key) > row.baselineTokens);
    if(scoreMode && row.scoreBaseline!==null && (!fastReferences || referenceRefine)){
      // Two bounded local score probes also cover improvements inside a grade
      // and above S. They are NOT Gallery XP or level thresholds.
      for(const threshold of [...new Set([row.scoreBaseline+1,Math.max(row.scoreBaseline+1,Math.ceil(row.scoreBaseline*1.5))])])
        if(threshold<=100000000)grades.push({name:`points:${threshold}`,threshold,numeric:true});
    }
    if(rowsOnly)grades.sort((a,b)=>({S:5,A:4,B:3,C:2,D:1}[b.name] ?? 0)-({S:5,A:4,B:3,C:2,D:1}[a.name] ?? 0));
    const planningProgress = { ...progress, rows: progress.rows.filter(card =>
      (!scoreMode || !isGalleryOwned(card) || card.collected===true)
      && (capital===null || isGalleryOwned(card) || !(Number.isSafeInteger(target.prices?.[card.eaId]) && target.prices[card.eaId] > capital))) };
    for (const grade of grades) {
      if (row.checkedGrades.includes(grade.name)) continue;
      const proposal = target.publicReference?.grades.find(row => row.grade === grade.name && row.cost != null);
      const reference = proposal ? yield* work.run(target, `reference:${grade.name}:${referenceRefine ? 'refine' : 'verify'}`, () => verifyGalleryReferenceSteps({
        target: { ...target, progress: planningProgress }, proposal, capital, summarize: scorer.steps,
        allowCapturedForecast: fastReferences, refine: referenceRefine })) : { complete: true, value: null };
      if (!reference.complete) { row.reason ??= 'search-time-exhausted'; stopped = true; break; }
      const verified = reference.value;
      const local = !fastReferences || scoreMode && grade.numeric ? yield* work.run(target, `grade:${grade.name}`,
        () => gradePlanner({ ...target, progress: planningProgress, targetGrade: grade.numeric?grade.threshold:grade.name,
          ...(grade.numeric?{maxEvaluations:6000,beamWidth:48,lineupSearch:true,scoreProbe:true}:{}), maxPlans: 1, scoreSummarizer: scorer })) : null;
      if (local && !local.complete) { row.reason ??= 'search-time-exhausted'; stopped = true; break; }
      const result = !local ? verified ? { status: 'ready', plans: [verified], searchComplete: false }
        : { status: 'partial', reason: 'deep-analysis-pending', plans: [] }
        : local.value;
      if (!fastReferences && verified && result.status !== 'achieved'
          && (!result.plans?.[0] || result.plans[0].totalPrice == null || verified.totalPrice < result.plans[0].totalPrice)) {
        result.status = 'ready'; result.plans = [verified]; result.searchComplete = false;
      }
      gradesChecked++;
      const candidate = result.plans?.[0] ?? (scoreMode?result.bestScoringCandidate:null);
      const slots=candidate?galleryPlanSlots({set,progress:planningProgress,items:candidate.items,
        scoringLineupIds:candidate.scoringLineupIds ?? null,confirmedOnly:scoreMode}):null;
      if ((result.status === 'ready' && candidate?.reached || scoreMode && candidate?.lineupComplete && candidate.score>row.scoreBaseline)
          && candidate.totalPrice !== null && (!scoreMode || slots?.status==='complete' && row.scoreBaseline!==null && candidate.score>row.scoreBaseline)) {
        const reached = galleryCatalogGrade(set, { full: true, low: { total: candidate.score } });
        const requested=grade.numeric?grade.threshold:grade.name;
        const {ownedIds,...scoringSlots}=slots;void ownedIds;
        row.options = row.options.filter(option => option.requestedGrade !== requested);
        row.options.push({ grade: reached?.name ?? (grade.numeric?'计分':grade.name), requestedGrade: requested, score: candidate.score, items: candidate.items,
          scoringSlots,
          projectedTokens: galleryCumulativeRewardQuantity(set, candidate.score, key),
          estimated: candidate.estimated, referenceVerified: candidate.referenceVerified === true, searchComplete: result.searchComplete === true });
      } else row.reason = scoreMode && candidate && slots?.status!=='complete'?'scoring-slots-incomplete':result.reason ?? 'grade-proposal-unavailable';
      if (!result.timeExhausted) row.checkedGrades.push(grade.name);
      row.analysisComplete = grades.every(grade => row.checkedGrades.includes(grade.name));
      if (result.timeExhausted || (yield { phase: 'roadmap', completed: index, total: targets.length,
        setId: set.id, name: set.name, grade: grade.name, gradesChecked })) { stopped = true; break; }
    }
    row.analysisComplete = grades.every(grade => row.checkedGrades.includes(grade.name));
    if(scoreMode && row.pendingCollectionCount && !row.options.length)row.reason='collection-confirmation-required';
    if (row.analysisComplete && !retainWork) work.release(target);
    if (stopped) break;
    if (yield { phase: 'roadmap', completed: index + 1, total: targets.length, setId: set.id,
      name: set.name, gradesChecked }) { stopped = true; break; }
  }
  const plan = rowsOnly ? { status:'candidates',route:[],selectedOptions:[],selectionStopped:false }
    : yield* selectGalleryRoadmapSteps({ rows, capital, lossLimit, resaleDiscountBps, previousSelection, objective, profile:scoreMode?'score':null });
  return { ...plan, rows, fastReferences, coverage: { total: targets.length, inspected: rows.length,
    available: rows.filter(row => row.currentScore !== null).length,
    missing: rows.filter(row => row.reason === 'progress-unavailable').length,
    gradesChecked: rows.reduce((sum, row) => sum + (row.checkedGrades?.length ?? 0), 0),
    stopped: stopped || plan.selectionStopped }, partial: stopped || plan.selectionStopped
      || rows.some(row => row.reason || row.collectionUnknown || row.candidateOnly) };
}
