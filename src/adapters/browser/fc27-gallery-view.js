import { GALLERY_TTL_MS } from './fc27-gallery-catalog.js';
import { diffGalleryCatalog } from '../../gallery/catalog.js';
import { summarizeGalleryScore } from '../../gallery/scoring.js';
import { planGalleryGrade } from '../../gallery/planner.js';
import { planGalleryJoint } from '../../gallery/joint-planner.js';

// Public catalogue and per-set read-only progress UI. Remote values are always
// rendered through textContent; this module never writes EA state.
export function mountFc27GalleryView({ document, shadow, host, provider, loadSet = null, accountScope = () => null,
  assets = null, prices = null, nativeRenderer = null, gradePlanner = planGalleryGrade,
  timers = document.defaultView,
  visible = () => host.isConnected && host.getClientRects().length > 0 && document.visibilityState !== 'hidden' }) {
  const node = id => shadow.getElementById(id);
  const add = (parent, tag, value = '', className = '') => {
    const child = document.createElement(tag); child.textContent = value; child.className = className; parent.append(child); return child;
  };
  const asset = (kind, id) => {
    try { const value = assets?.[kind]?.(id); return typeof value === 'string' && /^https:\/\/www\.ea\.com\//i.test(value) ? value : ''; }
    catch { return ''; }
  };
  const image = (parent, src, alt, className = '') => {
    if (!src) return null;
    const img = document.createElement('img'); img.src = src; img.alt = alt || ''; img.loading = 'lazy'; img.decoding = 'async';
    img.className = className; img.referrerPolicy = 'no-referrer'; parent.append(img); return img;
  };
  const nativeCards = new Set();
  let cardSequence = 0, disposed = false;
  const disposeNativeCards = () => {
    for (const card of nativeCards) {
      try { card.__fcatDealloc?.(); } catch { /* UI cleanup only. */ }
      card.remove();
    }
    nativeCards.clear();
  };
  const renderTextCard = (parent, row) => {
    const fallback = add(parent, 'div', '', 'gallery-text-card');
    add(fallback, 'strong', String(row.overall ?? '—'), 'gallery-text-card-rating');
    add(fallback, 'span', row.name, 'gallery-text-card-name');
    add(fallback, 'small', `${row.version ?? '版本未知'} · ${row.positions?.[0] ?? '位置未知'}`, 'gallery-text-card-meta');
    fallback.title = 'EA 原生卡面暂未取得';
    return fallback;
  };
  const cardImage = (parent, row, runtimeCards, setId) => {
    if (!active || disposed || jointMode) return;
    let native, fallbackRendered = false;
    const slot = add(parent, 'slot'); slot.name = `gallery-card-${++cardSequence}`;
    const fallback = () => {
      if (fallbackRendered || disposed || !active || !slot.isConnected || selectedSetId !== setId) return;
      fallbackRendered = true; slot.remove(); nativeCards.delete(native);
      renderTextCard(parent, row);
    };
    try {
      // Slotted light-DOM children inherit EA's global card styles. Do not
      // copy stylesheets or rebuild a portrait/card shell inside our shadow.
      native = nativeRenderer?.render?.({ parent: host, raw: runtimeCards?.get?.(row.eaId), label: `${row.name} ${row.version ?? ''}`, onUnavailable: fallback });
      if (native) { native.slot = slot.name; nativeCards.add(native); return; }
    } catch { /* Fall through to text-only card. */ }
    fallback();
  };
  const cachedPrice = (row, detail = null) => {
    try {
      const value = detail?.prices?.[row.eaId] ?? (typeof prices === 'function' ? prices(row.eaId, row) : prices?.[row.eaId]);
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    } catch { return null; }
  };
  const priceExpired = detail => detail?.priceSnapshot?.expiresAt != null && Date.now() >= detail.priceSnapshot.expiresAt;
  const planningPrices = detail => detail?.priceSnapshot
    ? priceExpired(detail) ? {} : detail.priceSnapshot.freshPrices : detail?.prices;
  const statusIcon = (parent, value, label) => {
    const icon = add(parent, 'span', value === true ? '✓' : value === false ? '○' : '?', `gallery-status-icon ${value === true ? 'is-yes' : value === false ? 'is-no' : 'is-unknown'}`);
    icon.title = label; icon.setAttribute('aria-label', label); return icon;
  };
  const gradeTrack = (parent, grades, total, state = '') => {
    const track = add(parent, 'div', '', `gallery-grade-track ${state}`); track.setAttribute('role', 'list');
    const score = Number.isFinite(total) ? total : null;
    for (let index = 0; index < grades.length; index++) {
      const grade = grades[index], reached = score != null && score >= grade.threshold;
      const next = grades[index + 1]?.threshold ?? grade.threshold;
      const previous = grade.threshold;
      const fraction = score == null || reached ? (reached ? 1 : 0) : Math.max(0, Math.min(1, (score - previous) / Math.max(1, next - previous)));
      const cell = add(track, 'span', '', 'gallery-grade-cell'); cell.setAttribute('role', 'listitem');
      const diamond = add(cell, 'span', '', `gallery-grade-diamond grade-${String(grade.name).toLowerCase()} ${reached ? 'is-reached' : ''}`);
      add(diamond, 'span', grade.name, 'gallery-grade-letter');
      diamond.title = `${grade.name} · ${count(grade.threshold)} 分`;
      diamond.setAttribute('aria-label', `${grade.name} 档，${count(grade.threshold)} 分${reached ? '，已达到' : ''}`);
      const bar = add(cell, 'span', '', 'gallery-grade-bar'); const fill = add(bar, 'i'); fill.style.width = `${Math.round(fraction * 100)}%`;
      add(cell, 'small', count(grade.threshold), 'gallery-grade-threshold');
    }
    return track;
  };
  const date = value => Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : '未知';
  const count = value => Number.isFinite(value) ? value.toLocaleString() : '未知';
  const state = value => value === true ? '是' : value === false ? '否' : '未知';
  const scoreCache = new WeakMap();
  const scoreSummary = (value, set) => {
    if (!value?.progress || !result?.catalog) return null;
    const revision = result.catalog.revision;
    const key = JSON.stringify([revision, result.catalog.tags, set]);
    const cached = scoreCache.get(value.progress);
    if (cached?.key === key) return cached.summary;
    let summary;
    try { summary = summarizeGalleryScore({ set, catalog: result.catalog, progress: value.progress }); }
    catch { summary = { status: 'unavailable', reason: 'input-invalid' }; }
    scoreCache.set(value.progress, { key, summary });
    return summary;
  };
  const scoreText = summary => {
    if (!summary || summary.status === 'unavailable') return '计分规则待核实';
    if (!summary.low || summary.status === 'partial') return '计分数据未完整同步';
    const points = summary.low.total === summary.high.total ? count(summary.low.total) : `${count(summary.low.total)}–${count(summary.high.total)}`;
    if (!summary.full) return `${points} 分 · 还缺 ${summary.missingCards} 张计分卡，暂不计等级`;
    if (summary.status === 'uncertain') return `${points} 分 · 等级待核实`;
    return `${points} 分 · 计算等级 ${summary.grade ?? '未达 D'}`;
  };
  const renderScoring = (target, summary, value) => {
    const section = add(target, 'section', '', 'gallery-score');
    add(section, 'strong', `${value.stale || value.poolStale || result?.stale ? '快照' : '当前'}计分：${scoreText(summary)}`);
    if (!summary?.low) {
      add(section, 'small', summary?.reason === 'base-score-unknown' ? '部分已收集卡缺少 EA 基础分；公开估值不会代替账号分值。' : '目录包含未识别的计分条件，保留收集进度并等待规则适配。');
      return;
    }
    add(section, 'small', `基础分 ${count(summary.low.base)} ＋ 已知加成 ${count(summary.low.bonus)} · 计分 ${summary.lineup.length} 张`);
    if (summary.zeroScoreCards) add(section, 'small', `${summary.zeroScoreCards} 张已收集版本的 EA 基础分为 0，按参考规则不计入计分人数。`);
    if (summary.full && summary.nextGrade) add(section, 'p', `下一档 ${summary.nextGrade}：按已知贡献还差 ${count(summary.pointsToNext)} 分`);
    else if (summary.full) add(section, 'p', '按已知贡献达到最高档门槛');
    if (summary.full && summary.low.total !== summary.high.total) {
      add(section, 'small', `同一计分组合的条件等级：${summary.lowGrade ?? '未达 D'}–${summary.highGrade ?? '未达 D'}。区间仅针对已选组合，不代表所有组合的最高分。`, 'gallery-unknown');
    }
    const names = { firstOwned: 'First Owner 历史', holographic: '闪卡属性', weakFoot: '逆足', skillMoves: '花式',
      nationEaId: '国籍', clubEaId: '俱乐部', leagueEaId: '联赛', playerEaId: '球员身份', positions: '位置', overall: '评分', rarityEaId: '卡种' };
    if (summary.unknownFields.length) add(section, 'small', `未知：${summary.unknownFields.map(field => names[field] ?? field).join('、')}。已知贡献不计未知项，区间另一端按未知项满足条件计算；重新同步未必能找回已离队卡的首任历史。`, 'gallery-unknown');
    if (summary.ruleDifference) add(section, 'small', `分组规则有差异：同组合 Fodder ${count(summary.low.total)}–${count(summary.high.total)}，FUT.GG ${count(summary.comparison.low.total)}–${count(summary.comparison.high.total)}；EA 规则仍待对照。`, 'gallery-unknown');
    if (summary.collectionUnknown) add(section, 'small', '收集状态尚未完整，当前仅计算已确认收集卡。', 'gallery-unknown');
    add(section, 'small', `${summary.selection === 'bounded-search' ? '按参考插件有界换阵选出组合，不保证全局最优。' : ''}本地计算参考等级，不代表 EA 已确认等级或奖励可领取；首任证据来自当前 Club 缓存。`);
    const explanation = add(section, 'details'); add(explanation, 'summary', '计分卡片与加成明细');
    const selected = add(explanation, 'ul', '', 'gallery-lineup');
    for (const row of summary.lineup) add(selected, 'li', `${row.name ?? row.eaId} · ${row.version ?? ''} · EA ${count(row.gradingScore)}`);
    add(explanation, 'p', '只计收益最高的十项加成；每项按匹配卡片的基础分向下取整。');
    const bonuses = add(explanation, 'ul', '', 'gallery-bonuses');
    for (const tag of summary.low.tags) {
      const high = summary.high.tags.find(row => row.id === tag.id);
      const suffix = tag.bonus > 0 && !tag.counted ? ' · 未进前十，不计入' : tag.counted ? ' · 计入' : '';
      add(bonuses, 'li', `${tag.name}：${tag.count} 张 · ${count(tag.matched)} × ${tag.pct}% = ${count(tag.bonus)}${suffix}${high.bonus !== tag.bonus ? ` · 未知项满足时 ${count(high.bonus)}` : ''}${tag.next ? ` · 再 ${tag.next.needed} 张达 ${tag.next.pct}%` : ''}`);
    }
  };
  const renderPlan = (target, value, set, summary) => {
    if (typeof gradePlanner !== 'function' || !value?.progress || !result?.catalog) return;
    const section = add(target, 'section', '', 'gallery-plan');
    add(section, 'strong', '指定等级补卡方案');
    const row = add(section, 'div', '', 'row');
    const select = document.createElement('select');
    for (const grade of set.grades) { const option = document.createElement('option'); option.value = grade.name; option.textContent = `${grade.name} · ${count(grade.threshold)} 分`; select.append(option); }
    if (summary?.nextGrade) select.value = summary.nextGrade;
    row.append(select);
    const button = add(row, 'button', '生成方案'); button.type = 'button';
    const jointAdd = add(row, 'button', '+', 'gallery-joint-add'); jointAdd.type = 'button';
    jointAdd.title = '加入联合目标'; jointAdd.setAttribute('aria-label', '加入联合目标');
    jointAdd.disabled = value.status !== 'observed' || value.stale === true || value.poolStale === true;
    jointAdd.addEventListener('click', event => {
      if (!event.isTrusted) return;
      jointTargets.set(set.id, select.value); invalidateJoint(); renderJoint();
      jointAdd.title = '已加入联合目标';
    });
    const output = add(section, 'div', '', 'gallery-plan-output'); output.setAttribute('aria-live', 'polite');
    const show = plan => {
      output.replaceChildren();
      if (!plan || plan.status === 'unavailable') { add(output, 'small', `暂不可规划：${plan?.reason ?? '输入不完整'}`, 'gallery-unknown'); return; }
      if (plan.status === 'achieved') { add(output, 'small', `当前已达到 ${plan.targetGrade} 档，无需补卡。`); return; }
      const reasons = { 'search-budget-exhausted': '搜索预算耗尽，尚不能确认无解',
        'candidate-search-truncated': '候选范围未完整搜索，尚不能确认无解',
        'beam-search-truncated': '有界搜索未找到方案，尚不能确认无解',
        'score-selection-bounded': '计分选队使用有界搜索，尚不能确认无解',
        'score-conditions-unknown': '部分计分属性待核实', 'collection-status-unknown': '收集状态待核实',
        'existing-score-unknown': '已收集卡的 EA 基础分待核实', 'target-unreachable': '当前材料达不到目标' };
      if (plan.status !== 'ready') { add(output, 'small', reasons[plan.reason] ?? '暂未找到可行方案', 'gallery-unknown'); return; }
      add(output, 'small', `找到 ${plan.plans.length} 个候选方案；只读结果，不代表 EA 已确认等级。`);
      for (const [index, candidate] of plan.plans.entries()) {
        const details = add(output, 'details'); add(details, 'summary', `方案 ${index + 1} · ${candidate.totalPrice == null ? '报价未知' : `${count(candidate.totalPrice)} 🪙`} · ${count(candidate.score)} 分`);
        const list = add(details, 'ul');
        for (const item of candidate.items) add(list, 'li', `${item.name ?? item.eaId} · ${item.version ?? '版本未知'} · ${item.price == null ? '价格未知' : `${count(item.price)} 🪙`}${item.scoreSource === 'catalog' ? ' · 公开估分' : ''}`);
        if (candidate.missingPriceIds.length) add(details, 'small', `${candidate.missingPriceIds.length} 张卡缺少报价，执行前必须重新查价。`, 'gallery-unknown');
        if (candidate.unknownFields?.length) add(details, 'small', '部分计分属性未知，方案按已知贡献计算。', 'gallery-unknown');
      }
    };
    button.addEventListener('click', event => {
      if (!event.isTrusted) return;
      button.disabled = true; output.replaceChildren(); add(output, 'small', '正在计算…');
      try { show(gradePlanner({ set, catalog: result.catalog, progress: value.progress, prices: planningPrices(value), targetGrade: select.value })); }
      catch { show({ status: 'unavailable', reason: 'planner-failed' }); }
      finally { button.disabled = false; }
    });
  };
  let categoryId = null, result = null, pending = null, timer = null, active = false;
  let selectedSetId = null, selection = 0, scopeTimer = null, filter = 'all';
  const details = new Map();
  const jointTargets = new Map();
  let jointMode = false;
  const invalidateJoint = () => {
    node('gallery-joint-output').replaceChildren();
  };
  const renderJoint = () => {
    const container = node('gallery-joint-targets'); container.replaceChildren();
    node('gallery-joint-count').textContent = String(jointTargets.size);
    node('gallery-joint-plan').disabled = !jointTargets.size;
    if (!jointTargets.size) { add(container, 'small', '尚无联合目标'); return; }
    const sets = result?.catalog?.categories.flatMap(category => category.sets) ?? [];
    for (const [id, grade] of jointTargets) {
      const set = sets.find(set => set.id === id);
      if (!set) continue;
      const row = add(container, 'div', '', 'gallery-joint-target'); row.dataset.setId = id;
      add(row, 'strong', set.name);
      const select = document.createElement('select'); select.setAttribute('aria-label', `${set.name} 目标等级`);
      for (const grade of set.grades) { const option = document.createElement('option'); option.value = grade.name;
        option.textContent = `${grade.name} · ${count(grade.threshold)}`; select.append(option); }
      select.value = grade; row.append(select);
      select.addEventListener('change', () => { jointTargets.set(id, select.value); invalidateJoint(); });
      const remove = add(row, 'button', '×'); remove.title = '移除目标'; remove.setAttribute('aria-label', `移除 ${set.name}`);
      remove.addEventListener('click', () => { jointTargets.delete(id); invalidateJoint(); renderJoint(); });
      const value = details.get(id);
      if (!value?.progress || value.status !== 'observed' || value.stale || value.poolStale) add(row, 'small', '集合状态待更新', 'gallery-unknown');
      else add(row, 'small', scoreText(scoreSummary(value, set)));
    }
  };
  const setJointMode = enabled => {
    jointMode = enabled;
    node('gallery-browse').hidden = enabled; node('gallery-joint').hidden = !enabled;
    node('gallery-mode-browse').setAttribute('aria-pressed', String(!enabled));
    node('gallery-mode-joint').setAttribute('aria-pressed', String(enabled));
    if (enabled) { disposeNativeCards(); renderJoint(); }
    else if (selectedSetId && details.has(selectedSetId)) {
      const set = result?.catalog.categories.flatMap(category => category.sets).find(set => set.id === selectedSetId);
      if (set) renderSetDetail(details.get(selectedSetId), set);
    }
  };
  const showJointPlan = plan => {
    const output = node('gallery-joint-output'); output.replaceChildren();
    if (plan.status === 'achieved') { add(output, 'p', '当前联合目标已达到，无需补卡。'); return; }
    if (plan.status !== 'ready') {
      const messages = { 'target-state-unknown': '集合状态待更新', 'price-unknown': '缺少有效报价，预算方案尚未确定',
        'search-budget-exhausted': '搜索预算耗尽，尚不能确认无解', 'candidate-search-truncated': '候选范围不完整，尚不能确认无解',
        'beam-search-truncated': '有界搜索未找到方案，尚不能确认无解', 'score-selection-bounded': '计分选队尚未穷尽，尚不能确认无解',
        'score-conditions-unknown': '部分计分属性待核实', 'budget-unreachable': '当前预算不足',
        'target-unreachable': '当前材料达不到联合目标', 'version-facts-conflict': '集合间的版本状态不一致，需要更新',
        'budget-invalid': '请输入非负整数预算', 'target-context-mismatch': '集合账号或平台不一致' };
      add(output, 'p', messages[plan.reason] ?? '联合规划暂不可用', 'gallery-unknown');
      for (const target of plan.targets ?? []) add(output, 'small', `${target.name} · ${target.targetGrade} · 已知贡献还差 ${count(target.pointsMissing)} 分`);
      return;
    }
    if (!plan.searchComplete) add(output, 'small', '有界候选方案，不保证最低总价。', 'gallery-unknown');
    for (const [index, planRow] of plan.plans.entries()) {
      const detail = add(output, 'details'); detail.open = index === 0;
      add(detail, 'summary', `方案 ${index + 1} · ${planRow.items.length} 张 · ${planRow.totalPrice == null ? '报价未知' : `${count(planRow.totalPrice)} 🪙`}`);
      if (planRow.remainingBudget != null) add(detail, 'small', `剩余预算 ${count(planRow.remainingBudget)} 🪙`);
      if (planRow.estimated) add(detail, 'small', '包含公开估分', 'gallery-unknown');
      const targets = add(detail, 'table');
      for (const target of planRow.targets) {
        const row = add(targets, 'tr'); add(row, 'th', `${target.name} · ${target.targetGrade}`);
        add(row, 'td', `${count(target.score)} 分`);
        add(row, 'td', target.rewards.map(reward => reward.label).join('、') || '无目录奖励');
      }
      add(detail, 'small', '奖励为目录内容，未确认可领或新增收益。');
      const list = add(detail, 'ul');
      for (const item of planRow.items) add(list, 'li', `${item.name ?? item.eaId} · ${item.version ?? ''} · ${item.price == null ? '价格未知' : `${count(item.price)} 🪙`}${item.targetIds.length > 1 ? ` · 共用 ${item.targetIds.length} 个目标` : ''}`);
    }
  };
  node('gallery-mode-browse').addEventListener('click', () => setJointMode(false));
  node('gallery-mode-joint').addEventListener('click', () => setJointMode(true));
  node('gallery-joint-budget').addEventListener('input', invalidateJoint);
  node('gallery-joint-plan').addEventListener('click', event => {
    if (!event.isTrusted) return;
    checkScope();
    const sets = result?.catalog?.categories.flatMap(category => category.sets) ?? [];
    const targets = [];
    for (const [id, targetGrade] of jointTargets) {
      const value = details.get(id), set = sets.find(set => set.id === id);
      if (!set || !value?.progress || value.status !== 'observed' || value.stale || value.poolStale) {
        showJointPlan({ status: 'partial', reason: 'target-state-unknown' }); return;
      }
      targets.push({ set, catalog: result.catalog, progress: value.progress, prices: planningPrices(value),
        scope: currentScope, targetGrade });
    }
    const rawBudget = node('gallery-joint-budget').value.trim(), budget = rawBudget ? Number(rawBudget) : null;
    try { showJointPlan(planGalleryJoint({ targets, budget })); }
    catch { showJointPlan({ status: 'unavailable' }); }
  });
  const invalidated = new Set();
  let detailRequest = null;
  const scope = () => { try { return accountScope(); } catch { return null; } };
  let currentScope = scope();
  const checkScope = () => {
    const next = scope();
    if (next === currentScope) return;
    currentScope = next; selection++; selectedSetId = null; details.clear();
    jointTargets.clear(); invalidateJoint(); renderJoint();
    disposeNativeCards(node('gallery-set-detail'));
    node('gallery-set-detail').replaceChildren(); node('gallery-set-detail').hidden = true;
    node('gallery-sets').hidden = false;
    if (result) renderSets();
  };

  const renderSetDetail = (value, set) => {
    const target = node('gallery-set-detail'); disposeNativeCards(target); target.replaceChildren(); target.hidden = false;
    node('gallery-sets').hidden = true;
    const back = add(target, 'button', '返回集合');
    back.addEventListener('click', () => { selection++; selectedSetId = null; disposeNativeCards(); target.replaceChildren(); target.hidden = true; node('gallery-sets').hidden = false; });
    const heading = add(target, 'div', '', 'gallery-detail-heading');
    const headingIdentity = add(heading, 'div', '', 'gallery-identity');
    add(headingIdentity, 'h3', set.name);
    if (!value) return;
    if (value.status === 'loading') { add(target, 'p', '正在读取卡池和账号状态…'); return; }
    if (!value.progress) {
      add(target, 'p', value.reason ?? '集合卡池或账号进度暂不可用', 'gallery-unknown'); return;
    }
    const progress = value.progress;
    const summary = scoreSummary(value, set);
    if (value.status !== 'observed') add(target, 'small', `账号状态未同步 · ${value.reason ?? '读取失败'}`, 'gallery-unknown');
    if (value.priceError) add(target, 'small', `价格读取失败 · ${value.priceError}`, 'gallery-unknown');
    if (value.priceSnapshot?.stale || priceExpired(value)) add(target, 'small', '报价快照待更新', 'gallery-unknown');
    const first = progress.rows[0];
    const emblems = add(headingIdentity, 'div', '', 'gallery-emblems');
    image(emblems, asset('club', first?.clubEaId), '俱乐部徽章', 'gallery-emblem');
    image(emblems, asset('league', first?.leagueEaId), '联赛标志', 'gallery-emblem');
    const overview = add(target, 'div', '', 'gallery-overview');
    add(overview, 'strong', `${progress.totals.collected}/${set.requiredCards}`, 'gallery-big-count');
    add(overview, 'span', '已收集', 'gallery-muted');
    add(overview, 'span', `${progress.totals.missing} 缺失 · ${progress.totals.unknown} 待核实`, 'gallery-muted');
    add(overview, 'span', `卡池 ${progress.totals.total}`, 'gallery-muted');
    gradeTrack(overview, set.grades, summary?.low?.total, summary?.status);
    const facts = add(target, 'details', '', 'gallery-facts'); add(facts, 'summary', '收集状态详情');
    add(facts, 'small', `Club 可见 ${progress.totals.inClub} / 未知 ${progress.totals.clubUnknown} · 首任可见 ${progress.totals.firstOwned} / 未知 ${progress.totals.firstOwnedUnknown}`);
    add(facts, 'small', 'Club 来自当前缓存；未看到不等于没有。公开分值与 EA 单卡基础分分别显示。');
    if (value.stale) add(target, 'small', `更新未成功，保留最近快照 · ${value.reason ?? ''}`, 'gallery-unknown');
    if (value.poolStale) add(target, 'small', '公共卡池暂时无法更新，使用上次卡池。', 'gallery-unknown');
    if (value.fetchedAt) add(target, 'small', `收集状态读取于 ${date(value.fetchedAt)}`);
    renderScoring(target, summary, value);
    renderPlan(target, value, set, summary);
    const filters = add(target, 'div', '', 'row gallery-card-filters');
    for (const [key, label] of [['all','全部'],['collected','已收集'],['missing','未收集'],['unknown','待核实']]) {
      const button = add(filters, 'button', label); button.setAttribute('aria-pressed', String(filter === key));
      button.addEventListener('click', () => { filter = key; renderSetDetail(value, set); });
    }
    const list = add(target, 'div', '', 'gallery-card-list');
    const scoredIds = new Set(summary?.lineup?.map(row => row.eaId) ?? []);
    for (const row of progress.rows.filter(row => filter === 'all' || row.status === filter)) {
      const card = add(list, 'article', '', 'gallery-card gallery-player-card');
      card.dataset.definitionId = String(row.eaId);
      card.dataset.rarityId = String(row.rarityEaId ?? '');
      const art = add(card, 'div', '', 'gallery-player-art');
      art.dataset.galleryCardArt = String(row.eaId);
      const price = cachedPrice(row, value);
      const priceBar = add(art, 'div', '', 'gallery-card-pricebar');
      const priceLabel = add(priceBar, 'span', price == null ? '价格未知' : `${price.toLocaleString()} 🪙`, 'gallery-card-price');
      const stalePrice = price != null && (priceExpired(value) || value.priceSnapshot?.staleIds?.includes(row.eaId)
        || value.priceSnapshot && !Object.hasOwn(value.priceSnapshot.prices, row.eaId));
      if (stalePrice) { priceLabel.dataset.priceState = 'snapshot'; priceLabel.title = '旧报价快照，不用于方案成本'; priceLabel.classList.add('gallery-unknown'); }
      add(priceBar, 'span', `Gallery ${row.galleryScore == null ? '—' : row.galleryScore.toLocaleString()}`, 'gallery-card-gallery-score');
      cardImage(art, row, value.runtimeCards, set.id);
      const meta = add(card, 'div', '', 'gallery-player-meta');
      add(meta, 'strong', row.name);
      add(meta, 'span', `${row.overall ?? '—'} OVR · ${row.version ?? '版本未知'}`, 'gallery-player-version');
      const logos = add(meta, 'div', '', 'gallery-player-logos');
      image(logos, asset('club', row.clubEaId), '俱乐部', 'gallery-mini-emblem');
      image(logos, asset('league', row.leagueEaId), '联赛', 'gallery-mini-emblem');
      image(logos, asset('nation', row.nationEaId), '国籍', 'gallery-mini-emblem');
      const flags = add(meta, 'div', '', 'gallery-player-flags');
      statusIcon(flags, row.collected, row.collected === true ? '已收集' : row.collected === false ? '未收集' : '收集状态未知');
      statusIcon(flags, row.inClub, row.inClub === true ? 'Club 可见' : row.inClub === false ? 'Club 未看到' : 'Club 状态未知');
      statusIcon(flags, row.firstOwned, row.firstOwned === true ? 'First Owner' : row.firstOwned === false ? '非 First Owner' : 'First Owner 未知');
      add(meta, 'span', `EA ${row.gradingScore == null ? '未知' : row.gradingScore}`, 'gallery-player-score');
      if (scoredIds.has(row.eaId)) add(meta, 'span', '计分阵容成员', 'badge');
    }
  };

  const loadSetDetails = (set, { force = false } = {}) => {
    if (typeof loadSet !== 'function') return;
    checkScope();
    selectedSetId = set.id;
    filter = 'all'; const token = ++selection, startedScope = currentScope, source = result?.source;
    force = force || invalidated.has(set.id);
    // A forced refresh must follow, not coalesce into, the pre-change read.
    const prior = force && detailRequest?.id === set.id && detailRequest.source === source ? detailRequest.task : null;
    renderSetDetail({status:'loading'}, set);
    const task = Promise.resolve(prior).then(() => {
      checkScope();
      if (token !== selection || startedScope !== currentScope) return null;
      return loadSet({ source, setId: set.id, set, force });
    })
      .then(value => {
        checkScope();
        if (!value || token !== selection || source !== result?.source || startedScope !== currentScope || value.scope && value.scope !== currentScope) return;
        if (value.status === 'observed' && !value.poolStale) invalidated.delete(set.id);
        details.set(set.id, value); invalidateJoint(); renderJoint(); renderSets();
        const currentSet = result.catalog.categories.flatMap(category => category.sets).find(row => row.id === set.id);
        if (currentSet && !jointMode) renderSetDetail(value, currentSet);
      })
      .catch(error => {
        checkScope();
        const value = { status: 'blocked', reason: /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_GALLERY_PROGRESS_UNAVAILABLE' };
        if (token === selection) renderSetDetail(value, set);
      });
    detailRequest = { id: set.id, source, task };
    return task;
  };

  const renderSets = () => {
    const categories = result?.catalog?.categories ?? [];
    const category = categories.find(row => row.id === categoryId);
    const list = node('gallery-set-list'); list.replaceChildren();
    node('gallery-category-title').textContent = category ? `${category.name} · ${category.sets.length} 个集合` : '全部集合';
    for (const row of category ? [category] : categories) for (const set of row.sets) {
      const card = add(list, 'article', '', 'gallery-set'); card.dataset.setId = set.id;
      const title = add(card, 'div', '', 'gallery-set-title');
      add(title, 'h4', set.name);
      const configuredIcons = assets?.set?.(set.name);
      const titleIcons = Array.isArray(configuredIcons) && configuredIcons.length
        ? configuredIcons
        : details.get(set.id)?.pool?.items?.slice(0, 3).map(item => asset('club', item.clubEaId)) ?? [];
      const iconBox = add(title, 'span', '', 'gallery-set-icons');
      for (const value of (Array.isArray(titleIcons) ? titleIcons : [titleIcons]).slice(0, 3)) {
        const src = typeof value === 'string' && value.startsWith('https://') ? value : asset('club', value);
        if (src) image(iconBox, src, set.name, 'gallery-set-icon');
      }
      if (result.changes?.added.includes(set.id)) add(card, 'span', '新集合', 'badge');
      add(card, 'p', `${row.name} · 需要 ${set.requiredCards} 张卡`);
      const detail = details.get(set.id), totals = detail?.progress?.totals, summary = scoreSummary(detail, set);
      add(card, 'small', totals ? `已确认收集 ${totals.collected} / 目标 ${set.requiredCards} · 待核实 ${totals.unknown}${detail.stale ? ' · 快照待更新' : ''}` : '收集进度：未同步', 'gallery-unknown');
      if (summary) add(card, 'small', `${detail.stale || detail.poolStale || result.stale ? '快照' : '当前'}计分：${scoreText(summary)}`);
      if (set.description) add(card, 'p', set.description);
      const grades = add(card, 'div', '', 'gallery-grades');
      gradeTrack(grades, set.grades, summary?.low?.total, summary?.status);
      if (typeof loadSet === 'function' && result.source === 'futgg') {
        const button = add(card, 'button', '查看卡片', 'gallery-open-set');
        button.type = 'button'; button.addEventListener('click', event => { if (event.isTrusted) void loadSetDetails(set); });
      } else if (typeof loadSet === 'function' && result.source === 'fodder') {
        add(card, 'small', '当前使用 Fodder 回退目录；该来源没有已核实卡池接口，暂不能读取卡片和 EA 收集状态。', 'gallery-unknown');
      }
      const rewardsDetail = add(card, 'details'); add(rewardsDetail, 'summary', '等级奖励');
      const rewards = add(rewardsDetail, 'ul');
      for (const grade of set.grades) {
        const labels = grade.rewards.map(reward => `${reward.count > 1 ? `${reward.count} × ` : ''}${reward.label}`).join('、');
        add(rewards, 'li', `${grade.name}：${labels || (grade.rewardsComplete ? '无奖励' : '未提供非代币奖励')}`);
      }
      if (set.grades.some(grade => !grade.rewardsComplete)) add(rewardsDetail, 'small', '回退目录仅提供代币奖励，其他奖励信息不完整。');
    }
    for (const button of node('gallery-categories').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.categoryId === (categoryId ?? '')));
  };

  const render = value => {
    if (disposed) return;
    const previous = result;
    result = value;
    const catalog = value?.catalog;
    if (!catalog) {
      node('gallery-source').textContent = '目录暂不可用';
      node('gallery-status').textContent = '公开目录读取失败，已有快照会保留。';
      return;
    }
    // Compare displayed snapshots; provider change metadata can be replayed
    // by peek/load and must not repeatedly invalidate the same revision.
    const changed = diffGalleryCatalog(previous?.catalog, catalog);
    const sourceChanged = previous?.source && previous.source !== value.source;
    const removed = new Set(changed?.removed ?? []);
    const requirementChanges = new Set(changed?.requirements ?? []);
    const selectedStillExists = selectedSetId != null && catalog.categories.some(category =>
      category.sets.some(set => set.id === selectedSetId));
    const selectedRemoved = selectedSetId != null && !selectedStillExists;
    for (const id of [...removed, ...requirementChanges]) {
      details.delete(id);
      if (requirementChanges.has(id)) invalidated.add(id);
      else invalidated.delete(id);
      if (removed.has(id)) jointTargets.delete(id);
    }
    if (sourceChanged || selectedRemoved) {
      disposeNativeCards();
      if (sourceChanged) { details.clear(); invalidated.clear(); }
      if (sourceChanged) jointTargets.clear();
      selection++; selectedSetId = null;
      node('gallery-set-detail').replaceChildren(); node('gallery-set-detail').hidden = true; node('gallery-sets').hidden = false;
    }
    if (!catalog.categories.some(row => row.id === categoryId)) categoryId = null;
    if (changed.tagsChanged || changed.requirements.length || changed.rewards.length || changed.removed.length
        || changed.renamed.length || sourceChanged) invalidateJoint();
    renderJoint();
    node('gallery-source').textContent = value.source === 'futgg' ? 'FUT.GG' : 'Fodder · 回退目录';
    const sets = catalog.categories.reduce((sum, row) => sum + row.sets.length, 0);
    const notice = value.reason === 'FC27_GALLERY_CATALOG_REFRESH_FAILED' ? '更新未成功，保留旧目录；' : value.stale ? '缓存待更新；' : '';
    node('gallery-status').textContent = `${catalog.categories.length} 类 · ${sets} 个集合 · ${notice}核验 ${date(value.fetchedAt)}`;
    const sourceErrors = value.sourceErrors ?? {};
    const futggError = sourceErrors.futgg;
    const sourceErrorNote = node('gallery-source-error');
    if (sourceErrorNote) sourceErrorNote.textContent = value.source === 'fodder' && futggError
      ? `FUT.GG 未连接（${futggError}），当前使用 Fodder 回退目录；点击“更新集合目录”可在退避结束后重试。` : '';
    const note = node('gallery-progress-note');
    note.textContent = typeof loadSet === 'function' ? '选择集合后读取该集合卡池和账号收集状态；未读取的集合不会触发 EA 查询。' : '账号收集进度尚未接入。';
    const buttons = node('gallery-categories'); buttons.replaceChildren();
    for (const row of [{ id: '', slug: '', name: '全部', sets: { length: sets } }, ...catalog.categories]) {
      const button = add(buttons, 'button');
      const icons = assets?.category?.(row.slug, row.name) ?? [];
      for (const src of (Array.isArray(icons) ? icons : [icons]).slice(0, 3)) image(button, src, row.name, 'gallery-category-icon');
      add(button, 'span', `${row.name} (${row.sets.length})`);
      button.type = 'button'; button.dataset.categoryId = row.id;
      button.addEventListener('click', () => { categoryId = row.id || null; renderSets(); });
    }
    renderSets();
    // A catalog refresh can finish while a user is reading a set. Invalidate
    // only the selected set when its actual requirements changed. The force
    // flag reaches the pool provider so an old card pool cannot be paired with
    // the new rules; unrelated changes keep their existing detail/read intact.
    if (!sourceChanged && !selectedRemoved && selectedSetId != null && requirementChanges.has(selectedSetId)) {
      const selected = catalog.categories.flatMap(category => category.sets).find(set => set.id === selectedSetId);
      if (selected) {
        details.delete(selected.id);
        void loadSetDetails(selected, { force: true });
      }
    } else if (!jointMode && selectedSetId != null && details.has(selectedSetId)) {
      const selected = catalog.categories.flatMap(category => category.sets).find(set => set.id === selectedSetId);
      if (selected) renderSetDetail(details.get(selectedSetId), selected);
    }
  };

  const load = force => {
    if (!provider || pending) return pending;
    node('gallery-refresh').disabled = true;
    pending = (async () => {
      const cached = await provider.peek(); if (cached) render(cached);
      node('gallery-status').textContent = cached ? `${node('gallery-status').textContent} · 检查更新中…` : '正在读取公开集合目录…';
      render(force ? await provider.refresh() : await provider.load());
    })().catch(() => { node('gallery-status').textContent = '公开目录读取失败；已有目录会保留，请稍后更新。'; })
      .finally(() => { pending = null; node('gallery-refresh').disabled = !provider; });
    return pending;
  };
  const check = () => { checkScope(); if (active && visible()) void load(false); };
  const setActive = value => {
    active = value && !disposed;
    if (!active) disposeNativeCards();
    if (timer !== null) timers?.clearInterval(timer);
    if (scopeTimer !== null) timers?.clearInterval(scopeTimer);
    timer = null;
    scopeTimer = null;
    if (active && provider) {
      if (!jointMode && selectedSetId != null && details.has(selectedSetId)) {
        const set = result?.catalog?.categories.flatMap(category => category.sets).find(row => row.id === selectedSetId);
        if (set) renderSetDetail(details.get(selectedSetId), set);
      }
      check(); timer = timers?.setInterval(check, GALLERY_TTL_MS) ?? null;
      if (loadSet) scopeTimer = timers?.setInterval(checkScope, 1000) ?? null;
    }
  };
  node('gallery-refresh').disabled = !provider;
  node('gallery-refresh').addEventListener('click', () => { if (provider && active) void load(true); });
  document.addEventListener('visibilitychange', check);
  if (!provider) node('gallery-status').textContent = '此检查入口未接入公开目录，请使用 FC Automation Tool 正式脚本。';
  return Object.freeze({ setActive, dispose: () => { disposed = true; selection++; setActive(false); document.removeEventListener('visibilitychange', check); } });
}
