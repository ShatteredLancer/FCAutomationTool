import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseMarketTaskFilter(context, directory) {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ stdin: { resolveDir: root, contents: `
    export {createMarketTaskCatalog} from './src/trading/market-task-catalog.js';
    export {createMarketTaskProvider} from './src/trading/market-task-provider.js';
    export {createMarketTaskScheduler} from './src/trading/market-task-scheduler.js';
    export {createMarketTaskRuntime} from './src/trading/market-task-runtime.js';
    export {createTradingTaskStore} from './src/adapters/browser/fc27-trading-task-store.js';
    export {createMarketCoordinator} from './src/adapters/browser/fc27-market-coordinator.js';
    export {defaultTradingTaskSettings} from './src/trading/task-model.js';
    export {mountFc27AcceptancePanel} from './src/adapters/browser/fc27-acceptance-panel.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'FilterFixture' });
  const page = await context.newPage(), errors = []; let requests = 0;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url() === 'https://fcat-offline.invalid/filter'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Filter tasks</title>' }) : (requests++, route.abort()));
  try {
    await page.goto('https://fcat-offline.invalid/filter'); await page.setViewportSize({ width: 1366, height: 1000 });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      const api = globalThis.FilterFixture, attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      const context = { scope: 'filter-fixture', season: '27', platform: 'console' }, data = new Map(), calls = [];
      const state = globalThis.filterSmoke = { calls, reads: 0, quoteBatches: [], maxGap: 0, stopped: false };
      let previousBeat = performance.now(), serial = 0;
      state.timer = setInterval(() => { const at = performance.now(); state.maxGap = Math.max(state.maxGap, at - previousBeat); previousBeat = at; }, 10);
      const rows = Array.from({ length: 50000 }, (_, i) => ({ definitionId: i + 1, playerId: i + 1,
        name: `Player ${i + 1}`, rating: 84, rarity: 1, teamId: i % 1000 + 1, leagueId: 13 }));
      const catalog = api.createMarketTaskCatalog({ context: () => context, readRows: () => { state.reads++; return rows; } });
      const get = async (k, fallback) => structuredClone(data.get(k) ?? fallback), set = async (k, v) => data.set(k, structuredClone(v));
      const store = api.createTradingTaskStore({ context: () => context, get, set, locks: navigator.locks, id: () => 'filter' });
      const coordinator = api.createMarketCoordinator({ context: () => context, get, set, locks: navigator.locks });
      await store.saveTask({ ...await store.read(), input: { name: '条件 84', mode: 'filter', settings: { ...api.defaultTradingTaskSettings(),
        ratingMin: 84, ratingMax: 84, perVersion: 1, buyValue: 100, sellRule: 'fixed', sellValue: 700 }, players: [], owned: [],
        excluded: [{ type: 'version', id: 2, label: 'Player 2' }] } });
      const native = { priceTiers: () => [{ min: 1000, inc: 100 }, { min: 0, inc: 50 }],
        preflight: async () => ({ ready: true, balance: 10000, freeSlots: 10 }),
        send: async ({ action, beforeDispatch }) => { beforeDispatch(); calls.push([action.kind, action.definitionId]);
          if (action.kind === 'search') return { sent: true, status: 'confirmed', offers: [{ itemId: '101', tradeId: '501', definitionId: action.definitionId, coins: 600 }] };
          return { status: 'confirmed', receipt: { itemId: action.itemId, definitionId: action.definitionId, tradeId: action.tradeId, coins: action.coins } };
        }, reconcile: async () => ({ status: 'unknown', receipt: null }) };
      const provider = api.createMarketTaskProvider({ context, catalog, native, assertCurrent() {}, id: () => `a${++serial}`,
        loadQuotes: async ids => { state.quoteBatches.push(ids); const at = Date.now(); return Object.fromEntries(ids.map(id => [id,
          { futbin: { definitionId: id, price: 800, source: 'futbin', season: '27', platform: 'console', fetchedAt: at, expiresAt: at + 300000 } }])); } });
      const modes = ['fixed','filter','sell'];
      const runtime = api.createMarketTaskRuntime({ context: store.context, enabled: true, modes, createScheduler: async () =>
        api.createMarketTaskScheduler({ taskStore: store, coordinator, provider, enabled: true, supportedModes: modes }) });
      runtime.subscribe(s => { if (!state.stopped && s.evidence.some(e => e.counts[0] === 1)) { state.stopped = true; runtime.pauseAll(); } });
      state.runtime = runtime; state.coordinator = coordinator;
      const panel = api.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'filter-panel', targets: () => [],
        tradingTasks: { service: store, runtime, readCoordination: () => coordinator.inspect(), readCatalog: async () => (await catalog.read()).rows } });
      panel.open();
    });
    const host = page.locator('#filter-panel'), view = host.locator('.market-task-manager');
    await host.locator('#tab-trading').click(); await view.locator('#toast').getByText(/任务已加载/).waitFor();
    assert.equal(await page.evaluate(() => globalThis.filterSmoke.reads), 0);
    await view.locator('[data-action=edit]').click(); await view.locator('#previewPool').click();
    await view.locator('[data-exclude="1"]').waitFor(); assert.equal(await view.locator('#pool .picker-row').count(), 5);
    await view.locator('[data-exclude="1"]').click(); await view.locator('#poolNext').click();
    await view.locator('[data-exclude="6"]').waitFor(); assert.equal(await view.locator('#pool .picker-row').count(), 5);
    await view.locator('#taskForm button[type=submit]').click(); await view.locator('#editor').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => globalThis.filterSmoke.calls.length), 0);
    await view.locator('[data-action=start]').click(); await view.locator('#confirmYes').click();
    await page.waitForFunction(() => globalThis.filterSmoke.stopped && !globalThis.filterSmoke.runtime.inspect().busy);
    const result = await page.evaluate(() => { clearInterval(globalThis.filterSmoke.timer); const s = globalThis.filterSmoke;
      return { calls: s.calls, quoteBatches: s.quoteBatches, maxGap: s.maxGap, scope: s.runtime.inspect().tasks[0].candidateScope }; });
    assert.deepEqual(result.calls, [['search', 3], ['buy', 3]]); assert.equal(result.quoteBatches.length, 1);
    assert.equal(result.quoteBatches[0].length, 20); assert.equal(result.scope.known, 50000); assert.equal(result.scope.complete, false);
    assert.ok(result.maxGap < 1000, `unresponsive catalog ${result.maxGap}ms`);
    await view.locator('[data-action=detail]').click(); assert.match(await view.locator('#taskDetailBody').innerText(), /已知目录 50000/);
    await page.screenshot({ path: path.join(directory, 'market-filter-desktop.png') }); await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await view.locator('#taskDetail').evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
    await page.screenshot({ path: path.join(directory, 'market-filter-mobile.png') });
    assert.equal(requests, 0); assert.deepEqual(errors, []);
    console.log(`Market filter Chrome passed: 50k catalog, five-card preview, unified exclusions, explicit start, 20 quotes, exact simulated buy, max heartbeat ${Math.round(result.maxGap)}ms, desktop/390px; no HTTP/EA writes.`);
  } finally { await page.close(); }
}
