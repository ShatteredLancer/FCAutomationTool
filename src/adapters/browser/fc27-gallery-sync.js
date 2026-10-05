// EA synchronization follows the reference plugin. Public pool mapping is the
// approved local substitute for Enhancer's private progress backend.
export function createFc27GallerySync({ provider, reader, diagnosticLog, now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const pools = new Map();
  let task = null, mappedScope = null, progressState = null;
  const remember = pool => { if (pool) pools.set(`${pool.source}:${pool.setId}`, pool); };
  const peekDetails = async source => {
    const cached = await provider.peek?.();
    if (cached?.source === source) for (const category of cached.catalog.categories) for (const set of category.sets) {
      const result = await provider.peekPool?.({ source, setId: set.id });
      if (result?.pool) remember(result.pool);
    }
    const details = [];
    for (const pool of pools.values()) if (pool.source === source) {
      details.push(await reader.project(pool));
      if (details.length % 8 === 0) await wait(0);
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
    const operation = { setId, stopped: false, scope: null, startedAt: now() };
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
      for (const [index, set] of sets.entries()) {
        if (!current()) return { status: 'stopped', scope };
        report({ phase: 'pools', index: index + 1, total: sets.length, completed: index });
        const result = currentPool ? { status: 'observed', cached: true, pool: currentPool }
          : await provider.loadPool({ source, setId: set.id, force, onProgress: report });
        if (!current()) return { status: 'stopped', scope };
        if (result.pool) {
          remember(result.pool);
          // Public pools may contain new special versions absent from EA's
          // static base-ID list. Resolve only missing exact versions.
          const detail = !currentPool && typeof reader.load === 'function'
            ? await reader.load(result.pool, { missingOnly: true, onProgress: report }) : await reader.project(result.pool);
          updates.push(detail);
          if (detail.status !== 'observed' || detail.stale) {
            failures.push({setId:set.id,reason:detail.reason});
            report({phase:'pools',index:index+1,total:sets.length,completed:index+1,details:updates.splice(0)});
            break;
          }
        }
        if (!current()) return { status: 'stopped', scope };
        if (updates.length >= 8 || index === sets.length - 1) {
          report({ phase: 'pools', index: index + 1, total: sets.length,
            completed: index + 1, details: updates.splice(0) });
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
      if (setId === null && !failures.length) mappedScope = scope;
      return { status: failures.length ? 'partial' : 'observed', scope, details: await peekDetails(source), failures };
    })().catch(error => ({ status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message)
      ? error.message : 'FC27_GALLERY_PROGRESS_UNAVAILABLE' })).then(result => {
        record({phase:operation.phase ?? 'catalog',status:result.status,durationMs:now()-operation.startedAt,count:result.details?.length ?? 0,reason:result.reason});
        return result;
      }).finally(() => { if (task?.promise === promise) task = null; });
    operation.promise = promise; task = operation;
    return promise;
  };
  const state = () => {
    const state = reader.syncState();
    try {
      return { ...state, busy: !!task || !!state.busy,
        synced: state.synced && mappedScope === reader.scope(),
        progress: task && task.scope === reader.scope() ? progressState : null };
    }
    catch { return { ...state, busy: !!task, synced: false, progress: progressState }; }
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
