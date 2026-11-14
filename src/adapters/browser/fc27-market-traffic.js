import { emptyMarketCoordination, readMarketCoordination, marketSearchGate, reserveMarketSearch, settleMarketSearch, MARKET_COORDINATION_BYTES } from '../../trading/market-coordination.js';
import { tradingTaskContext, tradingPublicSettings } from '../../trading/task-model.js';
import { marketCoordinationKey } from './fc27-market-coordinator.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(reason,at=null)=>{throw Object.assign(Error(`MARKET_TRAFFIC_${reason}`),{retryAt:at});};
const stopOf=value=>{
 const codes=[value?.status,value?.code,value?.httpStatus,value?.error?.code,value?.response?.status,value?.response?.code].map(Number);
 return codes.includes(401)?'authentication':codes.some(c=>[403,426,427,429,459,512,521].includes(c))?'throttle':value?.category==='captcha'?'captcha':null;
};
const kinds=['search','buy','move','list','relist'];
const validate=value=>{try{return readMarketCoordination(value);}catch(error){fail(error.message==='MARKET_STORAGE_LIMIT'?'STORAGE_LIMIT':'INVALID');}};
export function createFc27MarketTraffic({context,get,set,locks,readSettings,now=()=>Date.now(),random=Math.random,
 sleep=ms=>new Promise(r=>setTimeout(r,ms)),id=()=>globalThis.crypto.randomUUID()}){
 const capture=()=>tradingTaskContext(context());
 const current=c=>{if(!same(c,capture()))fail('CONTEXT_CHANGED');};
 const key=c=>marketCoordinationKey(c)+':traffic';
 const read=async c=>{
  current(c);let value=await get(key(c),null);current(c);
  if(value===null){
   // Seed the prior task-only window once, without deleting its transaction ledger.
   const old=await get(marketCoordinationKey(c),null);current(c);
   if(old!==null&&(!same(old.context,c)||!old.ledger))fail('INVALID');
   const prior=validate(old?.ledger),ledger=emptyMarketCoordination();
   Object.assign(ledger,{searches:prior.searches,nextSearchAt:prior.nextSearchAt,cycleCount:prior.cycleCount,cycleTarget:prior.cycleTarget,stopped:prior.stopped});
   value={context:c,ledger,writes:{buy:0,move:0,list:0,relist:0},nextWriteAt:0};
  }
  if(!same(value.context,c)||Object.keys(value).some(k=>!['context','ledger','writes','nextWriteAt'].includes(k))
    ||!Number.isSafeInteger(value.nextWriteAt)||value.nextWriteAt<0||!value.writes
    ||Object.keys(value.writes).length!==4||['buy','move','list','relist'].some(k=>!Number.isSafeInteger(value.writes[k])||value.writes[k]<0))fail('INVALID');
  const ledger=validate(value.ledger);
  if(ledger.intents.length||ledger.holdings.length)fail('INVALID');
  return {...value,ledger};
 };
 const save=async(c,v)=>{current(c);v.ledger.revision++;validate(v.ledger);
  if(new globalThis.TextEncoder().encode(JSON.stringify(v)).length>MARKET_COORDINATION_BYTES)fail('STORAGE_LIMIT');
  await set(key(c),v);current(c);if(!same(await get(key(c),null),v))fail('SAVE_UNVERIFIED');current(c);};
 const locked=(c,fn)=>{if(!locks?.request)fail('LOCK_UNAVAILABLE');return locks.request(key(c)+':lock',{mode:'exclusive'},async()=>{current(c);return fn();});};
 const inspect=async()=>{const c=capture();return locked(c,async()=>{
  const missing=await get(key(c),null)===null,value=await read(c);
  // Commit migration before a task reserves its next local search. Otherwise
  // that new reservation would be imported and counted again at native send.
  if(missing)await save(c,value);
  const settings=tradingPublicSettings(await readSettings());current(c);return {...value,gate:marketSearchGate(value.ledger,settings,now())};
 });};
 return Object.freeze({inspect,
  async signal(reason){if(!['authentication','captcha','throttle','manual'].includes(reason))fail('INVALID');const c=capture();return locked(c,async()=>{const v=await read(c);v.ledger.stopped=reason;await save(c,v);});},
  async observe(result){const reason=stopOf(result);if(reason)await this.signal(reason);return result;},
  async run(kind,check,operation,{wait=true,exactDispatch=false}={}){
   if(!kinds.includes(kind)||typeof check!=='function'||typeof operation!=='function')fail('INVALID');
   const c=capture();let waitingSince=now(),dispatched=false;
   try {
   for(;;){
    current(c);await check();current(c);
    const attempt=await locked(c,async()=>{
     const value=await read(c),settings=tradingPublicSettings(await readSettings());current(c);await check();current(c);
     if(value.ledger.stopped)fail('STOPPED');
     const gate=marketSearchGate(value.ledger,settings,now()),nextAt=kind==='search'?gate.nextAt:value.nextWriteAt;
     if(nextAt>now())return {waiting:true,at:nextAt};
     const requestId=id();
     if(kind==='search')reserveMarketSearch(value.ledger,{requestId,now:now(),settings,random});
     else {value.writes[kind]++;value.nextWriteAt=now()+3000;}
     await save(c,value);let sent=false,result,error;
     try{await check();current(c);if(!exactDispatch)dispatched=sent=true;result=await operation(()=>{if(sent)fail('DUPLICATE_DISPATCH');current(c);dispatched=sent=true;});}
     catch(e){error=e;}
     // A context switch never writes the new account. The old dispatch marker
     // remains conservative if acknowledgement cannot be safely persisted.
     current(c);
     if(kind==='search')settleMarketSearch(value.ledger,requestId,sent?'sent':'not-sent');
     else if(!sent)value.writes[kind]--;
     const stopped=stopOf(result)??stopOf(error);
     if(stopped)value.ledger.stopped=stopped;
     await save(c,value);
     if(error)throw error;
     return {waiting:false,result};
    });
    if(!attempt.waiting)return attempt.result;
    // Task searches wait outside the native turn. Legacy batch owners may wait
    // for ordinary short spacing, but never hold their transaction for an hour.
    if(!wait||attempt.at-now()>30000||now()-waitingSince>=30000)fail('WAIT',attempt.at);
    await sleep(Math.min(1000,Math.max(1,attempt.at-now())));
   }
   }catch(error){if(error instanceof Error)error.notSent=!dispatched;throw error;}
  },
  async clear(){const c=capture();return locked(c,async()=>{const v=await read(c);v.ledger.stopped=null;await save(c,v);return v;});},
 });
}
