// FCAT module layout. Gallery loads its public catalogue lazily when selected.
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
    .gallery-toolbar{align-items:center;margin-top:0}.gallery-toolbar #gallery-status{color:#bdcbd3;font-size:13px}.gallery-background-progress{display:block;width:100%;height:6px;margin-top:12px;accent-color:#9df3d5}.gallery-categories{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.gallery-categories button{display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;min-height:126px;padding:14px;text-align:left;border-radius:10px;background:#22323d;border-color:#455a66}.gallery-categories button:hover,.gallery-categories button[aria-pressed=true]{border-color:#9df3d5;background:#273f38;color:#b3ffe3}.gallery-category-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px}.gallery-category-icons{display:flex;align-items:center;gap:3px;min-width:44px}.gallery-category-icon{width:34px;height:34px;object-fit:contain}.gallery-category-count{color:#aabac3;font-size:11px;white-space:nowrap}.gallery-category-name{display:block;margin-top:14px;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gallery-set-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.gallery-set{display:flex;flex-direction:column;padding:0;background:#22323d;border:1px solid #455a66;border-radius:10px;cursor:pointer;overflow:hidden}.gallery-set:hover{border-color:#7abfa8}.gallery-set h4{font-size:15px;margin:0}.gallery-set button{min-height:34px;padding:6px 10px}.gallery-set-title{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 12px;background:#304451;border-bottom:1px solid #455a66}.gallery-set-title h4{grid-column:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gallery-set-title .gallery-set-icons{grid-column:1;grid-row:1}.gallery-set-title .gallery-watch{grid-column:3;grid-row:1}.gallery-set-icons{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;min-height:24px}.gallery-set-icon{width:22px;height:22px;object-fit:contain}.gallery-set-metrics{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 12px 0;color:#c1ced5;font-size:12px}.gallery-set-metrics .gallery-collected{font-weight:700;color:#b3ffe3}.gallery-set-metrics .gallery-summary{color:#d9e5ec}.gallery-grades{margin:12px 12px 0}.gallery-grade-track{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;width:100%;min-width:0}.gallery-grade-cell{display:grid;justify-items:center;gap:3px;min-width:0}.gallery-grade-diamond{display:grid;place-items:center;width:24px;height:24px;transform:rotate(45deg);border:1px solid #667681;background:#26353e;color:#c0cbd1;font-size:11px}.gallery-grade-diamond::first-letter{transform:rotate(-45deg)}.gallery-grade-diamond.is-reached{color:#17251f;background:#b1f5d7;border-color:#d4fff0}.gallery-grade-diamond.is-current{transform:rotate(45deg) scale(1.25)}.gallery-grade-bar{display:block;width:100%;height:3px;border-radius:3px;background:#52616a;overflow:hidden}.gallery-grade-bar i{display:block;height:100%;background:#9df3d5}.gallery-grade-threshold{font-size:9px;color:#aabac3;white-space:nowrap}.gallery-unknown{color:#e7dbad}.gallery-set-detail{margin-top:18px;padding:16px;background:#22323d;border:1px solid #3a4b57;border-radius:10px}.gallery-detail-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.gallery-identity{min-width:0}.gallery-emblems,.gallery-player-logos{display:flex;gap:6px;align-items:center}.gallery-emblem{width:34px;height:34px;object-fit:contain}.gallery-overview{display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:4px 10px;margin-top:14px;padding:12px;background:#304451;border-radius:8px}.gallery-big-count{font-size:25px;color:#b3ffe3}.gallery-muted{font-size:11px;color:#c1ced5}.gallery-overview .gallery-grade-track{grid-column:1/-1}.gallery-facts{margin-top:8px}.gallery-facts>summary{padding:6px 0;font-size:12px}.gallery-reward-row{display:grid;grid-template-columns:32px 72px minmax(0,1fr);gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #455a66;font-size:12px}.gallery-player-card{display:grid;grid-template-columns:72px 1fr;gap:10px;padding:10px;background:#304451;border-radius:7px;font-size:12px;min-width:0;overflow:hidden}.gallery-card-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:8px;margin-top:12px}.gallery-player-art{display:grid;place-items:center;min-height:94px;border-radius:6px;background:linear-gradient(145deg,#b1f5d7,#427e70);overflow:hidden}.gallery-player-meta{display:grid;align-content:start;gap:4px;min-width:0}.gallery-player-meta strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gallery-player-version,.gallery-player-score{color:#c1ced5;font-size:11px}.gallery-mini-emblem{width:16px;height:16px;object-fit:contain}.gallery-player-flags{display:flex;gap:4px;align-items:center}.gallery-status-icon{display:inline-grid;place-items:center;width:19px;height:19px;border-radius:50%;font-size:12px;font-weight:700;border:1px solid currentColor}.gallery-status-icon.is-yes{color:#b1f5d7}.gallery-status-icon.is-no{color:#aabac3}.gallery-status-icon.is-unknown{color:#e7dbad}.gallery-set-detail h3{margin-top:14px}.gallery-set-detail button{min-height:44px}.gallery-set-detail button[aria-pressed=true]{border-color:#9df3d5;color:#b3ffe3}.gallery-set-detail:empty{display:none}
    .gallery-score{margin-top:16px;padding:14px;border:1px solid #517368;border-radius:8px;overflow-wrap:anywhere}.gallery-score>strong{font-size:17px;color:#b3ffe3}.gallery-score>p{margin-top:8px}.gallery-score summary{padding:12px 0;color:#c6e8dc}.gallery-lineup,.gallery-bonuses{font-size:12px}.gallery-grade[data-reached=true]{background:#32554a;color:#b3ffe3;border:1px solid #678e7c}
    .gallery-plan{margin-top:16px;padding:14px;border:1px solid #53616b;border-radius:8px}.gallery-plan>strong{display:block;color:#b3ffe3}.gallery-plan>.row{align-items:center}.gallery-plan select{min-width:170px;width:auto}.gallery-plan-output{margin-top:8px}.gallery-plan-output details{margin-top:6px}.gallery-plan-output summary{padding:7px 0;color:#c6e8dc}.gallery-plan-output ul{margin:6px 0 0}
    .gallery-modes{display:flex;gap:0;margin:16px 0}.gallery-modes button{border-radius:0}.gallery-modes button:first-child{border-radius:5px 0 0 5px}.gallery-modes button:last-child{border-radius:0 5px 5px 0}.gallery-modes button[aria-pressed=true]{border-color:#9df3d5;color:#b3ffe3;background:#273f38}
    .gallery-joint-target{display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,160px) 40px;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid #455a66}.gallery-joint-target>strong{overflow-wrap:anywhere}.gallery-joint-target small{grid-column:1/-1;margin-top:0}.gallery-joint-target button{padding:4px;width:40px;height:40px}.gallery-joint-controls{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:16px 0}.gallery-joint-controls label{margin:0;max-width:260px}.gallery-joint-output{overflow-wrap:anywhere}.gallery-joint-output table{width:100%;border-collapse:collapse;font-size:12px}.gallery-joint-output td,.gallery-joint-output th{text-align:left;border-bottom:1px solid #455a66;padding:8px 4px;vertical-align:top}.gallery-joint-output details{margin-top:12px}.gallery-joint-output summary{padding:8px 0}.gallery-joint-add{min-width:44px}
    .card+.card-block,.card-block{margin-top:18px}.accent{color:#8bf0c8}label{display:grid;gap:7px;margin:12px 0;font-size:13px}select{width:100%}.row{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}
    .primary{background:#b1f5d7;color:#152c22;border-color:#b1f5d7;font-weight:600}small{display:block;color:#a5b7c4;font-size:12px;margin-top:8px}.advanced{border:1px solid #3a4b57;border-radius:12px;margin-top:18px;background:#1c2a34}.advanced>summary{padding:16px 20px;font-size:14px;color:#d9e5ec}.advanced-content{padding:0 20px 20px}
    .operation-status{margin:24px 24px 0;border-top:1px solid #36444e;padding:12px 0 20px;color:#b2c1cc;font-size:12px;overflow-wrap:anywhere}.operation-status output{display:block;color:#e7dbad;margin-top:4px}
    #detail,#requirements,#squad{overflow-wrap:anywhere}#detail{margin-top:12px}#requirements:empty,#squad:empty{display:none}#requirements,#squad{margin-top:18px;padding:16px;background:#22323d;border-radius:8px}.requirement{margin-top:10px;border-top:1px solid #45535c;padding-top:10px}ul{padding-left:20px}#squad ol{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0;gap:6px}#squad li{padding:8px;background:#304451;border-radius:4px}
    dialog{max-width:min(440px,calc(100vw - 24px));color:#edf1f4;background:#22323d;border:1px solid #617781;border-radius:10px}dialog::backdrop{background:#0009}
    @media(max-width:650px){.body{padding:16px}.module-tabs{padding:10px 16px;gap:6px}.feature-grid,.settings-grid,.gallery-set-list,.gallery-categories{grid-template-columns:1fr}.section-heading{align-items:flex-start;flex-direction:column;gap:10px}h2{font-size:20px}.card{padding:16px}.operation-status{margin:16px 16px 0}#squad ol{grid-template-columns:repeat(2,minmax(0,1fr))}.gallery-browse-nav{top:60px}.gallery-header{align-items:flex-start}.gallery-header .gallery-toolbar{margin-top:-4px}}
    .gallery-player-card{isolation:isolate}
    .gallery-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.gallery-header h2{margin:0}.gallery-header .gallery-toolbar{margin:0;align-items:center}.gallery-header .gallery-toolbar button{min-width:40px;padding-inline:10px}.gallery-source-details{margin:0 0 12px;color:#9dabb7}.gallery-source-details summary{padding:4px 0}.gallery-source-details [role=status]{margin-left:4px}.gallery-browse-nav{position:sticky;top:68px;z-index:3;display:flex;align-items:center;gap:10px;margin:0 -2px 12px;padding:8px 2px;background:#17212c;border-bottom:1px solid #36444e}.gallery-browse-nav button{width:40px;min-height:40px;padding:0;font-size:22px;line-height:1}.gallery-browse-nav strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gallery-set>.gallery-open-set{align-self:flex-end;margin:12px}.gallery-set>.gallery-unknown,.gallery-set>.badge{margin:10px 12px}.gallery-set-title{min-width:0}.gallery-set-icon{width:32px;height:42px}
    @media(min-width:651px) and (max-width:1023px){.gallery-categories,.gallery-set-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:650px){.gallery-browse-nav{top:64px}.gallery-set>.gallery-open-set{align-self:stretch}}
    .gallery-grade-letter{display:block;transform:rotate(-45deg)}
    .gallery-category-top{flex-wrap:wrap}.gallery-category-icons{margin-right:auto}.gallery-category-rewards,.gallery-reward-summary{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px;max-width:100%;font-size:12px;color:#b9c8d0}.gallery-reward-token{display:inline-flex;align-items:center;gap:5px;min-width:0}.gallery-reward-token-icon{width:16px;height:16px;object-fit:contain}.gallery-reward-label{overflow-wrap:anywhere}.gallery-reward-token-value{font-variant-numeric:tabular-nums;font-weight:600}.gallery-set-metrics .gallery-reward-summary{margin-left:auto}.gallery-score-caption{font-size:11px;color:#9dabb5}.gallery-collection-flag{color:#e7dbad}.gallery-browse-tools{margin-bottom:12px}.gallery-browse-tools>summary{padding:6px 0;font-size:12px;color:#9dabb5}.gallery-categories button,.gallery-set,.gallery-set-detail{border-radius:8px}
    .gallery-grade-diamond.grade-d{border-color:#b9703f}.gallery-grade-diamond.grade-c{border-color:#a3acb6}.gallery-grade-diamond.grade-b{border-color:#d8a93f}.gallery-grade-diamond.grade-a{border-color:#33b6a6}.gallery-grade-diamond.grade-s{border-color:#9b72ff}.gallery-grade-diamond.grade-d.is-reached{background:#b9703f;color:#fff}.gallery-grade-diamond.grade-c.is-reached{background:#a3acb6;color:#17212c}.gallery-grade-diamond.grade-b.is-reached{background:#d8a93f;color:#17212c}.gallery-grade-diamond.grade-a.is-reached{background:#33b6a6;color:#17212c}.gallery-grade-diamond.grade-s.is-reached{background:#9b72ff;color:#fff}
    .gallery-player-card{grid-template-columns:184px minmax(0,1fr)}.gallery-card-list{grid-template-columns:repeat(auto-fit,minmax(min(350px,100%),1fr))}.gallery-player-art{position:relative;align-content:start;min-height:228px;background:none;overflow:visible;gap:4px;padding-inline:20px;box-sizing:border-box}.gallery-card-pricebar{display:flex;justify-content:space-between;gap:4px;width:100%;align-items:center;color:#fff;font-size:10px;font-weight:700;pointer-events:none}.gallery-card-price,.gallery-card-gallery-score{padding:2px 4px;border-radius:4px;background:#1119;white-space:nowrap}.gallery-player-art>slot{display:block;width:144px;height:200px}.gallery-player-art>slot::slotted(.gallery-native-card){width:144px;height:200px}.gallery-card-select{position:absolute;top:38px;left:4px;width:20px;height:20px;min-height:20px;margin:0;padding:0;z-index:2;accent-color:#9df3d5}.gallery-text-card{box-sizing:border-box;width:144px;min-height:200px;border:1px solid #617883;border-radius:8px;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:12px;text-align:center;color:#dae9ef;background:#273944}.gallery-text-card-rating{font-size:28px}.gallery-text-card-name{font-size:13px}.gallery-text-card-meta{font-size:11px;color:#b5c5ce}
    @media(max-width:600px){.gallery-player-card{grid-template-columns:minmax(0,1fr)}.gallery-player-art{width:184px;justify-self:center}.gallery-player-meta{justify-items:center;text-align:center}}
    .gallery-browse-controls{align-items:center;margin:10px 0}.gallery-browse-controls>input{flex:1;min-width:120px;width:auto}.gallery-browse-controls>select{width:auto;max-width:100%}.gallery-followed-toggle{display:flex;align-items:center;gap:6px;margin:0}.gallery-followed-toggle input{width:18px;height:18px}.gallery-watch{min-width:36px;width:36px;height:36px;flex:0 0 auto;padding:0!important}.gallery-watch[aria-pressed=true]{color:#b3ffe3;border-color:#9df3d5}.gallery-joint-target .gallery-target-open{width:auto;grid-column:1/-1;justify-self:start;padding:4px 10px}#gallery-target-status{display:block;font-size:12px;color:#e7dbad;overflow-wrap:anywhere}
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
      <section id="page-gallery" role="tabpanel" aria-labelledby="tab-gallery" tabindex="0" hidden>
        <nav id="gallery-browse-nav" class="gallery-browse-nav" aria-label="Gallery 导航" hidden><button id="gallery-back" type="button" aria-label="返回集合" title="返回集合">←</button><strong id="gallery-browse-title"></strong></nav>
        <div class="gallery-header"><h2>Gallery</h2><div class="row gallery-toolbar"><button id="gallery-refresh" aria-label="更新集合目录" title="更新集合目录">↻</button><button id="gallery-sync" hidden>同步收集</button><button id="gallery-purchase-resume" hidden>核对并继续购买</button><span id="gallery-sync-time"></span></div></div>
        <progress id="gallery-background-progress" class="gallery-background-progress" hidden max="1" value="0" aria-label="Gallery 收集同步进度"></progress>
        <small id="gallery-source-error" class="gallery-unknown" role="status"></small><small id="gallery-progress-note"></small>
        <details class="gallery-source-details"><summary><span id="gallery-source">尚未同步目录</span></summary><span id="gallery-status" role="status">首次打开 Gallery 时读取公开集合目录。</span></details>
        <dialog id="gallery-sync-dialog"><div class="row"><strong>同步收集</strong><button id="gallery-sync-stop" aria-label="停止同步" title="停止同步">停止</button></div><progress id="gallery-sync-progress" max="1" value="0" style="width:100%"></progress><output id="gallery-sync-message" role="status"></output></dialog>
        <dialog id="gallery-purchase-dialog"><div class="row"><strong>Gallery 购买</strong><button id="gallery-purchase-stop">停止</button><button id="gallery-purchase-close" hidden>关闭</button></div><progress id="gallery-purchase-progress" max="1" value="0" style="width:100%"></progress><output id="gallery-purchase-message" role="status"></output></dialog>
        <div class="gallery-modes" role="group" aria-label="Gallery 视图"><button id="gallery-mode-browse" aria-pressed="true">收集进度</button><button id="gallery-mode-joint" aria-pressed="false">联合规划 <span id="gallery-joint-count">0</span></button></div>
        <output id="gallery-target-status" aria-live="polite"></output>
        <div id="gallery-browse">
        <div id="gallery-summary"><div id="gallery-categories" class="gallery-categories"></div></div>
        <section id="gallery-sets" hidden><h3 id="gallery-category-title" hidden>集合</h3><details class="gallery-browse-tools"><summary>搜索与排序</summary><div class="row gallery-browse-controls"><input id="gallery-search" type="search" placeholder="搜索集合" aria-label="搜索集合" maxlength="200"><select id="gallery-sort" aria-label="集合排序"><option value="catalog">目录顺序</option><option value="name">名称</option><option value="cards">所需卡数</option><option value="progress">已同步收集进度</option></select><label class="gallery-followed-toggle"><input id="gallery-followed" type="checkbox">关注</label></div></details><div id="gallery-set-list" class="gallery-set-list"></div></section>
        <section id="gallery-set-detail" class="gallery-set-detail" aria-live="polite" hidden></section>
        </div>
        <section id="gallery-joint" hidden><h3>联合目标</h3><div id="gallery-joint-targets"></div><div class="gallery-joint-controls"><label>总预算（金币）<input id="gallery-joint-budget" type="number" min="0" step="1" placeholder="不限"></label><button id="gallery-joint-plan" class="primary" disabled>生成联合方案</button></div><div id="gallery-joint-output" class="gallery-joint-output" aria-live="polite"></div></section>
      </section>
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
        <div id="gallery-proxy-card" class="card"><h3>Gallery 网络</h3><label>FUT.GG HTTPS 转发代理<input id="gallery-proxy" type="url" placeholder="https://proxy.example/" autocomplete="off"><small>用于 FUT.GG 直连受限时的 Gallery 目录和卡池读取。这里需要 HTTPS 转发端点；127.0.0.1:1080 这类 SOCKS/浏览器代理请在专用浏览器或系统层配置，不能直接填入。</small></label><div class="row"><button id="gallery-proxy-save" class="primary">保存代理</button><button id="gallery-proxy-clear">清除代理</button></div></div>
        <div id="diagnostic-export-card" class="card"><h3>离线诊断</h3><p>导出最近的脱敏运行事件，用于离线调查 Gallery 回退、限流和网络错误。</p><small>不包含 URL、响应正文、凭证、账号标识或完整球员数据。</small><div class="row"><button id="export-diagnostics" class="primary">导出诊断日志</button></div><output id="diagnostic-export-status" aria-live="polite"></output></div>
        <div class="card"><h3>安装与多标签检查</h3><p>仅在需要排查存储或多标签占用问题时运行。</p><div class="row"><button id="gm">检查脚本存储</button><button id="hold">检查标签锁</button></div></div></div>
      </section>
    </div><div class="operation-status" aria-live="polite">最近一次工作台操作<output id="status">尚无操作</output></div>
  </details></div><dialog id="action-approval-dialog"><p id="approval"></p><div class="row"><button id="cancel">取消</button><button id="confirm">确认</button></div></dialog>`;
}

export function bindFc27WorkbenchTabs(shadow, host, onSelect = () => {}) {
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
    onSelect(id);
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
