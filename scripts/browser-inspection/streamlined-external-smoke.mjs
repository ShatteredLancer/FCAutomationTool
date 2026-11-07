import assert from 'node:assert/strict';

export async function exerciseStreamlinedExternal(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    globalThis.streamlinedMount?.dispose();
    const a = globalThis.StreamlinedSmoke, anchor = globalThis.document.querySelector('main');
    anchor.replaceChildren();
    anchor.innerHTML = `<style>
      .ut-one-click-sbc-work-area-view--tabs{background:#1d272f;padding-top:10px}
      .ea-filter-bar-view{text-align:center;overflow-x:auto;overflow-y:hidden;padding-bottom:10px;white-space:nowrap;width:100%}
      .ea-filter-bar-item-view{padding:12px 24px;background:#1d272f;border:1px solid #deded826;border-radius:10px;color:#deded8;display:inline-flex;margin:4px;font:14px Arial}
      .ea-filter-bar-item-view.selected{border-color:#9effc6;color:#fcfcfc}
    </style><div class="ea-filter-bar-view ut-one-click-sbc-work-area-view--tabs"><div class="menu-container"><button class="ea-filter-bar-item-view selected">Club</button><button class="ea-filter-bar-item-view">SBC Storage</button></div></div>`;
    const c = a.challenge({ scoreRequirement: 1000 });
    const inventory = [a.safeItem({ id: 1, definitionId: 100, name: 'Club prerequisite' }),
      ...Array.from({ length: 27 }, (_, index) => a.safeItem({ id: index + 2,
        definitionId: index < 2 ? 100 : index + 1000, name: `External ${index + 2}`,
        pile: index % 2 ? 'unassigned' : 'transfer', activeTrade: index === 26 }))];
    const evidence = globalThis.externalSmoke = { current: true, rendered: 0, disposed: 0, writes: 0, quotes: 0, executed: 0 };
    const session = a.createFc27StreamlinedSession({ inspect: () => {
      if (!evidence.current) throw Error('FC27_STREAMLINED_PAGE_UNAVAILABLE');
      return { context: c.context, challenge: c };
    }, readInputs: () => {
      if (evidence.protectionFailure) throw Object.assign(Error('FC27_STREAMLINED_PROTECTION_UNVERIFIED'),
        { evidence: { phase: 'protection-cache', cached: false, mismatch: 'binding' } });
      return { context: c.context, challenge: c, inventory, policy: a.policy, eligibility: a.eligibility,
        assertCurrent() {}, resolveDisplayItem: ref => inventory.find(item => item.id === ref.id) };
    },
    get: async (_key, fallback) => fallback, set: async () => { evidence.writes++; },
    prices: { load: async () => { evidence.quotes++; throw Error('unexpected quote'); } },
    createExecution: async () => ({ prepare(plan) { evidence.plan = plan; },
      inspectContributionHistory: async () => evidence.offerHistory ? ({ recovery: { setId: 32, challengeId: 62, currentScore: 3860,
        targetScore: 5500, confirmedBatches: 1, waitingBatches: 1, pendingWriteCount: 0 },
        historyAction: { canArchive: !evidence.blockHistory, kind: 'contribution',
          ...(evidence.blockHistory ? { reason: 'FC27_STREAMLINED_HISTORY_RECEIPT_UNVERIFIED' } : {}) } }) : null,
      archiveContributionHistory: async () => { evidence.archives = (evidence.archives ?? 0) + 1; evidence.offerHistory = false;
        return { status: 'archived', reason: 'FC27_STREAMLINED_CONTRIBUTION_HISTORY_ARCHIVED' }; }, transaction: {
      recover: async () => evidence.offerHistory
        ? { status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED' } : { status: 'absent' },
      execute: async (plan, approval) => {
        if (evidence.lateHistory) return { status: 'blocked', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED',
          recovery: { setId: 32, challengeId: 62, currentScore: 3860, targetScore: 5500,
            confirmedBatches: 1, waitingBatches: 1, pendingWriteCount: 0 } };
        evidence.executed++; evidence.approval = approval;
        return { status: 'partial', record: { context: plan.context, plan, submittedScore: plan.score,
          batches: plan.batches.map((refs, index) => ({ index, refs, state: 'confirmed' })) } };
      } } }) });
    globalThis.streamlinedMount = a.mountFc27StreamlinedPanel({ document: globalThis.document, session,
      readTarget: () => evidence.current ? { anchor, setId: c.setId, challengeId: c.id } : null,
      nativeRenderer: { renderOwned({ parent, raw, slot, onUnavailable }) {
        const card = globalThis.document.createElement('div'); card.slot = slot;
        card.textContent = `${raw.name} · Native card fixture`; card.style.cssText = 'width:108px;height:150px;background:#254859';
        parent.append(card); evidence.rendered++; let disposed = false;
        card.__fcatDealloc = () => { if (!disposed) evidence.disposed++; disposed = true; };
        if (raw.id === 2) setTimeout(onUnavailable, 150);
        return card;
      } } });
  });
  assert.equal(await page.getByRole('button', { name: 'SBC Storage', exact: true }).count(), 1);
  const entry = page.getByRole('button', { name: 'Transfer / Unassigned', exact: true });
  assert.equal(await entry.evaluate(button => button.parentNode === button.closest('.ut-one-click-sbc-work-area-view--tabs')?.querySelector('.menu-container')), true);
  assert.equal(await entry.getAttribute('class'), 'ea-filter-bar-item-view');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const rects = await page.locator('.ut-one-click-sbc-work-area-view--tabs button').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect(); return { y: rect.y, height: rect.height };
    }));
    assert.equal(rects.length, 3); assert.equal(new Set(rects.map(rect => rect.y)).size, 1);
    assert.equal(new Set(rects.map(rect => rect.height)).size, 1);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-external-native-tabs.png' });
  await page.evaluate(() => {
    const bar = globalThis.document.querySelector('.ut-one-click-sbc-work-area-view--tabs');
    bar.replaceWith(bar.cloneNode(true)); globalThis.document.getElementById('fcat-streamlined-external-entry').remove();
  });
  await entry.waitFor();
  assert.equal(await entry.count(), 1, 'Native menu rebuild reattaches exactly one entry');
  await entry.evaluate(button => button.click());
  assert.equal(await page.getByRole('dialog').count(), 0, 'Synthetic entry clicks cannot start browsing');
  await entry.click();
  await page.locator('[data-external-list] .external-row').first().waitFor();
  assert.equal(await page.locator('[data-external-list] .external-row').count(), 24);
  assert.equal(await page.locator('[data-settings]').isVisible(), false);
  assert.match(await page.locator('[data-result]').innerText(), /先贡献 Club 同版本/);
  const choices = page.locator('[data-external-list] input[type=checkbox]');
  await choices.nth(0).check(); await choices.nth(1).check();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await choices.count(), 3); assert.equal(await choices.last().isDisabled(), true);
  assert.match(await page.locator('[data-result]').innerText(), /交易状态未核实/);
  await choices.first().check();
  assert.match(await page.locator('[data-external-summary]').innerText(), /已选外部卡 3 张.*Club 前置 1 张/);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  assert.equal(await choices.nth(0).isChecked(), true); assert.equal(await choices.nth(1).isChecked(), true);
  assert.deepEqual(await page.evaluate(() => ({ writes: globalThis.externalSmoke.writes,
    quotes: globalThis.externalSmoke.quotes, executed: globalThis.externalSmoke.executed })), { writes: 0, quotes: 0, executed: 0 });
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-external-selection-desktop.png' });
  await page.setViewportSize({ width: 390, height: 700 });
  assert.ok(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-external-selection-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '准备贡献预览', exact: true }).click();
  const contribute = page.getByRole('button', { name: '按顺序贡献', exact: true }); await contribute.waitFor();
  assert.equal(await page.getByRole('checkbox', { name: /选择第/ }).count(), 0);
  const batches = await page.evaluate(() => globalThis.externalSmoke.plan.batches.map(batch => batch.map(item => item.id)));
  assert.deepEqual(batches, [[1, 26], [2], [3]]);
  assert.match(await page.locator('[data-result]').innerText(), /Club 前置及所选外部卡/);
  await contribute.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => globalThis.externalSmoke.executed), 0);
  await contribute.click();
  await page.waitForFunction(() => globalThis.externalSmoke.executed === 1);
  assert.deepEqual(await page.evaluate(() => globalThis.externalSmoke.approval.batchIndices), [0, 1, 2]);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => globalThis.externalSmoke.rendered === globalThis.externalSmoke.disposed);
  await entry.click(); await page.locator('[data-external-list] .external-row').first().waitFor();
  assert.match(await page.locator('[data-external-summary]').innerText(), /已选外部卡 0 张/);
  await page.evaluate(() => { globalThis.externalSmoke.offerHistory = true; });
  await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
  const archive = page.getByRole('button', { name: '结束旧贡献余批并归档', exact: true });
  await archive.waitFor();
  assert.match(await page.locator('[data-history-note]').innerText(), /没有未知请求/);
  assert.equal(await page.locator('[data-contribute]').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: 'artifacts/fc27-browser/streamlined-foreign-history-mobile.png' });
  await archive.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => globalThis.externalSmoke.archives ?? 0), 0);
  await archive.click();
  assert.equal(await page.evaluate(() => globalThis.externalSmoke.archives), 1);
  assert.equal(await page.evaluate(() => globalThis.externalSmoke.executed), 1);
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.locator('[data-external-list] .external-row').first().waitFor();
  assert.match(await page.locator('[data-external-summary]').innerText(), /已选外部卡 0 张/);
  // Both the initial preview and a late cross-tab blocker must offer cleanup
  // directly, without a second recovery click or a repeated contribution.
  for (const stage of ['preview', 'contribute']) {
    await page.evaluate(stage => { globalThis.externalSmoke.offerHistory = stage === 'preview'; }, stage);
    await page.locator('[data-external-list] input[type=checkbox]').first().check();
    await page.getByRole('button', { name: '准备贡献预览', exact: true }).click();
    if (stage === 'contribute') {
      await page.evaluate(() => { globalThis.externalSmoke.offerHistory = true; globalThis.externalSmoke.lateHistory = true; });
      await page.getByRole('button', { name: '按顺序贡献', exact: true }).click();
    }
    await archive.waitFor();
    assert.equal(await page.getByRole('button', { name: '按顺序贡献', exact: true }).isDisabled(), true);
    assert.match(await page.locator('[data-status]').innerText(), /请先点击“结束旧贡献余批并归档”/);
    assert.equal(await page.locator('progress[aria-label="执行进度"]').isVisible(), false);
    assert.equal(await page.evaluate(() => globalThis.externalSmoke.executed), 1);
    await archive.click();
    await page.evaluate(() => { globalThis.externalSmoke.lateHistory = false; });
    await page.getByRole('button', { name: '刷新列表', exact: true }).click();
    await page.locator('[data-external-list] .external-row').first().waitFor();
  }
  assert.equal(await page.evaluate(() => globalThis.externalSmoke.archives), 3);
  await page.evaluate(() => { globalThis.externalSmoke.offerHistory = true; globalThis.externalSmoke.blockHistory = true; });
  await page.getByRole('button', { name: '核对并恢复', exact: true }).click();
  assert.equal(await archive.isVisible(), false);
  assert.match(await page.locator('[data-history-note]').innerText(), /缺少完整回执/);
  assert.match(await page.locator('[data-history-note]').innerText(), /不必反复点击恢复/);
  assert.equal(await page.evaluate(() => globalThis.externalSmoke.archives), 3);
  await page.evaluate(() => { globalThis.externalSmoke.protectionFailure = true; });
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  assert.match(await page.locator('[data-status]').innerText(), /原生主阵容缓存缺失/);
  assert.equal(await page.getByRole('button', { name: '准备贡献预览', exact: true }).isDisabled(), true);
  await page.evaluate(() => { globalThis.externalSmoke.protectionFailure = false; });
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.locator('[data-external-list] .external-row').first().waitFor();
  await page.evaluate(() => { globalThis.externalSmoke.current = false; });
  await page.waitForFunction(() => !globalThis.document.getElementById('fcat-streamlined-external-entry')?.isConnected);
  await page.waitForFunction(() => globalThis.externalSmoke.rendered === globalThis.externalSmoke.disposed);
  assert.equal(await page.getByRole('button', { name: 'SBC Storage', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => globalThis.externalSmoke.writes + globalThis.externalSmoke.quotes), 0);
}
