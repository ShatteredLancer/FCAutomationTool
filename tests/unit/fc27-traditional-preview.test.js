import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { previewTraditionalSquad } from '../../src/fc27/traditional-preview.js';

const ui = JSON.parse(readFileSync(new URL('../fixtures/fc27-a-brace-ui.json', import.meta.url), 'utf8'));
function fixture() {
  const context = { season: '27', accountScope: 'synthetic-test', platform: 'pc' };
  const item = (id, rating) => ({ id, definitionId: id + 100, rating, type: 'player', pile: 'club',
    special: false, evolution: false, cosmetic: false, concept: false, academyEnrolled: false,
    activeTrade: false, limitedUse: false, loans: -1, protected: false, tradeable: false,
    leagueId: 1, locked: false, activeSquad: false });
  return { context, challenge: { context, schema: 1, mechanism: 'traditional', id: 2, setId: 1,
    requirementsOperation: 'AND',
    completed: false, slotCount: 11, brickIndices: [0, 1, 2, 3, 4, 5, 6, 9, 10],
    requirements: [{ kind: 'player-count', count: ui.playerCount },
      { kind: 'player-min-overall', value: ui.minimumOverall, count: ui.playerCount },
      { kind: 'player-max-overall', value: ui.maximumOverall, count: ui.playerCount }] },
  inventory: { context, schema: 1, kind: 'normalized-inventory', status: 'provisional',
    items: [item(1, 74), item(2, 65), item(3, 75), item(4, 64)] },
  policy: { context, schema: 1, reviewed: true, maxRating: 74, onlyUntradeable: true,
    goldRange: [75, 82],
    protectFsuLockedPlayers: true, protectActiveSquad: true, storageFirst: true, excludedLeagueIds: [] } };
}
it('uses the screenshot only for visible rules, never as a runtime identity fixture', () => {
  expect(ui.runtimeContractVerified).toBe(false);
  expect(ui.challengeId).toBeNull();
  const input = fixture();
  input.challenge.id = ui.challengeId;
  expect(previewTraditionalSquad(input).reason).toBe('CHALLENGE_UNVERIFIED');
});
it('plans exactly two 65-74 players in the two unbricked slots without changing inputs', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = previewTraditionalSquad(input);
  expect(result).toMatchObject({ status: 'preview', liveExecutionEnabled: false, required: 2, excluded: 2 });
  expect(result.selected.map(item => [item.id, item.slot])).toEqual([[2, 7], [1, 8]]);
  expect(input).toEqual(before);
});
it.each(['special', 'evolution', 'cosmetic', 'concept', 'academyEnrolled', 'activeTrade',
  'limitedUse', 'protected', 'tradeable', 'locked', 'activeSquad'])('keeps %s protection', field => {
  const input = fixture();
  input.inventory.items[0][field] = true;
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
  input.inventory.items[0][field] = null;
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
});
it('does not resolve duplicate signals or select duplicate definitions', () => {
  const input = fixture();
  input.inventory.items[0].definitionId = input.inventory.items[1].definitionId;
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
  input.inventory.items[0].definitionId = 500;
  input.inventory.items[0].pile = 'unassigned';
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
});
it('rejects missing safety facts, unknown requirements, and unverified layout', () => {
  const unknown = fixture();
  delete unknown.inventory.items[0].loans;
  expect(previewTraditionalSquad(unknown).reason).toBe('SAFE_MATERIAL_SHORTAGE');
  const rules = fixture();
  rules.challenge.requirements.push({ kind: 'chemistry', count: 2, value: 1 });
  expect(previewTraditionalSquad(rules).reason).toBe('UNSUPPORTED_REQUIREMENT');
  const layout = fixture();
  layout.challenge.brickIndices = [];
  expect(previewTraditionalSquad(layout).reason).toBe('SLOT_LAYOUT_UNVERIFIED');
});
it('honors reviewed policy, league exclusions and maximum rating', () => {
  const input = fixture();
  input.policy.reviewed = false;
  expect(previewTraditionalSquad(input).reason).toBe('PROTECTION_POLICY_UNVERIFIED');
  input.policy.reviewed = true;
  input.policy.excludedLeagueIds = [1];
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
  input.policy.excludedLeagueIds = [];
  input.policy.maxRating = 73;
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
});
it('applies FSU Golden Player Range only to gold players and respects opt-in submission guards', () => {
  const input = fixture();
  input.policy.goldRange = [80, 82];
  expect(previewTraditionalSquad(input).status).toBe('preview');
  input.inventory.items[0].locked = true;
  input.inventory.items[0].activeSquad = true;
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
  input.policy.protectFsuLockedPlayers = false;
  input.policy.protectActiveSquad = false;
  expect(previewTraditionalSquad(input).status).toBe('preview');
  input.policy.maxRating = 90;
  input.challenge.requirements[2].value = 90;
  input.inventory.items[0].rating = 83;
  expect(previewTraditionalSquad(input).reason).toBe('SAFE_MATERIAL_SHORTAGE');
});
it('rejects mixed scope, observation samples, completed challenges and conflicting IDs', () => {
  const input = fixture();
  input.inventory.context = { ...input.context, accountScope: 'other' };
  expect(previewTraditionalSquad(input).reason).toBe('CONTEXT_MISMATCH');
  input.inventory.context = input.context;
  input.inventory.kind = 'passive-sample';
  expect(previewTraditionalSquad(input).reason).toBe('INVENTORY_UNVERIFIED');
  input.inventory.kind = 'normalized-inventory';
  input.inventory.items[1].id = input.inventory.items[0].id;
  expect(previewTraditionalSquad(input).reason).toBe('INVENTORY_IDENTITY_CONFLICT');
  input.challenge.completed = true;
  expect(previewTraditionalSquad(input).reason).toBe('CHALLENGE_UNVERIFIED');
});
