import { expect, it } from 'vitest';
import { prepareFc27PuzzleConceptPlan } from '../../src/fc27/puzzle-concept-plan.js';

const challenge = { setId: 19, id: 44, slotCount: 4, brickIndices: [1] };

it('projects owned and missing cards into one slot-preserving concept plan', () => {
  const result = prepareFc27PuzzleConceptPlan({ challenge, plan: {
    status: 'preview', setId: 19, challengeId: 44, purchaseCount: 1,
    selectedOwned: [{ id: 11, definitionId: 101, pile: 'club', rating: 62, slot: 0 },
      { id: 12, definitionId: 102, pile: 'club', rating: 63, slot: 2 }],
    purchases: [{ catalogRef: 'fc27:103', definitionId: 103, rating: 64, slot: 3,
      quantity: 1, estimatedUnitPrice: 500, observedBuyNow: 500 }],
  } });
  expect(result).toMatchObject({ status: 'prepared', kind: 'puzzle-concept', required: 3,
    purchaseCount: 1, estimatedCost: 500 });
  expect(result.slots).toEqual([
    { slot: 0, kind: 'owned', definitionId: 101, rating: 62, id: 11, pile: 'club' },
    null,
    { slot: 2, kind: 'owned', definitionId: 102, rating: 63, id: 12, pile: 'club' },
    { slot: 3, kind: 'concept', definitionId: 103, rating: 64, catalogRef: 'fc27:103', quantity: 1,
      estimatedUnitPrice: 500, observedBuyNow: 500 },
  ]);
});

it('rejects market entries without a stable catalog reference or with duplicate definitions', () => {
  expect(prepareFc27PuzzleConceptPlan({ challenge, plan: { status: 'preview', setId: 19, challengeId: 44, purchaseCount: 1,
    selectedOwned: [{ id: 11, definitionId: 101, pile: 'club', rating: 62, slot: 0 },
      { id: 12, definitionId: 102, pile: 'club', rating: 63, slot: 2 }],
    purchases: [{ definitionId: 101, rating: 64, slot: 3 }],
  } }).reason).toBe('FC27_PUZZLE_CONCEPT_PLAN_INVALID');
});

it('rejects a market plan that silently omits a non-brick slot', () => {
  expect(prepareFc27PuzzleConceptPlan({ challenge, plan: { status: 'preview', setId: 19, challengeId: 44, purchaseCount: 0,
    selectedOwned: [{ id: 11, definitionId: 101, pile: 'club', rating: 62, slot: 0 }], purchases: [],
  } }).reason).toBe('FC27_PUZZLE_CONCEPT_PLAN_INVALID');
});

it.each([
  { id: 0 }, { id: undefined }, { pile: 'storage' }, { catalogRef: 'fc27:101' },
])('rejects an invalid owned ref %j instead of treating it as a concept', patch => {
  const result = prepareFc27PuzzleConceptPlan({ challenge: { ...challenge, slotCount: 1, brickIndices: [] },
    plan: { status: 'preview', setId: 19, challengeId: 44, selectedOwned: [
      { id: 11, definitionId: 101, pile: 'club', rating: 62, slot: 0, ...patch },
    ], purchases: [], purchaseCount: 0 } });
  expect(result.status).toBe('blocked');
});

it.each([{ id: 101 }, { quantity: 2 }, { observedBuyNow: -1 }, { catalogRef: 'fc26:101' }])(
  'rejects an invalid concept ref %j', patch => {
    const result = prepareFc27PuzzleConceptPlan({ challenge: { ...challenge, slotCount: 1, brickIndices: [] },
      plan: { status: 'preview', setId: 19, challengeId: 44, selectedOwned: [], purchases: [
        { catalogRef: 'fc27:101', definitionId: 101, rating: 62, slot: 0, quantity: 1, observedBuyNow: 500, ...patch },
      ], purchaseCount: 1 } });
    expect(result.status).toBe('blocked');
  });

it('rejects a plan for a different Challenge', () => {
  expect(prepareFc27PuzzleConceptPlan({ challenge, plan: { status: 'preview', setId: 19, challengeId: 43 } }).status).toBe('blocked');
});
