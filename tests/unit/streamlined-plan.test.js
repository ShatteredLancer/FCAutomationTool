import { expect, it } from 'vitest';
import { assertStreamlinedPlan, createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { testPlan } from '../helpers/streamlined.js';
import { streamlinedPlanFingerprint } from '../../src/streamlined/contract.js';

it('freezes exact items/batches and detects mutations including score/status', () => {
  const plan = testPlan();
  expect(Object.isFrozen(plan.items[0])).toBe(true);
  expect(assertStreamlinedPlan(plan)).toBe(plan);
  for (const mutate of [p => { p.items[0].id++; }, p => { p.batches.reverse(); },
    p => { p.score++; }, p => { p.status = 'partial'; }, p => { p.purchaseCost = 900; },
    p => { p.progress.remaining = 100; }]) {
    const changed = structuredClone(plan); mutate(changed);
    expect(() => assertStreamlinedPlan(changed)).toThrow('PLAN_CHANGED');
  }
});

it('preserves already-frozen legacy objectives and fingerprints after the new default changes', () => {
  const previous = testPlan();
  for (const objective of ['lowest-coins', 'fewest-cards']) {
    const legacy = createStreamlinedPlan({ ...previous, result: previous, objective });
    const serialized = JSON.stringify(legacy);
    expect(assertStreamlinedPlan(JSON.parse(serialized)).objective).toBe(objective);
    expect(JSON.stringify(legacy)).toBe(serialized);
  }
});

it('does not accept internally inconsistent plans even with a recomputed fingerprint', () => {
  for (const mutate of [p => { p.items[1].id = p.items[0].id; }, p => { p.purchaseCost = 100; },
    p => { p.materialValue = 0; }, p => { p.status = 'partial'; }, p => { p.progress.total++; },
    p => { p.challenge.remainingScore++; }, p => { p.items[0].scoreVerified = false; }]) {
    const p = structuredClone(testPlan()); mutate(p); p.batches = p.items.map(i => [i]);
    p.fingerprint = streamlinedPlanFingerprint(p);
    expect(() => assertStreamlinedPlan(p)).toThrow('PLAN_CHANGED');
    expect(() => createStreamlinedPlan({ ...p, result: p })).toThrow('PLAN_UNCONFIRMED');
  }
});

it('rejects missing/duplicate identities and disagreement between results and batches', () => {
  const plan = testPlan();
  for (const result of [{ ...plan, batches: [] }, { ...plan, items: [plan.items[0], plan.items[0]] },
    { ...plan, items: [{ ...plan.items[0], key: undefined }] }]) {
    expect(() => createStreamlinedPlan({ ...plan, result })).toThrow();
  }
});
