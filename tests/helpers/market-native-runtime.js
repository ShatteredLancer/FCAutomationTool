import { executionRuntime } from './fc27-execution-runtime.js';
import { FC27_BUY_SERVICE_METHODS } from '../../src/adapters/ea/fc27-puzzle-buy.js';

export function marketNativeRuntime() {
  const { root } = executionRuntime(), calls = [], club = [], transfer = [], unassigned = [], market = [];
  let time = 1000000, coins = 10000;
  const hooks = {}, observable = value => ({ observe(_owner, callback) { callback(this, value); }, unobserve() {} });
  Object.assign(root.ItemPile, { PURCHASED: 6, TRANSFER: 5, CLUB: 7 });
  root.MAX_NEW_ITEMS = 100; root.GameCurrency = { COINS: 'COINS' }; root.TradeAccessLevel = { ALLOWED: 1 };
  root.SearchType = { PLAYER: 'player' }; root.SearchCategory = { ANY: 'any' };
  root.UTSearchCriteriaDTO = class {};
  root.UTCurrencyInputControl = { PRICE_TIERS: [{ min: 100000, inc: 1000 }, { min: 50000, inc: 500 }, { min: 10000, inc: 250 }, { min: 1000, inc: 100 }, { min: 0, inc: 50 }] };
  root.services.User.getUser = () => ({ tradeAccess: 1, coins, getCurrency: () => ({ amount: coins }) });
  const makeCard = (id, definitionId, pile = 'market', price = 600) => {
    const card = Object.assign(root.factories.Item.createItem({ id, resourceId: definitionId }), { type: 'player', _rating: 84,
      untradeable: false, tradable: true, isTradeable: () => true, isPlayer: () => true, isDuplicate: () => false,
      pile: { club: 7, transfer: 5, unassigned: 6, market: 9 }[pile],
      _itemPriceLimits: { minimum: 150, maximum: 10000 },
      auction: pile === 'market' ? { tradeId: 9000 + id, tradeState: 'active', buyNowPrice: price,
        canBuy: () => true, getSecondsRemaining: () => 300 } : { tradeState: 'inactive' } });
    card.getAuctionData = () => card.auction;
    ({ club, transfer, unassigned, market })[pile].push(card); return card;
  };
  class ItemService {
    bid(card, price) {
      calls.push(['bid', card.id, price]); if (hooks.bid) return observable(hooks.bid(card, price));
      coins -= price; card.purchasePrice = price; card.pile = 6; unassigned.push(card); card.auction = { tradeState: 'inactive' };
      return observable({ success: true, status: 200, data: { itemIds: [card.id] } });
    }
    move(card, pile) {
      calls.push(['move', card.id, pile]); card.pile = pile;
      for (const list of [club, unassigned]) { const index = list.indexOf(card); if (index >= 0) list.splice(index, 1); }
      transfer.push(card); return observable({ success: true, status: 200, data: { itemIds: [card.id] } });
    }
    list(card, start, buyNow, duration) {
      calls.push(['list', card.id, start, buyNow, duration]);
      card.auction = { tradeId: 19000 + card.id, tradeState: 'active', startingBid: start, buyNowPrice: buyNow, currentBid: 0 };
      return observable({ success: true, status: 200 });
    }
    searchTransferMarket(criteria) {
      calls.push(['search', criteria.defId[0], criteria.maxBuy]);
      return observable(hooks.search ? hooks.search(criteria) : { success: true, status: 200,
        data: { items: market.filter(c => c.definitionId === criteria.defId[0] && c.auction.buyNowPrice <= criteria.maxBuy) } });
    }
    clearTransferMarketCache() {}
    requestUnassignedItems() { calls.push(['read', 'unassigned']); return observable({ success: true, status: 200, response: { items: unassigned } }); }
    requestTransferItems() { calls.push(['read', 'transfer']); return observable({ success: true, status: hooks.readStatus ?? 200 }); }
    requestMarketData() { return observable({ success: true, status: 200 }); }
    refreshAuctions(items) { calls.push(['read', 'auctions']); hooks.auctions?.(items); return observable({ success: true, status: 200 }); }
  }
  root.services.Item = new ItemService();
  Object.assign(root.repositories.Item, { getUnassignedItems: () => unassigned, getTransferItems: () => transfer,
    getPileSize: () => 100, numItemsInCache: pile => pile === 5 ? transfer.length : unassigned.length, setDirty() {} });
  const digest = root.crypto.subtle.digest;
  const hashes = new Map(FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [String(ItemService.prototype[name]).replace(/\r\n/g, '\n'), hash]));
  root.crypto.subtle.digest = async (algorithm, bytes) => {
    const hash = hashes.get(new TextDecoder().decode(bytes));
    return hash ? Uint8Array.from(Buffer.from(hash, 'hex')).buffer : digest(algorithm, bytes);
  };
  const inventoryFactory = () => ({ clubItems: () => club, async validate(ref) {
    calls.push(['read', 'club']); if (!club.some(c => c.id === ref.id && c.definitionId === ref.definitionId)) throw Error('MARKET_HOLDING_UNAVAILABLE');
  } });
  return { root, calls, hooks, makeCard, club, transfer, unassigned, market, inventoryFactory, now: () => time,
    sleep: async ms => { time += ms; if (hooks.sleep) await hooks.sleep(); }, advance: ms => { time += ms; } };
}
