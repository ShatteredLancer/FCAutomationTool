// UI behavior adapted from FSU 26.09 (Futcd_kcka, MIT); no FSU runtime access.
import { mountFc27PurchaseResults } from './fc27-purchase-results.js';
import { purchaseDialogMarkup, purchaseDialogStyles, updatePurchaseDialogProgress } from './fc27-purchase-dialog.js';
const reasons = {
  FC27_BUY_BUDGET_EXCEEDED: '已到本次预算；可修改预算后继续剩余购买。',
  FC27_BUY_NO_LISTING: '部分版本在价格范围内暂无挂牌，已继续处理其余球员。',
  FC27_BUY_RATE_LIMITED: 'EA 限流，已停止，没有自动重试。',
  FC27_BUY_STOPPED: '已停止，已购买结果保留。',
  FC27_BUY_ALREADY_OWNED: '缺失版本已在 Club 中，请先替换对应概念卡，避免重复购买。',
  FC27_BUY_SQUAD_CHANGED: '阵容已被修改，本次未继续购买或覆盖阵容。',
  FC27_BUY_INSUFFICIENT_COINS: '部分球员金币不足，已继续处理其余球员。',
  FC27_BUY_REJECTED: '部分买断被 EA 拒绝，已继续处理其余球员。',
  FC27_BUY_SEARCH_FAILED: '部分球员查价失败，已继续处理其余球员。',
  FC27_BUY_MOVE_REJECTED: '部分球员已购入但未能入库，已保留回执并继续处理其余球员。',
  FC27_BUY_UNASSIGNED_FULL: '待分配区已满，请先处理后继续。',
  FC27_BUY_AUTH_REQUIRED: 'EA 登录或交易权限失效，已停止，请恢复会话后继续。',
  FC27_BUY_LISTING_UNAVAILABLE: '部分挂牌已被买走；已继续处理其余球员。',
  FC27_BUY_LISTING_CHANGED: '部分挂牌已过期；已继续处理其余球员。',
};
export function mountFc27PuzzleBuyButton({ document, readTarget, inspect, buy, stop, foregroundProgress = null, refreshPrices = null,
  readPlayerName = null,
  schedule = setInterval, unschedule = clearInterval, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!document?.body || document.getElementById('fcat-fc27-puzzle-buy')) return () => {};
  const box = document.createElement('div'); box.id = 'fcat-fc27-puzzle-buy';
  box.style.cssText = 'margin:.5rem 1rem;padding:.5rem 0;text-align:center';
  // EA button display rules override the browser's default [hidden] styling.
  const style = document.createElement('style');
  style.textContent = '#fcat-fc27-puzzle-buy [hidden]{display:none!important}';
  box.append(style);
  const button = document.createElement('button'); button.className = 'btn-standard mini call-to-action'; button.style.width = '100%';
  const cancel = document.createElement('button'); cancel.className = 'btn-standard'; cancel.textContent = '停止购买'; cancel.hidden = true;
  const output = document.createElement('div'); output.setAttribute('role', 'status'); output.style.cssText = 'font-size:13px;margin:.4rem 0';
  box.append(button, cancel, output);
  let resultDialog = null, resultView = null, dialogOutput = null, dialogStop = null, dialogClose = null;
  let resultTarget = null;
  const sameTarget = selected => {
    const now = readTarget();
    return !disposed && !!now && now.setId === selected.setId && now.challengeId === selected.challengeId;
  };
  const openResults = selected => {
    if (!refreshPrices) return;
    if (!resultDialog) {
      const template = document.createElement('template'); template.innerHTML = purchaseDialogMarkup('puzzle');
      resultDialog = template.content.firstElementChild;
      const windowStyle = document.createElement('style'); windowStyle.textContent = purchaseDialogStyles; resultDialog.prepend(windowStyle);
      dialogStop = resultDialog.querySelector('#fcat-puzzle-purchase-stop');
      dialogClose = resultDialog.querySelector('#fcat-puzzle-purchase-close');
      dialogStop.addEventListener('click', event => { if (event.isTrusted && busy) { stop(); dialogStop.disabled = true; } });
      dialogClose.addEventListener('click', () => { if (!busy) resultDialog.close(); });
      resultDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
      dialogOutput = resultDialog.querySelector('#fcat-puzzle-purchase-message'); document.body.append(resultDialog);
    }
    resultTarget = selected;
    resultView?.dispose();
    resultView = mountFc27PurchaseResults({ document, parent: resultDialog.querySelector('.purchase-dialog-results'), refreshPrices, readPlayerName,
      isCurrent: () => sameTarget(selected), retry: retry => runPurchase(selected, retry), resume: () => runPurchase(selected) });
    dialogStop.hidden = !busy; dialogStop.disabled = false; dialogClose.hidden = busy;
    updatePurchaseDialogProgress(resultDialog, busy ? null : summary);
    if (!resultDialog.open) resultDialog.showModal();
  };
  let foregroundActive = false;
  const loading = active => {
    if (active) {
      if (foregroundActive) return;
      foregroundActive = true;
      try { if (!refreshPrices) foregroundProgress?.start?.({ stop }); } catch { /* Presentation cannot change a transaction. */ }
    } else {
      if (!foregroundActive) return;
      foregroundActive = false;
      try { if (!refreshPrices) foregroundProgress?.end?.(); } catch { /* Presentation cannot change a transaction. */ }
    }
  };
  const message = text => { output.textContent = text; if (dialogOutput) dialogOutput.textContent = text; };
  const markFailures = (selected, failures = []) => {
    const now = readTarget();
    if (now?.setId !== selected.setId || now?.challengeId !== selected.challengeId) return;
    for (const failure of failures) {
      const ref = now.slots?.[failure.slot];
      if (!Number.isSafeInteger(failure.slot) || ref?.concept !== true || ref.definitionId !== failure.definitionId) continue;
      // EA UTSquadSlotView.render writes the native slot's index attribute.
      const cards = document.querySelectorAll(`.ut-squad-slot-view[index="${failure.slot}"] .concept`);
      if (cards.length !== 1 || cards[0].querySelector('.fcat-cards-buyerror')) continue;
      const marker = document.createElement('div');
      marker.className = 'ut-squad-slot-chemistry-points-view item fcat-cards-buyerror';
      marker.title = reasons[failure.reason] ?? '本次购买未完成';
      const icon = document.createElement('div'); icon.className = 'ut-squad-slot-chemistry-points-view--container chemstyle icon_untradeable';
      marker.append(icon); cards[0].append(marker);
    }
  };
  let target = null; let summary = null; let signature = null; let busy = false; let reading = false; let disposed = false;
  const key = value => value ? `${value.setId}:${value.challengeId}:${value.squadSignature ?? ''}` : null;
  const attach = next => {
    if (next.purchaseAnchor?.isConnected) { next.purchaseAnchor.prepend(box); return; }
    const panel = next.anchor.closest('.ut-sbc-challenge-details-view');
    if (panel) panel.prepend(box); else next.anchor.before(box);
  };
  const refresh = async (force = false) => {
    if (disposed || busy || reading) return;
    const next = readTarget();
    if (!next?.anchor?.isConnected) { box.remove(); target = null; signature = null; if (!busy) resultDialog?.close(); return; }
    const changed = key(next) !== signature;
    if (!force && !changed) return;
    reading = true;
    try {
      const result = await inspect(next);
      if (disposed || key(readTarget()) !== key(next)) return;
      if (result?.reason === 'FC27_ACCEPTANCE_BUSY') return;
      const switched = !target || target.setId !== next.setId || target.challengeId !== next.challengeId;
      target = next; signature = key(next); summary = result;
      if (result?.status !== 'ready' || result.completed) {
        if (result?.completed && !switched && button.hidden) { attach(next); return; }
        if (!switched && output.textContent) {
          button.disabled = true;
          if (result?.reason) output.textContent += ` ${reasons[result.reason] ?? result.reason}`;
          attach(next); return;
        }
        box.remove(); return;
      }
      if (switched || result.remaining > 0 || result.recovery) button.hidden = false;
      button.textContent = result.recovery ? 'FCAT 核对并继续购买' : result.retryContext && result.results?.some(row => row.attempt?.failed)
        ? 'FCAT 查看购买结果／重试' : `FCAT 批量购买概念球员（${result.remaining} 张）`;
      button.disabled = false;
      if (switched) output.textContent = '点击后逐张查询、买入并替换当前概念卡；不会提交 SBC。';
      attach(next);
    } catch { output.textContent = '购买清单暂不可用，请稍后重试。'; signature = null; }
    finally { reading = false; }
  };
  const runPurchase = async (selected, retry = null) => {
    if (busy || !sameTarget(selected) || summary?.status !== 'ready') return;
    busy = true; button.disabled = true; cancel.hidden = false; cancel.disabled = false;
    openResults(selected);
    try {
      await wait(500);
      loading(true); message('正在查询并购买当前概念球员…');
      const result = await buy(selected, { approved: true, budget: null, expectedOperationId: summary.operationId, ...(retry ? { retry } : {}) }, {
        isCurrent: () => { const now = readTarget(); return !!now && now.setId === selected.setId && now.challengeId === selected.challengeId; },
        onProgress: progress => { try { if (!refreshPrices) foregroundProgress?.update?.(progress); } catch { /* Presentation cannot change a transaction. */ }
          resultView?.show(progress, { running: true });
          if (resultDialog) updatePurchaseDialogProgress(resultDialog, progress);
          message(`已购买 ${progress.purchased}/${progress.total}，已花费 ${progress.spent} 金币。`);
          markFailures(selected, progress.failures); },
      });
      output.textContent = result?.status === 'purchased'
        ? `购买完成：${result.purchased} 张，花费 ${result.spent} 金币；${result.replacementPending ? '原生阵容替换尚未完成，回执已保留，不会重复买入' : '已入库并替换当前概念卡'}，未提交 SBC。`
        : `${reasons[result?.reason] ?? `购买暂停：${/^FC27_[A-Z0-9_]+$/.test(result?.reason ?? '') ? result.reason : '结果待核对'}`} 已购买 ${result?.purchased ?? 0} 张，花费 ${result?.spent ?? 0} 金币。`;
      if (result?.failures?.length) output.textContent += ` 本次 ${result.failures.length} 张未完成${refreshPrices ? '，请在结果清单重试或核对' : '，可再次点击续购'}。`;
      markFailures(selected, result?.failures);
      if (result?.reused) output.textContent += ` 另有 ${result.reused} 张已在 Club，直接替换，未重复购买。`;
      if (result?.status === 'purchased' && !result.replacementPending) button.hidden = true;
      resultView?.show(result); if (resultDialog) updatePurchaseDialogProgress(resultDialog, result);
      if (dialogOutput) dialogOutput.textContent = output.textContent;
    } catch { message('购买结果待核对，请勿重复下单。'); }
    finally { loading(false); busy = false; button.disabled = false; cancel.hidden = true;
      if (dialogStop) { dialogStop.hidden = true; dialogClose.hidden = false; } }
    // Keep the completion message; partial runs refresh the remaining count.
    if (!button.hidden) await refresh(true);
  };
  button.addEventListener('click', event => {
    if (!event.isTrusted || busy || !target || summary?.status !== 'ready') return;
    if (refreshPrices && summary.retryContext && summary.results?.length) {
      openResults(target); resultView.show(summary); dialogOutput.textContent = '上次购买结果；修改仅作用于本次重试。';
    } else void runPurchase(target);
  });
  cancel.addEventListener('click', event => { if (event.isTrusted && busy) { stop(); cancel.disabled = true; output.textContent = '正在完成当前成交核对，然后停止…'; } });
  const timer = schedule(() => { if (resultTarget && !sameTarget(resultTarget) && !busy) resultDialog?.close(); void refresh(); }, 700); void refresh();
  return () => { disposed = true; unschedule(timer); loading(false); resultView?.dispose(); resultDialog?.remove(); box.remove(); };
}
