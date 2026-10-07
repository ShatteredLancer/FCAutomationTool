const number = value => Number.isSafeInteger(value) ? value.toLocaleString() : '未知';
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_UNAVAILABLE';

export function streamlinedExecutionMessage(reason, recovery = null) {
  if (reason === 'FC27_BUY_RECOVERY_REQUIRED') {
    const target = recovery?.kind === 'puzzle-purchase' && Number.isSafeInteger(recovery.setId) && Number.isSafeInteger(recovery.challengeId)
      ? `（Set ${recovery.setId} / Challenge ${recovery.challengeId}）` : '';
    const phase = { 'save-pending': '阵容替换保存尚未核对', ready: '购买或入库尚未核对', saved: '购买恢复标记尚未结清' }[recovery?.phase];
    const labels = { waiting: '未购买', 'buy-pending': '成交待核对', bought: '已购待入库',
      'move-pending': '入库待核对', 'move-rejected': '入库被拒', club: '已入库' };
    const counts = Object.entries(labels).flatMap(([state, label]) => {
      const count = recovery?.states?.[state];
      return Number.isSafeInteger(count) && count > 0 && count <= 32 ? [`${label} ${count}`] : [];
    });
    if (Number.isSafeInteger(recovery?.applied) && recovery.applied >= 0 && recovery.applied <= 32) counts.push(`已确认替换 ${recovery.applied}`);
    return `当前账号有待核对的 Puzzle 购卡记录${target}${phase ? `：${phase}` : ''}。${counts.length ? `记录状态：${counts.join('、')}。` : ''}请先回对应 SBC 的批量购买窗口核对并恢复；若该 SBC 已下架，请保留记录并导出诊断。本次未投入材料。`;
  }
  const messages = {
    FC27_BUY_JOURNAL_READ_FAILED: 'Puzzle 购买记录读取失败，请重新读取或导出诊断；未清除记录、未投入材料。',
    FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED: '当前账号有待核对的 Gallery 购卡记录，请先到 Gallery 购买窗口核对并继续购买。',
    FC27_RECOVERY_REQUIRED: '当前账号有待核对的传统 SBC 提交记录，请先恢复该次提交。',
    FC27_STREAMLINED_INITIATION_UNVERIFIED: '请先通过 EA 原生界面开始此 SBC，再重新生成方案。',
    FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED: '当前构建未启用贡献接口。',
    FC27_STREAMLINED_RECONCILIATION_REQUIRED: '本次投入结果尚待核对，请点击“核对并恢复”，不要重复投入。',
    FC27_STREAMLINED_RECOVERY_REQUIRED: '上次贡献已发出，结果尚待核对；请点击“核对并恢复”，不要再次投入。',
    FC27_STREAMLINED_CONTEXT_CHANGED: '账号、SBC 或积分状态已变化，请重新打开当前 SBC 并生成方案。',
    FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED: `另一个 SBC（Set ${recovery?.setId ?? '?'} / Challenge ${recovery?.challengeId ?? '?'}）仍有未结清的贡献记录，未在当前 SBC 恢复或重复投入。`,
    FC27_STREAMLINED_COMPLETED: '所选目标已达成，无需再次贡献。',
  };
  return messages[reason] ?? reason ?? '请重新生成方案或核对执行结果。';
}

// Fodder's observed workflow: native work-area entry -> settings -> progress ->
// batches in one window. No private solver, prototype hook or EA writer.
export function mountFc27StreamlinedPanel({ document, readTarget, session, nativeRenderer = null,
  schedule = setInterval, unschedule = clearInterval } = {}) {
  if (!document?.body || document.getElementById('fcat-streamlined-entry')) return null;
  const add = (parent, tag, value = '') => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
  const entry = document.createElement('button'); entry.id = 'fcat-streamlined-entry'; entry.type = 'button';
  entry.textContent = 'FCAT 积分解题'; entry.className = 'btn-standard call-to-action';
  entry.style.cssText = 'margin:8px;min-height:38px';
  const host = document.createElement('div'); host.id = 'fcat-streamlined-panel'; document.body.append(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box} [hidden]{display:none!important}
    dialog{width:min(720px,94vw);max-width:94vw;max-height:88vh;overflow:auto;background:#17232c;color:#ecf2f5;border:1px solid #53636d;border-radius:10px;padding:16px;font:14px/1.5 Arial,sans-serif}
    dialog::backdrop{background:#000a}header,footer,.tabs{display:flex;gap:10px;align-items:center}header{margin-bottom:12px}header strong{flex:1}footer{position:sticky;bottom:-16px;background:#17232c;padding:12px 0;justify-content:flex-end;border-top:1px solid #46545d}
    button,select,input{font:inherit;color:inherit;background:#25353f;border:1px solid #536570;border-radius:5px;padding:6px 9px;min-height:34px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true]{color:#b4f2d7;border-color:#b4f2d7}button.primary{background:#b4f2d7;color:#15251f}label{display:grid;gap:5px;min-width:0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.sources{display:flex;gap:12px}.sources label{display:flex;align-items:center}input[type=checkbox]{min-height:0}small{display:block;color:#b4c4cd;margin:8px 0}output{display:block;white-space:pre-line;overflow-wrap:anywhere;margin:10px 0}.player-row{display:flex;align-items:center;gap:10px;min-height:52px;padding:4px 0;border-top:1px solid #364956}.player-card{flex:0 0 30px;position:relative;width:30px;height:42px;display:grid;place-items:center}.player-card slot{display:block;position:absolute;inset:0;width:144px;height:200px;transform:scale(.2083333);transform-origin:top left}.player-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:3px}.player-text strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.player-text span{font-size:12px;color:#b4c4cd}.player-points{flex:0 0 66px;text-align:right;color:#b4f2d7;font-variant-numeric:tabular-nums}.player-price{flex:0 0 72px;text-align:right;font-variant-numeric:tabular-nums}summary{padding:10px 0;cursor:pointer}.result-summary{font-size:16px;color:#b4f2d7}progress{width:100%;height:8px;accent-color:#b4f2d7} @media(max-width:500px){.fields{grid-template-columns:1fr}.player-row{gap:6px}.player-points{flex-basis:58px}.player-price{flex-basis:62px}dialog{padding:12px}}
  </style><dialog aria-label="FCAT Streamlined SBC"><header><strong>FCAT 积分解题</strong><button data-close aria-label="关闭">×</button></header>
    <div data-target></div><div class="tabs"><button data-local aria-pressed="true">当前 SBC</button><button data-global aria-pressed="false">全局设置</button></div>
    <section data-settings><div class="fields"><label>规划目标<select data-objective><option value="lowest-coins">最低待购总额，材料估值次之</option><option value="fewest-cards">最少卡片</option></select></label>
    <label>材料范围<select data-mode><option value="inventory-market">库存＋补卡</option><option value="inventory">仅库存</option><option value="market">仅购买材料</option></select></label>
    <label>最高评分<input data-rating type="number" min="1" max="99" step="1"></label></div><div class="sources"><label><input data-club type="checkbox">Club</label><label><input data-storage type="checkbox">SBC Storage</label></div>
    <small>最高评分仍受 FSU 设置约束；仅普通不可交易卡。补卡候选的积分与路由尚待验证，当前提供库存预览。</small><button data-save>保存设置</button></section>
    <output data-status aria-live="polite"></output><progress hidden></progress><section data-result></section>
    <footer><button data-stop hidden>停止</button><button data-recover>核对并恢复</button><button data-solve class="primary">生成方案</button><button data-contribute disabled hidden>贡献所选批次</button></footer></dialog>`;
  const node = key => shadow.querySelector(`[data-${key}]`), dialog = shadow.querySelector('dialog');
  let target = null, origin = null, busy = false, disposed = false, global = false, opened = 0;
  const rendered = new Set();
  let renderGeneration = 0;
  let shown = null, selected = new Set();
  const contributionReady = () => shown?.liveExecutionEnabled === true && selected.size > 0;
  const clearRendered = () => { renderGeneration++; for (const node of rendered) { try { node.__fcatDealloc?.(); } catch { /* UI disposal only. */ } node.remove(); } rendered.clear(); };
  const read = () => { try { return readTarget(); } catch { return null; } };
  const same = (a, b) => !!a && !!b && a.anchor === b.anchor && a.setId === b.setId && a.challengeId === b.challengeId;
  const setBusy = value => {
    busy = value; entry.disabled = value;
    for (const control of shadow.querySelectorAll('[data-settings] input,[data-settings] select,[data-settings] button,.tabs button,[data-solve],[data-recover]')) control.disabled = value;
    for (const control of shadow.querySelectorAll('[data-result] input')) control.disabled = value || control.dataset.settled === 'true';
    node('contribute').disabled = value || !contributionReady();
    node('stop').hidden = !value; shadow.querySelector('progress').hidden = !value;
  };
  const close = () => { opened++; session.stop(); clearRendered(); session.clearPreview?.(); dialog.close(); origin = null; };
  const update = () => {
    target = read();
    if (!target?.anchor?.isConnected) entry.remove();
    else if (entry.parentNode !== target.anchor) target.anchor.prepend(entry);
    if (origin && !same(origin, target)) close();
  };
  const applySettings = s => {
    node('objective').value = s.objective; node('mode').value = s.mode; node('rating').value = String(s.maxRating);
    for (const key of ['club', 'storage']) node(key).checked = s.sources.includes(key);
  };
  const selectScope = value => { global = value; node('local').setAttribute('aria-pressed', String(!value)); node('global').setAttribute('aria-pressed', String(value)); };
  const loadScope = async value => {
    if (busy) return; const serial = opened; setBusy(true);
    try { const result = await session.readSettings(value); if (serial === opened) { selectScope(value); applySettings(result.settings); } }
    catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  };
  const config = () => ({ objective: node('objective').value, mode: node('mode').value,
    maxRating: Number(node('rating').value), sources: ['club', 'storage'].filter(key => node(key).checked) });
  const on = (key, handler) => node(key).addEventListener('click', event => { if (event.isTrusted) void handler(); });
  on('close', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  on('local', () => loadScope(false)); on('global', () => loadScope(true)); on('stop', () => session.stop());
  entry.addEventListener('click', async event => {
    if (!event.isTrusted || disposed || busy) return;
    update(); if (!target) return;
    origin = target; const serial = ++opened; dialog.showModal(); node('status').textContent = '读取当前需求…'; node('result').replaceChildren(); node('contribute').hidden = true; clearRendered();
    setBusy(true);
    try {
      const result = await session.readSettings(); if (serial !== opened) return;
      const c = result.challenge, s = result.settings;
      node('target').textContent = `${c.name ?? 'Streamlined SBC'} · ${number(c.submittedScore)} / ${number(c.targetScore)} · 剩余 ${number(c.remainingScore)}`;
      applySettings(s);
      node('status').textContent = '规划不会选卡或提交。'; selectScope(false);
    } catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  });
  on('save', async () => {
    if (busy) return; setBusy(true);
    try { await session.saveSettings(config(), global); node('status').textContent = global ? '全局默认设置已保存。当前 SBC 独立设置优先。' : '当前 SBC 设置已保存。'; }
    catch (error) { node('status').textContent = safeReason(error); } finally { setBusy(false); }
  });
  const renderResult = result => {
      clearRendered(); node('result').replaceChildren(); node('contribute').hidden = true; shown = null;
      if (!result.plan) return;
      shown = result;
      const output = node('result'), p = result.progress;
      add(output, 'div', `${result.status === 'ready' ? '预计达标' : '部分方案'} · ${number(p.submitted)} 已提交 + ${number(p.added)} 本次 · 还差 ${number(p.remaining)} / 超额 ${number(p.excess)}`).className = 'result-summary';
      add(output, 'small', `待购 ${number(result.purchaseCost)} 金币 · 已有材料估值 ${number(result.materialValue)} · ${String(result.quoteSource).toUpperCase()} · ${result.items.length} 张 / ${result.batches.length} 批`);
      if (!result.searchComplete) add(output, 'small', '搜索已达预算；显示最佳已知方案，不代表全局最优。');
      if (!result.poolComplete) add(output, 'small', '基于当前可读取库存；未确认全量库存。');
      if (result.marketPending) add(output, 'small', '当前未接入可验证的市场候选；此结果仅包含库存。');
      if (result.quoteReadError) add(output, 'small', `报价读取未完成：${result.quoteReadError}`);
      if (result.unknownValueCount) add(output, 'small', `${result.unknownValueCount} 张材料估值未知，不能视作零价。`);
      const settled = index => !!result.record && (result.record.submittedScore >= p.target || result.record.batches[index]?.state !== 'waiting');
      selected = new Set(result.batches.map((_, index) => index).filter(index => !settled(index)));
      const selection = add(output, 'output'); selection.dataset.selection = '';
      const updateSelection = () => {
        const items = [...selected].flatMap(index => result.batches[index]);
        const points = items.reduce((sum, item) => sum + item.points, 0);
        selection.textContent = `已选 ${selected.size} 批 · ${items.length} 张 · ${number(points)} 分 · 还差 ${number(Math.max(0, p.target - (result.record?.submittedScore ?? p.submitted) - points))}`;
        node('contribute').disabled = busy || !contributionReady();
      };
      updateSelection();
      const generation = renderGeneration;
      result.batches.forEach((batch, index) => {
        const details = add(output, 'details'); details.open = index === 0;
        const summary = add(details, 'summary'), choice = add(summary, 'input'); choice.type = 'checkbox'; choice.checked = !settled(index);
        choice.dataset.settled = String(settled(index)); choice.disabled = busy || settled(index);
        choice.setAttribute('aria-label', `选择第 ${index + 1} 批`);
        choice.addEventListener('click', event => event.stopPropagation());
        choice.addEventListener('change', () => { if (choice.checked) selected.add(index); else selected.delete(index); updateSelection(); });
        summary.append(document.createTextNode(` 第 ${index + 1} 批 · ${batch.length} 张 · ${number(batch.reduce((sum, i) => sum + i.points, 0))} 分`));
        let populated = false;
        const populate = () => {
          if (populated || !details.open || generation !== renderGeneration || disposed) return;
          populated = true;
          const list = add(details, 'div'); list.className = 'player-list';
          for (const item of batch) {
            const row = add(list, 'div'); row.className = 'player-row';
            const card = add(row, 'div'); card.className = 'player-card';
            const fallback = add(card, 'span', number(item.rating)); fallback.title = '卡面不可用';
            const slot = add(card, 'slot'); slot.name = `streamlined-card-${generation}-${item.key}`;
            const text = add(row, 'div'); text.className = 'player-text';
            add(text, 'strong', item.name ?? `版本 ${item.definitionId}`);
            add(text, 'span', item.pile === 'storage' ? 'SBC Storage' : item.source === 'market' ? '待购' : 'Club');
            add(row, 'span', `${number(item.points)} 分`).className = 'player-points';
            const price = add(row, 'span', `${number(item.price)} ◉`); price.className = 'player-price'; price.title = '材料估值';
            let native = null, failed = false;
            const unavailable = () => {
              failed = true;
              if (native) { rendered.delete(native); try { native.__fcatDealloc?.(); } catch { /* UI disposal only. */ } native.remove(); }
              if (generation === renderGeneration && !disposed) { fallback.hidden = false; slot.remove(); }
            };
            try {
              const raw = session.resolveDisplayItem?.(item);
              if (raw) native = nativeRenderer?.renderOwned({ parent: host, raw, slot: slot.name,
                label: item.name ?? `版本 ${item.definitionId}`, onUnavailable: unavailable });
            } catch { unavailable(); }
            if (native && !failed) { rendered.add(native); fallback.hidden = true; }
            else unavailable();
          }
        };
        details.addEventListener('toggle', populate); populate();
      });
      const skipped = Object.entries(result.excluded ?? {}).map(([key, count]) => `${key}: ${count}`).join(' · ');
      if (skipped) { const details = add(output, 'details'); add(details, 'summary', '材料排除原因'); add(details, 'small', skipped); }
      add(output, 'small', result.liveExecutionEnabled ? '点击贡献将永久消耗所选批次的卡片；可以分批贡献，停止会等待当前批次核对完成。'
        : `当前不能贡献：${streamlinedExecutionMessage(result.executionReason, result.executionRecovery)}`); node('contribute').hidden = false;
  };
  on('solve', async () => {
    if (busy || !origin || !same(origin, read())) return;
    const serial = opened; shown = null; setBusy(true); clearRendered(); node('result').replaceChildren(); node('contribute').hidden = true; node('status').textContent = '正在准备候选…';
    try {
      const result = await session.plan(config(), { onProgress: p => {
        if (serial !== opened) return;
        const bar = shadow.querySelector('progress');
        bar.max = p.phase === 'quotes' ? p.total || 1 : p.maxNodes || 1;
        bar.value = p.phase === 'quotes' ? p.completed : p.nodes;
        node('status').textContent = p.phase === 'quotes' ? `报价 ${number(p.completed)} / ${number(p.total)}`
          : `搜索节点 ${number(p.nodes)} / ${number(p.maxNodes)} · 候选 ${number(p.candidates)} · ${number(p.elapsedMs)} ms`;
      } });
      if (serial !== opened) return;
      node('status').textContent = result.status === 'cancelled' ? '已停止。' : result.reason ?? result.status;
      renderResult(result);
    } catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  });
  const showOutcome = result => {
    const labels = { completed: '目标已达成，奖励状态需另行核对。', partial: '本次贡献已确认，可继续剩余批次。',
      stopped: '已停止，当前批次核对完成。', recovered: '已恢复记录，未重复贡献。', observed: '已读取上次记录。', absent: '没有待恢复的贡献记录。',
      'recovery-required': '结果尚未确认，请核对并恢复；不会重复贡献。', rejected: 'EA 拒绝了本次贡献，请重新规划。' };
    node('status').textContent = result.reason ? streamlinedExecutionMessage(result.reason, result.recovery)
      : result.status === 'absent' ? '当前 SBC 没有待恢复的贡献记录，请点击“生成方案”。' : labels[result.status] ?? result.status;
    if (result.record) node('target').textContent = `${result.record.plan.challenge.name} · ${number(result.record.submittedScore)} / ${number(result.record.plan.challenge.targetScore)}`;
  };
  on('contribute', async () => {
    if (busy || !contributionReady()) return;
    const serial = opened, result = shown, indices = [...selected].sort((a, b) => a - b);
    setBusy(true);
    try {
      const outcome = await session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: indices, allowPartial: result.plan.status === 'partial' }, {
        onProgress: p => {
          if (serial !== opened) return;
          const label = { validation: '复核材料', contribution: '贡献中', reconciliation: '核对回执', confirmed: '已确认' }[p.phase];
          node('status').textContent = `第 ${p.index + 1} 批 · ${label} · 已确认 ${number(p.submittedScore)} 分`;
          const bar = shadow.querySelector('progress'); bar.max = indices.length;
          bar.value = indices.indexOf(p.index) + (p.phase === 'confirmed' ? 1 : 0);
        },
      });
      if (serial !== opened) return;
      renderResult({ ...result, record: outcome.record,
        executionReason: outcome.reason ?? (outcome.status === 'completed' ? 'FC27_STREAMLINED_COMPLETED' : result.executionReason),
        liveExecutionEnabled: result.liveExecutionEnabled && ['partial', 'stopped'].includes(outcome.status) });
      showOutcome(outcome);
    } catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  });
  on('recover', async () => {
    if (busy) return;
    const serial = opened;
    // Recovery can return absence, another target or an error. None of those
    // outcomes may leave the previous preview enabled for contribution.
    shown = null; selected.clear(); session.clearPreview?.(); clearRendered();
    node('result').replaceChildren(); node('contribute').hidden = true;
    setBusy(true);
    try {
      const outcome = await session.recover(); if (serial !== opened) return;
      if (outcome.preview) renderResult(outcome.preview);
      showOutcome(outcome);
    } catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  });
  update(); const timer = schedule(update, 900);
  return Object.freeze({ dispose: () => { disposed = true; close(); unschedule(timer); entry.remove(); host.remove(); } });
}
