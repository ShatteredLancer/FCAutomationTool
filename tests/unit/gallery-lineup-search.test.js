import { expect, it } from 'vitest';
import replay from '../fixtures/gallery-lineup-cost-2026-10-28.json' with { type: 'json' };
import { planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { summarizeGalleryScore } from '../../src/gallery/scoring.js';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';
import { createGalleryPlanReplay } from '../../src/gallery/plan-replay.js';
import costReplay from '../fixtures/fc27-gallery-cost-replay.json' with { type: 'json' };
import holoReplay from '../fixtures/fc27-gallery-holo-cost-replay.json' with { type: 'json' };

it.each(replay.cases)('plans the public 33-version control without nested scoring explosion ($maxPrice)', ({ prices, maxPrice }) => {
  const input = { ...structuredClone(replay.input), prices, lineupSearch: true };
  const before = structuredClone(input), steps = planGalleryGradeSteps(input);
  let next, work = 0;
  do { next = steps.next(); work++; } while (!next.done);
  const result = next.value, plan = result.plans[0];
  expect(result.status).toBe('ready');
  expect(plan.totalPrice).toBeLessThanOrEqual(maxPrice);
  expect(plan.score).toBeGreaterThanOrEqual(4000);
  expect(result.evaluations).toBeLessThanOrEqual(30000);
  expect(work).toBeLessThan(50000);
  const purchased = new Set(plan.items.map(row => row.eaId));
  expect(plan.items.every(row => prices[row.eaId] > 0 && input.progress.rows.find(card => card.eaId === row.eaId).collected === false)).toBe(true);
  const summary = summarizeGalleryScore({ ...input, progress: { ...input.progress,
    rows: input.progress.rows.map(row => purchased.has(row.eaId) ? { ...row, collected: true, firstOwned: false,
      gradingScore: row.gradingScore ?? row.galleryScore } : row) } });
  expect(summary.full).toBe(true); expect(summary.low.total).toBe(plan.score);
  expect(plan.items.reduce((sum, row) => sum + prices[row.eaId], 0)).toBe(plan.totalPrice);
  expect(input).toEqual(before);
});

const simple = () => ({ lineupSearch: true, set: { id: 'futgg:17', requiredCards: 3, grades: [{ name: 'A', threshold: 150 }] },
  catalog: { source: 'futgg', tags: [{ id: 1, name: 'No bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }] },
  progress: { season: '27', setId: 17, complete: true, rows: [1, 2, 3, 4, 5, 6, 7].map(id => ({ eaId: id, playerEaId: id,
    overall: 70, gradingScore: id <= 2 ? 1 : id === 5 ? 0 : id === 6 ? 9999 : id === 7 ? 20 : 100,
    collected: id <= 2 ? true : id === 6 ? null : false, held: id === 7, firstOwned: false, rarityEaId: 1 })) },
  prices: { 3: 100, 4: 200, 5: 10, 6: 1, 7: 1 }, targetGrade: 'A' });
const finish = input => { const steps = planGalleryGradeSteps(input); let next; do { next = steps.next(); } while (!next.done); return next.value; };

it.each([{ input: costReplay, maxPrice: 13850 }, { input: holoReplay.input, maxPrice: 1448000 }])('does not regress the retained cost/bonus control ($maxPrice)', ({ input, maxPrice }) => {
  const result = finish({ ...input, lineupSearch: true });
  expect(result.status).toBe('ready'); expect(result.plans[0].totalPrice).toBeLessThanOrEqual(maxPrice);
  expect(result.plans[0].score).toBeGreaterThanOrEqual(result.threshold);
});

it('can replace scoring slots already filled by owned cards without buying owned/unknown/zero-score versions', () => {
  const result = finish(simple());
  expect(result.status).toBe('ready'); expect(result.plans[0].totalPrice).toBe(300);
  expect(result.plans[0].items.map(row => row.eaId).sort()).toEqual([3, 4]);
  expect(result.searchComplete).toBe(false);
});

it('preserves the unpriced proposal fallback instead of turning missing quotes into zero-cost purchases', () => {
  const input = simple(); input.prices = {};
  const result = finish(input);
  expect(result.status).toBe('ready'); expect(result.plans[0].totalPrice).toBeNull();
  expect(result.plans[0].missingPriceIds.length).toBeGreaterThan(0);
});

it.each([1, 2, 7, 31])('shares the requested evaluation budget, including final verification (%i)', maxEvaluations => {
  const result = finish({ ...simple(), maxEvaluations });
  expect(result.evaluations).toBeLessThanOrEqual(maxEvaluations);
  if (result.status !== 'ready') expect(result.status).toBe('partial');
});

it('retains the explicit new algorithm in sanitized replays, without changing joint defaults', () => {
  const input = simple(), replay = createGalleryPlanReplay(input);
  expect(replay.input.lineupSearch).toBe(true);
  expect(finish(replay.input).plans[0].totalPrice).toBe(finish(input).plans[0].totalPrice);
  expect(createGalleryPlanReplay({ targets: [input] }).input.targets[0].lineupSearch).toBeUndefined();
});

it.each(['cancel', 'deadline'])('retains cancellation/partial behavior for complete-lineup %s', async mode => {
  let active = true, at = 0, turns = 0;
  const result = await runGalleryPlan(planGalleryGradeSteps({ ...replay.input, prices: replay.cases[0].prices, lineupSearch: true }), {
    now: () => ++at, sliceMs: 1, maxMs: mode === 'deadline' ? 2 : 30000,
    current: () => active, schedule: async () => { turns++; if (mode === 'cancel') active = false; },
  });
  expect(turns).toBeGreaterThan(0);
  if (mode === 'cancel') expect(result).toBeNull();
  else { expect(result.timeExhausted).toBe(true); expect(result.searchComplete).toBe(false); }
});

it('does not turn an expired deadline into one timer wait per nested microstep', async () => {
  let clock = 0, waits = 0, askedToFinish = false, closed = false;
  function* steps() {
    try {
      for (let i = 0; i < 5000; i++) { const stop = yield { evaluations: 1 }; askedToFinish ||= stop === true; }
      return { status: 'partial' };
    } finally { closed = true; }
  }
  expect(await runGalleryPlan(steps(), { now: () => clock += .01, maxMs: 1,
    schedule: async () => { waits++; } })).toEqual({ status: 'partial' });
  expect(askedToFinish).toBe(true); expect(closed).toBe(true);
  expect(waits).toBeLessThan(12);
});
