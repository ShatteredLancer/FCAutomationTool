import {writeFile} from 'node:fs/promises';
import path from 'node:path';

// Public method source only. Never serialize authentication instances/tokens.
export async function inspectMarketSessionSources(page,directory){
 const result=await page.evaluate(()=>{
  const names=Object.getOwnPropertyNames(globalThis).filter(k=>/Session|Authentication|Activity|Heartbeat|KeepAlive|Idle|Ping|UTAppMain|UTUtasRequestQueue/.test(k));
  const types=[];
  for(const name of names){const value=Object.getOwnPropertyDescriptor(globalThis,name)?.value;if(typeof value!=='function')continue;
   const methods=Object.getOwnPropertyNames(value.prototype??{}).filter(k=>typeof Object.getOwnPropertyDescriptor(value.prototype,k)?.value==='function');
   types.push({name,methods});
  }
  const activity=[];
  for(const name of Object.getOwnPropertyNames(globalThis).filter(k=>/^(UT|FC|EA)/.test(k))){const value=Object.getOwnPropertyDescriptor(globalThis,name)?.value;if(typeof value!=='function')continue;
   const methods=Object.getOwnPropertyNames(value.prototype??{}).filter(k=>/ping|keep|idle|expir|activity|timeout|session|token/i.test(k)&&typeof Object.getOwnPropertyDescriptor(value.prototype,k)?.value==='function');
   if(methods.length)activity.push({name,methods});
  }
  const app=typeof globalThis.getAppMain==='function'?globalThis.getAppMain():null;
  const appMethods=[];let proto=app;
  for(let i=0;proto&&i<3;i++,proto=Object.getPrototypeOf(proto))appMethods.push(Object.getOwnPropertyNames(proto).filter(k=>typeof Object.getOwnPropertyDescriptor(proto,k)?.value==='function'));
  const extraNames=Object.getOwnPropertyNames(globalThis).filter(k=>/AppMain|Inactiv|Timeout|Utas|Timer|Heart|UserDAO|UserService/.test(k));
  const sources=[];
  const base=String(globalThis.UTHttpRequest),fallback=globalThis[base.match(/=([a-zA-Z0-9_]+)/)?.[1]];
  const decode=raw=>{const aliases=new Map([...raw.matchAll(/(_0x[\da-f]+)=([a-zA-Z0-9_]+)/g)].map(m=>[m[1],m[2]]));return raw.replace(/(_0x[\da-f]+|a0_0x[\da-f]+)\((0x[\da-f]+)\)/g,(call,n,v)=>{let d=globalThis[aliases.get(n)??n]??fallback;try{return typeof d==='function'?JSON.stringify(d(Number(v))):call;}catch{return call;}});};
  for(const name of ['FCAuthenticationService','FCSessionEntity','UTUtasRequestQueueService','UTUserDAO','UTUserService',
   'UTHttpRequest','EAHttpRequest','EADPIdentityManager','EADPIdentityManagerWeb']){
   const type=globalThis[name];if(typeof type!=='function')continue;
   for(const key of Object.getOwnPropertyNames(type.prototype)){const fn=Object.getOwnPropertyDescriptor(type.prototype,key)?.value;if(typeof fn!=='function')continue;
    const source=String(fn);if(source.length<18000)sources.push({name:name+'.prototype.'+key,source,decoded:decode(source)});
   }
  }
  return {types,activity,appMethods,extraNames,sources,utasEnvironment:globalThis.AuthEnvironment?.UTAS};
 });
 await writeFile(path.join(directory,'market-session-public-sources.json'),JSON.stringify(result,null,2));return result;
}
