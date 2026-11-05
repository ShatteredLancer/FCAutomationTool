import {DESK_DEFAULTS,DESK_LIMITS,deskFunding,deskOpportunity,deskTrend,deskNet,deskPriceSignal,deskExit} from '../../trading/desk-model.js';

export function mountFc27TradingView({document,parent,tab,service,timers=globalThis,now=()=>Date.now()}){
  if(!parent)return {setActive(){}};
  const add=(p,tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;p.append(node);return node;};
  parent.replaceChildren();
  const style=add(parent,'style');style.textContent='.trading-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.trading-card{margin:12px 0;padding:14px;border:1px solid #526671;border-radius:7px;background:#22323d}.trading-card small{display:block;color:#bdcbd3}.trading-card input,.trading-card select{max-width:100%}.trading-chart{width:100%;height:100px;background:#17212c}.trading-warning{color:#ffdb8c}.trading-opportunity{border-color:#9df3d5}.trading-funding{font-size:16px}.trading-ledger{overflow-wrap:anywhere}.trading-card label:has(input[type=checkbox]){display:flex;align-items:center;gap:8px}.trading-card input[type=checkbox]{width:auto}.trading-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.trading-row>*{flex:1;min-width:100px}';
  style.textContent+='#page-trading{min-width:0;overflow-wrap:anywhere}.trading-grid>*{min-width:0}.trading-row>*{min-width:0;flex-basis:180px}.trading-card label{min-width:0;max-width:100%}.trading-card input,.trading-card select{min-width:0;width:100%}.trading-card input[type=checkbox]{width:18px;flex:0 0 18px}.trading-card a{color:#9df3d5;text-decoration:underline}';
  add(parent,'h2','交易观察 · 手动执行');
  add(parent,'p','只读公共参考价、机会提醒和手填记录；不搜索 EA 挂单，不自动买入、移动、挂牌或重挂。没有防封承诺。','module-note');
  const status=add(parent,'output');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const funding=add(parent,'p','','trading-funding');
  const controls=add(parent,'div','','row');
  let active=false,busy=false,epoch=0,timer=null,context=null,state=null,attempted=0,advice=null,pairingRevision=0,pairBusy=false,pairConfigured=false,intelFailed=false;
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
    DESK_SAVE_UNVERIFIED:'本地保存未确认，先不要重复添加记录，请重新打开核对。',
    DESK_DISCOVERY_UNAVAILABLE:'候选来源暂不可用，未生成建议；可稍后重试。',DESK_DISCOVERY_CHANGED:'资金或线索已变化，请重新分析候选。',
    DESK_DISCOVERY_EXPIRED:'本轮买价参考已过期，请重新分析候选。',FC27_PUBLIC_PRICE_FUTBIN_DISABLED:'自动候选需 FUTBIN 公共卡池；该来源当前已关闭，请在报价设置中启用后重试。',
    DESK_INTEL_PAIRING_REQUIRED:'请输入控制台显示的 48 位配对码，只复制冒号后的字符；不要填整行标签。',DESK_INTEL_COLLECTOR_UNAVAILABLE:'本机 X 采集器未启动或连接失败；价格候选仍可使用。',
    DESK_INTEL_PAIRING_REJECTED:'采集器拒绝该配对码；请核对当前采集器窗口显示的码。',
    DESK_INTEL_SAVE_FAILED:'配对码写入失败，未确认保存；请重试。',DESK_INTEL_SAVE_UNVERIFIED:'配对码回读不一致，未确认保存；请重试。',
    DESK_INTEL_STORAGE_READ_FAILED:'读取本机配对配置失败，未确认保存。',DESK_INTEL_STATUS_TIMEOUT:'本机采集器连接检查超时；未调用 Grok。',
    DESK_INTEL_STATUS_UNSUPPORTED:'采集器版本较旧，请在更新后的项目目录重启采集器。',
    DESK_INTEL_TIMEOUT:'X 搜索超时；不会自动重试产生费用，可稍后手动刷新。',DESK_INTEL_RESPONSE_INVALID:'没有得到可验证格式的 X 原帖数据；不生成爆料建议。',
    DESK_INTEL_COOLDOWN:'X 采集正在退避，请稍后再刷新。',DESK_INTEL_NATIVE_X_UNAVAILABLE:'本次未取得原生 X 搜索权限或结果，不用网页摘要冒充线程。',
    DESK_INTEL_NATIVE_X_NOT_USED:'未检测到真实原生 X 调用记录，本轮结果未采纳。',DESK_INTEL_TRACE_UNAVAILABLE:'原生 X 调用记录核验未完成，本轮结果未采纳。'}[error?.message]??`操作未完成（${/^([A-Z0-9_]+)$/.test(error?.message??'')?error.message:'读取或保存失败'}）；未执行交易。`);
  const run=async task=>{const token=epoch;
    try{if(!current(token))throw Error('DESK_CONTEXT_CHANGED');}catch{pause();state=null;advice=null;intelList.replaceChildren();adviceList.replaceChildren();watch.replaceChildren();ledger.replaceChildren();alerts.replaceChildren();newsList.replaceChildren();funding.textContent='账号已变化，请重新打开交易观察。';tab.textContent='交易观察';return;}
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
  button(settings,'保存资金设置',async()=>{const result=await service.settings(Object.fromEntries(Object.keys(names).map(key=>[key,Number(inputs[key].value)])));advice=null;renderAdvice();status.textContent='资金设置已保存；重新分析会按新额度筛选。';return result;});
  const discovery=add(parent,'section','','trading-card');discovery.setAttribute('aria-label','自动候选建议');
  add(discovery,'h3','本轮候选 · 不用先填球员');
  add(discovery,'small','低价短线初筛：80/82/84 普通金卡各一页；X 作者明确点名后额外定向读最多 3 个名字。最多 12 张交叉核价、6 张建议，不扫 EA 市场。非 META 排名或成交保证，拥挤度未知。');
  const adviceControls=add(discovery,'div','','row'),adviceList=add(discovery,'div');
  const discover=async()=>{const token=epoch;advice=null;adviceList.textContent='正在筛选预算内候选…';
    try{const value=await service.discover({isCurrent:()=>current(token),onProgress:v=>{if(current(token))adviceList.textContent=v.phase==='candidate-pool'
      ?`读取 ${v.rating} 评分公共候选（${v.index+1}/${v.total} 页）…`:v.phase==='named-candidate'?`定向读取作者点名：${v.name}…`:`交叉核对候选报价（最多 ${v.total??12} 张）…`;}});
      if(current(token)){advice=value;renderAdvice();status.textContent='候选已生成；买价是等待低价的上限，不是让你按现价买。';}
    }catch(error){if(current(token)){adviceList.textContent=errorText(error);throw error;}}
  };
  button(adviceControls,'重新分析候选',discover);
  button(adviceControls,'跟踪本轮候选',()=>service.followSuggestions());
  const cancel=add(adviceControls,'button','取消候选分析');cancel.type='button';cancel.addEventListener('click',event=>{
    if(!event.isTrusted||!active||!busy)return;epoch++;busy=false;pause();advice=null;adviceList.textContent='分析已取消；不会产生交易。';});
  function renderAdvice(){adviceList.replaceChildren();if(!advice){add(adviceList,'p','点击重新分析，按资金设置自动找候选。');return;}
    add(adviceList,'p',`样本 ${advice.scanned} 张 · 预算内 ${advice.affordable} 张 · 交叉核价 ${advice.crossChecked} 张 · 本批各一张最多占用 ${advice.allocated} / 可用 ${advice.available}`);
    add(adviceList,'small',`${advice.defaultBudget?'当前按预填 1 万试仓估算；请保存真实资金设置后再开启提醒。 ':''}读取 ${new Date(advice.at).toLocaleString()}；买价参考 5 分钟有效，进入原生市场前重新核价。`);
    if(!advice.suggestions.length)add(adviceList,'p',advice.available<150?'可用试仓不足：先核对资金设置或未售持仓。':'本轮没有满足利润/预算/数据条件的候选，不凑数推荐。');
    for(const row of advice.suggestions){const box=add(adviceList,'article','','trading-card');add(box,'h4',`${row.name} · ${row.rating} 普通${row.rating>=75?'金':row.rating>=65?'银':'铜'}卡`);
      const link=add(box,'a','查看 FUTBIN 精确版本');link.href=`https://www.futbin.com/27/player/${row.futbinId}`;link.target='_blank';link.rel='noopener noreferrer';
      add(box,'p',`当前参考 FUTBIN ${row.price} / FUT.GG ${row.ggPrice??'待核价'} · ${row.sourceCount===2?'双源观察':'单源暂定观察'}`);
      add(box,'strong',`等到 ≤ ${row.buyCeiling} 再核价；卖出参考 ${row.resaleEstimate}`);
      add(box,'p',`仅在该买价与卖价均成交时，模型税后差额 ${row.netAtCeiling}；买入需比当前参考低 ${row.requiredDiscount.toFixed(1)}%。`);
      add(box,'small',`关注理由：${row.reason}`);
      add(box,'small',`退出计划：成交后到卖出参考可核价卖出；税后浮亏达到 ${state.settings.buffer} 金币或买入满 6 小时则复核退出；消息落空/替代卡上线提前复核。均不自动执行。`);
      for(const clue of row.evo??[]){const a=add(box,'a',`EVO ${clue.status==='leak'?'爆料':'线索'} · 仅条件初筛`);a.href=clue.url;a.target='_blank';a.rel='noopener noreferrer';add(box,'small',clue.reason);}
      button(box,'跟踪这张候选',()=>service.followSuggestions({definitionId:row.definitionId}));
    }
    for(const row of advice.avoid)add(adviceList,'small',`暂缓 ${row.name}：${row.reason}`);
    for(const name of advice.unresolvedNames??[])add(adviceList,'small',`点名 ${name}：名字未唯一匹配，未生成版本/买价建议。`);
  }
  const intelligence=add(parent,'section','','trading-card');add(intelligence,'h3','X 自动采集 · 按需刷新，不开定时');
  add(intelligence,'small','从 FutSheriff / FutPoliceLeaks / Fut_scoreboard / AsyFutTrader / DetectiveFUT 原生 X 搜索原帖，核对最多两条 EVO 线程及作者后续回复，包含点名球员。复用本机 Grok，可能产生模型费用；不保证实时、完整线程或爆料准确。15 分钟内重复刷新用缓存。');
  const pairing=add(intelligence,'details');add(pairing,'summary','连接本机采集器（首次设置）');
  add(pairing,'small','在本项目电脑运行 npm.cmd run trading:intel，保持采集器窗口开启；只复制冒号后的 48 位本机配对码。配对码保存在本机，不导出、不发到 X。保存和检查连接均不调用 Grok。');
  const pairKey=input(pairing,'本机采集器配对码','','password');pairKey.autocomplete='off';pairKey.placeholder='48 位十六进制配对码';
  const pairStatus=add(pairing,'output','未配置配对码。');pairStatus.setAttribute('role','status');pairStatus.setAttribute('aria-label','采集器连接状态');pairStatus.setAttribute('aria-live','polite');pairStatus.style.display='block';
  const pairButtons=add(pairing,'div','','row'),pairSave=add(pairButtons,'button','保存采集器连接'),pairCheck=add(pairButtons,'button','检查连接（不采集）');pairSave.type=pairCheck.type='button';
  const pairingMessage=value=>value.connected?`配对码已保存；本机采集器已连接${value.collecting?'，当前有采集进行中':''}。检查未调用 Grok。`
    :value.connection==='legacy'?'配对码已保存；采集器版本较旧，不支持连接检查，请更新项目后重启采集器。'
    :'配对码已保存；本机采集器未连接。请运行 npm.cmd run trading:intel 并保持窗口开启。';
  const pairingAction=async(event,save)=>{
    if(!event.isTrusted||!active||!parent.isConnected||!service)return;
    if(pairBusy){pairStatus.textContent='正在处理配对连接，请稍候；未采集 X。';return;}
    let captured;try{captured=JSON.stringify(service.context());if(captured!==JSON.stringify(context))throw Error('DESK_CONTEXT_CHANGED');}
    catch(error){pairStatus.textContent=errorText(error);return;}
    const ticket=++pairingRevision,currentPair=()=>{try{return active&&parent.isConnected&&ticket===pairingRevision&&captured===JSON.stringify(service.context());}catch{return false;}};
    pairBusy=true;pairSave.disabled=pairCheck.disabled=true;pairStatus.textContent=save?'正在保存配对码并检查连接…（不采集 X）':'正在检查已保存连接…（不采集 X）';
    try{const result=save?await service.pairIntel(pairKey.value):await service.checkIntel();if(!currentPair())return;
      if(save&&result?.saved!==true)throw Error('DESK_INTEL_SAVE_UNVERIFIED');
      pairConfigured=true;if(save)pairKey.value='';pairStatus.textContent=pairingMessage(result);status.textContent=pairStatus.textContent;
      if(intelFailed){intelList.replaceChildren();intelFailed=false;}
    }catch(error){if(currentPair())pairStatus.textContent=save?`保存未完成：${errorText(error)}`:`${pairConfigured?'配对码已保存；':''}${errorText(error)}`;}
    finally{if(ticket===pairingRevision){pairBusy=false;pairSave.disabled=pairCheck.disabled=false;}}
  };
  pairSave.addEventListener('click',event=>{void pairingAction(event,true);});pairCheck.addEventListener('click',event=>{void pairingAction(event,false);});
  const intelList=add(intelligence,'div');
  button(intelligence,'采集 X 线索并筛选',async()=>{const token=epoch;intelFailed=false;intelList.textContent='正在搜索原帖与作者回复；通常需要几十秒，不执行交易…';
    try{const feed=await service.refreshIntel();if(!current(token))return;intelList.replaceChildren();
      add(intelList,'p',`读取 ${new Date(feed.fetchedAt).toLocaleString()} · ${feed.posts.length} 条去重线索${feed.cached?' · 缓存':''}${feed.costUsd==null?'':` · CLI 模型估算 $${feed.costUsd.toFixed(3)}（非账单；缓存不发新请求）`}`);
      add(intelList,'small',feed.warning);if(!feed.posts.length)add(intelList,'p','未找到可用的原帖/回复证据；不会生成消息买入建议。');
      for(const post of feed.posts){const box=add(intelList,'article','','trading-card'),link=add(box,'a',`${post.author} · ${post.topic.toUpperCase()} · ${new Date(post.at).toLocaleString()}`);
        link.href=post.url;link.target='_blank';link.rel='noopener noreferrer';
        add(box,'p',post.text);add(box,'small',post.evidence==='native-thread-author-reply'?'原生线程＋同作者会话检索已执行；作者回复线索，未保证读全'
          :post.evidence==='search-reported-author-reply'?'搜索报告为作者回复，完整线程关联待核验'
          :post.threadChecked?'原生线程读取已执行，未当作官方确认'
          :post.evidence==='native-search-post'?'原生搜索检索到的帖子，未核完整线程或官方确认':'网页检索线索，未核线程或官方确认');
        if(post.parentUrl){const parentLink=add(box,'a','查看上级原帖');parentLink.href=post.parentUrl;parentLink.target='_blank';parentLink.rel='noopener noreferrer';}
        for(const player of post.players)add(box,'small',`${player.nominationQuote?'点名候选':'仅提及，非已确认候选'} ${player.name} · ${player.version??'版本未说明'}；不证明 EVO 合格`);
      }
      await discover();
    }catch(error){if(current(token)){intelFailed=true;intelList.textContent=errorText(error);}throw error;}
  });
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
  add(news,'small','可观察 Fut Sheriff、FUT Police Leaks、Fut Scoreboard、AsyFutTrader、DetectiveFUT 等；不是可信度排名。此处保留手动线索补录；自动采集见上方，同源搬运不算独立证据，消息不触发买卖。');
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
    alerts.replaceChildren();add(alerts,'h3',`机会提醒 · ${unread} 条未读`);add(alerts,'p','已跟踪候选可在公共参考价触及目标时提醒，不必先填球员/买卖价；这不代表利润已成立。手填原生买卖两端后另做价差评估，趋势不足不伪造。');
    for(const row of state.alerts.slice(-5).reverse()){const card=state.watch.find(card=>card.definitionId===row.definitionId),signal=card&&deskPriceSignal(state,card,now()),live=card&&deskOpportunity(state,card,now()).status==='opportunity';
      add(alerts,'p',`${card?.name??row.definitionId} · ${row.kind==='price-signal'?(signal?'公共参考价触及目标，利润待核实':'历史触价提醒，需重新核价'):(live?'值得到原生市场再次核价':'历史机会，当前需重新核价')} · ${new Date(row.at).toLocaleString()}${row.read?' · 已读':''}`);}
    watch.replaceChildren();if(!state.watch.length)add(watch,'p','观察名单为空。可直接跟踪上方自动候选，不必自己寻找或填写球员。');
    for(const card of state.watch){const value=deskOpportunity(state,card,now()),box=add(watch,'article','',`trading-card ${value.status==='opportunity'?'trading-opportunity':''}`);
      add(box,'h3',`${card.name} · EA ${card.definitionId}`);add(box,'strong',value.reason);
      if(card.plan){add(box,'p',`观察目标 ≤ ${card.plan.buyCap} · 原卖出参考 ${card.plan.saleTarget} · ${new Date(card.plan.at).toLocaleString()}；实际买卖前重核`);
        const signal=deskPriceSignal(state,card,now());if(signal)add(box,'strong',signal.reason,'trading-warning');}
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
      if(row.sell===null){const exit=deskExit(state,row,now());add(item,'strong',exit.reason);add(item,'small',`卖出原目标 ${exit.target} · 保本价至少 ${exit.breakEven} · 当前保守参考 ${exit.reference??'—'} / 税后浮动 ${exit.net??'—'} · 时间复核 ${new Date(exit.deadline).toLocaleString()}（非卖出回执）`);
        const field=input(item,'实际卖出价',''),confirmed=input(item,'我已在官方应用实际卖出',false,'checkbox');confirmed.checked=false;
        button(item,'记录已卖出（只记账）',()=>{if(!confirmed.checked)throw Error('DESK_MANUAL_CONFIRM_REQUIRED');return service.recordSale({recordId:row.id,sell:Number(field.value)});});}}
    newsList.replaceChildren();for(const row of state.events.slice().reverse()){const p=add(newsList,'p');const a=add(p,'a',`${new URL(row.url).pathname.split('/')[1]} · ${row.status}`);a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';add(p,'span',` · ${row.note}`);}
  }
  if(!service){status.textContent='交易观察服务未接入。';for(const node of parent.querySelectorAll('button,input,select'))node.disabled=true;}
  return {setActive(value){active=value;epoch++;pairingRevision++;busy=false;pairBusy=false;pause();
    if(!value)return;if(!service)return;
    state=null;advice=null;intelFailed=false;intelList.replaceChildren();pairKey.value='';pairConfigured=false;pairSave.disabled=pairCheck.disabled=false;pairStatus.textContent='读取本机配对保存状态…';adviceList.replaceChildren();watch.replaceChildren();ledger.replaceChildren();alerts.replaceChildren();newsList.replaceChildren();for(const key of Object.keys(names))inputs[key].value=String(DESK_DEFAULTS[key]);funding.textContent='读取本地交易观察记录…';
    try{context=service.context();}catch{funding.textContent='交易账号上下文尚未就绪，请登录后重新打开。';return;}
    const pairTicket=pairingRevision,pairContext=JSON.stringify(context);
    void Promise.resolve(service.intelConfig?.()??{configured:false}).then(value=>{if(active&&pairTicket===pairingRevision&&pairContext===JSON.stringify(service.context())){
      pairConfigured=value.configured===true;pairStatus.textContent=pairConfigured?'配对码已保存（已回读）；连接尚未检查。可点下方检查，不采集 X。':'未配置配对码。';}})
      .catch(error=>{if(active&&pairTicket===pairingRevision)pairStatus.textContent=errorText(error);});
    void run(async()=>{const token=epoch,result=await service.read();if(!current(token))return;state=result.state;context=result.context;render();
      if(service.discover)await discover();else status.textContent='本地记录已加载，候选服务暂未接入。';});
  }};
}
