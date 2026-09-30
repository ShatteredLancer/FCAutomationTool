// Offline interface fixture only. No EA APIs, remote requests or purchases.
(() => {
  const tiers = ['D', 'C', 'B', 'A', 'S'];
  const thresholds = [10, 2400, 4800, 7800, 11200];
  const rewards = [0, 0, 20, 30, 50];
  const categories = [
    { id:'england', name:'Premier League / Barclays WSL', marks:['ENG 1','WSL'], teams:['Arsenal','Chelsea','Liverpool','Manchester City'] },
    { id:'spain', name:'LALIGA EA SPORTS / Liga F', marks:['LALIGA','LIGA F'], teams:['Real Madrid','FC Barcelona'] },
    { id:'germany', name:'Bundesliga / Frauen-Bundesliga', marks:['BUND','FRAUEN'], teams:['Bayern München','Borussia Dortmund'] },
    { id:'france', name:'Ligue 1 / Arkema PL', marks:['LIGUE 1','ARKEMA'], teams:['Paris Saint-Germain','Olympique Lyonnais'] },
    { id:'italy', name:'Serie A', marks:['SERIE A'], teams:['Inter','Juventus'] },
    { id:'leagues', name:'Leagues', marks:['LEAGUES'], teams:['联赛集合 A','联赛集合 B'] },
    { id:'rarities', name:'Rarities', marks:['RARE','SPECIAL'], teams:['稀有度集合 A','稀有度集合 B'] },
  ];
  const el = id => document.getElementById(id);
  const fmt = value => value.toLocaleString('zh-CN');
  const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const totalReward = rewards.reduce((sum, value) => sum + value, 0);
  const sets = categories.flatMap((category, ci) => category.teams.map((name, si) => {
    const seed = ci * 3 + si, count = [16, 8, 24, 4, 12, 20][seed % 6];
    return { id:`${category.id}-${si}`, categoryId:category.id, name, required:10, target:2,
      synced:true, filter:'all', selected:new Set(),
      cards:Array.from({ length:24 }, (_, index) => ({
        id:`demo-${ci}-${si}-${index}`, name:`示例球员 ${String(index + 1).padStart(2,'0')}`, variant:index + 1,
        rating:68 + (index * 3 + seed) % 22, score:90 + ((index * 3 + seed * 7) % 16) * 85,
        collected:index < count ? true : index >= 22 ? null : false,
        held:index < count && index % 3 !== 0,
        firstOwner:index < count && index % 3 !== 0 ? index % 2 === 0 : null,
        price:index % 9 === 0 ? null : 200 + ((index + seed) % 9) * 100,
      })) };
  }));
  const filters = new Map(categories.map(category => [category.id,{ search:'',state:'all',sort:'name' }]));
  let route = {}, focusAfterRoute = false;
  function stats(set) {
    if (!set.synced) return null;
    const collected = set.cards.filter(card => card.collected === true);
    const base = collected.map(card => card.score).sort((a,b) => b-a).slice(0,set.required).reduce((sum,score) => sum+score,0);
    const bonus = collected.length >= set.required ? Math.floor(base * 0.1) : 0;
    const points = base + bonus;
    const level = collected.length >= set.required ? thresholds.findLastIndex(score => points >= score) : -1;
    const possibleReward = rewards.slice(0,level+1).reduce((sum,value) => sum+value,0);
    const claimed = level >= 2 ? 20 : 0;
    return { collected:collected.length, unknown:set.cards.filter(card => card.collected === null).length,
      held:collected.filter(card => card.held).length, base,bonus,points,level,possibleReward,claimed };
  }
  function summary(group) {
    const complete = group.every(set => set.synced);
    const versions = new Map();
    for (const set of group) for (const card of set.cards) versions.set(card.id,card.collected);
    return { complete,total:versions.size, collected:[...versions.values()].filter(value => value === true).length,
      unknown:[...versions.values()].filter(value => value === null).length,
      goals:group.filter(set => (stats(set)?.level ?? -1) >= set.target).length,
      claimed:group.reduce((sum,set) => sum+(stats(set)?.claimed ?? 0),0), reward:totalReward * group.length };
  }
  const routeUrl = (categoryId, setId) => `#category=${categoryId}${setId ? `&set=${setId}` : ''}`;
  function tierTrack(level) {
    return `<div class="grade-track" aria-label="等级门槛">${tiers.map((tier,index) => `<span class="grade-step ${index <= level ? 'reached' : ''}"><b>${tier}</b><small>${fmt(thresholds[index])}</small></span>`).join('')}</div>`;
  }
  function progress(known,total) {
    return `<div class="collection-progress" role="progressbar" aria-label="版本收集进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${known}"><span style="width:${known/total*100}%"></span></div>`;
  }
  function heading(title,subtitle,scope) {
    const ready=scope.every(set=>set.synced);
    return `<div class="gallery-heading"><div><h1 id="gallery-title" tabindex="-1">${escape(title)}</h1><p>${escape(subtitle)}</p></div><div class="gallery-actions"><small>${ready?'示例进度 · 刚刚同步':'尚未同步当前范围'}</small><button type="button" data-action="sync">${route.set?'同步此集合':route.category?'同步此分类':'同步收集进度'}</button></div></div>`;
  }
  function renderHome() {
    return heading('Gallery','按分类查看收集进度、等级与奖励。',sets)+`<div class="category-grid">${categories.map(category=>{
      const group=sets.filter(set=>set.categoryId===category.id), data=summary(group);
      return `<a class="category-card" href="${routeUrl(category.id)}" aria-label="查看 ${escape(category.name)} 进度">
        <div class="category-top"><div class="category-emblems" aria-hidden="true">${category.marks.map(mark=>`<span>${mark}</span>`).join('')}</div><span class="category-count">${group.length} 个示例集合</span></div>
        <h2>${escape(category.name)}</h2>
        ${data.complete?`<div class="progress-meta"><span>已收集 ${data.collected} / ${data.total} 版本</span><span>${data.unknown} 待核实</span></div>${progress(data.collected,data.total)}<div class="category-stats"><span>目标达标 ${data.goals} / ${group.length}</span><span><b>◆ ${data.claimed}</b> / ${data.reward}<small> 代币已领</small></span></div>`:`<div class="unknown-progress">${group.some(set=>set.synced)?'部分集合已同步，分类汇总待完成':'未同步 · 收集与奖励进度待读取'}</div><div class="category-stats"><span>进度 —</span><span>目录奖励 ◆ ${data.reward}</span></div>`}
      </a>`;
    }).join('')}</div><p class="foot">类别名称参考实际导航；本原型每类仅放少量示例集合，所有进度、积分、版本与奖励均为虚构。</p>`;
  }
  function setCard(set) {
    const data=stats(set), level=data?.level ?? -1;
    const note=!data?'未同步，进度待读取':data.collected<set.required?`展示人数还差 ${set.required-data.collected}，暂未定级`:level===4?(data.collected===set.cards.length?'已达 S 级，当前目录版本已收齐':'已达 S 级；仍可继续收集其他版本'):`距离 ${tiers[level+1]} 级还差 ${fmt(Math.max(0,thresholds[level+1]-data.points))} 分`;
    return `<article class="set-card"><a class="set-open" href="${routeUrl(set.categoryId,set.id)}" aria-label="查看 ${escape(set.name)} 集合">
      <div class="set-top"><h2>${escape(set.name)}</h2><span class="grade-label ${level<0?'pending':''}">${data?level>=0?tiers[level]+' 级':'未定级':'未同步'}</span></div>
      ${tierTrack(level)}<div class="set-metrics"><span>已收集版本<strong>${data?`${data.collected} / ${set.cards.length}`:'—'}</strong></span><span>当前总分<strong>${data?fmt(data.points):'—'}</strong></span></div>
      <p class="set-note">${note}</p><div class="set-footer"><span>${data?`代币已领 ${data.claimed} / ${totalReward}`:`目录奖励 ◆ ${totalReward}`}</span><span>查看球员 →</span></div>
    </a></article>`;
  }
  function filteredSets(category) {
    const filter=filters.get(category.id);
    return sets.filter(set=>set.categoryId===category.id && set.name.toLowerCase().includes(filter.search.toLowerCase()))
      .filter(set=>filter.state==='all'||(filter.state==='goal'?(stats(set)?.level??-1)>=set.target:set.synced&&(stats(set)?.level??-1)<set.target))
      .sort((a,b)=>filter.sort==='progress'?(stats(b)?.points??-1)-(stats(a)?.points??-1)||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
  }
  function renderCategory(category) {
    const group=sets.filter(set=>set.categoryId===category.id), data=summary(group),filter=filters.get(category.id);
    return heading(category.name,'选择集合，查看等级、缺失版本与下一档进度。',group)+
      `<div class="gallery-summary">${data.complete?`<span><strong>${data.collected} / ${data.total}</strong> 已收集版本</span><span><strong>${data.goals} / ${group.length}</strong> 目标达标</span><span><strong>${data.claimed} / ${data.reward}</strong> 代币已领取</span>`:'<span>尚未完成此分类同步，整体进度未知。</span>'}</div>
      <div class="gallery-controls"><input id="gallery-search" aria-label="搜索当前分类集合" placeholder="搜索集合" value="${escape(filter.search)}"><label>显示<select id="gallery-set-filter"><option value="all">全部集合</option><option value="goal">目标已达标</option><option value="unfinished">目标未达标</option></select></label><label>排序<select id="gallery-set-sort"><option value="name">名称 A–Z</option><option value="progress">当前积分</option></select></label></div><div class="set-grid" id="gallery-sets"></div>`;
  }
  function renderCards(set) {
    const active=set.filter;
    const visible=set.cards.filter(card=>active==='all'||active==='collected'&&card.collected===true||active==='missing'&&card.collected===false||active==='unknown'&&card.collected===null);
    if(!set.synced)return '<p class="empty">同步此集合后显示卡片与收集状态。当前未同步不会被视为全部缺失。</p>';
    return `<div class="player-grid">${visible.map(card=>`<article class="gallery-player ${card.collected===true?'collected':''} ${set.selected.has(card.id)?'selected':''}">
      <div class="player-art" aria-hidden="true"><strong>${card.rating}</strong><small>DEMO · ${card.variant}</small></div><div class="player-info"><h3>${card.name}</h3><p>版本 ${card.variant} · ${fmt(card.score)} 基础分</p><span class="player-status">${card.collected===true?'✓ 已收集':card.collected===false?'尚未收集':'收集状态待核实'}</span>
      <p>当前持有：${card.held?'是':'否'}</p><p>First Owner：${card.firstOwner===null?'未知':card.firstOwner?'是':'否'}</p>
      ${card.collected===false?`<p>参考价：${card.price===null?'未知':fmt(card.price)+' 金币'}</p><button type="button" data-select="${card.id}" aria-pressed="${set.selected.has(card.id)}" ${card.price===null?'disabled':''}>${set.selected.has(card.id)?'移出采购清单':'加入采购清单'}</button>`:''}</div></article>`).join('')}</div>${visible.length?'':'<p class="empty">此筛选下没有卡片。</p>'}`;
  }
  function renderSet(set) {
    const data=stats(set),level=data?.level??-1;
    return heading(set.name,'已收集、仍持有与 First Owner 分开显示。',[set])+`<div class="set-detail"><div class="detail-stats">
      <div><small>已收集版本</small><strong>${data?`${data.collected} / ${set.cards.length}`:'—'}</strong><div class="secondary-value">${data?`${data.unknown} 个版本待核实`:'未同步'}</div></div>
      <div><small>当前等级 / 总分</small><strong>${data?`${level>=0?tiers[level]:'未定级'} · ${fmt(data.points)}`:'—'}</strong><div class="secondary-value">${data?`基础 ${fmt(data.base)} ＋ 示例加成 ${fmt(data.bonus)}`:'基础分与加成待读取'}</div></div>
      <div><small>当前仍持有</small><strong>${data?data.held:'—'}</strong><div class="secondary-value">不等于历史已收集数量</div></div>
      <div><small>代币已领 / 目录总额</small><strong>${data?`${data.claimed} / ${totalReward}`:'—'}</strong><div class="secondary-value">${data?`按已达档位另可领取 ${data.possibleReward-data.claimed}`:'领取状态未知'}</div></div>
      </div>${tierTrack(level)}<div class="detail-bottom"><label>目标等级 <select id="gallery-target">${tiers.map((tier,index)=>`<option value="${index}">${tier}</option>`).join('')}</select></label><p id="gallery-target-gap"></p></div></div>
      <div class="card-filters" aria-label="卡片筛选">${[['all','全部'],['collected','已收集'],['missing','缺失'],['unknown','待核实']].map(([key,label])=>`<button type="button" data-filter="${key}" aria-pressed="${set.filter===key}">${label}${data?' '+(key==='all'?set.cards.length:set.cards.filter(card=>key==='collected'?card.collected===true:key==='missing'?card.collected===false:card.collected===null).length):''}</button>`).join('')}</div>
      <div id="gallery-players">${renderCards(set)}</div><div class="gallery-cart-bar" id="gallery-cart-bar" hidden><div><p id="gallery-selected-summary"></p><small>仅展示清单，不实际购买或改变收集状态。</small></div><button type="button" data-action="cart">查看采购清单</button></div>`;
  }
  function updateGap(set) {
    const data=stats(set);
    el('gallery-target-gap').textContent=!data?'同步后计算目标差距':data.collected<set.required?`人数还差 ${set.required-data.collected}；积分还差 ${fmt(Math.max(0,thresholds[set.target]-data.points))}`:data.level>=set.target?'目标等级已达标；达标不代表全部版本收齐。':`距离 ${tiers[set.target]} 级还差 ${fmt(Math.max(0,thresholds[set.target]-data.points))} 分`;
  }
  function updateCart(set) {
    const cards=set.cards.filter(card=>set.selected.has(card.id));
    el('gallery-cart-bar').hidden=!cards.length||!set.synced;
    el('gallery-selected-summary').textContent=`已选 ${cards.length} 张 · 参考合计 ${fmt(cards.reduce((sum,card)=>sum+card.price,0))} 金币`;
  }
  function updateSetGrid(category) {
    const group=filteredSets(category);
    el('gallery-sets').innerHTML=group.length?group.map(setCard).join(''):'<p class="empty">没有匹配的集合。</p>';
  }
  function renderRoute() {
    const params=new URLSearchParams(location.hash.slice(1));
    route={ category:categories.find(category=>category.id===params.get('category')) };
    route.set=sets.find(set=>set.categoryId===route.category?.id&&set.id===params.get('set'));
    const plan=location.hash==='#plan';
    el('planner-screen').hidden=!plan;el('browse-screen').hidden=plan;el('demo-sync').parentElement.hidden=plan;
    el('browse-link').toggleAttribute('aria-current',!plan);el('plan-link').toggleAttribute('aria-current',plan);
    (plan?el('plan-link'):el('browse-link')).setAttribute('aria-current','page');
    el('gallery-message').textContent='';
    if(plan)return;
    const crumbs=route.category?`<nav class="gallery-breadcrumbs" aria-label="收集导航"><a href="#">Gallery</a><span>›</span>${route.set?`<a href="${routeUrl(route.category.id)}">${escape(route.category.name)}</a><span>›</span><span>${escape(route.set.name)}</span>`:`<span>${escape(route.category.name)}</span>`}</nav>`:'';
    el('browse-screen').innerHTML=crumbs+(route.set?renderSet(route.set):route.category?renderCategory(route.category):renderHome());
    if(route.set){el('gallery-target').value=String(route.set.target);updateGap(route.set);updateCart(route.set);}
    else if(route.category){const filter=filters.get(route.category.id);el('gallery-set-filter').value=filter.state;el('gallery-set-sort').value=filter.sort;updateSetGrid(route.category);}
    if(focusAfterRoute)el('gallery-title').focus({preventScroll:true});
    focusAfterRoute=true;
  }
  el('browse-screen').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.action==='sync') {
      const scope=route.set?[route.set]:route.category?sets.filter(set=>set.categoryId===route.category.id):sets;
      scope.forEach(set=>set.synced=true);if(sets.every(set=>set.synced))el('demo-sync').value='synced';
      renderRoute();el('gallery-message').textContent='当前范围的示例进度已更新；未连接 EA。';return;
    }
    const set=route.set;if(!set)return;
    if(button.dataset.filter){set.filter=button.dataset.filter;renderRoute();el('browse-screen').querySelector(`[data-filter="${set.filter}"]`).focus({preventScroll:true});}
    else if(button.dataset.select){const id=button.dataset.select;if(set.selected.has(id))set.selected.delete(id);else set.selected.add(id);el('gallery-players').innerHTML=renderCards(set);updateCart(set);el('gallery-players').querySelector(`[data-select="${id}"]`)?.focus({preventScroll:true});}
    else if(button.dataset.action==='cart'){
      const cards=set.cards.filter(card=>set.selected.has(card.id));
      el('cart-content').innerHTML=`<p>${escape(set.name)} · ${cards.length} 个精确版本</p><ul>${cards.map(card=>`<li>${card.name} / 版本 ${card.variant} — ${fmt(card.price)} 金币</li>`).join('')}</ul><p>参考合计 ${fmt(cards.reduce((sum,card)=>sum+card.price,0))} 金币</p><p>这里只演示缺卡清单，实际购买尚未接入。关闭后保留选择。</p>`;
      el('gallery-cart').showModal();
    }
  });
  el('browse-screen').addEventListener('input',event=>{
    if(route.category&&!route.set&&event.target.id==='gallery-search'){filters.get(route.category.id).search=event.target.value;updateSetGrid(route.category);}
  });
  el('browse-screen').addEventListener('change',event=>{
    if(route.set&&event.target.id==='gallery-target'){route.set.target=Number(event.target.value);updateGap(route.set);}
    else if(route.category){const filter=filters.get(route.category.id);if(event.target.id==='gallery-set-filter')filter.state=event.target.value;else if(event.target.id==='gallery-set-sort')filter.sort=event.target.value;updateSetGrid(route.category);}
  });
  el('demo-sync').addEventListener('change',()=>{sets.forEach(set=>{set.synced=el('demo-sync').value==='synced';if(!set.synced)set.selected.clear();});renderRoute();});
  window.addEventListener('hashchange',renderRoute);
  renderRoute();
})();
