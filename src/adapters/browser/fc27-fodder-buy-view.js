import { createFodderDialog } from './fc27-fodder-trade-ui.js';
import { fodderAttemptCap } from '../../gallery/fodder-trade-options.js';
import { purchasePriceCap } from '../../gallery/public-price-policy.js';
import { bindCurrencyArrows } from './fc27-listing-currency.js';

const retryMessages = {
  FC27_BUY_REFERENCE_PRICE_UNAVAILABLE: '所选来源无报价',
  FC27_BUY_REFERENCE_PRICE_EXPIRED: '报价已过期，请刷新参考价',
  FC27_BUY_RETRY_CAP_INVALID: '重试上限无效',
  FC27_PUBLIC_PRICE_FUTBIN_DISABLED: 'FUTBIN 读取已关闭，请重新生成方案',
  FC27_PUBLIC_PRICE_FUTGG_DISABLED: 'FUT.GG 读取已关闭，请重新生成方案',
};
const retryFailed = row => row.state === 'waiting' && row.attempt?.failed === true;
const retryRecovered = row => ['club', 'unassigned', 'acquired', 'collected'].includes(row.state);
const retryUncertain = row => ['buy-pending', 'bought', 'move-pending', 'move-rejected'].includes(row.state);

// Fodder has its own result screen. The generic Gallery/Puzzle result editor
// intentionally remains Enhancer-style and is never mounted in this view.
function mountFodderRetryResults({ document, parent, refreshPrices, retry, resume, isCurrent }) {
  let outcome = null, context = null, references = {}, edits = new Map(), selected = new Set();
  let busy = false, running = false, disposed = false, errorText = '';
  const add = (host, tag, text = '', className = '') => {
    const node = document.createElement(tag); node.textContent = text; if (className) node.className = className;
    host.append(node); return node;
  };
  const root = add(parent, 'div', '', 'fd-retry-screen');
  const render = () => {
    if (disposed) return;
    root.replaceChildren();
    if (!outcome) return;
    const rows = outcome.results ?? [], failed = rows.filter(retryFailed);
    const pending = rows.filter(row => row.state === 'waiting' && !retryFailed(row));
    const recovery = outcome.status === 'recovery-required' || outcome.recovery || rows.some(retryUncertain);
    const head = add(root, 'div', '', 'fd-retry-head');
    add(head, 'strong', 'Purchase results');
    add(head, 'span', `${outcome.purchased ?? rows.filter(retryRecovered).length} bought · Spent ${(outcome.spent ?? 0).toLocaleString()}`);
    const layout = add(root, 'div', '', 'fd-retry-layout');
    const table = add(layout, 'div', '', 'fd-retry-table');
    const header = add(table, 'div', '', 'fd-retry-row fd-retry-head-row');
    for (const label of ['','OVR','PLAYER','STATUS','BUY NOW']) add(header, 'small', label);
    for (const row of rows.filter(item => !retryRecovered(item))) {
      const line = add(table, 'div', '', 'fd-retry-row');
      const box = add(line, 'input'); box.type = 'checkbox'; box.checked = selected.has(row.definitionId);
      box.disabled = busy || !retryFailed(row); box.addEventListener('change', () => {
        if (box.checked) selected.add(row.definitionId); else selected.delete(row.definitionId); renderActions();
      });
      add(line, 'strong', String(row.overall ?? row.rating ?? '—'));
      const who = add(line, 'div', '', 'fd-retry-who'); add(who, 'strong', row.name || `#${row.definitionId}`);
      const active = running && outcome.definitionId === row.definitionId;
      add(line, 'span', active ? (outcome.phase ?? 'Buying') : retryFailed(row) ? 'Not found'
        : row.state === 'waiting' ? 'Pending' : (row.state || 'Pending'), 'fd-retry-state');
      const input = add(line, 'input'); input.type = 'number'; input.min = '150';
      input.setAttribute('aria-label', `Retry ${row.name || row.definitionId}`);
      input.value = edits.get(row.definitionId) ?? row.reference?.maxBuy ?? '';
      input.disabled = busy || recovery || !retryFailed(row);
      const changed = () => { edits.set(row.definitionId, input.value === '' ? null : Number(input.value)); renderActions(); };
      input.addEventListener('input', changed);
      bindCurrencyArrows({ document, input, label: `Retry ${row.name || row.definitionId}`, enabled: () => !busy && retryFailed(row),
        limits: () => ({ minimum: 150, maximum: Math.min(15000000, context?.absoluteCap ?? 15000000,
          context?.balance ?? 15000000, context?.remainingBudget ?? 15000000) }), onStep: value => { input.value = String(value); changed(); } });
    }
    const side = add(layout, 'div', '', 'fd-retry-side');
    add(side, 'strong', running ? 'Purchase progress' : `${failed.length} failed · ${pending.length} pending`);
    const progress = add(side, 'progress'); progress.max = outcome.total || rows.length || 1; progress.value = outcome.completed || 0;
    add(side, 'small', `${outcome.completed ?? 0}/${outcome.total ?? rows.length} completed`);
    if (rows.some(row => row.state === 'acquired')) add(side, 'small', '买入已确认；部分卡当前不在 Club/Unassigned，未宣称已入库，也不会重买。');
    if (outcome.collection?.status === 'pending') add(side, 'small', '画廊计分待 EA 同步，不影响已确认成交。');
    add(side, 'small', running ? '正在购买，可点击 Stop 停止后续操作。' : recovery ? '成交或入库结果待核对，请先核对并继续。'
      : pending.length ? '尚未处理的卡请点击 Continue pending，沿用本批价格设置。' : 'Select failed players and adjust Buy Now before retrying.');
    if (outcome.reason) add(side, 'output', outcome.reason);
    const totals = add(side, 'output', '', 'fd-retry-total');
    const actions = add(root, 'div', '', 'fd-retry-actions');
    const retryButton = add(actions, 'button', `Retry selected (${selected.size})`); retryButton.className = 'primary';
    retryButton.disabled = busy || !selected.size || !context || !isCurrent();
    retryButton.addEventListener('click', async event => {
      if (!event.isTrusted || retryButton.disabled || disposed || !isCurrent()) return;
      busy = true; render();
      try {
        const items = [...selected].map(definitionId => ({ definitionId, maxBuy: edits.get(definitionId) }));
        const total = items.reduce((sum, item) => sum + (Number.isFinite(item.maxBuy) ? item.maxBuy : 0), 0);
        if (items.some(item => purchasePriceCap({ ...context, maxBuy: item.maxBuy }) !== item.maxBuy)
            || total > (context.remainingBudget ?? Infinity) || total > (context.balance ?? Infinity)) throw Error('FC27_BUY_RETRY_CAP_INVALID');
        await retry({ operationId: context.operationId, key: context.key, items,
          references: structuredClone(references), policy: { ...context.policy } });
      } catch (reason) { errorText = retryMessages[reason?.message] ?? reason?.message ?? 'Retry failed'; }
      finally { busy = false; render(); }
    });
    const refresh = add(actions, 'button', 'Refresh prices'); refresh.disabled = busy || recovery || !failed.length || !refreshPrices;
    refresh.addEventListener('click', async event => {
      if (!event.isTrusted || refresh.disabled || disposed || !isCurrent()) return;
      busy = true; render();
      try {
        const snapshot = await refreshPrices(failed.map(row => row.definitionId), { force: true, isCurrent: () => !disposed && isCurrent() });
        if (disposed || !isCurrent()) return;
        references = { ...references, ...snapshot.references }; context = { ...context, policy: snapshot.policy ?? context.policy }; errorText = '';
      } catch (reason) { errorText = retryMessages[reason?.message] ?? 'Unable to refresh prices'; }
      finally { busy = false; render(); }
    });
    const resumeButton = add(actions, 'button', recovery ? 'Check and continue' : `Continue pending (${pending.length})`);
    resumeButton.hidden = !recovery && !pending.length;
    resumeButton.disabled = busy; resumeButton.addEventListener('click', async event => {
      if (!event.isTrusted || busy || disposed || !isCurrent()) return;
      busy = true; render();
      try { await resume(); } finally { busy = false; render(); }
    });
    if (errorText) add(root, 'p', errorText, 'fd-retry-error');
    const update = () => {
      const total = [...selected].reduce((sum, id) => sum + (Number.isFinite(edits.get(id)) ? edits.get(id) : 0), 0);
      totals.textContent = `${selected.size} selected · Maximum ${total.toLocaleString()} coins · ${context?.policy?.purchaseAttempts ?? '—'} attempts/player`;
      retryButton.textContent = `Retry selected (${selected.size})`;
      retryButton.disabled = busy || recovery || !selected.size || !context || !isCurrent();
    };
    renderActions = update; update();
  };
  let renderActions = () => {};
  return { show(value) {
    outcome = value; context = value?.retryContext ?? null;
    references = Object.fromEntries((value?.results ?? []).filter(row => row.reference).map(row => [row.definitionId, row.reference]));
    edits = new Map((value?.results ?? []).filter(retryFailed).map(row => [row.definitionId, row.reference?.maxBuy ?? null]));
    selected = new Set(edits.keys()); errorText = ''; render();
  }, progress(value) {
    outcome = { ...outcome, ...value }; running = busy = true; render();
  }, finish(error = null) { running = busy = false; if (error !== null) errorText = error; render(); },
  dispose() { disposed = true; root.remove(); } };
}

export function mountFc27FodderBuyView({ document, parent, purchase, accountScope, host = null, nativeRenderer = null, readCard = () => null, isActive = () => true, onChanged = () => {} }) {
  const { dialog, body, footer, add } = createFodderDialog(document, parent, 'gallery-fodder-buy-dialog', 'Gallery · Buy Players');
  dialog.style.width = '960px';
  const layout = add(body, 'div', '', 'fd-buy-layout'), table = add(layout, 'div'), side = add(layout, 'div', '', 'fd-buy-options');
  const field = label => { const row = add(side, 'div', '', 'fd-setting'); add(row, 'span', label); return add(row, 'div', '', 'fd-options'); };
  const range = field('Price range'), rangeText = add(range, 'strong'), track = add(range, 'div', '', 'fd-dual-range'), inputs = [];
  for (const label of ['Lowest price %', 'Highest price %']) {
    const el = add(track, 'input'); el.type = 'range'; el.min = '75'; el.max = '200'; el.step = '5'; el.value = '100'; el.setAttribute('aria-label', label); inputs.push(el);
  }
  let tries = 3, busy = false, identity = null, input = null, preview = null, outcome = null, disposed = false, retryView = null;
  const current = () => !disposed && isActive() && accountScope() === identity && dialog.open;
  const buttons = [], choices = field('Attempts per player');
  for (let n = 1; n <= 5; n++) {
    const button = add(choices, 'button', String(n)); button.type = 'button'; buttons.push(button);
    button.addEventListener('click', event => { if (event.isTrusted && !busy) { tries = n; summary(); } });
  }
  const progress = add(side, 'progress'); progress.max = 1; progress.value = 0;
  const bought = add(side, 'strong', '0 bought'), spent = add(side, 'div', 'Spent 0');
  const ledger = add(side, 'div', '', 'fd-ledger');
  const totals = add(side, 'output', '', 'fd-totals'), notice = add(side, 'output'); notice.setAttribute('role', 'status');
  const retryRoot = add(body, 'div'); retryRoot.hidden = true;
  const close = add(footer, 'button', 'Close Esc'), start = add(footer, 'button', 'Auto-buy 0 players Enter'); start.className = 'primary';
  const stop = add(footer, 'button', 'Stop'); stop.hidden = true;
  const options = () => ({ minPct: Number(inputs[0].value), maxPct: Number(inputs[1].value), tries });
  const nativeCards = new Set();
  const clearCards = () => { for (const card of nativeCards) { try { card.__fcatDealloc?.(); card.remove(); } catch { /* display only */ } } nativeCards.clear(); };
  const summary = () => {
    rangeText.textContent = `${inputs[0].value}%–${inputs[1].value}%`;
    track.style.setProperty('--range-start', `${(Number(inputs[0].value) - 75) / 1.25}%`);
    track.style.setProperty('--range-end', `${(Number(inputs[1].value) - 75) / 1.25}%`);
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i + 1 === tries)));
    if (!preview) return;
    const sum = attempt => preview.approval.rows.reduce((total, row) => {
      if (row.maxBuy == null) return total;
      return total + (fodderAttemptCap({ options: options(), estimate: row.estimate, attempt,
        maxBuy: Math.min(row.maxBuy, preview.absoluteCap ?? Infinity), priceTiers: preview.priceTiers }) ?? 0);
    }, 0);
    totals.replaceChildren();
    for (const [label, value] of [['Players', preview.items.length], ['Minimum total', sum(1)], ['Maximum total', sum(tries)]]) {
      const line = add(totals, 'div'); add(line, 'span', label); add(line, 'strong', value.toLocaleString());
    }
    const missing = preview.approval.rows.filter(row => row.maxBuy == null).length;
    if (missing) add(totals, 'small', `${missing} 张缺价，合计不完整；这些卡不会下单。`);
    notice.textContent = `Destination ${preview.destination === 'unassigned' ? 'Unassigned' : 'Club'} · ${preview.approval.policy.source.toUpperCase()} · 实际上限取本批区间与已批准上限中的较低值`;
    start.textContent = `Auto-buy ${preview.items.length} players Enter`;
  };
  inputs.forEach((el, i) => el.addEventListener('input', () => { if (busy) return;
    if (Number(inputs[0].value) > Number(inputs[1].value)) inputs[1 - i].value = el.value; summary(); }));
  const lock = value => { busy = value; for (const el of [...side.querySelectorAll('input,button'), ...footer.querySelectorAll('button')]) el.disabled = value; stop.hidden = !value; stop.disabled = false; };
  const rows = new Map();
  const renderPlayers = items => {
    clearCards(); rows.clear(); table.replaceChildren();
    const head = add(table, 'div', '', 'fd-buy-row'); for (const text of ['', 'OVR','Player','Source','Price']) add(head, 'small', text);
    for (const item of items) {
      const line = add(table, 'div', '', 'fd-buy-row'), art = add(line, 'div', '', 'fd-mini-card');
      const raw = readCard(item.definitionId), slot = add(art, 'slot'); slot.name = `gallery-fodder-buy-${item.definitionId}`;
      let card = null;
      const fallback = () => { slot.remove(); card?.__fcatDealloc?.(); nativeCards.delete(card); };
      try { if (host && raw) card = nativeRenderer?.render?.({ parent: host, raw, slot: slot.name, label: item.name, onUnavailable: fallback }); } catch { /* text fallback */ }
      if (card) nativeCards.add(card); else fallback();
      const paid = add(art, 'small', '', 'fd-paid');
      add(line, 'strong', String(item.overall ?? item.rating ?? raw?.rating ?? raw?._rating ?? ''));
      const who = add(line, 'div'); add(who, 'strong', item.name || `#${item.definitionId}`);
      add(who, 'small', item.version ?? (raw?.rareflag === 0 ? 'Common' : raw?.rareflag === 1 ? 'Rare' : ''));
      const state = add(who, 'small');
      const source = add(line, 'span', 'Market', 'fd-source'), price = add(line, 'span',
        (item.priceReference?.estimate ?? item.reference?.estimate)?.toLocaleString() ?? '—', 'fd-amount');
      rows.set(item.definitionId, { source, price, state, paid });
    }
  };
  const show = value => {
    outcome = value;
    progress.max = value.total || preview?.items.length || 1; progress.value = value.completed || 0;
    bought.textContent = `${value.purchased ?? 0} bought`; spent.textContent = `Spent ${(value.spent ?? 0).toLocaleString()}`;
    ledger.replaceChildren();
    for (const row of value.results ?? []) {
      const cell = rows.get(row.definitionId);
      if (cell) {
        cell.source.textContent = ({ club: 'Club', unassigned: 'Unassigned', acquired: 'Bought · route unavailable', collected: 'Collected', waiting: row.attempt?.failed ? 'Not found' : 'Market', 'buy-pending': 'Buying', bought: 'Bought', 'move-pending': 'Moving', 'move-rejected': 'Not moved' })[row.state] ?? row.state;
        cell.price.textContent = row.reference?.estimate?.toLocaleString() ?? cell.price.textContent;
        cell.price.classList.toggle('fd-acquired', ['club', 'unassigned', 'acquired', 'collected'].includes(row.state));
        cell.paid.textContent = row.price > 0 ? row.price.toLocaleString() : '';
        cell.state.textContent = row.reason ?? '';
      }
      if (row.price > 0) { const line = add(ledger, 'div'); add(line, 'span', row.name || String(row.definitionId)); add(line, 'span', row.price.toLocaleString()); }
    }
    notice.textContent = `${value.phase ?? value.status ?? ''}${value.reason ? ` · ${value.reason}` : ''}${value.collection?.status === 'pending' ? ' · 收集进度待 EA 确认' : ''}`;
  };
  const retryPanel = result => {
    layout.hidden = true; retryRoot.hidden = false; start.hidden = true; stop.hidden = true;
    retryView?.dispose(); retryRoot.replaceChildren();
    retryView = mountFodderRetryResults({ document, parent: retryRoot, refreshPrices: purchase.refreshPrices,
      isCurrent: current, retry: retry => execute({ resume: true, expectedOperationId: retry.operationId, retry }),
      resume: () => execute({ resume: true, expectedOperationId: outcome?.operationId ?? input?.expectedOperationId }) });
    retryView.show(result);
  };
  const execute = async override => {
    if (busy || !current()) return;
    lock(true);
    layout.hidden = false; retryRoot.hidden = true; start.hidden = true; body.scrollTop = 0;
    if (override?.resume) {
      if (!rows.size) renderPlayers(outcome?.results ?? []);
      if (outcome) show(outcome);
      const caps = override.retry?.items ?? (outcome?.results ?? []).filter(row => row.state === 'waiting' && !retryFailed(row))
        .map(row => ({ definitionId: row.definitionId, maxBuy: row.reference?.maxBuy }));
      totals.replaceChildren();
      const line = add(totals, 'div'); add(line, 'span', 'Players'); add(line, 'strong', String(caps.length));
      for (const item of caps) {
        const cell = rows.get(item.definitionId);
        if (cell) { cell.source.textContent = 'Market'; cell.state.textContent = `本次上限 ${item.maxBuy?.toLocaleString() ?? '沿用本批授权'}`; }
      }
      notice.textContent = '正在核对并继续本批购买…';
    }
    retryView?.progress({ phase: 'preparing' });
    try {
      const result = await purchase({ ...(override ?? { ...input, items: preview.items, batchOptions: options() }), approved: true,
        isCurrent: current, onProgress: value => { if (current()) { show(value); retryView?.progress(value); } } });
      if (!current()) return; show(result);
      const saved = await purchase.inspect(); if (!current()) return;
      // Error results may contain only item states; restore attempt and quote
      // details from the inspected journal rather than showing blank prices.
      if (saved.status === 'blocked') throw Error(saved.reason ?? 'FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED');
      outcome = { ...result, operationId: saved.operationId };
      retryPanel({ ...result, results: saved.results ?? result.results, recovery: saved.recovery,
        retryContext: saved.retryContext ?? result.retryContext });
      onChanged(result);
    } catch (error) {
      const message = `结果待核对 · ${error.message}`; notice.textContent = message; retryView?.finish(message);
      if (retryView) { layout.hidden = true; retryRoot.hidden = false; }
    }
    finally { retryView?.finish(); lock(false); start.disabled = true; start.textContent = outcome?.status === 'purchased' ? 'Completed' : 'Stopped'; }
  };
  start.addEventListener('click', event => { if (event.isTrusted && !busy && !start.disabled) void execute(); });
  stop.addEventListener('click', event => { if (event.isTrusted && busy) { purchase.stop(); stop.disabled = true; } });
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('close', clearCards);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('keydown', event => { if (event.isTrusted && event.key === 'Enter' && event.target.tagName !== 'INPUT' && !busy && !start.disabled) { event.preventDefault(); void execute(); } });
  return { async open(value) {
    if (busy) return; identity = accountScope(); input = value; preview = outcome = null;
    layout.hidden = false; retryRoot.hidden = true; start.hidden = false; stop.hidden = true;
    retryView?.dispose(); retryRoot.replaceChildren(); clearCards(); rows.clear(); table.replaceChildren(); ledger.replaceChildren();
    progress.value = 0; bought.textContent = '0 bought'; spent.textContent = 'Spent 0'; totals.textContent = ''; notice.textContent = 'Loading…';
    dialog.showModal(); lock(true);
    try {
      if (value.resume) { const saved = await purchase.inspect(); if (current()) { outcome = saved; show(saved); retryPanel(saved); } return; }
      preview = await purchase.preview(value.items); if (!current()) return;
      tries = Math.max(1, Math.min(5, preview.approval.policy.purchaseAttempts)); inputs.forEach(el => { el.value = '100'; });
      renderPlayers(preview.items);
      summary();
    } catch (error) { notice.textContent = error.message; preview = null; }
    finally { lock(false); start.disabled = !preview; }
  }, isBusy: () => busy, dispose() { disposed = true; purchase.stop(); clearCards(); retryView?.dispose(); dialog.remove(); } };
}
