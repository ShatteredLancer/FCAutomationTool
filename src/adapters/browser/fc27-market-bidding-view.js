import { bindCurrencyArrows } from './fc27-listing-currency.js';
export function marketPurchaseSummary(task){
  const s=task.settings,mode=s.buyMode??'bin',parts=[];
  if(mode!=='bin')parts.push(`竞价≤${s.bidValue}${s.bidRule==='percent'?'%':''}`);
  if(mode!=='bid')parts.push(`一口价≤${s.buyValue}${s.buyRule==='percent'?'%':''}`);
  return parts.join(' · ');
}
export function mountMarketBiddingEditor({document,$,onChange}) {
  const mode=document.createElement('label');
  mode.innerHTML='<span>购买方式</span><select id="buyMode"><option value="bin">一口价</option><option value="bid">竞价</option><option value="both">竞价＋一口价</option></select>';
  $('rating-prices').before(mode);
  const rules=document.createElement('div');rules.className='fields two';
  rules.innerHTML='<label>竞价上限<select id="bidRule"><option value="percent">参考价百分比</option><option value="fixed">固定金币</option></select></label><label><span id="bidLabel">竞价比例 %</span><input id="bidValue" type="number" min="1"></label>';
  $('buyFields').after(rules);
  const more=document.createElement('details');more.className='advanced';
  more.innerHTML='<summary>更多竞价设置</summary><div class="fields three"><label>出价方式<select id="bidExact"><option value="step">EA 下一档价格</option><option value="cap">直接出到上限</option></select></label><label>被超价后<select id="bidRebid"><option value="yes">在上限内追价</option><option value="no">不追价</option></select></label><label>剩余时间不超过（秒）<input id="bidExpires" type="number" min="1" max="604800"></label></div><p class="hint">出价成功只表示竞拍中，赢得后才按购后规则处理。暂停停止新出价；已发出的竞价不能撤销。</p>';
  $('moreRules').before(more);
  bindCurrencyArrows({document,input:$('bidValue'),label:'Bid limit',enabled:()=>$('bidRule').value==='fixed',onStep:value=>{$('bidValue').value=String(value);onChange();}});
  return {refresh(task){
    const bidding=task.mode!=='sell'&&(task.settings.buyMode??'bin')!=='bin';
    mode.hidden=task.mode==='sell';more.hidden=!bidding;rules.hidden=!bidding||Boolean(task.ratingPrices);
    mode.classList.toggle('hidden',mode.hidden);more.classList.toggle('hidden',more.hidden);
    rules.classList.toggle('hidden',rules.hidden);
    if(task.settings.buyMode==='bid')$('buyFields').classList.add('hidden');
    $('bidLabel').textContent=task.settings.bidRule==='fixed'?'固定竞价上限':'竞价比例 %';
    for(const b of $('bidValue').parentElement.querySelectorAll('button'))b.hidden=task.settings.bidRule!=='fixed';
  }};
}
