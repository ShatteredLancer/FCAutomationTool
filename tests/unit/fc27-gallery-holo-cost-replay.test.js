import { expect, it } from 'vitest';
import fixture from '../fixtures/fc27-gallery-holo-cost-replay.json';
import { planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { summarizeGalleryScore } from '../../src/gallery/scoring.js';

it('reproduces the public five-card screenshot using the unchanged scorer', () => {
  const { input, witness } = fixture;
  const result = summarizeGalleryScore({ ...input, progress: { ...input.progress,
    rows: input.progress.rows.map(row => ({ ...row, collected: witness.includes(row.eaId), firstOwned: false })) } });
  expect(result).toMatchObject({ full: true, low: { total: 254473 } });
  expect(witness.reduce((sum, id) => sum + input.prices[id], 0)).toBe(1697000);
});

it('finds four affordable upgrades before expensive generic exploration, without buying the owned fifth card', () => {
  const input = structuredClone(fixture.input), before = structuredClone(input);
  const steps = planGalleryGradeSteps(input);
  let step = steps.next(), work = 0;
  while (!step.done && (step.value.evaluations ?? 0) < 3 && work < 18000) { work++; step = steps.next(); }
  // A deterministic cooperative stop checks the cheap route is discovered
  // early, independently of CPU speed and the browser's ten-second deadline.
  while (!step.done) step = steps.next(true);
  expect(step.value).toMatchObject({ status: 'ready', timeExhausted: true, searchComplete: false });
  expect(step.value.plans[0].totalPrice).toBeLessThanOrEqual(1448000);
  expect(step.value.plans[0].score).toBeGreaterThanOrEqual(250000);
  expect(step.value.plans[0].items).toHaveLength(4);
  expect(step.value.plans[0].items.some(row => input.progress.rows.find(original => original.eaId === row.eaId).collected)).toBe(false);
  expect(input).toEqual(before);
});
