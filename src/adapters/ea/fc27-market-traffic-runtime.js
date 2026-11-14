import { fc27MarketTraffic, runFc27MarketRequest } from './fc27-market-traffic.js';
export function observeFc27TrafficResult(value){
 if(value?.then)return Promise.resolve(value);
 if(!value?.observe)return Promise.resolve(value);
 return new Promise((resolve,reject)=>{
  const owner={};let done=false;
  const finish=(error,reply)=>{if(done)return;done=true;clearTimeout(timer);try{value.unobserve?.(owner);}catch{}if(error)reject(error);else resolve(reply);};
  const timer=setTimeout(()=>finish(Error('MARKET_RESPONSE_UNCONFIRMED')),18000);
  try{value.observe(owner,(_sender,reply)=>finish(null,reply));}catch(e){finish(e);}
 });
}
export function fc27TrafficRuntime(runtime,{requestRoot=runtime,check=()=>{}}={}){
 // Absence is intentional in isolated fixtures/FC26. Production registers once.
 if(!fc27MarketTraffic(requestRoot))return runtime;
 const wrap=(target,overrides)=>new Proxy(target,{get(o,k){if(Object.hasOwn(overrides,k))return overrides[k];const v=Reflect.get(o,k,o);return typeof v==='function'?v.bind(o):v;}});
 const item=runtime.services.Item,methods={};
 for(const [name,kind] of Object.entries({bid:'buy',move:'move',list:'list',relistExpiredAuctions:'relist'}))if(typeof item[name]==='function'){
  methods[name]=(...args)=>{
   const deadline=Date.now()+10000;
   const current=async()=>{if(Date.now()>=deadline)throw Error('FC27_MARKET_TRAFFIC_WAIT');await check(kind,args);};
   return runFc27MarketRequest(requestRoot,kind,current,mark=>{mark();return observeFc27TrafficResult(item[name](...args));},{exactDispatch:true});
  };
 }
 for(const name of ['requestTransferItems','requestUnassignedItems'])if(typeof item[name]==='function')methods[name]=async(...args)=>{
  const reply=await observeFc27TrafficResult(item[name](...args));await fc27MarketTraffic(requestRoot).observe(reply);return reply;
 };
 return wrap(runtime,{services:wrap(runtime.services,{Item:wrap(item,methods)})});
}
