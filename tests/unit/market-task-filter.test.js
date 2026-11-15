import { describe, it, expect, vi } from 'vitest';
import { createMarketTaskCatalog } from '../../src/trading/market-task-catalog.js';
import { createMarketTaskProvider } from '../../src/trading/market-task-provider.js';
import { emptyMarketCoordination, claimMarketHolding } from '../../src/trading/market-coordination.js';
import { defaultTradingTaskSettings, defaultTradingPublicSettings } from '../../src/trading/task-model.js';

const tiers = [{ min: 100000, inc: 1000 }, { min: 50000, inc: 500 }, { min: 10000, inc: 250 }, { min: 1000, inc: 100 }, { min: 0, inc: 50 }];
async function fixture() {
  let rows = Array.from({ length: 55 }, (_, i) => ({ definitionId: i + 1, playerId: i + 1, name: `Card ${i + 1}`, rating: 84, rarity: 1 })), current = true, time = 1000000, serial = 0;
  const context = { scope: 'A', season: '27', platform: 'console' }, task = { id: 't', mode: 'filter',
    settings: { ...defaultTradingTaskSettings(), buyValue: 100 }, players: [{ definitionId: 1, cap: 150, qty: 1 }], owned: [], excluded: [] };
  const settings = defaultTradingPublicSettings(), ledger = emptyMarketCoordination();
  const native = { priceTiers: () => tiers, preflight: vi.fn(async () => ({ ready: true })), send: vi.fn(async ({ beforeDispatch }) => { beforeDispatch(); return { status: 'confirmed', sent: true, offers: [] }; }) };
  const loadQuotes = vi.fn(async ids => Object.fromEntries(ids.map(id => [id, { futbin: { definitionId: id, source: 'futbin', price: 800,
    season: '27', platform: 'console', fetchedAt: time, expiresAt: time + 300000 } }])));
  const catalog = createMarketTaskCatalog({ readRows: () => rows, context: () => context, yieldControl: async () => {} });
  const provider = createMarketTaskProvider({ context, native, loadQuotes, catalog, assertCurrent() {}, now: () => time, id: () => `p${++serial}` });
  const begin = () => provider.begin({ task, settings, isCurrent: () => current });
  const prepare = () => provider.prepare({ task, settings, ledger });
  await begin();
  return { task, settings, ledger, native, provider, loadQuotes, begin, prepare, advance: n => { time += n; },
    replace: value => { rows = value; }, cancel: () => { current = false; } };
}

describe('bounded filter execution on frozen public definitions', () => {
  it('holds transfer and unsold cards while selecting buy-only rating rows, then requires sell prices when listing is enabled',async()=>{
    const f=await fixture();f.task.settings.afterBuy='hold';f.task.ratingPrices={84:{buy:1100,sell:null}};
    claimMarketHolding(f.ledger,{taskId:'t',itemId:'held',definitionId:2,cost:600});f.ledger.holdings[0].phase='transfer';
    await f.begin();expect(await f.prepare()).toMatchObject({kind:'search',maxBuy:1100});expect(f.loadQuotes).not.toHaveBeenCalled();
    f.ledger.holdings[0].phase='unsold';f.ledger.holdings[0].listingTradeId='old-list';
    await f.begin();expect(await f.prepare()).toMatchObject({kind:'search'});
    f.ledger.holdings[0].phase='transfer';f.task.settings.afterBuy='list';await f.begin();
    await expect(f.prepare()).rejects.toThrow('RATING_PRICE_UNAVAILABLE');
    f.task.ratingPrices[84].sell=1400;await f.begin();expect(await f.prepare()).toMatchObject({kind:'list',coins:1400,itemId:'held'});
  });
  it('skips incomplete rating rows and sells held cards with the same rating rule after restart without quotes',async()=>{
    const f=await fixture();f.task.ratingPrices={83:{buy:null,sell:1000},84:{buy:1100,sell:1400}};
    f.replace([{definitionId:1,playerId:1,rating:83,rarity:1},{definitionId:2,playerId:2,rating:84,rarity:1}]);f.task.settings.ratingMin=83;f.task.settings.ratingMax=84;await f.begin();
    expect(await f.prepare()).toMatchObject({kind:'search',definitionId:2,maxBuy:1100,rating:84});
    claimMarketHolding(f.ledger,{taskId:'t',itemId:'held',definitionId:2,cost:600});f.ledger.holdings[0].phase='transfer';await f.begin();
    const list=await f.prepare();expect(list).toMatchObject({kind:'list',coins:1400,rating:84});
    await f.provider.preflight({task:f.task,settings:f.settings,action:list,ledger:f.ledger});expect(f.loadQuotes).not.toHaveBeenCalled();
  });
  it('quotes only one 20-card page and continues the frozen directory without repeating prior searches', async () => {
    const f = await fixture();
    for (let i = 1; i <= 21; i++) {
      const action = await f.prepare(); expect(action).toMatchObject({ kind: 'search', definitionId: i, maxBuy: 800 });
      await f.provider.preflight({ task: f.task, settings: f.settings, action, ledger: f.ledger });
      await f.provider.accept({ action, response: { sent: true, status: 'confirmed', offers: [] }, ledger: f.ledger });
    }
    expect(f.loadQuotes.mock.calls.map(call => call[0])).toEqual([Array.from({ length: 20 }, (_, i) => i + 1), Array.from({ length: 20 }, (_, i) => i + 21)]);
    expect(f.provider.describe('t')).toMatchObject({ known: 55, matched: 40, batch: 20, complete: false });
  });
  it('fixed-price filter ignores leftover fixed-list overrides and performs no price requests', async () => {
    const f = await fixture(); f.task.settings.buyRule = 'fixed'; f.task.settings.buyValue = 700; await f.begin();
    expect(await f.prepare()).toMatchObject({ definitionId: 1, maxBuy: 700 }); expect(f.loadQuotes).not.toHaveBeenCalled();
  });
  it('shares exclusions, skips unknown player identities and skips full per-version occupancy before quoting', async () => {
    const f = await fixture(); f.task.excluded = [{ type: 'player', id: 1 }, { type: 'version', id: 2 }]; f.task.settings.perVersion = 1;
    claimMarketHolding(f.ledger, { taskId: 't', itemId: 'owned', definitionId: 3, cost: 700 });
    Object.assign(f.ledger.holdings[0], { phase: 'unsold', listingTradeId: 'old' }); f.task.settings.relist = 'pause'; await f.begin();
    expect((await f.prepare()).definitionId).toBe(4);
    for (const id of [1, 2, 3]) expect(f.loadQuotes.mock.calls[0][0]).not.toContain(id);
  });
  it('retains offers from the last version of a page and enforces the cap between purchases', async () => {
    const f = await fixture(); f.task.settings.perVersion = 1; f.task.settings.relist = 'pause'; await f.begin();
    for (let i = 1; i < 20; i++) { const action = await f.prepare(); await f.provider.accept({ action, response: { sent: true, status: 'confirmed', offers: [] }, ledger: f.ledger }); }
    const action = await f.prepare(); await f.provider.accept({ action, response: { sent: true, status: 'confirmed', offers: [{ itemId: '100', definitionId: 20, tradeId: '900', coins: 700 }] }, ledger: f.ledger });
    expect(await f.prepare()).toMatchObject({ kind: 'buy', definitionId: 20 });
    claimMarketHolding(f.ledger, { taskId: 't', itemId: 'other-copy', definitionId: 20, cost: 700 });
    // Held purchases finish before new procurement; once sold, page progress continues.
    f.ledger.holdings[0].phase = 'unsold'; f.ledger.holdings[0].listingTradeId = 'old';
    expect(await f.prepare()).toMatchObject({ kind: 'search', definitionId: 21 });
  });
  it('does not silently expand a running scope; a new explicit start observes equal-length metadata changes', async () => {
    const f = await fixture(), before = f.provider.describe('t').revision;
    f.replace([{ definitionId: 100, name: 'New', rating: 90, rarity: 1 }]);
    expect((await f.prepare()).definitionId).toBe(1); await f.begin();
    expect(f.provider.describe('t').revision).not.toBe(before);
    await expect(f.prepare()).rejects.toThrow('CATALOG_EMPTY');
  });
  it('skips missing individual prices, but pauses if a whole eligible batch lacks references', async () => {
    const f = await fixture(), original = f.loadQuotes.getMockImplementation();
    f.loadQuotes.mockImplementation(async ids => { const quotes = await original(ids); delete quotes[1]; return quotes; });
    expect((await f.prepare()).definitionId).toBe(2); expect(f.provider.describe('t').missing).toBe(1);
    f.loadQuotes.mockResolvedValue({}); await f.begin(); await expect(f.prepare()).rejects.toThrow('REFERENCE_UNAVAILABLE');
    expect(f.native.send).not.toHaveBeenCalled();
  });
  it('cancels during batch pricing and immediately before native dispatch', async () => {
    const f = await fixture(); f.loadQuotes.mockImplementation(async () => { f.cancel(); return {}; });
    await expect(f.prepare()).rejects.toThrow('USER_STOP');
    const g = await fixture(), action = await g.prepare(); g.cancel();
    await expect(g.provider.send({ action, beforeDispatch: () => { throw Error('must not dispatch'); } })).rejects.toThrow('CANDIDATE_CHANGED');
  });
});
