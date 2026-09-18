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
