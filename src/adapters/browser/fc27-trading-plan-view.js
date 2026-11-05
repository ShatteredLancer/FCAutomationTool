import {deskNet} from '../../trading/desk-model.js';

export function mountTradingPlanView({document,parent,service,isCurrent,onDiscovery=()=>{},now=()=>Date.now(),timers=globalThis}){
  const add=(p,tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;p.append(n);return n;};
  const money=n=>Number(n).toLocaleString();
  add(parent,'h3','本轮投资方案');
  add(parent,'p','1 设置预算 → 2 审核清单 → 3 确认执行','trading-step');
  const conclusion=add(parent,'p','正在等待候选分析；尚未启动交易。');conclusion.setAttribute('role','status');
  const fields=add(parent,'div','','trading-grid');
  const field=(label,value)=>{const l=add(fields,'label',label),input=add(l,'input');input.type='number';input.min='0';input.step='50';input.value=String(value);input.setAttribute('aria-label',label);return input;};
  const budget=field('本轮资金上限（可调整）',20000),reserve=field('本轮最低留存金币',0);budget.min='150';
  const actions=add(fields,'div','','trading-row trading-generate'),prepare=add(actions,'button','生成可审核交易方案','trading-primary');prepare.type='button';
  add(parent,'small','额度是上限，不必花满；已有手填未售持仓也占用额度。候选过期时重新核价，不沿用旧价。');
  const planArea=add(parent,'section');planArea.setAttribute('aria-label','待审核清单');planArea.hidden=true;
  const metrics=add(planArea,'div','','trading-metrics'),table=add(planArea,'div','','trading-table-wrap');
  const approvalLabel=add(parent,'label','','trading-approval'),approval=add(approvalLabel,'input');approval.type='checkbox';approval.setAttribute('aria-label','我已审核方案并同意真实买入和上架');
  const approvalText=add(approvalLabel,'span','我已审核清单、上限和风险，同意按本方案真实买入并上架');
  approvalText.id='trading-approval-terms';approval.setAttribute('aria-describedby',approvalText.id);
  const buttons=add(parent,'div','','trading-row');
  const start=add(buttons,'button','确认并开始自动交易','trading-primary'),resume=add(buttons,'button','确认并继续未完成操作','trading-primary');
  const stop=add(buttons,'button','停止自动交易','trading-stop'),recover=add(buttons,'button','核对成交与持仓（只读）');for(const b of [start,resume,stop,recover])b.type='button';
  const progress=add(parent,'output','','trading-status');progress.setAttribute('role','status');progress.setAttribute('aria-label','自动交易进度');progress.setAttribute('aria-live','polite');
  const positions=add(parent,'section');positions.setAttribute('aria-label','自动交易持仓');positions.hidden=true;
  const rules=add(parent,'details');add(rules,'summary','交易规则与风险');
  add(rules,'small','每版本一张、最多六张，一轮有限执行；买不到跳过。新购卡按固定目标价上架一小时，不自动降价、重挂或追涨。只有确认卖出才计收益。');
  add(rules,'small','只操作本轮新买的卡，不出售原有 Club 卡。离开交易页或关闭页面会停止新操作，停止不撤回已上架挂单。自动化存在账号风险，无防封或盈利承诺。');
  add(rules,'small','观察笔记的手填余额不替代 EA 实时余额；买入前仍核余额、容量、总预算和单卡限价。');
  let active=false,busy=false,launching=false,plan=null,record=null,timer=null,revision=0,advice=null;
  const valid=t=>active&&t===revision&&isCurrent();
  const haltTimer=()=>{if(timer!==null)timers.clearInterval(timer);timer=null;};
  const pending=()=>record?.entries.some(e=>['buy-pending','move-pending','list-pending'].includes(e.phase));
  const resumable=()=>record&&record.status!=='completed'&&!pending()&&record.entries.some(e=>['waiting','bought','transfer'].includes(e.phase));
  const sync=()=>{const available=service?.executionAvailable?.()===true,canResume=Boolean(resumable())&&!plan;
    prepare.disabled=busy||!available||!advice;start.hidden=!plan;resume.hidden=!canResume;
    approvalText.textContent=canResume?`我已审核原方案，同意按原上限 ${money(record.plan.capitalLimit)}、留存 ${money(record.plan.reserveCoins)} 继续；上方输入仅用于新方案。`:'我已审核清单、上限和风险，同意按本方案真实买入并上架';
    approvalLabel.hidden=!plan&&!canResume;start.disabled=busy||!available||!plan||!approval.checked;resume.disabled=busy||!available||!approval.checked;
    recover.hidden=!record;recover.disabled=busy||!available;stop.hidden=(!record||record.status==='completed')&&!launching;stop.disabled=!available;
    budget.disabled=reserve.disabled=busy||!available;approval.disabled=busy||!available;planArea.hidden=!plan;buttons.hidden=!plan&&!record&&!launching;};
  const statusNames={waiting:'尚未购买','buy-pending':'买入待核对',bought:'已买入','move-pending':'移入待核对',transfer:'待上架','list-pending':'上架待核对',listed:'已上架，未确认卖出',sold:'已确认卖出',skipped:'本轮跳过',rejected:'买入被拒绝'};
  const reasons={DESK_PLAN_NO_CANDIDATES:'本轮暂不买：没有同时满足双源核价、利润和资金条件的候选。',
    DESK_DISCOVERY_EXPIRED:'候选报价仍已过期。请在“候选与线索”重新分析，再生成清单。',
    DESK_PLAN_EXPIRED:'审核价已过期，请重新生成清单；已有持仓仍保留。',
    DESK_EXECUTION_READ_UNCONFIRMED:'成交或持仓读取尚未确认。请点“核对成交与持仓”重新读取，不会再次下单。',
    DESK_EXECUTION_RECOVERY_REQUIRED:'上轮仍有持仓或待核对结果。请先只读核对，再继续原方案。',
    DESK_EXECUTION_APPROVAL_REQUIRED:'方案已变化，请重新生成并审核后确认。',DESK_EXECUTION_DISABLED:'当前构建未启用真实交易。',
    DESK_EXECUTION_INSUFFICIENT_FUNDS:'余额或可用预算不足。请核对额度和已有持仓，不会提高限价。',
    DESK_EXECUTION_CONTEXT_CHANGED:'账号或页面已变化，已停止新操作。请重新打开交易台。'};
  const errorDetails=add(parent,'details');add(errorDetails,'summary','诊断代码');const errorCode=add(errorDetails,'code');errorDetails.hidden=true;
  const explain=reason=>reasons[reason]??'本轮操作已暂停。已有成交和待核对记录保留；请先只读核对，不要重复下单。';
  const diagnostic=reason=>{errorDetails.hidden=!reason;errorCode.textContent=/^(DESK|FC27)_[A-Z0-9_]+$/.test(reason??'')?reason:'';};
  const metric=(host,label,value)=>{const box=add(host,'div','','trading-metric');add(box,'small',label);add(box,'strong',value);};
  const renderRecord=value=>{record=value;positions.replaceChildren();positions.hidden=!record;if(!record){sync();return;}
    const spent=record.entries.reduce((n,e)=>n+(e.offer&&!['waiting','skipped','rejected'].includes(e.phase)?e.offer.price:0),0);
    const bought=record.entries.filter(e=>['bought','move-pending','transfer','list-pending','listed','sold'].includes(e.phase)).length;
    const sold=record.entries.filter(e=>e.phase==='sold'),profit=sold.reduce((n,e)=>n+deskNet(e.salePrice)-e.offer.price,0);
    progress.dataset.state=record.reason||pending()?'error':'ready';
    progress.textContent=`${record.status==='completed'?'本轮已结束':record.status==='waiting-sales'?'买入/上架处理已结束，等待成交':record.status==='recovery-required'?'结果待核对，已暂停':record.status==='paused'?'已暂停':'正在执行'} · 已确认买入 ${bought} / ${record.entries.length} · 已用/待核对 ${spent} / 上限 ${record.plan.capitalLimit} · 已确认卖出 ${sold.length} · 已实现税后盈亏 ${profit}${record.reason?`。${explain(record.reason)}`:''}`;
    diagnostic(record.reason);add(positions,'h3','执行与持仓');const wrap=add(positions,'div','','trading-table-wrap'),t=add(wrap,'table','','trading-table');
    const head=add(add(t,'thead'),'tr');for(const label of ['球员','当前状态','买价 / 上限','挂牌目标','确认卖价'])add(head,'th',label).scope='col';const body=add(t,'tbody');
    for(let i=0;i<record.entries.length;i++){const e=record.entries[i],row=record.plan.rows[i],tr=add(body,'tr');add(tr,'td',row.name);const cell=add(tr,'td',statusNames[e.phase]);
      cell.dataset.label='当前状态';if(e.reason)add(cell,'small',explain(e.reason));add(tr,'td',`${e.offer?money(e.offer.price):'—'} / ${money(row.buyCap)}`).dataset.label='买价 / 上限';add(tr,'td',money(row.sellPrice)).dataset.label='挂牌目标';add(tr,'td',e.phase==='sold'?money(e.salePrice):'—').dataset.label='确认卖价';}sync();};
  const showError=e=>{if(e?.message==='DESK_EXECUTION_RECOVERY_REQUIRED'){plan=null;approval.checked=false;table.replaceChildren();metrics.replaceChildren();}
    diagnostic(e?.message);progress.dataset.state='error';progress.textContent=explain(e?.message);};
  const task=async fn=>{if(busy||!active||!isCurrent())return;const ticket=revision;busy=true;sync();
    try{const result=await fn(ticket);if(valid(ticket)&&result?.record!==undefined)renderRecord(result.record);return result;}
    catch(e){if(valid(ticket))showError(e);}finally{if(ticket===revision){busy=false;sync();}}};
  const autoRead=()=>{haltTimer();timer=timers.setInterval(()=>{if(active&&!busy&&record?.status==='waiting-sales'&&isCurrent())void task(()=>service.recoverInvestment());},60000);};
  const drawPlan=result=>{plan=result.plan;approval.checked=false;table.replaceChildren();metrics.replaceChildren();
    metric(metrics,'本批最多占用',money(plan.allocated));metric(metrics,'税后情景净利',money(plan.expectedNet));metric(metrics,'批准上限',money(plan.capitalLimit));
    const t=add(table,'table','','trading-table'),header=add(add(t,'thead'),'tr');for(const text of ['球员 · 各一张','买入上限','目标卖价','税后情景净利','操作'])add(header,'th',text).scope='col';const body=add(t,'tbody');
    for(const row of plan.rows){const tr=add(body,'tr'),name=add(tr,'td');add(name,'strong',row.name);const why=add(name,'details');add(why,'summary','版本与理由');add(why,'small',`EA ${row.definitionId} · ${row.reason}`);
      for(const [label,value]of [['买入上限',row.buyCap],['目标卖价',row.sellPrice],['税后情景净利',row.expectedNet]])add(tr,'td',money(value)).dataset.label=label;const remove=add(add(tr,'td'),'button','移除');remove.type='button';remove.setAttribute('aria-label',`移除方案球员 ${row.name}`);
      remove.addEventListener('click',e=>{if(!e.isTrusted)return;void task(async ticket=>{const ids=plan.rows.filter(r=>r.definitionId!==row.definitionId).map(r=>r.definitionId);
        plan=null;approval.checked=false;const result=await service.prepareInvestment({capitalLimit:Number(budget.value),reserveCoins:Number(reserve.value),definitionIds:ids,isCurrent:()=>valid(ticket)});
        if(valid(ticket))drawPlan(result);});});}
    add(table,'small',`本批最多占用 ${plan.allocated} / 批准上限 ${plan.capitalLimit}；仅全部按上限买入、目标价卖出时，情景税后净利 ${plan.expectedNet}。不是收益保证。`);
    add(table,'small',`EA 余额缓存 ${result.balance==null?'未知':money(result.balance)}，执行前重新核验。`);progress.dataset.state='ready';diagnostic(null);
    progress.textContent=`清单已生成，尚未交易。报价有效至 ${new Date(plan.expiresAt).toLocaleTimeString()}；请审核后勾选并确认。`;sync();};
  prepare.addEventListener('click',event=>{if(!event.isTrusted)return;void task(async ticket=>{plan=null;approval.checked=false;table.replaceChildren();sync();
    progress.dataset.state='';progress.textContent='正在生成清单，不买入；候选过期时会先重新核价…';
    const result=await service.prepareInvestment({capitalLimit:Number(budget.value),reserveCoins:Number(reserve.value),isCurrent:()=>valid(ticket),
      onProgress:()=>{if(valid(ticket))progress.textContent='候选已过期，正在重新核对公共报价；尚未交易…';}});if(!valid(ticket))return;
    if(result.refreshedDiscovery)onDiscovery(result.refreshedDiscovery);drawPlan(result);
  });});
  const launch=async resumeMode=>{if(!approval.checked)return;await task(async ticket=>{launching=true;approval.checked=false;progress.dataset.state='';sync();
    progress.textContent='正在核价及核对余额/容量，随后按已批准方案执行…';
    try{const result=await service.startInvestment({plan:resumeMode?null:plan,resume:resumeMode,approved:true,onProgress:value=>{if(valid(ticket))renderRecord(value);}});
      if(valid(ticket)){plan=null;approval.checked=false;if(result?.record?.status==='waiting-sales')autoRead();}return result;
    }finally{if(ticket===revision)launching=false;}
  });};
  start.addEventListener('click',e=>{if(e.isTrusted)void launch(false);});resume.addEventListener('click',e=>{if(e.isTrusted)void launch(true);});
  stop.addEventListener('click',e=>{if(!e.isTrusted||!active)return;service.stopInvestment();haltTimer();approval.checked=false;
    progress.textContent='已请求停止新操作；在途请求保留回执，已上架挂单不撤回。稍后可只读核对。';sync();});
  recover.addEventListener('click',e=>{if(e.isTrusted)void task(()=>service.recoverInvestment());});approval.addEventListener('change',sync);
  for(const input of [budget,reserve])input.addEventListener('input',()=>{plan=null;approval.checked=false;table.replaceChildren();metrics.replaceChildren();progress.dataset.state='';
    progress.textContent='预算已调整，请重新生成并审核清单。';sync();});sync();
  return {setAnalysisStatus(text){conclusion.textContent=text;},setAdvice(value){advice=value;plan=null;approval.checked=false;table.replaceChildren();metrics.replaceChildren();
    conclusion.textContent=!value?'尚无本轮结论，正在等候候选分析。':value.suggestions?.length
      ?`本轮结论：${value.suggestions.length} 张等待低价的观察候选。生成清单后再审核，不按当前参考价直接买入。`
      :'本轮结论：暂不买。没有满足利润、预算和数据条件的候选；详细原因见“候选与线索”。';sync();},
    setActive(value){active=value;revision++;busy=false;launching=false;haltTimer();advice=null;plan=null;record=null;approval.checked=false;table.replaceChildren();metrics.replaceChildren();positions.replaceChildren();positions.hidden=true;progress.textContent='';conclusion.textContent='正在读取当前账号候选；尚未启动交易。';diagnostic(null);
      service?.stopInvestment?.();if(value&&service){const ticket=revision;void task(()=>service.inspectInvestment()).then(result=>{
        if(valid(ticket)&&result?.record){budget.value=String(result.record.plan.capitalLimit);reserve.value=String(result.record.plan.reserveCoins);progress.textContent+=' · 已恢复记录，未自动继续交易。';}});}sync();},
  };
}
