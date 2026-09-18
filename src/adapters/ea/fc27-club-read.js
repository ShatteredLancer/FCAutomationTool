import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, snapshotFc27ClubPlayer } from './fc27-local-read.js';

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

const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
const validId = value => Number.isSafeInteger(value) && value > 0;

export async function createFc27ClubReadTransport(root) {
  const context = readFc27Context(root);
  const reviewed = new Map();
  const assertScope = () => {
    if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw new Error('FC27_CLUB_SCOPE_CHANGED');
  };
  for (const [index, [path, expected]] of FC27_CLUB_READ_METHODS.entries()) {
    const fn = at(root, path);
    if (typeof fn !== 'function') throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_MISSING`);
    const bytes = new globalThis.TextEncoder().encode(Function.prototype.toString.call(fn));
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected) throw new Error(`FC27_CLUB_RUNTIME_UNVERIFIED_METHOD_${index}_CHANGED`);
    reviewed.set(path, fn);
  }
  const assertRuntime = () => {
    for (const [path, fn] of reviewed) if (at(root, path) !== fn) throw new Error('FC27_CLUB_RUNTIME_UNVERIFIED');
  };
  assertRuntime();
  const Request = ownData(root, 'UTHttpRequest');
  const factory = at(root, 'factories.Item');
  const createItem = at(root, 'UTItemEntityFactory.prototype.createItem');
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
      req.doRetry = false;
      req.doReauth = false;
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
          finish(new Error('FC27_CLUB_READ_TIMEOUT'));
          try { req.abort(); } catch { /* No retry after timeout, even if abort fails. */ }
        }, 16000);
        try {
          req.observe(observer, (sender, value) => {
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
            || ownData(entity, 'definitionId') !== ownData(data, 'resourceId')) throw new Error('FC27_CLUB_ENTITY_UNVERIFIED');
        return snapshotFc27ClubPlayer(entity, root);
      });
    },
  });
}
