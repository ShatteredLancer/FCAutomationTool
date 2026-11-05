import {deskNet} from '../../trading/desk-model.js';

export function mountTradingPlanView({document,parent,service,isCurrent,now=()=>Date.now(),timers=globalThis}){
  const add=(p,tag,text='')=>{const n=document.createElement(tag);n.textContent=text;p.append(n);return n;};
  add(parent,'h3','本轮投资结论与自动交易方案');
  add(parent,'small','先审核整批清单，再确认启动。买入价为硬上限，不是当前市场上一定有卖单。只操作本方案新买入的卡，不出售现有 Club 卡；自动化存在账号风险，无防封或盈利承诺。');
  const conclusion=add(parent,'p','正在等待候选分析；尚未启动交易。');conclusion.setAttribute('role','status');
  const fields=add(parent,'div');fields.className='trading-grid';
  const field=(label,value)=>{const l=add(fields,'label',label),input=add(l,'input');input.type='number';input.min='0';input.step='50';input.value=String(value);input.setAttribute('aria-label',label);return input;};
  const budget=field('本轮资金上限（可调整）',20000),reserve=field('本轮最低留存金币',0);
  budget.min='150';
  add(parent,'small','此处是本轮真实执行的独立审批上限；已有手填未售持仓也占用该额度。下方观察笔记中的估算余额不替代执行前的 EA 余额核验。');
  const actions=add(parent,'div');actions.className='trading-row';
  const prepare=add(actions,'button','生成可审核交易方案');prepare.type='button';
  const table=add(parent,'div');table.style.overflowX='auto';
  const approvalLabel=add(parent,'label'),approval=add(approvalLabel,'input');approval.type='checkbox';approval.setAttribute('aria-label','我已审核方案并同意真实买入和上架');
  add(approvalLabel,'span','我已审核清单、上限和风险，同意按本方案真实买入并上架');
  const buttons=add(parent,'div');buttons.className='trading-row';
  const start=add(buttons,'button','确认并开始自动交易'),resume=add(buttons,'button','确认并继续未完成操作'),stop=add(buttons,'button','停止自动交易'),recover=add(buttons,'button','核对成交与持仓（只读）');
  for(const b of [start,resume,stop,recover])b.type='button';
  add(parent,'small','首版每个版本一张、最多六张，一轮有限执行，不要求花满上限。买不到就跳过；购得后自动按固定目标价上架一小时，等待市场成交。不会自动降价、重挂或追涨。停止不撤回 EA 上已有的挂单；离开交易页会停止新操作。');
  const progress=add(parent,'output');progress.setAttribute('role','status');progress.setAttribute('aria-label','自动交易进度');progress.setAttribute('aria-live','polite');
  const positions=add(parent,'div');
  let active=false,busy=false,plan=null,record=null,timer=null,revision=0,advice=null;
  const valid=t=>active&&t===revision&&isCurrent();
  const haltTimer=()=>{if(timer!==null)timers.clearInterval(timer);timer=null;};
  const sync=()=>{const available=service?.executionAvailable?.()===true;prepare.disabled=busy||!available||!advice;
    start.disabled=busy||!plan||!approval.checked;resume.disabled=busy||!record||record.status==='completed'||!approval.checked;
    recover.disabled=busy||!available;budget.disabled=reserve.disabled=busy||!available;approval.disabled=busy||!available;stop.disabled=!available;};
  const statusNames={waiting:'尚未购买','buy-pending':'买入待核对',bought:'已买入','move-pending':'移入待核对',transfer:'待上架','list-pending':'上架待核对',listed:'已上架，未确认卖出',sold:'已确认卖出',skipped:'本轮跳过',rejected:'买入被拒绝'};
  const renderRecord=value=>{record=value;positions.replaceChildren();if(!record){sync();return;}
    const spent=record.entries.reduce((n,e)=>n+(e.offer&&!['waiting','skipped','rejected'].includes(e.phase)?e.offer.price:0),0);
    const sold=record.entries.filter(e=>e.phase==='sold'),profit=sold.reduce((n,e)=>n+deskNet(e.salePrice)-e.offer.price,0);
    progress.textContent=`${record.status==='completed'?'本轮已结束':record.status==='waiting-sales'?'买入/上架处理已结束，等待成交':record.status==='recovery-required'?'结果待核对，已暂停':record.status==='paused'?'已暂停':'正在执行'} · 已确认买入 ${record.entries.filter(e=>['bought','move-pending','transfer','list-pending','listed','sold'].includes(e.phase)).length} / ${record.entries.length} · 已用/待核对 ${spent} / 上限 ${record.plan.capitalLimit} · 已确认卖出 ${sold.length} · 已实现税后盈亏 ${profit}${record.reason?` · ${record.reason}`:''}`;
    for(let i=0;i<record.entries.length;i++){const e=record.entries[i];add(positions,'p',`${record.plan.rows[i].name}：${statusNames[e.phase]}${e.offer?` · 买价 ${e.offer.price}`:''}${e.phase==='sold'?` · 实际卖价 ${e.salePrice}`:''}${e.reason?` · ${e.reason}`:''}`);}sync();};
  const showError=e=>{const text={DESK_PLAN_NO_CANDIDATES:'本轮暂不买：缺少满足双源核价、利润和资金条件的候选',
    DESK_DISCOVERY_EXPIRED:'本轮参考价已过期或资金条件已变化，请重新分析候选',DESK_EXECUTION_RECOVERY_REQUIRED:'上轮仍有持仓或待核对结果，请先核对并继续原方案',
    DESK_EXECUTION_APPROVAL_REQUIRED:'方案已变化，请重新生成并审核后确认',DESK_EXECUTION_DISABLED:'当前构建未启用真实交易'}[e?.message]
    ??(/^(DESK|FC27)_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'读取或执行失败');
    progress.textContent=`操作未完成：${text}。已有成交/待核对记录保留；不要另开任务重复下单。`;};
  const task=async fn=>{if(busy||!active||!isCurrent())return;const ticket=revision;busy=true;sync();
    try{const result=await fn(ticket);if(valid(ticket)&&result?.record!==undefined)renderRecord(result.record);return result;}
    catch(e){if(valid(ticket))showError(e);}finally{if(ticket===revision){busy=false;sync();}}};
  const autoRead=()=>{haltTimer();timer=timers.setInterval(()=>{if(active&&!busy&&record?.status==='waiting-sales'&&isCurrent())void task(()=>service.recoverInvestment());},60000);};
  const drawPlan=result=>{
    plan=result.plan;approval.checked=false;table.replaceChildren();const t=add(table,'table');t.style.width='100%';const header=add(t,'tr');for(const text of ['球员/版本','数量','买入上限','目标卖价','情景税后净利','操作'])add(header,'th',text);
    for(const row of plan.rows){const tr=add(t,'tr');for(const text of [`${row.name} · EA ${row.definitionId}`,row.quantity,row.buyCap,row.sellPrice,row.expectedNet])add(tr,'td',String(text));
      const remove=add(add(tr,'td'),'button','移除此卡');remove.type='button';remove.setAttribute('aria-label',`移除方案球员 ${row.name}`);
      remove.addEventListener('click',e=>{if(!e.isTrusted)return;void task(async ticket=>{const ids=plan.rows.filter(r=>r.definitionId!==row.definitionId).map(r=>r.definitionId);
        plan=null;approval.checked=false;const result=await service.prepareInvestment({capitalLimit:Number(budget.value),reserveCoins:Number(reserve.value),definitionIds:ids});
        if(valid(ticket))drawPlan(result);});});}
    add(table,'p',`本批最多占用 ${plan.allocated} / 批准上限 ${plan.capitalLimit}；若全部按上限买入、目标价售出，情景税后净利 ${plan.expectedNet}。不是收益保证。EA 余额缓存：${result.balance??'未知，执行前核验'}。`);
    for(const row of plan.rows)add(table,'small',`${row.name}：${row.reason}`);
    progress.textContent=`清单已生成，尚未交易。报价有效至 ${new Date(plan.expiresAt).toLocaleTimeString()}；请审核后勾选并确认。`;
  };
  prepare.addEventListener('click',event=>{if(!event.isTrusted)return;void task(async ticket=>{
    plan=null;approval.checked=false;table.replaceChildren();progress.textContent='正在按本轮上限生成清单（不买入）…';
    const result=await service.prepareInvestment({capitalLimit:Number(budget.value),reserveCoins:Number(reserve.value)});if(!valid(ticket))return;drawPlan(result);
  });});
  const launch=async resumeMode=>{if(!approval.checked)return;await task(async ticket=>{
    approval.checked=false;progress.textContent='正在核价及核对余额/容量，随后按已批准方案执行…';
    const result=await service.startInvestment({plan:resumeMode?null:plan,resume:resumeMode,approved:true,onProgress:value=>{if(valid(ticket))renderRecord(value);}});
    if(valid(ticket)&&result?.record?.status==='waiting-sales')autoRead();return result;
  });};
  start.addEventListener('click',e=>{if(e.isTrusted)void launch(false);});resume.addEventListener('click',e=>{if(e.isTrusted)void launch(true);});
  stop.addEventListener('click',e=>{if(!e.isTrusted||!active)return;service.stopInvestment();haltTimer();approval.checked=false;
    progress.textContent='已请求停止新操作；正在发送的请求会先保留回执。已上架挂单不会撤回，稍后可只读核对。';sync();});
  recover.addEventListener('click',e=>{if(e.isTrusted)void task(()=>service.recoverInvestment());});
  approval.addEventListener('change',sync);
  for(const input of [budget,reserve])input.addEventListener('input',()=>{plan=null;approval.checked=false;table.replaceChildren();sync();});
  sync();
  return {setAdvice(value){advice=value;plan=null;approval.checked=false;table.replaceChildren();
    conclusion.textContent=!value?'尚无本轮结论，请先分析候选。':value.suggestions?.length
      ?`本轮结论：${value.suggestions.length} 张等待低价的观察候选；尚未核实 EA 挂单，先不按当前参考价买入。点击生成整批方案，审核后才执行。`
      :'本轮结论：暂不买。没有满足现有利润、预算和数据条件的候选，不凑数推荐。';sync();},
    setActive(value){active=value;revision++;busy=false;haltTimer();plan=null;record=null;approval.checked=false;table.replaceChildren();positions.replaceChildren();
      service?.stopInvestment?.();if(value&&service){const ticket=revision;void task(()=>service.inspectInvestment()).then(result=>{
        if(valid(ticket)&&result?.record){budget.value=String(result.record.plan.capitalLimit);reserve.value=String(result.record.plan.reserveCoins);progress.textContent+=' · 已恢复记录，未自动继续交易。';}});}sync();},
  };
}
