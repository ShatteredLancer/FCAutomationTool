import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';
import { boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';

// Synthetic analogue of the exported counts; never a replay of private cards.
export function shortageFixture() {
  const input = puzzleFillFixture();
  input.challenge.rawRequirements = [marketRow(3, 1), marketRow(17, 2, 3), marketRow(35, 14)];
  input.challenge.formation.positions = [0, 3, 5, 5, 7, 12, 14, 14, 16, 25, 25];
  input.inventory.items = Array.from({ length: 60 }, (_, i) => ({ ...input.inventory.items[0],
    id: i + 1, definitionId: i + 101, rating: i % 4 === 0 ? 70 : 60,
    nationId: 100 + i, leagueId: 1, teamId: 100 + i, positions: [0] }));
  const entries = Array.from({ length: 59 }, (_, i) => ({ definitionId: 1001 + i,
    rating: i % 4 === 0 ? 70 : 60, rarity: 0, nationId: 300 + i, leagueId: i < 40 ? 1 : 2,
    teamId: 300 + i, positions: [i < 40 ? 0 : input.challenge.formation.positions[(i - 40) % 11]],
    groups: [], special: false, evolution: false, cosmetic: false }));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  return { input, entries };
}
