const number = value => Number.isSafeInteger(value) ? value.toLocaleString('en-US') : '未知';
const labels = {
  'history-reserved': '旧任务预留，需先核对记录', 'duplicate-unverified': 'Club 同版本尚未核实，请先在原生页面加载库存',
  trade: '正在挂牌、已售出或交易状态未核实', untradeable: '当前仅允许不可交易卡',
  locked: 'FSU 锁卡保护', 'active-squad': '当前主阵容保护', rating: '超过库存评分上限',
  'fsu-gold-range': '不在 FSU 金卡评分范围', special: '特殊卡保护', evolution: '进化卡保护',
  cosmetic: '外观卡保护', academy: '进化中保护', protected: '受保护材料', league: '联赛被排除',
  concept: '概念卡不可消耗', loan: '租借卡不可消耗', 'points-unknown': '积分尚未核实',
  'eligibility-ineligible': '不符合本 SBC 条件', 'eligibility-unknown': '本 SBC 资格尚未核实', pile: '库存位置未核实',
};
export const streamlinedExternalReason = reason => reason?.startsWith('prerequisite-')
  ? `Club 前置卡：${labels[reason.slice(13)] ?? reason.slice(13)}` : labels[reason] ?? reason;

// Display/selection only. No native query, materializer or transaction is
// reachable here. Selection persists across pages, but not after closing.
export function renderStreamlinedExternalSelection({ document, parent, snapshot, renderCard, onSelection, isBusy }) {
  const add = (parent, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  const selected = new Set(), rows = snapshot.rows, size = 24;
  const controls = new Set(); let page = 0, disposed = false, cardDisposers = [];
  add(parent, 'strong', `Transfer / Unassigned · ${number(rows.length)} 张`).className = 'result-summary';
  add(parent, 'small', `当前缓存 · 可选 ${number(rows.filter(row => row.selectable).length)} 张 · FSU 仅不可交易：${snapshot.policy.onlyUntradeable ? '开启' : '关闭'}`);
  add(parent, 'small', 'Club 有同版本时，预览会加入那张 Club 卡作为前置；确认消耗后才逐批移入外部卡。达到本轮目标即停止。');
  const summary = add(parent, 'output'); summary.dataset.externalSummary = '';
  const actions = add(parent, 'div'); actions.className = 'external-actions';
  const button = (text, action) => {
    const node = add(actions, 'button', text); node.type = 'button'; controls.add(node);
    node.addEventListener('click', event => { if (event.isTrusted && !disposed && !isBusy()) action(); }); return node;
  };
  button('选择本页可用卡', () => { for (const row of rows.slice(page * size, (page + 1) * size)) if (row.selectable) selected.add(row.item.key); paint(); });
  button('清空选择', () => { selected.clear(); paint(); });
  const previous = button('上一页', () => { page--; paint(); });
  const pageLabel = add(actions, 'span');
  const next = button('下一页', () => { page++; paint(); });
  const list = add(parent, 'div'); list.dataset.externalList = '';
  const notify = () => {
    const chosen = rows.filter(row => selected.has(row.item.key));
    const prerequisites = new Map(chosen.filter(row => row.prerequisite).map(row => [row.prerequisite.key, row.prerequisite]));
    summary.textContent = `已选外部卡 ${number(chosen.length)} 张 · ${number(chosen.reduce((sum, row) => sum + row.item.points, 0))} 分 · Club 前置 ${number(prerequisites.size)} 张`;
    onSelection(chosen.map(row => row.item.key));
  };
  const setBusy = () => {
    for (const control of controls) control.disabled = isBusy() || control.dataset.unavailable === 'true';
    previous.disabled = isBusy() || page === 0; next.disabled = isBusy() || (page + 1) * size >= rows.length;
  };
  const paint = () => {
    for (const dispose of cardDisposers) dispose(); cardDisposers = [];
    for (const node of list.querySelectorAll('input')) controls.delete(node);
    list.replaceChildren();
    page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1)));
    pageLabel.textContent = `${page + 1} / ${Math.max(1, Math.ceil(rows.length / size))}`;
    if (!rows.length) add(list, 'small', '当前缓存没有外部球员。请先在 EA 原生转会列表或未分配页面加载球员，再返回并点击“刷新列表”。');
    for (const row of rows.slice(page * size, (page + 1) * size)) {
      const element = add(list, 'div'); element.className = 'external-row';
      cardDisposers.push(renderCard(element, row.item));
      const info = add(element, 'div'); info.className = 'player-text';
      const label = add(info, 'label'); label.className = 'external-choice';
      const choice = add(label, 'input'); choice.type = 'checkbox'; choice.checked = selected.has(row.item.key);
      choice.dataset.unavailable = String(!row.selectable); controls.add(choice);
      choice.setAttribute('aria-label', `选择 ${row.item.name ?? `版本 ${row.item.definitionId}`} (${row.item.id})`);
      add(label, 'strong', row.item.name ?? `版本 ${row.item.definitionId}`);
      add(info, 'span', `${number(row.item.rating)} OVR · ${number(row.item.points)} 分 · ${row.item.pile === 'transfer' ? 'Transfer' : 'Unassigned'}`);
      if (!row.selectable) add(info, 'span', streamlinedExternalReason(row.reason)).className = 'inventory-warning';
      else add(info, 'span', row.prerequisite
        ? `先贡献 Club 同版本（${number(row.prerequisite.rating)} OVR · ${number(row.prerequisite.points)} 分）`
        : '执行时核对后移入 Club');
      choice.addEventListener('change', event => {
        if (!event.isTrusted || disposed || isBusy() || !row.selectable) return;
        if (choice.checked) selected.add(row.item.key); else selected.delete(row.item.key); notify();
      });
    }
    setBusy(); notify();
  };
  paint();
  return { keys: () => [...selected], setBusy, dispose() { disposed = true; for (const dispose of cardDisposers) dispose(); cardDisposers = []; controls.clear(); } };
}
