import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context, snapshotFc27ClubPlayer } from './fc27-local-read.js';
import { FC27_CLUB_READ_METHODS } from './fc27-club-read.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { integer, same, fail } from '../../streamlined/contract.js';

export const FC27_STREAMLINED_STORAGE_HASH = '29b26cfe38eed39262f3976c7e122329703b37572dae41d36365966c082fab4e';
export const FC27_STREAMLINED_STORAGE_QUERY_HASH = '2e4fc68dd8d9b1fce716adeb21f09793c836545829ff0a138d4c86e2d06d404c';

// Native searchStorageItems, decoded 2026-10-07: one GET of the entire Storage
// pile, with skuMode=FUT. Its criteria are LOCAL filters, not server pagination.
// Use an owned request so 304/local cache cannot impersonate a fresh read and
// do not call the DAO's setStorageItems/cache timestamp side effects.
export async function createFc27StreamlinedStorageReader(root, { onEntity = null, nativeReauth = false } = {}) {
  const context = readFc27Context(root), dao = root.services?.Item?.itemDao;
  const methods = { search: dao?.searchStorageItems, query: root.UTHttpRequest?.prototype?.setUrlVariables };
  const native = await verifyFc27Methods({ methods, crypto: root.crypto }, [
    ['methods.search', FC27_STREAMLINED_STORAGE_HASH], ['methods.query', FC27_STREAMLINED_STORAGE_QUERY_HASH],
  ]);
  const runtime = await verifyFc27Methods(root, FC27_CLUB_READ_METHODS);
  const Request = root.UTHttpRequest, factory = root.factories?.Item, createItem = factory?.createItem;
  const auth = ownData(dao, 'authDelegate'), game = ownData(root, 'GAME_NAME'), pile = ownData(root.ItemPile, 'STORAGE');
  if (!auth || typeof game !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(game)
      || !integer(pile, 1) || typeof createItem !== 'function') fail('STORAGE_RUNTIME_UNVERIFIED');
  let busy = false, stopped = false, requests = 0;
  const assert = () => {
    runtime(); native();
    if (stopped || !same(readFc27Context(root), context) || root.services?.Item?.itemDao !== dao
        || dao.searchStorageItems !== methods.search || root.UTHttpRequest.prototype.setUrlVariables !== methods.query
        || ownData(dao, 'authDelegate') !== auth
        || root.factories?.Item !== factory || factory.createItem !== createItem
        || ownData(root.ItemPile, 'STORAGE') !== pile || root.GAME_NAME !== game) fail('STORAGE_CONTEXT_CHANGED');
  };
  return Object.freeze({ getRequestCount: () => requests, async read() {
    if (busy || stopped) fail('STORAGE_READ_BLOCKED');
    busy = true;
    try {
      assert();
      const req = new Request(auth);
      req.cache = false; req.doRetry = nativeReauth === true; req.doReauth = nativeReauth === true;
      req.timeout = 15000; req.requestType = 'GET';
      const endpoint = `/ut/game/${game}/storagepile`;
      req.setPath(endpoint);
      if (req.setUrlVariables !== methods.query) fail('STORAGE_CONTEXT_CHANGED');
      req.setUrlVariables({ skuMode: 'FUT' });
      const url = new URL(ownData(req, 'url'));
      if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint
          || url.search || ownData(req, 'urlVariables') !== '?skuMode=FUT'
          || url.hash || url.username || url.password) fail('STORAGE_ENDPOINT_UNVERIFIED');
      requests++;
      const dto = await new Promise((resolve, reject) => {
        let done = false; const owner = {};
        const finish = (error, value) => {
          if (done) return; done = true; clearTimeout(timer);
          try { req.unobserve(owner); } catch { /* owned observer only */ }
          if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => {
          stopped = true; req.doRetry = false; req.doReauth = false;
          finish(Error('FC27_STREAMLINED_STORAGE_READ_TIMEOUT'));
          try { req.abort(); } catch { /* Never retry after timeout. */ }
        }, 16000);
        try {
          req.observe(owner, (sender, value) => {
            if (done) return;
            if (sender !== req) { finish(Error('FC27_STREAMLINED_STORAGE_RESPONSE_OWNER')); return; }
            finish(null, value);
          });
          assert(); req.send();
        } catch { finish(Error('FC27_STREAMLINED_STORAGE_READ_FAILED')); }
      });
      assert();
      if (ownData(dto, 'success') !== true || ownData(dto, 'status') !== 200) {
        const status = ownData(dto, 'status');
        fail(integer(status, 100, 599) ? `STORAGE_HTTP_${status}` : 'STORAGE_RESPONSE_UNVERIFIED');
      }
      const response = ownData(dto, 'response'), data = ownData(response, 'itemData');
      if (!Array.isArray(data) || data.length > 20000 || new Set(data.map(item => ownData(item, 'id'))).size !== data.length
          || data.some(item => !integer(ownData(item, 'id'), 1) || !integer(ownData(item, 'resourceId'), 1)
            || ![undefined, 'player'].includes(ownData(item, 'itemType')))) fail('STORAGE_PAYLOAD_UNVERIFIED');
      const rows = data.map(data => {
        const entity = createItem.call(factory, { ...data });
        if (ownData(entity, 'type') !== 'player' || ownData(entity, 'id') !== data.id
            || ownData(entity, 'definitionId') !== data.resourceId || ownData(entity, 'utasPile') !== pile
            || ownData(entity, 'concept') !== false) fail('STORAGE_ENTITY_UNVERIFIED');
        const snapshot = { ...snapshotFc27ClubPlayer(entity, root), pile: 'storage' };
        onEntity?.(entity);
        return snapshot;
      });
      assert(); return rows;
    } catch (error) { stopped = true; throw error; }
    finally { busy = false; }
  } });
}
