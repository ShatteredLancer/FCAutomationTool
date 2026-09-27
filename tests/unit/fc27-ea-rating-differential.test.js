import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspectEaRatingDifferential } from '../../scripts/browser-inspection/ea-rating-differential.mjs';

// The reviewed EA bundle is a local artifact, never redistributed with tests.
const source = await readFile(new URL('../../artifacts/fc27-browser/ea-compiled_2.js', import.meta.url), 'utf8')
  .catch(error => { if (error.code === 'ENOENT') return null; throw error; });

const report = JSON.parse(await readFile(new URL('../fixtures/fc27-puzzle-owned-recheck-observation.json', import.meta.url), 'utf8'));
report.configuration = { floatCalculationEnabled: true };
report.layout = { slotCount: 11, requiredPlayerCount: 11, simpleBrickIndices: [], customBrickIndices: [] };
report.plan.slots = Array.from({ length: 11 }, (_, index) => index);
report.eaTeamFactsProbe = { targets: [{ path: 'UTSquadEntity.prototype', present: true, truncated: false,
  methods: [{ name: '_calculateRating', kind: 'function', arity: 0,
    sha256: '398beb4841b2f7e08b46c8c556ee4be2e6d3ed991ec8adcbe0dbb13e467adc7e' }] }] };

it.skipIf(!source)('matches EA float rating in a copied VM without page calls', async () => {
  await expect(inspectEaRatingDifferential(report, { readSource: async () => source })).resolves.toMatchObject({
    status: 'verified', reason: 'FC27_EA_RATING_DIFFERENTIAL_MATCH', local: 68, ea: 68,
    executable: false, reusableForExecution: false, chemistryVerified: false,
  });
});

it('reports unavailable source without leaking read errors or requiring a local bundle', async () => {
  const result = await inspectEaRatingDifferential(report, { readSource: async () => { throw new Error('private file path'); } });
  expect(result).toMatchObject({ status: 'unverified', reason: 'FC27_EA_RATING_SOURCE_UNAVAILABLE', executable: false });
  expect(JSON.stringify(result)).not.toContain('private');
});

it('fails closed for an unreviewed runtime fingerprint', async () => {
  const changed = structuredClone(report);
  changed.eaTeamFactsProbe.targets[0].methods[0].sha256 = '0'.repeat(64);
  await expect(inspectEaRatingDifferential(changed)).resolves.toMatchObject({
    status: 'unverified', reason: 'FC27_EA_RATING_METHOD_UNREVIEWED', executable: false,
  });
});

it('fails closed for an input drift instead of comparing stale facts', async () => {
  const changed = structuredClone(report);
  changed.plan.ratings[0] = 99;
  await expect(inspectEaRatingDifferential(changed)).resolves.toMatchObject({
    status: 'unverified', reason: 'FC27_EA_RATING_INPUT_UNVERIFIED', executable: false,
  });
});
