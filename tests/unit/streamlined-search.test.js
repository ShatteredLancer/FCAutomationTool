import { expect, it } from 'vitest';
import { planStreamlined, runStreamlinedPlan } from '../../src/streamlined/planner.js';
import { challenge, safeItem, eligibility, policy } from '../helpers/streamlined.js';

it('matches an exhaustive oracle on small pools, including repeated versions and non-greedy covers', () => {
  let seed = 17;
  const rand = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 40; trial++) {
    const target = 20 + rand(120);
    const inventory = Array.from({ length: 8 }, (_, i) => safeItem({ id: i + 1, definitionId: 9,
      points: 5 + rand(60), price: 100 + rand(1000) }));
    for (const objective of ['lowest-value', 'lowest-coins', 'fewest-cards']) {
      let best = null;
      for (let mask = 1; mask < 256; mask++) {
        const selected = inventory.filter((_, i) => mask & (1 << i));
        const score = selected.reduce((s, item) => s + item.points, 0);
        if (score < target) continue;
        const value = selected.reduce((s, item) => s + item.price, 0), count = selected.length;
        const rank = objective === 'fewest-cards' ? [count, value, score] : [value, score, count];
        if (!best || rank.find((v, i) => v !== best.rank[i]) < best.rank[rank.findIndex((v, i) => v !== best.rank[i])]) best = { rank, score, value, count };
      }
      const result = planStreamlined({ challenge: challenge({ scoreRequirement: target }), inventory, policy, eligibility, objective });
      if (!best) expect(result.status).toBe('partial');
      else expect([result.materialValue, result.score, result.items.length]).toEqual([best.value, best.score, best.count]);
    }
  }
});

it('exposes bounded results without claiming exhausted search or incomplete pools are globally optimal', async () => {
  const input = { challenge: challenge(), inventory: Array.from({ length: 200 }, (_, i) => safeItem({ id: i + 1, points: 20 + i })), policy, eligibility };
  const limited = planStreamlined({ ...input, maxNodes: 1 });
  expect(limited).toMatchObject({ status: 'ready', searchComplete: false, optimalWithinPricedPool: false, poolComplete: false, nodes: 1 });
  const progress = [];
  const cancelled = await runStreamlinedPlan(input, { onProgress: p => progress.push(p), stopped: () => true, schedule: async () => {} });
  expect(cancelled.status).toBe('cancelled');
  expect(progress.length).toBeGreaterThan(0);
});

it('does not use missing/expired/wrong-source quotes or guess unknown point values', () => {
  const market = [safeItem({ source: 'market', points: 3000, quote: { source: 'futgg', definitionId: 2, price: 200, fetchedAt: 1, expiresAt: 9 } })];
  const result = planStreamlined({ challenge: challenge(), market, quoteAt: 10, policy, eligibility,
    inventory: [safeItem({ points: 3000, scoreVerified: false })] });
  expect(result).toMatchObject({ status: 'unavailable', excluded: { 'points-unknown': 1, 'market-quote': 1 } });
});
