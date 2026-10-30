import { expect, it } from 'vitest';
import shapes from '../fixtures/fc27-norway-candidate-shapes.json';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';
import { prepareFc27PuzzleFillPlan } from '../../src/fc27/puzzle-fill-plan.js';

function fixture() {
  const input = puzzleFillFixture(); input.policy.maxRating = 82;
  input.challenge.rawRequirements = structuredClone(shapes.rawRequirements);
  input.challenge.formation = structuredClone(shapes.formation);
  input.clubLinks = structuredClone(shapes.clubLinks); input.chemistry = structuredClone(shapes.chemistry);
  input.inventory.items = shapes.candidates.map(([rating, rarity, nationId, leagueId, teamId, positions], index) => ({
    ...input.inventory.items[0], id: index + 1, definitionId: index + 101, rating, rarity, nationId, leagueId, teamId, positions,
  }));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  return input;
}

it('retains the real Norway chemistry target when a native-valid higher-quality fallback is needed', () => {
  const input = fixture();
  const result = previewFc27PuzzleSquad(input);
  expect(result).toMatchObject({status:'preview',materialPreference:'native-quality-fallback'});
  expect(result.teamFacts.chemistry).toBeGreaterThanOrEqual(18);
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(result.selected.every(ref=>ref.rating<=82)).toBe(true);
  expect(prepareFc27PuzzleFillPlan(input,result).status).toBe('prepared');
  expect(input.challenge.rawRequirements.find(rule => rule.pairs[0].key === 35).pairs[0].values).toEqual([18]);
});

it('solves a synthetic chemistry-17 variant with exactly two gold and nine silver within one budget', () => {
  const input = fixture();
  input.challenge.rawRequirements.find(rule => rule.pairs[0].key === 35).pairs[0].values = [17];
  const result = previewFc27PuzzleSquad(input);
  expect(result.status, JSON.stringify({reason:result.reason,nodes:result.nodes,search:result.search})).toBe('preview');
  expect(result.selected.filter(item => item.rating >= 75)).toHaveLength(2);
  expect(result.selected.filter(item => item.rating >= 65 && item.rating <= 74)).toHaveLength(9);
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(prepareFc27PuzzleFillPlan(input, result).status).toBe('prepared');
});
