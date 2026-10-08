import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exerciseStreamlined(context) {
  const page = await context.newPage();
  try {
    const root = path.resolve(import.meta.dirname, '../..');
    const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
      export { mountFc27StreamlinedPanel } from './src/adapters/browser/fc27-streamlined-panel.js';
      export { createFc27StreamlinedSession } from './src/adapters/browser/fc27-streamlined-session.js';
      export { challenge, safeItem, policy, eligibility } from './tests/helpers/streamlined.js';
    ` }, bundle: true, write: false, format: 'iife', globalName: 'StreamlinedSmoke', target: 'chrome120' });
    await page.setContent('<!doctype html><title>Streamlined offline</title><main id="native"></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const a = globalThis.StreamlinedSmoke, c = a.challenge(), context = c.context, anchor = globalThis.document.getElementById('native');
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      const saved = new Map(); globalThis.streamlinedEvidence = { writes: 0, quotes: 0, current: true, progress: [], rendered: 0, disposed: 0 };
      const inventory = Array.from({ length: 80 }, (_, i) => a.safeItem({ id: i + 1, definitionId: i + 101,
        points: i < 60 ? 35 : 20, name: `Fixture ${i + 1}` }));
      const session = a.createFc27StreamlinedSession({
        createExecution: async () => {
          if (!globalThis.streamlinedEvidence.executionEnabled) throw Error('FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED');
          return { prepare: () => true, transaction: {
            stop: () => { globalThis.streamlinedEvidence.stopped = true; },
            async recover() {
              if (globalThis.streamlinedEvidence.recoveryThrows) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED');
              return globalThis.streamlinedEvidence.recoveryOutcome ?? { status: 'absent' };
            },
            async execute(plan, approval, callbacks) {
              if (globalThis.streamlinedEvidence.purchasePending) return { status: 'blocked', reason: 'FC27_BUY_RECOVERY_REQUIRED' };
              globalThis.streamlinedEvidence.approval = approval;
              const record = { plan, submittedScore: 0, batches: plan.batches.map(() => ({ state: 'waiting' })) };
              for (const index of approval.batchIndices) {
                globalThis.streamlinedEvidence.writes++;
                record.batches[index].state = 'confirmed';
                record.submittedScore += plan.batches[index].reduce((sum, item) => sum + item.points, 0);
                callbacks.onProgress({ phase: 'confirmed', index, submittedScore: record.submittedScore });
              }
              return { status: 'partial', record };
            },
          } };
        },
        inspect: () => { if (!globalThis.streamlinedEvidence.current) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED'); return { context, challenge: c }; },
        readInputs: () => ({ context, challenge: c, inventory, policy: a.policy, eligibility: a.eligibility,
          assertCurrent: () => {}, priceRows: [], resolveDisplayItem: ref => inventory.find(item => item.id === ref.id) }),
        get: async (key, fallback) => saved.get(key) ?? fallback,
        set: async (key, value) => { saved.set(key, value); },
      });
      const original = session.plan;
      const observed = { ...session, plan: (settings, options) => original(settings, { onProgress: p => {
        globalThis.streamlinedEvidence.progress.push(p.nodes); options.onProgress(p);
      } }) };
      globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session: observed,
        readTarget: () => globalThis.streamlinedEvidence.current ? { anchor, setId: 31, challengeId: 61 } : null,
        nativeRenderer: { renderOwned({ parent, raw, slot, onUnavailable }) {
          if (raw.id % 5 === 0) return null;
          const node = globalThis.document.createElement('div'); node.slot = slot; node.className = 'gallery-native-card';
          node.textContent = 'Native card fixture'; node.style.cssText = 'width:144px;height:200px'; node.classList.add('owned-card'); parent.append(node);
          globalThis.streamlinedEvidence.rendered++;
          let disposed = false;
          node.__fcatDealloc = () => { if (!disposed) globalThis.streamlinedEvidence.disposed++; disposed = true; };
          if (raw.id % 7 === 0) setTimeout(onUnavailable, 20);
          return node;
        } } });
    });
    await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
    await page.getByRole('button', { name: '生成方案', exact: true }).click();
    await page.getByText('第 3 批', { exact: false }).waitFor();
    const text = await page.getByRole('dialog').innerText();
    assert.match(text, /80 张 \/ 3 批/);
    assert.match(text, /第 1 批 · 30 张（库存 30 \/ 待购 0）· 1,050 分/);
    assert.match(text, /Fixture 1/);
    assert.match(text, /55 OVR/);
    assert.match(text, /Club · 已有/);
    assert.equal(await page.locator('[data-market-rating]').inputValue(), '99');
    assert.ok((await page.locator('.player-card').first().boundingBox()).width >= 100, 'Readable desktop card');
    assert.match(text, /待购 0 金币/);
    assert.equal(await page.getByRole('button', { name: '贡献所选批次' }).isDisabled(), true);
    assert.ok((await page.evaluate(() => globalThis.streamlinedEvidence.progress)).length > 0);
    assert.equal(await page.locator('.player-row').count(), 30, 'Only the expanded batch renders');
    assert.ok(await page.locator('.gallery-native-card').count() > 0);
    await page.getByRole('checkbox', { name: '选择第 1 批' }).uncheck();
    assert.match(await page.locator('[data-selection]').innerText(), /已选 2 批 · 50 张 · 1,450 分 · 还差 1,050/);
    await page.getByText('第 2 批 ·', { exact: false }).click();
    await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelectorAll('.player-row').length === 60);
    assert.equal(await page.locator('.player-row').count(), 60);
    await page.setViewportSize({ width: 390, height: 600 });
    assert.ok((await page.locator('.player-card').first().boundingBox()).width >= 88, 'Readable mobile card');
    const metrics = await page.getByRole('dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    assert.ok(metrics.width <= 390 && metrics.scrollWidth <= metrics.clientWidth + 1, 'No horizontal overflow on mobile');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.locator('.gallery-native-card').count(), 0, 'Close deallocates every native card');
    const cleanup = await page.evaluate(() => globalThis.streamlinedEvidence);
    assert.equal(cleanup.rendered, cleanup.disposed);
    await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
    await page.getByRole('button', { name: '生成方案', exact: true }).click();
    await page.getByText('第 3 批', { exact: false }).waitFor();
    await page.evaluate(() => { globalThis.streamlinedEvidence.current = false; });
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-entry'));
    assert.equal(await page.locator('.gallery-native-card').count(), 0, 'Navigation also clears cards');
    assert.deepEqual(await page.evaluate(() => ({ writes: globalThis.streamlinedEvidence.writes, quotes: globalThis.streamlinedEvidence.quotes })), { writes: 0, quotes: 0 });
    // The enabled variant uses only an explicit synthetic execution adapter.
    // Exercise actual trusted UI clicks, selected-batch approval and redraw.
    await page.evaluate(() => { globalThis.streamlinedEvidence.current = true; globalThis.streamlinedEvidence.executionEnabled = true; });
    await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
    await page.getByRole('button', { name: '生成方案', exact: true }).click();
    await page.getByText('第 3 批', { exact: false }).waitFor();
    const contribute = page.getByRole('button', { name: '贡献所选批次', exact: true });
    assert.equal(await contribute.isEnabled(), true);
    // Screenshot regression: recovery errors/other-target history must not
    // leave an old generated plan and active contribution button underneath.
    for (const scenario of ['absent', 'other-target', 'context-error']) {
      await page.evaluate(scenario => {
        globalThis.streamlinedEvidence.recoveryThrows = scenario === 'context-error';
        globalThis.streamlinedEvidence.recoveryOutcome = scenario === 'other-target'
          ? { status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED', recovery: { setId: 48, challengeId: 85 } }
          : { status: 'absent' };
      }, scenario);
      await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
      await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
      assert.equal(await contribute.isVisible(), false);
      assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
      assert.equal(await page.locator('.player-row').count(), 0);
      assert.equal(await page.locator('.gallery-native-card').count(), 0);
      const message = await page.locator('[data-status]').innerText();
      assert.match(message, scenario === 'absent' ? /当前 SBC 没有待恢复/ : scenario === 'other-target' ? /Set 48 \/ Challenge 85/ : /账号、SBC 或积分状态已变化/);
      assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 0);
      await page.getByRole('button', { name: '生成方案', exact: true }).click();
      await page.getByText('第 3 批', { exact: false }).waitFor();
      assert.equal(await contribute.isEnabled(), true, 'A new valid plan is independently usable');
    }
    await page.getByRole('checkbox', { name: '选择第 1 批' }).uncheck();
    await page.getByRole('checkbox', { name: '选择第 3 批' }).uncheck();
    await contribute.evaluate(button => button.click());
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 0, 'Untrusted clicks never contribute');
    await contribute.click();
    await page.getByText('本次贡献已确认，可继续剩余批次。', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => globalThis.streamlinedEvidence.approval.batchIndices), [1]);
    assert.equal(await page.getByRole('checkbox', { name: '选择第 2 批' }).isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: '选择第 1 批' }).isEnabled(), true);
    // A purchase marker can appear between planning and execution. Preserve
    // the actual failure after redraw instead of saying the writer is absent.
    await page.evaluate(() => { globalThis.streamlinedEvidence.purchasePending = true; });
    await page.getByRole('button', { name: '生成方案', exact: true }).click();
    await page.getByText('第 3 批', { exact: false }).waitFor();
    await contribute.click();
    await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
      .querySelector('[data-status]').textContent.includes('Puzzle 购卡记录'));
    assert.equal(await contribute.isDisabled(), true);
    const blocked = await page.getByRole('dialog').innerText();
    assert.match(blocked, /当前不能贡献：当前账号有待核对的 Puzzle 购卡记录/);
    assert.doesNotMatch(blocked, /提交接口未接通/);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 1, 'Pending purchase never spends materials');
    await exerciseStreamlinedMarket(page);
    console.log('Streamlined offline browser passed: native entry, settings, 30+30+20, market routes, frozen settings, partial progress, stop/recover, unavailable supply, completion, responsive dialog, no EA writes.');
  } finally { await page.close(); }
}

async function exerciseStreamlinedMarket(page) {
  // This is a separate synthetic session. Trusted clicks exercise the real
  // panel/session, while every execution effect stays in this fixture.
  let requests = 0;
  await page.route('**/*', route => { requests++; return route.abort(); });
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 100 });
    const saved = new Map(), evidence = { calls: 0, mode: 'stopped', saved: [], record: null };
    globalThis.marketSmoke = evidence;
    let finish;
    const transaction = { recover: async () => ({ status: 'absent' }) };
    const execution = {
      prepare() {}, transaction,
      stop() { finish?.(); },
      recoverPurchase: async () => ({ status: 'recovered', record: evidence.record }),
      async purchase(plan, approval, { onProgress }) {
        evidence.calls++; evidence.execution = plan.execution;
        evidence.record = { context: c.context, plan, submittedScore: 0, spent: 300, budget: 1500,
          completed: false, consumedIds: [], entries: [{ state: 'club' }, { state: 'club' }] };
        if (evidence.mode === 'stopped') {
          await new Promise(resolve => {
            finish = resolve;
            onProgress({ phase: 'partial-ready', batchNumber: 1, purchased: 2, purchaseTarget: 10,
              spent: 300, budget: 1500, contributed: 0, submittedScore: 0, targetScore: 100,
              readyCount: 2, selectionLimit: 30, readyPoints: 20 });
          });
          finish = null;
          return { status: 'stopped', reason: 'FC27_STREAMLINED_STOPPED', record: evidence.record };
        }
        if (evidence.mode === 'no-supply') return { status: 'blocked',
          reason: 'FC27_STREAMLINED_NO_AFFORDABLE_CARDS', record: evidence.record };
        evidence.record = { ...evidence.record, completed: true, submittedScore: 100 };
        return { status: 'completed', record: evidence.record };
      },
    };
    const session = a.createFc27StreamlinedSession({
      inspect: () => ({ context: c.context, challenge: c }), now: () => 100,
      get: async (key, fallback) => saved.get(key) ?? fallback,
      set: async (key, value) => { saved.set(key, value); evidence.saved.push(value); },
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [], assertCurrent() {} }),
      readMarketCandidates: async () => ({ pricePolicy: { source: 'futgg', purchaseAttempts: 7 },
        market: [[101, 10, 150], [102, 100, 2000]].map(([definitionId, points, price]) => a.safeItem({
          source: 'market', definitionId, points, price,
          quote: { definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 },
        })) }),
      createExecution: async () => execution,
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  assert.equal(await page.locator('[data-wait]').inputValue(), '60');
  await page.locator('[data-wait]').fill('12');
  await page.locator('[data-mode]').selectOption('market');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByText('当前 SBC 设置已保存。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.saved[0].settings.partialWaitMs), 12000);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  assert.equal(await page.locator('[data-wait]').inputValue(), '12');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.equal(await page.locator('.route-list button').count(), 2);
  assert.match(await page.locator('.route-list').innerText(), /1,500.*100 积分.*10 张/);
  const routeLabels = await page.locator('.route-list button').allTextContents();
  assert.equal(routeLabels.some(label => /OVR|版本|待购估价|库存材料估值/.test(label)), false,
    'Route choices stay compact and do not repeat per-card details');
  assert.equal(routeLabels.some(label => /82|83|84/.test(label)), false,
    'Route choices do not expose individual ratings');
  await page.locator('.route-list button').last().click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('.route-list button:last-child').getAttribute('aria-pressed') === 'true');
  assert.match(await page.locator('[data-result]').innerText(), /2,000 金币/);
  assert.match(await page.locator('[data-result]').innerText(), /第 1 批/);
  assert.match(await page.locator('[data-result]').innerText(), /市场概念卡/);
  await page.locator('.route-list button').first().click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('.route-list button').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.getByRole('checkbox', { name: '选择第 1 批' }).count(), 0);
  assert.match(await page.locator('[data-selection]').innerText(), /市场路线已冻结/);
  assert.match(await page.locator('[data-result]').innerText(), /每卡最多尝试 7 次 · 部分批次等待 12 秒/);
  const run = page.getByRole('button', { name: '按方案购买并贡献', exact: true });
  assert.equal(await run.isEnabled(), true);
  await run.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 0);
  await run.click();
  await page.getByText('本批就绪 2 / 30 张 · 20 分', { exact: false }).waitFor();
  assert.match(await page.locator('[data-status]').innerText(), /已购 2 \/ 10 张/);
  assert.equal(await page.locator('[data-mode]').isDisabled(), true);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止；已确认成交保留，可核对并恢复。', { exact: true }).waitFor();
  assert.match(await page.locator('[data-selection]').innerText(), /已就绪 2 张/);
  assert.deepEqual(await page.evaluate(() => globalThis.marketSmoke.execution), { purchaseAttempts: 7, partialWaitMs: 12000 });
  await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
  await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
  assert.equal(await run.isEnabled(), true);
  await page.evaluate(() => { globalThis.marketSmoke.mode = 'no-supply'; });
  await run.click();
  await page.getByText('当前没有可购买的限价内候选，已暂停。已购材料保留，核对并恢复后可重试。', { exact: true }).waitFor();
  assert.equal(await run.isDisabled(), true);
  await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
  await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
  await page.evaluate(() => { globalThis.marketSmoke.mode = 'completed'; });
  await run.click();
  await page.getByText('目标已达成，奖励状态需另行核对。', { exact: true }).waitFor();
  assert.equal(await run.isDisabled(), true);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 3);
  assert.equal(requests, 0, 'The synthetic market UI must never make network requests');
}
