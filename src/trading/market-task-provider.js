import { marketScheduleGate, marketScheduleWake } from './market-task-schedule.js';
import { marketTaskPrice } from './market-task-prices.js';
import { marketLastListing, marketRelistAllowed } from './market-coordination.js';
import { taskCandidateAllowed } from './task-catalog.js';
import { taskCandidatePage } from './market-task-catalog.js';

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
    context, now: now(), priceTiers: native.priceTiers() });
  const priceFor = async (task, settings, definitionId, side) => {
    const player = task.mode === 'fixed' ? task.players.find(p => p.definitionId === definitionId) : null;
    const fixed = side === 'buy' ? player?.cap != null || task.settings.buyRule === 'fixed' : task.settings.sellRule === 'fixed';
    const quotes = fixed ? null : await loadQuotes([definitionId], { source: settings.source, context }); check();
    return { ...price(task, settings, definitionId, side, quotes?.[definitionId]), quotes: quotes?.[definitionId] ?? null };
  };
  const remember = (task, settings, action) => {
    const result = { ...action, taskId: task.id, token: id(), expiresAt: Math.min(action.expiresAt ?? Infinity,
      now() + (action.kind === 'search' ? 300000 : 30000)) };
    prepared.set(task.id, { task: structuredClone(task), settings: structuredClone(settings), action: structuredClone(result) });
    return result;
  };
  const bound = (action, task = null, settings = null) => {
    check(); const saved = prepared.get(action.taskId);
    if (!saved || !same(saved.action, action) || task && !same(saved.task, task) || settings && !same(saved.settings, settings)) fail('ACTION_CHANGED');
    if (!marketScheduleGate(saved.task, cursors.get(action.taskId)?.schedule, action.kind, action, now())) fail('SCHEDULE_WINDOW_CLOSED');
    if (action.expiresAt <= now()) fail('ACTION_EXPIRED_OR_INVALID');
    if (saved.task.mode === 'filter' && ['search','buy'].includes(action.kind)) {
      const c = cursors.get(action.taskId), row = c?.rows?.find(r => r.definitionId === action.definitionId);
      if (!c?.isCurrent?.() || !row || !taskCandidateAllowed(row, saved.task)) fail('CANDIDATE_CHANGED');
    }
    return saved;
  };
  const holdingFor = (ledger, task, action) => {
    const held = ledger.holdings.find(h => h.itemId === action.itemId);
    if (!held || held.taskId !== task.id || held.definitionId !== action.definitionId) fail('ITEM_OCCUPIED');
    return held;
  };
  const api = {
    dispatchBoundary: true,
    async checkCapacity(task) { return native.preflight({ action: { kind: 'search' }, task }); },
    async begin({ task, settings, isCurrent = () => true }) {
      check(); cursors.delete(task.id); prepared.delete(task.id);
      const c = cursor(task, settings); c.isCurrent = isCurrent;
      if (task.mode === 'filter') {
        if (!catalog?.read) fail('CATALOG_UNAVAILABLE');
        const snapshot = await catalog.read({ isCurrent }); check();
        if (!isCurrent()) fail('USER_STOP');
        if (snapshot.context !== JSON.stringify(context)) fail('CONTEXT_CHANGED');
        c.catalog = snapshot; c.next = 0; c.rows = []; c.quotes = {}; c.matched = 0; c.cycled = false;
      }
    },
    describe(taskId) {
      const c = cursors.get(taskId);
      return c?.catalog ? { revision: c.catalog.revision, known: c.catalog.rows.length, matched: c.matched,
        batch: c.rows.length, missing: c.missing ?? 0, complete: false } : null;
    },
    async prepare({ task, settings, ledger }) {
      check(); if (!['fixed', 'sell', 'filter'].includes(task.mode)) fail('TASK_SELECTION_INVALID');
      const c = cursor(task, settings), held = ledger.holdings.filter(h => h.taskId === task.id);
      c.schedule = ledger.schedules?.find(r => r.taskId === task.id);
      const scheduleWait = () => { const wake = marketScheduleWake(task, c.schedule, ledger.holdings, now(),h=>marketRelistAllowed(ledger,task,h));
        return wake === null ? { kind: 'done' } : { kind: 'wait', until: Math.max(now()+1000,wake), scheduleWait: true }; };
      if (task.mode === 'filter' && (!c.catalog || !c.isCurrent?.())) fail('CATALOG_UNAVAILABLE');
      const due = h => h.phase === 'transfer' && marketScheduleGate(task, c.schedule, 'list', h, now()) || marketRelistAllowed(ledger, task, h);
      const pending = task.schedule ? held.find(due) ?? held.find(h=>h.phase==='held') : held.find(h => h.phase === 'held' || due(h));
      if (pending) {
        const action = { kind: pending.phase === 'held' ? 'move' : 'list', itemId: pending.itemId,
          definitionId: pending.definitionId, coins: 0, ...(pending.sellAt !== undefined ? { sellAt: pending.sellAt } : {}) };
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
              listing: { startPrice: p.price, buyNow: p.price, durationSeconds: task.settings.duration } });
          }
        }
        return remember(task, settings, action);
      }
      if (task.mode === 'sell') {
        const unclaimed = task.owned.find(row => !held.some(h => h.itemId === row.itemId));
        if (unclaimed && marketScheduleGate(task, c.schedule, 'claim', null, now())) return remember(task, settings, { kind: 'claim', itemId: unclaimed.itemId, definitionId: unclaimed.definitionId, pile: unclaimed.pile });
      }
      if (held.some(h => h.phase === 'listed') && now() >= c.salesAt) return remember(task, settings, { kind: 'sales' });
      if (task.schedule && (task.mode === 'sell' && (held.some(h=>h.phase==='transfer') || task.owned.some(r=>!held.some(h=>h.itemId===r.itemId)))
        || task.mode !== 'sell' && !marketScheduleGate(task,c.schedule,'buy',null,now()))) return scheduleWait();
      if (task.mode === 'sell') return held.some(h => h.phase === 'listed') ? { kind: 'wait', until: Math.max(now() + 1000, c.salesAt) }
        : { kind: 'done', ...(held.some(h => h.phase === 'unsold') ? { reason: 'MARKET_RELIST_PAUSED' } : {}) };
      // Consume only offers from the last search for this task. Rejections are
      // removed in accept, so one stale/competitive auction is never rebid.
      while (c.offers.length) {
        const offer = c.offers[0], row = (task.mode === 'filter' ? c.rows : task.players).find(p => p.definitionId === offer.definitionId);
        const copies = held.filter(h => h.definitionId === offer.definitionId && h.phase !== 'sold').length;
        const cap = task.mode === 'filter' ? task.settings.perVersion : row?.qty;
        if (!row || offer.expiresAt <= now() || ledger.intents.some(i => i.kind === 'buy' && i.tradeId === offer.tradeId)
          || cap != null && copies >= cap || task.mode === 'filter' && !taskCandidateAllowed(row, task)) { c.offers.shift(); continue; }
        return remember(task, settings, { ...offer, kind: 'buy' });
      }
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
        const eligible = c.rows.slice(c.index).filter(row => task.settings.perVersion === null
          || held.filter(h => h.definitionId === row.definitionId && h.phase !== 'sold').length < task.settings.perVersion);
        if (task.settings.buyRule !== 'fixed' && eligible.length && (c.quotedAt === null || now() - c.quotedAt >= 30000
          && eligible.some(row => { try { price(task, settings, row.definitionId, 'buy', c.quotes[row.definitionId]); return false; } catch { return true; } }))) {
          c.quotes = await loadQuotes(eligible.map(row => row.definitionId), { source: settings.source, context, rows: eligible, isCurrent: c.isCurrent }); check();
          if (!c.isCurrent()) fail('USER_STOP');
          c.quotedAt = now(); c.missing = 0;
          for (const row of eligible) {
            try { price(task, settings, row.definitionId, 'buy', c.quotes[row.definitionId]); }
            catch (error) { if (error.message !== 'MARKET_REFERENCE_UNAVAILABLE') throw error; c.missing++; }
          }
          if (c.missing === eligible.length) fail('REFERENCE_UNAVAILABLE');
        }
        for (; c.index < c.rows.length; c.index++) {
          const row = c.rows[c.index]; if (!eligible.includes(row)) continue;
          let p;
          try { p = price(task, settings, row.definitionId, 'buy', c.quotes[row.definitionId]); }
          catch (error) { if (error.message !== 'MARKET_REFERENCE_UNAVAILABLE') throw error; continue; }
          return remember(task, settings, { kind: 'search', definitionId: row.definitionId, maxBuy: p.price,
            quotes: c.quotes[row.definitionId] ?? null, expiresAt: p.expiresAt, limit: settings.perSearch });
        }
        return { kind: 'wait', until: now() + (c.next >= c.catalog.candidates.length ? 30000 : 1000) };
      }
      for (let i = 0; i < task.players.length; i++) {
        const row = task.players[(c.index + i) % task.players.length];
        const copies = held.filter(h => h.definitionId === row.definitionId && h.phase !== 'sold').length;
        if (row.qty !== null && copies >= row.qty) continue;
        const p = await priceFor(task, settings, row.definitionId, 'buy');
        return remember(task, settings, { kind: 'search', definitionId: row.definitionId, maxBuy: p.price,
          quotes: p.quotes, expiresAt: p.expiresAt, limit: settings.perSearch });
      }
      return { kind: 'wait', until: Math.max(now() + 1000, c.salesAt) };
    },
    async preflight({ task, settings, action, ledger }) {
      bound(action, task, settings);
      if (action.kind === 'claim') {
        const row = task.owned.find(r => r.itemId === action.itemId && r.definitionId === action.definitionId);
        if (task.mode !== 'sell' || !row || ledger.holdings.some(h => h.itemId === row.itemId)) fail('ITEM_OCCUPIED');
        const facts = await native.inspectOwned({ ...row }, { task }); bound(action, task, settings);
        if (!facts?.eligible || facts.itemId !== row.itemId || facts.definitionId !== row.definitionId
          || !['club', 'unassigned', 'transfer'].includes(facts.pile)) fail('HOLDING_UNAVAILABLE');
        return { ready: true, holding: { taskId: task.id, itemId: row.itemId, definitionId: row.definitionId, cost: facts.cost },
          holdingPhase: facts.pile === 'transfer' ? 'transfer' : 'held' };
      }
      if (action.kind === 'sales') {
        const held = ledger.holdings.filter(h => h.taskId === task.id && h.phase === 'listed').map(h => ({ ...h,
          listing: marketLastListing(ledger, h) }));
        const sales = await native.readSales(held); bound(action, task, settings);
        return { ready: true, sales };
      }
      if (['search', 'buy', 'list'].includes(action.kind) && !(action.previousTradeId && task.settings.relist === 'original')) {
        const p = price(task, settings, action.definitionId, action.kind === 'list' ? 'sell' : 'buy', action.quotes);
        if (action.kind === 'search' && p.price !== action.maxBuy || action.kind === 'buy' && action.coins > p.price
          || action.kind === 'list' && action.coins !== p.price) fail('PRICE_CHANGED');
      }
      if (['move', 'list'].includes(action.kind)) {
        const holding = holdingFor(ledger, task, action);
        if (action.previousTradeId) {
          if (!marketRelistAllowed(ledger, task, holding) || holding.listingTradeId !== action.previousTradeId
            || !same(marketLastListing(ledger, holding), action.previousListing)
            || task.settings.relist === 'original' && !same(action.listing, action.previousListing)) fail('ITEM_OCCUPIED');
        } else if (holding.phase !== (action.kind === 'move' ? 'held' : 'transfer')) fail('ITEM_OCCUPIED');
      }
      const result = await native.preflight({ task, settings, action, ledger }); bound(action, task, settings); return result;
    },
    async send({ action, requestId, beforeDispatch }) {
      const saved = bound(action);
      // The final callback is passed through to the *native* call. Calling it
      // before an awaited pacing/permit step would restore the cancellation bug.
      return native.send({ ...saved, action, requestId, beforeDispatch: () => { bound(action); beforeDispatch(); } });
    },
    async accept({ action, response, ledger }) {
      check(); const c = cursors.get(action.taskId); if (!c) return;
      if (action.kind === 'sales') c.salesAt = now() + 30000;
      if (action.kind === 'buy') c.offers = c.offers.filter(o => o.tradeId !== action.tradeId);
      if (action.kind === 'search') {
        const saved = prepared.get(action.taskId);
        c.index = saved.task.mode === 'filter' ? c.rows.findIndex(p => p.definitionId === action.definitionId) + 1
          : (saved.task.players.findIndex(p => p.definitionId === action.definitionId) + 1) % saved.task.players.length;
        if (response.sent === true && response.status === 'confirmed') {
          if (!Array.isArray(response.offers) || response.offers.length > 21) fail('SEARCH_UNCONFIRMED');
          const seen = new Set();
          c.offers = response.offers.filter(o => {
            const key = `${o.itemId}:${o.tradeId}`;
            if (!publicId(Number(o.itemId)) || String(Number(o.itemId)) !== o.itemId || o.definitionId !== action.definitionId
              || typeof o.tradeId !== 'string' || !/^[1-9]\d{0,19}$/.test(o.tradeId)
              || !Number.isSafeInteger(o.coins) || o.coins < 150 || o.coins > action.maxBuy || seen.has(key)
              || ledger.intents.some(i => i.kind === 'buy' && i.tradeId === o.tradeId)) return false;
            seen.add(key); return true;
          }).sort((a, b) => a.coins - b.coins).slice(0, action.limit).map(o => ({ itemId: o.itemId, definitionId: o.definitionId,
            tradeId: o.tradeId, coins: o.coins, quotes: action.quotes, expiresAt: action.expiresAt }));
        } else c.offers = [];
      }
    },
    reconcile: intent => { check(); return native.reconcile(structuredClone(intent)); },
    inspectHolding: async holding => { check(); const result = await native.inspectOwned(holding); check(); return result; },
    readHoldings: async holdings => { check(); const result = await native.readSales(holdings); check(); return result; },
    verifySession: () => { check(); return native.verifySession(); },
  };
  return Object.freeze(api);
}
