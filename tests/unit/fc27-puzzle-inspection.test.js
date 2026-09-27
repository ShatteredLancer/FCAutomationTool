import { beforeEach, expect, it, vi } from 'vitest';
import { inspectPuzzlePlan } from '../../scripts/browser-inspection/puzzle-inspection.mjs';
import { inspectEaRatingDifferential } from '../../scripts/browser-inspection/ea-rating-differential.mjs';
import { inspectEaChemistryDifferential } from '../../scripts/browser-inspection/ea-chemistry-differential.mjs';
import { inspectEaRequirementDifferential } from '../../scripts/browser-inspection/ea-requirement-differential.mjs';

vi.mock('../../scripts/browser-inspection/ea-rating-differential.mjs', () => ({ inspectEaRatingDifferential: vi.fn() }));
vi.mock('../../scripts/browser-inspection/ea-chemistry-differential.mjs', () => ({ inspectEaChemistryDifferential: vi.fn() }));
vi.mock('../../scripts/browser-inspection/ea-requirement-differential.mjs', () => ({ inspectEaRequirementDifferential: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  inspectEaRatingDifferential.mockResolvedValue({ status: 'unverified' });
  inspectEaChemistryDifferential.mockResolvedValue({ status: 'unverified', chemistryVerified: false });
  inspectEaRequirementDifferential.mockResolvedValue({ status: 'unverified', requirementsVerified: false });
});

it('builds the read-only Puzzle exact validation probe without write calls', async () => {
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: vi.fn(async source => {
      expect(source).toContain('createFc27ClubReadTransport');
      expect(source).toContain('validateFc27PuzzleSelection');
      expect(source).toContain('readPage');
      expect(source).toContain('probeFc27TeamFactsRuntime');
      expect(source).toContain('report.eaTeamFactsProbe');
      // Club search is a read-only POST, so the native body setter is expected.
      expect(source).not.toMatch(/saveChallenge|submitChallenge|buyNowItem|playerListFillSquad/);
      return { report: { status: 'preview', reason: 'READ_ONLY_PLAN', liveExecutionEnabled: false }, transient: null };
    }) };
  await expect(inspectPuzzlePlan(page, 19, 43)).resolves.toMatchObject({ status: 'preview', reason: 'READ_ONLY_PLAN' });
  expect(page.evaluate).toHaveBeenCalledTimes(2);
});

it('rejects malformed IDs before constructing a browser probe', async () => {
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', evaluate: vi.fn() };
  await expect(inspectPuzzlePlan(page, 0, 43)).rejects.toThrow('FC27_PUZZLE_ID_INVALID');
  expect(page.evaluate).not.toHaveBeenCalled();
});

it.each(['verified', 'unverified'])('discards temporary player attributes after chemistry %s', async status => {
  const transient = { squad: [{ nationId: 123, privateSentinel: 'never-write-this' }] };
  const report = { status: 'preview', reason: 'READ_ONLY_PLAN', executable: false, liveExecutionEnabled: false,
    plan: { exactValidation: { status: 'verified' } } };
  inspectEaRatingDifferential.mockResolvedValue({ status: 'verified' });
  inspectEaChemistryDifferential.mockResolvedValue({ status, executable: false, chemistryVerified: status === 'verified' });
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: vi.fn(async () => ({ report, transient })) };
  const result = await inspectPuzzlePlan(page, 19, 43);
  expect(inspectEaChemistryDifferential).toHaveBeenCalledExactlyOnceWith(report, transient);
  expect(inspectEaRequirementDifferential).toHaveBeenCalledWith(expect.objectContaining({
    eaChemistryDifferential: expect.objectContaining({ status }),
  }), transient);
  expect(result.eaChemistryDifferential.status).toBe(status);
  expect(JSON.stringify(result)).not.toMatch(/transient|squad|nationId|never-write-this/);
});

it.each([true, false])('only clears team-facts Pending after all checks agree and EA accepts the plan: %s', async eaOverall => {
  const report = { status: 'preview', reason: 'READ_ONLY_PLAN', executable: false, liveExecutionEnabled: false,
    pending: ['EA_TEAM_FACTS_DIFFERENTIAL', 'PUZZLE_FILL_TRANSACTION'] };
  inspectEaRatingDifferential.mockResolvedValue({ status: 'verified' });
  inspectEaChemistryDifferential.mockResolvedValue({ status: 'verified' });
  inspectEaRequirementDifferential.mockResolvedValue({ status: 'verified', eaOverall });
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: vi.fn(async () => ({ report, transient: null })) };
  const result = await inspectPuzzlePlan(page, 19, 43);
  expect(result.pending.includes('EA_TEAM_FACTS_DIFFERENTIAL')).toBe(!eaOverall);
  expect(result.pending).toContain('PUZZLE_FILL_TRANSACTION');
  expect(result.executable).toBe(false);
  expect(page.evaluate.mock.calls[1][0]).toContain('eaRequirementDifferential');
});

it('does not compare chemistry when the rating prerequisite fails', async () => {
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: vi.fn(async () => ({ report: { status: 'blocked' }, transient: { privateSentinel: 'never-write-this' } })) };
  expect(await inspectPuzzlePlan(page, 19, 43)).toMatchObject({ status: 'blocked', eaChemistryDifferential: {
    reason: 'FC27_EA_CHEMISTRY_RATING_PREREQUISITE', executable: false } });
  expect(inspectEaChemistryDifferential).not.toHaveBeenCalled();
});

it('rejects a malformed envelope without returning its transient attributes', async () => {
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: vi.fn(async () => ({ report: null, transient: { privateSentinel: 'never-write-this' } })) };
  const result = await inspectPuzzlePlan(page, 19, 43);
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_REPORT_UNAVAILABLE', executable: false });
  expect(JSON.stringify(result)).not.toMatch(/never-write-this|transient/);
});
