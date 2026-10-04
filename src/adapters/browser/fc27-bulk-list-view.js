import { moveGalleryListingPrice } from '../../gallery/listing-candidates.js';
import { mountListingRange, listingRangeStyles } from './fc27-listing-range.js';

// Enhancer Qh/yMt/oMt contract: duration, price, delay groups, native card
// cells/table, per-card prices and selected profit. Public quotes are FUT.GG.
export function mountFc27BulkListView({ document, parent, host = parent, nativeRenderer, service, accountScope }) {
  if (!service) return { open() {}, dispose() {} };
  const add = (parent, tag, text = '') => { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; };
  const dialog = add(parent, 'dialog'); dialog.id = 'gallery-bulk-list-dialog'; dialog.setAttribute('aria-label', 'Bulk List');
  dialog.style.cssText = 'width:min(672px,94vw);max-width:min(672px,94vw);max-height:85vh;overflow:hidden;box-sizing:border-box';
  const style = add(dialog, 'style'); style.textContent = `
    #gallery-bulk-list-dialog{background:#171c22;color:#f2f4f6;border:1px solid #53616b;border-radius:12px;padding:20px;width:min(672px,94vw);max-width:min(672px,94vw);max-height:85vh;overflow:hidden;box-sizing:border-box}
    #gallery-bulk-list-dialog::backdrop{background:#0009}
    #gallery-bulk-list-dialog [hidden]{display:none!important}
    #gallery-bulk-list-dialog .dialog-header{display:flex;align-items:center;gap:12px;margin:0 0 12px;flex-wrap:nowrap}
    #gallery-bulk-list-dialog .dialog-header>strong{flex:1;min-width:0}#gallery-bulk-list-dialog .dialog-header>button{flex:0 0 auto;margin:0;align-self:center}
    #gallery-bulk-list-dialog .list-group{padding:10px;margin:10px 0;border:1px solid #46515b;border-radius:7px;display:grid;gap:10px}
    #gallery-bulk-list-dialog .list-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    #gallery-bulk-list-dialog label{display:grid;gap:6px;min-width:0}
    #gallery-bulk-list-dialog input,#gallery-bulk-list-dialog select{box-sizing:border-box;width:100%;min-width:0;color:inherit;background:#242d36;border:1px solid #63717e;border-radius:5px;padding:6px}
    #gallery-bulk-list-dialog input[type=checkbox]{width:18px;height:18px}
    #gallery-bulk-list-dialog input[type=range]{padding:0;accent-color:#b0ed55}
    ${listingRangeStyles}
    #gallery-bulk-list-dialog button{border:1px solid #65717c;border-radius:6px;padding:7px 12px;background:#28333e;color:inherit;cursor:pointer}
    #gallery-bulk-list-dialog button[aria-pressed=true]{background:#b0ed55;color:#141c09}
    #gallery-bulk-list-dialog button:disabled{opacity:.45;cursor:default}
    #gallery-bulk-list-dialog .list-segments{display:flex;gap:4px}#gallery-bulk-list-dialog .list-segments button{flex:1}
    #gallery-bulk-list-dialog .list-toolbar{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin:10px 0}
    #gallery-bulk-list-dialog .list-table-wrap{max-height:36vh;overflow-x:auto;overflow-y:auto}#gallery-bulk-list-dialog table{width:max-content;min-width:100%;border-collapse:collapse;font-size:12px}
    #gallery-bulk-list-dialog th,#gallery-bulk-list-dialog td{padding:8px 5px;border-bottom:1px solid #3d4650;text-align:left}
    #gallery-bulk-list-dialog .list-card{height:50px;width:80px;position:relative}
    #gallery-bulk-list-dialog .list-card slot{display:block;transform:scale(.5);transform-origin:top left;width:144px;height:200px}
    #gallery-bulk-list-dialog .list-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
    #gallery-bulk-list-dialog output{display:block;overflow-wrap:anywhere;margin:10px 0}
    #gallery-bulk-list-dialog .list-profit[data-sign=positive]{color:#8ddd9d}#gallery-bulk-list-dialog .list-profit[data-sign=negative]{color:#ff9696}
  `;
  const header = add(dialog, 'div'); header.className = 'dialog-header'; add(header, 'strong', 'Bulk List');
  const close = add(header, 'button', '关闭'); close.type = 'button';
  add(dialog, 'small', '来源：FUT.GG · 挂牌不等于售出，成交后才计收入');
  const controls = add(dialog, 'div');
  const group = () => { const e = add(controls, 'section'); e.className = 'list-group'; return e; };
  const durationGroup = group(), priceGroup = group(), delayGroup = group();
  const durationLabel = add(durationGroup, 'label', '时长'), duration = add(durationLabel, 'select'); duration.setAttribute('aria-label', '时长');
  for (const hours of [1,3,6,12,24,72]) { const o = add(duration, 'option', `${hours}h`); o.value = String(hours * 3600); }
  add(priceGroup, 'strong', '价格');
  const segments = add(priceGroup, 'div'); segments.className = 'list-segments';
  const mode = { value: 'percentage' }, modes = new Map();
  for (const [value, label] of [['fixed','Fixed'],['percentage','Percentage'],['steps','Steps']]) {
    const button = add(segments, 'button', label); button.type = 'button'; modes.set(value, button);
    button.addEventListener('click', event => { if (event.isTrusted && !busy) { mode.value = value; changeSettings(true); } });
  }
  const percentFields = add(priceGroup, 'div'), fixedFields = add(priceGroup, 'div');
  percentFields.className = fixedFields.className = 'list-fields';
  const field = (parent, label, value, type = 'number') => {
    const wrap = add(parent, 'label'), caption = add(wrap, 'span', label), input = add(wrap, 'input'); input.type = type; input.value = String(value); input.setAttribute('aria-label', label);
    if (type === 'range') { const display = () => { caption.textContent = `${label} · ${input.value}`; }; input.addEventListener('input', display); input.updateCaption = display; }
    return input;
  };
  let pctMinValue = 100, pctMaxValue = 100;
  const percentageRange = mountListingRange({ document, parent: percentFields, label: '价格范围 %', labels: ['最低百分比', '最高百分比'], min: 0, max: 200, value: [100, 100], enabled: () => !busy,
    onValueChange: next => { pctMinValue = next[0]; pctMaxValue = next[1]; changeSettings(true); } });
  const pctMin = { get value() { return String(pctMinValue); }, set value(v) { pctMinValue = Number(v); }, updateCaption() {} };
  const pctMax = { get value() { return String(pctMaxValue); }, set value(v) { pctMaxValue = Number(v); }, updateCaption() {} };
  const start = field(fixedFields, 'Start Bid', ''), fixed = field(fixedFields, 'Buy Now', ''), steps = field(priceGroup, '价格档位', 0);
  steps.min = '-20'; steps.max = '20';
  add(delayGroup, 'strong', '挂牌间隔');
  const delayFields = add(delayGroup, 'div'); delayFields.className = 'list-fields';
  const delayMin = field(delayFields, '等待最少（秒）', 3, 'range'), delayMax = field(delayFields, '等待最多（秒）', 5, 'range');
  for (const input of [delayMin,delayMax]) { input.min = '1'; input.max = '15'; }
  delayMin.value = '3'; delayMax.value = '5';
  const toolbar = add(dialog, 'div'); toolbar.className = 'list-toolbar';
  const all = add(toolbar, 'button', '全选'), none = add(toolbar, 'button', '取消选择');
  const cards = add(toolbar, 'button', '卡片视图'), tableView = add(toolbar, 'button', '表格视图');
  const tableWrap = add(dialog, 'div'); tableWrap.className = 'list-table-wrap';
  const table = add(tableWrap, 'table');
  const heading = add(table, 'thead'), hr = add(heading, 'tr');
  for (const text of ['选择','球员','FUT.GG','卖价','买入价','盈亏','结果']) add(hr, 'th', text);
  const body = add(table, 'tbody');
  const footer = add(add(table, 'tfoot'), 'tr'); const totalLabel = add(footer, 'td', '选中盈亏'); totalLabel.colSpan = 5;
  const totalProfit = add(footer, 'td'); totalProfit.className = 'list-profit'; add(footer, 'td');
  const pages = add(dialog, 'div'); pages.className = 'list-toolbar';
  const previous = add(pages, 'button', '上一页'), pageStatus = add(pages, 'span'), next = add(pages, 'button', '下一页');
  const progress = add(dialog, 'progress'); progress.style.width = '100%'; progress.max = 1; progress.value = 0;
  progress.hidden = true;
  const execution = add(dialog, 'div'); execution.hidden = true;
  const output = add(dialog, 'output'); output.setAttribute('role', 'status');
  const actions = add(dialog, 'div'); actions.className = 'list-footer';
  const cancel = add(actions, 'button', '取消'); cancel.type = 'button';
  const submit = add(actions, 'button', '挂牌选中卡'), stop = add(actions, 'button', '停止'); stop.hidden = true;
  const scheduleBox = add(dialog, 'details'); scheduleBox.id = 'gallery-listing-schedule';
  const scheduleCapability = service.scheduleCapability?.() ?? { enabled: false };
  scheduleBox.hidden = !scheduleCapability.enabled;
  add(scheduleBox, 'summary', '定时挂牌本批次');
  const scheduleControls = add(scheduleBox, 'div'); scheduleControls.className = 'settings-grid';
  const scheduleLabel = add(scheduleControls, 'label', '挂牌时间');
  const scheduleValue = add(scheduleLabel, 'input'); scheduleValue.type = 'datetime-local'; scheduleValue.setAttribute('aria-label', '挂牌时间');
  const scheduleSave = add(scheduleControls, 'button', '保存计划'); scheduleSave.type = 'button';
  const scheduleArm = add(scheduleControls, 'button', '启用定时'); scheduleArm.type = 'button'; scheduleArm.disabled = true;
  const scheduleCancel = add(scheduleControls, 'button', '取消定时'); scheduleCancel.type = 'button'; scheduleCancel.disabled = true;
  const scheduleStatus = add(scheduleBox, 'output', '尚无计划'); scheduleStatus.setAttribute('role', 'status');
  const selected = new Set(), overrides = {}, generatedPrices = {}, rows = new Map();
  let viewMode = 'cards', pageIndex = 0;
  let busy = false, identity = null, prepared = null, plan = null, resumeRunId = null, disposed = false, scheduleState = 'absent';
  const settings = () => ({ priceMode: mode.value, percentageRange: [Number(pctMin.value), Number(pctMax.value)],
    fixedPrice: fixed.value ? Number(fixed.value) : null, fixedStartPrice: start.value ? Number(start.value) : null,
    steps: Number(steps.value), durationSeconds: Number(duration.value), delaySeconds: [Number(delayMin.value), Number(delayMax.value)], playerView: viewMode });
  const schedule = () => ({ type: 'once', runAt: new Date(scheduleValue.value).getTime() });
  const updateScheduleControls = () => {
    scheduleSave.disabled = busy || !!resumeRunId || scheduleState === 'armed';
    scheduleArm.disabled = busy || !!resumeRunId || scheduleState !== 'disarmed';
    scheduleCancel.disabled = busy || scheduleState !== 'armed';
  };
  const scheduleSummary = record => {
    const entries = record?.entries ?? [], total = entries.reduce((sum, entry) => sum + entry.buyNow, 0);
    const at = record?.schedule?.runAt;
    return `${entries.length} 张 · Buy Now 合计 ${total} · ${Number.isFinite(at) ? new Date(at).toLocaleString() : '时间未知'}`;
  };
  const current = () => !disposed && identity === accountScope();
  const label = state => ({ pending: '待处理', 'list-pending': '核对中', listing: '挂牌中', accepted: '已挂牌', rejected: '失败', skipped: '跳过', unknown: '待恢复' })[state] ?? state;
  const reasonText = reason => ({
    FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED: '上一批挂牌仍有未核对结果，请点击“核对并继续”恢复该批次。',
    FC27_GALLERY_BULK_LIST_JOURNAL_INVALID: '旧挂牌记录格式异常，无法确定所属批次，未开始挂牌；请保留记录并导出诊断日志。',
    FC27_GALLERY_BULK_LIST_JOURNAL_READ_FAILED: '读取旧挂牌记录失败，未开始挂牌；请重试，仍失败请导出诊断日志。',
    FC27_GALLERY_BULK_LIST_RECOVERY_UNCONFIRMED: '旧挂牌结果仍无法核对，未重复挂牌或继续后续卡；记录已保留，请检查 Transfer List 并导出诊断日志。',
    FC27_GALLERY_BULK_LIST_CONTEXT_CHANGED: '上一批挂牌记录属于其他账号或会话，未继续挂牌；请切换回原账号恢复。',
    FC27_GALLERY_BULK_LIST_JOURNAL_UNCONFIRMED: '挂牌记录无法可靠保存，未继续发送挂牌请求；请导出诊断日志。',
    FC27_GALLERY_BULK_LIST_JOURNAL_WRITE_FAILED: '写入或归档挂牌记录失败，未发送后续挂牌请求；请检查存储并导出诊断日志。',
    FC27_GALLERY_LISTING_READBACK_UNCONFIRMED: '挂牌回执无法确认，未自动重试；请点击“核对并继续”。',
  })[reason] ?? reason ?? '没有可挂牌的已购卡';
  const failure = result => [reasonText(result?.reason), result?.reason && reasonText(result.reason) !== result.reason ? result.reason : '', result?.phase ? `阶段：${result.phase}` : '',
    result?.httpStatus ? `HTTP ${result.httpStatus}` : ''].filter(Boolean).join(' · ');
  const safeError = error => ({ reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '')
    ? error.message : 'FC27_GALLERY_LISTING_UNAVAILABLE', phase: /^[a-z-]{1,40}$/.test(error?.phase ?? '') ? error.phase : null,
    httpStatus: Number.isSafeInteger(error?.httpStatus) ? error.httpStatus : null });
  const resultText = result => {
    const entries = result?.entries ?? [];
    const count = (status, reported) => Number.isSafeInteger(reported) ? reported : entries.filter(row => row.status === status).length;
    const accepted = count('accepted', result?.accepted), rejected = count('rejected', result?.rejected);
    const skipped = count('skipped', result?.skipped), pending = entries.filter(row => !['accepted','rejected','skipped'].includes(row.status)).length;
    const unknown = entries.some(row => ['unknown','list-pending'].includes(row.status));
    const label = unknown ? '挂牌结果待核对' : result?.status === 'blocked' && !entries.length ? '挂牌未开始'
      : rejected || skipped || pending || result?.status !== 'completed' ? '挂牌部分完成' : '挂牌完成';
    return `${label} · 已挂牌 ${accepted} · 失败 ${rejected} · 跳过 ${skipped} · 待处理 ${pending}`
      + (result?.reason ? ` · ${failure(result)}` : '')
      + (unknown ? ' · 存在未知回执，记录已保留，请先核对再继续' : '');
  };
  const disposeCards = () => { for (const row of rows.values()) { row.native?.__fcatDealloc?.(); row.native = null; row.card?.replaceChildren(row.slot); row.cardAttempted = false; } };
  const profit = (cell, value) => {
    cell.textContent = Number.isFinite(value) ? value.toLocaleString() : 'N/A';
    cell.dataset.sign = value >= 0 ? 'positive' : 'negative';
  };
  const renderView = () => {
    table.hidden = false;
    cards.setAttribute('aria-pressed', String(viewMode === 'cards'));
    tableView.setAttribute('aria-pressed', String(viewMode === 'table'));
    hr.children[2].textContent = viewMode === 'cards' ? '上次挂牌' : 'FUT.GG';
    pages.hidden = viewMode !== 'cards' || rows.size <= 10;
    pageIndex = Math.max(0, Math.min(pageIndex, Math.ceil(rows.size / 10) - 1));
    previous.disabled = busy || pageIndex === 0; next.disabled = busy || (pageIndex + 1) * 10 >= rows.size;
    pageStatus.textContent = `${pageIndex + 1} / ${Math.max(1, Math.ceil(rows.size / 10))}`;
    let index = 0;
    for (const row of rows.values()) {
      row.tr.hidden = viewMode === 'cards' && Math.floor(index++ / 10) !== pageIndex;
      if (!row.card) continue;
      const show = viewMode === 'cards' && !row.tr.hidden;
      row.card.hidden = !show || row.cardAttempted && !row.native; row.name.hidden = show && !!row.native;
      row.reference.textContent = viewMode === 'cards' ? row.previousPrice ?? 'N/A' : row.quote ?? '未知';
      if (!show) { row.native?.__fcatDealloc?.(); row.native = null; row.cardAttempted = false; row.name.hidden = false; continue; }
      if (row.native || row.cardAttempted) continue;
      row.cardAttempted = true;
      try {
        // Enhancer's native card is a light-DOM child of the component host,
        // projected into the named slot in our shadow tree. Keeping the
        // wrapper on `host` is required for EA's global card styles to apply.
        row.native = nativeRenderer?.renderOwned?.({ parent: host, slot: row.slot.name,
          raw: service.readDisplayItem?.(row.entry.item), label: row.entry.name,
          onUnavailable: () => { row.native = null; row.name.hidden = false; row.card.hidden = true; } }) ?? null;
      } catch { row.native = null; }
      row.name.hidden = !!row.native; row.card.hidden = !row.native;
    }
  };
  const changeSettings = (pricesChanged = false) => {
    if (pricesChanged) for (const key of Object.keys(generatedPrices)) delete generatedPrices[key];
    void Promise.resolve(service.writeSettings?.(settings())).catch(() => {});
    refresh();
  };
  const refresh = () => {
    percentFields.hidden = mode.value !== 'percentage';
    fixedFields.hidden = mode.value !== 'fixed'; steps.parentElement.hidden = mode.value !== 'steps';
    for (const [value, button] of modes) button.setAttribute('aria-pressed', String(mode.value === value));
    for (const input of [pctMin,pctMax,delayMin,delayMax]) input.updateCaption();
    renderView();
    if (!prepared || resumeRunId || busy) return;
    // Price every row once as Enhancer does, including temporarily unselected
    // rows. Selection/duration/delay/view changes must not rerandomize prices.
    if (Object.keys(generatedPrices).length === 0) {
      const preview = service.plan({ selectedIds: prepared.candidates.map(row => row.item.id), settings: settings(), overridesByItem: overrides });
      for (const entry of preview.entries ?? []) generatedPrices[entry.item.id] = entry.buyNow;
    }
    const effectiveOverrides = { ...generatedPrices, ...overrides };
    plan = service.plan({ selectedIds: [...selected], settings: settings(), overridesByItem: effectiveOverrides });
    let total = 0;
    for (const [id, row] of rows) {
      const entry = plan.entries?.find(e => e.item.id === id), skip = plan.skipped?.find(e => e.itemId === id);
      if (!row.price) continue;
      const bin = effectiveOverrides[id] ?? entry?.buyNow;
      row.price.value = bin == null ? '' : String(bin);
      row.state.textContent = !selected.has(id) ? '未选择' : entry ? `${entry.startPrice} → ${entry.buyNow}` : skip?.reason ?? '不可用';
      row.check.checked = selected.has(id);
      const amount = Number.isFinite(bin) && row.purchasePrice > 0 ? Math.round(bin * .95) - row.purchasePrice : null;
      profit(row.profit, amount); if (selected.has(id) && amount != null) total += amount;
    }
    profit(totalProfit, total);
    submit.disabled = plan.status !== 'observed' || !plan.entries?.length || prepared.liveEnabled !== true;
    submit.textContent = `挂牌 ${plan.entries?.length ?? 0} 张`;
    output.textContent = `${plan.entries?.length ?? 0} 张可挂牌 · ${plan.skipped?.length ?? 0} 张跳过${plan.skipped?.some(row => row.reason.includes('unavailable')) ? ' · 未知报价/限制已跳过' : ''}`;
  };
  const setBusy = value => {
    busy = value; for (const el of dialog.querySelectorAll('input,select,button')) el.disabled = value;
    stop.disabled = false; stop.hidden = !value; close.hidden = value;
    updateScheduleControls();
  };
  const showEntries = entries => {
    execution.replaceChildren();
    for (const entry of entries ?? []) {
      let row = rows.get(entry.item.id);
      if (!row) { const tr = add(body, 'tr'); add(tr, 'td'); add(tr, 'td', entry.name || String(entry.item.definitionId));
        add(tr, 'td', '—'); add(tr, 'td', String(entry.buyNow)); add(tr, 'td', '—'); add(tr, 'td', '—');
        row = { tr, state: add(tr, 'td') }; rows.set(entry.item.id, row); }
      row.state.textContent = `${label(entry.status)}${entry.reason ? ` · ${entry.reason}` : ''}`;
      const line = add(execution, 'div'); line.style.cssText = 'padding:8px 0;border-bottom:1px solid #46515b;overflow-wrap:anywhere';
      add(line, 'strong', `${entry.name || entry.item.definitionId} · ${entry.buyNow} 🪙`);
      add(line, 'span', ` · ${row.state.textContent}`);
    }
  };
  const run = async () => {
    controls.hidden = toolbar.hidden = tableWrap.hidden = pages.hidden = true;
    progress.hidden = execution.hidden = false; cancel.hidden = submit.hidden = true;
    disposeCards();
    setBusy(true);
    try {
      const result = await service.execute({ approved: true, plan, settings: settings(), resume: !!resumeRunId,
        expectedRunId: resumeRunId, isCurrent: current, onProgress: value => {
          if (!current()) return;
          progress.max = value.total || 1; progress.value = value.completed;
          output.textContent = `${value.index}/${value.total} · 已挂牌 ${value.accepted} · 失败 ${value.rejected} · 跳过 ${value.skipped}`;
          showEntries(value.entries);
        } });
      if (!current()) return;
      showEntries(result.entries);
      output.textContent = resultText(result);
      try {
        const journal = await service.inspect();
        resumeRunId = journal.status === 'observed' && journal.state !== 'completed' ? journal.runId : null;
      } catch { output.textContent += ' · 进度核对失败，记录已保留'; }
    } catch (error) { output.textContent = `挂牌结果待核对 · ${failure(safeError(error))} · 记录已保留`; }
    finally { setBusy(false); cancel.hidden = false; submit.hidden = false; submit.textContent = resumeRunId ? '核对并继续' : '已完成'; submit.disabled = !resumeRunId; }
  };
  submit.addEventListener('click', event => { if (event.isTrusted && !busy && current() && (resumeRunId || plan?.entries?.length)) void run(); });
  stop.addEventListener('click', event => { if (event.isTrusted && busy) { service.stop(); stop.disabled = true; output.textContent = '当前挂牌核对完成后停止…'; } });
  scheduleSave.addEventListener('click', async event => {
    if (!event.isTrusted || busy || !current() || !plan?.entries?.length) return;
    scheduleStatus.textContent = '正在保存计划…'; scheduleSave.disabled = true;
    try {
      const result = await service.saveSchedule?.({ approved: true, plan, settings: settings(), schedule: schedule() });
      scheduleState = result?.status === 'saved' ? 'disarmed' : scheduleState;
      scheduleStatus.textContent = result?.status === 'saved' ? `已保存，尚未启用 · ${scheduleSummary(result.schedule)}` : (result?.reason || '计划未保存');
    } catch { scheduleStatus.textContent = '计划保存失败'; }
    finally { updateScheduleControls(); }
  });
  scheduleArm.addEventListener('click', async event => {
    if (!event.isTrusted || busy || !current()) return;
    scheduleArm.disabled = true;
    try {
      const result = await service.armSchedule?.({ approved: true });
      scheduleState = result?.status === 'armed' ? 'armed' : scheduleState;
      scheduleStatus.textContent = result?.status === 'armed' ? `已启用，页面与 EA 会话保持在线时执行一次 · ${scheduleSummary(result.schedule)}` : (result?.reason || '计划未启用');
    } catch { scheduleStatus.textContent = '计划启用结果待核对'; }
    finally { updateScheduleControls(); }
  });
  scheduleCancel.addEventListener('click', async event => {
    if (!event.isTrusted || busy || !current() || scheduleState !== 'armed') return;
    scheduleCancel.disabled = true;
    try {
      const result = await service.disarmSchedule?.('user-cancelled');
      scheduleState = result?.status === 'disarmed' ? 'disarmed' : result?.status ?? scheduleState;
      scheduleStatus.textContent = result?.status === 'disarmed' ? '已取消定时；原计划保留' : result?.reason ?? '取消结果待核对';
    } catch { scheduleStatus.textContent = '取消结果待核对'; }
    updateScheduleControls();
  });
  // `HTMLDialogElement.close()` dispatches its `close` event after the
  // activation task.  Native EA card wrappers live on the light-DOM host,
  // so waiting for that event leaves the previous page's cards visible for
  // one turn (and can race a Gallery tab switch).  Dispose synchronously at
  // the user action, while retaining the event handler for Escape/programmatic
  // closes.
  const closeDialog = () => { if (!busy) { disposeCards(); dialog.close(); } };
  close.addEventListener('click', closeDialog);
  cancel.addEventListener('click', closeDialog);
  dialog.addEventListener('close', disposeCards);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  controls.addEventListener('change', event => { if (event.isTrusted && !busy) {
    const input = event.target;
    let coupled = false;
    if (input === start && start.value && fixed.value && Number(start.value) > Number(fixed.value)) {
      const nextPrice = moveGalleryListingPrice(Number(start.value), 1, prepared?.priceTiers);
      if (nextPrice != null) { fixed.value = String(nextPrice); coupled = true; }
    }
    if (input === fixed && fixed.value && start.value && Number(start.value) > Number(fixed.value)) {
      const previousPrice = moveGalleryListingPrice(Number(fixed.value), -1, prepared?.priceTiers);
      if (previousPrice != null) start.value = String(previousPrice);
    }
    for (const [lo,hi] of [[pctMin,pctMax],[delayMin,delayMax]]) if (Number(lo.value) > Number(hi.value)) {
      if (input === lo) hi.value = lo.value; else lo.value = hi.value;
    }
    changeSettings(coupled || priceGroup.contains(input) && input !== start);
  } });
  cards.addEventListener('click', event => { if (event.isTrusted && !busy) { viewMode = 'cards'; for (const row of rows.values()) row.cardAttempted = false; changeSettings(); } });
  tableView.addEventListener('click', event => { if (event.isTrusted && !busy) { viewMode = 'table'; changeSettings(); } });
  previous.addEventListener('click', event => { if (event.isTrusted && !busy) { pageIndex--; for (const row of rows.values()) row.cardAttempted = false; renderView(); } });
  next.addEventListener('click', event => { if (event.isTrusted && !busy) { pageIndex++; for (const row of rows.values()) row.cardAttempted = false; renderView(); } });
  all.addEventListener('click', event => { if (event.isTrusted && !busy) { prepared?.candidates.forEach(e => selected.add(e.item.id)); refresh(); } });
  none.addEventListener('click', event => { if (event.isTrusted && !busy) { selected.clear(); refresh(); } });
  return Object.freeze({
    async open() {
      if (busy || disposed) return;
      identity = accountScope(); disposeCards(); selected.clear(); rows.clear(); body.replaceChildren(); prepared = null; plan = null; resumeRunId = null; scheduleState = 'absent'; pageIndex = 0;
      controls.hidden = toolbar.hidden = tableWrap.hidden = cancel.hidden = submit.hidden = false;
      progress.hidden = execution.hidden = true; execution.replaceChildren(); progress.value = 0;
      for (const key of Object.keys(overrides)) delete overrides[key];
      for (const key of Object.keys(generatedPrices)) delete generatedPrices[key];
      scheduleStatus.textContent = '尚无计划'; scheduleValue.value = '';
      dialog.showModal(); setBusy(true); output.textContent = '正在读取已购实体和报价…';
      try {
        const saved = await service.readSettings?.();
        viewMode = saved?.playerView === 'table' ? 'table' : 'cards';
        if (saved?.priceMode) mode.value = saved.priceMode;
        if (Array.isArray(saved?.percentageRange)) { pctMin.value = String(saved.percentageRange[0]); pctMax.value = String(saved.percentageRange[1]); percentageRange.setValue(saved.percentageRange); }
        fixed.value = saved?.fixedPrice == null ? '' : String(saved.fixedPrice);
        start.value = saved?.fixedStartPrice == null ? '' : String(saved.fixedStartPrice);
        if (Number.isSafeInteger(saved?.steps)) steps.value = String(saved.steps);
        if (Number.isSafeInteger(saved?.durationSeconds)) duration.value = String(saved.durationSeconds);
        if (Array.isArray(saved?.delaySeconds)) { delayMin.value = String(saved.delaySeconds[0]); delayMax.value = String(saved.delaySeconds[1]); }
        if (scheduleCapability.enabled) {
          const savedSchedule = await service.readSchedule?.();
          if (savedSchedule?.schedule) {
            scheduleState = savedSchedule.schedule.armed && ['waiting-time', 'waiting-session', 'ready', 'armed'].includes(savedSchedule.status)
              ? 'armed' : savedSchedule.status;
            scheduleStatus.textContent = `${scheduleState} · ${scheduleSummary(savedSchedule.schedule)}${savedSchedule.reason ? ` · ${savedSchedule.reason}` : ''}`;
            if (savedSchedule.schedule.schedule?.type === 'once') {
              const due = new Date(savedSchedule.schedule.schedule.runAt);
              const local = new Date(due.getTime() - due.getTimezoneOffset() * 60000);
              scheduleValue.value = local.toISOString().slice(0, 16);
            }
          }
        }
        const result = await service.prepare({ isCurrent: current });
        if (!current()) { output.textContent = '账号已变化，请重新打开'; return; }
        if (result.status === 'resume-required') {
          resumeRunId = result.runId; showEntries(result.entries);
          const pending = (result.entries ?? []).filter(entry => !['accepted', 'rejected', 'skipped'].includes(entry.status)).length;
          output.textContent = `上一批挂牌记录待核对 · ${pending} 张未完成；请先点击“核对并继续”${result.lastReason ? ` · ${reasonText(result.lastReason)}` : ''}`;
        } else if (result.status === 'ready') {
          prepared = result;
          for (const e of result.candidates) {
            const tr = add(body, 'tr'), check = add(add(tr, 'td'), 'input'); check.type = 'checkbox';
            check.setAttribute('aria-label', `选择 ${e.name}`);
            const player = add(tr, 'td'), card = add(player, 'div'), slot = document.createElement('slot'), name = add(player, 'span', e.name); card.className = 'list-card';
            slot.name = `gallery-bulk-card-${String(e.item.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`; card.append(slot);
            const reference = add(tr, 'td');
            const price = add(add(tr, 'td'), 'input'); price.type = 'number'; price.min = '150'; price.max = '15000000';
            price.style.width = '100px'; price.setAttribute('aria-label', `${e.name} Buy Now`);
            const purchasePrice = e.boughtFor ?? e.purchase?.purchasePrice;
            add(tr, 'td', purchasePrice > 0 ? String(purchasePrice) : 'N/A');
            const profitCell = add(tr, 'td'); profitCell.className = 'list-profit';
            const state = add(tr, 'td');
            const quoteKnown = Number.isFinite(Number(result.prices?.[e.item.definitionId])) && Number(result.prices[e.item.definitionId]) > 0;
            check.checked = quoteKnown; if (quoteKnown) selected.add(e.item.id);
            rows.set(e.item.id, { tr, check, price, state, card, name, reference, entry: e, purchasePrice, profit: profitCell,
              quote: result.prices[e.item.definitionId], previousPrice: e.previousListingPrice, slot });
            check.addEventListener('change', event => { if (event.isTrusted && !busy) { if (check.checked) selected.add(e.item.id); else selected.delete(e.item.id); refresh(); } });
            price.addEventListener('change', event => { if (event.isTrusted && !busy) { if (price.value) overrides[e.item.id] = Number(price.value); else delete overrides[e.item.id]; refresh(); } });
          }
        } else output.textContent = failure(result);
      } catch (error) { output.textContent = `挂牌准备失败，未发送挂牌请求 · ${failure(safeError(error))}`; }
      finally {
        setBusy(false); controls.hidden = !!resumeRunId; toolbar.hidden = !!resumeRunId;
        submit.textContent = resumeRunId ? '核对并继续' : '挂牌选中卡'; submit.disabled = !resumeRunId;
        updateScheduleControls();
        refresh();
      }
    },
    dispose() { disposed = true; service.stop(); disposeCards(); dialog.remove(); },
  });
}
