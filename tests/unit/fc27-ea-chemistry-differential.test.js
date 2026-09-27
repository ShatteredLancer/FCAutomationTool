import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspectEaChemistryDifferential, EA_CHEMISTRY_METHOD_HASHES } from '../../scripts/browser-inspection/ea-chemistry-differential.mjs';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';

// EA's complete public bundle is a local inspection artifact, not a test asset
// to redistribute. Guard/failure tests always run; algorithm replays explicitly
// skip on clean checkouts without the reviewed artifact.
const source = await readFile(new URL('../../artifacts/fc27-browser/ea-compiled_2.js', import.meta.url), 'utf8')
  .catch(error => { if (error.code === 'ENOENT') return null; throw error; });

function fixture(change = () => {}) {
  const input = {
    formation: { id: 16, positions: Array(11).fill(5) },
    squad: Array.from({ length: 11 }, () => ({ type: 'player', rating: 60, rarity: 0,
      nationId: 11, leagueId: 1, teamId: 1, positions: [5], special: false,
      evolution: false, cosmetic: false, concept: false, academyEnrolled: false })),
    chemistry: { parameters: [
      { id: 1, thresholds: [2, 5, 8].map(requirement => ({ requirement, points: 1 })) },
      { id: 2, thresholds: [3, 5, 8].map(requirement => ({ requirement, points: 1 })) },
      { id: 3, thresholds: [2, 4, 7].map(requirement => ({ requirement, points: 1 })) },
    ], links: { schema: 1, complete: true, links: [] }, maxChemistryPerPlayer: 3, profilesEnabled: false,
    identities: { legendClubId: 9001, legendLeagueId: 9002, heroClubId: 9003, hallOfFutClubId: 9004 },
    superChemRarityIds: [], rating: { floatCalculationEnabled: false } },
  };
  change(input);
  const facts = evaluateFc27PuzzleSquad({ ...input, rating: input.chemistry.rating });
  const report = { status: 'preview', reason: 'READ_ONLY_PLAN', executable: false, liveExecutionEnabled: false,
    configuration: { profilesEnabled: input.chemistry.profilesEnabled, ...input.chemistry.rating },
    layout: { slotCount: 11, requiredPlayerCount: 11, simpleBrickIndices: [], customBrickIndices: [], formation: input.formation },
    plan: { selectedCount: 11, exactValidation: { status: 'verified', presentCount: 11 },
      slots: Array.from({ length: 11 }, (_, i) => i), ratings: input.squad.map(item => item.rating), teamFacts: facts },
    eaTeamFactsProbe: { targets: [{ path: 'UTSquadChemCalculatorUtils.prototype', present: true, truncated: false,
      methods: Object.entries(EA_CHEMISTRY_METHOD_HASHES).map(([name, sha256]) => ({ name, sha256, kind: 'function' })) }] },
  };
  return { input, report };
}

const scenarios = [
  ['ordinary', 33, () => {}],
  ['out of position', 30, input => { input.squad[0].positions = [7]; }],
  ['no links', 0, input => { input.squad.forEach((item, i) => Object.assign(item,
    { nationId: 100 + i, leagueId: 200 + i, teamId: 300 + i })); }],
  ['linked clubs', 2, input => {
    input.squad.forEach((item, i) => Object.assign(item, { nationId: 100 + i, leagueId: 200 + i, teamId: 300 + i }));
    input.chemistry.links.links = [[301, 300]];
  }],
  ['profiles enabled', 33, input => {
    input.chemistry.profilesEnabled = true;
    input.chemistry.profiles = { complete: true, entries: [{ id: 1, maxChem: false, applicableRarityIds: [],
      rules: [1, 2, 3].map(parameterId => ({ parameterId, calculationType: 1, contribution: 1 })) }] };
  }],
];
it.skipIf(!source).each(scenarios)('compares every slot using reviewed EA methods: %s', async (_name, expected, change) => {
  const { input, report } = fixture(change);
  const before = structuredClone(input);
  expect(await inspectEaChemistryDifferential(report, input, { readSource: async () => source })).toMatchObject({
    status: 'verified', reason: 'FC27_EA_CHEMISTRY_DIFFERENTIAL_MATCH', local: expected, ea: expected,
    chemistryVerified: true, perSlotMatch: true, checkedMethodCount: 13,
    executable: false, reusableForExecution: false, requirementsVerified: false,
  });
  expect(input).toEqual(before);
});

it.each(['missing-input', 'rating', 'formation', 'exact', 'special', 'bricks', 'slot', 'profile', 'facts'])
  ('rejects %s inputs before reading EA source', async kind => {
    const { input, report } = fixture();
    if (kind === 'rating') input.squad[0].rating = 85;
    if (kind === 'formation') report.layout.formation = { ...input.formation, positions: Array(11).fill(7) };
    if (kind === 'exact') report.plan.exactValidation.status = 'blocked';
    if (kind === 'special') input.squad[0].special = true;
    if (kind === 'bricks') report.layout.simpleBrickIndices = [0];
    if (kind === 'slot') report.plan.slots[0] = 1;
    if (kind === 'profile') input.chemistry.profilesEnabled = true;
    if (kind === 'facts') report.plan.teamFacts.chemistry = 17;
    const readSource = vi.fn();
    expect(await inspectEaChemistryDifferential(report, kind === 'missing-input' ? null : input, { readSource }))
      .toMatchObject({ status: 'unverified', reason: 'FC27_EA_CHEMISTRY_INPUT_UNVERIFIED', executable: false });
    expect(readSource).not.toHaveBeenCalled();
  });

it.each(['hash', 'duplicate', 'missing', 'truncated'])('rejects %s runtime method evidence', async kind => {
  const { input, report } = fixture();
  const target = report.eaTeamFactsProbe.targets[0];
  if (kind === 'hash') target.methods[0].sha256 = '0'.repeat(64);
  if (kind === 'duplicate') target.methods.push(target.methods[0]);
  if (kind === 'missing') target.methods.pop();
  if (kind === 'truncated') target.truncated = true;
  const readSource = vi.fn();
  expect(await inspectEaChemistryDifferential(report, input, { readSource })).toMatchObject({
    status: 'unverified', reason: 'FC27_EA_CHEMISTRY_METHOD_UNREVIEWED', chemistryVerified: false });
  expect(readSource).not.toHaveBeenCalled();
});

it('never executes changed source or exposes input/error details in reports', async () => {
  const { input, report } = fixture();
  input.squad[0].privateSentinel = 'should-not-appear';
  expect(await inspectEaChemistryDifferential(report, input, { readSource: async () => 'unreviewed source' }))
    .toMatchObject({ reason: 'FC27_EA_CHEMISTRY_SOURCE_UNREVIEWED' });
  const result = await inspectEaChemistryDifferential(report, input, {
    readSource: async () => { throw new Error('secret payload should-not-appear'); },
  });
  expect(result).toMatchObject({ status: 'unverified', chemistryVerified: false, executable: false });
  expect(JSON.stringify(result)).not.toMatch(/secret|should-not-appear|squad|nationId|formation/);
});

it.skipIf(!source)('rejects a changed or duplicate reviewed method in the artifact', async () => {
  const { input, report } = fixture();
  for (const changed of [source.replace('UTSquadChemCalculatorUtils.prototype.calculate=function',
    'UTSquadChemCalculatorUtils.prototype.calculate= function'),
  `${source},UTSquadChemCalculatorUtils.prototype.calculate=function(){}`]) {
    expect(await inspectEaChemistryDifferential(report, input, { readSource: async () => changed }))
      .toMatchObject({ status: 'unverified', reason: 'FC27_EA_CHEMISTRY_SOURCE_UNREVIEWED' });
  }
});
