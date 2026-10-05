import { purchasePriceCap, galleryReferenceQuote } from '../../gallery/public-price-policy.js';
import { bindCurrencyArrows, currencyInputStyles } from './fc27-listing-currency.js';

const messages = {
  FC27_BUY_NO_LISTING: '上限内无挂牌', FC27_GALLERY_NO_LISTING: '上限内无挂牌',
  FC27_BUY_LISTING_UNAVAILABLE: '挂牌已售出', FC27_BUY_LISTING_CHANGED: '挂牌已失效',
  FC27_BUY_REFERENCE_PRICE_UNAVAILABLE: '所选来源无报价', FC27_BUY_REFERENCE_PRICE_EXPIRED: '报价已过期，请刷新',
  FC27_BUY_ATTEMPTS_EXHAUSTED: '尝试次数已用完', FC27_BUY_INSUFFICIENT_COINS: '金币不足',
  FC27_PUBLIC_PRICE_FUTBIN_DISABLED: 'FUTBIN 读取已关闭；原批次仍采用 FUTBIN，请重新开启读取或重新生成 FUT.GG 方案。',
  FC27_PUBLIC_PRICE_FUTGG_DISABLED: 'FUT.GG 读取已关闭；当前批次的价格授权不变，请重新启用该来源或生成新方案。',
};
const recovered = row => ['club', 'collected'].includes(row.state);
const uncertain = row => ['buy-pending', 'bought', 'move-pending', 'move-rejected'].includes(row.state);
const failed = row => row.state === 'waiting' && row.attempt?.failed === true;
const amount = n => Number.isFinite(n) ? n.toLocaleString() : '未知';
const time = n => Number.isSafeInteger(n) ? new Date(n).toLocaleString() : '未提供';

// Shared Gallery/Puzzle result editor. It never calls EA or modifies settings.
// A trusted retry click hands the exact visible grant back to the transaction.
export function mountFc27PurchaseResults({ document, parent, refreshPrices, retry, resume, readPlayerName = null, isCurrent = () => true }) {
  let outcome = null, context = null, busy = false, disposed = false, revision = 0;
  let running = false;
  const expanded = new Set();
  let edits = new Map(), references = {}, selected = new Set(), actionError = '';
  const add = (container, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; container.append(node); return node; };
  const root = add(parent, 'div'); root.className = 'fcat-purchase-results';
  const style = add(root, 'style');
  style.textContent = '.fcat-purchase-results{font:14px/1.5 Arial,sans-serif;text-align:left;color:inherit}.fcat-purchase-results *{box-sizing:border-box}.fcat-purchase-results .purchase-row{padding:10px 0;border-bottom:1px solid #68766a;overflow-wrap:anywhere}.fcat-purchase-results label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.fcat-purchase-results input[type=checkbox]{width:18px;height:18px;min-width:18px;margin:0}.fcat-purchase-results input[type=number]{width:120px;min-width:0;height:32px}.fcat-purchase-results .purchase-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 0}.fcat-purchase-results button{height:auto;min-height:36px;margin:0;padding:6px 12px}.fcat-purchase-results small{display:block}.fcat-purchase-results [hidden]{display:none!important}.fcat-purchase-results .purchase-error{color:#ffb9aa;overflow-wrap:anywhere}';
  style.textContent += currencyInputStyles;
  style.textContent += `.fcat-purchase-results button,.fcat-purchase-results input,.fcat-purchase-results select{font:inherit;color:#edf1f4;background:#202d36;border:1px solid #46545d;border-radius:5px;max-width:100%}
    .fcat-purchase-results select{width:auto;min-height:36px;padding:6px 10px}.fcat-purchase-results button{width:auto;cursor:pointer}.fcat-purchase-results button:disabled{opacity:.45;cursor:default}
    .fcat-purchase-results p{margin:6px 0;font:inherit}.fcat-purchase-results label{margin:0;font:inherit}
    .fcat-purchase-results .purchase-row{padding:10px 6px}.fcat-purchase-results .purchase-row[data-active=true]{background:#304451;border-left:3px solid #9df3d5}
    .fcat-purchase-results .purchase-row-title{display:flex;justify-content:space-between;gap:8px}.fcat-purchase-results strong{font:600 14px/1.5 Arial,sans-serif}
    .fcat-purchase-results .purchase-state{font-size:13px;color:#c1ced5}.fcat-purchase-results .purchase-price{font-size:13px;font-variant-numeric:tabular-nums}
    .fcat-purchase-results summary{margin:0;padding:4px 0;color:#b3c5cd;font:12px/1.5 Arial,sans-serif;cursor:pointer}
    .fcat-purchase-results small{margin:2px 0;font:12px/1.5 Arial,sans-serif;color:#b3c5cd}
    .fcat-purchase-results .purchase-error:empty,.fcat-purchase-results .purchase-actions:empty{display:none}
    .fcat-purchase-results .purchase-row>label:not(:first-child){margin-top:6px}`;
  const content = add(root, 'div');
  let totals, error, retryButton;
  const valid = () => {
    let total = 0, reason = '';
    if (!Number.isSafeInteger(context?.balance) || context.balance < 0) reason = '当前余额无法确认，请重新打开购买结果。';
    const items = [...selected].map(definitionId => ({ definitionId, maxBuy: edits.get(definitionId) }));
    for (const item of items) {
      const quote = references[item.definitionId]?.quotes?.[context?.policy.source];
      if (!quote || quote.error || quote.price === null || quote.expiresAt <= Date.now() || quote.fetchedAt > Date.now()) reason = '所选来源缺价或已过期，请刷新参考价；也可在设置中调整来源。';
      const cap = purchasePriceCap({ ...context, maxBuy: item.maxBuy });
      if (cap === null || cap !== item.maxBuy) reason = '上限须为 EA 合法价档，且不能超过单卡限制、余额或剩余预算。';
      total += Number.isFinite(item.maxBuy) ? item.maxBuy : 0;
    }
    if (total > (context?.remainingBudget ?? Infinity) || total > (context?.balance ?? Infinity)) reason = '所选上限合计超过余额或剩余预算，请减少选择或降低上限。';
    return { items, total, reason };
  };
  const updateTotals = () => {
    if (!totals) return;
    const value = valid();
    totals.textContent = `已选 ${value.items.length} 张 · 本次最多 ${amount(value.total)} 金币 · 每卡最多 ${context?.policy.purchaseAttempts ?? '—'} 次`;
    error.textContent = actionError || value.reason;
    retryButton.textContent = `重试所选失败卡（${value.items.length}）`;
    retryButton.disabled = busy || !context || !!value.reason || !value.items.length || !isCurrent();
  };
  const button = (container, label, action) => {
    const node = add(container, 'button', label); node.type = 'button'; node.className = 'btn-standard'; node.disabled = busy;
    node.addEventListener('click', async event => {
      if (!event.isTrusted || busy || disposed || !isCurrent()) return;
      busy = true; actionError = ''; const turn = revision; render();
      try { await action(); }
      catch (e) { if (!disposed && turn === revision && isCurrent()) { actionError = messages[e?.message] ?? (/^FC27_[A-Z0-9_]+$/.test(e?.message ?? '') ? e.message : '操作失败，请重试或导出诊断日志。'); error.textContent = actionError; } }
      finally { if (!disposed && turn === revision) { busy = false; for (const node of content.querySelectorAll('button,input,select')) node.disabled = false; updateTotals(); } }
    });
    return node;
  };
  const rowView = (container, row, editable) => {
    const line = add(container, 'div'); line.className = 'purchase-row'; line.dataset.definitionId = row.definitionId;
    line.dataset.active = String(running && outcome?.definitionId === row.definitionId);
    const label = add(line, 'label');
    label.className = 'purchase-row-title';
    if (editable) {
      const box = add(label, 'input'); box.type = 'checkbox'; box.checked = selected.has(row.definitionId); box.disabled = busy;
      box.addEventListener('change', () => { if (box.checked) selected.add(row.definitionId); else selected.delete(row.definitionId); updateTotals(); });
    }
    const active = running && outcome?.definitionId === row.definitionId;
    const inFlight = { 'buy-pending': '买入中', bought: '已买入，待入库', 'move-pending': '入库中', 'move-rejected': '入库失败，保留回执' };
    const state = recovered(row) ? '已完成' : uncertain(row) ? running ? inFlight[row.state] : '回执待核对，不能重买'
      : failed(row) ? '未买到' : active ? '正在查价' : '待处理';
    let name = row.name;
    if (!name && readPlayerName) { try { name = readPlayerName(row.definitionId); } catch { /* Display-only local lookup. */ } }
    add(label, 'strong', name || `球员 #${row.definitionId}`);
    add(label, 'span', state).className = 'purchase-state';
    const reference = references[row.definitionId] ?? row.reference;
    add(line, 'div', `${row.price == null ? '' : `成交 ${amount(row.price)} · `}上限 ${amount(row.reference?.maxBuy)}`).className = 'purchase-price';
    if (row.reason) add(line, 'small', messages[row.reason] ?? row.reason);
    const detail = add(line, 'details'); detail.className = 'purchase-quote-details'; detail.open = expanded.has(row.definitionId);
    add(detail, 'summary', '报价与尝试详情');
    detail.addEventListener('toggle', () => { if (detail.isConnected) { if (detail.open) expanded.add(row.definitionId); else expanded.delete(row.definitionId); } });
    add(detail, 'small', `版本 ${row.definitionId}`);
    if (row.attempt) add(detail, 'small', `本轮 ${row.attempt.used}/${row.attempt.limit} 次 · 累计 ${row.attempt.total} 次 · 第 ${row.attempt.round} 轮 · 市场查询 ${row.attempt.queries ?? 0} 次`);
    if (reference) {
      for (const source of ['futgg', 'futbin']) {
        const quote = reference.quotes?.[source];
        if (['FC27_PUBLIC_PRICE_SOURCE_NOT_REQUESTED', 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED'].includes(quote?.error)) {
          add(detail, 'small', `${source === 'futgg' ? 'FUT.GG' : 'FUTBIN'} · 未读取`); continue;
        }
        add(detail, 'small', `${source === 'futgg' ? 'FUT.GG' : 'FUTBIN'} ${amount(quote?.price)} · 抓取 ${time(quote?.fetchedAt)} · 源站更新 ${time(quote?.sourceUpdatedAt)}`);
      }
      add(detail, 'small', `采用 ${context?.policy.source ?? reference.policy?.source ?? '—'} · 上次上限 ${amount(row.reference?.maxBuy)}`);
    }
    if (editable) {
      const edit = add(line, 'label', '本次重试上限'); const input = add(edit, 'input');
      input.type = 'number'; input.min = '150'; input.value = edits.get(row.definitionId) ?? ''; input.disabled = busy;
      const changed = () => { edits.set(row.definitionId, input.value === '' ? null : Number(input.value)); updateTotals(); };
      input.addEventListener('input', changed);
      bindCurrencyArrows({ document, input, label: `本次重试上限 ${row.name || row.definitionId}`, enabled: () => !busy,
        limits: () => ({ minimum: 150, maximum: Math.min(15000000,
          context?.absoluteCap ?? 15000000, context?.balance ?? 15000000,
          context?.remainingBudget ?? 15000000) }),
        onStep: value => { input.value = String(value); changed(); } });
    }
  };
  const render = () => {
    content.replaceChildren(); totals = error = retryButton = null;
    const rows = outcome?.results ?? [];
    if (!outcome) return;
    add(content, 'p', `累计已支出 ${amount(outcome.spent ?? 0)} 金币 · 剩余预算 ${context?.remainingBudget == null ? '按可用余额' : amount(context.remainingBudget)}`);
    const recovery = outcome.status === 'recovery-required' || outcome.recovery || outcome.replacementPending || rows.some(uncertain);
    const canRetry = !busy && !recovery && !!context;
    if (!busy && rows.some(recovered)) {
      const done = add(content, 'details'); done.className = 'purchase-completed'; add(done, 'summary', `已完成 ${rows.filter(recovered).length} 张`);
      rows.filter(recovered).forEach(row => rowView(done, row, false));
    }
    rows.filter(row => busy || !recovered(row)).forEach(row => rowView(content, row, canRetry && failed(row)));
    const actions = add(content, 'div'); actions.className = 'purchase-actions';
    if (!recovery && rows.some(failed) && context) {
      const mode = add(actions, 'select'); mode.disabled = busy;
      for (const [value, text] of [['fixed', '加固定金币'], ['percent', '加百分比']]) { const option = add(mode, 'option', text); option.value = value; }
      const premium = add(actions, 'input'); premium.type = 'number'; premium.min = '0'; premium.value = '0'; premium.disabled = busy; premium.setAttribute('aria-label', '批量溢价');
      button(actions, '应用到所选卡', () => {
        const value = Number(premium.value);
        if (!Number.isSafeInteger(value) || value < 0) throw Error('FC27_PUBLIC_PRICE_POLICY_INVALID');
        for (const id of selected) {
          const quotes = references[id]?.quotes;
          const price = galleryReferenceQuote({ futgg: quotes?.futgg?.price, futbin: quotes?.futbin?.price }, { ...context.policy, premiumMode: mode.value, premium: value });
          edits.set(id, price.maxBuy === null ? null : purchasePriceCap({ maxBuy: price.maxBuy, priceTiers: context.priceTiers }));
        }
        busy = false; render();
      });
      if (refreshPrices) button(actions, '刷新参考价', async () => {
        const turn = revision;
        const snapshot = await refreshPrices(rows.filter(failed).map(row => row.definitionId), { force: true, isCurrent: () => !disposed && turn === revision && isCurrent() });
        if (disposed || turn !== revision || !isCurrent()) return;
        references = { ...references, ...snapshot.references }; context = { ...context, policy: snapshot.policy ?? context.policy };
        busy = false; render(); // Preserve user-entered caps.
      });
      totals = add(content, 'p');
      retryButton = button(content, '重试所选失败卡', () => {
        const value = valid();
        if (value.reason || !value.items.length) throw Error('FC27_BUY_RETRY_CAP_INVALID');
        return retry({ operationId: context.operationId, key: context.key, items: value.items,
          references: structuredClone(references), policy: { ...context.policy } });
      });
    }
    if (!busy && (recovery || rows.some(row => row.state === 'waiting' && !row.attempt?.failed))) {
      button(content, recovery ? '核对并继续' : '继续未处理', () => resume());
    }
    error = add(content, 'p'); error.className = 'purchase-error'; error.setAttribute('role', 'status');
    updateTotals();
  };
  return Object.freeze({
    show(value, { running: active = false } = {}) {
      const first = outcome === null;
      revision++; outcome = value; context = value?.retryContext ?? null; running = active; busy = active; actionError = '';
      references = Object.fromEntries((value?.results ?? []).filter(row => row.reference).map(row => [row.definitionId, row.reference]));
      edits = new Map((value?.results ?? []).filter(failed).map(row => [row.definitionId, row.reference?.maxBuy ?? null]));
      selected = new Set(edits.keys()); render();
      if (first) parent.scrollTop = 0;
    },
    dispose() { disposed = true; revision++; root.remove(); },
  });
}
