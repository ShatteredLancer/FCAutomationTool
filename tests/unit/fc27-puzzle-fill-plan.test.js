import { expect, it } from 'vitest';
import { prepareFc27PuzzleFillPlan, validateFc27PuzzleFillPlan } from '../../src/fc27/puzzle-fill-plan.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';

it('rejects excess gold even when EA minimum-quality requirements are satisfied', () => {
  const input = puzzleFillFixture(); input.policy.maxRating = 82;
  input.challenge.rawRequirements = [
    { count: -1, scope: 0, pairs: [{ key: 3, values: [2] }] },
    { count: 2, scope: 0, pairs: [{ key: 17, values: [3] }] },
  ];
  input.inventory.items.forEach((item, i) => { item.rating = i < 2 ? 80 : 70; });
  const preview = previewFc27PuzzleSquad(input);
  expect(prepareFc27PuzzleFillPlan(input, preview).status).toBe('prepared');
  input.inventory.items[2].rating = 80;
  preview.selected.find(ref => ref.id === input.inventory.items[2].id).rating = 80;
  expect(prepareFc27PuzzleFillPlan(input, preview)).toMatchObject({
    status: 'blocked', reason: 'FC27_PUZZLE_MATERIAL_COMPOSITION_BLOCKED',
  });
});

function fixture() {
  const input = puzzleFillFixture();
  const preview = previewFc27PuzzleSquad(input);
  const plan = prepareFc27PuzzleFillPlan(input, preview);
  const fresh = structuredClone(input.inventory.items);
  return { input, preview, plan, fresh };
}

it('revalidates the fixed eleven without trusting cached preview success or exposing an execution permit', () => {
  const x = fixture();
  expect(x.plan).toMatchObject({ status: 'prepared', executable: false,
    validation: { selectedCount: 11, teamFacts: { chemistry: 33, teamRating: 60 }, requirementCount: 2 } });
  expect(Object.isFrozen(x.plan.items[0].positions)).toBe(true);
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, x.fresh)).toMatchObject({ status: 'verified', executable: false });
  const originalId = x.plan.selected[0].id;
  x.preview.selected[0].id = 999;
  x.input.inventory.items[0].rating = 99;
  expect(x.plan.selected[0].id).toBe(originalId);
  expect(x.plan.items[0].rating).toBe(60);
});

it.each(['missing', 'version', 'substitute', 'duplicate', 'position', 'nation', 'rarity', 'tradeable', 'evolution', 'protected', 'state'])
('rejects changed %s before saving even if another local solution exists', kind => {
  const x = fixture();
  if (kind === 'missing') x.fresh.pop();
  if (kind === 'version') x.fresh[0].definitionId++;
  if (kind === 'substitute') x.fresh[0].id = 900;
  if (kind === 'duplicate') x.fresh.push(x.fresh[0]);
  if (kind === 'position') x.fresh[0].positions = [7];
  if (kind === 'nation') x.fresh[0].nationId++;
  if (kind === 'rarity') x.fresh[0].rarity = 1;
  if (kind === 'tradeable') x.fresh[0].tradeable = true;
  if (kind === 'evolution') x.fresh[0].evolution = true;
  if (kind === 'protected') x.fresh[0].protected = true;
  if (kind === 'state') x.fresh[0].state = 'active';
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, x.fresh).status).toBe('blocked');
});

it.each(['context', 'challenge', 'formation', 'rules', 'policy', 'chemistry', 'links'])('rejects %s drift', kind => {
  const x = fixture();
  if (kind === 'context') x.input.context.accountScope = 'other';
  if (kind === 'challenge') x.input.challenge.id++;
  if (kind === 'formation') x.input.challenge.formation.positions[0] = 7;
  if (kind === 'rules') x.input.challenge.rawRequirements[1].pairs[0].values[0] = 33;
  if (kind === 'policy') x.input.policy.protectFsuLockedPlayers = false;
  if (kind === 'chemistry') x.input.chemistry.rating.floatCalculationEnabled = true;
  if (kind === 'links') x.input.clubLinks.links.push([2, 1]);
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, x.fresh).reason).toBe('FC27_PUZZLE_FILL_INPUTS_CHANGED');
});

it('checks exact saved positions and rejects extra bench players', () => {
  const x = fixture();
  const saved = x.fresh.map(item => ({ ...item, slot: x.plan.selected.find(ref => ref.id === item.id).slot }));
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, saved, { saved: true }).status).toBe('verified');
  [saved[0].slot, saved[1].slot] = [saved[1].slot, saved[0].slot];
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, saved, { saved: true }).status).toBe('blocked');
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, [...saved, { ...saved[0], id: 901, slot: 11 }], { saved: true }).status).toBe('blocked');
});

it.each(['slot', 'definition', 'market', 'protected', 'invalid-rating', 'brick', 'unsatisfied', 'missing-config'])
('does not prepare %s even when the preview claims success', kind => {
  const x = fixture();
  if (kind === 'slot') x.preview.selected[1].slot = 0;
  if (kind === 'definition') x.preview.selected[1].definitionId = 101;
  if (kind === 'market') x.preview.selected[0].catalogRef = 'market:101';
  if (kind === 'protected') x.input.inventory.items[0].locked = true;
  if (kind === 'invalid-rating') x.input.policy.maxRating = 100;
  if (kind === 'brick') x.input.challenge.brickIndices = [0];
  if (kind === 'unsatisfied') x.input.inventory.items.forEach(item => { item.positions = [7]; });
  if (kind === 'missing-config') delete x.input.chemistry;
  expect(prepareFc27PuzzleFillPlan(x.input, x.preview).status).toBe('blocked');
});

it.each([1, 2, 10])('prepares %i real players with explicit simple bricks and preserves their slots', count => {
  const input = puzzleFillFixture();
  input.challenge.brickIndices = Array.from({ length: 11 - count }, (_, i) => i);
  input.challenge.rawRequirements = [input.challenge.rawRequirements[0]];
  input.chemistry = null; delete input.evaluateSquad;
  input.inventory.items = input.inventory.items.slice(0, count);
  const preview = previewFc27PuzzleSquad(input);
  const plan = prepareFc27PuzzleFillPlan(input, preview);
  expect(plan).toMatchObject({ status: 'prepared', validation: { selectedCount: count } });
  const saved = plan.items.map((item, i) => ({ ...item, slot: preview.selected[i].slot }));
  expect(validateFc27PuzzleFillPlan(plan, input, saved, { saved: true }).status).toBe('verified');
  saved[0].slot = 0;
  expect(validateFc27PuzzleFillPlan(plan, input, saved, { saved: true }).status).toBe('blocked');
});

it('uses the explicit rating policy for ordinary gold without raising it when materials are missing', () => {
  const input = puzzleFillFixture();
  input.challenge.rawRequirements[0].pairs[0].values = [3];
  input.inventory.items.forEach(item => { item.rating = 80; });
  expect(previewFc27PuzzleSquad(input).status).toBe('blocked');
  input.policy.maxRating = 83;
  const plan = prepareFc27PuzzleFillPlan(input, previewFc27PuzzleSquad(input));
  expect(plan.status).toBe('prepared');
  input.policy.maxRating = 79;
  expect(validateFc27PuzzleFillPlan(plan, input, input.inventory.items).status).toBe('blocked');
});

it('accepts a fresh same-definition alternate only as extra evidence, never as a replacement', () => {
  const x = fixture(); x.fresh.push({ ...x.fresh[0], id: 999 });
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, x.fresh).status).toBe('verified');
  x.fresh.shift();
  expect(validateFc27PuzzleFillPlan(x.plan, x.input, x.fresh).status).toBe('blocked');
});

it('keeps local protection separate from the server projection and exports only aggregate verification', () => {
  const x = fixture(); x.fresh.forEach(item => { item.protected = null; });
  const result = validateFc27PuzzleFillPlan(x.plan, x.input, x.fresh);
  expect(result.status).toBe('verified');
  expect(JSON.stringify(result)).not.toMatch(/accountScope|definitionId|"selected":|positions/);
});
