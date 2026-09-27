const stageText = { planning: '正在解题…', procurement: '正在计算补卡方案并查询候选报价…', validating: '正在复核材料…', saving: '正在填阵保存…', verifying: '正在核验保存结果…', recovering: '正在核对已保存阵容并恢复显示…' };
const sameTarget = (a, b) => !!(a && b && a.setId === b.setId && a.challengeId === b.challengeId && a.anchor === b.anchor);
const resultText = result => {
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
  if (Number.isSafeInteger(result?.recoveryChallengeId)) return `子阵 ${result.recoveryChallengeId} 的保存待核对，请返回该子阵点击解题填充恢复。`;
  if (result?.status === 'recovery-required' || /RECOVERY_REQUIRED/.test(result?.reason ?? '')) return '保存状态待核对，请使用 FCAT 恢复检查。';
  if (result?.reason === 'FC27_PUZZLE_EXISTING_SQUAD_BLOCKED') return '当前阵容已有球员，未覆盖原阵容。';
  if (result?.reason === 'FC27_PUZZLE_MATERIAL_COMPOSITION_BLOCKED') return '阵容不符合选材策略，未增加高品质卡补位。';
  if (['FC27_PUZZLE_SEARCH_LIMIT', 'FC27_PUZZLE_CONSTRAINT_SHORTAGE', 'SAFE_MATERIAL_SHORTAGE', 'FC27_PUZZLE_NO_PLAN_FOUND'].includes(result?.reason)) {
    const composition = result.policy?.materialComposition?.filter(rule => rule.count > 0)
      .map(rule => `${rule.count} ${({ 1: '铜', 2: '银', 3: '金' })[rule.quality] ?? ''}`).join('＋');
    const scope = [composition, Number.isInteger(result.policy?.maxRating) ? `最高 ${result.policy.maxRating}` : ''].filter(Boolean).join('，');
    const message = result.reason === 'FC27_PUZZLE_SEARCH_LIMIT'
      ? '本次搜索未找到满足全部条件的阵容，未放宽选材或修改阵容。'
      : '当前可用材料无法在选材限制内组成阵容，未自动增加高品质卡。';
    return scope ? `${scope}：${message}` : message;
  }
  if (result?.reason === 'FC27_PUZZLE_CHALLENGE_COMPLETED') return '当前 SBC 子阵已完成，不会改用其他子阵。';
  if (result?.reason === 'FC27_PUZZLE_CHALLENGE_NOT_IN_PROGRESS') return '当前 SBC 子阵不可继续，不会改用其他子阵。';
  if (result?.reason === 'FC27_PUZZLE_FILL_TARGET_CHANGED') return '页面已切换，本次填阵停止。';
  return `未完成填阵：${/^[A-Z0-9_]{1,100}$/.test(result?.reason ?? '') ? result.reason : '请稍后重试'}`;
};

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
  status.style.cssText = 'margin:.5rem;text-align:center;white-space:normal;overflow-wrap:anywhere;font-size:13px';
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
    const onProgress = stage => {
      if (!isCurrent()) return;
      status.hidden = false; status.textContent = stageText[stage] ?? '正在处理…';
    };
    busy = true; button.disabled = true; button.textContent = 'FCAT 正在填充…';
    onProgress('planning');
    try {
      const result = await onFill({ setId: origin.setId, challengeId: origin.challengeId }, { isCurrent, onProgress });
      if (isCurrent()) { status.hidden = false; status.textContent = resultText(result); }
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
