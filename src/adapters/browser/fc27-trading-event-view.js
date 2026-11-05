export function mountTradingEventView({document,parent,service,isCurrent,onChange=async()=>{},onRevoke=()=>{}}){
  const add=(p,tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;p.append(n);return n;};
  const section=add(parent,'section','','trading-card');section.setAttribute('aria-label','导入事件型候选');add(section,'h3','EVO 消息仓 · 从帖子加入方案');
  add(section,'small','粘贴具体帖子，读取原帖/作者回复后匹配普通卡版本及双源报价。仅点击读取时调用本机 Grok，可能产生费用；同帖 15 分钟内复用缓存。导入、核价和加入清单均不交易。');
  const controls=add(section,'div','','trading-row'),label=add(controls,'label','X 帖子链接'),input=add(label,'input');input.type='url';input.placeholder='https://x.com/author/status/…';input.setAttribute('aria-label','事件原帖链接');input.maxLength=600;
  const importButton=add(controls,'button','读取帖子并核价','trading-primary'),refresh=add(controls,'button','刷新消息仓报价');importButton.type=refresh.type='button';
  const status=add(section,'output','','trading-status');status.setAttribute('role','status');status.setAttribute('aria-label','消息仓状态');status.setAttribute('aria-live','polite');
  const rows=add(section,'div');let active=false,busy=false,revision=0;
  const current=t=>active&&t===revision&&section.isConnected&&isCurrent();
  const errors={DESK_INTEL_POST_UNSUPPORTED:'本机采集器需要更新；请用桌面 Stop Collector / Start Collector 重启，配对码保留。',DESK_EVENT_NO_EVO_SOURCE:'没有读到可核实的 EVO 原帖，未添加候选。',DESK_INTEL_POST_NOT_EVO:'这条帖子不是 EVO 线索，未加入消息仓。',DESK_EVENT_SELECTED_LIMIT:'消息仓一次最多纳入三个标的；仍与其他策略共用整批预算。',DESK_EVENT_LIMIT:'最多保留六条事件线索，请先移除不再使用的线索。',DESK_INTEL_PAIRING_REQUIRED:'请先在本页“设置”中连接本机采集器。',DESK_INTEL_PAIRING_REJECTED:'本机采集器拒绝配对码，请在“设置”检查连接。',DESK_INTEL_COLLECTOR_UNAVAILABLE:'本机采集器未连接，请启动后台采集器后再试。',DESK_INTEL_URL_INVALID:'请粘贴完整的 https://x.com/作者/status/帖子编号 链接。',DESK_INTEL_BUSY:'采集器正在处理另一项请求，请稍后再试；未新增模型调用。'};
  const task=async fn=>{if(busy||!active||!isCurrent())return;busy=true;importButton.disabled=refresh.disabled=true;const ticket=revision;
    try{await fn(ticket);}catch(e){if(current(ticket)){status.dataset.state='error';status.textContent=errors[e?.message]??`读取或核价未完成（${/^(DESK|FC27)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'读取失败'}）；没有下单。`;}}
    finally{if(ticket===revision){busy=false;importButton.disabled=refresh.disabled=!service?.importEvent;}}};
  const render=analysis=>{rows.replaceChildren();for(const row of analysis.store.rows){const candidate=analysis.candidates.find(c=>c.event.sourceUrl===row.url),issue=analysis.issues.find(i=>i.url===row.url),box=add(rows,'article','','trading-card');
      const link=add(box,'a',`${row.post.author} · ${new Date(row.post.at).toLocaleString()} · 查看原帖`);link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';
      add(box,'h4',candidate?`${candidate.name} · ${candidate.rating} 普通卡 · ${row.included?'已纳入整批候选':'待纳入'}`:`${row.post.players[0]?.name??'EVO 线索'} · ${row.status==='failed'?'已失效':'待核实'}`);
      const details=add(box,'details');add(details,'summary','原文与价格依据');add(details,'p',row.post.text);if(row.post.entry)add(details,'small',`来源建议：${row.post.entry.strictBelow?'低于':'不高于'} ${row.post.entry.ceiling}；引用：${row.post.entry.quote}`);
      if(candidate){add(box,'p',`当前参考 FUTBIN ${candidate.price} / FUT.GG ${candidate.ggPrice}；买入硬上限 ${candidate.buyCeiling}，本版每个版本一张。`);
        add(box,'strong',`审核目标 ${candidate.resaleEstimate} · 税后情景净利 ${candidate.netAtCeiling}`);add(box,'small',candidate.reason);
        add(box,'small','先持有，双源参考达到固定目标后才自动上架；6 小时后暂停并提醒复核，不自动亏本卖出。离开页面/停止/重载会停止自动监测，回来需重新审核继续。');
      }else add(box,'p',issue?.reason??'数据不足，未加入可执行候选。','trading-warning');
      const actions=add(box,'div','','trading-row'),include=add(actions,'button',row.included?'移出本轮候选':'纳入整批方案');include.type='button';include.disabled=!candidate||row.status==='failed';
      include.addEventListener('click',e=>{if(e.isTrusted)void task(async t=>{await service.setEvent({url:row.url,included:!row.included});if(!current(t))return;await onChange();if(current(t))await analyze(t);});});
      const revoke=add(actions,'button','标记线索失效');revoke.type='button';revoke.disabled=row.status==='failed';revoke.addEventListener('click',e=>{if(e.isTrusted)void task(async t=>{onRevoke();await service.setEvent({url:row.url,status:'failed'});if(!current(t))return;await onChange();if(current(t))await analyze(t);});});
      const remove=add(actions,'button','移除线索');remove.type='button';remove.addEventListener('click',e=>{if(e.isTrusted)void task(async t=>{onRevoke();await service.setEvent({url:row.url,remove:true});if(!current(t))return;await onChange();if(current(t))await analyze(t);});});
    }if(!analysis.store.rows.length)add(rows,'p','尚未导入事件线索；不会自动关注新账号或把消息当作买入指令。');};
  const analyze=async t=>{status.dataset.state='';status.textContent='正在按点名球员核价，不扫描全目录…';const result=await service.analyzeEvents({isCurrent:()=>current(t)});if(!current(t))return;render(result);status.textContent=`${result.candidates.length} 个可审核候选；纳入后请回“投资与执行”重新生成并审核清单。`;};
  importButton.addEventListener('click',e=>{if(e.isTrusted)void task(async t=>{status.dataset.state='';status.textContent='正在读取指定原帖和作者回复，可能产生模型费用；尚未交易…';const imported=await service.importEvent({url:input.value,isCurrent:()=>current(t)});if(!current(t))return;await onChange();if(current(t)){await analyze(t);if(current(t))status.textContent+=imported.cached?' · 本次复用采集缓存，未新增模型调用。':imported.costUsd==null?' · 模型费用以本机账单为准。':` · 本次 CLI 模型估算 $${imported.costUsd.toFixed(3)}（非账单）。`;}});});
  refresh.addEventListener('click',e=>{if(e.isTrusted)void task(analyze);});
  return {setActive(value){active=value;revision++;busy=false;rows.replaceChildren();input.value='';status.textContent='';importButton.disabled=refresh.disabled=!service?.importEvent;
    if(value&&service?.eventState){const ticket=revision;void task(async()=>{const result=await service.eventState();if(current(ticket))render({...result,candidates:[],issues:result.store.rows.map(r=>({url:r.url,reason:'已恢复线索，点击刷新消息仓报价后再审核；不会重新采集 X。'}))});});}}};
}
