import {build} from 'esbuild';
import path from 'node:path';

// One explicit diagnostic after observing an actual defid 401. Reuses the
// reviewed native renewal; reads the same public player once, never trades.
export async function inspectMarketPlayerRenewal(page,{renew=true}={}){
 const bundle=await build({stdin:{resolveDir:path.resolve(import.meta.dirname,'../..'),contents:`
 export {renewFc27MarketSession} from './src/adapters/ea/fc27-market-session-renewal.js';
 export {createFc27MarketReadTransport} from './src/adapters/ea/fc27-market-read.js';
 export {readFc27Context} from './src/adapters/ea/fc27-local-read.js';
 export {FC27_TRADITIONAL_WEB_LOCK} from './src/fc27/traditional-lock.js';
 `},bundle:true,write:false,format:'iife',globalName:'PlayerSessionCheck'});
 return page.evaluate(`(async()=>{${bundle.outputFiles[0].text}
  const failed=performance.getEntriesByType('resource').filter(r=>{try{return new URL(r.name).pathname.endsWith('/defid');}catch{return false;}}).at(-1);
  const renew=${renew===true};
  if(renew&&failed?.responseStatus!==401)return {status:'not-applicable',requests:0};
  const scope=JSON.stringify(PlayerSessionCheck.readFc27Context(globalThis)),stages=[];
  const check=()=>{if(scope!==JSON.stringify(PlayerSessionCheck.readFc27Context(globalThis)))throw Error('INSPECTION_CONTEXT_CHANGED');};
  return navigator.locks.request(PlayerSessionCheck.FC27_TRADITIONAL_WEB_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
   if(!lock)return {status:'busy',requests:0};let reads=0;
   try{
    if(renew)await PlayerSessionCheck.renewFc27MarketSession(globalThis,{beforeDispatch:check,onPhase:r=>stages.push({at:Date.now(),...r})});check();
    const reader=await PlayerSessionCheck.createFc27MarketReadTransport(globalThis,{maxRequests:1});check();reads++;
    const result=await reader.readPlayerVersions({playerId:220901,start:0,count:20});check();
    return {status:renew?'renewed':'read-success',stages,reads,versions:result.entries.map(r=>({definitionId:r.definitionId,rating:r.rating})),taskStarts:0,eaMutations:0};
   }catch(error){return {status:'blocked',stages,reads,reason:/^(FC27|MARKET|INSPECTION)_[A-Z0-9_]+$/.test(error.message)?error.message:'UNVERIFIED',httpStatus:error.marketFailure?.httpStatus??null,taskStarts:0,eaMutations:0};}
  });
 })()`);
}
