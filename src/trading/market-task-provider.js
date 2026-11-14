import { marketTaskPrice } from './market-task-prices.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw Error(`MARKET_${reason}`); };
const publicId = n => Number.isSafeInteger(n) && n > 0;

// Task orchestration is independent of the EA transport. The native port MUST
// invoke beforeDispatch synchronously at every market search / mutation, and
// supply independent, exact receipts. Constructing this provider grants no permit.
export function createMarketTaskProvider({ context, native, loadQuotes, assertCurrent,
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
    player: task.players.find(p => p.definitionId === definitionId), quotes, definitionId, side,
    context, now: now(), priceTiers: native.priceTiers() });
  const priceFor = async (task, settings, definitionId, side) => {
    const player = task.players.find(p => p.definitionId === definitionId);
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
    if (action.expiresAt <= now()) fail('ACTION_EXPIRED_OR_INVALID');
    return saved;
  };
  const holdingFor = (ledger, task, action) => {
    const held = ledger.holdings.find(h => h.itemId === action.itemId);
    if (!held || held.taskId !== task.id || held.definitionId !== action.definitionId) fail('ITEM_OCCUPIED');
    return held;
  };
  const api = {
    dispatchBoundary: true,
    async prepare({ task, settings, ledger }) {
      check(); if (!['fixed', 'sell'].includes(task.mode)) fail('TASK_SELECTION_INVALID');
      const c = cursor(task, settings), held = ledger.holdings.filter(h => h.taskId === task.id);
      const pending = held.find(h => h.phase === 'held' || h.phase === 'transfer');
      if (pending) {
        const action = { kind: pending.phase === 'held' ? 'move' : 'list', itemId: pending.itemId,
          definitionId: pending.definitionId, coins: 0 };
        if (action.kind === 'list') {
          const p = await priceFor(task, settings, pending.definitionId, 'sell');
          Object.assign(action, { coins: p.price, quotes: p.quotes, expiresAt: p.expiresAt,
            listing: { startPrice: p.price, buyNow: p.price, durationSeconds: task.settings.duration } });
        }
        return remember(task, settings, action);
      }
      if (task.mode === 'sell') {
        const unclaimed = task.owned.find(row => !held.some(h => h.itemId === row.itemId));
        if (unclaimed) return remember(task, settings, { kind: 'claim', itemId: unclaimed.itemId, definitionId: unclaimed.definitionId, pile: unclaimed.pile });
      }
      if (held.some(h => h.phase === 'listed') && now() >= c.salesAt) return remember(task, settings, { kind: 'sales' });
      if (task.mode === 'sell') return held.some(h => h.phase !== 'sold') ? { kind: 'wait', until: Math.max(now() + 1000, c.salesAt) } : { kind: 'done' };
      // Consume only offers from the last search for this task. Rejections are
      // removed in accept, so one stale/competitive auction is never rebid.
      while (c.offers.length) {
        const offer = c.offers[0], row = task.players.find(p => p.definitionId === offer.definitionId);
        const copies = held.filter(h => h.definitionId === offer.definitionId && h.phase !== 'sold').length;
        if (!row || offer.expiresAt <= now() || ledger.intents.some(i => i.kind === 'buy' && i.tradeId === offer.tradeId)
          || row.qty !== null && copies >= row.qty) { c.offers.shift(); continue; }
        return remember(task, settings, { ...offer, kind: 'buy' });
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
          listing: ledger.intents.find(i => i.taskId === task.id && i.itemId === h.itemId && i.kind === 'list'
            && i.phase === 'confirmed' && i.receipt.tradeId === h.listingTradeId)?.listing ?? null }));
        const sales = await native.readSales(held); bound(action, task, settings);
        return { ready: true, sales };
      }
      if (['search', 'buy', 'list'].includes(action.kind)) {
        const p = price(task, settings, action.definitionId, action.kind === 'list' ? 'sell' : 'buy', action.quotes);
        if (action.kind === 'search' && p.price !== action.maxBuy || action.kind === 'buy' && action.coins > p.price
          || action.kind === 'list' && action.coins !== p.price) fail('PRICE_CHANGED');
      }
      if (['move', 'list'].includes(action.kind)) {
        const holding = holdingFor(ledger, task, action);
        if (holding.phase !== (action.kind === 'move' ? 'held' : 'transfer')) fail('ITEM_OCCUPIED');
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
        const saved = prepared.get(action.taskId); c.index = (saved.task.players.findIndex(p => p.definitionId === action.definitionId) + 1) % saved.task.players.length;
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
    verifySession: () => { check(); return native.verifySession(); },
  };
  return Object.freeze(api);
}
