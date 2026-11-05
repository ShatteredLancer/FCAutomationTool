import {DESK_LIMITS,deskId,deskText,deskSettings,emptyDesk,readDesk,observeDeskQuote,deskAlerts,validDeskEvent,deskPlan,deskFunding} from '../../trading/desk-model.js';
import {tradingPreselection,rankTradingSuggestions} from '../../trading/shortlist.js';
import {publicPriceSourceEnabled} from '../../gallery/public-price-policy.js';
import {intelEvents} from '../../trading/intel.js';
import {createInvestmentPlan} from '../../trading/investment-plan.js';
import {eventStoreKey,readEventStore,eventCandidates,eventNames,eventMatches} from '../../trading/event-candidates.js';

export const tradingDeskKey=scope=>`fcat-fc27-trading-desk-v1:${scope}`;
// The notebook stays separate from Gallery ownership and receipts. Optional
// real execution has its own approval and durable journal, never a notebook
// flag or a public reference quote masquerading as an EA transaction receipt.
export function createFc27TradingDesk({prices,get,set,locks,intel=null,execution=null,diagnosticLog=null,readCandidates=()=>[],now=()=>Date.now(),id=()=>globalThis.crypto.randomUUID()}){
  let lastDiscovery=null,discoveryId=0,lastIntel=null,intelId=0,eventImportId=0;
  const diagnostic=fields=>{try{Promise.resolve(diagnosticLog?.record?.({area:'trading',...fields})).catch(()=>{});}catch{/* Diagnostics only. */}};
  const discoveryBasis=state=>JSON.stringify([state.settings,state.configured,state.events,deskFunding(state)]);
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
  const readEvents=async(context=capture())=>{const value=readEventStore(await get(eventStoreKey(context.scope),null),context);if(!current(context))throw Error('DESK_CONTEXT_CHANGED');return value;};
  const updateEvents=async(context,mutate,{isCurrent=()=>true,expectedRevision=null}={})=>{
    if(!locks?.request)throw Error('DESK_STORAGE_LOCK_UNAVAILABLE');
    const check=()=>{if(!current(context)||!isCurrent())throw Error('DESK_CONTEXT_CHANGED');};
    return locks.request(eventStoreKey(context.scope),{mode:'exclusive'},async()=>{check();const store=await readEvents(context);check();if(expectedRevision!==null&&store.revision!==expectedRevision)throw Error('DESK_EVENT_SOURCE_CHANGED');
      mutate(store);store.revision++;readEventStore(store,context);
      const serialized=JSON.stringify(store);check();await set(eventStoreKey(context.scope),store);
      if(JSON.stringify(await get(eventStoreKey(context.scope),null))!==serialized)throw Error('DESK_SAVE_UNVERIFIED');if(!current(context))throw Error('DESK_CONTEXT_CHANGED');
      discoveryId++;lastDiscovery=null;return {context,store};});
  };
  const desk=Object.freeze({read,context:capture,
    async eventState(){const context=capture();return {context,store:await readEvents(context)};},
    async importEvent({url,isCurrent=()=>true}={}){const context=capture(),serial=++eventImportId;if(!intel?.importPost)throw Error('DESK_INTEL_POST_UNSUPPORTED');
      const before=await readEvents(context);if(!current(context)||!isCurrent()||serial!==eventImportId)throw Error('DESK_CONTEXT_CHANGED');
      const feed=await intel.importPost({url});if(!current(context)||!isCurrent()||serial!==eventImportId)throw Error('DESK_CONTEXT_CHANGED');
      const posts=feed.posts.filter(p=>p.topic==='evo'&&p.entry&&p.players?.some(v=>v.nominationQuote));
      const post=posts[0]??feed.posts.find(p=>p.topic==='evo');if(!post)throw Error('DESK_EVENT_NO_EVO_SOURCE');
      const result=await updateEvents(context,store=>{const old=store.rows.find(r=>r.url===post.url);
        if(old){old.post=structuredClone(post);old.importedAt=now();}else{if(store.rows.length>=6)throw Error('DESK_EVENT_LIMIT');store.rows.push({url:post.url,post:structuredClone(post),status:'leak',included:false,exitMode:'target-hold',importedAt:now()});}},
        {isCurrent:()=>isCurrent()&&serial===eventImportId,expectedRevision:before.revision});
      return {...result,cached:feed.cached===true,costUsd:feed.costUsd??null};
    },
    async setEvent({url,included,status,remove=false}={}){const context=capture();eventImportId++;if(status==='failed'||remove)execution?.stop?.();
      return updateEvents(context,store=>{const row=store.rows.find(r=>r.url===url);if(!row)throw Error('DESK_EVENT_NOT_FOUND');
        if(remove){store.rows=store.rows.filter(r=>r!==row);return;}
        if(included!==undefined){if(typeof included!=='boolean')throw Error('DESK_EVENT_INVALID');if(included&&store.rows.filter(r=>r.included&&r!==row).length>=3)throw Error('DESK_EVENT_SELECTED_LIMIT');row.included=included;}
        if(status!==undefined){if(!['leak','live','failed'].includes(status))throw Error('DESK_EVENT_INVALID');row.status=status;if(status==='failed')row.included=false;}});
    },
    async analyzeEvents({isCurrent=()=>true,onProgress=()=>{}}={}){const {context,state}=await read(),store=await readEvents(context),basis=JSON.stringify(store);
      const check=()=>{if(!current(context)||!isCurrent())throw Error('DESK_CONTEXT_CHANGED');};check();const names=eventNames(store);
      if(!names.length)return {...eventCandidates(store,{platform:context.platform,at:now(),rows:[]},{},state.settings,now()),store};
      const pool=await prices.tradingCandidates({names,namesOnly:true,isCurrent:()=>{check();return true;},onProgress});check();
      const ids=[...new Set(pool.rows.filter(r=>names.some(name=>eventMatches(r,{name}))).map(r=>r.definitionId))].slice(0,12),policy=await prices.readSettings();check();let references={};
      if(ids.length&&publicPriceSourceEnabled(policy,'futgg')){const snapshot=await prices.load(ids,{purpose:'trading',sources:['futgg'],futbinBatch:false,policy:{...policy,futbinPlatform:context.platform==='pc'?'pc':'ps'},deadlineAt:now()+30000,isCurrent:()=>{check();return true;},onProgress});references=snapshot.references??{};}check();
      if(JSON.stringify(await readEvents(context))!==basis)throw Error('DESK_DISCOVERY_CHANGED');return {...eventCandidates(store,pool,references,state.settings,now()),store};
    },
    async prepareInvestment({capitalLimit=20000,reserveCoins=0,definitionIds=null,isCurrent=()=>true,onProgress=()=>{}}={}){
      try{
      if(!execution)throw Error('DESK_EXECUTION_DISABLED');let saved=lastDiscovery,serial=discoveryId,refreshedDiscovery=null;
      const {context,state:initialState}=await read();let state=initialState;const events=await readEvents(context);
      const check=()=>{if(!current(context)||!isCurrent()||serial!==discoveryId)throw Error('DESK_CONTEXT_CHANGED');};
      check();if(!saved||!current(saved.context))throw Error('DESK_DISCOVERY_EXPIRED');
      if(saved.result.validUntil<=now()||discoveryBasis(state)!==saved.basis||JSON.stringify(events)!==saved.eventBasis){
        // Only an explicit full prepare may discover again. A subset remains
        // bound to the displayed selection; old quotes/approvals are immutable.
        if(definitionIds!==null)throw Error('DESK_DISCOVERY_EXPIRED');
        serial++;refreshedDiscovery=await desk.discover({isCurrent:()=>current(context)&&isCurrent(),onProgress});check();
        const latest=await read();check();
        if(discoveryBasis(latest.state)!==discoveryBasis(state))throw Error('DESK_DISCOVERY_CHANGED');
        state=latest.state;saved=lastDiscovery;
      }
      check();if(!saved||!current(saved.context)||saved.result.validUntil<=now()||discoveryBasis(state)!==saved.basis||JSON.stringify(await readEvents(context))!==saved.eventBasis)throw Error('DESK_DISCOVERY_EXPIRED');check();
      if(definitionIds!==null&&(!Array.isArray(definitionIds)||definitionIds.length>6||new Set(definitionIds).size!==definitionIds.length
        ||definitionIds.some(id=>!saved.result.suggestions.some(row=>row.definitionId===id))))throw Error('DESK_PLAN_INVALID');
      const advice=definitionIds===null?saved.result:{...saved.result,suggestions:saved.result.suggestions.filter(row=>definitionIds.includes(row.definitionId))};
      const result=await execution.prepare(createInvestmentPlan({advice,context,capitalLimit,reserveCoins,existingCapital:deskFunding(state).occupied,unitLimit:state.settings.unitLimit,
        minProfit:state.settings.minProfit,buffer:state.settings.buffer,now:now(),id:id()}));
      check();diagnostic({event:'plan-result',phase:'prepare',status:'ready',approvedBudget:capitalLimit,requestedCount:result.plan?.rows?.length??0});
      return {...result,...(refreshedDiscovery?{refreshedDiscovery}: {})};
      }catch(error){diagnostic({event:'plan-result',phase:'prepare',status:'blocked',reason:/^(DESK|FC27)_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'DESK_PLAN_UNCONFIRMED'});throw error;}
    },
    executionAvailable:()=>execution!==null,
    inspectInvestment:()=>execution?.inspect()??Promise.resolve({record:null,running:false}),
    startInvestment:options=>{if(!execution)throw Error('DESK_EXECUTION_DISABLED');return execution.start(options);},
    recoverInvestment:()=>{if(!execution)throw Error('DESK_EXECUTION_DISABLED');return execution.recover();},
    stopInvestment:()=>execution?.stop(),
    pairIntel:async key=>{if(!intel)throw Error('DESK_INTEL_COLLECTOR_UNAVAILABLE');return intel.pair(key);},
    intelConfig:async()=>typeof intel?.config==='function'?intel.config():{configured:false},
    checkIntel:async()=>{if(typeof intel?.check!=='function')throw Error('DESK_INTEL_COLLECTOR_UNAVAILABLE');return intel.check();},
    stopIntel:async()=>{if(typeof intel?.stop!=='function')throw Error('DESK_INTEL_STATUS_UNSUPPORTED');return intel.stop();},
    async refreshIntel(){const context=capture(),serial=++intelId;if(!intel)throw Error('DESK_INTEL_COLLECTOR_UNAVAILABLE');
      const feed=await intel.refresh();if(!current(context)||serial!==intelId)throw Error('DESK_CONTEXT_CHANGED');
      lastIntel=feed;discoveryId++;lastDiscovery=null;return feed;},
    async discover({isCurrent=()=>true,onProgress=()=>{}}={}){
      const serial=++discoveryId;lastDiscovery=null;
      const {context,state}=await read(),events=await readEvents(context),selectedEvents={...events,rows:events.rows.filter(r=>r.included&&r.status!=='failed')};
      const check=()=>{if(!current(context)||!isCurrent()||serial!==discoveryId)throw Error('DESK_CONTEXT_CHANGED');};
      check();if(typeof prices.tradingCandidates!=='function')throw Error('DESK_DISCOVERY_UNAVAILABLE');
      const newsEvents=intelEvents(lastIntel),effective={...state,events:[...state.events,...newsEvents]};
      const names=[...eventNames(selectedEvents),...newsEvents.filter(e=>e.at<=now()&&now()-e.at<=86400000).flatMap(e=>e.players.map(p=>p.name))].slice(0,3);
      const pool=deskFunding(state).available<150?{rows:[],scanned:0,ratings:[80,82,84],at:now(),platform:context.platform}
        :await prices.tradingCandidates({isCurrent:()=>current(context)&&isCurrent()&&serial===discoveryId,onProgress,names});
      check();if(pool.platform!==context.platform)throw Error('DESK_CONTEXT_CHANGED');
      const policy=await prices.readSettings();check();const ordinary=tradingPreselection(pool,effective,now());
      const eventCards=pool.rows.filter(r=>selectedEvents.rows.some(s=>s.post.players.some(p=>p.nominationQuote&&eventMatches(r,p)))).slice(0,3);
      const pre={...ordinary,rows:[...eventCards,...ordinary.rows.filter(r=>!eventCards.some(e=>e.definitionId===r.definitionId))].slice(0,12)};let references={},crossChecked=0;
      if(pre.rows.length&&publicPriceSourceEnabled(policy,'futgg')){
        onProgress({phase:'cross-check',index:0,total:pre.rows.length});
        try{const snapshot=await prices.load(pre.rows.map(row=>row.definitionId),{purpose:'trading',sources:['futgg'],futbinBatch:false,
          policy:{...policy,futbinPlatform:context.platform==='pc'?'pc':'ps'},deadlineAt:now()+30000,
          isCurrent:()=>current(context)&&isCurrent()&&serial===discoveryId,onProgress});
          references=snapshot.references??{};crossChecked=pre.rows.length;
        }catch{check();/* A missing secondary source is explicit, not a fabricated quote. */}
      }
      check();const latest=await read();check();
      if(discoveryBasis(latest.state)!==discoveryBasis(state))throw Error('DESK_DISCOVERY_CHANGED');
      if(JSON.stringify(await readEvents(context))!==JSON.stringify(events))throw Error('DESK_DISCOVERY_CHANGED');check();
      const result={...rankTradingSuggestions(pool,effective,references,now()),crossChecked,validUntil:pool.at+300000},eventResult=eventCandidates(selectedEvents,pool,references,state.settings,now());
      const mixed=[...eventResult.candidates,...result.suggestions.filter(r=>!eventCards.some(e=>e.definitionId===r.definitionId))];result.suggestions=[];result.allocated=0;const used=new Set();
      for(const row of mixed){if(result.suggestions.length>=6)break;if(used.has(row.definitionId)||result.allocated+row.buyCeiling>result.available)continue;used.add(row.definitionId);result.suggestions.push(row);result.allocated+=row.buyCeiling;}result.eventIssues=eventResult.issues;
      check();lastDiscovery={context,result:structuredClone(result),basis:discoveryBasis(state),eventBasis:JSON.stringify(events)};
      diagnostic({event:'candidate-result',phase:'screening',status:'success',count:result.suggestions.length,requestedCount:result.scanned,quotedCount:result.crossChecked});return result;
    },
    async followSuggestions({definitionId=null}={}){
      const saved=lastDiscovery,context=capture();
      if(!saved||JSON.stringify(saved.context)!==JSON.stringify(context)||saved.result.validUntil<=now())throw Error('DESK_DISCOVERY_EXPIRED');
      const rows=saved.result.suggestions.filter(row=>definitionId===null||row.definitionId===definitionId);
      if(!rows.length)throw Error('DESK_PLAYER_INVALID');
      return update(context,state=>{
        if(discoveryBasis(state)!==saved.basis)throw Error('DESK_DISCOVERY_CHANGED');
        if(state.watch.length+rows.filter(row=>!state.watch.some(card=>card.definitionId===row.definitionId)).length>DESK_LIMITS.watch)throw Error('DESK_WATCH_LIMIT');
        for(const row of rows){let card=state.watch.find(card=>card.definitionId===row.definitionId);
          if(!card){card={definitionId:row.definitionId,name:deskText(row.name),ask:0,sell:0,checkedAt:0,series:{futbin:[],futgg:[]},latest:{}};state.watch.push(card);}
          card.plan=deskPlan(row,state,now());
          observeDeskQuote(card,'futbin',{source:'futbin',definitionId:row.definitionId,season:'27',platform:context.platform,price:row.price,
            fetchedAt:row.fetchedAt,expiresAt:saved.result.validUntil,sourceUpdatedAt:null},context.platform,now());
          if(row.ggQuote)observeDeskQuote(card,'futgg',row.ggQuote,context.platform,now());
        }
      });
    },
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
      const plan=state.watch.find(card=>card.definitionId===definitionId)?.plan;
      state.records.push({id:id(),definitionId,name:deskText(name||definitionId),buy,sell:null,at:now(),...(plan?{plan:structuredClone(plan)}:{})});
    }),
    recordSale:({recordId,sell})=>act(state=>{
      if(!Number.isSafeInteger(sell)||sell<150||sell>15000000)throw Error('DESK_PRICE_INVALID');
      const row=state.records.find(row=>row.id===recordId);if(!row||row.sell!==null)throw Error('DESK_RECORD_ALREADY_CLOSED');row.sell=sell;row.soldAt=now();
    }),
    acknowledge:()=>act(state=>{for(const alert of state.alerts)alert.read=true;}),
    event:row=>act(state=>{let link;try{link=new URL(deskText(row.url,2000));link.search='';link.hash='';}catch{throw Error('DESK_EVENT_INVALID');}
      const value={url:link.href,note:deskText(row.note,300),status:row.status,at:now(),...(row.evo?{evo:structuredClone(row.evo)}:{})};
      if(!validDeskEvent(value))throw Error('DESK_EVENT_INVALID');
      const old=state.events.findIndex(event=>event.url===value.url);
      if(old<0&&state.events.length>=DESK_LIMITS.events)throw Error('DESK_EVENT_LIMIT');
      if(old>=0)state.events[old]=value;else state.events.push(value);
    }),
    defaults:()=>emptyDesk(),
  });
  return desk;
}
