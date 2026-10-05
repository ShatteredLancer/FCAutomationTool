import { expect, it } from 'vitest';
import input from '../fixtures/fc27-gallery-lecce-replay.json';
import { planGalleryGradeSteps } from '../../src/gallery/planner.js';
import { planGalleryJointSteps } from '../../src/gallery/joint-planner.js';
import { summarizeGalleryScore } from '../../src/gallery/scoring.js';

// Sanitized 2026-10-05 replay: one 29-version public pool, no account,
// instance IDs, credentials or other collections. Fifteen are already scored.
const withPurchases = ids => ({ ...input, progress: { ...input.progress,
  rows: input.progress.rows.map(row => ids.includes(row.eaId)
    ? { ...row, collected: true, firstOwned: false } : row) } });

it('replaces scored cards rather than adding a gold and silver score to a full Lecce lineup', () => {
  expect(summarizeGalleryScore(input).low.total).toBe(1595);
  expect(summarizeGalleryScore(withPurchases([50590331])).low.total).toBe(1671);
  for (const row of input.progress.rows.filter(row => !row.collected && row.gradingScore === 35 && input.prices[row.eaId])) {
    const result = summarizeGalleryScore(withPurchases([50590331, row.eaId]));
    expect(result.lineup).toHaveLength(15);
    expect(result.low.total).toBeGreaterThanOrEqual(1671);
    expect(result.low.total).toBeLessThanOrEqual(1681);
  }
});

it.each(['single', 'joint'])('retains a better refinement witness when the deadline interrupts Lecce: %s', mode => {
  const before = structuredClone(input);
  const steps = mode === 'single' ? planGalleryGradeSteps(input) : planGalleryJointSteps({ targets: [input] });
  let next = steps.next();
  // Deterministic deadline after the fourth candidate, not a machine-speed
  // assertion. It interrupts refinement, before generic beam expansion.
  while (!next.done && next.value.evaluations < 4) next = steps.next();
  expect(next.done).toBe(false);
  do { next = steps.next(true); } while (!next.done);
  const result = next.value;
  expect(result).toMatchObject({ status: 'partial', reason: 'search-time-exhausted',
    timeExhausted: true, searchComplete: false, plans: [], evaluations: 4 });
  if (mode === 'single') {
    expect(result).toMatchObject({ currentScore: 1595, bestScore: 1689, distanceToTarget: 11, missingPriceCount: 2 });
    expect(result.bestCandidate.totalPrice).toBeGreaterThan(0);
    expect(result.bestCandidate.ids.every(id => !input.progress.rows.find(row => row.eaId === id).collected)).toBe(true);
    expect(summarizeGalleryScore(withPurchases(result.bestCandidate.ids)).low.total).toBe(result.bestScore);
  } else {
    expect(result.targets[0]).toMatchObject({ reached: false, score: 1689, threshold: 1700, pointsMissing: 11 });
  }
  expect(input).toEqual(before);
});
