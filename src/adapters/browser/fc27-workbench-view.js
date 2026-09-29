// FCAT module layout. Tab changes are local UI operations only.
export const FC27_WORKBENCH_TABS = Object.freeze([
  ['sbc', 'SBC 解题'], ['gallery', 'Gallery'], ['market', '市场'],
  ['trading', '自动交易'], ['inventory', '库存'], ['routine', 'Routine'],
  ['rolling', '滚卡'], ['activity', '活动记录'], ['settings', '设置'],
]);

const planned = (id, title, description, features, status = '规划中 · 尚未接入') => `
  <section id="page-${id}" role="tabpanel" aria-labelledby="tab-${id}" tabindex="0" hidden>
    <div class="section-heading"><div><p class="eyebrow">${title}</p><h2>${description}</h2></div><span class="badge planned">${status}</span></div>
    <div class="feature-grid">${features.map(([name, text]) => `<article class="card"><h3>${name}</h3><p>${text}</p></article>`).join('')}</div>
    <p class="module-note">本页当前仅展示功能规划，尚不执行操作。</p>
  </section>`;

export function fc27WorkbenchMarkup() {
  return `<style>
    :host{all:initial;position:fixed;inset:0;z-index:100002;display:none;padding:24px 12px;background:#0008;font:14px/1.5 Arial,sans-serif;color:#edf1f4;letter-spacing:0}
    *{box-sizing:border-box;letter-spacing:0}[hidden]{display:none!important}
    .workbench{width:min(1100px,100%);height:100%;margin:auto;background:#17212c;border:1px solid #3c4852;border-radius:8px;overflow:auto}
    :host([data-navigation-page]){position:relative;inset:auto;z-index:auto;min-height:100%;padding:0;background:#17212c}
    :host([data-navigation-page]) .workbench{width:100%;height:auto;min-height:100%;margin:0;border:0;border-radius:0;overflow:visible}
    summary{padding:10px 24px;font-size:12px;color:#9dabb7;cursor:pointer}
    :host([data-navigation-page]) .workbench>details>summary{display:none}
    .module-tabs{display:flex;gap:8px;overflow-x:auto;padding:12px 24px;background:#17212c;border-bottom:1px solid #36444e;scrollbar-width:thin;position:sticky;top:0;z-index:2}
    button,select,input{font:inherit;color:inherit;background:#202d36;border:1px solid #46545d;border-radius:5px;padding:9px 12px;min-height:40px;max-width:100%}
    button{cursor:pointer}button:disabled{opacity:.45;cursor:default}
    button[role=tab]{flex:0 0 auto;min-width:88px;min-height:44px;white-space:nowrap;border-radius:10px;background:#1d2931;font-weight:500}
    button[role=tab][aria-selected=true]{border-color:#9df3d5;background:#273740;color:#b3ffe3}
    button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #9df3d5;outline-offset:2px}
    .body{padding:24px;max-width:1280px;margin:0 auto}h2,h3,p{margin:0}h2{font-size:23px;line-height:1.3;margin-top:4px}h3{font-size:16px;margin-bottom:10px}
    .section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.eyebrow{font-size:12px;color:#9cabb7}
    .badge{display:inline-block;flex-shrink:0;font-size:12px;border:1px solid #517368;color:#a7efd2;background:#203c35;border-radius:20px;padding:4px 10px}.badge.planned{border-color:#53616b;color:#bac7d0;background:#25313a}
    .feature-grid,.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{padding:20px;background:#22323d;border:1px solid #3a4b57;border-radius:12px;min-width:0}.card p,.module-note{color:#bdcbd3}.card p+p{margin-top:10px}.module-note{font-size:13px;margin-top:18px}
    .card+.card-block,.card-block{margin-top:18px}.accent{color:#8bf0c8}label{display:grid;gap:7px;margin:12px 0;font-size:13px}select{width:100%}.row{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
    .primary{background:#b1f5d7;color:#152c22;border-color:#b1f5d7;font-weight:600}small{display:block;color:#a5b7c4;font-size:12px;margin-top:8px}.advanced{border:1px solid #3a4b57;border-radius:12px;margin-top:18px;background:#1c2a34}.advanced>summary{padding:16px 20px;font-size:14px;color:#d9e5ec}.advanced-content{padding:0 20px 20px}
    .operation-status{margin:24px 24px 0;border-top:1px solid #36444e;padding:12px 0 20px;color:#b2c1cc;font-size:12px;overflow-wrap:anywhere}.operation-status output{display:block;color:#e7dbad;margin-top:4px}
    #detail,#requirements,#squad{overflow-wrap:anywhere}#detail{margin-top:12px}#requirements:empty,#squad:empty{display:none}#requirements,#squad{margin-top:18px;padding:16px;background:#22323d;border-radius:8px}.requirement{margin-top:10px;border-top:1px solid #45535c;padding-top:10px}ul{padding-left:20px}#squad ol{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0;gap:6px}#squad li{padding:8px;background:#304451;border-radius:4px}
    dialog{max-width:min(440px,calc(100vw - 24px));color:#edf1f4;background:#22323d;border:1px solid #617781;border-radius:10px}dialog::backdrop{background:#0009}
    @media(max-width:650px){.body{padding:16px}.module-tabs{padding:10px 16px;gap:6px}.feature-grid,.settings-grid{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column;gap:10px}h2{font-size:20px}.card{padding:16px}.operation-status{margin:16px 16px 0}#squad ol{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style><div class="workbench"><details open><summary></summary>
    <nav class="module-tabs" role="tablist" aria-label="FCAT 功能模块">${FC27_WORKBENCH_TABS.map(([id, label], index) => `<button type="button" role="tab" id="tab-${id}" aria-controls="page-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join('')}</nav>
    <div class="body">
      <section id="page-sbc" role="tabpanel" aria-labelledby="tab-sbc" tabindex="0">
        <div class="section-heading"><div><p class="eyebrow">SBC PUZZLE</p><h2>解题与补卡</h2></div><span class="badge">已接入原生 SBC</span></div>
        <div class="card"><h3>在原生阵容中完成操作</h3><p>进入目标 SBC，点击右栏的 <span class="accent">FCAT 解题填充</span>，将库存球员和缺失的概念球员一起填入阵容。</p><p>需要补卡时，再点击同一侧栏的 <span class="accent">FCAT 批量购买</span>。提交 SBC 仍为独立操作。</p></div>
        <div id="puzzle-settings" class="card card-block"><h3>解题与采购设置</h3><div class="settings-grid">
          <label>金卡最高评分<input id="puzzle-rating" type="number" min="1" max="99" step="1" value="82"><small>默认 82；已保存的更低上限继续有效。</small></label>
          <label id="puzzle-quote-setting">补卡单卡报价上限（金币）<input id="puzzle-quote-ceiling" type="number" min="150" max="15000000" step="1" placeholder="不限"><small>留空为不限；此项用于补卡规划。</small></label>
          <label id="puzzle-queries-setting">购买查价次数<input id="puzzle-queries" type="number" min="1" step="1" value="5"><small>默认 5 次。</small></label>
        </div><small>铜银卡按原生品质要求选材；最低银卡＋至少 2 金按 2 金＋其余银卡解题。金卡仍受 FSU 范围限制，缺料不自动增加金卡或提高评分。</small><div class="row"><button id="puzzle-policy-save" class="primary">保存解题设置</button></div></div>
        <details class="advanced" data-sbc-advanced><summary>需求检查与单次操作</summary><div class="advanced-content">
          <p class="module-note">原生右栏是日常解题入口。这里保留需求检查、方案预览及已有的单次确认操作。</p>
          <div class="settings-grid"><label>SBC<select id="target"></select></label><label>传统单次 SBC 评分上限<select id="rating"><option>74</option><option>83</option></select></label></div>
          <div class="row"><button id="refresh" title="Refresh targets" aria-label="Refresh targets">刷新列表</button><button id="catalog">读取需求</button><button id="puzzle">解题预览</button><button id="prepare">校验阵容</button><button id="execute" disabled>单次提交</button><button id="fill" disabled>填阵并保存</button></div>
          <div id="requirements" aria-live="polite"></div><div id="squad"></div>
        </div></details>
      </section>
      ${planned('gallery', 'GALLERY', '收集目标与缺卡采购', [['收集进度', '查看收集目标、已拥有版本与缺失球员。'], ['缺卡采购', '根据缺口比较价格，生成采购计划并核对收集进度。']])}
      ${planned('market', 'MARKET', '价格比较与订单执行', [['搜索与比价', '筛选精确球员版本，对比参考价格与实时挂牌。'], ['买入与挂牌', '管理手动订单、批量买入与挂牌结果。SBC 概念球员购买目前已在原生 SBC 侧栏提供。']])}
      ${planned('trading', 'TRADING', '定时买入与售出', [['定时任务', '按指定时间或周期执行购买、挂牌和重新挂牌。'], ['执行条件', '为任务设置价格范围、预算、有效期及停止条件。']])}
      ${planned('inventory', 'INVENTORY', '库存与材料管理', [['库存视图', '统一查看 Club、Storage、重复卡与可用材料。'], ['整理与保护', '规划库存整理，查看选材限制、锁卡及保护冲突。']])}
      ${planned('routine', 'ROUTINE', '日常任务编排', [['任务组合', '将每日操作组织为可复用的有限步骤。'], ['进度与续跑', '查看完成情况，从已确认的中断位置继续。']])}
      ${planned('rolling', 'ROLLING', '连续 SBC 循环', [['FC27 循环', '在适合重复制作的 SBC 和 FC27 合同就绪后接入。'], ['当前优先级', '优先完善解题、Gallery 与交易。旧 FC26 的 Rolling、Swap 和预测逻辑不会直接启用。']], '暂缓开发')}
      <section id="page-activity" role="tabpanel" aria-labelledby="tab-activity" tabindex="0" hidden>
        <div class="section-heading"><div><p class="eyebrow">ACTIVITY</p><h2>操作记录与恢复</h2></div><span class="badge">基础恢复检查</span></div>
        <div class="card"><h3>当前会话</h3><p>最近一次工作台操作结果显示在页底；详细信息显示在此。跨模块历史列表尚未接入。</p><div id="detail"></div></div>
        <div class="card card-block"><h3>单次 SBC 恢复检查</h3><p>核对已有单次 SBC 事务记录，再确认可恢复结果。</p><div class="row"><button id="recovery">检查恢复记录</button><button id="resolve" disabled>确认恢复结果</button></div></div>
      </section>
      <section id="page-settings" role="tabpanel" aria-labelledby="tab-settings" tabindex="0" hidden>
        <div class="section-heading"><div><p class="eyebrow">SETTINGS</p><h2>设置与诊断</h2></div></div>
        <div class="feature-grid"><div class="card"><h3>当前版本</h3><p id="workbench-version"></p><small id="workbench-mode"></small><p class="module-note">解题与采购参数在「SBC 解题」页设置。</p></div>
        <div class="card"><h3>安装与多标签检查</h3><p>仅在需要排查存储或多标签占用问题时运行。</p><div class="row"><button id="gm">检查脚本存储</button><button id="hold">检查标签锁</button></div></div></div>
      </section>
    </div><div class="operation-status" aria-live="polite">最近一次工作台操作<output id="status">尚无操作</output></div>
  </details></div><dialog><p id="approval"></p><div class="row"><button id="cancel">取消</button><button id="confirm">确认</button></div></dialog>`;
}

export function bindFc27WorkbenchTabs(shadow, host) {
  const tabs = FC27_WORKBENCH_TABS.map(([id]) => shadow.getElementById(`tab-${id}`));
  const select = id => {
    if (!FC27_WORKBENCH_TABS.some(([key]) => key === id)) return;
    for (const [key] of FC27_WORKBENCH_TABS) {
      const active = key === id;
      const tab = shadow.getElementById(`tab-${key}`);
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      shadow.getElementById(`page-${key}`).hidden = !active;
    }
    host.dataset.activeTab = id;
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', event => { if (event.isTrusted) select(FC27_WORKBENCH_TABS[index][0]); });
    tab.addEventListener('keydown', event => {
      if (!event.isTrusted) return;
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); select(FC27_WORKBENCH_TABS[next][0]); tabs[next].focus();
      tabs[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  });
  select('sbc');
  return select;
}
