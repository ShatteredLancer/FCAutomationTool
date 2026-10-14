import { normalizeStreamlinedProtectionFailure } from '../../streamlined/protection.js';

const number = value => Number.isSafeInteger(value) ? value.toLocaleString() : '未知';
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_UNAVAILABLE';

export function streamlinedMarketMessage(result) {
  const source = { futbin: 'FUTBIN', futgg: 'FUT.GG' }[result.quoteSource] ?? '所选来源';
  if (result.marketError === 'FC27_STREAMLINED_QUOTES_EXPIRED') {
    return `${source} 补卡报价在等待中到期，刷新后仍未取得完整有效报价。请重新生成方案；不会使用过期报价或自动切换来源。`;
  }
  if (/QUOTE|PRICE|REFERENCE/.test(String(result.marketError ?? ''))) {
    return `${source} 补卡报价读取失败，未生成方案。请检查该报价来源连接后重新生成。`;
  }
  return '市场候选未验证，未生成补卡方案。请检查候选目录连接（FUT.GG），或将材料范围切换为“仅库存”后重试。';
}

export function streamlinedRouteSummary(route) {
  const cap = route.groups.filter(group => group.source === 'market')
    .reduce((sum, group) => sum + group.quantity * Math.max(...group.items.map(item => item.purchaseMaxBuy ?? item.price)), 0);
  const total = route.materialValue == null ? null : route.purchaseCost + route.materialValue;
  return `总价值 ${number(total)} ◉ · 待购 ${number(route.purchaseCost)} · 上限 ${number(cap)} · ${number(route.score)} 积分 · ${route.count} 张（库存 ${route.inventoryCount} / 待购 ${route.marketCount}）· 至少 ${route.minBatches} 批${route.repeatPurchaseCount ? ` · 重复购卡 ${route.repeatPurchaseCount}` : ''}`;
}

export function streamlinedInventoryPreview(plan, indices = null, record = null) {
  const market = plan?.route?.groups?.some(group => group.source === 'market');
  const selected = new Set((market || indices === null ? plan?.items ?? []
    : indices.flatMap(index => plan?.batches?.[index] ?? [])).map(item => item.id));
  const consumed = new Set(record?.consumedIds ?? []);
  record?.batches?.forEach((batch, index) => {
    if (batch.state === 'confirmed') for (const item of plan?.batches?.[index] ?? []) consumed.add(item.id);
  });
  return (plan?.items ?? []).filter(item => item.source === 'inventory' && (selected.has(item.id) || consumed.has(item.id)))
    .map(item => ({ ...item, consumed: consumed.has(item.id) }));
}

export function streamlinedExecutionProgress(p = {}) {
  const stages = { 'checking-source': '检查外部卡', 'checking-club': '核对 Club', 'journal-pending': '写入恢复记录',
    'move-request': '请求移入 Club', 'move-acknowledged': '移动回执已确认', 'club-readback': '核对 Club 回读', confirmed: '移入 Club 已确认' };
  const label = p.phase === 'materialize' ? stages[p.stage] ?? '移入 Club'
    : { preflight: '准备执行：核对方案与恢复记录', 'checking-state': '核对库存与剩余容量', search: '搜索限价内挂牌',
      buying: '买入中', moving: '移入 Club', 'partial-ready': '等待部分批次收批', validation: '复核材料',
      contribution: '贡献中', reconciliation: '核对回执', confirmed: '贡献已确认', recovery: '核对已有执行记录' }[p.phase] ?? '执行中';
  let text = `${Number.isSafeInteger(p.batchNumber) ? `第 ${number(p.batchNumber)} 批 · ` : ''}${label}`;
  if (p.playerName || Number.isSafeInteger(p.rating)) text += `\n当前候选：${p.playerName ?? '姓名未取得'} · ${number(p.rating)} OVR · 上限 ${number(p.maxBuy)} 金币 · 尝试 ${number(p.attempt)} / ${number(p.attemptLimit)}`;
  if (p.purchaseTarget !== undefined) text += `\n已购 ${number(p.purchased)} / ${number(p.purchaseTarget)} 张 · 已花费 ${number(p.spent)} / ${number(p.budget)} 金币`;
  text += `\n已贡献 ${number(p.contributed)} 张 · 已确认 ${number(p.submittedScore)} / ${number(p.targetScore)} 分`;
  if (p.readyCount !== undefined) text += `\n本批就绪 ${number(p.readyCount)} / ${number(p.selectionLimit)} 张 · ${number(p.readyPoints)} 分`;
  if (p.phase === 'materialize') text += `\n外部卡 ${number(p.completed)} / ${number(p.materialTotal)} 张`;
  return text;
}

export function streamlinedExecutionClock(p, elapsedMs = 0, phaseElapsedMs = 0, active = true) {
  const seconds = ms => Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  let text = `本次耗时 ${seconds(elapsedMs)} 秒`;
  if (active) text += ` · 当前步骤等待 ${seconds(phaseElapsedMs)} 秒`;
  if (active && p?.phase === 'partial-ready' && Number.isSafeInteger(p.waitMs)) {
    text += ` · 预计收批等待剩余 ${Math.ceil(Math.max(0, p.waitMs - Math.max(0, phaseElapsedMs)) / 1000)} 秒`;
  }
  return text;
}

export function streamlinedExecutionMessage(reason, recovery = null, protection = null) {
  if (reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED') {
    const evidence = normalizeStreamlinedProtectionFailure(protection);
    const labels = {
      'protection-lock-list': 'FSU 锁卡名单未读到或格式异常。请确认 FSU Local 已启用并初始化完成，再刷新页面；不要解除锁卡。',
      'protection-active-id': 'EA 当前主阵容标识尚未核验。请在 Squads 打开当前主阵容，再返回生成方案。',
      'protection-active-state': '原生主阵容的启用状态尚未核验。请在 Squads 确认当前主阵容已启用；若仍报错，请导出诊断。',
      'protection-native-id': '原生缓存中的主阵容标识与当前主阵容不一致。请导出诊断排查。',
      'protection-layout': '原生主阵容卡位数量定义未通过核验。请导出诊断排查。',
      'protection-slot-list': `原生主阵容卡位未完整核验（${number(evidence?.count)} / ${number(evidence?.requiredSlots)}）。请导出诊断排查。`,
      'protection-slot-id': '原生主阵容卡位中的物品标识未通过核验。请导出诊断排查。',
      'protection-fsu-roster': 'FSU 主阵容快照未读到或格式异常。请导出诊断排查。',
      'protection-cache': '原生主阵容缓存缺失，且没有当前账号/主阵容的有效已核验快照。请导出诊断排查。',
    };
    return `${labels[evidence?.phase] ?? '锁卡或当前主阵容信息尚未核验。请先打开 EA 主阵容，再返回生成方案；若仍报错，请导出诊断。'} 本次未投入新材料。`;
  }
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
    FC27_STREAMLINED_STOPPED: '已停止；已确认成交保留，可核对并恢复。',
    FC27_STREAMLINED_NO_AFFORDABLE_CARDS: '当前没有可购买的限价内候选，已暂停。已购材料保留，核对并恢复后可重试。',
    FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED: '本次执行授权已到期。已发生的交易保留，请核对并恢复后继续。',
    FC27_STREAMLINED_PURCHASE_QUOTE_EXPIRED: '公共报价已过期且未能更新。已购材料保留，请核对并恢复后重试。',
    FC27_STREAMLINED_PURCHASE_RECOVERY_REQUIRED: '购买或入库结果尚未确认，请核对并恢复；不会重复买入。',
    FC27_STREAMLINED_PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED: '本批贡献结果尚未确认，请核对并恢复；不会重复贡献。',
    FC27_STREAMLINED_PURCHASE_JOURNAL_READ_FAILED: '购买记录读取失败，请重试恢复或导出诊断。',
    FC27_STREAMLINED_PURCHASE_JOURNAL_WRITE_FAILED: '购买记录保存失败，请核对并恢复后继续。',
    FC27_STREAMLINED_PROGRESS_CHANGED: '当前积分与方案不一致，已停止，请核对并恢复。',
    FC27_STREAMLINED_PROTECTION_UNVERIFIED: '锁卡或当前主阵容信息尚未核验，请先打开 EA 主阵容，再返回生成方案；未投入新材料。',
    FC27_STREAMLINED_POLICY_CHANGED: '材料保护或设置已变化，请核对旧执行记录后重新生成方案。',
    FC27_STREAMLINED_MATERIAL_CHANGED: '选中材料已变化或受到锁卡/主阵容保护，已停止；请核对记录后重新生成方案。',
    FC27_BUY_JOURNAL_READ_FAILED: 'Puzzle 购买记录读取失败，请重新读取或导出诊断；未清除记录、未投入材料。',
    FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED: '当前账号有待核对的 Gallery 购卡记录，请先到 Gallery 购买窗口核对并继续购买。',
    FC27_RECOVERY_REQUIRED: '当前账号有待核对的传统 SBC 提交记录，请先恢复该次提交。',
    FC27_STREAMLINED_INITIATION_UNVERIFIED: '请先通过 EA 原生界面开始此 SBC，再重新生成方案。',
    FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED: '当前构建未启用贡献接口。',
    FC27_STREAMLINED_RECONCILIATION_REQUIRED: '本次投入结果尚待核对，请点击“核对并恢复”，不要重复投入。',
    FC27_STREAMLINED_RECOVERY_REQUIRED: '上次贡献已发出，结果尚待核对；请点击“核对并恢复”，不要再次投入。',
    FC27_STREAMLINED_CONTEXT_CHANGED: '账号、SBC 或积分状态已变化，请重新打开当前 SBC 并生成方案。',
    FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED: `另一个 SBC（Set ${recovery?.setId ?? '?'} / Challenge ${recovery?.challengeId ?? '?'}）仍有未结清的贡献记录，未在当前 SBC 恢复或重复投入。`,
    FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED: `另一个 SBC（Set ${recovery?.setId ?? '?'} / Challenge ${recovery?.challengeId ?? '?'}）仍有未核对的外部卡移动记录（${recovery?.pendingCount ?? '?'} 张）。请先点击“核对并恢复”；这里只检查是否已进入 Club，不会重复移动、购买或贡献。`,
    FC27_STREAMLINED_COMPLETED: '所选目标已达成，无需再次贡献。',
    FC27_STREAMLINED_PURCHASE_PENDING: '此路线含待购材料；先完成购买并核对真实实体，才能贡献。',
  };
  return messages[reason] ?? reason ?? '请重新生成方案或核对执行结果。';
}

// Fodder's observed workflow: native work-area entry -> settings -> progress ->
// batches in one window. No private solver, prototype hook or EA writer.
export function mountFc27StreamlinedPanel({ document, readTarget, session, nativeRenderer = null,
  schedule = setInterval, unschedule = clearInterval, now = () => Date.now() } = {}) {
  if (!document?.body || document.getElementById('fcat-streamlined-entry')) return null;
  const add = (parent, tag, value = '') => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
  const entry = document.createElement('button'); entry.id = 'fcat-streamlined-entry'; entry.type = 'button';
  entry.textContent = 'FCAT 积分解题'; entry.className = 'btn-standard call-to-action';
  entry.style.cssText = 'margin:8px;min-height:38px';
  const host = document.createElement('div'); host.id = 'fcat-streamlined-panel'; document.body.append(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box} [hidden]{display:none!important}
    dialog{width:min(720px,94vw);max-width:94vw;max-height:88vh;overflow:hidden;background:#17232c;color:#ecf2f5;border:1px solid #53636d;border-radius:10px;padding:16px;font:14px/1.5 Arial,sans-serif}
    dialog::backdrop{background:#000a}header,footer,.tabs{display:flex;gap:10px;align-items:center}header{margin-bottom:12px}header strong{flex:1}footer{position:sticky;bottom:-16px;background:#17232c;padding:12px 0;justify-content:flex-end;border-top:1px solid #46545d}
    button,select,input{font:inherit;color:inherit;background:#25353f;border:1px solid #536570;border-radius:5px;padding:6px 9px;min-height:34px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true]{color:#b4f2d7;border-color:#b4f2d7}button.primary{background:#b4f2d7;color:#15251f}label{display:grid;gap:5px;min-width:0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.sources{display:flex;gap:12px}.sources label{display:flex;align-items:center}input[type=checkbox]{min-height:0}small{display:block;color:#b4c4cd;margin:8px 0}output{display:block;white-space:pre-line;overflow-wrap:anywhere;margin:10px 0}.player-row{display:flex;align-items:center;gap:12px;min-height:92px;padding:8px 0;border-top:1px solid #364956}.player-card{flex:0 0 64px;position:relative;width:64px;height:88px;display:grid;place-items:center}.player-card slot{display:block;position:absolute;inset:0;width:144px;height:200px;transform:scale(.4444444);transform-origin:top left}.player-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:3px}.player-text strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.player-text span{font-size:12px;color:#b4c4cd}.player-points{flex:0 0 76px;text-align:right;color:#b4f2d7;font-variant-numeric:tabular-nums}.player-price{flex:0 0 82px;text-align:right;font-variant-numeric:tabular-nums}summary{padding:10px 0;cursor:pointer}.result-summary{font-size:16px;color:#b4f2d7}progress{width:100%;height:8px;accent-color:#b4f2d7} @media(max-width:500px){.fields{grid-template-columns:1fr}.player-row{gap:8px}.player-card{flex-basis:54px;width:54px;height:74px}.player-card slot{transform:scale(.375)}.player-points{flex-basis:62px}.player-price{flex-basis:68px}dialog{padding:12px}}
    .player-row{display:grid;grid-template-columns:104px minmax(0,1fr) 90px 112px;min-height:156px}
    .player-card{width:104px;height:145px}.player-card slot{transform:scale(.7222222)}
    .player-card slot::slotted(.gallery-native-card.owned-card){transform:scale(1.75);transform-origin:top left}
    .player-text strong{white-space:normal;overflow-wrap:anywhere;font-size:16px}.player-text span{font-size:14px}
    .player-points,.player-price{font-size:15px}.player-price small{margin:3px 0;font-size:12px}
    dialog[open]{display:flex;flex-direction:column}.panel-body{min-height:0;overflow:auto;overscroll-behavior:contain}
    footer{display:block;position:static;flex-shrink:0;padding:10px 0 0}.actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
    footer output{margin:0 0 6px;max-height:10em;overflow:auto;font-size:13px}footer small{margin:4px 0 8px;font-size:12px}footer progress{display:block;margin:6px 0}
    .inventory-review{border:1px solid #536570;border-radius:6px;padding:0 10px;margin:12px 0}.inventory-review summary{font-weight:bold;color:#b4f2d7}
    .inventory-row{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px;padding:8px 0;border-top:1px solid #364956}.inventory-row strong{overflow-wrap:anywhere}.inventory-row small{margin:3px 0 0}.inventory-row.consumed{opacity:.65}.inventory-warning{color:#ffd48a}
    @media(max-width:500px){.player-row{grid-template-columns:88px minmax(0,1fr);gap:4px 12px;min-height:136px}.player-card{grid-row:1/4;width:88px;height:123px}.player-card slot{transform:scale(.6111111)}.player-card slot::slotted(.gallery-native-card.owned-card){transform:scale(1.75)}.player-text{grid-column:2}.player-points,.player-price{grid-column:2;text-align:left}.player-price small{display:inline;margin-left:8px}}
  </style><dialog aria-label="FCAT Streamlined SBC"><div class="panel-body"><header><strong>FCAT 积分解题</strong><button data-close aria-label="关闭">×</button></header>
    <div data-target></div><div class="tabs"><button data-local aria-pressed="true">当前 SBC</button><button data-global aria-pressed="false">全局设置</button></div>
    <section data-settings><div class="fields"><label>规划目标<select data-objective><option value="lowest-value">最低总材料价值（库存＋待购）</option><option value="lowest-coins">最低待购总额，材料估值次之</option><option value="fewest-cards">最少卡片</option></select></label>
    <label>材料范围<select data-mode><option value="inventory-market">库存＋补卡</option><option value="inventory">仅库存</option><option value="market">仅购买材料</option></select></label>
    <label>库存最高评分<input data-rating type="number" min="1" max="99" step="1"></label><label>补卡最高评分<input data-market-rating type="number" min="1" max="99" step="1"></label><label>部分批次等待（秒）<input data-wait type="number" min="0" max="3600" step="1"></label></div><div class="sources"><label><input data-club type="checkbox">Club</label><label><input data-storage type="checkbox">SBC Storage</label><label><input data-unassigned type="checkbox">Unassigned</label><label><input data-transfer type="checkbox">Transfer List</label></div>
    <small>库存遵循 FSU 材料保护；补卡按当前购买报价来源规划。路线估价不保证市场供应，选择路线不会购买或贡献。</small><button data-save>保存设置</button></section>
    <section data-result></section></div>
    <footer><output data-status aria-live="polite"></output><progress aria-label="执行进度" hidden></progress><small data-clock hidden></small><small data-final-progress hidden></small>
      <div class="actions"><button data-review-stock hidden>查看库存清单</button><button data-stop hidden>停止</button><button data-recover>核对并恢复</button><button data-solve class="primary">生成方案</button><button data-contribute disabled hidden>贡献所选批次</button></div></footer></dialog>`;
  const node = key => shadow.querySelector(`[data-${key}]`), dialog = shadow.querySelector('dialog');
  let target = null, origin = null, busy = false, disposed = false, global = false, opened = 0;
  const rendered = new Set();
  let renderGeneration = 0;
  let shown = null, selected = new Set(), quoteCoverageAcknowledged = false;
  let executionProgress = null;
  const resetProgress = () => { executionProgress = null; node('clock').hidden = true; node('final-progress').hidden = true; };
  const refreshClock = () => {
    if (!executionProgress || executionProgress.serial !== opened) return;
    const current = executionProgress.active ? now() : executionProgress.endedAt;
    node('clock').textContent = streamlinedExecutionClock(executionProgress.progress,
      current - executionProgress.startedAt, current - executionProgress.phaseAt, executionProgress.active);
    node('clock').hidden = false;
  };
  const beginProgress = (result, phase = 'preflight') => {
    resetProgress();
    const submittedScore = result?.record?.submittedScore ?? result?.plan?.challenge.submittedScore;
    const targetScore = result?.plan?.challenge.targetScore;
    const start = now();
    executionProgress = { serial: opened, startedAt: start, phaseAt: start, active: true, progress: { phase, submittedScore, targetScore } };
    node('status').textContent = streamlinedExecutionProgress(executionProgress.progress);
    const bar = shadow.querySelector('progress'); bar.max = targetScore || 1;
    if (Number.isSafeInteger(submittedScore)) bar.value = submittedScore; else bar.removeAttribute('value');
    bar.hidden = false; refreshClock();
  };
  const executionStep = p => {
    if (!executionProgress || executionProgress.serial !== opened || !executionProgress.active) return;
    if (p.phase !== executionProgress.progress.phase) executionProgress.phaseAt = now();
    executionProgress.progress = p; refreshClock();
  };
  const contributionReady = () => shown?.liveExecutionEnabled === true
    && (shown.plan.execution?.quoteLimited !== true || quoteCoverageAcknowledged) && (shown.plan.route?.groups?.some(g => g.source === 'market')
    ? (shown.record?.submittedScore ?? shown.plan.challenge.submittedScore) < shown.plan.challenge.targetScore
    : selected.size > 0);
  const clearRendered = () => { renderGeneration++; for (const node of rendered) { try { node.__fcatDealloc?.(); } catch { /* UI disposal only. */ } node.remove(); } rendered.clear(); };
  const read = () => { try { return readTarget(); } catch { return null; } };
  const same = (a, b) => !!a && !!b && a.anchor === b.anchor && a.setId === b.setId && a.challengeId === b.challengeId;
  const setBusy = value => {
    busy = value; entry.disabled = value;
    for (const control of shadow.querySelectorAll('[data-settings] input,[data-settings] select,[data-settings] button,.tabs button,[data-solve],[data-recover]')) control.disabled = value;
    for (const control of shadow.querySelectorAll('[data-result] input')) control.disabled = value || control.dataset.settled === 'true';
    node('contribute').disabled = value || !contributionReady();
    node('stop').hidden = !value; shadow.querySelector('progress').hidden = !value && !executionProgress;
  };
  const close = () => { opened++; session.stop(); resetProgress(); clearRendered(); session.clearPreview?.(); dialog.close(); origin = null; };
  const update = () => {
    target = read();
    if (!target?.anchor?.isConnected) entry.remove();
    else if (entry.parentNode !== target.anchor) target.anchor.prepend(entry);
    if (origin && !same(origin, target)) close();
    refreshClock();
  };
  const applySettings = s => {
    node('objective').value = s.objective; node('mode').value = s.mode; node('rating').value = String(s.maxRating);
    node('market-rating').value = String(s.marketMaxRating ?? 99);
    node('wait').value = String(s.partialWaitMs / 1000);
    for (const key of ['club', 'storage', 'unassigned', 'transfer']) node(key).checked = s.sources.includes(key);
  };
  const selectScope = value => { global = value; node('local').setAttribute('aria-pressed', String(!value)); node('global').setAttribute('aria-pressed', String(value)); };
  const loadScope = async value => {
    if (busy) return; const serial = opened; setBusy(true);
    try { const result = await session.readSettings(value); if (serial === opened) { selectScope(value); applySettings(result.settings); } }
    catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  };
  const config = () => ({ objective: node('objective').value, mode: node('mode').value,
    maxRating: Number(node('rating').value), marketMaxRating: Number(node('market-rating').value), partialWaitMs: Number(node('wait').value) * 1000,
    sources: ['club', 'storage', 'unassigned', 'transfer'].filter(key => node(key).checked) });
  const on = (key, handler) => node(key).addEventListener('click', event => { if (event.isTrusted) void handler(); });
  on('close', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  on('local', () => loadScope(false)); on('global', () => loadScope(true)); on('stop', () => session.stop());
  on('review-stock', () => {
    const review = shadow.querySelector('[data-inventory-review]');
    if (review) { review.open = true; review.scrollIntoView({ block: 'start' }); }
  });
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
      quoteCoverageAcknowledged = false;
      clearRendered(); node('result').replaceChildren(); node('contribute').hidden = true; shown = null;
      node('review-stock').hidden = true;
      if (!result.plan) {
        const output = node('result');
        if (result.reason === 'FC27_STREAMLINED_QUOTES_UNAVAILABLE') {
          add(output, 'div', '报价读取失败或已过期，未生成方案。请检查所选报价来源连接后重新生成。').className = 'result-summary';
          add(output, 'small', `${String(result.quoteSource).toUpperCase()} · ${result.quoteReadError}`);
        } else if (result.reason === 'FC27_STREAMLINED_MARKET_UNAVAILABLE') {
          add(output, 'div', streamlinedMarketMessage(result)).className = 'result-summary';
          if (result.marketError) add(output, 'small', `补卡候选读取失败：${result.marketError}`);
        } else if (result.reason) {
          add(output, 'div', `未生成方案：${result.reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED'
            ? streamlinedExecutionMessage(result.reason, null, result.protectionFailure) : result.reason}`).className = 'result-summary';
          if (result.reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED') add(output, 'small', `${result.reason}${result.protectionFailure?.phase ? ` · ${result.protectionFailure.phase}` : ''}`);
        }
        return;
      }
      shown = result;
      const marketRun = result.plan.route?.groups?.some(group => group.source === 'market') === true;
      node('contribute').textContent = marketRun ? '按方案购买并贡献' : '贡献所选批次';
      const output = node('result'), p = result.progress;
      if (result.plan.execution?.quoteLimited === true) {
        const warning = add(output, 'section'); warning.className = 'inventory-warning';
        add(warning, 'strong', '报价覆盖不完整：待确认方案，不保证全库存/全市场最低价。');
        for (const [key, label] of [['inventory', '库存'], ['market', '补卡']]) {
          const coverage = result.quoteCoverage?.[key];
          if (coverage) add(warning, 'small', `${label}版本报价：有效 ${number(coverage.valid)} / ${number(coverage.requested)} · 失败 ${number(coverage.failed)} · 缺失/过期 ${number(coverage.missing)}；未取得有效报价的卡不参加本方案。`);
        }
        const label = add(warning, 'label'), confirm = add(label, 'input');
        label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin:10px 0';
        confirm.type = 'checkbox'; confirm.dataset.quoteConfirm = '';
        label.append(document.createTextNode('我已核对库存消耗和价格，接受仅用有效报价的本方案。'));
        confirm.addEventListener('change', event => {
          if (!event.isTrusted || busy) return;
          quoteCoverageAcknowledged = confirm.checked;
          node('contribute').disabled = !contributionReady();
        });
      }
      const inventoryReview = add(output, 'details'); inventoryReview.className = 'inventory-review'; inventoryReview.dataset.inventoryReview = ''; inventoryReview.open = true;
      const inventorySummary = add(inventoryReview, 'summary'), inventoryList = add(inventoryReview, 'div');
      let inventoryPage = 0;
      const updateInventoryReview = () => {
        inventoryList.replaceChildren();
        const rows = streamlinedInventoryPreview(result.plan, [...selected], result.record);
        const remaining = rows.filter(item => !item.consumed).length, consumed = rows.length - remaining;
        inventorySummary.textContent = `本方案将消耗的现有库存卡：${remaining} 张${consumed ? ` · 已消耗 ${consumed} 张` : ''}`;
        node('review-stock').textContent = `库存 ${remaining} 张（查看）`; node('review-stock').hidden = false;
        if (!rows.length) { add(inventoryList, 'small', '当前路线/已选批次不消耗现有库存卡。'); return; }
        if (result.plan.policy?.protectFsuLockedPlayers !== true || result.plan.policy?.protectActiveSquad !== true) {
          add(inventoryList, 'small', '旧方案的保护标记未更新；执行前会按当前锁卡和主阵容重新复核。请先逐张核对库存清单。').className = 'inventory-warning';
        }
        inventoryPage = Math.min(inventoryPage, Math.max(0, Math.ceil(rows.length / 50) - 1));
        for (const item of rows.slice(inventoryPage * 50, (inventoryPage + 1) * 50)) {
          const row = add(inventoryList, 'div'); row.className = `inventory-row${item.consumed ? ' consumed' : ''}`;
          add(row, 'strong', number(item.rating));
          const text = add(row, 'div'); add(text, 'strong', item.name ?? `版本 ${item.definitionId}（姓名未取得）`);
          const pile = { club: 'Club', storage: 'SBC Storage', unassigned: 'Unassigned → Club', transfer: 'Transfer List → Club' }[item.pile] ?? '来源未核验';
          add(text, 'small', `${pile} · ${number(item.points)} 分 · ${item.price == null ? '估值未知' : `估值 ${number(item.price)} 金币`} · ${item.consumed ? '已消耗' : '将消耗'}`);
        }
        if (rows.length > 50) {
          add(inventoryList, 'small', `显示 ${inventoryPage * 50 + 1}–${Math.min((inventoryPage + 1) * 50, rows.length)} / ${rows.length} 张`);
          for (const [label, delta] of [['上一页', -1], ['下一页', 1]]) {
            const button = add(inventoryList, 'button', label); button.type = 'button';
            button.disabled = delta < 0 ? inventoryPage === 0 : (inventoryPage + 1) * 50 >= rows.length;
            button.addEventListener('click', () => { inventoryPage += delta; updateInventoryReview(); });
          }
        }
      };
      if (marketRun) add(output, 'small', `每卡最多尝试 ${number(result.plan.execution?.purchaseAttempts ?? 3)} 次 · 部分批次等待 ${number((result.plan.execution?.partialWaitMs ?? 60000) / 1000)} 秒 · 每次点击授权最长 10 分钟；到期保留进度。`);
      if (result.routes?.length) {
        const routes = add(output, 'div'); routes.className = 'route-list';
        for (const route of result.routes) {
          const button = add(routes, 'button', streamlinedRouteSummary(route));
          button.type = 'button'; button.style.cssText = 'display:block;width:100%;text-align:left;margin:6px 0';
          button.setAttribute('aria-pressed', String(route.id === result.selectedRoute));
          button.addEventListener('click', async event => {
            if (!event.isTrusted || busy) return; const serial = opened; setBusy(true);
            try { const next = await session.selectRoute(route.id); if (serial === opened) { renderResult(next);
              node('status').textContent = next.plan?.execution?.quoteLimited === true ? '报价覆盖不完整：请重新核对并勾选确认，尚未购买或贡献。'
                : next.reason ?? '已选择路线，未购买或贡献。'; } }
            catch (error) { node('status').textContent = safeReason(error); } finally { setBusy(false); }
          });
        }
      }
      add(output, 'div', `${result.status === 'ready' ? '预计达标' : '部分方案'} · ${number(p.submitted)} 已提交 + ${number(p.added)} 本次 · 还差 ${number(p.remaining)} / 超额 ${number(p.excess)}`).className = 'result-summary';
      const total = result.materialValue == null ? null : result.purchaseCost + result.materialValue;
      add(output, 'small', `总材料价值 ${number(total)} 金币 · 待购 ${number(result.purchaseCost)} 金币 · 已有材料估值 ${number(result.materialValue)} · ${String(result.quoteSource).toUpperCase()} · ${result.items.length} 张 / ${result.batches.length} 批`);
      if (result.policy) {
        const stats = result.inventoryStats;
        const pileText = stats?.byPile ? ['club', 'storage', 'unassigned', 'transfer'].map(pile => `${pile} ${number(stats.byPile[pile] ?? 0)}`).join(' / ') : 'Club / Storage';
        const raw = stats?.rawByPile ? ` · 原始 ${number(stats.rawByPile.club)} / ${number(stats.rawByPile.storage)}` : '';
        add(output, 'small', `FSU Only Untradeable：${result.policy.onlyUntradeable ? '开启' : '关闭'} · 读取库存：${pileText}${raw}`);
        add(output, 'small', result.policy.protectFsuLockedPlayers && result.policy.protectActiveSquad
          ? '锁卡保护：开启 · 当前主阵容保护：开启（首发/替补/预备）'
          : '旧方案：执行前重新核验当前锁卡与主阵容保护。');
      }
      if (!result.searchComplete) add(output, 'small', '搜索已达预算；显示最佳已知方案，不代表全局最优。');
      if (!result.poolComplete) add(output, 'small', '基于当前可读取库存；未确认全量库存。');
      if (result.marketPending) add(output, 'small', '当前未接入可验证的市场候选；此结果仅包含库存。');
      if (result.quoteReadError) add(output, 'small', `报价读取未完成：${result.quoteReadError}`);
      if (result.marketError) add(output, 'small', `补卡候选读取未完成：${result.marketError}`);
      if (result.unknownValueCount) add(output, 'small', `${result.unknownValueCount} 张材料估值未知，不能视作零价。`);
      const settled = index => !!result.record && (result.record.submittedScore >= p.target
        || (marketRun ? result.record.completed === true : result.record.batches?.[index]?.state !== 'waiting'));
      selected = new Set(result.batches.map((_, index) => index).filter(index => !settled(index)));
      const selection = add(output, 'output'); selection.dataset.selection = '';
      const updateSelection = () => {
        const items = [...selected].flatMap(index => result.batches[index]);
        const points = items.reduce((sum, item) => sum + item.points, 0);
        selection.textContent = marketRun ? '市场路线已冻结：按剩余目标逐批执行；下方批次仅为预估。'
          : `已选 ${selected.size} 批 · ${items.length} 张 · ${number(points)} 分 · 还差 ${number(Math.max(0, p.target - (result.record?.submittedScore ?? p.submitted) - points))}`;
        if (marketRun && result.record) {
          const r = result.record, rows = r.entries ?? [];
          selection.textContent += `\n已确认 ${number(r.submittedScore)} / ${number(p.target)} 分 · 已花费 ${number(r.spent)} / ${number(r.budget)} 金币`
            + `\n已购待入库 ${rows.filter(e => ['bought', 'move-pending'].includes(e.state)).length} 张 · 已就绪 ${rows.filter(e => ['ready', 'club'].includes(e.state)).length} 张 · 已贡献 ${r.consumedIds?.length ?? 0} 张`;
        }
        node('contribute').disabled = busy || !contributionReady();
        updateInventoryReview();
      };
      updateSelection();
      const generation = renderGeneration;
      result.batches.forEach((batch, index) => {
        const details = add(output, 'details'); details.open = index === 0;
        const summary = add(details, 'summary'), choice = add(summary, 'input'); choice.type = 'checkbox'; choice.checked = !settled(index);
        // Market routes are frozen as one complete purchase/contribution plan;
        // projected batches are informational and cannot be approved alone.
        if (marketRun) choice.hidden = true;
        choice.dataset.settled = String(settled(index)); choice.disabled = busy || settled(index);
        choice.setAttribute('aria-label', `选择第 ${index + 1} 批`);
        choice.addEventListener('click', event => event.stopPropagation());
        choice.addEventListener('change', () => { if (marketRun) return; if (choice.checked) selected.add(index); else selected.delete(index); updateSelection(); });
        const pending = batch.filter(item => item.source === 'market');
        summary.append(document.createTextNode(` 第 ${index + 1} 批 · ${batch.length} 张（库存 ${batch.length - pending.length} / 待购 ${pending.length}）· ${number(batch.reduce((sum, i) => sum + i.points, 0))} 分 · 待购 ${number(pending.reduce((sum, item) => sum + item.price, 0))} 金币`));
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
            add(text, 'span', `${number(item.rating)} OVR · ${number(item.points)} 分`);
            add(text, 'span', item.source === 'market'
              ? '待购 · 市场概念卡'
              : item.pile === 'storage' ? 'SBC Storage · 已有'
                : item.pile === 'unassigned' ? 'Unassigned → Club · 已有'
                  : item.pile === 'transfer' ? 'Transfer List → Club · 已有' : 'Club · 已有');
            const points = add(row, 'span', `${number(item.points)} 分`); points.className = 'player-points';
            const price = add(row, 'span', item.price == null ? '估值未知' : `${number(item.price)} 金币`);
            price.className = 'player-price'; price.title = item.source === 'market' ? '待购估价' : '库存材料估值';
            if (item.source === 'market') add(price, 'small', `上限 ${number(item.purchaseMaxBuy)}`);
            let native = null, failed = false;
            const unavailable = () => {
              failed = true;
              if (native) { rendered.delete(native); try { native.__fcatDealloc?.(); } catch { /* UI disposal only. */ } native.remove(); }
              if (generation === renderGeneration && !disposed) { fallback.hidden = false; slot.remove(); }
            };
            try {
              const raw = session.resolveDisplayItem?.(item);
              if (raw) native = (item.source === 'market' ? nativeRenderer?.render : nativeRenderer?.renderOwned)?.({ parent: host, raw, slot: slot.name,
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
      if (result.policy?.goldRange?.[1] < 99) {
        add(output, 'small', `FSU 金卡上限 ${number(result.policy.goldRange[1])}：高于该上限的库存卡受保护，不会自动投入；市场补卡仍按独立市场上限。`);
      }
      const exclusionBuckets = result.inventorySelection?.buckets;
      if (Array.isArray(exclusionBuckets) && exclusionBuckets.length) {
        const details = add(output, 'details');
        add(details, 'summary', `未采用库存 ${number(result.inventorySelection.readCount - result.inventorySelection.eligibleCount)} 张`);
        const labels = {
          'fsu-gold-range': '不在 FSU 金卡评分范围',
          untradeable: 'Only Untradeable 不满足',
          pile: '不支持的库存位置',
          locked: 'FSU 手动锁卡保护',
          'active-squad': '当前主阵容保护',
          'eligibility-ineligible': '不符合 SBC 条件',
          'eligibility-unknown': 'SBC 资格未确认',
        };
        add(details, 'small', exclusionBuckets.map(bucket =>
          `${labels[bucket.reason] ?? bucket.reason} · ${bucket.pile === 'storage' ? 'Storage' : bucket.pile === 'club' ? 'Club' : bucket.pile} · ${bucket.rating == null ? '评分未知' : `${number(bucket.rating)}级`} ×${number(bucket.count)}`
        ).join('；'));
      }
      add(output, 'small', result.liveExecutionEnabled ? (marketRun
        ? '点击后按当前路线逐批搜卡、买断、入 Club 并贡献；实际成交不超过每张卡的冻结上限。'
        : '点击贡献将永久消耗所选批次的卡片；可以分批贡献，停止会等待当前批次核对完成。')
        : `当前不能贡献：${streamlinedExecutionMessage(result.executionReason, result.executionRecovery)}`); node('contribute').hidden = false;
  };
  on('solve', async () => {
    if (busy || !origin || !same(origin, read())) return;
    resetProgress(); node('review-stock').hidden = true;
    const serial = opened; shown = null; setBusy(true); clearRendered(); node('result').replaceChildren(); node('contribute').hidden = true; node('status').textContent = '正在准备候选…';
    try {
      const result = await session.plan(config(), { onProgress: p => {
        if (serial !== opened) return;
        const bar = shadow.querySelector('progress');
        const stage = p.phase === 'market-quotes' && p.refresh ? '刷新过期补卡报价'
          : { quotes: '库存报价', catalog: '候选分组', 'market-validation': '核对候选积分', 'market-quotes': '补卡报价' }[p.phase];
        bar.max = stage ? p.total || 1 : p.maxNodes || 1;
        bar.value = stage ? p.completed : p.nodes;
        node('status').textContent = stage ? `${stage} ${number(p.completed)} / ${number(p.total)}${p.source ? ` · ${String(p.source).toUpperCase()}` : ''}${Number.isFinite(p.elapsedMs) ? ` · 已等待 ${Math.floor(p.elapsedMs / 1000)} 秒` : ''}`
          : `搜索节点 ${number(p.nodes)} / ${number(p.maxNodes)} · 候选 ${number(p.candidates)} · ${number(p.elapsedMs)} ms`;
      } });
      if (serial !== opened) return;
      node('status').textContent = result.status === 'cancelled' ? '已停止。'
        : result.plan?.execution?.quoteLimited === true ? '部分报价可用：请核对库存消耗和价格，再确认是否执行。'
        : result.reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED'
          ? streamlinedExecutionMessage(result.reason, null, result.protectionFailure) : result.reason ?? result.status;
      renderResult(result);
    } catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  });
  const showOutcome = result => {
    if (executionProgress) {
      executionProgress.active = false; executionProgress.endedAt = now(); refreshClock();
      const record = result.record;
      if (record) {
        const spent = Number.isSafeInteger(record.spent) ? ` · 已花费 ${number(record.spent)} / ${number(record.budget)} 金币` : '';
        node('final-progress').textContent = `已确认 ${number(record.submittedScore)} / ${number(record.plan?.challenge.targetScore)} 分${spent}`;
        node('final-progress').hidden = false;
        const bar = shadow.querySelector('progress'); bar.max = record.plan?.challenge.targetScore || 1;
        if (Number.isSafeInteger(record.submittedScore)) bar.value = record.submittedScore; else bar.removeAttribute('value');
      }
    }
    const labels = { completed: '目标已达成，奖励状态需另行核对。', partial: '本次贡献已确认，可继续剩余批次。',
      stopped: '已停止；已确认的成交和贡献保留，可核对并恢复。', recovered: '已恢复记录，未重复贡献。', observed: '已读取上次记录。', absent: '没有待恢复的贡献记录。',
      'recovery-required': '结果尚未确认，请核对并恢复；不会重复贡献。', rejected: 'EA 拒绝了本次贡献，请重新规划。' };
    node('status').textContent = result.reason ? streamlinedExecutionMessage(result.reason, result.recovery)
      : result.status === 'absent' ? '当前 SBC 没有待恢复的贡献记录，请点击“生成方案”。' : labels[result.status] ?? result.status;
    if (result.record) node('target').textContent = `${result.record.plan.challenge.name} · ${number(result.record.submittedScore)} / ${number(result.record.plan.challenge.targetScore)}`;
  };
  on('contribute', async () => {
    if (busy || !contributionReady()) return;
    const serial = opened, result = shown, indices = [...selected].sort((a, b) => a - b);
    const marketRun = result.plan.route?.groups?.some(group => group.source === 'market') === true;
    setBusy(true);
    beginProgress(result);
    try {
      const outcome = await session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: indices, allowPartial: result.plan.status === 'partial',
        acknowledgeQuoteCoverage: quoteCoverageAcknowledged }, {
        onProgress: p => {
          if (serial !== opened) return;
          executionStep(p);
          const materializeLabel = { 'checking-source': '检查外部卡', 'checking-club': '核对 Club',
            'journal-pending': '写入恢复记录', 'move-request': '请求移入 Club',
            'move-acknowledged': '移动回执已确认', 'club-readback': '核对 Club 回读', confirmed: '移入 Club 已确认' }[p.stage];
          if (marketRun) {
            node('status').textContent = streamlinedExecutionProgress(p);
            const bar = shadow.querySelector('progress'); bar.max = p.targetScore || 1; bar.value = p.submittedScore;
            return;
          }
          const label = p.phase === 'materialize' && materializeLabel ? materializeLabel
            : { validation: '复核材料', materialize: '移入 Club', contribution: '贡献中', reconciliation: '核对回执', confirmed: '已确认' }[p.phase];
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
    } catch (error) { if (serial === opened) showOutcome({ reason: safeReason(error) }); }
    finally { setBusy(false); }
  });
  on('recover', async () => {
    if (busy) return;
    const serial = opened;
    // Recovery can return absence, another target or an error. None of those
    // outcomes may leave the previous preview enabled for contribution.
    shown = null; selected.clear(); session.clearPreview?.(); clearRendered();
    node('review-stock').hidden = true;
    node('result').replaceChildren(); node('contribute').hidden = true;
    setBusy(true);
    beginProgress(null, 'recovery');
    try {
      const outcome = await session.recover(); if (serial !== opened) return;
      if (outcome.preview) renderResult(outcome.preview);
      showOutcome(outcome);
    } catch (error) { if (serial === opened) showOutcome({ reason: safeReason(error) }); }
    finally { setBusy(false); }
  });
  update(); const timer = schedule(update, 900);
  return Object.freeze({ dispose: () => { disposed = true; close(); unschedule(timer); entry.remove(); host.remove(); } });
}
