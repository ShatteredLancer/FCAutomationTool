import { describe, it, expect } from 'vitest';
import { defaultTradingPublicSettings } from '../../src/trading/task-model.js';
import { emptyMarketCoordination, readMarketCoordination, marketSearchGate, reserveMarketSearch,
  settleMarketSearch, marketOccupancy, claimMarketHolding, reserveMarketWrite, settleMarketWrite,
  settleMarketSale, nextMarketTask } from '../../src/trading/market-coordination.js';

const settings = { ...defaultTradingPublicSettings(), gapMin: 7, gapMax: 7, cycleMin: 2, cycleMax: 2, restMin: 5, restMax: 5 };
const funds = { balance: 10000, reserve: null, totalCap: null, taskCap: null, spendCap: null, freeSlots: 10 };
const buy = (extra = {}) => ({ id: 'buy-1', taskId: 'A', kind: 'buy', itemId: '101', definitionId: 1001, tradeId: '501', coins: 800, at: 100, ...extra });
const receipt = entry => ({ itemId: entry.itemId, definitionId: entry.definitionId, tradeId: entry.tradeId, coins: entry.coins });
const confirm = (state, entry) => settleMarketWrite(state, entry.id, { status: 'confirmed', receipt: receipt(entry) });

describe('account-wide market pacing and ledger primitives', () => {
  it('shares cooldown and cycle rest across tasks and reloads', () => {
    let state = emptyMarketCoordination();
    reserveMarketSearch(state, { requestId: 'A-1', now: 0, settings, random: () => 0 });
    settleMarketSearch(state, 'A-1', 'sent');
    expect(marketSearchGate(state, settings, 0)).toMatchObject({ hour: 1, day: 1, nextAt: 7000, uncertain: 0 });
    state = readMarketCoordination(state);
    expect(() => reserveMarketSearch(state, { requestId: 'B-1', now: 6999, settings })).toThrow('MARKET_SEARCH_WAIT');
    reserveMarketSearch(state, { requestId: 'B-1', now: 7000, settings, random: () => 0 });
    expect(state.nextSearchAt).toBe(19000);
    expect(state.cycleCount).toBe(0);
  });
  it('counts potentially sent requests once; known no-send releases quota but not pacing', () => {
    const state = emptyMarketCoordination();
    reserveMarketSearch(state, { requestId: 'timeout', now: 0, settings, random: () => 0 });
    expect(marketSearchGate(state, settings, 0)).toMatchObject({ hour: 1, uncertain: 1 });
    settleMarketSearch(state, 'timeout', 'sent');
    expect(() => settleMarketSearch(state, 'timeout', 'sent')).toThrow('MARKET_RECEIPT_CONFLICT');
    reserveMarketSearch(state, { requestId: 'cancelled', now: 7000, settings, random: () => 0 });
    settleMarketSearch(state, 'cancelled', 'not-sent');
    expect(marketSearchGate(state, settings, 7000)).toMatchObject({ hour: 1, nextAt: 19000 });
    expect(() => reserveMarketSearch(state, { requestId: 'timeout', now: 20000, settings })).toThrow('MARKET_DUPLICATE_REQUEST');
  });
  it('computes enough expirations when a limit is reduced, with exact rolling boundaries', () => {
    const state = emptyMarketCoordination();
    state.searches = [0, 1000, 2000, 3000, 4000].map((at, i) => ({ id: `r${i}`, at, status: 'sent' }));
    const lower = { ...settings, hourLimit: 2, dayLimit: 100 };
    expect(marketSearchGate(state, lower, 5000).nextAt).toBe(3603000);
    expect(marketSearchGate(state, lower, 3603000)).toMatchObject({ hour: 1, nextAt: 3603000 });
    expect(marketSearchGate(state, { ...lower, dayLimit: 1 }, 5000).nextAt).toBe(86404000);
  });
  it('does not replay missed intervals when time advances or clear pacing on reload', () => {
    const state = emptyMarketCoordination();
    reserveMarketSearch(state, { requestId: '1', now: 0, settings, random: () => 0 });
    reserveMarketSearch(state, { requestId: '2', now: 86400000, settings, random: () => 0 });
    expect(state.searches).toHaveLength(1);
    expect(state.nextSearchAt).toBe(86412000);
    expect(marketSearchGate(readMarketCoordination(state), settings, 86400000).nextAt).toBe(86412000);
  });
  it('round-robins only ready tasks and prioritizes unresolved evidence over all new work', () => {
    const state = emptyMarketCoordination();
    expect(Array.from({ length: 5 }, () => nextMarketTask(state, ['A', 'B', 'C']))).toEqual(['A', 'B', 'C', 'A', 'B']);
    expect(nextMarketTask(state, ['A', 'C'])).toBe('A');
    reserveMarketWrite(state, buy(), funds);
    expect(nextMarketTask(state, ['A', 'C'])).toBeNull();
    expect(() => reserveMarketSearch(state, { requestId: 'new-search', now: 100000, settings })).toThrow('MARKET_RECOVERY_REQUIRED');
    settleMarketWrite(state, 'buy-1', { status: 'unknown', receipt: null });
    expect(state.stopped).toBe('unknown-write');
    expect(marketOccupancy(state)).toMatchObject({ reservedCoins: 800, count: 1, spent: 0 });
    expect(() => reserveMarketWrite(state, buy({ id: 'buy-2', taskId: 'B' }), funds)).toThrow('MARKET_STOPPED');
  });
  it('reserves funds before sending and does not clear unknowns by rejecting a different request', () => {
    const state = emptyMarketCoordination(); reserveMarketWrite(state, buy(), funds);
    expect(() => reserveMarketWrite(state, buy({ id: 'buy-2', itemId: '102', tradeId: '502' }), funds)).toThrow('MARKET_RECOVERY_REQUIRED');
    expect(() => settleMarketWrite(state, 'other', { status: 'rejected', receipt: null })).toThrow('MARKET_RECEIPT_CONFLICT');
    expect(marketOccupancy(readMarketCoordination(state)).reservedCoins).toBe(800);
    settleMarketWrite(state, 'buy-1', { status: 'rejected', receipt: null });
    expect(marketOccupancy(state).reservedCoins).toBe(0);
    expect(state.intents).toHaveLength(1);
  });
  it.each([
    [{ balance: 799 }, 'FUNDS_OR_CAPACITY'], [{ balance: 800, reserve: 1 }, 'FUNDS_OR_CAPACITY'],
    [{ freeSlots: 0 }, 'FUNDS_OR_CAPACITY'], [{ totalCap: 799 }, 'HOLDING_CAP'],
    [{ taskCap: 799 }, 'HOLDING_CAP'], [{ spendCap: 799 }, 'SPEND_CAP'],
  ])('checks independent cash/capacity/holding/spend constraints %j', (limits, reason) => {
    const state = emptyMarketCoordination();
    expect(() => reserveMarketWrite(state, buy(), { ...funds, ...limits })).toThrow(`MARKET_${reason}`);
    expect(state.intents).toHaveLength(0);
  });
  it('confirmed buys transfer reservation into holdings without counting listing as proceeds', () => {
    const state = emptyMarketCoordination(), entry = buy(); reserveMarketWrite(state, entry, funds); confirm(state, entry);
    confirm(state, entry); // Identical independent readback is idempotent.
    expect(marketOccupancy(state)).toMatchObject({ reservedCoins: 0, holdingCoins: 800, spent: 800, count: 1 });
    const move = buy({ id: 'move', kind: 'move', coins: 0, tradeId: null });
    reserveMarketWrite(state, move); confirm(state, move);
    const list = buy({ id: 'list', kind: 'list', coins: 700, tradeId: null });
    reserveMarketWrite(state, list);
    settleMarketWrite(state, 'list', { status: 'confirmed', receipt: { ...receipt(list), tradeId: '900' } });
    expect(state.holdings[0]).toMatchObject({ phase: 'listed', cost: 800, salePrice: null });
    expect(marketOccupancy(readMarketCoordination(state)).holdingCoins).toBe(800);
    expect(() => settleMarketSale(state, { itemId: '101', definitionId: 1001, tradeId: '900', price: 700, sold: false })).toThrow('MARKET_RECEIPT_CONFLICT');
    settleMarketSale(state, { itemId: '101', definitionId: 1001, tradeId: '900', price: 700, sold: true });
    expect(marketOccupancy(state)).toMatchObject({ holdingCoins: 0, spent: 800 });
    expect(state.intents).toHaveLength(3);
  });
  it('keeps imported unknown purchase costs unknown, enforcing an optional global holding cap', () => {
    const state = emptyMarketCoordination();
    claimMarketHolding(state, { taskId: 'sell', itemId: '5', definitionId: 55, cost: null });
    expect(marketOccupancy(state)).toMatchObject({ unknownCosts: 1, count: 1 });
    expect(() => reserveMarketWrite(state, buy(), { ...funds, totalCap: 10000 })).toThrow('MARKET_HOLDING_CAP');
    reserveMarketWrite(state, buy(), funds); // Null cap is genuinely unlimited.
  });
  it('never assigns the same entity or purchased offer to another task', () => {
    const state = emptyMarketCoordination(), entry = buy(); reserveMarketWrite(state, entry, funds); confirm(state, entry);
    expect(() => claimMarketHolding(state, { taskId: 'B', itemId: '101', definitionId: 1001, cost: 800 })).toThrow('MARKET_ITEM_OCCUPIED');
    expect(() => reserveMarketWrite(state, buy({ id: 'again', taskId: 'B' }), funds)).toThrow('MARKET_ITEM_OCCUPIED');
    expect(() => reserveMarketWrite(state, buy({ id: 'move', taskId: 'B', kind: 'move', tradeId: null, coins: 0 }))).toThrow('MARKET_ITEM_OCCUPIED');
  });
  it('enforces per-version holdings without merging different versions or imposing a default cap', () => {
    const state = emptyMarketCoordination(), entry = buy(); reserveMarketWrite(state, entry, funds); confirm(state, entry);
    const another = buy({ id: 'second', itemId: '102', tradeId: '502' });
    expect(() => reserveMarketWrite(state, another, { ...funds, perVersion: 1 })).toThrow('MARKET_VERSION_CAP');
    reserveMarketWrite(state, { ...another, definitionId: 1002 }, { ...funds, perVersion: 1 });
    settleMarketWrite(state, 'second', { status: 'rejected', receipt: null });
    reserveMarketWrite(state, { ...another, id: 'third' }, { ...funds, perVersion: null });
    expect(marketOccupancy(state, 'A').count).toBe(2);
  });
  it('keeps receipts pending on conflicting identity, price or trade; successful recovery does not resume', () => {
    const state = emptyMarketCoordination(), entry = buy(); reserveMarketWrite(state, entry, funds);
    for (const extra of [{ itemId: '102' }, { definitionId: 1002 }, { tradeId: '502' }, { coins: 850 }]) {
      expect(() => settleMarketWrite(state, entry.id, { status: 'confirmed', receipt: { ...receipt(entry), ...extra } })).toThrow('MARKET_RECEIPT_CONFLICT');
    }
    settleMarketWrite(state, entry.id, { status: 'unknown', receipt: null });
    confirm(state, entry);
    expect(state.stopped).toBe('unknown-write');
    expect(nextMarketTask(state, ['A'])).toBeNull();
  });
  it('preserves paid history, rejects corrupt/new evidence and refuses capacity overflow without truncation', () => {
    const state = emptyMarketCoordination();
    expect(() => readMarketCoordination({ ...state, evidence: 'unknown' })).toThrow('MARKET_INVALID');
    expect(() => readMarketCoordination({ ...state, searches: Array(10001).fill({ id: 'a', at: 0, status: 'sent' }) })).toThrow('MARKET_STORAGE_LIMIT');
    expect(() => readMarketCoordination({ ...state, holdings: [{ taskId: 'A', itemId: '1', definitionId: 1, cost: null, phase: 'sold', listingTradeId: null, salePrice: 500 }] })).toThrow('MARKET_INVALID');
  });
  it('an unknown result cannot overwrite a global authentication stop', () => {
    const state = emptyMarketCoordination(); reserveMarketWrite(state, buy(), funds);
    state.stopped = 'authentication';
    settleMarketWrite(state, 'buy-1', { status: 'unknown', receipt: null });
    expect(state.stopped).toBe('authentication');
  });
});
