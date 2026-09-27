import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { describeCatalogRule } from '../../src/fc27/sbc-presentation.js';

const observation = JSON.parse(readFileSync(new URL('../fixtures/fc27-production-panel-catalog-observation.json', import.meta.url), 'utf8'));

it('records a real multi-challenge catalog without treating it as executable', () => {
  expect(observation).toMatchObject({
    evidence: 'dedicated-browser-production-panel-read-only',
    liveExecutionEnabled: false,
    eaMutationsPerformed: false,
    catalog: {
      setId: 19,
      challengeRewardsSource: 'catalog-response',
      rewardIdentityVerified: false,
      challenges: expect.arrayContaining([
        expect.objectContaining({ id: 43, status: 'IN_PROGRESS' }),
        expect.objectContaining({ id: 44, status: 'NOT_STARTED' }),
      ]),
    },
  });
  expect(observation.catalog.challenges).toHaveLength(4);
  expect(observation.catalog.challenges.some(challenge => challenge.requirements.length > 5)).toBe(true);
});

it('keeps unreviewed Puzzle rule keys visible as unsupported labels', () => {
  const challenge = observation.catalog.challenges.find(value => value.id === 43);
  expect(describeCatalogRule(challenge.requirements.find(rule => rule.pairs[0].key === 10))).toMatchObject({
    recognized: false,
    label: 'Unsupported requirement — retained for inspection',
  });
});
