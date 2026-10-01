import { readFc27Context } from './fc27-local-read.js';
import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { createFc27PurchaseSquad } from './fc27-purchase-squad.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { readFc27PurchasePage, readFc27PurchasePageSlots } from './fc27-puzzle-page.js';
import { puzzleBuyMatchesSlots } from '../../fc27/puzzle-buy-slots.js';
import { readFsuStyleAuctionPrices } from '../../fc27/fsu-auction-search.js';

// FSU 26.09 buyConceptPlayer: exact-version search -> Item.bid at Buy Now
// -> Item.move(CLUB). Use EA services directly, never invoke FSU's buyer.
// Native service bodies inspected in the logged-in FC27 page on 2026-09-28.
export const FC27_BUY_SERVICE_METHODS = Object.freeze([
  ['bid', '998a2fe52b55da1fd5a4e96263dcefb153769ced27d093117af1e9bfac1e820a'],
  ['move', '021d1826feb561a8e66721559bc223b69346f51287f2993b4eadbb0c3bf353f4'],
]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = n => Number.isSafeInteger(n) && n > 0;
const fail = reason => { throw new Error(reason); };
export function readFc27PuzzleBuyPlan(root, target) {
  const page = readFc27PurchasePage(root, target);
  if (!page) fail('FC27_BUY_TARGET_CHANGED');
  const { items, slots: refs } = page;
  if (refs.filter(Boolean).some(ref => !id(ref.id) || !id(ref.definitionId) || typeof ref.concept !== 'boolean')) fail('FC27_BUY_PLAN_CHANGED');
  const purchases = refs.filter(ref => ref?.concept).map(ref => {
    const item = items[ref.slot];
    return { definitionId: ref.definitionId, rating: item._rating, nationId: item.nationId,
      teamId: item.teamId, leagueId: item.leagueId, preferredPosition: item.preferredPosition };
  });
  return { context: readFc27Context(root), kind: 'native-concept-purchase',
    challenge: { id: target.challengeId, setId: target.setId },
    slots: refs.map(ref => !ref ? null : ref.concept ? { slot: ref.slot, kind: 'concept', definitionId: ref.definitionId }
      : { slot: ref.slot, kind: 'owned', id: ref.id, definitionId: ref.definitionId, pile: 'club' }),
    purchases, purchaseCount: purchases.length };
}

export async function createFc27PuzzleBuyAdapter(root, { canWrite, assertTarget, referencePrice,
  verifyCurrent: verifyCurrentOverride = null, verifySquad: verifySquadOverride = null,
  collectionState = null, confirmCollection = null, playerDetails = null,
  attempts = 5, onEvent = () => {}, wait = (min, max) => new Promise(resolve => setTimeout(resolve,
    Math.floor(Math.random() * (max * 1000 - min * 1000 + 1)) + min * 1000)) } = {}) {
  const context = readFc27Context(root); const service = root.services.Item;
  const proto = Object.getPrototypeOf(service);
  const runtime = await verifyFc27Methods({ service: proto, crypto: root.crypto },
    FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [`service.${name}`, hash]));
  const functions = Object.fromEntries(['bid', 'move', 'searchTransferMarket', 'clearTransferMarketCache', 'requestUnassignedItems']
    .map(name => [name, service[name]]));
  if (Object.values(functions).some(fn => typeof fn !== 'function') || root.ItemPile.CLUB !== 7
      || root.ItemPile.PURCHASED !== 6 || root.GameCurrency.COINS !== 'COINS') fail('FC27_BUY_RUNTIME_UNVERIFIED');
  let provider;
  const legacyProvider = async () => provider ??= await createFc27PurchaseSquad(root, { canWrite, assertTarget });
  let club;
  const auctions = new Map(); const confirmedMoves = new Set();
  let closed = false; let currentRecord = null;
  const diagnostic = (stage, values = {}) => { onEvent({ stage, ...values }); };
  const pin = pgid => root.services.PIN.sendData(root.PINEventType.PAGE_VIEW, { type: root.PIN_PAGEVIEW_EVT_TYPE, pgid });
  const assertAccount = () => {
    runtime();
    if (closed || !same(context, readFc27Context(root)) || root.services.Item !== service || Object.getPrototypeOf(service) !== proto
        || Object.keys(functions).some(name => service[name] !== functions[name])) fail('FC27_BUY_CONTEXT_CHANGED');
  };
  const writable = () => { assertAccount(); if (canWrite() !== true) fail('FC27_BUY_DISABLED'); };
  const observe = async (operation, mutation = false) => {
    assertAccount(); if (mutation) writable();
    return new Promise((resolve, reject) => {
      const owner = {}; let observable; let done = false;
      const finish = (error, result) => {
        if (done) return; done = true; clearTimeout(timer);
        try { observable?.unobserve(owner); } catch { /* Our observer only. */ }
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('FC27_BUY_RESPONSE_UNCONFIRMED')), 16000);
      try {
        observable = operation();
        observable.observe(owner, (_sender, reply) => {
          try { assertAccount(); finish(null, reply); } catch (error) { finish(error); }
        });
      } catch { finish(new Error('FC27_BUY_RESPONSE_UNCONFIRMED')); }
    });
  };
  const coins = () => {
    const amount = root.services.User.getUser()?.getCurrency(root.GameCurrency.COINS)?.amount;
    if (!Number.isSafeInteger(amount) || amount < 0) fail('FC27_BUY_BALANCE_UNVERIFIED');
    return amount;
  };
  const verifyCurrent = record => {
    assertAccount(); assertTarget?.();
    if (typeof verifyCurrentOverride === 'function') return verifyCurrentOverride(record);
    const page = readFc27PurchasePageSlots(root, record.target, record);
    if (!puzzleBuyMatchesSlots(record, page)) fail('FC27_BUY_SQUAD_CHANGED');
  };
  return Object.freeze({
    async verifySquad(record) {
      currentRecord = record;
      if (typeof verifySquadOverride === 'function') return verifySquadOverride(record);
      verifyCurrent(record);
      const used = root.repositories.Item.numItemsInCache(root.ItemPile.PURCHASED);
      if (used >= root.MAX_NEW_ITEMS) fail('FC27_BUY_UNASSIGNED_FULL');
    },
    verifyCurrent,
    async find(definitionId, maxBuy) {
      await verifyCurrent(currentRecord);
      const criteria = new root.UTSearchCriteriaDTO();
      Object.assign(criteria, { defId: [definitionId], type: root.SearchType.PLAYER, category: root.SearchCategory.ANY });
      const model = new root.UTBucketedItemSearchViewModel();
      model.searchFeature = root.ItemSearchFeature.MARKET;
      model.defaultSearchCriteria.type = criteria.type; model.defaultSearchCriteria.category = criteria.category;
      model.updateSearchCriteria(criteria);
      // FSU uses the same native cache invalidation and search API. Only our
      // returned entities of the exact requested version may enter this batch.
      const item = playerDetails?.get?.(definitionId)
        ?? (playerDetails === null ? readFc27PurchasePage(root, currentRecord.target)?.items.find(card => card?.definitionId === definitionId) : null);
      if (!item || typeof referencePrice !== 'function') fail('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE');
      const initial = Number(await referencePrice({ definitionId, rating: item._rating, nationId: item.nationId,
        teamId: item.teamId, leagueId: item.leagueId, preferredPosition: item.preferredPosition }));
      if (!Number.isFinite(initial) || initial < 0) fail('FC27_BUY_REFERENCE_PRICE_INVALID');
      diagnostic('reference', { definitionId, price: initial });
      let searchFailure = null;
      const items = await readFsuStyleAuctionPrices({ ceiling: maxBuy, initial, attempts, wait,
        onResults: () => pin('Transfer Market Results - List View'),
        onSearchFailure: reply => { searchFailure = { reason: 'FC27_BUY_SEARCH_FAILED', ...responseCodes(reply) }; },
        above: price => root.UTCurrencyInputControl.getIncrementAboveVal(price),
        below: price => root.UTCurrencyInputControl.getIncrementBelowVal(price),
        search: async price => {
          verifyCurrent(currentRecord); criteria.maxBuy = price; model.updateSearchCriteria(criteria); service.clearTransferMarketCache();
          const reply = await observe(() => service.searchTransferMarket(model.searchCriteria, 1));
          diagnostic('search', { definitionId, maxBuy: model.searchCriteria.maxBuy, ...responseCodes(reply), count: reply.data?.items?.length ?? 0 });
          if (reply.success && (!Array.isArray(reply.data?.items) || reply.data.items.some(card => card.definitionId !== definitionId))) fail('FC27_BUY_QUOTE_UNVERIFIED');
          return reply;
        } });
      items.sort((a, b) => b.getAuctionData().buyNowPrice - a.getAuctionData().buyNowPrice);
      if (!items.length) return searchFailure ? { unavailable: true, ...searchFailure } : null;
      const selected = items[items.length - 1]; const auction = selected.getAuctionData(); const tradeId = String(auction.tradeId);
      if (!/^[1-9]\d{0,19}$/.test(tradeId)) fail('FC27_BUY_QUOTE_UNVERIFIED');
      auctions.set(tradeId, selected);
      return { definitionId, itemId: selected.id, tradeId, price: auction.buyNowPrice };
    },
    async buy(entry) {
      await verifyCurrent(currentRecord); writable();
      const item = auctions.get(entry.tradeId); const auction = item?.getAuctionData();
      if (!item || item.id !== entry.itemId || item.definitionId !== entry.definitionId || String(auction.tradeId) !== entry.tradeId
          || auction.buyNowPrice !== entry.price) {
        return { status: 'rejected', reason: 'FC27_BUY_LISTING_CHANGED' };
      }
      if (!auction.canBuy(coins())) return { status: 'rejected', reason: 'FC27_BUY_INSUFFICIENT_COINS' };
      if (!(auction.getSecondsRemaining() > 0)) return { status: 'rejected', reason: 'FC27_BUY_LISTING_CHANGED' };
      pin('Item - Detail View');
      const reply = await observe(() => { verifyCurrent(currentRecord); return service.bid(item, entry.price); }, true);
      diagnostic('bid', { definitionId: entry.definitionId, price: entry.price, ...responseCodes(reply) });
      if (reply?.success === true && Array.isArray(reply.data?.itemIds) && reply.data.itemIds.length === 1 && reply.data.itemIds[0] === entry.itemId) {
        return { status: 'bought', itemId: entry.itemId, definitionId: entry.definitionId, tradeId: entry.tradeId, price: entry.price };
      }
      if (reply?.success === false) return { status: 'rejected', ...responseCodes(reply),
        reason: reply.error?.code !== undefined && reply.error.code === root.UtasErrorCode.PERMISSION_DENIED
          ? 'FC27_BUY_LISTING_UNAVAILABLE' : 'FC27_BUY_REJECTED' };
      return { status: 'unknown' };
    },
    async locate(entry) {
      assertAccount();
      if (confirmedMoves.has(entry.itemId)) return 'club';
      club ??= await createFc27ClubReadTransport(root);
      const matches = await club.readPage({ start: 0, count: 250, definitionIds: [entry.definitionId] });
      const found = matches.find(item => item.id === entry.itemId && item.definitionId === entry.definitionId);
      if (found) return 'club';
      root.repositories.Item.setDirty(root.ItemPile.PURCHASED);
      const reply = await observe(() => service.requestUnassignedItems());
      if (reply?.success !== true || reply.status !== 200 || !Array.isArray(reply.response?.items)) fail('FC27_BUY_RECEIPT_UNCONFIRMED');
      const items = reply.response.items.filter(item => item.id === entry.itemId && item.definitionId === entry.definitionId);
      if (items.length !== 1) return 'unknown';
      auctions.set(entry.tradeId, items[0]); return 'purchased';
    },
    async collectionState(definitionId) {
      return typeof collectionState === 'function' ? collectionState(definitionId) : false;
    },
    async confirmCollection(definitionIds) {
      return typeof confirmCollection === 'function' ? confirmCollection(definitionIds) : { status: 'pending', definitionIds };
    },
    async move(entry) {
      writable();
      const item = auctions.get(entry.tradeId);
      if (!item || item.id !== entry.itemId || item.definitionId !== entry.definitionId) fail('FC27_BUY_MOVE_UNCONFIRMED');
      const reply = await observe(() => service.move(item, root.ItemPile.CLUB), true);
      diagnostic('move', { definitionId: entry.definitionId, ...responseCodes(reply) });
      if (reply?.success === false) return { status: 'rejected', reason: 'FC27_BUY_MOVE_REJECTED', ...responseCodes(reply) };
      if (reply?.success !== true || !Array.isArray(reply.data?.itemIds) || !reply.data.itemIds.includes(entry.itemId)
          || item.pile !== root.ItemPile.CLUB) fail('FC27_BUY_MOVE_UNCONFIRMED');
      confirmedMoves.add(entry.itemId);
    },
    async save(record, beforeDispatch) {
      await verifyCurrent(record);
      // FSU relies on Item.move's native concept replacement, never another
      // squad GET/PUT. Old save-pending journals alone use the legacy reader.
      if (record.base.kind !== 'native-concept-purchase') await (await legacyProvider()).save(record, beforeDispatch);
      else {
        const slots = readFc27PurchasePageSlots(root, record.target, record);
        return { applied: record.entries.filter(entry => entry.state === 'club' && slots[entry.slot]?.id === entry.itemId
          && slots[entry.slot]?.concept === false) };
      }
    },
    async recoverSave(record) {
      await (await legacyProvider()).recoverSave(record);
    },
    afterPlayer: () => wait(0.5, 1),
    cancel() { closed = true; provider?.cancel(); },
  });
}

function responseCodes(reply) {
  return { httpStatus: Number.isSafeInteger(reply?.status) ? reply.status : null,
    errorCode: Number.isSafeInteger(reply?.error?.code) ? reply.error.code : null };
}
