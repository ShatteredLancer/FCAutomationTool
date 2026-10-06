import { expect, it } from 'vitest';
import { trimGalleryPlanSteps } from '../../src/gallery/trim-plan.js';
const finish = steps => { let next; do { next = steps.next(); } while (!next.done); return next.value; };
it('removes the most expensive redundant purchase and re-evaluates the exact remaining combination', () => {
  const calls = [], price = id => ({ 1: 80000, 2: 200, 3: 200 })[id];
  const result = finish(trimGalleryPlanSteps({ initial: { ids: [1, 2, 3], score: 400 }, price,
    reached: state => state.score >= 300, maxEvaluations: 3,
    evaluate: function* (ids) { calls.push(ids); yield { scoringWork: 1 }; return { ids, score: ids.reduce((s, id) => s + (id === 1 ? 100 : 150), 0) }; } }));
  expect(result.state.ids).toEqual([2, 3]); expect(result.evaluations).toBe(3);
  expect(calls[0]).toEqual([2, 3]);
});
it('does not remove a cheap card required by a nonlinear bonus and obeys the remaining budget', () => {
  const result = finish(trimGalleryPlanSteps({ initial: { ids: [1, 2], reached: true }, price: () => 150,
    reached: state => state.reached, maxEvaluations: 1,
    evaluate: function* (ids) { return { ids, reached: ids.length === 2 }; } }));
  expect(result.state.ids).toEqual([1, 2]); expect(result.evaluations).toBe(1);
});
