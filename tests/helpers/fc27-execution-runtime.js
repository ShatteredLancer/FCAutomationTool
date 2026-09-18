import { vi } from 'vitest';
import { FC27_CLUB_READ_METHODS } from '../../src/adapters/ea/fc27-club-read.js';
import { FC27_SBC_EXECUTION_METHODS, FC27_SBC_CACHE_METHODS } from '../../src/adapters/ea/fc27-traditional-provider.js';

export function executionRuntime() {
  const calls = [];
  const players = Array.from({ length: 11 }, (_, index) => ({ id: index + 1, resourceId: index + 101 }));
  const set = { id: 4, name: 'Synthetic upgrade', challengesCount: 1, challengesCompletedCount: 0,
    timesCompleted: 0, repeats: 0, repeatabilityMode: 'UNLIMITED', startTime: 0, endTime: 0,
    awards: [{ type: 'pack', value: 509, count: 1, tradable: false }] };
  const challenge = { id: 16, setId: 4, name: set.name, status: 'IN_PROGRESS', type: 'OPEN_CHALLENGE',
    eligibilityOperation: 'AND', eligibilityRequirements: [{ count: -1, scope: 2, kvPairs: { _collection: { 3: [1] } } }], awards: [] };
  const state = { players, saved: null, packCount: 3, unassigned: [], submitStatus: 200, timeout: false, wrongOwner: false };
  const ok = response => ({ success: true, status: 200, response });
  const observable = response => ({ observe(_owner, callback) { callback(this, response); }, unobserve() {} });
  class EAHttpRequest {
    setRequestBody(body) { this.requestBody = body; }
    send() { throw new Error('never use base send'); }
    abort() { calls.push({ kind: 'abort' }); }
    observe(_owner, callback) { this.callback = callback; }
    unobserve() {}
  }
  class UTHttpRequest extends EAHttpRequest {
    setPath(path) { this.url = `https://utas.test.ea.com${path}`; }
    send() {
      calls.push({ kind: 'request', method: this.requestType, url: this.url, body: this.requestBody,
        retry: this.doRetry, reauth: this.doReauth });
      if (state.timeout) return;
      let response;
      if (this.url.endsWith('/club')) response = ok({ itemData: state.players });
      else if (this.url.endsWith('/purchased/items')) response = ok({ itemData: state.unassigned });
      else if (this.url.endsWith('/store/purchaseGroup/all')) response = ok({ purchase: [{ id: 509, displayGroup: { value: 'mypacks' },
        packType: 'CARDPACK', untradeable: true, quantity: state.packCount }] });
      else if (this.url.endsWith('/squad')) { state.saved = this.requestBody.players; response = ok({}); }
      else if (this.url.endsWith('?skipUserSquadValidation=false')) {
        response = state.submitStatus === 200 ? ok({ setId: 4, challengeId: 16 })
          : { success: false, status: state.submitStatus, response: {} };
        if (state.submitStatus === 200) { state.players = []; set.timesCompleted++; state.packCount++; }
      } else throw new Error('unreviewed request');
      this.callback(state.wrongOwner ? {} : this, response);
    }
  }
  class UTItemEntityFactory {
    createItem(data) {
      return { ...data, definitionId: data.resourceId, type: 'player', utasPile: 7, _rating: 60, _rareflag: 0,
        upgrades: null, concept: false, cosmetics: [], _hyperCosmeticDTOs: {}, leagueId: 10,
        startTime: -1, endTime: -1, loans: -1, limitedUseType: 0, tradable: false,
        state: 'free', _auction: { _tradeState: 'inactive' } };
    }
  }
  const itemFactory = new UTItemEntityFactory();
  class UTItemRepository {
    constructor() { this._collection = Object.fromEntries(players.map(item => [item.id, itemFactory.createItem(item)])); }
    remove(id) { delete this._collection[id]; }
  }
  class UTClubRepository {
    constructor() { this.items = new UTItemRepository(); }
    resetStatsCacheTimestamp() { this.statsCacheTimestamp = 0; }
  }
  class UTSquadBuildingChallengeDAO {
    constructor() { this.authDelegate = {}; }
    getSets() { calls.push({ kind: 'sets' }); return observable(ok({ sets: [set] })); }
    getChallengesForSet() { calls.push({ kind: 'challenges' }); return observable(ok({ challenges: [challenge] })); }
    loadChallenge(_id, inProgress) {
      if (!inProgress) throw new Error('initialization forbidden');
      calls.push({ kind: 'squad' });
      const slots = state.saved ?? Array.from({ length: 23 }, (_, index) => ({ index, itemData: { id: 0, dream: false } }));
      return observable(ok({ squad: { simpleBrickIndices: [], customBrickIndices: [], _players: slots.map(({ index, itemData }) => ({ index,
        _item: itemData.id > 0 ? itemFactory.createItem({ id: itemData.id, resourceId: itemData.id + 100 }) : { id: 0 } })) } }));
    }
    saveChallenge() { throw new Error('queued mutation forbidden'); }
    submitChallenge() { throw new Error('queued mutation forbidden'); }
  }
  const club = { sku: 'synthetic27', year: 2027, platform: 'pc' };
  const persona = { id: 902, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 901, selectedPersona: 902, _personas: { _collection: { 902: persona } } };
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27, GAME_NAME: 'fc27',
    UTHttpRequest, EAHttpRequest, UTItemEntityFactory, UTItemRepository, UTClubRepository, UTSquadBuildingChallengeDAO, UTSquadEntity: { FIELD_PLAYERS: 11 },
    factories: { Item: itemFactory }, services: { User: { currentUserId: 901, repository: { _collection: { 901: user } } },
      SBC: { sbcDAO: new UTSquadBuildingChallengeDAO(), repository: { sets: { _collection: { 4: { ...set, challenges: [challenge] } } } } },
      Club: { clubDao: { authDelegate: {} } } },
    repositories: { Item: { club: new UTClubRepository() } },
    info: { base: { initialized: true, year: 27, state: false, clubCache: { status: 'trusted-provisional' } },
      build: { untradeable: true, academy: true, league: true, firststorage: true }, set: { goldenrange: 83, shield_league: [20] } },
    events: { validateClubPlayers() {}, markClubCacheDirty() { root.info.base.clubCache.localDirty = true; } },
    SBCChallengeStatus: { IN_PROGRESS: 'IN_PROGRESS' },
    SBCEligibilityKey: { PLAYER_MIN_OVR: 26, PLAYER_MAX_OVR: 28, PLAYER_QUALITY: 3 },
    SBCEligibilityScope: { GREATER: 0, EXACT: 2 }, SBCEligibilityQualityType: { BRONZE: 1, SILVER: 2, GOLD: 3 },
    PurchaseDisplayGroup: { MYPACKS: 'mypacks' }, HttpRequestMethod: { GET: 'GET', POST: 'POST', PUT: 'PUT' },
    ItemType: { PLAYER: 'player' }, ItemPile: { CLUB: 7, EVOLUTION: 9 },
    ItemRarity: { NONE: 0, RARE: 1 }, LimitedUseType: { NONE: 0 }, AuctionTradeStateEnum: { ACTIVE: 'active', INACTIVE: 'inactive' } };
  // Git may check this synthetic runtime out with CRLF; adapters hash normalized source.
  const normalizeSource = source => source.replace(/\r\n/g, '\n');
  const hashes = new Map([...FC27_CLUB_READ_METHODS, ...FC27_SBC_EXECUTION_METHODS, ...FC27_SBC_CACHE_METHODS].map(([path, hash]) => [
    normalizeSource(Function.prototype.toString.call(path.split('.').reduce((value, key) => value[key], root))), hash,
  ]));
  root.crypto = { subtle: { digest: vi.fn(async (_algorithm, bytes) => Uint8Array.from(Buffer.from(
    hashes.get(normalizeSource(new TextDecoder().decode(bytes))) ?? '0'.repeat(64), 'hex')).buffer) } };
  return { root, state, calls, set, challenge, user };
}
