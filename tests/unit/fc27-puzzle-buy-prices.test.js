import { expect, it, vi } from 'vitest';
import { createFc27PuzzleBuyAdapter } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { createPurchasePriceApproval } from '../../src/fc27/purchase-price-approval.js';
import { priceTiers } from '../fixtures/enhancer-listing-price-reference.js';
vi.mock('../../src/adapters/ea/fc27-transaction-transport.js', () => ({ verifyFc27Methods: async () => () => {} }));
vi.mock('../../src/adapters/ea/fc27-local-read.js', () => ({ readFc27Context: () => ({ season: '27', accountScope: 'account', platform: 'pc' }) }));
async function fixture({ premium = 0 } = {}) {
  const state = { prices: [600,500], coins: 10000, time: 1000, bids: [], searches: [] };
  const quote = (source, price) => ({ schema: 2, source, definitionId: 10, season: '27', platform: 'pc', price,
    fetchedAt: 900, sourceUpdatedAt: null, expiresAt: 300900, error: null });
  const reference = { definitionId: 10, season: '27', platform: 'pc', quotes: { futgg: quote('futgg', 200), futbin: quote('futbin', 250) } };
  const record = { scope: 'account', entries: [{ definitionId: 10 }], priceApproval: createPurchasePriceApproval({ scope: 'account',
    season: '27', platform: 'pc', policy: { premium }, definitionIds: [10], references: { 10: reference }, now: 1000 }) };
  const cards = new Map();
  const observable = value => ({ observe(_owner, notify) { notify(null, value); }, unobserve() {} });
  class ItemService {
    clearTransferMarketCache() {}
    requestUnassignedItems() {}
    searchTransferMarket(criteria) {
      state.searches.push(criteria.maxBuy);
      const items = state.prices.map((price, i) => {
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
    playerDetails: new Map([[10, details]]), now: () => state.time, wait: async () => {} });
  await adapter.verifySquad(record);
  return { state, record, adapter, root, cards, details };
}
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
