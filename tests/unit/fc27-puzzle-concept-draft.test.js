import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { prepareFc27PuzzleConceptDraft, validateFc27PuzzleConceptDraft } from '../../src/fc27/puzzle-concept-draft.js';

function fixture() {
  const input = puzzleFillFixture();
  const missing = input.inventory.items.pop();
  const purchase = { definitionId: 901, catalogRef: 'fc27:901', rating: missing.rating,
    rarity: missing.rarity, nationId: missing.nationId, leagueId: missing.leagueId, teamId: missing.teamId,
    positions: missing.positions, groups: missing.groups, special: false, evolution: false, cosmetic: false,
    type: 'player', concept: false, academyEnrolled: false, slot: 10, quantity: 1, observedBuyNow: 500 };
  const suggestion = { selectedOwned: input.inventory.items.map((item, slot) => ({ id: item.id,
    definitionId: item.definitionId, rating: item.rating, pile: 'club', slot })), purchases: [purchase], purchaseCount: 1 };
  return { input, suggestion };
}

it('validates a mixed draft without fabricating owned identities or weakening Only Untradeable', () => {
  const { input, suggestion } = fixture();
  const plan = prepareFc27PuzzleConceptDraft(input, suggestion);
  expect(plan).toMatchObject({ status: 'prepared', kind: 'puzzle-concept-draft', validation: { status: 'verified' } });
  expect(plan.slots[10]).not.toHaveProperty('id');
  expect(input.policy.onlyUntradeable).toBe(true);
  expect(validateFc27PuzzleConceptDraft(plan, input, input.inventory.items).status).toBe('verified');
});

it.each(['tradeable', 'protected', 'evolution', 'locked'])('rejects protected owned material: %s', field => {
  const { input, suggestion } = fixture(); input.inventory.items[0][field] = true;
  expect(prepareFc27PuzzleConceptDraft(input, suggestion).status).toBe('blocked');
});

it.each(['rating', 'positions', 'special', 'definitionId'])('rejects changed catalog evidence: %s', field => {
  const { input, suggestion } = fixture();
  if (field === 'rating') suggestion.purchases[0].rating = 88;
  if (field === 'positions') suggestion.purchases[0].positions = [];
  if (field === 'special') suggestion.purchases[0].special = true;
  if (field === 'definitionId') suggestion.purchases[0].definitionId = input.inventory.items[0].definitionId;
  expect(prepareFc27PuzzleConceptDraft(input, suggestion).status).toBe('blocked');
});

it('rechecks the exact identities and original conditions after the fresh Club read', () => {
  const { input, suggestion } = fixture(); const plan = prepareFc27PuzzleConceptDraft(input, suggestion);
  const fresh = structuredClone(input.inventory.items); fresh[0].id = 999;
  expect(validateFc27PuzzleConceptDraft(plan, input, fresh).status).toBe('blocked');
  input.challenge.rawRequirements[1].pairs[0].values = [33];
  expect(validateFc27PuzzleConceptDraft(plan, input, input.inventory.items).status).toBe('blocked');
});
