import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { normalizeFc27TraditionalChallenge } from '../../src/adapters/ea/fc27-traditional-read.js';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/fc27-native-sbc-observation.json', import.meta.url), 'utf8'));
const originalFsu = JSON.parse(readFileSync(new URL('../fixtures/fc27-original-fsu-runner-observation.json', import.meta.url), 'utf8'));
function input() {
  return { context: { season: '27', accountScope: 'fixture', platform: 'PSN' }, setId: 1,
    challenge: { ...structuredClone(fixture.set.challenges[0]), setId: 1 },
    layout: { status: 'observed', setId: 1, challengeId: 2, slotCount: 11, requiredPlayerCount: 2,
      simpleBrickIndices: [0, 1, 4, 5, 6, 7, 8, 9, 10], customBrickIndices: [] },
    keys: fixture.eligibilityKeys, scopes: { GREATER: 0, EXACT: 2 } };
}
it('normalizes only proven all-player OVR requirements and fresh brick layout', () => {
  expect(normalizeFc27TraditionalChallenge(input())).toMatchObject({ id: 2, requirements: [
    { kind: 'player-count', count: 2 }, { kind: 'player-min-overall', count: 2, value: 65 },
    { kind: 'player-max-overall', count: 2, value: 74 },
  ] });
});
it('rejects unknown chemistry, changed scope/count, hidden combined keys and unstarted challenges', () => {
  for (const mutate of [
    x => { x.challenge.status = 'NOT_STARTED'; },
    x => { x.challenge.eligibilityRequirements[0].count = 1; },
    x => { x.challenge.eligibilityRequirements[0].scope = 1; },
    x => { x.challenge.eligibilityRequirements[0].kvPairs._collection['99'] = [10]; },
    x => { x.layout.status = 'blocked'; },
  ]) { const value = input(); mutate(value); expect(() => normalizeFc27TraditionalChallenge(value)).toThrow(); }
});

it.each([[1, 1, 64], [2, 65, 74], [3, 75, 99]])('normalizes exact whole-squad quality %s only with matching EA enums', (quality, min, max) => {
  const value = input();
  value.keys.PLAYER_QUALITY = 3;
  value.qualities = { BRONZE: 1, SILVER: 2, GOLD: 3 };
  value.challenge.eligibilityRequirements = [{ count: -1, scope: 2, kvPairs: { _collection: { 3: [quality] } } }];
  expect(normalizeFc27TraditionalChallenge(value).requirements).toEqual([
    { kind: 'player-count', count: 2 }, { kind: 'player-min-overall', count: 2, value: min },
    { kind: 'player-max-overall', count: 2, value: max },
  ]);
  for (const mutate of [
    x => { x.qualities.BRONZE = 7; }, x => { x.challenge.eligibilityRequirements[0].scope = 1; },
    x => { x.challenge.eligibilityRequirements[0].count = null; },
    x => { x.challenge.eligibilityRequirements[0].kvPairs._collection[3] = [1, 2]; },
  ]) { const changed = structuredClone(value); mutate(changed); expect(() => normalizeFc27TraditionalChallenge(changed)).toThrow(); }
});

it('accepts the observed all-gold minimum quality, not unreviewed minimum bronze/silver scope', () => {
  const value = input();
  value.keys.PLAYER_QUALITY = 3;
  value.qualities = { BRONZE: 1, SILVER: 2, GOLD: 3 };
  value.challenge.eligibilityRequirements = [{ count: -1, scope: 0, kvPairs: { _collection: { 3: [3] } } }];
  expect(normalizeFc27TraditionalChallenge(value).requirements).toEqual([
    { kind: 'player-count', count: 2 }, { kind: 'player-min-overall', count: 2, value: 75 },
    { kind: 'player-max-overall', count: 2, value: 99 },
  ]);
  for (const quality of [1, 2, 4]) {
    value.challenge.eligibilityRequirements[0].kvPairs._collection[3] = [quality];
    expect(() => normalizeFc27TraditionalChallenge(value)).toThrow('FC27_REQUIREMENT_UNSUPPORTED');
  }
});

it.each([...originalFsu.previews, originalFsu.goldPreview])('replays the live $name whole-squad rule and layout without inferring Live readiness', observed => {
  const value = input();
  Object.assign(value, { setId: observed.setId, keys: originalFsu.eligibilityKeys, scopes: originalFsu.scopes,
    qualities: originalFsu.qualities, layout: { status: 'observed', setId: observed.setId, challengeId: observed.challengeId, ...observed.layout },
    challenge: { id: observed.challengeId, setId: observed.setId, status: observed.challengeStatus,
      eligibilityOperation: observed.eligibilityOperation, eligibilityRequirements: observed.requirements.map(rule => ({
        count: rule.count, scope: rule.scope, kvPairs: { _collection: Object.fromEntries(rule.pairs.map(pair => [pair.key, pair.values])) },
      })) } });
  const quality = observed.requirements[0].pairs[0].values[0];
  const [min, max] = [[1, 64], [65, 74], [75, 99]][quality - 1];
  expect(normalizeFc27TraditionalChallenge(value).requirements).toEqual([
    { kind: 'player-count', count: 11 }, { kind: 'player-min-overall', count: 11, value: min },
    { kind: 'player-max-overall', count: 11, value: max },
  ]);
  expect(observed.result.safeCandidates).toBeLessThan(11);
  expect(originalFsu.liveExecutionEnabled).toBe(false);
  expect(originalFsu.inventory.complete).toBe(false);
});
