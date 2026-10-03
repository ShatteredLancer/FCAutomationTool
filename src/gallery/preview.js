import { summarizeGalleryScoreSteps } from './scoring.js';
import { planGalleryGradeSteps } from './planner.js';
import { isGalleryOwned } from './planner.js';

// A market purchase is not first-owner evidence. Preview only changes the
// explicitly selected versions, preserving unknown history of all others.
export function* previewGallerySelectionSteps({ set, catalog, progress, selectedIds = [] } = {}) {
  const ids = new Set(selectedIds);
  if (!progress?.rows) return { status: 'unavailable', reason: 'input-invalid' };
  const candidates = progress.rows.filter(row => ids.has(row.eaId) && !isGalleryOwned(row) && row.collected === false);
  const estimated = candidates.some(row => !Number.isSafeInteger(row.gradingScore));
  const rows = progress.rows.map(row => ids.has(row.eaId) && !isGalleryOwned(row) && row.collected === false ? {
    ...row, collected: true, firstOwned: false,
    gradingScore: Number.isSafeInteger(row.gradingScore) ? row.gradingScore : row.galleryScore,
  } : row);
  const summary = yield* summarizeGalleryScoreSteps({ set, catalog, progress: { ...progress, rows } });
  return { ...summary, estimated, selectedCount: candidates.length, preview: true };
}

// Each grade is evaluated by the same bounded, cooperative local planner.
// No public or account request is added by opening the grade overview.
export function* planGalleryGradeOverviewSteps(input) {
  if (!Array.isArray(input?.set?.grades)) return { status: 'unavailable', reason: 'input-invalid', grades: [] };
  const grades = [];
  for (const grade of input.set.grades) {
    const result = yield* planGalleryGradeSteps({ ...input, targetGrade: grade.name, maxPlans: 1 });
    grades.push({ grade: grade.name, threshold: grade.threshold, status: result.status, reason: result.reason ?? null,
      searchComplete: result.searchComplete === true, candidate: result.plans?.[0] ?? null });
    if (yield { phase: 'grade', completed: grades.length, total: input.set.grades.length }) break;
  }
  return { status: grades.length === input.set.grades.length ? 'observed' : 'partial', grades };
}
