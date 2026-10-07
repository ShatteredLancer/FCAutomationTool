import { createFodderDialog } from './fc27-fodder-trade-ui.js';
import { mountListingCurrency, currencyInputStyles } from './fc27-listing-currency.js';

// Fodder AI/PI: individual typed prices, same-version inheritance, additive
// adjustment, paid fallback to market, one wait slider and two distinct actions.
export function mountFc27FodderListView({ document, parent, service, accountScope, isActive = () => true }) {
  const { dialog, body, footer, add } = createFodderDialog(document, parent, 'gallery-fodder-list-dialog', 'To Transfer List');
  add(dialog, 'style', currencyInputStyles);
  const setting = label => { const row = add(body, 'div', '', 'fd-setting'); add(row, 'span', label); return add(row, 'div', '', 'fd-options'); };
  const duration = add(setting('Duration'), 'select'); duration.setAttribute('aria-label', 'Duration');
  for (const h of [1,3,6,12,24,72]) { const option = add(duration, 'option', `${h} Hour${h > 1 ? 's' : ''}`); option.value = String(h * 3600); }
  let from = 'market', adjustment = 0, busy = false, prepared = null, identity = null, resumeRunId = null, targetCurrent = () => true, disposed = false, finished = false;
  const selected = new Set(), overrides = {}, rows = new Map();
  let lastSelected = null;
  const current = () => !disposed && dialog.open && isActive() && identity === accountScope() && targetCurrent();
  const button = (parent, text, action) => { const el = add(parent, 'button', text); el.type = 'button'; el.addEventListener('click', event => { if (event.isTrusted && !busy && current()) action(); }); return el; };
  const bases = setting('From');
  const market = button(bases, 'Market', () => { from = 'market'; render(); });
  const paid = button(bases, 'Bought for', () => { from = 'paid'; render(); });
  const check = button(setting('Prices'), 'Check market prices', async () => {
    lock(true); output.textContent = 'Checking…'; let errorText = '';
    const definitionIds = [...new Set(prepared.candidates.filter(row => selected.has(row.item.id)
      && !prepared.candidates.some(other => other.item.definitionId === row.item.definitionId && overrides[other.item.id] != null))
      .map(row => row.item.definitionId))];
    try { const reply = await service.refreshQuotes({ isCurrent: current, definitionIds }); if (current()) {
      if (reply.status === 'blocked') throw Error(reply.reason);
      prepared.prices = reply.prices; prepared.expiresAt = reply.expiresAt;
    } }
    catch (error) { errorText = error.message; }
    finally { lock(false); render(); if (errorText) output.textContent = errorText; }
  });
  const adjust = setting('Adjust');
  for (const pct of [-5,5,10,20]) button(adjust, `${pct > 0 ? '+' : ''}${pct}%`, () => { adjustment += pct; render(); });
  const totalAdjust = add(adjust, 'span'); button(adjust, '×', () => { adjustment = 0; render(); }).setAttribute('aria-label', 'Clear adjustment');
  const waitRow = setting('Wait'), wait = add(waitRow, 'input'); wait.type = 'range'; wait.min = '2'; wait.max = '15'; wait.step = '1'; wait.value = '5'; wait.setAttribute('aria-label', 'Wait');
  const waitLabel = add(waitRow, 'span', '5 s'); wait.addEventListener('input', () => { waitLabel.textContent = `${wait.value} s`; });
  const head = add(body, 'div', '', 'fd-row fd-head'), all = add(head, 'input'); all.type = 'checkbox'; all.setAttribute('aria-label', 'All cards');
  for (const label of ['OVR','Player','Rarity','Buy now','Profit']) add(head, 'span', label);
  const table = add(body, 'div'), progress = add(body, 'progress'); progress.hidden = true;
  const output = add(body, 'output'); output.setAttribute('role', 'status');
  const net = add(footer, 'span', '', 'fd-net');
  const cancel = add(footer, 'button', 'Cancel Esc'); cancel.addEventListener('click', () => { if (!busy) dialog.close(); });
  const transfer = button(footer, 'Send to Transfer List', () => run(true));
  const submit = button(footer, 'List 0 cards Enter', () => run(false)); submit.className = 'primary';
  const stop = add(footer, 'button', 'Stop'); stop.hidden = true;
  stop.addEventListener('click', event => { if (event.isTrusted && busy) { service.stop(); stop.disabled = true; } });
  const settings = () => ({ delaySeconds: [Number(wait.value), Number(wait.value)] });
  const lock = value => { busy = value; for (const el of dialog.querySelectorAll('button,input,select')) el.disabled = value; stop.hidden = !value; stop.disabled = false; };
  const plan = () => service.planFodder({ selectedIds: [...selected], from, adjustment, overrides, durationSeconds: Number(duration.value) });
  const render = () => {
    if (!prepared || busy || resumeRunId || finished) return;
    market.setAttribute('aria-pressed', String(from === 'market')); paid.setAttribute('aria-pressed', String(from === 'paid'));
    totalAdjust.textContent = `${adjustment > 0 ? '+' : ''}${adjustment}%`;
    const value = plan(); let proceeds = 0;
    for (const [id, row] of rows) {
      const bin = value.bins?.[id]; row.currency.setValue(bin);
      row.check.checked = selected.has(id);
      const cost = row.entry.boughtFor ?? row.entry.purchase?.purchasePrice;
      const amount = bin > 0 && (cost > 0 || row.entry.boughtForSource === 'first-owner') ? Math.round(bin * .95) - (cost ?? 0) : null;
      row.profit.textContent = amount == null ? '—' : `${amount > 0 ? '+' : ''}${amount.toLocaleString()}`; row.profit.dataset.negative = String(amount < 0);
      row.state.textContent = value.skipped?.find(item => item.itemId === id)?.reason ?? '';
    }
    for (const entry of value.entries ?? []) proceeds += Math.round(entry.buyNow * .95);
    net.textContent = `You receive ${proceeds.toLocaleString()} after EA tax`;
    submit.textContent = `List ${value.entries?.length ?? 0} cards Enter`; submit.disabled = !value.entries?.length || !prepared.liveEnabled;
    transfer.disabled = !selected.size || !prepared.liveEnabled; all.checked = selected.size === rows.size && rows.size > 0;
    output.textContent = `${prepared.source ?? 'Market'} · ${value.skipped?.length ?? 0} skipped`;
  };
  all.addEventListener('change', event => { if (!event.isTrusted || busy) return; selected.clear(); if (all.checked) for (const id of rows.keys()) selected.add(id); render(); });
  duration.addEventListener('change', () => { if (!busy) render(); });
  const showResult = value => {
    progress.max = value.total || 1; progress.value = value.completed || 0;
    for (const entry of value.entries ?? []) {
      const row = rows.get(entry.item.id); if (row) row.state.textContent = `${entry.action === 'transfer' ? 'Transfer' : 'List'}: ${entry.status}${entry.reason ? ` · ${entry.reason}` : ''}`;
    }
    output.textContent = `${value.completed ?? 0}/${value.total ?? 0} · ${value.accepted ?? 0} done${value.reason ? ` · ${value.reason}` : ''}`;
  };
  const run = async transferOnly => {
    if (busy || !current() || finished) return;
    const approvedPlan = resumeRunId ? null : transferOnly ? service.planTransfer({ selectedIds: [...selected] }) : plan();
    if (!resumeRunId && !approvedPlan?.entries?.length) return;
    lock(true); progress.hidden = false;
    try {
      const result = await service.execute({ approved: true, plan: approvedPlan, settings: settings(), resume: !!resumeRunId,
        expectedRunId: resumeRunId, isCurrent: current, onProgress: value => { if (current()) showResult(value); } });
      if (!current()) return; showResult(result);
      const state = await service.inspect(); resumeRunId = state.status === 'observed' && state.state !== 'completed' ? state.runId : null;
      finished = !resumeRunId;
    } catch (error) { output.textContent = `结果待核对 · ${error.message}`; }
    finally { lock(false); transfer.disabled = true; submit.textContent = resumeRunId ? '核对并继续' : 'Completed'; submit.disabled = !resumeRunId; cancel.textContent = 'Close Esc'; }
  };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('keydown', event => { if (event.isTrusted && event.key === 'Enter' && event.target.tagName !== 'INPUT' && !submit.disabled && !busy) { event.preventDefault(); void run(false); } });
  return { async open({ target = null, isTargetCurrent = () => true } = {}) {
    if (busy) return; identity = accountScope(); targetCurrent = isTargetCurrent; prepared = null; resumeRunId = null; finished = false;
    selected.clear(); rows.clear(); lastSelected = null; table.replaceChildren(); for (const key of Object.keys(overrides)) delete overrides[key];
    from = 'market'; adjustment = 0; progress.hidden = true; dialog.showModal(); lock(true); output.textContent = 'Loading…';
    cancel.textContent = 'Cancel Esc';
    try {
      const value = await service.prepare({ isCurrent: current, target }); if (!current()) return;
      if (value.status === 'resume-required') { resumeRunId = value.runId; showResult(value); return; }
      if (value.status !== 'ready') { output.textContent = value.reason; return; }
      prepared = value;
      for (const entry of value.candidates) {
        const tr = add(table, 'div', '', 'fd-row'), box = add(tr, 'input'); box.type = 'checkbox'; box.setAttribute('aria-label', `选择 ${entry.name}`);
        const raw = service.readDisplayItem?.(entry.item);
        add(tr, 'span', String(raw?.rating ?? raw?._rating ?? ''));
        add(tr, 'span', entry.name, 'fd-who'); add(tr, 'span', raw?.rareflag === 0 ? 'Common' : raw?.rareflag === 1 ? 'Rare' : '—');
        const price = add(tr, 'div'), currency = mountListingCurrency({ document, parent: price, label: `${entry.name} Buy Now`, enabled: () => !busy,
          onCommit: amount => { if (amount == null) delete overrides[entry.item.id]; else {
            overrides[entry.item.id] = amount;
            selected.add(entry.item.id);
            for (const other of prepared.candidates) if (other.item.definitionId === entry.item.definitionId && overrides[other.item.id] == null) selected.add(other.item.id);
          } render(); } });
        const state = add(price, 'small'), profit = add(tr, 'span', '', 'fd-profit');
        rows.set(entry.item.id, { entry, check: box, currency, state, profit });
        // Fodder preselects owned entities even when their market price is unknown.
        selected.add(entry.item.id);
        box.addEventListener('click', event => {
          if (!event.isTrusted || busy || finished) return;
          const ids = [...rows.keys()], index = ids.indexOf(entry.item.id), anchor = event.shiftKey && lastSelected != null ? lastSelected : index;
          for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) {
            if (box.checked) selected.add(ids[i]); else selected.delete(ids[i]);
          }
          lastSelected = index; render();
        });
      }
    } catch (error) { output.textContent = error.message; }
    finally { lock(false); if (resumeRunId) { submit.textContent = '核对并继续'; transfer.disabled = true; } else if (prepared) render(); else submit.disabled = transfer.disabled = true; check.disabled = !prepared; }
  }, dispose() { disposed = true; service.stop(); dialog.remove(); } };
}
