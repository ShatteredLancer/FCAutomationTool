import { ownData, contextKey } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { mergeGalleryAccountProgress } from '../../gallery/progress.js';
import { GALLERY_TOP_CANDIDATE_LIMIT } from '../../gallery/pool.js';

// Behavioral reference: Enhancer 27.0.0.4, b_/GAe/iFe/fy. Requests and
// authentication belong to EA's service/DAO/queue, not to this adapter.
const at = (root, path) => path.split('.').reduce((value, key) => ownData(value, key), root);
const id = value => Number.isSafeInteger(value) && value > 0;
// EA's concept search accepts database IDs and may return every revision in
// that family. Keep the same mask as ItemIdMask.DATABASE from the native app,
// without using bitwise coercion on values outside the signed 32-bit range.
const databaseId = value => id(value) ? value % 16777216 : null;
const sameDatabaseId = (left, right) => databaseId(left) === databaseId(right);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_GALLERY_PROGRESS_UNAVAILABLE';
const fail = reason => { throw new Error(reason); };

const CARD_KEYS = Object.freeze([
  'id','definitionId','timestamp','formation','untradeable','assetId','rating','dream','itemType','resourceId','owners',
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
      || result.definitionId != null && result.definitionId !== definitionId
      || !Number.isSafeInteger(result.rareflag) || !Number.isFinite(result.rating)
      || !Array.isArray(result.attributeArray) || result.attributeArray.length !== 6 || !result.attributeArray.every(Number.isFinite)
      || (guid != null && (typeof guid !== 'string' || guid.length > 100))) return null;
  result.resourceId = definitionId;
  result.definitionId = definitionId;
  result.id = id(result.id) ? result.id : definitionId;
  return Object.freeze(result);
};

export function sanitizeGalleryNativeCard(raw) { return nativeCardData(raw); }

function sanitizeRows(rows, allowed, accepts = value => allowed.has(value), maxRows = allowed.size) {
  if (!Array.isArray(rows) || rows.length > maxRows) fail('FC27_GALLERY_CONCEPT_PAYLOAD_UNVERIFIED');
  const result = rows.map(raw => {
    const definitionId = ownData(raw, 'resourceId') ?? ownData(raw, 'definitionId');
    if (!id(definitionId) || !accepts(definitionId)) fail('FC27_GALLERY_CONCEPT_ID_UNVERIFIED');
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
function readClubSnapshot(root) {
  const result = [];
  let items = at(root, 'repositories.Item.club.items');
  for (let depth = 0; depth < 3 && ownData(items, '_collection'); depth++) items = ownData(items, '_collection');
  if (!items || typeof items !== 'object' || Object.keys(items).length > 20000) return result;
  for (const key of Object.keys(items)) {
    const raw = ownData(items, key), definitionId = ownData(raw, 'definitionId');
    if (ownData(raw, 'type') !== 'player' || ownData(raw, 'concept') !== false || !id(ownData(raw, 'id'))) continue;
    const owners = ownData(raw, 'owners');
    result.push({ definitionId, owners: Number.isSafeInteger(owners) && owners > 0 && owners <= 10000 ? owners : null });
  }
  return result;
}

export function createFc27GalleryProgressReader(root, { gmGetValue, gmSetValue, diagnosticLog, now = () => Date.now(), ttlMs = 300000 } = {}) {
  const states = new Map(), inFlight = new Map(), listeners = new Set(), rawByItem = new WeakMap(), nativePending = new Set();
  let tail = Promise.resolve(), running = null, disposed = false, factoryHook = null;
  const record = entry => {
    try { Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', source: 'ea', ...entry })).catch(() => {}); }
    catch { /* Logs do not affect EA's request or authentication. */ }
  };
  const scope = () => contextKey(readFc27Context(root), 'gallery-view');
  const notify = () => { for (const listener of listeners) try { listener(); } catch { /* UI only. */ } };
  const stateFor = context => {
    const key = contextKey(context, 'gallery-collection');
    if (!states.has(key)) states.set(key, { key, context, rows: new Map(), reading: null, writing: Promise.resolve(),
      fetchedAt: 0, syncedAt: null, fullSyncAt: null, coveredDefinitionIds: new Set(), setSyncedAt: {},
      sessionSynced: false, retryAt: 0, timer: null, clubSnapshot: null, clubSnapshotAt: 0, displayEntities: new Map() });
    return states.get(key);
  };
  const assert = context => { if (disposed || !same(context, readFc27Context(root))) fail('FC27_GALLERY_CONTEXT_CHANGED'); };
  const merge = (state, rows) => {
    let changed = false;
    for (const row of rows) {
      const previous = state.rows.get(row.definitionId);
      const owners = [previous?.collectedOwners, row.collectedOwners].filter(value => id(value));
      const next = { ...previous, ...row,
        isCollected: previous?.isCollected === true || row.isCollected === true ? true : row.isCollected,
        ...(owners.length ? { collectedOwners: Math.min(...owners) } : {}),
        cardData: row.cardData ?? previous?.cardData };
      if (!same(previous, next)) { state.rows.set(row.definitionId, next); changed = true; }
    }
    return changed;
  };
  const restore = state => state.reading ??= (async () => {
    let saved;
    try { saved = await gmGetValue?.(state.key, null); } catch { /* Optional persistence. */ }
    assert(state.context);
    if (saved?.schema !== 3 || !same(saved.context, state.context) || !Array.isArray(saved.concepts)
        || saved.concepts.length > 100000 || !Number.isSafeInteger(saved.fetchedAt) || saved.fetchedAt > now()) return;
    try {
      const rows = sanitizeRows(saved.concepts, new Set(saved.concepts.map(row => row.definitionId)));
      for (let i = 0; i < rows.length; i++) {
        if (id(saved.concepts[i].collectedOwners)) rows[i].collectedOwners = saved.concepts[i].collectedOwners;
        const readAt = saved.concepts[i].readAt ?? saved.fetchedAt;
        if (Number.isSafeInteger(readAt) && readAt >= 0 && readAt <= now()) rows[i].readAt = readAt;
      }
      const current = [...state.rows.values()]; state.rows.clear(); merge(state, rows); merge(state, current);
      state.fetchedAt = Math.max(state.fetchedAt, saved.fetchedAt);
      state.syncedAt = Number.isSafeInteger(saved.syncedAt) && saved.syncedAt <= now() ? saved.syncedAt : null;
      state.fullSyncAt = Number.isSafeInteger(saved.fullSyncAt) && saved.fullSyncAt <= now() ? saved.fullSyncAt : null;
      if (Array.isArray(saved.coveredDefinitionIds) && saved.coveredDefinitionIds.length <= 100000) {
        state.coveredDefinitionIds = new Set(saved.coveredDefinitionIds.filter(id));
      }
      state.setSyncedAt = saved.setSyncedAt && typeof saved.setSyncedAt === 'object' ? { ...saved.setSyncedAt } : {};
    } catch { /* Damaged cache is never authoritative. */ }
  })();
  const persist = state => {
    const value = { schema: 3, context: state.context, concepts: [...state.rows.values()],
      fetchedAt: state.fetchedAt, syncedAt: state.syncedAt, fullSyncAt: state.fullSyncAt,
      coveredDefinitionIds: [...state.coveredDefinitionIds].slice(0, 100000),
      setSyncedAt: { ...state.setSyncedAt } };
    state.writing = state.writing.then(async () => { try { await gmSetValue?.(state.key, value); } catch { /* Memory remains usable. */ } });
    return state.writing;
  };
  const ownerCount = item => {
    const auction = item.getAuctionData();
    return !item.concept && !(auction.isValid() && !auction.tradeOwner) && item.owners > 0 ? item.owners : null;
  };
  const observeItem = (item, raw, context) => {
    if (!item) return;
    // These two flags are lost by EA's factory. Enhancer preserves them here.
    if (raw?.gradingScore != null) item.gradingScore = raw.gradingScore;
    if (raw?.isCollected != null) item.isCollected = raw.isCollected;
    rawByItem.set(item, raw);
    if (!item.isPlayer() || !item.isCollected || !context) return;
    assert(context);
    if ([...nativePending].some(pending => !same(context, pending.context))) return;
    const definitionId = item.definitionId;
    if (!id(definitionId)) return;
    const state = stateFor(context), owners = ownerCount(item);
    const changed = merge(state, [{ definitionId, isCollected: true, gradingScore: Number.isFinite(item.gradingScore) ? item.gradingScore : null,
      cardData: nativeCardData(raw), ...(id(owners) ? { collectedOwners: owners } : {}) }]);
    state.clubSnapshot = null;
    if (!changed) return;
    state.fetchedAt = now();
    if (state.timer === null) state.timer = setTimeout(() => {
      state.timer = null;
      void restore(state).then(() => persist(state)).then(notify).catch(() => {});
    }, 250);
  };
  const install = () => {
    if (disposed) return false;
    const prototype = root.UTItemEntityFactory?.prototype;
    if (!prototype || typeof prototype.createItem !== 'function') return false;
    if (factoryHook?.prototype === prototype) return true;
    const original = prototype.createItem;
    const wrapped = function(raw) {
      let context = null;
      try { context = running?.context ?? readFc27Context(root); } catch { /* No account evidence yet. */ }
      const item = original.apply(this, arguments);
      try { observeItem(item, raw, context); } catch { /* Passive observation must not break EA/FSU factories. */ }
      return item;
    };
    prototype.createItem = wrapped; factoryHook = { prototype, original, wrapped }; return true;
  };
  const validatePool = (pool, context) => {
    if (pool?.source !== 'futgg' || pool.season !== context.season || typeof pool.complete !== 'boolean' || !id(pool.setId)
        || !Array.isArray(pool.items) || pool.items.length > 100000 || pool.items.some(row => !id(row.eaId))
        || new Set(pool.items.map(row => row.eaId)).size !== pool.items.length
        || pool.complete === false && (pool.candidateOnly !== true || !id(pool.requiredCards)
          || !id(pool.poolSize) || pool.poolSize <= pool.items.length
          || pool.items.length < pool.requiredCards || pool.items.length > GALLERY_TOP_CANDIDATE_LIMIT
          || pool.candidateLimit !== pool.items.length)
        || pool.complete && pool.candidateOnly === true) fail('FC27_GALLERY_POOL_UNAVAILABLE');
  };
  const projectState = (pool, state, extra = {}) => {
    assert(state.context);
    const allowed = new Set(pool.items.map(row => row.eaId)), concepts = [...allowed].map(id => state.rows.get(id)).filter(Boolean);
    if (!state.clubSnapshot || now() - state.clubSnapshotAt >= 5000) {
      state.clubSnapshot = readClubSnapshot(root); state.clubSnapshotAt = now();
    }
    const clubItems = state.clubSnapshot.filter(row => allowed.has(row.definitionId));
    return { status: 'observed', scope: contextKey(state.context, 'gallery-view'), fetchedAt: state.fetchedAt,
      pool, runtimeCards: new Map(concepts.filter(row => row.cardData || state.displayEntities.has(row.definitionId))
        .map(row => [row.definitionId, state.displayEntities.get(row.definitionId) ?? row.cardData])),
      progress: mergeGalleryAccountProgress(pool, { conceptItems: concepts, clubItems, collectionHistory: concepts }), ...extra };
  };
  const project = async pool => {
    try {
      const context = readFc27Context(root); validatePool(pool, context); const state = stateFor(context);
      await restore(state); return projectState(pool, state, { cached: true });
    } catch (error) { return { status: 'blocked', reason: safeReason(error) }; }
  };
  const nativePage = (criteria, context) => new Promise((resolve, reject) => {
    let observable, done = false; const observer = {};
    const pending = { context }; nativePending.add(pending);
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      // A timed-out native request may still finish authentication. Leave only
      // our completion observer until that reply so its account guard expires.
      if (error?.message !== 'FC27_GALLERY_CONCEPT_TIMEOUT') {
        try { observable?.unobserve(observer); } catch { /* Detach our observer only. */ }
      }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('FC27_GALLERY_CONCEPT_TIMEOUT')), 16000);
    try {
      assert(context); record({ event: 'concept-request', phase: 'native-service', status: 'started', batchSize: criteria.defId.length });
      observable = root.services.Item.searchConceptItems(criteria);
      observable.observe(observer, (_sender, reply) => {
        nativePending.delete(pending);
        if (done) { try { observable.unobserve(observer); } catch { /* Our observer only. */ } return; }
        try { assert(context); finish(null, reply); } catch (error) { finish(error); }
      });
    } catch { nativePending.delete(pending); finish(new Error('FC27_GALLERY_CONCEPT_REQUEST_FAILED')); }
  });
  const syncState = () => {
    try {
      const state = stateFor(readFc27Context(root));
      return { synced: state.sessionSynced, syncedAt: state.syncedAt, setSyncedAt: { ...state.setSyncedAt }, busy: !!running,
        needsRefresh: now() - (state.fullSyncAt ?? 0) >= ttlMs && now() >= state.retryAt
          && [...state.rows.values()].some(row => row.isCollected !== true) };
    } catch { return { synced: false, syncedAt: null, busy: !!running }; }
  };
  const needsRead = (state, definitionId, missingOnly = false) => {
    const row = state.rows.get(definitionId);
    return !row || !missingOnly && row.isCollected !== true && now() - (row.readAt ?? 0) >= ttlMs;
  };
  const sync = (pool = null, { onProgress = null, definitionIds = null, force = false, incremental = false, missingOnly = false } = {}) => {
    let context;
    try {
      context = readFc27Context(root); if (pool) validatePool(pool, context);
      if (definitionIds !== null && (pool !== null || !Array.isArray(definitionIds) || !definitionIds.length
          || definitionIds.length > 1000 || definitionIds.some(value => !id(value))
          || new Set(definitionIds).size !== definitionIds.length)) fail('FC27_GALLERY_CONCEPT_IDS_UNAVAILABLE');
    }
    catch (error) { return Promise.resolve({ status: 'blocked', reason: safeReason(error) }); }
    const state = stateFor(context), key = `${state.key}:${definitionIds?.join(',') ?? pool?.setId ?? 'all'}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const run = async () => {
      const operation = { context, stopped: false }; running = operation;
      const progress = value => { try { onProgress?.(value); } catch { /* UI only. */ } };
      try {
        await restore(state); assert(context);
        const allIds = definitionIds ?? (pool ? pool.items.map(row => row.eaId) : root.repositories.Item.getStaticData().map(row => row.id));
        if (!Array.isArray(allIds) || !allIds.length || allIds.length > 100000 || allIds.some(value => !id(value))) fail('FC27_GALLERY_CONCEPT_IDS_UNAVAILABLE');
        const fullSync = !pool && definitionIds === null;
        let ids = fullSync && !force ? allIds.filter(value => !state.coveredDefinitionIds.has(value))
          : pool && incremental && !force ? allIds.filter(value => needsRead(state, value, missingOnly)) : allIds;
        // No EA delta cursor is known. Recheck one bounded, oldest-first batch
        // of uncollected versions in the background; never restart the library
        // just because the account was reopened. Collected history is monotonic.
        let rechecking = false;
        if (fullSync && !force && !ids.length && now() - (state.fullSyncAt ?? 0) >= ttlMs) {
          ids = [...state.rows.values()].filter(row => needsRead(state, row.definitionId))
            .sort((a,b)=>(a.readAt ?? 0)-(b.readAt ?? 0) || a.definitionId-b.definitionId)
            .slice(0,1000).map(row=>row.definitionId);
          rechecking = ids.length > 0;
        }
        if (pool && !ids.length) return projectState(pool, state, { cached: true });
        if (fullSync && !ids.length) {
          state.sessionSynced = true;
          record({event:'sync-plan',phase:'incremental',status:'success',count:0,cached:true});
          return { status: 'observed', cached: true, scope: scope(), covered: state.coveredDefinitionIds.size };
        }
        if (now() < state.retryAt) fail('FC27_GALLERY_PROGRESS_BACKOFF');
        if (!install() || typeof root.UTSearchCriteriaDTO !== 'function' || typeof root.services?.Item?.searchConceptItems !== 'function'
            || root.GAME_NAME !== 'fc27') fail('FC27_GALLERY_CONCEPT_RUNTIME_UNVERIFIED');
        record({event:'sync-plan',phase:force?'full':rechecking?'recheck':'incremental',status:'started',count:ids.length,cached:state.rows.size>0});
        const incoming = [], seen = new Set(), groups = Math.ceil(ids.length / 1000);
        let pages = 0;
        for (let start = 0; start < ids.length; start += 1000) {
          const batch = ids.slice(start, start + 1000), allowed = new Set(batch);
          const criteria = new root.UTSearchCriteriaDTO();
          criteria.type = root.SearchType.PLAYER; criteria.category = root.SearchCategory.ANY;
          criteria.defId = batch; criteria.count = 250; criteria.offset = 0;
          let ended = false; const batchRows = [];
          while (!ended) {
            assert(context);
            if (operation.stopped) return { status: 'stopped', scope: scope() };
            progress({ phase: 'ea', index: Math.floor(start / 1000) + 1, total: groups,
              completed: Math.floor(start / 1000), pages, count: incoming.length });
            const reply = await nativePage(criteria, context);
            record({ event: 'concept-response', status: 'received', httpStatus: reply?.status });
            if (reply?.success !== true || reply.status !== 200) fail(Number.isInteger(reply?.status)
              && reply.status >= 100 && reply.status <= 599 ? `FC27_GALLERY_HTTP_${reply.status}` : 'FC27_GALLERY_CONCEPT_RESPONSE_UNVERIFIED');
            const data = reply.response ?? reply.data;
            if (!Array.isArray(data?.items) || data.items.length > 250) fail('FC27_GALLERY_CONCEPT_PAYLOAD_UNVERIFIED');
            // Whole-library searches use base static IDs and can return special
            // versions. A set's public pool is an exact-version list. The
            // bounded recheck is based on previously observed versions, but EA
            // may still expand a request to the same database-id family; accept
            // that transport expansion while retaining only exact requested rows.
            const exactProjection = pool || definitionIds !== null || rechecking;
            const pageAllowed = exactProjection ? allowed : new Set(data.items.map(item => item.definitionId));
            const accepts = (pool || rechecking)
              ? value => [...allowed].some(requested => sameDatabaseId(requested, value))
              : value => pageAllowed.has(value);
            const responseIds = data.items.map(item => item?.definitionId).filter(id);
            record({ event: 'concept-response', status: 'validated', requestedCount: allowed.size,
              responseCount: responseIds.length, expandedCount: responseIds.filter(value => !allowed.has(value)).length,
              foreignCount: responseIds.filter(value => !accepts(value)).length,
              offset: criteria.offset, recheck: rechecking });
            // Enhancer receives native UTItemEntity instances here, including
            // cached instances created before our factory hook was installed.
            // Keep those in memory for its exact shallow-copy rendering path.
            // Only sanitized network DTOs belong in the persistent cache; never
            // deep-clone or serialize the entity's private objects/prototypes.
            const nativeItems = new Map(data.items.map(item => [item?.definitionId, item]));
            const rows = sanitizeRows(data.items.map(item => ({ definitionId: item.definitionId,
              isCollected: item.isCollected, gradingScore: item.gradingScore,
              cardData: nativeCardData(rawByItem.get(item) ?? item) })),
              pageAllowed, accepts, exactProjection && (pool || rechecking) ? 250 : pageAllowed.size);
            const retainedRows = exactProjection ? rows.filter(row => allowed.has(row.definitionId)) : rows;
            record({ event: 'concept-response', status: 'retained', requestedCount: allowed.size,
              responseCount: rows.length, retainedCount: retainedRows.length,
              expandedCount: rows.length - retainedRows.length, offset: criteria.offset, recheck: rechecking });
            for (const row of retainedRows) {
              if (seen.has(row.definitionId)) fail('FC27_GALLERY_PROGRESS_DUPLICATE_CONCEPT');
              row.readAt = now(); seen.add(row.definitionId); incoming.push(row); batchRows.push(row);
              const Entity = root.UTItemEntity;
              const native = nativeItems.get(row.definitionId);
              if (typeof Entity === 'function' && native instanceof Entity) {
                state.displayEntities.delete(row.definitionId);
                state.displayEntities.set(row.definitionId, native);
              }
            }
            ended = !data.items.length || ('endOfList' in data ? data.endOfList === true : data.retrievedAll === true);
            criteria.offset += data.items.length;
            pages++;
            progress({ phase: 'ea', index: Math.floor(start / 1000) + 1, total: groups,
              completed: Math.floor(start / 1000) + (ended ? 1 : 0), pages, count: incoming.length });
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          // Only a complete successful static batch certifies coverage. Failed
          // or interrupted pages never skip unobserved versions after reload.
          if (fullSync && !rechecking) {
            merge(state, batchRows); state.fetchedAt = now();
            for (const value of batch) state.coveredDefinitionIds.add(value);
            await persist(state); assert(context);
          }
        }
        assert(context);
        if (operation.stopped) return { status: 'stopped', scope: scope() };
        if ((definitionIds !== null || rechecking) && incoming.length !== ids.length) fail('FC27_GALLERY_CONCEPT_INCOMPLETE');
        if (pool && incoming.length < ids.length && ids.every(id => state.rows.has(id))) fail('FC27_GALLERY_CONCEPT_INCOMPLETE');
        merge(state, incoming); state.fetchedAt = now();
        if (fullSync && !rechecking) for (const value of ids) state.coveredDefinitionIds.add(value);
        if (pool) state.setSyncedAt[pool.setId] = now();
        else if (definitionIds === null) { state.syncedAt = now(); state.fullSyncAt = state.syncedAt; state.sessionSynced = true; }
        await persist(state); assert(context); notify();
        record({ event: 'progress-read', phase: 'native-service', status: 'success', count: incoming.length });
        return pool ? projectState(pool, state, { cached: false }) : { status: 'observed', scope: scope(), count: incoming.length, fetchedAt: state.fetchedAt,
          ...(definitionIds !== null ? { rows: incoming } : {}) };
      } catch (error) {
        const reason = safeReason(error);
        try { assert(context); } catch { return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' }; }
        if (reason === 'FC27_GALLERY_SYNC_STOPPED') return { status: 'stopped', scope: scope() };
        if (reason !== 'FC27_GALLERY_PROGRESS_BACKOFF') state.retryAt = now() + ttlMs;
        record({ event: 'progress-read', phase: 'request', status: 'failed', reason, retryAt: state.retryAt });
        return pool && pool.items.some(row => state.rows.has(row.eaId))
          ? projectState(pool, state, { cached: true, stale: true, reason }) : { status: 'blocked', reason, scope: scope() };
      } finally { if (running === operation) running = null; }
    };
    const task = tail.then(run).finally(() => inFlight.delete(key)); tail = task.catch(() => {}); inFlight.set(key, task); return task;
  };
  const load = async (pool, { force = false, onProgress = null, missingOnly = false } = {}) => {
    let context;
    try { context = readFc27Context(root); validatePool(pool, context); }
    catch (error) { return { status: 'blocked', reason: safeReason(error) }; }
    const state = stateFor(context);
    try {
      await restore(state); assert(context);
      // Keep previously verified per-set snapshots usable after the upgrade.
      // They seed shared evidence; they never mark a full-library sync complete.
      if (!pool.items.every(row => state.rows.has(row.eaId)) && typeof gmGetValue === 'function') {
        try {
          const saved = await gmGetValue(contextKey(context, `gallery-progress:${pool.source}:${pool.setId}`), null);
          assert(context);
          if ([1, 2].includes(saved?.schema) && same(saved.context, context) && saved.revision === pool.revision
              && Number.isSafeInteger(saved.fetchedAt) && saved.fetchedAt >= 0 && saved.fetchedAt <= now()) {
            merge(state, sanitizeRows(saved.concepts, new Set(pool.items.map(row => row.eaId))).map(row => ({...row,readAt:saved.fetchedAt})));
            state.fetchedAt = Math.max(state.fetchedAt, saved.fetchedAt); await persist(state);
          }
        } catch { /* Invalid legacy cache cannot block a native read. */ }
        assert(context);
      }
      if (!force && pool.items.every(row => !needsRead(state, row.eaId, missingOnly))) return projectState(pool, state, { cached: true });
      return sync(pool, { onProgress, force, incremental: !force, missingOnly });
    } catch (error) { return { status: 'blocked', reason: safeReason(error) }; }
  };
  install();
  return Object.freeze({ load, project, sync, syncState, scope, install, readVersions: definitionIds => sync(null, { definitionIds }), stop: () => { if (running) running.stopped = true; },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    dispose: () => { disposed = true; if (running) running.stopped = true;
      for (const state of states.values()) if (state.timer !== null) clearTimeout(state.timer);
      if (factoryHook && factoryHook.prototype.createItem === factoryHook.wrapped) factoryHook.prototype.createItem = factoryHook.original;
      for (const state of states.values()) { state.displayEntities.clear(); state.clubSnapshot = null; }
      listeners.clear(); } });
}
