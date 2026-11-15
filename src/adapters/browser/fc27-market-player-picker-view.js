import { taskExclusion } from '../../trading/task-catalog.js';
import { marketTaskMessages } from '../../trading/market-task-messages.js';

export function mountMarketPlayerPicker({$,picker,esc,playerTile,getDraft,getMode,isCurrent,onRows,onExclusion}){
 const host=$('pickerRows');let query=null,identities=[],selected=null,result=null,page=0,serial=0,liveCheck=()=>false;
 const render=()=>{
  const draft=getDraft(),mode=getMode();
  if(!selected){onRows([]);host.innerHTML=identities.map(p=>`<div class="picker-row"><div><b>${esc(p.name)}</b><small>基础评分 ${p.rating} · 先选择球员，再选卡版本</small></div><button type="button" data-player-identity="${p.playerId}">查看版本</button>${mode==='exclude'?`<button type="button" data-player-exclusion="${p.playerId}" ${draft.excluded.some(e=>e.type==='player'&&e.id===p.playerId)?'disabled':''}>排除全部版本</button>`:''}</div>`).join('')||'<p class="hint">请输入至少两个字符；按 EA 姓名资料搜索，每次最多显示五人。</p>';return;}
  const rows=result?.rows.slice(page*5,page*5+5)??[];onRows(rows);
  host.innerHTML=`<div class="row between"><b>${esc(selected.name)}</b><button type="button" data-player-back>返回姓名</button></div>`+rows.map(c=>`<div class="picker-row">${playerTile(c)}${mode==='fixed'?`<button type="button" data-add="${c.definitionId}" ${draft.players.some(p=>p.definitionId===c.definitionId)?'disabled':''}>添加</button>`:`<button type="button" data-exclude="${c.definitionId}" ${taskExclusion(c,draft.excluded)?'disabled':''}>排除此版本</button>`}</div>`).join('')+`${rows.length?'':'<p>此页没有可选版本。</p>'}<div class="row between"><button type="button" data-player-prev ${page===0?'disabled':''}>上一页</button><small>第 ${page+1} 页 · 已读取 ${result?.rows.length??0} 个版本</small><button type="button" data-player-next ${(page+1)*5<(result?.rows.length??0)||result?.more?'':'disabled'}>下一页</button></div><p class="hint">版本来自 EA 概念目录；不表示市场有货。${result?.capped?'已达本次 100 个版本读取上限。':''}</p>`;
 };
 const versions=async(player,start=0)=>{
  const ticket=++serial;const valid=()=>ticket===serial&&liveCheck()&&isCurrent();selected=player;onRows([]);host.textContent='正在读取 EA 卡版本…';
  try{const next=await picker.versions(player.playerId,{start,isCurrent:valid});if(!valid())return;
   if(start===0){result=next;page=0;}else{const known=new Set(result.rows.map(r=>r.definitionId));result={...next,rows:[...result.rows,...next.rows.filter(r=>!known.has(r.definitionId))]};page++;}
   render();
  }catch(error){if(valid()){selected=null;result=null;host.textContent=marketTaskMessages[error.message]??'EA 版本读取失败，请重新选择球员；没有添加或购买卡片。';}}
 };
 host.addEventListener('click',event=>{
  if(!event.isTrusted||!isCurrent())return;const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-player-back')){serial++;selected=null;result=null;render();}
  if(b.dataset.playerIdentity){const player=identities.find(p=>p.playerId===Number(b.dataset.playerIdentity));if(player)void versions(player);}
  if(b.dataset.playerExclusion){const player=identities.find(p=>p.playerId===Number(b.dataset.playerExclusion));if(player){onExclusion(player);render();}}
  if(b.hasAttribute('data-player-prev')&&page>0){page--;render();}
  if(b.hasAttribute('data-player-next')&&result){if((page+1)*5<result.rows.length){page++;render();}else if(result.more)void versions(selected,result.next);}
 });
 return {reset(){query=null;serial++;selected=null;result=null;identities=[];onRows([]);},
  query(text,check){liveCheck=check;if(query!==text){serial++;query=text;selected=null;result=null;identities=picker.search(text);}render();}};
}
