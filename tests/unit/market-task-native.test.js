import { describe, it, expect, vi } from 'vitest';
import { marketNativeRuntime } from '../helpers/market-native-runtime.js';
import { createFc27MarketTaskNative } from '../../src/adapters/browser/fc27-market-task-native.js';
import { createMarketTaskProvider } from '../../src/trading/market-task-provider.js';
import { defaultTradingTaskSettings, defaultTradingPublicSettings } from '../../src/trading/task-model.js';
import { emptyMarketCoordination, reserveMarketWrite, settleMarketWrite, claimMarketHolding, settleMarketSale, settleMarketUnsold } from '../../src/trading/market-coordination.js';
import { createMarketTaskScheduler } from '../../src/trading/market-task-scheduler.js';
import { createTradingTaskStore } from '../../src/adapters/browser/fc27-trading-task-store.js';
import { createMarketCoordinator } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { createMarketTaskCatalog } from '../../src/trading/market-task-catalog.js';

async function fixture(mode = 'fixed', extra = {}) {
  const f = marketNativeRuntime();
  const assertProtected = vi.fn(() => true), checkOtherTransactions = vi.fn(async () => {}), assertCurrent = vi.fn();
  const native = await createFc27MarketTaskNative({ ...f, assertProtected, assertCurrent, checkOtherTransactions, ...extra });
  const task = { id: 't', revision: 0, mode, players: [{ definitionId: 901, name: 'A', rating: 84, cap: null, qty: 2 }], owned: [], excluded: [],
    settings: { ...defaultTradingTaskSettings(), buyRule: 'fixed', buyValue: 800, sellRule: 'fixed', sellValue: 700 } };
  const settings = { ...defaultTradingPublicSettings(), perSearch: 2 }, context = { scope: 'test', season: '27', platform: 'console' };
  const loadQuotes = vi.fn(async () => { throw Error('unexpected public quote request'); });
  const catalog=createMarketTaskCatalog({context:()=>context,readRows:()=>[{definitionId:901,playerId:901,rating:84,rarity:0}]});
  let sequence = 0; const provider = createMarketTaskProvider({ native, context, loadQuotes, assertCurrent, catalog, now: f.now, id: () => `a${++sequence}` });
  const ledger = emptyMarketCoordination(), dispatched = [];
  const step = async () => {
    const action = await provider.prepare({ task, settings, ledger });
    if (['done', 'wait'].includes(action.kind)) return action;
    const preflight = await provider.preflight({ task, settings, action, ledger });
    expect(preflight.ready).toBe(true);
    if (action.kind === 'claim') claimMarketHolding(ledger, preflight.holding, preflight.holdingPhase);
    else if (action.kind === 'sales') for (const receipt of preflight.sales) {
      if (receipt.unsold) settleMarketUnsold(ledger, receipt); else settleMarketSale(ledger, receipt);
    }
    else {
      const requestId = `r${sequence}`;
      if (action.kind !== 'search') reserveMarketWrite(ledger, { id: requestId, taskId: task.id, kind: action.kind, itemId: action.itemId,
        definitionId: action.definitionId, tradeId: action.tradeId ?? null, coins: action.coins, at: f.now(), ...(action.listing ? { listing: action.listing } : {}),
        ...(action.previousTradeId ? { previousTradeId: action.previousTradeId } : {}) },
      { balance: preflight.balance, freeSlots: preflight.freeSlots, reserve: null, totalCap: null, taskCap: null, spendCap: null, perVersion: 2 });
      const response = await provider.send({ action, requestId, beforeDispatch: () => dispatched.push(action.kind) });
      if (action.kind !== 'search') settleMarketWrite(ledger, requestId, { status: response.status, receipt: response.receipt });
      await provider.accept({ action, response, ledger });
      return { action, response };
    }
    await provider.accept({ action, response: { status: 'observed' }, ledger });
    return { action };
  };
  return { ...f, native, provider, task, settings, ledger, step, dispatched, loadQuotes, assertProtected, checkOtherTransactions };
}

describe('native session maintenance', () => {
  it('records only successful native reads and cancels at the final health send boundary', async () => {
    const f = await fixture();
    expect(f.provider.sessionHealth()).toEqual({ lastOnlineAt: null });
    await f.native.verifySession();
    expect(f.provider.sessionHealth()).toEqual({ lastOnlineAt: f.now() });
    const last = f.now(); f.advance(180000);
    let active = true; f.hooks.session = async () => { active = false; };
    await expect(f.provider.maintainSession({ beforeDispatch: () => { if (!active) throw Error('stop'); } })).rejects.toThrow('SESSION_UNVERIFIED');
    expect(f.calls.filter(c => c[1] === 'session')).toHaveLength(0);
    expect(f.provider.sessionHealth()).toEqual({ lastOnlineAt: last });
    f.hooks.session = null; active = true;
    expect(await f.provider.maintainSession({ beforeDispatch: () => {} })).toEqual({ status: 'online', observedAt: f.now() });
    expect(f.calls.filter(c => c[1] === 'session')).toHaveLength(1);
    expect(f.calls.some(c => ['bid', 'move', 'list', 'search'].includes(c[0]))).toBe(false);
  });
  it('propagates authentication and EA restriction codes without exposing a reply', async () => {
    for (const [httpStatus, eaCode, code] of [[401, null, 401], [200, 459, 459], [429, null, 429]]) {
      const f = await fixture('fixed', { sessionReaderFactory: async () => ({ readSessionHealth: async () => {
        throw Object.assign(Error('private response'), { marketFailure: { httpStatus, eaCode } });
      } }) });
      await expect(f.native.maintainSession({ beforeDispatch: () => {} })).rejects.toMatchObject({ message: 'MARKET_SESSION_UNVERIFIED', code });
      expect(f.native.sessionHealth().lastOnlineAt).toBeNull();
    }
  });
});

describe('market task relisting with the production native port', () => {
  it.each(['original','reference'])('restarts a rating task and relists at %s price with the exact native entity',async relist=>{
    const f=await fixture('filter'),card=f.makeCard(101,901,'transfer');
    f.task.ratingPrices={84:{buy:800,sell:1400}};f.task.settings.relist=relist;
    claimMarketHolding(f.ledger,{taskId:'t',itemId:'101',definitionId:901,cost:600},'transfer');
    await f.provider.begin({task:f.task,settings:f.settings});await f.step();
    card.auction.tradeState='expired';card.auction.isSold=()=>false;await f.step();
    f.task.ratingPrices['84'].sell=1600;await f.provider.begin({task:f.task,settings:f.settings});
    const result=await f.step();expect(result.action.coins).toBe(relist==='original'?1400:1600);
    expect(result.response.status).toBe('confirmed');expect(f.ledger.holdings[0].cost).toBe(600);expect(f.loadQuotes).not.toHaveBeenCalled();
  });
  it('runs initial listing, fresh expiry, one relist and count exhaustion through the real scheduler and journals', async () => {
    const f = await fixture('sell'), data = new Map(), context = { scope: 'test', season: '27', platform: 'console' };
    f.task.owned = [{ itemId: '101', definitionId: 901, name: 'A', pile: 'transfer' }]; f.task.settings.relistTimes = 1;
    f.makeCard(101, 901, 'transfer');
    f.hooks.auctions = items => { for (const card of items) { card.auction.tradeState = 'expired'; card.auction.isSold = () => false; } };
    const get = async (key, fallback) => structuredClone(data.get(key) ?? fallback), set = async (key, value) => data.set(key, structuredClone(value));
    const locks = { request: async (name, _options, callback) => callback({ name, mode: 'exclusive' }) };
    const taskStore = createTradingTaskStore({ context: () => context, get, set, locks, id: () => 't', now: f.now });
    const coordinator = createMarketCoordinator({ context: () => context, get, set, locks });
    const { mode, settings, players, owned, excluded } = f.task;
    const snapshot = await taskStore.saveTask({ ...await taskStore.read(), input: { name: 'Relist', mode, settings, players, owned, excluded } });
    let serial = 0;
    const scheduler = createMarketTaskScheduler({ taskStore, coordinator, provider: f.provider, enabled: true, now: f.now,
      wait: f.sleep, id: () => `r${++serial}` });
    await scheduler.run({ approved: true, snapshot, taskIds: ['t'] });
    expect(scheduler.inspect().tasks[0]).toMatchObject({ state: 'paused', reason: 'MARKET_RELIST_PAUSED' });
    const ledger = (await coordinator.inspect()).ledger;
    expect(ledger.intents.map(i => [i.kind, i.phase, i.previousTradeId ?? null])).toEqual([
      ['list', 'confirmed', null], ['list', 'confirmed', '19101']]);
    expect(ledger.holdings[0].phase).toBe('unsold'); expect(ledger.clocks[0].elapsedMs).toBeGreaterThan(30000);
    expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(2); expect(f.calls.some(c => c[0] === 'bid')).toBe(false);
  });
  async function listed() {
    const f = await fixture('sell'); const card = f.makeCard(101, 901, 'transfer');
    f.task.owned = [{ itemId: '101', definitionId: 901, name: 'A', pile: 'transfer' }];
    await f.step(); await f.step();
    const expire = () => { card.auction.tradeState = 'expired'; card.auction.isSold = () => false; };
    return { ...f, card, expire };
  }
  it('reuses original start/buy/duration despite a changed rule, with a new trade ID and retained cost', async () => {
    const f = await listed(); f.task.settings.sellValue = 1000;
    f.expire(); await f.step(); expect(f.ledger.holdings[0].phase).toBe('unsold');
    const result = await f.step();
    expect(result.action).toMatchObject({ previousTradeId: '19101', coins: 700 });
    expect(result.response).toMatchObject({ status: 'confirmed', receipt: { tradeId: '19102' } });
    expect(f.calls.filter(c => c[0] === 'list').map(c => c.slice(2))).toEqual([[700, 700, 3600], [700, 700, 3600]]);
    expect(f.ledger.holdings[0]).toMatchObject({ cost: null, phase: 'listed', listingTradeId: '19102' });
    expect(f.loadQuotes).not.toHaveBeenCalled(); expect(f.calls.some(c => c[0] === 'bid')).toBe(false);
  });
  it('recomputes from the current independent sell rule and honors the persisted count', async () => {
    const f = await listed(); f.task.settings.relist = 'reference'; f.task.settings.relistTimes = 1; f.task.settings.sellValue = 900;
    f.expire(); await f.step(); const result = await f.step(); expect(result.action.coins).toBe(900);
    f.advance(31000); f.expire(); await f.step();
    expect((await f.step()).kind).toBe('done');
    expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(2);
  });
  it('uses fresh Both quotes for percentage relists and rejects missing references', async () => {
    const f = await listed(); f.task.settings.relist = 'reference'; f.task.settings.sellRule = 'reference';
    f.task.settings.sellValue = 100; f.settings.source = 'both';
    f.loadQuotes.mockImplementation(async () => ({ 901: Object.fromEntries([['futbin', 900], ['futgg', 800]].map(([source, price]) =>
      [source, { source, price, definitionId: 901, season: '27', platform: 'console', fetchedAt: f.now(), expiresAt: f.now() + 300000 }])) }));
    f.expire(); await f.step(); expect((await f.step()).action.coins).toBe(900);
    f.advance(31000); f.expire(); await f.step(); f.loadQuotes.mockResolvedValue({});
    await expect(f.step()).rejects.toThrow('REFERENCE_UNAVAILABLE');
    expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(2);
  });
  it.each([{ relist: 'pause', relistTimes: null }, { relist: 'original', relistTimes: 0 }])('does not relist disabled cards: %j', async settings => {
    const f = await listed(); Object.assign(f.task.settings, settings); f.expire(); await f.step();
    expect((await f.step()).kind).toBe('done'); expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(1);
  });
  it.each(['active', 'unknown-sold', 'bid', 'wrong-id', 'wrong-price'])('does not infer unsold from incomplete or contradictory evidence: %s', async reason => {
    const f = await listed(); f.expire();
    if (reason === 'active') f.card.auction.tradeState = 'active';
    if (reason === 'unknown-sold') delete f.card.auction.isSold;
    if (reason === 'bid') f.card.auction.currentBid = 700;
    if (reason === 'wrong-id') f.card.auction.tradeId++;
    if (reason === 'wrong-price') f.card.auction.buyNowPrice = 900;
    await f.step(); expect(f.ledger.holdings[0].phase).toBe('listed');
    expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(1);
  });
  it('keeps ambiguous relist pending when readback only contains the old trade ID', async () => {
    const f = await listed(); f.expire(); await f.step();
    f.hooks.list = card => { card.auction.tradeState = 'active'; return { success: true, status: 200 }; };
    const result = await f.step(); expect(result.response.status).toBe('unknown');
    expect(f.ledger.intents.at(-1).phase).toBe('pending');
    expect((await f.native.reconcile(f.ledger.intents.at(-1))).status).toBe('unknown');
  });
  it('does not retry a definite relist rejection against the same old auction', async () => {
    const f = await listed(); f.expire(); await f.step();
    f.hooks.list = () => ({ success: false, status: 400 });
    expect((await f.step()).response.status).toBe('rejected');
    expect((await f.step()).kind).toBe('done'); expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(2);
  });
});

describe('market task native port with synthetic EA services', () => {
  it('runs the real task scheduler/store/coordinator/provider/native adapter through a complete bought-to-sold lifecycle', async () => {
    const f = await fixture(), data = new Map(), context = { scope: 'test', season: '27', platform: 'console' };
    const get = async (key, fallback) => structuredClone(data.get(key) ?? fallback);
    const set = async (key, value) => data.set(key, structuredClone(value));
    const locks = { request: async (name, _options, callback) => callback({ name, mode: 'exclusive' }) };
    const taskStore = createTradingTaskStore({ context: () => context, get, set, locks, id: () => 't', now: f.now });
    const coordinator = createMarketCoordinator({ context: () => context, get, set, locks });
    const { mode, settings, players, owned, excluded } = f.task;
    const snapshot = await taskStore.saveTask({ ...await taskStore.read(), input: { name: 'Synthetic', mode, settings, players, owned, excluded } });
    const card = f.makeCard(101, 901); f.hooks.auctions = () => { card.auction.isSold = () => true; card.auction.currentBid = 700; };
    let complete = false, serial = 0;
    const scheduler = createMarketTaskScheduler({ taskStore, coordinator, provider: f.provider, enabled: true, now: f.now,
      wait: f.sleep, random: () => 0, id: () => `r${++serial}`, onStatus: state => {
        if (!complete && state.evidence.some(e => e.counts[2] === 1)) { complete = true; scheduler.pauseAll(); }
      } });
    await scheduler.run({ approved: true, snapshot, taskIds: ['t'] });
    expect(complete).toBe(true);
    const ledger = (await coordinator.inspect()).ledger;
    expect(ledger.intents.map(i => [i.kind, i.phase])).toEqual([['buy', 'confirmed'], ['move', 'confirmed'], ['list', 'confirmed']]);
    expect(ledger.holdings[0]).toMatchObject({ phase: 'sold', cost: 600, salePrice: 700, listingTradeId: '19101' });
    expect(ledger.searches.map(s => s.status)).toEqual(['sent']);
    const count = f.calls.length; await scheduler.recover(); expect(f.calls.length).toBe(count);
  });
  it('searches once for two offers and keeps independent losing sell prices and actual costs through exact reads', async () => {
    const f = await fixture(); const a = f.makeCard(101, 901, 'market', 600), b = f.makeCard(102, 901, 'market', 650);
    expect(f.calls).toEqual([]);
    await f.step(); await f.step(); await f.step(); await f.step();
    // Initial read of active listings, then second saved offer without another search.
    await f.step(); await f.step(); await f.step(); await f.step();
    expect(f.ledger.holdings.map(h => [h.itemId, h.phase, h.cost])).toEqual([['101', 'listed', 600], ['102', 'listed', 650]]);
    expect(f.calls.filter(c => c[0] === 'search')).toEqual([['search', 901, 800]]);
    expect(f.calls.filter(c => c[0] === 'list')).toEqual([['list', 101, 700, 700, 3600], ['list', 102, 700, 700, 3600]]);
    for (const item of [a, b]) item.auction = { ...item.auction, tradeState: 'closed', currentBid: 700, isSold: () => true };
    f.advance(30000); await f.step();
    expect(f.ledger.holdings.map(h => h.salePrice)).toEqual([700, 700]); expect(f.loadQuotes).not.toHaveBeenCalled();
    expect(f.dispatched).toEqual(['search', 'buy', 'buy', 'move', 'list', 'move', 'list']);
  });
  it.each(['club', 'transfer', 'unassigned'])('imports exact selected %s holdings without fabricating a purchase', async pile => {
    const f = await fixture('sell'); const card = f.makeCard(201, 901, pile); card.purchasePrice = 800;
    f.task.owned = [{ itemId: '201', definitionId: 901, name: 'Owned', pile }];
    await f.step(); if (pile !== 'transfer') await f.step(); await f.step();
    expect(f.ledger.holdings[0]).toMatchObject({ itemId: '201', phase: 'listed', cost: 800 });
    expect(f.ledger.intents.some(i => i.kind === 'buy')).toBe(false);
    expect(f.calls.filter(c => ['bid', 'search'].includes(c[0]))).toEqual([]);
    expect(f.calls.filter(c => c[0] === 'move')).toHaveLength(pile === 'transfer' ? 0 : 1);
  });
  it('unknown purchase cost remains null and does not change an independent fixed sale', async () => {
    const f = await fixture('sell'); f.makeCard(201, 901, 'transfer');
    f.task.owned = [{ itemId: '201', definitionId: 901, name: 'Owned', pile: 'transfer' }];
    await f.step(); await f.step(); expect(f.ledger.holdings[0].cost).toBeNull();
    expect(f.calls.filter(c => c[0] === 'list')[0][3]).toBe(700);
  });
  it('does not import active, protected or incorrectly identified holdings', async () => {
    const f = await fixture('sell'); f.makeCard(201, 901, 'transfer');
    f.task.owned = [{ itemId: '201', definitionId: 901, name: 'Owned', pile: 'transfer' }];
    f.assertProtected.mockReturnValue(false); await expect(f.step()).rejects.toThrow('MARKET_HOLDING_PROTECTED');
    expect(f.ledger.holdings).toEqual([]); expect(f.dispatched).toEqual([]);
  });
  it('rejects active or wrong-version imports without moving or claiming them', async () => {
    const f = await fixture('sell'); const card = f.makeCard(201, 901, 'transfer');
    f.task.owned = [{ itemId: '201', definitionId: 901, name: 'Owned', pile: 'transfer' }];
    card.auction.tradeState = 'active'; await expect(f.step()).rejects.toThrow('MARKET_HOLDING_PROTECTED');
    card.definitionId = 902; await expect(f.step()).rejects.toThrow('MARKET_HOLDING_UNAVAILABLE');
    expect(f.ledger.holdings).toEqual([]); expect(f.dispatched).toEqual([]);
  });
  it('a removed or expired market offer is never sent to native bid', async () => {
    const f = await fixture(); const card = f.makeCard(101, 901); await f.step();
    card.auction.getSecondsRemaining = () => 0;
    const result = await f.step(); expect(result.response.status).toBe('rejected');
    expect(f.calls.filter(c => c[0] === 'bid')).toEqual([]);
  });
  it('rechecks protection at the final native call after waiting for pacing', async () => {
    const f = await fixture('sell'); f.makeCard(201, 901, 'transfer');
    f.task.owned = [{ itemId: '201', definitionId: 901, name: 'Owned', pile: 'transfer' }]; await f.step();
    const action = await f.provider.prepare({ task: f.task, settings: f.settings, ledger: f.ledger });
    await f.provider.preflight({ task: f.task, settings: f.settings, action, ledger: f.ledger });
    f.hooks.sleep = () => f.assertProtected.mockReturnValue(false);
    const boundary = vi.fn(); const result = await f.provider.send({ action, requestId: 'r', beforeDispatch: boundary });
    expect(result.status).toBe('rejected'); expect(boundary).not.toHaveBeenCalled();
    expect(f.calls.filter(c => c[0] === 'list')).toEqual([]);
  });
  it.each([401, 429, 461])('keeps native negative code %s and removes the losing offer instead of rebidding', async status => {
    const f = await fixture(); f.makeCard(101, 901); f.hooks.bid = () => ({ success: false, status, data: { itemIds: [] } });
    await f.step(); const result = await f.step();
    expect(result.response).toMatchObject({ status: 'rejected', code: status });
    expect(f.ledger.intents[0].phase).toBe('rejected');
    const next = await f.provider.prepare({ task: f.task, settings: f.settings, ledger: f.ledger }); expect(next.kind).toBe('search');
  });
  it.each(['throw', 'reject'])('diagnostic %s cannot change a bid or its exact receipt', async failure => {
    const onDiagnostic = () => { if (failure === 'throw') throw Error('log failure'); return Promise.reject(Error('log failure')); };
    const f = await fixture('fixed', { onDiagnostic }); f.makeCard(101, 901);
    await f.step(); const result = await f.step();
    expect(result.response.status).toBe('confirmed');
    expect(f.ledger.holdings[0]).toMatchObject({ itemId: '101', cost: 600, phase: 'held' });
    expect(f.calls.filter(c => c[0] === 'bid')).toEqual([['bid', 101, 600]]);
  });
  it('does not treat a contradictory failed buy response as proof of no payment', async () => {
    const f = await fixture(); f.makeCard(101, 901); f.hooks.bid = () => ({ success: false, status: 461, data: { itemIds: [101] } });
    await f.step(); const result = await f.step(); expect(result.response.status).toBe('unknown');
    expect(f.ledger.intents[0].phase).toBe('pending'); const writes = f.dispatched.length;
    await f.provider.reconcile(f.ledger.intents[0]); expect(f.dispatched.length).toBe(writes);
  });
  it('a cached 304 cannot confirm an unknown mutation', async () => {
    const f = await fixture(); f.makeCard(101, 901, 'unassigned').purchasePrice = 600; f.hooks.readStatus = 304;
    const result = await f.native.reconcile({ kind: 'move', itemId: '101', definitionId: 901, coins: 0 });
    expect(result.status).toBe('unknown');
  });
  it('keeps frozen listing terms for recovery rather than using edited task settings', async () => {
    const f = await fixture(); const card = f.makeCard(101, 901); await f.step(); await f.step(); await f.step(); await f.step();
    const intent = f.ledger.intents.at(-1); f.task.settings.sellValue = 5000;
    expect((await f.native.reconcile(intent)).status).toBe('confirmed');
    card.auction.startingBid = 5000; expect((await f.native.reconcile(intent)).status).toBe('unknown');
  });
  it('needs a durable positive acknowledgement for a closed listing, and still does not call it sold', async () => {
    const f = await fixture(); const card = f.makeCard(101, 901); await f.step(); await f.step(); await f.step(); await f.step();
    card.auction.tradeState = 'closed';
    const intent = f.ledger.intents.at(-1);
    expect((await f.native.reconcile(intent)).status).toBe('unknown');
    expect(await f.native.reconcile({ ...intent, acknowledged: true })).toMatchObject({ status: 'confirmed', receipt: { tradeId: '19101' } });
    expect(f.ledger.holdings[0].phase).toBe('listed'); expect(f.ledger.holdings[0].salePrice).toBeNull();
  });
  it('rejects impossible sold amounts and leaves unproven sale evidence unchanged', async () => {
    const f = await fixture(); const card = f.makeCard(101, 901); await f.step(); await f.step(); await f.step(); await f.step();
    card.auction.isSold = () => true; card.auction.currentBid = 200;
    await expect(f.step()).rejects.toThrow('MARKET_RECEIPT_CONFLICT');
    expect(f.ledger.holdings[0].phase).toBe('listed'); expect(f.ledger.holdings[0].salePrice).toBeNull();
  });
});
