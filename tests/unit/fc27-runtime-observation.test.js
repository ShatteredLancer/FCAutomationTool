import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { observeRuntime } from '../../scripts/browser-inspection/runtime-observation.mjs';

it('reports unknown collections without claiming empty inventory or readiness', () => {
  const result = observeRuntime({});
  expect(result.inventory.club.count).toBeNull();
  expect(result.sbc.sets.count).toBeNull();
  expect(result.liveExecutionEnabled).toBe(false);
  expect(result.fsu.verified).toBe(false);
});

it('observes Puzzle enums without invoking accessors or assuming numeric aliases', () => {
  const forbidden = vi.fn(() => { throw new Error('private-secret'); });
  const keys = { CLUB_ID: 12, PLAYER_LEVEL: 17, PLAYER_RARITY: 18, SAME_NATION_COUNT: 4, CLUB_COUNT: 9 };
  Object.defineProperty(keys, 'NATION_ID', { get: forbidden });
  const result = observeRuntime({ SBCEligibilityKey: keys, SBCEligibilityQualityType: { BRONZE: 1, SILVER: 2, GOLD: 3 } });
  expect(result.eligibilityKeyEnums).toMatchObject({ CLUB_ID: 12, PLAYER_LEVEL: 17, NATION_ID: null });
  expect(result.eligibilityQualityEnums).toEqual({ BRONZE: 1, SILVER: 2, GOLD: 3 });
  expect(forbidden).not.toHaveBeenCalled();
});

it('never invokes model accessors, service methods, or bridge methods', () => {
  const forbidden = vi.fn(() => { throw new Error('private-secret'); });
  const service = { requestSets: forbidden, saveChallenge: forbidden };
  Object.defineProperty(service, 'repository', { get: forbidden });
  const result = observeRuntime({ services: { SBC: service },
    FSULocalRunnerBridge: { describe: forbidden }, privateAccount: 'private-secret' });
  expect(result.sbc.methods.requestSets).toBe('function');
  expect(result.sbc.repository).toBe('accessor');
  expect(result.fsu.bridge.describe).toBe('function');
  expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('private-secret');
});

it('observes market method descriptors without searching, constructing criteria or exposing private fields', () => {
  const forbidden = vi.fn(() => { throw new Error('private-secret'); });
  const itemService = Object.create({ searchConceptItems: forbidden, searchTransferMarket: forbidden });
  itemService.privateToken = 'private-secret';
  Object.defineProperty(itemService, 'requestMarketData', { get: forbidden });
  const root = { services: { Item: itemService }, UTSearchCriteriaDTO: forbidden };
  const result = observeRuntime(root);
  expect(result.market).toEqual({ verified: false, itemService: 'data', criteria: 'function',
    methods: { searchConceptItems: 'function', searchTransferMarket: 'function', requestMarketData: 'accessor' } });
  expect(result.limitations).toContain('NO_MARKET_CONTRACT_VERIFICATION');
  expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('private-secret');
});

it('does not invoke shadowing market accessors or promote absent market methods to readiness', () => {
  const forbidden = vi.fn();
  const service = Object.create({ searchConceptItems: forbidden });
  Object.defineProperty(service, 'searchConceptItems', { get: forbidden });
  const root = { services: { Item: service } };
  Object.defineProperty(root, 'UTSearchCriteriaDTO', { get: forbidden });
  expect(observeRuntime(root).market).toMatchObject({ verified: false, criteria: 'accessor',
    methods: { searchConceptItems: 'accessor', searchTransferMarket: 'absent', requestMarketData: 'absent' } });
  Object.defineProperty(root.services, 'Item', { get: forbidden });
  expect(observeRuntime(root).market).toMatchObject({ itemService: 'accessor',
    methods: { searchConceptItems: 'absent' } });
  expect(observeRuntime({}).market).toMatchObject({ itemService: 'absent', criteria: 'absent', verified: false });
  expect(forbidden).not.toHaveBeenCalled();
});

it('observes bounded puzzle attributes without reading position accessors or item identities', () => {
  const forbidden = vi.fn();
  const item = { id: 900001, definitionId: 12345678, nationId: 27, teamId: 10, leagueId: 5,
    preferredPosition: 25, basePossiblePositions: [25, 23], groups: [0, 83] };
  Object.defineProperty(item, 'possiblePositions', { get: forbidden });
  const result = observeRuntime({ repositories: { Item: { club: { items: [item] } } } });
  expect(result.inventory.club.samples[0].puzzle).toEqual({ nationId: 27, teamId: 10, leagueId: 5,
    preferredPosition: 25, basePossiblePositions: [25, 23], groups: [0, 83] });
  expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/900001|12345678/);
});

it('observes chemistry thresholds, profile contributions and bounded public team links without runtime methods', () => {
  const forbidden = vi.fn();
  const teamLinks = new Map(Array.from({ length: 10 }, (_, i) => [100 + i, 200 + i]));
  teamLinks.entries = forbidden;
  const report = observeRuntime({ ChemistryParamId: { CLUB: 3, LEAGUE: 2, NATION: 1 }, repositories: {
    TeamConfig: { teamLinks }, Chemistry: { parameters: [{ id: 3, thresholds: [{ requirement: 2, points: 1 }] }],
      profiles: [{ id: 1, maxChem: false, applicableRarityIds: [], rules: [{ parameterId: 3, calculationType: 1, contribution: 1 }] }] },
  } });
  expect(report.chemistry.parameters.samples[0].thresholds.samples).toEqual([{ requirement: 2, points: 1 }]);
  expect(report.chemistry.profiles.samples[0].rules.samples).toEqual([{ parameterId: 3, calculationType: 1, contribution: 1 }]);
  expect(report.chemistry.teamLinks).toMatchObject({ count: 10, truncated: true });
  expect(report.chemistry.teamLinks.samples).toHaveLength(8);
  expect(forbidden).not.toHaveBeenCalled();
});

it('replays the logged-in Puzzle descriptors without promoting sampled cards or chemistry to a solved plan', () => {
  const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-puzzle-runtime-observation.json', import.meta.url), 'utf8'));
  const report = observeRuntime({ SBCEligibilityKey: observed.eligibilityKeys, SBCEligibilityScope: observed.scopes,
    SBCEligibilityQualityType: observed.quality, ChemistryParamId: observed.chemistryParameterEnums,
    repositories: { Chemistry: { parameters: observed.chemistryParameters },
      Item: { club: { items: observed.playerSamples } } } });
  expect(report.eligibilityKeyEnums).toEqual(observed.eligibilityKeys);
  expect(report.inventory.club.samples.map(item => item.puzzle.nationId)).toEqual(observed.playerSamples.map(item => item.nationId));
  expect(report.chemistry.parameters.samples.map(parameter => parameter.thresholds.samples))
    .toEqual(observed.chemistryParameters.map(parameter => parameter.thresholds));
  expect(report.liveExecutionEnabled).toBe(false);
  expect(observed).toMatchObject({ cachedEntries: 314, cachedPlayers: 306, eaMutationsPerformed: false });
});

it('reads profile overrides and calculation enums without promoting missing fields to defaults', () => {
  const forbidden = vi.fn();
  const profile = { id: 1, baseOverride: false, iconOverride: true };
  Object.defineProperty(profile, 'heroOverride', { get: forbidden });
  const result = observeRuntime({ ChemistryProfileId: { BASE: 1, ICON: 3, HERO: 2 },
    ChemistryProfileRuleCalculationType: { NORMAL: 1, UNIVERSAL_WITH_PLAYER_COUNT: 2 },
    repositories: { Chemistry: { profiles: [profile] } } });
  expect(result.chemistry.profileEnums).toEqual({ BASE: 1, ICON: 3, HERO: 2 });
  expect(result.chemistry.calculationEnums).toEqual({ NORMAL: 1, UNIVERSAL_WITH_PLAYER_COUNT: 2 });
  expect(result.chemistry.profiles.samples[0]).toMatchObject({ baseOverride: false, iconOverride: true, heroOverride: null });
  expect(forbidden).not.toHaveBeenCalled();
});

it('observes inherited config readers and constants without executing settings readers or accessors', () => {
  const forbidden = vi.fn();
  const settings = Object.create({ getStringSettingByKey: forbidden });
  const keys = { CHEMISTRY_PROFILES_ENABLED: 'enableChemistryProfiles' };
  Object.defineProperty(keys, 'SUPER_CHEM_RARITY_IDS', { get: forbidden });
  const result = observeRuntime({ services: { Configuration: Object.create({ checkFeatureEnabled: forbidden }) },
    repositories: { ServerSettings: settings }, UTServerSettingsRepository: { KEY: keys },
    UTItemEntity: { HALL_OF_FUT_CLUB_ID: 132794 } });
  expect(result.chemistry.configEvidence).toMatchObject({ checkFeatureEnabled: 'function', getStringSettingByKey: 'function',
    keys: { CHEMISTRY_PROFILES_ENABLED: 'enableChemistryProfiles', SUPER_CHEM_RARITY_IDS: null },
    identities: { HALL_OF_FUT_CLUB_ID: 132794, LEGENDS_CLUB_ID: null } });
  expect(forbidden).not.toHaveBeenCalled();
});

it('bounds inventory samples, anonymizes identities and preserves unknown safety fields', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: 900001 + i,
    definitionId: i < 2 ? 12345678 : 22222222 + i, rating: 65 + i % 10,
    untradeable: true, loans: -1, token: 'private-secret', name: 'private-name' }));
  const result = observeRuntime({ repositories: { Item: { club: { items } } } });
  expect(result.inventory.club).toMatchObject({ count: 100, truncated: true });
  expect(result.inventory.club.samples).toHaveLength(6);
  const [a, b] = result.inventory.club.samples;
  expect(a.itemRef).not.toBe(b.itemRef);
  expect(a.definitionRef).toBe(b.definitionRef);
  expect(a).toMatchObject({ rating: 65, loans: -1, untradeable: true, evolution: null });
  expect(JSON.stringify(result)).not.toMatch(/900001|12345678|private-secret|private-name/);
});

it('retains bounded raw requirement facts and bricks without assuming eleven playable slots', () => {
  const challenge = { id: 2, eligibilityRequirements: [
    { count: 2, kvPairs: { _collection: { 9: [65] } } },
    { count: 2, key: 10, values: [74] },
  ], squad: { simpleBrickIndices: [0, 1, 2, 3, 4, 5, 6, 9, 10] } };
  const result = observeRuntime({ services: { SBC: { repository: { sets: { _collection: {
    1: { id: 1, challenges: [challenge] },
  } } } } }, SBCEligibilityKey: { PLAYER_MIN_OVR: 9, PLAYER_MAX_OVR: 10 } });
  const value = result.sbc.sets.samples[0].challenges.samples[0];
  expect(value.requirements.samples[0]).toMatchObject({ count: 2, pairs: [{ key: 9, keyName: 'PLAYER_MIN_OVR', values: [65] }] });
  expect(value.requirements.samples[1]).toMatchObject({ key: 10, keyName: 'PLAYER_MAX_OVR', values: [74] });
  expect(value.brickIndices).toHaveLength(9);
  expect(value.requiredPlayerCount).toBeNull();
});

it('inspects inherited method descriptors but does not execute inherited getters', () => {
  const forbidden = vi.fn();
  const proto = { requestSets: forbidden };
  Object.defineProperty(proto, 'repository', { get: forbidden });
  const result = observeRuntime({ services: { SBC: Object.create(proto) } });
  expect(result.sbc.methods.requestSets).toBe('function');
  expect(result.sbc.repository).toBe('accessor');
  expect(forbidden).not.toHaveBeenCalled();
});

it('does not enumerate arbitrary roots or read credentials/storage', () => {
  const forbidden = vi.fn();
  const root = { repositories: {}, services: {} };
  for (const key of ['localStorage', 'sessionStorage', 'document', 'privateAccount']) {
    Object.defineProperty(root, key, { get: forbidden });
  }
  observeRuntime(root);
  expect(forbidden).not.toHaveBeenCalled();
});

it('accepts string-valued EA type enums and counts players separately from cached consumables', () => {
  const result = observeRuntime({ ItemType: { PLAYER: 'Player', MANAGER: 'Manager' },
    LimitedUseType: { NONE: 0 }, SBCEligibilityScope: { GREATER: 0, LOWER: 1, EXACT: 2 },
    repositories: { Item: { club: { items: [
      { id: 1, definitionId: 101, type: 'Manager', _rating: 99 },
      { id: 2, definitionId: 102, type: 'Player', _rating: 70, _rareflag: 0, upgrades: null,
        cosmetics: [], _hyperCosmeticDTOs: {}, loans: -1, limitedUseType: 0, tradable: false },
    ] } } } });
  expect(result.itemTypeEnums.PLAYER).toBe('Player');
  expect(result.inventory.club).toMatchObject({ count: 2, cachedPlayers: 1, typesComplete: true });
  expect(result.inventory.club.samples[0].type).toBe('manager');
  expect(result.inventory.club.playerSamples[0]).toMatchObject({ type: 'player', cosmeticCount: 0, hyperCosmeticCount: 0 });
  expect(result.eligibilityScopeEnums).toEqual({ GREATER: 0, LOWER: 1, EXACT: 2 });
  expect(result.limitations).toContain('NO_ACCOUNT_SCOPE_VERIFICATION');
});

it('does not read more than the inventory bound or infer a complete collection from samples', () => {
  const items = Array.from({ length: 20001 }, () => ({ type: 'Player' }));
  const result = observeRuntime({ ItemType: { PLAYER: 'Player' }, repositories: { Item: { club: { items } } } });
  expect(result.inventory.club.cachedPlayers).toBeNull();
  expect(result.inventory.club.typesComplete).toBe(false);
});
it('replays observed FC27 native requirement keys and reward values without inventing counts or flags', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/fc27-native-sbc-observation.json', import.meta.url), 'utf8'));
  const root = { SBCEligibilityKey: fixture.eligibilityKeys,
    services: { SBC: { repository: { sets: [fixture.set] } } } };
  const result = observeRuntime(root);
  const challenge = result.sbc.sets.samples[0].challenges.samples[0];
  expect(challenge).toMatchObject({ id: 2, status: 'IN_PROGRESS', requiredPlayerCount: null, brickIndices: null });
  expect(challenge.requirements.samples.map(rule => rule.pairs[0]))
    .toEqual([{ key: 26, keyName: 'PLAYER_MIN_OVR', values: [65] }, { key: 28, keyName: 'PLAYER_MAX_OVR', values: [74] }]);
  expect(challenge.rewards.samples[0]).toMatchObject({ type: 'pack', value: 200, count: 1, untradeable: null });
});
