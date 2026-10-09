import { expect, it, vi } from 'vitest';
import { FC27_MARKET_READ_METHODS, createFc27MarketReadTransport, probeFc27MarketRuntime, readFc27MarketPlayerName } from '../../src/adapters/ea/fc27-market-read.js';
import { createFc27ClubReadTransport } from '../../src/adapters/ea/fc27-club-read.js';
import { verifyFc27Methods } from '../../src/adapters/ea/fc27-transaction-transport.js';
import { createFc27GalleryProgressReader } from '../../src/adapters/ea/fc27-gallery-progress.js';
import { createGalleryMarketComparison } from '../../src/gallery/market-comparison.js';
import october9 from '../fixtures/fc27-request-method-observation-2026-10-09.json';

// Public runtime captured without login on 2026-10-02, independently of the
// production allowlist. All thirteen decoded methods match the old structure.
const currentHashes = [
  '2397854164bed3b80e1250dc595bb87f278beac64afa9a665086b91dcdb35925',
  '76996922678762db2333635fa82497a8cf0c1af13f8faf36222c0257504bc6d1',
  'a76f0ea6f31e1a7a2183347d5c8f4867a2d85b9eacf083b1dcd58b8dffcce0df',
  'da2f34a13796aff01549443c202cf642dd03f1b2cb5c59fd7dc97ee128e51e81',
  'd19611a15440170b86573c0de3ddcc378cdc9990372fcade371af71383175452',
  'b5a39fadfeba1ca87b2e8c7a8d20b3f211d46a2ea36238bf90e5e59b6fe7a3e9',
  'a683769393a3a6d7116e57e54a08d76308f05b8c0a5afc262036075d59409419',
  'fc0713a05642d8d4fcebac3d20ebee458edd59f6d44e4a8a3ed84ae237391491',
  '6147c9f404a3638daa032c5ab89818f0856e56f7bb7192ae4e7a0ca988e5ce72',
  'edcd06d35a1fed95ead779eb152e9fce08662855bfda6ded3f0933d40236c7cc',
  'dceda80c8f59ac33349b5fb1eeecb4705834e0c0bc094bdb80fc98494b561111',
  '963bdc4c7fca39df8d4865716ceae2e323da2e16ca70287be4c9f00149494dc2',
  'b2c26d4d12aab146387df266044ffbab40e77b96d7b3328ac55f32d99d767949',
  '2fb555ef84ebf2a1c71b05095ec37955733f40ab55e48e3849d3b49636f3abb4',
];

function fixture(methodHashes = null) {
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
    generateItemsFromItemData(rows, duplicates) {
      return rows.map(raw => this.createItem(raw));
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
  const hashes = new Map(FC27_MARKET_READ_METHODS.map(([path, hash], index) => {
    const fn = path === 'factories.Item.generateItemsFromItemData'
      ? Object.getPrototypeOf(root.factories.Item).generateItemsFromItemData
      : path.split('.').reduce((v, key) => v[key], root);
    return [Function.prototype.toString.call(fn).replace(/\r\n/g, '\n'), methodHashes?.[index] ?? hash];
  }));
  root.crypto = { subtle: { digest: vi.fn(async (_algo, bytes) => {
    const hash = hashes.get(new TextDecoder().decode(bytes).replace(/\r\n/g, '\n')) ?? '0'.repeat(64);
    return Uint8Array.from(hash.match(/../g).map(pair => parseInt(pair, 16))).buffer;
  }) } };
  return { root, calls, cleanups, control, catalog, market, player, auction, user, forbidden, identified };
}
const catalogQuery = { start: 0, count: 20, level: 'silver' };
const quoteQuery = { definitionId: 101, start: 0, count: 20, maxBuy: 2000 };

it('accepts the independently captured current public runtime for one exact-version read', async () => {
  const f = fixture(currentHashes);
  const result = await (await createFc27MarketReadTransport(f.root)).readQuotePage(quoteQuery);
  expect(result).toMatchObject({ definitionId: 101, price: 450, eligible: 1 });
  expect(f.calls).toHaveLength(1);
  expect(f.identified.map(row => row[0])).toEqual(['request', 'response']);
  expect(f.forbidden).not.toHaveBeenCalled();
});

it.each(FC27_MARKET_READ_METHODS.map(([path], index) => [path, index]).filter(([, index]) => index !== 7))
('rejects a new unreviewed hash for %s before sending', async (_path, index) => {
  const hashes = [...currentHashes]; hashes[index] = '0'.repeat(64);
  const f = fixture(hashes);
  await expect(createFc27MarketReadTransport(f.root)).rejects.toThrow(`METHOD_${index}_CHANGED`);
  expect(f.calls).toEqual([]);
});

it('keeps runtime replacement blocked after accepting the current fingerprint', async () => {
  const f = fixture(currentHashes); const transport = await createFc27MarketReadTransport(f.root);
  f.root.UTHttpRequest.prototype.send = () => {};
  await expect(transport.readQuotePage(quoteQuery)).rejects.toThrow('RUNTIME_CHANGED');
  expect(f.calls).toEqual([]);
});

it('keeps unknown hashes blocked in Club and transaction verification', async () => {
  const f = fixture(currentHashes);
  f.root.UTHttpRequest = function unknownRequest() {};
  await expect(createFc27ClubReadTransport(f.root)).rejects.toThrow('METHOD_0_CHANGED');
  await expect(verifyFc27Methods(f.root, FC27_MARKET_READ_METHODS.slice(0, 7))).rejects.toThrow('FC27_TRANSACTION_METHOD_UNREVIEWED');
  expect(f.calls).toEqual([]);
});

it('shares October 9 request primitive compatibility without loosening other Market methods', async () => {
  const hashes = FC27_MARKET_READ_METHODS.map(([path], index) => october9.methods[path]?.sha256 ?? currentHashes[index]);
  const f = fixture(hashes);
  f.root.services.Club = { clubDao: { authDelegate: {} } };
  f.root.HttpRequestMethod.POST = 'POST'; f.root.ItemType = { PLAYER: 'player' };
  await expect(createFc27ClubReadTransport(f.root)).resolves.toBeTruthy();
  await expect(verifyFc27Methods(f.root, FC27_MARKET_READ_METHODS.slice(0, 7))).resolves.toBeTypeOf('function');
  await expect(createFc27MarketReadTransport(f.root)).resolves.toBeTruthy();
  f.root.Identification.prototype.handleResponse = () => {};
  await expect(createFc27MarketReadTransport(f.root)).rejects.toThrow('METHOD_13_CHANGED');
  expect(f.calls).toEqual([]);
});

it('accepts the reviewed FC27-2026-10-02 EAObservable notify fingerprint', async () => {
  const f = fixture();
  class EAObservable { notify() { return this; } }
  f.root.EAObservable = EAObservable;
  const current = '626035e884aceedbca0ba6ddf853134ffeecaba9414b92a6d7a41a78474063f2';
  const digest = f.root.crypto.subtle.digest;
  f.root.crypto.subtle.digest = async (algorithm, bytes) => {
    if (new TextDecoder().decode(bytes) === Function.prototype.toString.call(EAObservable.prototype.notify)) {
      return Uint8Array.from(current.match(/../g).map(pair => parseInt(pair, 16))).buffer;
    }
    return digest(algorithm, bytes);
  };
  const guard = await verifyFc27Methods(f.root, [['EAObservable.prototype.notify',
    '1e483385deb8aa65cce0dfa60efb7344d85a8caa8dff9e443a1c6ae9bab8559c']]);
  expect(() => guard()).not.toThrow();
});

it('reads quotes without the entity factory wrapped by Gallery, but does not permit catalog reads', async () => {
  const f = fixture();
  f.root.UTItemEntityFactory.prototype.createItem = () => { throw new Error('factory must not be used for quotes'); };
  const transport = await createFc27MarketReadTransport(f.root, { maxRequests: 1, quotesOnly: true });
  await expect(transport.readCatalogPage(catalogQuery)).rejects.toThrow('CATALOG_DISABLED');
  expect(await transport.readQuotePage(quoteQuery)).toMatchObject({ price: 450, definitionId: 101 });
  expect(f.calls).toHaveLength(1);
  await expect((await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery)).rejects.toThrow();
});

it('ignores factory hydration after quotes-only creation while still rejecting quote dependency drift', async () => {
  const f = fixture();
  const transport = await createFc27MarketReadTransport(f.root, { quotesOnly: true });
  f.root.UTItemEntityFactory.prototype.createItem = () => {};
  expect(await transport.readQuotePage(quoteQuery)).toMatchObject({ price: 450 });
  f.root.UTHttpRequest.prototype.send = () => {};
  await expect(transport.readQuotePage(quoteQuery)).rejects.toThrow('RUNTIME_CHANGED');
  expect(f.calls).toHaveLength(1);
});

it('compares a Gallery card after the real collection reader installs its factory hook', async () => {
  const f = fixture(currentHashes), original = f.root.UTItemEntityFactory.prototype.createItem;
  const reader = createFc27GalleryProgressReader(f.root);
  try {
    expect(f.root.UTItemEntityFactory.prototype.createItem).not.toBe(original);
    const service = createGalleryMarketComparison({ scope: reader.scope,
      createTransport: options => createFc27MarketReadTransport(f.root, options) });
    expect(await service.compare(101)).toMatchObject({ status: 'observed', price: 450, executable: false });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toMatch(/\/transfermarket$/);
    expect(f.forbidden).not.toHaveBeenCalled();
  } finally { reader.dispose(); }
  expect(f.root.UTItemEntityFactory.prototype.createItem).toBe(original);
});

it('reads Puzzle catalog data through the reviewed factory beneath the FCAT observer', async () => {
  const f = fixture(currentHashes);
  const reader = createFc27GalleryProgressReader(f.root);
  try {
    const wrapped = f.root.UTItemEntityFactory.prototype.createItem;
    const transport = await createFc27MarketReadTransport(f.root);
    expect(await transport.readCatalogPage(catalogQuery)).toMatchObject({ entries: [{ definitionId: 101, rating: 70 }] });
    expect(f.root.UTItemEntityFactory.prototype.createItem).toBe(wrapped);
    expect(f.calls).toHaveLength(1);
    f.root.UTItemEntityFactory.prototype.createItem = function() { return {}; };
    await expect(transport.readCatalogPage(catalogQuery)).rejects.toThrow('RUNTIME_CHANGED');
    expect(f.calls).toHaveLength(1);
  } finally { reader.dispose(); }
});

it('uses EA generateItemsFromItemData for catalog hydration', async () => {
  const f = fixture(currentHashes);
  const factory = f.root.factories.Item;
  const native = factory.generateItemsFromItemData;
  const calls = [];
  factory.generateItemsFromItemData = function(rows, duplicates) {
    calls.push({ rows, duplicates });
    return native.call(this, rows, duplicates);
  };
  // The test wrapper changes the inspected function identity, so provide its
  // reviewed digest while retaining the runtime identity guard contract.
  const originalDigest = f.root.crypto.subtle.digest;
  f.root.crypto.subtle.digest = async (algorithm, bytes) => {
    if (new TextDecoder().decode(bytes) === Function.prototype.toString.call(factory.generateItemsFromItemData)) {
      return Uint8Array.from('6147c9f404a3638daa032c5ab89818f0856e56f7bb7192ae4e7a0ca988e5ce72'.match(/../g).map(pair => parseInt(pair, 16))).buffer;
    }
    return originalDigest(algorithm, bytes);
  };
  const result = await (await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery);
  expect(result.entries).toHaveLength(1);
  expect(calls).toHaveLength(1);
  expect(calls[0].rows[0].resourceId).toBe(101);
});

it('accepts public catalog entities without an owned item id or with concept state', async () => {
  const f = fixture();
  f.catalog.itemData = [{ resourceId: 101, itemType: 'player' }];
  f.control.entity = { concept: true };
  const result = await (await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery);
  expect(result.entries[0]).toMatchObject({ definitionId: 101, rating: 70 });
});

it('rejects invalid factory output beneath the FCAT observer and stops further reads', async () => {
  const f = fixture(currentHashes);
  f.root.UTItemEntityFactory.prototype.createItem = function() { return {}; };
  const reader = createFc27GalleryProgressReader(f.root);
  try {
    const transport = await createFc27MarketReadTransport(f.root);
    await expect(transport.readCatalogPage(catalogQuery)).rejects.toThrow('ENTITY_UNVERIFIED');
    await expect(transport.readCatalogPage(catalogQuery)).rejects.toThrow('READ_BLOCKED');
    expect(f.calls).toHaveLength(1);
  } finally { reader.dispose(); }
});

it.each([false, true])('accepts an external metadata wrapper, including FCAT observation above it (%s)', async observed => {
  const f = fixture(currentHashes), original = f.root.UTItemEntityFactory.prototype.createItem;
  f.root.UTItemEntityFactory.prototype.createItem = function(raw) {
    return Object.assign(original.call(this, raw), { gradingScore: 123, isCollected: false });
  };
  const reader = observed ? createFc27GalleryProgressReader(f.root) : null;
  try {
    const transport = await createFc27MarketReadTransport(f.root);
    expect(f.calls).toHaveLength(0);
    expect(await transport.readCatalogPage(catalogQuery)).toMatchObject({ entries: [{ definitionId: 101, rating: 70 }] });
    expect(f.calls).toHaveLength(1);
    expect(f.forbidden).not.toHaveBeenCalled();
  } finally { reader?.dispose(); }
});

it.each([{ id: 2 }, { definitionId: 999 }, { type: 'manager' }])('rejects incorrect external factory identity %j', async patch => {
  const f = fixture(), original = f.root.UTItemEntityFactory.prototype.createItem;
  f.root.UTItemEntityFactory.prototype.createItem = function(raw) { return { ...original.call(this, raw), ...patch }; };
  await expect((await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery)).rejects.toThrow('ENTITY_UNVERIFIED');
});

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
  // Match complete identities, not coincidental digits inside observedAt.
  expect(JSON.stringify(result)).not.toMatch(/(?<!\d)(?:900001|9002|9003|9876543210123)(?!\d)/);
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
  expect(JSON.stringify(result)).not.toMatch(/(?<!\d)(?:9876543210123|900001)(?!\d)/);
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

it.each([1234, '1234', 'secret-token', null])('exports only a numeric EA failure code (%j), without auth retry', async code => {
  const f = fixture(); f.control.status = 401;
  Object.assign(f.market, { code, message: 'secret-token', token: 'secret-token' });
  const transport = await createFc27MarketReadTransport(f.root);
  const error = await transport.readQuotePage(quoteQuery).catch(error => error);
  expect(error.message).toBe('FC27_MARKET_HTTP_401');
  expect(error.marketFailure).toEqual({ httpStatus: 401, eaCode: code === 1234 || code === '1234' ? 1234 : null });
  expect(JSON.stringify(error)).not.toContain('secret-token');
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ doRetry: false, doReauth: false });
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
  await expect(t.readQuotePage({ ...quoteQuery, maxBuy: 15000001 })).rejects.toThrow('QUERY_INVALID');
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

it('omits the price filter for unlimited quote reads and accepts a configured ceiling above 10000', async () => {
  const f = fixture(); f.auction.buyNowPrice = 12500;
  const unlimited = await (await createFc27MarketReadTransport(f.root)).readQuotePage({ ...quoteQuery, maxBuy: null });
  expect(unlimited.price).toBe(12500); expect(f.calls[0].urlVariables).not.toContain('maxb');
  expect(await (await createFc27MarketReadTransport(f.root)).readQuotePage({ ...quoteQuery, maxBuy: 15000 }))
    .toMatchObject({ price: 12500 });
  expect(f.calls[1].urlVariables).toContain('maxb=15000');
});

it('supports the bounded procurement budget without retaining the probe-only eight-read ceiling', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); const t = await createFc27MarketReadTransport(f.root, { maxRequests: 25 });
    for (let i = 0; i < 25; i++) { const next = t.readQuotePage(quoteQuery); await vi.advanceTimersByTimeAsync(800); await next; }
    await expect(t.readQuotePage(quoteQuery)).rejects.toThrow('READ_BLOCKED');
    expect(f.calls).toHaveLength(25);
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
