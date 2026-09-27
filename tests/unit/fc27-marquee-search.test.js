import { expect, it } from 'vitest';
import shapes from '../fixtures/fc27-marquee-candidate-shapes.json';
import observation from '../fixtures/fc27-puzzle-plan-observation.json';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';
import { prepareFc27PuzzleFillPlan } from '../../src/fc27/puzzle-fill-plan.js';

function marqueeInput() {
  const input = puzzleFillFixture();
  input.challenge.rawRequirements = structuredClone(observation.rawRequirements);
  // Preserve the broad bronze/silver search regression using a synthetic
  // maximum-silver rule. The recorded minimum-bronze case below now requires
  // eight bronze fillers under the user's stricter material policy.
  const quality = input.challenge.rawRequirements.find(rule => rule.pairs[0].key === 3);
  quality.scope = 1; quality.pairs[0].values = [2];
  input.challenge.formation = structuredClone(observation.layout.formation);
  input.clubLinks = { schema: 1, complete: true, links: [[115996, 32], [116011, 18], [116019, 88], [131358, 234], [131733, 452], [116302, 111140]] };
  input.chemistry.links = input.clubLinks;
  input.chemistry.rating.floatCalculationEnabled = true;
  input.inventory.items = shapes.candidates.map(([rating, rarity, nationId, leagueId, teamId, positions], index) => ({
    ...input.inventory.items[0], id: index + 1, definitionId: index + 101, rating, rarity, nationId, leagueId, teamId, positions,
  }));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  return input;
}

it('finds a valid synthetic Marquee variant within the budget instead of spending it on equivalent permutations', () => {
  const input = marqueeInput();
  const result = previewFc27PuzzleSquad(input);
  expect(result.status, JSON.stringify({ reason: result.reason, nodes: result.nodes, search: result.search })).toBe('preview');
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(result.strategyAttempts).toBeGreaterThan(1);
  expect(result.nodes).toBe(Object.values(result.search).reduce((sum, value) => sum + value, 0));
  expect(prepareFc27PuzzleFillPlan(input, result).status).toBe('prepared');
});

it('reports the bronze filler shortage in the original recorded requirements without upgrading to silver', () => {
  const input = marqueeInput(); input.challenge.rawRequirements = structuredClone(observation.rawRequirements);
  expect(previewFc27PuzzleSquad(input)).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_CONSTRAINT_SHORTAGE',
    deficits: expect.arrayContaining([expect.objectContaining({ source: expect.objectContaining({ policy: 'minimum-quality-fillers', quality: 1 }) })]) });
});

it('preserves a single explicit traversal and returns search-limit, not shortage, when starts exhaust their shared budget', () => {
  const input = marqueeInput();
  const explicit = previewFc27PuzzleSquad({ ...input, maxNodes: 2000, searchHint: { strategy: 'league', groupId: 20 } });
  expect(explicit.status).toBe('preview'); expect(explicit.strategyAttempts).toBeUndefined();
  const limited = previewFc27PuzzleSquad({ ...input, maxNodes: 1000 });
  expect(limited.reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  expect(limited.nodes).toBeLessThanOrEqual(1000); expect(limited).not.toHaveProperty('deficits');
});

it('does not report an impossible squad when the per-combination placement allocation was truncated', () => {
  const input = puzzleFillFixture();
  input.evaluateSquad = () => ({ status: 'observed', chemistry: 0, teamRating: 60 });
  const result = previewFc27PuzzleSquad(input);
  expect(result.reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  expect(result.nodes).toBeLessThan(50000);
  expect(result).not.toHaveProperty('deficits');
});
