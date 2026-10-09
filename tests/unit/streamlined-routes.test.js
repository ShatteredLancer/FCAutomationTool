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

it('defaults to 8000 in new purchases instead of consuming 30000 of stock, with explicit alternatives', () => {
  const value = input(100, [market(10, 25, 2000)], [safeItem({ points: 100, price: 30000 })]);
  const result = solve(value);
  expect(result.routes[0]).toMatchObject({ totalValue: 8000, materialValue: 0, purchaseCost: 8000, count: 4 });
  expect(solve({ ...value, objective: 'lowest-coins' }).routes[0]).toMatchObject({ purchaseCost: 0, materialValue: 30000 });
  expect(solve({ ...value, objective: 'fewest-cards' }).routes[0]).toMatchObject({ count: 1, materialValue: 30000 });
  expect(result.routes.some(r => r.count === 1 && r.purchaseCost === 0)).toBe(true);
});

it('prefers known market cost over unknown stock value without inventing an estimate', () => {
  const result = solve(input(100, [market(10, 25, 2000)], [safeItem({ points: 100, price: null })]));
  expect(result.routes[0]).toMatchObject({ totalValue: 8000, unknownValueCount: 0 });
  expect(result.routes.find(r => r.purchaseCost === 0)).toMatchObject({ totalValue: null, unknownValueCount: 1 });
});

it('matches an independent mixed inventory/market cover oracle for all three objectives', () => {
  for (let target = 1; target <= 25; target++) {
    const inventory = [safeItem({ id: 101, points: 6, price: 3000 }),
      safeItem({ id: 102, points: 4, price: 100 }), safeItem({ id: 103, points: 5, price: 200 })];
    const combinations = [];
    for (let mask = 0; mask < 8; mask++) for (let a = 0; a <= Math.ceil(target / 3); a++) {
      for (let b = 0; b <= Math.ceil(target / 8); b++) {
        const rows = inventory.filter((_, i) => mask & (1 << i));
        const score = rows.reduce((sum, row) => sum + row.points, 0) + 3 * a + 8 * b;
        if (score < target) continue;
        const purchase = 150 * a + 450 * b, material = rows.reduce((sum, row) => sum + row.price, 0);
        combinations.push({ score, purchase, material, count: rows.length + a + b });
      }
    }
    for (const objective of ['lowest-value', 'lowest-coins', 'fewest-cards']) {
      const tuple = row => objective === 'lowest-value' ? [row.purchase + row.material, row.purchase, row.material, row.score, row.count]
        : objective === 'fewest-cards' ? [row.count, row.purchase, row.material, row.score]
          : [row.purchase, row.material, row.score, row.count];
      const compare = (a, b) => { const left = tuple(a), right = tuple(b); for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return left[i] - right[i];
      } return 0; };
      const expected = combinations.sort(compare)[0];
      for (const stock of [inventory, inventory.slice().reverse()]) {
        const result = solve({ ...input(target, [market(10, 3, 150), market(11, 8, 450)], stock), objective });
        expect(result.searchComplete).toBe(true);
        const row = result.routes[0];
        expect(tuple({ purchase: row.purchaseCost, material: row.materialValue, count: row.count, score: row.score }))
          .toEqual(tuple(expected));
      }
    }
  }
});

it('does not prune cheap multi-card inventory with an expensive one-card route at zero purchase cost', () => {
  const inventory = [safeItem({ id: 101, definitionId: 101, points: 100, price: 30000 }),
    safeItem({ id: 102, definitionId: 102, points: 50, price: 100 }),
    safeItem({ id: 103, definitionId: 103, points: 50, price: 100 })];
  const result = solve(input(100, [], inventory));
  expect(result.routes[0]).toMatchObject({ purchaseCost: 0, materialValue: 200, count: 2, score: 100 });
  expect(result.routes.some(r => r.materialValue === 30000 && r.count === 1)).toBe(true);
});

it('retains cheaper equal-score partial paths regardless of their card count or input order', () => {
  const inventory = [safeItem({ id: 101, definitionId: 101, points: 50, price: 30000 }),
    ...[102, 103].map(id => safeItem({ id, definitionId: id, points: 25, price: 100 })),
    safeItem({ id: 104, definitionId: 104, points: 50, price: 500 })];
  for (const order of [inventory, inventory.slice().reverse()]) {
    const result = solve(input(100, [], order));
    expect(result.routes[0]).toMatchObject({ purchaseCost: 0, materialValue: 700, count: 3 });
    expect(result.routes.find(r => r.count === 2)?.materialValue).toBe(30500);
  }
});

it('keeps known-priced inventory routes instead of allowing fewer unknown-value cards to dominate them', () => {
  const inventory = [safeItem({ id: 101, definitionId: 101, points: 100, price: null }),
    ...[102, 103].map(id => safeItem({ id, definitionId: id, points: 50, price: 100 }))];
  const result = solve(input(100, [], inventory));
  expect(result.routes[0]).toMatchObject({ materialValue: 200, count: 2 });
  expect(result.routes.find(r => r.count === 1)?.materialValue).toBeNull();
});

it('keeps the lowest material value inventory seed when search stops before the exact cover', () => {
  const inventory = [safeItem({ id: 101, definitionId: 101, points: 14000, price: 30000 }),
    ...Array.from({ length: 12 }, (_, index) => safeItem({ id: 102 + index, definitionId: 102 + index, points: 1000, price: 200 }))];
  const result = solve(input(12000, [market(901, 10, 200), market(902, 1000, 300)], inventory), { maxNodes: 1 });
  expect(result.searchComplete).toBe(false);
  expect(result.routes[0]).toMatchObject({ purchaseCost: 0, materialValue: 2400, count: 12 });
  expect(result.routes.some(r => r.materialValue === 30000 && r.count === 1)).toBe(true);
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
