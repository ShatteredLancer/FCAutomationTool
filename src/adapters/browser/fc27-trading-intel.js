import {normalizeTradingIntel} from '../../trading/intel.js';
export function createFc27TradingIntel({gmRequest,get,set,now=()=>Date.now()}){
  const keyName='fcat-trading-intel-pairing-v1';
  return Object.freeze({
    async pair(value){if(!/^[a-f0-9]{48}$/.test(String(value).trim()))throw Error('DESK_INTEL_PAIRING_REQUIRED');await set(keyName,String(value).trim());},
    async refresh(){const key=await get(keyName,'');if(!/^[a-f0-9]{48}$/.test(key))throw Error('DESK_INTEL_PAIRING_REQUIRED');
      return new Promise((resolve,reject)=>{const url='http://127.0.0.1:17864/v1/refresh';
        gmRequest({method:'POST',url,timeout:185000,headers:{'X-FCAT-Intel-Key':key,'Content-Type':'application/json'},data:'{}',
          onload:response=>{try{if(response.finalUrl&&response.finalUrl!==url)throw Error('DESK_INTEL_REDIRECT');
            const value=JSON.parse(response.responseText);if(response.status!==200)throw Error(value.error??'DESK_INTEL_UNAVAILABLE');
            if(value.schema!==1||!Array.isArray(value.posts)||value.posts.length>30||JSON.stringify(value).length>100000
              ||!Number.isSafeInteger(value.fetchedAt)||value.fetchedAt>now()||now()-value.fetchedAt>86400000)throw Error('DESK_INTEL_RESPONSE_INVALID');
            const safe=normalizeTradingIntel({schema:1,posts:value.posts.map(p=>({...p,publishedAt:new Date(p.at).toISOString(),conditions:p.evo}))},now(),value.nativeEvidence??null);
            resolve({...safe,fetchedAt:value.fetchedAt,cached:value.cached===true,costUsd:Number.isFinite(value.costUsd)&&value.costUsd>=0?value.costUsd:null});
          }catch(error){reject(error);}},onerror:()=>reject(Error('DESK_INTEL_COLLECTOR_UNAVAILABLE')),ontimeout:()=>reject(Error('DESK_INTEL_TIMEOUT'))});});
    },
  });
}
