import {marketUnresolved,marketIsolated,marketRecoveryBlocks,validateMarketIsolation} from './market-recovery.js';
import { marketTaskAutoLists } from './market-task-policy.js';
import { activeMarketAuctions, validateMarketAuctions, confirmMarketBid } from './market-auctions.js';
export { settleMarketAuction } from './market-auctions.js';
import { validateMarketSchedules } from './market-task-schedule.js';
// Account-wide bookkeeping primitives. They do not authorize or send requests.
// P3 adapters must supply freshly verified EA facts and exact receipts.
import { validateMarketClocks } from './market-task-clock.js';
const fail = reason => { throw Error(`MARKET_${reason}`); };
const number = (value, min = 0) => {
  if (!Number.isSafeInteger(value) || value < min) fail('INVALID');
  return value;
};
const id = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) fail('INVALID');
  return value;
};
const fields = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID');
};
const choice = (value, choices) => { if (!choices.includes(value)) fail('INVALID'); return value; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DAY = 86400000;
const HOUR = 3600000;
export const MARKET_COORDINATION_BYTES = 1000000;

export const emptyMarketCoordination = () => ({ schema: 1, revision: 0, lastTask: null,
  searches: [], nextSearchAt: 0, cycleCount: 0, cycleTarget: null, stopped: null,
  intents: [], holdings: [] });

export function readMarketCoordination(value) {
  if (value == null) return emptyMarketCoordination();
  fields(value, [...Object.keys(emptyMarketCoordination()), 'clocks', 'handoffs', 'schedules', 'auctions']);
  if(value.auctions!==undefined)validateMarketAuctions(value.auctions);
  if (value.schedules !== undefined) validateMarketSchedules(value.schedules);
  if (value.clocks !== undefined) validateMarketClocks(value.clocks);
  if (value.handoffs !== undefined) {
    if (!Array.isArray(value.handoffs) || value.handoffs.length > 2000) fail('STORAGE_LIMIT');
    for (const h of value.handoffs) {
      fields(h, ['fromTaskId', 'toTaskId', 'itemId', 'definitionId', 'at', 'cost']);
      id(h.fromTaskId); id(h.toTaskId); id(h.itemId); number(h.definitionId, 1); number(h.at);
      if (h.fromTaskId === h.toTaskId) fail('INVALID');
      if (h.cost !== null) number(h.cost);
    }
  }
  if (value.schema !== 1) fail('INVALID');
  number(value.revision); number(value.nextSearchAt); number(value.cycleCount);
  if (value.lastTask !== null) id(value.lastTask);
  if (value.cycleTarget !== null) number(value.cycleTarget, 1);
  if (value.stopped !== null) choice(value.stopped, ['authentication', 'captcha', 'throttle', 'unknown-write', 'manual']);
  for (const [key, max] of [['searches', 10000], ['intents', 2000], ['holdings', 2000]]) {
    if (!Array.isArray(value[key]) || value[key].length > max) fail('STORAGE_LIMIT');
  }
  for (const event of value.searches) {
    fields(event, ['id', 'at', 'status']); id(event.id); number(event.at);
    choice(event.status, ['dispatching', 'sent', 'not-sent']);
  }
  for (const entry of value.intents) {
    fields(entry, ['id', 'taskId', 'kind', 'itemId', 'definitionId', 'tradeId', 'coins', 'at', 'phase', 'receipt', 'listing', 'acknowledged', 'previousTradeId', 'sellAt', 'resolution', 'isolation']);
    if (entry.sellAt !== undefined) { number(entry.sellAt); if (!['buy','bid'].includes(entry.kind)) fail('INVALID'); }
    if (entry.previousTradeId !== undefined) { id(entry.previousTradeId); if (entry.kind !== 'list' || !entry.listing) fail('INVALID'); }
    id(entry.id); id(entry.taskId); id(entry.itemId); number(entry.definitionId, 1); number(entry.at);
    choice(entry.kind, ['buy', 'bid', 'move', 'list']); choice(entry.phase, ['pending', 'isolated', 'confirmed', 'rejected', 'resolved']);
    if(entry.phase==='isolated'||entry.isolation!==undefined)validateMarketIsolation(entry);
    if(entry.phase==='pending'&&entry.isolation!==undefined)fail('RECOVERY_INVALID');
    if (entry.phase === 'resolved') validateUnlistedResolution(entry, entry.resolution);
    else if (entry.resolution !== undefined) fail('RECEIPT_CONFLICT');
    if (entry.tradeId !== null) id(entry.tradeId);
    if (['buy','bid'].includes(entry.kind) && entry.tradeId === null) fail('INVALID');
    number(entry.coins, entry.kind === 'move' ? 0 : 150);
    if (entry.coins > 15000000 || entry.kind === 'move' && entry.coins !== 0) fail('INVALID');
    if (entry.acknowledged !== undefined && entry.acknowledged !== true) fail('INVALID');
    if (entry.acknowledged && entry.phase === 'rejected') fail('RECEIPT_CONFLICT');
    if (entry.listing !== undefined) {
      fields(entry.listing, ['startPrice', 'buyNow', 'durationSeconds']);
      if (entry.kind !== 'list' || entry.listing.buyNow !== entry.coins) fail('INVALID');
      number(entry.listing.startPrice, 150);
      if (entry.listing.startPrice > entry.coins) fail('INVALID');
      choice(entry.listing.durationSeconds, [3600, 10800, 21600, 43200, 86400, 259200]);
    }
    if (entry.phase === 'confirmed') validateReceipt(entry, entry.receipt);
    else if (entry.receipt !== null) fail('INVALID');
  }
  for (const holding of value.holdings) {
    fields(holding, ['taskId', 'itemId', 'definitionId', 'cost', 'phase', 'listingTradeId', 'salePrice', 'sellAt']);
    if (holding.sellAt !== undefined) number(holding.sellAt);
    id(holding.taskId); id(holding.itemId); number(holding.definitionId, 1);
    if (holding.cost !== null) number(holding.cost);
    choice(holding.phase, ['held', 'transfer', 'listed', 'unsold', 'sold']);
    if (holding.listingTradeId !== null) id(holding.listingTradeId);
    if (['listed', 'unsold', 'sold'].includes(holding.phase) && holding.listingTradeId === null) fail('INVALID');
    if (holding.phase === 'sold') { number(holding.salePrice, 150); if (holding.salePrice > 15000000) fail('INVALID'); }
    else if (holding.salePrice !== null) fail('INVALID');
  }
  for (const [rows, key] of [[value.searches, 'id'], [value.intents, 'id'], [value.holdings, 'itemId']]) {
    if (new Set(rows.map(row => row[key])).size !== rows.length) fail('INVALID');
  }
  if (new Set(value.intents.filter(marketUnresolved).map(i => i.itemId)).size
    !== value.intents.filter(marketUnresolved).length) fail('INVALID');
  if (new globalThis.TextEncoder().encode(JSON.stringify(value)).length > MARKET_COORDINATION_BYTES) fail('STORAGE_LIMIT');
  return structuredClone(value);
}

function windowRelease(events, limit, window, now) {
  number(limit, 1);
  const times = events.filter(e => e.status !== 'not-sent' && e.at + window > now).map(e => e.at).sort((a, b) => a - b);
  // If limits were lowered, more than one event may need to expire.
  return { count: times.length, at: times.length < limit ? now : times[times.length - limit] + window };
}

export function marketSearchGate(state, settings, now) {
  number(now);
  const hour = windowRelease(state.searches, settings.hourLimit, HOUR, now);
  const day = windowRelease(state.searches, settings.dayLimit, DAY, now);
  return { hour: hour.count, day: day.count, nextAt: Math.max(now, hour.at, day.at, state.nextSearchAt),
    uncertain: state.searches.filter(e => e.status === 'dispatching' && e.at + DAY > now).length,
    recoveryRequired: state.intents.some(i => i.phase === 'pending'),
    stopped: state.stopped };
}

function randomSeconds(min, max, random) {
  number(min); number(max); if (max < min) fail('INVALID');
  const value = random(); if (!Number.isFinite(value) || value < 0 || value >= 1) fail('INVALID');
  return min + Math.floor(value * (max - min + 1));
}

// Persist immediately before dispatch. A crash between persistence and sending
// is displayed as uncertain and conservatively occupies the rolling window.
export function reserveMarketSearch(state, { requestId, now, settings, random = Math.random, externalGate = false }) {
  id(requestId);
  const gate = marketSearchGate(state, settings, now);
  if (gate.stopped) fail('STOPPED');
  if (gate.recoveryRequired) fail('RECOVERY_REQUIRED');
  if (!externalGate && gate.nextAt > now) fail('SEARCH_WAIT');
  if (state.searches.some(e => e.id === requestId)) fail('DUPLICATE_REQUEST');
  state.searches = state.searches.filter(e => e.at + DAY > now);
  state.searches.push({ id: requestId, at: now, status: 'dispatching' });
  // The shared FC27 transport performs the quota/pace check at native dispatch.
  // This ledger retains only the task's exact send/no-send evidence in that mode.
  if (externalGate) return;
  state.cycleTarget ??= randomSeconds(settings.cycleMin, settings.cycleMax, random);
  let wait = randomSeconds(settings.gapMin, settings.gapMax, random);
  state.cycleCount++;
  if (state.cycleCount >= state.cycleTarget) {
    wait += randomSeconds(settings.restMin, settings.restMax, random);
    state.cycleCount = 0; state.cycleTarget = null;
  }
  state.nextSearchAt = now + wait * 1000;
}

export function settleMarketSearch(state, requestId, status) {
  choice(status, ['sent', 'not-sent']);
  const event = state.searches.find(e => e.id === requestId);
  if (!event || event.status !== 'dispatching') fail('RECEIPT_CONFLICT');
  event.status = status;
  // A definite no-send releases quota, but never shortens shared pacing.
}

export function marketOccupancy(state, taskId = null) {
  const pending = state.intents.filter(i => marketUnresolved(i) && ['buy','bid'].includes(i.kind) && (taskId === null || i.taskId === taskId));
  const auctions=activeMarketAuctions(state).filter(a=>(taskId===null||a.taskId===taskId)&&!pending.some(i=>i.tradeId===a.tradeId));
  const held = state.holdings.filter(h => h.phase !== 'sold' && (taskId === null || h.taskId === taskId));
  return { reservedCoins: pending.reduce((sum, i) => sum + i.coins, 0),
    holdingCoins: held.reduce((sum, h) => sum + (h.cost ?? 0), 0)+auctions.reduce((sum,a)=>sum+a.coins,0),
    unknownCosts: held.filter(h => h.cost === null).length,
    count: held.length + pending.length + auctions.length,
    spent: state.intents.filter(i => i.kind === 'buy' && i.phase === 'confirmed' && (taskId === null || i.taskId === taskId))
      .reduce((sum, i) => sum + i.coins, 0)+(state.auctions??[]).filter(a=>a.state==='won'&&(taskId===null||a.taskId===taskId)).reduce((sum,a)=>sum+a.coins,0) };
}

export function claimMarketHolding(state, holding, phase = 'held') {
  fields(holding, ['taskId', 'itemId', 'definitionId', 'cost', 'sellAt']);
  if (holding.sellAt !== undefined) number(holding.sellAt);
    id(holding.taskId); id(holding.itemId); number(holding.definitionId, 1);
  if (holding.cost !== null) number(holding.cost);
  if(marketRecoveryBlocks(state,holding))fail('RECOVERY_ISOLATED');
  if (state.holdings.some(h => h.itemId === holding.itemId) || state.intents.some(i => i.itemId === holding.itemId && i.phase === 'pending')) fail('ITEM_OCCUPIED');
  choice(phase, ['held', 'transfer']);
  state.holdings.push({ ...holding, phase, listingTradeId: null, salePrice: null });
}

export function reserveMarketWrite(state, command, funds) {
  fields(command, ['id', 'taskId', 'kind', 'itemId', 'definitionId', 'tradeId', 'coins', 'at', 'listing', 'previousTradeId', 'sellAt']);
  const entry = { ...command, phase: 'pending', receipt: null };
  // Validate before changing any caller-owned state.
  readMarketCoordination({ ...emptyMarketCoordination(), intents: [entry] });
  if (state.stopped) fail('STOPPED');
  if(marketRecoveryBlocks(state,entry))fail('RECOVERY_ISOLATED');
  if (state.intents.some(i => i.phase === 'pending')) fail('RECOVERY_REQUIRED');
  if (state.intents.some(i => i.id === entry.id)) fail('DUPLICATE_REQUEST');
  const holding = state.holdings.find(h => h.itemId === entry.itemId);
  if (['buy','bid'].includes(entry.kind)) {
    const auction=state.auctions?.find(a=>a.tradeId===entry.tradeId);
    const rebid=entry.kind==='bid'&&auction?.state==='outbid'&&auction.taskId===entry.taskId
      &&auction.itemId===entry.itemId&&auction.definitionId===entry.definitionId&&entry.coins>auction.coins;
    if (holding || activeMarketAuctions(state).some(a=>a.itemId===entry.itemId&&a.tradeId!==entry.tradeId)
      || auction&&!rebid || state.intents.some(i => ['buy','bid'].includes(i.kind) && i.tradeId === entry.tradeId && i.phase !== 'rejected')&&!rebid) fail('ITEM_OCCUPIED');
    fields(funds, ['balance', 'reserve', 'totalCap', 'taskCap', 'spendCap', 'freeSlots', 'perVersion']);
    number(funds.balance); number(funds.freeSlots);
    for (const key of ['reserve', 'totalCap', 'taskCap', 'spendCap']) if (funds[key] !== null) number(funds[key]);
    const comparison=rebid?{...state,auctions:state.auctions.filter(a=>a!==auction)}:state;
    const all = marketOccupancy(comparison), task = marketOccupancy(comparison, entry.taskId);
    if (funds.perVersion != null) {
      number(funds.perVersion, 1);
      const copies = state.holdings.filter(h => h.taskId === entry.taskId && h.definitionId === entry.definitionId && h.phase !== 'sold').length
        +activeMarketAuctions(comparison).filter(a=>a.taskId===entry.taskId&&a.definitionId===entry.definitionId).length
        +comparison.intents.filter(i=>marketUnresolved(i)&&['buy','bid'].includes(i.kind)&&i.taskId===entry.taskId&&i.definitionId===entry.definitionId).length;
      if (copies >= funds.perVersion) fail('VERSION_CAP');
    }
    if (funds.freeSlots < 1 || funds.balance - all.reservedCoins - entry.coins < (funds.reserve ?? 0)) fail('FUNDS_OR_CAPACITY');
    // Won cards awaiting a move occupy future Transfer slots across all tasks.
    // Buying a batch must not count the same physical slot several times.
    if (funds.freeSlots <= state.holdings.filter(h => h.phase === 'held').length+activeMarketAuctions(comparison).length+comparison.intents.filter(i=>marketUnresolved(i)&&['buy','bid'].includes(i.kind)).length) fail('TRANSFER_FULL');
    for (const [cap, occupancy] of [[funds.totalCap, all], [funds.taskCap, task]]) {
      if (cap !== null && (occupancy.unknownCosts || occupancy.reservedCoins + occupancy.holdingCoins + entry.coins > cap)) fail('HOLDING_CAP');
    }
    if (funds.spendCap !== null && task.spent + task.reservedCoins + activeMarketAuctions(comparison).filter(a=>a.taskId===entry.taskId).reduce((s,a)=>s+a.coins,0)+entry.coins > funds.spendCap) fail('SPEND_CAP');
  } else if (!holding || holding.taskId !== entry.taskId || holding.definitionId !== entry.definitionId
    || entry.kind === 'move' && holding.phase !== 'held'
    || entry.kind === 'list' && (entry.previousTradeId ? holding.phase !== 'unsold' || holding.listingTradeId !== entry.previousTradeId
      : holding.phase !== 'transfer')) fail('ITEM_OCCUPIED');
  state.intents.push(entry);
}

function validateReceipt(entry, receipt) {
  fields(receipt, ['itemId', 'definitionId', 'tradeId', 'coins']);
  if (receipt.itemId !== entry.itemId || receipt.definitionId !== entry.definitionId || receipt.coins !== entry.coins) fail('RECEIPT_CONFLICT');
  if (['buy','bid'].includes(entry.kind) && receipt.tradeId !== entry.tradeId || entry.kind === 'move' && receipt.tradeId !== null) fail('RECEIPT_CONFLICT');
  if (entry.kind === 'list') { id(receipt.tradeId); if (entry.previousTradeId === receipt.tradeId) fail('RECEIPT_CONFLICT'); }
}

function validateUnlistedResolution(entry, proof) {
  fields(proof, ['kind', 'itemId', 'definitionId', 'at', 'tradeId']);
  if (entry.kind !== 'list' || !entry.listing || proof.kind !== 'unlisted'
    || proof.itemId !== entry.itemId || proof.definitionId !== entry.definitionId) fail('RECEIPT_CONFLICT');
  number(proof.at);
  if (proof.at < entry.at + 60000) fail('RECEIPT_CONFLICT');
  if (proof.tradeId !== null) id(proof.tradeId);
}

// Resolves only the current disposition of a listing. It does not invent a
// historical rejection, positive listing receipt or sale, or erase an ack.
export function resolveMarketUnlisted(state, requestId, proof) {
  const entry = state.intents.find(i => i.id === requestId);
  if (!entry) fail('RECEIPT_CONFLICT');
  validateUnlistedResolution(entry, proof);
  if (entry.phase === 'resolved' && same(entry.resolution, proof)) return;
  const holding = state.holdings.find(h => h.itemId === entry.itemId);
  if (!marketUnresolved(entry) || !holding || holding.taskId !== entry.taskId
    || holding.definitionId !== entry.definitionId
    || (entry.previousTradeId ? holding.phase !== 'unsold' || holding.listingTradeId !== entry.previousTradeId
      : holding.phase !== 'transfer')) fail('RECEIPT_CONFLICT');
  entry.phase = 'resolved'; entry.resolution = structuredClone(proof);
}

// Only an adapter's independently verified exact receipt may call confirmed.
// A transport exception is not a rejection: leave the pending entry intact.
export function settleMarketWrite(state, requestId, result) {
  fields(result, ['status', 'receipt', 'acknowledged']); choice(result.status, ['confirmed', 'rejected', 'unknown']);
  const entry = state.intents.find(i => i.id === requestId);
  if (!entry) fail('RECEIPT_CONFLICT');
  if (result.acknowledged !== undefined && result.acknowledged !== true) fail('RECEIPT_CONFLICT');
  if ((entry.acknowledged || result.acknowledged) && result.status === 'rejected') fail('RECEIPT_CONFLICT');
  if (!marketUnresolved(entry)) {
    if (entry.phase === result.status && same(entry.receipt, result.receipt)) return;
    fail('RECEIPT_CONFLICT');
  }
  if (result.status !== 'confirmed' && result.receipt !== null) fail('RECEIPT_CONFLICT');
  if (result.acknowledged) entry.acknowledged = true;
  if (result.status === 'unknown') { state.stopped ??= 'unknown-write'; return; }
  if (result.status === 'confirmed') {
    validateReceipt(entry, result.receipt);
    const holding = state.holdings.find(h => h.itemId === entry.itemId);
    if(entry.kind==='bid')confirmMarketBid(state,entry);
    else if (entry.kind === 'buy') {
      if (holding) fail('ITEM_OCCUPIED');
      state.holdings.push({ taskId: entry.taskId, itemId: entry.itemId, definitionId: entry.definitionId,
        cost: entry.coins, phase: 'held', listingTradeId: null, salePrice: null, ...(entry.sellAt !== undefined ? { sellAt: entry.sellAt } : {}) });
    } else {
      if (!holding || holding.taskId !== entry.taskId || holding.definitionId !== entry.definitionId) fail('RECEIPT_CONFLICT');
      holding.phase = entry.kind === 'move' ? 'transfer' : 'listed';
      if (entry.kind === 'list') holding.listingTradeId = result.receipt.tradeId;
    }
  }
  entry.phase = result.status; entry.receipt = structuredClone(result.receipt);
  // Reconciling evidence never automatically clears a global stop or restarts.
}

export function settleMarketSale(state, receipt) {
  fields(receipt, ['itemId', 'definitionId', 'tradeId', 'price', 'sold']);
  if (receipt.sold !== true) fail('RECEIPT_CONFLICT');
  number(receipt.price, 150); if (receipt.price > 15000000) fail('RECEIPT_CONFLICT');
  const holding = state.holdings.find(h => h.itemId === receipt.itemId);
  if (!holding || !['listed', 'sold'].includes(holding.phase) || holding.definitionId !== receipt.definitionId
    || holding.listingTradeId !== receipt.tradeId || holding.phase === 'sold' && holding.salePrice !== receipt.price) fail('RECEIPT_CONFLICT');
  holding.phase = 'sold'; holding.salePrice = receipt.price;
}

// Only a fresh native auction read can establish expired, zero-bid unsold stock.
export function settleMarketUnsold(state, receipt) {
  fields(receipt, ['itemId', 'definitionId', 'tradeId', 'sold', 'unsold']);
  if (receipt.sold !== false || receipt.unsold !== true) fail('RECEIPT_CONFLICT');
  const h = state.holdings.find(row => row.itemId === receipt.itemId);
  if (!h || !['listed', 'unsold'].includes(h.phase) || h.definitionId !== receipt.definitionId
    || h.listingTradeId !== receipt.tradeId) fail('RECEIPT_CONFLICT');
  h.phase = 'unsold';
}

export function marketLastListing(state, holding) {
  return state.intents.find(i => i.itemId === holding.itemId && i.definitionId === holding.definitionId
    && i.kind === 'list' && i.phase === 'confirmed' && i.receipt.tradeId === holding.listingTradeId)?.listing ?? null;
}

export function marketRelistAllowed(state, task, holding) {
  if (!marketTaskAutoLists(task)) return false;
  if(marketRecoveryBlocks(state,{taskId:task.id,itemId:holding.itemId,definitionId:holding.definitionId}))return false;
  if (holding.phase !== 'unsold' || task.settings.relist === 'pause' || task.settings.relistTimes === 0) return false;
  const attempts = state.intents.filter(i => i.itemId === holding.itemId && i.kind === 'list' && i.previousTradeId);
  // A rejected relist needs a new explicit review; never hammer the same auction.
  if (attempts.some(i => i.previousTradeId === holding.listingTradeId)) return false;
  return task.settings.relistTimes === null || attempts.filter(i => i.phase === 'confirmed').length < task.settings.relistTimes;
}

export function transferMarketHoldings(state, { fromTaskId, toTaskId, itemIds, now }) {
  id(fromTaskId); id(toTaskId); number(now);
  if (fromTaskId === toTaskId || !Array.isArray(itemIds) || !itemIds.length || itemIds.length > 500
    || new Set(itemIds).size !== itemIds.length) fail('HANDOFF_INVALID');
  if (state.intents.some(i => i.phase === 'pending')) fail('RECOVERY_REQUIRED');
  if(marketIsolated(state,fromTaskId).length||marketIsolated(state,toTaskId).length||itemIds.some(itemId=>marketRecoveryBlocks(state,{itemId})))fail('RECOVERY_ISOLATED');
  const holdings = itemIds.map(itemId => state.holdings.find(h => h.itemId === itemId));
  if (holdings.some(h => !h || h.taskId !== fromTaskId || !['held', 'transfer', 'unsold'].includes(h.phase))) fail('HANDOFF_INVALID');
  if ((state.handoffs?.length ?? 0) + holdings.length > 2000) fail('STORAGE_LIMIT');
  state.handoffs ??= [];
  for (const h of holdings) {
    state.handoffs.push({ fromTaskId, toTaskId, itemId: h.itemId, definitionId: h.definitionId, at: now, cost: h.cost });
    h.taskId = toTaskId;
  }
}

export function nextMarketTask(state, readyIds) {
  if (state.stopped || state.intents.some(i => i.phase === 'pending')) return null;
  if (!Array.isArray(readyIds) || readyIds.length > 100 || new Set(readyIds).size !== readyIds.length) fail('INVALID');
  readyIds.forEach(id);
  if (!readyIds.length) return null;
  const next = readyIds[(readyIds.indexOf(state.lastTask) + 1) % readyIds.length];
  state.lastTask = next;
  return next;
}

export function marketTaskEvidence(state, taskId) {
  const entries = state.intents.filter(entry => entry.taskId === taskId);
  return { unresolved: entries.some(marketUnresolved),
    hasEvidence: entries.length > 0 || state.holdings.some(holding => holding.taskId === taskId)
      || (state.handoffs ?? []).some(h => h.fromTaskId === taskId || h.toTaskId === taskId) };
}
