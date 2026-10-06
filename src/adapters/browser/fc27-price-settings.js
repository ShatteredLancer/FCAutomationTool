// Account-scoped settings UI shared by Gallery and Puzzle. Mount only when
// the caller supplies the shared service; saving never initiates a trade.
export function mountFc27PriceSettings({ document, parent, service }) {
  if (!service) return { refresh() {} };
  const add = (parent, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  const card = add(parent, 'section'); card.className = 'card'; card.id = 'public-price-settings';
  add(card, 'h3', '报价与交易价格 · Gallery / Puzzle');
  const fields = add(card, 'div'); fields.className = 'settings-grid';
  const select = (label, values) => {
    const control = add(add(fields, 'label', label), 'select'); control.setAttribute('aria-label', label);
    for (const [value, text] of values) { const option = add(control, 'option', text); option.value = value; }
    return control;
  };
  const readSources = select('读取公共报价来源', [['futgg', 'FUT.GG'], ['futbin', 'FUTBIN'], ['both', 'Both · 双源']]);
  const source = select('购买 / 挂牌价格参考', [['futgg', 'FUT.GG'], ['futbin', 'FUTBIN']]);
  const mode = select('允许超过参考价', [['fixed', '固定金币'], ['percent', '百分比']]);
  const number = (label, min) => {
    const control = add(add(fields, 'label', label), 'input'); control.type = 'number'; control.min = String(min); control.step = '1';
    control.setAttribute('aria-label', label); return control;
  };
  const premium = number('溢价数值', 0), attempts = number('每卡购买尝试次数', 1);
  const validity = number('报价有效期（分钟）', 1); validity.max = '30';
  add(card, 'small', '购买与挂牌共用参考来源，溢价仅用于购买。报价优先复用有效缓存，缺失或过期时更新。保存后新方案生效，已批准的价格不变。');
  add(card, 'small', '报价有效期 1–30 分钟，默认 5，从实际获取报价时计时。保存后新读取生效；已打开的挂牌窗口请关闭后重新打开。失败重试等待不受此设置影响。');
  const preview = add(card, 'output'); preview.setAttribute('aria-live', 'polite');
  const row = add(card, 'div'); row.className = 'row';
  const save = add(row, 'button', '保存价格设置'); save.type = 'button'; save.className = 'primary';
  const status = add(card, 'output'); status.setAttribute('aria-live', 'polite');
  let scope = null, busy = false, epoch = 0;
  const enabled = value => {
    for (const control of [source, mode, premium, attempts, validity, readSources, save]) control.disabled = !value;
  };
  const syncFutbin = () => {
    for (const control of [source]) {
      for (const option of control.options) option.disabled = readSources.value !== 'both' && option.value !== readSources.value;
      if (readSources.value !== 'both') control.value = readSources.value;
    }
  };
  const summary = () => {
    const value = premium.valueAsNumber;
    preview.textContent = Number.isSafeInteger(value) && value >= 0
      ? `单卡上限：${source.value === 'futgg' ? 'FUT.GG' : 'FUTBIN'} 参考价 + ${value}${mode.value === 'percent' ? '%' : ' 金币'}` : '请输入非负整数溢价';
  };
  const reason = error => ({
    FC27_PUBLIC_PRICE_POLICY_INVALID: '设置无效，请检查来源、非负整数溢价、正整数尝试次数及 1–30 分钟整数有效期。',
    FC27_PUBLIC_PRICE_POLICY_SAVE_FAILED: '保存失败，设置尚未确认，请重试。',
    FC27_PUBLIC_PRICE_CONTEXT_CHANGED: '账号已变化，请重新打开设置。',
  })[error?.message] ?? '无法读取当前账号设置，请登录后重试。';
  for (const control of [source, mode, premium]) control.addEventListener('input', summary);
  const refresh = async () => {
    if (busy) return;
    const token = ++epoch; enabled(false); scope = null;
    try {
      const expected = service.scope(), value = await service.readSettings();
      if (token !== epoch) return;
      if (service.scope() !== expected) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
      scope = expected; source.value = value.source; mode.value = value.premiumMode;
      premium.value = String(value.premium); attempts.value = String(value.purchaseAttempts);
      validity.value = String(value.quoteValidityMinutes ?? 5);
      readSources.value = value.readSources ?? (value.futbinEnabled === false ? 'futgg' : 'both');
      syncFutbin();
      summary(); status.textContent = ''; enabled(true);
    } catch (error) { if (token === epoch) { status.textContent = reason(error); enabled(false); } }
  };
  save.addEventListener('click', async event => {
    if (!event.isTrusted || busy) return;
    busy = true; enabled(false);
    try {
      if (!scope || scope !== service.scope()) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
      await service.saveSettings({ source: source.value, premiumMode: mode.value, premium: premium.valueAsNumber,
        purchaseAttempts: attempts.valueAsNumber, readSources: readSources.value, listingSource: source.value,
        quoteValidityMinutes: validity.valueAsNumber,
        futbinEnabled: readSources.value !== 'futgg', futbinRefresh: 'cache' });
      if (scope !== service.scope()) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
      status.textContent = '当前账号价格设置已保存；新批次生效，进行中的购买上限不变。';
    } catch (error) { status.textContent = reason(error); }
    finally { busy = false; let same = false; try { same = scope === service.scope(); } catch { /* Logged out. */ } enabled(same); }
  });
  readSources.addEventListener('change', () => { syncFutbin(); summary(); });
  enabled(false);
  return { refresh };
}
