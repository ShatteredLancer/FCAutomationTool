import { createFc27MarketReadTransport } from './fc27-market-read.js';
import { normalizeTaskCatalogCard } from '../../trading/market-task-catalog.js';

// EA's own name engine handles prefixes/diacritics and sorts by rating.
// Name results are identities, never permission to buy a guessed version.
export function createFc27MarketPlayerPicker({root,context,createTransport=createFc27MarketReadTransport,now=()=>Date.now()}) {
 let scope=null,data=null,engine=null,busy=false;
 const known=new Map(),pages=new Map(),fail=code=>{throw Error(`MARKET_PLAYER_${code}`);};
 const check=()=>{const next=JSON.stringify(context());if(scope!==next){scope=next;data=null;engine=null;known.clear();pages.clear();}return next;};
 const current=(captured,isCurrent)=>{if(!isCurrent()||check()!==captured)throw Error('TASKS_CONTEXT_CHANGED');};
 const identity=row=>{
  if(!row||!Number.isSafeInteger(row.id)||row.id<=0||row.id>0xffffff||!Number.isSafeInteger(row.rating)||row.rating<1||row.rating>99)return null;
  const parts=key=>typeof row[key]==='string'?row[key].trim().slice(0,100):'';
  const name=parts('commonName')||[parts('firstName'),parts('lastName')].filter(Boolean).join(' ');
  return name?{playerId:row.id,name,rating:row.rating}:null;
 };
 const source=()=>{
  const next=root.repositories?.Item?.getStaticData?.();
  if(!Array.isArray(next)||!next.length||next.length>100000||root.ItemIdMask?.DATABASE!==0xffffff||typeof root.UTPlayerSearchEngine!=='function')fail('DATA_UNAVAILABLE');
  if(data!==next){data=next;engine=new root.UTPlayerSearchEngine(next);}
 };
 return Object.freeze({
  search(query){check();if(typeof query!=='string'||query.trim().length<2)return [];if(query.length>100)fail('QUERY_INVALID');source();
   const rows=engine.getEntriesForString(query.trim(),5);if(!Array.isArray(rows)||rows.length>5)fail('DATA_UNAVAILABLE');
   return rows.map(identity).filter(Boolean);
  },
  known(){check();return [...known.values()];},
  async versions(playerId,{start=0,isCurrent=()=>true}={}){
   const captured=check();current(captured,isCurrent);source();
   const player=identity(data.find(row=>row.id===playerId));if(!player||!Number.isSafeInteger(start)||start<0||start>80||start%20!==0)fail('QUERY_INVALID');
   const key=`${playerId}:${start}`,cached=pages.get(key);
   if(cached&&now()-cached.at<300000)return structuredClone(cached.result);
   if(busy)fail('BUSY');busy=true;
   try{
    const transport=await createTransport(root,{maxRequests:1});current(captured,isCurrent);
    const result=await transport.readPlayerVersions({playerId,start,count:20});current(captured,isCurrent);
    if(!Array.isArray(result.entries)||result.entries.length>20||typeof result.pageEndObserved!=='boolean')fail('VERSIONS_INVALID');
    if(result.entries.some(row=>!Number.isSafeInteger(row.definitionId)||(row.definitionId&0xffffff)!==playerId))fail('VERSIONS_INVALID');
    const rows=result.entries.filter(row=>row.evolution===false&&row.cosmetic===false).map(row=>normalizeTaskCatalogCard({...row,playerId,name:player.name,preferredPosition:row.positions?.[0],version:`EA ${row.rarity??'?'}`})).filter(Boolean);
    for(const row of rows){known.delete(row.definitionId);known.set(row.definitionId,row);}while(known.size>2000)known.delete(known.keys().next().value);
    const value={rows,more:!result.pageEndObserved&&start<80,next:start+20,capped:!result.pageEndObserved&&start===80};
    pages.delete(key);pages.set(key,{at:now(),result:value});while(pages.size>30)pages.delete(pages.keys().next().value);
    return structuredClone(value);
   }finally{busy=false;}
  },
 });
}
