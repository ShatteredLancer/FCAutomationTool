import {deskFunding,deskFloorPrice,deskText} from './desk-model.js';
import {parsePublicFutbinPrice} from '../fc27/public-price-responses.js';

const id=n=>Number.isSafeInteger(n)&&n>0&&n<=1000000000;
const price=n=>Number.isSafeInteger(n)&&n>=150&&n<=15000000;
export const TRADING_DISCOVERY_RATINGS=Object.freeze([80,82,84]);
const canonical=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const tradingMentionNames=names=>[...new Set((Array.isArray(names)?names:[]).map(n=>deskText(n,60)).filter(n=>canonical(n).length>=4))].slice(0,3);
function candidateFact(row,platform,now){
  if(!id(row?.resource_id)||!id(row.ID)||!Number.isSafeInteger(row.rating)||row.rating<1||row.rating>99)throw Error('DESK_DISCOVERY_RESPONSE_INVALID');
  if(![0,1].includes(row.raretype))return null;
  const quote=parsePublicFutbinPrice({data:[row]},row.resource_id,platform,false);if(!price(quote.price))return null;
  return {definitionId:row.resource_id,futbinId:row.ID,name:deskText(row.playername??row.name??row.common_name??`EA ${row.resource_id}`),rating:row.rating,
    price:quote.price,closingPrice:price(row[platform==='pc'?'pc_LCPClosing':'ps_LCPClosing'])?row[platform==='pc'?'pc_LCPClosing':'ps_LCPClosing']:null,
    referenceScore:Number.isSafeInteger(row.itemScore)&&row.itemScore>0?row.itemScore:null,nationId:row.nation,leagueId:row.league,teamId:row.club,preferredPosition:row.position,
    positions:[row.position,...String(row.alternativePositions??'').split(/[,;\s]+/)].filter(p=>/^[A-Z]{2,3}$/.test(p)).slice(0,6),fetchedAt:now,season:'27',platform};
}

// Three first pages, not a market census. Ordinary gold only; private/raw
// provider responses, images, popularity and EA entities never leave this reader.
export async function readTradingCandidatePool({request,platform,names=[],namesOnly=false,now=()=>Date.now(),check=async()=>{},onProgress=()=>{}}){
  if(!['pc','console'].includes(platform))throw Error('DESK_DISCOVERY_PLATFORM_INVALID');
  const rows=[],seen=new Set();let scanned=0,requests=0;
  for(const rating of namesOnly?[]:TRADING_DISCOVERY_RATINGS){
    await check();onProgress({phase:'candidate-pool',rating,index:requests,total:3});
    const reply=await request(`https://www.futbin.org/futbin/api/27/getFilteredPlayers?platform=${platform==='pc'?'PC':'PS'}&rating=${rating}-${rating}&sort=rating&order=desc&page=1`);
    requests++;await check();let payload;try{payload=typeof reply==='string'?JSON.parse(reply):reply;}catch{throw Error('DESK_DISCOVERY_RESPONSE_INVALID');}
    if(!payload?.data||typeof payload.data!=='object'||payload.errorcode!=null&&String(payload.errorcode)!=='200')throw Error('DESK_DISCOVERY_RESPONSE_INVALID');
    const page=Object.values(payload.data);if(page.length>100)throw Error('DESK_DISCOVERY_RESPONSE_INVALID');scanned+=page.length;
    for(const row of page){
      if(!id(row?.resource_id)||!id(row.ID)||row.rating!==rating||seen.has(row.resource_id))throw Error('DESK_DISCOVERY_RESPONSE_INVALID');
      seen.add(row.resource_id);const fact=candidateFact(row,platform,now());if(fact)rows.push(fact);
    }
  }
  const unresolvedNames=[];
  for(const name of tradingMentionNames(names)){
    await check();onProgress({phase:'named-candidate',name});
    const reply=await request(`https://www.futbin.org/futbin/api/27/getFilteredPlayers?platform=${platform==='pc'?'PC':'PS'}&name=${encodeURIComponent(name)}&sort=rating&order=desc&page=1`);
    requests++;await check();let payload;try{payload=typeof reply==='string'?JSON.parse(reply):reply;}catch{throw Error('DESK_DISCOVERY_RESPONSE_INVALID');}
    if(!payload?.data||typeof payload.data!=='object'||payload.errorcode!=null&&String(payload.errorcode)!=='200')throw Error('DESK_DISCOVERY_RESPONSE_INVALID');
    const page=Object.values(payload.data);if(page.length>100)throw Error('DESK_DISCOVERY_RESPONSE_INVALID');scanned+=page.length;
    const matches=page.filter(row=>canonical(row.playername??row.name??row.common_name).includes(canonical(name)));
    const exact=matches.filter(row=>canonical(row.playername??row.name??row.common_name)===canonical(name));
    const unique=exact.length?exact:matches;
    if(new Set(unique.map(row=>canonical(row.playername??row.name??row.common_name))).size!==1){unresolvedNames.push(name);continue;}
    for(const row of unique){const fact=candidateFact(row,platform,now());if(!fact)continue;
      if(!seen.has(fact.definitionId)){seen.add(fact.definitionId);rows.push({...fact,mentionQuery:name});}
      else{const existing=rows.find(card=>card.definitionId===fact.definitionId);if(existing)existing.mentionQuery=name;}}
  }
  return {rows,scanned,requests,unresolvedNames,ratings:[...TRADING_DISCOVERY_RATINGS],at:now(),platform};
}
export function tradingPreselection(pool,state,now){
  const available=deskFunding(state).available,limit=Math.min(state.settings.unitLimit,available);
  const valid=pool.rows.filter(row=>row.season==='27'&&row.platform===pool.platform&&id(row.definitionId)&&price(row.price)
    &&row.fetchedAt<=now&&now-row.fetchedAt<=300000);
  const affordable=valid.filter(row=>row.price<=limit),lanes=new Map();
  // Keep more than one rating lane before cross-checking, rather than always
  // returning six variants of whichever grade happens to have the highest price.
  for(const row of affordable){const lane=lanes.get(row.rating)??[];lane.push(row);lanes.set(row.rating,lane);}
  for(const lane of lanes.values())lane.sort((a,b)=>evoClues(b,state,now).length-evoClues(a,state,now).length
    ||Math.abs(a.closingPrice?a.price/a.closingPrice-1:0)-Math.abs(b.closingPrice?b.price/b.closingPrice-1:0)
    ||b.price-a.price||a.definitionId-b.definitionId);
  const selected=[];for(let turn=0;turn<4;turn++)for(const lane of lanes.values())if(lane[turn])selected.push(lane[turn]);
  return {rows:selected.slice(0,12),affordable:affordable.length,available,limit};
}
export function evoClues(row,state,now){
  const mentions=event=>event.players?.some(p=>canonical(p.name)===canonical(row.name)||canonical(p.name)===canonical(row.mentionQuery));
  return state.events.filter(event=>event.status!=='failed'&&event.at<=now&&now-event.at<=86400000
    &&(mentions(event)
      ||event.evo&&row.rating<=event.evo.maxRating&&(!event.evo.positions.length||event.evo.positions.some(p=>(row.positions??[row.preferredPosition]).includes(p)))))
    .slice(-3).map(event=>({url:event.url,status:event.status,note:event.note,at:event.at,
      reason:mentions(event)
        ?event.evidence==='native-thread-author-reply'?'原生线程与作者会话已检索，作者回复提及同名球员；具体版本、完整条件仍待核验，不是 EVO 合格证明'
          :'搜索原帖/作者回复提及同名球员；卡片版本、完整条件及回复关联待核验，不是 EVO 合格证明'
        :'仅评分/位置初筛；速度、体型、PlayStyles 等完整条件及最终强度未核验，不是 EVO 合格证明'}));
}
export function rankTradingSuggestions(pool,state,references,now){
  const pre=tradingPreselection(pool,state,now),candidates=[],avoid=[];
  for(const row of pre.rows){
    const gg=references?.[row.definitionId]?.quotes?.futgg;
    const ggValid=gg?.source==='futgg'&&gg.definitionId===row.definitionId&&gg.season==='27'&&gg.platform===pool.platform&&!gg.error&&price(gg.price)
      &&gg.fetchedAt<=now&&gg.expiresAt>now&&(gg.sourceUpdatedAt==null||gg.sourceUpdatedAt<=now&&now-gg.sourceUpdatedAt<=1800000);
    const movement=row.closingPrice?(row.price/row.closingPrice-1)*100:null;
    if(movement!==null&&(movement < -8 || movement>15)){avoid.push({...row,reason:`较 FUTBIN 收盘参考变化 ${movement.toFixed(1)}%，暂不追涨/接急跌`});continue;}
    if(ggValid&&Math.max(row.price,gg.price)/Math.min(row.price,gg.price)>1.15){avoid.push({...row,reason:'双源参考价偏离超过 15%，先核实数据'});continue;}
    const sale=Math.min(row.price,ggValid?gg.price:Infinity,row.closingPrice??Infinity);
    const ceiling=deskFloorPrice(Math.min(Math.floor(sale*.95)-state.settings.minProfit-state.settings.buffer,state.settings.unitLimit,pre.available));
    if(ceiling<150){avoid.push({...row,reason:'扣税、目标利润和缓冲后，买入空间不足'});continue;}
    const sourceCount=ggValid?2:1;
    candidates.push({...row,status:'observe',sourceCount,ggPrice:ggValid?gg.price:null,
      ggQuote:ggValid?{source:'futgg',definitionId:gg.definitionId,season:gg.season,platform:gg.platform,price:gg.price,fetchedAt:gg.fetchedAt,
        expiresAt:gg.expiresAt,sourceUpdatedAt:gg.sourceUpdatedAt??null}:null,
      resaleEstimate:sale,buyCeiling:ceiling,evo:evoClues(row,state,now),
      netAtCeiling:Math.floor(sale*.95)-ceiling,requiredDiscount:(1-ceiling/row.price)*100,
      costPer1000:row.referenceScore?Math.round(row.price*1000/row.referenceScore):null,
      reason:deskText([sourceCount===2?'同平台双源参考价接近':'仅有 FUTBIN，FUT.GG 待核价',movement===null?'收盘参考缺失，走势待观察':`较收盘参考 ${movement.toFixed(1)}%（窗口未知）`,
        `普通卡，本轮单卡上限 ${pre.limit} 内`,`只有买价不高于 ${ceiling} 才考虑核价；不是按当前价买入`].join('；'),400)});
  }
  candidates.sort((a,b)=>b.sourceCount-a.sourceCount||Number(b.evo.length>0)-Number(a.evo.length>0)
    ||a.requiredDiscount-b.requiredDiscount||(a.costPer1000??Infinity)-(b.costPer1000??Infinity)||a.definitionId-b.definitionId);
  const suggestions=[],counts=new Map();let allocated=0;
  for(const row of candidates){if((counts.get(row.rating)??0)>=2||allocated+row.buyCeiling>pre.available)continue;
    suggestions.push(row);allocated+=row.buyCeiling;counts.set(row.rating,(counts.get(row.rating)??0)+1);if(suggestions.length===6)break;}
  return {suggestions,avoid:avoid.slice(0,6),scanned:pool.scanned??pool.rows.length,affordable:pre.affordable,crossChecked:pre.rows.length,
    ratings:pool.ratings,at:pool.at,platform:pool.platform,defaultBudget:!state.configured,available:pre.available,limit:pre.limit,allocated,
    unresolvedNames:pool.unresolvedNames??[],verifiedOffers:0,claims:'reference-screening-not-market-offers'};
}
