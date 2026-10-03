import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { FC27_CLUB_READ_METHODS } from './fc27-club-read.js';
import { unwrapFc27ItemFactory } from './fc27-item-factory-observer.js';
import { MAX_PUZZLE_QUOTE_PRICE, PUZZLE_MARKET_READ_LIMIT, isPuzzleQuoteCeiling } from '../../fc27/puzzle-procurement-policy.js';

// Public FC27 sources reviewed 2026-09-26, captured 2026-09-17. No service
// market search: its page cache can contain another caller's search results.
export const FC27_MARKET_READ_METHODS = Object.freeze([
  ...FC27_CLUB_READ_METHODS,
  ['factories.Item.generateItemsFromItemData', '6147c9f404a3638daa032c5ab89818f0856e56f7bb7192ae4e7a0ca988e5ce72'],
  ['UTItemDAO.prototype.searchConceptItems', '6d5080a272138db4e8ba514633e7678d43d065fde141d1cad0fa1246818aa788'],
  ['UTItemDAO.prototype.searchTransferMarket', '3894f730c0e1bbcf0ff8dc1f5290f35c21e8906fdcf6a6344714e66d0739d90e'],
  ['FCAuthenticationService.prototype.getIdentifier', '30d1c91b414f508725e07f81c0577e40308be93ea92925051b21740c2781dbc3'],
  ['Identification.prototype.handleRequest', '74627d97570009ea15aea10dd2ff26d4ac85c8eeaea55f53253b6d3f9bb0eb09'],
  ['Identification.prototype.handleResponse', 'cc4de06cc8696a4723f9539159c912c6d7cd4b7263ccaf7db9d7198b2f31ff01'],
]);
// Public runtime reviewed 2026-10-02: decoded bodies are unchanged; only EA's
// obfuscator identifiers/string indexes changed. Scope these hashes to Market
// reads, not Club or write transactions. Evidence: market-runtime-review.mjs.
const compatibleHashes = Object.freeze({
  'UTHttpRequest': '2397854164bed3b80e1250dc595bb87f278beac64afa9a665086b91dcdb35925',
  'EAHttpRequest': '76996922678762db2333635fa82497a8cf0c1af13f8faf36222c0257504bc6d1',
  'UTHttpRequest.prototype.setPath': 'a76f0ea6f31e1a7a2183347d5c8f4867a2d85b9eacf083b1dcd58b8dffcce0df',
  'UTHttpRequest.prototype.send': 'da2f34a13796aff01549443c202cf642dd03f1b2cb5c59fd7dc97ee128e51e81',
  'EAHttpRequest.prototype.send': 'd19611a15440170b86573c0de3ddcc378cdc9990372fcade371af71383175452',
  'EAHttpRequest.prototype.setRequestBody': 'b5a39fadfeba1ca87b2e8c7a8d20b3f211d46a2ea36238bf90e5e59b6fe7a3e9',
  'EAHttpRequest.prototype.abort': 'a683769393a3a6d7116e57e54a08d76308f05b8c0a5afc262036075d59409419',
  'UTItemDAO.prototype.searchConceptItems': 'edcd06d35a1fed95ead779eb152e9fce08662855bfda6ded3f0933d40236c7cc',
  'UTItemDAO.prototype.searchTransferMarket': 'dceda80c8f59ac33349b5fb1eeecb4705834e0c0bc094bdb80fc98494b561111',
  'FCAuthenticationService.prototype.getIdentifier': '963bdc4c7fca39df8d4865716ceae2e323da2e16ca70287be4c9f00149494dc2',
  'Identification.prototype.handleRequest': 'b2c26d4d12aab146387df266044ffbab40e77b96d7b3328ac55f32d99d767949',
  'Identification.prototype.handleResponse': '2fb555ef84ebf2a1c71b05095ec37955733f40ab55e48e3849d3b49636f3abb4',
});
const at = (root, path) => path.split('.').reduce((v, key) => ownData(v, key), root);
const valid = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const num = (v, min = 1, max = 1e9) => valid(v, min, max) ? v : null;
const error = code => new Error(`FC27_MARKET_${code}`);
// Display-only name lookup from EA's already-loaded public player metadata.
// It does not invoke repository getters, request data, or identify an owned card.
export function readFc27MarketPlayerName(root, definitionId) {
  const mask = at(root, 'ItemIdMask.DATABASE');
  if (!valid(definitionId, 1, 0x7fffffff) || !valid(mask, 1, 0x7fffffff)) return null;
  const assetId = definitionId & mask;
  const entry = ownData(at(root, 'repositories.Item.staticData._collection'), String(assetId));
  if (ownData(entry, 'id') !== assetId) return null;
  const part = key => {
    const value = ownData(entry, key);
    return typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f]/.test(value) && /[\p{L}\p{N}]/u.test(value) ? value.trim() : '';
  };
  return part('commonName') || [part('firstName'), part('lastName')].filter(Boolean).join(' ') || null;
}
export function marketReadReason(caught) {
  return /^FC27_(?:MARKET_[A-Z0-9_]+|CONTEXT_UNAVAILABLE)$/.test(caught?.message ?? '')
    ? caught.message : 'FC27_MARKET_READ_FAILED';
}
function numbers(value, limit, max) {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result = Array.from({ length: value.length }, (_, i) => num(ownData(value, String(i)), 0, max));
  return result.includes(null) || new Set(result).size !== result.length ? null : result;
}
function publicPlayer(entity, resourceId) {
  if (ownData(entity, 'definitionId') !== resourceId) throw error('ENTITY_UNVERIFIED_DEFINITION_MISMATCH');
  if (ownData(entity, 'type') !== 'player') throw error('ENTITY_UNVERIFIED_TYPE_MISMATCH');
  const get = key => ownData(entity, key);
  const rarity = num(get('_rareflag'), 0, 10000);
  const upgrades = get('upgrades');
  const cosmetics = get('cosmetics'); const hyper = get('_hyperCosmeticDTOs');
  const staticData = get('_staticData');
  const part = key => {
    const value = ownData(staticData, key);
    return typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f]/.test(value) ? value.trim() : '';
  };
  const displayName = part('knownAs') || [part('firstName'), part('lastName')].filter(Boolean).join(' ');
  return { definitionId: resourceId, rating: upgrades === null ? num(get('_rating'), 1, 99) : null,
    ...(displayName ? { displayName } : {}),
    rarity, nationId: num(get('nationId')), leagueId: num(get('leagueId')), teamId: num(get('teamId')),
    positions: upgrades === null ? numbers(get('basePossiblePositions'), 28, 27) : null,
    groups: numbers(get('groups'), 128, 10000),
    special: rarity === null ? null : ![0, 1].includes(rarity),
    evolution: upgrades === undefined ? null : upgrades !== null,
    cosmetic: Array.isArray(cosmetics) && hyper && typeof hyper === 'object' && !Array.isArray(hyper)
      ? cosmetics.length > 0 || Object.getOwnPropertyNames(hyper).length > 0 : null };
}
const publicCatalogIdentityError = (entity, raw, definitionId) => {
  if (ownData(entity, 'definitionId') !== definitionId) return error('ENTITY_UNVERIFIED_DEFINITION_MISMATCH');
  if (ownData(entity, 'type') !== 'player') return error('ENTITY_UNVERIFIED_TYPE_MISMATCH');
  // The public /defid endpoint returns database versions, not owned Club
  // entities. Its item id is absent or a non-owned placeholder in some FC27
  // responses, and the native factory may normalize that value. Enforce an id
  // match only when both sides expose a real positive item identity.
  const rawId = ownData(raw, 'id');
  const entityId = ownData(entity, 'id');
  if (num(rawId) !== null && num(entityId) !== null && rawId !== entityId) return error('ENTITY_UNVERIFIED_ID_MISMATCH');
  return null;
};
function method(object, key) {
  for (let depth = 0; object && depth < 5; depth++, object = Object.getPrototypeOf(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    if (d) return Object.hasOwn(d, 'value') ? d.value : undefined;
  }
}

export async function createFc27MarketReadTransport(root, { maxRequests = 8, quotesOnly = false } = {}) {
  if (!valid(maxRequests, 1, PUZZLE_MARKET_READ_LIMIT) || typeof quotesOnly !== 'boolean') throw error('QUERY_INVALID');
  const context = readFc27Context(root);
  const reviewed = new Map();
  const bindings = new Map();
  let factoryOutputValidated = false;
  const marketFactory = quotesOnly ? null : at(root, 'factories.Item');
  for (const [index, [path, expected]] of FC27_MARKET_READ_METHODS.entries()) {
    if (quotesOnly && ['UTItemEntityFactory.prototype.createItem', 'factories.Item.generateItemsFromItemData',
      'UTItemDAO.prototype.searchConceptItems'].includes(path)) continue;
    const binding = path === 'factories.Item.generateItemsFromItemData'
      ? method(marketFactory, 'generateItemsFromItemData') : at(root, path);
    const fn = path === 'UTItemEntityFactory.prototype.createItem' ? unwrapFc27ItemFactory(binding) : binding;
    if (typeof fn !== 'function') throw error(`METHOD_${index}_MISSING`);
    const digest = await root.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(Function.prototype.toString.call(fn)));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== expected && hash !== ownData(compatibleHashes, path)) {
      if (path !== 'UTItemEntityFactory.prototype.createItem') throw error(`METHOD_${index}_CHANGED`);
      // Gallery/Enhancer/FSU may decorate EA's pure entity factory. Keep the
      // live binding, then enforce exact output identity in materialize(); no
      // request or write method is accepted by this fallback.
      factoryOutputValidated = true;
      reviewed.set(path, binding);
    } else reviewed.set(path, fn);
    bindings.set(path, binding);
  }
  const Request = at(root, 'UTHttpRequest');
  const auth = at(root, 'services.Item.itemDao.authDelegate');
  const factory = marketFactory;
  const generateItems = quotesOnly ? null : reviewed.get('factories.Item.generateItemsFromItemData');
  const createItem = reviewed.get('UTItemEntityFactory.prototype.createItem');
  const identifier = ownData(auth, 'identification');
  const assertRuntime = () => {
    if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw error('SCOPE_CHANGED');
    for (const [path, fn] of bindings) {
      const current = path === 'factories.Item.generateItemsFromItemData'
        ? method(factory, 'generateItemsFromItemData') : at(root, path);
      if (current !== fn) throw error('RUNTIME_CHANGED');
    }
    if (at(root, 'GAME_NAME') !== 'fc27' || at(root, 'HttpRequestMethod.GET') !== 'GET'
        || at(root, 'services.Item.itemDao.authDelegate') !== auth || !auth || !identifier
        || ownData(auth, 'identification') !== identifier
        || method(auth, 'getIdentifier') !== reviewed.get('FCAuthenticationService.prototype.getIdentifier')
        || method(identifier, 'handleRequest') !== reviewed.get('Identification.prototype.handleRequest')
        || method(identifier, 'handleResponse') !== reviewed.get('Identification.prototype.handleResponse')
        || !quotesOnly && (at(root, 'factories.Item') !== factory
          || method(factory, 'createItem') !== bindings.get('UTItemEntityFactory.prototype.createItem')
          || method(factory, 'generateItemsFromItemData') !== bindings.get('factories.Item.generateItemsFromItemData'))) throw error('DEPENDENCIES_UNVERIFIED');
  };
  assertRuntime();
  let busy = false; let stopped = false; let requests = 0; let lastRequestAt = null;

  async function request(kind, query, project) {
    if (busy || stopped || requests >= maxRequests) throw error('READ_BLOCKED');
    busy = true;
    let failureDetails = null;
    try {
      const delay = lastRequestAt === null ? 0 : Math.max(0, 800 - (Date.now() - lastRequestAt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      assertRuntime();
      const req = new Request(auth);
      for (const [key, path] of [['send', 'UTHttpRequest.prototype.send'], ['setPath', 'UTHttpRequest.prototype.setPath'],
        ['abort', 'EAHttpRequest.prototype.abort']]) if (method(req, key) !== reviewed.get(path)) throw error('RUNTIME_CHANGED');
      req.doRetry = false; req.doReauth = false; req.timeout = 15000; req.cache = false; req.requestType = 'GET';
      const endpoint = `/ut/game/fc27/${kind === 'catalog' ? 'defid' : 'transfermarket'}`;
      req.setPath(endpoint);
      const url = new URL(ownData(req, 'url'));
      if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname)
          || url.pathname !== endpoint || url.search || url.hash || url.username || url.password) throw error('ENDPOINT_UNVERIFIED');
      req.urlVariables = `?${new URLSearchParams(query).toString()}`;
      // Preserve EA's native request identification; never inspect or export it.
      if (kind === 'quotes') reviewed.get('Identification.prototype.handleRequest').call(identifier, req);
      lastRequestAt = Date.now(); requests++;
      const dto = await new Promise((resolve, reject) => {
        const observer = {}; let done = false;
        const finish = (err, value) => {
          if (done) return; done = true; clearTimeout(timer);
          try { req.unobserve(observer); } catch { /* Only our observer. */ }
          if (err) reject(err); else resolve(value);
        };
        const timer = setTimeout(() => {
          finish(error('READ_TIMEOUT')); try { req.abort(); } catch { /* No retry. */ }
        }, 16000);
        try {
          req.observe(observer, (sender, value) => {
            if (done) return;
            if (sender !== req) { finish(error('RESPONSE_OWNER_MISMATCH')); return; }
            try {
              if (kind === 'quotes') reviewed.get('Identification.prototype.handleResponse').call(identifier, req);
              finish(null, value);
            } catch { finish(error('RESPONSE_UNVERIFIED')); }
          });
          req.send();
        } catch { finish(error('REQUEST_FAILED')); }
      });
      assertRuntime();
      const status = ownData(dto, 'status');
      if (ownData(dto, 'success') !== true || status !== 200) {
        // Numeric EA subcodes only: never retain the response, messages or credentials.
        const rawCode = ownData(ownData(dto, 'response'), 'code');
        const code = typeof rawCode === 'string' && /^\d{1,10}$/.test(rawCode) ? Number(rawCode) : rawCode;
        failureDetails = { httpStatus: valid(status, 100, 599) ? status : null,
          eaCode: valid(code, 0, 0x7fffffff) ? code : null };
        throw error(valid(status, 100, 599) ? `HTTP_${status}` : 'RESPONSE_UNVERIFIED');
      }
      const body = ownData(dto, 'response');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('RESPONSE_UNVERIFIED');
      const result = project(body);
      assertRuntime();
      return result;
    } catch (caught) {
      stopped = true;
      const failure = new Error(marketReadReason(caught));
      if (failureDetails) failure.marketFailure = failureDetails;
      throw failure;
    }
    finally { busy = false; }
  }
  function materialize(raw) {
    const definitionId = num(ownData(raw, 'resourceId'), 1, Number.MAX_SAFE_INTEGER);
    if (definitionId === null || ![undefined, 'player'].includes(ownData(raw, 'itemType'))
        || ownData(raw, 'count') !== undefined || ownData(raw, 'cardassetid') !== undefined) throw error('PAYLOAD_UNVERIFIED');
    const source = structuredClone(raw);
    let entity;
    try {
      // Match EA's native /defid path: generateItemsFromItemData owns the
      // createItem call and applies the same consumable/entity normalization
      // used by the Web App. Keep the result local and never insert it into a
      // repository or treat it as an owned card.
      const generated = generateItems.call(factory, [source]);
      if (!Array.isArray(generated) || generated.length !== 1) throw new Error('factory output');
      entity = generated[0];
    } catch { throw error('ENTITY_FACTORY_FAILED'); }
    const identityError = publicCatalogIdentityError(entity, raw, definitionId);
    if (identityError) throw identityError;
    const projected = publicPlayer(entity, definitionId);
    // A catalog version is intentionally represented as a concept candidate;
    // concept=true is expected for some native FC27 /defid payloads and does
    // not authorize a save or submit. The Puzzle planner treats every catalog
    // result as purchase-only until an exact Club receipt is materialized.
    return projected;
  }
  return Object.freeze({
    getRequestCount: () => requests,
    readCatalogPage: async (query = {}) => {
      if (quotesOnly) throw error('CATALOG_DISABLED');
      if (!query || Object.keys(query).some(k => !['start', 'count', 'level', 'nation', 'league', 'team'].includes(k))
          || !valid(query.start, 0, 1000) || !valid(query.count, 1, 50) || !['bronze', 'silver', 'gold'].includes(query.level)
          || ['nation', 'league', 'team'].some(k => query[k] !== undefined && !valid(query[k], 1, 1e9))) throw error('QUERY_INVALID');
      return request('catalog', { type: 'player', sort: 'asc', ...query }, body => {
        const raw = ownData(body, 'itemData');
        if (!Array.isArray(raw) || raw.length > query.count) throw error('PAYLOAD_UNVERIFIED');
        const entries = raw.map(materialize);
        if (new Set(entries.map(p => p.definitionId)).size !== entries.length) throw error('DUPLICATE_DEFINITION');
        return { status: 'observed', season: '27', source: 'ea-defid', observedAt: Date.now(), entries,
          query: { ...query }, complete: false, pageEndObserved: raw.length < query.count };
      });
    },
    readQuotePage: async (query = {}) => {
      if (!query || Object.keys(query).some(k => !['definitionId', 'start', 'count', 'maxBuy'].includes(k))
          || !valid(query.definitionId, 1, Number.MAX_SAFE_INTEGER) || !valid(query.start, 0, 1000)
          || !valid(query.count, 1, 50) || !isPuzzleQuoteCeiling(query.maxBuy)) throw error('QUERY_INVALID');
      return request('quotes', { type: 'player', definitionId: query.definitionId, start: query.start,
        num: query.count, ...(query.maxBuy === null ? {} : { maxb: query.maxBuy }) }, body => {
        const rows = ownData(body, 'auctionInfo');
        if (!Array.isArray(rows) || rows.length > query.count) throw error('PAYLOAD_UNVERIFIED');
        const ids = new Set(); const prices = []; const listings = [];
        for (const row of rows) {
          const item = ownData(row, 'itemData');
          if (ownData(item, 'resourceId') !== query.definitionId) throw error('DEFINITION_MISMATCH');
          const tradeId = ownData(row, 'tradeId');
          if (!(valid(tradeId, 1, Number.MAX_SAFE_INTEGER) || typeof tradeId === 'string' && /^[1-9]\d{0,19}$/.test(tradeId))
              || ids.has(String(tradeId))) throw error('AUCTION_IDENTITY_UNVERIFIED');
          ids.add(String(tradeId));
          const price = ownData(row, 'buyNowPrice');
          if (ownData(row, 'tradeState') === 'active' && valid(ownData(row, 'expires'), 1, 604800)
              && valid(price, 150, query.maxBuy ?? MAX_PUZZLE_QUOTE_PRICE) && ownData(row, 'tradeOwner') === false
              && ownData(item, 'untradeable') === false) {
            prices.push(price);
            const bid = ownData(row, 'currentBid'), starting = ownData(row, 'startingBid');
            listings.push({ buyNow: price, expires: ownData(row, 'expires'),
              currentBid: valid(bid, 0, MAX_PUZZLE_QUOTE_PRICE) ? bid : null,
              startingBid: valid(starting, 150, MAX_PUZZLE_QUOTE_PRICE) ? starting : null });
          }
        }
        return { status: 'observed', season: '27', platform: context.platform, definitionId: query.definitionId,
          source: 'ea-visible-buy-now', observedAt: Date.now(), returned: rows.length, eligible: prices.length,
          price: prices.length ? Math.min(...prices) : null, complete: false,
          listings: listings.sort((a, b) => a.buyNow - b.buyNow || a.expires - b.expires),
          executable: false, marketAvailabilityVerified: false };
      });
    },
  });
}

// One silver catalog page and at most three exact-version quote pages. No full
// scan, buying, cache changes, or export of account/item/auction identities.
export async function probeFc27MarketRuntime(root) {
  let transport;
  try {
    transport = await createFc27MarketReadTransport(root);
    const catalog = await transport.readCatalogPage({ start: 0, count: 20, level: 'silver' });
    const sample = catalog.entries.filter(p => p.rating >= 65 && p.rating <= 74
      && p.special === false && p.evolution === false && p.cosmetic === false).slice(0, 3);
    const quotes = [];
    for (const item of sample) quotes.push(await transport.readQuotePage({ definitionId: item.definitionId, start: 0, count: 20, maxBuy: 2000 }));
    return { status: 'observed', reason: 'FC27_MARKET_SAMPLE_OBSERVED', catalog, quotes,
      requests: transport.getRequestCount(), executable: false, liveExecutionEnabled: false,
      pending: ['CATALOG_COVERAGE', 'CHALLENGE_QUERY_ROUTES', 'FRESH_PLAN'] };
  } catch (caught) {
    return { status: 'blocked', reason: marketReadReason(caught), requests: transport?.getRequestCount() ?? 0,
      executable: false, liveExecutionEnabled: false };
  }
}
