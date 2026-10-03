import observation from '../fixtures/fc27-puzzle-mixed-quality-observation.json';
import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';

export function mixedQualityFixture() {
  const input = puzzleFillFixture();
  input.challenge.formation = structuredClone(observation.formation);
  input.challenge.rawRequirements = structuredClone(observation.rawRequirements);
  input.chemistry = structuredClone(observation.chemistry);
  input.clubLinks = structuredClone(observation.clubLinks);
  const base = input.inventory.items[0];
  input.inventory.items = observation.candidates.map(([rating, rarity, nationId, leagueId, teamId, positions], index) => ({
    ...base, id: index + 1, definitionId: index + 101, rating, rarity, nationId, leagueId, teamId, positions: [...positions],
  }));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  return { input, pages: structuredClone(observation.pages) };
}
