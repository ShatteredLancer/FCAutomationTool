const stageText = { planning: '正在解题…', procurement: '正在计算补卡方案并查询候选报价…', validating: '正在复核材料…', saving: '正在填阵保存…', verifying: '正在核验保存结果…', recovering: '正在核对已保存阵容并恢复显示…' };
const progressCount = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : '?';
export const formatFc27PuzzleProgress = progress => {
  if (typeof progress === 'string') return stageText[progress] ?? '正在处理…';
  if (!progress || typeof progress !== 'object') return '正在处理…';
  const procurementPhases = { 'repair-seed': '正在寻找补卡起点…', 'query-planning': '正在规划卡池查询…',
    'catalog-read': '正在读取候选卡池…', 'local-market-search': '正在计算补卡组合…', 'quote-read': '正在查询方案报价…' };
  const stage = procurementPhases[progress.phase] ?? stageText[progress.stage] ?? stageText[progress.phase] ?? stageText.planning;
  const hasBudget = Number.isSafeInteger(progress.nodes) && Number.isSafeInteger(progress.maxNodes);
  const lines = [hasBudget ? `${stage}\n节点 ${progressCount(progress.nodes)} / ${progressCount(progress.maxNodes)}` : stage];
  const search = progress.search;
  if (search && typeof search === 'object') {
    const parts = [['combinationNodes', '组合'], ['placementNodes', '阵位'], ['evaluations', '评估'], ['bounds', '剪枝']]
      .filter(([key]) => Number.isSafeInteger(search[key])).map(([key, label]) => `${label} ${progressCount(search[key])}`);
    if (parts.length) lines.push(parts.join(' · '));
  }
  const candidates = progress.safeCandidates ?? progress.marketCandidates;
  if (Number.isSafeInteger(candidates)) lines.push(`候选 ${progressCount(candidates)} 人`);
  if (Number.isSafeInteger(progress.attempts) && Number.isSafeInteger(progress.attempt)) {
    lines.push(`策略 ${progress.attempt} / ${progress.attempts}`);
  }
  if (Number.isSafeInteger(progress.checks) && !search) lines.push(`评估 ${progressCount(progress.checks)} / ${progressCount(progress.maxNodes)}`);
  if (Number.isSafeInteger(progress.catalogPages)) lines.push(`卡池 ${progressCount(progress.catalogPages)} / ${progressCount(progress.catalogTotal)} 页 · ${progressCount(progress.catalogCandidates)} 个版本`);
  if (progress.phase === 'quote-read') lines.push(`报价 ${progressCount(progress.quoteCompleted)} / ${progressCount(progress.quoteTotal)}`);
  if (Number.isSafeInteger(progress.requests)) lines.push(`请求 ${progressCount(progress.requests)} · 缓存 ${progressCount(progress.cacheHits)}`);
  return lines.join('\n');
};
const sameTarget = (a, b) => !!(a && b && a.setId === b.setId && a.challengeId === b.challengeId && a.anchor === b.anchor);
const resultText = result => {
  if (result?.reason === 'FC27_BUY_RECOVERY_REQUIRED') return '购买结果尚待核对，请使用本页批量购买按钮恢复，不会重新购买已成交的卡。';
  if (result?.reason === 'FC27_BUY_DRAFT_ACTIVE') return '此阵容已有确认购买的卡；可继续批量购买剩余概念卡，或在原生页面提交已完成的阵容。';
  if (result?.status === 'concept-filled') return `已${result.restored ? '恢复' : '保存'}阵容，含 ${result.purchaseCount} 张待购概念卡，观察总价 ${result.estimatedCost} 金币。尚未购买或提交 SBC；FCAT 批量购买接线尚未完成。`;
  const purchase = result?.purchaseSuggestion;
  if (purchase?.reason === 'FC27_PURCHASE_CACHE_EXPIRED') return '补卡资料或报价已过期，本次未采用旧价格、未再次请求或购买；需要更新补卡资料。';
  if (purchase?.reason === 'FC27_MARKET_HTTP_429') return 'EA 市场请求限流，本次已停止并记录，不会自动重试或购买。';
  if (purchase?.status === 'suggested' && purchase.plans?.length) {
    const plan = purchase.plans[0];
    const cards = plan.purchases.map(item => `${item.displayName && /[\p{L}\p{N}]/u.test(item.displayName) ? item.displayName : '球员'}（${item.rating} 分，版本 ${item.definitionId}），观察价 ${item.observedBuyNow}`).join('；');
    return `补卡建议：${cards}。共 ${plan.purchaseCount} 张，约 ${plan.estimatedCost} 金币；补卡方案化学 ${plan.teamFacts.chemistry}，本地复核满足全部条件。尚未购买，需批准购买及使用这些卡后重新验阵。`;
  }
  if (result?.status === 'filled' && result.restored === true) return '已恢复之前保存的阵容，未重复保存或提交 SBC。';
  if (result?.status === 'filled' && result.saved === true) return '阵容已保存，未提交 SBC。';
  if (result?.httpStatus === 429 || result?.reason === 'FC27_CLUB_HTTP_429') return 'EA 请求限流，本次已停止，没有自动重试。';
  if (result?.reason === 'FC27_CATALOG_READ_UNCONFIRMED' || result?.reason === 'FC27_CATALOG_CACHE_UNVERIFIED') {
    return 'SBC 需求记录不可用，请进入目标子阵后使用解题填充。';
  }
  if (result?.reason === 'FC27_PUZZLE_PAGE_SYNC_UNCONFIRMED') return '保存后页面同步未完成，已保留恢复记录；请勿重复保存。';
  if (result?.reason === 'FC27_CONCEPT_SQUAD_MANUAL_EDITED') return '检测到阵容被部分清空或手动修改；为保护现有卡片，请先清空整个阵容后再点击 FCAT 解题填充。';
  if (Number.isSafeInteger(result?.recoveryChallengeId)) return `子阵 ${result.recoveryChallengeId} 的保存待核对，请返回该子阵点击解题填充恢复。`;
  if (result?.status === 'recovery-required' || /RECOVERY_REQUIRED/.test(result?.reason ?? '')) return '保存状态待核对，请使用 FCAT 恢复检查。';
  if (result?.reason === 'FC27_PUZZLE_EXISTING_SQUAD_BLOCKED') return '当前阵容已有球员，未覆盖原阵容。';
  if (result?.reason === 'FC27_PUZZLE_SERVER_SQUAD_CHANGED') return '解题期间服务器阵容发生变化，本次未覆盖；请核对当前阵容后再试。';
  if (result?.reason === 'FC27_PUZZLE_SERVER_BASELINE_UNVERIFIED') return '本次服务器阵容核对已失效，未保存；请重新点击解题填充。';
  if (result?.reason === 'FC27_PUZZLE_MATERIAL_COMPOSITION_BLOCKED') return '阵容不符合选材策略，未增加高品质卡补位。';
  if (['FC27_PUZZLE_SEARCH_LIMIT', 'FC27_PUZZLE_CONSTRAINT_SHORTAGE', 'SAFE_MATERIAL_SHORTAGE', 'FC27_PUZZLE_NO_PLAN_FOUND'].includes(result?.reason)) {
    const composition = result.policy?.materialComposition?.filter(rule => rule.count > 0)
      .map(rule => `${rule.count} ${({ 1: '铜', 2: '银', 3: '金' })[rule.quality] ?? ''}`).join('＋');
    const scope = [composition, Number.isInteger(result.policy?.maxRating) ? `最高 ${result.policy.maxRating}` : ''].filter(Boolean).join('，');
    const message = result.reason === 'FC27_PUZZLE_SEARCH_LIMIT'
      ? '本次搜索达到上限，尚未找到满足全部条件的阵容；不能判定无解，未修改阵容。'
      : '本次库存解题未找到符合选材限制的阵容，未自动增加高品质卡。';
    return scope ? `${scope}：${message}` : message;
  }
  if (result?.reason === 'FC27_PUZZLE_CHALLENGE_COMPLETED') return '当前 SBC 子阵已完成，不会改用其他子阵。';
  if (result?.reason === 'FC27_PUZZLE_CHALLENGE_NOT_IN_PROGRESS') return '当前 SBC 子阵不可继续，不会改用其他子阵。';
  if (result?.reason === 'FC27_PUZZLE_FILL_TARGET_CHANGED') return '页面已切换，本次填阵停止。';
  return `未完成填阵：${/^[A-Z0-9_]{1,100}$/.test(result?.reason ?? '') ? result.reason : '请稍后重试'}`;
};

const code = value => typeof value === 'string' && /^FC27_[A-Z0-9_]{1,100}$/.test(value) ? value : null;
const countText = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : '未知';
const purchaseReasons = {
  FC27_MARKET_POLICY_INVALID: '求解器规划参数不一致，搜索未启动；请导出诊断日志',
  FC27_MARKET_QUOTE_INVALID: '候选报价数值无效，未采用该报价继续搜索',
  FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE: '阵容评分或化学评估不可用，不能确认方案',
  FC27_PUZZLE_SEARCH_LIMIT: '补卡组合搜索达到上限，不能判定无解',
  FC27_PURCHASE_REPAIR_NO_PLAN: '本次候选中未找到补卡组合，不代表整个市场无解',
  FC27_PURCHASE_QUOTES_UNAVAILABLE: '已尝试替换无可用挂牌的候选，仍未取得整阵所需报价',
  FC27_PURCHASE_READ_BUDGET: '本次查询已达预算，已保存进度；再次点击会复用仍有效的数据继续规划',
  FC27_PURCHASE_PRICE_LIMIT_INVALID: '补卡单卡报价上限无效，请在解题设置中填写金额或留空为不限',
  FC27_MARKET_HTTP_429: 'EA 限流，已停止；不会自动重试',
  FC27_MARKET_HTTP_401: 'EA 拒绝了市场查询认证，未修改阵容',
  FC27_MARKET_READ_BLOCKED: '资料或报价读取被停止，未完成查询',
  FC27_PURCHASE_CACHE_UNVERIFIED: '补卡缓存校验失败，未重新查询',
  FC27_PURCHASE_READ_UNCONFIRMED: '之前的查询尚未确认，未重复请求',
  FC27_PURCHASE_CACHE_EXPIRED: '资料或报价已过期，未采用旧价格',
};

// Display only the existing aggregate result. Never query EA to explain a stop.
export function formatFc27PuzzleNativeResult(result) {
  const message = resultText(result);
  const purchase = result?.purchaseSuggestion;
  if (purchase?.status !== 'blocked') return message;
  const reason = code(purchase.reason);
  const runtimeFailure = /^FC27_MARKET_METHOD_\d+_(?:MISSING|CHANGED)$/.test(reason);
  const explanation = runtimeFailure ? '市场运行时方法兼容性检查失败，未发送 EA 市场请求' : purchaseReasons[reason] ?? '规划未完成';
  const lines = [message, `补卡：${explanation}${reason ? `（${reason}）` : ''}。`];
  if (Object.hasOwn(purchase, 'quoteCeiling')) lines.push(purchase.quoteCeiling === null
    ? '单卡报价：不限。' : `单卡报价上限：${countText(purchase.quoteCeiling)} 金币。`);
  const inventory = result.plan;
  if (inventory) lines.push(`库存初筛 ${countText(inventory.safeCandidates)} 人；搜索节点 ${countText(inventory.nodes)}。`);
  const d = purchase.diagnostics;
  if (d) {
    if (d.failureSource === 'cache') lines.push('本次读取的是历史失败记录，未重新发送该查询。');
    else if (d.failureSource === 'request') lines.push('本次查询失败，已停止后续请求。');
    if (reason === 'FC27_MARKET_HTTP_401' && Number.isSafeInteger(d.retryAfterSeconds) && d.retryAfterSeconds >= 0) {
      lines.push(`确认 Web App 已正常登录后，请等待 ${d.retryAfterSeconds} 秒，再次点击“FCAT 解题填充”；只重查失败项，成功资料继续复用（过期则更新），不会自动循环重试。`);
    }
    if (Number.isSafeInteger(d.eaCode) && d.eaCode >= 0 && d.eaCode <= 0x7fffffff) lines.push(`EA 错误码：${d.eaCode}。`);
    if (runtimeFailure) {
      lines.push('这是运行时兼容性检查失败，不是库存无解；本次没有发送市场请求。刷新 Web App 后再次点击可重新探测。');
    }
    const stage = ({ 'repair-seed': '寻找库存基础阵容', 'query-planning': '规划资料查询',
      'catalog-read': '读取球员资料', 'local-market-search': '本地组合求解', 'quote-read': '读取市场报价' })[d.stage] ?? '未知';
    const route = ({ repair: '局部替换 1–2 张', joint: '库存与候选联合求解' })[d.route] ?? '尚未确定';
    lines.push(`停在${stage}；${route}。资料 ${countText(d.catalogPages)} 页，去重候选 ${countText(d.catalogCandidates)}，资料预筛合格 ${countText(d.usableCandidates)}。`);
    if (code(d.localReason)) lines.push(`本地结果：${d.localReason}；检查 ${countText(d.checks)} 次 / 节点 ${countText(d.nodes)}${d.truncated === true ? '（搜索或结果截断）' : ''}。`);
    lines.push(`查询尝试：资料 ${countText(d.catalogAttempts)}、报价 ${countText(d.quoteAttempts)}；缓存 ${countText(d.cacheHits)}。`);
    if (d.excludedUnavailable > 0) lines.push(`已排除 ${countText(d.excludedUnavailable)} 个无可用挂牌的候选；本地重新规划 ${countText(d.replans)} 次。`);
  }
  return lines.join('\n');
}

// One trusted click authorizes one solve/validate/save attempt. No Tools popup.
export function mountFc27PuzzleNativeButton({ document, onFill, readTarget,
  schedule = setInterval, unschedule = clearInterval } = {}) {
  if (!document?.body || document.getElementById('fcat-fc27-puzzle-native')) return () => {};
  const button = document.createElement('button');
  button.id = 'fcat-fc27-puzzle-native'; button.type = 'button';
  button.textContent = 'FCAT 解题填充'; button.title = '一键解题、复核并保存阵容，不提交 SBC';
  button.className = 'btn-standard call-to-action';
  button.style.cssText = 'display:block;width:calc(100% - 1rem);margin:.5rem auto;min-height:38px';
  const status = document.createElement('div'); status.id = 'fcat-fc27-puzzle-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'margin:.5rem;text-align:center;white-space:pre-line;overflow-wrap:anywhere;font-size:13px;max-height:180px;overflow-y:auto';
  let target = null; let busy = false; let disposed = false;
  const read = () => { try { return readTarget?.(); } catch { return null; } };
  const update = () => {
    const next = read();
    if (!next?.anchor?.isConnected) { target = null; button.remove(); status.remove(); return; }
    if (!sameTarget(next, target)) { status.textContent = ''; status.hidden = true; }
    target = next;
    if (button.nextSibling !== next.anchor) next.anchor.before(button);
    if (status.nextSibling !== button) button.before(status);
    button.disabled = busy;
  };
  button.addEventListener('click', async event => {
    if (!event.isTrusted || !target || busy || disposed || typeof onFill !== 'function') return;
    const next = read();
    if (!sameTarget(next, target)) { update(); return; }
    const origin = { ...next };
    const isCurrent = () => !disposed && origin.anchor.isConnected && sameTarget(read(), origin);
    const onProgress = progress => {
      if (!isCurrent()) return;
      status.hidden = false; status.textContent = formatFc27PuzzleProgress(progress);
    };
    onProgress.wantsPuzzleProgress = true;
    busy = true; button.disabled = true; button.textContent = 'FCAT 正在填充…';
    onProgress('planning');
    try {
      const result = await onFill({ setId: origin.setId, challengeId: origin.challengeId }, { isCurrent, onProgress });
      if (isCurrent()) { status.hidden = false; status.textContent = formatFc27PuzzleNativeResult(result); }
    } catch {
      if (isCurrent()) { status.hidden = false; status.textContent = '填阵未完成，请查看后台记录。'; }
    } finally {
      busy = false; button.textContent = 'FCAT 解题填充';
      if (!disposed) update();
    }
  });
  update();
  const timer = schedule(update, 1000);
  return () => { disposed = true; unschedule(timer); button.remove(); status.remove(); };
}
