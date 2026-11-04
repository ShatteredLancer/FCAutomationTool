import {DESK_LIMITS,deskId,deskText,deskSettings,emptyDesk,readDesk,observeDeskQuote,deskAlerts,validDeskEvent} from '../../trading/desk-model.js';

export const tradingDeskKey=scope=>`fcat-fc27-trading-desk-v1:${scope}`;
// A separate local notebook. No Gallery ownership, transaction journal or EA
// write service is available to this module. All prices are reference data.
export function createFc27TradingDesk({prices,get,set,locks,readCandidates=()=>[],now=()=>Date.now(),id=()=>globalThis.crypto.randomUUID()}){
  const rememberComplete=rows=>prices.remember(rows.filter(row=>Number.isSafeInteger(row.rating)&&row.rating>=1&&row.rating<=99
    &&[row.nationId,row.leagueId,row.teamId].every(v=>Number.isSafeInteger(v)&&v>0)&&row.preferredPosition!=null));
  const capture=()=>{const context=prices.context();if(!context.scope||!['pc','console'].includes(context.platform))throw Error('DESK_CONTEXT_INVALID');return context;};
  const current=context=>JSON.stringify(context)===JSON.stringify(capture());
  const read=async()=>{const context=capture(),state=readDesk(await get(tradingDeskKey(context.scope),null));
    if(!current(context))throw Error('DESK_CONTEXT_CHANGED');return {context,state};};
  const update=async(context,mutate)=>{
    if(!locks?.request)throw Error('DESK_STORAGE_LOCK_UNAVAILABLE');
    return locks.request(tradingDeskKey(context.scope),{mode:'exclusive'},async()=>{
      if(!current(context))throw Error('DESK_CONTEXT_CHANGED');
      const key=tradingDeskKey(context.scope),state=readDesk(await get(key,null));
      if(!current(context))throw Error('DESK_CONTEXT_CHANGED');
      mutate(state);readDesk(state);
      const serialized=JSON.stringify(state);
      if(new globalThis.TextEncoder().encode(serialized).length>DESK_LIMITS.bytes)throw Error('DESK_STORAGE_LIMIT');
      if(!current(context))throw Error('DESK_CONTEXT_CHANGED');
      await set(key,state);
      if(JSON.stringify(await get(key,null))!==serialized)throw Error('DESK_SAVE_UNVERIFIED');
      if(!current(context))throw Error('DESK_CONTEXT_CHANGED');return {context,state};
    });
  };
  const act=async mutate=>{const context=capture();return update(context,mutate);};
  return Object.freeze({read,context:capture,
    candidates(){const context=capture();const rows=[...prices.knownPlayers(),...readCandidates()];
      if(!current(context))throw Error('DESK_CONTEXT_CHANGED');
      const safe=[...new Map(rows.filter(row=>deskId(row.definitionId)).map(row=>[row.definitionId,{definitionId:row.definitionId,
        name:deskText(row.name||row.definitionId),rating:row.rating??null,version:deskText(row.version??'',60),
        nationId:row.nationId,leagueId:row.leagueId,teamId:row.teamId,preferredPosition:row.preferredPosition}])).values()].slice(0,1000);
      rememberComplete(safe);return safe;
    },
    settings:value=>act(state=>{state.settings=deskSettings(value);state.configured=true;deskAlerts(state,now());}),
    async add({input,name='',player=null}){
      const context=capture();let resolved=player;
      if(!resolved)resolved=/^[1-9]\d{0,8}$/.test(String(input).trim())?{definitionId:Number(input)}:await prices.resolveTradingPlayer(input);
      if(!current(context)||!deskId(resolved?.definitionId))throw Error('DESK_PLAYER_INVALID');
      // A bare EA ID or link label must not erase richer shared Puzzle/Gallery
      // lookup facts. The existing public ID mapping already serves links.
      rememberComplete([resolved]);
      return update(context,state=>{
        if(state.watch.some(row=>row.definitionId===resolved.definitionId))return;
        if(state.watch.length>=DESK_LIMITS.watch)throw Error('DESK_WATCH_LIMIT');
        state.watch.push({definitionId:resolved.definitionId,name:deskText(name||resolved.name||`EA ${resolved.definitionId}`),
          ask:0,sell:0,checkedAt:0,series:{futbin:[],futgg:[]},latest:{}});
      });
    },
    remove:definitionId=>act(state=>{state.watch=state.watch.filter(row=>row.definitionId!==definitionId);}),
    evaluate:({definitionId,ask,sell})=>act(state=>{if(![ask,sell].every(v=>Number.isSafeInteger(v)&&v>=150&&v<=15000000))throw Error('DESK_PRICE_INVALID');
      const card=state.watch.find(row=>row.definitionId===definitionId);if(!card)throw Error('DESK_PLAYER_INVALID');
      Object.assign(card,{ask,sell,checkedAt:now()});deskAlerts(state,now());}),
    async refresh({isCurrent=()=>true,onProgress=()=>{}}={}){
      const {context,state}=await read();if(!state.watch.length)return {context,state};
      const policy=await prices.readSettings();if(!current(context)||!isCurrent())throw Error('DESK_CONTEXT_CHANGED');
      const snapshot=await prices.load(state.watch.map(row=>row.definitionId),{purpose:'trading',futbinBatch:false,
        policy:{...policy,futbinPlatform:context.platform==='pc'?'pc':'ps'},deadlineAt:now()+30000,
        isCurrent:()=>current(context)&&isCurrent(),onProgress});
      if(!current(context)||!isCurrent())throw Error('DESK_CONTEXT_CHANGED');
      return update(context,next=>{for(const card of next.watch)for(const source of ['futbin','futgg'])
        observeDeskQuote(card,source,snapshot.references?.[card.definitionId]?.quotes?.[source],context.platform,now());deskAlerts(next,now());});
    },
    recordBuy:({definitionId,name,buy})=>act(state=>{
      if(!deskId(definitionId)||!Number.isSafeInteger(buy)||buy<150||buy>15000000)throw Error('DESK_RECORD_INVALID');
      if(state.records.length>=DESK_LIMITS.records)throw Error('DESK_RECORD_LIMIT');
      state.records.push({id:id(),definitionId,name:deskText(name||definitionId),buy,sell:null,at:now()});
    }),
    recordSale:({recordId,sell})=>act(state=>{
      if(!Number.isSafeInteger(sell)||sell<150||sell>15000000)throw Error('DESK_PRICE_INVALID');
      const row=state.records.find(row=>row.id===recordId);if(!row||row.sell!==null)throw Error('DESK_RECORD_ALREADY_CLOSED');row.sell=sell;row.soldAt=now();
    }),
    acknowledge:()=>act(state=>{for(const alert of state.alerts)alert.read=true;}),
    event:row=>act(state=>{let link;try{link=new URL(deskText(row.url,2000));link.search='';link.hash='';}catch{throw Error('DESK_EVENT_INVALID');}
      const value={url:link.href,note:deskText(row.note,300),status:row.status,at:now()};
      if(!validDeskEvent(value))throw Error('DESK_EVENT_INVALID');
      const old=state.events.findIndex(event=>event.url===value.url);
      if(old<0&&state.events.length>=DESK_LIMITS.events)throw Error('DESK_EVENT_LIMIT');
      if(old>=0)state.events[old]=value;else state.events.push(value);
    }),
    defaults:()=>emptyDesk(),
  });
}
