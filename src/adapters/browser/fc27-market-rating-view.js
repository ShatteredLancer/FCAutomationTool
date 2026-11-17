import { bindCurrencyArrows } from './fc27-listing-currency.js';
import { completeMarketRatingRow } from '../../trading/market-rating-prices.js';
import { marketTaskAutoLists } from '../../trading/market-task-policy.js';

export function marketRatingSummary(task) {
 const rows=Object.entries(task.ratingPrices??{}).filter(([rating,row])=>Number(rating)>=task.settings.ratingMin&&Number(rating)<=task.settings.ratingMax&&completeMarketRatingRow(row,task));
 return `按评分固定价 · 已配置 ${rows.length} 档`;
}

// Draft-only controls. Values outside the current range survive editing but
// remain excluded by the execution filter. No transaction methods live here.
export function mountMarketRatingEditor({document,$,onChange}) {
 const host=document.createElement('section');host.className='box';host.id='rating-prices';
 host.innerHTML='<label>定价方式<select id="rating-price-mode"><option value="reference">每卡参考价百分比</option><option value="rating">按评分固定价</option><option value="uniform">统一固定价</option><option value="mixed">分别设置买卖规则</option></select></label><div id="rating-price-body"><p id="rating-price-summary" class="hint" role="status"></p><div class="rating-grid"><b>评分</b><b>买入上限</b><b>挂牌价</b></div><div id="rating-price-rows"></div><button type="button" id="rating-price-expand"></button><p id="rating-price-warning" class="hint"></p><div id="rating-price-duration" class="fields"></div></div>';
 $('buyFields').before(host);
 const style=document.createElement('style');style.textContent='.rating-grid{display:grid;grid-template-columns:38px repeat(var(--price-columns,2),minmax(0,1fr));gap:6px;align-items:center;margin:8px 0}.rating-grid>small{grid-column:1/-1}.rating-grid input{width:100%;min-width:0}.rating-grid .listing-currency input{padding:6px 2px}.rating-grid b{font-size:11px}#rating-prices[hidden],#rating-price-body[hidden]{display:none}';host.append(style);
 const get=id=>host.querySelector('#'+id),select=get('rating-price-mode'),body=get('rating-price-body'),rowsHost=get('rating-price-rows');
 const sellFields=$('sellRule').closest('.fields'),duration=$('duration').closest('label'),anchor=document.createComment('duration');duration.before(anchor);
 let mode='reference',rows={},expanded=false,current=null,renderKey=null;
 const header=body.querySelector('.rating-grid');
 const readRows=()=>{for(const input of rowsHost.querySelectorAll('input[data-side]')){const key=input.dataset.rating;rows[key]??={buy:null,sell:null};rows[key][input.dataset.side]=input.value===''?null:Number(input.value);}};
 const derived=task=>task.ratingPrices?'rating':task.settings.buyRule==='fixed'&&task.settings.sellRule==='fixed'?'uniform':task.settings.buyRule==='percent'&&task.settings.sellRule==='reference'?'reference':'mixed';
 const refresh=task=>{
  const hold=!marketTaskAutoLists(task);
  current=task;host.hidden=task.mode!=='filter';const active=task.mode==='filter'&&mode==='rating';body.hidden=!active;
  $('buyFields').classList.toggle('hidden',task.mode==='sell'||active);sellFields.classList.toggle('hidden',active||hold);
  duration.hidden=hold;duration.classList.toggle('hidden',hold);
  for(const key of ['relist','relistTimes']){const label=$(key).closest('label');label.hidden=hold;label.classList.toggle('hidden',hold);}
  host.classList.toggle('hold-only',hold);
  if(active)get('rating-price-duration').append(duration);else anchor.after(duration);
  if(task.mode==='filter'&&mode!=='rating')mode=derived(task);select.value=mode;
  if(!active)return;
  const min=Math.max(1,Math.min(99,task.settings.ratingMin)),max=Math.min(99,task.settings.ratingMax),ratings=Array.from({length:Math.max(0,max-min+1)},(_,i)=>min+i);
  const count=ratings.filter(r=>completeMarketRatingRow(rows[r],task)).length;
  get('rating-price-summary').textContent=`已配置 ${count} / ${ratings.length} 档 · 空白或未填完整的档位跳过${count?'':'；至少填完整一档才能保存'}`;
  get('rating-price-warning').textContent=task.settings.quality==='all'||task.settings.quality==='special'?'包含特殊卡：同评分的特殊卡也使用本行价格，请确认筛选范围。':hold?'Only a buy limit is required. Purchased cards will not be listed.':'买卖独立定价；不会由买入成本反推卖价。';
  const expand=get('rating-price-expand');expand.hidden=ratings.length<=5;expand.textContent=expanded?'收起其余评分':`展开其余 ${Math.max(0,ratings.length-5)} 档`;
  const purchase=task.settings.buyMode??'bin',sides=[...(purchase==='bin'?['buy']:purchase==='bid'?['bid']:['bid','buy']),...hold?[]:['sell']];
  const labels={bid:'竞价上限',buy:'一口价上限',sell:'挂牌价'};
  host.style.setProperty('--price-columns',String(sides.length));
  header.replaceChildren();for(const text of ['评分',...sides.map(s=>labels[s])]){const b=document.createElement('b');b.textContent=text;header.append(b);}
  const nextKey=JSON.stringify([min,max,expanded,hold,purchase]);if(nextKey===renderKey)return;renderKey=nextKey;
  rowsHost.replaceChildren();
  for(const r of ratings.slice(0,expanded?99:5)){
   const row=document.createElement('div');row.className='rating-grid';const label=document.createElement('b');label.textContent=String(r);row.append(label);
   for(const side of sides){const input=document.createElement('input');input.type='number';input.min='150';input.max='15000000';input.placeholder='未配置';input.value=rows[r]?.[side]??'';input.dataset.rating=String(r);input.dataset.side=side;input.setAttribute('aria-label',`${r} ${side==='buy'?'买入上限':side==='bid'?'Bid limit':'挂牌价'}`);row.append(input);
    bindCurrencyArrows({document,input,label:input.getAttribute('aria-label'),onStep:value=>{input.value=String(value);readRows();onChange();}});
   }rowsHost.append(row);
  }
 };
 select.onchange=()=>{readRows();mode=select.value;
  if(mode==='reference'||mode==='uniform'){
   const fixed=mode==='uniform';for(const [rule,value,next,fallback] of [['buyRule','buyValue',fixed?'fixed':'percent',fixed?'800':'85'],['bidRule','bidValue',fixed?'fixed':'percent',fixed?'800':'85'],['sellRule','sellValue',fixed?'fixed':'reference',fixed?'1000':'100']]){
    if($(rule).value!==next)$(value).value=fallback;$(rule).value=next;
   }
  }onChange();
 };
 get('rating-price-expand').onclick=event=>{if(event.isTrusted){readRows();expanded=!expanded;refresh(current);}};
 return {open(task){rows=structuredClone(task.ratingPrices??{});mode=derived(task);expanded=false;renderKey=null;rowsHost.replaceChildren();},refresh,
  read(taskMode){readRows();return taskMode==='filter'&&mode==='rating'?structuredClone(rows):null;}};
}
