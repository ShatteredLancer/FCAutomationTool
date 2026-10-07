export function mountGalleryTradeSettings({ document, parent, service }) {
  if (!service) return { refresh() {} };
  const add = (parent, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  const card = add(parent, 'section'); card.id = 'gallery-trade-settings'; card.className = 'card';
  add(card, 'h3', 'Gallery 交易');
  const grid = add(card, 'div'); grid.className = 'settings-grid';
  const select = (label, options) => {
    const control = add(add(grid, 'label', label), 'select'); control.setAttribute('aria-label', label);
    for (const [value, text] of options) { const option = add(control, 'option', text); option.value = value; }
    return control;
  };
  const destination = select('Gallery 购卡去向', [['club', 'Club'], ['unassigned', 'Unassigned']]);
  const style = select('Gallery 购买 / 挂牌风格', [['enhancer', 'Enhancer'], ['fodder', 'Fodder']]);
  add(card, 'small', '去向仅作用于新购买批次；恢复沿用原批次设置。Unassigned 的收集进度以 EA 回读为准。');
  const save = add(card, 'button', '保存 Gallery 交易设置'); save.type = 'button';
  const output = add(card, 'output'); output.setAttribute('role', 'status');
  let account = null, busy = false, epoch = 0;
  const enable = value => { for (const node of [destination, style, save]) node.disabled = !value; };
  const message = error => error?.message === 'FC27_GALLERY_CONTEXT_CHANGED' ? '账号已变化，请重新打开设置。' : 'Gallery 交易设置读取或保存失败，请重试。';
  const refresh = async () => {
    if (busy) return;
    const token = ++epoch; account = null; enable(false);
    try {
      const expected = service.scope(), value = await service.read();
      if (token !== epoch) return;
      if (service.scope() !== expected) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
      account = expected; destination.value = value.destination; style.value = value.style; output.textContent = ''; enable(true);
    } catch (error) { if (token === epoch) output.textContent = message(error); }
  };
  save.addEventListener('click', async event => {
    if (!event.isTrusted || busy || !account) return;
    busy = true; enable(false);
    try {
      if (service.scope() !== account) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
      await service.save({ destination: destination.value, style: style.value });
      if (service.scope() !== account) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
      output.textContent = '已保存；新窗口和新购买批次生效。';
    } catch (error) { output.textContent = message(error); }
    finally { busy = false; try { enable(service.scope() === account); } catch { enable(false); } }
  });
  enable(false); return { refresh };
}
