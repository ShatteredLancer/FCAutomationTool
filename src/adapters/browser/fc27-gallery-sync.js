// EA synchronization follows the reference plugin. Public pool mapping is the
// approved local substitute for Enhancer's private progress backend.
import { createGalleryMappingCache } from '../../gallery/mapping-cache.js';

export function createFc27GallerySync({ provider, reader, diagnosticLog, gmGetValue, gmSetValue,
  now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const pools = new Map();
  const mappings = createGalleryMappingCache({ get: gmGetValue, set: gmSetValue, now });
  let task = null, mappedScope = null, progressState = null, poolsNeedRefresh = false;
  const covered = detail => detail?.status === 'observed' && !detail.stale && detail.progress?.complete === true;
  const matches = (state, set, catalog, pool) => {
    const row = state.rows.get(String(set.id));
    return pool?.revision && row?.poolRevision === pool.revision && row.signature === mappings.signature(set, catalog);
  };
  const checkpoint = (state, set, catalog, pool) => {
    if (typeof pool?.revision === 'string') state.rows.set(String(set.id), { setId: String(set.id),
      signature: mappings.signature(set, catalog), poolRevision: pool.revision, mappedAt: now() });
  };
  const remember = pool => { if (pool) pools.set(`${pool.source}:${pool.setId}`, pool); };
  const peekDetails = async source => {
    const scope = reader.scope();
    const cached = await provider.peek?.();
    const state = await mappings.read(scope, source), details = [];
    if (scope !== reader.scope()) return [];
    let allMapped = true, stale = false;
    const sets = cached?.source === source ? cached.catalog.categories.flatMap(category => category.sets) : [];
    const activePools = new Set();
    for (const set of sets) {
      const result = await provider.peekPool?.({ source, setId: set.id });
      if (scope !== reader.scope()) return [];
      const poolId = `${source}:${source === 'futgg' ? String(set.id).replace(/^futgg:/, '') : set.id}`;
      activePools.add(poolId);
      if (result?.pool) remember(result.pool);
      const pool = result?.pool ?? pools.get(poolId);
      if (!pool) { allMapped = false; stale = true; continue; }
      const detail = await reader.project(pool); details.push(detail);
      allMapped &&= matches(state, set, cached.catalog, pool) && covered(detail);
      stale ||= !!result?.stale;
      if (details.length % 8 === 0) await wait(0);
    }
    if (scope !== reader.scope()) return [];
    for (const [id, pool] of pools) if (pool.source === source && !activePools.has(id)) pools.delete(id);
    if (sets.length) {
      poolsNeedRefresh = stale;
      if (allMapped) mappedScope = scope;
      else if (mappedScope === scope) mappedScope = null;
    }
    return details;
  };
  const sync = ({ source, setId = null, force = false, onProgress = null } = {}) => {
    if (task) {
      if (task.setId === setId) return task.promise;
      // A clicked collection has priority over the optional all-collection
      // mapping. Stop the background operation at its next safe boundary.
      if (setId !== null && task.setId === null) {
        task.stopped = true; reader.stop();
        return task.promise.then(() => sync({ source, setId, force, onProgress }));
      }
      else return task.promise;
    }
    const operation = { setId, stopped: false, scope: null, phase: null, startedAt: now() };
    progressState = null;
    const record = fields => {
      try { Promise.resolve(diagnosticLog?.record?.({area:'gallery',event:'sync-run',...fields})).catch(()=>{}); }
      catch { /* Diagnostics only. */ }
    };
    const report = progress => {
      if (operation.stopped) return;
      progressState = { ...progress, setId };
      if (operation.phase !== progress.phase) {
        operation.phase = progress.phase;
        record({phase:progress.phase,status:'started',durationMs:now()-operation.startedAt});
      }
      try { onProgress?.(progressState); } catch { /* Presentation only. */ }
    };
    let promise;
    promise = (async () => {
      const scope = reader.scope();
      operation.scope = scope;
      const current = () => !operation.stopped && scope === reader.scope();
      report({ phase: 'catalog', index: 0, total: 1, completed: 0 });
      const catalog = await provider.load();
      if (!current()) return { status: 'stopped', scope };
      if (!['futgg', 'fodder'].includes(source) || catalog.source !== source || !catalog.catalog) return { status: 'blocked', reason: 'FC27_GALLERY_POOL_UNAVAILABLE', scope };
      const sets = catalog.catalog.categories.flatMap(category => category.sets).filter(set => setId === null || set.id === setId);
      if (!sets.length) return { status: 'blocked', reason: 'FC27_GALLERY_POOL_UNAVAILABLE', scope };
      const mapping = await mappings.read(scope, source);
      if (!current()) return { status: 'stopped', scope };
      const activeIds = new Set(catalog.catalog.categories.flatMap(category => category.sets).map(set => String(set.id)));
      for (const id of mapping.rows.keys()) if (!activeIds.has(id)) mapping.rows.delete(id);
      operation.mapping = mapping; operation.catalogRevision = catalog.catalog.revision;
      let currentPool = null;
      if (setId !== null) {
        const result = await provider.loadPool({ source, setId, force, onProgress: report });
        if (!current()) return { status: 'stopped', scope };
        if (result.status !== 'observed' || result.stale || !result.pool) return { ...result, scope };
        currentPool = result.pool; remember(currentPool);
      }
      const native = source === 'fodder' ? { status: 'observed' } : await reader.sync(currentPool, { onProgress: report, force });
      if (!current()) return { status: 'stopped', scope };
      if (native.status !== 'observed' || native.stale) return native;
      const failures = [], updates = [];
      const queue = [];
      let reused = 0, changed = 0;
      for (const set of sets) {
        if (!current()) return { status: 'stopped', scope };
        const cached = currentPool ? null : await provider.peekPool?.({ source, setId: set.id });
        const detail = cached?.pool ? await reader.project(cached.pool) : null;
        if (!current()) return { status: 'stopped', scope };
        const same = cached?.pool && matches(mapping, set, catalog.catalog, cached.pool);
        // Old installs can bootstrap a checkpoint from actual restored EA
        // coverage. A missing account cache never inherits public completion.
        const legacy = !mapping.rows.has(String(set.id));
        if (!force && cached?.pool && !cached.stale && covered(detail) && (same || legacy)) {
          remember(cached.pool); checkpoint(mapping, set, catalog.catalog, cached.pool);
          updates.push(detail); reused++;
        } else queue.push({ set, cached, detail });
        if ((reused + queue.length) % 8 === 0) await wait(0);
      }
      if (updates.length) report({ phase: 'cache', index: reused, total: sets.length, completed: reused, details: updates.splice(0) });
      for (const [index, { set, cached, detail: cachedDetail }] of queue.entries()) {
        if (!current()) return { status: 'stopped', scope };
        const phase = cached?.pool ? 'pool-check' : 'pools';
        report({ phase, index: index + 1, total: queue.length, completed: index, changed, reused });
        const result = currentPool ? { status: 'observed', cached: true, pool: currentPool }
          : await provider.loadPool({ source, setId: set.id, force, onProgress: report });
        if (!current()) return { status: 'stopped', scope };
        if (result.pool) {
          remember(result.pool);
          // Public pools may contain new special versions absent from EA's
          // static base-ID list. Resolve only missing exact versions.
          const same = matches(mapping, set, catalog.catalog, result.pool);
          const legacy = !mapping.rows.has(String(set.id)) && cached?.pool?.revision === result.pool.revision;
          const reusable = !force && (same || legacy) && covered(cachedDetail)
            && cached?.pool?.revision === result.pool.revision;
          const detail = !currentPool && !reusable && typeof reader.load === 'function'
            ? await reader.load(result.pool, { missingOnly: true, onProgress: report }) : await reader.project(result.pool);
          if (!current()) return { status: 'stopped', scope };
          if (reusable) reused++; else changed++;
          updates.push(detail);
          if (covered(detail) && !result.stale) checkpoint(mapping, set, catalog.catalog, result.pool);
          if (detail.status !== 'observed' || detail.stale) {
            failures.push({setId:set.id,reason:detail.reason});
            report({phase,index:index+1,total:queue.length,completed:index+1,changed,reused,details:updates.splice(0)});
            break;
          }
        }
        if (!current()) return { status: 'stopped', scope };
        if (updates.length >= 8 || index === queue.length - 1) {
          report({ phase, index: index + 1, total: queue.length,
            completed: index + 1, changed, reused, details: updates.splice(0) });
        }
        if (result.status !== 'observed' || result.stale) {
          failures.push({ setId: set.id, reason: result.reason });
          // Do not fan out the same public-service limit across every set.
          if (/429|BACKOFF|TIMEOUT|NETWORK/.test(`${result.reason ?? ''} ${result.error ?? ''}`)) break;
        }
        // The provider already owns HTTP caching/backoff. Yield to the page
        // without adding a fixed one-second delay for every collection.
        if (setId === null) await wait(0);
      }
      if (updates.length) report({ phase: 'pools', index: sets.length, total: sets.length, details: updates.splice(0) });
      const details = await peekDetails(source);
      if (!current()) return { status: 'stopped', scope };
      return { status: failures.length ? 'partial' : 'observed', scope, details, failures, reused, changed };
    })().catch(error => ({ status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message)
      ? error.message : 'FC27_GALLERY_PROGRESS_UNAVAILABLE' })).then(result => {
        record({phase:operation.phase ?? 'catalog',status:result.status,durationMs:now()-operation.startedAt,count:result.details?.length ?? 0,reason:result.reason});
        return result;
      }).finally(async () => {
        if (operation.mapping) await mappings.save(operation.mapping, operation.catalogRevision);
        if (task?.promise === promise) task = null;
      });
    operation.promise = promise; task = operation;
    return promise;
  };
  const state = () => {
    let nativeState;
    try { nativeState = reader.syncState(); }
    catch { nativeState = { synced: false, syncedAt: null, busy: false, running: null }; }
    const compact = value => value && typeof value === 'object' ? {
      phase: value.phase ?? null, index: value.index ?? null, total: value.total ?? null,
      completed: value.completed ?? null, pages: value.pages ?? null, count: value.count ?? null,
      setId: value.setId ?? null,
    } : null;
    const taskState = task ? { active: true, setId: task.setId, phase: task.phase ?? null,
      stopped: !!task.stopped, startedAt: task.startedAt, ageMs: Math.max(0, now() - task.startedAt),
      progress: compact(progressState) } : { active: false, setId: null, phase: null, stopped: false,
      startedAt: null, ageMs: 0, progress: null };
    try {
      return { ...nativeState, busy: !!task || !!nativeState.busy,
        needsRefresh: !!nativeState.needsRefresh || poolsNeedRefresh,
        synced: nativeState.synced && mappedScope === reader.scope(),
        progress: task && (!task.scope || task.scope === reader.scope()) ? progressState : null,
        task: taskState, reader: { busy: !!nativeState.busy, running: nativeState.running ?? null } };
    }
    catch { return { ...nativeState, busy: !!task, synced: false, progress: progressState,
      task: taskState, reader: { busy: true, running: null } }; }
  };
  return Object.freeze({ sync, remember, peekDetails, state, subscribe: reader.subscribe,
    prioritize: setId => {
      if (task?.setId === null && setId !== null) {
        task.stopped = true; reader.stop();
        return task.promise.then(() => true);
      }
      return Promise.resolve(false);
    },
    stop: () => { if (task) task.stopped = true; reader.stop(); } });
}
