import { expect, it } from 'vitest';
import { puzzleGroupCapacityFixture as largePool } from '../helpers/fc27-puzzle-group-capacity-fixture.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';
import { matchFc27SbcRequirements, parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { createPuzzleGroupCapacity } from '../../src/fc27/puzzle-group-capacity.js';
import { suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';


it('reaches a native-valid squad in a 291-card pool within the original inventory budget', () => {
  const { input, known } = largePool(), before = structuredClone(input.inventory);
  const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules;
  const witness = evaluateFc27PuzzleSquad({ squad: known, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  expect(matchFc27SbcRequirements({ requirements: rules, squad: known, ...witness, clubLinks: input.clubLinks }).status).toBe('satisfied');
  const result = previewFc27PuzzleSquad({ ...input, maxNodes: 50000 });
  expect(result.status, JSON.stringify({ reason: result.reason, nodes: result.nodes, search: result.search })).toBe('preview');
  expect(result.nodes).toBeLessThanOrEqual(50000);
  const selected = result.selected.map(ref => ({ ...input.inventory.items.find(item => item.id === ref.id), slot: ref.slot }));
  const facts = evaluateFc27PuzzleSquad({ squad: selected, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  expect(matchFc27SbcRequirements({ requirements: rules, squad: selected, ...facts, clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(input.inventory).toEqual(before);
});

it.each(['additional-coins', 'material-value'])('retains an affordable fully verified owned/market mix for %s', objective => {
  const { input, known } = largePool();
  const missing = new Set(known.filter(item => item.teamId === 70).map(item => item.definitionId));
  input.inventory.items = input.inventory.items.filter(item => !missing.has(item.definitionId));
  const entries = known.filter(item => missing.has(item.definitionId)).map(({ definitionId, rating, nationId, teamId, leagueId, positions, rarity }) =>
    ({ definitionId, rating, nationId, teamId, leagueId, positions, rarity, special: false, cosmetic: false, evolution: false, groups: [] }));
  const result = suggestFc27PuzzleJointPurchases(input, entries, { maxNodes: 50000,
    prices: new Map(entries.map(item => [item.definitionId, 200])), priceSource: 'futbin',
    ...(objective === 'material-value' ? { materialPrices: new Map(input.inventory.items.map(item => [item.definitionId, 200])) } : {}) });
  expect(result.status, JSON.stringify({ reason: result.reason, search: result.search })).toBe('suggested');
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(result.estimatedCost).toBeLessThanOrEqual(800);
  if (objective === 'material-value') expect(result.materialValue).toBeLessThanOrEqual(2200);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(26);
  expect(result.plans[0].teamFacts.teamRating).toBeGreaterThanOrEqual(75);
  const plan = result.plans[0], squad = Array(11);
  for (const ref of plan.selectedOwned) squad[ref.slot] = { ...input.inventory.items.find(item => item.id === ref.id), slot: ref.slot };
  for (const item of plan.purchases) squad[item.slot] = item;
  const facts = evaluateFc27PuzzleSquad({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules,
    squad, ...facts, clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(result.executable).toBe(false);
});

it('accepts the other OR club without hardcoding a preferred club or forcing the first club', () => {
  const { input } = largePool();
  for (const item of input.inventory.items) if (item.teamId === 240) item.teamId = 241;
  const result = previewFc27PuzzleSquad(input);
  expect(result.status).toBe('preview');
  expect(result.teamFacts.chemistry).toBeGreaterThanOrEqual(26);
});

it.each(['locked', 'activeSquad'])('does not restore a %s member of an otherwise complete backbone', flag => {
  const { input, known } = largePool();
  const definitions = new Set(known.map(item => item.definitionId));
  input.inventory.items = input.inventory.items.filter(item => definitions.has(item.definitionId));
  input.inventory.items[0][flag] = true;
  const result = previewFc27PuzzleSquad(input);
  expect(result.status).toBe('blocked');
  expect(result.reason).toBe('SAFE_MATERIAL_SHORTAGE');
});

const minimum = { kind: 'same-club', mode: 'min', value: 4 };
const cap = { kind: 'same-nation', mode: 'max', value: 3 };
const resolveClub = id => id === 101 ? 1 : id;
it('does not count a fifth same-country card towards four club members under a national cap', () => {
  const candidates = Array.from({ length: 5 }, (_, i) => ({ definitionId: i + 1, teamId: 1, nationId: 1, leagueId: 1 }));
  const [bound] = createPuzzleGroupCapacity({ rules: [minimum, cap], candidates, resolveClub });
  expect(bound.matches).toEqual(Array(5).fill(false));
  expect(bound.canReach([], 0, 4)).toBe(false);
  candidates[4].nationId = 2;
  const [mixed] = createPuzzleGroupCapacity({ rules: [minimum, cap], candidates, resolveClub });
  expect(mixed.canReach([], 0, 4)).toBe(true);
  expect(mixed.canReach([candidates[4]], 5, 3)).toBe(false);
});

it('accounts for the nationality capacity already consumed by other clubs and linked club IDs', () => {
  const candidates = [
    { definitionId: 1, teamId: 2, nationId: 1 },
    ...Array.from({ length: 4 }, (_, i) => ({ definitionId: i + 2, teamId: i % 2 ? 101 : 1, nationId: i < 3 ? 1 : 2 })),
  ];
  const [bound] = createPuzzleGroupCapacity({ rules: [minimum, cap], candidates, resolveClub });
  expect(bound.canReach([], 0, 4)).toBe(true);
  expect(bound.canReach(candidates.slice(0, 1), 1, 4)).toBe(false);
});

function combinations(length, count, start = 0, chosen = []) {
  if (!count) return [chosen];
  return Array.from({ length: Math.max(0, length - count - start + 1) }, (_, offset) => start + offset)
    .flatMap(index => combinations(length, count - 1, index + 1, [...chosen, index]));
}

it.each(['min', 'exact'])('never prunes an independently valid completion with %s group counts, copies and sparse suffixes', mode => {
  const rules = [{ kind: 'same-club', mode, value: 3 }, { kind: 'same-nation', mode: 'max', value: 2 },
    { kind: 'same-league', mode: 'exact', value: 3 }].map(rule => ({ ...rule, source: { required: 5 } }));
  let valid = 0;
  for (let seed = 0; seed < 16; seed++) {
    const candidates = Array.from({ length: 9 }, (_, i) => ({ definitionId: i === 8 ? 1 : i + 1,
      teamId: i % 3 === 0 ? 101 : 1 + (i + seed) % 3,
      nationId: 1 + (i * 3 + seed) % 4, leagueId: 1 + (i + seed) % 2 }));
    const before = structuredClone(candidates), bounds = createPuzzleGroupCapacity({ rules, candidates, resolveClub });
    for (const indices of combinations(candidates.length, 5)) {
      const squad = indices.map(i => candidates[i]);
      if (new Set(squad.map(item => item.definitionId)).size !== squad.length) continue;
      if (matchFc27SbcRequirements({ requirements: rules, squad, clubLinks: { schema: 1, complete: true, links: [[101, 1]] } }).status !== 'satisfied') continue;
      valid++;
      for (let depth = 0; depth <= indices.length; depth++) for (const bound of bounds) {
        expect(bound.canReach(squad.slice(0, depth), depth ? indices[depth - 1] + 1 : 0, indices.length - depth)).toBe(true);
        expect(indices.filter(index => bound.matches[index]).length).toBeGreaterThanOrEqual(bound.rule.value);
      }
    }
    expect(candidates).toEqual(before);
  }
  expect(valid).toBeGreaterThan(100);
});

it('leaves unknown identities and rules without a cross-group cap to the original validator', () => {
  const candidates = [{ definitionId: 1, teamId: 1, nationId: null }];
  expect(createPuzzleGroupCapacity({ rules: [minimum, cap], candidates, resolveClub })).toEqual([]);
  expect(createPuzzleGroupCapacity({ rules: [minimum], candidates, resolveClub })).toEqual([]);
});
