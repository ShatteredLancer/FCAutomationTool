import { describe, it, expect } from 'vitest';
import { fodderPoolQueries, matchesFodderPool } from '../../src/gallery/fodder-pool.js';

const set = (conditions = {}) => ({ conditions: { clubs: [], leagues: [], rareflags: [], holo: false, ...conditions } });
describe('Fodder Gallery native pool contract', () => {
  it('queries club alternatives, retaining AND league/rarity/holo membership', () => {
    const target = set({ clubs: [1, 2], leagues: [8, 9], rareflags: [4], holo: true });
    expect(fodderPoolQueries(target)).toEqual([{ club: 1, rarities: [4] }, { club: 2, rarities: [4] }]);
    const card = { teamId: 2, leagueId: 8, rareflag: 4, _hyperCosmeticDTOs: [{}] };
    expect(matchesFodderPool(target, card)).toBe(true);
    for (const change of [{ teamId: 3 }, { leagueId: 7 }, { rareflag: 5 }, { _hyperCosmeticDTOs: [] }]) {
      expect(matchesFodderPool(target, { ...card, ...change })).toBe(false);
    }
  });
  it('uses league or rarity without inventing an unrestricted query', () => {
    expect(fodderPoolQueries(set({ leagues: [9] }))).toEqual([{ league: 9 }]);
    expect(fodderPoolQueries(set({ rareflags: [4, 5] }))).toEqual([{ rarities: [4, 5] }]);
    expect(() => fodderPoolQueries(set())).toThrow('CONDITIONS_UNSUPPORTED');
    expect(() => fodderPoolQueries(set({ clubs: [1], newFilter: true }))).toThrow('CONDITIONS_UNSUPPORTED');
  });
});
