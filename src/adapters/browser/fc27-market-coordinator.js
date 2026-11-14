import { tradingTaskContext } from '../../trading/task-model.js';
import { readMarketCoordination, nextMarketTask } from '../../trading/market-coordination.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../fc27/traditional-lock.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const track = (pending, promise, onError) => {
  pending.add(promise);
  void promise.then(() => pending.delete(promise), error => { pending.delete(promise); onError(error); });
  return promise;
};
const drain = async pending => { while (pending.size) await Promise.allSettled([...pending]); };
export const marketCoordinationKey = context => {
  const c = tradingTaskContext(context);
  return `fcat-fc27-market-coordination-v1:${encodeURIComponent(c.scope)}:${c.season}:${c.platform}`;
};

// P2 infrastructure only: no timer, EA provider, authorization or auto-resume.
// The owner lives only for the callback lifetime. A new page can read evidence,
// but must obtain fresh P3 user authorization before supplying executable work.
export function createMarketCoordinator({ context, get, set, locks }) {
  const capture = () => tradingTaskContext(context());
  const current = captured => { if (!same(capture(), captured)) throw Error('MARKET_CONTEXT_CHANGED'); };
  const read = async captured => {
    current(captured);
    const raw = await get(marketCoordinationKey(captured), null);
    current(captured);
    if (raw !== null && (!same(raw.context, captured) || Object.keys(raw).some(k => !['context', 'ledger'].includes(k)))) throw Error('MARKET_CONTEXT_INVALID');
    if (raw !== null && raw.ledger == null) throw Error('MARKET_INVALID');
    return readMarketCoordination(raw?.ledger);
  };
  const inspect = async () => {
    const captured = capture();
    return { context: captured, ledger: await read(captured) };
  };

  async function withOwner(callback) {
    if (typeof locks?.request !== 'function') throw Error('MARKET_LOCK_UNAVAILABLE');
    const captured = capture(), key = marketCoordinationKey(captured), ownerKey = key + ':owner';
    return locks.request(ownerKey, { mode: 'exclusive', ifAvailable: true }, async owner => {
      if (!owner) return { status: 'busy' };
      if (owner.name !== ownerKey || owner.mode !== 'exclusive') throw Error('MARKET_LOCK_LOST');
      current(captured);
      let alive = true, busy = false, turnError = null;
      const pendingTurns = new Set();
      const check = () => { current(captured); if (!alive) throw Error('MARKET_OWNER_CLOSED'); if (turnError) throw turnError; };
      const runTurn = async (readyIds, run, control = false) => {
        check(); if (busy) return { status: 'busy' }; busy = true;
        try {
          // Reuse the current native transaction lock as well. Full cross-module
          // cadence accounting is P6; this already prevents overlapping writes.
          return await locks.request(FC27_TRADITIONAL_WEB_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (!lock) return { status: 'busy' };
            if (lock.name !== FC27_TRADITIONAL_WEB_LOCK || lock.mode !== 'exclusive') throw Error('MARKET_LOCK_LOST');
            check(); let ledger = await read(captured), turnAlive = true, writing = false, writeError = null;
            const pendingWrites = new Set();
            const saveCheckpoint = async change => {
              check();
              if (!turnAlive) throw Error('MARKET_TURN_CLOSED');
              if (writing) throw Error('MARKET_CHECKPOINT_BUSY');
              writing = true;
              try {
                const fresh = await read(captured);
                if (!same(fresh, ledger)) throw Error('MARKET_STALE');
                const next = structuredClone(ledger);
                const result = change(next);
                if (result && typeof result.then === 'function') {
                  void Promise.resolve(result).catch(() => {});
                  throw Error('MARKET_ASYNC_MUTATION');
                }
                next.revision++;
                const value = { context: captured, ledger: readMarketCoordination(next) };
                check(); await set(key, value);
                // Do not release the Web Lock until every write/readback settles.
                const saved = await get(key, null);
                if (!same(saved, value)) throw Error('MARKET_SAVE_UNVERIFIED');
                ledger = value.ledger; check(); return structuredClone(ledger);
              } finally { writing = false; }
            };
            const checkpoint = change => track(pendingWrites, saveCheckpoint(change), error => { writeError ??= error; });
            try {
              const pending = ledger.intents.find(i => i.phase === 'pending');
              let taskId = pending?.taskId ?? null;
              if (!pending && !control) {
                const next = structuredClone(ledger);
                taskId = nextMarketTask(next, readyIds);
                if (taskId !== null) await checkpoint(state => { state.lastTask = taskId; });
              }
              if (taskId === null && !control) return { status: 'idle', ledger: structuredClone(ledger) };
              return await run({ taskId, recoveryOnly: control || Boolean(pending),
                inspect: () => { check(); if (!turnAlive) throw Error('MARKET_TURN_CLOSED'); return structuredClone(ledger); }, checkpoint });
            } finally {
              turnAlive = false;
              await drain(pendingWrites);
              if (writeError) throw writeError;
            }
          });
        } finally { busy = false; }
      };
      const turn = (readyIds, run) => track(pendingTurns, runTurn(readyIds, run), error => { turnError ??= error; });
      const control = run => track(pendingTurns, runTurn([], run, true), error => { turnError ??= error; });
      try { return await callback({ turn, control, inspect: async () => { check(); return read(captured); } }); }
      finally { alive = false; await drain(pendingTurns); if (turnError) throw turnError; }
    });
  }
  return Object.freeze({ inspect, withOwner });
}
