import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { previewFc27RunnerSquad } from '../../src/adapters/ea/fc27-fsu-read.js';
import { inspectFc27ChallengeCatalog } from '../../src/adapters/ea/fc27-challenge-catalog.js';
import { inspectInProgressSquad } from '../../src/adapters/ea/fc27-sbc-read.js';

vi.mock('../../src/adapters/ea/fc27-challenge-catalog.js', () => ({ inspectFc27ChallengeCatalog: vi.fn() }));
vi.mock('../../src/adapters/ea/fc27-sbc-read.js', () => ({ inspectInProgressSquad: vi.fn() }));
function fixture() {
  const club = { sku: 'test-27', year: 2027, platform: 'pc' };
  const persona = { id: 902, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 901, selectedPersona: persona.id, _personas: { _collection: { [persona.id]: persona } } };
  const player = { id: 101, definitionId: 201, type: 'player', _rating: 61, _rareflag: 0,
    utasPile: 7, state: 'free', tradable: false, loans: -1, limitedUseType: 0, upgrades: null,
    concept: false, cosmetics: [], _hyperCosmeticDTOs: {}, leagueId: 10, startTime: -1, endTime: -1,
    _auction: { _tradeState: 'inactive' } };
  const forbidden = vi.fn(() => { throw new Error('no writes'); });
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27,
    ItemType: { PLAYER: 'player' }, ItemPile: { CLUB: 7, EVOLUTION: 11 },
    ItemRarity: { NONE: 0, RARE: 1 }, LimitedUseType: { NONE: 0 },
    AuctionTradeStateEnum: { INACTIVE: 'inactive', ACTIVE: 'active' },
    SBCEligibilityKey: { PLAYER_MIN_OVR: 26, PLAYER_MAX_OVR: 28, PLAYER_QUALITY: 3 },
    SBCEligibilityScope: { GREATER: 0, EXACT: 2 }, SBCEligibilityQualityType: { BRONZE: 1, SILVER: 2, GOLD: 3 },
    services: { User: { currentUserId: 901, repository: { _collection: { 901: user } } },
      SBC: { repository: { sets: { _collection: {} } }, saveChallenge: forbidden, submitChallenge: forbidden } },
    repositories: { Item: { club: { items: { _collection: {
      101: player, 102: { ...player, id: 102, definitionId: 202, _rating: 62 },
    } } } } },
    info: { base: { year: 27, initialized: true, state: false, clubCache: { status: 'trusted-provisional' } },
      build: { untradeable: true, academy: false, league: true, firststorage: true },
      set: { goldenrange: 83, shield_league: [20] } },
    events: { validateClubPlayers: forbidden, oneFillCreationGF: forbidden, playerListFillSquad: forbidden } };
  return { root, player, forbidden };
}
const catalog = () => ({ status: 'observed', setId: 4, setName: 'Synthetic upgrade', challenges: [{
  id: 16, setId: 4, status: 'IN_PROGRESS', eligibilityOperation: 'AND', type: 'OPEN_CHALLENGE',
  requirements: [{ count: -1, scope: 2, pairs: [{ key: 3, values: [1] }] }], rewards: [],
}] });
const layout = () => ({ status: 'observed', setId: 4, challengeId: 16, slotCount: 11, requiredPlayerCount: 2,
  simpleBrickIndices: [0, 1, 4, 5, 6, 7, 8, 9, 10], customBrickIndices: [] });
beforeEach(() => {
  vi.clearAllMocks();
  inspectFc27ChallengeCatalog.mockResolvedValue(catalog());
  inspectInProgressSquad.mockResolvedValue(layout());
});

it('uses original FSU and a stricter temporary low-value policy without writes or full-inventory claims', async () => {
  const { root, forbidden } = fixture();
  const before = JSON.stringify(root.info);
  const result = await previewFc27RunnerSquad(root, { setId: 4 });
  expect(result).toMatchObject({ status: 'preview', reason: 'READ_ONLY_PLAN', liveExecutionEnabled: false,
    inventory: { cachedPlayers: 2, complete: false, status: 'provisional' },
    policy: { maxRating: 74, onlyUntradeable: true, excludeEvolution: true, excludedLeagueCount: 1 },
    plan: { required: 2, selectedCount: 2, ratings: [61, 62], slots: [2, 3], uniqueDefinitions: true } });
  expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(root.info)).toBe(before);
  expect(JSON.stringify(result)).not.toMatch(/901|902|101|102|201|202|accountScope|definitionId/);
});

it.each([74, 83])('does not relax original league protection or accept unknown safety attributes at cap %s', async maxRating => {
  for (const mutate of [
    x => { x.player.leagueId = 20; }, x => { x.player.upgrades = undefined; },
    x => { x.player.tradable = true; }, x => { x.player.loans = 0; },
    x => { x.player._rating = 85; }, x => { x.player._rareflag = 3; },
    x => { delete x.player._auction; },
  ]) {
    const value = fixture(); mutate(value);
    expect((await previewFc27RunnerSquad(value.root, { setId: 4, maxRating })).reason).toBe('SAFE_MATERIAL_SHORTAGE');
    expect(value.forbidden).not.toHaveBeenCalled();
  }
}, 15000);

it('never reads a squad for an unstarted or ambiguous catalog challenge', async () => {
  for (const change of [c => { c.challenges[0].status = 'NOT_STARTED'; }, c => { c.challenges.push(c.challenges[0]); }]) {
    const current = catalog(); change(current); inspectFc27ChallengeCatalog.mockResolvedValue(current);
    expect((await previewFc27RunnerSquad(fixture().root, { setId: 4 })).reason).toBe('FC27_SINGLE_IN_PROGRESS_CHALLENGE_REQUIRED');
  }
  expect(inspectInProgressSquad).not.toHaveBeenCalled();
});

it('stops on policy/context changes across the GETs and does not use a stale selection', async () => {
  for (const change of [root => { root.info.set.shield_league.push(10); }, root => { root.services.User.currentUserId = 999; }]) {
    const { root } = fixture();
    inspectInProgressSquad.mockImplementationOnce(async () => { change(root); return layout(); });
    expect((await previewFc27RunnerSquad(root, { setId: 4 })).reason).toBe('FC27_RUNNER_INPUTS_CHANGED');
  }
});

it('preserves GET failure and never ignores an unsupported chemistry condition', async () => {
  inspectFc27ChallengeCatalog.mockResolvedValueOnce({ status: 'blocked', reason: 'FC27_CATALOG_READ_TIMEOUT', liveExecutionEnabled: false });
  expect((await previewFc27RunnerSquad(fixture().root, { setId: 4 })).reason).toBe('FC27_CATALOG_READ_TIMEOUT');
  expect(inspectInProgressSquad).not.toHaveBeenCalled();
  const current = catalog(); current.challenges[0].requirements.push({ count: 2, scope: 0, pairs: [{ key: 99, values: [10] }] });
  inspectFc27ChallengeCatalog.mockResolvedValueOnce(current);
  expect((await previewFc27RunnerSquad(fixture().root, { setId: 4 })).reason).toBe('FC27_REQUIREMENT_UNSUPPORTED');
});

it('requires an explicit 83-point preview and keeps the default at 74 without persisting settings', async () => {
  const { root, player, forbidden } = fixture();
  const gold = catalog(); gold.challenges[0].requirements[0].pairs[0].values = [3];
  inspectFc27ChallengeCatalog.mockResolvedValue(gold);
  player._rating = 82;
  root.repositories.Item.club.items._collection[102]._rating = 83;
  const before = JSON.stringify(root.info);
  expect((await previewFc27RunnerSquad(root, { setId: 4 })).reason).toBe('SAFE_MATERIAL_SHORTAGE');
  const result = await previewFc27RunnerSquad(root, { setId: 4, maxRating: 83 });
  expect(result).toMatchObject({ status: 'preview', liveExecutionEnabled: false,
    policy: { maxRating: 83, onlyUntradeable: true, excludedLeagueCount: 1 }, plan: { ratings: [82, 83] } });
  expect(JSON.stringify(root.info)).toBe(before);
  expect(forbidden).not.toHaveBeenCalled();
});

it('intersects the approved 83-point preview with a lower FSU gold limit', async () => {
  const { root, player } = fixture();
  const gold = catalog(); gold.challenges[0].requirements[0].pairs[0].values = [3];
  inspectFc27ChallengeCatalog.mockResolvedValue(gold);
  root.info.set.goldenrange = 81;
  player._rating = 81;
  root.repositories.Item.club.items._collection[102]._rating = 82;
  expect(await previewFc27RunnerSquad(root, { setId: 4, maxRating: 83 })).toMatchObject({
    reason: 'SAFE_MATERIAL_SHORTAGE', policy: { maxRating: 81 }, plan: { safeCandidates: 1 },
  });
});

it('does not accept unapproved preview caps or read EA before rejecting them', async () => {
  for (const maxRating of [0, 75, 84, 99, null, '83']) {
    expect((await previewFc27RunnerSquad(fixture().root, { setId: 4, maxRating })).reason).toBe('FC27_PREVIEW_POLICY_UNAPPROVED');
  }
  expect(inspectFc27ChallengeCatalog).not.toHaveBeenCalled();
});

it('replays the observed Gold Upgrade rule and rejection totals using synthetic players, not real inventory', async () => {
  const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-original-fsu-runner-observation.json', import.meta.url), 'utf8')).goldPreview;
  const { root, player, forbidden } = fixture();
  const syntheticPlayers = Array.from({ length: 41 }, (_, index) => ({ ...player,
    id: 1000 + index, definitionId: 2000 + index, _rating: index < 25 ? 74 : 75,
    tradable: index >= 25 && index < 28, leagueId: index >= 28 && index < 36 ? 20 : 10,
  }));
  root.repositories.Item.club.items._collection = Object.fromEntries(syntheticPlayers.map(item => [item.id, item]));
  inspectFc27ChallengeCatalog.mockResolvedValue({ status: 'observed', setId: observed.setId, setName: observed.name,
    challenges: [{ id: observed.challengeId, setId: observed.setId, status: observed.challengeStatus,
      eligibilityOperation: observed.eligibilityOperation, requirements: observed.requirements }] });
  inspectInProgressSquad.mockResolvedValue({ status: 'observed', setId: observed.setId,
    challengeId: observed.challengeId, ...observed.layout });
  const before = JSON.stringify(root);
  const result = await previewFc27RunnerSquad(root, { setId: observed.setId, maxRating: observed.previewMaxRating });
  const { status, reason, ...plan } = observed.result;
  expect(result).toMatchObject({ status, reason, plan, inventory: observed.inventory, liveExecutionEnabled: false });
  expect(JSON.stringify(root)).toBe(before);
  expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/accountScope|definitionId|fingerprint|1000|2000/);
});

it('connects original-FSU fields to a full read-only Gold plan using synthetic sufficient inventory', async () => {
  const observed = JSON.parse(readFileSync(new URL('../fixtures/fc27-original-fsu-runner-observation.json', import.meta.url), 'utf8')).goldPreview;
  const { root, player, forbidden } = fixture();
  const players = Array.from({ length: 11 }, (_, index) => ({ ...player,
    id: 1000 + index, definitionId: 2000 + index, _rating: 75 + index % 9 }));
  root.repositories.Item.club.items._collection = Object.fromEntries(players.map(item => [item.id, item]));
  inspectFc27ChallengeCatalog.mockResolvedValue({ status: 'observed', setId: observed.setId, setName: observed.name,
    challenges: [{ id: observed.challengeId, setId: observed.setId, status: observed.challengeStatus,
      eligibilityOperation: observed.eligibilityOperation, requirements: observed.requirements }] });
  inspectInProgressSquad.mockResolvedValue({ status: 'observed', setId: observed.setId,
    challengeId: observed.challengeId, ...observed.layout });
  const before = JSON.stringify(root);
  const result = await previewFc27RunnerSquad(root, { setId: observed.setId, maxRating: 83 });
  expect(result).toMatchObject({ status: 'preview', liveExecutionEnabled: false,
    inventory: { complete: false, status: 'provisional', cachedPlayers: 11 },
    plan: { required: 11, selectedCount: 11, uniqueDefinitions: true,
      slots: Array.from({ length: 11 }, (_, index) => index), ratings: [75, 75, 76, 76, 77, 78, 79, 80, 81, 82, 83] } });
  expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(root)).toBe(before);
  expect(JSON.stringify(result)).not.toMatch(/accountScope|definitionId|fingerprint|1000|2000/);
});
