import { planGalleryRoadmapSteps } from '../../gallery/roadmap.js';
import { runGalleryPlan } from '../../gallery/cooperative-plan.js';
import { priceGalleryPlanningTargets } from '../../gallery/planning-prices.js';
import { buildGalleryAnalysisSnapshot } from '../../gallery/analysis-snapshot.js';
import { downloadFc27Diagnostics } from './fc27-diagnostic-download.js';
import { attachFodderPlanningReferences, forecastFodderReferencePrices } from '../../gallery/fodder-planning-reference.js';
import { renderGalleryReferenceTable } from './fc27-gallery-reference-table.js';
import { createGalleryRoadmapWork } from '../../gallery/roadmap-work.js';

const money = value => value == null ? '待核实' : Number(value).toLocaleString('en-US');
const failureCode = error => {
  try {
    if (/^FC27_[A-Z0-9_]+$/.test(error?.message ?? '')) return error.message;
    const classes = { TypeError: 'TYPE_ERROR', RangeError: 'RANGE_ERROR', ReferenceError: 'REFERENCE_ERROR', SyntaxError: 'SYNTAX_ERROR' };
    if (Object.hasOwn(classes, error?.name)) return `FC27_GALLERY_ROADMAP_${classes[error.name]}`;
  } catch { /* Error metadata must not prevent cleanup. */ }
  return 'FC27_GALLERY_ROADMAP_FAILED';
};
const add = (document, parent, tag, text = '') => {
  const node = document.createElement(tag); node.textContent = text; parent.append(node); return node;
};

// Read-only global route. Opening a club is the only handoff; buying and
// listing remain in their original independently confirmed account flows.
export function mountGalleryRoadmap({ document, parent, button, read, prepare, stopPrepare,
  loadPrices = null, referenceService = null, onBusyChange = () => {}, onDiagnostic = () => {}, readTimeout = async () => 30000, openSet, download = downloadFc27Diagnostics }) {
  const dialog = add(document, parent, 'dialog'); dialog.className = 'gallery-roadmap-dialog';
  dialog.setAttribute('aria-label', '全画廊整体方案');
  const style = add(document, dialog, 'style', '.gallery-roadmap-dialog{width:min(1120px,94vw);max-width:calc(100vw - 24px);max-height:88vh;overflow:auto;box-sizing:border-box;padding:20px;font:14px/1.5 Arial,sans-serif;text-align:left}.gallery-roadmap-dialog p{margin:8px 0}.gallery-roadmap-dialog h2{margin:0}.gallery-roadmap-dialog .row{margin:12px 0}.gallery-roadmap-header,.gallery-roadmap-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end}.gallery-roadmap-header{justify-content:space-between}.gallery-roadmap-controls label{flex:1;min-width:180px}.gallery-roadmap-controls input,.gallery-roadmap-controls select{width:100%;box-sizing:border-box}.gallery-roadmap-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}.gallery-roadmap-metrics article{padding:12px;border:1px solid #45606b;border-radius:6px}.gallery-roadmap-metrics strong{display:block;font-size:22px}.gallery-roadmap-table{overflow:auto}.gallery-roadmap-table table{width:100%;border-collapse:collapse}.gallery-roadmap-table th,.gallery-roadmap-table td{padding:10px;text-align:left;border-bottom:1px solid #45606b}.gallery-roadmap-dialog button{min-height:40px}.gallery-roadmap-status{display:block;margin:12px 0;overflow-wrap:anywhere}');
  void style;
  const header = add(document, dialog, 'div'); header.className = 'gallery-roadmap-header';
  add(document, header, 'h2', '全画廊整体方案');
  const close = add(document, header, 'button', '关闭'); close.type = 'button';
  add(document, dialog, 'p', '先看全目录路线，再进入各俱乐部完成。已经收集过的版本不重复买；卖出或 SBC 消耗后仍算已有。');
  const controls = add(document, dialog, 'div'); controls.className = 'gallery-roadmap-controls';
  const input = (labelText, placeholder) => {
    const label = add(document, controls, 'label', labelText), field = add(document, label, 'input');
    field.type = 'number'; field.min = '0'; field.step = '1'; field.placeholder = placeholder;
    return field;
  };
  const capital = input('可周转金币', '可留空，先看所需本金');
  const lossLimit = input('最多预计损耗（可选）', '留空不限，不等于采购总额');
  const discountLabel = add(document, controls, 'label', '回售价假设');
  const discount = add(document, discountLabel, 'select');
  for (const [value, text] of [[0, '按买入价卖回，仅估税费'], [500, '比买入价低 5%，另扣税'], [1000, '比买入价低 10%，另扣税']]) {
    const option = add(document, discount, 'option', text); option.value = String(value);
  }
  const actions = add(document, dialog, 'div'); actions.className = 'row'; actions.style.alignItems = 'center';
  const generate = add(document, actions, 'button', '生成整体方案'); generate.className = 'primary'; generate.type = 'button';
  const stop = add(document, actions, 'button', '停止分析'); stop.type = 'button'; stop.hidden = true;
  const exportButton = add(document, actions, 'button', '导出分析快照'); exportButton.type = 'button';
  const modeLabel = add(document, actions, 'label', ' '), deep = add(document, modeLabel, 'input'); deep.type = 'checkbox';
  modeLabel.style.display = referenceService ? 'inline-flex' : 'none'; modeLabel.style.alignItems = 'center'; modeLabel.style.gap = '8px';
  deep.style.width = '18px'; deep.style.height = '18px'; deep.style.minHeight = '0'; deep.style.margin = '0';
  modeLabel.append(document.createTextNode('深度优化（完整候选查价/搜索，更慢）')); modeLabel.hidden = !referenceService;
  if (referenceService) add(document, dialog, 'small', '默认快速首轮：按 Fodder 参考价估算，不等全目录逐卡查价；本地核验组合并扣已有。进入俱乐部/购买前仍独立核价，不保证最低价。');
  const progress = add(document, dialog, 'progress'); progress.max = 1; progress.value = 0; progress.hidden = true;
  progress.setAttribute('aria-label', '整体方案分析进度');
  const status = add(document, dialog, 'output'); status.className = 'gallery-roadmap-status'; status.setAttribute('role', 'status');
  const timing = add(document, dialog, 'small'); timing.setAttribute('role', 'status');
  const referenceBox = add(document, dialog, 'div');
  const output = add(document, dialog, 'div'); output.setAttribute('aria-live', 'polite');
  let epoch = 0, busy = false, last = null, binding = null, planInputs = null, fingerprint = null;
  const work = createGalleryRoadmapWork();
  let stage = 'idle', stopRequested = false;
  let mismatchReason = null;
  const mismatch = reason => { mismatchReason ??= reason; return false; };
  const diagnose = value => { try { Promise.resolve(onDiagnostic(value)).catch(() => {}); } catch { /* Diagnostics never control planning. */ } };
  const parse = field => field.value.trim() === '' ? null : Number(field.value);
  const params = () => ({ capital: parse(capital), lossLimit: parse(lossLimit), resaleDiscountBps: Number(discount.value), deep: deep.checked });
  const capture = state => ({ scope: state.scope, revision: state.catalog?.revision, source: state.catalog?.source,
    targets: state.targets.map(target => [target.set.id, target.progressKey ?? target.progress, target.pool?.revision,
      !!target.stale, !!target.poolStale, target.status]) });
  const same = mark => {
    const state = read('binding');
    if (!state.active) return mismatch('PAGE');
    if (state.scope !== mark.scope) return mismatch('ACCOUNT');
    if (state.catalog?.revision !== mark.revision || state.catalog?.source !== mark.source
        || state.targets.length !== mark.targets.length) return mismatch('CATALOG');
    return state.targets.every((target, i) => {
      const before = mark.targets[i];
      if (target.set.id !== before[0]) return mismatch('CATALOG');
      if ((target.progressKey ?? target.progress) !== before[1]) return mismatch('MATERIAL');
      if (target.pool?.revision !== before[2]) return mismatch('POOL');
      if (!!target.stale !== before[3] || !!target.poolStale !== before[4]) return mismatch('FRESHNESS');
      return target.status === before[5] || mismatch('READINESS');
    });
  };
  const quotesFresh = targets => (targets ?? []).every(target => !target.progress?.rows || target.stale || target.poolStale
    || target.status !== 'observed' || (target.forecastPriceExpiresAt ?? target.priceSnapshot?.expiresAt) == null
    || (target.forecastPriceExpiresAt ?? target.priceSnapshot?.expiresAt) > Date.now());
  const invalidate = () => { epoch++; work.clear(); last = null; planInputs = null; binding = null; output.replaceChildren(); referenceBox.replaceChildren(); timing.textContent = ''; generate.textContent = '生成整体方案'; };
  const render = result => {
    output.replaceChildren();
    const metric = add(document, output, 'div'); metric.className = 'gallery-roadmap-metrics';
    for (const [label, value] of [['目录新增 token', result.addedTokens], ['所需周转本金', result.funding?.requiredCapital],
      ['预计净损耗', result.funding?.expectedNetLoss], ['累计采购额（非本金）', result.funding?.totalPurchase]]) {
      const card = add(document, metric, 'article'); add(document, card, 'small', label); add(document, card, 'strong', money(value));
    }
    add(document, output, 'p', `覆盖 ${result.coverage.inspected}/${result.coverage.total} 个合集；可计分 ${result.coverage.available}。${result.partial ? '当前为部分分析，待核实或未完成的合集另列。' : ''}`);
    if (result.fastReferences) add(document, output, 'p', '快速首轮已本地核验组合、扣除已有卡；金额按 Fodder 逐卡参考价估算，行情年龄未知，不是实际购买限价。进入合集/购买前按原价格来源独立核价；深度优化可继续比较。');
    add(document, output, 'p', '按低预计损耗 / 新增 token 优先的有界路线，不保证全市场最优。Token 为相对当前收集快照的目录增量，不是已领余额或保证可领取数量。');
    add(document, output, 'p', '本金按逐卡买入 → 确认收集 → 卖出到账 → 下一张模拟；并非要求一次买齐。回售价仅是假设，价格波动和未成交都会改变资金需求。');
    if (!result.route.length) add(document, output, 'p', !result.partial && !result.unavailable.length && !result.skipped.length
      ? '当前已分析范围没有确认的目录 token 升级缺口；无需为已达档重复买入，奖励领取状态仍待核实。'
      : '当前已分析范围未得到可确认的升级路线；不代表全画廊无方案。请看待核实项目，或继续分析剩余合集。');
    const tableWrap = add(document, output, 'div'); tableWrap.className = 'gallery-roadmap-table';
    const table = add(document, tableWrap, 'table'), head = add(document, table, 'tr');
    for (const text of ['顺序 / 合集', '现状 → 目标', '新增 token', '本批新买 / 复用', '执行入口']) add(document, head, 'th', text);
    for (const step of result.route) {
      const tr = add(document, table, 'tr');
      add(document, tr, 'th', `${step.order}. ${step.name}`);
      add(document, tr, 'td', `${step.currentGrade ?? '未达档'} → ${step.targetGrade}`);
      add(document, tr, 'td', `+${step.addedTokens}`);
      add(document, tr, 'td', `${step.cycles.length} 张 / ${step.reusedIds.length} 张`);
      const td = add(document, tr, 'td'), open = add(document, td, 'button', '进入俱乐部 / 合集'); open.type = 'button';
      open.addEventListener('click', event => {
        if (!event.isTrusted || !binding || !same(binding) || !quotesFresh(planInputs)) { status.textContent = '数据、账号或报价已变化，请重新生成路线。'; return; }
        dialog.close(); openSet(step.setId, step.targetGrade);
      });
      const cards = add(document, output, 'details');
      add(document, cards, 'summary', `${step.order}. ${step.name} · 补卡与逐卡周转明细`);
      for (const cycle of step.cycles) {
        const card = step.items.find(item => item.eaId === cycle.eaId);
        add(document, cards, 'p', `${card?.name ?? cycle.eaId} · ${card?.version ?? ''} · 买入 ${money(cycle.price)} → 预计税后回收 ${money(cycle.expectedSaleNet)}${cycle.expectedClosingBalance != null ? ` → 预计余额 ${money(cycle.expectedClosingBalance)}` : ''}`);
      }
    }
    const pending = [...result.unavailable, ...result.skipped];
    if (result.freeCheck.length) {
      const achieved = add(document, output, 'details');
      add(document, achieved, 'summary', `现有收藏已可达档位 ${result.freeCheck.length} 项（不重复买入，领取状态未核实）`);
      for (const row of result.freeCheck) add(document, achieved, 'p', `${row.name} · ${row.grade} · 累计目录 token ${row.catalogTokens}`);
    }
    if (pending.length) {
      const details = add(document, output, 'details'); add(document, details, 'summary', `待核实 / 资金受限 ${pending.length} 项`);
      const reasons = { 'capital-gap': '周转本金不足', 'loss-limit': '超出预计损耗上限', 'price-unknown': '报价待核实',
        'progress-unavailable': '收集状态或卡池尚未读取 / 已过期', 'target-unreachable': '已检查范围暂未达到目标',
        'collection-status-unknown': '部分版本的收集状态待核实', 'existing-score-unknown': '已有收藏的计分待核实',
        'search-time-exhausted': '本轮分析时间已到，可继续', 'candidate-search-truncated': '候选范围有限，尚未确认方案',
        'deep-analysis-pending': '快速首轮尚未确认，可勾选深度优化继续检查' };
      for (const item of pending) add(document, details, 'p', `${item.name} · ${reasons[item.reason] ?? `尚未确认方案（${item.reason}）`}${item.capitalShortfall ? ` · 预计还差 ${money(item.capitalShortfall)} 金币本金` : ''}`);
    }
  };
  const cancel = () => {
    stopRequested = true;
    if (stage !== 'planning') { epoch++; stopPrepare?.(); }
    status.textContent = '正在停止分析；未进行买卖。';
  };
  stop.addEventListener('click', event => { if (event.isTrusted) cancel(); });
  close.addEventListener('click', event => { if (event.isTrusted) { if (busy) cancel(); epoch++; dialog.close(); } });
  dialog.addEventListener('cancel', () => { if (busy) cancel(); epoch++; });
  for (const field of [capital, lossLimit, discount, deep]) field.addEventListener('change', invalidate);
  button?.addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (binding && (!same(binding) || !quotesFresh(planInputs))) invalidate();
    const state = read();
    status.textContent = state.catalog ? `全目录 ${state.targets.length} 个合集。点击生成后自动复用收集缓存、补充数据与报价；可随时停止。` : '公开目录尚未载入，请先等待 Gallery 同步。';
    if (!dialog.open) dialog.showModal();
  });
  generate.addEventListener('click', async event => {
    if (!event.isTrusted || busy) return;
    const options = params();
    if ([options.capital, options.lossLimit].some(value => value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 1000000000))) {
      status.textContent = '请输入非负整数金币金额。可周转金币不是累计采购上限。'; return;
    }
    const token = ++epoch; busy = true; stopRequested = false; mismatchReason = null; generate.disabled = true; exportButton.disabled = true; stop.hidden = false; progress.hidden = false;
    let completed = false, failureReason = null, priceBasis = 'unknown', targetCount = 0, planningLimitMs = null;
    for (const field of [capital, lossLimit, discount, deep]) field.disabled = true;
    const completedPhases = new Set();
    const startedAt = performance.now(), timings = {}, tick = () => { timing.textContent = `已用 ${((performance.now() - startedAt) / 1000).toFixed(1)} 秒 · ${stage === 'preparing' ? '同步收集' : stage === 'pricing' ? '独立查价' : stage === 'planning' ? '本地核验/规划' : '读取公共参考'}`; };
    let stageStarted = startedAt;
    const ticker = document.defaultView.setInterval(tick, 500); let referenceSnapshot = null, referenceView = null;
    const context = read('context').scope, current = () => {
      const state = read('context');
      if (state.scope !== context) return mismatch('ACCOUNT');
      return token === epoch && state.active && dialog.open;
    };
    try {
      onBusyChange(true);
      const resume = last?.coverage.stopped && binding && same(binding) && fingerprint === JSON.stringify(options)
        && quotesFresh(planInputs);
      if (!resume) {
        work.clear();
        last = null; binding = null; planInputs = null; output.replaceChildren(); generate.textContent = '生成整体方案';
        if (referenceService) {
          stage = 'reference'; status.textContent = '读取 Fodder 全目录公开组合（空收藏请求，不发送你的收藏）…';
          const at = performance.now();
          stageStarted = at;
          try {
            referenceSnapshot = await referenceService.load({ isCurrent: current });
            if (!current()) return;
            const targets = attachFodderPlanningReferences(read().targets, referenceSnapshot);
            referenceView = renderGalleryReferenceTable(document, referenceBox, targets, referenceSnapshot);
          } catch { if (current()) referenceBox.textContent = 'Fodder 参考暂不可用；可勾选深度优化，按原价格来源独立查价。'; }
          timings.referenceMs = Math.round(performance.now() - at);
        }
        stage = 'preparing';
        const at = performance.now();
        stageStarted = at;
        status.textContent = '1/3 · 校验全目录收集状态（仅数据读取，不买卖）…';
        await prepare?.(value => { if (current()) status.textContent = `1/3 · 同步 ${value.phase ?? ''} ${value.index ?? 0}/${value.total ?? '?'} · 已读 ${value.count ?? 0}`; });
        if (!current()) return;
        timings.syncMs = Math.round(performance.now() - at);
        completedPhases.add('sync');
      }
      const state = read(); if (!state.catalog) throw Error('目录尚未载入');
      binding = capture(state); const valid = () => current() && same(binding) && (stage !== 'planning' || quotesFresh(targets));
      let targets = resume ? planInputs : structuredClone(state.targets);
      targetCount = targets.length;
      if (!resume && referenceSnapshot) targets = attachFodderPlanningReferences(targets, referenceSnapshot);
      if (!resume && referenceSnapshot) referenceView = renderGalleryReferenceTable(document, referenceBox, targets, referenceSnapshot);
      const fastReferences = !!referenceService && !options.deep;
      priceBasis = fastReferences ? 'fodder-public-estimate' : 'independent-reference-quotes';
      if (!resume && fastReferences) targets = forecastFodderReferencePrices(targets);
      if (!resume && loadPrices && !fastReferences) {
        stage = 'pricing';
        const at = performance.now();
        stageStarted = at;
        status.textContent = '2/3 · 读取全目录候选的公开报价…';
        const available = targets.filter(target => target.progress?.rows && !target.stale && !target.poolStale && target.status === 'observed');
        const priced = await priceGalleryPlanningTargets(available, { load: loadPrices, current: valid,
          onProgress: value => { status.textContent = `2/3 · 读取 ${value.source ?? ''} 报价 ${value.index}/${value.total}`; } });
        const byId = new Map(priced.map(target => [target.set.id, target])); targets = targets.map(target => {
          const priced = byId.get(target.set.id); return priced ? { ...target, prices: priced.prices, priceSnapshot: priced.priceSnapshot } : target;
        });
        timings.priceMs = Math.round(performance.now() - at);
        completedPhases.add('pricing');
      }
      if (!valid()) return;
      if (!quotesFresh(targets)) throw Error('FC27_GALLERY_ROADMAP_QUOTES_EXPIRED');
      const maxMs = await readTimeout();
      planningLimitMs = maxMs;
      stage = 'planning';
      const planStarted = performance.now();
      stageStarted = planStarted;
      const generator = planGalleryRoadmapSteps({ ...options, targets, previousRows: resume ? last.rows : [],
        previousSelection: resume ? last.selectedOptions : [], fastReferences, work });
      const steps = { next: finish => generator.next(finish || stopRequested), return: () => generator.return() };
      const result = await runGalleryPlan(steps,
        { current, checkpoint: valid, maxMs, progress: value => {
          status.textContent = value.phase === 'route' ? `3/3 · 组合整体路线 · 已选 ${value.completed}/${value.total} 个目标 · 比对 ${value.comparisons} 次`
            : `3/3 · 全目录分析 ${value.completed ?? 0}/${value.total ?? targets.length} · ${value.name ?? ''} ${value.grade ?? ''} · 已检查 ${value.gradesChecked ?? 0} 档`;
          progress.max = value.total || targets.length || 1; progress.value = value.completed ?? 0;
        } });
      if (!result || !valid()) {
        failureReason = !quotesFresh(targets) ? 'FC27_GALLERY_ROADMAP_QUOTES_EXPIRED' : 'FC27_GALLERY_ROADMAP_CONTEXT_CHANGED';
        status.textContent = !quotesFresh(targets) ? '公开报价已过期，请重新生成整体方案；未进行买卖。'
        : '数据、账号或页面已变化，旧计算已停止。'; return; }
      timings.planningMs = Math.round(performance.now() - planStarted);
      last = { ...result, generatedAt: Date.now(), timings, priceBasis };
      planInputs = targets; fingerprint = JSON.stringify(options); render(last); referenceView?.collapse();
      completed = true;
      status.textContent = result.coverage.stopped ? '已保留本轮结果；可继续分析剩余档位，不从头重算。' : '整体路线已生成；进入具体合集后再确认操作。';
      generate.textContent = result.coverage.stopped ? '继续分析剩余' : '重新生成整体方案';
    } catch (error) {
      failureReason = failureCode(error);
      status.textContent = stopRequested ? '数据读取已停止；未进行买卖。'
      : failureReason === 'FC27_GALLERY_ROADMAP_QUOTES_EXPIRED' ? '公开报价已过期，请重新生成整体方案；未进行买卖。'
      : `本次分析未完成，未买卖：${failureReason}`; }
    finally {
      document.defaultView.clearInterval(ticker);
      const unfinishedPhase = { reference: 'referenceMs', preparing: 'syncMs', pricing: 'priceMs', planning: 'planningMs' }[stage];
      if (unfinishedPhase && timings[unfinishedPhase] == null) timings[unfinishedPhase] = Math.round(performance.now() - stageStarted);
      const outcome = completed ? last.coverage.stopped ? 'partial' : 'success' : stopRequested ? 'stopped' : failureReason ? 'failed' : 'blocked';
      for (const [key, phase] of [['referenceMs','reference'],['syncMs','sync'],['priceMs','pricing'],['planningMs','planning']]) {
        if (timings[key] != null) diagnose({ event: 'roadmap-phase', phase,
          status: phase === 'reference' ? referenceSnapshot ? 'observed' : stopRequested ? 'stopped' : 'unavailable'
            : completedPhases.has(phase) ? 'success' : outcome,
          reason: phase === 'reference' && !referenceSnapshot && !stopRequested ? 'FC27_FODDER_REFERENCE_UNAVAILABLE' : undefined,
          durationMs: timings[key], priceSource: priceBasis, count: targetCount,
          responseCount: phase === 'reference' ? referenceSnapshot?.sets?.length ?? 0 : undefined });
      }
      diagnose({ event: 'roadmap-plan', phase: stage, status: outcome, priceSource: priceBasis, count: targetCount,
        durationMs: Math.round(performance.now() - startedAt), deadlineMs: planningLimitMs,
        responseCount: completed ? last.coverage.inspected : 0, acceptedCount: completed ? last.route.length : 0,
        reason: failureReason ?? (mismatchReason ? 'FC27_GALLERY_ROADMAP_CONTEXT_CHANGED'
          : completed && last.coverage.stopped ? stopRequested ? 'FC27_GALLERY_ROADMAP_STOPPED' : 'FC27_GALLERY_ROADMAP_TIME_LIMIT' : undefined),
        localReason: mismatchReason ? `FC27_GALLERY_ROADMAP_${mismatchReason}_CHANGED` : undefined });
      timing.textContent = `本轮 ${((performance.now() - startedAt) / 1000).toFixed(1)} 秒 · 公共参考 ${((timings.referenceMs ?? 0) / 1000).toFixed(1)} / 同步 ${((timings.syncMs ?? 0) / 1000).toFixed(1)} / 查价 ${((timings.priceMs ?? 0) / 1000).toFixed(1)} / 计算 ${((timings.planningMs ?? 0) / 1000).toFixed(1)} 秒`;
      if (stopRequested && stage !== 'planning') status.textContent = '数据读取已停止；未进行买卖。';
      busy = false; stage = 'idle'; generate.disabled = false; exportButton.disabled = false; stop.hidden = true; progress.hidden = true;
      for (const field of [capital, lossLimit, discount, deep]) field.disabled = false;
      if (!completed || !last.coverage.stopped) work.clear();
      onBusyChange(false);
    }
  });
  exportButton.addEventListener('click', event => {
    if (!event.isTrusted || busy) return;
    try {
      const state = read(), current = binding && same(binding) && quotesFresh(planInputs);
      const payload = buildGalleryAnalysisSnapshot({ ...state, targets: current && planInputs ? planInputs : state.targets, plan: current ? last : null });
      const filename = `FCAT-Gallery-analysis-${new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-')}.json`;
      download(document.defaultView, document, JSON.stringify(payload, null, 2), filename);
      status.textContent = `已导出 ${payload.coverage.loaded}/${payload.coverage.total} 个合集快照；未加载和未知项已标记，不含账号或交易日志。`;
    } catch { status.textContent = '快照导出未完成；请先读取目录。'; }
  });
  return { close: () => { if (busy) cancel(); invalidate(); dialog.close(); },
    dispose: () => { if (busy) cancel(); epoch++; work.clear(); dialog.close(); dialog.remove(); } };
}
