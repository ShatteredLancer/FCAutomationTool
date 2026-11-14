import { TASK_STORE_LIMIT, tradingTaskContext, tradingPublicSettings, normalizeTradingTaskInput,
  emptyTaskActivity, readTradingTasks } from '../../trading/task-model.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const config = t => normalizeTradingTaskInput({ name: t.name, mode: t.mode, settings: t.settings,
  players: t.players, owned: t.owned, excluded: t.excluded });
export const tradingTaskKey = context => {
  const c = tradingTaskContext(context);
  return `fcat-fc27-market-tasks-v1:${encodeURIComponent(c.scope)}:${c.season}:${c.platform}`;
};

export function createTradingTaskStore({ context, get, set, locks, now = () => Date.now(),
  id = () => globalThis.crypto.randomUUID(), readEvidence = async () => ({ unresolved: false, hasEvidence: false }) }) {
  const capture = () => tradingTaskContext(context());
  const current = c => { if (!same(capture(), c)) throw Error('TASKS_CONTEXT_CHANGED'); };
  const read = async () => {
    const c = capture(), store = readTradingTasks(await get(tradingTaskKey(c), null), c);
    current(c); return { context: c, store };
  };
  const find = (store, key) => {
    const task = store.tasks.find(t => t.id === key); if (!task) throw Error('TASKS_NOT_FOUND'); return task;
  };
  const evidence = async (task, c) => {
    const value = await readEvidence(task.id, c); current(c);
    if (typeof value?.unresolved !== 'boolean' || typeof value?.hasEvidence !== 'boolean') throw Error('TASKS_EVIDENCE_UNVERIFIED');
    return { unresolved: task.activity.unresolved || value.unresolved,
      hasEvidence: task.activity.receipts.length > 0 || value.hasEvidence };
  };
  const touch = task => { task.revision++; task.updatedAt = now(); };
  const mutate = async (snapshot, fn) => {
    const c = tradingTaskContext(snapshot.context); current(c);
    if (!locks?.request) throw Error('TASKS_LOCK_UNAVAILABLE');
    return locks.request(tradingTaskKey(c), { mode: 'exclusive' }, async () => {
      current(c); const key = tradingTaskKey(c), store = readTradingTasks(await get(key, null), c); current(c);
      if (store.revision !== snapshot.store?.revision) throw Error('TASKS_STALE');
      await fn(store, c); current(c); store.revision++;
      const next = readTradingTasks(store, c), serialized = JSON.stringify(next);
      if (new globalThis.TextEncoder().encode(serialized).length > TASK_STORE_LIMIT) throw Error('TASKS_STORAGE_LIMIT');
      current(c); await set(key, next); current(c);
      if (JSON.stringify(await get(key, null)) !== serialized) throw Error('TASKS_SAVE_UNVERIFIED');
      current(c); return { context: c, store: readTradingTasks(next, c) };
    });
  };

  // Held for one short executor round. Editing uses this same lock, so the
  // captured task rules cannot change between preflight and dispatch. Local
  // pause/stop revokes the scheduler's memory permit immediately, before saving.
  const withTask = async (snapshot, taskId, callback) => {
    const c = tradingTaskContext(snapshot.context); current(c);
    const expected = find(readTradingTasks(snapshot.store, c), taskId);
    if (!locks?.request) throw Error('TASKS_LOCK_UNAVAILABLE');
    return locks.request(tradingTaskKey(c), { mode: 'exclusive' }, async () => {
      const fresh = await read(); current(c);
      const task = find(fresh.store, taskId);
      if (task.revision !== expected.revision || !same(config(task), config(expected))
        || !same(fresh.store.settings, snapshot.store.settings) || task.state !== expected.state
        || ['archived', 'review'].includes(task.state) || task.activity.unresolved) throw Error('TASKS_AUTHORIZATION_CHANGED');
      return callback({ task: structuredClone(task), settings: structuredClone(fresh.store.settings) });
    });
  };

  return Object.freeze({ context: capture, read, withTask,
    saveTask: options => {
      const input = normalizeTradingTaskInput(options.input);
      return mutate(options, async (store, c) => {
        if (options.id) {
          const task = find(store, options.id);
          if (!['ready', 'paused'].includes(task.state) || (await evidence(task, c)).unresolved) throw Error('TASKS_EDIT_BLOCKED');
          Object.assign(task, input); touch(task);
        } else store.tasks.push({ id: id(), revision: 0, ...input, state: 'ready',
          createdAt: now(), updatedAt: now(), activity: emptyTaskActivity() });
      });
    },
    saveSettings: options => {
      const settings = tradingPublicSettings(options.settings);
      return mutate(options, store => {
        store.settings = settings;
        for (const task of store.tasks) {
          if (['running', 'queued'].includes(task.state)) task.state = 'paused';
          touch(task); // Revoke all prior approvals, even if values were restored.
        }
      });
    },
    action: options => mutate(options, async (store, c) => {
      if (options.action === 'pause-all') {
        for (const task of store.tasks) {
          if (['ready', 'running', 'queued'].includes(task.state)) task.state = 'paused';
          touch(task);
        }
        return;
      }
      const task = find(store, options.id);
      if (options.action === 'copy') {
        store.tasks.push({ id: id(), revision: 0, ...config(task), name: task.name.slice(0, 55) + ' · 副本',
          state: 'ready', createdAt: now(), updatedAt: now(), activity: emptyTaskActivity() }); return;
      }
      if (options.action === 'pause') {
        if (['ready', 'running', 'queued'].includes(task.state)) task.state = 'paused'; touch(task); return;
      }
      const facts = await evidence(task, c);
      if (options.action === 'stop') {
        if (task.state !== 'archived') task.state = facts.unresolved || task.state === 'review' ? 'review' : 'stopped'; touch(task); return;
      }
      if (options.action === 'acknowledge' && !facts.unresolved && task.state === 'review') {
        task.state = 'paused'; touch(task); return; // Still requires a fresh explicit run approval.
      }
      if (facts.unresolved || task.state === 'review') throw Error('TASKS_UNRESOLVED');
      if (options.action === 'delete') {
        if (facts.hasEvidence) { task.state = 'archived'; touch(task); }
        else store.tasks = store.tasks.filter(row => row !== task);
        return;
      }
      throw Error('TASKS_EXECUTION_UNAVAILABLE');
    }),
  });
}
