import { readTradingTasks } from './task-model.js';
import { marketSearchGate, marketOccupancy, nextMarketTask, reserveMarketSearch, settleMarketSearch,
  reserveMarketWrite, settleMarketWrite } from './market-coordination.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const actionable = row => ['queued', 'waiting', 'running'].includes(row.state);
const safeReason = error => /^(MARKET|TASKS)_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'MARKET_PROVIDER_FAILED';
const defaultWait = (ms, signal) => new Promise(resolve => {
  if (signal.aborted) { resolve(); return; }
  let timer;
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
  timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
});
const codeOf = result => Number.isSafeInteger(result?.code) && result.code >= 100 && result.code <= 99999 ? result.code : null;
const stopReason = result => result?.category === 'captcha' ? 'captcha'
  : codeOf(result) === 401 ? 'authentication'
    : [403, 429, 512, 521, 426, 459].includes(codeOf(result)) || result?.category === 'market-unavailable' ? 'throttle' : null;

// P2 executor contract. No default/real EA provider is installed. prepare may
// read public quotes outside native locks; preflight/send/reconcile must use
// the audited P3 adapter. One turn sends at most ONE request. Persisting task
// state never grants a permit; only this live, explicitly approved run does.
export function createMarketTaskScheduler({ taskStore, coordinator, provider = null, enabled = false,
  now = () => Date.now(), random = Math.random, id = () => globalThis.crypto.randomUUID(),
  wait = defaultWait, onStatus = () => {}, onDiagnostic = () => {}, errorPolicy = { codes: [], count: 1 }, supportedModes = ['fixed', 'sell'] }) {
  if (!Array.isArray(supportedModes) || supportedModes.some(mode => !['fixed', 'sell', 'filter'].includes(mode))) throw Error('MARKET_TASK_SELECTION_INVALID');
  if (!Array.isArray(errorPolicy.codes) || errorPolicy.codes.some(code => !Number.isSafeInteger(code) || code < 100 || code > 99999)
    || !Number.isSafeInteger(errorPolicy.count) || errorPolicy.count < 1) throw Error('MARKET_ERROR_POLICY_INVALID');
  let busy = false, executing = false, disposed = false, runContext = null, snapshot = null, wake = null, evidence = [];
  let policyRead = null, policyAt = 0;
  let tasks = new Map(), phase = 'idle', currentTask = null, lastReason = null, errorCounts = new Map();
  const listeners = new Set();
  const inspect = () => ({ available: enabled && Boolean(provider), modes: [...supportedModes], context: runContext ? structuredClone(runContext) : null, busy, phase, taskId: currentTask,
    reason: lastReason, evidence: structuredClone(evidence), errors: [...errorCounts].map(([code, count]) => ({ code, count })), tasks: [...tasks.values()].map(row => ({ ...row })) });
  const publish = () => { for (const listener of [onStatus, ...listeners]) { try { listener(inspect()); } catch { /* Presentation is not authorization. */ } } };
  const reportFailure = reason => {
    try { Promise.resolve(onDiagnostic({ area: 'trading', event: 'task-scheduler', phase, status: 'blocked', reason })).catch(() => {}); }
    catch { /* A logging failure cannot change task authorization or receipts. */ }
  };
  const diagnostic = (state, reason = null, code = null) => {
    const occupancy = marketOccupancy(state);
    evidence = [...new Set([...state.intents.map(i => i.taskId), ...state.holdings.map(h => h.taskId)])].map(taskId => {
      const entries = state.intents.filter(i => i.taskId === taskId);
      return { taskId, hasEvidence: true, unresolved: entries.some(i => i.phase === 'pending'),
        counts: [entries.filter(i => i.kind === 'buy' && i.phase === 'confirmed').length,
          entries.filter(i => i.kind === 'list' && i.phase === 'confirmed').length,
          state.holdings.filter(h => h.taskId === taskId && h.phase === 'sold').length] };
    });
    try { Promise.resolve(onDiagnostic({ area: 'trading', event: 'task-scheduler', phase,
      status: reason ? 'blocked' : 'observed', reason, errorCode: code,
      pendingWriteCount: state.intents.filter(i => i.phase === 'pending').length,
      requestedCount: tasks.size, ownedCount: occupancy.count, spent: occupancy.spent,
      reservedCoins: occupancy.reservedCoins })).catch(() => {}); } catch { /* No evidence objects/IDs. */ }
  };
  const current = () => {
    if (!same(taskStore.context(), runContext)) throw Error('TASKS_CONTEXT_CHANGED');
  };
  const allowed = taskId => !disposed && actionable(tasks.get(taskId) ?? {});
  const stateOf = (taskId, state, reason = null, nextAt = 0) => {
    const row = tasks.get(taskId); if (row) Object.assign(row, { state, reason, nextAt }); publish();
  };
  const revoke = (taskId, state) => {
    for (const row of tasks.values()) if (taskId === null || row.id === taskId) {
      if (actionable(row)) Object.assign(row, { state, reason: 'MARKET_USER_STOP', nextAt: 0 });
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
  const bound = async (taskId, fn) => taskStore.withTask(snapshot, taskId, async args => { current(); return fn(args); });
  const applyError = async (turn, result) => {
    const code = codeOf(result);
    if (code !== null) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
    const reason = stopReason(result) ?? (errorPolicy.codes.includes(code) && errorCounts.get(code) >= errorPolicy.count ? 'manual' : null);
    if (reason) {
      await turn.checkpoint(state => { state.stopped = reason; });
      lastReason = reason === 'authentication' ? 'MARKET_AUTHENTICATION' : reason === 'captcha' ? 'MARKET_CAPTCHA'
        : reason === 'manual' ? 'MARKET_ERROR_LIMIT' : 'MARKET_THROTTLED';
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
      if (!task || !supportedModes.includes(task.mode) || !['ready', 'paused', 'stopped'].includes(task.state) || task.activity.unresolved
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
      || taskIds.some(taskId => !store.tasks.some(t => t.id === taskId && supportedModes.includes(t.mode) && ['ready', 'paused', 'stopped'].includes(t.state) && !t.activity.unresolved))) throw Error('MARKET_TASK_SELECTION_INVALID');
    snapshot = { context: structuredClone(requested.context), store }; runContext = snapshot.context; current();
    busy = true; executing = true; lastReason = null; errorCounts = new Map(); evidence = []; policyRead = null;
    const startedAt = now();
    tasks = new Map(taskIds.map(taskId => [taskId, { id: taskId, state: 'queued', reason: null, nextAt: 0, startedAt }])); publish();
    try {
      const result = await coordinator.withOwner(async session => {
        while (!disposed && [...tasks.values()].some(actionable)) {
          current(); const ledger = await session.inspect();
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
            if (duration !== null && now() - row.startedAt >= duration * 60000 && actionable(row)) stateOf(row.id, 'stopped', 'MARKET_TIME_LIMIT');
          }
          const ready = [...tasks.values()].filter(row => actionable(row) && row.nextAt <= now()).map(row => row.id);
          if (!ready.length) {
            const pending = [...tasks.values()].filter(actionable); if (!pending.length) break;
            phase = 'waiting'; currentTask = null; publish();
            await delay(Math.min(...pending.map(row => row.nextAt)) - now()); continue;
          }
          const selected = nextMarketTask(structuredClone(ledger), ready), task = taskConfig(selected);
          currentTask = selected; phase = 'prepare'; stateOf(selected, 'running');
          let action;
          try { action = structuredClone(await provider.prepare({ task: structuredClone(task), settings: structuredClone(store.settings),
            ledger: structuredClone(ledger), now: now() })); current(); }
          catch (error) { reportFailure(safeReason(error)); stateOf(selected, 'paused', safeReason(error)); continue; }
          if (!allowed(selected)) continue;
          if (action?.kind === 'wait' && Number.isSafeInteger(action.until) && action.until > now()) {
            stateOf(selected, 'waiting', 'MARKET_TASK_WAIT', action.until); continue;
          }
          if (action?.kind === 'done') { stateOf(selected, 'completed'); continue; }
          if (!['search', 'buy', 'move', 'list'].includes(action?.kind) || !validAt(action)) {
            stateOf(selected, 'paused', 'MARKET_ACTION_EXPIRED_OR_INVALID'); continue;
          }
          if (action.kind === 'search') {
            const gate = marketSearchGate(ledger, store.settings, now());
            if (gate.nextAt > now()) { stateOf(selected, 'waiting', 'MARKET_SEARCH_WAIT', gate.nextAt); continue; }
          }
          try {
            const round = await session.turn([selected], async turn => {
              if (turn.recoveryOnly) { stateOf(selected, 'review', 'MARKET_RECOVERY_REQUIRED'); return; }
              try { await bound(selected, async ({ task: fresh, settings }) => {
                if (!allowed(selected) || !validAt(action)) return;
                phase = 'preflight'; publish();
                const preflight = await provider.preflight({ task: fresh, settings, action: structuredClone(action), ledger: turn.inspect() }); current();
                if (!allowed(selected)) return;
                if (await applyError(turn, preflight)) return;
                if (preflight?.ready !== true) { stateOf(selected, 'paused', 'MARKET_PREFLIGHT_BLOCKED'); return; }
                if (!validAt(action)) { stateOf(selected, 'paused', 'MARKET_ACTION_EXPIRED_OR_INVALID'); return; }
                const requestId = id();
                const command = action.kind === 'search' ? null : { id: requestId, taskId: selected, kind: action.kind,
                  itemId: action.itemId, definitionId: action.definitionId, tradeId: action.tradeId ?? null, coins: action.coins, at: now() };
                if (command?.kind === 'buy') {
                  const row = fresh.players.find(p => p.definitionId === command.definitionId);
                  if (fresh.mode === 'sell' || fresh.mode === 'fixed' && !row
                    || fresh.settings.hardCap !== null && command.coins > fresh.settings.hardCap
                    || row?.cap == null && fresh.settings.buyRule === 'fixed' && command.coins > fresh.settings.buyValue
                    || row?.cap != null && command.coins > row.cap) throw Error('MARKET_BUY_RULE_CHANGED');
                }
                if (command?.kind === 'list' && fresh.settings.sellRule === 'fixed' && command.coins !== fresh.settings.sellValue) throw Error('MARKET_SELL_RULE_CHANGED');
                phase = action.kind; publish();
                if (action.kind === 'search') await turn.checkpoint(state => reserveMarketSearch(state, { requestId, now: now(), settings, random }));
                else await turn.checkpoint(state => reserveMarketWrite(state, command, {
                  balance: preflight.balance, freeSlots: preflight.freeSlots, reserve: settings.reserve,
                  totalCap: settings.totalCap, taskCap: fresh.settings.taskCap, spendCap: fresh.settings.spendCap,
                  perVersion: fresh.mode === 'fixed' ? fresh.players.find(p => p.definitionId === command.definitionId)?.qty ?? null : fresh.settings.perVersion,
                }));
                // This is the final synchronous boundary before invoking send.
                // Cancelling during GM persistence is a definite no-send.
                if (!allowed(selected) || !validAt(action)) {
                  await turn.checkpoint(state => action.kind === 'search' ? settleMarketSearch(state, requestId, 'not-sent')
                    : settleMarketWrite(state, requestId, { status: 'rejected', receipt: null }));
                  if (allowed(selected)) stateOf(selected, 'paused', 'MARKET_ACTION_EXPIRED_OR_INVALID'); return;
                }
                current(); let response;
                try { response = await provider.send({ action: structuredClone(action), requestId }); }
                catch { response = { status: 'unknown', receipt: null }; }
                current();
                if (action.kind === 'search') {
                  // An exception/timeout cannot prove no-send; retain dispatching.
                  if (response?.sent === true || response?.sent === false) await turn.checkpoint(state => settleMarketSearch(state, requestId, response.sent ? 'sent' : 'not-sent'));
                } else {
                  const status = ['confirmed', 'rejected'].includes(response?.status) ? response.status : 'unknown';
                  await turn.checkpoint(state => settleMarketWrite(state, requestId, { status, receipt: response?.receipt ?? null }));
                }
                const halted = await applyError(turn, response);
                if (!halted && (response?.status === 'unknown' || action.kind === 'search' && response?.sent !== true)) {
                  stateOf(selected, action.kind === 'search' ? 'paused' : 'review', 'MARKET_RESPONSE_UNCONFIRMED');
                }
                diagnostic(turn.inspect(), tasks.get(selected)?.reason ?? lastReason);
                // Optional adapter-local cursor update, never a second request.
                if (typeof provider.accept === 'function') await provider.accept({ action, response, ledger: turn.inspect() });
                current();
                if (allowed(selected)) stateOf(selected, 'queued');
              }); } catch (error) {
                if (['TASKS_AUTHORIZATION_CHANGED', 'TASKS_NOT_FOUND'].includes(error.message)) stateOf(selected, 'paused', error.message);
                else throw error;
              }
            });
            if (round?.status === 'busy') stateOf(selected, 'waiting', 'MARKET_NATIVE_BUSY', now() + 1000);
          } catch (error) { stateOf(selected, 'paused', safeReason(error)); throw error; }
        }
        return inspect();
      });
      if (result?.status === 'busy') { lastReason = 'MARKET_BUSY'; pauseAll(); }
    } catch (error) {
      lastReason = safeReason(error);
      reportFailure(lastReason);
      for (const row of tasks.values()) if (actionable(row)) stateOf(row.id, 'paused', lastReason);
    } finally {
      busy = false; executing = false; phase = 'idle'; currentTask = null; wake?.abort(); publish();
    }
    return inspect();
  }

  // Explicit read-only recovery. Never turns a recovery click into a new send,
  // never resumes tasks or clears authentication/throttle stops automatically.
  async function recover() {
    ensureProvider(); if (busy) throw Error('MARKET_BUSY');
    runContext = structuredClone(taskStore.context()); busy = true; phase = 'recover'; publish();
    try {
      return await coordinator.withOwner(session => session.control(async turn => {
        const pending = turn.inspect().intents.filter(i => i.phase === 'pending');
        for (const entry of pending) {
          current(); const response = await provider.reconcile(structuredClone(entry)); current();
          if (['confirmed', 'rejected'].includes(response?.status)) await turn.checkpoint(state => settleMarketWrite(state, entry.id,
            { status: response.status, receipt: response.receipt ?? null }));
          await applyError(turn, response);
        }
        diagnostic(turn.inspect()); return turn.inspect();
      }));
    } finally { busy = false; phase = 'idle'; publish(); }
  }
  async function acknowledgeStop({ approved = false } = {}) {
    ensureProvider(); if (approved !== true) throw Error('MARKET_APPROVAL_REQUIRED');
    if (busy) throw Error('MARKET_BUSY');
    if (typeof provider.verifySession !== 'function') throw Error('MARKET_SESSION_UNVERIFIED');
    runContext = structuredClone(taskStore.context()); busy = true; phase = 'resume-check'; publish();
    try {
      return await coordinator.withOwner(session => session.control(async turn => {
        if (turn.inspect().intents.some(i => i.phase === 'pending')) throw Error('MARKET_RECOVERY_REQUIRED');
        const result = await provider.verifySession(); current();
        if (result?.ready !== true || stopReason(result)) throw Error('MARKET_SESSION_UNVERIFIED');
        await turn.checkpoint(state => { state.stopped = null; });
        return turn.inspect();
      }));
    } finally { busy = false; phase = 'idle'; publish(); }
  }
  return Object.freeze({ run, enqueue, recover, acknowledgeStop, inspect, pause, stop, pauseAll,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; pauseAll(); } });
}
