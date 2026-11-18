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
        maintainSession: async ({ beforeDispatch }) => { beforeDispatch(); state.healthChecks=(state.healthChecks??0)+1; return { status: 'online' }; },
        prepare: async ({ task }) => state.released ? { definitionId: 1001, maxBuy: 800, ...(queues.get(task.id)[0] ?? { kind: 'done' }), taskId: task.id, expiresAt: Date.now() + 60000 }
          : { kind: 'wait', until: Date.now() + 500 },
        preflight: async () => ({ ready: true, balance: 10000, freeSlots: 10 }),
        send: async ({ action }) => {
          calls.push({ taskId: action.taskId, kind: action.kind });
          if (action.kind === 'search') return { status: 'confirmed', sent: true, responseCount: 0 };
          state.pendingBuy = true; await new Promise(resolve => { state.releaseBuy = resolve; });
          return { status: 'confirmed', receipt: { itemId: action.itemId, definitionId: action.definitionId, tradeId: action.tradeId, coins: action.coins } };
        },
        accept: async ({ action }) => { queues.get(action.taskId).shift(); return { acceptedCount: 0 }; },
        reconcile: async entry => state.resolveUnlisted ? { status:'resolved',receipt:null,resolution:{kind:'unlisted',
          itemId:entry.itemId,definitionId:entry.definitionId,at:Date.now(),tradeId:null} }
          : { status: 'unknown', receipt: null, reason:'MARKET_LISTING_STATE_UNCONFIRMED' }, verifySession: async () => ({ ready: true }),
        inspectHolding: async h => ({ eligible: true, itemId: h.itemId, definitionId: h.definitionId, pile: 'unassigned' }),
      };
      const runtime = api.createMarketTaskRuntime({ context: service.context, enabled: true, createScheduler: async () => {
        state.factoryCalls = (state.factoryCalls ?? 0) + 1;
        if (state.factoryCalls === 1) await new Promise(resolve => { state.releaseFactory = resolve; });
        return api.createMarketTaskScheduler({ taskStore: service, coordinator, provider, enabled: true, id: () => `request-${++requestSerial}`, random: () => 0 });
      } });
      state.runtime = runtime;
      state.panel = api.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'scheduler-test', targets: () => [],
        tradingTasks: { service, runtime, statusStorage: globalThis.localStorage, readCoordination: () => coordinator.inspect() } });
      state.panel.open();
    });
    const host = page.locator('#scheduler-test'), view = host.locator('.market-task-manager');
    const background = page.locator('#scheduler-test-market-status');
    assert.equal(await background.isVisible(), false);
    await host.locator('#tab-trading').click(); await view.locator('#toast').getByText(/任务已加载/).waitFor();
    assert.match(await view.locator('#market-coordination-status').innerText(), /搜索 1h 0/);
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.calls.length), 0);
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.factoryCalls ?? 0), 0);
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.healthChecks ?? 0), 0);
    const start = async taskId => {
      await view.locator(`[data-action=start][data-id="${taskId}"]`).click();
      assert.match(await view.locator('#confirmBody').innerText(), /按已保存/); await view.locator('#confirmYes').click();
    };
    await start('task-1');
    await page.waitForFunction(() => !!globalThis.marketSchedulerUI.releaseFactory);
    assert.match(await background.locator('output').innerText(), /Starting trading/);
    await view.locator('#globalSettings > summary').click();
    const statusToggle = view.locator('#marketStatusVisible');
    assert.equal(await statusToggle.isChecked(), true);
    await statusToggle.uncheck();
    assert.equal(await background.isVisible(), false);
    await statusToggle.check();
    assert.equal(await background.isVisible(), true);
    const barBox = await background.locator('.bar').boundingBox();
    assert.ok(barBox);
    await page.evaluate(({ x, y }) => {
      const host = globalThis.document.querySelector('#scheduler-test-market-status');
      const bar = host?.shadowRoot?.querySelector('.bar');
      bar?.dispatchEvent(new globalThis.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
      globalThis.window.dispatchEvent(new globalThis.MouseEvent('mousemove', { bubbles: true, clientX: x + 30, clientY: y + 22 }));
      globalThis.window.dispatchEvent(new globalThis.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x + 30, clientY: y + 22 }));
    }, { x: barBox.x + 12, y: barBox.y + 12 });
    assert.match(await background.getAttribute('style'), /(?:left:|inset:)/);
    assert.equal(await page.evaluate(() => Object.keys(globalThis.localStorage).some(key => key.startsWith('fcat-market-status:'))), true);
    // The compact host and its Pause all control remain interactive after the
    // user moves the widget; hiding it is handled by the settings toggle.
    assert.deepEqual(await page.evaluate(() => {
      const host = globalThis.document.querySelector('#scheduler-test-market-status');
      const bar = host?.shadowRoot?.querySelector('.bar');
      const button = bar?.querySelector('button');
      return {
        host: host ? globalThis.getComputedStyle(host).pointerEvents : null,
        bar: bar ? globalThis.getComputedStyle(bar).pointerEvents : null,
        button: button ? globalThis.getComputedStyle(button).pointerEvents : null,
      };
    }), { host: 'auto', bar: 'auto', button: 'auto' });
    // An approved task belongs to the page, not the currently visible FCAT tab.
    await host.locator('#tab-sbc').click();
    await page.evaluate(() => globalThis.marketSchedulerUI.panel.close());
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.runtime.inspect().busy), true);
    await page.evaluate(() => globalThis.marketSchedulerUI.panel.element.remove());
    assert.equal(await background.isVisible(), true);
    await page.evaluate(() => globalThis.marketSchedulerUI.releaseFactory());
    await page.waitForFunction(() => globalThis.marketSchedulerUI.runtime.inspect().tasks.some(row => row.state === 'waiting'));
    assert.match(await background.locator('output').innerText(), /Trading active/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => globalThis.dispatchEvent(new Event('resize')));
    assert.equal(await background.evaluate(node => { const r=node.getBoundingClientRect(); return r.width>0 && r.left>=0 && r.right<=globalThis.innerWidth && node.scrollWidth<=r.width+1; }), true);
    await page.screenshot({ path: path.join(directory, 'market-background-mobile.png') });
    await page.setViewportSize({ width: 1366, height: 1000 });
    await page.evaluate(() => globalThis.marketSchedulerUI.panel.open());
    await host.locator('#tab-trading').click();
    await view.locator('[data-action=pause][data-id="task-1"]').waitFor();
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.factoryCalls), 1);
    await start('task-2'); await view.locator('[data-action=pause][data-id="task-2"]').waitFor();
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.healthChecks), 1);
    assert.match(await view.locator('#market-session-status').innerText(), /Session maintenance active.*Last online/);
    await view.locator('[data-action=pause][data-id="task-1"]').click();
    await page.waitForFunction(() => globalThis.marketSchedulerUI.runtime.inspect().tasks.find(t => t.id === 'task-1')?.state === 'paused');
    await host.locator('#tab-sbc').click();
    await page.evaluate(() => globalThis.marketSchedulerUI.panel.close());
    await page.evaluate(() => { globalThis.marketSchedulerUI.released = true; });
    await page.waitForFunction(() => !globalThis.marketSchedulerUI.runtime.inspect().busy);
    await page.evaluate(() => globalThis.marketSchedulerUI.panel.open());
    await host.locator('#tab-trading').click();
    await view.locator('#toast').getByText(/任务已加载/).waitFor();
    assert.match(await view.locator('#market-session-status').innerText(), /Session maintenance stopped/);
    assert.match(await view.locator('#market-search-status').innerText(), /EA 1001.*Buy limit 800.*Returned 0.*Eligible 0/);
    assert.deepEqual(await page.evaluate(() => globalThis.marketSchedulerUI.calls), [{ taskId: 'task-2', kind: 'search' }]);
    await start('task-1'); await page.waitForFunction(() => globalThis.marketSchedulerUI.pendingBuy);
    await page.evaluate(() => globalThis.marketSchedulerUI.panel.close());
    // A real trusted click outside the closed panel revokes all future sends.
    await background.getByRole('button', { name: 'Pause all' }).click();
    await page.evaluate(() => globalThis.marketSchedulerUI.releaseBuy());
    await page.waitForFunction(() => !globalThis.marketSchedulerUI.runtime.inspect().busy);
    assert.match(await background.locator('output').innerText(), /Trading paused/);
    await page.evaluate(() => globalThis.marketSchedulerUI.panel.open());
    await view.locator('#toast').getByText(/任务已加载/).waitFor();
    await view.locator('[data-action=stop][data-id="task-1"]').click();
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
    await page.evaluate(async () => {
      const state = globalThis.marketSchedulerUI, snapshot = await state.service.read(), first = snapshot.store.tasks[0];
      await state.service.saveTask({ ...snapshot, input: { name: '接收持仓', mode: 'sell', settings: first.settings, players: [], excluded: [],
        owned: [{ itemId: '100', definitionId: 1001, name: 'Test player', pile: 'unassigned' }] } });
    });
    await view.locator('#reloadTasks').click(); await view.locator('#toast').getByText(/任务已加载/).waitFor();
    await view.locator('[data-action=detail][data-id="task-1"]').click();
    await view.locator('#market-handoff-target').selectOption('task-3');
    await view.locator('#market-handoff-items input').check();
    await view.locator('#market-handoff-confirm').click();
    await view.locator('#toast').getByText('持仓已移交；没有移卡、挂牌或启动接收任务。', { exact: true }).waitFor();
    assert.match(await view.locator('#taskDetailBody').innerText(), /移交给 接收持仓/);
    assert.match(await view.locator('#taskDetailBody').innerText(), /累计运行/);
    assert.equal(await page.evaluate(async () => (await globalThis.marketSchedulerUI.coordinator.inspect()).ledger.holdings[0].taskId), 'task-3');
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.calls.length), 3);
    await page.screenshot({ path: path.join(directory, 'market-handoff-desktop.png') });
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
    await view.locator('#market-recover').click(); await view.locator('#toast').getByText(/Receipt check complete.*tasks will not restart automatically/).waitFor();
    await view.locator('#market-release').click(); assert.match(await view.locator('#confirmBody').innerText(), /Tasks remain stopped/);
    assert.match(await view.locator('#confirmBody').innerText(), /cannot remove an EA market restriction/);
    await view.locator('#confirmYes').click(); await view.locator('#toast').getByText('全局暂停已解除，任务尚未启动。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.calls.length), writesBefore);
    assert.equal(await page.evaluate(async () => (await globalThis.marketSchedulerUI.coordinator.inspect()).ledger.stopped), null);
    // Reproduce both stopped rows plus a retained global pause. Restart stays
    // explicit; clearing the pause and editing do not send or erase history.
    await view.locator('#taskFilter').selectOption('active');
    await page.evaluate(async () => {
      const s = globalThis.marketSchedulerUI;
      await s.service.action({ ...await s.service.read(), id: 'task-2', action: 'stop' });
      await s.coordinator.withOwner(o => o.control(t => t.checkpoint(l => { l.stopped = 'manual'; })));
    });
    await view.locator('#reloadTasks').click(); await view.locator('#toast').getByText(/任务已加载/).waitFor();
    assert.equal(await view.locator('[data-action=start][data-id="task-2"]').innerText(), 'Restart');
    assert.equal(await view.locator('[data-action=edit][data-id="task-2"]').isVisible(), true);
    await view.locator('[data-action=start][data-id="task-2"]').click();
    assert.match(await view.locator('#confirmBody').innerText(), /Holdings, spending, elapsed time and receipts are retained/);
    await view.locator('#confirmYes').click();
    await view.locator('#toast').getByText(/全局已暂停/).waitFor();
    assert.equal(await page.evaluate(async () => (await globalThis.marketSchedulerUI.service.read()).store.tasks.find(t => t.id === 'task-2').state), 'stopped');
    await view.locator('#market-release').click(); await view.locator('#confirmYes').click();
    await view.locator('#toast').getByText('全局暂停已解除，任务尚未启动。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.calls.length), writesBefore);
    const previousRun = await page.evaluate(() => globalThis.marketSchedulerUI.runtime.inspect().tasks.find(t => t.id === 'task-2')?.startedAt ?? 0);
    await start('task-2');
    // Reopen briefly persists paused before the asynchronous run starts. Wait
    // for this run's terminal state, not that intermediate old state, before
    // acquiring the owner lock to install the recovery fixture.
    await page.waitForFunction(previous => {
      const s = globalThis.marketSchedulerUI, runtime = s.runtime.inspect(), row = runtime.tasks.find(t => t.id === 'task-2');
      return row?.startedAt > previous && row.state === 'completed' && !runtime.busy;
    }, previousRun);
    assert.equal(await page.evaluate(async () => (await globalThis.marketSchedulerUI.service.read()).store.tasks.find(t => t.id === 'task-2').state), 'paused');
    assert.equal(await page.evaluate(async () => (await globalThis.marketSchedulerUI.coordinator.inspect()).ledger.holdings[0].cost), 800);
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.calls.length), writesBefore);
    // A retained old listing must show why checking did not release the pause,
    // then complete using current disposition without sending a replacement.
    await page.evaluate(async () => {
      const s=globalThis.marketSchedulerUI;
      const installed = await s.coordinator.withOwner(o=>o.control(t=>t.checkpoint(l=>{
        l.stopped='unknown-write';
        l.holdings.push({taskId:'task-2',itemId:'202',definitionId:1002,cost:600,phase:'transfer',listingTradeId:null,salePrice:null});
        l.intents.push({id:'old-list',taskId:'task-2',itemId:'202',definitionId:1002,kind:'list',coins:700,tradeId:null,
          at:Date.now()-120000,phase:'pending',receipt:null,listing:{startPrice:650,buyNow:700,durationSeconds:3600}});
      })));
      if (!installed?.intents?.some(i => i.id === 'old-list' && i.phase === 'pending')) throw Error('RECOVERY_FIXTURE_NOT_INSTALLED');
    });
    await view.locator('#reloadTasks').click(); await view.locator('#toast').getByText(/任务已加载/).waitFor();
    await view.locator('#market-recover').click();
    await view.locator('#toast').getByText(/old listing is still unresolved/).waitFor();
    await view.locator('#market-release').click(); await view.locator('#confirmYes').click();
    await view.locator('#toast').getByText(/有未决交易/).waitFor();
    const recovery=view.locator('#market-recovery-panel');
    await recovery.locator('summary').click();
    await recovery.locator('[data-recovery=isolate]').click();
    await view.locator('#market-recovery-confirm').getByText('取消',{exact:true}).click();
    assert.equal(await page.evaluate(async()=>(await globalThis.marketSchedulerUI.coordinator.inspect()).ledger.intents.find(i=>i.id==='old-list').phase),'pending');
    await recovery.locator('[data-recovery=isolate]').click();
    await view.locator('#market-recovery-confirm-yes').click();
    await view.locator('#toast').getByText(/旧交易已隔离/).waitFor();
    await view.locator('#reloadTasks').click();await view.locator('#toast').getByText(/任务已加载/).waitFor();
    assert.match(await recovery.innerText(),/隔离待处理/);
    assert.equal(await view.locator('[data-action=start][data-id="task-2"]').isDisabled(),true);
    await recovery.locator('[data-recovery=handled]').click();
    await view.locator('#market-recovery-confirm-yes').click();
    await page.waitForFunction(async()=>(await globalThis.marketSchedulerUI.coordinator.inspect()).ledger.intents.find(i=>i.id==='old-list').isolation?.handledAt>0);
    await recovery.getByText(/已备注手动处理，仍需回执/).waitFor();
    await page.screenshot({path:path.join(directory,'market-recovery-isolation-mobile.png')});
    await view.locator('#market-release').click();await view.locator('#confirmYes').click();
    await view.locator('#toast').getByText('全局暂停已解除，任务尚未启动。',{exact:true}).waitFor();
    assert.equal(await view.locator('[data-action=start][data-id="task-2"]').isDisabled(),true);
    assert.equal(await page.evaluate(()=>globalThis.marketSchedulerUI.calls.length),writesBefore);
    await page.evaluate(()=>{globalThis.marketSchedulerUI.resolveUnlisted=true;});
    await view.locator('#market-recover').click(); await view.locator('#toast').getByText(/Receipt check complete/).waitFor();
    await view.locator('[data-action=detail][data-id="task-2"]').click();
    assert.match(await view.locator('#taskDetailBody').innerText(),/Resolved: currently unlisted/);
    await view.locator('[data-close=taskDetail]').first().click();
    assert.equal(await view.locator('#market-release').isVisible(),false);
    assert.equal(await page.evaluate(()=>globalThis.marketSchedulerUI.calls.length),writesBefore);
    await host.locator('#tab-sbc').click();
    assert.equal(await page.evaluate(() => globalThis.marketSchedulerUI.runtime.inspect().busy), false);
    assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
    console.log('Market scheduler Chrome passed: tab switch/closed/detached panel retains one runtime, empty search completes while hidden, persistent Pause all settles in-flight receipt without next move, explicit approvals/enqueue/handoff, desktop/390px; no real requests.');
  } finally { await page.close(); }
}
