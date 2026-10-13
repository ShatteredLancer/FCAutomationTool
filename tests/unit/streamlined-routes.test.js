import { expect, it } from 'vitest';
import { expandStreamlinedRoute, planStreamlinedRoutesSteps, runStreamlinedRoutes } from '../../src/streamlined/routes.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';
import repeatedDemand from '../fixtures/fc27-streamlined-repeated-demand-2026-10-13.json';

const market = (id, points, price, rating = 84) => safeItem({ source: 'market', definitionId: id, points, rating, price,
  quote: { definitionId: id, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 } });
const input = (target, versions, inventory = []) => ({ challenge: challenge({ scoreRequirement: target }),
  policy, eligibility, inventory, market: versions, quoteSource: 'futgg', quoteAt: 10 });
const solve = (value, options) => { const iterator = planStreamlinedRoutesSteps(value, options); let step;
  do { step = iterator.next(); } while (!step.done); return step.value; };

it('keeps cheapest repeated demand and offers a near-price distinct-version cover without changing stock', () => {
  let identity = 900;
  const stock = repeatedDemand.inventory.flatMap(row => Array.from({ length: row.quantity }, () =>
    safeItem({ id: ++identity, definitionId: identity, rating: row.rating, points: row.points, price: row.price })));
  // 1050-price alternatives are synthetic, not recovered individual quotes.
  const versions = [market(101, 830, 1000),
    ...Array.from({ length: 8 }, (_, i) => market(102 + i, 830, 1050)),
    ...Array.from({ length: 3 }, (_, i) => market(201 + i, 4100, 5000, 86))];
  const result = solve(input(repeatedDemand.remainingScore, versions, stock), { maxNodes: 1 });
  expect(result.routes[0]).toMatchObject(repeatedDemand.selected);
  const practical = result.routes.find(row => row.minBatches === 1 && row.inventoryCount === 4);
  expect(practical).toMatchObject({ totalValue: 15100, purchaseCost: 9400, count: 13, score: 12060, repeatPurchaseCount: 0 });
  const expanded = expandStreamlinedRoute(practical, challenge({ scoreRequirement: 12000 }));
  expect(expanded.batches).toHaveLength(1);
  expect(new Set(expanded.items.filter(row => row.source === 'market').map(row => row.definitionId)).size).toBe(9);
  const reversed = solve(input(repeatedDemand.remainingScore, versions.slice().reverse(), stock.slice().reverse()), { maxNodes: 1 });
  expect(reversed.routes.find(row => row.minBatches === 1 && row.inventoryCount === 4)?.purchaseCost).toBe(9400);
});

it('does not silently diversify into costly versions or change a lowest-coins objective', () => {
  const versions = [market(101, 830, 1000), market(102, 830, 50000)];
  const result = solve({ ...input(2490, versions), objective: 'lowest-coins' }, { maxNodes: 1 });
  expect(result.routes[0]).toMatchObject({ purchaseCost: 3000, minBatches: 3 });
  expect(result.routes.every(row => row.purchaseCost === 3000)).toBe(true);
});

it('never increases an approved budget or reuses missing/stale versions for a diversified cover', () => {
  const versions = [market(101, 830, 1000), market(102, 830, 1050),
    market(103, 830, 1050), { ...market(104, 830, 1050), quote: null }];
  const result = solve(input(2490, versions), { maxNodes: 1, budget: 3050 });
  expect(result.routes[0]).toMatchObject({ purchaseCost: 3000, minBatches: 3 });
  expect(result.routes.some(row => row.purchaseCost === 3050 && row.minBatches === 2)).toBe(true);
  expect(result.routes.every(row => row.purchaseCost <= 3050 && row.groups.every(g => g.items.every(i => i.definitionId !== 104)))).toBe(true);
});

it('keeps thousand-card demand compressed without assuming thirty distinct quoted versions', () => {
  const result = solve(input(1125000, [market(1, 410, 760, 83), market(2, 830, 985),
    market(3, 4100, 5190, 86), market(4, 5500, 7160, 87)]), { maxNodes: 100000, maxMs: 60000 });
  expect(result.routes[0]).toMatchObject({ count: 1356, score: 1125060, purchaseCost: 1335435, minBatches: 1355 });
  expect(result.routes.find(r => r.count === 205)).toMatchObject({ score: 1126100, purchaseCost: 1465830 });
  expect(result.routes[0].groups).toHaveLength(2);
  expect(result.routes[0].groups.flatMap(g => g.items)).toHaveLength(2);
  expect(result.routes.every(r => r.supplyVerified === false)).toBe(true);
});

it('can project a thirty-version price bucket into the public recipe capacity bound', () => {
  const versions = Array.from({ length: 30 }, (_, i) => market(100 + i, 830, 985));
  const result = solve(input(1125000, [...versions, market(1, 410, 760, 83)]), { maxMs: 60000 });
  expect(result.routes[0]).toMatchObject({ minBatches: 46, count: 1356, purchaseCost: 1335435 });
  expect(expandStreamlinedRoute(result.routes[0], challenge({ scoreRequirement: 1125000 })).batches).toHaveLength(46);
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

it('seeds a cheap TOTW cover before exhausting a tiny budget on costly same-score price buckets', () => {
  const versions = [market(1, 4100, 41000, 86),
    ...Array.from({ length: 40 }, (_, i) => market(100 + i, 830, 2000 + i * 100, 84)),
    market(200, 830, 925, 84), market(201, 410, 700, 83)];
  for (const order of [versions, versions.slice().reverse()]) {
    const result = solve(input(12000, order), { maxNodes: 1 });
    expect(result.routes[0]).toMatchObject({ purchaseCost: 13650, score: 12030, count: 15 });
    expect(result.searchComplete).toBe(false);
  }
});

it('seeds the cheaper 83 tail before unrelated stock prefixes exhaust the time budget', () => {
  const stock = Array.from({ length: 300 }, (_, i) => safeItem({ id: 1000 + i,
    definitionId: 1000 + i, points: 10, price: 200 }));
  let clock = 0;
  const result = solve(input(12000, [market(84, 830, 700), market(83, 410, 500, 83)], stock),
    { now: () => ++clock, maxMs: 2 });
  expect(result.searchComplete).toBe(false);
  expect(result.routes[0]).toMatchObject({ purchaseCost: 10300, score: 12030, count: 15 });
});

it('yields after a fast bulk-tail sweep even when its bucket count does not divide 128', () => {
  const iterator = planStreamlinedRoutesSteps(input(12000, [market(84, 830, 700),
    market(83, 410, 500, 83), market(85, 2100, 2000, 85)]));
  const progress = iterator.next();
  expect(progress.done).toBe(false);
  expect(progress.value.nodes).toBe(3);
  const cancelled = iterator.next(true);
  expect(cancelled.done).toBe(true);
  expect(cancelled.value).toMatchObject({ status: 'cancelled', nodes: 3 });
});

it('reuses equally valued stock in a cheap market recipe before bounded exact search', () => {
  const stock = [safeItem({ id: 101, definitionId: 101, points: 830, rating: 84, price: 700 }),
    safeItem({ id: 102, definitionId: 102, points: 410, rating: 83, price: 500 }),
    ...Array.from({ length: 200 }, (_, i) => safeItem({ id: 1000 + i, definitionId: 1000 + i, points: 10, price: 200 }))];
  const result = solve(input(12000, [market(84, 830, 700), market(83, 410, 500, 83)], stock), { maxNodes: 1 });
  expect(result.routes[0]).toMatchObject({ totalValue: 10300, materialValue: 1200,
    purchaseCost: 9100, inventoryCount: 2, marketCount: 13, score: 12030 });
});

it('reuses equal-value owned cards in the later winning TOTW pair recipe before search truncation', () => {
  // Oct 11 log: owned 84 minimum 800; selected 8x84 at 800 + 1x87 at 5200.
  // Counts/identities below are synthetic; only score/price buckets are replayed.
  const stock = [safeItem({ id: 101, definitionId: 101, points: 830, rating: 84, price: 800 }),
    ...Array.from({ length: 300 }, (_, i) => safeItem({ id: 1000 + i,
      definitionId: 1000 + i, points: 160, rating: 79, price: 650 }))];
  for (const inventory of [stock, stock.slice().reverse()]) {
    const result = solve(input(12000, [market(84, 830, 800), market(87, 5500, 5200, 87)], inventory),
      { maxStates: 1 });
    expect(result.searchComplete).toBe(false);
    expect(result.routes[0]).toMatchObject({ totalValue: 11600, materialValue: 800,
      purchaseCost: 10800, inventoryCount: 1, marketCount: 8, count: 9, score: 12140 });
  }
});

it.each([1, 2, 8, 10])('reuses at most the needed copies from %s equal-value stock cards', copies => {
  const stock = Array.from({ length: copies }, (_, i) => safeItem({ id: 100 + i,
    definitionId: 100 + i, points: 830, rating: 84, price: 800, pile: 'storage' }));
  const result = solve(input(12000, [market(84, 830, 800), market(87, 5500, 5200, 87)], stock),
    { maxStates: 1 });
  const used = Math.min(copies, 8);
  expect(result.routes[0]).toMatchObject({ score: 12140, totalValue: 11600, inventoryCount: used,
    marketCount: 9 - used, purchaseCost: 11600 - 800 * used, materialValue: 800 * used });
  const expanded = expandStreamlinedRoute(result.routes[0], challenge({ scoreRequirement: 12000 }));
  const refs = expanded.items.filter(item => item.source === 'inventory');
  expect(new Set(refs.map(item => item.id)).size).toBe(used);
  expect(refs.every(item => stock.some(row => row.id === item.id))).toBe(true);
});

it('projects repeated market demand into distinct-version purchase batches', () => {
  const c = challenge({ scoreRequirement: 12000 });
  const result = solve(input(12000, [market(84, 830, 700), market(83, 410, 500, 83)]));
  const route = result.routes[0];
  expect(route.minBatches).toBe(14);
  const expanded = expandStreamlinedRoute(route, c);
  expect(expanded.batches).toHaveLength(14);
  expect(expanded.items).toEqual(expanded.batches.flat());
  for (const batch of expanded.batches) expect(new Set(batch.map(i => i.definitionId)).size).toBe(batch.length);
});

it('keeps multiple existing physical copies but never projects buying their version in the same batch', () => {
  const stock = [101, 102].map(id => safeItem({ id, definitionId: 84, points: 830, price: 700 }));
  const result = solve(input(2400, [market(84, 830, 700)], stock));
  const expanded = expandStreamlinedRoute(result.routes[0], challenge({ scoreRequirement: 2400 }));
  expect(expanded.batches).toHaveLength(2);
  expect(expanded.batches[0].map(i => i.source)).toEqual(['inventory', 'inventory']);
  expect(expanded.batches[1].map(i => i.source)).toEqual(['market']);
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

it('keeps pure inventory and mixed lanes visible when the cheapest default is market-only', () => {
  const inventory = [101, 102, 103].map(id => safeItem({ id, definitionId: id, points: 40, price: 20000 }));
  const result = solve(input(100, [market(10, 25, 1000)], inventory));
  expect(result.routes[0]).toMatchObject({ inventoryCount: 0, marketCount: 4, purchaseCost: 4000 });
  expect(result.routes.some(route => route.inventoryCount > 0 && route.marketCount === 0)).toBe(true);
  expect(result.routes.some(route => route.inventoryCount > 0 && route.marketCount > 0)).toBe(true);
});

it('keeps partial-stock covers when the exact search mixes inventory and market groups', () => {
  const stock = [safeItem({ id: 101, definitionId: 101, points: 4100, price: 2900, rating: 85 }),
    safeItem({ id: 102, definitionId: 102, points: 4100, price: 2900, rating: 85 }),
    safeItem({ id: 103, definitionId: 103, points: 4100, price: 5000, rating: 85 })];
  for (const inventory of [stock, stock.slice().reverse()]) {
    const value = input(12000, [market(901, 4100, 3000, 85)], inventory);
    const result = solve(value);
    expect(result.searchComplete).toBe(true);
    expect(result.routes[0]).toMatchObject({ totalValue: 8800, materialValue: 5800,
      purchaseCost: 3000, inventoryCount: 2, marketCount: 1, score: 12300 });
    expect(solve({ ...value, objective: 'lowest-coins' }).routes[0])
      .toMatchObject({ purchaseCost: 0, inventoryCount: 3 });
    expect(solve({ ...value, mode: 'market' }).routes[0])
      .toMatchObject({ totalValue: 9000, inventoryCount: 0, marketCount: 3 });
  }
});

it('seeds partial stock before a state limit prevents exact mixed search', () => {
  const inventory = [101, 102].map(id => safeItem({ id, definitionId: id, points: 4100, price: 2900 }));
  inventory.push(safeItem({ id: 103, definitionId: 103, points: 4100, price: 5000 }));
  for (const stock of [inventory, inventory.slice().reverse()]) {
    const value = input(12000, [market(901, 4100, 3000)], stock);
    const result = solve(value, { maxStates: 1 });
    expect(result.searchComplete).toBe(false);
    expect(result.routes[0]).toMatchObject({ totalValue: 8800, materialValue: 5800,
      purchaseCost: 3000, inventoryCount: 2, marketCount: 1, score: 12300 });
    expect(solve({ ...value, objective: 'lowest-coins' }, { maxStates: 1 }).routes[0])
      .toMatchObject({ purchaseCost: 0, inventoryCount: 3 });
    expect(solve({ ...value, mode: 'market' }, { maxStates: 1 }).routes[0])
      .toMatchObject({ totalValue: 9000, inventoryCount: 0, marketCount: 3 });
  }
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
