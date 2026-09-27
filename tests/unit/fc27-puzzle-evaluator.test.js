import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateFc27PuzzleSquad, evaluateFc27PuzzleRating, boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';

const links = { schema: 1, complete: true, links: [[101, 1], [102, 2]] };
const parameters = [
  { id: 1, thresholds: [{ requirement: 2, points: 1 }, { requirement: 5, points: 1 }, { requirement: 8, points: 1 }] },
  { id: 2, thresholds: [{ requirement: 3, points: 1 }, { requirement: 5, points: 1 }, { requirement: 8, points: 1 }] },
  { id: 3, thresholds: [{ requirement: 2, points: 1 }, { requirement: 4, points: 1 }, { requirement: 7, points: 1 }] },
];
const chemistry = { parameters, links, maxChemistryPerPlayer: 3, profilesEnabled: false,
  identities: { legendClubId: 9001, legendLeagueId: 9002, heroClubId: 9003, hallOfFutClubId: 9004 },
  superChemRarityIds: [] };
const rating = { floatCalculationEnabled: false };
const formation = { id: 16, positions: Array(11).fill(5) };
const player = (id, ratingValue = 60, extra = {}) => ({ id, definitionId: 1000 + id, type: 'player', rating: ratingValue,
  nationId: 11, teamId: 1, leagueId: 1, rarity: 0, positions: [5], special: false, evolution: false, cosmetic: false,
  concept: false, academyEnrolled: false, activeTrade: false, tradeable: false, limitedUse: false, loans: -1, ...extra });

it('replays ordinary-player chemistry with linked clubs, thresholds and three-point cap', () => {
  const squad = Array.from({ length: 11 }, (_, index) => player(index + 1));
  squad[0].teamId = 101; squad[1].teamId = 102;
  const result = evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating });
  expect(result).toMatchObject({ status: 'observed', chemistry: 33, teamRating: 60, ratingMode: 'integer' });
  expect(result.slotChemistry).toEqual(Array(11).fill(3));
});

it('assigns zero chemistry to an out-of-position player', () => {
  const squad = Array.from({ length: 11 }, (_, index) => player(index + 1));
  squad[0].positions = [7];
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating })).toMatchObject({ status: 'observed', chemistry: 30 });
});

it('computes an optimistic chemistry bound without changing cards or actual positions', () => {
  const squad = Array.from({ length: 11 }, (_, i) => player(i + 1));
  squad[0].positions = [7]; squad[10] = null;
  const before = structuredClone(squad);
  const bound = boundFc27PuzzleChemistry({ squad, formation, chemistry, rating });
  expect(bound).toEqual({ status: 'observed', maxChemistry: 27 });
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating }).chemistry).toBeLessThanOrEqual(bound.maxChemistry);
  expect(squad).toEqual(before);
  expect(boundFc27PuzzleChemistry({ squad, formation, chemistry: null }).status).toBe('blocked');
});

it('uses nation parameter 1 and club parameter 3 even when the parameter list is reordered', () => {
  const squad = Array.from({ length: 11 }, (_, i) => player(i + 1, 60,
    { nationId: 100 + i, leagueId: 200 + i, teamId: i < 4 ? 1 : 300 + i }));
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry }).chemistry).toBe(8);
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry: { ...chemistry, parameters: [...parameters].reverse() } }).chemistry).toBe(8);
  squad.forEach((item, i) => { item.teamId = 300 + i; item.nationId = i < 4 ? 1 : 100 + i; });
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry }).chemistry).toBe(4);
});

it('never underestimates any placement when tightening the bound for shared slots and simple bricks', () => {
  const permutations = values => values.length === 0 ? [[]] : values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]));
  const orders = permutations([0, 1, 2, 3]);
  for (let seed = 0; seed < 24; seed++) {
    const slots = [0, 2, 5, 9];
    const layout = { id: 16, positions: Array.from({ length: 11 }, (_, i) => i % 3 + 3) };
    const players = slots.map((_, i) => player(i + 1, 60, { positions: [(seed + i) % 3 + 3],
      nationId: (seed + i) % 2 + 1, leagueId: (seed * i) % 3 + 1, teamId: i % 2 + 1 }));
    const squad = Array(11).fill(null); slots.forEach((slot, i) => { squad[slot] = players[i]; });
    const bound = boundFc27PuzzleChemistry({ squad, formation: layout, chemistry, rating });
    expect(bound.status).toBe('observed');
    for (const order of orders) {
      const arranged = Array(11).fill(null); slots.forEach((slot, i) => { arranged[slot] = players[order[i]]; });
      const actual = evaluateFc27PuzzleSquad({ squad: arranged, formation: layout, chemistry, rating });
      expect(actual.chemistry).toBeLessThanOrEqual(bound.maxChemistry);
    }
  }
});

it('excludes out-of-position players from threshold counts, not just their own points', () => {
  const squad = Array.from({ length: 11 }, (_, i) => player(i + 1, 60,
    { nationId: 100 + i, leagueId: 200 + i, teamId: i < 2 ? 1 : 300 + i }));
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry }).chemistry).toBe(2);
  squad[1].positions = [7];
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry }).chemistry).toBe(0);
});

it('evaluates rating independently of chemistry and divides simple-brick squads by eleven', () => {
  expect(evaluateFc27PuzzleRating({ squad: [{ rating: 60 }, { rating: 60 }], rating })).toMatchObject({ teamRating: 20 });
  expect(evaluateFc27PuzzleRating({ squad: [{ rating: 60 }], rating: {} }).status).toBe('blocked');
});

it('requires explicit special-identity and super-chemistry evidence', () => {
  const squad = Array.from({ length: 11 }, (_, i) => player(i + 1));
  for (const config of [{ ...chemistry, identities: null }, { ...chemistry, superChemRarityIds: null },
    { ...chemistry, profilesEnabled: undefined }]) {
    expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry: config }).status).toBe('blocked');
  }
  for (const extra of [{ teamId: 9001 }, { teamId: 9003 }, { teamId: 9004 }, { leagueId: 9002 }, { rarity: 69 }]) {
    expect(evaluateFc27PuzzleSquad({ squad: [player(1, 60, extra), ...squad.slice(1)], formation, chemistry }).status).toBe('blocked');
  }
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry: { ...chemistry, superChemRarityIds: [0] } }).status).toBe('blocked');
});

it('supports explicit ordinary normal profiles and rejects incomplete or universal profile evidence', () => {
  const squad = Array.from({ length: 11 }, (_, i) => player(i + 1));
  const base = { id: 1, maxChem: false, applicableRarityIds: [], rules: [1, 2, 3].map(parameterId =>
    ({ parameterId, calculationType: 1, contribution: 1 })) };
  const config = { ...chemistry, profilesEnabled: true, profiles: { complete: true, entries: [base] } };
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry: config }).chemistry).toBe(33);
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry: { ...config, profiles: { ...config.profiles, complete: false } } }).status).toBe('blocked');
  config.profiles.entries.push({ ...base, id: 4, applicableRarityIds: [0],
    rules: [{ parameterId: 1, calculationType: 2, contribution: 1 }] });
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry: config }).status).toBe('blocked');
});

it('matches EA integer and float rating branches', () => {
  const squad = [90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 60].map((value, index) => player(index + 1, value));
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating }).teamRating).toBe(90);
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating: { floatCalculationEnabled: true } }).teamRating).toBe(89);
});

it('replays the aggregate live preview rating without representing it as EA transaction confirmation', () => {
  const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-puzzle-evaluator-observation.json', import.meta.url), 'utf8'));
  const result = evaluateFc27PuzzleRating({ squad: observed.plan.ratings.map(rating => ({ rating })),
    rating: { floatCalculationEnabled: observed.configuration.floatCalculationEnabled } });
  expect(result.teamRating).toBe(observed.plan.teamFacts.teamRating);
  expect(observed).toMatchObject({ liveExecutionEnabled: false, agentPerformedAccountMutation: false });
  expect(observed.limitations).toContain('PURE_EVALUATOR_RESULT_NOT_EA_CONFIRMATION');
});

it.each([
  ['FC27_PUZZLE_FORMATION_UNAVAILABLE', { formation: null }],
  ['FC27_PUZZLE_CHEMISTRY_CONFIG_UNAVAILABLE', { chemistry: { ...chemistry, links: null } }],
  ['FC27_PUZZLE_CHEMISTRY_FEATURE_UNVERIFIED', { chemistry: { ...chemistry, profilesEnabled: true } }],
])('fails closed when %s is not proven', (reason, extra) => {
  const squad = Array.from({ length: 11 }, (_, index) => player(index + 1));
  expect(evaluateFc27PuzzleSquad({ squad, formation, chemistry, rating, ...extra }).reason).toBe(reason);
});
