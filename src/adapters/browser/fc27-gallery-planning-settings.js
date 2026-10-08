import { DEFAULT_GALLERY_PLANNING_TIMEOUT_MS, MAX_GALLERY_PLANNING_TIMEOUT_MS, MIN_GALLERY_PLANNING_TIMEOUT_MS } from '../../gallery/planning-settings.js';

export function mountGalleryPlanningSettings({ document, parent, service }) {
  if (!service) return { refresh() {} };
  const add = (owner, tag, text = '') => { const node = document.createElement(tag); node.textContent = text; owner.append(node); return node; };
  const card = add(parent, 'section'); card.id = 'gallery-planning-settings'; card.className = 'card';
  add(card, 'h3', 'Gallery 方案计算');
  const label = add(card, 'label', '方案计算时间上限（秒）');
  const input = add(label, 'input'); input.type = 'number'; input.min = String(MIN_GALLERY_PLANNING_TIMEOUT_MS / 1000); input.max = String(MAX_GALLERY_PLANNING_TIMEOUT_MS / 1000); input.step = '1'; input.setAttribute('aria-label', '方案计算时间上限（秒）');
  add(card, 'small', `默认 ${DEFAULT_GALLERY_PLANNING_TIMEOUT_MS / 1000} 秒，范围 ${input.min}-${input.max} 秒。仅影响 Gallery 方案搜索，不改变报价、预算或购买授权。`);
  const save = add(card, 'button', '保存 Gallery 方案设置'); save.type = 'button';
  const output = add(card, 'output'); output.setAttribute('role', 'status');
  let account = null, busy = false, epoch = 0;
  const enable = enabled => { input.disabled = !enabled; save.disabled = !enabled; };
  const message = error => error?.message === 'FC27_GALLERY_CONTEXT_CHANGED' ? '账号已变化，请重新打开设置。' : 'Gallery 方案设置读取或保存失败，请重试。';
  const refresh = async () => {
    if (busy) return;
    const token = ++epoch; account = null; enable(false);
    try {
      const expected = service.scope(), value = await service.read();
      if (token !== epoch) return;
      if (service.scope() !== expected) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
      account = expected; input.value = String(value.timeoutMs / 1000); output.textContent = ''; enable(true);
    } catch (error) { if (token === epoch) output.textContent = message(error); }
  };
  save.addEventListener('click', async event => {
    if (!event.isTrusted || busy || !account) return;
    const seconds = Number(input.value);
    if (!Number.isSafeInteger(seconds) || seconds < Number(input.min) || seconds > Number(input.max)) { output.textContent = `请输入 ${input.min}-${input.max} 秒。`; return; }
    busy = true; enable(false);
    try {
      if (service.scope() !== account) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
      await service.save({ timeoutMs: seconds * 1000 });
      if (service.scope() !== account) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
      output.textContent = '已保存；下一次方案计算生效。';
    } catch (error) { output.textContent = message(error); }
    finally { busy = false; try { enable(service.scope() === account); } catch { enable(false); } }
  });
  enable(false);
  return { refresh };
}
