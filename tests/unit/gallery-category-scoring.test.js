import { expect, it } from 'vitest';
import { galleryCategoryScoring } from '../../src/gallery/category-scoring.js';

const detail = { progress: { complete: true, rows: [] } };
const score = (status, low = 100, high = low) => ({ status, low: { total: low }, high: { total: high } });
it('counts all nine league scores as finished, including eight intervals', () => {
  const rows = [score('calculated'), ...Array.from({ length: 4 }, () => score('uncertain', 100, 120)),
    ...Array.from({ length: 4 }, () => ({ ...score('partial', 100, 120), collectionUnknown: true }))];
  expect(galleryCategoryScoring(rows.map(summary => ({ detail, summary })))).toMatchObject({
    total: 9, completed: 9, pending: 0, missing: 0, unavailable: 0, intervals: 8, collectionUnknown: 4,
  });
});
it('does not label queued calculations or missing base scores as network sync work', () => {
  const result = galleryCategoryScoring([
    { detail, summary: { status: 'calculating' } },
    { detail, summary: { status: 'partial', reason: 'base-score-unknown' } },
    { detail: null, summary: null },
    { detail, summary: score('calculated', 0) },
  ]);
  expect(result).toMatchObject({ total: 4, completed: 1, pending: 1, missing: 1, unavailable: 1 });
  expect(result.completed + result.pending + result.missing + result.unavailable).toBe(result.total);
});
it('keeps unsupported rules visible without claiming a computed result', () => {
  expect(galleryCategoryScoring([{ detail, summary: { status: 'unavailable', reason: 'rule-unsupported' } }]))
    .toMatchObject({ completed: 0, pending: 0, missing: 0, unavailable: 1 });
});
