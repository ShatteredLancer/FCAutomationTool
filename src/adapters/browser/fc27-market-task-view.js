import { mountMarketRecoveryView } from './fc27-market-recovery-view.js';
import { mountMarketScheduleEditor, marketScheduleSummary } from './fc27-market-task-schedule-view.js';
import { mountMarketRatingEditor, marketRatingSummary } from './fc27-market-rating-view.js';
import { mountMarketBiddingEditor, marketPurchaseSummary } from './fc27-market-bidding-view.js';
import { mountMarketPlayerPicker } from './fc27-market-player-picker-view.js';
import {defaultTradingTaskSettings,defaultTradingPublicSettings} from '../../trading/task-model.js';
import {readTaskCatalogPage,taskExclusion} from '../../trading/task-catalog.js';
import {marketTaskMarkup} from './fc27-market-task-markup.js';
import {mountFc27TradingView} from './fc27-trading-view.js';
import {bindCurrencyArrows,currencyInputStyles} from './fc27-listing-currency.js';
import {marketSearchGate,marketOccupancy,marketTaskEvidence} from '../../trading/market-coordination.js';
import {marketTaskReport} from '../../trading/market-task-report.js';
import {marketTaskMessages,marketTaskFailureReason} from '../../trading/market-task-messages.js';
import {marketTaskAutoLists} from '../../trading/market-task-policy.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const saleSummary=t=>t.sellSelection?`自动出售 ${t.sellSelection.ratingMin}–${t.sellSelection.ratingMax} 分 · ${({all:'全部仓库',club:'Club',transfer:'Transfer',unassigned:'Unassigned'})[t.sellSelection.pile]} · 每 5 分钟检查并加入新卡，直到暂停或停止`:'持仓出售';
const modes={fixed:'固定名单',filter:'条件选卡',sell:'持仓出售'},states={ready:'待启动',running:'运行中',queued:'排队中',waiting:'等待中',completed:'已完成',paused:'已暂停',stopped:'已停止',archived:'已归档',review:'待核对'};
const inputOf=t=>({name:t.name,mode:t.mode,settings:structuredClone(t.settings),players:structuredClone(t.players),owned:structuredClone(t.owned),excluded:structuredClone(t.excluded),schedule:t.schedule?structuredClone(t.schedule):null,ratingPrices:t.ratingPrices?structuredClone(t.ratingPrices):null,sellSelection:t.sellSelection?structuredClone(t.sellSelection):null});
const errors={...marketTaskMessages,TASKS_STALE:'任务已在其他窗口修改，请刷新后重新编辑。',TASKS_CONTEXT_CHANGED:'账号已变化，请刷新任务。',TASKS_SAVE_UNVERIFIED:'保存回读未确认，请刷新核对，勿重复添加。',TASKS_INVALID:'请检查价格、评分和数量设置。',TASKS_SELECTION_EMPTY:'请先选择具体版本或持仓卡。',TASKS_STORAGE_LIMIT:'任务记录达到存储容量限制，原记录已保留。',TASKS_UNRESOLVED:'有待核对的交易，不能删除记录。',TASKS_EDIT_BLOCKED:'该任务当前不能编辑，请先暂停并核对交易。',TASKS_EXECUTION_UNAVAILABLE:'自动执行尚未开放。'};

export function mountFc27MarketTasks({document,parent,tab,service,legacyService=null,readCatalog=()=>[],readInventory=()=>[],readCoordination=null,runtime=null,playerPicker=null,backgroundStatus=null}){
 parent.replaceChildren();const element=document.createElement('section');element.className='market-task-manager';parent.append(element);
 const shadow=element.attachShadow({mode:'closed'});shadow.innerHTML=marketTaskMarkup;const $=id=>shadow.getElementById(id);
 const currencyStyle=document.createElement('style');currencyStyle.textContent=currencyInputStyles+' .listing-currency{width:100%;background:#253945;border-color:#48606d} .task-table td:nth-child(4):before{content:none} #market-coordination-status:not([hidden]),#market-runtime-status:not([hidden]),#market-session-status:not([hidden]),#market-search-status:not([hidden]){display:block;margin:6px 0}';shadow.append(currencyStyle);
 const statusField=document.createElement('label');statusField.className='check';statusField.innerHTML='<span>显示交易状态浮条</span><input id="marketStatusVisible" type="checkbox"><small>关闭后不显示；可直接拖动浮条移动位置</small>';
 $('globalSettings').querySelector('.fields')?.append(statusField);
 const scheduleEditor=mountMarketScheduleEditor({document,parent:$('moreRules').parentElement});
 const ratingEditor=mountMarketRatingEditor({document,$,onChange:()=>{readInputs();renderDraft();}});
 const biddingEditor=mountMarketBiddingEditor({document,$,onChange:()=>{readInputs();renderDraft();}});
 const afterBuyLabel=document.createElement('label');afterBuyLabel.innerHTML='<span>After buying</span><select id="afterBuy"><option value="list">Auto list</option><option value="hold">Hold only (Transfer List)</option></select><small id="afterBuyHint">Hold only moves purchased cards to Transfer List without listing or relisting. Existing live listings are not cancelled.</small>';
 $('rating-prices').before(afterBuyLabel);
 $('taskPreview').nextElementSibling.textContent='保存不会买卖；点击启动并确认后执行。';
 $('confirm').querySelector('h2').textContent='确认任务操作';
 const editorStatus=document.createElement('output');editorStatus.setAttribute('role','status');editorStatus.setAttribute('aria-live','polite');$('editor').querySelector('.dialog-body').append(editorStatus);
 const coordinationStatus=document.createElement('output');coordinationStatus.id='market-coordination-status';coordinationStatus.className='hint';coordinationStatus.setAttribute('role','status');coordinationStatus.hidden=true;$('toast').after(coordinationStatus);let coordination=null;
 const runtimeOutput=document.createElement('output');runtimeOutput.id='market-runtime-status';runtimeOutput.className='hint';runtimeOutput.setAttribute('role','status');runtimeOutput.hidden=true;coordinationStatus.after(runtimeOutput);let runtimeStatus=runtime?.inspect(),pendingStart=null,pendingRestart=false;
 const recoveryBar=document.createElement('div');recoveryBar.className='actions';runtimeOutput.after(recoveryBar);
 const sessionOutput=document.createElement('output');sessionOutput.id='market-session-status';sessionOutput.className='hint';sessionOutput.setAttribute('role','status');sessionOutput.hidden=true;runtimeOutput.after(sessionOutput);
 const searchOutput=document.createElement('output');searchOutput.id='market-search-status';searchOutput.className='hint';searchOutput.setAttribute('role','status');searchOutput.hidden=true;sessionOutput.after(searchOutput);
 const recoverButton=document.createElement('button'),releaseButton=document.createElement('button');
 recoverButton.id='market-recover';releaseButton.id='market-release';recoverButton.type=releaseButton.type='button';
 recoverButton.textContent='核对交易回执';releaseButton.textContent='解除全局暂停';recoveryBar.append(recoverButton,releaseButton);let pendingRelease=false;
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
  catch(error){if(ticket===epoch&&active){message(errors[error.message]??marketTaskMessages[marketTaskFailureReason(error)]);if(error.message==='TASKS_CONTEXT_CHANGED'){closeDialogs();snapshot=null;$('tasks').replaceChildren();}}}
  finally{if(ticket===epoch)busy=false;}};
 const refreshRecovery=async()=>{coordination=await readCoordination();check();render(false);};
 const checkReceipts=()=>void run(async()=>{await runtime.recover();await refreshRecovery();message(coordination.ledger.intents.some(i=>['pending','isolated'].includes(i.phase))?(errors[runtime.inspect().reason]??errors.MARKET_RECOVERY_REQUIRED):'Receipt check complete. Unlisted cards remain in holdings. You can now clear the global pause; tasks will not restart automatically.');});
 const recoveryView=mountMarketRecoveryView({document,parent:shadow,
  onRecheck:checkReceipts,onManage:request=>void run(async()=>{
    await runtime.manageRecovery({...request,approved:true});await refreshRecovery();message(errors.MARKET_RECOVERY_ISOLATED);
  })});
 recoveryBar.after(shadow.getElementById('market-recovery-panel'));
 const liveEvidence=t=>runtimeStatus?.context&&JSON.stringify(runtimeStatus.context)===JSON.stringify(snapshot?.context)?runtimeStatus.evidence?.find(e=>e.taskId===t.id):null;
 const factsOf=t=>liveEvidence(t)??(coordination?marketTaskEvidence(coordination.ledger,t.id):{unresolved:false,hasEvidence:false});
 const countsOf=t=>{if(liveEvidence(t))return liveEvidence(t).counts;if(!coordination||!factsOf(t).hasEvidence)return ['bought','listed','sold'].map(kind=>t.activity.receipts.filter(r=>r.kind===kind).length);const entries=coordination.ledger.intents.filter(i=>i.taskId===t.id&&i.phase==='confirmed');return [entries.filter(i=>i.kind==='buy').length+(coordination.ledger.auctions??[]).filter(a=>a.taskId===t.id&&a.state==='won').length,entries.filter(i=>i.kind==='list').length,coordination.ledger.holdings.filter(h=>h.taskId===t.id&&h.phase==='sold').length];};
 const runtimeRow=t=>runtimeStatus?.context&&JSON.stringify(runtimeStatus.context)===JSON.stringify(snapshot?.context)?runtimeStatus.tasks.find(r=>r.id===t.id):null;
 const stateFor=t=>factsOf(t).unresolved?'review':['archived','stopped'].includes(t.state)?t.state:t.stopRequested?'stopped':coordination?.ledger.clocks?.some(c=>c.taskId===t.id&&c.stopped)?'stopped':runtimeRow(t)?.state==='review'&&t.state==='paused'?'paused':runtimeRow(t)?.state??t.state;
 const reasonFor=t=>{const row=runtimeRow(t);if(!row?.reason)return '';const labels={MARKET_SEARCH_WAIT:'公共搜索冷却',MARKET_NATIVE_BUSY:'等待其他操作',MARKET_TASK_WAIT:'等待任务条件',MARKET_TIME_LIMIT:'已到运行时限',MARKET_USER_STOP:'已停止后续操作',TASKS_AUTHORIZATION_CHANGED:'设置已变，请重新启动',MARKET_RESPONSE_UNCONFIRMED:'请核对交易回执',MARKET_RECOVERY_REQUIRED:'先核对未决交易',MARKET_ACTION_EXPIRED_OR_INVALID:'报价或候选已失效',MARKET_AUTHENTICATION:'需要重新登录',MARKET_CAPTCHA:'需要完成验证',MARKET_THROTTLED:'市场限制，已暂停',MARKET_ERROR_LIMIT:'已达到错误次数限制'};return `<small title="${esc(row.reason)}">${labels[row.reason]??marketTaskMessages[row.reason]??'请检查任务条件'}${row.nextAt>Date.now()?` · ${Math.ceil((row.nextAt-Date.now())/1000)} 秒`:''}</small>`;};
 const render=(syncSettings=true)=>{if(!snapshot)return;const tasks=snapshot.store.tasks.filter(t=>$('taskFilter').value==='archived'?t.state==='archived':t.state!=='archived');
  recoveryView.update({coordination,tasks:snapshot.store.tasks,busy:Boolean(runtimeStatus?.busy)});
  recoveryBar.hidden=!runtimeStatus?.available;recoverButton.disabled=releaseButton.disabled=Boolean(runtimeStatus?.busy);
  const traffic=[coordination?.traffic,runtimeStatus?.traffic].filter(Boolean).sort((a,b)=>b.ledger.revision-a.ledger.revision)[0];
  releaseButton.hidden=!(coordination?.ledger.stopped||traffic?.ledger.stopped);
  shadow.querySelector('.content > p.hint').textContent=runtimeStatus?.available?'Start each task explicitly. Tasks continue when this panel is closed; refreshing or closing the Web App ends the run.':'任务管理已接入；自动买卖尚未开放。';
  runtimeOutput.hidden=!runtimeStatus?.available;
  const search=runtimeStatus?.lastSearch;searchOutput.hidden=!search;
  searchOutput.textContent=search?`Last search · EA ${search.definitionId??'?'} · Buy limit ${search.searchCeiling?.toLocaleString()??'?'} · ${!search.sent?'Not sent':!search.confirmed?'Response unconfirmed':`Returned ${search.responseCount??'?'} · Eligible ${search.acceptedCount??'?'}`}`:'';
  const health=runtimeStatus?.sessionHealth;
  sessionOutput.hidden=!health||(!runtimeStatus.busy&&health.lastOnlineAt===null&&health.state!=='failed');
  sessionOutput.textContent=health?`${health.state==='checking'?'Checking EA session':health.state==='failed'?'Session check failed; tasks paused':runtimeStatus.busy?'Session maintenance active (every 3 minutes when idle)':'Session maintenance stopped'}${health.lastOnlineAt!==null?' · Last online '+new Date(health.lastOnlineAt).toLocaleTimeString():''}`:'';
  sessionOutput.title='Enabled only for running or waiting tasks. Recent successful requests postpone checks. Sleep, disconnection or an EA logout may require login and manual resume.';
  if(runtimeStatus?.available){const row=runtimeStatus.tasks.find(r=>r.id===runtimeStatus.taskId),label=snapshot.store.tasks.find(t=>t.id===row?.id)?.name??'';
   const labels={inventory:'\u8bfb\u53d6\u51fa\u552e\u5e93\u5b58',initialize:'核对交易接口',idle:'已停止执行',prepare:'准备候选',preflight:'核对条件',search:'搜索',buy:'买入',bid:'竞价',auctions:'核对竞拍',move:'移卡',list:'挂牌',waiting:'等待下一轮',recover:'只读核对','resume-check':'核对恢复条件','session-check':'Checking EA session','restart-check':'Checking task restart'};
   runtimeOutput.textContent=`${label?label+' · ':''}${labels[runtimeStatus.phase]??'等待'}${row?.nextAt>Date.now()?` · ${Math.ceil((row.nextAt-Date.now())/1000)} 秒`:''}${runtimeStatus.reason?' · '+(marketTaskMessages[runtimeStatus.reason]??runtimeStatus.reason):''}`;}
  if(coordination){const shared=traffic,gate=shared?.gate??marketSearchGate(coordination.ledger,snapshot.store.settings,Date.now()),funds=marketOccupancy(coordination.ledger);coordinationStatus.hidden=false;
   coordinationStatus.textContent=`${shared?'FCAT 共用市场':'当前交易任务'} · 搜索 1h ${gate.hour} / 24h ${gate.day}${gate.uncertain?`（${gate.uncertain} 次发送待确认）`:''} · 持仓 ${funds.count} · 在途 ${funds.reservedCoins} 金币${gate.recoveryRequired?' · 有交易待核对':gate.stopped?' · 执行已暂停':''}${shared&&gate.nextAt>Date.now()?` · 可搜索 ${new Date(gate.nextAt).toLocaleTimeString()}`:''}`;
   coordinationStatus.title=shared?'FCAT Gallery / SBC / 交易已发送的市场搜索；不含其他插件、手动操作或其他设备。持仓与在途金币仍仅为交易任务账本。':'仅本任务系统记录。';}
  else coordinationStatus.hidden=true;
  $('tasks').innerHTML=tasks.map(t=>`<tr><td><button type="button" class="task-name" data-action="detail" data-id="${esc(t.id)}">${esc(t.name)}</button><small>${modes[t.mode]}${t.mode==='sell'?'':` · 买入 ${esc(t.settings.buyValue)}${t.settings.buyRule==='percent'?'%':''}`} · 卖出 ${esc(t.settings.sellValue)}${t.settings.sellRule==='reference'?'%':''}</small>${t.schedule?`<small>${esc(marketScheduleSummary(t))}</small>`:''}</td><td>${states[stateFor(t)]}${reasonFor(t)}${runtimeRow(t)?.schedule?`<small>${runtimeRow(t).schedule.buyClosed?'\u4e70\u5165\u5df2\u7ed3\u675f':'\u4e70\u5165\u672a\u7ed3\u675f'}${runtimeRow(t)?.nextAt>Date.now()?` / ${new Date(runtimeRow(t).nextAt).toLocaleString()}`:''}</small>`:''}</td><td>${countsOf(t).join(' / ')}</td><td><div class="actions"><button type="button" data-action="start" data-id="${esc(t.id)}" ${runtimeStatus?.available&&runtimeStatus.modes.includes(t.mode)&&['ready','paused','stopped'].includes(stateFor(t))?'':'disabled'} title="Start or restart using saved rules; accumulated records are retained">${stateFor(t)==='stopped'?'Restart':'启动'}</button>${stateFor(t)==='review'&&!factsOf(t).unresolved?`<button type="button" data-action="acknowledge" data-id="${esc(t.id)}">确认核对完成</button>`:''}${['ready','paused','stopped'].includes(stateFor(t))?`<button type="button" data-action="edit" data-id="${esc(t.id)}">编辑</button>`:''}<button type="button" data-action="copy" data-id="${esc(t.id)}">复制</button>${['running','queued','waiting'].includes(stateFor(t))?`<button type="button" data-action="pause" data-id="${esc(t.id)}">暂停</button>`:''}${!['stopped','archived'].includes(stateFor(t))?`<button type="button" data-action="stop" data-id="${esc(t.id)}">停止</button>`:''}<button type="button" data-action="delete" data-id="${esc(t.id)}">${(t.activity.receipts.length||factsOf(t).hasEvidence)?'归档':'删除'}</button></div></td></tr>`).join('');$('empty').hidden=tasks.length>0;
  for(const [i,row] of [...$('tasks').children].entries()){
   const task=tasks[i];if(!task)continue;
   row.querySelector('small').textContent=(task.ratingPrices?marketRatingSummary(task):task.mode==='sell'?'持仓出售':marketPurchaseSummary(task))
    +(marketTaskAutoLists(task)?` · 挂牌 ${task.settings.sellValue}${task.settings.sellRule==='reference'?'%':''}`:' · 只买不挂牌');
   if(task.sellSelection)row.querySelector('small').textContent=saleSummary(task)+` · 挂牌 ${task.settings.sellValue}${task.settings.sellRule==='reference'?'%':''}`;
   const auctions=liveEvidence(task)?.auctions??Object.fromEntries(['leading','outbid','won','lost'].map(k=>[k,(coordination?.ledger.auctions??[]).filter(a=>a.taskId===task.id&&a.state===k).length]));
   if(Object.values(auctions).some(Boolean)){const note=document.createElement('small');note.textContent=`竞拍中 ${auctions.leading} · 被超价 ${auctions.outbid} · 赢得 ${auctions.won} · 落标 ${auctions.lost}`;row.children[2].append(note);}
   const rating=runtimeRow(task)?.candidateScope?.currentRating;if(rating){const note=document.createElement('small');note.textContent=`当前评分 ${rating}`;row.children[1].append(note);}
  }
  if(syncSettings)for(const key of Object.keys(defaultTradingPublicSettings()))$(key).value=String(snapshot.store.settings[key]??'');
  if(syncSettings&&backgroundStatus) $('marketStatusVisible').checked=backgroundStatus.isVisible();
  $('settingsBrief').textContent=`${snapshot.store.settings.source.toUpperCase()} · 跟随账号平台 · 搜索 ${snapshot.store.settings.gapMin}–${snapshot.store.settings.gapMax} 秒`;
 };
 const reload=async()=>{if(busy||!active)return;closeDialogs();const ticket=++epoch;busy=true;coordination=null;coordinationStatus.hidden=true;message('读取本地任务…');try{const [result,ledger]=await Promise.all([service.read(),readCoordination?readCoordination():null]);if(ticket!==epoch||!active)return;snapshot=result;check();if(ledger&&JSON.stringify(ledger.context)!==JSON.stringify(snapshot.context))throw Error('TASKS_CONTEXT_CHANGED');coordination=ledger;render();message('任务已加载；保存不会启动交易。');}catch(error){if(ticket===epoch){snapshot=null;coordination=null;coordinationStatus.hidden=true;$('tasks').replaceChildren();message(errors[error.message]??'任务或执行记录读取失败，原数据未清除。');}}finally{if(ticket===epoch)busy=false;}};
 const readInputs=()=>{for(const [key,base]of Object.entries(defaultTradingTaskSettings())){const node=$(key),raw=node.value;draft.settings[key]=node.type==='number'||key==='duration'||['league','nation','club','position'].includes(key)?(raw===''&&base===null?null:Number(raw)):raw;}draft.name=$('taskName').value.trim();draft.schedule=scheduleEditor.read(draft.mode);draft.ratingPrices=ratingEditor.read(draft.mode);draft.sellSelection=draft.mode==='sell'&&stockSource.value==='rating'?{ratingMin:stockMin.value===''?NaN:Number(stockMin.value),ratingMax:stockMax.value===''?NaN:Number(stockMax.value),pile:$('pile').value}:null;};
 const playerTile=c=>`<div class="player"><span class="card">${esc(c.rating??'—')}</span><div><b>${esc(c.name)}</b><small>${esc(c.version||'版本')} · EA ${esc(c.definitionId)}</small></div></div>`;
 const fillSelect=(key,rows)=>{const field={league:'leagueId',nation:'nationId',club:'teamId',position:'preferredPosition'}[key],value=draft.settings[key];
  const labels=new Map();for(const card of rows){const id=card[field];if(Number.isSafeInteger(id)&&id>=0&&!labels.has(id))labels.set(id,card[`${key}Name`]??`ID ${id}`);}if(value!==null&&!labels.has(value))labels.set(value,`ID ${value}`);
  $(key).innerHTML='<option value="">全部</option>'+[...labels.keys()].sort((a,b)=>a-b).map(v=>`<option value="${v}">${esc(labels.get(v))}</option>`).join('');$(key).value=String(value??'');};
 const stockRange=()=>{const min=stockMin.value===''?1:Number(stockMin.value),max=stockMax.value===''?99:Number(stockMax.value);return {min,max,valid:stockMin.validity.valid&&stockMax.validity.valid&&min<=max};};
 const matchingStocks=()=>{const range=stockRange();return range.valid?inventory.filter(r=>($('pile').value==='all'||r.pile===$('pile').value)
   &&(stockMin.value===''&&stockMax.value===''||Number.isSafeInteger(r.rating)&&r.rating>=range.min&&r.rating<=range.max)):[];};
 const loadCatalog=async()=>{if(catalog)return catalog;check();const rows=await readCatalog();check();if(!Array.isArray(rows))throw Error('TASKS_CATALOG_UNAVAILABLE');catalog=rows;for(const key of ['league','nation','club','position'])fillSelect(key,rows);return rows;};
 const renderDraft=()=>{scheduleEditor.refresh(draft.mode,draft.settings.afterBuy);afterBuyLabel.hidden=draft.mode==='sell';afterBuyLabel.classList.toggle('hidden',draft.mode==='sell');for(const b of shadow.querySelectorAll('[data-mode]'))b.classList.toggle('active',b.dataset.mode===draft.mode);for(const mode of ['fixed','filter','sell'])$(`${mode}Box`).classList.toggle('hidden',draft.mode!==mode);$('buyFields').classList.toggle('hidden',draft.mode==='sell');
  $('selectedRows').innerHTML=draft.players.map(p=>`<tr><td>${playerTile(p)}</td><td><input type="number" min="150" max="15000000" placeholder="沿用买入规则" aria-label="${esc(p.name)} 买入上限" data-cap="${p.definitionId}" value="${p.cap??''}"></td><td><input type="number" min="1" placeholder="不限" aria-label="${esc(p.name)} 持仓上限" data-qty="${p.definitionId}" value="${p.qty??''}"></td><td><button type="button" data-remove="${p.definitionId}">移除</button></td></tr>`).join('');
  $('exclusionList').innerHTML=draft.excluded.map((e,i)=>`<button type="button" data-restore="${i}" title="移除排除规则">${esc(e.label)} ×</button>`).join('')||'<small>未排除球员</small>';
  const stocks=matchingStocks();stockPage=Math.min(stockPage,Math.max(0,Math.ceil(stocks.length/5)-1));
  $('sellRows').innerHTML=stocks.slice(stockPage*5,stockPage*5+5).map(r=>`<label class="picker-row check"><input type="checkbox" data-stock="${esc(r.itemId)}" ${draft.owned.some(p=>p.itemId===r.itemId)?'checked':''} ${r.available?'':'disabled'}>${playerTile(r)}<small>${esc(r.pile)} · ${r.available?'缓存引用':'不可选择'}</small></label>`).join('')||'<p class="hint">未读取缓存持仓。点击下方读取；不会刷新EA或执行挂牌。</p>';
  stockPrev.disabled=stockPage===0;stockNext.disabled=(stockPage+1)*5>=stocks.length;stockCount.textContent=`第 ${stockPage+1} 页 · 已选 ${draft.owned.length} 张`;
  const selectable=stocks.filter(r=>r.available===true),selectedIds=new Set(draft.owned.map(r=>r.itemId));
  stockSelect.disabled=!selectable.some(r=>!selectedIds.has(r.itemId));stockClear.disabled=!stocks.some(r=>selectedIds.has(r.itemId));
  stockHint.textContent=!stockRange().valid?'评分范围无效，请填写 1–99 且最低不高于最高。':`匹配 ${stocks.length} 张 · 可选 ${selectable.length} 张 · 其中已选 ${stocks.filter(r=>selectedIds.has(r.itemId)).length} 张。全选跨页生效，仅保存当前具体卡片；新入库卡不会自动加入，执行前仍核对保护条件。`;
  const autoSell=draft.mode==='sell'&&stockSource.value==='rating';
  stockSelect.hidden=stockClear.hidden=autoSell;
  for(const box of $('sellRows').querySelectorAll('input'))if(autoSell)box.disabled=true;
  if(autoSell)stockHint.textContent=`自动出售 ${stockMin.value||'?'}–${stockMax.value||'?'} 分：启动后读取实际库存，每 5 分钟重新扫描并加入新卡，直到暂停或停止。这里仅预览缓存（匹配 ${stocks.length}／可选 ${selectable.length}），无需勾选。锁定、主阵容、已挂牌和其他任务占用的卡不出售。`;
  for(const hint of $('sellBox').querySelectorAll(':scope > p.hint'))if(hint!==stockHint)hint.textContent=autoSell?'执行前逐张核对可交易状态与保护条件；扫描失败不会使用旧缓存继续加入卡片。':'仅选择已读取的具体卡片，执行前重新核对实体与保护条件。';
  if(!stocks.length)$('sellRows').textContent=inventory.length?'当前评分及仓库下没有匹配卡片。':'尚未读取持仓缓存；请点击“读取缓存持仓”。';
  const selected=draft.mode==='sell'?draft.owned.length:draft.mode==='fixed'?draft.players.length:null;
  $('taskPreview').textContent=`${modes[draft.mode]} · ${selected===null?'按条件和统一排除名单运行':`已选 ${selected} ${draft.mode==='sell'?'张实体':'个版本'}`} · 保存后待启动`;
  if(autoSell)$('taskPreview').textContent=`持仓出售 · 自动扫描 ${stockMin.value||'?'}–${stockMax.value||'?'} 分 · 新入库卡持续加入 · 保存后待启动`;
  $('extraFiltersLabel').textContent=`更多筛选${draft.excluded.length?` · 排除 ${draft.excluded.length} 项`:''}`;
  $('buyLabel').textContent=draft.settings.buyRule==='fixed'?'固定买入上限':'买入比例 %';$('sellLabel').textContent=draft.settings.sellRule==='fixed'?'固定挂牌价':'挂牌比例 %';
  for(const [key,rule]of [['buyValue','buyRule'],['sellValue','sellRule']])for(const b of $(key).parentElement.querySelectorAll('button'))b.hidden=draft.settings[rule]!=='fixed';
  for(const input of $('selectedRows').querySelectorAll('[data-cap]'))bindCurrencyArrows({document,input,label:'单卡买入上限',onStep:value=>{input.value=String(value);draft.players.find(p=>p.definitionId===Number(input.dataset.cap)).cap=value;}});
  ratingEditor.refresh(draft);
  biddingEditor.refresh(draft);
 };
 const cancelQuery=()=>{querySerial++;clearTimeout(queryTimer);};
 const renderPool=()=>{$('pool').innerHTML=poolRows.map(c=>`<div class="picker-row">${playerTile(c)}<button type="button" data-exclude="${c.definitionId}" ${taskExclusion(c,draft.excluded)?'disabled':''}>${taskExclusion(c,draft.excluded)?'已排除':'排除此版本'}</button></div>`).join('')||'<p class="hint">当前缓存没有匹配球员，非全市场结果。</p>';
  $('poolPage').textContent=`第 ${page+1} 页${poolMore?' · 还有更多':''}`;$('poolPrev').disabled=page===0;$('poolNext').disabled=!poolMore;$('filterCount').textContent=`已预览 ${page*5+poolRows.length} 个缓存版本 · 非全量目录`;};
 const queryPool=async(reset=false)=>{cancelQuery();if($('poolPreview').classList.contains('hidden'))return;if(reset){page=0;cursors=[0];}const ticket=querySerial;const settings={...draft.settings},query=$('poolSearch').value;poolRows=[];$('pool').textContent='正在查找…';$('poolNext').disabled=$('poolPrev').disabled=true;
  try{const rows=await loadCatalog();if(ticket!==querySerial)return;const result=await readTaskCatalogPage({rows,settings,query,cursor:cursors[page]??0,isCurrent:()=>ticket===querySerial&&active&&sameContext()&&$('editor').open});if(ticket!==querySerial)return;poolRows=result.rows;poolMore=result.more;if(result.more)cursors[page+1]=result.next;renderPool();}catch(error){if(ticket===querySerial){$('pool').textContent=errors[error.message]??'本地目录暂不可用。';}}
 };
 let pickerRows=[];
 const namePicker=playerPicker?mountMarketPlayerPicker({$,picker:playerPicker,esc,playerTile,getDraft:()=>draft,getMode:()=>pickerMode,
  isCurrent:()=>active&&sameContext()&&$('picker').open,onRows:rows=>{pickerRows=rows;},onExclusion:player=>{
   if(!draft.excluded.some(e=>e.type==='player'&&e.id===player.playerId)){draft.excluded=draft.excluded.filter(e=>e.type!=='version'||![...pickerRows,...(catalog??[])].some(c=>c.definitionId===e.id&&c.playerId===player.playerId));draft.excluded.push({type:'player',id:player.playerId,label:`${player.name} · 全部版本`});renderDraft();renderPool();}
  }}):null;
 const queryPicker=async()=>{cancelQuery();const ticket=querySerial,query=$('playerSearch').value.trim();
  if(namePicker){try{namePicker.query(query,()=>ticket===querySerial);}catch(error){pickerRows=[];$('pickerRows').textContent=errors[error.message]??'EA 姓名资料读取失败。';}return;}
  if(!query){$('pickerRows').textContent='输入名字，每次最多显示5个缓存版本。';return;}$('pickerRows').textContent='正在搜索…';
  try{const rows=await loadCatalog();if(ticket!==querySerial)return;const result=await readTaskCatalogPage({rows,query,isCurrent:()=>ticket===querySerial&&active&&sameContext()&&$('picker').open});if(ticket!==querySerial)return;pickerRows=result.rows;
   $('pickerRows').innerHTML=pickerRows.map(c=>`<div class="picker-row">${playerTile(c)}${pickerMode==='fixed'?`<button type="button" data-add="${c.definitionId}" ${draft.players.some(p=>p.definitionId===c.definitionId)?'disabled':''}>添加</button>`:`<button type="button" data-exclude="${c.definitionId}" ${taskExclusion(c,draft.excluded)?'disabled':''}>排除此版本</button>${Number.isSafeInteger(c.playerId)?`<button type="button" data-exclude-player="${c.definitionId}">全部版本</button>`:''}`}</div>`).join('')||'<p class="hint">本地缓存未找到；完整目录将在条件选卡阶段接入。</p>';if(result.more)$('pickerRows').insertAdjacentHTML('beforeend','<small>还有更多，请细化名字。</small>');
  }catch(error){if(ticket===querySerial)$('pickerRows').textContent=errors[error.message]??'本地目录读取失败。';}
 };
 const openPicker=mode=>{namePicker?.reset();pickerMode=mode;$('pickerTitle').textContent=mode==='fixed'?'选择精确版本':'排除球员';$('playerSearch').value='';pickerRows=[];$('picker').showModal();void queryPicker();};
 const openEditor=task=>{check();editingId=task?.id??null;editorSnapshot=structuredClone(snapshot);draft=task?inputOf(task):{name:'',mode:'fixed',settings:defaultTradingTaskSettings(),players:[],owned:[],excluded:[]};catalog=null;inventory=[];cancelQuery();
  ratingEditor.open(draft);scheduleEditor.open(draft.schedule,draft.mode);stockSource.value=draft.sellSelection?'rating':'manual';stockMin.value=draft.sellSelection?.ratingMin??'';stockMax.value=draft.sellSelection?.ratingMax??'';$('taskName').value=draft.name;for(const key of Object.keys(defaultTradingTaskSettings()))$(key).value=String(draft.settings[key]??'');for(const key of ['league','nation','club','position'])fillSelect(key,[]);
  $('editTitle').textContent=task?'编辑交易任务':'新建交易任务';editorStatus.textContent='';$('extraFilters').open=$('moreRules').open=false;$('poolPreview').classList.add('hidden');$('pool').replaceChildren();$('poolSearch').value='';$('filterCount').textContent='展开后读取本地缓存';$('pile').value=draft.sellSelection?.pile??'all';renderDraft();$('editor').showModal();};
 const removeTask=async()=>{runtime?.stop(pendingDelete);const result=await service.action({...snapshot,id:pendingDelete,action:'delete'});$('confirm').close();message('任务已删除或归档，原交易证据保留。');return result;};
 const showDetail=async task=>{
  if(readCoordination){const latest=await readCoordination();check();if(JSON.stringify(latest.context)!==JSON.stringify(snapshot.context))throw Error('TASKS_CONTEXT_CHANGED');coordination=latest;}
  const report=coordination?marketTaskReport(coordination.ledger,task.id):null;
  const money=value=>value===null?'未知':esc(value);
  const elapsedMs=runtimeRow(task)?.elapsedMs??report?.elapsedMs??0;
  const scope=runtimeRow(task)?.candidateScope;
  const receipts=report&&(report.events.length||report.holdings.length)
   ? `<p>已买 ${report.purchased} · 已挂 ${report.listed} · 已售 ${report.sold} · 持仓成本 ${money(report.heldCost)} · 已实现利润 ${money(report.realizedProfit)}</p><p class="hint">仅已售回执计入收益，按 5% 交易税计算；成本缺失时利润保持未知。</p><h3>持仓（最近 40 张 / 共 ${report.holdings.length} 张）</h3>${report.holdings.slice(-40).reverse().map(h=>`<p>EA ${h.definitionId} · ${esc(h.itemId)} · ${({held:'待移卡',transfer:marketTaskAutoLists(task)?'待挂牌':'Held on Transfer List',listed:'已挂牌',unsold:'未售出',sold:'已售出'})[h.phase]} · 买入 ${money(h.cost)}${h.phase==='sold'?` · 售出 ${money(h.salePrice)}`:''}</p>`).join('')}<h3>交易回执（最近 40 条 / 共 ${report.events.length} 条）</h3>${report.events.slice(-40).reverse().map(r=>`<p>${r.previousTradeId?'重挂':({bid:'Bid',buy:'买入',move:'移动',list:'挂牌'})[r.kind]} · EA ${r.definitionId} · ${({isolated:'Isolated: awaiting evidence',resolved:'Resolved: currently unlisted',pending:'待核对',confirmed:'已确认',rejected:'未成交／未发送'})[r.phase]} · ${r.coins}${r.listing?` · ${r.listing.startPrice}/${r.listing.buyNow} · ${r.listing.durationSeconds/3600}h`:''}</p>`).join('')}`
   : `<h3>交易回执</h3>${task.activity.receipts.map(r=>`<p>${({bought:'买入',moved:'移动',listed:'挂牌',sold:'售出'})[r.kind]} · EA ${r.definitionId} · ${r.coins??'金额未知'}</p>`).join('')||'<p>暂无交易</p>'}`;
  $('taskDetailBody').innerHTML=`<h3>${esc(task.name)}</h3><p>${modes[task.mode]} · ${states[stateFor(task)]}</p><p>买入：${task.settings.buyRule==='fixed'?'固定上限':'参考价比例'} ${task.settings.buyValue}${task.settings.buyRule==='percent'?'%':''}</p>${marketTaskAutoLists(task)?`<p>卖出：${task.settings.sellRule==='fixed'?'固定挂牌价':'参考价比例'} ${task.settings.sellValue}${task.settings.sellRule==='reference'?'%':''}</p>`:'<p>After buying: Hold only (Transfer List)</p>'}<p>${task.activity.unresolved||factsOf(task).unresolved?'有待核对交易':'无待核对交易'}</p><h3>已选卡片</h3>${(task.mode==='fixed'?task.players:task.owned).map(p=>`<p>${esc(p.name)} · EA ${p.definitionId}</p>`).join('')||'<p>按条件选卡</p>'}${receipts}`;
  const purchaseParagraph=$('taskDetailBody').querySelectorAll(':scope > p')[1];
  if(task.mode==='sell')purchaseParagraph?.remove();else if(purchaseParagraph)purchaseParagraph.textContent=marketPurchaseSummary(task);
  if(task.ratingPrices){const prices=document.createElement('section');prices.className='box';prices.textContent=marketRatingSummary(task)+'：'+Object.entries(task.ratingPrices).filter(([r])=>Number(r)>=task.settings.ratingMin&&Number(r)<=task.settings.ratingMax).map(([r,p])=>`${r} ${task.settings.buyMode!=='bin'?`竞价≤${p.bid??'未填'} / `:''}${task.settings.buyMode!=='bid'?`一口价≤${p.buy??'未填'}`:''}${marketTaskAutoLists(task)?` / 卖出 ${p.sell??'未填'}`:''}`).join('；');const paragraphs=$('taskDetailBody').querySelectorAll(':scope > p');paragraphs[1]?.remove();if(marketTaskAutoLists(task))paragraphs[2]?.remove();$('taskDetailBody').prepend(prices);}
  const scheduleNote=document.createElement('p');scheduleNote.className='hint';scheduleNote.textContent=marketScheduleSummary(task);$('taskDetailBody').append(scheduleNote);
  if(report?.auctions.length){const box=document.createElement('section');box.className='box';box.textContent='竞拍（最近 40 条）：'+report.auctions.slice(-40).reverse().map(a=>`EA ${a.definitionId} · ${({leading:'竞拍中',outbid:'被超价',won:'已赢得',lost:'已落标'})[a.state]} · 已出价 ${a.coins}`).join('；');$('taskDetailBody').append(box);}
  const extra=document.createElement('section');extra.className='box';
  extra.innerHTML=`<p>累计运行 ${Math.ceil(elapsedMs/1000)} 秒 ${marketTaskAutoLists(task)?`· 重挂：${({original:'原挂牌价',reference:'当前卖出规则重新定价',pause:'暂停此卡'})[task.settings.relist]} · 最多 ${task.settings.relistTimes??'不限'} 次`:'· Hold only; relisting disabled'}</p><p class="hint">暂停和继续不重置用时、支出或重挂次数。异常关闭最多保守计入剩余 60 秒；离线时间不累计。</p>${(report?.handoffs??[]).slice(-40).map(h=>`<p>${h.fromTaskId===task.id?'移交给':'接收自'} ${esc(snapshot.store.tasks.find(t=>t.id===(h.fromTaskId===task.id?h.toTaskId:h.fromTaskId))?.name??'历史任务')} · EA ${h.definitionId} · 成本 ${money(h.cost)}</p>`).join('')}`;
  $('taskDetailBody').append(extra);
  if(task.mode==='filter'){
   const note=document.createElement('p');note.className='hint';note.textContent=scope
    ?`本轮 ${scope.revision} · 已知目录 ${scope.known} 个版本 · 已匹配 ${scope.matched} 个 · 当前批 ${scope.batch} 个 · 缺价 ${scope.missing} 个。仅已知目录，非全市场；每次重新启动更新目录。`
    :'启动后按最新已知目录分批筛选，每批最多 20 个版本；预览每页 5 张。不代表全市场覆盖，缺少所需字段的版本不参与。';extra.append(note);
  }
  if(!marketTaskAutoLists(task)){const note=document.createElement('p');note.textContent='Hold only: purchased cards stay on Transfer List without listing or relisting. To sell, edit this task to Auto list and start it explicitly, or stop and hand off its holdings.';extra.prepend(note);}
  if(runtime&&report&&['stopped','archived'].includes(task.state)&&!factsOf(task).unresolved){
   const holdings=report.holdings.filter(h=>['held','transfer','unsold'].includes(h.phase));
   const targets=snapshot.store.tasks.filter(t=>t.id!==task.id&&t.mode==='sell'&&['ready','paused'].includes(stateFor(t)));
   if(holdings.length){
    const box=document.createElement('section');box.className='box';
    box.innerHTML='<h3>移交剩余持仓</h3><p class="hint">先建立持仓出售任务并选中这些实体，再在这里移交。仅更改任务归属；买入成本和重挂次数保留，接收任务需单独启动。</p><label>接收任务<select id="market-handoff-target"><option value="">请选择</option>'+targets.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')+'</select></label><div id="market-handoff-items"></div><button type="button" id="market-handoff-confirm" disabled>确认移交所选持仓</button><output id="market-handoff-status" role="status"></output>';
    extra.append(box);const target=box.querySelector('select'),items=box.querySelector('#market-handoff-items'),button=box.querySelector('button');
    target.onchange=()=>{const t=targets.find(t=>t.id===target.value);items.innerHTML=holdings.filter(h=>t?.owned.some(p=>p.itemId===h.itemId&&p.definitionId===h.definitionId)).map(h=>`<label class="check"><input type="checkbox" value="${esc(h.itemId)}">EA ${h.definitionId} · ${esc(h.itemId)} · 成本 ${money(h.cost)}</label>`).join('')||'<p>此任务尚未选择可交接的实体。</p>';button.disabled=true;};
    items.onchange=()=>{button.disabled=!items.querySelector('input:checked');};
    button.onclick=event=>{if(!event.isTrusted)return;void run(async()=>{
     const status=box.querySelector('output');button.disabled=true;status.textContent='正在核对所选持仓…';
     try{
      const result=await runtime.handoff({approved:true,snapshot:structuredClone(snapshot),fromTaskId:task.id,toTaskId:target.value,itemIds:[...items.querySelectorAll('input:checked')].map(i=>i.value)});check();
      if(result?.status==='busy')throw Error('MARKET_BUSY');
      coordination=await readCoordination();render(false);await showDetail(task);message('持仓已移交；没有移卡、挂牌或启动接收任务。');
     }catch(error){status.textContent=errors[error.message]??marketTaskMessages[marketTaskFailureReason(error)]??'移交未完成，请核对记录。';button.disabled=false;throw error;}
    });};
   }
  }
  if(!$('taskDetail').open)$('taskDetail').showModal();
 };
 shadow.addEventListener('click',event=>{if(!event.isTrusted||!active)return;const button=event.target.closest('button');if(!button)return;
  if(button.dataset.close){$(button.dataset.close).close();cancelQuery();return;}if(busy)return;
  try{check();if(button.dataset.mode){readInputs();draft.mode=button.dataset.mode;cancelQuery();renderDraft();}
   if(button.dataset.action){const task=snapshot.store.tasks.find(t=>t.id===button.dataset.id);if(!task)return;const action=button.dataset.action;
    if(action==='start'){pendingRelease=false;pendingDelete=null;pendingStart=task.id;pendingRestart=stateFor(task)==='stopped';$('confirm').querySelector('h2').textContent=pendingRestart?'Restart task':'Start task';$('confirmBody').textContent=`启动“${task.name}”：按已保存的${modes[task.mode]}和买卖规则持续执行，直到暂停、停止或触及限制。报价源 ${snapshot.store.settings.source.toUpperCase()}。保存本身不会启动。`;if(task.schedule)$('confirmBody').textContent=marketScheduleSummary(task)+'\n\u542f\u52a8\u540e\u7b49\u5f85\u5bf9\u5e94\u65f6\u6bb5\u6267\u884c\uff1b\u4e0d\u8865\u8dd1\u5df2\u8fc7\u671f\u7684\u4e70\u5165\u7a97\u53e3\u3002\u6bcf\u5929\u91cd\u590d\u4e0d\u91cd\u7f6e\u7d2f\u8ba1\u989d\u5ea6\u3002';if(!marketTaskAutoLists(task))$('confirmBody').textContent+='\nHold only: buy and move to Transfer List, without listing or relisting.';if(task.sellSelection)$('confirmBody').textContent+='\n'+saleSummary(task);if(pendingRestart)$('confirmBody').textContent='Restart this task using its saved rules. Holdings, spending, elapsed time and receipts are retained. Unresolved trades and global pauses must be cleared first.\n'+$('confirmBody').textContent;$('confirm').showModal();}
    else if(action==='acknowledge')void run(async()=>{const result=await service.action({...snapshot,id:task.id,action});runtime?.pause(task.id);return result;});
    else if(action==='edit')openEditor(task);else if(action==='detail')void run(()=>showDetail(task));
    else if(action==='delete'){$('confirm').querySelector('h2').textContent='Delete or archive task';pendingRelease=false;pendingStart=null;pendingDelete=task.id;$('confirmBody').textContent=task.activity.receipts.length||factsOf(task).hasEvidence?'任务有交易记录，将归档并保留完整回执。':'删除这个尚无交易记录的任务？';$('confirm').showModal();}
    else {if(action==='pause')runtime?.pause(task.id);if(action==='stop')runtime?.stop(task.id);void run(()=>service.action({...snapshot,id:task.id,action}));}
   }
   if(button.dataset.add){const c=pickerRows.find(r=>r.definitionId===Number(button.dataset.add));if(c&&!draft.players.some(p=>p.definitionId===c.definitionId)){draft.players.push({definitionId:c.definitionId,name:c.name,rating:c.rating,version:c.version??'',cap:null,qty:null});renderDraft();void queryPicker();}}
   if(button.dataset.remove){draft.players=draft.players.filter(p=>p.definitionId!==Number(button.dataset.remove));renderDraft();}
   if(button.dataset.exclude||button.dataset.excludePlayer){const c=[...pickerRows,...poolRows].find(r=>r.definitionId===Number(button.dataset.exclude??button.dataset.excludePlayer));if(c){const type=button.dataset.excludePlayer?'player':'version',id=type==='player'?c.playerId:c.definitionId;if(!draft.excluded.some(e=>e.type===type&&e.id===id)){if(type==='player')draft.excluded=draft.excluded.filter(e=>e.type!=='version'||!catalog?.some(r=>r.definitionId===e.id&&r.playerId===id));draft.excluded.push({type,id,label:`${c.name} · ${type==='player'?'全部版本':`${c.rating} / EA ${c.definitionId}`}`});}renderDraft();renderPool();if($('picker').open)void queryPicker();}}
   if(button.dataset.restore!==undefined){draft.excluded.splice(Number(button.dataset.restore),1);renderDraft();renderPool();}
  }catch(error){message(errors[error.message]??'操作未完成，请刷新任务。');}
 });
 $('newTask').onclick=event=>{if(event.isTrusted&&!busy&&snapshot&&active){try{openEditor();}catch(error){message(errors[error.message]??'请刷新任务。');}}};$('reloadTasks').onclick=event=>{if(event.isTrusted)void reload();};$('taskFilter').onchange=render;
 $('pauseAll').onclick=event=>{if(event.isTrusted){runtime?.pauseAll();void run(()=>service.action({...snapshot,action:'pause-all'}));}};
 recoverButton.onclick=event=>{if(event.isTrusted)checkReceipts();};
 releaseButton.onclick=event=>{if(!event.isTrusted)return;$('confirm').querySelector('h2').textContent='Clear global pause';pendingRelease=true;pendingStart=null;pendingDelete=null;$('confirmBody').textContent='Recheck the EA session and clear the FCAT pause after pending receipts are resolved or explicitly isolated. Isolated tasks and cards remain protected. This cannot remove an EA market restriction or prove that buying/listing is available. Tasks remain stopped until you start them explicitly.';$('confirm').showModal();};
 $('confirmYes').onclick=event=>{if(!event.isTrusted)return;if(pendingRelease){pendingRelease=false;$('confirm').close();void run(async()=>{await runtime.acknowledgeStop({approved:true});coordination=await readCoordination();render(false);message('全局暂停已解除，任务尚未启动。');});return;}if(pendingStart){const taskId=pendingStart,restarting=pendingRestart;pendingStart=null;pendingRestart=false;$('confirm').close();
   try{check();if(!runtime?.inspect().available)throw Error('TASKS_EXECUTION_UNAVAILABLE');
    const launch=()=>{const options={approved:true,snapshot:structuredClone(snapshot),taskIds:[taskId]};void (runtime.inspect().busy?runtime.enqueue(options):runtime.run(options)).catch(error=>message(errors[error.message]??marketTaskMessages[marketTaskFailureReason(error)]));};
    if(restarting){const ticket=epoch;void run(async()=>{const fresh=await runtime.reopen({approved:true,snapshot:structuredClone(snapshot),taskId});if(ticket!==epoch||!active)return;check();snapshot={context:fresh.context,store:fresh.store};coordination=fresh.coordination;render(false);launch();});}else launch();} catch(error){message(errors[error.message]??'执行未开始。');}
  }else void run(removeTask);};
 $('taskForm').onchange=event=>{if(!draft)return;const t=event.target;
  if(t.dataset.cap||t.dataset.qty){const p=draft.players.find(r=>r.definitionId===Number(t.dataset.cap??t.dataset.qty));p[t.dataset.cap?'cap':'qty']=t.value===''?null:Number(t.value);}
  if(t.dataset.stock){const row=inventory.find(r=>r.itemId===t.dataset.stock);if(row?.available){draft.owned=draft.owned.filter(r=>r.itemId!==row.itemId);if(t.checked)draft.owned.push({itemId:row.itemId,definitionId:row.definitionId,name:row.name,pile:row.pile});}}
  if(t.id==='pile')stockPage=0;if(t.id==='buyRule')$('buyValue').value=t.value==='fixed'?'800':'85';if(t.id==='bidRule')$('bidValue').value=t.value==='fixed'?'800':'85';if(t.id==='sellRule')$('sellValue').value=t.value==='fixed'?'1000':'100';readInputs();renderDraft();
  if(['ratingMin','ratingMax','quality','league','nation','club','position'].includes(t.id))void queryPool(true);
 };
 $('taskForm').onsubmit=event=>{event.preventDefault();if(!event.isTrusted)return;readInputs();void run(async()=>{const result=await service.saveTask({...editorSnapshot,id:editingId,input:draft});$('editor').close();message('任务已保存，尚未启动。');return result;});};
 for(const [key,rule]of [['buyValue','buyRule'],['sellValue','sellRule']])bindCurrencyArrows({document,input:$(key),label:key==='buyValue'?'买入价格':'挂牌价格',enabled:()=>draft?.settings[rule]==='fixed',onStep:value=>{$(key).value=String(value);readInputs();renderDraft();}});
 bindCurrencyArrows({document,input:$('hardCap'),label:'单卡绝对买入上限',onStep:value=>{$('hardCap').value=String(value);readInputs();}});
 $('saveGlobal').onclick=event=>{if(!event.isTrusted)return;runtime?.pauseAll();const settings=Object.fromEntries(Object.keys(defaultTradingPublicSettings()).map(key=>[key,key==='source'?$(key).value:$(key).value===''?null:Number($(key).value)]));void run(async()=>{const result=await service.saveSettings({...snapshot,settings});message('公共设置已保存。');return result;});};
 $('marketStatusVisible').onchange=event=>{if(event.isTrusted)backgroundStatus?.setVisible($('marketStatusVisible').checked);};
 $('addPlayer').onclick=event=>{if(event.isTrusted&&!busy)openPicker('fixed');};$('editExclusions').onclick=event=>{if(event.isTrusted&&!busy)openPicker('exclude');};
 $('previewPool').onclick=event=>{if(!event.isTrusted)return;$('poolPreview').classList.toggle('hidden');void queryPool(true);};
 $('poolSearch').oninput=()=>{cancelQuery();queryTimer=setTimeout(()=>{void queryPool(true)},250);};if(!namePicker?.native)$('playerSearch').oninput=()=>{cancelQuery();queryTimer=setTimeout(()=>{void queryPicker()},250);};
 $('poolPrev').onclick=event=>{if(event.isTrusted&&page>0){page--;void queryPool();}};$('poolNext').onclick=event=>{if(event.isTrusted&&poolMore){page++;void queryPool();}};
 $('extraFilters').addEventListener('toggle',()=>{if($('extraFilters').open&&active)void loadCatalog().catch(()=>{});});
 const stockSourceLabel=document.createElement('label');stockSourceLabel.innerHTML='<span>出售选卡方式</span><select id="stock-source"><option value="manual">手动选择具体卡片</option><option value="rating">按评分自动出售（持续检查）</option></select>';
 $('sellRows').before(stockSourceLabel);const stockSource=$('stock-source');
 stockSource.onchange=event=>{if(!event.isTrusted||!draft)return;if(stockSource.value==='rating'){stockMin.value||='88';stockMax.value||=stockMin.value;}readInputs();renderDraft();};
 const stockFilter=document.createElement('div');stockFilter.className='fields two';
 stockFilter.innerHTML='<label>最低评分<input id="stock-rating-min" type="number" min="1" max="99" step="1" placeholder="不限"></label><label>最高评分<input id="stock-rating-max" type="number" min="1" max="99" step="1" placeholder="不限"></label>';
 $('sellRows').before(stockFilter);const stockMin=$('stock-rating-min'),stockMax=$('stock-rating-max');
 const stockActions=document.createElement('div');stockActions.className='actions wrap';
 const stockButton=document.createElement('button'),stockSelect=document.createElement('button'),stockClear=document.createElement('button'),stockHint=document.createElement('p');
 stockButton.type=stockSelect.type=stockClear.type='button';stockButton.textContent='读取缓存持仓';stockSelect.textContent='全选匹配卡';stockClear.textContent='取消匹配卡';stockSelect.id='stock-select-matching';stockClear.id='stock-clear-matching';stockHint.id='stock-match-hint';stockHint.className='hint';stockHint.setAttribute('aria-live','polite');stockActions.append(stockButton,stockSelect,stockClear);$('sellRows').before(stockActions,stockHint);
 const filterStocks=()=>{stockPage=0;if(draft){readInputs();renderDraft();}};stockMin.oninput=stockMax.oninput=filterStocks;
 stockSelect.onclick=event=>{if(!event.isTrusted||busy||!draft)return;try{check();const selected=new Map(draft.owned.map(r=>[r.itemId,r]));for(const r of matchingStocks())if(r.available===true&&!selected.has(r.itemId))selected.set(r.itemId,{itemId:r.itemId,definitionId:r.definitionId,name:r.name,pile:r.pile});
   if(selected.size>500){message('本任务最多选择 500 张卡，请缩小评分或仓库范围；本次没有改变选择。');return;}draft.owned=[...selected.values()];renderDraft();}catch(error){message(errors[error.message]??'无法更改选择，请刷新任务。');}};
 stockClear.onclick=event=>{if(!event.isTrusted||busy||!draft)return;try{check();const ids=new Set(matchingStocks().map(r=>r.itemId));draft.owned=draft.owned.filter(r=>!ids.has(r.itemId));renderDraft();}catch(error){message(errors[error.message]??'无法更改选择，请刷新任务。');}};
 stockButton.onclick=event=>{if(!event.isTrusted)return;void run(async()=>{inventory=await readInventory();stockPage=0;check();renderDraft();});};
 const stockControls=document.createElement('div');stockControls.className='row between';const stockPrev=document.createElement('button'),stockNext=document.createElement('button'),stockCount=document.createElement('small');stockPrev.type=stockNext.type='button';stockPrev.textContent='上一页持仓';stockNext.textContent='下一页持仓';stockControls.append(stockPrev,stockCount,stockNext);$('sellBox').append(stockControls);
 stockPrev.onclick=event=>{if(event.isTrusted&&stockPage>0){stockPage--;renderDraft();}};stockNext.onclick=event=>{if(event.isTrusted){stockPage++;renderDraft();}};
 for(const dialog of shadow.querySelectorAll('dialog'))dialog.addEventListener('close',cancelQuery);
 legacyDetails.addEventListener('toggle',()=>legacy.setActive(active&&legacyDetails.open));
 runtime?.subscribe(status=>{runtimeStatus=status;if(active&&snapshot)render(false);});
 // Visibility never revokes a page-lifetime trading approval. Explicit pause,
 // settings changes, account guards and page teardown still do.
 return {setActive(value){active=value;epoch++;busy=false;closeDialogs();pendingStart=null;pendingRelease=false;pendingDelete=null;legacy.setActive(value&&legacyDetails.open);tab.textContent='市场交易';if(value)void reload();else{snapshot=null;catalog=null;inventory=[];coordination=null;coordinationStatus.hidden=true;} }};
}
