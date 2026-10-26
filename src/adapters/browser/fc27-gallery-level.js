// Exact level, user-recorded console level and milestone evidence remain
// separate. This surface has no claim, XP-write or purchase callback.
export function mountGalleryLevel({ document, parent, service, visible = () => true, timers = document.defaultView }) {
  if (!service || !parent) return null;
  parent.hidden = false;
  const add = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  const line = add('div'); line.className = 'row';
  const title = document.createElement('strong'); title.textContent = '画廊等级：待核实'; line.append(title);
  const reward = document.createElement('span'); line.append(reward);
  const refresh = document.createElement('button'); refresh.textContent = '刷新等级奖励'; refresh.type = 'button'; line.append(refresh);
  const status = add('output'); status.setAttribute('role', 'status');
  const details = add('details'), summary = document.createElement('summary'); summary.textContent = '等级来源 / 主机记录'; details.append(summary);
  const note = document.createElement('p'); note.textContent = 'EA 目前返回等级里程碑状态，没有精确等级或 XP；不按 token 或合集评分猜等级。'; details.append(note);
  const label = document.createElement('label'); label.textContent = '主机确认等级（可选）'; details.append(label);
  const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '1000'; input.step = '1'; label.append(input);
  const save = document.createElement('button'); save.textContent = '保存主机记录'; save.type = 'button'; details.append(save);
  const explanation = document.createElement('small'); explanation.textContent = '仅存本机并标明来源，不修改 EA 等级。等级奖励仍在游戏内确认/领取。'; details.append(explanation);
  const list = document.createElement('ul'); details.append(list);
  let active = false, epoch = 0, snapshot = null, consoleNote = null, interval = null;
  const render = () => {
    const minimum = snapshot?.confirmedAtLeast;
    title.textContent = snapshot?.exactLevel != null ? `画廊等级：Lv.${snapshot.exactLevel}（EA）`
      : consoleNote && !(minimum > consoleNote.level) ? `画廊等级：Lv.${consoleNote.level}（主机记录）`
        : minimum != null ? `画廊等级：至少 Lv.${minimum}（EA 里程碑）` : '画廊精确等级：待 EA 数据确认';
    const next = snapshot?.nextMilestone;
    reward.textContent = next ? `下一奖励节点 Lv.${next.level} · ${next.rewards.join(' / ') || '奖励描述待核实'}` : '下一等级奖励：待核实';
    input.value = consoleNote ? String(consoleNote.level) : '';
    list.replaceChildren();
    for (const milestone of snapshot?.milestones ?? []) {
      const li = document.createElement('li');
      const state = milestone.claimed === true ? '已领取' : milestone.completed === true ? '已达成，未领取' : milestone.completed === false ? '未达成' : '完成状态待核实';
      li.textContent = `Lv.${milestone.level} · ${state} · ${milestone.rewards.join(' / ') || '奖励描述待核实'}`; list.append(li);
    }
  };
  const load = async force => {
    if (!active || !visible()) return;
    let scope;
    try { scope = service.scope(); } catch { status.textContent = '账号上下文待就绪，等级信息尚未读取。'; return; }
    const token = ++epoch; refresh.disabled = true; save.disabled = true; status.textContent = '正在读取画廊等级奖励…';
    const current = () => active && token === epoch && scope === service.scope();
    try {
      const storedNote = await service.readNote(); if (!current()) return; consoleNote = storedNote;
      snapshot = service.peek(); render();
      if (force || !snapshot || Date.now() - (snapshot.observedAt ?? 0) >= 300000) {
        const updated = await service.refresh(); if (!current()) return; snapshot = updated;
      }
      if (!current()) return;
      render(); status.textContent = snapshot?.status === 'observed'
        ? '已刷新 EA 等级里程碑；精确等级与升级 XP 尚未由此接口提供。'
        : '等级目标暂未核实；现有画廊收集和整体规划不受影响。';
    } catch { if (active) status.textContent = '等级信息读取未完成，未领取奖励或修改等级。'; }
    finally { if (token === epoch) { refresh.disabled = false; save.disabled = false; } }
  };
  refresh.addEventListener('click', event => { if (event.isTrusted) void load(true); });
  save.addEventListener('click', async event => {
    if (!event.isTrusted || !active) return;
    const level = Number(input.value); if (!Number.isSafeInteger(level) || level < 1 || level > 1000) { status.textContent = '请输入主机上确认的等级。'; return; }
    const token = ++epoch; save.disabled = true;
    try { const value = await service.saveNote(level); if (!active || token !== epoch) return; consoleNote = value; render(); status.textContent = '已保存本机主机记录；不是 EA 自动读取的精确等级。'; }
    catch { if (active) status.textContent = '主机等级记录保存未确认，请重试。'; }
    finally { save.disabled = false; }
  });
  const setActive = value => {
    active = value; epoch++;
    if (interval !== null) timers.clearInterval(interval); interval = null;
    if (active) { void load(false); interval = timers.setInterval(() => { void load(false); }, 300000); }
    else { snapshot = null; consoleNote = null; refresh.disabled = false; save.disabled = false; status.textContent = ''; render(); }
  };
  return { setActive, snapshot: () => ({ ...snapshot, consoleNote }), dispose: () => { setActive(false); parent.replaceChildren(); } };
}
