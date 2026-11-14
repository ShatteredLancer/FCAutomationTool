import { describe, it, expect, vi } from 'vitest';
import { createMarketCoordinator, marketCoordinationKey } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../src/fc27/traditional-lock.js';
import { reserveMarketWrite, settleMarketWrite } from '../../src/trading/market-coordination.js';

const scope = { scope: 'test-account', season: '27', platform: 'console' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const data = new Map([['old-journal', { pending: true }]]), held = new Set(); let account = { ...scope };
  const locks = { request: async (name, options, fn) => {
    if (held.has(name)) { expect(options.ifAvailable).toBe(true); return fn(null); }
    held.add(name); try { return await fn({ name, mode: 'exclusive' }); } finally { held.delete(name); }
  } };
  const get = vi.fn(async (key, fallback) => structuredClone(data.get(key) ?? fallback));
  const set = vi.fn(async (key, value) => { data.set(key, structuredClone(value)); });
  const create = () => createMarketCoordinator({ context: () => account, get, set, locks });
  return { data, held, locks, get, set, create, switchAccount: () => { account = { ...scope, scope: 'other' }; } };
}
const command = { id: 'buy', taskId: 'A', kind: 'buy', itemId: '100', definitionId: 1001, tradeId: '500', coins: 800, at: 0 };
const funds = { balance: 1000, reserve: null, totalCap: null, taskCap: null, spendCap: null, freeSlots: 1 };

describe('durable market coordinator owner and shared native transaction lock', () => {
  it('inspection is read-only and never migrates or clears legacy data', async () => {
    const f = fixture(), coordinator = f.create();
    expect((await coordinator.inspect()).ledger.revision).toBe(0);
    expect(f.set).not.toHaveBeenCalled(); expect(f.data.size).toBe(1);
  });
  it('allows only one account owner; each short round rotates ready tasks', async () => {
    const f = fixture(), a = f.create(), b = f.create(), seen = [];
    await a.withOwner(async session => {
      expect(await b.withOwner(() => { throw Error('unexpected'); })).toEqual({ status: 'busy' });
      for (let i = 0; i < 4; i++) await session.turn(['A', 'B'], turn => { seen.push(turn.taskId); });
    });
    expect(seen).toEqual(['A', 'B', 'A', 'B']); expect(f.held.size).toBe(0);
    expect(f.data.get('old-journal')).toEqual({ pending: true });
  });
  it('does not overlap old Gallery/SBC native transactions', async () => {
    const f = fixture();
    await f.locks.request(FC27_TRADITIONAL_WEB_LOCK, { ifAvailable: true }, async () => {
      await f.create().withOwner(async session => {
        expect(await session.turn(['A'], () => { throw Error('unexpected'); })).toEqual({ status: 'busy' });
      });
    });
    expect(f.set).not.toHaveBeenCalled();
  });
  it('checkpoint is durable before a simulated request, unknown recovery has priority on reload', async () => {
    const f = fixture(); let sends = 0;
    await f.create().withOwner(session => session.turn(['A', 'B'], async turn => {
      await turn.checkpoint(state => reserveMarketWrite(state, command, funds));
      expect(f.data.get(marketCoordinationKey(scope)).ledger.intents[0].phase).toBe('pending');
      sends++;
      await turn.checkpoint(state => settleMarketWrite(state, 'buy', { status: 'unknown', receipt: null }));
    }));
    await f.create().withOwner(session => session.turn(['B'], async turn => {
      expect(turn).toMatchObject({ taskId: 'A', recoveryOnly: true });
      await turn.checkpoint(state => settleMarketWrite(state, 'buy', { status: 'confirmed', receipt: { itemId: '100', definitionId: 1001, tradeId: '500', coins: 800 } }));
    }));
    await f.create().withOwner(async session => {
      expect((await session.turn(['B'], () => { sends++; })).status).toBe('idle');
    });
    expect(sends).toBe(1);
    expect((await f.create().inspect()).ledger.stopped).toBe('unknown-write');
  });
  it('rejects discarded storage writes before a caller can send', async () => {
    const f = fixture(); f.set.mockImplementation(async () => {}); let sends = 0;
    await expect(f.create().withOwner(session => session.turn(['A'], async turn => {
      await turn.checkpoint(state => reserveMarketWrite(state, command, funds)); sends++;
    }))).rejects.toThrow('MARKET_SAVE_UNVERIFIED');
    expect(sends).toBe(0); expect(f.held.size).toBe(0);
  });
  it('rejects account changes while preserving writes in the original account bucket', async () => {
    const f = fixture();
    await expect(f.create().withOwner(session => session.turn(['A'], async turn => {
      f.switchAccount(); await turn.checkpoint(state => reserveMarketWrite(state, command, funds));
    }))).rejects.toThrow('MARKET_CONTEXT_CHANGED');
    expect(f.data.has(marketCoordinationKey({ ...scope, scope: 'other' }))).toBe(false);
    expect(f.data.get(marketCoordinationKey(scope)).ledger.intents).toEqual([]);
  });
  it('closed turns and closed owners cannot be reused as authorization', async () => {
    const f = fixture(); let savedSession, savedTurn;
    await f.create().withOwner(async session => {
      savedSession = session; await session.turn(['A'], turn => { savedTurn = turn; });
      await expect(savedTurn.checkpoint(() => {})).rejects.toThrow('MARKET_TURN_CLOSED');
    });
    await expect(savedSession.turn(['A'], () => {})).rejects.toThrow('MARKET_OWNER_CLOSED');
  });
  it('does not repair corrupt records or overwrite external revisions', async () => {
    const f = fixture();
    await expect(f.create().withOwner(session => session.turn(['A'], async turn => {
      f.data.get(marketCoordinationKey(scope)).ledger.revision++;
      await turn.checkpoint(state => reserveMarketWrite(state, command, funds));
    }))).rejects.toThrow('MARKET_STALE');
    f.data.set(marketCoordinationKey(scope), { context: scope, ledger: null }); f.set.mockClear();
    await expect(f.create().inspect()).rejects.toThrow('MARKET_INVALID'); expect(f.set).not.toHaveBeenCalled();
  });
  it('holds both locks while an unawaited checkpoint storage write is still settling', async () => {
    const f = fixture(), entered = deferred(), release = deferred(), returned = deferred();
    const original = f.set.getMockImplementation(); let write;
    f.set.mockImplementation(async (key, value) => {
      if (value.ledger.intents.length) { entered.resolve(); await release.promise; }
      await original(key, value);
    });
    const run = f.create().withOwner(session => session.turn(['A'], async turn => {
      write = turn.checkpoint(state => reserveMarketWrite(state, command, funds));
      await entered.promise; returned.resolve(); // Deliberately omit await write.
    }));
    await returned.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    const blocked = f.held.has(FC27_TRADITIONAL_WEB_LOCK) && f.held.has(marketCoordinationKey(scope) + ':owner');
    release.resolve(); await Promise.allSettled([run, write]);
    expect(blocked).toBe(true);
  });
});
