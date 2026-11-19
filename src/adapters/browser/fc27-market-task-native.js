import { marketTaskAutoLists } from '../../trading/market-task-policy.js';
import { marketSellMatches } from '../../trading/market-sell-selection.js';
import { fc27MarketTraffic } from '../ea/fc27-market-traffic.js';
import { createFc27MarketReadTransport, marketReadReason } from '../ea/fc27-market-read.js';
import { renewFc27MarketSession } from '../ea/fc27-market-session-renewal.js';
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
import { marketTaskBuyResponse } from '../../trading/market-task-buy-response.js';
import { marketBuyMode, chooseMarketOffer } from '../../trading/market-bidding.js';
import { createMarketAuctionReader, marketAuctionOffer } from '../ea/fc27-market-auctions.js';
import { observeFc27TrafficResult } from '../ea/fc27-market-traffic-runtime.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw Error(`MARKET_${reason}`); };
const refFor = (row, pile) => ({ id: Number(row.itemId), definitionId: row.definitionId, ...(pile ? { pile } : {}) });
const codeOf = result => {
  const http = result?.response?.status;
  return [401, 403, 429].includes(http) ? http : result?.error?.code ?? result?.response?.error?.code ?? result?.response?.code ?? http ?? null;
};
const errorResult = result => ({ code: codeOf(result), category: result?.error?.kind === 'captcha' ? 'captcha'
  : codeOf(result) === 427 ? 'market-unavailable' : null });

// Lazily constructed by the approved task runtime. The composition provides
// account lock/protection/other-journal checks; no permissive defaults exist.
export async function createFc27MarketTaskNative({ root, assertCurrent, assertProtected, checkOtherTransactions,
  now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
  tradeFactory = createEaTradeAdapter, inventoryFactory = createFc27GalleryListingInventory,
  sessionReaderFactory = createFc27MarketReadTransport, renewSession = renewFc27MarketSession, onDiagnostic = null }) {
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
  const cachedItems = collection => {
    if(typeof collection?.values==='function')return Array.from(collection.values());
    return Array.isArray(collection)?collection:Object.values(collection?._collection??{});
  };
  // Manual selections can already be in EA's Club cache without a scan.
  // Prefer entities from our latest scan when both caches contain the same ID.
  const view = galleryListingInventoryRuntime(root, {clubItems:()=>[...new Map([
    ...cachedItems(repository.club?.items),...cachedItems(service.itemDao?.itemRepo?.club?.items),
    ...inventory.clubItems(),
  ].map(item=>[item.id,item])).values()]}), trade = tradeFactory(view), taskTrades = new Map();
  const forTask = taskId => {
    if (!taskTrades.has(taskId)) {
      const facade = marketTaskNativeRuntime(view, root);
      taskTrades.set(taskId, { ...facade, adapter: tradeFactory(facade.runtime), lastSearchAt: null });
    }
    return taskTrades.get(taskId);
  };
  let lastRequest = -Infinity, lastOnlineAt = null;
  const pace = async () => { assert(); const left = 3000 - (now() - lastRequest); if (left > 0) await sleep(left); assert(); lastRequest = now(); };
  const bounded = operation => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('MARKET_RESPONSE_UNCONFIRMED')), 20000);
    Promise.resolve().then(operation).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const recoveryDiagnostic = (transportPhase, result, localReason = null) => {
    try {
      const response=result?.response;
      Promise.resolve(onDiagnostic?.({area:'trading',event:'task-native',phase:'recover',transportPhase,
        status:localReason?'blocked':'received',
        httpStatus:Number.isSafeInteger(response?.status)?response.status:undefined,
        errorCode:Number.isSafeInteger(result?.code)?result.code:Number.isSafeInteger(response?.error?.code)?response.error.code:undefined,
        ...(localReason?{localReason}:{}),
      })).catch(()=>{});
    } catch { /* Diagnostics never change reconciliation or its retained evidence. */ }
  };
  const readable = result => {
    if (result?.status !== 'completed' || result.response?.success !== true || !Number.isSafeInteger(result.response.status)
      || result.response.status < 200 || result.response.status >= 300) {
      throw Object.assign(Error('MARKET_READ_UNCONFIRMED'), errorResult(result), { readResult: result });
    }
  };
  const auctions=createMarketAuctionReader({root,assert,pace,readable}),marketItems=new Map();
  const marketKey=(task,row)=>`${task.id}:${row.tradeId}`;
  const wonOrigin=async action=>{
    const row=action.wonAuction;
    if(!row||row.itemId!==action.itemId||row.definitionId!==action.definitionId)fail('HOLDING_UNAVAILABLE');
    await auctions.read([row]);const result=auctions.won(row);
    if(assertProtected(result.candidate.item,result.candidate)!==true)fail('HOLDING_PROTECTED');
    return result;
  };
  const refresh = async (pile, recovery = false) => {
    await pace(); assert(); repository.setDirty(pile === 'transfer' ? 5 : 6);
    const result = await bounded(() => pile === 'transfer' ? trade.refreshTransferItems() : trade.refreshPurchaseState());
    if(recovery)recoveryDiagnostic(`${pile}-read`,result);
    assert(); readable(result);
    lastOnlineAt = now();
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
  const cachedOwned = row => {
    const result=exact(row),candidate=result.candidate;
    if(!galleryListingCandidateAllowed(candidate)||assertProtected(candidate.item,candidate)!==true)fail('HOLDING_PROTECTED');
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
  const searchSnapshots = new WeakMap();
  // Only the current native-lock turn can reuse this snapshot. Nothing is
  // persisted or carried to another turn, task, account or subsequent buy.
  const pileStamp = () => {
    if (typeof repository.isDirty !== 'function' || repository.isDirty(5) !== false || repository.isDirty(6) !== false) return null;
    const transfer=repository.getTransferItems(), unassigned=repository.getUnassignedItems();
    if (!Array.isArray(transfer)||!Array.isArray(unassigned)
      || transfer.length!==repository.numItemsInCache(5)||unassigned.length!==repository.numItemsInCache(6)) return null;
    return JSON.stringify([capabilities(),root.MAX_NEW_ITEMS,...[transfer,unassigned].map(rows=>rows.map(item=>{
      const auction=item.getAuctionData?.();
      return [item.id,item.definitionId,item.pile,auction?.tradeId,auction?.tradeState,auction?.currentBid];
    }))]);
  };
  const hitSnapshot = (action,task,scope) => {
    const saved=scope&&searchSnapshots.get(scope);
    if(!['buy','bid'].includes(action.kind)||!saved)return null;
    if(saved.used||saved.task!==JSON.stringify(task)||saved.definitionId!==action.definitionId
      ||now()-saved.at>15000||now()<saved.at||saved.stamp!==pileStamp())fail('SEARCH_HIT_CHANGED');
    return saved;
  };
  const unknown = result => ({ status: 'unknown', receipt: null, ...errorResult(result) });
  const refreshAuctions = async (items, recovery = false) => {
    await pace();
    const value = await bounded(() => new Promise((resolve, reject) => {
      const owner = {}; let observable;
      try { observable = service.refreshAuctions(items); observable.observe(owner, (_sender, reply) => { observable.unobserve?.(owner); resolve(reply); }); }
      catch (error) { observable?.unobserve?.(owner); reject(error); }
    }));
    if(recovery)recoveryDiagnostic('auction-read',{response:value});
    assert(); readable({ status: 'completed', response: value });
  };
  const reconcile = async (entry, { recovery = false } = {}) => {
    let stage=entry.kind==='bid'?'watch-read':entry.kind==='buy'?'unassigned-read':'transfer-read';
    try {
      if(entry.kind==='bid'){
        const proof=(await auctions.read([entry])).receipts[0];
        if(proof&&(['leading','won'].includes(proof.state)||entry.acknowledged===true))return {status:'confirmed',receipt:{itemId:entry.itemId,definitionId:entry.definitionId,tradeId:entry.tradeId,coins:entry.coins}};
        return unknown(null);
      }
      await refresh(entry.kind === 'buy' ? 'unassigned' : 'transfer', recovery);
      stage='item-match';
      const result = exact(entry), candidate = result.candidate;
      const receipt = { itemId: entry.itemId, definitionId: entry.definitionId, tradeId: entry.tradeId ?? null, coins: entry.coins };
      if (entry.kind === 'buy' && candidate.item.pile === 'unassigned' && (entry.acknowledged === true || result.purchasePrice === entry.coins)) return { status: 'confirmed', receipt };
      if (entry.kind === 'move' && candidate.item.pile === 'transfer' && ['none', 'inactive'].includes(candidate.auction?.state)) return { status: 'confirmed', receipt: { ...receipt, tradeId: null } };
      if (entry.kind === 'list' && entry.listing) {
        const proof = galleryListingEvidence({ item: refFor(entry, 'transfer'), ...entry.listing,
          response: entry.acknowledged === true ? { success: true, status: 200 } : null }, result);
        if (proof.matched && proof.listingTradeId !== entry.previousTradeId) return { status: 'confirmed', receipt: { ...receipt, tradeId: proof.listingTradeId } };
        if (recovery && Number.isSafeInteger(entry.at) && now() >= entry.at + 60000 && candidate.item.pile === 'transfer') {
          const findItem = () => repository.getTransferItems().filter(i => i.id === Number(entry.itemId) && i.definitionId === entry.definitionId);
          let items = findItem();
          if (items.length !== 1) fail('HOLDING_UNAVAILABLE');
          const auctionId = items[0].getAuctionData?.()?.tradeId;
          if (auctionId !== null && auctionId !== undefined && auctionId !== 0 && auctionId !== '0') { stage='auction-read'; await refreshAuctions(items,recovery); }
          stage='unlisted-proof';
          assert(); items = findItem();
          if (items.length !== 1 || exact(entry).candidate.item.pile !== 'transfer') fail('HOLDING_UNAVAILABLE');
          const a = items[0].getAuctionData?.(), rawId = a?.tradeId;
          const emptyId = rawId === null || rawId === undefined || rawId === 0 || rawId === '0';
          const validId = (typeof rawId === 'string' && /^[1-9]\d{0,19}$/.test(rawId)) || (Number.isSafeInteger(rawId) && rawId > 0);
          const inactive = ['none', 'inactive', 'expired'].includes(a?.tradeState);
          if (a?.isSold?.() === false && a.isActiveTrade?.() === false && a.currentBid === 0
            && inactive && (emptyId || validId)) {
            return { status: 'resolved', receipt: null, resolution: { kind: 'unlisted', itemId: entry.itemId,
              definitionId: entry.definitionId, at: now(), tradeId: emptyId ? null : String(rawId) } };
          }
        }
        return { ...unknown(null), reason: 'MARKET_LISTING_STATE_UNCONFIRMED' };
      }
      return unknown(null);
    } catch (error) {
      const reason=error.code===401?'MARKET_AUTHENTICATION':error.message==='MARKET_HOLDING_UNAVAILABLE'?'MARKET_RECOVERY_ITEM_MISSING':'MARKET_READ_UNCONFIRMED';
      if(recovery)recoveryDiagnostic(stage,error.readResult??{code:error.code},
        reason==='MARKET_AUTHENTICATION'?'FC27_MARKET_RECOVERY_AUTHENTICATION':reason==='MARKET_RECOVERY_ITEM_MISSING'?'FC27_MARKET_RECOVERY_ITEM_MISSING':'FC27_MARKET_RECOVERY_READ_UNCONFIRMED');
      return { ...unknown(null), code: error.code ?? null, reason };
    }
  };
  return Object.freeze({
    async discoverOwned({task,isCurrent=()=>true,onProgress=()=>{}}) {
      const check=()=>{assert();if(!isCurrent())fail('USER_STOP');};
      await guards();check();if(!task.sellSelection)fail('SELL_SELECTION_INVALID');
      // Refresh external piles before resolving Club entities, since cards may
      // have moved between warehouses. No stale cache qualifies a new holding.
      await refresh('transfer');check();await refresh('unassigned');check();
      const selection=task.sellSelection,refs=[];
      if(['all','club'].includes(selection.pile)){
        if(typeof inventory.scanPlayers!=='function')fail('SELL_SCAN_UNAVAILABLE');
        try{refs.push(...await inventory.scanPlayers({beforeRead:async()=>{check();await pace();check();},onProgress}));}
        catch(error){const code=Number(error.message?.match(/^FC27_CLUB_HTTP_(\d+)$/)?.[1]);if(code)error.code=code;throw error;}check();
      }
      for(const [pile,items] of [['transfer',repository.getTransferItems()],['unassigned',repository.getUnassignedItems()]]){
        if(selection.pile==='all'||selection.pile===pile)for(const item of items)if(item.type==='player')refs.push({id:item.id,definitionId:item.definitionId,pile});
      }
      const seen=new Set(),rows=[];
      for(const ref of refs){
        check();if(seen.has(ref.id))continue;seen.add(ref.id);
        const row={itemId:String(ref.id),definitionId:ref.definitionId};let result;
        try{result=exact(row);}catch(error){if(error.message==='MARKET_HOLDING_UNAVAILABLE')continue;throw error;}
        const candidate=result.candidate;
        if(!marketSellMatches(selection,{...candidate.item,rating:candidate.rating})||!galleryListingCandidateAllowed(candidate)||assertProtected(candidate.item,candidate)!==true)continue;
        rows.push({...row,pile:candidate.item.pile,rating:candidate.rating,name:candidate.name||`EA ${ref.definitionId}`});
      }
      check();return rows.sort((a,b)=>({transfer:0,unassigned:1,club:2}[a.pile]-{transfer:0,unassigned:1,club:2}[b.pile]));
    },
    readAuctions: async rows=>{await guards();return auctions.read(rows);},
    priceTiers: () => root.UTCurrencyInputControl?.PRICE_TIERS?.map(row => ({ min: row.min, inc: row.inc })),
    async inspectOwned(row, {task} = {}) {
      await guards(); const result = task?.mode==='sell'?cachedOwned(row):await owned(row); assert();
      if(task?.sellSelection&&!marketSellMatches(task.sellSelection,{...result.candidate.item,rating:result.candidate.rating}))fail('HOLDING_PROTECTED');
      const cost = result.purchasePrice;
      return { eligible: true, itemId: row.itemId, definitionId: row.definitionId, pile: result.candidate.item.pile, rating:result.candidate.rating,
        cost: Number.isSafeInteger(cost) && cost > 0 && cost <= 15000000 ? cost : null };
    },
    async preflight({ action, task, executionScope }) {
      await guards();
      if(marketBuyMode(task??{settings:{}})!=='bin')await auctions.ready();
      const hit=hitSnapshot(action,task,executionScope);
      if (['move', 'list'].includes(action.kind)) {
        // Listing uses the current native entity, like Enhancer Bulk List.
        let result;try{result=action.kind==='list'||task?.mode==='sell'?cachedOwned(action):await owned(action);}catch(error){if(action.kind!=='move'||!action.wonAuction||!['MARKET_HOLDING_UNAVAILABLE','MARKET_HOLDING_PROTECTED'].includes(error.message))throw error;result=await wonOrigin(action);}
        const pile = result.candidate.item.pile;
        if(task?.sellSelection&&!marketSellMatches(task.sellSelection,{...result.candidate.item,rating:result.candidate.rating},{moved:true}))fail('HOLDING_PROTECTED');
        if (action.kind === 'list' && pile !== 'transfer' || action.kind === 'move' && !['club', 'unassigned','watch'].includes(pile)) fail('HOLDING_UNAVAILABLE');
        if (action.kind === 'list') {
          checkRelist(action);
          let limits = await trade.inspectPriceLimits(result.candidate.item); assert();
          if(!limits.after?.hasPriceLimits){
            limits=await bounded(()=>trade.inspectPriceLimits(result.candidate.item,{refresh:true}));assert();
            readable({...limits,status:limits.refreshStatus});
          }
          const limit = limits.after;
          try {
            Promise.resolve(onDiagnostic?.({area:'trading',event:'task-native',phase:'list',transportPhase:'price-limits',
              status:'observed',definitionId:action.definitionId,startPrice:action.listing?.startPrice,buyNow:action.listing?.buyNow,
              durationSeconds:action.listing?.durationSeconds,minimumPrice:limit?.minimum,maximumPrice:limit?.maximum})).catch(()=>{});
          } catch { /* A diagnostic failure cannot prevent listing. */ }
          if (!limit?.hasPriceLimits || purchasePriceCap({ maxBuy: action.coins, eaLimits: limit,
            priceTiers: root.UTCurrencyInputControl?.PRICE_TIERS }) !== action.coins
            || !Number.isSafeInteger(action.listing?.startPrice) || action.listing.startPrice < limit.minimum
            || action.listing.startPrice > action.listing.buyNow
            || purchasePriceCap({maxBuy:action.listing.startPrice,eaLimits:limit,priceTiers:root.UTCurrencyInputControl?.PRICE_TIERS}) !== action.listing.startPrice) fail('PRICE_LIMIT');
        }
      } else if (!hit) { await refresh('unassigned'); await refresh('transfer'); }
      const cap = capabilities();
      if ((task?.schedule || task && !marketTaskAutoLists(task)) && ['search','buy','bid','move'].includes(action.kind) && cap.freeSlots < 1) fail('TRANSFER_FULL');
      if (['buy','bid','search'].includes(action.kind)) {
        const count = repository.numItemsInCache(6), max = root.MAX_NEW_ITEMS;
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(max) || count < 0 || count >= max || cap.freeSlots < 1) fail('FUNDS_OR_CAPACITY');
        if (action.kind === 'buy' && trade.inspectPurchase(refFor(action)).status === 'loaded') fail('ITEM_OCCUPIED');
      }
      if (action.kind === 'move' && cap.freeSlots < 1) fail('FUNDS_OR_CAPACITY');
      await guards();
      if(action.kind==='search'&&executionScope){
        const stamp=pileStamp();
        if(stamp!==null)searchSnapshots.set(executionScope,{task:JSON.stringify(task),definitionId:action.definitionId,stamp,at:now(),used:false});
      }
      return cap;
    },
    async send({ action, task, beforeDispatch, beforeRequest, executionScope }) {
      const mode=marketBuyMode(task);
      if(action.kind==='bid'&&mode==='bin'||action.kind==='buy'&&mode==='bid')fail('BUY_RULE_CHANGED');
      const hit=hitSnapshot(action,task,executionScope);
      const listingMove=action.kind==='move'&&task.mode==='sell';
      if(!hit&&action.kind!=='list'&&!listingMove)await pace();
      await guards();
      const taskTrade = forTask(task.id), { adapter, dispatch } = taskTrade;
      let dispatched = false, reply = null, blocked = null, dispatchAt = null, listedItem = null, oldListingId = null;
      const diagnostic = (transportPhase, value = null) => {
        if (!['buy', 'bid', 'move', 'list'].includes(action.kind)) return;
        // Keep transport status separate from EA's business error. No raw
        // response/message, account, entity ID or auction ID enters the log.
        try {
          const httpStatus = Number.isSafeInteger(value?.status) ? value.status : null;
          const errorCode = Number.isSafeInteger(value?.error?.code) ? value.error.code
            : Number.isSafeInteger(value?.code) ? value.code : null;
          const permissionDenied = errorCode !== null && errorCode === root.UtasErrorCode?.PERMISSION_DENIED;
          Promise.resolve(onDiagnostic?.({ area: 'trading', event: 'task-native', phase: action.kind, transportPhase,
            method: `service.${action.kind === 'buy' ? 'bid' : action.kind}`, definitionId: action.definitionId,
            actualPrice: ['buy','bid'].includes(action.kind) ? action.coins : undefined,
            ...(action.kind === 'list' ? { startPrice: action.listing?.startPrice, buyNow: action.listing?.buyNow,
              durationSeconds: action.listing?.durationSeconds } : {}),
            capturedAt: ['buy','bid'].includes(action.kind) ? taskTrade.lastSearchAt : undefined,
            durationMs: dispatchAt === null ? undefined : Math.max(0, now() - dispatchAt),
            status: value === null ? 'dispatch-approved' : value?.success === false ? 'rejected' : 'received',
            httpStatus, errorCode, ...(permissionDenied ? { localReason: 'FC27_MARKET_PERMISSION_DENIED' } : {}) })).catch(() => {});
        } catch { /* Diagnostics never alter a native dispatch or receipt. */ }
      };
      const options = { beforeRequest, listingMove, beforeDispatch: item => {
        assert();
        if (['buy','bid'].includes(action.kind)) {
          if(hit)hitSnapshot(action,task,executionScope);
          if (task.mode === 'filter') {
            const facts = readTradingTaskCard(item);
            if (!facts || !taskCandidateAllowed(facts, task) || task.ratingPrices&&facts.rating!==action.rating) fail('CANDIDATE_CHANGED');
          }
          const auction = item?.getAuctionData?.();
          const chosen=action.kind==='bid'?chooseMarketOffer({offer:marketAuctionOffer(item),buyMode:'bid',bidCap:action.coins,
            bidExact:task.settings.bidExact,bidExpires:task.settings.bidExpires,priceTiers:root.UTCurrencyInputControl?.PRICE_TIERS}):null;
          if (item?.id !== Number(action.itemId) || item.definitionId !== action.definitionId || String(auction?.tradeId) !== action.tradeId
            || (action.kind==='buy'?(auction.buyNowPrice !== action.coins || auction.canBuy?.(capabilities().balance) !== true)
              :chosen?.coins!==action.coins||auction.tradeOwner!==false||auction.isHighestBid?.()===true||auction.canBid?.(action.coins,capabilities().balance)!==true)
            || !(auction.getSecondsRemaining?.() > 0) || purchasePriceCap({ maxBuy: action.coins,
              eaLimits: item._itemPriceLimits ?? item.itemPriceLimits ?? null,
              priceTiers: root.UTCurrencyInputControl?.PRICE_TIERS }) !== action.coins) fail('OFFER_CHANGED');
        }
        if (['move', 'list'].includes(action.kind)) {
          checkRelist(action);
          let c;try{c=exact(action).candidate;}catch(error){if(action.kind!=='move'||!action.wonAuction)throw error;c=auctions.won(action.wonAuction).candidate;}
          if(task.sellSelection&&!marketSellMatches(task.sellSelection,{...c.item,rating:c.rating},{moved:true}))fail('HOLDING_PROTECTED');
          if(action.kind==='move'&&action.wonAuction&&c.item.pile==='unassigned'&&!galleryListingCandidateAllowed(c))c=auctions.won(action.wonAuction).candidate;
          if(task.ratingPrices&&action.kind==='list'&&!(action.previousTradeId&&task.settings.relist==='original')&&readTradingTaskCard(repository.getTransferItems().find(i=>i.id===Number(action.itemId)))?.rating!==action.rating)fail('CANDIDATE_CHANGED');
          if (!(c.item.pile==='watch'&&action.kind==='move')&&!galleryListingCandidateAllowed(c) || assertProtected(c.item, c) !== true
            || action.kind === 'list' && c.item.pile !== 'transfer'
            || action.kind === 'move' && !['club', 'unassigned','watch'].includes(c.item.pile)) fail('HOLDING_PROTECTED');
        }
        if(action.kind==='list'){listedItem=item;oldListingId=item.getAuctionData?.()?.tradeId;}
        beforeDispatch(); dispatched = true;
        if(hit)hit.used=true;
        if(hit||action.kind==='list'||listingMove)lastRequest=now();
        dispatchAt = now(); diagnostic('before-dispatch');
      }, onResponse: value => { reply = value; diagnostic('native-response', value); }, onBlocked: error => { blocked=error; } };
      let result;
      if (action.kind === 'search') {
        if(mode!=='bin'){
          await auctions.ready();
          const criteria=new root.UTSearchCriteriaDTO();criteria.defId=[action.definitionId];criteria.type=root.SearchType.PLAYER;criteria.category=root.SearchCategory.ANY;
          if(action.searchMode==='bid')criteria.maxBid=action.maxBid;else if(action.searchMode==='bin')criteria.maxBuy=action.maxBuy;else fail('ACTION_CHANGED');
          service.clearTransferMarketCache();
          const response=await dispatch(options,()=>observeFc27TrafficResult(taskTrade.runtime.services.Item.searchTransferMarket(criteria,1)));
          assert();if(blocked)throw blocked;readable({status:'completed',response});
          const items=(response.data??response.response)?.items;
          if(!Array.isArray(items)||items.length>21)fail('SEARCH_UNCONFIRMED');
          for(const key of marketItems.keys())if(key.startsWith(task.id+':'))marketItems.delete(key);
          const offers=[];for(const item of items){const offer=marketAuctionOffer(item);
            if(item.definitionId!==action.definitionId||item.getAuctionData?.()?.isActiveTrade?.()!==true)continue;
            marketItems.set(marketKey(task,offer),item);offers.push(offer);
          }
          taskTrade.lastSearchAt=now();return {sent:dispatched,status:'confirmed',responseCount:items.length,offers};
        }
        result = await dispatch(options, () => bounded(() => adapter.searchMarket({ definitionId: action.definitionId, maxBuyNow: action.maxBuy, page: 1 })));
        assert();if(blocked)throw blocked;
        const ok = result.status === 'completed' && result.response?.success === true && result.response.status >= 200 && result.response.status < 300;
        if (ok) taskTrade.lastSearchAt = now();
        if (ok && (!Array.isArray(result.candidates) || result.candidates.length > 21)) return { sent: dispatched, status: 'unknown' };
        return { sent: dispatched, status: ok ? 'confirmed' : 'unknown', ...errorResult(result),
          responseCount: ok ? result.candidates.length : null,
          offers: ok ? result.candidates.filter(c => c.item?.definitionId === action.definitionId && c.auction?.state === 'active'
            && Number.isSafeInteger(c.auction.tradeId) && c.auction.tradeId > 0).map(c => ({ itemId: String(c.item.id),
            definitionId: c.item.definitionId, tradeId: String(c.auction.tradeId), coins: c.auction.buyNowPrice })) : [] };
      }
      if(action.kind==='bid'||action.kind==='buy'&&mode!=='bin'){
        const item=action.rebid?auctions.find(action):marketItems.get(marketKey(task,action));
        if(!item)fail('OFFER_CHANGED');
        result={status:'completed',response:await dispatch(options,()=>observeFc27TrafficResult(taskTrade.runtime.services.Item.bid(item,action.coins)))};
      }else if(action.kind==='move'&&action.wonAuction&&(()=>{try{exact(action);return false;}catch{return true;}})()){
        const result=await wonOrigin(action);
        const response=await dispatch(options,()=>observeFc27TrafficResult(taskTrade.runtime.services.Item.move(result.entity,root.ItemPile.TRANSFER)));
        // Keep transport errors for the account-wide stop classifier below.
        reply=response;
      }else{
      const permit = await adapter.acquireRequestPermit(action.kind === 'move' ? 'purchase-route' : action.kind);
      assert(); if (permit.status !== 'acquired') return { status: 'rejected', receipt: null, ...errorResult(permit) };
      const permitOptions = { requestPermit: permit.permit };
      if (action.kind === 'buy') result = await dispatch(options, () => bounded(() => adapter.buyNowItem({ ...refFor(action), tradeId: action.tradeId }, action.coins, permitOptions)));
      else if (action.kind === 'move') result = await dispatch(options, () => bounded(() => adapter.routePurchasedItem(exact(action).candidate.item, 'transfer', permitOptions)));
      else if (action.kind === 'list') result = await dispatch(options, () => bounded(() => adapter.listItem(refFor(action, 'transfer'), action.listing, permitOptions)));
      else fail('ACTION_CHANGED');
      }
      if(!result&&reply)result={status:'completed',response:reply};
      assert();if(blocked)throw blocked;
      if (!dispatched) return { status: 'rejected', receipt: null, ...errorResult(result) };
      const buyResponse = ['buy','bid'].includes(action.kind) ? marketTaskBuyResponse(reply) : null;
      if (buyResponse?.rejected) return { status: 'rejected', receipt: null, ...buyResponse };
      const evidence = reply?.data?.itemIds;
      const contradictory = evidence != null && (!Array.isArray(evidence) || evidence.length > 0);
      if (!buyResponse && reply?.success === false && !contradictory && [400, 401, 403, 404, 409, 429, 461].includes(reply.status)) {
        return { status: 'rejected', receipt: null, ...errorResult(result) };
      }
      const acknowledged = reply?.success === true && Number.isSafeInteger(reply.status) && reply.status >= 200 && reply.status < 300
        && Array.isArray(evidence) && evidence.length === 1 && evidence[0] === Number(action.itemId);
      if(action.kind==='bid'&&acknowledged)return {status:'confirmed',acknowledged:true,receipt:{itemId:action.itemId,definitionId:action.definitionId,tradeId:action.tradeId,coins:action.coins}};
      if(listingMove)return acknowledged
        ? {status:'confirmed',acknowledged:true,receipt:{itemId:action.itemId,definitionId:action.definitionId,tradeId:null,coins:0}}
        : {status:'unknown',receipt:null,...errorResult(result)};
      if(action.kind==='list'){
        // EA list sets tradeId and finishes its own refreshAuctions before
        // notifying this response. Do not add a second inventory/auction read.
        const tradeId=listedItem?.getAuctionData?.()?.tradeId;
        const validTradeId=typeof tradeId==='string'?/^[1-9]\d{0,19}$/.test(tradeId):Number.isSafeInteger(tradeId)&&tradeId>0;
        if(acknowledged&&listedItem?.id===Number(action.itemId)&&listedItem.definitionId===action.definitionId
          &&validTradeId&&String(tradeId)!==String(oldListingId)
          &&String(tradeId)!==action.previousTradeId){
          lastOnlineAt=now();
          return {status:'confirmed',acknowledged:true,receipt:{itemId:action.itemId,definitionId:action.definitionId,tradeId:String(tradeId),coins:action.coins}};
        }
        return {status:'unknown',receipt:null,...errorResult(result)};
      }
      const checked = await reconcile({ ...action, ...(acknowledged ? { acknowledged: true } : {}) });
      return { ...checked, ...(acknowledged ? { acknowledged: true } : {}), code: buyResponse?.code ?? checked.code ?? codeOf(result),
        category: buyResponse?.category ?? checked.category ?? errorResult(result).category };
    },
    reconcile,
    async readSales(holdings) {
      assert(); await refresh('transfer');
      const items = repository.getTransferItems();
      if (!Array.isArray(items)) fail('READ_UNCONFIRMED');
      const selected = items.filter(item => holdings.some(h => Number(h.itemId) === item.id && h.definitionId === item.definitionId));
      if (!selected.length) return [];
      await refreshAuctions(selected);
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
    async verifySession() { await guards(); await refresh('transfer'); return capabilities(); },
    sessionHealth: () => ({ lastOnlineAt }),
    async maintainSession({ beforeDispatch, onProgress }) {
      assert(); beforeDispatch();
      const check = () => { assert(); beforeDispatch(); };
      const diagnostic = row => {
        try { Promise.resolve(onDiagnostic?.({area:'trading',event:'task-native',phase:'session-check',...row})).catch(()=>{}); }
        catch { /* Never change maintenance due to logging. */ }
      };
      const startedAt = now();
      let stage = 'session-reader-create';
      const progress = (state, reason) => {
        try { Promise.resolve(onProgress?.({ state, reason })).catch(() => {}); }
        catch { /* Presentation must not change session recovery. */ }
      };
      const failureDiagnostic = error => {
        try {
          diagnostic({ transportPhase: stage, status: 'blocked', localReason: marketReadReason(error),
            durationMs: Math.max(0, now() - startedAt), httpStatus: error.marketFailure?.httpStatus,
            errorCode: error.marketFailure?.eaCode ?? error.code });
        } catch { /* Reading diagnostic properties cannot replace the original failure. */ }
      };
      try {
        diagnostic({ transportPhase: 'session-check-start', status: 'started' });
        const read = async () => {
          stage = 'session-reader-create';
          check(); const reader = await sessionReaderFactory(root, { quotesOnly: true, maxRequests: 1 });
          stage = 'session-read';
          check(); return reader.readSessionHealth({ beforeDispatch: check });
        };
        let result, retried = false, renewed = false;
        for (;;) {
          try { result = await read(); break; }
          catch (error) {
            const details = error.marketFailure, reason = marketReadReason(error);
            // Only a positively identified transport failure of this read can retry.
            // A failed factory, abort, restriction or unknown zero status cannot.
            if (!retried && stage === 'session-read'
              && ['FC27_MARKET_READ_TIMEOUT', 'FC27_MARKET_READ_NETWORK_ERROR'].includes(reason)
              && [details?.httpStatus, details?.eaCode, error.code].every(code => code == null || code === 0)) {
              check(); retried = true; stage = 'session-retry-wait';
              diagnostic({ transportPhase: stage, status: 'started', localReason: reason,
                durationMs: Math.max(0, now() - startedAt) });
              progress('retry-wait', reason);
              // Short waits let stop/account changes release the lock promptly.
              const retryAt = now() + 5000;
              while (now() < retryAt) {
                check(); await sleep(Math.min(250, retryAt - now())); check();
              }
              progress('retrying', reason);
              diagnostic({ transportPhase: 'session-retry-read', status: 'started', localReason: reason });
              continue; // read() constructs a fresh single-use transport.
            }
            if (renewed || details?.httpStatus !== 401 || details.eaCode != null && details.eaCode !== 401) throw error;
            check(); renewed = true;
            diagnostic({transportPhase:'session-expired',status:'received',httpStatus:401});
            stage = 'session-renewal';
            try { await renewSession(root, { beforeDispatch: check, onPhase: diagnostic }); }
            catch (renewalError) { throw Object.assign(Error('MARKET_SESSION_RENEWAL_FAILED'), { code: renewalError.code ?? 401 }); }
            check(); diagnostic({transportPhase:'session-renew-verify',status:'started'});
          }
        }
        check();
        if (result?.status !== 'online') fail('SESSION_UNVERIFIED');
        lastOnlineAt = now();
        diagnostic({transportPhase:'session-online',status:'completed'});
        return { status: 'online', observedAt: lastOnlineAt };
      } catch (error) {
        failureDiagnostic(error);
        const http = error.marketFailure?.httpStatus, ea = error.marketFailure?.eaCode;
        throw Object.assign(Error('MARKET_SESSION_UNVERIFIED'), { code: http === 401 ? http
          : [403, 427, 429, 512, 521, 426, 459].includes(ea) ? ea : http ?? error.code ?? null });
      }
    },
    traffic: () => fc27MarketTraffic(root)?.inspect() ?? null,
    clearTraffic: () => fc27MarketTraffic(root)?.clear(),
    stopTraffic: reason => fc27MarketTraffic(root)?.signal(reason),
  });
}
