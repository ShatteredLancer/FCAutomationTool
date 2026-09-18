import { expect, it, vi } from 'vitest';
import { readFc27Context, readFc27CachedClub } from '../../src/adapters/ea/fc27-local-read.js';
import { createNativeRunnerSupport, inspectNativeRunnerSupport } from '../../FSU_mod/src/runner-support/native-provider.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { previewTraditionalSquad } from '../../src/fc27/traditional-preview.js';
import { inspectNativeProvider } from '../../scripts/browser-inspection/native-provider.mjs';
import vm from 'node:vm';

function fixture() {
  const player = { id: 101, definitionId: 201, type: 'player', _rating: 71, _rareflag: 0,
    utasPile: 7, state: 'free', tradable: false, loans: -1, limitedUseType: 0, upgrades: null,
    concept: false, cosmetics: [], _hyperCosmeticDTOs: {}, leagueId: 10, startTime: -1, endTime: -1 };
  const club = { sku: 'synthetic-27-ps', year: 2027, platform: 'PSN' };
  const persona = { id: 9002, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 9001, selectedPersona: persona.id, _personas: { _collection: { [persona.id]: persona } } };
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27,
    ItemType: { PLAYER: 'player' }, ItemPile: { CLUB: 7, EVOLUTION: 11 },
    ItemRarity: { NONE: 0, RARE: 1 }, LimitedUseType: { NONE: 0 },
    services: { User: { currentUserId: user.id, repository: { _collection: { [user.id]: user } } } },
    repositories: { Item: { club: { items: { _collection: { 101: player } } } } } };
  return { root, player, user, persona, club };
}

it('resolves the exact selected persona/sku/year without methods, getters or default scopes', () => {
  const { root, user, persona, club } = fixture();
  const forbidden = vi.fn(() => { throw new Error('no accessors'); });
  Object.defineProperty(persona, 'sku', { get: forbidden });
  Object.defineProperty(user, 'personas', { get: forbidden });
  root.services.User.getUser = forbidden;
  expect(readFc27Context(root)).toMatchObject({ season: '27', accountScope: 'ea:9001:9002', platform: 'PSN:synthetic-27-ps' });
  club.year = 2026;
  expect(() => readFc27Context(root)).toThrow('FC27_CONTEXT_UNAVAILABLE');
  expect(forbidden).not.toHaveBeenCalled();
});

it('keeps cached inventory partial and preserves unknown safety flags', () => {
  const { root } = fixture();
  const result = readFc27CachedClub(root);
  expect(result).toMatchObject({ status: 'partial', complete: false, kind: 'cached-club-inspection', liveExecutionEnabled: false });
  expect(result.items[0]).toMatchObject({ id: 101, definitionId: 201, rating: 71, special: false,
    evolution: false, cosmetic: false, academyEnrolled: false, tradeable: false,
    limitedUse: false, loans: -1, activeTrade: null, locked: null, protected: null });
  expect(result.items[0].safetyFingerprint).toEqual(expect.any(String));
});

it('does not use backing ratings for upgraded items or materialize evolution pile as ordinary Club', () => {
  const { root, player } = fixture();
  player.upgrades = { rating: 93, rarity: 123, enrolled: true };
  player.utasPile = 11;
  const item = readFc27CachedClub(root).items[0];
  expect(item).toMatchObject({ rating: null, special: null, evolution: true, academyEnrolled: true, pile: null });
});

it('excludes non-players and rejects missing, duplicate and conflicting identities', () => {
  const { root, player } = fixture();
  const items = root.repositories.Item.club.items._collection;
  items[102] = { ...player, id: 102, type: 'badge', _rating: 99 };
  expect(readFc27CachedClub(root).items).toHaveLength(1);
  items[103] = { ...player };
  expect(() => readFc27CachedClub(root)).toThrow('FC27_CACHED_ITEM_IDENTITY_CONFLICT');
  delete items[103];
  player.definitionId = undefined;
  expect(() => readFc27CachedClub(root)).toThrow('FC27_CACHED_ITEM_IDENTITY_CONFLICT');
});

it('never invokes inventory getters or assumes missing safety fields are safe', () => {
  const { root, player } = fixture();
  const forbidden = vi.fn(() => { throw new Error('private'); });
  for (const key of ['rating', 'rareflag', 'pile']) Object.defineProperty(player, key, { get: forbidden });
  delete player.upgrades;
  delete player.cosmetics;
  delete player.loans;
  expect(readFc27CachedClub(root).items[0]).toMatchObject({ rating: null, special: null, evolution: null, cosmetic: null, loans: null });
  expect(forbidden).not.toHaveBeenCalled();
});

it('fingerprints ordinary rarity changes and reads only explicit auction/state evidence', () => {
  const { root, player } = fixture();
  const before = readFc27CachedClub(root).items[0];
  player._rareflag = 1;
  const rare = readFc27CachedClub(root).items[0];
  expect(rare.special).toBe(false);
  expect(rare.rarity).toBe(1);
  expect(rare.safetyFingerprint).not.toBe(before.safetyFingerprint);
  root.AuctionTradeStateEnum = { INACTIVE: 'inactive', ACTIVE: 'active' };
  player._auction = { _tradeState: 'inactive' };
  expect(readFc27CachedClub(root).items[0].activeTrade).toBe(false);
  player._auction._tradeState = 'active';
  expect(readFc27CachedClub(root).items[0].activeTrade).toBe(true);
  player._auction._tradeState = 'unknown';
  expect(readFc27CachedClub(root).items[0].activeTrade).toBeNull();
});

it('reads observed EA market average as display-only metadata, never as a safety or bid price', () => {
  const { root, player } = fixture();
  const initial = readFc27CachedClub(root).items[0];
  expect(initial.marketAverage).toBeNull();
  player._marketAverage = 500;
  const current = readFc27CachedClub(root).items[0];
  expect(current.marketAverage).toBe(500);
  expect(current.safetyFingerprint).toBe(initial.safetyFingerprint);
  player._marketAverage = -1;
  expect(readFc27CachedClub(root).items[0].marketAverage).toBeNull();
});

it('wires synchronous GM reads to scoped core policy without importing old settings or exposing storage', () => {
  const { root } = fixture();
  const gmGetValue = vi.fn((_key, fallback) => fallback);
  const provider = createNativeRunnerSupport({ root, gmGetValue });
  expect(provider.bridge.describe()).toMatchObject({ status: 'not-ready', capabilities: { club: false, targetedValidation: false, policy: false } });
  expect(provider.readCachedClub().status).toBe('partial');
  const scope = readFc27Context(root);
  expect(gmGetValue.mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([
    contextKey(scope, 'fsu-policy'), contextKey(scope, 'fsu-locks'),
  ]));
  expect(gmGetValue.mock.calls.flat()).not.toEqual(expect.arrayContaining(['build', 'set', 'lock_26']));
  expect(provider.bridge.getValue).toBeUndefined();
});

it('refuses to certify native cached inventory even with reviewed policy and detects account switches', () => {
  const { root, user } = fixture();
  const gmGetValue = vi.fn(key => key.includes('fsu-policy') ? JSON.stringify({ schema: 1, reviewed: true, policy: {
    onlyUntradeable: true, excludeEvolution: true, protectFsuLockedPlayers: false, protectActiveSquad: false,
    storageFirst: true, goldRange: [75, 80], maxRating: 74, excludedLeagueIds: [],
  } }) : null);
  const provider = createNativeRunnerSupport({ root, gmGetValue });
  expect(provider.bridge.describe()).toMatchObject({ status: 'not-ready', capabilities: { policy: true, club: false } });
  user.selectedPersona = 9003;
  expect(provider.bridge.getPolicy()).toBeNull();
  expect(() => provider.readCachedClub()).toThrow('FC27_CONTEXT_UNAVAILABLE');
});

it('keeps partial cache distinct from the planners normalized inventory contract', () => {
  const { root } = fixture();
  const inventory = readFc27CachedClub(root);
  const context = inventory.context;
  const challenge = { schema: 1, context, mechanism: 'traditional', requirementsOperation: 'AND',
    setId: 1, id: 2, completed: false, requirements: [{ kind: 'player-count', count: 1 }], slotCount: 1, brickIndices: [] };
  const policy = { schema: 1, context, reviewed: true, onlyUntradeable: true, protectFsuLockedPlayers: false,
    protectActiveSquad: false, storageFirst: true, maxRating: 74, goldRange: [75, 80], excludedLeagueIds: [] };
  expect(previewTraditionalSquad({ context, inventory, challenge, policy }).reason).toBe('INVENTORY_UNVERIFIED');
});

it('exports only aggregate facts and no refs, raw account identities or GM storage', () => {
  const { root } = fixture();
  const report = inspectNativeRunnerSupport(root);
  expect(report).toMatchObject({ contextMatched: true, complete: false, cachedEntries: 1, cachedPlayers: 1,
    gmPolicyVerified: false, targetedValidationVerified: false, liveExecutionEnabled: false });
  expect(JSON.stringify(report)).not.toMatch(/9001|9002|101|201|ea:|accountScope|synthetic|items|fingerprint/i);
});

it('runs the actual isolated bundle without installing globals or exposing raw inventory', async () => {
  const { root } = fixture();
  const sandbox = vm.createContext(root);
  const page = { url: () => 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/',
    evaluate: vi.fn(async source => vm.runInContext(source, sandbox)) };
  // Create repository collections inside the browser realm, like real EA models.
  vm.runInContext('repositories = JSON.parse(JSON.stringify(repositories))', sandbox);
  expect(await inspectNativeProvider(page)).toMatchObject({ status: 'observed', cachedPlayers: 1, liveExecutionEnabled: false });
  expect(sandbox.FSURunnerSupportCore).toBeUndefined();
  page.url = () => 'https://example.com/';
  expect((await inspectNativeProvider(page)).reason).toBe('WEB_APP_REQUIRED');
  expect(page.evaluate).toHaveBeenCalledTimes(1);
});
