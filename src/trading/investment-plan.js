import {deskFloorPrice,deskNet,deskText} from './desk-model.js';

const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const eventKeys=['sourceUrl','sourceAt','entryCeiling','strictBelow','entryQuote','exitMode','reviewAt','targetBasis','status','evidence'];
const validEvent=(event,createdAt)=>event&&typeof event==='object'&&!Array.isArray(event)
  &&Object.keys(event).every(key=>eventKeys.includes(key))
  &&typeof event.sourceUrl==='string'&&/^https:\/\/x\.com\/[A-Za-z0-9_]{1,30}\/status\/[1-9]\d{14,21}$/.test(event.sourceUrl)
  &&integer(event.sourceAt,0,createdAt)&&integer(event.entryCeiling,150,15000000)&&typeof event.strictBelow==='boolean'
  &&typeof event.entryQuote==='string'&&event.entryQuote.trim().length>0&&event.entryQuote.length<=180&&!/[\u0000-\u001f]/.test(event.entryQuote)
  &&['target-hold','immediate-target'].includes(event.exitMode)&&integer(event.reviewAt,createdAt+1,createdAt+86400000)
  &&['source','required-return'].includes(event.targetBasis)&&event.status==='leak'&&event.evidence==='native-thread-post';
const sourceCap=event=>deskFloorPrice(event.entryCeiling-(event.strictBelow?1:0));
const validStrategy=row=>row.strategy==null?row.event==null:row.strategy==='spread'?row.event==null:row.strategy==='evo-event';
export function createInvestmentPlan({advice,context,capitalLimit=20000,reserveCoins=0,existingCapital=0,unitLimit=2000,minProfit=150,buffer=100,now=Date.now(),id}){
  if(!advice||!Array.isArray(advice.suggestions)||!context?.scope||!id||!integer(capitalLimit,150,100000000)
    ||!integer(reserveCoins,0,100000000)||!integer(existingCapital,0,100000000)||!integer(unitLimit,150,15000000)||!integer(minProfit,0,100000000)||!integer(buffer,0,100000000)
    ||!integer(advice.validUntil,now+1,now+300000)||advice.platform!==context.platform)throw Error('DESK_PLAN_INVALID');
  let allocated=0;const rows=[],seen=new Set();
  for(const row of advice.suggestions.slice(0,6)){
    if(!integer(row.definitionId,1,1000000000)||seen.has(row.definitionId)||row.sourceCount!==2||!row.ggQuote||row.ggQuote.expiresAt<=now)continue;
    if(!validStrategy(row))continue;
    const isEvent=row.strategy==='evo-event',event=isEvent?{...row.event,exitMode:row.event?.exitMode??'target-hold',reviewAt:row.event?.reviewAt??now+21600000}:null;
    if(isEvent&&(!validEvent(event,now)||!integer(row.buyCeiling,150,15000000)||!integer(row.resaleEstimate,150,15000000)
      ||row.ggQuote.source!=='futgg'||row.ggQuote.definitionId!==row.definitionId||row.ggQuote.season!=='27'||row.ggQuote.platform!==context.platform
      ||row.ggQuote.error||!integer(row.ggQuote.price,150,15000000)||!integer(row.ggQuote.fetchedAt,Math.max(0,now-300000),now)
      ||!integer(row.ggQuote.expiresAt,now+1,Number.MAX_SAFE_INTEGER)
      ||row.ggQuote.sourceUpdatedAt!=null&&!integer(row.ggQuote.sourceUpdatedAt,Math.max(0,now-1800000),now)))continue;
    const sellPrice=deskFloorPrice(row.resaleEstimate),buyCap=deskFloorPrice(Math.min(row.buyCeiling,unitLimit,isEvent?sourceCap(event):Infinity));
    if(!integer(buyCap,150,15000000)||!integer(sellPrice,150,15000000)||deskNet(sellPrice)-buyCap<minProfit+buffer||allocated+buyCap+existingCapital>capitalLimit)continue;
    seen.add(row.definitionId);allocated+=buyCap;
    rows.push({definitionId:row.definitionId,name:deskText(row.name),rating:row.rating,quantity:1,buyCap,sellPrice,
      ...(row.strategy?{strategy:row.strategy}:{}),...(isEvent?{event:structuredClone(event)}:{}),
      expectedNet:deskNet(sellPrice)-buyCap,reason:deskText(isEvent?`Scenario target, not a forecast; ${row.reason??''}`:row.reason,400),futbinId:row.futbinId,
      nationId:row.nationId,leagueId:row.leagueId,teamId:row.teamId,preferredPosition:row.preferredPosition});
  }
  if(!rows.length)throw Error('DESK_PLAN_NO_CANDIDATES');
  return {schema:1,id,context:structuredClone(context),createdAt:now,expiresAt:Math.min(advice.validUntil,...advice.suggestions.filter(r=>seen.has(r.definitionId)).map(r=>r.ggQuote.expiresAt)),
    capitalLimit,reserveCoins,existingCapital,unitLimit,minProfit,buffer,allocated,expectedNet:rows.reduce((v,r)=>v+r.expectedNet,0),durationSeconds:3600,rows};
}
export function validateInvestmentPlan(plan,context){
  if(plan?.schema!==1||typeof plan.id!=='string'||plan.id.length>100||JSON.stringify(plan.context)!==JSON.stringify(context)
    ||!integer(plan.createdAt,0,Number.MAX_SAFE_INTEGER)||!integer(plan.expiresAt,plan.createdAt+1,plan.createdAt+300000)
    ||!integer(plan.capitalLimit,150,100000000)||!integer(plan.reserveCoins,0,100000000)||!integer(plan.existingCapital,0,100000000)||!integer(plan.unitLimit,150,15000000)
    ||!integer(plan.minProfit,0,100000000)||!integer(plan.buffer,0,100000000)||plan.durationSeconds!==3600
    ||!Array.isArray(plan.rows)||!plan.rows.length||plan.rows.length>6||new Set(plan.rows.map(r=>r.definitionId)).size!==plan.rows.length)throw Error('DESK_PLAN_INVALID');
  let allocated=0,net=0;
  for(const row of plan.rows){if(!integer(row.definitionId,1,1000000000)||row.quantity!==1||typeof row.name!=='string'||row.name.length>100
    ||!validStrategy(row)||row.strategy==='evo-event'&&(!validEvent(row.event,plan.createdAt)||row.buyCap>sourceCap(row.event))
    ||!integer(row.buyCap,150,plan.unitLimit)||!integer(row.sellPrice,150,15000000)||row.buyCap!==deskFloorPrice(row.buyCap)||row.sellPrice!==deskFloorPrice(row.sellPrice)
    ||row.expectedNet!==deskNet(row.sellPrice)-row.buyCap||row.expectedNet<plan.minProfit+plan.buffer)throw Error('DESK_PLAN_INVALID');allocated+=row.buyCap;net+=row.expectedNet;}
  if(allocated!==plan.allocated||allocated+plan.existingCapital>plan.capitalLimit||net!==plan.expectedNet)throw Error('DESK_PLAN_INVALID');
  return structuredClone(plan);
}
