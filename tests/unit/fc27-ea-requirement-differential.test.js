import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspectEaRequirementDifferential, EA_REQUIREMENT_METHOD_HASHES } from '../../scripts/browser-inspection/ea-requirement-differential.mjs';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';
import { parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

// Reviewed EA code stays local. Clean checkouts still run every guard test.
const source = await readFile(new URL('../../artifacts/fc27-browser/ea-compiled_2.js', import.meta.url), 'utf8')
  .catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const rule = (key, values, count = -1, scope = 0) => ({ count, scope, pairs: [{ key, values }] });
function fixture(requirements = [rule(3, [1])], change = () => {}) {
  const clubLinks = { schema: 1, complete: true, links: [[301, 300]] };
  const input = { requirements, clubLinks,
    formation: { id: 16, positions: Array(11).fill(5) },
    squad: Array.from({ length: 11 }, (_, index) => ({ type: 'player', rating: index < 6 ? 60 : 70,
      rarity: index < 4 ? 1 : 0, nationId: index < 5 ? 11 : 12, leagueId: index < 3 ? 21 : 22,
      teamId: index < 4 ? 301 : 300, groups: [1, 2], positions: [5], special: false,
      evolution: false, cosmetic: false, concept: false, academyEnrolled: false })),
    chemistry: { parameters: [
      { id: 1, thresholds: [2, 5, 8].map(requirement => ({ requirement, points: 1 })) },
      { id: 2, thresholds: [3, 5, 8].map(requirement => ({ requirement, points: 1 })) },
      { id: 3, thresholds: [2, 4, 7].map(requirement => ({ requirement, points: 1 })) },
    ], links: clubLinks, maxChemistryPerPlayer: 3, profilesEnabled: false,
    identities: { legendClubId: 9001, legendLeagueId: 9002, heroClubId: 9003, hallOfFutClubId: 9004 },
    superChemRarityIds: [], rating: { floatCalculationEnabled: true } },
  };
  change(input);
  const facts = evaluateFc27PuzzleSquad({ ...input, rating: input.chemistry.rating });
  const report = { status: 'preview', reason: 'READ_ONLY_PLAN', executable: false, liveExecutionEnabled: false,
    rules: parseFc27SbcRequirements(requirements, 11).rules,
    layout: { slotCount: 11, requiredPlayerCount: 11, simpleBrickIndices: [], customBrickIndices: [], formation: input.formation },
    plan: { selectedCount: 11, exactValidation: { status: 'verified', presentCount: 11 },
      slots: Array.from({ length: 11 }, (_, i) => i), ratings: input.squad.map(item => item.rating), teamFacts: facts },
    eaRatingDifferential: { status: 'verified' }, eaChemistryDifferential: { status: 'verified' },
    eaTeamFactsProbe: { targets: [{ path: 'UTSBCChallengeEntity.prototype', present: true, truncated: false,
      methods: Object.entries(EA_REQUIREMENT_METHOD_HASHES).map(([name, sha256]) => ({ name, sha256, kind: 'function' })) }] } };
  return { input, report };
}

it.skipIf(!source).each([
  ['nation', rule(10, [11], 5, 2), true], ['multiple nations', rule(10, [11, 12], 11, 2), true],
  ['league', rule(11, [21], 3, 2), true], ['multiple leagues', rule(11, [21, 22], 11, 2), true],
  ['linked club', rule(12, [301], 11, 2), true], ['multiple linked clubs', rule(12, [301, 300], 11, 2), true],
  ['distinct clubs', rule(9, [1], -1, 2), true], ['distinct nations', rule(7, [2], -1, 2), true],
  ['distinct leagues', rule(8, [2], -1, 2), true], ['same club', rule(6, [11], -1, 2), true],
  ['same nation', rule(4, [6], -1, 2), true], ['same league', rule(5, [8], -1, 2), true],
  ['min quality', rule(3, [1]), true], ['max quality', rule(3, [2], -1, 1), true],
  ['exact quality fails', rule(3, [2], -1, 2), false], ['quality count', rule(17, [2], 5, 2), true],
  ['multiple quality tiers', rule(17, [1, 2], 11, 2), true],
  ['min OVR', rule(26, [65], 5, 2), true], ['max OVR', rule(28, [64], 6, 2), true],
  ['exact OVR', rule(27, [60], 6, 2), true], ['rare', rule(18, [1], 4, 2), true],
  ['group', rule(25, [2], 11, 2), true], ['chemistry', rule(35, [30]), true],
  ['rating', rule(19, [60]), true], ['missing nation', rule(10, [99], 1), false],
])('compares %s with the reviewed EA implementation', async (_name, requirement, satisfied) => {
  const { input, report } = fixture([requirement]);
  const before = structuredClone(input);
  expect(await inspectEaRequirementDifferential(report, input, { readSource: async () => source })).toMatchObject({
    status: 'verified', requirementsVerified: true, perRequirementMatch: true, local: [satisfied], ea: [satisfied],
    localOverall: satisfied, eaOverall: satisfied, checkedMethodCount: 23,
    executable: false, liveExecutionEnabled: false, reusableForExecution: false,
  });
  expect(input).toEqual(before);
});

it.skipIf(!source)('compares each rule and the complete AND result together', async () => {
  const { input, report } = fixture([rule(10, [11, 12], 1), rule(9, [1]), rule(17, [2], 3), rule(3, [1]), rule(35, [14])]);
  expect(await inspectEaRequirementDifferential(report, input, { readSource: async () => source }))
    .toMatchObject({ status: 'verified', local: Array(5).fill(true), ea: Array(5).fill(true), eaOverall: true });
});

it.each(['missing', 'exact', 'rules', 'unknown', 'bricks', 'groups', 'special', 'slot', 'facts', 'links'])
  ('rejects incomplete or changed %s input before source access', async kind => {
    const { input, report } = fixture();
    if (kind === 'exact') report.plan.exactValidation.status = 'blocked';
    if (kind === 'rules') report.rules = [];
    if (kind === 'unknown') input.requirements[0].pairs[0].key = 999;
    if (kind === 'bricks') report.layout.customBrickIndices = [0];
    if (kind === 'groups') delete input.squad[0].groups;
    if (kind === 'special') input.squad[0].special = true;
    if (kind === 'slot') report.plan.slots[0] = 1;
    if (kind === 'facts') report.plan.teamFacts = { chemistry: 0, teamRating: 1 };
    if (kind === 'links') input.clubLinks = { schema: 1, complete: false, links: [] };
    const readSource = vi.fn();
    expect(await inspectEaRequirementDifferential(report, kind === 'missing' ? null : input, { readSource }))
      .toMatchObject({ status: 'unverified', reason: 'FC27_EA_REQUIREMENT_INPUT_UNVERIFIED' });
    expect(readSource).not.toHaveBeenCalled();
  });

it.each(['eaRatingDifferential', 'eaChemistryDifferential'])('requires %s first', async key => {
  const { input, report } = fixture(); report[key].status = 'mismatch';
  expect(await inspectEaRequirementDifferential(report, input)).toMatchObject({ reason: 'FC27_EA_REQUIREMENT_FACTS_PREREQUISITE' });
});

it.each(['hash', 'duplicate', 'missing', 'truncated'])('rejects %s runtime method evidence', async kind => {
  const { input, report } = fixture(); const target = report.eaTeamFactsProbe.targets[0];
  if (kind === 'hash') target.methods[2].sha256 = '0'.repeat(64);
  if (kind === 'duplicate') target.methods.push(target.methods[0]);
  if (kind === 'missing') target.methods.pop();
  if (kind === 'truncated') target.truncated = true;
  const readSource = vi.fn();
  expect(await inspectEaRequirementDifferential(report, input, { readSource }))
    .toMatchObject({ status: 'unverified', reason: 'FC27_EA_REQUIREMENT_METHOD_UNREVIEWED' });
  expect(readSource).not.toHaveBeenCalled();
});

it('does not leak source errors or transient material attributes', async () => {
  const { input, report } = fixture(); input.squad[0].privateSentinel = 'secret-item';
  const result = await inspectEaRequirementDifferential(report, input, { readSource: async () => { throw new Error('private-path secret-item'); } });
  expect(result).toMatchObject({ status: 'unverified', reason: 'FC27_EA_REQUIREMENT_CHECK_UNAVAILABLE' });
  expect(JSON.stringify(result)).not.toMatch(/secret-item|private-path|nationId|squad/);
  expect(await inspectEaRequirementDifferential(report, input, { readSource: async () => 'bad source' }))
    .toMatchObject({ reason: 'FC27_EA_REQUIREMENT_SOURCE_UNREVIEWED' });
});

it.skipIf(!source)('rejects changed and duplicate method source', async () => {
  const { input, report } = fixture();
  for (const altered of [source.replace('UTSBCChallengeEntity.prototype.isRequirementMet=function',
    'UTSBCChallengeEntity.prototype.isRequirementMet= function'), `${source},UTSBCChallengeEntity.prototype.isRequirementMet=function(){}`]) {
    expect(await inspectEaRequirementDifferential(report, input, { readSource: async () => altered }))
      .toMatchObject({ reason: 'FC27_EA_REQUIREMENT_SOURCE_UNREVIEWED' });
  }
});
