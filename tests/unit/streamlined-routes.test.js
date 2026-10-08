import { expect, it } from 'vitest';
import { planStreamlinedRoutesSteps, runStreamlinedRoutes } from '../../src/streamlined/routes.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';

const market = (id, points, price, rating = 84) => safeItem({ source: 'market', definitionId: id, points, rating, price,
  quote: { definitionId: id, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 } });
const input = (target, versions, inventory = []) => ({ challenge: challenge({ scoreRequirement: target }),
  policy, eligibility, inventory, market: versions, quoteSource: 'futgg', quoteAt: 10 });
const solve = (value, options) => { const iterator = planStreamlinedRoutesSteps(value, options); let step;
  do { step = iterator.next(); } while (!step.done); return step.value; };

it('keeps thousand-card demand compressed and reproduces public cheapest / 87 route arithmetic', () => {
  const result = solve(input(1125000, [market(1, 410, 760, 83), market(2, 830, 985),
    market(3, 4100, 5190, 86), market(4, 5500, 7160, 87)]), { maxNodes: 100000, maxMs: 60000 });
  expect(result.routes[0]).toMatchObject({ count: 1356, score: 1125060, purchaseCost: 1335435, minBatches: 46 });
  expect(result.routes.find(r => r.count === 205)).toMatchObject({ score: 1126100, purchaseCost: 1465830 });
  expect(result.routes[0].groups).toHaveLength(2);
  expect(result.routes[0].groups.flatMap(g => g.items)).toHaveLength(2);
  expect(result.routes.every(r => r.supplyVerified === false)).toBe(true);
});

it('prefers a cheaper higher-score route over a large 82-rated fallback', () => {
  const result = solve(input(85000, [
    market(21, 340, 700, 82),
    market(22, 410, 760, 83),
  ]), { maxNodes: 100000, maxMs: 60000 });
  expect(result.routes[0].purchaseCost).toBeLessThan(250 * 700);
  expect(result.routes[0].groups.some(group => group.item.definitionId === 22)).toBe(true);
  expect(result.routes[0].count).toBeLessThan(250);
});

it('uses inventory without counting its value as purchase cost; market-only never consumes it', () => {
  const value = input(100, [market(10, 30, 200)], [safeItem({ points: 70, price: 500 })]);
  expect(solve(value).routes[0]).toMatchObject({ inventoryCount: 1, marketCount: 1, purchaseCost: 200, materialValue: 500 });
  expect(solve({ ...value, mode: 'market' }).routes[0]).toMatchObject({ inventoryCount: 0, marketCount: 4, purchaseCost: 800 });
});

it('replays the public Hero 85000-point price comparison while protecting high-rated stock', () => {
  // FUT.GG public PC snapshot, 2026-10-08. Rates are arithmetic fixtures, not live quote authority.
  const value = input(85000, [market(82, 340, 700, 82), market(84, 830, 1090, 84),
    market(85, 2100, 2970, 85), market(86, 4100, 5900, 86), market(87, 5500, 8030, 87)],
    [safeItem({ rating: 84, points: 830 })]);
  value.policy = { ...policy, maxRating: 82, marketMaxRating: 99, goldRange: [75, 82] };
  const result = solve(value);
  expect(result.routes[0]).toMatchObject({ purchaseCost: 111880, count: 103, score: 85000, inventoryCount: 0 });
  expect(result.excluded.rating).toBe(1);
  expect(result.routes[0].groups.map(g => [g.item.rating, g.quantity])).toEqual([[82, 1], [84, 102]]);
  expect(solve({ ...value, policy: { ...value.policy, marketMaxRating: 82 } }).routes[0].purchaseCost).toBe(175000);
  const { marketMaxRating: _marketMaxRating, ...legacyPolicy } = value.policy;
  expect(solve({ ...value, policy: legacyPolicy }).routes[0].purchaseCost).toBe(175000);
});

it('matches an exhaustive small integer cover oracle and retains fewer-card cost alternatives', () => {
  for (let target = 1; target <= 35; target++) {
    const combinations = [];
    for (let a = 0; a <= 7; a++) for (let b = 0; b <= 5; b++) for (let c = 0; c <= 4; c++) {
      if (a * 5 + b * 8 + c * 13 >= target) combinations.push({ cost: a * 150 + b * 300 + c * 600, count: a + b + c });
    }
    const result = solve(input(target, [market(10, 5, 150), market(11, 8, 300), market(12, 13, 600)]));
    expect(result.searchComplete).toBe(true);
    expect(result.routes[0].purchaseCost).toBe(Math.min(...combinations.map(v => v.cost)));
    expect(Math.min(...result.routes.map(v => v.count))).toBe(Math.min(...combinations.map(v => v.count)));
  }
});

it('excludes expired/wrong-source quotes and protected cards instead of treating them as free', () => {
  const result = solve(input(100, [{ ...market(10, 100, 200), quote: { ...market(10, 100, 200).quote, expiresAt: 5 } },
    { ...market(11, 100, 200), quote: { ...market(11, 100, 200).quote, source: 'futbin' } }], [safeItem({ protected: true, points: 100 })]));
  expect(result.status).toBe('unavailable'); expect(result.excluded).toMatchObject({ protected: 1, 'market-quote': 2 });
});

it('enforces the supplied total budget and yields cancellation without claiming completion', async () => {
  expect(solve(input(100, [market(10, 50, 200)]), { budget: 399 }).status).toBe('unavailable');
  const progress = [];
  const result = await runStreamlinedRoutes(input(1125000, [market(10, 410, 760), market(11, 830, 985)]),
    { onProgress: row => progress.push(row), stopped: () => true, schedule: async () => {} });
  expect(progress.length).toBeGreaterThan(0); expect(result.status).toBe('cancelled'); expect(result.searchComplete).toBe(false);
});
