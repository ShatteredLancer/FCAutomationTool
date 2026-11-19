import { MARKET_SELL_SCAN_INTERVAL, marketSellMatches } from './market-sell-selection.js';
import {marketIsolated,marketRecoveryBlocks} from './market-recovery.js';
import { marketScheduleGate, marketScheduleWake } from './market-task-schedule.js';
import { marketTaskPrice } from './market-task-prices.js';
import { marketLastListing, marketRelistAllowed } from './market-coordination.js';
import { taskCandidateAllowed } from './task-catalog.js';
import { taskCandidatePage, rotateMarketRatings } from './market-task-catalog.js';
import { marketBuyMode, chooseMarketOffer } from './market-bidding.js';
import { activeMarketAuctions } from './market-auctions.js';
import { marketTaskAutoLists } from './market-task-policy.js';
import { moveGalleryListingPrice } from '../gallery/listing-candidates.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw Error(`MARKET_${reason}`); };
const publicId = n => Number.isSafeInteger(n) && n > 0;

// Task orchestration is independent of the EA transport. The native port MUST
// invoke beforeDispatch synchronously at every market search / mutation, and
// supply independent, exact receipts. Constructing this provider grants no permit.
export function createMarketTaskProvider({ context, native, loadQuotes, assertCurrent, catalog = null,
  now = () => Date.now(), id = () => globalThis.crypto.randomUUID() }) {
  if (!native || typeof assertCurrent !== 'function' || typeof loadQuotes !== 'function') fail('PROVIDER_UNAVAILABLE');
  const cursors = new Map(), prepared = new Map();
  const check = () => { assertCurrent(); };
  const cursor = (task, settings) => {
    const binding = JSON.stringify([context, task, settings]);
    let value = cursors.get(task.id);
    if (value?.binding !== binding) {
      value = { binding, index: 0, offers: [], salesAt: 0 };
      cursors.set(task.id, value); prepared.delete(task.id);
    }
    return value;
  };
  const price = (task, settings, definitionId, side, quotes) => marketTaskPrice({ task, source: settings.source,
    player: task.mode === 'fixed' ? task.players.find(p => p.definitionId === definitionId) : null, quotes, definitionId, side,
    context, now: now(), priceTiers: native.priceTiers(), rating:cursors.get(task.id)?.catalog?.find(definitionId)?.rating });
  const priceFor = async (task, settings, definitionId, side) => {
    const player = task.mode === 'fixed' ? task.players.find(p => p.definitionId === definitionId) : null;
    const fixed = task.ratingPrices || (side === 'bid' ? player?.cap != null || task.settings.bidRule === 'fixed' : side === 'buy' ? player?.cap != null || task.settings.buyRule === 'fixed' : task.settings.sellRule === 'fixed');
    const quotes = fixed ? null : await loadQuotes([definitionId], { source: settings.source, context }); check();
    return { ...price(task, settings, definitionId, side, quotes?.[definitionId]), quotes: quotes?.[definitionId] ?? null };
  };
  const remember = (task, settings, action) => {
    const result = { ...action, ...(task.ratingPrices&&['search','buy','bid','list'].includes(action.kind)?{rating:cursors.get(task.id)?.catalog?.find(action.definitionId)?.rating}:{}), taskId: task.id, token: id(), expiresAt: Math.min(action.expiresAt ?? Infinity,
      now() + (['search','inventory'].includes(action.kind) ? 300000 : 30000)) };
    prepared.set(task.id, { task: structuredClone(task), settings: structuredClone(settings), action: structuredClone(result) });
    return result;
  };
  const bound = (action, task = null, settings = null) => {
    check(); const saved = prepared.get(action.taskId);
    if (!saved || !same(saved.action, action) || task && !same(saved.task, task) || settings && !same(saved.settings, settings)) fail('ACTION_CHANGED');
    if (!marketScheduleGate(saved.task, cursors.get(action.taskId)?.schedule, action.kind, action, now())) fail('SCHEDULE_WINDOW_CLOSED');
    if (action.expiresAt <= now()) fail('ACTION_EXPIRED_OR_INVALID');
    if (saved.task.mode === 'filter' && ['search','buy','bid'].includes(action.kind)) {
      const c = cursors.get(action.taskId), row = c?.catalog?.find(action.definitionId);
      if (!c?.isCurrent?.() || !row || !taskCandidateAllowed(row, saved.task)) fail('CANDIDATE_CHANGED');
    }
    return saved;
  };
  const holdingFor = (ledger, task, action) => {
    const held = ledger.holdings.find(h => h.itemId === action.itemId);
    if (!held || held.taskId !== task.id || held.definitionId !== action.definitionId) fail('ITEM_OCCUPIED');
    return held;
  };
  const nextPurchase = (task, settings, ledger) => {
    const c=cursor(task,settings), held=ledger.holdings.filter(h=>h.taskId===task.id);
    while (c.offers.length) {
        const offer = c.offers[0], row = (task.mode === 'filter' ? c.rows : task.players).find(p => p.definitionId === offer.definitionId);
        const copies = held.filter(h => h.definitionId === offer.definitionId && h.phase !== 'sold').length
          +activeMarketAuctions(ledger).filter(a=>a.taskId===task.id&&a.definitionId===offer.definitionId).length;
        const cap = task.mode === 'filter' ? task.settings.perVersion : row?.qty;
        if (marketRecoveryBlocks(ledger,{...offer,taskId:task.id}) || !row || offer.expiresAt <= now() || ledger.intents.some(i => ['buy','bid'].includes(i.kind) && i.tradeId === offer.tradeId)
          || cap != null && copies >= cap || task.mode === 'filter' && !taskCandidateAllowed(row, task)) { c.offers.shift(); continue; }
        return remember(task, settings, { ...offer, kind: offer.kind??'buy' });
      }
    return null;
  };
  const purchasePrices=(task,settings,definitionId,quotes)=>{
    const mode=marketBuyMode(task),result={buy:null,bid:null};
    for(const side of mode==='bin'?['buy']:mode==='bid'?['bid']:['buy','bid'])result[side]=price(task,settings,definitionId,side,quotes);
    return result;
  };
  const searchAction=(task,settings,row,quotes)=>{
    const c=cursor(task,settings),mode=marketBuyMode(task),prices=purchasePrices(task,settings,row.definitionId,quotes);
    const searchMode=mode==='both'?(c.searchMode??'bin'):mode;
    return remember(task,settings,{kind:'search',definitionId:row.definitionId,
      maxBuy:prices.buy?.price??null,maxBid:prices.bid?.price??null,searchMode,
      quotes:quotes??null,expiresAt:Math.min(...Object.values(prices).filter(Boolean).map(p=>p.expiresAt??Infinity)),limit:settings.perSearch});
  };
  const api = {
    dispatchBoundary: true,
    nextPurchase: ({task,settings,ledger}) => { check(); return nextPurchase(task,settings,ledger); },
    discardOffers: taskId => { const c=cursors.get(taskId); if(c)c.offers=[]; },
    finishPurchaseBatch: ({ task, ledger, reason }) => {
      check(); const c = cursors.get(task.id);
      // Only a local, definite no-send limit may defer its pause long enough to
      // handle purchases already confirmed. Unknown/auth/user stops never drain.
      if (!c || !['MARKET_TRANSFER_FULL','MARKET_FUNDS_OR_CAPACITY','MARKET_HOLDING_CAP','MARKET_SPEND_CAP','MARKET_VERSION_CAP'].includes(reason)
        || ledger.intents.some(i => i.phase === 'pending')
        || !ledger.holdings.some(h => h.taskId === task.id && h.phase === 'held')) return false;
      c.offers = [];
      c.purchaseStop = task.schedule && reason === 'MARKET_TRANSFER_FULL' ? null : reason;
      return true;
    },
    traffic: () => native.traffic?.() ?? null,
    clearTraffic: () => native.clearTraffic?.(),
    stopTraffic: reason => native.stopTraffic?.(reason),
    async checkCapacity(task) { return native.preflight({ action: { kind: 'search' }, task }); },
    async begin({ task, settings, isCurrent = () => true }) {
      check(); cursors.delete(task.id); prepared.delete(task.id);
      const c = cursor(task, settings); c.isCurrent = isCurrent;
      if (task.mode === 'filter') {
        if (!catalog?.read) fail('CATALOG_UNAVAILABLE');
        const snapshot = await catalog.read({ isCurrent }); check();
        if (!isCurrent()) fail('USER_STOP');
        if (snapshot.context !== JSON.stringify(context)) fail('CONTEXT_CHANGED');
        c.catalog = await rotateMarketRatings(snapshot,task,isCurrent); c.next = 0; c.rows = []; c.quotes = {}; c.matched = 0; c.cycled = false;
      }
    },
    describe(taskId) {
      const c = cursors.get(taskId);
      if(c?.sellRows)return {known:c.sellRows.length,matched:c.sellRows.length,batch:c.sellRows.length,missing:0,complete:true};
      return c?.catalog ? { revision: c.catalog.revision, known: c.catalog.rows.length, matched: c.matched,
        batch: c.rows.length, missing: c.missing ?? 0, currentRating:c.rows[c.index]?.rating??null, complete: false } : null;
    },
    async prepare({ task, settings, ledger }) {
      check(); if (!['fixed', 'sell', 'filter'].includes(task.mode)) fail('TASK_SELECTION_INVALID');
      if(marketIsolated(ledger,task.id).length)fail('RECOVERY_ISOLATED');
      const c = cursor(task, settings), held = ledger.holdings.filter(h => h.taskId === task.id);
      c.schedule = ledger.schedules?.find(r => r.taskId === task.id);
      const auctions=activeMarketAuctions(ledger).filter(a=>a.taskId===task.id);
      if(auctions.length&&now()>=(c.auctionsAt??0))return remember(task,settings,{kind:'auctions'});
      if(marketBuyMode(task)!=='bin'&&task.settings.bidRebid==='yes'&&marketScheduleGate(task,c.schedule,'bid',null,now())){
        const outbid=auctions.find(a=>a.state==='outbid'&&c.auctionOffers?.some(o=>o.tradeId===a.tradeId));
        if(outbid){
          const seen=c.auctionOffers.find(o=>o.tradeId===outbid.tradeId);c.auctionOffers=c.auctionOffers.filter(o=>o!==seen);
          const p=await priceFor(task,settings,outbid.definitionId,'bid');
          const chosen=chooseMarketOffer({offer:seen,buyMode:'bid',bidCap:p.price,bidExact:task.settings.bidExact,bidExpires:task.settings.bidExpires,priceTiers:native.priceTiers()});
          if(chosen)return remember(task,settings,{...chosen,itemId:outbid.itemId,definitionId:outbid.definitionId,tradeId:outbid.tradeId,
            quotes:p.quotes,rebid:true,expiresAt:Math.min(p.expiresAt??Infinity,seen.expiresAt??0)});
        }
      }
      const scheduleWait = () => { const wake = marketScheduleWake(task, c.schedule, ledger.holdings, now(),h=>marketRelistAllowed(ledger,task,h));
        if(auctions.length)return {kind:'wait',until:Math.max(now()+1000,Math.min(wake??Infinity,c.auctionsAt??now()+30000)),scheduleWait:true};
        return wake === null ? { kind: 'done' } : { kind: 'wait', until: Math.max(now()+1000,wake), scheduleWait: true }; };
      if (task.mode === 'filter' && (!c.catalog || !c.isCurrent?.())) fail('CATALOG_UNAVAILABLE');
      // Finish this search's bounded purchase candidates before won-item work.
      // A new search still waits for all due move/list work below.
      if (marketScheduleGate(task, c.schedule, 'buy', null, now()) && !c.purchaseStop) {
        const offerAction = nextPurchase(task, settings, ledger);
        if (offerAction) return offerAction;
      } else c.offers = [];
      const due = h => marketTaskAutoLists(task) && (h.phase === 'transfer' && marketScheduleGate(task, c.schedule, 'list', h, now()) || marketRelistAllowed(ledger, task, h));
      if(task.mode==='sell'&&task.sellSelection&&marketScheduleGate(task,c.schedule,'claim',null,now())&&now()>=(c.nextSellScan??0))return remember(task,settings,{kind:'inventory'});
      const candidates=task.mode==='sell'?(task.sellSelection?c.sellRows??[]:task.owned):[];
      const pileRank=row=>({transfer:0,unassigned:1,club:2}[row?.pile]??2);
      const unclaimed=[...candidates].sort((a,b)=>pileRank(a)-pileRank(b)).find(row=>!ledger.holdings.some(h=>h.itemId===row.itemId)&&!marketRecoveryBlocks(ledger,{...row,taskId:task.id}));
      const orderedHeld=task.mode==='sell'?[...held].sort((a,b)=>{
        const rank=h=>h.phase!=='held'?1:pileRank(candidates.find(r=>r.itemId===h.itemId));
        return rank(a)-rank(b);
      }):held;
      const pending = task.schedule ? orderedHeld.find(due) ?? orderedHeld.find(h=>h.phase==='held') : orderedHeld.find(h => h.phase === 'held' || due(h));
      // Resume already moved cards first, but do not move a Club holding ahead
      // of unclaimed external cards, including after a task restart.
      if(task.mode==='sell'&&unclaimed&&pileRank(unclaimed)<2&&pending?.phase==='held'
        &&pileRank(candidates.find(r=>r.itemId===pending.itemId))===2&&marketScheduleGate(task,c.schedule,'claim',null,now())){
        return remember(task,settings,{kind:'claim',itemId:unclaimed.itemId,definitionId:unclaimed.definitionId,pile:unclaimed.pile});
      }
      if (pending) {
        const action = { kind: pending.phase === 'held' ? 'move' : 'list', itemId: pending.itemId,
          definitionId: pending.definitionId, coins: 0, ...(pending.sellAt !== undefined ? { sellAt: pending.sellAt } : {}) };
        const won=ledger.auctions?.find(a=>a.state==='won'&&a.taskId===task.id&&a.itemId===pending.itemId&&a.definitionId===pending.definitionId);
        if(action.kind==='move'&&won)action.wonAuction={itemId:won.itemId,definitionId:won.definitionId,tradeId:won.tradeId,coins:won.coins};
        if (action.kind === 'list') {
          if (pending.phase === 'unsold') {
            action.previousTradeId = pending.listingTradeId;
            action.previousListing = marketLastListing(ledger, pending);
            if (!action.previousListing) fail('RECEIPT_CONFLICT');
          }
          if (action.previousTradeId && task.settings.relist === 'original') {
            action.listing = structuredClone(action.previousListing); action.coins = action.listing.buyNow;
          } else {
            const p = await priceFor(task, settings, pending.definitionId, 'sell');
            Object.assign(action, { coins: p.price, quotes: p.quotes, expiresAt: p.expiresAt,
              listing: { startPrice: moveGalleryListingPrice(p.price, -1, native.priceTiers()), buyNow: p.price, durationSeconds: task.settings.duration } });
          }
        }
        return remember(task, settings, action);
      }
      if (c.purchaseStop) throw Error(c.purchaseStop);
      if (task.mode === 'sell') {
        if (unclaimed && marketScheduleGate(task, c.schedule, 'claim', null, now())) return remember(task, settings, { kind: 'claim', itemId: unclaimed.itemId, definitionId: unclaimed.definitionId, pile: unclaimed.pile });
      }
      if (held.some(h => h.phase === 'listed') && now() >= c.salesAt) return remember(task, settings, { kind: 'sales' });
      if (task.schedule && (task.mode === 'sell' && (held.some(h=>h.phase==='transfer') || task.owned.some(r=>!held.some(h=>h.itemId===r.itemId)))
        || task.mode !== 'sell' && !marketScheduleGate(task,c.schedule,'buy',null,now()))) return scheduleWait();
      if(task.mode==='sell'&&task.sellSelection)return {kind:'wait',until:Math.max(now()+1000,Math.min(c.nextSellScan??now(),held.some(h=>h.phase==='listed')?c.salesAt:Infinity))};
      if (task.mode === 'sell') return held.some(h => h.phase === 'listed') ? { kind: 'wait', until: Math.max(now() + 1000, c.salesAt) }
        : { kind: 'done', ...(held.some(h => h.phase === 'unsold') ? { reason: 'MARKET_RELIST_PAUSED' } : {}) };
      if (task.mode === 'filter') {
        if (c.index >= c.rows.length) {
          if (c.next >= c.catalog.candidates.length) { c.next = 0; c.cycled = true; }
          const page = await taskCandidatePage(c.catalog, task, { cursor: c.next, isCurrent: c.isCurrent }); check();
          if (!c.isCurrent()) fail('USER_STOP');
          c.rows = page.rows; c.next = page.next; c.index = 0; c.quotes = {}; c.quotedAt = null;
          if (!c.cycled) c.matched += c.rows.length;
          if (!c.rows.length) {
            if (!c.matched) fail('CATALOG_EMPTY');
            return { kind: 'wait', until: now() + 30000 };
          }
        }
        const eligible = c.rows.slice(c.index).filter(row => !marketRecoveryBlocks(ledger,{taskId:task.id,definitionId:row.definitionId}) && (task.settings.perVersion === null
          || held.filter(h => h.definitionId === row.definitionId && h.phase !== 'sold').length+auctions.filter(a=>a.definitionId===row.definitionId).length < task.settings.perVersion));
        const needsQuotes=!task.ratingPrices&&((marketBuyMode(task)!=='bid'&&task.settings.buyRule!=='fixed')||(marketBuyMode(task)!=='bin'&&task.settings.bidRule!=='fixed'));
        if (needsQuotes && eligible.length && (c.quotedAt === null || now() - c.quotedAt >= 30000
          && eligible.some(row => { try { purchasePrices(task, settings, row.definitionId, c.quotes[row.definitionId]); return false; } catch { return true; } }))) {
          c.quotes = await loadQuotes(eligible.map(row => row.definitionId), { source: settings.source, context, rows: eligible, isCurrent: c.isCurrent }); check();
          if (!c.isCurrent()) fail('USER_STOP');
          c.quotedAt = now(); c.missing = 0;
          for (const row of eligible) {
            try { purchasePrices(task, settings, row.definitionId, c.quotes[row.definitionId]); }
            catch (error) { if (error.message !== 'MARKET_REFERENCE_UNAVAILABLE') throw error; c.missing++; }
          }
          if (c.missing === eligible.length) fail('REFERENCE_UNAVAILABLE');
        }
        for (; c.index < c.rows.length; c.index++) {
          const row = c.rows[c.index]; if (!eligible.includes(row)) continue;
          try { return searchAction(task,settings,row,c.quotes[row.definitionId]); }
          catch (error) { if (error.message !== 'MARKET_REFERENCE_UNAVAILABLE') throw error; continue; }
        }
        return { kind: 'wait', until: now() + (c.next >= c.catalog.candidates.length ? 30000 : 1000) };
      }
      for (let i = 0; i < task.players.length; i++) {
        const row = task.players[(c.index + i) % task.players.length];
        if(marketRecoveryBlocks(ledger,{taskId:task.id,definitionId:row.definitionId}))continue;
        const copies = held.filter(h => h.definitionId === row.definitionId && h.phase !== 'sold').length+auctions.filter(a=>a.definitionId===row.definitionId).length;
        if (row.qty !== null && copies >= row.qty) continue;
        const side=marketBuyMode(task)==='bid'?'bid':'buy';
        let p = await priceFor(task, settings, row.definitionId, side);
        if(marketBuyMode(task)==='both'&&task.settings.bidRule!=='fixed'&&!p.quotes)p=await priceFor(task,settings,row.definitionId,'bid');
        return searchAction(task,settings,row,p.quotes);
      }
      return { kind: 'wait', until: Math.max(now() + 1000, c.salesAt) };
    },
    async preflight({ task, settings, action, ledger, executionScope }) {
      bound(action, task, settings);
      if(action.kind==='inventory'){
        if(task.mode!=='sell'||!task.sellSelection||typeof native.discoverOwned!=='function')fail('SELL_SCAN_UNAVAILABLE');
        const c=cursors.get(task.id),rows=await native.discoverOwned({task,isCurrent:()=>{bound(action,task,settings);return c.isCurrent?.()===true;}});
        bound(action,task,settings);
        if(!Array.isArray(rows)||rows.length>20500||rows.some(r=>!publicId(Number(r.itemId))||!publicId(r.definitionId)||!marketSellMatches(task.sellSelection,r))||new Set(rows.map(r=>r.itemId)).size!==rows.length)fail('SELL_SCAN_UNAVAILABLE');
        return {ready:true,inventory:rows};
      }
      if(action.kind==='auctions'){
        const auctions=activeMarketAuctions(ledger).filter(a=>a.taskId===task.id);
        const result=await native.readAuctions(auctions);bound(action,task,settings);
        cursors.get(task.id).auctionOffers=result.offers.map(o=>({...o,expiresAt:now()+30000}));
        return {ready:true,auctions:result.receipts};
      }
      if (action.kind === 'claim') {
        const row = (task.sellSelection?cursors.get(task.id)?.sellRows??[]:task.owned).find(r => r.itemId === action.itemId && r.definitionId === action.definitionId);
        if (task.mode !== 'sell' || !row || ledger.holdings.some(h => h.itemId === row.itemId)) fail('ITEM_OCCUPIED');
        let facts;
        try{facts=await native.inspectOwned({...row},{task});}catch(error){
          if(task.sellSelection&&['MARKET_HOLDING_UNAVAILABLE','MARKET_HOLDING_PROTECTED','FC27_GALLERY_LISTING_ITEM_CHANGED'].includes(error.message)){bound(action,task,settings);return {ready:true,skip:true};}throw error;
        }
        bound(action,task,settings);
        if(task.sellSelection&&!marketSellMatches(task.sellSelection,facts))fail('HOLDING_PROTECTED');
        if (!facts?.eligible || facts.itemId !== row.itemId || facts.definitionId !== row.definitionId
          || !['club', 'unassigned', 'transfer'].includes(facts.pile)) fail('HOLDING_UNAVAILABLE');
        return { ready: true, holding: { taskId: task.id, itemId: row.itemId, definitionId: row.definitionId, cost: facts.cost },
          holdingPhase: facts.pile === 'transfer' ? 'transfer' : 'held', ...(task.sellSelection?{selectionFacts:{rating:facts.rating,pile:facts.pile}}:{}) };
      }
      if (action.kind === 'sales') {
        const held = ledger.holdings.filter(h => h.taskId === task.id && h.phase === 'listed').map(h => ({ ...h,
          listing: marketLastListing(ledger, h) }));
        const sales = await native.readSales(held); bound(action, task, settings);
        return { ready: true, sales };
      }
      if(action.kind==='search'&&marketBuyMode(task)!=='bin'){
        const prices=purchasePrices(task,settings,action.definitionId,action.quotes);
        if((prices.buy?.price??null)!==action.maxBuy||prices.bid?.price!==action.maxBid)fail('PRICE_CHANGED');
      }else if (['search', 'buy', 'bid', 'list'].includes(action.kind) && !(action.previousTradeId && task.settings.relist === 'original')) {
        const p = price(task, settings, action.definitionId, action.kind === 'list' ? 'sell' : action.kind==='bid'?'bid':'buy', action.quotes);
        if (action.kind === 'search' && p.price !== action.maxBuy || action.kind === 'buy' && action.coins > p.price
          || action.kind==='bid'&&action.coins>p.price || action.kind === 'list' && action.coins !== p.price) fail('PRICE_CHANGED');
      }
      if (['move', 'list'].includes(action.kind)) {
        const holding = holdingFor(ledger, task, action);
        if (action.previousTradeId) {
          if (!marketRelistAllowed(ledger, task, holding) || holding.listingTradeId !== action.previousTradeId
            || !same(marketLastListing(ledger, holding), action.previousListing)
            || task.settings.relist === 'original' && !same(action.listing, action.previousListing)) fail('ITEM_OCCUPIED');
        } else if (holding.phase !== (action.kind === 'move' ? 'held' : 'transfer')) fail('ITEM_OCCUPIED');
      }
      const result = await native.preflight({ task, settings, action, ledger, executionScope }); bound(action, task, settings); return result;
    },
    async send({ action, requestId, beforeDispatch, beforeRequest, executionScope }) {
      const saved = bound(action);
      // The final callback is passed through to the *native* call. Calling it
      // before an awaited pacing/permit step would restore the cancellation bug.
      return native.send({ ...saved, action, requestId, executionScope, beforeRequest: async () => { bound(action); await beforeRequest?.(); bound(action); },
        beforeDispatch: () => { bound(action); beforeDispatch(); } });
    },
    async accept({ action, response, ledger }) {
      check(); const c = cursors.get(action.taskId); if (!c) return;
      if(action.kind==='inventory'){c.sellRows=response.inventory;c.nextSellScan=now()+MARKET_SELL_SCAN_INTERVAL;}
      if(action.kind==='claim'&&response.skip)c.sellRows=c.sellRows.filter(r=>r.itemId!==action.itemId);
      if (action.kind === 'sales') c.salesAt = now() + 30000;
      if (action.kind === 'auctions') c.auctionsAt=now()+30000;
      if (['buy','bid'].includes(action.kind)) c.offers = c.offers.filter(o => o.tradeId !== action.tradeId);
      if (action.kind === 'search') {
        const saved = prepared.get(action.taskId);
        if(marketBuyMode(saved.task)==='both'&&action.searchMode==='bin')c.searchMode='bid';
        else {c.searchMode='bin';c.index = saved.task.mode === 'filter' ? c.rows.findIndex(p => p.definitionId === action.definitionId) + 1
          : (saved.task.players.findIndex(p => p.definitionId === action.definitionId) + 1) % saved.task.players.length;
        }
        if (response.sent === true && response.status === 'confirmed') {
          if (!Array.isArray(response.offers) || response.offers.length > 21) fail('SEARCH_UNCONFIRMED');
          const seen = new Set();
          c.offers = response.offers.map(o=>{
            if(marketBuyMode(saved.task)==='bin')return o;
            const selected=chooseMarketOffer({offer:o,buyMode:marketBuyMode(saved.task),buyCap:action.maxBuy,bidCap:action.maxBid,
              bidExact:saved.task.settings.bidExact,bidExpires:saved.task.settings.bidExpires,priceTiers:native.priceTiers()});
            return selected?{...o,...selected}:null;
          }).filter(o => {
            if(!o)return false;
            const key = `${o.itemId}:${o.tradeId}`;
            if (!publicId(Number(o.itemId)) || String(Number(o.itemId)) !== o.itemId || o.definitionId !== action.definitionId
              || typeof o.tradeId !== 'string' || !/^[1-9]\d{0,19}$/.test(o.tradeId)
              || !Number.isSafeInteger(o.coins) || o.coins < 150 || o.coins > (o.kind==='bid'?action.maxBid:action.maxBuy) || seen.has(key)
              || ledger.intents.some(i => ['buy','bid'].includes(i.kind) && i.tradeId === o.tradeId)) return false;
            seen.add(key); return true;
          }).sort((a, b) => a.coins - b.coins).slice(0, action.limit).map(o => ({ itemId: o.itemId, definitionId: o.definitionId,
            tradeId: o.tradeId, coins: o.coins, ...(o.kind?{kind:o.kind}:{}), quotes: action.quotes, expiresAt: action.expiresAt }));
        } else c.offers = [];
        return { acceptedCount: c.offers.length };
      }
    },
    reconcile: intent => { check(); return native.reconcile(structuredClone(intent), { recovery: true }); },
    inspectHolding: async holding => { check(); const result = await native.inspectOwned(holding); check(); return result; },
    readHoldings: async holdings => { check(); const result = await native.readSales(holdings); check(); return result; },
    readAuctions: async auctions => {check();const result=await native.readAuctions(auctions);check();return result;},
    verifySession: () => { check(); return native.verifySession(); },
    sessionHealth: () => native.sessionHealth?.() ?? null,
    ...(typeof native.maintainSession === 'function' ? { maintainSession: args => { check(); return native.maintainSession(args); } } : {}),
  };
  return Object.freeze(api);
}
