import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { boundFc27PuzzleChemistry, evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';
import { matchFc27SbcRequirements, parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

// Same requirement shape as Set 65/Challenge 105, with synthetic safe cards.
// The diagnostic exported counts rather than player identities, so this is
// a bounded-search regression, not a replay of the user's live inventory.
it('finds a high-chemistry 5-silver/6-gold squad under a four-per-league cap', () => {
  const input = puzzleFillFixture();
  input.policy.maxRating = 82;
  input.challenge.formation.positions = [5, 7, 9, 11, 12, 13, 14, 15, 16, 17, 18];
  input.challenge.rawRequirements = [
    marketRow(5, 4, -1, 1), // Same league: max 4.
    marketRow(4, 3), // Same nation: min 3.
    marketRow(8, 3), // Distinct leagues: min 3.
    marketRow(3, 2), // Minimum silver.
    marketRow(17, 3, 6), // Gold: min 6.
    marketRow(35, 22), // Chemistry: min 22.
  ];
  const base = input.inventory.items[0];
  input.inventory.items = Array.from({ length: 123 }, (_, index) => ({
    ...base, id: index + 1, definitionId: index + 1001,
    rating: index % 2 ? 70 : 78,
    leagueId: index < 90 ? 1 : 2 + Math.floor((index - 90) / 11),
    nationId: 1, teamId: index < 90 ? 1 : 2 + Math.floor((index - 90) / 11),
    positions: [index < 90 ? 0 : input.challenge.formation.positions[(index - 90) % 11]],
  }));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad,
    formation: input.challenge.formation, chemistry: input.chemistry, rating: input.chemistry.rating });
  const known = [
    ...input.inventory.items.slice(90, 94),
    ...input.inventory.items.slice(105, 109),
    ...input.inventory.items.slice(120, 123),
  ];
  const facts = evaluateFc27PuzzleSquad({ squad: known.map((item, slot) => ({ ...item, slot })),
    formation: input.challenge.formation, chemistry: input.chemistry, rating: input.chemistry.rating });
  expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules,
    squad: known, chemistry: facts.chemistry }).status).toBe('satisfied');

  const result = previewFc27PuzzleSquad(input);
  expect(result.status, JSON.stringify({ reason: result.reason, search: result.search })).toBe('preview');
  expect(result.teamFacts.chemistry).toBeGreaterThanOrEqual(22);
  expect(result.selected.filter(item => item.rating < 75)).toHaveLength(5);
  expect(result.selected.filter(item => item.rating >= 75)).toHaveLength(6);
  expect(result.nodes).toBeLessThan(50000);
}, 30000);

it('reaches a legal 22-chemistry squad behind same-slot decoys before the 50000-node cap', () => {
  const input = puzzleFillFixture();
  input.policy.maxRating = 82;
  input.challenge.formation.positions = [5, 7, 9, 11, 12, 13, 14, 15, 16, 17, 18];
  input.challenge.rawRequirements = [marketRow(5, 4, -1, 1), marketRow(4, 3), marketRow(8, 3),
    marketRow(3, 2), marketRow(17, 3, 6), marketRow(35, 22)];
  const base = input.inventory.items[0];
  input.inventory.items = Array.from({ length: 123 }, (_, index) => ({ ...base,
    id: index + 1, definitionId: index + 1001, rating: index < 112 ? index % 2 ? 70 : 78 : index - 112 < 5 ? 70 : 78,
    leagueId: index < 112 ? 1 : 2 + Math.floor((index - 112) / 4),
    nationId: index < 112 ? 1 : 2 + Math.floor((index - 112) / 3),
    teamId: index < 112 ? 1 : 100 + index,
    positions: index < 112 ? [5] : [input.challenge.formation.positions[index - 112]],
  }));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad,
    formation: input.challenge.formation, chemistry: input.chemistry, rating: input.chemistry.rating });
  const known = input.inventory.items.slice(112);
  const knownFacts = evaluateFc27PuzzleSquad({ squad: known.map((item, slot) => ({ ...item, slot })),
    formation: input.challenge.formation, chemistry: input.chemistry, rating: input.chemistry.rating });
  expect(knownFacts.chemistry).toBe(22);
  expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules,
    squad: known, chemistry: knownFacts.chemistry }).status).toBe('satisfied');

  const result = previewFc27PuzzleSquad(input);
  expect(result.status, JSON.stringify({ reason: result.reason, search: result.search })).toBe('preview');
  expect(result.teamFacts.chemistry).toBeGreaterThanOrEqual(22);
  expect(result.nodes).toBeLessThan(50000);
}, 30000);
