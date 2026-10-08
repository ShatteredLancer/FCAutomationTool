import { expect, it } from 'vitest';
import { previewGallerySelectionSteps, planGalleryGradeOverviewSteps, runGalleryGradeOverview } from '../../src/gallery/preview.js';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';
const exhaust = steps => { let next; do { next = steps.next(); } while (!next.done); return next.value; };
const catalog = { source: 'futgg', tags: [{ id: 1, name: 'FO', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
  rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'FIRST_OWNED', values: ['1'] }], tiers: [{ minItems: 1, bonus: 100 }] }] };
const set = { id: 'futgg:30', requiredCards: 2, grades: [{ name: 'D', threshold: 200 }, { name: 'S', threshold: 500 }] };
const progress = { season: '27', setId: 30, complete: true, rows: [
  { eaId: 1, collected: true, firstOwned: false, gradingScore: 100 },
  { eaId: 2, collected: false, firstOwned: true, gradingScore: null, galleryScore: 100 },
] };
it('previews the selected exact version as a purchase, never granting FO bonus', () => {
  const before = structuredClone(progress);
  const summary = exhaust(previewGallerySelectionSteps({ set, catalog, progress, selectedIds: [2] }));
  expect(summary).toMatchObject({ selectedCount: 1, estimated: true, full: true, low: { total: 200 }, grade: 'D' });
  expect(progress).toEqual(before);
});
it('retains unknown collection facts and ignores unknown/collected selected IDs', () => {
  const value = exhaust(previewGallerySelectionSteps({ set, catalog, progress: { ...progress, complete: false }, selectedIds: [1, 9] }));
  expect(value).toMatchObject({ status: 'partial', grade: null, selectedCount: 0 });
});
it('returns all grade costs and distinguishes an unreachable grade', () => {
  const output = exhaust(planGalleryGradeOverviewSteps({ set, catalog, progress, prices: { 2: 200 } }));
  expect(output.grades).toHaveLength(2);
  expect(output.grades[0]).toMatchObject({ status: 'ready', candidate: { totalPrice: 200 } });
  expect(output.grades[1].status).not.toBe('ready');
});
it('charges for missing scoring cards at every already-exceeded point threshold', () => {
  const output = exhaust(planGalleryGradeOverviewSteps({ set, catalog,
    progress: { ...progress, rows: [{ ...progress.rows[0], gradingScore: 600 }, progress.rows[1]] }, prices: { 2: 200 } }));
  expect(output.grades.every(grade => grade.status === 'ready' && grade.candidate.totalPrice === 200)).toBe(true);
});

it('runs each overview grade with an independent deadline and keeps earlier results', async () => {
  const budgets = [];
  const progressEvents = [];
  const output = await runGalleryGradeOverview({ set, catalog, progress, prices: { 2: 200 } }, {
    timeoutMs: 30000,
    runGrade: async ({ grade, index, total, steps, timeoutMs }) => {
      budgets.push({ grade: grade.name, index, total, steps: Boolean(steps), timeoutMs });
      return index === 0
        ? { status: 'partial', reason: 'search-time-exhausted', searchComplete: false, plans: [] }
        : { status: 'ready', searchComplete: true, plans: [{ totalPrice: 200, score: 500, items: [] }] };
    },
    progress: state => progressEvents.push(state),
  });
  expect(output.status).toBe('observed');
  expect(output.grades.map(row => row.status)).toEqual(['partial', 'ready']);
  expect(budgets).toEqual([
    { grade: 'D', index: 0, total: 2, steps: true, timeoutMs: 30000 },
    { grade: 'S', index: 1, total: 2, steps: true, timeoutMs: 30000 },
  ]);
  expect(progressEvents.map(state => state.completed)).toEqual([1, 2]);
});

it('cancels an overview before starting the next grade', async () => {
  let active = true;
  const started = [];
  const output = await runGalleryGradeOverview({ set, catalog, progress, prices: {} }, {
    current: () => active,
    runGrade: async ({ grade }) => {
      started.push(grade.name);
      active = false;
      return { status: 'partial', reason: 'search-time-exhausted', plans: [] };
    },
  });
  expect(output).toBeNull();
  expect(started).toEqual(['D']);
});

it('restarts the real cooperative clock after every timed-out grade', async () => {
  const traces = [];
  const input = { set: { ...set, grades: [{ name: 'D', threshold: 100 }, { name: 'S', threshold: 500 }] },
    catalog, progress, prices: { 2: 200 } };
  const output = await runGalleryGradeOverview(input, {
    timeoutMs: 30000,
    runGrade: async ({ timeoutMs }) => {
      const trace = [], clock = [0, 15000, 30000, 30000];
      function* steps() {
        let finish = false;
        while (!finish) finish = yield {};
        return { status: 'partial', reason: 'search-time-exhausted', searchComplete: false, plans: [] };
      }
      const result = await runGalleryPlan(steps(), { now: () => {
        const value = clock[Math.min(trace.length, clock.length - 1)];
        trace.push(value);
        return value;
      }, maxMs: timeoutMs,
        sliceMs: Infinity, schedule: async () => {} });
      traces.push(trace);
      return result;
    },
  });
  expect(output.grades).toHaveLength(2);
  expect(output.grades.every(row => row.status === 'partial' && row.reason === 'search-time-exhausted')).toBe(true);
  expect(traces).toEqual([[0, 15000, 30000, 30000], [0, 15000, 30000, 30000]]);
});
