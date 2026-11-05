import {normalizeTradingIntel} from '../../trading/intel.js';

const pairingKey=value=>{
  const key=String(value??'').trim().replace(/^["']([a-fA-F0-9]{48})["']$/,'$1').toLowerCase();
  if(!/^[a-f0-9]{48}$/.test(key))throw Error('DESK_INTEL_PAIRING_REQUIRED');return key;
};
export function createFc27TradingIntel({gmRequest,get,set,now=()=>Date.now()}){
  const keyName='fcat-trading-intel-pairing-v1';
  const readKey=async()=>{try{return await get(keyName,'');}catch{throw Error('DESK_INTEL_STORAGE_READ_FAILED');}};
  const request=(route,key,timeout)=>new Promise((resolve,reject)=>{
    const url=`http://127.0.0.1:17864/v1/${route}`;
    try{gmRequest({method:'POST',url,timeout,headers:{'X-FCAT-Intel-Key':key,'Content-Type':'application/json'},data:'{}',
      onload:response=>{try{if(response.finalUrl&&response.finalUrl!==url)throw Error('DESK_INTEL_REDIRECT');
        if(typeof response.responseText!=='string'||response.responseText.length>100000)throw Error('DESK_INTEL_RESPONSE_INVALID');
        const value=JSON.parse(response.responseText);
        if(response.status===401)throw Error('DESK_INTEL_PAIRING_REJECTED');
        if(response.status===404&&route==='status')throw Error('DESK_INTEL_STATUS_UNSUPPORTED');
        if(response.status!==200)throw Error(/^DESK_INTEL_[A-Z_]+$/.test(value?.error??'')?value.error:'DESK_INTEL_UNAVAILABLE');resolve(value);
      }catch(error){reject(error.message?.startsWith('DESK_INTEL_')?error:Error('DESK_INTEL_RESPONSE_INVALID'));}},
      onerror:()=>reject(Error('DESK_INTEL_COLLECTOR_UNAVAILABLE')),ontimeout:()=>reject(Error(route==='status'?'DESK_INTEL_STATUS_TIMEOUT':'DESK_INTEL_TIMEOUT'))});
    }catch{reject(Error('DESK_INTEL_COLLECTOR_UNAVAILABLE'));}
  });
  const checkKey=async key=>{const value=await request('status',key,4000);
    if(value?.schema!==1||value.service!=='fcat-trading-intel'||value.status!=='ready'||typeof value.collecting!=='boolean')throw Error('DESK_INTEL_RESPONSE_INVALID');
    return {configured:true,connected:true,connection:'connected',collecting:value.collecting};
  };
  return Object.freeze({
    async config(){let configured=false;try{pairingKey(await readKey());configured=true;}catch(error){if(error.message==='DESK_INTEL_STORAGE_READ_FAILED')throw error;}
      return {configured};},
    async check(){return checkKey(pairingKey(await readKey()));},
    async pair(value){const key=pairingKey(value);let connection;
      try{connection=await checkKey(key);}catch(error){
        if(!['DESK_INTEL_COLLECTOR_UNAVAILABLE','DESK_INTEL_STATUS_TIMEOUT','DESK_INTEL_STATUS_UNSUPPORTED'].includes(error.message))throw error;
        connection={connected:false,connection:error.message==='DESK_INTEL_STATUS_UNSUPPORTED'?'legacy':'unreachable'};
      }
      try{await set(keyName,key);}catch{throw Error('DESK_INTEL_SAVE_FAILED');}
      if(await readKey()!==key)throw Error('DESK_INTEL_SAVE_UNVERIFIED');
      return {configured:true,saved:true,...connection};
    },
    async refresh(){const value=await request('refresh',pairingKey(await readKey()),185000);
      if(value.schema!==1||!Array.isArray(value.posts)||value.posts.length>30
        ||!Number.isSafeInteger(value.fetchedAt)||value.fetchedAt>now()||now()-value.fetchedAt>86400000)throw Error('DESK_INTEL_RESPONSE_INVALID');
      const safe=normalizeTradingIntel({schema:1,posts:value.posts.map(p=>({...p,publishedAt:new Date(p.at).toISOString(),conditions:p.evo}))},now(),value.nativeEvidence??null);
      return {...safe,fetchedAt:value.fetchedAt,cached:value.cached===true,costUsd:Number.isFinite(value.costUsd)&&value.costUsd>=0?value.costUsd:null};
    },
  });
}
