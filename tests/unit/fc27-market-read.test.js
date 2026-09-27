import { expect, it, vi } from 'vitest';
import { FC27_MARKET_READ_METHODS, createFc27MarketReadTransport, probeFc27MarketRuntime, readFc27MarketPlayerName } from '../../src/adapters/ea/fc27-market-read.js';

function fixture() {
  const calls = []; const cleanups = []; const identified = [];
  const control = { status: 200, timeout: false, wrongOwner: false };
  const player = { id: 900001, resourceId: 101, itemType: 'player', untradeable: false };
  const auction = { tradeId: '9876543210123', tradeState: 'active', tradeOwner: false,
    expires: 120, buyNowPrice: 450, itemData: player };
  const catalog = { itemData: [player] }; const market = { auctionInfo: [auction] };
  class EAHttpRequest {
    setRequestBody(body) { this.body = body; }
    send() { throw new Error('not used'); }
    abort() { cleanups.push('abort'); }
    observe(observer, callback) { this.observer = observer; this.callback = callback; }
    unobserve(observer) { if (this.observer !== observer) throw new Error('foreign observer'); cleanups.push('unobserve'); }
  }
  class UTHttpRequest extends EAHttpRequest {
    setPath(endpoint) { this.url = `https://utas.test.ea.com${endpoint}`; }
    send() {
      calls.push(this); control.onSend?.();
      if (!control.timeout) this.callback(control.wrongOwner ? {} : this,
        { success: control.status === 200, status: control.status,
          response: this.url.endsWith('/defid') ? catalog : market });
    }
  }
  class UTItemEntityFactory {
    createItem(raw) {
      return { ...raw, definitionId: raw.resourceId, type: 'player', _rating: 70, _rareflag: 0,
        nationId: 14, teamId: 22, leagueId: 33, basePossiblePositions: [12, 23], groups: [],
        upgrades: null, cosmetics: [], _hyperCosmeticDTOs: {}, ...control.entity };
    }
  }
  class Identification {
    handleRequest(request) { identified.push(['request', request]); }
    handleResponse(request) { identified.push(['response', request]); }
  }
  class FCAuthenticationService {
    constructor() { this.identification = new Identification(); }
    getIdentifier() { return this.identification; }
  }
  class UTItemDAO {
    searchConceptItems() { throw new Error('do not call shared DAO'); }
    searchTransferMarket() { throw new Error('do not call shared cache'); }
  }
  const club = { sku: 'synthetic27', year: 2027, platform: 'PSN' };
  const persona = { id: 9003, _sku: club.sku, clubs: { _collection: { [club.sku]: club } } };
  const user = { id: 9002, selectedPersona: persona.id, _personas: { _collection: { [persona.id]: persona } } };
  const forbidden = vi.fn(() => { throw new Error('private-do-not-export'); });
  const root = { APP_YEAR: 2027, APP_YEAR_SHORT: 27, GAME_NAME: 'fc27',
    services: { User: { currentUserId: user.id, repository: { _collection: { [user.id]: user } } },
      Item: { itemDao: { authDelegate: new FCAuthenticationService() }, searchTransferMarket: forbidden,
        clearTransferMarketCache: forbidden, bid: forbidden, list: forbidden } },
    UTHttpRequest, EAHttpRequest, UTItemEntityFactory, UTItemDAO, FCAuthenticationService, Identification,
    factories: { Item: new UTItemEntityFactory() }, HttpRequestMethod: { GET: 'GET' } };
  const hashes = new Map(FC27_MARKET_READ_METHODS.map(([path, hash]) => {
    const fn = path.split('.').reduce((v, key) => v[key], root);
    return [Function.prototype.toString.call(fn), hash];
  }));
  root.crypto = { subtle: { digest: vi.fn(async (_algo, bytes) => {
    const hash = hashes.get(new TextDecoder().decode(bytes)) ?? '0'.repeat(64);
    return Uint8Array.from(hash.match(/../g).map(pair => parseInt(pair, 16))).buffer;
  }) } };
  return { root, calls, cleanups, control, catalog, market, player, auction, user, forbidden, identified };
}
const catalogQuery = { start: 0, count: 20, level: 'silver' };
const quoteQuery = { definitionId: 101, start: 0, count: 20, maxBuy: 2000 };

it('hydrates display names by exact public asset identity without calling a repository method', () => {
  const root = {ItemIdMask:{DATABASE:0xffffff},repositories:{Item:{staticData:{_collection:{
    101:{id:101,firstName:'Ada',lastName:'Player',commonName:null},
  }}}}};
  expect(readFc27MarketPlayerName(root, 0x1000000+101)).toBe('Ada Player');
  root.repositories.Item.staticData._collection[101].id=102;
  expect(readFc27MarketPlayerName(root, 101)).toBeNull();
});

it('reads a public player name from already-materialized static data without extra requests or getters', async () => {
  const f = fixture(); f.control.entity = { _staticData: { firstName: 'Ada', lastName: 'Player', knownAs: '' } };
  const result = await (await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery);
  expect(result.entries[0].displayName).toBe('Ada Player'); expect(f.calls).toHaveLength(1);
  expect(f.forbidden).not.toHaveBeenCalled();
});

it('uses an owned FC27 catalog GET without shared cache mutation or owned identities', async () => {
  const f = fixture(); const t = await createFc27MarketReadTransport(f.root);
  const result = await t.readCatalogPage({ ...catalogQuery, nation: 14 });
  expect(result).toMatchObject({ status: 'observed', season: '27', complete: false,
    entries: [{ definitionId: 101, rating: 70, positions: [12, 23], groups: [] }] });
  expect(f.calls[0]).toMatchObject({ url: 'https://utas.test.ea.com/ut/game/fc27/defid', requestType: 'GET',
    cache: false, doRetry: false, doReauth: false, urlVariables: '?type=player&sort=asc&start=0&count=20&level=silver&nation=14' });
  expect(JSON.stringify(result)).not.toMatch(/900001|9002|9003|9876543210123/);
  expect(f.cleanups).toEqual(['unobserve']); expect(f.forbidden).not.toHaveBeenCalled();
  expect(f.identified).toEqual([]);
});

it('reads exact-version Buy Now observations, not averages/price limits, preserving native identification', async () => {
  const f = fixture(); const t = await createFc27MarketReadTransport(f.root);
  f.market.auctionInfo.push({ ...f.auction, tradeId: 444, buyNowPrice: 600 });
  const result = await t.readQuotePage(quoteQuery);
  expect(result).toMatchObject({ status: 'observed', definitionId: 101, price: 450, eligible: 2, returned: 2,
    source: 'ea-visible-buy-now', platform: 'PSN:synthetic27', complete: false, executable: false, marketAvailabilityVerified: false });
  expect(f.calls[0].urlVariables).toBe('?type=player&definitionId=101&start=0&num=20&maxb=2000');
  expect(f.identified.map(row => row[0])).toEqual(['request', 'response']);
  expect(JSON.stringify(result)).not.toMatch(/9876543210123|900001/);
  expect(f.forbidden).not.toHaveBeenCalled();
});

it.each([{ expires: 0 }, { tradeState: 'closed' }, { tradeOwner: true }, { tradeOwner: undefined },
  { buyNowPrice: 0 }, { buyNowPrice: 2500 }, { itemData: { resourceId: 101, untradeable: true } }])
('does not convert an unusable auction into a zero/free quote: %j', async patch => {
  const f = fixture(); Object.assign(f.auction, patch);
  const result = await (await createFc27MarketReadTransport(f.root)).readQuotePage(quoteQuery);
  expect(result).toMatchObject({ price: null, eligible: 0, returned: 1 });
});

it('keeps unknown public card facts unknown and never invokes their accessors', async () => {
  const f = fixture(); f.control.entity = { groups: undefined, upgrades: undefined };
  Object.defineProperty(f.control.entity, 'rating', { get: f.forbidden, enumerable: false });
  const result = await (await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery);
  expect(result.entries[0]).toMatchObject({ rating: null, positions: null, evolution: null, groups: null });
  expect(f.forbidden).not.toHaveBeenCalled();
});

it.each([304, 401, 427, 429, 500])('stops on HTTP %s without retries or cache fallback', async status => {
  const f = fixture(); f.control.status = status; const t = await createFc27MarketReadTransport(f.root);
  await expect(t.readCatalogPage(catalogQuery)).rejects.toThrow(`HTTP_${status}`);
  await expect(t.readQuotePage(quoteQuery)).rejects.toThrow('READ_BLOCKED');
  expect(f.calls).toHaveLength(1); expect(f.forbidden).not.toHaveBeenCalled();
});

it.each(['missing', 'bad-card', 'duplicate', 'oversized'])('rejects malformed catalog %s and latches stopped', async mode => {
  const f = fixture();
  if (mode === 'missing') delete f.catalog.itemData;
  if (mode === 'bad-card') f.catalog.itemData = [{ id: 1 }];
  if (mode === 'duplicate') f.catalog.itemData.push(f.player);
  if (mode === 'oversized') f.catalog.itemData = Array(21).fill(f.player);
  const t = await createFc27MarketReadTransport(f.root);
  await expect(t.readCatalogPage(catalogQuery)).rejects.toThrow(/PAYLOAD_UNVERIFIED|DUPLICATE_DEFINITION/);
  await expect(t.readCatalogPage(catalogQuery)).rejects.toThrow('READ_BLOCKED');
});

it.each(['definition', 'identity', 'duplicate', 'payload'])('rejects untrusted market response %s', async mode => {
  const f = fixture();
  if (mode === 'definition') f.auction.itemData = { resourceId: 102 };
  if (mode === 'identity') delete f.auction.tradeId;
  if (mode === 'duplicate') f.market.auctionInfo.push(f.auction);
  if (mode === 'payload') delete f.market.auctionInfo;
  await expect((await createFc27MarketReadTransport(f.root)).readQuotePage(quoteQuery)).rejects.toThrow(/MISMATCH|UNVERIFIED/);
});

it('rejects invalid queries and runtime method drift before any request', async () => {
  const f = fixture(); const t = await createFc27MarketReadTransport(f.root);
  await expect(t.readCatalogPage({ ...catalogQuery, endpoint: '/item' })).rejects.toThrow('QUERY_INVALID');
  await expect(t.readQuotePage({ ...quoteQuery, maxBuy: 10001 })).rejects.toThrow('QUERY_INVALID');
  f.root.UTHttpRequest.prototype.send = () => {};
  await expect(t.readCatalogPage(catalogQuery)).rejects.toThrow('RUNTIME_CHANGED');
  expect(f.calls).toEqual([]);
  await expect(createFc27MarketReadTransport(f.root)).rejects.toThrow(/METHOD_\d+_CHANGED/);
});

it('rejects wrong response ownership and context drift during the request', async () => {
  const f = fixture(); f.control.wrongOwner = true;
  await expect((await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery)).rejects.toThrow('OWNER_MISMATCH');
  const g = fixture(); g.control.onSend = () => { g.user.selectedPersona = 777; };
  await expect((await createFc27MarketReadTransport(g.root)).readCatalogPage(catalogQuery)).rejects.toThrow('CONTEXT_UNAVAILABLE');
});

it('paces requests, refuses parallel work and caps a transport at eight reads', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); const t = await createFc27MarketReadTransport(f.root);
    await t.readCatalogPage(catalogQuery);
    const pending = t.readQuotePage(quoteQuery);
    await expect(t.readCatalogPage(catalogQuery)).rejects.toThrow('READ_BLOCKED');
    await vi.advanceTimersByTimeAsync(799); expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); await pending;
    for (let i = 2; i < 8; i++) { const next = t.readCatalogPage(catalogQuery); await vi.advanceTimersByTimeAsync(800); await next; }
    await expect(t.readCatalogPage(catalogQuery)).rejects.toThrow('READ_BLOCKED');
    expect(f.calls).toHaveLength(8);
  } finally { vi.useRealTimers(); }
});

it('times out, ignores late callbacks, and never aborts another request', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); f.control.timeout = true; const t = await createFc27MarketReadTransport(f.root);
    const pending = expect(t.readQuotePage(quoteQuery)).rejects.toThrow('READ_TIMEOUT');
    await vi.advanceTimersByTimeAsync(16001); await pending;
    f.calls[0].callback(f.calls[0], { success: true, status: 200, response: f.market });
    expect(f.cleanups).toEqual(['unobserve', 'abort']);
    expect(f.identified.map(row => row[0])).toEqual(['request']);
    await expect(t.readCatalogPage(catalogQuery)).rejects.toThrow('READ_BLOCKED');
  } finally { vi.useRealTimers(); }
});

it('bounds the explicit probe and keeps raw errors and account data out of its report', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); const pending = probeFc27MarketRuntime(f.root);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ reason: 'FC27_MARKET_SAMPLE_OBSERVED', requests: 2, executable: false });
    expect(f.forbidden).not.toHaveBeenCalled();
    expect(await probeFc27MarketRuntime({})).toMatchObject({ status: 'blocked', requests: 0, reason: 'FC27_CONTEXT_UNAVAILABLE' });
    const g = fixture(); g.root.crypto.subtle.digest = () => { throw new Error('private-secret'); };
    expect(await probeFc27MarketRuntime(g.root)).toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_READ_FAILED', requests: 0 });
  } finally { vi.useRealTimers(); }
});
