// Read-only decision support. No auctions, permits or EA entities enter here.
export const DESK_LIMITS=Object.freeze({watch:20,points:120,records:100,events:30,alerts:40,bytes:750000});
export const DESK_DEFAULTS=Object.freeze({startingCoins:40000,capitalLimit:10000,reserveCoins:30000,unitLimit:2000,minProfit:150,buffer:100});
export const deskSources=['futbin','futgg'];
const int=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export const deskId=v=>int(v,1,1000000000);
export const deskText=(v,max=100)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);
export function deskSettings(value={}){
  const settings=Object.fromEntries(Object.keys(DESK_DEFAULTS).map(key=>[key,value[key]??DESK_DEFAULTS[key]]));
  if(Object.values(settings).some(v=>!int(v,0,100000000))||settings.capitalLimit<150||settings.unitLimit<150
      ||settings.reserveCoins>settings.startingCoins)throw Error('DESK_SETTINGS_INVALID');
  return settings;
}
export const deskNet=sale=>Math.floor(sale*95/100);
export function deskFunding(state){
  let cash=state.settings.startingCoins,occupied=0,realized=0;
  for(const row of state.records){cash-=row.buy;if(row.sell===null)occupied+=row.buy;
    else{cash+=deskNet(row.sell);realized+=deskNet(row.sell)-row.buy;}}
  return {cash,occupied,realized,available:Math.max(0,Math.min(state.settings.capitalLimit-occupied,cash-state.settings.reserveCoins))};
}
export function emptyDesk(){return {schema:1,configured:false,settings:{...DESK_DEFAULTS},watch:[],records:[],events:[],alerts:[]};}
export function readDesk(value){
  if(value==null)return emptyDesk();
  if(JSON.stringify(value).length>DESK_LIMITS.bytes)throw Error('DESK_STORAGE_LIMIT');
  if(value.schema!==1||typeof value.configured!=='boolean'||!Array.isArray(value.watch)||value.watch.length>DESK_LIMITS.watch
    ||!Array.isArray(value.records)||value.records.length>DESK_LIMITS.records||!Array.isArray(value.events)||value.events.length>DESK_LIMITS.events
    ||!Array.isArray(value.alerts)||value.alerts.length>DESK_LIMITS.alerts)throw Error('DESK_STORAGE_INVALID');
  const state=structuredClone(value);state.settings=deskSettings(state.settings);
  const validPoint=p=>int(p?.at)&&int(p?.price,150,15000000)&&int(p?.fetchedAt)&&p.at<=p.fetchedAt
    &&int(p?.expiresAt)&&p.expiresAt>p.fetchedAt&&p.expiresAt-p.fetchedAt<=1800000;
  if(new Set(state.watch.map(r=>r.definitionId)).size!==state.watch.length)throw Error('DESK_STORAGE_INVALID');
  for(const row of state.watch){
    if(!deskId(row.definitionId)||typeof row.name!=='string'||row.name.length>100||!row.series||!row.latest)throw Error('DESK_STORAGE_INVALID');
    for(const source of deskSources)if(!Array.isArray(row.series[source])||row.series[source].length>DESK_LIMITS.points
      ||row.series[source].some(p=>!validPoint(p)))throw Error('DESK_STORAGE_INVALID');
    for(const source of deskSources)if(row.latest[source]&&row.latest[source].error!=='unavailable'&&!validPoint(row.latest[source]))throw Error('DESK_STORAGE_INVALID');
    if(!int(row.ask)||!int(row.sell)||!int(row.checkedAt))throw Error('DESK_STORAGE_INVALID');
  }
  if(new Set(state.records.map(r=>r.id)).size!==state.records.length||state.records.some(r=>typeof r.id!=='string'||r.id.length>100
    ||!deskId(r.definitionId)||!int(r.buy,150,15000000)||r.sell!==null&&!int(r.sell,150,15000000)||!int(r.at)
    ||typeof r.name!=='string'||r.name.length>100))throw Error('DESK_STORAGE_INVALID');
  for(const event of state.events)if(!validDeskEvent(event))throw Error('DESK_STORAGE_INVALID');
  if(state.alerts.some(a=>typeof a.key!=='string'||a.key.length>150||!deskId(a.definitionId)||!int(a.at)||typeof a.read!=='boolean'))throw Error('DESK_STORAGE_INVALID');
  return state;
}
export function validDeskEvent(row){
  try{const url=new URL(row.url);return ['https:'].includes(url.protocol)&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)
    &&/^\/[A-Za-z0-9_]{1,30}\/status\/\d+$/.test(url.pathname)&&!url.username&&!url.password&&!url.search&&!url.hash
    &&['leak','confirmed','live','failed'].includes(row.status)&&typeof row.note==='string'&&row.note.length<=300&&int(row.at);}
  catch{return false;}
}
export function observeDeskQuote(card,source,quote,platform,now){
  if(!deskSources.includes(source))throw Error('DESK_SOURCE_INVALID');
  const market=source==='futbin'?(quote?.futbinPlatform==='pc'?'pc':quote?.futbinPlatform==='ps'?'console':quote?.platform):quote?.platform;
  if(quote?.definitionId!==card.definitionId||quote?.season!=='27'||quote?.platform!==platform||market!==platform
    ||quote.error||!int(quote.price,150,15000000)||!int(quote.fetchedAt)||quote.fetchedAt>now
    ||!int(quote.expiresAt)||quote.expiresAt<=now||quote.sourceUpdatedAt!=null&&(!int(quote.sourceUpdatedAt)||quote.sourceUpdatedAt>now)){
    card.latest[source]={error:'unavailable',at:now};return;
  }
  const point={at:quote.sourceUpdatedAt??quote.fetchedAt,price:quote.price,fetchedAt:quote.fetchedAt,expiresAt:quote.expiresAt,sourceTimed:quote.sourceUpdatedAt!=null};
  card.latest[source]=point;
  if(card.series[source].some(p=>p.at===point.at&&p.price===point.price)||point.at<now-7*86400000)return;
  const buckets=new Map();
  for(const p of [...card.series[source],point].filter(p=>p.at>=now-7*86400000).sort((a,b)=>a.at-b.at)){
    const interval=now-p.at<=86400000?900000:21600000;buckets.set(`${interval}:${Math.floor(p.at/interval)}`,p);
  }
  card.series[source]=[...buckets.values()].sort((a,b)=>a.at-b.at).slice(-DESK_LIMITS.points);
}
export function deskTrend(points,now,windowMs){
  const rows=points.filter(p=>p.at<=now&&p.at>=now-windowMs).sort((a,b)=>a.at-b.at);
  if(rows.length<2||rows.at(-1).at-rows[0].at<windowMs*.8)return null;
  return (rows.at(-1).price/rows[0].price-1)*100;
}
// Display-only conservative standard coin steps; final native limits/steps
// remain the user's responsibility. This value is never an execution permit.
const floorPrice=value=>{const step=value<1000?50:value<10000?100:value<50000?250:value<100000?500:value<1000000?1000:10000;return Math.floor(value/step)*step;};
export function deskOpportunity(state,card,now){
  const quotes=deskSources.map(source=>card.latest[source]).filter(q=>q&&!q.error&&q.fetchedAt<=now&&q.at<=now&&q.expiresAt>now&&now-q.at<=1800000);
  const available=deskFunding(state).available;
  const report={status:'watch',reason:'等待双源有效报价',cap:null,profit:null,sale:null,available};
  if(!state.configured)return {...report,reason:'请先核对并保存资金设置，默认余额不是 EA 实时余额'};
  if(quotes.length!==2)return report;
  const low=Math.min(...quotes.map(q=>q.price)),high=Math.max(...quotes.map(q=>q.price));
  if(high/low>1.15)return {...report,reason:'双源价差较大，待核实'};
  if(deskSources.some(source=>(deskTrend(card.series[source],now,3600000)??0)<-8))return {...report,reason:'近期跌幅较大，继续观察'};
  if(!card.ask||!card.sell||now-card.checkedAt>300000)return {...report,reason:'请录入当前原生市场买价与保守卖价'};
  const sale=Math.min(card.sell,low),cap=floorPrice(Math.min(deskNet(sale)-state.settings.minProfit-state.settings.buffer,state.settings.unitLimit,available));
  const profit=deskNet(sale)-card.ask;
  if(cap<150||card.ask>cap)return {...report,cap:Math.max(0,cap),profit,sale,reason:available<card.ask?'试仓额度或保留金币不足':'价差未覆盖目标利润与缓冲'};
  return {...report,status:'opportunity',reason:'值得到原生市场再次核价；并非已成交',cap,profit,sale};
}
export function deskAlerts(state,now){
  const fresh=[];
  for(const card of state.watch){const value=deskOpportunity(state,card,now);if(value.status!=='opportunity')continue;
    const key=[card.definitionId,card.ask,value.sale,value.cap].join(':');
    if(state.alerts.some(a=>a.key===key&&now-a.at<1800000))continue;
    const alert={key,definitionId:card.definitionId,at:now,read:false};state.alerts.push(alert);fresh.push(alert);
  }
  state.alerts=state.alerts.slice(-DESK_LIMITS.alerts);return fresh;
}
