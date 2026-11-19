import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import observation from '../fixtures/fc27-market-method-observation-2026-10-12.json';
import november19 from '../fixtures/fc27-market-method-observation-2026-11-19.json';
import { createFc27ClubReadTransport } from '../../src/adapters/ea/fc27-club-read.js';
import { executionRuntime } from '../helpers/fc27-execution-runtime.js';
import { createFc27MarketReadTransport } from '../../src/adapters/ea/fc27-market-read.js';

it.each(Object.entries(observation.methods))('checks the independently captured native source digest for %s', (_path, row) => {
  expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.sha256);
  expect(row.sha256).toBe(row.baselineSha256); // Exact October 9 asset capture, not an older inferred body.
  expect(row.decoded).not.toMatch(/\[(?:_0x|a0_0x)[a-f0-9]+\(/);
});

function capturedRuntime(capture=observation) {
  const { root } = executionRuntime(), ctx = vm.createContext({});
  for (const [path, row] of Object.entries(capture.methods)) {
    const keys = path.split('.'); let target = root;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = vm.runInContext(`(${row.source})`, ctx);
  }
  root.factories.Item.createItem = root.UTItemEntityFactory.prototype.createItem;
  const auth = Object.create(root.FCAuthenticationService.prototype);
  auth.identification = Object.create(root.Identification.prototype);
  root.services.Item = { itemDao: { authDelegate: auth } };
  root.crypto = webcrypto; root.HttpRequestMethod.GET = 'GET';
  return root;
}

it('accepts all actual captured native function bodies using real SHA256, without invoking a query or logging in', async () => {
  for (const quotesOnly of [true, false]) {
    await expect(createFc27MarketReadTransport(capturedRuntime(), { maxRequests: 1, quotesOnly })).resolves.toBeTruthy();
  }
  expect(observation.authenticated).toBe(false);
});

it('accepts November 19 Club and Market prerequisites with real source hashes and no requests',async()=>{
  for(const row of Object.values(november19.methods))expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.sha256);
  await expect(createFc27ClubReadTransport(capturedRuntime(november19))).resolves.toBeTruthy();
  for(const quotesOnly of [true,false])await expect(createFc27MarketReadTransport(capturedRuntime(november19),{maxRequests:1,quotesOnly})).resolves.toBeTruthy();
});

it('limits the decoded November 19 difference to the two reviewed FOIL query branches',()=>{
  const normalize=source=>{const names=new Map();return source.replace(/(?:_0x|a0_0x)[0-9a-f]+/g,name=>{
    if(!names.has(name))names.set(name,`v${names.size}`);return names.get(name);
  });};
  for(const [path,row] of Object.entries(november19.methods)){
    let expected=normalize(observation.methods[path].decoded);
    if(path==='UTItemDAO.prototype.searchConceptItems'||path==='UTItemDAO.prototype.searchTransferMarket'){
      const key=path.endsWith('searchConceptItems')?'level':'lev';
      const old=`v0["level"]!==SearchLevel["ANY"]&&(v7["${key}"]=v0["level"]);`;
      expect(expected).toContain(`else ${old}`);
      expected=expected.replace(`else ${old}`,`else{if(v0["level"]===SearchLevel["FOIL"]||v0["level"]===SearchLevel["NO_FOIL"])v7["hypercosmetic"]=v0["level"];else ${old}}`);
    }
    expect(normalize(row.decoded),path).toBe(expected);
  }
});

it('rejects an unknown real function instead of trusting its method name', async () => {
  const root = capturedRuntime(); root.UTItemDAO.prototype.searchTransferMarket = () => {};
  await expect(createFc27MarketReadTransport(root, { quotesOnly: true })).rejects.toMatchObject({
    message: 'FC27_MARKET_METHOD_10_CHANGED', method: 'UTItemDAO.prototype.searchTransferMarket',
    observedHash: createHash('sha256').update(String(root.UTItemDAO.prototype.searchTransferMarket)).digest('hex'),
  });
});

it.each([observation,november19])('replays the decoded native query and identification contract locally, without network, credentials or writes (%#)', capture => {
  const requests = [], calls = [];
  const phrase = 'Examine and identify incoming requests on the client-side.';
  const header = [1,52,33,16,52,35,0,2,30,23,43,52,4,10].map(index => phrase[index]).join('').toUpperCase();
  class Request {
    constructor(auth) { this.auth = auth; }
    setPath(path) { this.path = path; }
    setUrlVariables(query) { this.query = query; }
    setRequestHeader(name, value) { calls.push(['header', name, value]); }
  }
  class Observable { notify(value) { this.value = value; } }
  const ctx = vm.createContext({
    _0x436f56: () => {}, _0x370cf4: () => {}, _0x4eb729: () => {},
    EAObservable: Observable, UTHttpRequest: Request, UTHttpResponseDTO: class {},
    GAME_NAME: 'fc27', HttpRequestMethod: { GET: 'GET' }, ItemIdMask: { DATABASE: 0x00ffffff },
    SearchType: { ANY: 'any', PLAYER: 'player' }, SearchCategory: { ANY: 'any', MANAGER_LEAGUE: 'manager-league' },
    SearchLevel: { ANY: 'any', SPECIAL: 'special',FOIL:'foil',NO_FOIL:'no-foil' }, ItemColor: { INVALID: -1 }, IconTraitSearchType: { ICONTRAITS: 'icontraits' },
    ModuleEncoding: { Base64: 'base64' },
    JSUtils: { assignPropertyValues: (from, to) => Object.assign(to, from), isObject: value => value !== null && typeof value === 'object' },
    factories: { Item: { generateItemsFromItemData: items => items, generateItemsFromAuctionData: items => items } },
    services: {
      Module: { isEnabled: () => true, get: value => { calls.push(['module-get', value]); return 'fixture-request'; },
        set: value => calls.push(['module-set', value]) },
      UTUtasRequestQueue: { send: request => {
        requests.push(request);
        return { unobserve() {}, getAllResponseHeaders: () => header,
          getResponseHeader: name => name === header ? 'fixture-response' : null,
          observe(_owner, done) { done(this, { success: true, response: request.path.endsWith('/defid')
            ? { itemData: [{ resourceId: 901 }] } : { auctionInfo: [{ tradeId: 'fixture-auction' }] } }); } };
      } },
    },
  });
  for(const row of Object.values(capture.methods))for(const [,name] of row.decoded.matchAll(/=((?:a0_0x|_0x)[0-9a-f]+)/g))ctx[name]??=()=>{};
  const compile = path => vm.runInContext(`(${capture.methods[path].decoded})`, ctx);
  const identification = { challenge: 'fixture-challenge', handleRequest: compile('Identification.prototype.handleRequest'),
    handleResponse: compile('Identification.prototype.handleResponse') };
  const auth = { identification, getIdentifier: compile('FCAuthenticationService.prototype.getIdentifier') };
  const criteria = { count: 20, offset: 0, type: 'any', defId: [901], zone: -1, position: 'any', category: 'any',
    rarities: [], level: 'any', nation: 0, league: 0, club: 0, playStyle: 0, authenticity: 'any',
    primaryColor: -1, secondaryColor: -1, minBid: 0, maxBid: 0, minBuy: 0, maxBuy: 2000, icontraits: 'none' };
  const market = compile('UTItemDAO.prototype.searchTransferMarket').call({ authDelegate: auth }, criteria);
  expect(requests[0]).toMatchObject({ path: '/ut/game/fc27/transfermarket', cache: false, requestType: 'GET',
    query: { num: 20, start: 0, type: 'player', definitionId: 901, maxb: 2000 } });
  expect(market.value.response.items).toHaveLength(1);
  expect(calls).toEqual([['module-get', 'fixture-challenge'], ['header', header, 'fixture-request'], ['module-set', 0x80000400]]);
  expect(identification.challenge).toBe('fixture-response');
  const concept = compile('UTItemDAO.prototype.searchConceptItems').call({ authDelegate: auth }, { ...criteria, sort: 'asc' });
  expect(requests[1]).toMatchObject({ path: '/ut/game/fc27/defid', query: { count: 20, start: 0, sort: 'asc', type: 'player', defId: [901] } });
  expect(concept.value.response.items).toHaveLength(1);
  if(capture===november19)for(const level of ['foil','no-foil']){
    compile('UTItemDAO.prototype.searchTransferMarket').call({authDelegate:auth},{...criteria,level});
    expect(requests.at(-1).query.hypercosmetic).toBe(level);expect(requests.at(-1).query).not.toHaveProperty('lev');
    compile('UTItemDAO.prototype.searchConceptItems').call({authDelegate:auth},{...criteria,level});
    expect(requests.at(-1).query.hypercosmetic).toBe(level);expect(requests.at(-1).query).not.toHaveProperty('level');
  }
});
