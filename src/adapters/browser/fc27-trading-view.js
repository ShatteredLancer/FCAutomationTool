import {DESK_DEFAULTS,DESK_LIMITS,deskFunding,deskOpportunity,deskTrend,deskNet} from '../../trading/desk-model.js';

export function mountFc27TradingView({document,parent,tab,service,timers=globalThis,now=()=>Date.now()}){
  if(!parent)return {setActive(){}};
  const add=(p,tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;p.append(node);return node;};
  parent.replaceChildren();
  const style=add(parent,'style');style.textContent='.trading-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.trading-card{margin:12px 0;padding:14px;border:1px solid #526671;border-radius:7px;background:#22323d}.trading-card small{display:block;color:#bdcbd3}.trading-card input,.trading-card select{max-width:100%}.trading-chart{width:100%;height:100px;background:#17212c}.trading-warning{color:#ffdb8c}.trading-opportunity{border-color:#9df3d5}.trading-funding{font-size:16px}.trading-ledger{overflow-wrap:anywhere}.trading-card label:has(input[type=checkbox]){display:flex;align-items:center;gap:8px}.trading-card input[type=checkbox]{width:auto}.trading-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.trading-row>*{flex:1;min-width:100px}';
  style.textContent+='#page-trading{min-width:0;overflow-wrap:anywhere}.trading-grid>*{min-width:0}.trading-row>*{min-width:0;flex-basis:180px}.trading-card label{min-width:0;max-width:100%}.trading-card input,.trading-card select{min-width:0;width:100%}.trading-card input[type=checkbox]{width:18px;flex:0 0 18px}';
  add(parent,'h2','交易观察 · 手动执行');
  add(parent,'p','只读公共参考价、机会提醒和手填记录；不搜索 EA 挂单，不自动买入、移动、挂牌或重挂。没有防封承诺。','module-note');
  const status=add(parent,'output');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const funding=add(parent,'p','','trading-funding');
  const controls=add(parent,'div','','row');
  let active=false,busy=false,epoch=0,timer=null,context=null,state=null,attempted=0;
  const current=token=>active&&parent.isConnected&&token===epoch&&JSON.stringify(context)===JSON.stringify(service.context());
  const button=(p,label,task)=>{const node=add(p,'button',label);node.type='button';node.addEventListener('click',event=>{
    if(!event.isTrusted||busy||!active||!node.isConnected)return;
    void run(task);
  });return node;};
  const input=(p,label,value='',type='number')=>{const field=add(add(p,'label',label),'input');field.type=type;field.value=String(value);field.setAttribute('aria-label',label);if(type==='number'){field.min='0';field.step='1';}return field;};
  const errorText=error=>({DESK_WATCH_LIMIT:'观察名单最多 20 张，请先移除不需要的标的。',DESK_CONTEXT_CHANGED:'账号或页面已变化，已停止；重新打开交易观察。',
    DESK_SETTINGS_INVALID:'请检查资金设置；保留金币应不高于起始余额，上限为整数。',DESK_PLAYER_LINK_INVALID:'请输入 FC27 FUTBIN 球员页链接或精确 EA 版本 ID（不是 FUTBIN ID）。',
    DESK_RECORD_LIMIT:'手填记录已达 100 条；不会自动删除，先导出记录。',DESK_EVENT_INVALID:'请输入完整 X 原帖链接（/账号/status/数字），并选择状态。',
    DESK_MANUAL_CONFIRM_REQUIRED:'先勾选已在官方应用完成买入/卖出；这里只记账，不执行交易。',
    DESK_SAVE_UNVERIFIED:'本地保存未确认，先不要重复添加记录，请重新打开核对。'}[error?.message]??`操作未完成（${/^([A-Z0-9_]+)$/.test(error?.message??'')?error.message:'读取或保存失败'}）；未执行交易。`);
  const run=async task=>{const token=epoch;
    try{if(!current(token))throw Error('DESK_CONTEXT_CHANGED');}catch{pause();state=null;watch.replaceChildren();ledger.replaceChildren();alerts.replaceChildren();newsList.replaceChildren();funding.textContent='账号已变化，请重新打开交易观察。';tab.textContent='交易观察';return;}
    busy=true;
    try{const result=await task();if(!current(token))return;
      if(result?.state){state=result.state;context=result.context;render();} }
    catch(error){if(active&&token===epoch)status.textContent=errorText(error);}
    finally{if(token===epoch)busy=false;}
  };
  const pause=()=>{if(timer!==null)timers.clearInterval(timer);timer=null;monitor.textContent='开始观察（每 5 分钟）';};
  const refresh=async()=>{attempted=now();status.textContent='正在读取公共报价…';const token=epoch;
    const result=await service.refresh({isCurrent:()=>current(token),onProgress:value=>{if(current(token))status.textContent=`读取 ${value.source} ${value.index}/${value.total}`;}});
    if(current(token))status.textContent='公共报价已核对；缓存不是新样本，第三方参考价不代表可成交价。';return result;};
  button(controls,'刷新报价',refresh);
  const monitor=button(controls,'开始观察（每 5 分钟）',async()=>{
    if(timer!==null){pause();status.textContent='已停止定时观察。';return;}
    if(!state?.watch.length)throw Error('DESK_WATCH_EMPTY');
    monitor.textContent='停止观察';timer=timers.setInterval(()=>{if(active&&!busy&&now()-attempted>=300000)void run(refresh);},60000);
    return refresh();
  });
  button(controls,'机会标为已读',()=>service.acknowledge());
  button(controls,'导出本地记录',async()=>{
    const value=await service.read();const blob=new globalThis.Blob([JSON.stringify({schema:1,exportedAt:now(),platform:value.context.platform,manualRecords:true,state:value.state},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=add(parent,'a');link.href=url;link.download='FCAT-trading-notebook.json';link.click();link.remove();URL.revokeObjectURL(url);
  });
  const settings=add(parent,'details','','trading-card');add(settings,'summary','资金与利润设置（可手动调整）');
  const fields=add(settings,'div','','trading-grid'),names={startingCoins:'起始金币（手填）',capitalLimit:'试仓总上限',reserveCoins:'最低保留金币',unitLimit:'单卡买入上限',minProfit:'单卡目标净利润',buffer:'每卡跌价缓冲'};
  const inputs=Object.fromEntries(Object.entries(names).map(([key,label])=>[key,input(fields,label,DESK_DEFAULTS[key])]));
  add(settings,'small','起始金币＋手填买卖推算账面余额，不是 EA 实时余额；改上限不改历史、不授权交易。实际买卖前核对官方余额。');
  button(settings,'保存资金设置',async()=>{const result=await service.settings(Object.fromEntries(Object.keys(names).map(key=>[key,Number(inputs[key].value)])));status.textContent='资金设置已保存。';return result;});
  const picker=add(parent,'details','','trading-card');add(picker,'summary','添加观察球员');
  const pickRows=add(picker,'div','','trading-row');const linkInput=input(pickRows,'FUTBIN FC27 链接 / EA版本ID','','text'),nameInput=input(pickRows,'球员名称（可选）','','text');
  button(picker,'加入观察',()=>service.add({input:linkInput.value,name:nameInput.value}));
  add(picker,'small','支持粘贴 FUTBIN FC27 球员页链接；EA 版本 ID 与 FUTBIN ID 不同。或从本页已加载的卡片事实中选择，不代表完整库存/市场。');
  const candidateOutput=add(picker,'div');
  button(picker,'读取已加载卡片',async()=>{candidateOutput.replaceChildren();const candidates=service.candidates();
    if(!candidates.length){add(candidateOutput,'p','尚无已加载卡片；可粘贴 FUTBIN 球员链接，或先在 Club/Gallery/SBC 加载卡片。');return;}
    const search=input(candidateOutput,'搜索已加载球员','','search'),select=add(candidateOutput,'select');select.setAttribute('aria-label','选择已加载球员');
    const list=()=>{select.replaceChildren();for(const card of candidates.filter(card=>`${card.name} ${card.definitionId} ${card.rating??''}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())).slice(0,100)){
      const opt=add(select,'option',`${card.name} · ${card.rating??'?'} · ${card.version??''} · EA ${card.definitionId}`);opt.value=String(card.definitionId);}};list();search.addEventListener('input',list);
    button(candidateOutput,'加入所选球员',()=>{const player=candidates.find(row=>row.definitionId===Number(select.value));if(!player)throw Error('DESK_PLAYER_INVALID');return service.add({player});});
  });
  const alerts=add(parent,'section','','trading-card');alerts.setAttribute('aria-label','机会提醒');
  const watch=add(parent,'section');watch.setAttribute('aria-label','球员观察名单');
  const ledger=add(parent,'section','','trading-card trading-ledger');ledger.setAttribute('aria-label','手填交易记录');
  const news=add(parent,'details','','trading-card');add(news,'summary','X 消息线索（手动录入，多来源）');
  add(news,'small','可观察 Fut Sheriff、FUT Police Leaks、Fut Scoreboard、AsyFutTrader 等；不是可信度排名。未接通自动 X 抓取，同源搬运不算独立证据，消息不触发买卖。');
  const newsFields=add(news,'div','','trading-grid'),post=input(newsFields,'X 原帖链接','','url'),note=input(newsFields,'消息备注','','text'),newsState=add(add(newsFields,'label','消息状态'),'select');
  newsState.setAttribute('aria-label','消息状态');for(const [value,label]of [['leak','爆料'],['confirmed','已确认'],['live','已上线'],['failed','落空']]){const opt=add(newsState,'option',label);opt.value=value;}
  button(news,'保存消息线索',()=>service.event({url:post.value,note:note.value,status:newsState.value}));const newsList=add(news,'div');
  function chart(target,card){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('trading-chart');svg.setAttribute('viewBox','0 0 600 100');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${card.name} 双源采样趋势`);target.append(svg);
    const points=Object.values(card.series).flat();
    if(!Object.values(card.series).some(rows=>rows.length>=2)){const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('x','15');text.setAttribute('y','55');text.setAttribute('fill','#bdcbd3');text.textContent='采样中；至少两次分桶观察后绘图';svg.append(text);return;}
    const start=Math.min(...points.map(p=>p.at)),end=Math.max(start+1,...points.map(p=>p.at)),low=Math.min(...points.map(p=>p.price)),high=Math.max(low+1,...points.map(p=>p.price));
    for(const [source,color]of [['futbin','#9df3d5'],['futgg','#e9c26b']]){const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('fill','none');line.setAttribute('stroke',color);line.setAttribute('stroke-width','2');line.setAttribute('points',card.series[source].map(p=>`${10+(p.at-start)/(end-start)*580},${90-(p.price-low)/(high-low)*80}`).join(' '));svg.append(line);}
  }
  function render(){
    const budget=deskFunding(state);funding.textContent=`账面余额 ${budget.cash.toLocaleString()} · 试仓占用 ${budget.occupied.toLocaleString()}/${state.settings.capitalLimit.toLocaleString()} · 可用试仓 ${budget.available.toLocaleString()} · 手填已实现净利 ${budget.realized.toLocaleString()}`;
    for(const key of Object.keys(names))inputs[key].value=String(state.settings[key]);
    const unread=state.alerts.filter(row=>!row.read).length;tab.textContent=`交易观察${unread?` (${unread})`:''}`;
    alerts.replaceChildren();add(alerts,'h3',`机会提醒 · ${unread} 条未读`);add(alerts,'p','提醒仅在你填写当前原生买价/保守卖价后评估；参考价差不是可成交套利。首次采样没有历史，短/日/周趋势样本不足时明确留空。');
    for(const row of state.alerts.slice(-5).reverse()){const card=state.watch.find(card=>card.definitionId===row.definitionId),live=card&&deskOpportunity(state,card,now()).status==='opportunity';add(alerts,'p',`${card?.name??row.definitionId} · ${live?'值得到原生市场再次核价':'历史机会，当前需重新核价'} · ${new Date(row.at).toLocaleString()}${row.read?' · 已读':''}`);}
    watch.replaceChildren();if(!state.watch.length)add(watch,'p','观察名单为空。先添加少量愿意手动交易的球员；不扫描全市场。');
    for(const card of state.watch){const value=deskOpportunity(state,card,now()),box=add(watch,'article','',`trading-card ${value.status==='opportunity'?'trading-opportunity':''}`);
      add(box,'h3',`${card.name} · EA ${card.definitionId}`);add(box,'strong',value.reason);
      add(box,'p',`建议买入上限 ${value.cap??'—'} · 保守卖价 ${value.sale??'—'} · 预计扣税利润 ${value.profit??'—'}（未成交）`);
      for(const source of ['futbin','futgg']){const q=card.latest[source];add(box,'small',`${source==='futbin'?'FUTBIN（绿）':'FUT.GG（金）'}：${q&&!q.error?`${q.price} · ${q.sourceTimed?'源报价':'采样观察'}时间 ${new Date(q.at).toLocaleString()} · 读取 ${new Date(q.fetchedAt).toLocaleTimeString()}${q.sourceTimed?'':'（源报价时间未知）'} · ${q.expiresAt>now()?'缓存有效':'已过期'}`:'暂无有效报价'} · 样本 ${card.series[source].length}`);
        add(box,'small',['1h','24h','7d'].map((label,i)=>{const n=deskTrend(card.series[source],now(),[3600000,86400000,604800000][i]);return `${label} ${n===null?'样本不足':`${n.toFixed(1)}%`}`;}).join(' / '));}
      chart(box,card);const prices=add(box,'div','','trading-grid'),ask=input(prices,'当前原生买价',card.ask||''),sell=input(prices,'保守可卖价',card.sell||'');
      button(box,'核价并评估',()=>service.evaluate({definitionId:card.definitionId,ask:Number(ask.value),sell:Number(sell.value)}));
      const check=input(box,'我已在官方应用实际买入一张',false,'checkbox');check.checked=false;
      button(box,'记录已买入（只记账）',()=>{if(!check.checked)throw Error('DESK_MANUAL_CONFIRM_REQUIRED');return service.recordBuy({definitionId:card.definitionId,name:card.name,buy:Number(ask.value)});});
      button(box,'移出观察名单',()=>service.remove(card.definitionId));
    }
    ledger.replaceChildren();add(ledger,'h3',`手填交易记录 ${state.records.length}/${DESK_LIMITS.records}`);add(ledger,'small','不是 EA 成交回执，不会自动售出或清理。按 5% 税保守取整，实际到账以官方记录为准；账外交易请自行核对。');
    for(const row of state.records.slice().reverse()){const item=add(ledger,'article','','trading-card');add(item,'p',`${row.name} · 买入 ${row.buy} · ${row.sell===null?'持仓':`卖出 ${row.sell} · 税后净利 ${deskNet(row.sell)-row.buy}`}`);
      if(row.sell===null){const field=input(item,'实际卖出价',''),confirmed=input(item,'我已在官方应用实际卖出',false,'checkbox');confirmed.checked=false;
        button(item,'记录已卖出（只记账）',()=>{if(!confirmed.checked)throw Error('DESK_MANUAL_CONFIRM_REQUIRED');return service.recordSale({recordId:row.id,sell:Number(field.value)});});}}
    newsList.replaceChildren();for(const row of state.events.slice().reverse()){const p=add(newsList,'p');const a=add(p,'a',`${new URL(row.url).pathname.split('/')[1]} · ${row.status}`);a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';add(p,'span',` · ${row.note}`);}
  }
  if(!service){status.textContent='交易观察服务未接入。';for(const node of parent.querySelectorAll('button,input,select'))node.disabled=true;}
  return {setActive(value){active=value;epoch++;busy=false;pause();
    if(!value)return;if(!service)return;
    state=null;watch.replaceChildren();ledger.replaceChildren();alerts.replaceChildren();newsList.replaceChildren();for(const key of Object.keys(names))inputs[key].value=String(DESK_DEFAULTS[key]);funding.textContent='读取本地交易观察记录…';
    try{context=service.context();}catch{funding.textContent='交易账号上下文尚未就绪，请登录后重新打开。';return;}
    void run(async()=>{const result=await service.read();status.textContent='仅加载本地记录；报价需点击刷新，定时观察需手动启动。';return result;});
  }};
}
