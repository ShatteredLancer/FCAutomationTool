import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseMarketTaskProvider(context) {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ stdin: { contents: `
    export { createMarketTaskProvider } from './src/trading/market-task-provider.js';
    export { createMarketTaskScheduler } from './src/trading/market-task-scheduler.js';
    export { createTradingTaskStore } from './src/adapters/browser/fc27-trading-task-store.js';
    export { createMarketCoordinator } from './src/adapters/browser/fc27-market-coordinator.js';
    export { defaultTradingTaskSettings } from './src/trading/task-model.js';
    export { marketTaskReport } from './src/trading/market-task-report.js';
  `, resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'marketProviderTest', platform: 'browser' });
  const page = await context.newPage(), errors = []; let requests = 0;
  page.on('pageerror', error => errors.push(error.message));
  const url = 'https://fcat-offline.invalid/market-provider';
  await page.route('**/*', route => route.request().url() === url ? route.fulfill({ contentType: 'text/html', body: '<html><body>Offline market task check</body></html>' })
    : (requests++, route.abort()));
  try {
    await page.goto(url); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const api = globalThis.marketProviderTest, data = new Map(), context = { scope: 'offline', season: '27', platform: 'console' };
      let time = 1000000, serial = 0, taskSerial = 0, quotes = 0, stopped = false;
      const calls = [], get = async (k, fallback) => structuredClone(data.get(k) ?? fallback), set = async (k, v) => data.set(k, structuredClone(v));
      const store = api.createTradingTaskStore({ context: () => context, get, set, locks: navigator.locks, now: () => time, id: () => `t${++taskSerial}` });
      const coordinator = api.createMarketCoordinator({ context: () => context, get, set, locks: navigator.locks });
      const settings = { ...api.defaultTradingTaskSettings(), buyRule: 'fixed', buyValue: 800, sellRule: 'fixed', sellValue: 700 };
      let snapshot = await store.saveTask({ ...await store.read(), input: { name: 'Fixed', mode: 'fixed', settings,
        players: [{ name: 'Test', definitionId: 901, rating: 84, version: 'gold', cap: null, qty: 1 }], owned: [], excluded: [] } });
      snapshot = await store.saveTask({ ...snapshot, input: { name: 'Sell', mode: 'sell', settings, players: [], excluded: [],
        owned: [{ itemId: '201', definitionId: 902, name: 'Owned', pile: 'club' }] } });
      const native = {
        priceTiers: () => [{ min: 1000, inc: 100 }, { min: 0, inc: 50 }],
        inspectOwned: async row => ({ ...row, eligible: true, cost: null }),
        preflight: async () => ({ ready: true, balance: 10000, freeSlots: 20 }),
        send: async ({ action, beforeDispatch }) => {
          await Promise.resolve(); beforeDispatch(); calls.push([action.taskId, action.kind]);
          if (action.kind === 'search') return { status: 'confirmed', sent: true, offers: [{ itemId: '101', definitionId: 901, tradeId: '501', coins: 600 }] };
          return { status: 'confirmed', receipt: { itemId: action.itemId, definitionId: action.definitionId, coins: action.coins,
            tradeId: action.kind === 'list' ? `7${action.itemId}` : action.tradeId ?? null } };
        },
        readSales: async holdings => holdings.map(h => ({ itemId: h.itemId, definitionId: h.definitionId, tradeId: h.listingTradeId, price: 700, sold: true })),
        reconcile: async () => ({ status: 'unknown', receipt: null }), verifySession: async () => ({ ready: true }),
      };
      const provider = api.createMarketTaskProvider({ native, context, assertCurrent() {}, now: () => time,
        id: () => `a${++serial}`, loadQuotes: async () => { quotes++; return {}; } });
      const scheduler = api.createMarketTaskScheduler({ taskStore: store, coordinator, provider, enabled: true,
        now: () => time, random: () => 0, id: () => `r${++serial}`, wait: async ms => { time += ms; },
        onStatus: state => { if (!stopped && state.evidence.reduce((sum, e) => sum + e.counts[2], 0) === 2) { stopped = true; scheduler.pauseAll(); } } });
      await scheduler.run({ approved: true, snapshot, taskIds: ['t1', 't2'] });
      const ledger = (await coordinator.inspect()).ledger, before = calls.length;
      await scheduler.recover();
      return { stopped, calls, quotes, recoveryWrites: calls.length - before, searches: ledger.searches.length,
        fixed: api.marketTaskReport(ledger, 't1'), sell: api.marketTaskReport(ledger, 't2') };
    });
    assert.equal(result.stopped, true); assert.equal(result.quotes, 0); assert.equal(result.recoveryWrites, 0);
    assert.equal(result.searches, 1); assert.equal(result.calls.filter(row => row[1] === 'buy').length, 1);
    assert.equal(result.fixed.realizedProfit, 65); assert.equal(result.sell.realizedProfit, null);
    assert.equal(result.fixed.sold, 1); assert.equal(result.sell.sold, 1);
    assert.equal(requests, 0); assert.deepEqual(errors, []);
    console.log('Market provider Chrome passed: real provider/scheduler/Web Locks with simulated native port, fixed buy and selected Club sale, one search, exact receipts, unknown cost, no requests.');
  } finally { await page.close(); }
}
