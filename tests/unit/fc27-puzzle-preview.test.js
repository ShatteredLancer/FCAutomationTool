import { expect, it, vi } from 'vitest';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { build } from 'esbuild';
import { evaluateFc27PuzzleSquad, boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';

const row = (key, value, count = -1, scope = 0) => ({ count, scope, pairs: [{ key, values: [value] }] });

it.each([[7, 'nationId'], [8, 'leagueId'], [9, 'teamId']])(
  'prunes insufficient remaining group capacity for key %i without exhausting the budget', (key, field) => {
    const input = fixture(); input.challenge.slotCount = 11;
    input.challenge.rawRequirements = [row(key, 3, -1, 1)];
    const base = input.inventory.items[0];
    // Many isolated low-rated cards precede three groups that can fill eleven.
    input.inventory.items = Array.from({ length: 52 }, (_, i) => ({ ...base,
      id: i + 1, definitionId: i + 101, rating: 50 + Math.floor(i / 10),
      [field]: i < 40 ? i + 1 : 100 + Math.floor((i - 40) / 4) }));
    const result = previewFc27PuzzleSquad({ ...input, maxNodes: 5000 });
    expect(result.status).toBe('preview');
    expect(result.selected).toHaveLength(11);
    expect(result.selected.every(item => item.id > 40)).toBe(true);
    expect(result.nodes).toBeLessThan(5000);
  });

it.each([1, 2])('proves insufficient max/exact club capacity with scope %i before placement', scope => {
  const input = fixture(); input.challenge.slotCount = 11;
  input.challenge.rawRequirements = [row(9, 4, -1, scope)];
  input.inventory.items = Array.from({ length: 23 }, (_, i) => ({ ...input.inventory.items[0],
    id: i + 1, definitionId: 101 + i, teamId: Math.floor(i / 2) + 1 }));
  expect(previewFc27PuzzleSquad({ ...input, maxNodes: 100 })).toMatchObject({
    reason: 'FC27_PUZZLE_NO_PLAN_FOUND', nodes: 1,
  });
});

it('agrees with exhaustive small-pool feasibility across group modes and duplicate definitions', () => {
  for (let sample = 0; sample < 36; sample++) {
    const input = fixture(); input.challenge.slotCount = 4;
    const key = 7 + sample % 3; const scope = Math.floor(sample / 3) % 3;
    input.challenge.rawRequirements = [row(key, 1 + Math.floor(sample / 9), -1, scope)];
    input.inventory.items = Array.from({ length: 9 }, (_, i) => ({ ...input.inventory.items[0],
      id: i + 1, definitionId: 101 + (i + sample) % 7,
      nationId: 1 + i % 3, leagueId: 1 + i % 4, teamId: 1 + i % 5 }));
    const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 4).rules;
    let feasible = false;
    for (let mask = 0; mask < 512; mask++) {
      const squad = input.inventory.items.filter((_, i) => mask & (1 << i));
      if (squad.length !== 4 || new Set(squad.map(item => item.definitionId)).size !== 4) continue;
      if (matchFc27SbcRequirements({ requirements: rules, squad, clubLinks: input.clubLinks }).status === 'satisfied') feasible = true;
    }
    const result = previewFc27PuzzleSquad({ ...input, maxNodes: 10000 });
    expect(result.status === 'preview', `sample ${sample}`).toBe(feasible);
    expect(result.reason).not.toBe('FC27_PUZZLE_SEARCH_LIMIT');
  }
});

it('uses exactly two capped gold cards and silver fillers for minimum silver plus two gold', () => {
  const input = fixture(); input.policy.maxRating = 82;
  input.challenge.rawRequirements = [row(3, 2), row(17, 3, 2)];
  input.inventory.items.forEach((item, i) => { item.rating = [75, 80, 82, 70][i]; });
  const result = previewFc27PuzzleSquad(input);
  expect(result.status).toBe('preview');
  expect(result.selected.map(item => item.rating).sort((a, b) => a - b)).toEqual([70, 75, 80]);
  input.inventory.items[3].rating = 81;
  expect(previewFc27PuzzleSquad(input)).toMatchObject({ status: 'blocked', selected: [] });
});

it.each([1, 2])('keeps minimum quality %i fillers in that tier instead of upgrading for chemistry', quality => {
  const input = fixture(); input.policy.maxRating = 82;
  input.challenge.rawRequirements = [row(3, quality), row(35, 14)];
  input.inventory.items.forEach((item, i) => { item.rating = i < 3 ? (quality === 1 ? 60 : 70) : 80; });
  input.evaluateSquad = squad => ({ chemistry: squad.some(item => item.rating === 80) ? 33 : 0 });
  expect(previewFc27PuzzleSquad(input).status).toBe('blocked');
});
function fixture() {
  const context = { season: '27', accountScope: 'synthetic', platform: 'pc' };
  const player = id => ({ id, definitionId: 100 + id, type: 'player', pile: 'club', rating: 60,
    nationId: 1, teamId: id, leagueId: 1, rarity: 0, special: false, evolution: false,
    cosmetic: false, concept: false, academyEnrolled: false, activeTrade: false,
    limitedUse: false, loans: -1, protected: false, tradeable: false, locked: false, activeSquad: false });
  return { context, clubLinks: { schema: 1, complete: true, links: [] },
  challenge: { schema: 1, context, mechanism: 'traditional-puzzle', setId: 19, id: 43,
    completed: false, requirementsOperation: 'AND', slotCount: 3, brickIndices: [],
    rawRequirements: [row(17, 2, 1), row(9, 3), row(10, 7, 1)] },
  policy: { schema: 1, context, reviewed: true, maxRating: 74, goldRange: [75, 83], onlyUntradeable: true,
    protectFsuLockedPlayers: true, protectActiveSquad: true, storageFirst: true, excludedLeagueIds: [] },
  inventory: { schema: 1, context, kind: 'normalized-inventory', status: 'provisional',
    items: [player(1), player(2), { ...player(3), rating: 66, nationId: 7 }, { ...player(4), rating: 70 }] } };
}

it('creates a deterministic puzzle plan, shares existing protections and does not mutate inputs', () => {
  const input = fixture(); const before = structuredClone(input);
  const result = previewFc27PuzzleSquad(input);
  expect(result).toMatchObject({ status: 'preview', liveExecutionEnabled: false, selected: [
    { id: 1, slot: 0 }, { id: 2, slot: 1 }, { id: 3, slot: 2 }], validation: { satisfied: true } });
  expect(previewFc27PuzzleSquad(input)).toEqual(result);
  expect(input).toEqual(before);
});

it('backtracks instead of accepting the first low-rating squad that violates puzzle rules', () => {
  const input = fixture(); input.inventory.items[2].teamId = 1;
  expect(previewFc27PuzzleSquad(input).selected.map(item => item.id)).toEqual([2, 3, 4]);
});

it.each(['locked', 'activeSquad', 'evolution', 'special', 'tradeable', 'protected'])('does not relax %s to solve a puzzle', key => {
  const input = fixture(); input.inventory.items[2][key] = true;
  const result = previewFc27PuzzleSquad(input);
  expect(result.status).toBe('blocked'); expect(result.selected).toEqual([]);
  expect(result.reason).toBe('FC27_PUZZLE_CONSTRAINT_SHORTAGE');
});

it('returns bounded shortage predicates, not invented market identities or orders', () => {
  const input = fixture(); input.inventory.items[2].nationId = 1;
  const result = previewFc27PuzzleSquad(input);
  expect(result).toMatchObject({ reason: 'FC27_PUZZLE_CONSTRAINT_SHORTAGE', deficits: [
    { kind: 'from-nations', minimumMissing: 1, source: { key: 10, values: [7] } }] });
  expect(result).not.toHaveProperty('orders');
});

it('requires team evidence and distinguishes unavailable facts from an exhausted search budget', () => {
  const input = fixture(); input.challenge.rawRequirements.push(row(35, 3));
  expect(previewFc27PuzzleSquad(input).reason).toBe('FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE');
  const evaluateSquad = vi.fn(() => ({ chemistry: 3 }));
  expect(previewFc27PuzzleSquad({ ...input, evaluateSquad }).status).toBe('preview');
  expect(evaluateSquad).toHaveBeenCalled();
  expect(previewFc27PuzzleSquad({ ...input, evaluateSquad: () => ({}) }).reason)
    .toBe('FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE');
  expect(previewFc27PuzzleSquad({ ...input, evaluateSquad, maxNodes: 1 }).reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
});

it('does not reuse definitions, ignores brick slots, and exposes no partial selection on failure', () => {
  const input = fixture(); input.challenge.slotCount = 4; input.challenge.brickIndices = [1];
  expect(previewFc27PuzzleSquad(input).selected.map(item => item.slot)).toEqual([0, 2, 3]);
  input.inventory.items.forEach(item => { item.definitionId = 101; });
  const result = previewFc27PuzzleSquad(input);
  expect(result.reason).toBe('SAFE_MATERIAL_SHORTAGE'); expect(result.selected).toEqual([]);
});

it('reports missing required item fields without treating them as numeric zero', () => {
  const input = fixture(); delete input.inventory.items[2].nationId;
  expect(previewFc27PuzzleSquad(input).reason).toBe('FC27_REQUIREMENT_VALUE_UNAVAILABLE');
});

it('rejects unknown rules, invalid context, malformed layout, and excessive search limits', () => {
  const input = fixture(); input.challenge.rawRequirements.push(row(999, 1));
  expect(previewFc27PuzzleSquad(input).reason).toBe('FC27_REQUIREMENT_UNSUPPORTED');
  const other = fixture(); other.inventory.context = { ...other.context, season: '26' };
  expect(previewFc27PuzzleSquad(other).reason).toBe('CONTEXT_MISMATCH');
  expect(previewFc27PuzzleSquad({ ...fixture(), maxNodes: Infinity }).reason).toBe('FC27_PUZZLE_BUDGET_INVALID');
});

it('preserves the FSU gold range, league guards and normalized inventory readiness', () => {
  const input = fixture(); input.policy.maxRating = 90; input.policy.goldRange = [75, 83];
  input.inventory.items[2].rating = 85;
  expect(previewFc27PuzzleSquad(input).excludedByReason['fsu-gold-range']).toBe(1);
  input.inventory.status = 'partial';
  expect(previewFc27PuzzleSquad(input).reason).toBe('INVENTORY_UNVERIFIED');
  input.inventory.status = 'provisional'; input.inventory.items[3].id = input.inventory.items[0].id;
  expect(previewFc27PuzzleSquad(input).reason).toBe('INVENTORY_IDENTITY_CONFLICT');
});

it('passes only detached frozen cards at the exact proposed slots to a team evaluator', () => {
  const input = fixture(); input.challenge.rawRequirements.push(row(35, 3));
  input.challenge.slotCount = 4; input.challenge.brickIndices = [1];
  const evaluateSquad = vi.fn(squad => {
    return { chemistry: 3, privateData: 'must-not-export' };
  });
  const result = previewFc27PuzzleSquad({ ...input, evaluateSquad });
  expect(result.status).toBe('preview');
  const squad = evaluateSquad.mock.calls[0][0];
  expect(squad.map(item => item?.slot ?? null)).toEqual([0, null, 2, 3]);
  expect(Object.isFrozen(squad)).toBe(true);
  expect(Object.isFrozen(squad[0])).toBe(true);
  expect(JSON.stringify(result)).not.toContain('must-not-export');
  const mutate = squad => { squad[0].rating = 99; return { chemistry: 33 }; };
  expect(previewFc27PuzzleSquad({ ...input, evaluateSquad: mutate }).reason).toBe('FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE');
  expect(input.inventory.items[0].rating).toBe(60);
});

it('passes all eleven slots including trailing bricks and searches legal position permutations', () => {
  const input = fixture();
  input.challenge.slotCount = 11; input.challenge.brickIndices = [1, 3, 4, 6, 7, 8, 9, 10];
  input.challenge.formation = { id: 16, positions: [5, 0, 7, 0, 0, 9, 0, 0, 0, 0, 0] };
  input.challenge.rawRequirements.push(row(35, 3));
  input.inventory.items.forEach((item, index) => { item.positions = [[9], [5], [7], [9]][index]; });
  const evaluateSquad = vi.fn(squad => ({ chemistry: squad.reduce((sum, item, slot) =>
    sum + Number(item !== null && item.positions.includes(input.challenge.formation.positions[slot])), 0) }));
  const result = previewFc27PuzzleSquad({ ...input, evaluateSquad });
  expect(result.status).toBe('preview');
  expect(result.selected.map(item => [item.id, item.slot])).toEqual([[2, 0], [3, 2], [1, 5]]);
  for (const [squad] of evaluateSquad.mock.calls) {
    expect(squad).toHaveLength(11);
    expect(input.challenge.brickIndices.every(slot => squad[slot] === null)).toBe(true);
  }
  expect(result.search.placementNodes).toBeGreaterThan(0);
  expect(result.nodes).toBe(Object.values(result.search).reduce((sum, count) => sum + count, 0));
});

it('does not call a market shortage proven when only a search limit was reached', () => {
  const input = fixture(); input.challenge.slotCount = 11;
  input.challenge.rawRequirements = [row(35, 33)];
  input.inventory.items = Array.from({ length: 300 }, (_, index) => ({
    ...input.inventory.items[0], id: index + 1, definitionId: 1000 + index,
  }));
  const result = previewFc27PuzzleSquad({ ...input, maxNodes: 200, evaluateSquad: () => ({ chemistry: 0 }) });
  expect(result.reason).toBe('FC27_PUZZLE_SEARCH_LIMIT'); expect(result.selected).toEqual([]);
  expect(result).not.toHaveProperty('deficits'); expect(result.nodes).toBeLessThanOrEqual(201);
});

it('reports throttled bounded search progress without changing the search result', () => {
  const input = fixture(); input.challenge.slotCount = 11;
  input.challenge.rawRequirements = [row(35, 33)];
  input.inventory.items = Array.from({ length: 300 }, (_, index) => ({
    ...input.inventory.items[0], id: index + 1, definitionId: 1000 + index,
  }));
  const progress = [];
  const result = previewFc27PuzzleSquad({ ...input, maxNodes: 1000,
    evaluateSquad: () => ({ chemistry: 0 }), onProgress: value => progress.push(value) });
  expect(result.reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  expect(progress.length).toBeGreaterThan(1);
  expect(progress.at(-1)).toMatchObject({ nodes: 1000, maxNodes: 1000, required: 11 });
  expect(progress.every(value => value.nodes >= 0 && value.nodes <= value.maxNodes)).toBe(true);
  expect(progress.every((value, index) => index === 0 || value.nodes >= progress[index - 1].nodes)).toBe(true);
});

it('continues bounded multi-start search when a frequent group disappears under native quality rules', () => {
  const input = fixture(); input.challenge.slotCount = 11;
  input.challenge.rawRequirements = [row(3, 1, -1, 2), row(35, 33)];
  input.inventory.items = Array.from({ length: 32 }, (_, i) => ({ ...input.inventory.items[0],
    id: i + 1, definitionId: 1000 + i, rating: i < 20 ? 70 : 60,
    leagueId: i < 20 ? 1 : 2, nationId: i < 20 ? 1 : 2,
  }));
  const evaluateSquad = vi.fn(squad => {
    expect(squad.every(item => item.rating < 65)).toBe(true);
    return { chemistry: 0 };
  });
  const result = previewFc27PuzzleSquad({ ...input, maxNodes: 1000, evaluateSquad });
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', selected: [] });
  expect(result.nodes).toBe(1000);
  expect(result.nodes).toBe(Object.values(result.search).reduce((sum, count) => sum + count, 0));
  expect(result.strategyAttempts).toBeGreaterThan(1);
  expect(evaluateSquad).toHaveBeenCalled();
});

it.each(['league', 'nation', 'club'])('falls back safely when a known %s hint is removed by unary constraints', strategy => {
  const input = fixture(); input.challenge.rawRequirements = [row(3, 1, -1, 2)];
  input.inventory.items = Array.from({ length: 5 }, (_, i) => ({ ...input.inventory.items[0],
    id: i + 1, definitionId: 1000 + i, rating: i < 2 ? 70 : 60,
    leagueId: i < 2 ? 1 : 2, nationId: i < 2 ? 1 : 2, teamId: i < 2 ? 1 : 2,
  }));
  const baseline = previewFc27PuzzleSquad(input);
  const result = previewFc27PuzzleSquad({ ...input, searchHint: { strategy, groupId: 1 } });
  expect(result).toMatchObject({ status: 'preview', selected: baseline.selected });
  expect(result.selected.every(item => item.rating < 65)).toBe(true);
  expect(previewFc27PuzzleSquad({ ...input, searchHint: { strategy, groupId: 999 } }).reason)
    .toBe('FC27_PUZZLE_STRATEGY_INVALID');
});

it('reaches a later feasible route instead of allocating starts to an excluded dominant group', () => {
  const input = fixture(); input.challenge.rawRequirements = [row(3, 1, -1, 2), row(35, 3)];
  input.inventory.items = Array.from({ length: 35 }, (_, i) => ({ ...input.inventory.items[0],
    id: i + 1, definitionId: 1000 + i, rating: i < 20 ? 70 : i < 32 ? 60 : 64,
    leagueId: i < 20 ? 1 : i < 32 ? 2 : 3, nationId: i < 20 ? 1 : i < 32 ? 2 : 3,
  }));
  const result = previewFc27PuzzleSquad({ ...input, maxNodes: 1000,
    evaluateSquad: squad => ({ chemistry: squad.every(item => item.leagueId === 3) ? 3 : 0 }) });
  expect(result).toMatchObject({ status: 'preview', validation: { satisfied: true } });
  expect(result.selected.map(item => item.id).sort((a, b) => a - b)).toEqual([33, 34, 35]);
  expect(result.strategyAttempts).toBeGreaterThan(1);
  expect(result.nodes).toBeLessThanOrEqual(1000);
});

it.each([{ strategy: 'relax', groupId: 0 }, { strategy: 'balanced', groupId: 2 },
  { strategy: 'nation', groupId: '1' }, { strategy: 'nation', groupId: 1, relax: true }])(
  'still rejects malformed external hints %j', searchHint => {
    expect(previewFc27PuzzleSquad({ ...fixture(), searchHint }).reason).toBe('FC27_PUZZLE_STRATEGY_INVALID');
  });

it('skips position permutations for a proven chemistry bound and reaches a later feasible combination', () => {
  const input = fixture(); input.challenge.rawRequirements.push(row(35, 3));
  input.inventory.items.forEach(item => { item.positions = [5]; });
  input.challenge.formation = { positions: [5, 5, 5] };
  const boundSquad = vi.fn(squad => ({ status: 'observed', maxChemistry: squad.some(item => item?.id === 4) ? 3 : 0 }));
  const evaluateSquad = vi.fn(squad => ({ chemistry: squad.some(item => item?.id === 4) ? 3 : 0 }));
  const result = previewFc27PuzzleSquad({ ...input, evaluateSquad, boundSquad, maxNodes: 30 });
  expect(result.status).toBe('preview');
  expect(result.selected.map(item => item.id).sort((a, b) => a - b)).toEqual([1, 3, 4]);
  expect(evaluateSquad).toHaveBeenCalledOnce();
  expect(boundSquad).toHaveBeenCalledTimes(2);
  expect(result.nodes).toBeLessThanOrEqual(30);
});

it('never treats missing or failed bound evidence as proof of infeasibility', () => {
  const input = fixture(); input.challenge.rawRequirements.push(row(35, 3));
  for (const boundSquad of [() => ({}), () => ({ status: 'observed', maxChemistry: null }), () => { throw new Error('private'); }]) {
    const result = previewFc27PuzzleSquad({ ...input, evaluateSquad: () => ({ chemistry: 3 }), boundSquad });
    expect(result).toMatchObject({ reason: 'FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE', selected: [] });
    expect(JSON.stringify(result)).not.toContain('private');
  }
});

it('reaches a connected chemistry group before exhausting low-rating unrelated combinations', () => {
  const input = fixture(); input.challenge.slotCount = 11;
  input.challenge.formation = { positions: Array(11).fill(5) };
  input.challenge.rawRequirements = [row(35, 33), row(9, 3)];
  input.inventory.items = Array.from({ length: 22 }, (_, index) => ({ ...input.inventory.items[0],
    id: index + 1, definitionId: 1000 + index, rating: index < 11 ? 60 : 65,
    nationId: index < 11 ? index + 10 : 1, leagueId: index < 11 ? index + 10 : 1,
    teamId: index + 1, positions: [5], rarity: 0,
  }));
  const chemistry = { links: input.clubLinks, profilesEnabled: false, superChemRarityIds: [], maxChemistryPerPlayer: 3,
    identities: { legendClubId: 9001, legendLeagueId: 9002, heroClubId: 9003, hallOfFutClubId: 9004 },
    parameters: [1, 2, 3].map(id => ({ id, thresholds: [{ requirement: 2, points: 1 },
      { requirement: 5, points: 1 }, { requirement: 8, points: 1 }] })) };
  const facts = { formation: input.challenge.formation, chemistry, rating: { floatCalculationEnabled: false } };
  const result = previewFc27PuzzleSquad({ ...input, maxNodes: 200,
    evaluateSquad: squad => evaluateFc27PuzzleSquad({ ...facts, squad }),
    boundSquad: squad => boundFc27PuzzleChemistry({ ...facts, squad }) });
  expect(result.status).toBe('preview');
  expect(result.teamFacts.chemistry).toBe(33);
  expect(result.selected).toHaveLength(11);
  expect(result.selected.every(item => item.rating === 65)).toBe(true);
  expect(result.nodes).toBeLessThanOrEqual(200);
});

it('preserves off-position solutions and matches exhaustive placement feasibility', () => {
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (let seed = 0; seed < 32; seed++) {
    const input = fixture(); input.inventory.items = input.inventory.items.slice(0, 3);
    input.challenge.formation = { positions: [5, 7, 9] };
    const scope = seed % 3; const target = seed % 4;
    input.challenge.rawRequirements = [row(35, target, -1, scope)];
    input.inventory.items.forEach((item, index) => { item.positions = [[5], [7, 9], [9], [5, 7, 9]][(index + seed) % 4]; });
    const evaluateSquad = squad => ({ chemistry: squad.reduce((sum, item, slot) =>
      sum + Number(item.positions.includes(input.challenge.formation.positions[slot])), 0) });
    const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, 3);
    const possible = permutations.some(order => {
      const squad = order.map(index => input.inventory.items[index]);
      return matchFc27SbcRequirements({ requirements: parsed.rules, squad, ...evaluateSquad(squad) }).satisfied;
    });
    const result = previewFc27PuzzleSquad({ ...input, evaluateSquad });
    expect(result.status === 'preview', `placement seed ${seed}`).toBe(possible);
    if (result.status === 'preview') {
      const squad = result.selected.map(ref => input.inventory.items.find(item => item.id === ref.id));
      expect(matchFc27SbcRequirements({ requirements: parsed.rules, squad, ...evaluateSquad(squad) }).satisfied).toBe(true);
    }
  }
});

it('matches exhaustive combination feasibility for small deterministic synthetic inventories', () => {
  for (let seed = 0; seed < 36; seed++) {
    const input = fixture(); input.challenge.rawRequirements = [row(10, 1, 1, seed % 3), row(6, 2, -1, (seed + 1) % 3), row(17, 2, 1)];
    input.inventory.items = Array.from({ length: 6 }, (_, i) => ({ ...input.inventory.items[0],
      id: i + 1, definitionId: 100 + (i + seed % 2) % 5,
      rating: 60 + (i * 3 + seed) % 14, nationId: 1 + (i + seed) % 3, teamId: 1 + (i * 2 + seed) % 3,
    }));
    const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 3).rules;
    let possible = false;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 6; c++) {
      const squad = [a, b, c].map(i => input.inventory.items[i]);
      if (new Set(squad.map(item => item.definitionId)).size === 3
          && matchFc27SbcRequirements({ requirements: rules, squad, clubLinks: input.clubLinks }).satisfied) possible = true;
    }
    expect(previewFc27PuzzleSquad(input).status === 'preview', `seed ${seed}`).toBe(possible);
  }
});

it('keeps the Puzzle core free from runtime adapters, legacy workflows and transaction writers', async () => {
  const result = await build({ entryPoints: ['src/fc27/puzzle-preview.js'], bundle: true, write: false, metafile: true });
  expect(Object.keys(result.metafile.inputs).map(name => name.replaceAll('\\', '/')).sort()).toEqual([
    'src/fc27/prelaunch-contract.js', 'src/fc27/puzzle-material-policy.js', 'src/fc27/puzzle-preview.js', 'src/fc27/sbc-requirements.js', 'src/fc27/traditional-preview.js',
  ]);
});
