import { normalizeStreamlinedProtectionFailure } from '../../streamlined/protection.js';

const number = value => Number.isSafeInteger(value) ? value.toLocaleString('en-US') : 'Unknown';
const quantity = (value, noun, plural = `${noun}s`) => `${number(value)} ${value === 1 ? noun : plural}`;
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_UNAVAILABLE';

export function streamlinedMarketMessage(result) {
  const source = { futbin: 'FUTBIN', futgg: 'FUT.GG' }[result.quoteSource] ?? 'Selected source';
  if (result.marketError === 'FC27_STREAMLINED_QUOTES_EXPIRED') {
    return `${source} market quotes expired while waiting and could not be refreshed. Generate a new plan. Expired quotes and other price sources are not used.`;
  }
  if (/QUOTE|PRICE|REFERENCE/.test(String(result.marketError ?? ''))) {
    return `${source} market quotes could not be loaded. No plan was generated. Check the price source connection and try again.`;
  }
  return 'Market candidates could not be verified. No purchase plan was generated. Check the FUT.GG catalog connection or choose Inventory only.';
}

export function streamlinedRouteSummary(route) {
  const cap = route.groups.filter(group => group.source === 'market')
    .reduce((sum, group) => sum + group.quantity * Math.max(...group.items.map(item => item.purchaseMaxBuy ?? item.price)), 0);
  const total = route.materialValue == null ? null : route.purchaseCost + route.materialValue;
  return `Total value ${number(total)} ◉ · To buy ${number(route.purchaseCost)} · Cap ${number(cap)} · ${number(route.score)} points · ${quantity(route.count, 'card')} (Inventory ${route.inventoryCount} / To buy ${route.marketCount}) · at least ${quantity(route.minBatches, 'batch', 'batches')}${route.repeatPurchaseCount ? ` · Repeat purchases ${route.repeatPurchaseCount}` : ''}`;
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
  const stages = { 'checking-source': 'Checking external cards', 'checking-club': 'Checking Club', 'journal-pending': 'Saving recovery record',
    'move-request': 'Moving to Club', 'move-acknowledged': 'Move receipt confirmed', 'club-readback': 'Verifying Club delivery', confirmed: 'Club delivery confirmed' };
  const label = p.phase === 'materialize' ? stages[p.stage] ?? 'Moving to Club'
    : { preflight: 'Preparing execution: checking the plan and records', 'checking-state': 'Checking inventory and capacity', search: 'Searching within the price cap',
      buying: 'Buying', moving: 'Moving to Club', 'partial-ready': 'Waiting to close the partial batch', validation: 'Checking cards',
      contribution: 'Contributing', reconciliation: 'Reconciling receipts', confirmed: 'Contribution confirmed', recovery: 'Reconciling previous records',
      replanning: 'Selecting the lowest-cost approved alternative', 'waiting-supply': 'Waiting to retry available supply', 'search-result': 'Search finished',
      'purchase-rejected': 'Purchase rejected by EA' }[p.phase] ?? 'Running';
  let text = `${Number.isSafeInteger(p.batchNumber) ? `Batch ${number(p.batchNumber)} · ` : ''}${label}`;
  if (p.playerName || Number.isSafeInteger(p.rating)) text += `\nCurrent candidate: ${p.playerName ?? 'Name unavailable'} · ${number(p.rating)} OVR · Cap ${number(p.maxBuy)} coins · Attempt ${number(p.attempt)} / ${number(p.attemptLimit)}`;
  if (p.purchaseTarget !== undefined) text += `\nPurchased ${number(p.purchased)} / ${number(p.purchaseTarget)} cards · Spent ${number(p.spent)} / ${number(p.budget)} coins`;
  text += `\nContributed ${number(p.contributed)} cards · Confirmed ${number(p.submittedScore)} / ${number(p.targetScore)} points`;
  if (p.readyCount !== undefined) text += `\nReady in this batch ${number(p.readyCount)} / ${number(p.selectionLimit)} cards · ${number(p.readyPoints)} points`;
  if (p.phase === 'materialize') text += `\nExternal cards ${number(p.completed)} / ${number(p.materialTotal)} cards`;
  if (p.phase === 'waiting-supply') text += `\nSupply retry ${number(p.attempt)} / ${number(p.attemptLimit)}`;
  return text;
}

export function streamlinedExecutionClock(p, elapsedMs = 0, phaseElapsedMs = 0, active = true) {
  const seconds = ms => Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  let text = `Elapsed ${seconds(elapsedMs)} s`;
  if (active) text += ` · Current step ${seconds(phaseElapsedMs)} s`;
  if (active && p?.phase === 'partial-ready' && Number.isSafeInteger(p.waitMs)) {
    text += ` · Estimated batch wait remaining ${Math.ceil(Math.max(0, p.waitMs - Math.max(0, phaseElapsedMs)) / 1000)} s`;
  }
  if (active && p?.phase === 'waiting-supply' && Number.isSafeInteger(p.waitMs)) {
    text += ` · Supply retry wait remaining ${Math.ceil(Math.max(0, p.waitMs - Math.max(0, phaseElapsedMs)) / 1000)} s`;
  }
  return text;
}

export function streamlinedExecutionMessage(reason, recovery = null, protection = null) {
  if (reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED') {
    const evidence = normalizeStreamlinedProtectionFailure(protection);
    const labels = {
      'protection-lock-list': 'The FSU lock list is unavailable or invalid. Ensure FSU Local is enabled and initialized, then refresh. Keep your cards locked.',
      'protection-active-id': 'The active squad ID could not be verified. Open your active squad in Squads, then return to generate a plan.',
      'protection-active-state': 'The active squad status could not be verified. Confirm the squad is active in Squads. Export diagnostics if the issue persists.',
      'protection-native-id': 'The cached squad ID does not match the active squad. Export diagnostics.',
      'protection-layout': 'The native squad slot layout could not be verified. Export diagnostics.',
      'protection-slot-list': `The native squad slot list is incomplete (${number(evidence?.count)} / ${number(evidence?.requiredSlots)}). Export diagnostics.`,
      'protection-slot-id': 'An item ID in the active squad could not be verified. Export diagnostics.',
      'protection-fsu-roster': 'The FSU active squad snapshot is unavailable or invalid. Export diagnostics.',
      'protection-cache': 'The active squad cache is missing and no verified snapshot matches this account and squad. Export diagnostics.',
    };
    return `${labels[evidence?.phase] ?? 'Card locks or the active squad could not be verified. Open your active EA squad and try again. Export diagnostics if the issue persists.'} No new cards were contributed.`;
  }
  if (reason === 'FC27_BUY_RECOVERY_REQUIRED') {
    const target = recovery?.kind === 'puzzle-purchase' && Number.isSafeInteger(recovery.setId) && Number.isSafeInteger(recovery.challengeId)
      ? ` (Set ${recovery.setId} / Challenge ${recovery.challengeId})` : '';
    const phase = { 'save-pending': 'Squad replacement has not been reconciled', ready: 'Purchase or Club delivery has not been reconciled', saved: 'The purchase recovery marker is unresolved' }[recovery?.phase];
    const labels = { waiting: 'Not purchased', 'buy-pending': 'Purchase unconfirmed', bought: 'Purchased, awaiting delivery',
      'move-pending': 'Delivery unconfirmed', 'move-rejected': 'Delivery rejected', club: 'In Club' };
    const counts = Object.entries(labels).flatMap(([state, label]) => {
      const count = recovery?.states?.[state];
      return Number.isSafeInteger(count) && count > 0 && count <= 32 ? [`${label} ${count}`] : [];
    });
    if (Number.isSafeInteger(recovery?.applied) && recovery.applied >= 0 && recovery.applied <= 32) counts.push(`Confirmed replacements ${recovery.applied}`);
    return `This account has an unresolved Puzzle purchase record${target}${phase ? `: ${phase}` : ''}. ${counts.length ? `Record states: ${counts.join(', ')}. ` : ''} Open that SBC's bulk purchase window to reconcile the record. If the SBC has expired, keep the record and export diagnostics. No cards were contributed.`;
  }
  const messages = {
    FC27_STREAMLINED_STOPPED: 'Stopped. Confirmed purchases are retained. Resume with the execution button; unresolved receipts are checked first.',
    FC27_STREAMLINED_NO_AFFORDABLE_CARDS: 'Paused: no executable purchase candidate for the current plan. Confirmed purchases have been retained.',
    FC27_STREAMLINED_PURCHASE_NO_SUPPLY: 'Paused after bounded retries: no approved candidate was available within the frozen price caps. Purchases are retained. Retry later or generate a new plan; no receipt recovery is needed for a normal shortage.',
    FC27_STREAMLINED_PURCHASE_CAPACITY_FULL: 'Unassigned capacity is full. Clear space manually, then retry. No market search or automatic disposal was performed.',
    FC27_STREAMLINED_PURCHASE_VERSION_HELD: 'The remaining versions are already held in Club and are not approved inventory materials. Choose another route or explicitly approve those stock cards; they will not be consumed automatically.',
    FC27_STREAMLINED_PURCHASE_BUDGET_LIMIT: 'The remaining approved budget cannot cover this purchase. No cap was raised. Generate a new plan to approve a different budget.',
    FC27_STREAMLINED_PURCHASE_PRICE_UNVERIFIED: 'A purchase price could not be verified. No purchase was authorized from that quote. Refresh the plan or export diagnostics.',
    FC27_STREAMLINED_PURCHASE_HOLDINGS_UNVERIFIED: 'Current Club holdings could not be verified. No missing cache entry was treated as permission to buy or consume a card. Retry or export diagnostics.',
    FC27_BUY_SEARCH_FAILED: 'EA rejected the market search. No purchase was sent for that search. Retry later; export diagnostics if this persists.',
    FC27_STREAMLINED_PURCHASE_REJECTED: 'EA rejected the purchase attempts. Confirmed purchases are retained. This is not an unknown receipt or proof that the market has no supply.',
    FC27_BUY_NATIVE_REJECTED: 'EA rejected the purchase attempts. Confirmed purchases are retained. Retry later or export diagnostics.',
    FC27_BUY_INSUFFICIENT_COINS: 'EA reported insufficient coins for the purchase. Confirmed purchases are retained. No approved price cap or budget was increased.',
    FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED: 'The execution approval has expired. Confirmed transactions are retained. Click the execution button to approve another run; unresolved receipts will be checked first.',
    FC27_STREAMLINED_PURCHASE_QUOTE_EXPIRED: 'Public quotes expired and could not be refreshed. Purchased cards are retained. Generate a fresh plan; no cap was raised.',
    FC27_STREAMLINED_PURCHASE_RECOVERY_REQUIRED: 'A purchase, delivery or previous plan needs reconciliation. Reconcile before continuing; purchases will not be repeated.',
    FC27_STREAMLINED_PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED: 'This contribution has not been confirmed. Reconcile before continuing; it will not be submitted again.',
    FC27_STREAMLINED_PURCHASE_JOURNAL_READ_FAILED: 'The purchase record could not be read. Retry reconciliation or export diagnostics.',
    FC27_STREAMLINED_PURCHASE_JOURNAL_WRITE_FAILED: 'The purchase record could not be saved. Reconcile before continuing.',
    FC27_STREAMLINED_PROGRESS_CHANGED: 'The current points no longer match the plan. Execution stopped. Reconcile before continuing.',
    FC27_STREAMLINED_PROTECTION_UNVERIFIED: 'Card locks or the active squad could not be verified. Open your active EA squad and try again. No new cards were contributed.',
    FC27_STREAMLINED_POLICY_CHANGED: 'Card protection or settings changed. Reconcile the previous run, then generate a new plan.',
    FC27_STREAMLINED_MATERIAL_CHANGED: 'Selected cards changed or are protected by locks or the active squad. Execution stopped. Reconcile, then generate a new plan.',
    FC27_BUY_JOURNAL_READ_FAILED: 'The Puzzle purchase record could not be read. Retry or export diagnostics. No record was cleared and no cards were contributed.',
    FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED: 'This account has an unresolved Gallery purchase. Reconcile it in the Gallery purchase window.',
    FC27_RECOVERY_REQUIRED: 'This account has an unresolved standard SBC submission. Reconcile that submission first.',
    FC27_STREAMLINED_INITIATION_UNVERIFIED: 'Start this SBC in the native EA interface, then generate a plan.',
    FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED: 'Contribution is not enabled in this build.',
    FC27_STREAMLINED_RECONCILIATION_REQUIRED: 'This contribution needs reconciliation. Click Check & recover; do not submit it again.',
    FC27_STREAMLINED_RECOVERY_REQUIRED: 'The previous contribution was dispatched but is not confirmed. Click Check & recover; do not submit it again.',
    FC27_STREAMLINED_CONTEXT_CHANGED: 'The account, SBC or points changed. Reopen the current SBC and generate a new plan.',
    FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED: `Another SBC (Set ${recovery?.setId ?? '?'} / Challenge ${recovery?.challengeId ?? '?'}) has an unresolved contribution. Nothing was resumed or submitted again in this SBC.`,
    FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED: `Another SBC (Set ${recovery?.setId ?? '?'} / Challenge ${recovery?.challengeId ?? '?'}) has an unresolved external card move (${recovery?.pendingCount ?? '?'} cards). Click Check & recover. This only checks Club delivery; it does not repeat moves, purchases or contributions.`,
    FC27_STREAMLINED_COMPLETED: 'The selected target is complete. No further contribution is needed.',
    FC27_STREAMLINED_PURCHASE_PENDING: 'This route needs market cards. Purchases and delivery must be confirmed before contribution.',
  };
  return messages[reason] ?? reason ?? 'Generate a new plan or reconcile the previous run.';
}

// Fodder's observed workflow: native work-area entry -> settings -> progress ->
// batches in one window. No private solver, prototype hook or EA writer.
export function mountFc27StreamlinedPanel({ document, readTarget, session, nativeRenderer = null,
  schedule = setInterval, unschedule = clearInterval, now = () => Date.now() } = {}) {
  if (!document?.body || document.getElementById('fcat-streamlined-entry')) return null;
  const add = (parent, tag, value = '') => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
  const entry = document.createElement('button'); entry.id = 'fcat-streamlined-entry'; entry.type = 'button';
  entry.textContent = 'FCAT Points Solver'; entry.className = 'btn-standard call-to-action';
  entry.style.cssText = 'margin:8px;min-height:38px';
  const host = document.createElement('div'); host.id = 'fcat-streamlined-panel'; document.body.append(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box} [hidden]{display:none!important}
    dialog{width:min(720px,94vw);max-width:94vw;max-height:88vh;overflow:hidden;background:#17232c;color:#ecf2f5;border:1px solid #53636d;border-radius:10px;padding:16px;font:14px/1.5 Arial,sans-serif}
    dialog::backdrop{background:#000a}header,footer,.tabs{display:flex;gap:10px;align-items:center}header{margin-bottom:12px}header strong{flex:1}footer{position:sticky;bottom:-16px;background:#17232c;padding:12px 0;justify-content:flex-end;border-top:1px solid #46545d}
    button,select,input{font:inherit;color:inherit;background:#25353f;border:1px solid #536570;border-radius:5px;padding:6px 9px;min-height:34px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true]{color:#b4f2d7;border-color:#b4f2d7}button.primary{background:#b4f2d7;color:#15251f}label{display:grid;gap:5px;min-width:0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.sources{display:flex;flex-wrap:wrap;gap:12px}.sources label{display:flex;align-items:center}input[type=checkbox]{min-height:0}small{display:block;color:#b4c4cd;margin:8px 0}output{display:block;white-space:pre-line;overflow-wrap:anywhere;margin:10px 0}.player-row{display:flex;align-items:center;gap:12px;min-height:92px;padding:8px 0;border-top:1px solid #364956}.player-card{flex:0 0 64px;position:relative;width:64px;height:88px;display:grid;place-items:center}.player-card slot{display:block;position:absolute;inset:0;width:144px;height:200px;transform:scale(.4444444);transform-origin:top left}.player-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:3px}.player-text strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.player-text span{font-size:12px;color:#b4c4cd}.player-points{flex:0 0 76px;text-align:right;color:#b4f2d7;font-variant-numeric:tabular-nums}.player-price{flex:0 0 82px;text-align:right;font-variant-numeric:tabular-nums}summary{padding:10px 0;cursor:pointer}.result-summary{font-size:16px;color:#b4f2d7}progress{width:100%;height:8px;accent-color:#b4f2d7} @media(max-width:500px){.fields{grid-template-columns:1fr}.player-row{gap:8px}.player-card{flex-basis:54px;width:54px;height:74px}.player-card slot{transform:scale(.375)}.player-points{flex-basis:62px}.player-price{flex-basis:68px}dialog{padding:12px}}
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
  </style><dialog aria-label="FCAT Streamlined SBC"><div class="panel-body"><header><strong>FCAT Points Solver</strong><button data-close aria-label="Close">×</button></header>
    <div data-target></div><div class="tabs"><button data-local aria-pressed="true">Current SBC</button><button data-global aria-pressed="false">Global settings</button></div>
    <section data-settings><div class="fields"><label>Planning objective<select data-objective><option value="lowest-value">Lowest total card value (inventory + purchases)</option><option value="lowest-coins">Lowest purchase cost, then inventory value</option><option value="fewest-cards">Fewest cards</option></select></label>
    <label>Card sources<select data-mode><option value="inventory-market">Inventory + market</option><option value="inventory">Inventory only</option><option value="market">Market only</option></select></label>
    <label>Maximum inventory rating<input data-rating type="number" min="1" max="99" step="1"></label><label>Maximum market rating<input data-market-rating type="number" min="1" max="99" step="1"></label><label>Partial batch wait (seconds)<input data-wait type="number" min="0" max="3600" step="1"></label></div><div class="sources"><label><input data-club type="checkbox">Club</label><label><input data-storage type="checkbox">SBC Storage</label><label><input data-unassigned type="checkbox">Unassigned</label><label><input data-transfer type="checkbox">Transfer List</label></div>
    <small>Inventory follows FSU card protection. Purchases use the selected price source. Estimates do not guarantee market availability. Selecting a route does not buy or contribute cards.</small><button data-save>Save settings</button></section>
    <section data-result></section></div>
    <footer><output data-status aria-live="polite"></output><progress aria-label="Execution progress" hidden></progress><small data-clock hidden></small><small data-final-progress hidden></small>
      <div class="actions"><button data-review-stock hidden>View inventory cards</button><button data-stop hidden>Stop</button><button data-recover>Check & recover</button><button data-solve class="primary">Generate plan</button><button data-contribute disabled hidden>Contribute selected batches</button></div></footer></dialog>`;
  const node = key => shadow.querySelector(`[data-${key}]`), dialog = shadow.querySelector('dialog');
  let target = null, origin = null, busy = false, disposed = false, global = false, opened = 0;
  const rendered = new Set();
  let renderGeneration = 0;
  let shown = null, selected = new Set();
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
    && (shown.plan.route?.groups?.some(g => g.source === 'market')
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
    origin = target; const serial = ++opened; dialog.showModal(); node('status').textContent = 'Loading requirements…'; node('result').replaceChildren(); node('contribute').hidden = true; clearRendered();
    setBusy(true);
    try {
      const result = await session.readSettings(); if (serial !== opened) return;
      const c = result.challenge, s = result.settings;
      node('target').textContent = `${c.name ?? 'Streamlined SBC'} · ${number(c.submittedScore)} / ${number(c.targetScore)} · Remaining ${number(c.remainingScore)}`;
      applySettings(s);
      node('status').textContent = 'Planning does not select or submit cards.'; selectScope(false);
    } catch (error) { if (serial === opened) node('status').textContent = safeReason(error); }
    finally { setBusy(false); }
  });
  on('save', async () => {
    if (busy) return; setBusy(true);
    try { await session.saveSettings(config(), global); node('status').textContent = global ? 'Global defaults saved. Settings for the current SBC take priority.' : 'Settings saved for this SBC.'; }
    catch (error) { node('status').textContent = safeReason(error); } finally { setBusy(false); }
  });
  const renderResult = result => {
      clearRendered(); node('result').replaceChildren(); node('contribute').hidden = true; shown = null;
      node('review-stock').hidden = true;
      if (!result.plan) {
        const output = node('result');
        if (result.reason === 'FC27_STREAMLINED_QUOTES_UNAVAILABLE') {
          add(output, 'div', 'Quotes are unavailable or expired. No plan was generated. Check the selected price source and try again.').className = 'result-summary';
          add(output, 'small', `${String(result.quoteSource).toUpperCase()} · ${result.quoteReadError}`);
        } else if (result.reason === 'FC27_STREAMLINED_MARKET_UNAVAILABLE') {
          add(output, 'div', streamlinedMarketMessage(result)).className = 'result-summary';
          if (result.marketError) add(output, 'small', `Market candidates unavailable: ${result.marketError}`);
        } else if (result.reason) {
          add(output, 'div', `No plan generated: ${result.reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED'
            ? streamlinedExecutionMessage(result.reason, null, result.protectionFailure) : result.reason}`).className = 'result-summary';
          if (result.reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED') add(output, 'small', `${result.reason}${result.protectionFailure?.phase ? ` · ${result.protectionFailure.phase}` : ''}`);
        }
        return;
      }
      shown = result;
      const marketRun = result.plan.route?.groups?.some(group => group.source === 'market') === true;
      node('contribute').textContent = marketRun ? 'Buy & contribute' : 'Contribute selected batches';
      const output = node('result'), p = result.progress;
      if (result.plan.execution?.quoteLimited === true) {
        const warning = add(output, 'section'); warning.className = 'inventory-warning';
        add(warning, 'strong', 'Quote coverage is incomplete. Review this plan; it may not be the cheapest across all inventory and market cards.');
        for (const [key, label] of [['inventory', 'Inventory'], ['market', 'Market']]) {
          const coverage = result.quoteCoverage?.[key];
          if (coverage) add(warning, 'small', `${label} quote coverage: valid ${number(coverage.valid)} / ${number(coverage.requested)} · failed ${number(coverage.failed)} · missing/expired ${number(coverage.missing)}; cards without valid quotes are excluded.`);
        }
        add(warning, 'small', 'Clicking the execution button accepts this displayed quote coverage, inventory list and purchase scope. No additional coverage checkbox is required.');
      }
      const inventoryReview = add(output, 'details'); inventoryReview.className = 'inventory-review'; inventoryReview.dataset.inventoryReview = ''; inventoryReview.open = true;
      const inventorySummary = add(inventoryReview, 'summary'), inventoryList = add(inventoryReview, 'div');
      let inventoryPage = 0;
      const updateInventoryReview = () => {
        inventoryList.replaceChildren();
        const rows = streamlinedInventoryPreview(result.plan, [...selected], result.record);
        const remaining = rows.filter(item => !item.consumed).length, consumed = rows.length - remaining;
        inventorySummary.textContent = `Inventory cards this plan will consume: ${quantity(remaining, 'card')}${consumed ? ` · Consumed ${quantity(consumed, 'card')}` : ''}`;
        node('review-stock').textContent = `Inventory ${quantity(remaining, 'card')} (view)`; node('review-stock').hidden = false;
        if (!rows.length) { add(inventoryList, 'small', 'This route or batch selection uses no existing inventory cards.'); return; }
        if (result.plan.policy?.protectFsuLockedPlayers !== true || result.plan.policy?.protectActiveSquad !== true) {
          add(inventoryList, 'small', 'This saved plan has old protection flags. Current card locks and the active squad will be checked before execution. Review the inventory list.').className = 'inventory-warning';
        }
        inventoryPage = Math.min(inventoryPage, Math.max(0, Math.ceil(rows.length / 50) - 1));
        for (const item of rows.slice(inventoryPage * 50, (inventoryPage + 1) * 50)) {
          const row = add(inventoryList, 'div'); row.className = `inventory-row${item.consumed ? ' consumed' : ''}`;
          add(row, 'strong', number(item.rating));
          const text = add(row, 'div'); add(text, 'strong', item.name ?? `Version ${item.definitionId} (name unavailable)`);
          const pile = { club: 'Club', storage: 'SBC Storage', unassigned: 'Unassigned → Club', transfer: 'Transfer List → Club' }[item.pile] ?? 'Source unverified';
          add(text, 'small', `${pile} · ${number(item.points)} points · ${item.price == null ? 'Value unknown' : `Value ${number(item.price)} coins`} · ${item.consumed ? 'Consumed' : 'Will consume'}`);
        }
        if (rows.length > 50) {
          add(inventoryList, 'small', `Showing ${inventoryPage * 50 + 1}–${Math.min((inventoryPage + 1) * 50, rows.length)} / ${rows.length} cards`);
          for (const [label, delta] of [['Previous', -1], ['Next', 1]]) {
            const button = add(inventoryList, 'button', label); button.type = 'button';
            button.disabled = delta < 0 ? inventoryPage === 0 : (inventoryPage + 1) * 50 >= rows.length;
            button.addEventListener('click', () => { inventoryPage += delta; updateInventoryReview(); });
          }
        }
      };
      if (marketRun) {
        const label = add(output, 'label', 'Total purchase budget (coins)'), budget = add(label, 'input');
        budget.type = 'number'; budget.min = '0'; budget.step = '1'; budget.dataset.purchaseBudget = '';
        budget.value = String(result.record?.budget ?? result.plan.route.groups.filter(group => group.source === 'market')
          .reduce((sum, group) => sum + group.quantity * Math.max(...group.items.map(item => item.purchaseMaxBuy ?? item.price)), 0));
        if (result.record) { budget.dataset.settled = 'true'; budget.disabled = true; }
        add(output, 'small', `Attempts per card: ${number(result.plan.execution?.purchaseAttempts ?? 3)} · Partial batch wait: ${number((result.plan.execution?.partialWaitMs ?? 60000) / 1000)} s · Each click approves up to 10 minutes of execution. Progress is retained on expiry.`);
        const scope = result.plan.execution?.purchaseScope;
        if (scope) {
          const pool = add(output, 'details'), rows = scope.groups.flatMap(group => group.items);
          add(pool, 'summary', `Approved market substitution pool: ${quantity(rows.length, 'version')}`);
          add(pool, 'small', 'Execution may select a lower-cost feasible recipe from these versions within the total budget and each frozen cap. Existing inventory is limited to the displayed selected stock IDs. Estimated prices are not supply guarantees.');
          for (const item of rows) add(pool, 'small', `${item.name ?? `Version ${item.definitionId}`} · OVR ${item.rating} · ${number(item.points)} points · Estimate ${number(item.price)} · Cap ${number(item.purchaseMaxBuy)} coins`);
        }
      }
      if (result.routes?.length) {
        const routes = add(output, 'div'); routes.className = 'route-list';
        for (const route of result.routes) {
          const button = add(routes, 'button', streamlinedRouteSummary(route));
          button.type = 'button'; button.style.cssText = 'display:block;width:100%;text-align:left;margin:6px 0';
          button.setAttribute('aria-pressed', String(route.id === result.selectedRoute));
          button.addEventListener('click', async event => {
            if (!event.isTrusted || busy) return; const serial = opened; setBusy(true);
            try { const next = await session.selectRoute(route.id); if (serial === opened) { renderResult(next);
              node('status').textContent = next.plan?.execution?.quoteLimited === true ? 'Quote coverage is incomplete. Review and confirm the selected route. No purchase or contribution has started.'
                : next.reason ?? 'Route selected. No purchase or contribution has started.'; } }
            catch (error) { node('status').textContent = safeReason(error); } finally { setBusy(false); }
          });
        }
      }
      add(output, 'div', `${result.status === 'ready' ? 'Target covered' : 'Partial plan'} · ${number(p.submitted)} submitted + ${number(p.added)} this plan · Remaining ${number(p.remaining)} / Excess ${number(p.excess)}`).className = 'result-summary';
      const total = result.materialValue == null ? null : result.purchaseCost + result.materialValue;
      add(output, 'small', `Total card value ${number(total)} coins · To buy ${number(result.purchaseCost)} coins · Inventory value ${number(result.materialValue)} · ${String(result.quoteSource).toUpperCase()} · ${quantity(result.items.length, 'card')} / ${quantity(result.batches.length, 'batch', 'batches')}`);
      if (result.policy) {
        const stats = result.inventoryStats;
        const pileText = stats?.byPile ? ['club', 'storage', 'unassigned', 'transfer'].map(pile => `${pile} ${number(stats.byPile[pile] ?? 0)}`).join(' / ') : 'Club / Storage';
        const raw = stats?.rawByPile ? ` · raw ${number(stats.rawByPile.club)} / ${number(stats.rawByPile.storage)}` : '';
        add(output, 'small', `FSU Only Untradeable: ${result.policy.onlyUntradeable ? 'enabled' : 'disabled'} · Read inventory: ${pileText}${raw}`);
        add(output, 'small', result.policy.protectFsuLockedPlayers && result.policy.protectActiveSquad
          ? 'Card locks: enabled · Active squad protection: enabled (starters, substitutes and reserves)'
          : 'Saved plan: current card locks and active squad protection will be checked before execution.');
      }
      if (!result.searchComplete) add(output, 'small', 'Search budget reached. Showing the best plan found, not a guaranteed global optimum.');
      if (!result.poolComplete) add(output, 'small', 'Based on currently readable inventory; full inventory coverage is not confirmed.');
      if (result.marketPending) add(output, 'small', 'Verified market candidates are unavailable. This result contains inventory only.');
      if (result.quoteReadError) add(output, 'small', `Quote reads incomplete: ${result.quoteReadError}`);
      if (result.marketError) add(output, 'small', `Market candidates incomplete: ${result.marketError}`);
      if (result.unknownValueCount) add(output, 'small', `${result.unknownValueCount} cards have unknown value. They are not treated as free.`);
      const settled = index => !!result.record && (result.record.submittedScore >= p.target
        || (marketRun ? result.record.completed === true : result.record.batches?.[index]?.state !== 'waiting'));
      selected = new Set(result.batches.map((_, index) => index).filter(index => !settled(index)));
      const selection = add(output, 'output'); selection.dataset.selection = '';
      const updateSelection = () => {
        const items = [...selected].flatMap(index => result.batches[index]);
        const points = items.reduce((sum, item) => sum + item.points, 0);
        selection.textContent = marketRun ? 'Review the target, total budget, market pool and inventory below. The execution button approves this scope. Batches are estimates.'
          : `Selected ${selected.size} batches · ${items.length} cards · ${number(points)} points · Remaining ${number(Math.max(0, p.target - (result.record?.submittedScore ?? p.submitted) - points))}`;
        if (marketRun && result.record) {
          const r = result.record, rows = r.entries ?? [];
          selection.textContent += `\nConfirmed ${number(r.submittedScore)} / ${number(p.target)} points · Spent ${number(r.spent)} / ${number(r.budget)} coins`
            + `\nPurchased, awaiting delivery ${rows.filter(e => ['bought', 'move-pending'].includes(e.state)).length} cards · Ready ${rows.filter(e => ['ready', 'club'].includes(e.state)).length} cards · Contributed ${r.consumedIds?.length ?? 0} cards`;
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
        choice.setAttribute('aria-label', `Select batch ${index + 1}`);
        choice.addEventListener('click', event => event.stopPropagation());
        choice.addEventListener('change', () => { if (marketRun) return; if (choice.checked) selected.add(index); else selected.delete(index); updateSelection(); });
        const pending = batch.filter(item => item.source === 'market');
        summary.append(document.createTextNode(` Batch ${index + 1} · ${quantity(batch.length, 'card')} (Inventory ${batch.length - pending.length} / To buy ${pending.length}) · ${number(batch.reduce((sum, i) => sum + i.points, 0))} points · To buy ${number(pending.reduce((sum, item) => sum + item.price, 0))} coins`));
        let populated = false;
        const populate = () => {
          if (populated || !details.open || generation !== renderGeneration || disposed) return;
          populated = true;
          const list = add(details, 'div'); list.className = 'player-list';
          for (const item of batch) {
            const row = add(list, 'div'); row.className = 'player-row';
            const card = add(row, 'div'); card.className = 'player-card';
            const fallback = add(card, 'span', number(item.rating)); fallback.title = 'Card image unavailable';
            const slot = add(card, 'slot'); slot.name = `streamlined-card-${generation}-${item.key}`;
            const text = add(row, 'div'); text.className = 'player-text';
            add(text, 'strong', item.name ?? `Version ${item.definitionId}`);
            add(text, 'span', `${number(item.rating)} OVR · ${number(item.points)} points`);
            add(text, 'span', item.source === 'market'
              ? 'To buy · Market concept card'
              : item.pile === 'storage' ? 'SBC Storage · owned'
                : item.pile === 'unassigned' ? 'Unassigned → Club · owned'
                  : item.pile === 'transfer' ? 'Transfer List → Club · owned' : 'Club · owned');
            const points = add(row, 'span', `${number(item.points)} points`); points.className = 'player-points';
            const price = add(row, 'span', item.price == null ? 'Value unknown' : `${number(item.price)} coins`);
            price.className = 'player-price'; price.title = item.source === 'market' ? 'Purchase estimate' : 'Inventory value';
            if (item.source === 'market') add(price, 'small', `Cap ${number(item.purchaseMaxBuy)}`);
            let native = null, failed = false;
            const unavailable = () => {
              failed = true;
              if (native) { rendered.delete(native); try { native.__fcatDealloc?.(); } catch { /* UI disposal only. */ } native.remove(); }
              if (generation === renderGeneration && !disposed) { fallback.hidden = false; slot.remove(); }
            };
            try {
              const raw = session.resolveDisplayItem?.(item);
              if (raw) native = (item.source === 'market' ? nativeRenderer?.render : nativeRenderer?.renderOwned)?.({ parent: host, raw, slot: slot.name,
                label: item.name ?? `Version ${item.definitionId}`, onUnavailable: unavailable });
            } catch { unavailable(); }
            if (native && !failed) { rendered.add(native); fallback.hidden = true; }
            else unavailable();
          }
        };
        details.addEventListener('toggle', populate); populate();
      });
      const skipped = Object.entries(result.excluded ?? {}).map(([key, count]) => `${key}: ${count}`).join(' · ');
      if (skipped) { const details = add(output, 'details'); add(details, 'summary', 'Card exclusion reasons'); add(details, 'small', skipped); }
      if (result.policy?.goldRange?.[1] < 99) {
        add(output, 'small', `FSU gold rating cap ${number(result.policy.goldRange[1])}: inventory above this rating is protected. Market purchases use their separate rating limit.`);
      }
      const exclusionBuckets = result.inventorySelection?.buckets;
      if (Array.isArray(exclusionBuckets) && exclusionBuckets.length) {
        const details = add(output, 'details');
        add(details, 'summary', `Excluded inventory ${quantity(result.inventorySelection.readCount - result.inventorySelection.eligibleCount, 'card')}`);
        const labels = {
          'fsu-gold-range': 'Outside the FSU gold rating range',
          untradeable: 'Excluded by Only Untradeable',
          pile: 'Unsupported inventory pile',
          locked: 'FSU manual card lock',
          'active-squad': 'Active squad protection',
          'eligibility-ineligible': 'Does not meet SBC requirements',
          'eligibility-unknown': 'SBC eligibility unverified',
        };
        add(details, 'small', exclusionBuckets.map(bucket =>
          `${labels[bucket.reason] ?? bucket.reason} · ${bucket.pile === 'storage' ? 'Storage' : bucket.pile === 'club' ? 'Club' : bucket.pile} · ${bucket.rating == null ? 'Rating unknown' : `${number(bucket.rating)} OVR`} ×${number(bucket.count)}`
        ).join('; '));
      }
      add(output, 'small', result.liveExecutionEnabled ? (marketRun
        ? 'Click to search, buy, deliver to Club and contribute in batches. Purchases stay within each approved card price cap.'
        : 'Contributing permanently consumes selected cards. You can contribute in batches. Stop waits for the current batch to be reconciled.')
        : `Execution unavailable: ${streamlinedExecutionMessage(result.executionReason, result.executionRecovery)}`); node('contribute').hidden = false;
  };
  on('solve', async () => {
    if (busy || !origin || !same(origin, read())) return;
    resetProgress(); node('review-stock').hidden = true;
    const serial = opened; shown = null; setBusy(true); clearRendered(); node('result').replaceChildren(); node('contribute').hidden = true; node('status').textContent = 'Preparing candidates…';
    try {
      const result = await session.plan(config(), { onProgress: p => {
        if (serial !== opened) return;
        const bar = shadow.querySelector('progress');
        const stage = p.phase === 'market-quotes' && p.refresh ? 'Refreshing expired market quotes'
          : { quotes: 'Inventory quotes', catalog: 'Candidate groups', 'market-validation': 'Verifying candidate points', 'market-quotes': 'Market quotes' }[p.phase];
        bar.max = stage ? p.total || 1 : p.maxNodes || 1;
        bar.value = stage ? p.completed : p.nodes;
        node('status').textContent = stage ? `${stage} ${number(p.completed)} / ${number(p.total)}${p.source ? ` · ${String(p.source).toUpperCase()}` : ''}${Number.isFinite(p.elapsedMs) ? ` · Waiting ${Math.floor(p.elapsedMs / 1000)} s` : ''}`
          : `Search nodes ${number(p.nodes)} / ${number(p.maxNodes)} · Candidates ${number(p.candidates)} · ${number(p.elapsedMs)} ms`;
      } });
      if (serial !== opened) return;
      node('status').textContent = result.status === 'cancelled' ? 'Stopped.'
        : result.plan?.execution?.quoteLimited === true ? 'Some quotes are unavailable. Review the inventory cards and prices before confirming execution.'
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
        const spent = Number.isSafeInteger(record.spent) ? ` · Spent ${number(record.spent)} / ${number(record.budget)} coins` : '';
        node('final-progress').textContent = `Confirmed ${number(record.submittedScore)} / ${number(record.plan?.challenge.targetScore)} points${spent}`;
        node('final-progress').hidden = false;
        const bar = shadow.querySelector('progress'); bar.max = record.plan?.challenge.targetScore || 1;
        if (Number.isSafeInteger(record.submittedScore)) bar.value = record.submittedScore; else bar.removeAttribute('value');
      }
    }
    const labels = { completed: 'Target reached. Check the reward status separately.', partial: 'Contribution confirmed. Remaining batches can continue.',
      stopped: 'Stopped. Confirmed purchases and contributions are retained. Resume with the execution button; unresolved receipts are checked first.', recovered: 'Record reconciled. No contribution was repeated.', observed: 'Previous record loaded.', absent: 'No contribution record needs reconciliation.',
      'recovery-required': 'The result is unconfirmed. Reconcile before continuing; contributions will not be repeated.', rejected: 'EA rejected this contribution. Generate a new plan.' };
    node('status').textContent = result.reason ? streamlinedExecutionMessage(result.reason, result.recovery)
      : result.status === 'absent' ? 'This SBC has no contribution record to reconcile. Click Generate plan.' : labels[result.status] ?? result.status;
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
        ...(marketRun ? { budget: Number(shadow.querySelector('[data-purchase-budget]').value) } : {}),
        acknowledgeQuoteCoverage: true }, {
        onProgress: p => {
          if (serial !== opened) return;
          executionStep(p);
          const materializeLabel = { 'checking-source': 'Checking external cards', 'checking-club': 'Checking Club',
            'journal-pending': 'Saving recovery record', 'move-request': 'Moving to Club',
            'move-acknowledged': 'Move receipt confirmed', 'club-readback': 'Verifying Club delivery', confirmed: 'Club delivery confirmed' }[p.stage];
          if (marketRun) {
            node('status').textContent = streamlinedExecutionProgress(p);
            const bar = shadow.querySelector('progress'); bar.max = p.targetScore || 1; bar.value = p.submittedScore;
            return;
          }
          const label = p.phase === 'materialize' && materializeLabel ? materializeLabel
            : { validation: 'Checking cards', materialize: 'Moving to Club', contribution: 'Contributing', reconciliation: 'Reconciling receipts', confirmed: 'Confirmed' }[p.phase];
          node('status').textContent = `Batch ${p.index + 1} · ${label} · Confirmed ${number(p.submittedScore)} points`;
          const bar = shadow.querySelector('progress'); bar.max = indices.length;
          bar.value = indices.indexOf(p.index) + (p.phase === 'confirmed' ? 1 : 0);
        },
      });
      if (serial !== opened) return;
      renderResult({ ...result, record: outcome.record,
        executionReason: outcome.reason ?? (outcome.status === 'completed' ? 'FC27_STREAMLINED_COMPLETED' : result.executionReason),
        liveExecutionEnabled: result.liveExecutionEnabled && ['partial', 'stopped', 'paused'].includes(outcome.status) });
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
