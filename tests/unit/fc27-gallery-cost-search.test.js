import { expect, it } from 'vitest';
import { refineGalleryCostSteps } from '../../src/gallery/cost-search.js';

const collect = steps => { let value; do { value = steps.next(); } while (!value.done); return value.value; };
const fixture = (threshold, initialIds = [1, 2, 3]) => {
  const candidates = [{ id: 1, price: 100, score: 10 }, { id: 2, price: 100, score: 10 },
    { id: 3, price: 100, score: 10 }, { id: 4, price: 200, score: 30 },
    { id: 5, price: 250, score: 40 }, { id: 6, price: 80000, score: 8000 }, { id: 7, price: null, score: 9000 }];
  const byId = new Map(candidates.map(row => [row.id, row]));
  const evaluate = ids => ({ ids, cost: ids.reduce((sum, id) => sum + (byId.get(id).price ?? 0), 0),
    missingPrices: ids.some(id => byId.get(id).price == null), score: ids.reduce((sum, id) => sum + byId.get(id).score, 0) });
  return { initial: evaluate(initialIds), candidates, evaluate, maxEvaluations: 100,
    measure: state => ({ reached: state.score >= threshold, progress: Math.min(1, state.score / threshold) }) };
};

it('finds a low-cost full bundle instead of a high-score expensive distractor', () => {
  const result = collect(refineGalleryCostSteps(fixture(50)));
  expect(result.plans.at(-1).cost).toBe(400);
  expect(result.plans.at(-1).ids).not.toContain(6);
  expect(result.plans.every(plan => !plan.ids.includes(7))).toBe(true);
});

it('takes more than one affordable upgrade when no single cheap replacement reaches the target', () => {
  const result = collect(refineGalleryCostSteps(fixture(80)));
  expect(result.plans.at(-1).cost).toBe(550);
  expect(result.plans.at(-1).ids).not.toContain(6);
});

it('downgrades a reached high-cost bundle while keeping the target reached', () => {
  const result = collect(refineGalleryCostSteps(fixture(50, [1, 2, 6])));
  expect(result.plans.at(-1)).toMatchObject({ cost: 400, score: 50 });
});

it('honors evaluator rejection, unknown prices and the exact evaluation budget', () => {
  const input = fixture(50), evaluate = input.evaluate;
  input.evaluate = ids => ids.includes(6) ? null : evaluate(ids);
  expect(collect(refineGalleryCostSteps(input)).plans.at(-1).cost).toBe(400);
  expect(collect(refineGalleryCostSteps({ ...input, maxEvaluations: 2 }))).toMatchObject({ evaluations: 2, stopped: true });
  expect(collect(refineGalleryCostSteps({ ...input, initial: { ...input.initial, missingPrices: true } })))
    .toEqual({ plans: [], evaluations: 0, stopped: false });
});

it('stops cooperatively without losing a complete candidate already observed', () => {
  const steps = refineGalleryCostSteps(fixture(50));
  expect(steps.next().done).toBe(false);
  const result = steps.next(true);
  expect(result.done).toBe(true);
  expect(result.value).toMatchObject({ evaluations: 1, stopped: true });
  expect(result.value.plans[0]).toMatchObject({ cost: 400, score: 50 });
});

it.each([2, 3])('crosses %i temporarily lower-score replacements to unlock a cheap combination bonus', count => {
  const candidates = [...[1, 2, 3].map(id => ({ id, price: 100, score: 100 })),
    ...[4, 5, 6].slice(0, count).map(id => ({ id, price: 150, score: 90 })),
    { id: 99, price: 79500, score: 9000 }];
  const evaluate = ids => ({ ids, cost: ids.reduce((sum, id) => sum + candidates.find(row => row.id === id).price, 0),
    score: ids.reduce((sum, id) => sum + candidates.find(row => row.id === id).score, 0)
      + (ids.filter(id => id >= 4 && id <= 6).length === count ? 1000 : 0) });
  const result = collect(refineGalleryCostSteps({ initial: evaluate([1, 2, 3]), candidates, evaluate,
    measure: state => ({ reached: state.score >= 900, progress: Math.min(1, state.score / 900) }), maxEvaluations: 200 }));
  expect(result.plans.at(-1).cost).toBe(300 + count * 50);
  expect(result.plans.at(-1).ids).not.toContain(99);
});

it('deduplicates equivalent replacement orders and never evaluates a version bundle twice', () => {
  const input = fixture(10000), seen = new Set(), evaluate = input.evaluate;
  input.evaluate = ids => {
    const key = ids.slice().sort((a, b) => a - b).join(',');
    expect(seen.has(key)).toBe(false); seen.add(key); return evaluate(ids);
  };
  seen.add(input.initial.ids.slice().sort((a, b) => a - b).join(','));
  collect(refineGalleryCostSteps(input));
});

it('reports bounded candidate, beam and depth pruning rather than claiming completeness', () => {
  expect(collect(refineGalleryCostSteps({ ...fixture(80), candidateLimit: 1 }))).toMatchObject({ truncated: true });
  expect(collect(refineGalleryCostSteps({ ...fixture(80), beamWidth: 1 }))).toMatchObject({ truncated: true });
  expect(collect(refineGalleryCostSteps({ ...fixture(80), maxDepth: 1 }))).toMatchObject({ truncated: true });
});
