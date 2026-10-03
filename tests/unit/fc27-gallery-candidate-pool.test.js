import { describe, expect, it } from 'vitest';
import { selectGalleryCandidatePool } from '../../src/gallery/candidate-pool.js';

const card = (id, price, score, diversityKeys = []) => ({ id, price, score, diversityKeys });

describe('Gallery candidate pool', () => {
  it('keeps affordable versions when high scores would otherwise fill the limit', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, index) => card(index + 1, 500 + index, 100)),
      ...Array.from({ length: 8 }, (_, index) => card(index + 20, 50000 + index, 1000)),
    ];
    const selected = selectGalleryCandidatePool(rows, 8);
    expect(selected.map(row => row.id)).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(selected.some(row => row.price >= 50000)).toBe(true);
  });

  it('retains a rule representative and treats unknown prices as last resort', () => {
    const selected = selectGalleryCandidatePool([
      card(1, null, 900, ['club:1']), card(2, 100, 100, ['club:2']),
      card(3, 200, 90, ['league:1']),
    ], 2);
    expect(selected.map(row => row.id)).toEqual([2, 3]);
  });
});
