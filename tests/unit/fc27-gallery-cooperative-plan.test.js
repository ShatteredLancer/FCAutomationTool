import { expect, it } from 'vitest';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';
import { planGalleryGrade, planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { planGalleryJoint, planGalleryJointSteps } from '../../src/gallery/joint-planner.js';

const catalog = { source: 'futgg', tags: [{ id: 1, name: 'Gold', bonusType: 'ITEM_SCORE_PERCENTAGE',
  thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'LEVEL', type: 'COUNT', target: 'ATTRIBUTE', values: ['gold'] }],
  tiers: [{ minItems: 2, bonus: 4 }] }] };
const set = { id: 'futgg:30', requiredCards: 3, grades: [{ name: 'C', threshold: 300, rewards: [] }] };
const progress = { season: '27', setId: 30, complete: true, rows: [1, 2, 3, 4].map(eaId =>
  ({ eaId, overall: 80, gradingScore: eaId * 60, firstOwned: false, collected: eaId < 3 })) };
const input = { set, catalog, progress, targetGrade: 'C', prices: {3: 200, 4: 300} };

it('cooperative grade and joint evaluation preserve synchronous results and yield to UI', async () => {
  for (const [sync, steps, value] of [[planGalleryGrade, planGalleryGradeSteps, input],
    [planGalleryJoint, planGalleryJointSteps, {targets: [input]}]]) {
    let time = 0, yields = 0;
    const before = structuredClone(value);
    expect(await runGalleryPlan(steps(value), {now: () => time++, sliceMs: 1,
      progress: state => { expect(Number.isFinite(state.evaluations)).toBe(true); },
      schedule: async () => { yields++; }})).toEqual(sync(value));
    expect(yields).toBeGreaterThan(0); expect(value).toEqual(before);
  }
});

it('deadline returns partial, never a false proof of no solution', async () => {
  const result = await runGalleryPlan(planGalleryGradeSteps({...input, targetGrade: 999999}),
    {now: (() => {let t=0; return () => t++;})(), maxMs: 1, schedule: async () => {}});
  expect(result).toMatchObject({status: 'partial', reason: 'search-time-exhausted', searchComplete: false});
});

it('account/navigation cancellation discards results and closes iterator', async () => {
  let active = true, closed = false;
  function* steps() { try { yield {evaluations: 1}; return {status: 'ready'}; } finally { closed = true; } }
  expect(await runGalleryPlan(steps(), {current: () => active, sliceMs: 0,
    schedule: async () => { active = false; }})).toBeNull();
  expect(closed).toBe(true);
});

it('yields and cancels a realistic 56-version pool with 20 collected cards without changing score rules or inputs', async () => {
  const value = { ...input, set: { ...set, requiredCards: 21 }, targetGrade: 99999999,
    progress: { ...progress, rows: Array.from({ length: 56 }, (_, i) => ({ eaId: 900000 + i,
      playerEaId: 200000 + i, overall: 80, gradingScore: 1000 + i * 100, firstOwned: false, collected: i < 20 })) } };
  const before = structuredClone(value); let active = true, yields = 0;
  const result = await runGalleryPlan(planGalleryGradeSteps(value), { current: () => active, sliceMs: 0,
    schedule: async () => { yields++; active = false; } });
  expect(yields).toBe(1); expect(result).toBeNull(); expect(value).toEqual(before);
});

it.each(['single', 'joint'])('yields inside %s scoring before the first plan candidate is evaluated', async mode => {
  const value = { ...input, targetGrade: 'C', set: { ...set, grades: [{ name: 'C', threshold: 99999999 }] },
    progress: { ...progress, rows: Array.from({ length: 65 }, (_, i) => ({ eaId: 900000 + i,
      playerEaId: 200000 + i, overall: 80, gradingScore: 1000 + i, firstOwned: false, collected: true })) } };
  const steps = mode === 'single' ? planGalleryGradeSteps(value) : planGalleryJointSteps({ targets: [value] });
  let active = true, observed;
  expect(await runGalleryPlan(steps, { current: () => active, sliceMs: 0,
    progress: state => { observed = state; }, schedule: async () => { active = false; } })).toBeNull();
  expect(observed).toMatchObject({ scoringWork: 1 });
});

it('continues yielding after a nested score deadline and returns a truthful partial result', async () => {
  const value = { ...input, targetGrade: 99999999,
    progress: { ...progress, rows: Array.from({ length: 65 }, (_, i) => ({ eaId: 900000 + i,
      overall: 80, gradingScore: 1000 + i, collected: true, firstOwned: false })) } };
  let ticks = 0, yields = 0;
  const result = await runGalleryPlan(planGalleryGradeSteps(value), { now: () => ticks++, maxMs: 1,
    schedule: async () => { yields++; } });
  expect(yields).toBeGreaterThan(100);
  expect(result).toMatchObject({ status: 'partial', timeExhausted: true, searchComplete: false });
});
