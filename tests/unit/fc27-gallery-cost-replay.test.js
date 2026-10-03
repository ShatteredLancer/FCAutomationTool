import { expect, it } from 'vitest';
import input from '../fixtures/fc27-gallery-cost-replay.json';
import { planGalleryGrade, planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { planGalleryJoint, planGalleryJointSteps } from '../../src/gallery/joint-planner.js';
import { summarizeGalleryScore } from '../../src/gallery/scoring.js';

// Sanitized 2026-10-02 11:46 replay: 33 public versions in one collection,
// three owned, 30 priced candidates; no account, instance IDs or raw objects.
const witness = [220651, 50604248, 258466, 264492, 260463, 72246,
  82172, 239403, 255580, 269228, 277069, 278035];

it('independently verifies the affordable witness using the unchanged scoring rules', () => {
  const selected = new Set(witness);
  const summary = summarizeGalleryScore({ ...input, progress: { ...input.progress,
    rows: input.progress.rows.map(row => selected.has(row.eaId)
      ? { ...row, collected: true, firstOwned: false } : row) } });
  expect(witness.reduce((sum, id) => sum + input.prices[id], 0)).toBe(13850);
  expect(summary).toMatchObject({ full: true, low: { total: 7830 }, high: { total: 7830 }, ruleDifference: false });
});

it.each(['single', 'joint'])('finds the affordable real replay before 3000 evaluations: %s', mode => {
  const before = structuredClone(input);
  const result = mode === 'single' ? planGalleryGrade({ ...input, maxEvaluations: 3000 })
    : planGalleryJoint({ targets: [input] });
  expect(result.status).toBe('ready');
  const plan = result.plans[0];
  expect(plan.totalPrice).toBeLessThanOrEqual(13850);
  expect(plan.items).toHaveLength(12);
  expect(plan.items.some(row => row.eaId === 67297431 || input.progress.rows.find(original => original.eaId === row.eaId).collected)).toBe(false);
  expect(mode === 'single' ? plan.score : plan.targets[0].score).toBeGreaterThanOrEqual(7800);
  expect(result.evaluations).toBeLessThanOrEqual(3000);
  expect(result.searchComplete).toBe(false);
  expect(input).toEqual(before);
});

it.each(['single', 'joint'])('retains the cheap seed when stopped before generic exploration: %s', mode => {
  const steps = mode === 'single' ? planGalleryGradeSteps(input) : planGalleryJointSteps({ targets: [input] });
  let next = steps.next(), yields = 0;
  const firstSeedEvaluation = mode === 'single' ? 2 : 3;
  while (!next.done && next.value.evaluations < firstSeedEvaluation) { yields++; next = steps.next(); }
  expect(yields).toBeGreaterThan(100);
  const result = steps.next(true).value;
  expect(result).toMatchObject({ status: 'ready', timeExhausted: true, searchComplete: false });
  expect(result.plans[0].totalPrice).toBeLessThanOrEqual(13850);
});

it('finds a shared real-world low-cost plan within an explicit budget', () => {
  const second = { ...input, set: { ...input.set, id: 'futgg:42' }, progress: { ...input.progress, setId: 42 } };
  const result = planGalleryJoint({ targets: [input, second], budget: 14000 });
  expect(result.status).toBe('ready');
  expect(result.plans[0].totalPrice).toBeLessThanOrEqual(13850);
  expect(result.plans[0].items).toHaveLength(12);
  expect(result.plans[0].targets.every(target => target.reached)).toBe(true);
});
