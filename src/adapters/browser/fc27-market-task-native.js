import { createEaTradeAdapter } from '../ea/trade.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { verifyFc27Methods } from '../ea/fc27-transaction-transport.js';
import { FC27_BUY_SERVICE_METHODS, FC27_BUY_COMPATIBLE_HASHES } from '../ea/fc27-puzzle-buy.js';
import { createFc27GalleryListingInventory, galleryListingInventoryRuntime } from '../ea/fc27-gallery-listing-inventory.js';
import { galleryListingCandidateAllowed } from '../../gallery/bulk-list-session.js';
import { galleryListingEvidence } from '../../gallery/listing-readback.js';
import { purchasePriceCap } from '../../gallery/public-price-policy.js';
import { marketTaskNativeRuntime } from '../ea/fc27-market-task-runtime.js';
import { readTradingTaskCard } from '../ea/fc27-trading-task-catalog.js';
import { taskCandidateAllowed } from '../../trading/task-catalog.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw Error(`MARKET_${reason}`); };
const refFor = (row, pile) => ({ id: Number(row.itemId), definitionId: row.definitionId, ...(pile ? { pile } : {}) });
const codeOf = result => {
  const http = result?.response?.status;
  return [401, 403, 429].includes(http) ? http : result?.error?.code ?? result?.response?.code ?? http ?? null;
};
const errorResult = result => ({ code: codeOf(result), category: result?.error?.kind === 'captcha' ? 'captcha'
  : codeOf(result) === 427 ? 'market-unavailable' : null });

// Lazily constructed by the approved task runtime. The composition provides
// account lock/protection/other-journal checks; no permissive defaults exist.
export async function createFc27MarketTaskNative({ root, assertCurrent, assertProtected, checkOtherTransactions,
  now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
  tradeFactory = createEaTradeAdapter, inventoryFactory = createFc27GalleryListingInventory }) {
  if (![assertCurrent, assertProtected, checkOtherTransactions].every(fn => typeof fn === 'function')) fail('GUARDS_UNAVAILABLE');
  const context = readFc27Context(root), service = root.services.Item, repository = root.repositories.Item;
  const functions = Object.fromEntries(['bid', 'move', 'list', 'searchTransferMarket', 'clearTransferMarketCache',
    'requestUnassignedItems', 'requestTransferItems', 'refreshAuctions', 'requestMarketData'].map(key => [key, service?.[key]]));
  if (Object.values(functions).some(fn => typeof fn !== 'function') || root.ItemPile?.TRANSFER !== 5 || root.ItemPile?.PURCHASED !== 6
    || root.ItemPile?.CLUB !== 7 || typeof repository?.setDirty !== 'function') fail('RUNTIME_UNAVAILABLE');
  const runtime = await verifyFc27Methods({ service: Object.getPrototypeOf(service), crypto: root.crypto },
    FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [`service.${name}`, hash]), FC27_BUY_COMPATIBLE_HASHES);
  const assert = () => {
    assertCurrent(); runtime();
    if (!same(context, readFc27Context(root)) || root.services.Item !== service || root.repositories.Item !== repository
      || Object.keys(functions).some(key => functions[key] !== service[key])) fail('CONTEXT_CHANGED');
  };
  const inventory = inventoryFactory(root, { assertCurrent: assert });
  const view = galleryListingInventoryRuntime(root, inventory), trade = tradeFactory(view), taskTrades = new Map();
  const forTask = taskId => {
    if (!taskTrades.has(taskId)) {
      const facade = marketTaskNativeRuntime(view);
      taskTrades.set(taskId, { ...facade, adapter: tradeFactory(facade.runtime) });
    }
    return taskTrades.get(taskId);
  };
  let lastRequest = -Infinity;
  const pace = async () => { assert(); const left = 3000 - (now() - lastRequest); if (left > 0) await sleep(left); assert(); lastRequest = now(); };
  const bounded = operation => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('MARKET_RESPONSE_UNCONFIRMED')), 20000);
    Promise.resolve().then(operation).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const readable = result => {
    if (result?.status !== 'completed' || result.response?.success !== true || !Number.isSafeInteger(result.response.status)
      || result.response.status < 200 || result.response.status >= 300) {
      throw Object.assign(Error('MARKET_READ_UNCONFIRMED'), errorResult(result));
    }
  };
  const refresh = async pile => {
    assert(); repository.setDirty(pile === 'transfer' ? 5 : 6); await pace();
    const result = await bounded(() => pile === 'transfer' ? trade.refreshTransferItems() : trade.refreshPurchaseState());
    assert(); readable(result);
  };
  const exact = row => {
    const result = trade.inspectPurchase(refFor(row)), c = result.candidate;
    if (result.status !== 'loaded' || c?.item?.id !== Number(row.itemId) || c.item.definitionId !== row.definitionId) fail('HOLDING_UNAVAILABLE');
    return result;
  };
  const unsold = (item, tradeId, listing) => {
    const a = item?.getAuctionData?.();
    return Boolean(listing && a && String(a.tradeId) === tradeId && a.isSold?.() === false
      && (a.isInactive?.() === true || ['inactive', 'expired'].includes(a.tradeState))
      && a.isActiveTrade?.() !== true && a.currentBid === 0
      && a.startingBid === listing.startPrice && a.buyNowPrice === listing.buyNow);
  };
  const checkRelist = action => {
    if (!action.previousTradeId) return;
    const item = repository.getTransferItems().find(i => i.id === Number(action.itemId) && i.definitionId === action.definitionId);
    if (!unsold(item, action.previousTradeId, action.previousListing)) fail('HOLDING_UNAVAILABLE');
  };
  const owned = async row => {
    await refresh('unassigned'); await refresh('transfer');
    let result;
    try { result = exact(row); } catch { /* Exact Club read below. */ }
    if (!result || result.candidate.item.pile === 'club') {
      await pace(); await inventory.validate(refFor(row, 'club')); result = exact(row);
    }
    const candidate = result.candidate;
    if (!galleryListingCandidateAllowed(candidate) || assertProtected(candidate.item, candidate) !== true) fail('HOLDING_PROTECTED');
    return result;
  };
  const capabilities = () => {
    assert(); const cap = trade.inspectCapabilities();
    const { max, used } = cap.transferCapacity ?? {};
    if (!cap.runtimeReady || cap.canTrade !== true || !Number.isSafeInteger(cap.coins) || cap.coins < 0
      || !Number.isSafeInteger(max) || !Number.isSafeInteger(used) || used < 0 || used > max) fail('SESSION_UNVERIFIED');
    return { ready: true, balance: cap.coins, freeSlots: max - used };
  };
  const guards = async () => { assert(); await checkOtherTransactions(); assert(); };
  const unknown = result => ({ status: 'unknown', receipt: null, ...errorResult(result) });
  const reconcile = async entry => {
    try {
      await refresh(entry.kind === 'buy' ? 'unassigned' : 'transfer');
      const result = exact(entry), candidate = result.candidate;
      const receipt = { itemId: entry.itemId, definitionId: entry.definitionId, tradeId: entry.tradeId ?? null, coins: entry.coins };
      if (entry.kind === 'buy' && candidate.item.pile === 'unassigned' && (entry.acknowledged === true || result.purchasePrice === entry.coins)) return { status: 'confirmed', receipt };
      if (entry.kind === 'move' && candidate.item.pile === 'transfer' && ['none', 'inactive'].includes(candidate.auction?.state)) return { status: 'confirmed', receipt: { ...receipt, tradeId: null } };
      if (entry.kind === 'list' && entry.listing) {
        const proof = galleryListingEvidence({ item: refFor(entry, 'transfer'), ...entry.listing,
          response: entry.acknowledged === true ? { success: true, status: 200 } : null }, result);
        if (proof.matched && proof.listingTradeId !== entry.previousTradeId) return { status: 'confirmed', receipt: { ...receipt, tradeId: proof.listingTradeId } };
      }
      return unknown(null);
    } catch (error) { return { ...unknown(null), code: error.code ?? null }; }
  };
  return Object.freeze({
    priceTiers: () => root.UTCurrencyInputControl?.PRICE_TIERS?.map(row => ({ min: row.min, inc: row.inc })),
    async inspectOwned(row) {
      await guards(); const result = await owned(row); assert();
      const cost = result.purchasePrice;
      return { eligible: true, itemId: row.itemId, definitionId: row.definitionId, pile: result.candidate.item.pile,
        cost: Number.isSafeInteger(cost) && cost > 0 && cost <= 15000000 ? cost : null };
    },
    async preflight({ action }) {
      await guards();
      if (['move', 'list'].includes(action.kind)) {
        const result = await owned(action), pile = result.candidate.item.pile;
        if (action.kind === 'list' && pile !== 'transfer' || action.kind === 'move' && !['club', 'unassigned'].includes(pile)) fail('HOLDING_UNAVAILABLE');
        if (action.kind === 'list') {
          checkRelist(action);
          await pace(); const limits = await bounded(() => trade.inspectPriceLimits(result.candidate.item, { refresh: true })); assert();
          readable({ ...limits, status: limits.refreshStatus });
          const limit = limits.after;
          if (!limit?.hasPriceLimits || purchasePriceCap({ maxBuy: action.coins, eaLimits: limit,
            priceTiers: root.UTCurrencyInputControl?.PRICE_TIERS }) !== action.coins) fail('PRICE_LIMIT');
        }
      } else { await refresh('unassigned'); await refresh('transfer'); }
      const cap = capabilities();
      if (action.kind === 'buy' || action.kind === 'search') {
        const count = repository.numItemsInCache(6), max = root.MAX_NEW_ITEMS;
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(max) || count < 0 || count >= max || cap.freeSlots < 1) fail('FUNDS_OR_CAPACITY');
        if (action.kind === 'buy' && trade.inspectPurchase(refFor(action)).status === 'loaded') fail('ITEM_OCCUPIED');
      }
      if (action.kind === 'move' && cap.freeSlots < 1) fail('FUNDS_OR_CAPACITY');
      await guards(); return cap;
    },
    async send({ action, task, beforeDispatch }) {
      await pace(); await guards();
      const { adapter, dispatch } = forTask(task.id); let dispatched = false, reply = null;
      const options = { beforeDispatch: item => {
        assert();
        if (action.kind === 'buy') {
          if (task.mode === 'filter') {
            const facts = readTradingTaskCard(item);
            if (!facts || !taskCandidateAllowed(facts, task)) fail('CANDIDATE_CHANGED');
          }
          const auction = item?.getAuctionData?.();
          if (item?.id !== Number(action.itemId) || item.definitionId !== action.definitionId || String(auction?.tradeId) !== action.tradeId
            || auction.buyNowPrice !== action.coins || auction.canBuy?.(capabilities().balance) !== true
            || !(auction.getSecondsRemaining?.() > 0) || purchasePriceCap({ maxBuy: action.coins,
              eaLimits: item._itemPriceLimits ?? item.itemPriceLimits ?? null,
              priceTiers: root.UTCurrencyInputControl?.PRICE_TIERS }) !== action.coins) fail('OFFER_CHANGED');
        }
        if (['move', 'list'].includes(action.kind)) {
          checkRelist(action);
          const c = exact(action).candidate;
          if (!galleryListingCandidateAllowed(c) || assertProtected(c.item, c) !== true
            || action.kind === 'list' && c.item.pile !== 'transfer'
            || action.kind === 'move' && !['club', 'unassigned'].includes(c.item.pile)) fail('HOLDING_PROTECTED');
        }
        beforeDispatch(); dispatched = true;
      }, onResponse: value => { reply = value; } };
      let result;
      if (action.kind === 'search') {
        result = await dispatch(options, () => bounded(() => adapter.searchMarket({ definitionId: action.definitionId, maxBuyNow: action.maxBuy, page: 1 })));
        assert();
        const ok = result.status === 'completed' && result.response?.success === true && result.response.status >= 200 && result.response.status < 300;
        if (ok && (!Array.isArray(result.candidates) || result.candidates.length > 21)) return { sent: dispatched, status: 'unknown' };
        return { sent: dispatched, status: ok ? 'confirmed' : 'unknown', ...errorResult(result),
          offers: ok ? result.candidates.filter(c => c.item?.definitionId === action.definitionId && c.auction?.state === 'active'
            && Number.isSafeInteger(c.auction.tradeId) && c.auction.tradeId > 0).map(c => ({ itemId: String(c.item.id),
            definitionId: c.item.definitionId, tradeId: String(c.auction.tradeId), coins: c.auction.buyNowPrice })) : [] };
      }
      const permit = await adapter.acquireRequestPermit(action.kind === 'move' ? 'purchase-route' : action.kind);
      assert(); if (permit.status !== 'acquired') return { status: 'rejected', receipt: null, ...errorResult(permit) };
      const permitOptions = { requestPermit: permit.permit };
      if (action.kind === 'buy') result = await dispatch(options, () => bounded(() => adapter.buyNowItem({ ...refFor(action), tradeId: action.tradeId }, action.coins, permitOptions)));
      else if (action.kind === 'move') result = await dispatch(options, () => bounded(() => adapter.routePurchasedItem(exact(action).candidate.item, 'transfer', permitOptions)));
      else if (action.kind === 'list') result = await dispatch(options, () => bounded(() => adapter.listItem(refFor(action, 'transfer'), action.listing, permitOptions)));
      else fail('ACTION_CHANGED');
      assert();
      if (!dispatched) return { status: 'rejected', receipt: null, ...errorResult(result) };
      const evidence = reply?.data?.itemIds;
      const contradictory = evidence != null && (!Array.isArray(evidence) || evidence.length > 0);
      if (reply?.success === false && !contradictory && [400, 401, 403, 404, 409, 429, 461].includes(reply.status)) {
        return { status: 'rejected', receipt: null, ...errorResult(result) };
      }
      const acknowledged = reply?.success === true && Number.isSafeInteger(reply.status) && reply.status >= 200 && reply.status < 300
        && (action.kind === 'list' || Array.isArray(evidence) && evidence.length === 1 && evidence[0] === Number(action.itemId));
      const checked = await reconcile({ ...action, ...(acknowledged ? { acknowledged: true } : {}) });
      return { ...checked, ...(acknowledged ? { acknowledged: true } : {}), code: checked.code ?? codeOf(result), category: checked.category ?? errorResult(result).category };
    },
    reconcile,
    async readSales(holdings) {
      assert(); await refresh('transfer'); await pace();
      const items = repository.getTransferItems();
      if (!Array.isArray(items)) fail('READ_UNCONFIRMED');
      const selected = items.filter(item => holdings.some(h => Number(h.itemId) === item.id && h.definitionId === item.definitionId));
      if (!selected.length) return [];
      const value = await bounded(() => new Promise((resolve, reject) => {
        const owner = {}; let observable;
        try { observable = service.refreshAuctions(selected); observable.observe(owner, (_sender, reply) => { observable.unobserve?.(owner); resolve(reply); }); }
        catch (error) { observable?.unobserve?.(owner); reject(error); }
      }));
      assert(); readable({ status: 'completed', response: value });
      const receipts = [];
      for (const item of selected) {
        const auction = item.getAuctionData?.(), holding = holdings.find(h => Number(h.itemId) === item.id);
        if (auction?.isSold?.() === true && String(auction.tradeId) === holding.listingTradeId) {
          if (!Number.isSafeInteger(auction.currentBid) || auction.currentBid < 150 || auction.currentBid > 15000000
            || holding.listing && (auction.currentBid < holding.listing.startPrice || auction.currentBid > holding.listing.buyNow)) fail('RECEIPT_CONFLICT');
          receipts.push({ itemId: holding.itemId, definitionId: item.definitionId, tradeId: holding.listingTradeId,
            price: auction.currentBid, sold: true });
        } else if (unsold(item, holding.listingTradeId, holding.listing)) {
          receipts.push({ itemId: holding.itemId, definitionId: item.definitionId, tradeId: holding.listingTradeId,
            sold: false, unsold: true });
        }
      }
      return receipts;
    },
    async verifySession() { await refresh('transfer'); return capabilities(); },
  });
}
