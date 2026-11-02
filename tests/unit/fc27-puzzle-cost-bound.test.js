import { expect, it } from 'vitest';
import { createFc27PuzzleCostBound } from '../../src/fc27/puzzle-preview.js';

it('includes the unavoidable cost of required cards instead of pricing only free inventory', () => {
  const entries = [{ rule: { mode: 'min', count: 2 }, used: 0, matches: [false, false, false, true, true] }];
  expect(createFc27PuzzleCostBound([0, 0, 0, 200, 400], entries, 3)(0, 3)).toBe(600);
});

it('never overestimates an exhaustive feasible completion with overlapping count rules and zero-cost inventory', () => {
  let seed = 91;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 160; run++) {
    const costs = Array.from({ length: 8 }, () => random(4) * 200);
    const entries = Array.from({ length: 3 }, () => ({ rule: { mode: ['min', 'exact', 'max'][random(3)], count: random(5) },
      used: random(2), matches: costs.map(() => random(2) === 0) }));
    const start = random(4), remaining = 1 + random(4);
    const bound = createFc27PuzzleCostBound(costs, entries, 4)(start, remaining);
    let exact = Infinity;
    for (let mask = 0; mask < 256; mask++) {
      const picked = costs.flatMap((_cost, i) => mask & (1 << i) ? [i] : []);
      if (picked.length !== remaining || picked.some(i => i < start)) continue;
      if (!entries.every(entry => {
        const count = entry.used + picked.filter(i => entry.matches[i]).length;
        return entry.rule.mode === 'min' ? count >= entry.rule.count
          : entry.rule.mode === 'max' ? count <= entry.rule.count : count === entry.rule.count;
      })) continue;
      exact = Math.min(exact, picked.reduce((sum, i) => sum + costs[i], 0));
    }
    expect(bound).toBeLessThanOrEqual(exact);
  }
});

it('counts duplicate physical copies as one candidate in the cost floor', () => {
  const costs = [0, 100, 200, 300, 500];
  const definitions = [1, 1, 2, 3, 4];
  const entries = [{ rule: { mode: 'min', count: 1 }, used: 0,
    matches: [false, false, false, true, true] }];
  const bound = createFc27PuzzleCostBound(costs, entries, 2, definitions);
  // One of the two slots must satisfy the count rule; use the cheapest unique
  // non-match plus the cheapest unique match.
  expect(bound(0, 2)).toBe(300);
  // A duplicate of definition 1 cannot satisfy two remaining slots.
  expect(bound(1, 2)).toBe(400);
});
