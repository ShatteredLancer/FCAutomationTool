import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, snapshotFc27ClubPlayer } from './fc27-local-read.js';
import { unwrapFc27ItemFactory } from './fc27-item-factory-observer.js';

// Public EA assets reviewed 2026-09-17. A changed implementation needs new evidence,
// not a fallback to cached repositories or an unreviewed request method.
export const FC27_CLUB_READ_METHODS = Object.freeze([
  ['UTHttpRequest', '539d97d365d2dce284ff22dc8d0bca7d3516549dc0b4f0e1c27b204a0910687b'],
  ['EAHttpRequest', 'efa1dc29b6b1709f95ad9ed90daed5658f822d014c9762ef575d0642cc2bf3d8'],
  ['UTHttpRequest.prototype.setPath', 'c560a9ed5afc9c93cbca649f1ee1d68209fef661b68229ea935554f3cfddc0ff'],
  ['UTHttpRequest.prototype.send', 'eb385e4af6bb6dfd7cd19ef89d6b22104fc76e103aac962a4b3e15c0bb1384bc'],
  ['EAHttpRequest.prototype.send', '11aa8103d89421128bf4781d77e906a61cec32d4b3c52b5046ed4dca69143334'],
  ['EAHttpRequest.prototype.setRequestBody', '6de3cb3455cead05cce8c08e74cbdc231ba9083b144215f06220ce67bec50ef9'],
  ['EAHttpRequest.prototype.abort', '431fe6f829c0f932686e851cfc850d90a4f85f67521527ebe68c820a8453658d'],
  ['UTItemEntityFactory.prototype.createItem', 'fc0713a05642d8d4fcebac3d20ebee458edd59f6d44e4a8a3ed84ae237391491'],
]);

// FC27 public runtime review captured 2026-10-02. EA changed only the
// obfuscator output for these request methods; decoded behavior and endpoint
// contracts were independently reviewed in
// artifacts/fc27-browser/puzzle-runtime-review-2026-10-02.json. Keep this
// compatibility set scoped to Club/Market reads; write methods remain strict.
export const FC27_CLUB_COMPATIBLE_HASHES = Object.freeze({
  UTHttpRequest: '2397854164bed3b80e1250dc595bb87f278beac64afa9a665086b91dcdb35925',
  EAHttpRequest: '76996922678762db2333635fa82497a8cf0c1af13f8faf36222c0257504bc6d1',
  'UTHttpRequest.prototype.setPath': 'a76f0ea6f31e1a7a2183347d5c8f4867a2d85b9eacf083b1dcd58b8dffcce0df',
  'UTHttpRequest.prototype.send': 'da2f34a13796aff01549443c202cf642dd03f1b2cb5c59fd7dc97ee128e51e81',
  'EAHttpRequest.prototype.send': 'd19611a15440170b86573c0de3ddcc378cdc9990372fcade371af71383175452',
  'EAHttpRequest.prototype.setRequestBody': 'b5a39fadfeba1ca87b2e8c7a8d20b3f211d46a2ea36238bf90e5e59b6fe7a3e9',
  'EAHttpRequest.prototype.abort': 'a683769393a3a6d7116e57e54a08d76308f05b8c0a5afc262036075d59409419',
  // FC27 runtime review 2026-10-02: observer notification dispatch was
  // obfuscated again while its decoded contract stayed unchanged. This is
  // a local synchronization method, not a request or write method.
  'EAObservable.prototype.notify': '626035e884aceedbca0ba6ddf853134ffeecaba9414b92a6d7a41a78474063f2',
});

const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
const validId = value => Number.isSafeInteger(value) && value > 0;

export async function createFc27ClubReadTransport(root, { onEntity = null, nativeReauth = false } = {}) {
  const context = readFc27Context(root);
  const reviewed = new Map();
  let factoryOutputValidated = false;
  const assertScope = () => {
    if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error('FC27_CLUB_SCOPE_CHANGED');
  };
  for (const [index, [path, expected]] of FC27_CLUB_READ_METHODS.entries()) {
    const binding = at(root, path);
    const fn = path === 'UTItemEntityFactory.prototype.createItem' ? unwrapFc27ItemFactory(binding) : binding;
    if (typeof fn !== 'function') throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_MISSING`);
    const bytes = new globalThis.TextEncoder().encode(Function.prototype.toString.call(fn));
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected && hash !== ownData(FC27_CLUB_COMPATIBLE_HASHES, path)) {
      // Entity factories are frequently wrapped by Gallery/Enhancer/FSU for
      // passive metadata. They do not authenticate or mutate EA; accept the
      // current binding only when the returned entity passes the exact output
      // identity checks below. All request and transaction methods remain
      // hash-gated.
      if (path !== 'UTItemEntityFactory.prototype.createItem') {
        throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_CHANGED`);
      }
      factoryOutputValidated = true;
      reviewed.set(path, binding);
    } else if (path === 'UTItemEntityFactory.prototype.createItem') {
      // Keep the live factory binding when a passive wrapper was installed
      // around the reviewed implementation. The wrapper is checked by the
      // output identity guard below and again at each read.
      reviewed.set(path, binding);
      if (binding !== fn) factoryOutputValidated = true;
    } else reviewed.set(path, fn);
  }
  const assertRuntime = () => {
    for (const [path, fn] of reviewed) if (at(root, path) !== fn) throw new Error('FC27_CLUB_RUNTIME_UNVERIFIED');
  };
  assertRuntime();
  const Request = ownData(root, 'UTHttpRequest');
  const factory = at(root, 'factories.Item');
  const createItem = reviewed.get('UTItemEntityFactory.prototype.createItem');
  const authDelegate = at(root, 'services.Club.clubDao.authDelegate');
  const game = ownData(root, 'GAME_NAME');
  if (!authDelegate || typeof game !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(game)
      || at(root, 'HttpRequestMethod.GET') !== 'GET' || at(root, 'HttpRequestMethod.POST') !== 'POST'
      || at(root, 'ItemType.PLAYER') !== 'player' || !factory || factory.createItem !== createItem) {
    throw new Error('FC27_CLUB_RUNTIME_UNVERIFIED_DEPENDENCIES');
  }
  assertScope();
  let busy = false;
  let stopped = false;
  let lastRequestAt = 0;
  let requests = 0;

  async function request(kind, body) {
    if (busy || stopped) throw new Error('FC27_CLUB_READ_BLOCKED');
    busy = true;
    try {
      const delay = Math.max(0, 800 - (Date.now() - lastRequestAt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      assertScope();
      assertRuntime();
      const req = new Request(authDelegate);
      // Use a new native request and its own observable/XHR, never a global response
      // hook, merged DAO result or queue-deduplicated request owned by another caller.
      if (req.send !== reviewed.get('UTHttpRequest.prototype.send')
          || req.setPath !== reviewed.get('UTHttpRequest.prototype.setPath')
          || req.setRequestBody !== reviewed.get('EAHttpRequest.prototype.setRequestBody')
          || req.abort !== reviewed.get('EAHttpRequest.prototype.abort')) throw new Error('FC27_CLUB_RUNTIME_UNVERIFIED');
      req.doRetry = nativeReauth === true;
      // Gallery browsing follows EA/Enhancer's native 401 session
      // renewal. Existing inspection/submission callers retain no-reauth.
      req.doReauth = nativeReauth === true;
      req.timeout = 15000;
      req.requestType = kind === 'stats' ? 'GET' : 'POST';
      const endpoint = `/ut/game/${game}/club${kind === 'stats' ? '/stats/club' : ''}`;
      req.setPath(endpoint);
      const url = new URL(ownData(req, 'url'));
      if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname)
          || url.pathname !== endpoint || url.search || url.hash || url.username || url.password) {
        throw new Error('FC27_CLUB_ENDPOINT_UNVERIFIED');
      }
      if (body) req.setRequestBody(body);
      lastRequestAt = Date.now();
      requests++;
      const dto = await new Promise((resolve, reject) => {
        const observer = {};
        let done = false;
        const finish = (error, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { req.unobserve(observer); } catch { /* Only our observer is removed. */ }
          if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => {
          stopped = true;
          // A pending native reauthentication callback must not resend after
          // this owned read has timed out and its observer has been removed.
          req.doRetry = false; req.doReauth = false;
          finish(new Error('FC27_CLUB_READ_TIMEOUT'));
          try { req.abort(); } catch { /* No retry after timeout, even if abort fails. */ }
        }, 16000);
        try {
          req.observe(observer, (sender, value) => {
            if (done) return;
            if (sender !== req) { finish(new Error('FC27_CLUB_RESPONSE_OWNER_MISMATCH')); return; }
            finish(null, value);
          });
          req.send();
        } catch { finish(new Error('FC27_CLUB_REQUEST_FAILED')); }
      });
      assertScope();
      const status = ownData(dto, 'status');
      if (ownData(dto, 'success') !== true || status !== 200) {
        throw new Error(Number.isInteger(status) && status >= 100 && status <= 599
          ? `FC27_CLUB_HTTP_${status}` : 'FC27_CLUB_RESPONSE_UNVERIFIED');
      }
      const response = ownData(dto, 'response');
      if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('FC27_CLUB_RESPONSE_UNVERIFIED');
      return response;
    } catch (error) {
      stopped = true;
      throw error;
    } finally { busy = false; }
  }

  return Object.freeze({
    getRequestCount: () => requests,
    readCount: async () => {
      const response = await request('stats');
      const stats = ownData(response, 'stat');
      if (!Array.isArray(stats) || stats.length > 100) throw new Error('FC27_CLUB_STATS_UNVERIFIED');
      const players = stats.filter(entry => ownData(entry, 'type') === 'players');
      const count = players.length === 1 ? ownData(players[0], 'typeValue') : null;
      if (!Number.isSafeInteger(count) || count < 0 || count > 20000) throw new Error('FC27_CLUB_STATS_UNVERIFIED');
      return count;
    },
    readPage: async ({ start, count, definitionIds }) => {
      if (!Number.isInteger(start) || start < 0 || start > 20000 || !Number.isInteger(count) || count < 1 || count > 250
          || !Array.isArray(definitionIds) || definitionIds.length > 50 || definitionIds.some(id => !validId(id))
          || new Set(definitionIds).size !== definitionIds.length) throw new Error('FC27_CLUB_QUERY_INVALID');
      // These fields are the Club DAO's documented search body, not a mutation.
      const body = { type: 'player', start, count };
      if (definitionIds.length) body.defId = definitionIds.join(',');
      const response = await request('players', body);
      const payload = ownData(response, 'itemData');
      if (!Array.isArray(payload) || payload.length > count) throw new Error('FC27_CLUB_PAYLOAD_UNVERIFIED');
      if (!payload.length && Object.keys(response).some(key => key !== 'itemData'
          && Array.isArray(ownData(response, key)) && ownData(response, key).length > 0)) {
        throw new Error('FC27_CLUB_PAYLOAD_UNVERIFIED');
      }
      return payload.map(data => {
        if (!validId(ownData(data, 'id')) || !validId(ownData(data, 'resourceId'))
            || ![undefined, 'player'].includes(ownData(data, 'itemType')) || ownData(data, 'count') !== undefined
            || ownData(data, 'cardassetid') !== undefined) throw new Error('FC27_CLUB_PAYLOAD_UNVERIFIED');
        // Fresh entities are kept local, never inserted into or used to delete EA cache.
        const entity = createItem.call(factory, { ...data });
        if (ownData(entity, 'type') !== 'player' || ownData(entity, 'id') !== ownData(data, 'id')
            || ownData(entity, 'definitionId') !== ownData(data, 'resourceId')
            || factoryOutputValidated && ownData(entity, 'concept') === true) throw new Error('FC27_CLUB_ENTITY_UNVERIFIED');
        const snapshot = snapshotFc27ClubPlayer(entity, root);
        // Optional local consumer; never insert a fresh entity into EA/FSU's
        // shared repositories. The regular snapshot-only contract is unchanged.
        onEntity?.(entity);
        return snapshot;
      });
    },
  });
}
