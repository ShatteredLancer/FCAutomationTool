import { describe, it, expect } from 'vitest';
import { emptyMarketCoordination, readMarketCoordination } from '../../src/trading/market-coordination.js';
import { reserveMarketClock, closeMarketClock, marketElapsed } from '../../src/trading/market-task-clock.js';

describe('durable market runtime leases', () => {
  it('preserves old ledgers and rejects malformed clocks instead of resetting them', () => {
    const old = emptyMarketCoordination(); expect(readMarketCoordination(old)).toEqual(old);
    expect(() => readMarketCoordination({ ...old, clocks: [{ taskId: 'a', elapsedMs: -1 }] })).toThrow();
  });
  it('counts active time across pause/resume and does not count offline hours', () => {
    const s = emptyMarketCoordination(); reserveMarketClock(s, 'a', 'first', 1000, 60000);
    expect(marketElapsed(s.clocks[0], 21000, 'first')).toBe(20000);
    closeMarketClock(s, 'a', 'first', 21000);
    reserveMarketClock(s, 'a', 'second', 1000000, 60000);
    expect(marketElapsed(s.clocks[0], 1005000, 'second')).toBe(25000);
    closeMarketClock(s, 'a', 'second', 1005000);
    expect(s.clocks[0]).toMatchObject({ elapsedMs: 25000, lease: null, stopped: false });
  });
  it('charges at most the abandoned minute and cannot evade a limit by refreshing', () => {
    const s = emptyMarketCoordination(); reserveMarketClock(s, 'a', 'crashed', 1000, 120000);
    reserveMarketClock(s, 'a', 'reloaded', 9000000, 120000);
    expect(marketElapsed(s.clocks[0], 9000000, 'reloaded')).toBe(60000);
    reserveMarketClock(s, 'a', 'another-refresh', 9000001, 120000);
    expect(s.clocks[0]).toEqual({ taskId: 'a', elapsedMs: 120000, lease: null, stopped: true });
  });
  it('rolls active leases, keeps stop terminal, isolates task IDs and refuses late refunds', () => {
    const s = emptyMarketCoordination(); reserveMarketClock(s, 'a', 'one', 1000);
    reserveMarketClock(s, 'a', 'one', 61000);
    closeMarketClock(s, 'a', 'one', 66000, true);
    reserveMarketClock(s, 'a', 'two', 100000); reserveMarketClock(s, 'b', 'new', 100000);
    closeMarketClock(s, 'a', 'one', 1000);
    expect(s.clocks[0]).toEqual({ taskId: 'a', elapsedMs: 65000, lease: null, stopped: true });
    expect(s.clocks[1].stopped).toBe(false); expect(readMarketCoordination(s)).toEqual(s);
  });
});
