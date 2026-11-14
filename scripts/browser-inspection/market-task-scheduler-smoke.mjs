import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseMarketTaskScheduler(context, directory) {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
    export { mountFc27AcceptancePanel } from './src/adapters/browser/fc27-acceptance-panel.js';
    export { createTradingTaskStore } from './src/adapters/browser/fc27-trading-task-store.js';
    export { createMarketCoordinator } from './src/adapters/browser/fc27-market-coordinator.js';
    export { createMarketTaskScheduler } from './src/trading/market-task-scheduler.js';
    export { createMarketTaskRuntime } from './src/trading/market-task-runtime.js';
    export { defaultTradingTaskSettings } from './src/trading/task-model.js';
    export { marketTaskEvidence } from './src/trading/market-coordination.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'MarketSchedulerFixture', target: 'chrome120' });
  const page = await context.newPage(), errors = []; let externalRequests = 0;
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url() === 'https://fcat-offline.invalid/task-scheduler') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Scheduler fixture</title>' });
    externalRequests++; return route.abort();
  });
  try {
    await page.goto('https://fcat-offline.invalid/task-scheduler');
    await page.setViewportSize({ width: 1366, height: 1000 }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      const api = globalThis.MarketSchedulerFixture, attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      const account = { scope: 'scheduler-ui', season: '27', platform: 'console' };
      const data = new Map(), calls = []; let taskSerial = 0, requestSerial = 0;
      const get = async (key, fallback) => structuredClone(data.get(key) ?? fallback);
      const set = async (key, value) => { data.set(key, structuredClone(value)); };
      const coordinator = api.createMarketCoordinator({ context: () => account, get, set, locks: globalThis.navigator.locks });
      const service = api.createTradingTaskStore({ context: () => account, get, set, locks: globalThis.navigator.locks,
        id: () => `task-${++taskSerial}`, readEvidence: async taskId => api.marketTaskEvidence((await coordinator.inspect()).ledger, taskId) });
      const input = name => ({ name, mode: 'fixed', settings: { ...api.defaultTradingTaskSettings(), buyRule: 'fixed', buyValue: 800, sellRule: 'fixed', sellValue: 700 },
        players: [{ name: 'Test player', rating: 84, definitionId: 1001, version: 'gold', cap: null, qty: null }], owned: [], excluded: [] });
      let snapshot = await service.saveTask({ ...await service.read(), input: input('任务 A') });
      snapshot = await service.saveTask({ ...snapshot, input: input('任务 B') });
      await service.saveSettings({ ...snapshot, settings: { ...snapshot.store.settings, gapMin: 1, gapMax: 1 } });
      const queues = new Map([['task-1', [{ kind: 'search' }, { kind: 'buy', itemId: '100', definitionId: 1001, tradeId: '500', coins: 800 },
        { kind: 'move', itemId: '100', definitionId: 1001, coins: 0 }]], ['task-2', [{ kind: 'search' }]]]);
      const state = { released: false, pendingBuy: false, data, calls, coordinator, service, queues };
      globalThis.marketSchedulerUI = state;
      const provider = {
        prepare: async ({ task }) => state.released ? { ...(queues.get(task.id)[0] ?? { kind: 'done' }), taskId: task.id, expiresAt: Date.now() + 60000 }
          : { kind: 'wait', until: Date.now() + 500 },
        preflight: async () => ({ ready: true, balance: 10000, freeSlots: 10 }),
        send: async ({ action }) => {
          calls.push({ taskId: action.taskId, kind: action.kind });
          if (action.kind === 'search') return { status: 'confirmed', sent: true };
          state.pendingBuy = true; await new Promise(resolve => { state.releaseBuy = resolve; });
          return { status: 'confirmed', receipt: { itemId: action.itemId, definitionId: action.definitionId, tradeId: action.tradeId, coins: action.coins } };
        },
        accept: async ({ action }) => { queues.get(action.taskId).shift(); },
        reconcile: async () => ({ status: 'unknown', receipt: null }), verifySession: async () => ({ ready: true }),
      };
      const runtime = api.createMarketTaskRuntime({ context: service.context, enabled: true, createScheduler: async () => {
        state.factoryCalls = (state.factoryCalls ?? 0) + 1;
        return api.createMarketTaskScheduler({ taskStore: service, coordinator, provider, enabled: true, id: () => `request-${++requestSerial}`, random: () => 0 });
      } });
      state.runtime = runtime;
      state.panel = api.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'scheduler-test', targets: () => [],
        tradingTasks: { service, runtime, readCoordination: () => coordinator.inspect() } });
      state.panel.open();
    });
    const host = page.locator('#scheduler-test'), view = host.locator('.market-task-manager');
    await host.locator('#tab-trading').click(); await view.locator('#toast').getByText(/任务已加载/).waitFor();
    assert.match(await view.locator('#market-coordination-status').innerText(), /搜索 1h 0/);
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.calls.length), 0);
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.factoryCalls ?? 0), 0);
    const start = async taskId => {
      await view.locator(`[data-action=start][data-id="${taskId}"]`).click();
      assert.match(await view.locator('#confirmBody').innerText(), /按已保存/); await view.locator('#confirmYes').click();
    };
    await start('task-1'); await view.locator('[data-action=pause][data-id="task-1"]').waitFor();
    await start('task-2'); await view.locator('[data-action=pause][data-id="task-2"]').waitFor();
    await view.locator('[data-action=pause][data-id="task-1"]').click();
    await page.waitForFunction(() => globalThis.marketSchedulerUI.runtime.inspect().tasks.find(t => t.id === 'task-1')?.state === 'paused');
    await page.evaluate(() => { globalThis.marketSchedulerUI.released = true; });
    await page.waitForFunction(() => !globalThis.marketSchedulerUI.runtime.inspect().busy);
    assert.deepEqual(await page.evaluate(() => globalThis.marketSchedulerUI.calls), [{ taskId: 'task-2', kind: 'search' }]);
    await start('task-1'); await page.waitForFunction(() => globalThis.marketSchedulerUI.pendingBuy);
    await view.locator('[data-action=stop][data-id="task-1"]').click();
    await page.evaluate(() => globalThis.marketSchedulerUI.releaseBuy());
    await page.waitForFunction(() => !globalThis.marketSchedulerUI.runtime.inspect().busy);
    await view.locator('[data-action=detail][data-id="task-1"]').locator('..').locator('..').getByText('1 / 0 / 0', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => globalThis.marketSchedulerUI.calls.map(c => c.kind)), ['search', 'search', 'buy']);
    await view.locator('#reloadTasks').click(); await view.locator('#toast').getByText(/任务已加载/).waitFor();
    assert.match(await view.locator('#market-coordination-status').innerText(), /持仓 1/);
    assert.equal(await view.locator('[data-action=delete][data-id="task-1"]').innerText(), '归档');
    await view.locator('[data-action=detail][data-id="task-1"]').click();
    await view.locator('#taskDetail').waitFor({ state: 'visible' });
    assert.match(await view.locator('#taskDetailBody').innerText(), /持仓成本 800/);
    assert.match(await view.locator('#taskDetailBody').innerText(), /买入 · EA 1001 · 已确认 · 800/);
    assert.doesNotMatch(await view.locator('#taskDetailBody').innerText(), /暂无交易/);
    await view.locator('[data-close=taskDetail]').first().click();
    await page.screenshot({ path: path.join(directory, 'market-scheduler-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await host.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    await page.screenshot({ path: path.join(directory, 'market-scheduler-mobile.png') });
    await view.locator('[data-action=delete][data-id="task-1"]').click();
    await view.locator('#confirmYes').click();
    await page.waitForFunction(async () => (await globalThis.marketSchedulerUI.service.read()).store.tasks[0].state === 'archived');
    await view.locator('#taskFilter').selectOption('archived');
    assert.equal(await view.locator('[data-action=start][data-id="task-1"]').isDisabled(), true);
    const writesBefore = await page.evaluate(() => globalThis.marketSchedulerUI.calls.length);
    await page.evaluate(async () => {
      await globalThis.marketSchedulerUI.coordinator.withOwner(s => s.control(t => t.checkpoint(state => { state.stopped = 'authentication'; })));
    });
    await view.locator('#reloadTasks').click(); await view.locator('#market-release').waitFor({ state: 'visible' });
    await view.locator('#market-recover').click(); await view.locator('#toast').getByText('核对完成；任务不会自动继续。', { exact: true }).waitFor();
    await view.locator('#market-release').click(); assert.match(await view.locator('#confirmBody').innerText(), /不会启动任务/);
    await view.locator('#confirmYes').click(); await view.locator('#toast').getByText('全局暂停已解除，任务尚未启动。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.calls.length), writesBefore);
    assert.equal(await page.evaluate(async () => (await globalThis.marketSchedulerUI.coordinator.inspect()).ledger.stopped), null);
    await host.locator('#tab-sbc').click();
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.runtime.inspect().busy), false);
    assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
    console.log('Market scheduler Chrome passed: explicit UI approvals, enqueue second task, independent pause, shared cooldown, stop during simulated buy, exact receipt retained, live counts/archive, desktop/390px; no real requests.');
  } finally { await page.close(); }
}
