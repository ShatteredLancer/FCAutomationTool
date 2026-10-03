import { GALLERY_TTL_MS } from './fc27-gallery-catalog.js';
import { diffGalleryCatalog } from '../../gallery/catalog.js';
import { createGalleryScoreQueue } from '../../gallery/score-queue.js';
import { planGalleryGrade, planGalleryGradeSteps } from '../../gallery/planner.js';
import { planGalleryJointSteps } from '../../gallery/joint-planner.js';
import { runGalleryPlan } from '../../gallery/cooperative-plan.js';
import { reconcileGalleryTargets } from '../../gallery/targets.js';
import { browseGallerySets } from '../../gallery/browse.js';
import { filterGalleryCards, paginateGalleryCards, reconcileGallerySelection, selectCheapestGalleryCards, summarizeGallerySelection } from '../../gallery/selection.js';
import { previewGallerySelectionSteps, planGalleryGradeOverviewSteps } from '../../gallery/preview.js';
import { benchmarkGalleryPlans, planGallerySequentialSteps } from '../../gallery/benchmark.js';
import { planGalleryRemainderSteps, isGalleryPurchaseReplanSafe, replanableGalleryFailures } from '../../gallery/replan.js';
import { isGalleryOwned } from '../../gallery/planner.js';
import { galleryFirstOwnerHistoryAction } from '../../gallery/first-owner-history.js';

// Enhancer exe/gPt chooses one image for a set; YPt/mPt is the separate
// multi-image category presentation. The caller retains the selected image.
export function selectGallerySetIcon(candidates, random = Math.random) {
  const images = candidates.filter(value => typeof value === 'string' && value.startsWith('https://'));
  return images.length ? images[Math.floor(random() * images.length)] : null;
}

// Enhancer JAe/yPt: each segment spans the previous threshold to this one.
// Known progress is useful even before a full lineup exists. An uncertain
// interval is projected using its known lower score, never the upper estimate.
export function galleryGradeSegments(grades, summary) {
  const score = Number.isFinite(summary?.low?.total) ? summary.low.total : null;
  return grades.map((grade, index) => {
    const previous = grades[index - 1]?.threshold ?? 0;
    const reached = score !== null && score >= grade.threshold;
    return { grade, reached, current: reached && !(score >= grades[index + 1]?.threshold),
      fraction: score === null ? 0 : grade.threshold > previous
        ? Math.max(0, Math.min(1, (score - previous) / (grade.threshold - previous))) : 1 };
  });
}

export function sameGalleryRuntimeCards(left, right) {
  if (left === right) return true;
  if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
  for (const [id, card] of left) if (!right.has(id) || right.get(id) !== card) return false;
  return true;
}

export function galleryPlanningStateKey(detail) {
  const progress = detail?.progress;
  const fields = ['eaId', 'playerEaId', 'collected', 'inClub', 'held', 'gradingScore', 'galleryScore',
    'firstOwned', 'holographic', 'overall', 'nationEaId', 'clubEaId', 'leagueEaId', 'rarityEaId',
    'positions', 'weakFoot', 'skillMoves'];
  const expired = detail?.priceSnapshot?.expiresAt != null && Date.now() >= detail.priceSnapshot.expiresAt;
  const quotes = detail?.priceSnapshot ? expired ? {} : detail.priceSnapshot.freshPrices : detail?.prices;
  return JSON.stringify([detail?.status, detail?.scope, detail?.stale === true, detail?.poolStale === true,
    detail?.pool?.revision, progress?.complete !== false, progress?.candidateOnly === true, progress?.poolComplete !== false,
    (progress?.rows ?? []).map(row => fields.map(key => row[key] ?? null)).sort((a, b) => a[0] - b[0]),
    (progress?.rows ?? []).map(row => [row.eaId, quotes?.[row.eaId] ?? null]).sort((a, b) => a[0] - b[0])]);
}

// Gallery presentation. All mutations use the injected, account-scoped buyer.
export function mountFc27GalleryView({ document, shadow, host, provider, loadSet = null, loadPrices = null, accountScope = () => null,
  assets = null, prices = null, marketCompare = null, diagnosticLog = null, nativeRenderer = null, gradePlanner = planGalleryGrade, targetStore = null, sync = null, purchase = null, setFirstOwner = null,
  planStore = null,
  timers = document.defaultView,
  visible = () => host.isConnected && host.getClientRects().length > 0 && document.visibilityState !== 'hidden' }) {
  const node = id => shadow.getElementById(id);
  const add = (parent, tag, value = '', className = '') => {
    const child = document.createElement(tag); child.textContent = value; child.className = className; parent.append(child); return child;
  };
  const diag = input => {
    try { return Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', ...input })).catch(() => false); }
    catch { return Promise.resolve(false); }
  };
  let buying = false, purchaseSummary = null;
  let purchaseReplan = null;
  const refreshPurchases = async () => {
    if (typeof purchase?.inspect !== 'function' || buying) return;
    const identity = scope();
    try {
      const value = await purchase.inspect();
      if (disposed || !active || identity !== scope()) return;
      purchaseSummary = value;
      node('gallery-purchase-resume').hidden = value.status !== 'observed'
        || !(value.recovery || value.remaining > 0 || value.collection?.status === 'pending');
    } catch { /* Optional presentation; execute validates the journal again. */ }
  };
  const runPurchase = async input => {
    if (buying || typeof purchase !== 'function' || checkScope() === false) return;
    const identity = scope(); buying = true;
    const dialog = node('gallery-purchase-dialog'), output = node('gallery-purchase-message');
    node('gallery-purchase-close').hidden = true; node('gallery-purchase-stop').hidden = false;
    node('gallery-purchase-stop').disabled = false;
    node('gallery-purchase-progress').value = 0; output.textContent = '正在核对购买清单…';
    node('gallery-purchase-results')?.replaceChildren(); dialog.showModal();
    const phases = { search: '查价', buying: '买入', bought: '已买入', moving: '入库', completed: '已入库',
      'already-collected': '已收集，跳过', failed: '未买到，继续其余卡', progress: '处理中' };
    try {
      const outcome = await purchase({ ...input, approved: true,
        isCurrent: () => !disposed && active && identity === scope(),
        onProgress: progress => {
          node('gallery-purchase-progress').max = progress.total || 1;
          node('gallery-purchase-progress').value = progress.completed;
          output.textContent = `${phases[progress.phase] ?? '处理中'} ${progress.index}/${progress.total} · 已购买 ${progress.purchased} 张 · ${count(progress.spent)} 金币`;
        } });
      if (disposed || !active || identity !== scope()) return;
      output.textContent = `${outcome.status === 'purchased' ? '购买完成' : '购买未完成'} · 已购买 ${outcome.purchased ?? 0} 张 · ${count(outcome.spent ?? 0)} 金币`;
      if (outcome.status !== 'purchased') output.textContent += ` · ${outcome.reason ?? outcome.status}`;
      output.textContent += ' · 出售计划：买入后默认进入 Club 并保留，不自动挂牌；挂牌/重挂需单独确认。';
      if (outcome.collection?.status === 'pending') output.textContent += ' · 收集待确认；再次核对不会重复买入';
      if (outcome.failures?.length) output.textContent += ` · ${outcome.failures.length} 张未完成，可续购`;
      const resultList = node('gallery-purchase-results');
      if (resultList) {
        resultList.replaceChildren();
        for (const item of outcome.results ?? []) {
          const state = ({ waiting: '待处理', 'buy-pending': '成交核对中', bought: '已买入，待入库', 'move-pending': '入库中',
            'move-rejected': '入库失败', club: '已入库', collected: '已确认收集' })[item.state] ?? item.reason ?? item.state;
          add(resultList, 'li', `${item.name || item.definitionId} · ${state}${item.price == null ? '' : ` · ${count(item.price)} 金币`}`);
        }
      }
      purchaseReplan = null;
      if (isGalleryPurchaseReplanSafe(outcome) && outcome.status !== 'purchased' && input.replanContext?.targets?.length) {
        const remaining = replanableGalleryFailures(outcome);
        if (remaining.length) {
          purchaseReplan = { ...input.replanContext, outcome };
          const acquired = (outcome.results ?? []).filter(item => ['club', 'collected'].includes(item.state)).length;
          const replan = add(resultList ?? dialog, 'li', `已确认 ${acquired} 张；剩余 ${remaining.length} 张可重新计算方案`, 'gallery-replan-ready');
          const replanButton = add(replan, 'button', '重新规划剩余目标'); replanButton.type = 'button';
          replanButton.addEventListener('click', event => { if (event.isTrusted && !buying) { node('gallery-purchase-close').click(); renderPurchaseReplan(purchaseReplan); } });
        }
      }
    } catch { output.textContent = '购买结果待核对，记录已保留，请勿重复下单。'; }
    finally {
      buying = false; node('gallery-purchase-stop').hidden = true; node('gallery-purchase-close').hidden = false;
      void refreshPurchases();
    }
  };
  const renderPurchaseReplan = input => {
    const target = node(input?.mode === 'joint' ? 'gallery-joint-output' : 'gallery-set-detail');
    if (!target || !input?.targets?.length || !input.outcome) return;
    const message = input.mode === 'joint' ? target
      : target.querySelector('.gallery-plan-output') ?? add(target, 'div', '', 'gallery-plan-output');
    message.replaceChildren();
    message.textContent = '正在根据已确认收集和剩余预算重新规划…';
    const identity = scope(), token = ++planningEpoch;
    const catalogAtStart = result?.catalog, setAtStart = selectedSetId, jointAtStart = jointMode;
    const current = () => !disposed && active && identity === scope() && token === planningEpoch
      && message.isConnected && result?.catalog === catalogAtStart && selectedSetId === setAtStart && jointMode === jointAtStart;
    const steps = planGalleryRemainderSteps({ targets: input.targets, outcome: input.outcome,
      ledger: input.ledger, budget: input.budget, mode: input.mode ?? (input.targets.length === 1 ? 'single' : 'joint') });
    void runGalleryPlan(steps, {
      current,
      progress: state => { message.textContent = `正在重算… ${state.evaluations} 个候选`; },
    }).then(plan => {
      if (!plan || !current()) return;
      message.replaceChildren();
      if (plan.status === 'ready') {
        add(message, 'small', '原购买结果已保留；以下仅是新的本地替代方案，需要再次点击购买。', 'gallery-unknown');
        for (const candidate of plan.plans) {
          const detail = add(message, 'details'); add(detail, 'summary', `${candidate.items.length} 张 · ${candidate.totalPrice == null ? '报价未知' : `${count(candidate.totalPrice)} 🪙`}${candidate.score == null ? '' : ` · 最终 ${count(candidate.score)} 分`}`);
          const list = add(detail, 'ul');
          for (const item of candidate.items) add(list, 'li', `${item.name ?? item.eaId} · ${item.version ?? '版本未知'} · ${item.price == null ? '价格未知' : `${count(item.price)} 金币`}`);
          const executionBudget = plan.remainingBudget ?? input.budget;
          purchaseButton(detail, candidate.items, `${input.binding ?? 'gallery'}:replan:${candidate.items.map(item => item.eaId).join(',')}`, {
            budget: executionBudget, label: '购买替代方案',
            replanContext: { targets: plan.targets, ledger: plan.ledger, budget: input.budget, mode: input.mode },
            valid: () => current() && !buying });
        }
      } else if (plan.status === 'achieved') add(message, 'small', '当前目标已达到，无需继续购买。');
      else add(message, 'small', `剩余目标暂不可规划：${plan.reason ?? plan.status}`, 'gallery-unknown');
    }).catch(() => { if (current()) message.textContent = '剩余目标重规划失败，原 Journal 保留。'; });
  };
  const purchaseButton = (parent, items, binding, { budget = null, label = '批量购买', valid = () => true,
    progress = null, targetGrade = null, replanContext = null } = {}) => {
    if (typeof purchase !== 'function' || !items.length) return null;
    const button = add(parent, 'button', label, 'primary gallery-purchase'); button.type = 'button';
    const identity = scope();
    button.addEventListener('click', event => {
      if (!event.isTrusted || buying || identity !== scope() || !valid()) return;
      void runPurchase({ items, binding, budget, progress, targetGrade,
        replanContext: replanContext ? structuredClone(replanContext) : null });
    });
    return button;
  };
  node('gallery-purchase-stop').addEventListener('click', event => {
    if (event.isTrusted && buying) { purchase?.stop?.(); node('gallery-purchase-stop').disabled = true;
      node('gallery-purchase-message').textContent = '当前成交核对完成后停止…'; }
  });
  node('gallery-purchase-close').addEventListener('click', () => { if (!buying) node('gallery-purchase-dialog').close(); });
  node('gallery-purchase-dialog').addEventListener('cancel', event => { if (buying) event.preventDefault(); });
  node('gallery-purchase-resume').addEventListener('click', event => {
    if (event.isTrusted && purchaseSummary?.status === 'observed') void runPurchase({ resume: true, expectedOperationId: purchaseSummary.operationId });
  });
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
      // A native EA view may have returned its wrapper before reporting a
      // missing Hero/Holographics asset.  Remove that wrapper explicitly so a
      // failed native card cannot remain as a blank white panel beside the
      // text fallback.
      try { native?.__fcatDealloc?.(); } catch { /* UI cleanup only. */ }
      try { native?.remove?.(); } catch { /* UI cleanup only. */ }
      const text = renderTextCard(parent, row);
      parent.insertBefore(text, parent.querySelector('.gallery-card-select'));
    };
    try {
      // Slotted light-DOM children inherit EA's global card styles. Do not
      // copy stylesheets or rebuild a portrait/card shell inside our shadow.
      native = nativeRenderer?.render?.({ parent: host, raw: runtimeCards?.get?.(row.eaId), slot: slot.name,
        label: `${row.name} ${row.version ?? ''}`, onUnavailable: fallback });
      if (native) { nativeCards.add(native); return; }
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
  const needsPriceRefresh = detail => !detail?.priceSnapshot || priceExpired(detail)
    || detail.priceSnapshot.expiresAt == null && !Object.keys(detail.priceSnapshot.freshPrices ?? {}).length;
  const statusIcon = (parent, value, label) => {
    const icon = add(parent, 'span', value === true ? '✓' : value === false ? '○' : '?', `gallery-status-icon ${value === true ? 'is-yes' : value === false ? 'is-no' : 'is-unknown'}`);
    icon.title = label; icon.setAttribute('aria-label', label); return icon;
  };
  const gradeTrack = (parent, grades, summary = null) => {
    const state = summary?.status ?? '';
    const track = add(parent, 'div', '', `gallery-grade-track ${state}`); track.setAttribute('role', 'list');
    for (const { grade, reached, current, fraction } of galleryGradeSegments(grades, summary)) {
      const cell = add(track, 'span', '', 'gallery-grade-cell'); cell.setAttribute('role', 'listitem');
      const bar = add(cell, 'span', '', 'gallery-grade-bar'); const fill = add(bar, 'i'); fill.style.width = `${Math.round(fraction * 100)}%`;
      const diamond = add(cell, 'span', '', `gallery-grade-diamond grade-${String(grade.name).toLowerCase()} ${reached ? 'is-reached' : ''} ${current ? 'is-current' : ''}`);
      add(diamond, 'span', grade.name, 'gallery-grade-letter');
      diamond.title = `${grade.name} · ${count(grade.threshold)} 分 · ${grade.rewards.map(reward => reward.label).join('、') || '无奖励'}${grade.rewardsComplete ? '' : ' · 未提供非代币奖励'}`;
      diamond.setAttribute('aria-label', `${grade.name} 档，${count(grade.threshold)} 分${reached ? '，已达到' : ''}`);
      add(cell, 'small', count(grade.threshold), 'gallery-grade-threshold');
    }
    return track;
  };
  const date = value => Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : '未知';
  const count = value => Number.isFinite(value) ? value.toLocaleString() : '未知';
  const state = value => value === true ? '是' : value === false ? '否' : '未知';
  // Enhancer presents one compact reward summary on category and set cards.
  // Keep the aggregation local to the public catalogue; reward receipts and
  // EA claim state never enter this projection.
  const summarizeRewards = sets => {
    const byType = new Map();
    for (const set of sets ?? []) for (const grade of set.grades ?? []) for (const reward of grade.rewards ?? []) {
      const type = String(reward.type ?? 'unknown');
      const previous = byType.get(type) ?? { type, value: 0 };
      previous.value += Number.isSafeInteger(reward.value) ? reward.value : 0;
      byType.set(type, previous);
    }
    return [...byType.values()].filter(row => row.value > 0);
  };
  const renderRewardSummary = (parent, sets, className = 'gallery-reward-summary') => {
    // Enhancer QAe only renders types resolved to an EA EventToken icon.
    // Public FUT.GG item rewards carry asset IDs in value, not quantities;
    // they remain available in grade details, never in the currency summary.
    const rewards = summarizeRewards(sets).map(reward => ({ ...reward, icon: asset('reward', reward.type) }))
      .filter(reward => reward.icon);
    if (!rewards.length) return null;
    const summary = add(parent, 'span', '', className);
    summary.setAttribute('aria-label', '奖励汇总');
    for (const reward of rewards) {
      const item = add(summary, 'span', '', 'gallery-reward-token');
      item.dataset.rewardType = reward.type;
      image(item, reward.icon, reward.type, 'gallery-reward-token-icon');
      add(item, 'span', count(reward.value), 'gallery-reward-token-value');
      item.title = `${reward.type} ${count(reward.value)}`;
      item.setAttribute('aria-label', item.title);
    }
    return summary;
  };
  let scoreRenderTimer = null;
  const scoredSets = new Set();
  const scoreQueue = createGalleryScoreQueue({ onUpdate: setId => {
    scoredSets.add(setId);
    if (disposed || !active || scoreRenderTimer !== null) return;
    scoreRenderTimer = setTimeout(() => {
      scoreRenderTimer = null;
      if (disposed || !active) return;
      const changed = new Set(scoredSets); scoredSets.clear();
      const sets = result?.catalog?.categories.flatMap(category => category.sets) ?? [];
      for (const card of node('gallery-set-list').querySelectorAll('.gallery-set')) {
        if (!changed.has(card.dataset.setId)) continue;
        const set = sets.find(row => row.id === card.dataset.setId), detail = details.get(set?.id);
        const summary = set && scoreSummary(detail, set);
        const label = card.querySelector('.gallery-summary'), grades = card.querySelector('.gallery-grades');
        if (!summary || !label || !grades) continue;
        label.textContent = compactScore(summary); label.title = `Base score · ${scoreText(summary)}`;
        label.setAttribute('aria-label', `Base score ${scoreText(summary)}`);
        grades.replaceChildren(); gradeTrack(grades, set.grades, summary);
      }
      if ([...changed].some(id => jointTargets.has(id))) renderJoint();
      if (changed.has(selectedSetId) && !activePlans && !foregroundSync && !jointMode && selectedSetId && details.has(selectedSetId)) {
        const set = result?.catalog?.categories.flatMap(category => category.sets).find(row => row.id === selectedSetId);
        const value = details.get(selectedSetId), summary = set && scoreSummary(value, set);
        const target = node('gallery-set-detail'), section = target.querySelector('.gallery-score');
        if (section && summary) {
          const fragment = document.createDocumentFragment(); renderScoring(fragment, summary, value); section.replaceWith(fragment);
          const track = target.querySelector('.gallery-overview .gallery-grade-track');
          if (track) { const next = document.createDocumentFragment(); gradeTrack(next, set.grades, summary); track.replaceWith(next); }
          const select = target.querySelector('.gallery-plan select');
          if (select && !select.dataset.edited && summary.nextGrade) select.value = summary.nextGrade;
          const ids = new Set(summary.lineup?.map(row => String(row.eaId)) ?? []);
          for (const card of target.querySelectorAll('.gallery-card')) {
            card.querySelector('.gallery-score-member')?.remove();
            if (ids.has(card.dataset.definitionId)) add(card.querySelector('.gallery-player-meta'), 'span', '计分阵容成员', 'badge gallery-score-member');
          }
        }
      }
    }, 100);
  } });
  const scoreSummary = (value, set) => {
    if (!active || !value?.progress || !result?.catalog) return null;
    return scoreQueue.read(scope(), { set, catalog: result.catalog, progress: value.progress });
  };
  const scoreText = summary => {
    if (summary?.status === 'calculating') return '计分中…';
    if (!summary || summary.status === 'unavailable') return '计分规则待核实';
    if (!summary.low || summary.status === 'partial') return '计分数据未完整同步';
    const points = summary.low.total === summary.high.total ? count(summary.low.total) : `${count(summary.low.total)}–${count(summary.high.total)}`;
    if (!summary.full) return `${points} 分 · 还缺 ${summary.missingCards} 张计分卡，暂不计等级`;
    if (summary.status === 'uncertain') return `${points} 分 · 等级待核实`;
    return `${points} 分 · 计算等级 ${summary.grade ?? '未达 D'}`;
  };
  const compactScore = summary => !summary?.low ? summary?.status === 'calculating' ? '计分中…' : '计分待同步'
    : `${count(summary.low.total)}${summary.low.total !== summary.high?.total ? `–${count(summary.high?.total)}` : ''} 分`;
  const renderScoring = (target, summary, value) => {
    const section = add(target, 'section', '', 'gallery-score');
    add(section, 'strong', `${value.stale || value.poolStale || result?.stale ? '快照' : '当前'}计分：${scoreText(summary)}`);
    if (!summary?.low) {
      if (summary?.status === 'calculating') { add(section, 'small', '正在后台计算，可继续浏览或切换页面。'); return; }
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
    select.addEventListener('change', () => { select.dataset.edited = 'true'; });
    row.append(select);
    const button = add(row, 'button', '生成方案'); button.type = 'button';
    const overviewButton = add(row, 'button', '各档费用'); overviewButton.type = 'button';
    const jointAdd = add(row, 'button', '+', 'gallery-joint-add'); jointAdd.type = 'button';
    jointAdd.title = '加入联合目标'; jointAdd.setAttribute('aria-label', '加入联合目标');
    jointAdd.disabled = restoringTargets || value.status !== 'observed' || value.stale === true || value.poolStale === true;
    jointAdd.addEventListener('click', event => {
      if (!event.isTrusted) return;
      if (restoringTargets) return;
      if (checkScope() === false) return;
      jointTargets.set(set.id, select.value); invalidateJoint(); renderJoint(); renderSets(); persistTargets();
      jointAdd.title = '已加入联合目标';
    });
    const output = add(section, 'div', '', 'gallery-plan-output'); output.setAttribute('aria-live', 'polite');
    const overview = add(section, 'div', '', 'gallery-grade-overview'); overview.setAttribute('aria-live', 'polite');
    const overviewKey = JSON.stringify([scope(), set, result.catalog.tags, value.progress, planningPrices(value)]);
    const showOverview = plan => {
      overview.replaceChildren();
      if (!plan) return;
      for (const item of plan.grades ?? []) {
        // If the user already generated this exact grade, reuse that result
        // instead of showing a second bounded search with a different winner.
        const saved = planCache.get(set.id)?.plan;
        const candidate = saved?.status === 'ready' && saved.targetGrade === item.grade
          ? saved.plans?.[0] ?? item.candidate : item.candidate;
        const line = add(overview, 'div', '', 'gallery-grade-overview-row');
        add(line, 'strong', `${item.grade} · ${count(item.threshold)} 分`);
        add(line, 'span', item.status === 'achieved' ? '已达到 · 0 金币'
          : candidate?.totalPrice == null ? item.status === 'ready' ? '报价未知' : (item.reason ?? '暂不可达') : `${count(candidate.totalPrice)} 金币`);
        if (candidate?.score != null) add(line, 'small', `${count(candidate.score)} 分 · ${candidate.items?.length ?? 0} 张补卡`);
      }
    };
    const show = plan => {
      output.replaceChildren();
      if (!plan || plan.status === 'unavailable') { add(output, 'small', `暂不可规划：${plan?.reason ?? '输入不完整'}`, 'gallery-unknown'); return; }
      if (plan.status === 'achieved') { add(output, 'small', `当前已达到 ${plan.targetGrade} 档，无需补卡。`); return; }
      const reasons = { 'search-time-exhausted': '计算时间预算已用完，尚不能确认无解；可降低目标等级再试', 'search-budget-exhausted': '搜索预算耗尽，尚不能确认无解',
        'candidate-search-truncated': '候选范围未完整搜索，尚不能确认无解',
        'beam-search-truncated': '有界搜索未找到方案，尚不能确认无解',
        'score-selection-bounded': '计分选队使用有界搜索，尚不能确认无解',
        'score-conditions-unknown': '部分计分属性待核实', 'collection-status-unknown': '收集状态待核实',
        'existing-score-unknown': '已收集卡的 EA 基础分待核实', 'target-unreachable': '当前材料达不到目标' };
      if (plan.status !== 'ready') { add(output, 'small', reasons[plan.reason] ?? '暂未找到可行方案', 'gallery-unknown'); return; }
      add(output, 'small', `找到 ${plan.plans.length} 个候选方案；只读结果，不代表 EA 已确认等级。`);
      if (!plan.searchComplete) add(output, 'small', '有界候选方案，不保证最低总价。', 'gallery-unknown');
      if (plan.costAudit) add(output, 'small', `按单卡价格选取的完整组合为 ${count(plan.costAudit.totalPrice)} 金币、${count(plan.costAudit.score)} 分（目标 ${count(plan.costAudit.target)}）。`, 'gallery-unknown');
      for (const [index, candidate] of plan.plans.entries()) {
        const details = add(output, 'details');
        const scoreNote = candidate.currentScore != null
          ? `当前 ${count(candidate.currentScore)} + 新增 ${count(candidate.addedScore ?? 0)} = ${count(candidate.score)} 分`
          : `${count(candidate.score)} 分`;
        add(details, 'summary', `方案 ${index + 1} · ${candidate.items.length} 张 · ${candidate.totalPrice == null ? '报价未知' : `${count(candidate.totalPrice)} 🪙`} · ${scoreNote}`);
        const list = add(details, 'ul');
        for (const item of candidate.items) add(list, 'li', `${item.name ?? item.eaId} · ${item.version ?? '版本未知'} · ${item.price == null ? '价格未知' : `${count(item.price)} 🪙`}${item.scoreSource === 'catalog' ? ' · 公开估分' : ''}`);
        if (candidate.missingPriceIds.length) add(details, 'small', `${candidate.missingPriceIds.length} 张卡缺少报价，执行前必须重新查价。`, 'gallery-unknown');
        if (candidate.unknownFields?.length) add(details, 'small', '部分计分属性未知，方案按已知贡献计算。', 'gallery-unknown');
        const planIsCurrent = !planCache.get(set.id)?.stale && planCache.get(set.id)?.binding === planBinding(value, set);
        purchaseButton(details, candidate.items, `set:${set.id}:${value.pool?.revision}:${candidate.items.map(item => item.eaId).join(',')}`,
          { progress: value.progress, targetGrade: candidate.targetGrade,
            replanContext: { targets: [{ set, catalog: result.catalog, progress: value.progress,
              prices: planningPrices(value), targetGrade: candidate.targetGrade, scope: currentScope }],
              mode: 'single', ledger: { receipts: [], excludedIds: [], quotes: {} }, budget: null },
            valid: () => planIsCurrent && value.status === 'observed' && !value.stale && !value.poolStale && thisDetailCurrent(value, set.id) });
      }
    };
    const saved = planCache.get(set.id);
    if (saved?.plan) {
      show(saved.plan);
      if (saved.binding !== planBinding(value, set))
        add(output, 'small', '集合数据或报价已更新，以下保留上次方案；请重新生成以确认金额。', 'gallery-unknown');
    }
    if (saved?.overview) {
      showOverview(saved.overview);
      if (saved.overviewBinding !== planBinding(value, set)) add(overview, 'small', '数据或报价已更新，保留上次各档费用；请重新计算。', 'gallery-unknown');
    }
    button.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      button.disabled = true; output.replaceChildren(); add(output, 'small', '正在计算…');
      const token = ++planningEpoch, identity = scope(), revision = result, binding = planBinding(value, set);
      activePlans++;
      const current = () => !disposed && active && token === planningEpoch && identity === scope()
        && revision === result && output.isConnected && selectedSetId === set.id && !jointMode;
      const cancel = add(row, 'button', '取消'); cancel.type = 'button';
      cancel.addEventListener('click', () => { planningEpoch++; output.replaceChildren(); add(output, 'small', '计算已取消'); });
      try {
      const input = { set, catalog: result.catalog, progress: value.progress, prices: planningPrices(value), targetGrade: select.value };
        const plan = gradePlanner === planGalleryGrade
          ? await runGalleryPlan(planGalleryGradeSteps(input), { current,
            progress: value => { output.textContent = `正在计算… ${value.evaluations} 个候选`; } })
          : await gradePlanner(input);
        if (plan) void diag({ event: 'grade-plan', phase: 'planner',
          replayInput: input,
          status: plan.status === 'ready' || plan.status === 'achieved' ? 'success' : 'blocked',
          reason: /^[a-z]+(?:-[a-z]+)*$/.test(plan.reason ?? '') ? `FC27_GALLERY_${plan.reason.replaceAll('-', '_').toUpperCase()}` : undefined,
          count: plan.candidateCount, requestedCount: plan.requestedCandidates,
          quotedCount: plan.quotedCandidateCount, eaScoreCount: plan.scoreSourceCounts?.ea,
          catalogScoreCount: plan.scoreSourceCounts?.catalog, targetScore: plan.threshold,
          currentScore: plan.currentScore, evaluations: plan.evaluations,
          searchComplete: plan.searchComplete === true, scopeTruncated: plan.scopeTruncated === true,
          beamTruncated: plan.beamTruncated === true, budgetExhausted: plan.budgetExhausted === true,
          timeExhausted: plan.timeExhausted === true, expandedCount: plan.omittedCandidates,
          cheapestPrice: plan.costAudit?.totalPrice, cheapestScore: plan.costAudit?.score,
          bestPrice: plan.plans?.[0]?.totalPrice, bestScore: plan.plans?.[0]?.score,
        });
        if (plan && current()) {
          savePlanCache(set, value, { binding, plan });
          show(plan);
          if (planCache.get(set.id)?.overview) showOverview(planCache.get(set.id).overview);
        }
      } catch { void diag({ event: 'grade-plan', phase: 'planner', status: 'failed', reason: 'FC27_GALLERY_GRADE_PLANNER_FAILED' }); if (current()) show({ status: 'unavailable', reason: 'planner-failed' }); }
      finally { activePlans = Math.max(0, activePlans - 1); button.disabled = false; cancel.remove(); }
    });
    overviewButton.addEventListener('click', async event => {
      if (!event.isTrusted || overviewButton.disabled) return;
      const cached = overviewCache.get(overviewKey);
      if (cached) { showOverview(cached); return; }
      overviewButton.disabled = true; overview.textContent = '正在计算各档费用…';
      const token = ++planningEpoch, identity = scope(), revision = result, binding = planBinding(value, set);
      activePlans++;
      try {
        const plan = await runGalleryPlan(planGalleryGradeOverviewSteps({ set, catalog: result.catalog, progress: value.progress, prices: planningPrices(value) }), {
          current: () => !disposed && active && token === planningEpoch && identity === scope() && revision === result && overview.isConnected,
          maxMs: 8000, progress: state => { overview.textContent = `正在计算各档费用… ${state.completed}/${state.total}`; },
        });
        if (plan && token === planningEpoch) {
          if (plan.status === 'observed' || plan.status === 'partial') {
            overviewCache.set(overviewKey, plan);
            savePlanCache(set, value, { overviewBinding: binding, overview: plan });
            while (overviewCache.size > 8) overviewCache.delete(overviewCache.keys().next().value);
          }
          showOverview(plan);
          if (plan.status === 'partial') add(overview, 'small', '费用计算未完成；已显示部分档位，可单独选择目标档位计算。', 'gallery-unknown');
        }
      } catch { if (token === planningEpoch) overview.textContent = '各档费用暂不可用'; }
      finally { activePlans = Math.max(0, activePlans - 1); overviewButton.disabled = false; }
    });
  };
  const setIconSelections = new Map();
  let categoryId = null, result = null, pending = null, timer = null, active = false;
  let selectedSetId = null, selection = 0, scopeTimer = null, filter = 'all', cardPage = 1, cardQuery = '', cardOrder = 'catalog';
  const selectedCards = new Map();
  let selectionSource = null;
  let selectionBudget = '';
  const updateFooterGeometry = () => {
    const footer = node('gallery-selection-footer');
    if (!footer || footer.hidden) return;
    const box = shadow.querySelector('.body')?.getBoundingClientRect();
    const viewport = document.defaultView?.innerWidth ?? 0;
    if (!box || box.width <= 0) return;
    const inset = Math.min(24, box.width * .04), left = Math.max(8, box.left + inset);
    footer.style.left = `${left}px`;
    footer.style.width = `${Math.max(0, Math.min(box.width - inset * 2, viewport - left - 8))}px`;
  };
  const selectionContext = () => {
    const rows = new Map(), prices = {}, confirmedMissing = new Set();
    for (const detail of details.values()) {
      const fresh = detail.status === 'observed' && detail.stale !== true && detail.poolStale !== true;
      for (const row of detail.progress?.rows ?? []) {
        const id = String(row.eaId), previous = rows.get(id);
        if (!previous || row.collected === true || fresh && previous.collected !== true) rows.set(id, row);
        if (fresh && !isGalleryOwned(row) && row.collected === false) confirmedMissing.add(id);
      }
      Object.assign(prices, planningPrices(detail) ?? {});
    }
    return { rows: [...rows.values()], prices, valid: [...selectedCards.keys()].every(id => confirmedMissing.has(id)) };
  };
  const showBrowseLevel = () => {
    const detail = selectedSetId !== null, category = categoryId !== null;
    node('gallery-summary').hidden = detail || category;
    node('gallery-sets').hidden = detail || !category;
    node('gallery-set-detail').hidden = !detail;
    const back = node('gallery-back');
    back.hidden = !detail && !category;
    back.setAttribute('aria-label', detail ? '返回集合' : '返回分类');
    back.title = detail ? '返回集合' : '返回分类';
    node('gallery-browse-title').textContent = detail
      ? result?.catalog?.categories.flatMap(row => row.sets).find(row => row.id === selectedSetId)?.name ?? ''
      : result?.catalog?.categories.find(row => row.id === categoryId)?.name ?? '';
    node('gallery-browse-nav').hidden = jointMode || !detail && !category;
    node('gallery-selection-footer').hidden = !active || !detail || jointMode;
    updateFooterGeometry();
  };
  const details = new Map();
  const overviewCache = new Map();
  // Planning output is independent from the DOM. A sync/render cycle may
  // replace the detail subtree, but it must not erase the user's last plan.
  const planCache = new Map();
  const planBinding = (value, set) => JSON.stringify([scope(), result?.source, set, result?.catalog?.tags, galleryPlanningStateKey(value)]);
  const savePlanCache = (set, value, patch) => {
    const current = planCache.get(set.id) ?? { binding: planBinding(value, set), overviewBinding: planBinding(value, set), plan: null, overview: null, stale: false };
    const next = { ...current, ...patch, binding: patch.binding ?? current.binding, stale: false };
    planCache.set(set.id, next);
    if (planStore && currentScope && result?.source) {
      const scopeAtStart = currentScope, source = result.source, record = { binding: next.binding, overviewBinding: next.overviewBinding, plan: next.plan, overview: next.overview };
      void Promise.resolve(planStore.save(scopeAtStart, source, set.id, record)).catch(() => {});
    }
    return next;
  };
  const restorePlanCache = async (set, value) => {
    if (!planStore || !currentScope || !result?.source) return;
    const scopeAtStart = currentScope, source = result.source, expected = planBinding(value, set);
    if (planCache.has(set.id)) return;
    try {
      const loaded = await planStore.load(scopeAtStart, source, set.id);
      if (disposed || scopeAtStart !== currentScope || source !== result?.source || selectedSetId !== set.id) return;
      if (loaded?.status === 'observed') {
        const record = loaded.record;
        planCache.set(set.id, { binding: record.binding, overviewBinding: record.overviewBinding, plan: record.plan, overview: record.overview, stale: record.binding !== expected });
      }
    } catch { /* A missing cache never blocks live collection reads. */ }
  };
  const thisDetailCurrent = (value, id) => details.get(id) === value && selectedSetId === id && !jointMode;
  const jointTargets = new Map();
  let jointMode = false;
  let targetsIdentity = null, targetsEpoch = 0, restoringTargets = false;
  let planningEpoch = 0;
  let activePlans = 0;
  let jointRun = null;
  let syncing = false, syncRefresh = null;
  let foregroundSync = null, resumeBackground = false;
  let autoSyncKey = null;
  const targetStatus = text => { node('gallery-target-status').textContent = text; };
  const targetValue = () => ({ targets: [...jointTargets].map(([setId, grade]) => ({ setId, grade })),
    budget: node('gallery-joint-budget').value.trim() ? Number(node('gallery-joint-budget').value) : null });
  const persistTargets = () => {
    if (!targetStore || restoringTargets || !currentScope || !result?.source) return;
    const scopeAtStart = currentScope, source = result.source, epoch = targetsEpoch;
    const value = targetValue();
    if (value.budget !== null && (!Number.isSafeInteger(value.budget) || value.budget < 0)) {
      targetStatus('请输入非负整数预算，当前输入未保存'); return;
    }
    targetStatus('正在保存目标…');
    void Promise.resolve().then(() => targetStore.save(scopeAtStart, source, value)).then(saved => {
      if (!disposed && epoch === targetsEpoch && scopeAtStart === currentScope && source === result?.source) {
        targetStatus(saved?.status === 'observed' ? '' : '目标保存失败，当前选择仍可使用');
      }
    }).catch(() => { if (!disposed && epoch === targetsEpoch) targetStatus('目标保存失败，当前选择仍可使用'); });
  };
  const reconcileTargets = () => {
    if (!result?.catalog || result.stale || result.cached === true || result.status !== 'observed' || restoringTargets) return;
    const before = targetValue(), after = reconcileGalleryTargets({ ...before, budget: null }, result.catalog);
    if (JSON.stringify(before.targets) === JSON.stringify(after.targets)) return;
    jointTargets.clear(); for (const row of after.targets) jointTargets.set(row.setId, row.grade);
    invalidateJoint(); persistTargets();
  };
  const restoreTargets = () => {
    if (!targetStore || !currentScope || !result?.source) return;
    const identity = JSON.stringify([currentScope, result.source]);
    if (targetsIdentity === identity) return;
    targetsIdentity = identity;
    const epoch = ++targetsEpoch, scopeAtStart = currentScope, source = result.source;
    restoringTargets = true; targetStatus('正在恢复目标…');
    node('gallery-joint-budget').disabled = true;
    void Promise.resolve().then(() => targetStore.load(scopeAtStart, source)).then(saved => {
      if (disposed || epoch !== targetsEpoch || scopeAtStart !== scope() || source !== result?.source) return;
      if (saved?.status === 'observed') {
        jointTargets.clear(); for (const row of saved.targets) jointTargets.set(row.setId, row.grade);
        node('gallery-joint-budget').value = saved.budget === null ? '' : String(saved.budget);
        targetStatus('');
      } else targetStatus('目标恢复失败，暂用当前页面选择');
    }).catch(() => { if (!disposed && epoch === targetsEpoch) targetStatus('目标恢复失败，暂用当前页面选择'); })
      .finally(() => {
        if (disposed || epoch !== targetsEpoch) return;
        if (checkScope() === false || source !== result?.source) return;
        restoringTargets = false; node('gallery-joint-budget').disabled = false;
        reconcileTargets(); renderJoint(); renderSets();
        if (!activePlans && !jointMode && selectedSetId && details.has(selectedSetId)) {
          const set = result?.catalog.categories.flatMap(category => category.sets).find(set => set.id === selectedSetId);
          if (set) renderSetDetail(details.get(selectedSetId), set);
        }
      });
  };
  const invalidateJoint = (message = '') => {
    planningEpoch++;
    const output = node('gallery-joint-output');
    const hadPlan = output.hasChildNodes();
    output.replaceChildren();
    if (message && hadPlan) add(output, 'small', message, 'gallery-unknown');
  };
  const renderJoint = () => {
    const container = node('gallery-joint-targets'); container.replaceChildren();
    node('gallery-joint-count').textContent = String(jointTargets.size);
    node('gallery-joint-plan').disabled = !jointTargets.size || restoringTargets || jointRun === planningEpoch;
    if (!jointTargets.size) { add(container, 'small', '尚无联合目标'); return; }
    const sets = result?.catalog?.categories.flatMap(category => category.sets) ?? [];
    for (const [id, grade] of jointTargets) {
      const set = sets.find(set => set.id === id);
      const row = add(container, 'div', '', 'gallery-joint-target'); row.dataset.setId = id;
      if (!set) {
        add(row, 'strong', id); add(row, 'small', '集合暂不在当前目录，目标保留待核实');
        const remove = add(row, 'button', '×'); remove.title = '移除目标'; remove.setAttribute('aria-label', `移除 ${id}`);
        remove.disabled = restoringTargets;
        remove.addEventListener('click', event => { if (!event.isTrusted || checkScope() === false) return; jointTargets.delete(id); invalidateJoint(); renderJoint(); renderSets(); persistTargets(); });
        continue;
      }
      add(row, 'strong', set.name);
      const select = document.createElement('select'); select.setAttribute('aria-label', `${set.name} 目标等级`);
      for (const grade of set.grades) { const option = document.createElement('option'); option.value = grade.name;
        option.textContent = `${grade.name} · ${count(grade.threshold)}`; select.append(option); }
      select.value = grade; select.disabled = restoringTargets; row.append(select);
      select.addEventListener('change', () => { if (restoringTargets || checkScope() === false) return; jointTargets.set(id, select.value); invalidateJoint(); persistTargets(); });
      const remove = add(row, 'button', '×'); remove.title = '移除目标'; remove.setAttribute('aria-label', `移除 ${set.name}`);
      remove.disabled = restoringTargets;
      remove.addEventListener('click', event => { if (!event.isTrusted || checkScope() === false) return; jointTargets.delete(id); invalidateJoint(); renderJoint(); renderSets(); persistTargets(); });
      const value = details.get(id);
      if (!value?.progress || value.status !== 'observed' || value.stale || value.poolStale) add(row, 'small', '集合状态待更新', 'gallery-unknown');
      else add(row, 'small', scoreText(scoreSummary(value, set)));
      if (typeof loadSet === 'function' && result.source === 'futgg') {
        const open = add(row, 'button', '查看卡片', 'gallery-target-open');
        open.addEventListener('click', event => { if (!event.isTrusted) return; setJointMode(false); void loadSetDetails(set); });
      }
    }
  };
  const setJointMode = enabled => {
    if (jointMode !== enabled) planningEpoch++;
    jointMode = enabled;
    node('gallery-browse').hidden = enabled; node('gallery-joint').hidden = !enabled;
    node('gallery-mode-browse').setAttribute('aria-pressed', String(!enabled));
    node('gallery-mode-joint').setAttribute('aria-pressed', String(enabled));
    showBrowseLevel();
    if (enabled) { disposeNativeCards(); renderJoint(); }
    else if (selectedSetId && details.has(selectedSetId)) {
      const set = result?.catalog.categories.flatMap(category => category.sets).find(set => set.id === selectedSetId);
      if (set) renderSetDetail(details.get(selectedSetId), set);
    }
  };
  const showJointPlan = (plan, inputs = []) => {
    const output = node('gallery-joint-output'); output.replaceChildren();
    if (plan.status === 'achieved') { add(output, 'p', '当前联合目标已达到，无需补卡。'); return; }
    if (plan.status !== 'ready') {
      const messages = { 'search-time-exhausted': '计算时间预算已用完，尚不能确认无解；可缩小目标范围再试', 'target-state-unknown': '集合状态待更新', 'price-unknown': '缺少有效报价，预算方案尚未确定',
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
    if (plan.costAudit) add(output, 'small', `按单卡价格选取的完整组合为 ${count(plan.costAudit.totalPrice)} 金币，最低目标计分 ${count(plan.costAudit.score)} 分。`, 'gallery-unknown');
    for (const [index, planRow] of plan.plans.entries()) {
      const detail = add(output, 'details'); detail.open = index === 0;
      add(detail, 'summary', `方案 ${index + 1} · ${planRow.items.length} 张 · ${planRow.totalPrice == null ? '报价未知' : `${count(planRow.totalPrice)} 🪙`}`);
      if (planRow.remainingBudget != null) add(detail, 'small', `剩余预算 ${count(planRow.remainingBudget)} 🪙`);
      if (planRow.estimated) add(detail, 'small', '包含公开估分', 'gallery-unknown');
      if (inputs.length) {
        const benchmark = add(detail, 'button', '对照逐集合'); benchmark.type = 'button';
        const comparison = add(detail, 'output', '', 'gallery-joint-benchmark');
        const frozen = structuredClone(inputs), identity = scope();
        benchmark.addEventListener('click', async event => {
          if (!event.isTrusted || benchmark.disabled) return;
          benchmark.disabled = true; comparison.textContent = '计算逐集合基准…';
          const token = ++planningEpoch;
          try {
            const baseline = await runGalleryPlan(planGallerySequentialSteps({ targets: frozen }), {
              current: () => active && !disposed && token === planningEpoch && identity === scope() && comparison.isConnected,
            });
            if (!baseline) return;
            const value = baseline.status === 'observed' ? benchmarkGalleryPlans({ jointPlan: planRow, individualPlans: baseline.plans }) : baseline;
            comparison.textContent = value.status === 'observed'
              ? `逐集合 ${count(value.separatePrice)} 金币 · 联合 ${count(value.jointPrice)} 金币 · 差额 ${count(value.savings)} 金币`
              : `基准未完整计算 · ${value.reason ?? '待核实'}`;
          } catch { void diag({ event: 'joint-benchmark', phase: 'planner', status: 'failed', reason: 'FC27_GALLERY_JOINT_BENCHMARK_FAILED' }); if (comparison.isConnected) comparison.textContent = '基准暂不可用'; }
          finally { benchmark.disabled = false; }
        });
      }
      const targets = add(detail, 'table');
      for (const target of planRow.targets) {
        const row = add(targets, 'tr'); add(row, 'th', `${target.name} · ${target.targetGrade}`);
        add(row, 'td', `${count(target.score)} 分`);
        add(row, 'td', target.rewards.map(reward => reward.label).join('、') || '无目录奖励');
      }
      add(detail, 'small', '奖励为目录内容，未确认可领或新增收益。');
      const list = add(detail, 'ul');
      for (const item of planRow.items) add(list, 'li', `${item.name ?? item.eaId} · ${item.version ?? ''} · ${item.price == null ? '价格未知' : `${count(item.price)} 🪙`}${item.targetIds.length > 1 ? ` · 共用 ${item.targetIds.length} 个目标` : ''}`);
      const targetsBinding = JSON.stringify([...jointTargets]);
      const catalogAtPlan = result.catalog;
      purchaseButton(detail, planRow.items, `joint:${targetsBinding}:${planRow.items.map(item => item.eaId).join(',')}`,
        { budget: targetValue().budget,
          replanContext: { targets: inputs, mode: 'joint', ledger: { receipts: [], excludedIds: [], quotes: {} }, budget: targetValue().budget },
          valid: () => jointMode && result.catalog === catalogAtPlan && JSON.stringify([...jointTargets]) === targetsBinding });
    }
  };
  node('gallery-mode-browse').addEventListener('click', () => setJointMode(false));
  node('gallery-mode-joint').addEventListener('click', () => setJointMode(true));
  node('gallery-joint-budget').addEventListener('input', event => { if (!event.isTrusted || checkScope() === false) return; invalidateJoint(); persistTargets(); });
  node('gallery-joint-plan').addEventListener('click', async event => {
    if (!event.isTrusted || restoringTargets) return;
    checkScope();
    const sets = result?.catalog?.categories.flatMap(category => category.sets) ?? [];
    const targets = [];
    for (const [id, targetGrade] of jointTargets) {
      const value = details.get(id), set = sets.find(set => set.id === id);
      if (!set || !value?.progress || value.status !== 'observed' || value.stale || value.poolStale) {
        void diag({ event: 'joint-plan', phase: 'preflight', status: 'blocked', reason: 'FC27_GALLERY_JOINT_TARGET_STATE_UNKNOWN', count: targets.length });
        showJointPlan({ status: 'partial', reason: 'target-state-unknown' }); return;
      }
      targets.push({ set, catalog: result.catalog, progress: value.progress, prices: planningPrices(value),
        scope: currentScope, targetGrade });
    }
    const rawBudget = node('gallery-joint-budget').value.trim(), budget = rawBudget ? Number(rawBudget) : null;
    const token = ++planningEpoch, identity = scope();
    jointRun = token;
    const current = () => !disposed && active && token === planningEpoch && identity === scope() && jointMode;
    const button = node('gallery-joint-plan'); button.disabled = true;
    const output = node('gallery-joint-output'); output.textContent = '正在计算…';
    const cancel = add(node('gallery-joint-controls') ?? button.parentElement, 'button', '取消');
    cancel.addEventListener('click', () => { planningEpoch++; output.textContent = '计算已取消'; });
    try {
      const refreshIds = [...new Set(targets.filter(target => {
        const value = details.get(target.set.id);
        return needsPriceRefresh(value);
      }).flatMap(target => target.progress.rows.filter(row => !isGalleryOwned(row)).map(row => row.eaId)))].sort((a, b) => a - b);
      if (refreshIds.length && typeof loadPrices === 'function') {
        output.textContent = '正在更新公开报价…';
        const snapshots = [];
        for (let start = 0; start < refreshIds.length; start += 250) {
          if (!current()) return;
          snapshots.push(await loadPrices(refreshIds.slice(start, start + 250)));
        }
        if (!current()) return;
        const priceSnapshot = { prices: {}, freshPrices: {}, expiresAt: null };
        for (const snapshot of snapshots) {
          Object.assign(priceSnapshot.prices, snapshot?.prices ?? {});
          Object.assign(priceSnapshot.freshPrices, snapshot?.freshPrices ?? {});
          if (snapshot?.expiresAt != null) priceSnapshot.expiresAt = Math.min(priceSnapshot.expiresAt ?? Infinity, snapshot.expiresAt);
        }
        for (const target of targets) {
          const previous = details.get(target.set.id);
          if (!needsPriceRefresh(previous)) continue;
          const value = { ...previous, priceSnapshot, prices: priceSnapshot.prices };
          details.set(target.set.id, value); target.prices = planningPrices(value);
        }
      }
      void diag({ event: 'joint-plan', phase: 'planner', status: 'started', count: targets.length });
      const plan = await runGalleryPlan(planGalleryJointSteps({ targets, budget }), { current,
        progress: value => { output.textContent = `正在计算… ${value.evaluations} 个候选`; } });
      if (plan) void diag({ event: 'joint-plan', phase: 'planner', status: plan.status === 'ready' || plan.status === 'achieved' ? 'success' : 'blocked',
        replayInput: { targets, budget },
        reason: /^[a-z]+(?:-[a-z]+)*$/.test(plan.reason ?? '') ? `FC27_GALLERY_JOINT_${plan.reason.replaceAll('-', '_').toUpperCase()}` : undefined,
        evaluations: plan.evaluations, count: targets.length, requestedCount: plan.candidateCount,
        retainedCount: plan.candidateCount, expandedCount: plan.omittedCandidates,
        quotedCount: plan.quotedCandidateCount, bestPrice: plan.plans?.[0]?.totalPrice,
        beamTruncated: plan.beamTruncated === true, budgetExhausted: plan.budgetExhausted === true,
        timeExhausted: plan.timeExhausted === true,
        searchComplete: plan.searchComplete === true, scopeTruncated: plan.scopeTruncated === true });
      if (plan && current()) showJointPlan(plan, targets);
    } catch { void diag({ event: 'joint-plan', phase: 'planner', status: 'failed', reason: 'FC27_GALLERY_JOINT_PLANNER_FAILED', count: targets.length }); if (current()) showJointPlan({ status: 'unavailable', reason: 'planner-failed' }); }
    finally {
      if (jointRun === token) { jointRun = null; button.disabled = !jointTargets.size || restoringTargets; }
      cancel.remove();
    }
  });
  const invalidated = new Set();
  let detailRequest = null;
  const scope = () => { try { return accountScope(); } catch { return null; } };
  let currentScope = scope();
  const checkScope = () => {
    const next = scope();
    if (next === currentScope) return true;
    scoreQueue.cancel(); scoredSets.clear(); overviewCache.clear(); planCache.clear();
    currentScope = next; selection++; selectedSetId = null; details.clear();
    selectedCards.clear(); selectionSource = null; selectionBudget = ''; cardPage = 1;
    foregroundSync = null; resumeBackground = false;
    if (syncing) sync?.stop();
    jointTargets.clear(); node('gallery-joint-budget').value = '';
    targetsIdentity = null; ++targetsEpoch; restoringTargets = false;
    node('gallery-joint-budget').disabled = false; targetStatus('');
    invalidateJoint(); restoreTargets(); renderJoint();
    disposeNativeCards(node('gallery-set-detail'));
    node('gallery-set-detail').replaceChildren();
    categoryId = null; showBrowseLevel();
    if (result) renderSets();
    updateSyncButton(); void refreshShared();
    return false;
  };

  const renderSetDetail = (value, set) => {
    const target = node('gallery-set-detail'); disposeNativeCards(target); target.replaceChildren(); showBrowseLevel();
    node('gallery-selection-footer').replaceChildren(); node('gallery-selection-footer').hidden = true;
    const heading = add(target, 'div', '', 'gallery-detail-heading');
    const headingIdentity = add(heading, 'div', '', 'gallery-identity');
    add(headingIdentity, 'h3', set.name);
    if (sync) {
      const button = add(heading, 'button', '同步当前集合'); button.title = '同步当前集合';
      // Background work must not disable a foreground collection refresh.
      button.disabled = foregroundSync?.setId === set.id;
      button.addEventListener('click', event => {
        if (event.isTrusted) void loadSetDetails(set, { force: true });
      });
    }
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
    const unconfirmed = progress.totals.unknown === progress.totals.total && progress.totals.total > 0;
    add(overview, 'strong', unconfirmed ? `?/${set.requiredCards}` : `${progress.totals.collected}/${set.requiredCards}`, 'gallery-big-count');
    add(overview, 'span', unconfirmed ? '待同步' : progress.candidateOnly ? '候选内已收集' : '已确认收集', 'gallery-muted');
    add(overview, 'span', `${progress.totals.missing} 缺失 · ${progress.totals.unknown} 待核实`, 'gallery-muted');
    add(overview, 'span', progress.candidateOnly
      ? `高分候选 ${progress.totals.total} / 全部 ${progress.poolSize ?? '?'}`
      : `卡池 ${progress.totals.total}`, 'gallery-muted');
    gradeTrack(overview, set.grades, summary);
    const rewards = add(target, 'details', '', 'gallery-rewards');
    add(rewards, 'summary', '等级奖励');
    for (const grade of set.grades) {
      const row = add(rewards, 'div', '', 'gallery-reward-row');
      add(row, 'strong', grade.name);
      add(row, 'span', `${count(grade.threshold)} 分`);
      add(row, 'span', grade.rewards.map(reward => reward.label).join('、') || (grade.rewardsComplete ? '无奖励' : '非代币奖励未提供'));
    }
    const facts = add(target, 'details', '', 'gallery-facts'); add(facts, 'summary', '收集状态详情');
    add(facts, 'small', `Club 可见 ${progress.totals.inClub} / 未知 ${progress.totals.clubUnknown} · 首任可见 ${progress.totals.firstOwned} / 未知 ${progress.totals.firstOwnedUnknown}`);
    add(facts, 'small', 'Club 来自当前缓存；未看到不等于没有。公开分值与 EA 单卡基础分分别显示。');
    if (value.stale) add(target, 'small', `更新未成功，保留最近快照 · ${value.reason ?? ''}`, 'gallery-unknown');
    if (value.poolStale) add(target, 'small', '公共卡池暂时无法更新，使用上次卡池。', 'gallery-unknown');
    if (value.fetchedAt) add(target, 'small', `收集状态读取于 ${date(value.fetchedAt)}`);
    renderScoring(target, summary, value);
    const cachedPlan = planCache.get(set.id);
    if (cachedPlan && cachedPlan.binding !== planBinding(value, set)) cachedPlan.stale = true;
    renderPlan(target, value, set, summary);
    if (selectionSource !== result?.source) {
      selectedCards.clear(); selectionSource = result?.source ?? null; cardPage = 1;
    }
    const filters = add(target, 'div', '', 'row gallery-card-filters');
    for (const [key, label] of [['all','全部'],['collected','已收集'],['missing','未收集'],['unknown','待核实'],['held','持有'],['lineup','计分阵容'],['firstOwned','First Owner']]) {
      const button = add(filters, 'button', label); button.setAttribute('aria-pressed', String(filter === key));
      button.addEventListener('click', event => { if (!event.isTrusted) return; filter = key; cardPage = 1; renderSetDetail(value, set); });
    }
    const cardTools = add(target, 'div', '', 'row gallery-card-tools');
    const search = add(cardTools, 'input'); search.type = 'search'; search.value = cardQuery; search.placeholder = '搜索球员'; search.setAttribute('aria-label', '搜索球员');
    const order = document.createElement('select'); order.setAttribute('aria-label', '卡片排序');
    for (const [key, label] of [['catalog', '目录顺序'], ['name', '名称'], ['score', 'Gallery 分数'], ['price', '价格']]) { const option = document.createElement('option'); option.value = key; option.textContent = label; option.selected = cardOrder === key; order.append(option); }
    cardTools.append(order);
    const clear = add(cardTools, 'button', '×'); clear.title = '清除选择'; clear.setAttribute('aria-label', '清除选择'); clear.type = 'button'; clear.disabled = !selectedCards.size;
    const missingRows = progress.rows.filter(row => !isGalleryOwned(row) && row.collected === false);
    const cheapCount = add(cardTools, 'input'); cheapCount.type = 'number'; cheapCount.min = '1'; cheapCount.max = String(Math.max(1, missingRows.length));
    cheapCount.value = String(Math.max(1, set.requiredCards - progress.totals.collected)); cheapCount.setAttribute('aria-label', '最低价选卡数量'); cheapCount.className = 'gallery-cheapest-count';
    const cheapest = add(cardTools, 'button', '最低价 N 张'); cheapest.type = 'button'; cheapest.disabled = typeof purchase !== 'function' || !missingRows.length;
    const filtered = filterGalleryCards(progress.rows, { filter, query: cardQuery, order: cardOrder, prices: planningPrices(value) ?? {}, lineupIds: summary?.lineup?.map(row => row.eaId) ?? [] });
    const page = paginateGalleryCards(filtered, { page: cardPage, pageSize: 24 }); cardPage = page.page;
    add(cardTools, 'span', `${page.total ? `${(page.page - 1) * page.pageSize + 1}-${Math.min(page.page * page.pageSize, page.total)}` : 0} / ${page.total}`, 'gallery-card-page');
    const previous = add(cardTools, 'button', '←'); previous.type = 'button'; previous.title = '上一页'; previous.setAttribute('aria-label', '上一页'); previous.disabled = page.page <= 1;
    const next = add(cardTools, 'button', '→'); next.type = 'button'; next.title = '下一页'; next.setAttribute('aria-label', '下一页'); next.disabled = page.page >= page.pages;
    const reconciled = reconcileGallerySelection(selectedCards, selectionContext().rows);
    selectedCards.clear(); for (const [id, row] of reconciled) selectedCards.set(id, row);
    const list = add(target, 'div', '', 'gallery-card-list');
    const selectionBar = node('gallery-selection-footer'); selectionBar.hidden = typeof purchase !== 'function' || !selectedCards.size;
    const selectedBuy = typeof purchase === 'function' ? add(selectionBar, 'button', 'Buy 0', 'primary gallery-purchase') : null;
    const selectionSummary = add(selectionBar, 'span', '', 'gallery-selection-summary');
    const preview = add(selectionBar, 'div', '', 'gallery-selection-preview'); preview.setAttribute('role', 'status');
    let selectedSummary, previewEpoch = 0;
    const updateSelected = () => {
      const context = selectionContext();
      selectedSummary = summarizeGallerySelection(selectedCards, context.rows, context.prices);
      if (selectedBuy) { selectedBuy.disabled = !selectedSummary.count || buying || !context.valid || value.status !== 'observed' || value.stale || value.poolStale; selectedBuy.textContent = `Buy ${selectedSummary.count}`; }
      selectionBar.hidden = typeof purchase !== 'function' || !selectedSummary.count;
      updateFooterGeometry();
      clear.disabled = !selectedSummary.count;
      selectionSummary.textContent = `${selectedSummary.count} 张 · ${selectedSummary.totalPrice == null ? '报价未知' : `${count(selectedSummary.totalPrice)} 金币`}`;
      for (const button of list.querySelectorAll('.gallery-card-select')) {
        const id = button.closest('[data-definition-id]').dataset.definitionId, added = selectedCards.has(id);
        button.textContent = added ? 'Added' : 'Buy'; button.setAttribute('aria-pressed', String(added));
        button.style.color = added ? '#152c22' : ''; button.style.opacity = added ? '1' : ''; button.style.fontWeight = added ? '700' : '';
        button.setAttribute('aria-label', `${added ? '移除' : '添加'} ${button.dataset.cardName}`);
      }
      const token = ++previewEpoch;
      if (!selectedSummary.count) { preview.replaceChildren(); return; }
      preview.textContent = '预计等级计算中…';
      void runGalleryPlan(previewGallerySelectionSteps({ set, catalog: result.catalog, progress,
        selectedIds: selectedSummary.selected.map(row => row.eaId) }), { current: () => token === previewEpoch && thisDetailCurrent(value, set.id) && preview.isConnected,
        maxMs: 1500 }).then(summary => {
        if (!summary) return;
        preview.textContent = `预计 ${scoreText(summary)}${summary.estimated ? ' · 公开估分' : ''}`;
      }).catch(() => { if (preview.isConnected && token === previewEpoch) preview.textContent = '预计等级暂不可用'; });
    };
    if (selectedBuy) {
      const budget = add(selectionBar, 'input'); budget.type = 'number'; budget.min = '0'; budget.max = '165000000'; budget.step = '1'; budget.value = selectionBudget;
      budget.placeholder = '总预算（可选）'; budget.setAttribute('aria-label', '购买总预算'); budget.style.maxWidth = '160px';
      budget.addEventListener('input', event => { if (event.isTrusted) selectionBudget = budget.value; });
      selectedBuy.addEventListener('click', event => {
        if (!event.isTrusted || !thisDetailCurrent(value, set.id) || value.stale || value.poolStale || buying || checkScope() === false) return;
        const context = selectionContext();
        if (!context.valid) return;
        const currentSelection = summarizeGallerySelection(selectedCards, context.rows, context.prices);
        if (currentSelection.count !== selectedCards.size) { updateSelected(); return; }
        const total = budget.value.trim() ? Number(budget.value) : null;
        void runPurchase({ items: currentSelection.selected.map(row => ({ eaId: row.eaId, name: row.name, definitionId: row.eaId })), binding: `cards:${result.source}:${[...selectedCards.keys()].sort().join(',')}`, budget: total });
      });
    }
    clear.disabled = !selectedCards.size;
    clear.addEventListener('click', event => { if (!event.isTrusted) return; selectedCards.clear(); updateSelected(); });
    cheapest.addEventListener('click', event => {
      if (!event.isTrusted) return;
      const candidates = selectCheapestGalleryCards(filtered, Number(cheapCount.value), planningPrices(value) ?? {});
      for (const row of candidates) selectedCards.set(String(row.eaId), { eaId: row.eaId, name: row.name });
      updateSelected();
    });
    search.addEventListener('change', event => { if (!event.isTrusted) return; cardQuery = search.value; cardPage = 1; renderSetDetail(value, set); });
    order.addEventListener('change', event => { if (!event.isTrusted) return; cardOrder = order.value; cardPage = 1; renderSetDetail(value, set); });
    previous.addEventListener('click', event => { if (!event.isTrusted) return; cardPage--; renderSetDetail(value, set); });
    next.addEventListener('click', event => { if (!event.isTrusted) return; cardPage++; renderSetDetail(value, set); });
    const scoredIds = new Set(summary?.lineup?.map(row => row.eaId) ?? []);
    for (const row of page.rows) {
      const card = add(list, 'article', '', 'gallery-card gallery-player-card');
      card.dataset.definitionId = String(row.eaId);
      card.dataset.rarityId = String(row.rarityEaId ?? '');
      const art = add(card, 'div', '', 'gallery-player-art');
      art.dataset.galleryCardArt = String(row.eaId);
      if (selectedBuy && !isGalleryOwned(row) && row.collected === false && value.status === 'observed' && !value.stale && !value.poolStale) {
        const select = add(art, 'button', selectedCards.has(String(row.eaId)) ? 'Added' : 'Buy', 'gallery-card-select');
        select.type = 'button'; select.setAttribute('aria-label', `${selectedCards.has(String(row.eaId)) ? '移除' : '添加'} ${row.name} ${row.version ?? ''}`);
        select.dataset.cardName = `${row.name} ${row.version ?? ''}`;
        select.setAttribute('aria-pressed', String(selectedCards.has(String(row.eaId))));
        if (selectedCards.has(String(row.eaId))) { select.style.color = '#152c22'; select.style.opacity = '1'; select.style.fontWeight = '700'; }
        select.addEventListener('click', event => {
          if (!event.isTrusted) return;
          if (selectedCards.has(String(row.eaId))) selectedCards.delete(String(row.eaId));
          else selectedCards.set(String(row.eaId), { eaId: row.eaId, name: row.name });
          updateSelected();
        });
      }
      const price = cachedPrice(row, value);
      const priceBar = add(art, 'div', '', 'gallery-card-pricebar');
      const priceLabel = add(priceBar, 'span', price == null ? '价格未知' : `${price.toLocaleString()} 🪙`, 'gallery-card-price');
      const stalePrice = price != null && (priceExpired(value) || value.priceSnapshot?.staleIds?.includes(row.eaId)
        || value.priceSnapshot && !Object.hasOwn(value.priceSnapshot.prices, row.eaId));
      if (stalePrice) { priceLabel.dataset.priceState = 'snapshot'; priceLabel.title = '旧报价快照，不用于方案成本'; priceLabel.classList.add('gallery-unknown'); }
      add(priceBar, 'span', `Gallery ${row.galleryScore == null ? '—' : row.galleryScore.toLocaleString()}`, 'gallery-card-gallery-score');
      cardImage(art, row, value.runtimeCards, set.id);
      const selectControl = art.querySelector('.gallery-card-select');
      if (selectControl) art.append(selectControl);
      const meta = add(card, 'div', '', 'gallery-player-meta');
      add(meta, 'strong', row.name);
      add(meta, 'span', `${row.overall ?? '—'} OVR · ${row.version ?? '版本未知'}`, 'gallery-player-version');
      const logos = add(meta, 'div', '', 'gallery-player-logos');
      image(logos, asset('club', row.clubEaId), '俱乐部', 'gallery-mini-emblem');
      image(logos, asset('league', row.leagueEaId), '联赛', 'gallery-mini-emblem');
      image(logos, asset('nation', row.nationEaId), '国籍', 'gallery-mini-emblem');
      const flags = add(meta, 'div', '', 'gallery-player-flags');
      statusIcon(flags, row.collected, row.collected === true ? '已收集' : row.collected === false ? '未收集' : '收集状态未知');
      statusIcon(flags, row.inClub, row.inClub === true ? 'Club 可见' : row.inClub === false && row.held ? '其他库存区持有，Club 未看到' : row.inClub === false ? 'Club 未看到' : 'Club 状态未知');
      statusIcon(flags, row.firstOwned, row.firstOwned === true ? 'First Owner' : row.firstOwned === false ? '非 First Owner' : 'First Owner 未知');
      add(meta, 'span', `EA ${row.gradingScore == null ? '未知' : row.gradingScore}`, 'gallery-player-score');
      const firstOwnerAction = galleryFirstOwnerHistoryAction(row);
      if (typeof setFirstOwner === 'function' && firstOwnerAction) {
        const localFirstOwner = firstOwnerAction === 'clear';
        const firstOwner = add(meta, 'button', localFirstOwner ? '清除历史 FO' : '标记历史 FO', 'gallery-first-owner-toggle');
        firstOwner.type = 'button';
        firstOwner.title = localFirstOwner
          ? '清除本地首任历史声明，恢复自动识别结果；不改变 EA 记录'
          : '仅在确定曾首任获得这个版本时标记；仅从市场买过的不要标记。只影响 FCAT 本地估分，不改变 EA 记录';
        firstOwner.addEventListener('click', async event => {
          if (!event.isTrusted || checkScope() === false || !thisDetailCurrent(value, set.id)) return;
          const identity = scope();
          firstOwner.disabled = true;
          try {
            await setFirstOwner(row.eaId, localFirstOwner ? null : true);
            const current = details.get(set.id);
            if (!current || current !== value || identity !== scope() || !thisDetailCurrent(value, set.id)) return;
            // Local history is shared by exact version across collections.
            // Undo reveals observed EA evidence without another service read.
            for (const [id, detail] of details) {
              if (!detail.progress?.rows.some(item => item.eaId === row.eaId)) continue;
              const rows = detail.progress.rows.map(item => {
                if (item.eaId !== row.eaId) return item;
                const observed = item.observedFirstOwned ?? (item.firstOwnedSource === 'ea-observed' ? item.firstOwned : null);
                return { ...item, observedFirstOwned: observed, firstOwned: localFirstOwner ? observed : true,
                  firstOwnedSource: localFirstOwner ? observed === null ? null : 'ea-observed' : 'local-history' };
              });
              details.set(id, { ...detail, progress: { ...detail.progress, rows, totals: { ...detail.progress.totals,
                firstOwned: rows.filter(item => item.firstOwned === true).length,
                firstOwnedUnknown: rows.filter(item => item.firstOwned === null).length } } });
            }
            invalidateJoint('First Owner 历史已更新，请重新生成');
            renderSetDetail(details.get(set.id), set);
          } catch {
            firstOwner.title = '本地 FO 历史保存失败';
            if (identity === scope() && thisDetailCurrent(value, set.id)) {
              const failure = meta.querySelector('.gallery-first-owner-error') ?? add(meta, 'small', '', 'gallery-first-owner-error');
              failure.textContent = '本地 FO 历史保存失败，请重试';
            }
          }
          finally { if (firstOwner.isConnected) firstOwner.disabled = false; }
        });
      }
      if (scoredIds.has(row.eaId)) add(meta, 'span', '计分阵容成员', 'badge gallery-score-member');
      if (typeof marketCompare === 'function' && !isGalleryOwned(row) && row.collected === false) {
        const compare = add(meta, 'button', '比价', 'gallery-card-compare'); compare.type = 'button';
        const comparison = add(meta, 'small', '', 'gallery-market-comparison');
        compare.addEventListener('click', async event => {
          if (!event.isTrusted || !thisDetailCurrent(value, set.id)) return;
          compare.disabled = true; comparison.textContent = '读取 EA 可见最低价…';
          meta.querySelector('.gallery-market-listings')?.remove();
          const compareScope = scope();
          try {
            const quote = await marketCompare(row.eaId);
            if (!comparison.isConnected || !thisDetailCurrent(value, set.id) || compareScope !== scope()) return;
            if (quote?.status !== 'observed') {
              comparison.textContent = `比价暂不可用 · ${quote?.reason ?? '未知'}`;
              comparison.title = quote?.reason ?? '';
              return;
            }
            comparison.title = '';
            const reference = cachedPrice(row, value);
            comparison.textContent = `EA ${quote.price == null ? '无有效挂牌' : `${count(quote.price)} 金币`} · 参考 ${reference == null ? '未知' : `${count(reference)} 金币`}`;
            if (quote.listings?.length) {
              const detail = add(meta, 'details', '', 'gallery-market-listings');
              add(detail, 'summary', `EA 可见报价 ${quote.listings.length} 条`);
              for (const listing of quote.listings.slice(0, 3)) add(detail, 'small', `${count(listing.buyNow)} 金币 · 剩余 ${listing.expires ?? '?'} 秒`);
            }
          } catch { void diag({ event: 'market-compare', phase: 'view', status: 'failed', reason: 'FC27_GALLERY_COMPARE_VIEW_FAILED' }); if (comparison.isConnected && thisDetailCurrent(value, set.id) && compareScope === scope()) comparison.textContent = '比价暂不可用'; }
          finally { compare.disabled = false; }
        });
      }
    }
    updateSelected();
    updateFooterGeometry();
  };

  const loadSetDetails = (set, { force = false } = {}) => {
    if (typeof loadSet !== 'function') return;
    if (checkScope() === false) return;
    if (!force && !invalidated.has(set.id) && foregroundSync?.setId === set.id && detailRequest?.id === set.id) return detailRequest.task;
    // A user-selected collection always wins over background all-set mapping.
    // The loader then performs the exact pool/progress read for this set.
    const priority = sync?.prioritize?.(set.id);
    categoryId = result?.catalog?.categories.find(row => row.sets.some(candidate => candidate.id === set.id))?.id ?? null;
    const changingSet = selectedSetId !== set.id;
    selectedSetId = set.id;
    if (changingSet) { cardPage = 1; cardQuery = ''; cardOrder = 'catalog'; }
    filter = 'all'; const token = ++selection, startedScope = currentScope, source = result?.source;
    force = force || invalidated.has(set.id);
    foregroundSync = { token, setId: set.id, name: set.name, progress: { phase: 'catalog', index: 0, total: 1, completed: 0 } };
    // A forced refresh must follow, not coalesce into, the pre-change read.
    const prior = force && detailRequest?.id === set.id && detailRequest.source === source ? detailRequest.task : null;
    renderSetDetail({status:'loading'}, set);
    updateSyncButton();
    const task = Promise.resolve(priority).then(() => prior).then(() => {
      checkScope();
      if (token !== selection || startedScope !== currentScope) return null;
      return loadSet({ source, setId: set.id, set, force, onProgress: progress => {
        if (foregroundSync?.token !== token || startedScope !== scope() || disposed) return;
        foregroundSync.progress = progress; updateSyncButton();
      } });
    })
      .then(async value => {
        checkScope();
        if (!value || token !== selection || source !== result?.source || startedScope !== currentScope || value.scope && value.scope !== currentScope) return;
        if (value.status === 'observed' && !value.poolStale) invalidated.delete(set.id);
        const changed = galleryPlanningStateKey(details.get(set.id)) !== galleryPlanningStateKey(value);
        details.set(set.id, value);
        await restorePlanCache(set, value);
        if (token !== selection || source !== result?.source || startedScope !== currentScope) return;
        if (changed && jointTargets.has(set.id)) invalidateJoint('目标材料或报价已更新，请重新生成方案。');
        renderJoint(); renderSets();
        const currentSet = result.catalog.categories.flatMap(category => category.sets).find(row => row.id === set.id);
        if (currentSet && !jointMode) renderSetDetail(value, currentSet);
      })
      .catch(error => {
        checkScope();
        const value = { status: 'blocked', reason: /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_GALLERY_PROGRESS_UNAVAILABLE' };
        if (token === selection) renderSetDetail(value, set);
      }).finally(() => {
        if (foregroundSync?.token === token) { foregroundSync = null; updateSyncButton(); }
        Promise.resolve(priority).then(interrupted => {
          if (interrupted && !disposed && active && startedScope === scope()) resumeBackground = true;
          if (resumeBackground && !foregroundSync && !disposed && active && !syncing) {
            resumeBackground = false; void synchronize(null, { background: true });
          }
        });
      });
    detailRequest = { id: set.id, source, task };
    return task;
  };

  const renderSets = () => {
    const categories = result?.catalog?.categories ?? [];
    const category = categories.find(row => row.id === categoryId);
    const list = node('gallery-set-list'); list.replaceChildren();
    if (!category) { showBrowseLevel(); return; }
    node('gallery-category-title').textContent = category.name;
    const summaries = new Map([...details].map(([id, value]) => [id, value?.progress?.totals]));
    const filtered = browseGallerySets(result?.catalog, { categoryId, query: node('gallery-search').value,
      order: node('gallery-sort').value, followedOnly: node('gallery-followed').checked,
      targets: targetValue().targets, summaries });
    if (!filtered.length) add(list, 'p', '没有匹配的集合', 'gallery-unknown');
    for (const { set } of filtered) {
      const card = add(list, 'article', '', 'gallery-set'); card.dataset.setId = set.id;
      const title = add(card, 'div', '', 'gallery-set-title');
      const configuredIcons = assets?.set?.(set.name);
      const titleIcons = Array.isArray(configuredIcons) && configuredIcons.length
        ? configuredIcons
        : details.get(set.id)?.pool?.items?.slice(0, 3).map(item => asset('club', item.clubEaId)) ?? [];
      const iconBox = add(title, 'span', '', 'gallery-set-icons');
      const candidates = (Array.isArray(titleIcons) ? titleIcons : [titleIcons]).map(value =>
        typeof value === 'string' && value.startsWith('https://') ? value : asset('club', value)).filter(Boolean);
      let chosen = setIconSelections.get(set.id);
      if (!chosen || chosen.key !== JSON.stringify(candidates)) {
        chosen = { key: JSON.stringify(candidates), src: selectGallerySetIcon(candidates) };
        setIconSelections.set(set.id, chosen);
      }
      if (chosen.src) image(iconBox, chosen.src, set.name, 'gallery-set-icon');
      add(title, 'h4', set.name);
      const watch = add(title, 'button', jointTargets.has(set.id) ? '★' : '☆', 'gallery-watch');
      watch.type = 'button'; watch.title = jointTargets.has(set.id) ? '取消关注' : '关注集合';
      watch.setAttribute('aria-label', `${watch.title} ${set.name}`);
      watch.setAttribute('aria-pressed', String(jointTargets.has(set.id))); watch.disabled = restoringTargets;
      watch.addEventListener('click', event => {
        event.stopPropagation();
        if (!event.isTrusted || restoringTargets) return;
        if (checkScope() === false) return;
        if (restoringTargets) return;
        if (jointTargets.has(set.id)) jointTargets.delete(set.id);
        else jointTargets.set(set.id, scoreSummary(details.get(set.id), set)?.nextGrade ?? set.grades[0].name);
        invalidateJoint(); renderJoint(); renderSets(); persistTargets();
      });
      if (result.changes?.added.includes(set.id)) add(card, 'span', '新集合', 'badge');
      const detail = details.get(set.id), totals = detail?.progress?.totals, summary = scoreSummary(detail, set);
      const grades = add(card, 'div', '', 'gallery-grades');
      gradeTrack(grades, set.grades, summary);
      const metrics = add(card, 'div', '', 'gallery-set-metrics');
      const collected = add(metrics, 'span', totals ? `${totals.collected} / ${set.requiredCards}` : `? / ${set.requiredCards}`, 'gallery-collected');
      collected.title = totals ? `已收集 / 目标 · ${totals.unknown} 待核实` : '收集进度：未同步';
      if (!totals || totals.total > 0 && totals.unknown === totals.total) collected.textContent = `? / ${set.requiredCards}`;
      const scoreCaption = add(metrics, 'span', 'Base score', 'gallery-score-caption');
      scoreCaption.title = '集合基础分（本地参考计分）';
      const score = add(metrics, 'span', compactScore(summary), 'gallery-summary');
      score.title = `Base score · ${scoreText(summary)}`;
      score.setAttribute('aria-label', `Base score ${scoreText(summary)}`);
      renderRewardSummary(metrics, [set]);
      if (detail?.progress?.candidateOnly) {
        const candidate = add(metrics, 'span', '▣', 'gallery-collection-flag');
        candidate.title = `高分候选 ${detail.progress.totals?.total ?? '?'} / 全部 ${detail.progress.poolSize ?? '?'}`;
        candidate.setAttribute('aria-label', candidate.title);
      }
      if (detail?.stale || detail?.poolStale) {
        const snapshot = add(metrics, 'span', '◷', 'gallery-collection-flag');
        snapshot.title = '当前显示最近一次快照'; snapshot.setAttribute('aria-label', snapshot.title);
      }
      if (typeof loadSet === 'function' && result.source === 'futgg') {
        const button = add(card, 'button', '查看卡片', 'gallery-open-set');
        button.type = 'button'; button.addEventListener('click', event => { if (event.isTrusted) void loadSetDetails(set); });
        card.addEventListener('click', event => { if (event.isTrusted && !event.target.closest?.('button')) void loadSetDetails(set); });
      } else if (typeof loadSet === 'function' && result.source === 'fodder') {
        add(card, 'small', '当前使用 Fodder 回退目录；该来源没有已核实卡池接口，暂不能读取卡片和 EA 收集状态。', 'gallery-unknown');
      }
    }
    showBrowseLevel();
  };

  const applySyncDetails = values => {
    const sets = result?.catalog?.categories.flatMap(category => category.sets) ?? [];
    let changed = false, selectedChanged = false, jointChanged = false;
    for (const value of values ?? []) {
      const setId = value?.pool?.setId ?? value?.progress?.setId;
      const source = value?.pool?.source ?? value?.progress?.source;
      const id = `${source}:${setId}`;
      if (source !== result?.source || !sets.some(set => set.id === id)
          || value.scope && value.scope !== currentScope || !value.progress) continue;
      const previous = details.get(id);
      if (previous && JSON.stringify(previous.progress) === JSON.stringify(value.progress)
          && previous.pool?.revision === value.pool?.revision && previous.stale === value.stale
          && sameGalleryRuntimeCards(previous.runtimeCards, value.runtimeCards)) continue;
      const merged = { ...previous, ...value };
      if (jointTargets.has(id) && galleryPlanningStateKey(previous) !== galleryPlanningStateKey(merged)) jointChanged = true;
      details.set(id, merged);
      changed = true; if (id === selectedSetId) selectedChanged = true;
    }
    if (!changed) return;
    if (jointChanged) invalidateJoint('目标材料或报价已更新，请重新生成方案。');
    renderJoint(); renderSets();
    if (selectedChanged && !activePlans && !foregroundSync && !jointMode && selectedSetId != null && details.has(selectedSetId)) {
      const set = result?.catalog?.categories.flatMap(category => category.sets).find(row => row.id === selectedSetId);
      if (set) renderSetDetail(details.get(selectedSetId), set);
    }
  };
  const updateSyncButton = () => {
    if (!sync) return;
    const state = sync.state();
    node('gallery-sync').hidden = false;
    node('gallery-sync').disabled = syncing || state.busy || !result?.catalog || result.source !== 'futgg';
    node('gallery-sync').title = '完整复核全部收集；平时自动增量合并';
    node('gallery-sync-time').textContent = state.syncedAt ? `上次同步 ${date(state.syncedAt)}` : '尚未同步';
    const progress = foregroundSync?.progress ?? state.progress;
    const bar = node('gallery-background-progress');
    if (progress && (foregroundSync || state.busy && !state.synced) && result?.source === 'futgg') {
      const phase = progress.phase === 'pools' ? '同步集合卡池' : progress.phase === 'catalog' ? '读取集合目录' : '同步 EA 收集';
      const index = Number.isSafeInteger(progress.index) ? progress.index : 0;
      const total = Number.isSafeInteger(progress.total) ? progress.total : 0;
      bar.hidden = false; bar.max = total || 1;
      bar.value = Math.min(progress.completed ?? Math.max(0, index - 1), total || 1);
      const page = Number.isSafeInteger(progress.pages) ? ` · 已读 ${progress.pages} 页` : '';
      const count = Number.isSafeInteger(progress.count) ? ` · 已读 ${progress.count}` : '';
      const collection = foregroundSync ? `${foregroundSync.name} · ` : '';
      node('gallery-progress-note').textContent = `${collection}${phase} ${index}/${total}${page}${count}`;
    } else if (bar) {
      bar.hidden = true; bar.value = 0;
    }
  };
  const refreshShared = () => {
    if (!sync || disposed || !active || syncing || !result || syncRefresh) return syncRefresh;
    const identity = scope(), source = result.source;
    syncRefresh = Promise.resolve(sync.peekDetails(source)).then(values => {
      if (!disposed && active && !syncing && scope() === identity && result?.source === source) applySyncDetails(values);
    }).catch(() => {}).finally(() => { syncRefresh = null; updateSyncButton(); });
    return syncRefresh;
  };
  const synchronize = async (setId = null, { background = false } = {}) => {
    if (!sync || syncing || !active || checkScope() === false) return;
    const identity = scope(), source = result?.source;
    syncing = true; updateSyncButton();
    const dialog = node('gallery-sync-dialog');
    node('gallery-sync-message').textContent = '正在同步收集…';
    node('gallery-sync-progress').value = 0;
    if (!background && !dialog.open) dialog.showModal();
    let outcome;
    try {
      outcome = await sync.sync({ source, setId, force: !background, onProgress: progress => {
        if (disposed || identity !== scope()) { sync.stop(); return; }
        node('gallery-sync-progress').max = progress.total || 1;
        node('gallery-sync-progress').value = progress.completed ?? Math.max(0, progress.index - 1);
        const page = Number.isSafeInteger(progress.pages) ? ` · 已读 ${progress.pages} 页` : '';
        const count = Number.isSafeInteger(progress.count) ? ` · 已读 ${progress.count}` : '';
        node('gallery-sync-message').textContent = `${progress.phase === 'pools' ? '映射集合' : '同步收集'} ${progress.index}/${progress.total}${page}${count}`;
        if (progress.details?.length) applySyncDetails(progress.details);
        updateSyncButton();
      } });
      if (!disposed && identity === scope() && result?.source === source) {
        applySyncDetails(outcome.details ?? await sync.peekDetails(source));
        node('gallery-progress-note').textContent = outcome.status === 'observed' ? '收集已同步'
          : outcome.status === 'stopped' ? '同步已停止，已确认记录保留'
            : outcome.status === 'partial' ? `收集已同步，${outcome.failures.length} 个集合卡池待更新`
              : `同步未完成 · ${outcome.reason ?? '读取失败'}`;
      }
    } catch { if (identity === scope()) node('gallery-progress-note').textContent = '同步未完成，已确认记录保留'; }
    finally {
      syncing = false; if (dialog.open) dialog.close(); updateSyncButton();
      if (resumeBackground && !foregroundSync && !disposed && active && identity === scope()) {
        resumeBackground = false; void synchronize(null, { background: true });
      }
      if (!activePlans && !foregroundSync && selectedSetId && details.has(selectedSetId)) {
        const set = result?.catalog?.categories.flatMap(category => category.sets).find(row => row.id === selectedSetId);
        if (set) renderSetDetail(details.get(selectedSetId), set);
      }
    }
  };
  const unsubscribeSync = sync?.subscribe(refreshShared);
  node('gallery-sync').addEventListener('click', event => { if (event.isTrusted) void synchronize(); });
  node('gallery-sync-stop').addEventListener('click', () => sync?.stop());
  node('gallery-sync-dialog').addEventListener('cancel', event => { event.preventDefault(); sync?.stop(); });

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
    for (const id of removed) setIconSelections.delete(id);
    const requirementChanges = new Set(changed?.requirements ?? []);
    const selectedStillExists = selectedSetId != null && catalog.categories.some(category =>
      category.sets.some(set => set.id === selectedSetId));
    const selectedRemoved = selectedSetId != null && !selectedStillExists;
    for (const id of [...removed, ...requirementChanges]) {
      details.delete(id);
      if (requirementChanges.has(id)) invalidated.add(id);
      else invalidated.delete(id);
    }
    if (sourceChanged || selectedRemoved) {
      disposeNativeCards();
      selectedCards.clear(); selectionSource = null; selectionBudget = ''; cardPage = 1;
      if (sourceChanged) { details.clear(); invalidated.clear(); setIconSelections.clear(); planCache.clear(); }
      if (sourceChanged) {
        jointTargets.clear(); node('gallery-joint-budget').value = ''; targetsIdentity = null; ++targetsEpoch; restoringTargets = false;
        node('gallery-joint-budget').disabled = false; targetStatus('');
      }
      selection++; selectedSetId = null;
      node('gallery-set-detail').replaceChildren(); categoryId = null; showBrowseLevel();
    }
    if (!catalog.categories.some(row => row.id === categoryId)) categoryId = null;
    const targetCatalogChanged = [...changed.requirements, ...changed.rewards, ...changed.removed, ...changed.renamed]
      .some(id => jointTargets.has(id));
    if (changed.tagsChanged || targetCatalogChanged || sourceChanged) invalidateJoint('目标规则已更新，请重新生成方案。');
    if (changed.tagsChanged || changed.requirements.length || changed.rewards.length || changed.removed.length
        || changed.renamed.length || sourceChanged) overviewCache.clear();
    restoreTargets(); reconcileTargets(); renderJoint();
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
    if (!sync || !sync.state().syncedAt) note.textContent = typeof loadSet === 'function'
      ? sync ? '收集状态尚未同步' : '选择集合后读取该集合卡池和账号收集状态；未读取的集合不会触发 EA 查询。'
      : '账号收集进度尚未接入。';
    const buttons = node('gallery-categories'); buttons.replaceChildren();
    for (const row of catalog.categories) {
      const button = add(buttons, 'button');
      const top = add(button, 'span', '', 'gallery-category-top');
      const iconsBox = add(top, 'span', '', 'gallery-category-icons');
      const icons = assets?.category?.(row.slug, row.name) ?? [];
      for (const src of (Array.isArray(icons) ? icons : [icons]).slice(0, 3)) image(iconsBox, src, row.name, 'gallery-category-icon');
      add(top, 'span', `${row.sets.length} 个集合`, 'gallery-category-count');
      renderRewardSummary(top, row.sets, 'gallery-category-rewards');
      add(button, 'strong', row.name, 'gallery-category-name');
      button.type = 'button'; button.dataset.categoryId = row.id;
      button.addEventListener('click', () => { categoryId = row.id; renderSets(); });
    }
    renderSets();
    updateSyncButton(); void refreshShared();
    // Account collection and public pool mapping run without blocking navigation.
    if (active && sync && value.source === 'futgg') {
      const state = sync.state();
      const key = `${scope() ?? 'unknown'}:${catalog.revision ?? value.fetchedAt ?? 'catalog'}:${state.needsRefresh ? Math.floor(Date.now()/GALLERY_TTL_MS) : 'baseline'}`;
      if ((!state.synced || state.needsRefresh) && autoSyncKey !== key) {
        autoSyncKey = key;
        queueMicrotask(() => { if (active && result === value && !syncing) void synchronize(null, { background: true }); });
      }
    }
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
    } else if (!activePlans && !jointMode && selectedSetId != null && details.has(selectedSetId)) {
      const selected = catalog.categories.flatMap(category => category.sets).find(set => set.id === selectedSetId);
      if (selected) renderSetDetail(details.get(selectedSetId), selected);
    }
  };

  const load = force => {
    checkScope();
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
    const wasActive = active;
    active = value && !disposed;
    if (!active) { planningEpoch++; scoreQueue.cancel(); selection++; selectedSetId = null; categoryId = null; overviewCache.clear();
      disposeNativeCards(); node('gallery-set-detail').replaceChildren(); node('gallery-set-list').replaceChildren(); showBrowseLevel(); }
    if (timer !== null) timers?.clearInterval(timer);
    if (scopeTimer !== null) timers?.clearInterval(scopeTimer);
    timer = null;
    scopeTimer = null;
    if (active && provider) {
      void refreshPurchases();
      if (!wasActive) { jointMode = false; node('gallery-browse').hidden = false; node('gallery-joint').hidden = true;
        node('gallery-mode-browse').setAttribute('aria-pressed', 'true'); node('gallery-mode-joint').setAttribute('aria-pressed', 'false');
        selectedSetId = null; categoryId = null; overviewCache.clear(); showBrowseLevel(); }
      check(); timer = timers?.setInterval(check, GALLERY_TTL_MS) ?? null;
      if (loadSet) scopeTimer = timers?.setInterval(checkScope, 1000) ?? null;
    }
  };
  node('gallery-refresh').disabled = !provider;
  node('gallery-back').addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (selectedSetId !== null) { selection++; selectedSetId = null; cardPage = 1; disposeNativeCards(); node('gallery-set-detail').replaceChildren(); renderSets(); }
    else if (categoryId !== null) { categoryId = null; node('gallery-set-list').replaceChildren(); showBrowseLevel(); }
  });
  node('gallery-search').addEventListener('input', renderSets);
  node('gallery-sort').addEventListener('change', renderSets);
  node('gallery-followed').addEventListener('change', renderSets);
  node('gallery-refresh').addEventListener('click', () => { if (provider && active) void load(true); });
  document.addEventListener('visibilitychange', check);
  document.defaultView?.addEventListener('resize', updateFooterGeometry);
  if (!provider) {
    const message = '此检查入口未接入公开目录，请使用 FC Automation Tool 正式脚本。';
    node('gallery-status').textContent = message;
    node('gallery-progress-note').textContent = message;
  }
  return Object.freeze({ setActive, dispose: () => { disposed = true; selection++; setIconSelections.clear(); scoreQueue.dispose(); clearTimeout(scoreRenderTimer); sync?.stop(); unsubscribeSync?.();
    purchase?.stop?.(); node('gallery-purchase-dialog').close();
    node('gallery-sync-dialog').close(); setActive(false); document.removeEventListener('visibilitychange', check);
    document.defaultView?.removeEventListener('resize', updateFooterGeometry); } });
}
