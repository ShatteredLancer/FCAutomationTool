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
      export { createFc27StreamlinedMarket } from './src/adapters/ea/fc27-streamlined-market.js';
      export { createGalleryReferencePrices } from './src/gallery/reference-prices.js';
      export { readFutbinBatchPrices } from './src/fc27/futbin-batch-prices.js';
      export { readFc27Context } from './src/adapters/ea/fc27-local-read.js';
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
      inventory.push(a.safeItem({ id: 81, definitionId: 181, rating: 84, points: 830 }));
      const session = a.createFc27StreamlinedSession({
        createExecution: async () => {
          if (!globalThis.streamlinedEvidence.executionEnabled) throw Error('FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED');
          return { prepare: () => true,
            recoverPurchase: async () => globalThis.streamlinedEvidence.purchaseRecoveryOutcome ?? { status: 'absent' },
            archivePurchaseHistory: async () => {
              globalThis.streamlinedEvidence.archives = (globalThis.streamlinedEvidence.archives ?? 0) + 1;
              globalThis.streamlinedEvidence.purchaseRecoveryOutcome = { status: 'absent' };
              return { status: 'archived', reason: 'FC27_STREAMLINED_PURCHASE_HISTORY_ARCHIVED' };
            }, transaction: {
            stop: () => { globalThis.streamlinedEvidence.stopped = true; },
            async recover() {
              if (globalThis.streamlinedEvidence.recoveryThrows) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED');
              return globalThis.streamlinedEvidence.recoveryOutcome ?? { status: 'absent' };
            },
            async execute(plan, approval, callbacks) {
              if (globalThis.streamlinedEvidence.purchasePending) return { status: 'blocked', reason: 'FC27_BUY_RECOVERY_REQUIRED' };
              globalThis.streamlinedEvidence.approval = approval;
              globalThis.streamlinedEvidence.lastPlan = plan;
              const record = { plan, submittedScore: 0, batches: plan.batches.map(() => ({ state: 'waiting' })) };
              for (const index of approval.batchIndices) {
                globalThis.streamlinedEvidence.writes++;
                record.batches[index].state = 'confirmed';
                record.submittedScore += plan.batches[index].reduce((sum, item) => sum + item.points, 0);
                callbacks.onProgress({ phase: 'confirmed', index, submittedScore: record.submittedScore });
              }
              return globalThis.streamlinedEvidence.progressReadFailure
                ? { status: 'blocked', reason: 'FC27_STREAMLINED_PROGRESS_READ_FAILED', record }
                : { status: 'partial', record };
            },
          } };
        },
        inspect: () => { if (!globalThis.streamlinedEvidence.current) throw Error('FC27_STREAMLINED_CONTEXT_CHANGED'); return { context, challenge: c }; },
        readInputs: () => ({ context, challenge: c, inventory, policy: { ...a.policy, goldRange: [75, 83] }, eligibility: a.eligibility,
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
    assert.match(text, /第 1 批 · 30 张（库存 30 \/ 待购 0\) · 1,050 分/);
    assert.match(text, /Fixture 1/);
    assert.match(text, /55 OVR/);
    assert.match(text, /Club · 已有/);
    assert.match(text, /FSU 金卡上限 83/);
    assert.match(text, /未采用库存 1 张/);
    await page.getByText('未采用库存 1 张', { exact: true }).click();
    assert.match(await page.getByRole('dialog').innerText(), /不在 FSU 金卡评分范围 · Club · 84级 ×1/);
    assert.equal(await page.locator('[data-market-rating]').inputValue(), '99');
    assert.ok((await page.locator('.player-card').first().boundingBox()).width >= 100, 'Readable desktop card');
    assert.match(text, /待购 0 金币/);
    assert.equal(await page.getByRole('button', { name: '贡献所选批次' }).isDisabled(), true);
    assert.equal(await page.locator('[data-inventory-review]').evaluate(node => node.open), true);
    assert.equal(await page.locator('.inventory-row').count(), 50, 'Inventory review is bounded and paginated');
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    assert.equal(await page.locator('.inventory-row').count(), 30);
    assert.ok((await page.evaluate(() => globalThis.streamlinedEvidence.progress)).length > 0);
    assert.equal(await page.locator('.player-row').count(), 30, 'Only the expanded batch renders');
    assert.ok(await page.locator('.gallery-native-card').count() > 0);
    await page.getByRole('checkbox', { name: '选择第 1 批' }).uncheck();
    assert.equal(await page.locator('.inventory-row').count(), 50);
    assert.match(await page.locator('[data-inventory-review] summary').innerText(), /50 张/);
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
    for (const scenario of ['absent', 'other-target', 'context-error', 'cycle-conflict', 'policy-change']) {
      await page.evaluate(scenario => {
        globalThis.streamlinedEvidence.recoveryThrows = scenario === 'context-error';
        globalThis.streamlinedEvidence.recoveryOutcome = scenario === 'other-target'
          ? { status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED', recovery: { setId: 48, challengeId: 85 } }
          : scenario === 'cycle-conflict' ? { status: 'recovery-required', reason: 'FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED' }
            : scenario === 'policy-change' ? { status: 'recovery-required', reason: 'FC27_STREAMLINED_POLICY_CHANGED' }
            : { status: 'absent' };
      }, scenario);
      await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
      await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
      assert.equal(await contribute.isVisible(), false);
      assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
      assert.equal(await page.locator('.player-row').count(), 0);
      assert.equal(await page.locator('.gallery-native-card').count(), 0);
      const message = await page.locator('[data-status]').innerText();
      assert.match(message, scenario === 'absent' ? /当前 SBC 没有待恢复的贡献记录/ : scenario === 'other-target' ? /Set 48 \/ Challenge 85/
        : scenario === 'cycle-conflict' ? /EA 已返回本批完成回执.*不要重新买卡或重复投入/
          : scenario === 'policy-change' ? /选材设置已变化.*生成新方案.*已确认积分保留.*先归档/ : /账号、SBC 或积分状态已变化/);
      assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 0);
      if (scenario === 'policy-change') await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-policy-replan.png') });
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
    // A later pre-dispatch GET failure retains the first batch's authoritative
    // score, disables its checkbox and never presents the run as zero progress.
    await page.evaluate(() => { globalThis.streamlinedEvidence.progressReadFailure = true; });
    await page.getByRole('button', { name: '生成方案', exact: true }).click();
    await page.getByText('第 3 批', { exact: false }).waitFor();
    await page.getByRole('checkbox', { name: '选择第 2 批' }).uncheck();
    await page.getByRole('checkbox', { name: '选择第 3 批' }).uncheck();
    await contribute.click();
    await page.getByText('EA 进度读取未成功。已确认批次和积分保留，不会重复投入；请稍后核对并恢复。', { exact: true }).first().waitFor();
    const partial = await page.evaluate(() => {
      const p = globalThis.streamlinedEvidence.lastPlan;
      return { score: p.batches[0].reduce((sum, item) => sum + item.points, 0).toLocaleString('en-US'),
        target: p.challenge.targetScore.toLocaleString('en-US') };
    });
    assert.equal(await page.locator('[data-final-progress]').innerText(), `已确认 ${partial.score} / ${partial.target} 分`);
    assert.equal(await page.getByRole('checkbox', { name: '选择第 1 批' }).isDisabled(), true);
    assert.equal(await contribute.isDisabled(), true);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 2);
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-progress-read-paused.png') });
    await page.evaluate(() => { globalThis.streamlinedEvidence.progressReadFailure = false; });
    // A truly unresolved foreign purchase must not conceal this SBC's settled
    // score, replace its target, or revive an executable preview.
    await page.evaluate(() => {
      const plan = globalThis.streamlinedEvidence.lastPlan;
      globalThis.streamlinedEvidence.recoveryThrows = false;
      globalThis.streamlinedEvidence.recoveryOutcome = { status: 'recovery-required',
        reason: 'FC27_STREAMLINED_OTHER_TARGET_PURCHASE_RECOVERY_REQUIRED',
        recovery: { setId: 71, challengeId: 999, pendingWriteCount: 1, unconsumedPurchaseCount: 2 },
        record: { context: plan.context, plan, submittedScore: plan.batches[0].reduce((sum, item) => sum + item.points, 0),
          batches: plan.batches.map((_, index) => ({ state: index ? 'waiting' : 'confirmed' })) } };
    });
    await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
    assert.match(await page.locator('[data-status]').innerText(), /Set 71 \/ Challenge 999.*1 笔待核对请求、2 张采购材料待处理/);
    assert.equal(await page.locator('[data-final-progress]').innerText(), `已确认 ${partial.score} / ${partial.target} 分`);
    assert.equal(await contribute.isVisible(), false);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 2);
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-foreign-purchase-blocked.png') });
    await page.evaluate(() => {
      const saved = globalThis.streamlinedEvidence.recoveryOutcome;
      globalThis.streamlinedEvidence.recoveryOutcome = { status: 'observed', record: saved.record,
        warning: { reason: 'FC27_STREAMLINED_FOREIGN_PURCHASE_ISOLATED', recovery: saved.recovery } };
    });
    await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
    assert.match(await page.locator('[data-status]').innerText(), /已恢复当前 SBC.*历史待核对记录已隔离保留.*不买卡、不重跑旧任务/);
    assert.equal(await page.locator('[data-final-progress]').innerText(), `已确认 ${partial.score} / ${partial.target} 分`);
    assert.equal(await contribute.isEnabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: '选择第 1 批' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 2, 'Recovery never dispatches a new or historical contribution');
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-historical-isolation.png') });
    // A separate trusted action retires another target's local execution only.
    // It must invalidate the old executable preview, never dispatch EA writes.
    await page.evaluate(() => {
      globalThis.streamlinedEvidence.purchaseRecoveryOutcome = { status: 'recovery-required',
        reason: 'FC27_STREAMLINED_OTHER_TARGET_PURCHASE_RECOVERY_REQUIRED',
        recovery: { name: 'Gold Re-Roll', setId: 9, challengeId: 24, pendingWriteCount: 1, unconsumedPurchaseCount: 2 },
        historyAction: { canArchive: true } };
    });
    await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
    const archive = page.getByRole('button', { name: '退出并归档旧任务', exact: true });
    await archive.waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-history-note]').innerText(), /不会把未知请求算作成功.*材料继续隔离/);
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-history-retirement.png') });
    await archive.click();
    await page.waitForFunction(() => globalThis.streamlinedEvidence.archives === 1);
    assert.match(await page.locator('[data-status]').innerText(), /旧任务已退出并归档.*重新生成当前方案并确认新预算/);
    assert.equal(await contribute.isVisible(), false); assert.equal(await archive.isVisible(), false);
    assert.equal(await page.getByRole('button', { name: '生成方案', exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 2);
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-history-retired.png') });
    // A previous, independently confirmed repeatable cycle is history, not
    // current-cycle progress or permission to initiate/contribute again.
    await page.evaluate(() => {
      const plan = globalThis.streamlinedEvidence.lastPlan;
      globalThis.streamlinedEvidence.recoveryOutcome = { status: 'observed', record: { context: plan.context,
        plan, submittedScore: plan.challenge.targetScore, batches: plan.batches.map((_, index) => ({ state: 'confirmed',
          receipt: { status: 'accepted', challengeCompleted: index === plan.batches.length - 1, submittedScore: plan.challenge.targetScore } })) } };
    });
    await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
    assert.match(await page.locator('[data-status]').innerText(), /上一轮贡献已确认完成.*不是上次提交失败.*原生入口/);
    assert.match(await page.locator('[data-final-progress]').innerText(), /上一轮已确认 2,500 \/ 2,500 分/);
    assert.match(await page.locator('[data-target]').innerText(), /上一轮/);
    assert.equal(await contribute.isDisabled(), true);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 2);
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-previous-cycle-completed.png') });
    // A successful EA contribution with unfinished local synchronization is
    // not an unknown contribution and must never leave the writer enabled.
    await page.evaluate(() => {
      const plan = globalThis.streamlinedEvidence.lastPlan;
      globalThis.streamlinedEvidence.recoveryThrows = false;
      globalThis.streamlinedEvidence.recoveryOutcome = { status: 'recovery-required', reason: 'FC27_STREAMLINED_SET_CHANGED',
        record: { plan, submittedScore: 0, batches: plan.batches.map(() => ({ state: 'unknown' })) },
        confirmation: { submittedScore: plan.challenge.targetScore, targetScore: plan.challenge.targetScore,
          completed: true, finalizationPending: true } };
    });
    await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
    const confirmedMessage = await page.locator('[data-status]').innerText();
    assert.match(confirmedMessage, /SBC 已完成/);
    assert.match(confirmedMessage, /仅本地界面同步未完成.*不会重复投入/);
    assert.doesNotMatch(confirmedMessage, /结果尚未确认/);
    const completedScore = await page.evaluate(() => globalThis.streamlinedEvidence.lastPlan.challenge.targetScore.toLocaleString('en-US'));
    assert.equal(await page.locator('[data-final-progress]').innerText(), `已确认 ${completedScore} / ${completedScore} 分`);
    assert.equal(await contribute.isVisible(), false);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 2);
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-confirmed-sync-pending.png') });
    await page.evaluate(() => { globalThis.streamlinedEvidence.recoveryOutcome = { status: 'absent' }; });
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
    assert.doesNotMatch(blocked, /contribution interface unavailable/);
    assert.equal(await page.evaluate(() => globalThis.streamlinedEvidence.writes), 2, 'Pending purchase never spends materials');
    await exerciseStreamlinedMarket(page);
    await exerciseStreamlinedValue(page);
    await exerciseStreamlinedOwnedRecipe(page);
    await exerciseStreamlinedDistinctRecipe(page);
    await exerciseStreamlinedQuoteWait(page);
    await exerciseStreamlinedQuoteExpiry(page);
    await exerciseStreamlinedRollingExpiry(page);
    await exerciseStreamlinedBatchedInventory(page);
    await exerciseStreamlinedProtectionBlocked(page);
    console.log('Streamlined offline browser passed: native entry, settings, 30+30+20, market routes, frozen settings, partial progress, stop/recover, unavailable supply, completion, responsive dialog, no EA writes.');
  } finally { await page.close(); }
}

async function exerciseStreamlinedProtectionBlocked(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge();
    const evidence = { writes: 0, quoteReads: 0, execution: 0, logs: [], phase: 'protection-lock-list' };
    globalThis.protectionSmoke = evidence;
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      readInputs: () => {
        const error = Error('FC27_STREAMLINED_PROTECTION_UNVERIFIED');
        error.evidence = { phase: evidence.phase, count: 11, requiredSlots: 23, mismatch: 'length' };
        throw error;
      }, get: async () => null, set: async () => { evidence.writes++; },
      prices: { load: async () => { evidence.quoteReads++; } },
      createExecution: async () => { evidence.execution++; }, diagnosticLog: { record: row => evidence.logs.push(row) } });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  for (const [phase, message] of [['protection-lock-list', 'FSU 锁卡名单'], ['protection-slot-list', '11 / 23'],
    ['protection-active-state', '主阵容的启用状态尚未核验']]) {
    await page.evaluate(value => { globalThis.protectionSmoke.phase = value; }, phase);
    await page.getByRole('button', { name: '生成方案', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-solve]').disabled);
    assert.ok((await page.locator('[data-result]').innerText()).includes(message));
    assert.ok((await page.locator('[data-status]').innerText()).includes(message), 'The footer explains the protection failure too');
    assert.equal(await page.locator('[data-contribute]').isVisible(), false);
  }
  assert.deepEqual(await page.evaluate(() => {
    const e = globalThis.protectionSmoke; return { writes: e.writes, quoteReads: e.quoteReads, execution: e.execution, phases: e.logs.map(row => row.phase) };
  }), { writes: 0, quoteReads: 0, execution: 0, phases: ['protection-lock-list', 'protection-slot-list', 'protection-active-state'] });
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-protection-blocked.png' });
}

async function exerciseStreamlinedBatchedInventory(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    const evidence = { requests: 0, writes: 0, maxActive: 0, active: 0, progress: [] }, cache = new Map();
    globalThis.batchedInventorySmoke = evidence;
    const inventory = Array.from({ length: 482 }, (_, index) => a.safeItem({ id: index + 1000, definitionId: index + 1000,
      rating: 75 + index % 10, points: index % 10 === 9 ? 830 : 100, name: `Inventory ${index}` }));
    const rows = inventory.map(item => ({ definitionId: item.definitionId, rating: item.rating }));
    const shared = a.createGalleryReferencePrices({
      readFutbin: async () => { throw Error('Unexpected per-version read'); },
      readFutbinBatch: (ids, players, options) => a.readFutbinBatchPrices(ids, players, { ...options, cache,
        request: async address => {
          evidence.requests++; evidence.maxActive = Math.max(evidence.maxActive, ++evidence.active);
          await new Promise(resolve => setTimeout(resolve, 100)); evidence.active--;
          const url = new URL(address), rating = Number(url.searchParams.get('rating').split('-')[0]);
          const page = Number(url.searchParams.get('page'));
          return JSON.stringify({ errorcode: '200', data: rows.filter(row => row.rating === rating)
            .slice((page - 1) * 32, page * 32).map(row => ({ resource_id: row.definitionId,
              rating, pc_LCPrice: 1000, ps_LCPrice: 2000 })) });
        } }),
    });
    const prices = { load: (ids, options) => shared.load(ids, { ...options, platform: 'pc', sources: ['futbin'],
      policy: { source: 'futbin' }, onProgress: p => { evidence.progress.push(p.index); options.onProgress(p); } }) };
    const session = a.createFc27StreamlinedSession({ prices, inspect: () => ({ context: c.context, challenge: c }),
      readInputs: () => ({ context: c.context, challenge: c, inventory, priceRows: rows, eligibility: a.eligibility,
        policy: { ...a.policy, maxRating: 99, goldRange: [75, 97] }, assertCurrent() {} }),
      get: async () => null, set: async () => { evidence.writes++; } });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  await page.locator('[data-mode]').selectOption('inventory');
  await page.locator('[data-objective]').selectOption('lowest-value');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.getByText(/库存报价 \d+ \/ 482 · FUTBIN/, { exact: false }).waitFor();
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-batched-inventory-progress.png' });
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-result]').textContent.includes('总材料价值'));
  const evidence = await page.evaluate(() => globalThis.batchedInventorySmoke);
  assert.equal(evidence.requests, 20, 'Synthetic 482-version inventory reads twenty public pages, not 482 single versions');
  assert.equal(evidence.maxActive, 3);
  assert.equal(evidence.active, 0);
  assert.equal(evidence.writes, 0);
  assert.match(await page.locator('[data-result]').innerText(), /FUTBIN/);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-result]').textContent.includes('总材料价值'));
  assert.equal(await page.evaluate(() => globalThis.batchedInventorySmoke.requests), 20, 'A second solve reuses exact quote cache');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-batched-inventory-result.png' });
}

async function exerciseStreamlinedRollingExpiry(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, evidence = { reads: 0, writes: 0, refreshes: [], active: 0, maximum: 0 };
    globalThis.rollingExpirySmoke = evidence;
    let time = 1000000;
    const root = { APP_YEAR_SHORT: 27, APP_YEAR: 2027, GAME_NAME: 'fc27', UTSearchCriteriaDTO: class {},
      SearchType: { PLAYER: 'player' }, SearchCategory: { ANY: 'any' },
      services: { User: { currentUserId: 1, repository: { _collection: {
        1: { id: 1, selectedPersona: 2, _personas: { _collection: {
          2: { id: 2, _sku: 'fixture', clubs: { _collection: { fixture: { sku: 'fixture', year: 2027, platform: 'pc' } } } },
        } } },
      } } } } };
    const context = a.readFc27Context(root), c = { ...a.challenge({ scoreRequirement: 12000 }), context };
    const ids = Array.from({ length: 166 }, (_, index) => index + 101), cache = new Map();
    const entities = ids.map(definitionId => ({ definitionId, type: 'player', concept: true,
      upgrades: null, cosmetics: [], _hyperCosmeticDTOs: {}, _rareflag: 1, _rating: 84,
      sbsScore: 830, leagueId: 13, nationId: 1, teamId: 1, preferredPosition: 25, name: `Fixture ${definitionId}` }));
    root.services.Item = { searchConceptItems: criteria => ({ observe: (_owner, callback) => callback(null,
      { success: true, status: 200, response: { items: entities.filter(item => criteria.defId.includes(item.definitionId)) } }), unobserve() {} }) };
    for (let index = 0; index < 52; index++) {
      const definitionId = ids[index], remaining = index === 51 ? 87327 : 10000;
      cache.set(`fcat-public-quotes-v2:27:pc:futbin:${definitionId}`, { schema: 2, source: 'futbin',
        season: '27', platform: 'pc', definitionId, price: 200, error: null, sourceUpdatedAt: null,
        fetchedAt: time - 300000 + remaining, expiresAt: time + remaining });
    }
    const shared = a.createGalleryReferencePrices({ now: () => time,
      get: async (key, fallback) => cache.get(key) ?? fallback,
      set: async (key, value) => cache.set(key, structuredClone(value)),
      readFutgg: async () => { throw Error('Unexpected source fallback'); },
      readFutbin: async definitionId => {
        evidence.reads++; time += 626;
        evidence.maximum = Math.max(evidence.maximum, ++evidence.active);
        await new Promise(resolve => setTimeout(resolve, definitionId === 101 ? 250 : 3));
        evidence.active--;
        return { definitionId, price: definitionId === 101 ? 250 : 500 };
      },
    });
    const prices = { load: (ids, options) => shared.load(ids, { ...options, platform: 'pc', sources: ['futbin'],
      policy: { readSources: 'futbin', source: 'futbin', premium: 50 } }) };
    const input = { context, challenge: c, policy: a.policy, eligibility: a.eligibility,
      inventory: [], assertCurrent() {}, registerMarketEntity() {} };
    const market = a.createFc27StreamlinedMarket(root, { prices, catalog: { load: async () => ({ ids }) },
      now: () => time, diagnosticLog: { record: row => { evidence.refreshes.push(row); } } });
    const session = a.createFc27StreamlinedSession({ prices, readMarketCandidates: market,
      inspect: () => ({ context, challenge: c }), readInputs: () => input, now: () => time,
      get: async (_key, fallback) => fallback, set: async () => { evidence.writes++; } });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.getByText(/刷新过期补卡报价 \d+ \/ 52 · FUTBIN · 已等待 \d+ 秒/, { exact: true }).waitFor();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('[data-result]').innerText(), /待购 3,750 金币/);
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.reads), 144, 'One quote round stops launching reads at its shared 90-second deadline');
  assert.match(await page.locator('[data-result]').innerText(), /补卡版本报价：有效 144 \/ 166/);
  assert.equal(await page.locator('[data-quote-confirm]').count(), 0, 'Quote coverage is accepted by the trusted execution action, not an extra checkbox');
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.maximum), 3);
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.active), 0);
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.writes), 0);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-futbin-rolling-expiry.png' });
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.reads), 166, 'Regeneration reads only the remaining 22 unresolved versions');
  assert.equal(await page.locator('[data-quote-confirm]').count(), 0, 'Complete fresh coverage removes the partial-quote confirmation requirement');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.reads), 166, 'A complete recovered cache is reused without new network reads');
  assert.equal(await page.evaluate(() => globalThis.rollingExpirySmoke.writes), 0);
}

async function exerciseStreamlinedOwnedRecipe(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    const inventory = Array.from({ length: 8 }, (_, i) => a.safeItem({ id: 100 + i, definitionId: 100 + i,
      points: 830, rating: 84, name: `Owned 84 ${i + 1}`, pile: i < 3 ? 'storage' : 'club' }));
    const quote = (definitionId, price) => ({ definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 });
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      get: async () => null, set: async () => {}, now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, inventory, eligibility: a.eligibility, assertCurrent() {},
        policy: { ...a.policy, maxRating: 99, goldRange: [75, 97], onlyUntradeable: false,
          protectFsuLockedPlayers: true, protectActiveSquad: true } }),
      prices: { load: async ids => ({ policy: { source: 'futgg' },
        references: Object.fromEntries(ids.map(id => [id, { quotes: { futgg: quote(id, 800) } }])) }) },
      readMarketCandidates: async () => ({ market: [[901, 830, 800, 84], [902, 5500, 5200, 87]]
        .map(([definitionId, points, price, rating]) => a.safeItem({ source: 'market', definitionId,
          points, price, rating, quote: quote(definitionId, price) })) }) });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  await page.locator('[data-objective]').selectOption('lowest-value');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('.route-list button').first().innerText(), /总价值 11,600.*待购 5,200.*库存 8 \/ 待购 1/);
  assert.match(await page.locator('[data-result]').innerText(), /已有材料估值 6,400/);
  assert.equal(await page.locator('.player-row').count(), 9);
  assert.equal(await page.locator('.inventory-row').count(), 8);
  assert.match(await page.locator('[data-inventory-review]').innerText(), /Owned 84 1/);
  assert.match(await page.locator('[data-inventory-review]').innerText(), /SBC 仓库/);
  assert.match(await page.locator('[data-result]').innerText(), /锁卡保护：开启.*当前主阵容保护：开启/);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true, 'Preview cannot spend or contribute');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const size = await page.getByRole('dialog').evaluate(dialog => ({ scroll: dialog.scrollWidth, client: dialog.clientWidth }));
    assert.ok(size.scroll <= size.client + 1);
    await page.locator('[data-review-stock]').click();
    await page.screenshot({ path: `artifacts/fc27-browser/streamlined-owned-recipe-${width}.png` });
  }
}

async function exerciseStreamlinedDistinctRecipe(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    globalThis.distinctRecipeSmoke = { writes: 0 };
    const inventory = [a.safeItem({ id: 901, definitionId: 901, rating: 85, points: 2100 }),
      ...Array.from({ length: 3 }, (_, i) => a.safeItem({ id: 902 + i, definitionId: 902 + i, rating: 84, points: 830 }))];
    const quote = (definitionId, price) => ({ definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 });
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      get: async () => null, set: async () => { globalThis.distinctRecipeSmoke.writes++; }, now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, inventory, eligibility: a.eligibility, assertCurrent() {},
        policy: { ...a.policy, maxRating: 99, goldRange: [75, 97], onlyUntradeable: false } }),
      prices: { load: async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(id =>
        [id, { quotes: { futgg: quote(id, id === 901 ? 2700 : 1000) } }])) }) },
      readMarketCandidates: async () => ({ market: Array.from({ length: 9 }, (_, i) => {
        const definitionId = 101 + i, price = i === 0 ? 1000 : 1050;
        return a.safeItem({ source: 'market', definitionId, points: 830, rating: 84, price,
          name: `Distinct ${definitionId}`, quote: quote(definitionId, price) });
      }) }) });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  await page.locator('[data-objective]').selectOption('lowest-value');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('.route-list button').first().innerText(), /总价值 14,700.*至少 9 批/);
  const alternative = page.locator('.route-list button').filter({ hasText: '待购 9,400' });
  assert.equal(await alternative.count(), 1);
  await alternative.click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-result]').textContent.includes('待购 9,400'));
  assert.match(await alternative.innerText(), /库存 4 \/ 待购 9.*至少 1 批/);
  assert.equal(await page.locator('.player-row').count(), 13);
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true);
  assert.equal(await page.evaluate(() => globalThis.distinctRecipeSmoke.writes), 0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.screenshot({ path: `artifacts/fc27-browser/streamlined-distinct-recipe-${width}.png` });
  }
}

async function exerciseStreamlinedQuoteWait(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    globalThis.quoteWaitSmoke = { writes: 0, loads: 0, fail: false, heartbeats: 0 };
    const session = a.createFc27StreamlinedSession({
      inspect: () => ({ context: c.context, challenge: c }),
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [a.safeItem({ points: 830 })], assertCurrent() {} }),
      get: async (_key, fallback) => fallback, set: async () => { globalThis.quoteWaitSmoke.writes++; },
      prices: { load: async (_ids, { onProgress }) => {
        globalThis.quoteWaitSmoke.loads++;
        onProgress({ source: 'futbin', index: 0, total: 1 });
        if (!globalThis.quoteWaitSmoke.fail) await new Promise(resolve => { globalThis.quoteWaitSmoke.resolve = resolve; });
        return { policy: { source: 'futbin' }, references: { 2: { quotes: { futbin: {
          source: 'futbin', definitionId: 2, price: null, error: 'FC27_BUY_REFERENCE_TIMEOUT' } } } } };
      } },
      readMarketCandidates: async () => ({ market: [], pricePolicy: { source: 'futbin' },
        quoteReadError: 'FC27_BUY_REFERENCE_TIMEOUT', quoteCoverage: { requested: 1, valid: 0, failed: 1, missing: 0 } }),
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
    globalThis.quoteWaitSmoke.timer = setInterval(() => { globalThis.quoteWaitSmoke.heartbeats++; }, 50);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  await page.locator('[data-objective]').selectOption('lowest-value');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.getByText('库存报价 0 / 1 · FUTBIN · 已等待 1 秒', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => globalThis.quoteWaitSmoke.heartbeats >= 10), 'Read wait does not block the UI thread');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-wait-desktop.png' });
  await page.setViewportSize({ width: 390, height: 600 });
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-wait-mobile.png' });
  assert.ok((await page.getByRole('button', { name: '停止', exact: true }).boundingBox()).y < 600, 'Stop remains visible');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止。', { exact: true }).waitFor({ timeout: 1500 });
  assert.equal(await page.getByRole('button', { name: '生成方案', exact: true }).isEnabled(), true);
  await page.evaluate(() => { globalThis.quoteWaitSmoke.resolve(); globalThis.quoteWaitSmoke.fail = true; });
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.getByText('报价读取失败或已过期，未生成方案。请检查所选报价来源连接后重新生成。', { exact: true }).waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /FUTBIN · FC27_BUY_REFERENCE_TIMEOUT/);
  assert.equal(await page.locator('.route-list button').count(), 0, 'An outage cannot approve costly cached routes');
  assert.equal(await page.evaluate(() => globalThis.quoteWaitSmoke.writes), 0);
  await page.evaluate(() => clearInterval(globalThis.quoteWaitSmoke.timer));
}

async function exerciseStreamlinedQuoteExpiry(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 12000 });
    globalThis.quoteExpirySmoke = { fail: true, writes: 0 };
    const quote = definitionId => ({ source: 'futbin', definitionId, price: 800, fetchedAt: 1, expiresAt: 1000 });
    const session = a.createFc27StreamlinedSession({
      inspect: () => ({ context: c.context, challenge: c }), now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [a.safeItem({ points: 830 })], assertCurrent() {} }),
      get: async (_key, fallback) => fallback, set: async () => { globalThis.quoteExpirySmoke.writes++; },
      prices: { load: async () => ({ policy: { source: 'futbin' },
        references: { 2: { quotes: { futbin: quote(2) } } } }) },
      readMarketCandidates: async ({ onProgress }) => {
        onProgress({ phase: 'market-quotes', source: 'futbin', completed: 0, total: 1, refresh: true });
        await new Promise(resolve => setTimeout(resolve, 500));
        if (globalThis.quoteExpirySmoke.fail) throw Error('FC27_STREAMLINED_QUOTES_EXPIRED');
        return { pricePolicy: { source: 'futbin' }, market: [a.safeItem({ source: 'market', definitionId: 901,
          points: 830, price: 800, quote: quote(901) })] };
      },
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  await page.locator('[data-objective]').selectOption('lowest-value');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.getByText('刷新过期补卡报价 0 / 1 · FUTBIN · 已等待 0 秒', { exact: true }).waitFor();
  await page.getByText('FUTBIN 补卡报价在等待中到期，刷新后仍未取得完整有效报价。请重新生成方案；不会使用过期报价或自动切换来源。', { exact: true }).waitFor();
  assert.equal((await page.locator('[data-result]').innerText()).includes('FUT.GG'), false);
  assert.equal(await page.locator('[data-contribute]').isVisible(), false);
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-futbin-expiry.png' });
  await page.evaluate(() => { globalThis.quoteExpirySmoke.fail = false; });
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('[data-result]').innerText(), /FUTBIN/);
  assert.equal(await page.evaluate(() => globalThis.quoteExpirySmoke.writes), 0);
}

async function exerciseStreamlinedValue(page) {
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 100 });
    const evidence = { quotes: 0, market: 0 };
    globalThis.valueSmoke = evidence;
    const session = a.createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
      get: async () => null, set: async () => {}, now: () => 100,
      readInputs: () => ({ context: c.context, challenge: c, policy: a.policy, eligibility: a.eligibility,
        inventory: [a.safeItem({ points: 100 })], assertCurrent() {} }),
      prices: { load: async () => { evidence.quotes++; return { policy: { source: 'futgg' }, references: {
        2: { quotes: { futgg: { source: 'futgg', definitionId: 2, price: 30000, fetchedAt: 1, expiresAt: 1000 } } },
      } }; } },
      readMarketCandidates: async () => { evidence.market++; return { market: [a.safeItem({ source: 'market',
        definitionId: 901, points: 25, price: 2000,
        quote: { source: 'futgg', definitionId: 901, price: 2000, fetchedAt: 1, expiresAt: 1000 } })] }; },
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => ({ anchor: globalThis.document.getElementById('native'), setId: c.setId, challengeId: c.id }) });
  });
  await page.getByRole('button', { name: 'FCAT 积分解题', exact: true }).click();
  assert.equal(await page.locator('[data-objective]').inputValue(), 'inventory-first');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('.route-list button').first().innerText(), /待购 0.*1 张/);
  assert.deepEqual(await page.evaluate(() => globalThis.valueSmoke), { quotes: 0, market: 0 });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const dimensions = await page.getByRole('dialog').evaluate(node => ({ width: node.getBoundingClientRect().width,
      scroll: node.scrollWidth, client: node.clientWidth }));
    assert.ok(dimensions.width <= width && dimensions.scroll <= dimensions.client + 1, 'Inventory-first fits desktop and mobile');
    await page.locator('.route-list button').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/fc27-browser/streamlined-inventory-first-${width}.png` });
  }
  // The prior economic behavior remains available as an explicit choice.
  await page.locator('[data-objective]').selectOption('lowest-value');
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.route-list button').first().waitFor();
  assert.match(await page.locator('.route-list button').first().innerText(), /总价值 8,000.*待购 8,000.*4 张/);
  assert.match(await page.locator('[data-result]').innerText(), /总材料价值 8,000 金币/);
  await page.locator('.route-list button').last().click();
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('.route-list button:last-child').getAttribute('aria-pressed') === 'true');
  assert.match(await page.locator('[data-result]').innerText(), /总材料价值 30,000 金币 · 待购 0 金币/);
  assert.deepEqual(await page.evaluate(() => globalThis.valueSmoke), { quotes: 1, market: 1 });
  assert.equal(await page.locator('[data-contribute]').isDisabled(), true, 'Route selection never grants contribution authority');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const dimensions = await page.getByRole('dialog').evaluate(node => ({ width: node.getBoundingClientRect().width,
      scroll: node.scrollWidth, client: node.clientWidth }));
    assert.ok(dimensions.width <= width && dimensions.scroll <= dimensions.client + 1, 'Cost summaries fit desktop and mobile');
    await page.screenshot({ path: `artifacts/fc27-browser/streamlined-value-${width}.png` });
  }
}

async function exerciseStreamlinedMarket(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // This is a separate synthetic session. Trusted clicks exercise the real
  // panel/session, while every execution effect stays in this fixture.
  let requests = 0;
  await page.route('**/*', route => { requests++; return route.abort(); });
  await page.evaluate(() => {
    globalThis.streamlinedMount.dispose();
    const a = globalThis.StreamlinedSmoke, c = a.challenge({ scoreRequirement: 100 });
    const saved = new Map(), evidence = { calls: 0, mode: 'stopped', saved: [], record: null, now: 1000, holdPreflight: true, holdHoldings: true };
    globalThis.marketSmoke = evidence;
    let finish;
    const transaction = { recover: async () => ({ status: 'absent' }) };
    const execution = {
      prepare() {}, transaction,
      stop() { finish?.(); },
      recoverPurchase: async () => ({ status: 'recovered', record: evidence.record }),
      async purchase(plan, approval, { onProgress }) {
        evidence.calls++; evidence.execution = plan.execution;
        if (evidence.holdPreflight) await new Promise(resolve => { evidence.preflight = resolve; });
        evidence.approval = approval;
        evidence.record = { context: c.context, plan, submittedScore: 0, spent: 300, budget: approval.budget,
          completed: false, consumedIds: [], entries: [{ state: 'club' }, { state: 'club' }] };
        if (evidence.holdHoldings) await new Promise(resolve => {
          evidence.holdings = resolve;
          onProgress({ phase: 'checking-holdings', holdingsBatch: 1, holdingsBatchTotal: 2, offset: 250,
            batchNumber: 1, purchased: 0, purchaseTarget: 10, spent: 0, budget: approval.budget,
            contributed: 0, submittedScore: 0, targetScore: 100 });
        });
        if (evidence.mode === 'stopped') {
          await new Promise(resolve => {
            finish = resolve;
            onProgress({ phase: 'partial-ready', batchNumber: 1, purchased: 2, purchaseTarget: 10,
              spent: 300, budget: approval.budget, contributed: 0, submittedScore: 0, targetScore: 100,
              readyCount: 2, selectionLimit: 30, readyPoints: 20, waitMs: 12000 });
          });
          finish = null;
          return { status: 'stopped', reason: 'FC27_STREAMLINED_STOPPED', record: evidence.record };
        }
        if (['no-supply', 'holdings'].includes(evidence.mode)) return { status: 'paused',
          reason: evidence.mode === 'holdings' ? 'FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED'
            : 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', record: evidence.record };
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
        ...(evidence.quoteLimited ? { quoteReadError: 'FC27_BUY_REFERENCE_TIMEOUT',
          quoteCoverage: { requested: 3, valid: 2, failed: 1, missing: 0 } } : {}),
        market: [[101, 10, 150], [102, 100, 2000]].map(([definitionId, points, price]) => ({ ...a.safeItem({
          source: 'market', definitionId, points, price,
          quote: { definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 },
        }), purchaseMaxBuy: price })) }),
      createExecution: async () => execution,
    });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session, now: () => evidence.now,
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
  assert.match(await page.locator('.route-list').innerText(), /1,500.*100 分.*10 张/);
  const routeLabels = await page.locator('.route-list button').allTextContents();
  assert.match(routeLabels[0], /至少 10 批.*重复购卡 9/,
    'Repeated market versions require separate purchase waves in the compact route summary');
  assert.equal(routeLabels.some(label => /OVR|Version|Purchase estimate|已有材料估值/.test(label)), false,
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
  assert.match(await page.locator('[data-selection]').innerText(), /点击执行将授权此目标/);
  assert.equal(await page.locator('[data-purchase-budget]').inputValue(), '1725');
  assert.match(await page.locator('[data-result]').innerText(), /单卡上限合计 1,500 \+ 15% 替代预留 225/);
  assert.match(await page.locator('[data-result]').innerText(), /不提高单卡限价，也不要求花完/);
  await page.locator('[data-purchase-budget]').fill('1600');
  assert.match(await page.locator('[data-result]').innerText(), /授权市场替代池：2 个版本/);
  assert.match(await page.locator('[data-result]').innerText(), /每卡最多尝试 7 次 · 部分批次等待上限 12 秒/);
  const run = page.getByRole('button', { name: '按方案购买并贡献', exact: true });
  assert.equal(await run.isEnabled(), true);
  assert.equal(await page.locator('[data-status]').evaluate(node => !!node.closest('footer')), true,
    'Execution progress stays beside the action buttons, not above a long result list');
  await run.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 0);
  await run.click();
  await page.getByText('准备执行：核对方案与恢复记录', { exact: false }).waitFor();
  await page.evaluate(() => { globalThis.marketSmoke.now += 2300; });
  await page.waitForFunction(() => globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot
    .querySelector('[data-clock]').textContent.includes('本次耗时 2 秒'));
  await page.evaluate(() => { globalThis.marketSmoke.holdPreflight = false; globalThis.marketSmoke.preflight(); });
  await page.getByText('版本核对 1 / 2 组 · 第 2 页', { exact: false }).waitFor();
  assert.match(await page.locator('[data-status]').innerText(), /核对 Club 版本持有/);
  await page.evaluate(() => { globalThis.marketSmoke.holdHoldings = false; globalThis.marketSmoke.holdings(); });
  await page.getByText('本批就绪 2 / 30 张 · 20 分', { exact: false }).waitFor();
  assert.match(await page.locator('[data-status]').innerText(), /已购 2 \/ 10 张/);
  assert.match(await page.locator('[data-clock]').innerText(), /预计收批等待剩余/);
  await page.locator('.panel-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const bounds = await page.locator('[data-status]').evaluate(node => {
    const rect = node.getBoundingClientRect(), dialog = node.closest('dialog').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, dialogTop: dialog.top, dialogBottom: dialog.bottom };
  });
  assert.ok(bounds.top >= bounds.dialogTop && bounds.bottom <= bounds.dialogBottom, 'Progress remains in view after scrolling to the buttons');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-execution-progress-desktop.png' });
  await page.setViewportSize({ width: 390, height: 700 });
  const narrow = await page.getByRole('dialog').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(narrow.scroll <= narrow.width + 1, 'Execution footer has no narrow-screen horizontal overflow');
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-execution-progress-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.locator('[data-mode]').isDisabled(), true);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByText('已停止；已确认成交保留。有未决回执时先核对，否则可直接继续。', { exact: true }).waitFor();
  assert.match(await page.locator('[data-selection]').innerText(), /已就绪 2 张/);
  const stoppedTime = await page.locator('[data-clock]').innerText();
  await page.evaluate(() => { globalThis.marketSmoke.now += 5000; });
  assert.equal(await page.locator('[data-clock]').innerText(), stoppedTime, 'Elapsed time freezes after stopping');
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.execution.purchaseAttempts), 7);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.execution.partialWaitMs), 12000);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.execution.purchaseScope.groups.length), 2);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.approval.budget), 1600, 'The trusted click uses the edited budget, not the default reserve');
  assert.equal(await page.locator('[data-purchase-budget]').inputValue(), '1600');
  assert.equal(await page.locator('[data-purchase-budget]').isDisabled(), true);
  assert.match(await page.locator('[data-result]').innerText(), /执行预算已冻结：1,600 金币/);
  await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
  await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-recover]').disabled);
  assert.equal(await run.isEnabled(), true);
  await page.evaluate(() => { globalThis.marketSmoke.mode = 'holdings'; });
  await run.click();
  await page.getByText('Club 版本持有读取未通过核验，已暂停；本次检查未发出购买或献祭请求。可直接重试，持续出错时导出诊断；已有未决交易仍须先核对。', { exact: true }).waitFor();
  assert.equal(await run.isEnabled(), true, 'A read-only holdings pause can be retried without a recovery click');
  await page.evaluate(() => { globalThis.marketSmoke.mode = 'no-supply'; });
  await run.click();
  await page.getByText('有限重试后仍无授权范围内的限价候选，已暂停。已购材料保留，可稍后重试或生成新方案；普通缺货不需要核对交易回执。', { exact: true }).waitFor();
  assert.equal(await run.isEnabled(), true, 'Normal scarcity can be retried without a recovery click');
  await page.evaluate(() => { globalThis.marketSmoke.mode = 'completed'; });
  await run.click();
  await page.getByText('目标已达成，奖励状态需另行核对。', { exact: true }).waitFor();
  assert.equal(await run.isDisabled(), true);
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 4);
  await page.evaluate(() => { globalThis.marketSmoke.quoteLimited = true; });
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('[data-result] section.inventory-warning').waitFor();
  assert.match(await page.locator('[data-result]').innerText(), /报价覆盖不完整.*最低价/);
  assert.match(await page.locator('[data-result]').innerText(), /补卡版本报价：有效 2 \/ 3 · 失败 1/);
  assert.equal(await page.locator('[data-quote-confirm]').count(), 0);
  await run.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 4, 'Only a trusted execution click approves quote coverage');
  assert.equal(await run.isEnabled(), true);
  await page.locator('.route-list button').last().click();
  await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-panel').shadowRoot.querySelector('[data-solve]').disabled);
  assert.equal(await run.isEnabled(), true, 'Changed route requires a new trusted execution click, not another checkbox');
  await page.locator('[data-result] section.inventory-warning').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-coverage-desktop.png' });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.locator('[data-result] section.inventory-warning').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-quote-coverage-mobile.png' });
  const coverageBounds = await page.getByRole('dialog').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(coverageBounds.scroll <= coverageBounds.width + 1, 'Quote coverage warning has no narrow-screen horizontal overflow');
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 4, 'Quote-limited previews have not executed');
  await run.click();
  await page.getByText('目标已达成，奖励状态需另行核对。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.marketSmoke.calls), 5);
  assert.equal(requests, 0, 'The synthetic market UI must never make network requests');
}
