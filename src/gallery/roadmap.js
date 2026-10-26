import { summarizeGalleryScoreSteps } from './scoring.js';
import { planGalleryGradeSteps, isGalleryOwned } from './planner.js';
import { galleryCatalogGrade, galleryCumulativeRewardQuantity } from './catalog-rewards.js';
import { selectGalleryRoadmapSteps } from './roadmap-selection.js';

// Reuse the existing scorer and grade planner over every catalogue target.
// A deadline keeps the completed rows, explicitly identifying unfinished work.
export function* planGalleryRoadmapSteps({ targets = [], capital = null, lossLimit = null, resaleDiscountBps = 0,
  gradePlanner = planGalleryGradeSteps, previousRows = [], previousSelection = [] } = {}) {
  const rows = [], key = 'event_token_1';
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
    if (!progress?.rows || target.stale || target.poolStale || target.status && target.status !== 'observed') {
      row.reason = 'progress-unavailable'; row.analysisComplete = true; continue;
    }
    const base = yield* summarizeGalleryScoreSteps({ set, catalog, progress: { ...progress,
      rows: progress.rows.map(card => isGalleryOwned(card) ? { ...card, collected: true } : card) } });
    if (!base?.low) { row.reason = base?.reason ?? 'score-unavailable'; row.analysisComplete = true; continue; }
    const currentGrade = galleryCatalogGrade(set, base);
    row.currentGrade = currentGrade?.name ?? null; row.currentScore = base.low.total;
    row.baselineTokens = currentGrade ? galleryCumulativeRewardQuantity(set, base.low.total, key) : 0;
    row.collectionUnknown = !!base.collectionUnknown;
    row.candidateOnly = progress.candidateOnly === true || progress.poolComplete === false;
    const grades = set.grades.filter(grade => galleryCumulativeRewardQuantity(set, grade.threshold, key) > row.baselineTokens);
    const planningProgress = capital === null ? progress : { ...progress, rows: progress.rows.filter(card =>
      isGalleryOwned(card) || !(Number.isSafeInteger(target.prices?.[card.eaId]) && target.prices[card.eaId] > capital)) };
    for (const grade of grades) {
      if (row.checkedGrades.includes(grade.name)) continue;
      const result = yield* gradePlanner({ ...target, progress: planningProgress, targetGrade: grade.name, maxPlans: 1 });
      gradesChecked++;
      const candidate = result.plans?.[0];
      if (result.status === 'ready' && candidate?.reached && candidate.totalPrice !== null) {
        const reached = galleryCatalogGrade(set, { full: true, low: { total: candidate.score } });
        row.options = row.options.filter(option => option.requestedGrade !== grade.name);
        row.options.push({ grade: reached?.name ?? grade.name, requestedGrade: grade.name, score: candidate.score, items: candidate.items,
          projectedTokens: galleryCumulativeRewardQuantity(set, candidate.score, key),
          estimated: candidate.estimated, searchComplete: result.searchComplete === true });
      } else row.reason = result.reason ?? 'grade-proposal-unavailable';
      if (!result.timeExhausted) row.checkedGrades.push(grade.name);
      row.analysisComplete = grades.every(grade => row.checkedGrades.includes(grade.name));
      if (result.timeExhausted || (yield { phase: 'roadmap', completed: index, total: targets.length,
        setId: set.id, name: set.name, grade: grade.name, gradesChecked })) { stopped = true; break; }
    }
    row.analysisComplete = grades.every(grade => row.checkedGrades.includes(grade.name));
    if (stopped) break;
    if (yield { phase: 'roadmap', completed: index + 1, total: targets.length, setId: set.id,
      name: set.name, gradesChecked }) { stopped = true; break; }
  }
  const plan = yield* selectGalleryRoadmapSteps({ rows, capital, lossLimit, resaleDiscountBps, previousSelection });
  return { ...plan, rows, coverage: { total: targets.length, inspected: rows.length,
    available: rows.filter(row => row.currentScore !== null).length,
    missing: rows.filter(row => row.reason === 'progress-unavailable').length,
    gradesChecked: rows.reduce((sum, row) => sum + (row.checkedGrades?.length ?? 0), 0),
    stopped: stopped || plan.selectionStopped }, partial: stopped || plan.selectionStopped
      || rows.some(row => row.reason || row.collectionUnknown || row.candidateOnly) };
}
