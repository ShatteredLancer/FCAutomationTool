import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import requestFailures from '../fixtures/fc27-request-failure-public-methods.json';
import { FC27_MARKET_READ_METHODS, createFc27MarketReadTransport, probeFc27MarketRuntime, readFc27MarketPlayerName } from '../../src/adapters/ea/fc27-market-read.js';
import { createFc27ClubReadTransport } from '../../src/adapters/ea/fc27-club-read.js';
import { verifyFc27Methods } from '../../src/adapters/ea/fc27-transaction-transport.js';
import { createFc27GalleryProgressReader } from '../../src/adapters/ea/fc27-gallery-progress.js';
import { createGalleryMarketComparison } from '../../src/gallery/market-comparison.js';
import october9 from '../fixtures/fc27-request-method-observation-2026-10-09.json';
import october12 from '../fixtures/fc27-market-method-observation-2026-10-12.json';
import build11502 from '../fixtures/fc27-market-read-11502.json';
import build11502Shared from '../fixtures/fc27-build-11502-method-digests.json';
import { createFc27MarketTraffic } from '../../src/adapters/browser/fc27-market-traffic.js';
import { registerFc27MarketTraffic } from '../../src/adapters/ea/fc27-market-traffic.js';
import { defaultTradingPublicSettings } from '../../src/trading/task-model.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';

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
        { success: control.status === 200, status: control.status, ...(control.error ? { error: control.error } : {}),
          response: control.respond ? control.respond(this)
            : this.url.endsWith('/user/credits') ? (control.credits ?? { currencies: [{ name: 'coins', funds: 10000 }] }) : this.url.endsWith('/defid') ? catalog : market });
    }
  }
  class UTItemEntityFactory {
    createItem(raw) {
      return { ...raw, definitionId: raw.resourceId, type: 'player', _rating: 70, _rareflag: 0,
        nationId: 14, teamId: 22, leagueId: 33, basePossiblePositions: [12, 23], groups: [],
        upgrades: null, cosmetics: [], _hyperCosmeticDTOs: {}, ...control.entity, ...control.project?.(raw) };
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
const october12Hashes = FC27_MARKET_READ_METHODS.map(([path]) => october12.methods[path].sha256);
// Independently measured public digests; stub requests/factories remain offline.
const build11502Hashes = FC27_MARKET_READ_METHODS.map(([path], index) =>
  build11502.methods[path] ?? build11502Shared.methods[path] ?? october12Hashes[index]);

it('encodes the bounded TOTW-only lookup as the native rareflag filter, not a quality search', async () => {
  const f = fixture(build11502Hashes);
  f.control.entity = { _rareflag: 3 };
  const transport = await createFc27MarketReadTransport(f.root);
  const query = { start: 20, count: 20, level: 'totw' };
  expect(await transport.readCatalogPage(query)).toMatchObject({ query, entries: [{ definitionId: 101, rarity: 3, special: true }] });
  expect(f.calls[0].url).toMatch(/\/defid$/);
  expect(Object.fromEntries(new URLSearchParams(f.calls[0].urlVariables)))
    .toEqual({ type: 'player', sort: 'asc', start: '20', count: '20', rarityIds: '3' });
  for (const invalid of [{ ...query, start: 60 }, { ...query, count: 50 }, { ...query, league: 13 }, { ...query, rarityIds: 5 }]) {
    await expect(transport.readCatalogPage(invalid)).rejects.toThrow('QUERY_INVALID');
  }
  expect(f.calls).toHaveLength(1);
});

it('requests only the exact normal-material shortlist definitions and rejects unrelated results', async () => {
  const f = fixture(build11502Hashes);
  const transport = await createFc27MarketReadTransport(f.root);
  const query = { start: 0, count: 20, level: 'gold', definitionIds: [101, 103] };
  expect(await transport.readCatalogPage(query)).toMatchObject({ query, entries: [{ definitionId: 101 }] });
  expect(Object.fromEntries(new URLSearchParams(f.calls[0].urlVariables)))
    .toEqual({ type: 'player', sort: 'asc', start: '0', count: '20', level: 'gold', defId: '101,103', rarityIds: '0,1' });
  for (const invalid of [{ ...query, start: 20 }, { ...query, level: 'totw' }, { ...query, definitionIds: [101, 101] }]) {
    await expect(transport.readCatalogPage(invalid)).rejects.toThrow('QUERY_INVALID');
  }
  await expect(transport.readCatalogPage({ ...query, definitionIds: [102] })).rejects.toThrow('DEFINITION_MISMATCH');
});

it('reads build 11502 quotes even when the catalog method is unavailable in quotes-only mode', async () => {
  const f = fixture(build11502Hashes);
  delete f.root.UTItemDAO.prototype.searchConceptItems;
  const transport = await createFc27MarketReadTransport(f.root, { quotesOnly: true });
  expect(await transport.readQuotePage(quoteQuery)).toMatchObject({ price: 450, executable: false });
  expect(f.calls.map(call => call.requestType)).toEqual(['GET']);
  await expect(transport.readCatalogPage(catalogQuery)).rejects.toThrow('CATALOG_DISABLED');
  expect(f.forbidden).not.toHaveBeenCalled();
});

it('116/176 generates an independently validated 11-player plan using build 11502 catalog and quotes', async () => {
  const f = fixture(build11502Hashes), input = puzzleFillFixture(), memory = new Map();
  const now = () => Date.now();
  input.now = now();
  input.context = input.challenge.context = input.policy.context = input.inventory.context = readFc27Context(f.root);
  Object.assign(input.challenge, { setId: 116, id: 176, rawRequirements: [
    marketRow(5, 4), marketRow(6, 3, -1, 1), marketRow(7, 2), marketRow(9, 5, -1, 1),
    marketRow(3, 2), marketRow(35, 18),
  ] });
  Object.assign(input.policy, { maxRating: 82 });
  Object.assign(input.marketPolicy, { budget: 6000, maxPurchases: 11, maxUnitPrice: 1000, availableCoins: 9000 });
  const base = input.inventory.items[0];
  const linked = Array.from({ length: 11 }, (_, i) => {
    const teamId = 2 + Math.floor(i / 3);
    return { definitionId: 1000 + i, rating: i < 2 ? 76 : 70, teamId, leagueId: i < 6 ? 40 : 41,
      nationId: i < 6 ? 20 : 21, positions: [5], rarity: 0, groups: [], special: false, evolution: false, cosmetic: false };
  });
  const protectedCards = [
    { ...base, ...linked[2], id: 32, definitionId: 1032, locked: true },
    { ...base, ...linked[5], id: 35, definitionId: 1035, activeSquad: true },
  ];
  input.inventory.items = [
    ...linked.slice(0, 2).map((card, i) => ({ ...base, ...card, id: i + 1 })),
    ...Array.from({ length: 9 }, (_, i) => ({ ...base, id: 10 + i, definitionId: 1010 + i,
      teamId: 100 + i, leagueId: 100 + i, nationId: 100 + i, rating: 76 })),
    ...protectedCards,
  ];
  const market = new Map(linked.slice(2).map(card => [card.definitionId, card]));
  const raw = definitionId => ({ ...f.player, id: definitionId, resourceId: definitionId });
  f.control.project = row => {
    const card = market.get(row.resourceId);
    return { _rating: card.rating, teamId: card.teamId, leagueId: card.leagueId,
      nationId: card.nationId, basePossiblePositions: card.positions };
  };
  f.control.respond = request => {
    const query = new URLSearchParams(request.urlVariables);
    if (request.url.endsWith('/defid')) {
      const cards = [...market.values()].filter(card => query.get('level') === 'silver'
        && ['team', 'league', 'nation'].every(field => !query.has(field) || Number(query.get(field)) === card[`${field}Id`]));
      return { itemData: cards.slice(Number(query.get('start')), Number(query.get('start')) + Number(query.get('count')))
        .map(card => raw(card.definitionId)) };
    }
    expect(request.url).toMatch(/\/transfermarket$/);
    const definitionId = Number(query.get('definitionId'));
    expect(market.has(definitionId)).toBe(true);
    return { auctionInfo: [{ ...f.auction, itemData: raw(definitionId), buyNowPrice: 400 }] };
  };
  const inventoryBefore = structuredClone(input.inventory);
  const session = createFc27PuzzleProcurementSession({
    now, get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)),
    createTransport: options => createFc27MarketReadTransport(f.root, options),
  });
  // Reproduce the pre-update blocked cache entry, then retry without clearing storage.
  const dao = f.root.UTItemDAO.prototype, catalogMethod = dao.searchConceptItems;
  dao.searchConceptItems = () => { throw Error('unknown locally replaced method'); };
  expect(await session.plan(input, { adaptiveSearch: true })).toMatchObject({
    status: 'blocked', reason: 'FC27_MARKET_METHOD_9_CHANGED', requests: 0,
  });
  expect(f.calls).toEqual([]);
  dao.searchConceptItems = catalogMethod;
  let result;
  vi.useFakeTimers();
  try {
    [result] = await Promise.all([session.plan(input, { adaptiveSearch: true }), vi.runAllTimersAsync()]);
  } finally {
    vi.useRealTimers();
  }
  expect(result.status, JSON.stringify({ reason: result.reason, diagnostics: result.diagnostics })).toBe('suggested');
  const plan = result.plans[0], squad = Array(11).fill(null);
  for (const ref of plan.selectedOwned) squad[ref.slot] = input.inventory.items.find(card => card.id === ref.id);
  for (const ref of plan.purchases) squad[ref.slot] = { ...base, ...market.get(ref.definitionId) };
  const facts = input.evaluateSquad(squad);
  expect(squad.every(Boolean)).toBe(true);
  expect(new Set(squad.map(card => card.definitionId)).size).toBe(11);
  const countsBy = field => new Map(squad.map(card => [card[field], squad.filter(other => other[field] === card[field]).length]));
  expect(Math.max(...countsBy('leagueId').values())).toBeGreaterThanOrEqual(4);
  expect(Math.max(...countsBy('teamId').values())).toBeLessThanOrEqual(3);
  expect(countsBy('nationId').size).toBeGreaterThanOrEqual(2);
  expect(countsBy('teamId').size).toBeLessThanOrEqual(5);
  expect(Math.min(...squad.map(card => card.rating))).toBeGreaterThanOrEqual(65);
  expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules,
    squad, ...facts, clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(facts.chemistry).toBeGreaterThanOrEqual(18);
  expect(plan.selectedOwned.every(card => !protectedCards.some(protectedCard => protectedCard.id === card.id))).toBe(true);
  expect(plan.purchases.length).toBeGreaterThan(0);
  expect(plan.estimatedCost).toBe(plan.purchases.length * 400);
  expect(result.diagnostics.catalogAttempts).toBeGreaterThan(0);
  expect(result.diagnostics.quoteAttempts).toBeGreaterThan(0);
  expect(f.calls.every(call => call.requestType === 'GET')).toBe(true);
  expect(f.forbidden).not.toHaveBeenCalled();
  expect(input.inventory).toEqual(inventoryBefore);
});

it('does not admit a reviewed build 11502 digest at the wrong method path or in write verification', async () => {
  const hashes = [...build11502Hashes]; hashes[10] = hashes[9];
  const misplaced = fixture(hashes), f = fixture(build11502Hashes);
  await expect(createFc27MarketReadTransport(misplaced.root, { quotesOnly: true }))
    .rejects.toThrow('FC27_MARKET_METHOD_10_CHANGED');
  await expect(verifyFc27Methods(f.root, [FC27_MARKET_READ_METHODS[10]]))
    .rejects.toThrow('FC27_TRANSACTION_METHOD_UNREVIEWED');
  expect([...misplaced.calls, ...f.calls]).toEqual([]);
});
it('checks session with one authenticated GET, no market search, balance export or retry', async () => {
  const f = fixture(october12Hashes), dispatch = vi.fn();
  const result = await (await createFc27MarketReadTransport(f.root, { quotesOnly: true, maxRequests: 1 })).readSessionHealth({ beforeDispatch: dispatch });
  expect(result).toEqual({ status: 'online', observedAt: expect.any(Number) });
  expect(f.calls).toHaveLength(1); expect(dispatch).toHaveBeenCalledTimes(1);
  expect(f.calls[0]).toMatchObject({ url: 'https://utas.test.ea.com/ut/game/fc27/user/credits', urlVariables: '', requestType: 'GET', doRetry: false, doReauth: false, cache: false });
  expect(f.identified.map(row => row[0])).toEqual(['request', 'response']);
  expect(f.forbidden).not.toHaveBeenCalled();
});
it.each([401, 429, 500])('session check exposes only numeric HTTP %s and never retries', async status => {
  const f = fixture(october12Hashes); f.control.status = status;
  const reader = await createFc27MarketReadTransport(f.root, { quotesOnly: true });
  await expect(reader.readSessionHealth({ beforeDispatch: () => {} })).rejects.toMatchObject({ marketFailure: { httpStatus: status } });
  await expect(reader.readSessionHealth({ beforeDispatch: () => {} })).rejects.toThrow('READ_BLOCKED');
  expect(f.calls).toHaveLength(1);
});
it.each([
  ['timedout', 'FC27_MARKET_READ_TIMEOUT'],
  ['errored', 'FC27_MARKET_READ_NETWORK_ERROR'],
  ['aborted', 'FC27_MARKET_READ_ABORTED'],
  [null, 'FC27_MARKET_RESPONSE_UNVERIFIED'],
])('distinguishes native status-zero session %s without retry or response export', async (flag, message) => {
  const f = fixture(); f.control.status = 0; f.control.error = { code: 0, message: 'private response' };
  f.control.onSend = () => { if (flag) f.calls.at(-1)[flag] = true; };
  const reader = await createFc27MarketReadTransport(f.root, { quotesOnly: true });
  await expect(reader.readSessionHealth({ beforeDispatch: () => {} })).rejects.toMatchObject({ message,
    marketFailure: { httpStatus: null, eaCode: 0 } });
  expect(f.calls).toHaveLength(1); expect(f.calls[0].doReauth).toBe(false); expect(f.calls[0].doRetry).toBe(false);
});
it('does not let timeout flags hide an explicit session rejection', async () => {
  const f = fixture(); f.control.status = 429;
  f.control.onSend = () => { f.calls.at(-1).timedout = true; };
  const reader = await createFc27MarketReadTransport(f.root, { quotesOnly: true });
  await expect(reader.readSessionHealth({ beforeDispatch: () => {} })).rejects.toMatchObject({ message: 'FC27_MARKET_HTTP_429',
    marketFailure: { httpStatus: 429 } });
});
it.each([
  ['onTimeout', 'FC27_MARKET_READ_TIMEOUT'], ['onError', 'FC27_MARKET_READ_NETWORK_ERROR'], ['onAbort', 'FC27_MARKET_READ_ABORTED'],
])('replays original EA %s and _notify through the real session reader', async (event, message) => {
  const sandbox = { _0x37b64a: null, _0x512d02: null, JSUtils: { isString: value => typeof value === 'string' },
    UTHttpResponseDTO: class {}, UTServerErrorVO: class { constructor(code) { this.code = code; } } };
  const method = name => {
    const row = requestFailures.methods[name];
    expect(createHash('sha256').update(row.decoded).digest('hex')).toBe(row.sha256);
    return runInNewContext(`(${row.decoded})`, sandbox);
  };
  const onEvent = method(`EAHttpRequest.prototype.${event}`), notify = method('UTHttpRequest.prototype._notify');
  const f = fixture(); f.control.timeout = true;
  f.control.onSend = () => {
    const request = f.calls.at(-1);
    request.http = { status: 0, response: null, getResponseHeader: () => null };
    request.convertUtasCodeToHttpStatus = status => status;
    request.generateErrorReason = () => 'native status zero';
    request.notify = dto => request.callback(request, dto);
    onEvent.call(request); notify.call(request);
  };
  const reader = await createFc27MarketReadTransport(f.root, { quotesOnly: true });
  await expect(reader.readSessionHealth({ beforeDispatch: () => {} })).rejects.toMatchObject({ message,
    marketFailure: { httpStatus: null, eaCode: 0 } });
  expect(f.calls).toHaveLength(1);
});
it('retains native error subcodes so a mapped 401 is not mistaken for ordinary session expiry', async () => {
  const f = fixture(october12Hashes); f.control.status = 401; f.control.error = { code: 459, message: 'private error text' };
  const reader = await createFc27MarketReadTransport(f.root, { quotesOnly: true });
  await expect(reader.readSessionHealth({ beforeDispatch: () => {} })).rejects.toMatchObject({ marketFailure: { httpStatus: 401, eaCode: 459 } });
});
it('cancels session checks at the actual send boundary and rejects malformed successful replies', async () => {
  const f = fixture(october12Hashes);
  await expect((await createFc27MarketReadTransport(f.root, { quotesOnly: true })).readSessionHealth({ beforeDispatch: () => { throw Error('stop'); } })).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
  f.control.credits = { currencies: [{ name: 'coins', funds: '10000' }] };
  await expect((await createFc27MarketReadTransport(f.root, { quotesOnly: true })).readSessionHealth({ beforeDispatch: () => {} })).rejects.toThrow('RESPONSE_UNVERIFIED');
});
it('reads native concept defId versions without broadening quality queries or using auction search',async()=>{
 const f=fixture(october12Hashes);f.root.ItemIdMask={DATABASE:0xffffff};f.catalog.itemData.push({...f.player,resourceId:0x1000065});
 const t=await createFc27MarketReadTransport(f.root);
 const result=await t.readPlayerVersions({playerId:101});expect(result.entries.map(p=>p.definitionId)).toEqual([101,0x1000065]);
 expect(f.calls).toHaveLength(1);expect(f.calls[0].url).toContain('/defid');expect(f.calls[0].urlVariables).toBe('?type=player&sort=asc&defId=101&start=0&count=20');
 expect(f.forbidden).not.toHaveBeenCalled();
 await expect(t.readCatalogPage({start:0,count:20,defId:[101]})).rejects.toThrow('QUERY_INVALID');
});
it('rejects concept versions for a different identity and a disabled catalog transport',async()=>{
 const f=fixture(october12Hashes);f.root.ItemIdMask={DATABASE:0xffffff};
 await expect((await createFc27MarketReadTransport(f.root)).readPlayerVersions({playerId:102})).rejects.toThrow('DEFINITION_MISMATCH');
 await expect((await createFc27MarketReadTransport(f.root,{quotesOnly:true})).readPlayerVersions({playerId:101})).rejects.toThrow('CATALOG_DISABLED');
});

it('counts actual quote requests but not concept catalog pages and shares their throttle with buying',async()=>{
 const f=fixture(october12Hashes),data=new Map();let clock=1000,id=0;
 const gate=createFc27MarketTraffic({context:()=>({scope:'account',season:'27',platform:'pc'}),get:async(k,d)=>structuredClone(data.get(k)??d),set:async(k,v)=>data.set(k,structuredClone(v)),
 locks:{request:async(_k,_o,fn)=>fn()},readSettings:()=>defaultTradingPublicSettings(),now:()=>clock,sleep:async ms=>{clock+=ms;},id:()=>`r${++id}`});registerFc27MarketTraffic(f.root,gate);
 await (await createFc27MarketReadTransport(f.root,{quotesOnly:true,maxRequests:1})).readSessionHealth({beforeDispatch:()=>{}});expect((await gate.inspect()).gate.hour).toBe(0);
 await (await createFc27MarketReadTransport(f.root)).readCatalogPage(catalogQuery);expect((await gate.inspect()).gate.hour).toBe(0);
 await (await createFc27MarketReadTransport(f.root)).readQuotePage(quoteQuery);expect((await gate.inspect()).gate.hour).toBe(1);
 f.control.status=429;
 await expect((await createFc27MarketReadTransport(f.root)).readQuotePage(quoteQuery)).rejects.toThrow('HTTP_429');
 expect((await gate.inspect()).gate.hour).toBe(2);const send=vi.fn();await expect(gate.run('buy',()=>{},send)).rejects.toThrow('STOPPED');expect(send).not.toHaveBeenCalled();
});

it('reads an exact Gallery comparison with the October 12 native query and authentication fingerprints', async () => {
  const f = fixture(october12Hashes);
  const comparison = createGalleryMarketComparison({ scope: () => 'fixture-account',
    createTransport: options => createFc27MarketReadTransport(f.root, options) });
  expect(await comparison.compare(101)).toMatchObject({ status: 'observed', definitionId: 101, price: 450, executable: false });
  expect(f.calls).toHaveLength(1);
  expect(f.forbidden).not.toHaveBeenCalled();
});

it('keeps catalog reads compatible with the independently reviewed October 12 concept query', async () => {
  const f = fixture(october12Hashes);
  const transport = await createFc27MarketReadTransport(f.root);
  expect((await transport.readCatalogPage(catalogQuery)).entries).toHaveLength(1);
  expect(f.calls).toHaveLength(1);
  expect(f.forbidden).not.toHaveBeenCalled();
});

it.each(FC27_MARKET_READ_METHODS.slice(9).map(([path], offset) => [path, offset + 9]))
('keeps an unknown replacement of the October 12 %s blocked with method evidence', async (path, index) => {
  const hashes = [...october12Hashes]; hashes[index] = '0'.repeat(64);
  const f = fixture(hashes);
  await expect(createFc27MarketReadTransport(f.root)).rejects.toMatchObject({
    message: `FC27_MARKET_METHOD_${index}_CHANGED`, method: path, observedHash: '0'.repeat(64),
  });
  expect(f.calls).toEqual([]);
});

it('does not approve Market-only native fingerprints for another method or a write transaction', async () => {
  const hashes = [...october12Hashes]; hashes[10] = hashes[11];
  const f = fixture(hashes);
  await expect(createFc27MarketReadTransport(f.root, { quotesOnly: true })).rejects.toThrow('METHOD_10_CHANGED');
  const g = fixture(october12Hashes);
  await expect(verifyFc27Methods(g.root, [['UTItemDAO.prototype.searchTransferMarket', FC27_MARKET_READ_METHODS[10][1]]]))
    .rejects.toThrow('FC27_TRANSACTION_METHOD_UNREVIEWED');
  expect(f.calls).toEqual([]); expect(g.calls).toEqual([]);
});

it('carries an unknown Market method and digest through the real Gallery comparison into redacted diagnostics', async () => {
  const hashes = [...october12Hashes]; hashes[10] = 'f'.repeat(64);
  const f = fixture(hashes), events = [];
  const comparison = createGalleryMarketComparison({ scope: () => 'fixture-account',
    createTransport: options => createFc27MarketReadTransport(f.root, options),
    diagnosticLog: { record: input => events.push(input) } });
  expect(await comparison.compare(101)).toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_METHOD_10_CHANGED' });
  expect(events.at(-1)).toMatchObject({ event: 'market-compare', reason: 'FC27_MARKET_METHOD_10_CHANGED',
    method: 'UTItemDAO.prototype.searchTransferMarket', observedHash: 'f'.repeat(64) });
  expect(f.calls).toEqual([]);
});

it('accepts the independently captured current public runtime for one exact-version read', async () => {
  const f = fixture(currentHashes);
  const result = await (await createFc27MarketReadTransport(f.root)).readQuotePage(quoteQuery);
  expect(result).toMatchObject({ definitionId: 101, price: 450, eligible: 1 });
  expect(f.calls).toHaveLength(1);
  expect(f.identified.map(row => row[0])).toEqual(['request', 'response']);
  expect(f.forbidden).not.toHaveBeenCalled();
});

it('accepts the independently captured 2026-10-09 public market runtime', async () => {
  const hashes = [...currentHashes];
  hashes[9] = 'a4636c57d7f0c0f2029c561f09cba2402c3a7d7b6741391681387c126a1c93c1';
  hashes[10] = '115db0308108407e39828df5dd05e5a5229d8f201bcb8dae46c268f0581de0a2';
  hashes[11] = 'b6a15ab3958bbc66a207a59b651f7bf508cadee3888dd92348b59645648e5339';
  hashes[12] = 'b2b5fcb44cb8ca501c0d803e1b42803fd503093688b930ed0dee8bf09cd3f291';
  hashes[13] = '0af5197cec225474ea1e7ccbd087bf6257b69a671d4c866e4ace782d93d35c5f';
  const f = fixture(hashes);
  const result = await (await createFc27MarketReadTransport(f.root)).readQuotePage(quoteQuery);
  expect(result).toMatchObject({ definitionId: 101, price: 450, eligible: 1 });
  expect(f.calls).toHaveLength(1);
  expect(f.identified.map(row => row[0])).toEqual(['request', 'response']);
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
