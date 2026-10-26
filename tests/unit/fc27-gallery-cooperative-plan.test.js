import { expect, it } from 'vitest';
import { runGalleryPlan } from '../../src/gallery/cooperative-plan.js';
import { planGalleryGrade, planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { planGalleryJoint, planGalleryJointSteps } from '../../src/gallery/joint-planner.js';
import { planGalleryRoadmapSteps } from '../../src/gallery/roadmap.js';

const catalog = { source: 'futgg', tags: [{ id: 1, name: 'Gold', bonusType: 'ITEM_SCORE_PERCENTAGE',
  thresholdType: 'ITEM_COUNT', rules: [{ attribute: 'LEVEL', type: 'COUNT', target: 'ATTRIBUTE', values: ['gold'] }],
  tiers: [{ minItems: 2, bonus: 4 }] }] };
const set = { id: 'futgg:30', requiredCards: 3, grades: [{ name: 'C', threshold: 300, rewards: [] }] };
const progress = { season: '27', setId: 30, complete: true, rows: [1, 2, 3, 4].map(eaId =>
  ({ eaId, overall: 80, gradingScore: eaId * 60, firstOwned: false, collected: eaId < 3 })) };
const input = { set, catalog, progress, targetGrade: 'C', prices: {3: 200, 4: 300} };

it('keeps roadmap scoring time slices cooperative without treating bare yields as progress records', async () => {
  const target = { status: 'observed', catalog,
    set: { ...set, requiredCards: 1, grades: [{ name: 'S', threshold: 50,
      rewards: [{ type: 'event_token_1', count: 1, value: 15 }] }] },
    progress: { ...progress, rows: progress.rows.map(card => ({ ...card, collected: true })) }, prices: {} };
  let at = 0, turns = 0; const phases = [];
  const result = await runGalleryPlan(planGalleryRoadmapSteps({ targets: [target], fastReferences: true }), {
    now: () => at += 20, sliceMs: 12, maxMs: 30000,
    progress: value => phases.push(value.phase), schedule: async () => { turns++; },
  });
  expect(result).toMatchObject({ status: 'no-route', baselineTokens: 15, coverage: { available: 1 } });
  expect(phases).toContain('roadmap'); expect(phases.every(Boolean)).toBe(true);
  expect(turns).toBeGreaterThan(phases.length);
});

it.each(['cancel', 'deadline'])('preserves %s at bare scoring checkpoints without inventing progress', async mode => {
  let active = true, closed = false, turns = 0, at = 0;
  function* steps() {
    try { for (;;) if (yield) return { status: 'partial' }; }
    finally { closed = true; }
  }
  const result = await runGalleryPlan(steps(), { current: () => active, now: () => at += 20,
    sliceMs: 12, maxMs: mode === 'deadline' ? 1 : 30000,
    progress: () => { throw Error('Bare checkpoint must not publish a record'); },
    schedule: async () => { turns++; if (mode === 'cancel') active = false; },
  });
  expect(result).toEqual(mode === 'cancel' ? null : { status: 'partial' });
  expect(turns).toBe(1); expect(closed).toBe(true);
});

it.each(['resume', 'final'])('checks full immutable-input binding at the %s boundary', async boundary => {
  let valid = true, closed = false, reads = 0, turns = 0, at = 0;
  function* steps() {
    try {
      for (let i = 0; i < 40; i++) yield;
      if (boundary === 'final') valid = false;
      return { status: 'ready' };
    } finally { closed = true; }
  }
  expect(await runGalleryPlan(steps(), { current: () => true, checkpoint: () => { reads++; return valid; },
    now: () => ++at, sliceMs: 10, schedule: async () => { turns++; if (boundary === 'resume') valid = false; },
  })).toBeNull();
  expect(closed).toBe(true); expect(reads).toBeLessThan(12); expect(turns).toBeGreaterThan(0);
});

it('avoids rebuilding a full catalog binding for every checkpoint within one synchronous CPU slice', async () => {
  let at = 0, fullReads = 0, contextReads = 0;
  function* steps() { for (let i = 0; i < 5000; i++) yield; return 7; }
  expect(await runGalleryPlan(steps(), { now: () => at += 0.001, sliceMs: 12,
    current: () => { contextReads++; return true; }, checkpoint: () => { fullReads++; return true; },
    schedule: async () => { throw Error('No asynchronous slice needed in this controlled clock'); },
  })).toBe(7);
  expect(contextReads).toBeGreaterThan(5000); expect(fullReads).toBe(2);
});

it('cooperative grade and joint evaluation preserve synchronous results and yield to UI', async () => {
  // The cheapest 360-point seed is insufficient: this scenario must search,
  // unlike the immediate cheapest-lineup shortcut covered below.
  const searching = { ...input, set: { ...set, grades: [{ name: 'C', threshold: 400, rewards: [] }] } };
  for (const [sync, steps, value] of [[planGalleryGrade, planGalleryGradeSteps, searching],
    [planGalleryJoint, planGalleryJointSteps, {targets: [searching]}]]) {
    let time = 0, yields = 0;
    const before = structuredClone(value);
    expect(await runGalleryPlan(steps(value), {now: () => time++, sliceMs: 1,
      progress: state => { expect(Number.isFinite(state.evaluations)).toBe(true); },
      schedule: async () => { yields++; }})).toEqual(sync(value));
    expect(yields).toBeGreaterThan(0); expect(value).toEqual(before);
  }
});

it('returns an immediately sufficient cheapest lineup without scheduling needless search', async () => {
  const schedule = async () => { throw Error('cheap complete seed should not search'); };
  const result = await runGalleryPlan(planGalleryGradeSteps(input), { sliceMs: 0, schedule });
  expect(result).toEqual(planGalleryGrade(input));
  expect(result.plans[0]).toMatchObject({ reached: true, totalPrice: 200 });
});

it('deadline returns partial, never a false proof of no solution', async () => {
  const result = await runGalleryPlan(planGalleryGradeSteps({...input, targetGrade: 999999}),
    {now: (() => {let t=0; return () => t++;})(), maxMs: 1, schedule: async () => {}});
  expect(result).toMatchObject({status: 'partial', reason: 'search-time-exhausted', searchComplete: false});
});

it('default deadline allows work beyond the former ten second limit', async () => {
  let ticks = 0;
  const steps = (function* () { for (let i = 0; i < 12; i++) {
    if (yield { evaluations: i + 1 }) return { status: 'partial' };
  } return { status: 'ready' }; }());
  const result = await runGalleryPlan(steps, { now: () => (ticks += 1000), sliceMs: 0, schedule: async () => {} });
  expect(result).toEqual({ status: 'ready' });
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
