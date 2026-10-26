// Public zero-collection market estimates, deliberately separate from the
// account route and its revolving-capital forecast.
export function renderGalleryReferenceTable(document, parent, targets, snapshot) {
  parent.replaceChildren();
  const add = (root, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; root.append(node); return node; };
  const details = add(parent, 'details'); details.open = true;
  add(details, 'summary', `Fodder 公开 D–S 参考 · ${targets.filter(t => t.publicReference).length}/${targets.length} 合集已对齐`);
  add(details, 'p', `平台 ${snapshot.platform === 'pc' ? 'PC' : '主机'} · 读取 ${new Date(snapshot.fetchedAt).toLocaleTimeString()}。空收藏采购额，未扣你的收藏；不是周转本金，也不是购买限价。底层行情时间未提供。`);
  const scroll = add(details, 'div'); scroll.className = 'gallery-roadmap-table'; scroll.style.maxHeight = '260px';
  const table = add(scroll, 'table'), head = add(table, 'tr');
  for (const name of ['合集', 'D', 'C', 'B', 'A', 'S']) add(head, 'th', name);
  for (const target of targets) {
    const tr = add(table, 'tr'); add(tr, 'th', target.set.name);
    for (const name of ['D','C','B','A','S']) {
      const grade = target.publicReference?.grades.find(grade => grade.grade === name);
      add(tr, 'td', grade?.cost != null ? grade.cost.toLocaleString('en-US') : '—');
    }
  }
  return { collapse: () => { details.open = false; } };
}
