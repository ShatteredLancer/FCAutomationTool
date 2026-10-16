import { expect, it, vi } from 'vitest';
import { createFc27PuzzleBuyAdapter } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { createPurchasePriceApproval } from '../../src/fc27/purchase-price-approval.js';
import { priceTiers } from '../fixtures/enhancer-listing-price-reference.js';
import { createStreamlinedProcurement } from '../../src/streamlined/procurement.js';
import { createStreamlinedPurchaseJournal } from '../../src/streamlined/purchase-journal.js';
import { createFc27PuzzleBuySession } from '../../src/fc27/puzzle-buy-session.js';
import ceilingCase from '../fixtures/fc27-purchase-ceiling-2026-10-16.json';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';
vi.mock('../../src/adapters/ea/fc27-transaction-transport.js', () => ({ verifyFc27Methods: async () => () => {} }));
vi.mock('../../src/adapters/ea/fc27-local-read.js', () => ({ readFc27Context: () => ({ season: '27', accountScope: 'account', platform: 'pc' }) }));
async function fixture({ premium = 0, excludeOffer = null, quotePrice = 200, filterByCap = false, onEvent = () => {} } = {}) {
  const state = { prices: [600,500], coins: 10000, time: 1000, bids: [], searches: [] };
  const quote = (source, price) => ({ schema: 2, source, definitionId: 10, season: '27', platform: 'pc', price,
    fetchedAt: 900, sourceUpdatedAt: null, expiresAt: 300900, error: null });
  const reference = { definitionId: 10, season: '27', platform: 'pc', quotes: { futgg: quote('futgg', quotePrice), futbin: quote('futbin', 250) } };
  const record = { scope: 'account', entries: [{ definitionId: 10 }], priceApproval: createPurchasePriceApproval({ scope: 'account',
    season: '27', platform: 'pc', policy: { premium }, definitionIds: [10], references: { 10: reference }, now: 1000 }) };
  const cards = new Map();
  const observable = value => ({ observe(_owner, notify) { notify(null, value); }, unobserve() {} });
  class ItemService {
    clearTransferMarketCache() {}
    requestUnassignedItems() {}
    searchTransferMarket(criteria) {
      state.searches.push(criteria.maxBuy);
      const items = state.prices.filter(price => !filterByCap || price <= criteria.maxBuy).map((price, i) => {
        const auction = { buyNowPrice: price, tradeId: String(1000 + i), canBuy: coins => price <= coins, getSecondsRemaining: () => 60 };
        const item = { definitionId: 10, id: 100 + i, getAuctionData: () => auction };
        cards.set(item.id, item); return item;
      });
      return observable({ success: true, data: { items } });
    }
    bid(item, price) { state.bids.push(price); return observable({ success: true, data: { itemIds: [item.id] } }); }
    move() {}
  }
  const root = { services: { Item: new ItemService(), User: { getUser: () => ({ getCurrency: () => ({ amount: state.coins }) }) }, PIN: { sendData() {} } },
    repositories: { Item: { numItemsInCache: () => 0 } }, MAX_NEW_ITEMS: 100,
    ItemPile: { CLUB: 7, PURCHASED: 6 }, GameCurrency: { COINS: 'COINS' }, PINEventType: { PAGE_VIEW: 1 }, PIN_PAGEVIEW_EVT_TYPE: 1,
    SearchType: { PLAYER: 'player' }, SearchCategory: { ANY: 'any' }, ItemSearchFeature: { MARKET: 'market' },
    UTCurrencyInputControl: { PRICE_TIERS: priceTiers, getIncrementAboveVal: n => n + 50, getIncrementBelowVal: n => n - 50 },
    UTSearchCriteriaDTO: class {}, UTBucketedItemSearchViewModel: class {
      defaultSearchCriteria = {};
      updateSearchCriteria(criteria) { this.searchCriteria = { ...criteria }; }
    } };
  const details = { _rating: 80, nationId: 1, teamId: 1, leagueId: 1, preferredPosition: 1 };
  const adapter = await createFc27PuzzleBuyAdapter(root, { canWrite: () => true, verifyCurrent: () => {},
    playerDetails: new Map([[10, details]]), referencePrice: () => quotePrice, now: () => state.time, wait: async () => {}, excludeOffer, onEvent });
  await adapter.verifySquad(record);
  return { state, record, adapter, root, cards, details, reference };
}

it.each(ceilingCase.retryCaps)('selects and bids 650 under an explicitly approved %i retry ceiling', async cap => {
  const events = [];
  const f = await fixture({ quotePrice: 350, filterByCap: true, onEvent: row => events.push(row) });
  f.state.prices = ceilingCase.offerPrices;
  f.record.priceOverrides = { 10: createPurchasePriceApproval({ scope: 'account', season: '27', platform: 'pc',
    policy: { source: 'futgg' }, definitionIds: [10], references: { 10: f.reference }, overrides: { 10: cap }, now: 1000 }) };
  const found = await f.adapter.find(10, cap);
  expect(found).toMatchObject({ definitionId: 10, price: 650 });
  expect(f.state.searches).toEqual(cap === 650 ? [350,400,500,550,650] : [350,450,550,650]);
  expect(await f.adapter.buy(found)).toMatchObject({ status: 'bought', price: 650 });
  expect(f.state.bids).toEqual([650]);
  expect(events).toContainEqual(expect.objectContaining({ stage: 'search', maxBuy: 650, attempt: cap === 650 ? 5 : 4,
    attemptLimit: 5, searchCeiling: cap, referencePrice: 350 }));
});

it('intersects a retry ceiling with native limits before the final search', async () => {
  const f = await fixture({ quotePrice: 350, premium: 450, filterByCap: true });
  f.state.prices = [650]; f.details._itemPriceLimits = { minimum: 150, maximum: 600 };
  expect(await f.adapter.find(10, 800)).toBeNull();
  expect(f.state.searches).toEqual([350,400,450,500,600]);
  expect(f.state.bids).toEqual([]);
});

it('keeps a no-approval legacy price walk unchanged even with a larger external cap', async () => {
  const f = await fixture({ quotePrice: 350, filterByCap: true });
  f.state.prices = [650]; delete f.record.priceApproval;
  expect(await f.adapter.find(10, 800)).toBeNull();
  expect(f.state.searches).toEqual([350,400,450,500,550]);
});

it('exports bounded price-search evidence without raw auction identities', async () => {
  const store = new Map();
  const log = createFcatDiagnosticLog({ gmGetValue: (key, fallback) => store.get(key) ?? fallback,
    gmSetValue: (key, value) => store.set(key, value) });
  const events = [];
  const f = await fixture({ quotePrice: 350, filterByCap: true, onEvent: row => events.push(row) });
  f.state.prices = [650];
  f.record.priceOverrides = { 10: createPurchasePriceApproval({ scope: 'account', season: '27', platform: 'pc',
    policy: { source: 'futgg' }, definitionIds: [10], references: { 10: f.reference }, overrides: { 10: 800 }, now: 1000 }) };
  await f.adapter.find(10, 800);
  for (const event of events.filter(row => row.stage === 'search')) {
    await log.record({ area: 'puzzle', event: 'buy-search', phase: 'market-query', ...event });
  }
  const exported = await log.exportPayload();
  expect(exported.criticalEntries).toContainEqual(expect.objectContaining({ area: 'puzzle', event: 'buy-search',
    referencePrice: 350, searchCeiling: 800, maxBuy: 650, attempt: 4, attemptLimit: 5 }));
  expect(JSON.stringify(exported)).not.toMatch(/tradeId|itemId|1000/);
});

it('retains the failed journal, applies one explicit retry, and never rebuys its confirmed receipt', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const f = await fixture({ quotePrice: 350, filterByCap: true }); f.state.prices = [800,650];
    const data = new Map(), target = { setId: 1, challengeId: 2 };
    const context = { season: '27', accountScope: 'account', platform: 'pc' };
    const draft = { phase: 'saved', operationId: 'cap-replay', plan: { context, kind: 'native-concept-purchase',
      slots: [{ slot: 0, kind: 'concept', definitionId: 10 }], purchases: [{ definitionId: 10 }], purchaseCount: 1 } };
    const session = createFc27PuzzleBuySession({ scope: 'account', context,
      get: async (key, fallback) => structuredClone(data.get(key) ?? fallback),
      set: async (key, value) => data.set(key, structuredClone(value)), exclusive: async (_scope, task) => task(),
      loadDraft: async () => draft, assertCurrent: () => {}, preparePrices: async () => f.record.priceApproval,
      createAdapter: async () => ({ ...f.adapter, move: async () => {}, locate: async () => 'club', save: async () => {}, cancel: () => {} }) });
    const approval = { approved: true, budget: 10000, expectedOperationId: 'cap-replay' };
    const first = await session.execute(target, approval);
    expect(first).toMatchObject({ status: 'partial', purchased: 0, reason: 'FC27_BUY_NO_LISTING' });
    f.state.searches.length = 0;
    const retry = { ...first.retryContext, items: [{ definitionId: 10, maxBuy: 800 }],
      references: { 10: f.reference }, policy: first.retryContext.policy };
    expect(await session.execute(target, { ...approval, retry })).toMatchObject({ status: 'purchased', purchased: 1, spent: 650 });
    expect(f.state.searches).toEqual([350,450,550,650]);
    expect(await session.execute(target, approval)).toMatchObject({ status: 'purchased', purchased: 1, spent: 650 });
    expect(f.state.bids).toEqual([650]);
  } finally { clock.mockRestore(); }
});
it('filters every over-cap returned offer and never bids on the cheapest 500 when approved for 200', async () => {
  const f = await fixture(); expect(await f.adapter.find(10, 200)).toBeNull();
  expect(f.state.searches).toEqual([200]); expect(f.state.bids).toEqual([]);
});
it('buys the lowest eligible offer and rechecks the frozen cap at dispatch', async () => {
  const f = await fixture(); f.state.prices = [600,200,150];
  const found = await f.adapter.find(10, 200);
  expect(found.price).toBe(150); expect(await f.adapter.buy(found)).toMatchObject({ status: 'bought', price: 150 });
  expect(f.state.bids).toEqual([150]);
});
it('allows an opt-in owner to exclude a settled stale auction before choosing the cheapest fresh offer', async () => {
  const excludeOffer = vi.fn((offer, record) => record.settledTrades.includes(offer.tradeId));
  const f = await fixture({ excludeOffer }); f.state.prices = [150, 200]; f.record.settledTrades = ['1000'];
  const offer = await f.adapter.find(10, 200);
  expect(offer).toMatchObject({ itemId: 101, tradeId: '1001', price: 200 });
  expect(excludeOffer).toHaveBeenCalledWith(expect.objectContaining({ itemId: 100, tradeId: '1000' }), f.record);
  expect(await f.adapter.buy(offer)).toMatchObject({ status: 'bought', price: 200 });
  expect(f.state.bids).toEqual([200]);
});
it('returns no supply without a bid when every native auction is excluded', async () => {
  const f = await fixture({ excludeOffer: () => true }); f.state.prices = [150, 200];
  expect(await f.adapter.find(10, 200)).toBeNull(); expect(f.state.bids).toEqual([]);
});
it('completes eight real native search/bid waves while old consumed listings remain in every response', async () => {
  const excludeOffer = (offer, record) => record.entries.some(entry => entry.state === 'consumed'
    && (entry.itemId === offer.itemId || entry.tradeId === offer.tradeId));
  const f = await fixture({ excludeOffer }); f.state.prices = [150];
  const market = { source: 'market', definitionId: 10, id: null, points: 20, price: 200, purchaseMaxBuy: 200 };
  const plan = { context: { schema: 1, season: '27', accountScope: 'account', platform: 'pc' },
    challenge: { id: 1, setId: 2, targetScore: 160, submittedScore: 0, selectionLimit: 30 }, policy: {},
    route: { groups: [{ source: 'market', quantity: 8, item: market, items: [market] }] } };
  const values = new Map(), journal = createStreamlinedPurchaseJournal({
    get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => values.set(key, structuredClone(value)) });
  let score = 0;
  const adapter = { assertCurrent: record => f.adapter.verifySquad(record),
    readState: async record => ({ submittedScore: record.submittedScore, freeSlots: 30, heldDefinitions: [] }),
    find: (card, cap) => f.adapter.find(card.definitionId, cap), buy: entry => f.adapter.buy(entry),
    move: async () => ({ status: 'bought' }), locate: async () => 'club',
    materialize: async entries => entries.map(entry => ({ item: { ...market, id: entry.itemId }, groupIndex: 0 })),
    prepareContribution: async material => ({ material }),
    contribute: async batch => { score += batch.material.length * 20;
      f.state.prices = [...f.state.prices.map(() => 150), 200]; return { confirmed: true, submittedScore: score }; },
  };
  const result = await createStreamlinedProcurement({ adapter, journal, operationId: () => 'offline',
    lock: { acquire: async () => () => {} }, now: () => 1000 }).execute(plan,
    { approved: true, fingerprint: JSON.stringify(plan), budget: 2000, attempts: 2, expiresAt: 10000 });
  expect(result).toMatchObject({ status: 'completed', record: { spent: 1550, submittedScore: 160 } });
  expect(result.record.consumedIds).toEqual([100, 101, 102, 103, 104, 105, 106, 107]);
  expect(f.state.bids).toEqual([150, 200, 200, 200, 200, 200, 200, 200]);
  expect(f.state.searches).toEqual(Array(8).fill(200));
});
it('floors a 275 approval to a 250 search cap and cannot walk above it', async () => {
  const f = await fixture({ premium: 75 }); f.state.prices = [];
  expect(await f.adapter.find(10, 275)).toBeNull(); expect(f.state.searches).toEqual([200,250]);
});
it('rejects an expired public quote before search or a quote that expires before dispatch', async () => {
  const f = await fixture(); f.state.prices = [200];
  const found = await f.adapter.find(10, 200); f.state.time = 400000;
  expect(await f.adapter.buy(found)).toMatchObject({ status: 'rejected', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED' });
  expect(await f.adapter.find(10, 200)).toMatchObject({ unavailable: true, reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED' });
  expect(f.state.searches).toHaveLength(1); expect(f.state.bids).toEqual([]);
});
it('intersects native price limits and balance without raising the approved cap', async () => {
  const f = await fixture(); f.details._itemPriceLimits = { minimum: 150, maximum: 150 }; f.state.prices = [200,150];
  const found = await f.adapter.find(10, 200); expect(found.price).toBe(150); expect(f.state.searches).toEqual([150]);
  f.state.coins = 149; expect((await f.adapter.buy(found)).status).toBe('rejected'); expect(f.state.bids).toEqual([]);
});
it('does not accept a fabricated auction that was never found under an approved cap', async () => {
  const f = await fixture();
  expect((await f.adapter.buy({ definitionId: 10, itemId: 100, tradeId: '1000', price: 200 })).status).toBe('rejected');
  expect(f.state.bids).toEqual([]);
});