import { taskExclusion } from '../../trading/task-catalog.js';
import { marketTaskMessages } from '../../trading/market-task-messages.js';
import { marketPlayerSearchStyle } from './fc27-market-player-search-style.js';

export function mountMarketPlayerPicker({$,picker,esc,playerTile,getDraft,getMode,isCurrent,onRows,onExclusion}){
 const host=$('pickerRows');let query=null,identities=[],selected=null,result=null,page=0,serial=0,liveCheck=()=>false;
 const style=host.ownerDocument.createElement('style');style.textContent=marketPlayerSearchStyle;$('picker').append(style);
 // The task panel can be mounted before EA login/localization is ready.
 // Instantiate the EA widget on opening the picker, not during bootstrap.
 let native=null;
 const mountNative=()=>{native??=picker.mountSearchControl?.({input:$('playerSearch'),isCurrent,
  onInput:text=>{serial++;query=text;selected=null;result=null;identities=[];onRows([]);liveCheck=isCurrent;host.innerHTML='<p class="hint">选择姓名后查看具体卡版本。</p>';},
  onError:()=>{serial++;selected=null;result=null;onRows([]);host.textContent='EA 姓名资料读取失败，请重新输入。';},
  onSelect:player=>{query=player.name;identities=[player];liveCheck=isCurrent;void versions(player);}
 });};
 const heading=()=>`<div class="row between wrap"><b>${esc(selected.name)}</b><button type="button" data-player-back>返回姓名</button>${getMode()==='exclude'?`<button type="button" data-player-exclusion="${selected.playerId}" ${getDraft().excluded.some(e=>e.type==='player'&&e.id===selected.playerId)?'disabled':''}>排除全部版本</button>`:''}</div>`;
 const render=()=>{
  const draft=getDraft(),mode=getMode();
  if(!selected){onRows([]);if(native){host.innerHTML='<p class="hint">选择姓名后查看具体卡版本。</p>';if(query)native.show(query,identities);return;}
   host.innerHTML=(identities.length?'<div class="player-name-row hint"><span>球员姓名</span><span>评分</span></div>':'')+identities.map(p=>`<button type="button" class="player-name-row" data-player-identity="${p.playerId}"><span>${esc(p.name)}</span><span>${p.rating}</span></button>${mode==='exclude'?`<button type="button" data-player-exclusion="${p.playerId}" ${draft.excluded.some(e=>e.type==='player'&&e.id===p.playerId)?'disabled':''}>排除全部版本</button>`:''}`).join('')||'<p class="hint">请输入至少两个字符；按 EA 姓名资料搜索，每次最多显示五人。</p>';return;}
  const rows=result?.rows.slice(page*5,page*5+5)??[];onRows(rows);
  host.innerHTML=heading()+rows.map(c=>`<div class="picker-row">${playerTile(c)}${mode==='fixed'?`<button type="button" data-add="${c.definitionId}" ${draft.players.some(p=>p.definitionId===c.definitionId)?'disabled':''}>添加</button>`:`<button type="button" data-exclude="${c.definitionId}" ${taskExclusion(c,draft.excluded)?'disabled':''}>排除此版本</button>`}</div>`).join('')+`${rows.length?'':'<p>此页没有可选版本。</p>'}<div class="row between"><button type="button" data-player-prev ${page===0?'disabled':''}>上一页</button><small>第 ${page+1} 页 · 已读取 ${result?.rows.length??0} 个版本</small><button type="button" data-player-next ${(page+1)*5<(result?.rows.length??0)||result?.more?'':'disabled'}>下一页</button></div><p class="hint">版本来自 EA 概念目录；不表示市场有货。${result?.capped?'已达本次 100 个版本读取上限。':''}</p>`;
 };
 const versions=async(player,start=0)=>{
  const ticket=++serial;const valid=()=>ticket===serial&&liveCheck()&&isCurrent();selected=player;onRows([]);host.innerHTML=heading()+'<p>正在读取 EA 卡版本…</p>';
  try{const next=await picker.versions(player.playerId,{start,isCurrent:valid});if(!valid())return;
   if(start===0){result=next;page=0;}else{const known=new Set(result.rows.map(r=>r.definitionId));result={...next,rows:[...result.rows,...next.rows.filter(r=>!known.has(r.definitionId))]};page++;}
   render();
  }catch(error){if(valid()){result=null;host.innerHTML=heading()+`<p>${esc(marketTaskMessages[error.message]??'EA 版本读取失败，请重新选择球员；没有添加或购买卡片。')}</p>`;}}
 };
 host.addEventListener('click',event=>{
  if(!event.isTrusted||!isCurrent())return;const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-player-back')){serial++;selected=null;result=null;identities=picker.search(query);render();}
  if(b.dataset.playerIdentity){const player=identities.find(p=>p.playerId===Number(b.dataset.playerIdentity));if(player)void versions(player);}
  if(b.dataset.playerExclusion){const player=identities.find(p=>p.playerId===Number(b.dataset.playerExclusion));if(player){onExclusion(player);render();}}
  if(b.hasAttribute('data-player-prev')&&page>0){page--;render();}
  if(b.hasAttribute('data-player-next')&&result){if((page+1)*5<result.rows.length){page++;render();}else if(result.more)void versions(selected,result.next);}
 });
 $('picker').addEventListener('close',()=>{serial++;native?.reset();onRows([]);});
 return {get native(){return !!native;},reset(){mountNative();query=null;serial++;selected=null;result=null;identities=[];onRows([]);native?.reset();},
  query(text,check){liveCheck=check;if(query!==text){serial++;query=text;selected=null;result=null;identities=picker.search(text);}render();}};
}
