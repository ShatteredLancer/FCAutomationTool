import { marketUnresolved } from '../../trading/market-recovery.js';

// Only explicit trusted clicks can change the local recovery classification.
export function mountMarketRecoveryView({ document, parent, onManage, onRecheck }) {
  const panel=document.createElement('details'), title=document.createElement('summary'), body=document.createElement('div');
  panel.id='market-recovery-panel'; title.textContent='交易恢复'; panel.append(title,body); parent.append(panel);
  const dialog=document.createElement('dialog'); dialog.id='market-recovery-confirm';
  const heading=document.createElement('h2'), explanation=document.createElement('p'), actions=document.createElement('div');
  actions.className='actions'; const cancel=document.createElement('button'), confirm=document.createElement('button');
  cancel.type=confirm.type='button';cancel.textContent='取消';confirm.textContent='确认';confirm.id='market-recovery-confirm-yes';
  actions.append(cancel,confirm);dialog.append(heading,explanation,actions);parent.append(dialog);
  let pending=null, page=0, stamp=null;
  cancel.onclick=event=>{if(event.isTrusted)dialog.close();};
  dialog.addEventListener('close',()=>{pending=null;});
  confirm.onclick=event=>{if(!event.isTrusted||!pending)return;const request=pending;dialog.close();onManage(request);};
  function update({ coordination, tasks=[], busy=false }) {
    if(!coordination){panel.hidden=true;dialog.close();return;}
    const {ledger,context}=coordination, rows=ledger.intents.filter(marketUnresolved);
    panel.hidden=!rows.length;title.textContent=`交易恢复（${rows.length} 条待处理）`;
    const key=JSON.stringify([context,ledger.revision,busy,tasks.map(t=>[t.id,t.name]),rows.some(r=>r.phase==='pending'&&Date.now()<r.at+60000)]);
    if(stamp===key)return;stamp=key;
    if(pending && (busy||pending.revision!==ledger.revision||JSON.stringify(pending.context)!==JSON.stringify(context)))dialog.close();
    body.replaceChildren();page=Math.min(page,Math.max(0,Math.ceil(rows.length/5)-1));
    const help=document.createElement('p');help.className='hint';
    help.textContent='先核对回执；仍无法确认的旧记录可隔离，再单独解除全局暂停并启动其他任务。隔离保留原任务、卡片和未知买入资金；不会自动重试交易。';body.append(help);
    for(const row of rows.slice(page*5,page*5+5)){
      const box=document.createElement('div'),label=document.createElement('p'),buttons=document.createElement('div');buttons.className='actions';
      const kind={buy:'买入',bid:'竞价',move:'移卡',list:'挂牌'}[row.kind], task=tasks.find(t=>t.id===row.taskId)?.name??'历史任务';
      label.textContent=`${task} · ${kind} · EA ${row.definitionId} · ${row.coins.toLocaleString()} 金币 · ${new Date(row.at).toLocaleString()} · ${row.phase==='isolated'?'隔离待处理':'结果待核对'}${row.isolation?.handledAt?' · 已备注手动处理，仍需回执':''}`;
      const button=document.createElement('button');button.type='button';button.dataset.recovery=row.phase==='pending'?'isolate':'handled';
      button.textContent=row.phase==='pending'?'隔离旧记录':'已手动处理（备注）';
      button.disabled=busy||row.phase==='pending'&&Date.now()<row.at+60000||Boolean(row.isolation?.handledAt);
      button.title=row.phase==='pending'?'发送满一分钟后可隔离；原任务与卡片仍受保护。':'仅保存备注，不会释放未知成交的资金或卡片。';
      button.onclick=event=>{if(!event.isTrusted||button.disabled)return;
        pending={context:structuredClone(context),revision:ledger.revision,requestId:row.id,action:button.dataset.recovery};
        heading.textContent=row.phase==='pending'?'隔离这条旧交易？':'记录已手动处理？';
        explanation.textContent=row.phase==='pending'?'这不会认定交易失败或清除证据。原任务和对应卡片继续锁定，未知买入／竞价仍预留金额及容量。同版本未知买入也会阻止其他任务重复采购。之后请另行解除全局暂停，再启动不受影响的任务。':'这只是你的处理备注，不是 EA 成交回执。原任务、卡片和未知资金仍保留保护；请点击重新核对，确认实际结果。';
        dialog.showModal();};
      buttons.append(button);box.append(label,buttons);body.append(box);
    }
    const controls=document.createElement('div');controls.className='actions';
    for(const [text,delta] of [['上一页',-1],['下一页',1]]){
      const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=busy||(delta<0?page===0:(page+1)*5>=rows.length);
      b.onclick=e=>{if(!e.isTrusted)return;page+=delta;stamp=null;update({coordination,tasks,busy});};controls.append(b);
    }
    const recheck=document.createElement('button');recheck.type='button';recheck.textContent='重新核对';recheck.disabled=busy;recheck.onclick=e=>{if(e.isTrusted)onRecheck();};controls.append(recheck);body.append(controls);
  }
  return {update};
}
