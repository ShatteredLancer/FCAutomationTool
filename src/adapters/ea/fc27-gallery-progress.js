import { ownData, contextKey } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { FC27_CLUB_READ_METHODS } from './fc27-club-read.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { mergeGalleryAccountProgress } from '../../gallery/progress.js';

// Native concept DAO GET contract. Raw itemData keeps Gallery flags that the
// item factory drops; no shared factory hook, repository writes or capture.
const LEGACY_READ_METHODS = Object.freeze([
  ...FC27_CLUB_READ_METHODS.filter(([path]) => !path.startsWith('UTItemEntityFactory.')),
  ['UTItemDAO.prototype.searchConceptItems', '6d5080a272138db4e8ba514633e7678d43d065fde141d1cad0fa1246818aa788'],
]);
// 2026-09-29: reviewed current constructors, request path/send/abort and DAO.
// EA re-obfuscated its public asset; the raw defid query contract is unchanged.
export const FC27_GALLERY_READ_METHODS = Object.freeze([
  ['UTHttpRequest', '2397854164bed3b80e1250dc595bb87f278beac64afa9a665086b91dcdb35925'],
  ['EAHttpRequest', '76996922678762db2333635fa82497a8cf0c1af13f8faf36222c0257504bc6d1'],
  ['UTHttpRequest.prototype.setPath', 'a76f0ea6f31e1a7a2183347d5c8f4867a2d85b9eacf083b1dcd58b8dffcce0df'],
  ['UTHttpRequest.prototype.send', 'da2f34a13796aff01549443c202cf642dd03f1b2cb5c59fd7dc97ee128e51e81'],
  ['EAHttpRequest.prototype.send', 'd19611a15440170b86573c0de3ddcc378cdc9990372fcade371af71383175452'],
  ['EAHttpRequest.prototype.setRequestBody', 'b5a39fadfeba1ca87b2e8c7a8d20b3f211d46a2ea36238bf90e5e59b6fe7a3e9'],
  ['EAHttpRequest.prototype.abort', 'a683769393a3a6d7116e57e54a08d76308f05b8c0a5afc262036075d59409419'],
  ['UTItemDAO.prototype.searchConceptItems', 'edcd06d35a1fed95ead779eb152e9fce08662855bfda6ded3f0933d40236c7cc'],
]);
// Reviewed native 401 -> authenticate -> telemetry -> resend chain. Only
// Gallery's idempotent read opts in; unknown versions keep the one-send path.
export const FC27_GALLERY_AUTH_METHODS = Object.freeze([
  ['UTHttpRequest.prototype._handleFail', 'ad29c4ef6f37b0aed2e3c284a864e083993ba1c82747c0a8e431bc6df3971fd5'],
  ['UTHttpRequest.prototype._handleReauth', '1518131a7407678e440c25f024602e23944f50abea004de0f2024caf54ec024f'],
  ['UTHttpRequest.prototype.handleTelemetry', 'ace4fb1d77f081e5c7162f69515a9ef5b1d20ebbd379d9a33864af4b0bd3c4c6'],
  ['FCAuthenticationService.prototype.requestTelemetry', '213a0d05dec8d1c335744a2a975c7ac7c78e4f51ac54f243da597d3c3c3f60f9'],
]);
const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
const id = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_GALLERY_PROGRESS_UNAVAILABLE';
const fail = reason => { throw new Error(reason); };

const CARD_KEYS = Object.freeze([
  'id','timestamp','formation','untradeable','assetId','rating','dream','itemType','resourceId','owners',
  'discardValue','cardsubtypeid','lastSalePrice','injuryType','injuryGames','preferredPosition','statsList',
  'lifetimeStats','contract','rareflag','playStyle','leagueId','loyaltyBonus','pile','nation','resourceGameYear',
  'guidAssetId','attributeArray','skillmoves','weakfootabilitytypecode','preferredfoot','rankId','possiblePositions',
  'gender','baseTraits','iconTraits','hyperCosmetics','plusRoles','plusPlusRoles','gradingScore','isCollected',
  'teamId','firstName','lastName','knownAs',
]);
const arrayCopy = (value, max = 128) => Array.isArray(value) && value.length <= max
  ? value.map(item => Number.isFinite(item) || typeof item === 'string' ? item : null)
  : [];
const nativeCardData = raw => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {};
  for (const key of CARD_KEYS) {
    const value = ownData(raw, key);
    if (value === undefined) continue;
    if (['statsList','lifetimeStats','attributeArray','possiblePositions','baseTraits','iconTraits','plusRoles','plusPlusRoles'].includes(key)) {
      result[key] = arrayCopy(value);
    } else if (key === 'hyperCosmetics' && value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value).slice(0, 32).filter(([, item]) => Number.isFinite(item));
      result[key] = Object.fromEntries(entries);
    } else if (typeof value === 'boolean' || Number.isFinite(value)
      || (typeof value === 'string' && value.length <= 200)) result[key] = value;
  }
  const definitionId = ownData(raw, 'resourceId') ?? ownData(raw, 'definitionId');
  const guid = result.guidAssetId;
  if (!id(definitionId) || result.itemType !== 'player' || result.dream !== true
      || !Number.isSafeInteger(result.rareflag) || !Number.isFinite(result.rating)
      || !Array.isArray(result.attributeArray) || result.attributeArray.length !== 6 || !result.attributeArray.every(Number.isFinite)
      || (guid != null && (typeof guid !== 'string' || guid.length > 100))) return null;
  result.resourceId = definitionId;
  result.id = id(result.id) ? result.id : definitionId;
  return Object.freeze(result);
};

export function sanitizeGalleryNativeCard(raw) { return nativeCardData(raw); }

function sanitizeRows(rows, allowed) {
  if (!Array.isArray(rows) || rows.length > allowed.size) fail('FC27_GALLERY_CONCEPT_PAYLOAD_UNVERIFIED');
  const result = rows.map(raw => {
    const definitionId = ownData(raw, 'resourceId') ?? ownData(raw, 'definitionId');
    if (!id(definitionId) || !allowed.has(definitionId)) fail('FC27_GALLERY_CONCEPT_ID_UNVERIFIED');
    const flag = ownData(raw, 'isCollected'), score = ownData(raw, 'gradingScore');
    const cardData = nativeCardData(ownData(raw, 'cardData') ?? raw);
    return { definitionId, isCollected: typeof flag === 'boolean' ? flag : null,
      gradingScore: Number.isFinite(score) && score >= 0 && score <= 100000000 ? score : null,
      ...(cardData?.resourceId === definitionId ? { cardData } : {}) };
  });
  if (new Set(result.map(row => row.definitionId)).size !== result.length) fail('FC27_GALLERY_PROGRESS_DUPLICATE_CONCEPT');
  return result;
}

// Provisional Club presence is display evidence only. Absence stays unknown.
function readClub(root, allowed) {
  const result = [];
  let items = at(root, 'repositories.Item.club.items');
  for (let depth = 0; depth < 3 && ownData(items, '_collection'); depth++) items = ownData(items, '_collection');
  if (!items || typeof items !== 'object' || Object.keys(items).length > 20000) return result;
  for (const key of Object.keys(items)) {
    const raw = ownData(items, key), definitionId = ownData(raw, 'definitionId');
    if (!allowed.has(definitionId) || ownData(raw, 'type') !== 'player' || ownData(raw, 'concept') !== false
        || !id(ownData(raw, 'id'))) continue;
    const owners = ownData(raw, 'owners');
    result.push({ definitionId, owners: Number.isSafeInteger(owners) && owners > 0 && owners <= 10000 ? owners : null });
  }
  return result;
}

export function createFc27GalleryProgressReader(root, { gmGetValue, gmSetValue, now = () => Date.now(), ttlMs = 300000 } = {}) {
  const memory = new Map(), inFlight = new Map(), retryAt = new Map();
  let tail = Promise.resolve(), lastRequestAt = -Infinity;
  const scope = () => contextKey(readFc27Context(root), 'gallery-view');
  const load = async (pool, { force = false } = {}) => {
    let context;
    try { context = readFc27Context(root); } catch (error) { return { status: 'blocked', reason: safeReason(error) }; }
    if (pool?.source !== 'futgg' || pool.season !== context.season || pool.complete !== true
        || !id(pool.setId) || !Array.isArray(pool.items) || pool.items.some(row => !id(row.eaId))
        || new Set(pool.items.map(row => row.eaId)).size !== pool.items.length) {
      return { status: 'blocked', reason: 'FC27_GALLERY_POOL_UNAVAILABLE' };
    }
    const key = contextKey(context, `gallery-progress:${pool.source}:${pool.setId}`), viewScope = scope();
    const workKey = `${key}:${pool.revision}`;
    if (inFlight.has(workKey)) return inFlight.get(workKey);
    const assertScope = () => { if (!same(context, readFc27Context(root))) fail('FC27_GALLERY_CONTEXT_CHANGED'); };
    const allowed = new Set(pool.items.map(row => row.eaId));
    const observed = (value, extra = {}) => ({ status: 'observed', fetchedAt: value.fetchedAt, scope: viewScope,
      runtimeCards: new Map(value.concepts.filter(row => row.cardData).map(row => [row.definitionId, row.cardData])),
      progress: mergeGalleryAccountProgress(pool, { conceptItems: value.concepts, clubItems: readClub(root, allowed) }), ...extra });
    const run = async () => {
      let cached = memory.get(key);
      try {
        assertScope();
        if (!cached && typeof gmGetValue === 'function') try { cached = await gmGetValue(key, null); } catch { /* Optional GM cache. */ }
        assertScope();
        if (![1, 2].includes(cached?.schema) || !same(cached.context, context) || cached.revision !== pool.revision
            || !Number.isSafeInteger(cached.fetchedAt) || cached.fetchedAt < 0 || cached.fetchedAt > now()) cached = null;
        if (cached) try { cached = { ...cached, concepts: sanitizeRows(cached.concepts, allowed) }; } catch { cached = null; }
        if (!force && cached && now() - cached.fetchedAt < ttlMs) return observed(cached, { cached: true });
        if (now() < (retryAt.get(viewScope) ?? 0)) fail('FC27_GALLERY_PROGRESS_BACKOFF');
        let runtime;
        try { runtime = await verifyFc27Methods(root, FC27_GALLERY_READ_METHODS); }
        catch { runtime = await verifyFc27Methods(root, LEGACY_READ_METHODS); }
        let authRuntime = null;
        try { authRuntime = await verifyFc27Methods(root, FC27_GALLERY_AUTH_METHODS); }
        catch { /* Unreviewed native auth remains disabled; no guessed recovery. */ }
        const auth = at(root, 'services.Item.itemDao.authDelegate'), Request = ownData(root, 'UTHttpRequest');
        if (!auth || at(root, 'GAME_NAME') !== 'fc27') fail('FC27_GALLERY_CONCEPT_RUNTIME_UNVERIFIED');
        const assert = () => { assertScope(); runtime(); authRuntime?.(); if (at(root, 'services.Item.itemDao.authDelegate') !== auth) fail('FC27_GALLERY_CONTEXT_CHANGED'); };
        const concepts = [], ids = [...allowed];
        for (let start = 0; start < ids.length; start += 250) {
          const batch = ids.slice(start, start + 250);
          const wait = Math.max(0, 1000 - (now() - lastRequestAt));
          if (wait) await new Promise(resolve => setTimeout(resolve, wait));
          assert();
          const req = new Request(auth);
          if (req.send !== at(root, 'UTHttpRequest.prototype.send') || req.setPath !== at(root, 'UTHttpRequest.prototype.setPath')
              || req.abort !== at(root, 'EAHttpRequest.prototype.abort')) fail('FC27_GALLERY_CONCEPT_RUNTIME_UNVERIFIED');
          req.doRetry = false; req.doReauth = false; req.cache = false; req.timeout = 15000; req.requestType = 'GET';
          const endpoint = '/ut/game/fc27/defid'; req.setPath(endpoint);
          const url = new URL(ownData(req, 'url'));
          if (url.protocol !== 'https:' || !/(^|\.)ea\.com$/i.test(url.hostname) || url.pathname !== endpoint
              || url.search || url.hash || url.username || url.password) fail('FC27_GALLERY_ENDPOINT_UNVERIFIED');
          req.urlVariables = `?type=player&count=${batch.length}&sort=asc&start=0&defId=${batch.join(',')}`;
          lastRequestAt = now();
          const reply = await new Promise((resolve, reject) => {
            const owner = {}; let done = false, sends = 0;
            const nativeSend = req.send;
            const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer);
              req.doRetry = false; req.doReauth = false;
              try { req.unobserve(owner); } catch { /* Our observer only. */ }
              error ? reject(error) : resolve(value); };
            const timer = setTimeout(() => { finish(new Error('FC27_GALLERY_CONCEPT_TIMEOUT')); try { req.abort(); } catch { /* No retry. */ } }, 16000);
            // Native auth resumes via this request's send(). Bound that resume
            // without patching shared prototypes or reading authentication data.
            req.send = function () {
              if (done) return;
              try {
                assert();
                if (++sends > 2) fail('FC27_GALLERY_CONCEPT_RESPONSE_UNVERIFIED');
                req.doRetry = req.doReauth = !!authRuntime && sends === 1;
                lastRequestAt = now();
                nativeSend.call(req);
              } catch (error) { finish(new Error(safeReason(error))); }
            };
            try {
              req.observe(owner, (sender, value) => finish(sender === req ? null : new Error('FC27_GALLERY_RESPONSE_OWNER'), value));
              assert(); req.send();
            } catch { finish(new Error('FC27_GALLERY_CONCEPT_REQUEST_FAILED')); }
          });
          assert();
          const status = ownData(reply, 'status');
          if (ownData(reply, 'success') !== true || status !== 200) {
            fail(Number.isSafeInteger(status) && status >= 100 && status <= 599 ? `FC27_GALLERY_HTTP_${status}` : 'FC27_GALLERY_CONCEPT_RESPONSE_UNVERIFIED');
          }
          concepts.push(...sanitizeRows(ownData(ownData(reply, 'response'), 'itemData'), new Set(batch)));
        }
        assert();
        if (concepts.length < ids.length && cached?.concepts.length === ids.length) fail('FC27_GALLERY_CONCEPT_INCOMPLETE');
        const value = { schema: 2, context, revision: pool.revision, fetchedAt: now(), concepts };
        memory.set(key, value);
        try { if (typeof gmSetValue === 'function') await gmSetValue(key, value); } catch { /* Memory stays usable. */ }
        assert(); return observed(value, { cached: false });
      } catch (error) {
        const reason = safeReason(error);
        try { assertScope(); } catch { return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' }; }
        if (reason !== 'FC27_GALLERY_PROGRESS_BACKOFF') retryAt.set(viewScope, now() + ttlMs);
        return cached ? observed(cached, { cached: true, stale: true, reason }) : { status: 'blocked', reason };
      }
    };
    const task = tail.then(run).finally(() => inFlight.delete(workKey));
    tail = task.catch(() => {}); inFlight.set(workKey, task); return task;
  };
  return Object.freeze({ load, scope });
}
