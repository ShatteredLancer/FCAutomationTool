import { marketSellMatches } from './market-sell-selection.js';
import { marketUnresolved, marketIsolated, isolateMarketIntent, markMarketManuallyHandled } from './market-recovery.js';
import { advanceMarketSchedule, marketScheduleGate, marketScheduleWake } from './market-task-schedule.js';
import { marketRatingRow, completeMarketRatingRow } from './market-rating-prices.js';
import { readTradingTasks } from './task-model.js';
import { activeMarketAuctions, settleMarketAuction } from './market-auctions.js';
import { reserveMarketClock, closeMarketClock, marketElapsed } from './market-task-clock.js';
import { marketTaskFailureReason } from './market-task-messages.js';
import { marketSearchGate, marketOccupancy, nextMarketTask, reserveMarketSearch, settleMarketSearch,
  reserveMarketWrite, settleMarketWrite, resolveMarketUnlisted, claimMarketHolding, settleMarketSale, settleMarketUnsold, transferMarketHoldings, marketLastListing, marketRelistAllowed } from './market-coordination.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const actionable = row => ['queued', 'waiting', 'running'].includes(row.state);
const safeReason = marketTaskFailureReason;
const defaultWait = (ms, signal) => new Promise(resolve => {
  if (signal.aborted) { resolve(); return; }
  let timer;
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
  timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
});
const codeOf = result => Number.isSafeInteger(result?.code) && result.code >= 100 && result.code <= 99999 ? result.code : null;
const stopReason = result => result?.category === 'captcha' ? 'captcha'
  : result?.category === 'throttle' ? 'throttle'
  : result?.category === 'purchase-denied' ? 'manual'
  : ['offer-rejected','insufficient-funds','destination-full'].includes(result?.category) ? null
  : codeOf(result) === 401 ? 'authentication'
    : [403, 427, 429, 512, 521, 426, 459].includes(codeOf(result)) || result?.category === 'market-unavailable' ? 'throttle' : null;

// P2 executor contract. No default/real EA provider is installed. prepare may
// read public quotes outside native locks; preflight/send/reconcile must use
// the audited P3 adapter. A turn may chain one search hit to one buy. Persisting task
// state never grants a permit; only this live, explicitly approved run does.
export function createMarketTaskScheduler({ taskStore, coordinator, provider = null, enabled = false,
  now = () => Date.now(), random = Math.random, id = () => globalThis.crypto.randomUUID(),
  wait = defaultWait, onStatus = () => {}, onDiagnostic = () => {}, errorPolicy = { codes: [], count: 1 }, supportedModes = ['fixed', 'sell'], monotonic = null }) {
  if (!Array.isArray(supportedModes) || supportedModes.some(mode => !['fixed', 'sell', 'filter'].includes(mode))) throw Error('MARKET_TASK_SELECTION_INVALID');
  if (!Array.isArray(errorPolicy.codes) || errorPolicy.codes.some(code => !Number.isSafeInteger(code) || code < 100 || code > 99999)
    || !Number.isSafeInteger(errorPolicy.count) || errorPolicy.count < 1) throw Error('MARKET_ERROR_POLICY_INVALID');
  let busy = false, executing = false, disposed = false, runContext = null, snapshot = null, wake = null, evidence = [], controlGeneration = 0;
  let policyRead = null, policyAt = 0;
  let tasks = new Map(), phase = 'idle', currentTask = null, lastReason = null, errorCounts = new Map();
  const listeners = new Set();
  let traffic=null, lastSearch=null;
  let activeSession = null, reopening = false;
  // One maintenance check for the approved account owner, never one per task.
  // Successful native reads postpone it; this is not a promise of EA renewal.
  let sessionHealth = { state: 'idle', lastOnlineAt: null };
  const inspect = () => ({ available: enabled && Boolean(provider), modes: [...supportedModes], context: runContext ? structuredClone(runContext) : null, busy, phase, taskId: currentTask,
    reason: lastReason, traffic, lastSearch: lastSearch ? { ...lastSearch } : null, sessionHealth: { ...sessionHealth }, evidence: structuredClone(evidence), errors: [...errorCounts].map(([code, count]) => ({ code, count })),
    tasks: [...tasks.values()].map(row => ({ id: row.id, state: row.state, reason: row.reason, nextAt: row.nextAt,
      startedAt: row.startedAt, elapsedMs: elapsed(row), candidateScope: provider?.describe?.(row.id) ?? null, schedule: row.schedule ?? null })) });
  const publish = () => { for (const listener of [onStatus, ...listeners]) { try { listener(inspect()); } catch { /* Presentation is not authorization. */ } } };
  const scopeFields = () => {
    const scope = provider?.describe?.(currentTask);
    return scope ? { count: scope.known, usableCandidates: scope.matched, batchSize: scope.batch, unknownCount: scope.missing } : {};
  };
  const reportFailure = reason => {
    try { Promise.resolve(onDiagnostic({ area: 'trading', event: 'task-scheduler', phase, status: 'blocked', reason, ...scopeFields() })).catch(() => {}); }
    catch { /* A logging failure cannot change task authorization or receipts. */ }
  };
  const diagnostic = (state, reason = null, code = null, details = {}) => {
    const occupancy = marketOccupancy(state);
    evidence = [...new Set([...state.intents.map(i => i.taskId), ...state.holdings.map(h => h.taskId),
      ...(state.handoffs ?? []).flatMap(h => [h.fromTaskId, h.toTaskId])])].map(taskId => {
      const entries = state.intents.filter(i => i.taskId === taskId);
      return { taskId, hasEvidence: true, unresolved: entries.some(marketUnresolved),
        auctions: Object.fromEntries(['leading','outbid','won','lost'].map(k=>[k,(state.auctions??[]).filter(a=>a.taskId===taskId&&a.state===k).length])),
        counts: [entries.filter(i => i.kind === 'buy' && i.phase === 'confirmed').length+(state.auctions??[]).filter(a=>a.taskId===taskId&&a.state==='won').length,
          entries.filter(i => i.kind === 'list' && i.phase === 'confirmed').length,
          state.holdings.filter(h => h.taskId === taskId && h.phase === 'sold').length] };
    });
    try { Promise.resolve(onDiagnostic({ area: 'trading', event: 'task-scheduler', phase,
      status: reason ? 'blocked' : 'observed', reason, errorCode: code,
      pendingWriteCount: state.intents.filter(i => i.phase === 'pending').length,
      requestedCount: tasks.size, ownedCount: occupancy.count, spent: occupancy.spent,
      reservedCoins: occupancy.reservedCoins, ...scopeFields(), ...details })).catch(() => {}); } catch { /* No evidence objects/IDs. */ }
  };
  let wallSample=null,monoSample=null;
  const current = () => {
    if(monotonic&&executing&&snapshot?.store.tasks.some(t=>t.schedule)){
      const wall=now(),mono=monotonic();
      if(wallSample!==null&&Math.abs((wall-wallSample)-(mono-monoSample))>120000)throw Error('MARKET_SCHEDULE_CLOCK_CHANGED');
      wallSample=wall;monoSample=mono;
    }
    if (!same(taskStore.context(), runContext)) throw Error('TASKS_CONTEXT_CHANGED');
  };
  const allowed = taskId => !disposed && actionable(tasks.get(taskId) ?? {});
  const stateOf = (taskId, state, reason = null, nextAt = 0) => {
    const row = tasks.get(taskId); if (row) {
      if (actionable(row) && !['queued', 'waiting', 'running'].includes(state)) row.endedAt = now();
      Object.assign(row, { state, reason, nextAt });
    } publish();
  };
  const revoke = (taskId, state) => {
    controlGeneration++;
    for (const row of tasks.values()) if (taskId === null || row.id === taskId) {
      if (actionable(row) || state === 'stopped' || state === 'paused' && row.state === 'review') {
        if (state === 'stopped') row.stopRequested = true;
        row.endedAt ??= now(); Object.assign(row, { state, reason: 'MARKET_USER_STOP', nextAt: 0 });
      }
    }
    wake?.abort(); publish();
  };
  const pause = taskId => revoke(taskId, 'paused');
  const stop = taskId => revoke(taskId, 'stopped');
  const pauseAll = () => revoke(null, 'paused');
  const delay = async ms => {
    wake = new globalThis.AbortController();
    try { await wait(Math.max(1, Math.min(ms, 1000)), wake.signal); } finally { wake = null; }
    current();
  };
  const validAt = action => Number.isSafeInteger(action?.expiresAt) && action.expiresAt > now();
  const taskConfig = taskId => snapshot.store.tasks.find(t => t.id === taskId);
  const elapsed = row => row.clock ? marketElapsed(row.clock, row.endedAt ?? now(), row.clockToken) : 0;
  const clockBoundary = row => {
    if (!row.clock?.lease || row.clock.lease.token !== row.clockToken || row.clock.lease.until <= now()) throw Error('MARKET_TIME_LIMIT');
  };
  const syncClocks = async (session, closing = false) => {
    const needed = [...tasks.values()].filter(row => closing ? row.clock?.lease
      : actionable(row) ? row.scheduleSleep ? Boolean(row.clock?.lease) : !row.clock?.lease || row.clock.lease.until <= now() : row.clock?.lease);
    if (!needed.length) return true;
    const result = await session.control(async turn => {
      await turn.checkpoint(state => {
        for (const row of needed) {
          row.clockToken ??= globalThis.crypto.randomUUID();
          if (closing || !actionable(row)) closeMarketClock(state, row.id, row.clockToken, row.endedAt ?? now(), row.state === 'stopped' || row.stopRequested === true);
          else if (row.scheduleSleep) closeMarketClock(state, row.id, row.clockToken, now());
          else reserveMarketClock(state, row.id, row.clockToken, now(), taskConfig(row.id).settings.runMinutes === null
            ? null : taskConfig(row.id).settings.runMinutes * 60000);
        }
      });
      for (const row of needed) {
        row.clock = turn.inspect().clocks?.find(c => c.taskId === row.id);
        row.elapsedMs = elapsed(row);
        if (row.clock?.stopped && actionable(row)) stateOf(row.id, 'stopped', 'MARKET_TIME_LIMIT');
      }
    });
    return result?.status !== 'busy';
  };
  const syncSchedules = async session => {
    const ledger = await session.inspect();
    if (ledger.stopped || ledger.intents.some(i=>i.phase==='pending')) return true;
    const proposed = { schedules: structuredClone(ledger.schedules ?? []) };
    for (const row of tasks.values()) if (actionable(row) && taskConfig(row.id).schedule) advanceMarketSchedule(proposed,taskConfig(row.id),now());
    if (!same(proposed.schedules,ledger.schedules??[])) {
      const result=await session.control(turn=>turn.checkpoint(state=>{state.schedules=proposed.schedules;}));
      if(result?.status==='busy')return false;
    }
    for(const row of tasks.values()) if(actionable(row)&&taskConfig(row.id).schedule){
      const schedule=proposed.schedules.find(r=>r.taskId===row.id);
      if(row.schedule?.startAt!==schedule.startAt)row.initialized=false;
      row.schedule=schedule;
      const wake=activeMarketAuctions(ledger).some(a=>a.taskId===row.id)?now()
        :marketScheduleWake(taskConfig(row.id),schedule,ledger.holdings,now(),h=>marketRelistAllowed(ledger,taskConfig(row.id),h));
      row.scheduleSleep=wake===null||wake>now();
      if(wake===null){const unsold=ledger.holdings.some(h=>h.taskId===row.id&&h.phase==='unsold');stateOf(row.id,unsold?'paused':'completed',unsold?'MARKET_RELIST_PAUSED':null);}
      else if(wake>now())stateOf(row.id,'waiting','MARKET_SCHEDULE_WAIT',wake);
    }
    return true;
  };
  const closeBuy = async (turn, taskId) => {
    await turn.checkpoint(state=>{const row=state.schedules?.find(r=>r.taskId===taskId);if(row)row.buyClosed??='full';});
    const row=tasks.get(taskId);row.schedule=turn.inspect().schedules.find(r=>r.taskId===taskId);
  };
  const bound = async (taskId, fn) => taskStore.withTask(snapshot, taskId, async args => { current(); return fn(args); });
  const applyError = async (turn, result) => {
    const code = codeOf(result);
    if (code !== null) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
    const reason = stopReason(result) ?? (errorPolicy.codes.includes(code) && errorCounts.get(code) >= errorPolicy.count ? 'manual' : null);
    if (reason) {
      await turn.checkpoint(state => { state.stopped = reason; });
      await provider.stopTraffic?.(reason);
      // Keep the visible shared-pause controls current even when this was the
      // last actionable task and there will be no next scheduler iteration.
      if (provider.traffic) { try { traffic = await provider.traffic(); } catch { /* Durable pause remains authoritative. */ } }
      lastReason = reason === 'authentication' ? 'MARKET_AUTHENTICATION' : reason === 'captcha' ? 'MARKET_CAPTCHA'
        : reason === 'manual' ? result?.category === 'purchase-denied' ? 'MARKET_PURCHASE_DENIED' : 'MARKET_ERROR_LIMIT' : 'MARKET_THROTTLED';
      for (const row of tasks.values()) if (actionable(row)) Object.assign(row, { state: 'paused', reason: lastReason });
      diagnostic(turn.inspect(), lastReason, code); publish();
    }
    return reason;
  };
  const ensureProvider = () => {
    if (!enabled || !provider || !['prepare', 'preflight', 'send', 'reconcile'].every(key => typeof provider[key] === 'function')) throw Error('TASKS_EXECUTION_UNAVAILABLE');
    if (disposed) throw Error('MARKET_OWNER_CLOSED');
  };

  async function enqueue({ approved = false, snapshot: requested, taskIds = [] } = {}) {
    ensureProvider(); if (approved !== true) throw Error('MARKET_APPROVAL_REQUIRED');
    if (!busy || !executing || !snapshot) throw Error('MARKET_SESSION_ENDED'); current();
    const next = readTradingTasks(requested?.store, requested?.context);
    if (!same(requested.context, runContext) || !same(next.settings, snapshot.store.settings)
      || !taskIds.length || new Set(taskIds).size !== taskIds.length) throw Error('TASKS_AUTHORIZATION_CHANGED');
    for (const taskId of taskIds) {
      const task = next.tasks.find(t => t.id === taskId);
      if (!task || !supportedModes.includes(task.mode) || !['ready', 'paused'].includes(task.state) || task.stopRequested || task.activity.unresolved
        || currentTask === taskId || actionable(tasks.get(taskId) ?? {})) throw Error('MARKET_TASK_SELECTION_INVALID');
      await taskStore.withTask(requested, taskId, () => {}); current();
    }
    if (!busy || !executing || disposed) throw Error('MARKET_SESSION_ENDED');
    if (new Set([...tasks.keys(), ...taskIds]).size > 100) throw Error('MARKET_TASK_SELECTION_INVALID');
    for (const taskId of taskIds) {
      const task = next.tasks.find(t => t.id === taskId), index = snapshot.store.tasks.findIndex(t => t.id === taskId);
      if (index >= 0) snapshot.store.tasks[index] = structuredClone(task); else snapshot.store.tasks.push(structuredClone(task));
      tasks.set(taskId, { id: taskId, state: 'queued', reason: null, nextAt: 0, startedAt: now() });
    }
    policyRead = null; wake?.abort(); publish(); return inspect();
  }

  async function run({ approved = false, snapshot: requested, taskIds = [] } = {}) {
    ensureProvider();
    if (approved !== true) throw Error('MARKET_APPROVAL_REQUIRED');
    if (busy) throw Error('MARKET_BUSY');
    const store = readTradingTasks(requested?.store, requested?.context);
    if (!taskIds.length || taskIds.length > 100 || new Set(taskIds).size !== taskIds.length
      || taskIds.some(taskId => !store.tasks.some(t => t.id === taskId && supportedModes.includes(t.mode) && ['ready', 'paused'].includes(t.state) && !t.stopRequested && !t.activity.unresolved))) throw Error('MARKET_TASK_SELECTION_INVALID');
    snapshot = { context: structuredClone(requested.context), store }; runContext = snapshot.context; current();
    wallSample=monoSample=null;busy = true; executing = true; lastReason = null; errorCounts = new Map(); evidence = []; policyRead = null;
    sessionHealth = { state: 'idle', lastOnlineAt: null };
    lastSearch = null;
    const startedAt = now();
    tasks = new Map(taskIds.map(taskId => [taskId, { id: taskId, state: 'queued', reason: null, nextAt: 0, startedAt }])); publish();
    try {
      const result = await coordinator.withOwner(async session => {
        activeSession = session;
        try {
        while (!disposed && [...tasks.values()].some(actionable)) {
          current();
          if (!await syncSchedules(session)) { await delay(1000); continue; }
          if (!await syncClocks(session)) { await delay(1000); continue; }
          const ledger = await session.inspect();
          traffic=await provider.traffic?.()??null;
          if(traffic?.ledger.stopped){lastReason='MARKET_TRAFFIC_STOPPED';for(const row of tasks.values())if(actionable(row))stateOf(row.id,'paused',lastReason);break;}
          if (ledger.stopped || ledger.intents.some(i => i.phase === 'pending')) {
            lastReason = ledger.intents.some(i => i.phase === 'pending') ? 'MARKET_RECOVERY_REQUIRED' : 'MARKET_STOPPED';
            for (const row of tasks.values()) if (actionable(row)) stateOf(row.id, 'review', lastReason);
            diagnostic(ledger, lastReason); break;
          }
          // Revalidate even while waiting: edits/stop in another tab revoke the
          // permit within one heartbeat, without issuing a request to check it.
          // Read/normalize the account configuration once per heartbeat, not
          // once per task. The selected task still has a fresh locked check.
          if (!policyRead || now() < policyAt || now() - policyAt >= 1000) {
            policyRead = await taskStore.read(); current(); policyAt = now();
          }
          const currentTasks = new Map(policyRead.store.tasks.map(task => [task.id, task]));
          for (const row of tasks.values()) if (actionable(row)) {
            const expected = taskConfig(row.id), fresh = currentTasks.get(row.id);
            if (!fresh || fresh.revision !== expected.revision || fresh.state !== expected.state
              || !same(policyRead.store.settings, store.settings)) stateOf(row.id, 'paused', 'TASKS_AUTHORIZATION_CHANGED');
            const duration = taskConfig(row.id).settings.runMinutes;
            row.elapsedMs = elapsed(row);
            if (duration !== null && row.elapsedMs >= duration * 60000 && actionable(row)) stateOf(row.id, 'stopped', 'MARKET_TIME_LIMIT');
          }
          if (provider.maintainSession && [...tasks.values()].some(actionable)) {
            const observed = provider.sessionHealth?.()?.lastOnlineAt;
            if (Number.isFinite(observed) && observed <= now() && (sessionHealth.lastOnlineAt === null || observed > sessionHealth.lastOnlineAt))
              sessionHealth = { state: 'online', lastOnlineAt: observed };
            if (sessionHealth.lastOnlineAt === null || now() < sessionHealth.lastOnlineAt || now() - sessionHealth.lastOnlineAt >= 180000) {
              const ticket = controlGeneration, selected = [...tasks.values()].find(actionable).id;
              const check = () => {
                current();
                if (disposed || ticket !== controlGeneration || !allowed(selected)) throw Error('MARKET_USER_STOP');
              };
              const maintained = await session.control(async turn => {
                if (turn.inspect().stopped || turn.inspect().intents.some(i => i.phase === 'pending')) return { status: 'busy' };
                try {
                  await bound(selected, async () => {
                    check();
                    const shared = await provider.traffic?.(); check();
                    if (shared?.ledger.stopped) throw Error('MARKET_TRAFFIC_STOPPED');
                    phase = 'session-check'; sessionHealth.state = 'checking'; publish();
                    const result = await provider.maintainSession({ beforeDispatch: check });
                    check();
                    if (result?.status !== 'online') throw Error('MARKET_SESSION_UNVERIFIED');
                    sessionHealth = { state: 'online', lastOnlineAt: now() };
                    diagnostic(turn.inspect()); publish();
                  });
                } catch (error) {
                  if (ticket !== controlGeneration || !allowed(selected)) return;
                  sessionHealth.state = 'failed';
                  if (!await applyError(turn, error)) {
                    lastReason = safeReason(error);
                    for (const row of tasks.values()) if (actionable(row)) stateOf(row.id, 'paused', lastReason);
                    diagnostic(turn.inspect(), lastReason, codeOf(error));
                  }
                }
              });
              if (maintained?.status === 'busy') { await delay(1000); continue; }
              if (![...tasks.values()].some(actionable)) break;
            }
          }
          const ready = [...tasks.values()].filter(row => actionable(row) && row.nextAt <= now()).map(row => row.id);
          if (!ready.length) {
            const pending = [...tasks.values()].filter(actionable); if (!pending.length) break;
            phase = 'waiting'; currentTask = null; publish();
            await delay(Math.min(...pending.map(row => row.nextAt)) - now()); continue;
          }
          const selected = nextMarketTask(structuredClone(ledger), ready), task = taskConfig(selected);
          if (marketIsolated(ledger, selected).length) { stateOf(selected, 'review', 'MARKET_RECOVERY_ISOLATED'); continue; }
          currentTask = selected; phase = 'prepare'; stateOf(selected, 'running');
          let action;
          try {
            const row = tasks.get(selected), isCurrent = () => { current(); return allowed(selected) && tasks.get(selected) === row; };
            if (!row.initialized && task.schedule && marketScheduleGate(task,row.schedule,'buy',null,now()) && provider.checkCapacity) {
              const capacity=await session.turn([selected],turn=>bound(selected,async ({task:fresh})=>{
                try { await provider.checkCapacity(fresh); }
                catch(error){if(error.message!=='MARKET_TRANSFER_FULL')throw error;await closeBuy(turn,selected);}
              }));
              if(capacity?.status==='busy'){stateOf(selected,'waiting','MARKET_NATIVE_BUSY',now()+1000);continue;}
              if(row.schedule.buyClosed)continue;
            }
            if (!row.initialized && typeof provider.begin === 'function') {
              await provider.begin({ task: structuredClone(task), settings: structuredClone(store.settings), isCurrent }); current();
              if (!isCurrent()) continue; row.initialized = true; publish();
            }
            action = structuredClone(await provider.prepare({ task: structuredClone(task), settings: structuredClone(store.settings),
            ledger: structuredClone(ledger), now: now() })); current(); }
          catch (error) { reportFailure(safeReason(error)); stateOf(selected, 'paused', safeReason(error)); continue; }
          if (!allowed(selected)) continue;
          if (action?.kind === 'wait' && Number.isSafeInteger(action.until) && action.until > now()) {
            tasks.get(selected).scheduleSleep=action.scheduleWait===true;
            stateOf(selected, 'waiting', action.scheduleWait?'MARKET_SCHEDULE_WAIT':'MARKET_TASK_WAIT', action.until); continue;
          }
          if (action?.kind === 'done') {
            stateOf(selected, action.reason === 'MARKET_RELIST_PAUSED' ? 'paused' : 'completed', action.reason === 'MARKET_RELIST_PAUSED' ? action.reason : null); continue;
          }
          if (!['search', 'buy', 'bid', 'auctions', 'inventory', 'move', 'list', 'claim', 'sales'].includes(action?.kind) || !validAt(action)) {
            stateOf(selected, 'paused', 'MARKET_ACTION_EXPIRED_OR_INVALID'); continue;
          }
          if (action.kind === 'search') {
            const gate = traffic?.gate ?? marketSearchGate(ledger, store.settings, now());
            if (gate.nextAt > now()) { stateOf(selected, 'waiting', 'MARKET_SEARCH_WAIT', gate.nextAt); continue; }
          }
          try {
            const round = await session.turn([selected], async turn => {
              if (turn.recoveryOnly) { stateOf(selected, 'review', 'MARKET_RECOVERY_REQUIRED'); return; }
              const executionScope = Object.freeze({});
              try { await bound(selected, async ({ task: fresh, settings }) => {
                for (let hitStep=0; hitStep<2; hitStep++) {
                if (!allowed(selected) || !validAt(action)) return;
                if(!marketScheduleGate(fresh,tasks.get(selected).schedule,action.kind,action,now())) {stateOf(selected,'queued');return;}
                phase = action.kind==='inventory'?'inventory':'preflight'; publish();
                const preflight = await provider.preflight({ task: fresh, settings, action: structuredClone(action), ledger: turn.inspect(), executionScope }); current();
                if (!allowed(selected)) return;
                if (await applyError(turn, preflight)) return;
                if (preflight?.ready !== true) { stateOf(selected, 'paused', 'MARKET_PREFLIGHT_BLOCKED'); return; }
                if (!validAt(action)) { stateOf(selected, 'paused', 'MARKET_ACTION_EXPIRED_OR_INVALID'); return; }
                if(action.kind==='inventory'){
                  if(fresh.mode!=='sell'||!fresh.sellSelection)throw Error('MARKET_SELL_SELECTION_INVALID');
                  await provider.accept({action,response:{status:'observed',inventory:preflight.inventory},ledger:turn.inspect()});
                  diagnostic(turn.inspect());stateOf(selected,'queued');return;
                }
                if(action.kind==='auctions'){
                  if(!Array.isArray(preflight.auctions)||preflight.auctions.some(r=>!turn.inspect().auctions?.some(a=>a.tradeId===r.tradeId&&a.taskId===selected)))throw Error('MARKET_RECEIPT_CONFLICT');
                  await turn.checkpoint(state=>{for(const r of preflight.auctions)settleMarketAuction(state,r);});
                  await provider.accept({action,response:{status:'observed'},ledger:turn.inspect()});
                  diagnostic(turn.inspect());stateOf(selected,'queued');return;
                }
                if (action.kind === 'claim') {
                  if(preflight.skip===true&&fresh.mode==='sell'&&fresh.sellSelection){await provider.accept({action,response:{skip:true},ledger:turn.inspect()});stateOf(selected,'queued');return;}
                  const selectedItem = fresh.sellSelection?(marketSellMatches(fresh.sellSelection,preflight.selectionFacts??{})?action:null):fresh.owned.find(row => row.itemId === action.itemId && row.definitionId === action.definitionId);
                  const h = preflight.holding;
                  if (fresh.mode !== 'sell' || !selectedItem || h?.itemId !== selectedItem.itemId
                    || h.definitionId !== selectedItem.definitionId || h.taskId !== selected) throw Error('MARKET_ITEM_OCCUPIED');
                  await turn.checkpoint(state => claimMarketHolding(state, {...h,...(fresh.schedule?{sellAt:tasks.get(selected).schedule.sellAt}:{})}, preflight.holdingPhase));
                  diagnostic(turn.inspect()); stateOf(selected, 'queued'); return;
                }
                if (action.kind === 'sales') {
                  if (!Array.isArray(preflight.sales)) throw Error('MARKET_RECEIPT_CONFLICT');
                  for (const receipt of preflight.sales) {
                    if (!turn.inspect().holdings.some(h => h.taskId === selected && h.itemId === receipt.itemId)) throw Error('MARKET_RECEIPT_CONFLICT');
                  }
                  await turn.checkpoint(state => { for (const receipt of preflight.sales) {
                    if (receipt.unsold === true) settleMarketUnsold(state, receipt); else settleMarketSale(state, receipt);
                  } });
                  if (typeof provider.accept === 'function') await provider.accept({ action, response: { status: 'observed' }, ledger: turn.inspect() });
                  diagnostic(turn.inspect()); stateOf(selected, 'queued'); return;
                }
                const requestId = id();
                const command = action.kind === 'search' ? null : { id: requestId, taskId: selected, kind: action.kind,
                  itemId: action.itemId, definitionId: action.definitionId, tradeId: action.tradeId ?? null, coins: action.coins, at: now(),
                  ...(action.kind === 'list' && action.listing ? { listing: structuredClone(action.listing) } : {}) };
                if (action.previousTradeId) command.previousTradeId = action.previousTradeId;
                if (['buy','bid'].includes(command?.kind) && fresh.schedule) command.sellAt=tasks.get(selected).schedule.sellAt;
                if (['buy','bid'].includes(command?.kind)) {
                  if(command.kind==='bid'&&(fresh.settings.buyMode??'bin')==='bin'||command.kind==='buy'&&fresh.settings.buyMode==='bid')throw Error('MARKET_BUY_RULE_CHANGED');
                  const row = fresh.mode === 'fixed' ? fresh.players.find(p => p.definitionId === command.definitionId) : null;
                  const rule=command.kind==='bid'?fresh.settings.bidRule:fresh.settings.buyRule,value=command.kind==='bid'?fresh.settings.bidValue:fresh.settings.buyValue;
                  if (fresh.mode === 'sell' || fresh.mode === 'fixed' && !row
                    || fresh.settings.hardCap !== null && command.coins > fresh.settings.hardCap
                    || !fresh.ratingPrices && row?.cap == null && rule === 'fixed' && command.coins > value
                    || row?.cap != null && command.coins > row.cap) throw Error('MARKET_BUY_RULE_CHANGED');
                }
                if (command?.kind === 'list' && !(action.previousTradeId && fresh.settings.relist === 'original')
                  && !fresh.ratingPrices && fresh.settings.sellRule === 'fixed' && command.coins !== fresh.settings.sellValue) throw Error('MARKET_SELL_RULE_CHANGED');
                if(fresh.ratingPrices&&['search','buy','bid','list'].includes(action.kind)&&!(action.previousTradeId&&fresh.settings.relist==='original')){
                  const prices=marketRatingRow(fresh,action.rating);
                  if(!completeMarketRatingRow(prices,fresh)||action.kind==='search'&&(action.maxBuy>prices.buy||action.maxBid>prices.bid)||action.kind==='buy'&&command.coins>prices.buy||action.kind==='bid'&&command.coins>prices.bid||action.kind==='list'&&command.coins!==prices.sell)throw Error('MARKET_RATING_PRICE_UNAVAILABLE');
                }
                phase = action.kind; publish();
                if (action.kind === 'search') await turn.checkpoint(state => reserveMarketSearch(state, { requestId, now: now(), settings, random, externalGate: Boolean(traffic) }));
                else {
                  const funds = {
                  balance: preflight.balance, freeSlots: preflight.freeSlots, reserve: settings.reserve,
                  totalCap: settings.totalCap, taskCap: fresh.settings.taskCap, spendCap: fresh.settings.spendCap,
                  perVersion: fresh.mode === 'fixed' ? fresh.players.find(p => p.definitionId === command.definitionId)?.qty ?? null : fresh.settings.perVersion,
                  };
                  // A predictable limit is not a failed durable checkpoint.
                  // Validate on a copy before persisting; the same guard runs
                  // again inside the checkpoint under these unchanged locks.
                  if (['buy','bid'].includes(command.kind)) reserveMarketWrite(turn.inspect(), command, funds);
                  await turn.checkpoint(state => reserveMarketWrite(state, command, funds));
                }
                // This is the final synchronous boundary before invoking send.
                // Cancelling during GM persistence is a definite no-send.
                if (!allowed(selected) || !validAt(action)) {
                  await turn.checkpoint(state => action.kind === 'search' ? settleMarketSearch(state, requestId, 'not-sent')
                    : settleMarketWrite(state, requestId, { status: 'rejected', receipt: null }));
                  if (allowed(selected)) stateOf(selected, 'paused', 'MARKET_ACTION_EXPIRED_OR_INVALID'); return;
                }
                current(); let response, dispatched = false, boundaryFailure = null, trafficRetryAt = null;
                // Native adapters opt in only when EVERY write/search invokes
                // this synchronous hook immediately before its service call.
                // Legacy/fake providers without that contract remain uncertain.
                const guarded = provider.dispatchBoundary === true;
                const beforeDispatch = () => {
                  current();
                  if (dispatched) throw Error('MARKET_DUPLICATE_REQUEST');
                  if (!allowed(selected)) throw Error('MARKET_USER_STOP');
                  if (!validAt(action)) throw Error('MARKET_ACTION_EXPIRED_OR_INVALID');
                  if(!marketScheduleGate(fresh,tasks.get(selected).schedule,action.kind,action,now()))throw Error('MARKET_SCHEDULE_WINDOW_CLOSED');
                  clockBoundary(tasks.get(selected));
                  dispatched = true;
                };
                const beforeRequest = async () => {
                  current();
                  if (!allowed(selected)) throw Error('MARKET_USER_STOP');
                  const row = tasks.get(selected);
                  if (row.clock?.lease?.token !== row.clockToken) throw Error('MARKET_CLOCK_INVALID');
                  // The 60-second durable lease is accounting, not a user limit.
                  // Renew under the existing owner/task/native locks after all
                  // pacing awaits, without restarting or resending this action.
                  if (row.clock.lease.until <= now()) {
                    await turn.checkpoint(state => reserveMarketClock(state, selected, row.clockToken, now(),
                      fresh.settings.runMinutes === null ? null : fresh.settings.runMinutes * 60000));
                    row.clock = turn.inspect().clocks.find(c => c.taskId === selected);
                  }
                  current();
                  if (!allowed(selected)) throw Error('MARKET_USER_STOP');
                  clockBoundary(row);
                };
                try { response = await provider.send({ action: structuredClone(action), requestId, beforeDispatch, beforeRequest, executionScope }); }
                catch (error) { boundaryFailure = safeReason(error);trafficRetryAt=error.retryAt;response = { status: 'unknown', receipt: null, code: codeOf(error) }; }
                if (guarded && !dispatched) {
                  response = { ...response, sent: false, status: 'rejected', receipt: null };
                  if(boundaryFailure==='MARKET_SEARCH_HIT_CHANGED'){provider.discardOffers?.(selected);}
                  if (allowed(selected)) stateOf(selected, boundaryFailure==='MARKET_SEARCH_HIT_CHANGED'?'queued':boundaryFailure==='MARKET_TRAFFIC_WAIT'?'waiting':boundaryFailure==='MARKET_SCHEDULE_WINDOW_CLOSED'?'queued':'paused', boundaryFailure ?? 'MARKET_NOT_SENT',boundaryFailure==='MARKET_TRAFFIC_WAIT'?Math.max(now()+1000,trafficRetryAt??0):0);
                }
                current();
                if (action.kind === 'search') {
                  // An exception/timeout cannot prove no-send; retain dispatching.
                  if (response?.sent === true || response?.sent === false) await turn.checkpoint(state => settleMarketSearch(state, requestId, response.sent ? 'sent' : 'not-sent'));
                } else {
                  const status = ['confirmed', 'rejected'].includes(response?.status) ? response.status : 'unknown';
                  await turn.checkpoint(state => settleMarketWrite(state, requestId, { status, receipt: response?.receipt ?? null,
                    ...(response?.acknowledged === true ? { acknowledged: true } : {}) }));
                }
                if(task.schedule&&action.kind==='move'&&response?.status==='confirmed'&&preflight.freeSlots===1)await closeBuy(turn,selected);
                const halted = await applyError(turn, response);
                if (!halted && allowed(selected) && response?.status === 'rejected'
                  && ['move','list'].includes(action.kind) && boundaryFailure === null) {
                  // A definite refusal leaves the same holding eligible. Do not
                  // queue it again in this run; only an explicit start may retry.
                  stateOf(selected, 'paused', action.kind === 'list' ? 'MARKET_LIST_REJECTED' : 'MARKET_MOVE_REJECTED');
                }
                if (!halted && ['insufficient-funds','destination-full'].includes(response?.category)) {
                  stateOf(selected, 'paused', response.category === 'insufficient-funds' ? 'MARKET_INSUFFICIENT_FUNDS' : 'MARKET_DESTINATION_FULL');
                }
                if (!halted && (response?.status === 'unknown' || action.kind === 'search' && response?.sent !== true && allowed(selected) && !['MARKET_SCHEDULE_WINDOW_CLOSED','MARKET_TRAFFIC_WAIT'].includes(boundaryFailure))) {
                  stateOf(selected, action.kind === 'search' ? 'paused' : 'review', 'MARKET_RESPONSE_UNCONFIRMED');
                }
                // Optional adapter-local cursor update, never a second request.
                const accepted = boundaryFailure!=='MARKET_TRAFFIC_WAIT'&&typeof provider.accept === 'function'
                  ? await provider.accept({ action, response, ledger: turn.inspect() }) : null;
                let searchDetails = {};
                if (action.kind === 'search') {
                  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 21 ? value : null;
                  const returned = count(response?.responseCount), eligible = count(accepted?.acceptedCount);
                  searchDetails = { definitionId: action.definitionId, searchCeiling: action.searchMode==='bid'?action.maxBid:action.maxBuy, rating: action.rating,
                    ...(returned !== null ? { responseCount: returned } : {}),
                    ...(eligible !== null ? { acceptedCount: eligible } : {}) };
                  lastSearch = { definitionId: action.definitionId, searchCeiling: action.searchMode==='bid'?action.maxBid:action.maxBuy,
                    responseCount: returned, acceptedCount: eligible, sent: dispatched || response?.sent === true,
                    confirmed: response?.status === 'confirmed', at: now() };
                }
                diagnostic(turn.inspect(), tasks.get(selected)?.reason ?? lastReason, codeOf(response), searchDetails);
                current();
                if (allowed(selected)&&boundaryFailure!=='MARKET_TRAFFIC_WAIT') stateOf(selected, 'queued');
                if (hitStep !== 0 || action.kind !== 'search' || response?.status !== 'confirmed'
                  || !allowed(selected) || !accepted?.acceptedCount || !provider.nextPurchase) break;
                const hit = provider.nextPurchase({task:fresh,settings,ledger:turn.inspect()});
                if (!hit || !['buy','bid'].includes(hit.kind) || !validAt(hit)) break;
                action=structuredClone(hit);
                }
              }); } catch (error) {
                if(error.message==='MARKET_SEARCH_HIT_CHANGED'){provider.discardOffers?.(selected);stateOf(selected,'queued');return;}
                if (await applyError(turn, error)) return;
                if (allowed(selected) && action.kind === 'buy' && provider.finishPurchaseBatch?.({ task, ledger: turn.inspect(), reason: error.message })) {
                  if (error.message === 'MARKET_TRANSFER_FULL' && task.schedule) await closeBuy(turn, selected);
                  stateOf(selected, 'queued'); return;
                }
                if(error.message==='MARKET_SCHEDULE_WINDOW_CLOSED'){stateOf(selected,'queued');return;}
                if(error.message==='MARKET_TRANSFER_FULL'&&task.schedule){await closeBuy(turn,selected);stateOf(selected,'waiting','MARKET_TRANSFER_FULL',now()+1000);return;}
                if (['TASKS_AUTHORIZATION_CHANGED', 'TASKS_NOT_FOUND'].includes(error.message)) stateOf(selected, 'paused', error.message);
                else throw error;
              }
            });
            if (round?.status === 'busy') stateOf(selected, 'waiting', 'MARKET_NATIVE_BUSY', now() + 1000);
          } catch (error) { stateOf(selected, 'paused', safeReason(error)); throw error; }
        }
        return inspect();
        } finally { try { await syncClocks(session, true); } finally { activeSession = null; } }
      });
      if (result?.status === 'busy') { lastReason = 'MARKET_BUSY'; pauseAll(); }
    } catch (error) {
      lastReason = safeReason(error);
      reportFailure(lastReason);
      for (const row of tasks.values()) if (actionable(row)) stateOf(row.id, 'paused', lastReason);
    } finally {
      if (sessionHealth.state !== 'failed') sessionHealth.state = 'idle';
      busy = false; executing = false; phase = 'idle'; currentTask = null; wake?.abort(); publish();
    }
    return inspect();
  }

  // Restart prepares the same task for a separate explicitly approved run or
  // enqueue. It never resets spending, elapsed time, schedules or receipts.
  async function reopen({ approved = false, snapshot: requested, taskId } = {}) {
    ensureProvider();
    if (approved !== true) throw Error('MARKET_APPROVAL_REQUIRED');
    if (reopening || busy && !activeSession) throw Error('MARKET_BUSY');
    if (actionable(tasks.get(taskId) ?? {})) throw Error('MARKET_TASK_SELECTION_INVALID');
    if (!same(requested?.context, taskStore.context())) throw Error('TASKS_CONTEXT_CHANGED');
    const session = activeSession, ticket = controlGeneration;
    if (!session) { runContext = structuredClone(requested.context); busy = true; phase = 'restart-check'; }
    reopening = true; publish();
    const check = () => {
      current();
      if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP');
    };
    const prepare = owner => owner.control(async turn => {
      check();
      if (turn.inspect().intents.some(i => i.phase === 'pending')) throw Error('MARKET_RECOVERY_REQUIRED');
      if (marketIsolated(turn.inspect(), taskId).length) throw Error('MARKET_RECOVERY_ISOLATED');
      if (turn.inspect().stopped) throw Error('MARKET_STOPPED');
      const shared = await provider.traffic?.(); check();
      if (shared?.ledger.stopped) throw Error('MARKET_TRAFFIC_STOPPED');
      const result = await taskStore.reopen({ ...requested, taskId }, async task => {
        check();
        const clock = turn.inspect().clocks?.find(c => c.taskId === taskId);
        if (task.state !== 'stopped' && !task.stopRequested && !clock?.stopped) throw Error('MARKET_TASK_SELECTION_INVALID');
        if (task.settings.runMinutes !== null && (clock?.elapsedMs ?? 0) >= task.settings.runMinutes * 60000) throw Error('MARKET_RESTART_TIME_LIMIT');
        if (clock?.lease && clock.lease.until > now()) throw Error('MARKET_BUSY');
        if (clock?.stopped) await turn.checkpoint(state => {
          check(); const saved = state.clocks.find(c => c.taskId === taskId);
          saved.stopped = false; saved.lease = null; // An abandoned lease remains charged.
        });
        check();
      });
      check(); tasks.delete(taskId);
      return { ...result, coordination: { context: structuredClone(runContext), ledger: turn.inspect(), traffic: shared ?? null } };
    });
    const reportRestart = reason => {
      try { Promise.resolve(onDiagnostic({ area: 'trading', event: 'task-scheduler', phase: 'restart-check',
        status: reason ? 'blocked' : 'observed', ...(reason ? { reason } : {}), requestedCount: 1 })).catch(() => {}); }
      catch { /* Logging never grants or revokes a restart. */ }
    };
    try {
      const result = session ? await prepare(session) : await coordinator.withOwner(prepare);
      if (result?.status === 'busy') throw Error('MARKET_BUSY');
      check(); reportRestart(null); return result;
    } catch (error) { reportRestart(safeReason(error)); throw error; }
    finally {
      reopening = false;
      if (!session) { busy = false; phase = 'idle'; }
      publish();
    }
  }

  // Explicit read-only recovery. Never turns a recovery click into a new send,
  // never resumes tasks or clears authentication/throttle stops automatically.
  async function recover() {
    ensureProvider(); if (busy) throw Error('MARKET_BUSY');
    const ticket = controlGeneration;
    runContext = structuredClone(taskStore.context()); busy = true; phase = 'recover'; publish();
    try {
      const recovered = await coordinator.withOwner(session => session.control(async turn => {
        const pending = turn.inspect().intents.filter(marketUnresolved);
        let unresolvedReason = null;
        for (const entry of pending) {
          if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP');
          current(); const response = await provider.reconcile(structuredClone(entry)); current();
          if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP');
          if (['confirmed', 'rejected'].includes(response?.status)) await turn.checkpoint(state => settleMarketWrite(state, entry.id,
            { status: response.status, receipt: response.receipt ?? null }));
          else if (response?.status === 'resolved') await turn.checkpoint(state => resolveMarketUnlisted(state, entry.id, response.resolution));
          else unresolvedReason = ['MARKET_LISTING_STATE_UNCONFIRMED','MARKET_READ_UNCONFIRMED','MARKET_AUTHENTICATION','MARKET_RECOVERY_ITEM_MISSING'].includes(response?.reason)
            ? response.reason : 'MARKET_RECOVERY_REQUIRED';
          await applyError(turn, response);
        }
        if (!turn.inspect().intents.some(i => i.phase === 'pending') && typeof provider.readHoldings === 'function') {
          const auctions=activeMarketAuctions(turn.inspect());
          if(auctions.length){
            if(typeof provider.readAuctions!=='function')throw Error('MARKET_BID_RUNTIME_UNAVAILABLE');
            const result=await provider.readAuctions(auctions);current();
            if(disposed||ticket!==controlGeneration)throw Error('MARKET_USER_STOP');
            if(!Array.isArray(result?.receipts))throw Error('MARKET_RECEIPT_CONFLICT');
            await turn.checkpoint(state=>{for(const r of result.receipts)settleMarketAuction(state,r);});
          }
          const ledger = turn.inspect(), listed = ledger.holdings.filter(h => h.phase === 'listed');
          for (let index = 0; index < listed.length; index += 40) {
            current(); if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP');
            const chunk = listed.slice(index, index + 40).map(h => ({ ...h, listing: marketLastListing(ledger, h) }));
            const receipts = await provider.readHoldings(chunk); current();
            if (!Array.isArray(receipts) || receipts.some(r => !chunk.some(h => h.itemId === r.itemId))) throw Error('MARKET_RECEIPT_CONFLICT');
            await turn.checkpoint(state => { for (const receipt of receipts) {
              if (receipt.unsold === true) settleMarketUnsold(state, receipt); else settleMarketSale(state, receipt);
            } });
            diagnostic(turn.inspect()); publish();
          }
        }
        lastReason = unresolvedReason === 'MARKET_AUTHENTICATION' ? unresolvedReason : turn.inspect().intents.some(i => i.phase === 'pending') ? unresolvedReason ?? 'MARKET_RECOVERY_REQUIRED'
          : marketIsolated(turn.inspect()).length ? 'MARKET_RECOVERY_ISOLATED' : null;
        diagnostic(turn.inspect(), lastReason); return turn.inspect();
      }));
      if (recovered?.status === 'busy') throw Error('MARKET_BUSY');
      return recovered;
    } finally { busy = false; phase = 'idle'; publish(); }
  }
  // Explicit local isolation retains financial evidence and never clears a pause.
  async function manageRecovery({ approved = false, context, revision, requestId, action } = {}) {
    ensureProvider();
    if (approved !== true) throw Error('MARKET_APPROVAL_REQUIRED');
    if (busy) throw Error('MARKET_BUSY');
    if (!same(context, taskStore.context())) throw Error('TASKS_CONTEXT_CHANGED');
    if (!['isolate','handled'].includes(action)) throw Error('MARKET_RECOVERY_INVALID');
    const ticket = controlGeneration;
    runContext = structuredClone(context); busy = true; phase = 'recovery-manage'; publish();
    const check = () => { current(); if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP'); };
    try {
      const result = await coordinator.withOwner(owner => owner.control(async turn => {
        check();
        if (turn.inspect().revision !== revision) throw Error('MARKET_STALE');
        await turn.checkpoint(state => {
          check();
          (action === 'isolate' ? isolateMarketIntent : markMarketManuallyHandled)(state, { requestId, at: now() });
        });
        check(); lastReason = 'MARKET_RECOVERY_ISOLATED'; diagnostic(turn.inspect(), lastReason);
        return turn.inspect();
      }));
      if (result?.status === 'busy') throw Error('MARKET_BUSY');
      return result;
    } finally { busy = false; phase = 'idle'; publish(); }
  }
  async function acknowledgeStop({ approved = false } = {}) {
    ensureProvider(); if (approved !== true) throw Error('MARKET_APPROVAL_REQUIRED');
    if (busy) throw Error('MARKET_BUSY');
    if (typeof provider.verifySession !== 'function') throw Error('MARKET_SESSION_UNVERIFIED');
    const ticket = controlGeneration;
    runContext = structuredClone(taskStore.context()); busy = true; phase = 'resume-check'; publish();
    try {
      const released = await coordinator.withOwner(session => session.control(async turn => {
        if (turn.inspect().intents.some(i => i.phase === 'pending')) {
          lastReason = 'MARKET_RECOVERY_REQUIRED'; diagnostic(turn.inspect(), lastReason); throw Error(lastReason);
        }
        const result = await provider.verifySession(); current();
        if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP');
        if (result?.ready !== true || stopReason(result)) throw Error('MARKET_SESSION_UNVERIFIED');
        await provider.clearTraffic?.();
        traffic=await provider.traffic?.()??null;
        current(); if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP');
        await turn.checkpoint(state => {
          current(); if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP');
          state.stopped = null;
        });
        lastReason = null;
        diagnostic(turn.inspect());
        return turn.inspect();
      }));
      if (released?.status === 'busy') throw Error('MARKET_BUSY');
      return released;
    } catch (error) {
      lastReason = safeReason(error); reportFailure(lastReason); throw error;
    } finally { busy = false; phase = 'idle'; publish(); }
  }
  async function handoff({ approved = false, snapshot: requested, fromTaskId, toTaskId, itemIds } = {}) {
    ensureProvider(); if (!approved) throw Error('MARKET_APPROVAL_REQUIRED');
    if (busy) throw Error('MARKET_BUSY');
    if (typeof provider.inspectHolding !== 'function' || typeof taskStore.withSnapshot !== 'function') throw Error('MARKET_HANDOFF_INVALID');
    runContext = structuredClone(taskStore.context());
    if (!same(requested?.context, runContext)) throw Error('TASKS_CONTEXT_CHANGED');
    const ticket = controlGeneration;
    const live = () => { current(); if (disposed || ticket !== controlGeneration) throw Error('MARKET_USER_STOP'); };
    busy = true; phase = 'handoff'; publish();
    try {
      return await coordinator.withOwner(session => session.control(turn => taskStore.withSnapshot(requested, async store => {
        live(); const source = store.tasks.find(t => t.id === fromTaskId), target = store.tasks.find(t => t.id === toTaskId);
        if (!source || !['stopped', 'archived'].includes(source.state) || source.activity.unresolved
          || !target || target.mode !== 'sell' || !['ready', 'paused'].includes(target.state) || target.stopRequested
          || target.activity.unresolved) throw Error('MARKET_HANDOFF_INVALID');
        const proof = turn.inspect(); transferMarketHoldings(proof, { fromTaskId, toTaskId, itemIds, now: now() });
        for (const itemId of itemIds) {
          const h = proof.holdings.find(row => row.itemId === itemId);
          if (!target.owned.some(row => row.itemId === itemId && row.definitionId === h.definitionId)) throw Error('MARKET_HANDOFF_INVALID');
          const facts = await provider.inspectHolding(structuredClone(h)); live();
          if (!facts?.eligible || facts.itemId !== h.itemId || facts.definitionId !== h.definitionId
            || !['club', 'transfer', 'unassigned'].includes(facts.pile)
            || ['transfer', 'unsold'].includes(h.phase) && facts.pile !== 'transfer') throw Error('MARKET_HOLDING_UNAVAILABLE');
        }
        live();
        await turn.checkpoint(state => {
          live(); transferMarketHoldings(state, { fromTaskId, toTaskId, itemIds, now: now() });
          const schedule=advanceMarketSchedule(state,target,now());
          for(const h of state.holdings)if(h.taskId===toTaskId&&itemIds.includes(h.itemId)){
            if(schedule)h.sellAt=schedule.sellAt;else delete h.sellAt;
          }
        });
        diagnostic(turn.inspect()); return turn.inspect();
      })));
    } finally { busy = false; phase = 'idle'; publish(); }
  }
  return Object.freeze({ run, enqueue, reopen, recover, manageRecovery, acknowledgeStop, handoff, inspect, pause, stop, pauseAll,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; pauseAll(); } });
}
