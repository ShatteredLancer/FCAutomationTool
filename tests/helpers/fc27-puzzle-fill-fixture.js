import { marketFixture, marketRow } from './fc27-market-fixture.js';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';

export function puzzleFillFixture() {
  const input = marketFixture();
  input.policy.onlyUntradeable = true;
  input.challenge.slotCount = 11;
  input.squadEmpty = true;
  input.challenge.formation = { id: 16, positions: Array(11).fill(5) };
  input.challenge.rawRequirements = [marketRow(3, 1, -1, 2), marketRow(35, 14)];
  input.inventory.items = Array.from({ length: 11 }, (_, index) => ({ ...input.inventory.items[0],
    id: index + 1, definitionId: 101 + index, state: 'free' }));
  input.chemistry = { parameters: [
    { id: 1, thresholds: [2, 5, 8].map(requirement => ({ requirement, points: 1 })) },
    { id: 2, thresholds: [3, 5, 8].map(requirement => ({ requirement, points: 1 })) },
    { id: 3, thresholds: [2, 4, 7].map(requirement => ({ requirement, points: 1 })) },
  ], links: input.clubLinks, maxChemistryPerPlayer: 3, profilesEnabled: false,
    identities: { legendClubId: 9001, legendLeagueId: 9002, heroClubId: 9003, hallOfFutClubId: 9004 },
    superChemRarityIds: [], rating: { floatCalculationEnabled: false } };
  input.evaluateSquad = squad => evaluateFc27PuzzleSquad({ squad,
    formation: input.challenge.formation, chemistry: input.chemistry, rating: input.chemistry.rating });
  return input;
}
