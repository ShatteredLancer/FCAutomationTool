import { expect, it } from 'vitest';
import { prepareFc27PuzzleFillPlan, validateFc27PuzzleFillPlan } from '../../src/fc27/puzzle-fill-plan.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

function upgradeFixture() {
  const input = puzzleFillFixture();
  Object.assign(input.challenge, { setId: 163, id: 266, rawRequirements: [marketRow(18, 3, 1), marketRow(19, 81)] });
  input.policy.maxRating = 82;
  input.inventory.items.forEach(item => { item.rating = 81; });
  const totw = { ...input.inventory.items.pop(), rarity: 3, special: true, pile: 'storage' };
  const card = (id, details) => ({ ...totw, id, definitionId: 100 + id, ...details });
  input.inventory.items.push(totw, card(12, {}), card(13, { rarity: 5 }), card(14, { locked: true }),
    card(15, { activeSquad: true }), card(16, { rating: 83 }), card(17, { evolution: true }),
    card(18, { special: null }), card(19, { tradeable: true }), card(20, { protected: true }));
  return { input, totw };
}

it('163/266 fills 11 players at 81 with exactly one eligible owned TOTW, and verifies fresh and saved cards', () => {
  const { input } = upgradeFixture();
  const preview = previewFc27PuzzleSquad(input);
  expect(preview, JSON.stringify(preview)).toMatchObject({ status: 'preview', required: 11, teamFacts: { teamRating: 81 } });
  const plan = prepareFc27PuzzleFillPlan(input, preview);
  expect(plan).toMatchObject({ status: 'prepared', executable: false });
  expect(plan.items.filter(card => card.special).map(card => card.id)).toEqual([11]);
  const fresh = plan.items.map(({ protected: _local, ...item }) => item);
  expect(validateFc27PuzzleFillPlan(plan, input, fresh)).toMatchObject({ status: 'verified' });
  const saved = plan.selected.map(ref => ({ ...fresh.find(item => item.id === ref.id), slot: ref.slot }));
  expect(validateFc27PuzzleFillPlan(plan, input, saved, { saved: true })).toMatchObject({ status: 'verified' });
  const totw = saved.find(item => item.id === 11);
  totw.rarity = 5;
  expect(validateFc27PuzzleFillPlan(plan, input, saved, { saved: true }).reason).toBe('FC27_EXACT_ITEMS_CHANGED');
});

it('leaves other specials and malformed rarity requirements blocked; accepts EA min scope without relaxing own cap', () => {
  const { input, totw } = upgradeFixture();
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, 11);
  expect(parsed.status).toBe('observed');
  expect(parsed.rules[0]).toMatchObject({ kind: 'totw', count: 1, mode: 'min' });
  expect(matchFc27SbcRequirements({ requirements: parsed.rules, squad: [...input.inventory.items.slice(0, 9), totw,
    input.inventory.items[11]], teamRating: 81 }).status).toBe('satisfied');
  const picked = [...input.inventory.items.slice(0, 9), totw, input.inventory.items[11]];
  const forged = { status: 'preview', setId: 163, challengeId: 266, required: 11,
    selected: picked.map(({ id, definitionId, pile, rating }, slot) => ({ id, definitionId, pile, rating, slot })) };
  expect(prepareFc27PuzzleFillPlan(input, forged).status).toBe('blocked');
  for (const row of [marketRow(18, 3, 2), marketRow(18, 5, 1), marketRow(18, 3, 1, 1),
    { count: 1, scope: 0, pairs: [{ key: 18, values: [3, 5] }] }]) {
    expect(parseFc27SbcRequirements([row], 11).status).toBe('unsupported');
  }
  input.challenge.rawRequirements = [marketRow(19, 81)];
  expect(previewFc27PuzzleSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
});

it('reports the protected TOTW shortage without using a different special or raising the configured rating cap', () => {
  const { input } = upgradeFixture();
  input.inventory.items[10].locked = true;
  input.inventory.items[11].activeSquad = true;
  expect(previewFc27PuzzleSquad(input)).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_TOTW_REQUIRED' });
});

it('does not assume normal chemistry for TOTW or infer a missing rating flag', () => {
  const { input } = upgradeFixture();
  input.challenge.rawRequirements.push(marketRow(35, 18));
  expect(previewFc27PuzzleSquad(input).reason).toBe('FC27_PUZZLE_TOTW_FACTS_UNSUPPORTED');
  input.challenge.rawRequirements.pop();
  delete input.chemistry.rating.floatCalculationEnabled;
  expect(previewFc27PuzzleSquad(input)).toMatchObject({ status: 'blocked', evaluatorReason: 'FC27_PUZZLE_RATING_CONFIG_UNAVAILABLE' });
});

it('163/266 reaches rating 81 despite 90 lower-rated cards and does not need the higher-rated normal cards', () => {
  const { input } = upgradeFixture(), base = input.inventory.items[0];
  input.inventory.items.push(...Array.from({ length: 95 }, (_, i) => ({
    ...base, id: 500 + i, definitionId: 600 + i, rating: i < 90 ? 75 + i % 5 : 82,
  })));
  const preview = previewFc27PuzzleSquad(input);
  expect(preview, JSON.stringify(preview)).toMatchObject({ status: 'preview', teamFacts: { teamRating: 81 } });
  expect(preview.selected.map(card => card.rating)).toEqual(Array(11).fill(81));
  expect(preview.nodes).toBeLessThan(100);
});

it('accepts native-valid higher quality but still rejects an explicit native gold maximum', () => {
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
  expect(prepareFc27PuzzleFillPlan(input, preview).status).toBe('prepared');
  input.challenge.rawRequirements.push({count:2,scope:1,pairs:[{key:17,values:[3]}]});
  expect(prepareFc27PuzzleFillPlan(input, preview).status).toBe('blocked');
});

function fixture() {
  const input = puzzleFillFixture();
  const preview = previewFc27PuzzleSquad(input);
  const plan = prepareFc27PuzzleFillPlan(input, preview);
  const fresh = structuredClone(input.inventory.items);
  return { input, preview, plan, fresh };
}

it('preserves Storage refs through exact validation and refuses pile drift or external piles', () => {
  const input = puzzleFillFixture();
  input.inventory.items[0].pile = 'storage';
  const preview = previewFc27PuzzleSquad(input);
  const plan = prepareFc27PuzzleFillPlan(input, preview);
  expect(plan.status).toBe('prepared');
  expect(plan.selected.some(ref => ref.pile === 'storage')).toBe(true);
  const fresh = structuredClone(input.inventory.items);
  expect(validateFc27PuzzleFillPlan(plan, input, fresh).status).toBe('verified');
  fresh[0].pile = 'club';
  expect(validateFc27PuzzleFillPlan(plan, input, fresh).reason).toBe('FC27_EXACT_ITEMS_CHANGED');
  input.inventory.items[0].pile = 'transfer';
  expect(prepareFc27PuzzleFillPlan(input, preview).status).toBe('blocked');
});

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

it('rejects a newly protected member before save without replacing the frozen selection', () => {
  const x = fixture();
  x.input.policy.lockedItemIds = []; x.input.policy.activeSquadItemIds = [];
  const protectedPlan = prepareFc27PuzzleFillPlan(x.input, x.preview);
  expect(protectedPlan.status).toBe('prepared');
  x.input.policy.activeSquadItemIds = [protectedPlan.selected[0].id];
  expect(validateFc27PuzzleFillPlan(protectedPlan, x.input, x.fresh).reason)
    .toBe('FC27_PUZZLE_FILL_INPUTS_CHANGED');
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

it('honours FSU Only Untradeable=false through preview and fresh fill validation', () => {
  const input = puzzleFillFixture();
  input.policy.onlyUntradeable = false;
  input.inventory.items.forEach(item => { item.tradeable = true; });
  const preview = previewFc27PuzzleSquad(input);
  expect(preview.status).toBe('preview');
  const plan = prepareFc27PuzzleFillPlan(input, preview);
  expect(plan.status).toBe('prepared');
  expect(validateFc27PuzzleFillPlan(plan, input, structuredClone(input.inventory.items)).status).toBe('verified');
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
