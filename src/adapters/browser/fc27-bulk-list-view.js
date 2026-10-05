import { moveGalleryListingPrice, previewGalleryListingPrices } from '../../gallery/listing-candidates.js';
import { mountListingCurrency } from './fc27-listing-currency.js';
import { mountListingRange, listingRangeStyles } from './fc27-listing-range.js';

// Enhancer Qh/yMt/oMt contract: duration, price, delay groups, native card
// cells/table, per-card prices and selected profit. Quotes follow account policy.
export function mountFc27BulkListView({ document, parent, host = parent, nativeRenderer, service, accountScope }) {
  if (!service) return { open() {}, dispose() {} };
  const add = (parent, tag, text = '') => { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; };
  const dialog = add(parent, 'dialog'); dialog.id = 'gallery-bulk-list-dialog'; dialog.setAttribute('aria-label', 'Bulk List');
  // Keep the modal itself scrollable like Enhancer; a nested scrollbar made
  // the price and profit columns difficult to reach on shorter viewports.
  dialog.style.cssText = 'width:min(760px,94vw);max-width:min(760px,94vw);max-height:88vh;min-height:0;overflow-y:auto!important;overflow-x:hidden;box-sizing:border-box';
  const style = add(dialog, 'style'); style.textContent = `
    #gallery-bulk-list-dialog{background:#151a20;color:#f2f4f6;border:1px solid #46525d;border-radius:10px;padding:16px;width:min(760px,94vw);max-width:min(760px,94vw);max-height:88vh;min-height:0;overflow-y:auto!important;overflow-x:hidden!important;box-sizing:border-box;box-shadow:0 18px 55px #000b;scrollbar-gutter:stable}
    #gallery-bulk-list-dialog[open]{display:block}
    #gallery-bulk-list-dialog::backdrop{background:#000b}
    #gallery-bulk-list-dialog [hidden]{display:none!important}
    #gallery-bulk-list-dialog .dialog-header{display:flex;align-items:center;gap:10px;margin:0 0 8px;min-height:30px}
    #gallery-bulk-list-dialog .dialog-header>strong{font-size:16px;font-weight:700;letter-spacing:.01em;flex:1;min-width:0}
    #gallery-bulk-list-dialog .dialog-header>button{flex:0 0 auto;margin:0;align-self:center}
    #gallery-bulk-list-dialog>.list-source{display:block;color:#8f9ba6;font-size:11px;margin:-2px 0 10px}
    #gallery-bulk-list-dialog .list-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:0 0 8px}
    #gallery-bulk-list-dialog .list-group{padding:9px 10px;margin:0;border:1px solid #37424c;border-radius:6px;background:#20272f;display:grid;gap:8px;align-content:start;min-width:0}
    #gallery-bulk-list-dialog .list-group>strong{font-size:11px;color:#d6dee5;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
    #gallery-bulk-list-dialog .list-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    #gallery-bulk-list-dialog label{display:grid;gap:4px;min-width:0;font-size:11px;color:#aeb9c2}
    #gallery-bulk-list-dialog input,#gallery-bulk-list-dialog select{box-sizing:border-box;width:100%;min-width:0;color:inherit;background:#171d23;border:1px solid #52606b;border-radius:4px;padding:6px 7px;font-size:12px;min-height:29px}
    #gallery-bulk-list-dialog input[type=checkbox]{width:18px;height:18px}
    #gallery-bulk-list-dialog input[type=range]{padding:0;accent-color:#b0ed55}
    #gallery-bulk-list-dialog .listing-currency{display:flex;min-width:96px;height:40px;align-items:center;border:1px solid #52606b;border-radius:4px;overflow:hidden;background:#171d23}
    #gallery-bulk-list-dialog .listing-currency>input{flex:1;width:70px;height:40px!important;min-height:0!important;appearance:textfield;border:0!important;border-radius:0!important;background:transparent}
    #gallery-bulk-list-dialog .listing-currency>input::-webkit-inner-spin-button{appearance:none}
    #gallery-bulk-list-dialog .listing-currency>div{display:flex;height:40px;flex-direction:column;border-left:1px solid #52606b}
    #gallery-bulk-list-dialog .listing-currency button{height:20px!important;min-height:0!important;width:24px;padding:0!important;line-height:0;border:0!important;border-radius:0;background:#29333d}
    #gallery-bulk-list-dialog .list-footer{align-items:center;flex-wrap:wrap}
    #gallery-bulk-list-dialog .list-footer>button{margin:0}
    ${listingRangeStyles}
    #gallery-bulk-list-dialog .listing-range{gap:6px}
    #gallery-bulk-list-dialog .listing-range-box{gap:7px;border-color:#46535e;border-radius:5px;padding:7px;background:#171d23}
    #gallery-bulk-list-dialog .listing-range-track{height:6px;background:#414d57}
    #gallery-bulk-list-dialog .listing-range-indicator{background:#b0ed55}
    #gallery-bulk-list-dialog .listing-range-thumb::-webkit-slider-thumb{width:16px;height:16px;border-color:#b0ed55;background:#202a30}
    #gallery-bulk-list-dialog .listing-range-values{gap:7px}
    #gallery-bulk-list-dialog .listing-range-values>input{height:27px!important;background:#171d23!important;border-color:#52606b}
    #gallery-bulk-list-dialog .listing-range-ends{font-size:10px;color:#87949e}
    #gallery-bulk-list-dialog button{border:1px solid #52606b;border-radius:4px;padding:6px 10px;background:#29333d;color:#e9eef2;cursor:pointer;font-size:12px;line-height:1.2}
    #gallery-bulk-list-dialog button:hover:not(:disabled){border-color:#9fda52;background:#34414b}
    #gallery-bulk-list-dialog button[aria-pressed=true]{background:#b0ed55;border-color:#b0ed55;color:#141c09;font-weight:700}
    #gallery-bulk-list-dialog button:disabled{opacity:.45;cursor:default}
    #gallery-bulk-list-dialog .list-segments{display:flex;gap:3px}#gallery-bulk-list-dialog .list-segments button{flex:1;padding-inline:5px}
    #gallery-bulk-list-dialog .list-toolbar{display:flex;gap:5px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:7px 0}
    #gallery-bulk-list-dialog .list-toolbar .toolbar-group{display:flex;gap:5px;align-items:center}
    #gallery-bulk-list-dialog .list-table-wrap{width:100%;height:auto;max-height:none;min-height:120px;overflow-x:hidden;overflow-y:visible;border:1px solid #39444e;border-radius:6px;background:#171d23}
    #gallery-bulk-list-dialog table{width:100%;min-width:0;border-collapse:separate;border-spacing:0;font-size:12px;table-layout:fixed}
    #gallery-bulk-list-dialog th{position:sticky;top:0;z-index:1;background:#252e37;color:#9eabb5;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
    #gallery-bulk-list-dialog th,#gallery-bulk-list-dialog td{padding:7px 8px;border-bottom:1px solid #303b45;text-align:left;vertical-align:middle;white-space:nowrap}
    #gallery-bulk-list-dialog tbody tr:hover{background:#222c34}
    #gallery-bulk-list-dialog tbody tr:last-child td{border-bottom:0}
    #gallery-bulk-list-dialog th:nth-child(1),#gallery-bulk-list-dialog td:nth-child(1){width:32px;text-align:center}
    #gallery-bulk-list-dialog th:nth-child(2),#gallery-bulk-list-dialog td:nth-child(2){width:26%}
    #gallery-bulk-list-dialog th:nth-child(3),#gallery-bulk-list-dialog td:nth-child(3){width:22%}
    #gallery-bulk-list-dialog th:nth-child(4),#gallery-bulk-list-dialog td:nth-child(4){width:22%}
    #gallery-bulk-list-dialog th:nth-child(5),#gallery-bulk-list-dialog td:nth-child(5){width:14%}
    #gallery-bulk-list-dialog th:nth-child(6),#gallery-bulk-list-dialog td:nth-child(6){width:16%}
    #gallery-bulk-list-dialog th,#gallery-bulk-list-dialog td{overflow:hidden;text-overflow:ellipsis}
    #gallery-bulk-list-dialog .list-card{height:50px;width:82px;position:relative;display:inline-block;vertical-align:middle;margin-right:7px}
    #gallery-bulk-list-dialog .list-card slot{display:block;transform:scale(.5);transform-origin:top left;width:144px;height:200px}
    #gallery-bulk-list-dialog .list-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;padding-top:10px;border-top:1px solid #35414a;background:#151a20}
    #gallery-bulk-list-dialog .list-footer button.primary{background:#b0ed55;border-color:#b0ed55;color:#141c09;font-weight:700;min-width:122px}
    #gallery-bulk-list-dialog output{display:block;overflow-wrap:anywhere;margin:7px 0;color:#aab6bf;font-size:11px;min-height:16px}
    #gallery-bulk-list-dialog progress{display:block;height:5px;border:0;border-radius:5px;overflow:hidden;background:#303b45}
    #gallery-bulk-list-dialog progress::-webkit-progress-value{background:#b0ed55}
    #gallery-bulk-list-dialog .list-pagebar{justify-content:center;color:#9eabb5;font-size:11px}
    #gallery-bulk-list-dialog tfoot{background:#1d252c;position:sticky;bottom:0}
    #gallery-bulk-list-dialog tfoot td{border-top:1px solid #3a4650;border-bottom:0;color:#c6d0d7;font-weight:600}
    #gallery-bulk-list-dialog details{margin-top:8px;padding:8px 10px;border:1px solid #37424c;border-radius:6px;background:#20272f;font-size:11px}
    @media (max-width:640px){#gallery-bulk-list-dialog{padding:12px;width:96vw;max-width:96vw;max-height:calc(100vh - 24px)}#gallery-bulk-list-dialog .list-table-wrap{min-height:120px!important}#gallery-bulk-list-dialog .list-footer{justify-content:stretch}#gallery-bulk-list-dialog .list-footer button{flex:1}#gallery-bulk-list-dialog th,#gallery-bulk-list-dialog td{padding:6px 4px;font-size:10px}#gallery-bulk-list-dialog .listing-currency{min-width:0}#gallery-bulk-list-dialog .listing-currency>input{width:52px;padding-inline:3px}}
    #gallery-bulk-list-dialog{background:#191d23}
    #gallery-bulk-list-dialog .list-controls{gap:14px}
    #gallery-bulk-list-dialog .list-group{padding:16px 12px;border:0;border-radius:14px;background:#2e3336;gap:12px}
    #gallery-bulk-list-dialog .list-group>strong,#gallery-bulk-list-dialog .list-group>label{font-size:13px;color:#f2f4f6;text-transform:none;letter-spacing:normal;font-weight:600}
    #gallery-bulk-list-dialog .list-segments{justify-content:flex-start;gap:8px}
    #gallery-bulk-list-dialog .list-segments button{flex:none;padding:6px 10px}
    #gallery-bulk-list-dialog button[aria-pressed=true],#gallery-bulk-list-dialog .list-footer button.primary{background:#2ca65e;border-color:#2ca65e;color:#fff}
    #gallery-bulk-list-dialog .listing-range-box{background:transparent;border-color:#777;padding:10px}
    #gallery-bulk-list-dialog .listing-range-indicator{background:#2ca65e}
    #gallery-bulk-list-dialog .listing-range-thumb::-webkit-slider-thumb{border-color:#2ca65e;background:#191d23}
    /* Keep the Enhancer control geometry after the Workbench global
       button/input min-height rule has been applied. */
    #gallery-bulk-list-dialog .listing-range-values>input{height:27px!important;min-height:0!important;background:#45494c!important;border-color:#888}
    #gallery-bulk-list-dialog .listing-currency{min-width:96px;background:#45494c;border-color:#888}
    #gallery-bulk-list-dialog .listing-currency>input{width:70px;min-width:0;height:40px!important;min-height:0!important;font-size:14px}
    #gallery-bulk-list-dialog .listing-currency button{height:20px!important;width:24px;background:#45494c}
    #gallery-bulk-list-dialog .list-card{height:50px;width:82px;margin-right:7px}
    #gallery-bulk-list-dialog .list-card slot{transform:scale(.5)}
    #gallery-bulk-list-dialog .list-table-wrap{box-sizing:border-box;overflow-x:hidden;overflow-y:visible}
    #gallery-bulk-list-dialog th,#gallery-bulk-list-dialog td{white-space:normal;overflow-wrap:anywhere;box-sizing:border-box}
    #gallery-bulk-list-dialog th{position:static;text-transform:none;font-size:12px;background:#191d23;color:#fff;letter-spacing:normal}
    #gallery-bulk-list-dialog td small{display:block;font-size:10px;line-height:1.4;color:#c3c7c9}
    #gallery-bulk-list-dialog tbody{background:#424242}
    #gallery-bulk-list-dialog tfoot{position:static;background:#191d23}
    #gallery-bulk-list-dialog .list-footer{background:#191d23;border:0;padding:24px 0 8px}
    #gallery-bulk-list-dialog .dialog-header>button{border:0;background:transparent;font-size:22px;padding:0 4px}
    #gallery-bulk-list-dialog .list-selection{margin-right:auto}
    #gallery-bulk-list-dialog .list-pagebar{justify-content:flex-end;margin:26px 0 12px}
    #gallery-bulk-list-dialog .list-profit[data-sign=positive]{color:#00da55}#gallery-bulk-list-dialog .list-profit[data-sign=negative]{color:#ff9696}
  `;
  const header = add(dialog, 'div'); header.className = 'dialog-header'; add(header, 'strong', 'Bulk List');
  const close = add(header, 'button', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭');
  const source = add(dialog, 'small', '报价来源读取设置中的来源 · 挂牌不是成交，需 EA 确认'); source.className = 'list-source';
  const controls = add(dialog, 'div'); controls.className = 'list-controls';
  const group = () => { const e = add(controls, 'section'); e.className = 'list-group'; return e; };
  const durationGroup = group(), priceGroup = group(), delayGroup = group();
  const durationLabel = add(durationGroup, 'label', 'Duration'), duration = add(durationLabel, 'select'); duration.setAttribute('aria-label', '时长');
  for (const hours of [1,3,6,12,24,72]) { const o = add(duration, 'option', `${hours} Hour${hours === 1 ? '' : 's'}`); o.value = String(hours * 3600); }
  add(priceGroup, 'strong', 'Price');
  const segments = add(priceGroup, 'div'); segments.className = 'list-segments';
  const mode = { value: 'percentage' }, modes = new Map();
  for (const [value, label] of [['fixed','Fixed'],['percentage','Percentage'],['steps','Steps']]) {
    const button = add(segments, 'button', label); button.type = 'button'; modes.set(value, button);
    button.addEventListener('click', event => { if (event.isTrusted && !busy && mode.value !== value) { mode.value = value; changeSettings(true); } });
  }
  const percentFields = add(priceGroup, 'div'), fixedFields = add(priceGroup, 'div');
  fixedFields.className = 'list-fields';
  const field = (parent, label, value, type = 'number') => {
    const wrap = add(parent, 'label'), caption = add(wrap, 'span', label), input = add(wrap, 'input'); input.type = type; input.value = String(value); input.setAttribute('aria-label', label);
    if (type === 'range') { const display = () => { caption.textContent = `${label} · ${input.value}`; }; input.addEventListener('input', display); input.updateCaption = display; }
    return input;
  };
  let pctMinValue = 100, pctMaxValue = 100;
  const percentageRange = mountListingRange({ document, parent: percentFields, label: 'Price Range %', labels: ['最低百分比', '最高百分比'], min: 0, max: 200, value: [100, 100], enabled: () => !busy,
    onValueChange: next => { pctMinValue = next[0]; pctMaxValue = next[1]; changeSettings(true); } });
  const pctMin = { get value() { return String(pctMinValue); }, set value(v) { pctMinValue = Number(v); }, updateCaption() {} };
  const pctMax = { get value() { return String(pctMaxValue); }, set value(v) { pctMaxValue = Number(v); }, updateCaption() {} };
  const startControl = mountListingCurrency({ document, parent: add(fixedFields, 'label', 'Start Bid'), label: 'Start Bid', enabled: () => !busy,
    onCommit: value => {
      let changed = false;
      if (value != null && fixedControl.getValue() != null && value > fixedControl.getValue()) {
        fixedControl.setValue(moveGalleryListingPrice(value, 1, prepared?.priceTiers)); changed = true;
      }
      // yMt's memo excludes fixedStartPrice. Recompute BIN only if coupling
      // actually changes fixedPrice; Start Bid itself is read by the planner.
      changeSettings(changed);
    } });
  const fixedControl = mountListingCurrency({ document, parent: add(fixedFields, 'label', 'Buy Now'), label: 'Buy Now', enabled: () => !busy,
    onCommit: value => {
      if (value != null && startControl.getValue() != null && startControl.getValue() > value) {
        startControl.setValue(moveGalleryListingPrice(value, -1, prepared?.priceTiers));
      }
      changeSettings(true);
    } });
  const steps = field(priceGroup, '价格档位', 0);
  steps.min = '-20'; steps.max = '20';
  // Enhancer cMt uses one dual slider, with non-crossing integer endpoints.
  let delayRangeValues = [3, 5];
  const delayRange = mountListingRange({ document, parent: delayGroup, label: 'Wait Time Between Listings',
    labels: ['最少秒数', '最多秒数'], min: 1, max: 15, value: delayRangeValues, enabled: () => !busy,
    onValueChange: next => { delayRangeValues = next; changeSettings(false); } });
  const toolbar = add(dialog, 'div'); toolbar.className = 'list-toolbar';
  const selectionTools = add(toolbar, 'div'); selectionTools.className = 'toolbar-group';
  const all = add(selectionTools, 'button', 'Select all'); all.setAttribute('aria-label', '全选');
  const none = add(selectionTools, 'button', 'Clear'); none.setAttribute('aria-label', '取消选择');
  const viewTools = add(toolbar, 'div'); viewTools.className = 'toolbar-group';
  const cards = add(viewTools, 'button', 'Cards'); cards.setAttribute('aria-label', '卡片视图');
  const tableView = add(viewTools, 'button', 'Table'); tableView.setAttribute('aria-label', '表格视图');
  const tableWrap = add(dialog, 'div'); tableWrap.className = 'list-table-wrap';
  const table = add(tableWrap, 'table');
  const heading = add(table, 'thead'), hr = add(heading, 'tr');
  for (const text of ['','Player','Previously Listed','Price','Bought For','Profit/Loss']) add(hr, 'th', text);
  const body = add(table, 'tbody');
  const footer = add(add(table, 'tfoot'), 'tr'); const totalLabel = add(footer, 'td', '选中盈亏'); totalLabel.colSpan = 5;
  const totalProfit = add(footer, 'td'); totalProfit.className = 'list-profit';
  const pages = add(dialog, 'div'); pages.className = 'list-toolbar';
  const selectionCount = add(pages, 'span'); selectionCount.className = 'list-selection';
  const previous = add(pages, 'button', 'Previous'); previous.setAttribute('aria-label', '上一页');
  const pageStatus = add(pages, 'span'); pages.classList.add('list-pagebar');
  const next = add(pages, 'button', 'Next'); next.setAttribute('aria-label', '下一页');
  const progress = add(dialog, 'progress'); progress.style.width = '100%'; progress.max = 1; progress.value = 0;
  progress.hidden = true;
  const execution = add(dialog, 'div'); execution.hidden = true;
  const output = add(dialog, 'output'); output.setAttribute('role', 'status');
  const actions = add(dialog, 'div'); actions.className = 'list-footer';
  const cancel = add(actions, 'button', 'Cancel'); cancel.type = 'button'; cancel.setAttribute('aria-label', '取消');
  const submit = add(actions, 'button', 'Bulk List'); submit.className = 'primary';
  const stop = add(actions, 'button', 'Stop'); stop.hidden = true; stop.setAttribute('aria-label', '停止');
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
  const selected = new Set(), overrides = {}, rows = new Map();
  let generatedPrices = null;
  let viewMode = 'cards', pageIndex = 0;
  let busy = false, identity = null, prepared = null, plan = null, resumeRunId = null, disposed = false, scheduleState = 'absent';
  const settings = () => ({ priceMode: mode.value, percentageRange: [Number(pctMin.value), Number(pctMax.value)],
    fixedPrice: fixedControl.getValue(), fixedStartPrice: startControl.getValue(),
    steps: Number(steps.value), durationSeconds: Number(duration.value), delaySeconds: [...delayRangeValues], playerView: viewMode });
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
    FC27_GALLERY_LISTING_QUOTE_EXPIRED: '基准源报价已过期，未开始挂牌；请重新打开读取报价。',
    'market-price-unavailable': '基准源无报价',
    'market-price-expired': '基准源报价已过期，请重新打开',
    'price-limits-unavailable': 'EA 价格范围读取失败',
    'price-out-of-range': '挂牌价格超出 EA 范围',
    'listing-price-invalid': '未设置有效一口价',
    'start-price-invalid': '起拍价无效',
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
    // Enhancer oMt switches this column with playerView. The quote source
    // remains the independently configured FCAT listing reference.
    hr.children[2].textContent = viewMode === 'table' ? prepared?.source ?? 'Market Price' : 'Previously Listed';
    pages.hidden = false;
    previous.hidden = next.hidden = pageStatus.hidden = viewMode !== 'cards' || rows.size <= 10;
    selectionCount.textContent = `${selected.size} of ${rows.size} row(s) selected.`;
    pageIndex = Math.max(0, Math.min(pageIndex, Math.ceil(rows.size / 10) - 1));
    previous.disabled = busy || pageIndex === 0; next.disabled = busy || (pageIndex + 1) * 10 >= rows.size;
    pageStatus.textContent = `${pageIndex + 1} / ${Math.max(1, Math.ceil(rows.size / 10))}`;
    let index = 0;
    for (const row of rows.values()) {
      row.tr.hidden = viewMode === 'cards' && Math.floor(index++ / 10) !== pageIndex;
      if (!row.card) continue;
      const show = viewMode === 'cards' && !row.tr.hidden;
      row.card.hidden = !show || row.cardAttempted && !row.native; row.name.hidden = show && !!row.native;
      row.reference.replaceChildren(); row.quoteLine.textContent = '';
      add(row.reference, 'span', (viewMode === 'table' ? row.quote : row.previousPrice) ?? 'N/A');
      if (row.quotes) for (const source of ['futgg', 'futbin']) {
        const value = row.quotes[source];
        if (value != null) add(row.quoteLine, 'span', `${source === 'futgg' ? 'GG' : 'BIN'} ${value}`);
      }
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
    if (pricesChanged) generatedPrices = null;
    void Promise.resolve(service.writeSettings?.(settings())).catch(() => {});
    refresh();
  };
  const refresh = () => {
    percentFields.hidden = mode.value !== 'percentage';
    fixedFields.hidden = mode.value !== 'fixed'; steps.parentElement.hidden = mode.value !== 'steps';
    for (const [value, button] of modes) button.setAttribute('aria-pressed', String(mode.value === value));
    for (const input of [pctMin,pctMax]) input.updateCaption();
    renderView();
    if (!prepared || resumeRunId || busy) return;
    // Price every row once as Enhancer does, including temporarily unselected
    // rows. Selection/duration/delay/view changes must not rerandomize prices.
    if (generatedPrices === null) generatedPrices = previewGalleryListingPrices({ candidates: prepared.candidates,
      marketPrices: prepared.prices, priceTiers: prepared.priceTiers, settings: settings(), overridesByItem: overrides });
    // Keep automatic generated prices separate from manual overrides. This is
    // what allows the service to distinguish a frozen market preview from a
    // user-entered fixed amount when a quote expires before execution.
    const effectiveOverrides = { ...overrides };
    plan = service.plan({ selectedIds: [...selected], settings: settings(),
      overridesByItem: effectiveOverrides, previewPrices: generatedPrices });
    let total = 0;
    for (const [id, row] of rows) {
      const entry = plan.entries?.find(e => e.item.id === id), skip = plan.skipped?.find(e => e.itemId === id);
      if (!row.price) continue;
      const bin = overrides[id] ?? generatedPrices[id] ?? entry?.buyNow;
      row.currency.setValue(bin ?? null);
      row.state.textContent = !selected.has(id) ? '' : entry ? '' : reasonText(skip?.reason ?? '不可用');
      row.price.title = entry ? `${entry.startPrice} → ${entry.buyNow}` : row.state.textContent;
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
        row = { tr, state: add(tr.children[3], 'small') }; rows.set(entry.item.id, row); }
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
  // A queued close event must not dispose the cards of a newly reopened dialog.
  dialog.addEventListener('close', () => { if (!dialog.open) disposeCards(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else disposeCards(); });
  duration.addEventListener('change', event => { if (event.isTrusted && !busy) changeSettings(); });
  steps.addEventListener('input', event => { if (event.isTrusted && !busy && steps.value !== '') {
    const value = Math.max(-20, Math.min(20, Math.round(Number(steps.value))));
    steps.value = String(value); changeSettings(true);
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
      generatedPrices = null;
      scheduleStatus.textContent = '尚无计划'; scheduleValue.value = '';
      dialog.showModal(); setBusy(true); output.textContent = '正在读取已购实体和报价…';
      try {
        const saved = await service.readSettings?.();
        viewMode = saved?.playerView === 'table' ? 'table' : 'cards';
        if (saved?.priceMode) mode.value = saved.priceMode;
        if (Array.isArray(saved?.percentageRange)) { pctMin.value = String(saved.percentageRange[0]); pctMax.value = String(saved.percentageRange[1]); percentageRange.setValue(saved.percentageRange); }
        fixedControl.setValue(saved?.fixedPrice ?? null);
        startControl.setValue(saved?.fixedStartPrice ?? null);
        if (Number.isSafeInteger(saved?.steps)) steps.value = String(saved.steps);
        if (Number.isSafeInteger(saved?.durationSeconds)) duration.value = String(saved.durationSeconds);
        if (Array.isArray(saved?.delaySeconds)) { delayRangeValues = [...saved.delaySeconds]; delayRange.setValue(delayRangeValues); }
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
          const names = (result.requestedSources ?? ['futgg']).map(value => value === 'futgg' ? 'FUT.GG' : 'FUTBIN');
          source.textContent = `${names.join(' + ')} · 基准 ${result.source ?? 'FUT.GG'}`;
          for (const e of result.candidates) {
            const tr = add(body, 'tr'), check = add(add(tr, 'td'), 'input'); check.type = 'checkbox';
            check.setAttribute('aria-label', `选择 ${e.name}`);
            const player = add(tr, 'td'), card = add(player, 'div'), slot = document.createElement('slot'), name = add(player, 'span', e.name); card.className = 'list-card';
            slot.name = `gallery-bulk-card-${String(e.item.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`; card.append(slot);
            const reference = add(tr, 'td');
            const priceCell = add(tr, 'td');
            const currency = mountListingCurrency({ document, parent: priceCell, label: `${e.name} Buy Now`, enabled: () => !busy,
              limits: () => result.limitsByItem?.[e.item.id] ?? {},
              onCommit: value => {
                if (value == null) delete overrides[e.item.id]; else overrides[e.item.id] = value;
                // yMt depends on the override map as well as pricing settings.
                // Recalculate ALL base rows, then reapply every manual price.
                generatedPrices = null; refresh();
              } });
            const price = currency.input;
            const quoteLine = add(priceCell, 'small');
            const purchasePrice = e.boughtFor ?? e.purchase?.purchasePrice;
            add(tr, 'td', purchasePrice > 0 ? String(purchasePrice) : 'N/A');
            const profitCell = add(tr, 'td'); profitCell.className = 'list-profit';
            const state = add(priceCell, 'small');
            const quoteKnown = Number.isFinite(Number(result.prices?.[e.item.definitionId])) && Number(result.prices[e.item.definitionId]) > 0;
            check.checked = quoteKnown; if (quoteKnown) selected.add(e.item.id);
            rows.set(e.item.id, { tr, check, price, currency, state, card, name, reference, quoteLine, entry: e, purchasePrice, profit: profitCell,
              quote: result.prices[e.item.definitionId], quotes: result.pricesBySource?.[e.item.definitionId], previousPrice: e.previousListingPrice, slot });
            check.addEventListener('change', event => { if (event.isTrusted && !busy) { if (check.checked) selected.add(e.item.id); else selected.delete(e.item.id); refresh(); } });
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
