import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { normalizeFc27TraditionalChallenge } from '../../src/adapters/ea/fc27-traditional-read.js';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/fc27-native-sbc-observation.json', import.meta.url), 'utf8'));
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
