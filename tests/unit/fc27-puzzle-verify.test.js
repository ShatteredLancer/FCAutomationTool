import { beforeEach, expect, it, vi } from 'vitest';
import { inspectFc27VerifiedPuzzlePlan } from '../../src/adapters/ea/fc27-puzzle-verify.js';
import { inspectFc27PuzzlePlan, readFc27PuzzleClubLinks, readFc27PuzzleChemistry } from '../../src/adapters/ea/fc27-puzzle-read.js';
import { createFc27ClubReadTransport } from '../../src/adapters/ea/fc27-club-read.js';
import { readFc27Context, readFc27CachedClub } from '../../src/adapters/ea/fc27-local-read.js';
import { readFc27PuzzlePolicy } from '../../src/adapters/ea/fc27-fsu-read.js';
import { marketFixture } from '../helpers/fc27-market-fixture.js';

vi.mock('../../src/adapters/ea/fc27-puzzle-read.js', async importOriginal => ({ ...await importOriginal(),
  inspectFc27PuzzlePlan: vi.fn(), readFc27PuzzleClubLinks: vi.fn(), readFc27PuzzleChemistry: vi.fn() }));
vi.mock('../../src/adapters/ea/fc27-club-read.js', () => ({ createFc27ClubReadTransport: vi.fn() }));
vi.mock('../../src/adapters/ea/fc27-local-read.js', () => ({ readFc27Context: vi.fn(), readFc27CachedClub: vi.fn() }));
vi.mock('../../src/adapters/ea/fc27-fsu-read.js', () => ({ readFc27PuzzlePolicy: vi.fn() }));

let input; let readPage;
beforeEach(() => {
  vi.resetAllMocks(); input = marketFixture(); input.policy.onlyUntradeable = true;
  input.inventory.items.push({ ...input.inventory.items[0], id: 3, definitionId: 103 });
  input.inventory.items.forEach(item => { item.state = 'free'; });
  readFc27Context.mockImplementation(() => input.context);
  readFc27PuzzlePolicy.mockImplementation(() => input.policy);
  readFc27CachedClub.mockImplementation(() => ({ items: input.inventory.items }));
  readFc27PuzzleClubLinks.mockImplementation(() => input.clubLinks);
  readFc27PuzzleChemistry.mockReturnValue(null);
  readPage = vi.fn(async () => structuredClone(input.inventory.items));
  createFc27ClubReadTransport.mockResolvedValue({ readPage });
  inspectFc27PuzzlePlan.mockImplementation(async (_root, options, callback) => {
    const plan = await callback(input);
    return { status: plan.status, reason: plan.reason, setId: options.setId, challengeId: options.challengeId,
      liveExecutionEnabled: false, plan: { selectedCount: plan.selected.length, exactValidation: plan.exactValidation },
      pending: ['EA_TEAM_FACTS_DIFFERENTIAL', 'EXACT_ITEM_VALIDATION', 'PUZZLE_FILL_TRANSACTION'] };
  });
});

it('checks the precise selected refs once and leaves EA comparison and writes pending', async () => {
  const report = await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 });
  expect(report).toMatchObject({ status: 'preview', executable: false,
    plan: { selectedCount: 3, exactValidation: { status: 'verified', presentCount: 3 } } });
  expect(readPage).toHaveBeenCalledExactlyOnceWith({ start: 0, count: 250, definitionIds: [101, 102, 103] });
  expect(report.pending).toEqual(['EA_TEAM_FACTS_DIFFERENTIAL', 'PUZZLE_FILL_TRANSACTION']);
  expect(JSON.stringify(report)).not.toMatch(/definitionId|accountScope|selectedFacts/);
});

it.each(['missing', 'wrong-version', 'same-version-other-item', 'changed-position', 'duplicate-response'])('blocks %s without substituting materials', async kind => {
  readPage.mockImplementation(async () => {
    const fresh = structuredClone(input.inventory.items);
    if (kind === 'missing') fresh.pop();
    if (kind === 'wrong-version') fresh[0].definitionId = 999;
    if (kind === 'same-version-other-item') fresh[0].id = 999;
    if (kind === 'changed-position') fresh[0].positions = [7];
    if (kind === 'duplicate-response') fresh.push(fresh[0]);
    return fresh;
  });
  expect(await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 })).toMatchObject({ status: 'blocked',
    reason: 'FC27_EXACT_ITEMS_CHANGED', plan: { selectedCount: 0, exactValidation: { status: 'blocked' } } });
  expect(readPage).toHaveBeenCalledOnce();
});

it.each(['policy', 'inventory', 'chemistry', 'club-links'])('rejects %s drift during the targeted read', async kind => {
  readPage.mockImplementation(async () => {
    const fresh = structuredClone(input.inventory.items);
    if (kind === 'policy') input.policy.maxRating = 83;
    if (kind === 'inventory') input.inventory.items.pop();
    if (kind === 'chemistry') readFc27PuzzleChemistry.mockReturnValue({ changed: true });
    if (kind === 'club-links') input.clubLinks.links.push([2, 1]);
    return fresh;
  });
  const report = await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 });
  expect(report).toMatchObject({ status: 'blocked', reason: 'FC27_RUNNER_INPUTS_CHANGED', plan: { selectedCount: 0 } });
});

it('does not query Club when the baseline has no plan', async () => {
  input.inventory.items.pop();
  expect(await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 })).toMatchObject({ status: 'blocked', reason: 'SAFE_MATERIAL_SHORTAGE' });
  expect(createFc27ClubReadTransport).not.toHaveBeenCalled();
});

it('retains a bounded error and never retries or exports raw exceptions', async () => {
  readPage.mockRejectedValue(new Error('FC27_CLUB_HTTP_429'));
  expect(await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 })).toMatchObject({
    status: 'blocked', reason: 'FC27_CLUB_HTTP_429', plan: { selectedCount: 0 } });
  expect(readPage).toHaveBeenCalledOnce();
  readPage.mockRejectedValue(new Error('private raw payload'));
  const report = await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 });
  expect(report.reason).toBe('FC27_PUZZLE_EXACT_CHECK_UNAVAILABLE');
  expect(JSON.stringify(report)).not.toContain('private');
});

it('passes only detached selected attributes to the optional inspection callback', async () => {
  input.challenge.formation = { id: 16, positions: Array(11).fill(5) };
  input.inventory.items.forEach(item => { item.privateSentinel = 'private'; });
  const before = structuredClone(input);
  const callback = vi.fn(value => {
    expect(value.squad).toHaveLength(11);
    expect(value.squad.filter(Boolean)).toHaveLength(3);
    expect(Object.keys(value.squad.find(Boolean))).toEqual(['type', 'rating', 'rarity', 'nationId',
      'leagueId', 'teamId', 'positions', 'groups', 'special', 'evolution', 'cosmetic', 'concept', 'academyEnrolled']);
    expect(value.requirements).toEqual(input.challenge.rawRequirements);
    expect(value.clubLinks).toEqual(input.clubLinks);
    expect(JSON.stringify(value)).not.toMatch(/definitionId|accountScope|privateSentinel/);
    value.squad.find(Boolean).positions.push(7);
    value.formation.positions[0] = 7;
  });
  const report = await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 }, callback);
  expect(report).toMatchObject({ status: 'preview', plan: { exactValidation: { status: 'verified' } } });
  expect(callback).toHaveBeenCalledOnce();
  expect(input).toEqual(before);
  expect(JSON.stringify(report)).not.toMatch(/nationId|privateSentinel|definitionId/);
});

it('does not expose selected attributes when exact rechecking fails', async () => {
  readPage.mockResolvedValue([]);
  const callback = vi.fn();
  expect(await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 }, callback))
    .toMatchObject({ status: 'blocked', reason: 'FC27_EXACT_ITEMS_CHANGED' });
  expect(callback).not.toHaveBeenCalled();
});

it('blocks input drift or callback failure without exporting the transient payload', async () => {
  const report = await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 }, () => {
    input.inventory.items[0].rating = 61;
  });
  expect(report).toMatchObject({ status: 'blocked', reason: 'FC27_RUNNER_INPUTS_CHANGED' });
  const failed = await inspectFc27VerifiedPuzzlePlan({}, { setId: 19, challengeId: 43 }, () => {
    throw new Error('secret payload');
  });
  expect(failed).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_EXACT_CHECK_UNAVAILABLE' });
  expect(JSON.stringify([report, failed])).not.toMatch(/nationId|secret|definitionId/);
});
