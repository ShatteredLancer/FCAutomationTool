import {defaultTradingTaskSettings,defaultTradingPublicSettings} from '../../trading/task-model.js';
import {readTaskCatalogPage,taskExclusion} from '../../trading/task-catalog.js';
import {marketTaskMarkup} from './fc27-market-task-markup.js';
import {mountFc27TradingView} from './fc27-trading-view.js';
import {bindCurrencyArrows,currencyInputStyles} from './fc27-listing-currency.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={fixed:'固定名单',filter:'条件选卡',sell:'持仓出售'},states={ready:'待启动',running:'运行中',queued:'排队中',paused:'已暂停',stopped:'已停止',archived:'已归档',review:'待核对'};
const inputOf=t=>({name:t.name,mode:t.mode,settings:structuredClone(t.settings),players:structuredClone(t.players),owned:structuredClone(t.owned),excluded:structuredClone(t.excluded)});
const errors={TASKS_STALE:'任务已在其他窗口修改，请刷新后重新编辑。',TASKS_CONTEXT_CHANGED:'账号已变化，请刷新任务。',TASKS_SAVE_UNVERIFIED:'保存回读未确认，请刷新核对，勿重复添加。',TASKS_INVALID:'请检查价格、评分和数量设置。',TASKS_SELECTION_EMPTY:'请先选择具体版本或持仓卡。',TASKS_STORAGE_LIMIT:'任务记录达到存储容量限制，原记录已保留。',TASKS_UNRESOLVED:'有待核对的交易，不能停止或删除记录。',TASKS_EDIT_BLOCKED:'该任务当前不能编辑，请先暂停并核对交易。',TASKS_EXECUTION_UNAVAILABLE:'自动执行尚未开放。'};

export function mountFc27MarketTasks({document,parent,tab,service,legacyService=null,readCatalog=()=>[],readInventory=()=>[]}){
 parent.replaceChildren();const element=document.createElement('section');element.className='market-task-manager';parent.append(element);
 const shadow=element.attachShadow({mode:'closed'});shadow.innerHTML=marketTaskMarkup;const $=id=>shadow.getElementById(id);
 const currencyStyle=document.createElement('style');currencyStyle.textContent=currencyInputStyles+' .listing-currency{width:100%;background:#253945;border-color:#48606d}';shadow.append(currencyStyle);
 const editorStatus=document.createElement('output');editorStatus.setAttribute('role','status');editorStatus.setAttribute('aria-live','polite');$('editor').querySelector('.dialog-body').append(editorStatus);
 const legacyDetails=document.createElement('details'),summary=document.createElement('summary'),legacyHost=document.createElement('div');summary.textContent='原投资、观察与历史记录';legacyDetails.append(summary,legacyHost);parent.append(legacyDetails);
 // Keep the old view/service and journals intact; its unread badge must not rename the shared tab.
 const legacy=mountFc27TradingView({document,parent:legacyHost,tab:document.createElement('button'),service:legacyService});
 let active=false,busy=false,epoch=0,snapshot=null,draft=null,editingId=null,editorSnapshot=null,catalog=null,inventory=[],pickerMode='fixed',pendingDelete=null;
 let querySerial=0,queryTimer=null,page=0,cursors=[0],poolRows=[],poolMore=false,stockPage=0;
 const message=value=>{$('toast').textContent=value;editorStatus.textContent=value;};
 const sameContext=()=>snapshot&&JSON.stringify(snapshot.context)===JSON.stringify(service.context());
 const closeDialogs=()=>{querySerial++;clearTimeout(queryTimer);for(const dialog of shadow.querySelectorAll('dialog[open]'))dialog.close();};
 const check=()=>{if(!active||!parent.isConnected||!sameContext())throw Error('TASKS_CONTEXT_CHANGED');};
 const run=async fn=>{if(busy||!active)return;const ticket=epoch;busy=true;try{check();const result=await fn();if(ticket!==epoch||!active)return;check();if(result?.store){snapshot=result;render();}return result;}
  catch(error){if(ticket===epoch&&active){message(errors[error.message]??`未完成：${/^TASKS_[A-Z_]+$/.test(error.message)?error.message:'读取或保存失败'}`);if(error.message==='TASKS_CONTEXT_CHANGED'){closeDialogs();snapshot=null;$('tasks').replaceChildren();}}}
  finally{if(ticket===epoch)busy=false;}};
 const render=()=>{if(!snapshot)return;const tasks=snapshot.store.tasks.filter(t=>$('taskFilter').value==='archived'?t.state==='archived':t.state!=='archived');
  $('tasks').innerHTML=tasks.map(t=>`<tr><td><button type="button" class="task-name" data-action="detail" data-id="${esc(t.id)}">${esc(t.name)}</button><small>${modes[t.mode]} · 买入 ${esc(t.settings.buyValue)}${t.settings.buyRule==='percent'?'%':''} · 卖出 ${esc(t.settings.sellValue)}${t.settings.sellRule==='reference'?'%':''}</small></td><td>${states[t.state]}</td><td>${['bought','listed','sold'].map(kind=>t.activity.receipts.filter(r=>r.kind===kind).length).join(' / ')}</td><td><div class="actions"><button type="button" disabled title="统一调度与买卖执行接入后开放">启动</button>${['ready','paused'].includes(t.state)?`<button type="button" data-action="edit" data-id="${esc(t.id)}">编辑</button>`:''}<button type="button" data-action="copy" data-id="${esc(t.id)}">复制</button>${['running','queued'].includes(t.state)?`<button type="button" data-action="pause" data-id="${esc(t.id)}">暂停</button>`:''}${!['stopped','archived'].includes(t.state)?`<button type="button" data-action="stop" data-id="${esc(t.id)}">停止</button>`:''}<button type="button" data-action="delete" data-id="${esc(t.id)}">${t.activity.receipts.length?'归档':'删除'}</button></div></td></tr>`).join('');$('empty').hidden=tasks.length>0;
  for(const key of Object.keys(defaultTradingPublicSettings()))$(key).value=String(snapshot.store.settings[key]??'');
  $('settingsBrief').textContent=`${snapshot.store.settings.source.toUpperCase()} · 跟随账号平台 · 搜索 ${snapshot.store.settings.gapMin}–${snapshot.store.settings.gapMax} 秒`;
 };
 const reload=async()=>{if(busy||!active)return;closeDialogs();const ticket=++epoch;busy=true;message('读取本地任务…');try{const result=await service.read();if(ticket!==epoch||!active)return;snapshot=result;check();render();message('任务已加载；保存不会启动交易。');}catch(error){if(ticket===epoch){snapshot=null;$('tasks').replaceChildren();message(errors[error.message]??'任务读取失败，原数据未清除。');}}finally{if(ticket===epoch)busy=false;}};
 const readInputs=()=>{for(const [key,base]of Object.entries(defaultTradingTaskSettings())){const node=$(key),raw=node.value;draft.settings[key]=node.type==='number'||key==='duration'||['league','nation','club','position'].includes(key)?(raw===''&&base===null?null:Number(raw)):raw;}draft.name=$('taskName').value.trim();};
 const playerTile=c=>`<div class="player"><span class="card">${esc(c.rating??'—')}</span><div><b>${esc(c.name)}</b><small>${esc(c.version||'版本')} · EA ${esc(c.definitionId)}</small></div></div>`;
 const fillSelect=(key,rows)=>{const field={league:'leagueId',nation:'nationId',club:'teamId',position:'preferredPosition'}[key],value=draft.settings[key];
  const values=[...new Set(rows.map(c=>c[field]).filter(v=>Number.isSafeInteger(v)&&v>=0))];if(value!==null&&!values.includes(value))values.push(value);
  $(key).innerHTML='<option value="">全部</option>'+values.sort((a,b)=>a-b).map(v=>`<option value="${v}">${esc(rows.find(c=>c[field]===v)?.[`${key}Name`]??`ID ${v}`)}</option>`).join('');$(key).value=String(value??'');};
 const loadCatalog=async()=>{if(catalog)return catalog;check();const rows=await readCatalog();check();if(!Array.isArray(rows))throw Error('TASKS_CATALOG_UNAVAILABLE');catalog=rows;for(const key of ['league','nation','club','position'])fillSelect(key,rows);return rows;};
 const renderDraft=()=>{for(const b of shadow.querySelectorAll('[data-mode]'))b.classList.toggle('active',b.dataset.mode===draft.mode);for(const mode of ['fixed','filter','sell'])$(`${mode}Box`).classList.toggle('hidden',draft.mode!==mode);$('buyFields').classList.toggle('hidden',draft.mode==='sell');
  $('selectedRows').innerHTML=draft.players.map(p=>`<tr><td>${playerTile(p)}</td><td><input type="number" min="150" max="15000000" placeholder="沿用买入规则" aria-label="${esc(p.name)} 买入上限" data-cap="${p.definitionId}" value="${p.cap??''}"></td><td><input type="number" min="1" placeholder="不限" aria-label="${esc(p.name)} 持仓上限" data-qty="${p.definitionId}" value="${p.qty??''}"></td><td><button type="button" data-remove="${p.definitionId}">移除</button></td></tr>`).join('');
  $('exclusionList').innerHTML=draft.excluded.map((e,i)=>`<button type="button" data-restore="${i}" title="移除排除规则">${esc(e.label)} ×</button>`).join('')||'<small>未排除球员</small>';
  const stocks=inventory.filter(r=>$('pile').value==='all'||r.pile===$('pile').value);stockPage=Math.min(stockPage,Math.max(0,Math.ceil(stocks.length/5)-1));
  $('sellRows').innerHTML=stocks.slice(stockPage*5,stockPage*5+5).map(r=>`<label class="picker-row check"><input type="checkbox" data-stock="${esc(r.itemId)}" ${draft.owned.some(p=>p.itemId===r.itemId)?'checked':''} ${r.available?'':'disabled'}>${playerTile(r)}<small>${esc(r.pile)} · ${r.available?'缓存引用':'不可选择'}</small></label>`).join('')||'<p class="hint">未读取缓存持仓。点击下方读取；不会刷新EA或执行挂牌。</p>';
  stockPrev.disabled=stockPage===0;stockNext.disabled=(stockPage+1)*5>=stocks.length;stockCount.textContent=`第 ${stockPage+1} 页 · 已选 ${draft.owned.length} 张`;
  const selected=draft.mode==='sell'?draft.owned.length:draft.mode==='fixed'?draft.players.length:null;
  $('taskPreview').textContent=`${modes[draft.mode]} · ${selected===null?'按条件和统一排除名单运行':`已选 ${selected} ${draft.mode==='sell'?'张实体':'个版本'}`} · 保存后待启动`;
  $('extraFiltersLabel').textContent=`更多筛选${draft.excluded.length?` · 排除 ${draft.excluded.length} 项`:''}`;
  $('buyLabel').textContent=draft.settings.buyRule==='fixed'?'固定买入上限':'买入比例 %';$('sellLabel').textContent=draft.settings.sellRule==='fixed'?'固定挂牌价':'挂牌比例 %';
  for(const [key,rule]of [['buyValue','buyRule'],['sellValue','sellRule']])for(const b of $(key).parentElement.querySelectorAll('button'))b.hidden=draft.settings[rule]!=='fixed';
  for(const input of $('selectedRows').querySelectorAll('[data-cap]'))bindCurrencyArrows({document,input,label:'单卡买入上限',onStep:value=>{input.value=String(value);draft.players.find(p=>p.definitionId===Number(input.dataset.cap)).cap=value;}});
 };
 const cancelQuery=()=>{querySerial++;clearTimeout(queryTimer);};
 const renderPool=()=>{$('pool').innerHTML=poolRows.map(c=>`<div class="picker-row">${playerTile(c)}<button type="button" data-exclude="${c.definitionId}" ${taskExclusion(c,draft.excluded)?'disabled':''}>${taskExclusion(c,draft.excluded)?'已排除':'排除此版本'}</button></div>`).join('')||'<p class="hint">当前缓存没有匹配球员，非全市场结果。</p>';
  $('poolPage').textContent=`第 ${page+1} 页${poolMore?' · 还有更多':''}`;$('poolPrev').disabled=page===0;$('poolNext').disabled=!poolMore;$('filterCount').textContent=`已预览 ${page*5+poolRows.length} 个缓存版本 · 非全量目录`;};
 const queryPool=async(reset=false)=>{cancelQuery();if($('poolPreview').classList.contains('hidden'))return;if(reset){page=0;cursors=[0];}const ticket=querySerial;const settings={...draft.settings},query=$('poolSearch').value;poolRows=[];$('pool').textContent='正在查找…';$('poolNext').disabled=$('poolPrev').disabled=true;
  try{const rows=await loadCatalog();if(ticket!==querySerial)return;const result=await readTaskCatalogPage({rows,settings,query,cursor:cursors[page]??0,isCurrent:()=>ticket===querySerial&&active&&sameContext()&&$('editor').open});if(ticket!==querySerial)return;poolRows=result.rows;poolMore=result.more;if(result.more)cursors[page+1]=result.next;renderPool();}catch(error){if(ticket===querySerial){$('pool').textContent=errors[error.message]??'本地目录暂不可用。';}}
 };
 let pickerRows=[];
 const queryPicker=async()=>{cancelQuery();const ticket=querySerial,query=$('playerSearch').value.trim();if(!query){$('pickerRows').textContent='输入名字，每次最多显示5个缓存版本。';return;}$('pickerRows').textContent='正在搜索…';
  try{const rows=await loadCatalog();if(ticket!==querySerial)return;const result=await readTaskCatalogPage({rows,query,isCurrent:()=>ticket===querySerial&&active&&sameContext()&&$('picker').open});if(ticket!==querySerial)return;pickerRows=result.rows;
   $('pickerRows').innerHTML=pickerRows.map(c=>`<div class="picker-row">${playerTile(c)}${pickerMode==='fixed'?`<button type="button" data-add="${c.definitionId}" ${draft.players.some(p=>p.definitionId===c.definitionId)?'disabled':''}>添加</button>`:`<button type="button" data-exclude="${c.definitionId}" ${taskExclusion(c,draft.excluded)?'disabled':''}>排除此版本</button>${Number.isSafeInteger(c.playerId)?`<button type="button" data-exclude-player="${c.definitionId}">全部版本</button>`:''}`}</div>`).join('')||'<p class="hint">本地缓存未找到；完整目录将在条件选卡阶段接入。</p>';if(result.more)$('pickerRows').insertAdjacentHTML('beforeend','<small>还有更多，请细化名字。</small>');
  }catch(error){if(ticket===querySerial)$('pickerRows').textContent=errors[error.message]??'本地目录读取失败。';}
 };
 const openPicker=mode=>{pickerMode=mode;$('pickerTitle').textContent=mode==='fixed'?'选择精确版本':'排除球员';$('playerSearch').value='';pickerRows=[];$('picker').showModal();void queryPicker();};
 const openEditor=task=>{check();editingId=task?.id??null;editorSnapshot=structuredClone(snapshot);draft=task?inputOf(task):{name:'',mode:'fixed',settings:defaultTradingTaskSettings(),players:[],owned:[],excluded:[]};catalog=null;inventory=[];cancelQuery();
  $('taskName').value=draft.name;for(const key of Object.keys(defaultTradingTaskSettings()))$(key).value=String(draft.settings[key]??'');for(const key of ['league','nation','club','position'])fillSelect(key,[]);
  $('editTitle').textContent=task?'编辑交易任务':'新建交易任务';editorStatus.textContent='';$('extraFilters').open=$('moreRules').open=false;$('poolPreview').classList.add('hidden');$('pool').replaceChildren();$('poolSearch').value='';$('filterCount').textContent='展开后读取本地缓存';$('pile').value='all';renderDraft();$('editor').showModal();};
 const removeTask=async()=>{const result=await service.action({...snapshot,id:pendingDelete,action:'delete'});$('confirm').close();message('任务已删除或归档，原交易证据保留。');return result;};
 shadow.addEventListener('click',event=>{if(!event.isTrusted||!active)return;const button=event.target.closest('button');if(!button)return;
  if(button.dataset.close){$(button.dataset.close).close();cancelQuery();return;}if(busy)return;
  try{check();if(button.dataset.mode){readInputs();draft.mode=button.dataset.mode;cancelQuery();renderDraft();}
   if(button.dataset.action){const task=snapshot.store.tasks.find(t=>t.id===button.dataset.id);if(!task)return;const action=button.dataset.action;
    if(action==='edit')openEditor(task);else if(action==='detail'){$('taskDetailBody').innerHTML=`<h3>${esc(task.name)}</h3><p>${modes[task.mode]} · ${states[task.state]}</p><p>买入：${task.settings.buyRule==='fixed'?'固定上限':'参考价比例'} ${task.settings.buyValue}${task.settings.buyRule==='percent'?'%':''}</p><p>卖出：${task.settings.sellRule==='fixed'?'固定挂牌价':'参考价比例'} ${task.settings.sellValue}${task.settings.sellRule==='reference'?'%':''}</p><p>${task.activity.unresolved?'有待核对交易':'无待核对交易'}</p><h3>已选卡片</h3>${(task.mode==='fixed'?task.players:task.owned).map(p=>`<p>${esc(p.name)} · EA ${p.definitionId}</p>`).join('')||'<p>按条件选卡</p>'}<h3>交易回执</h3>${task.activity.receipts.map(r=>`<p>${({bought:'买入',moved:'移动',listed:'挂牌',sold:'售出'})[r.kind]} · EA ${r.definitionId} · ${r.coins??'金额未知'}</p>`).join('')||'<p>暂无交易</p>'}`;$('taskDetail').showModal();}
    else if(action==='delete'){pendingDelete=task.id;$('confirmBody').textContent=task.activity.receipts.length?'任务有交易记录，将归档并保留完整回执。':'删除这个尚无交易记录的任务？';$('confirm').showModal();}
    else void run(()=>service.action({...snapshot,id:task.id,action}));
   }
   if(button.dataset.add){const c=pickerRows.find(r=>r.definitionId===Number(button.dataset.add));if(c&&!draft.players.some(p=>p.definitionId===c.definitionId)){draft.players.push({definitionId:c.definitionId,name:c.name,rating:c.rating,version:c.version??'',cap:null,qty:null});renderDraft();void queryPicker();}}
   if(button.dataset.remove){draft.players=draft.players.filter(p=>p.definitionId!==Number(button.dataset.remove));renderDraft();}
   if(button.dataset.exclude||button.dataset.excludePlayer){const c=[...pickerRows,...poolRows].find(r=>r.definitionId===Number(button.dataset.exclude??button.dataset.excludePlayer));if(c){const type=button.dataset.excludePlayer?'player':'version',id=type==='player'?c.playerId:c.definitionId;if(!draft.excluded.some(e=>e.type===type&&e.id===id)){if(type==='player')draft.excluded=draft.excluded.filter(e=>e.type!=='version'||!catalog?.some(r=>r.definitionId===e.id&&r.playerId===id));draft.excluded.push({type,id,label:`${c.name} · ${type==='player'?'全部版本':`${c.rating} / EA ${c.definitionId}`}`});}renderDraft();renderPool();if($('picker').open)void queryPicker();}}
   if(button.dataset.restore!==undefined){draft.excluded.splice(Number(button.dataset.restore),1);renderDraft();renderPool();}
  }catch(error){message(errors[error.message]??'操作未完成，请刷新任务。');}
 });
 $('newTask').onclick=event=>{if(event.isTrusted&&!busy&&snapshot&&active){try{openEditor();}catch(error){message(errors[error.message]??'请刷新任务。');}}};$('reloadTasks').onclick=event=>{if(event.isTrusted)void reload();};$('taskFilter').onchange=render;
 $('pauseAll').onclick=event=>{if(event.isTrusted)void run(()=>service.action({...snapshot,action:'pause-all'}));};
 $('confirmYes').onclick=event=>{if(event.isTrusted)void run(removeTask);};
 $('taskForm').onchange=event=>{if(!draft)return;const t=event.target;
  if(t.dataset.cap||t.dataset.qty){const p=draft.players.find(r=>r.definitionId===Number(t.dataset.cap??t.dataset.qty));p[t.dataset.cap?'cap':'qty']=t.value===''?null:Number(t.value);}
  if(t.dataset.stock){const row=inventory.find(r=>r.itemId===t.dataset.stock);if(row?.available){draft.owned=draft.owned.filter(r=>r.itemId!==row.itemId);if(t.checked)draft.owned.push({itemId:row.itemId,definitionId:row.definitionId,name:row.name,pile:row.pile});}}
  if(t.id==='pile')stockPage=0;if(t.id==='buyRule')$('buyValue').value=t.value==='fixed'?'800':'85';if(t.id==='sellRule')$('sellValue').value=t.value==='fixed'?'1000':'100';readInputs();renderDraft();
  if(['ratingMin','ratingMax','quality','league','nation','club','position'].includes(t.id))void queryPool(true);
 };
 $('taskForm').onsubmit=event=>{event.preventDefault();if(!event.isTrusted)return;readInputs();void run(async()=>{const result=await service.saveTask({...editorSnapshot,id:editingId,input:draft});$('editor').close();message('任务已保存，尚未启动。');return result;});};
 for(const [key,rule]of [['buyValue','buyRule'],['sellValue','sellRule']])bindCurrencyArrows({document,input:$(key),label:key==='buyValue'?'买入价格':'挂牌价格',enabled:()=>draft?.settings[rule]==='fixed',onStep:value=>{$(key).value=String(value);readInputs();renderDraft();}});
 bindCurrencyArrows({document,input:$('hardCap'),label:'单卡绝对买入上限',onStep:value=>{$('hardCap').value=String(value);readInputs();}});
 $('saveGlobal').onclick=event=>{if(!event.isTrusted)return;const settings=Object.fromEntries(Object.keys(defaultTradingPublicSettings()).map(key=>[key,key==='source'?$(key).value:$(key).value===''?null:Number($(key).value)]));void run(async()=>{const result=await service.saveSettings({...snapshot,settings});message('公共设置已保存。');return result;});};
 $('addPlayer').onclick=event=>{if(event.isTrusted&&!busy)openPicker('fixed');};$('editExclusions').onclick=event=>{if(event.isTrusted&&!busy)openPicker('exclude');};
 $('previewPool').onclick=event=>{if(!event.isTrusted)return;$('poolPreview').classList.toggle('hidden');void queryPool(true);};
 $('poolSearch').oninput=()=>{cancelQuery();queryTimer=setTimeout(()=>{void queryPool(true)},250);};$('playerSearch').oninput=()=>{cancelQuery();queryTimer=setTimeout(()=>{void queryPicker()},250);};
 $('poolPrev').onclick=event=>{if(event.isTrusted&&page>0){page--;void queryPool();}};$('poolNext').onclick=event=>{if(event.isTrusted&&poolMore){page++;void queryPool();}};
 $('extraFilters').addEventListener('toggle',()=>{if($('extraFilters').open&&active)void loadCatalog().catch(()=>{});});
 const stockButton=document.createElement('button');stockButton.type='button';stockButton.textContent='读取缓存持仓';$('sellBox').append(stockButton);stockButton.onclick=event=>{if(!event.isTrusted)return;void run(async()=>{inventory=await readInventory();stockPage=0;check();renderDraft();});};
 const stockControls=document.createElement('div');stockControls.className='row between';const stockPrev=document.createElement('button'),stockNext=document.createElement('button'),stockCount=document.createElement('small');stockPrev.type=stockNext.type='button';stockPrev.textContent='上一页持仓';stockNext.textContent='下一页持仓';stockControls.append(stockPrev,stockCount,stockNext);$('sellBox').append(stockControls);
 stockPrev.onclick=event=>{if(event.isTrusted&&stockPage>0){stockPage--;renderDraft();}};stockNext.onclick=event=>{if(event.isTrusted){stockPage++;renderDraft();}};
 for(const dialog of shadow.querySelectorAll('dialog'))dialog.addEventListener('close',cancelQuery);
 legacyDetails.addEventListener('toggle',()=>legacy.setActive(active&&legacyDetails.open));
 return {setActive(value){active=value;epoch++;busy=false;closeDialogs();legacy.setActive(value&&legacyDetails.open);tab.textContent='市场交易';if(value)void reload();else{snapshot=null;catalog=null;inventory=[];} }};
}
