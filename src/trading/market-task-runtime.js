import { marketTaskFailureReason } from './market-task-messages.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Page lifetime facade. Loading the tab reads only local state; the native
// factory runs solely after an explicit start/recovery click. Late factory
// completion cannot revive a permission revoked by pause or page teardown.
// In-page navigation and panel visibility do not revoke an approved run.
export function createMarketTaskRuntime({ context, createScheduler, enabled = false, modes = ['fixed', 'sell'] }) {
  let scheduler = null, binding = null, initializing = false, generation = 0, disposed = false, unsubscribe = null, initializationFailure = null;
  const listeners = new Set();
  const inspect = () => scheduler?.inspect() ?? { available: enabled && !disposed, modes: [...modes],
    context: binding, busy: initializing, phase: initializing ? 'initialize' : 'idle', taskId: null,
    reason: initializationFailure, evidence: [], errors: [], tasks: [] };
  const publish = () => { for (const listener of listeners) { try { listener(inspect()); } catch { /* UI only. */ } } };
  const invalidate = () => { generation++; };
  async function ensure() {
    if (!enabled || disposed) throw Error('TASKS_EXECUTION_UNAVAILABLE');
    if (initializing) throw Error('MARKET_BUSY');
    const captured = structuredClone(context());
    if (scheduler && same(binding, captured)) return scheduler;
    scheduler?.dispose(); unsubscribe?.(); scheduler = null; binding = captured;
    const ticket = generation; initializing = true; initializationFailure = null; publish();
    const assertCurrent = () => {
      if (disposed || !same(captured, context())) throw Error('TASKS_CONTEXT_CHANGED');
    };
    let created;
    try {
      created = await createScheduler({ context: captured, assertCurrent }); assertCurrent();
      if (ticket !== generation) throw Error('MARKET_USER_STOP');
      scheduler = created; unsubscribe = scheduler.subscribe(publish); return scheduler;
    } catch (error) { initializationFailure = marketTaskFailureReason(error); created?.dispose(); throw error; }
    finally { initializing = false; publish(); }
  }
  const invoke = async (method, options) => {
    const ticket = generation;
    if (['run', 'enqueue', 'acknowledgeStop', 'handoff'].includes(method) && options?.approved !== true) throw Error('MARKET_APPROVAL_REQUIRED');
    const current = await ensure();
    if (ticket !== generation) throw Error('MARKET_USER_STOP');
    return current[method](options);
  };
  return Object.freeze({ inspect,
    run: options => invoke('run', options), enqueue: options => invoke('enqueue', options),
    recover: () => invoke('recover'), acknowledgeStop: options => invoke('acknowledgeStop', options),
    handoff: options => invoke('handoff', options),
    pause(id) { invalidate(); scheduler?.pause(id); publish(); },
    stop(id) { invalidate(); scheduler?.stop(id); publish(); },
    pauseAll() { invalidate(); scheduler?.pauseAll(); publish(); },
    dispose() { if (disposed) return; disposed = true; invalidate(); scheduler?.dispose(); unsubscribe?.(); publish(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
}
