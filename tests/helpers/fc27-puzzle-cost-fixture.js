import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';
import { boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';

// Fixed synthetic inventory/quotes reproducing the price-sort regression.
export function puzzleCostFixture(seed = 4) {
  let state = seed;
  const rand = n => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor(state / 4294967296 * n);
  };
  const input = puzzleFillFixture();
  input.challenge.rawRequirements = [marketRow(3, 1), marketRow(35, 27), marketRow(9, 4, -1, 1)];
  const base = input.inventory.items[0];
  input.inventory.items = Array.from({ length: 14 }, (_, i) => ({ ...base, id: i + 1, definitionId: 101 + i,
    rating: 55 + rand(10), leagueId: 1 + rand(5), nationId: 1 + rand(5), teamId: 1 + rand(9), positions: [5] }));
  const entries = Array.from({ length: 40 }, (_, i) => ({ definitionId: 901 + i, rating: 55 + rand(10), rarity: 0,
    leagueId: 1 + rand(5), nationId: 1 + rand(5), teamId: 1 + rand(9), positions: [5], groups: [],
    special: false, evolution: false, cosmetic: false }));
  const prices = new Map(entries.map(x => [x.definitionId, 150 + 50 * rand(25)]));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad, formation: input.challenge.formation, chemistry: input.chemistry });
  return { input, entries, prices };
}
