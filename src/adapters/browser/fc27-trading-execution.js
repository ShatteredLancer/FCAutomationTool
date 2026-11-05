import {createTradingExecutionSession} from '../../trading/execution-session.js';
import {validateInvestmentPlan} from '../../trading/investment-plan.js';
import {eventStoreKey,readEventStore,eventMatches} from '../../trading/event-candidates.js';
import {createFc27PuzzleBuyAdapter} from '../ea/fc27-puzzle-buy.js';
import {createEaTradeAdapter} from '../ea/trade.js';
import {readFc27Context} from '../ea/fc27-local-read.js';
import {traditionalJournalScope,isTerminalTraditionalJournal} from '../../fc27/traditional-journal.js';
import {createFc27TransactionPersistence} from './fc27-transaction-persistence.js';
import {galleryPurchasePendingKey} from '../../gallery/purchase-session.js';
import {assertNoGalleryListingPending} from '../../gallery/bulk-list-session.js';
import {assertGalleryRelistSettled} from '../../gallery/relist-recovery.js';
import {galleryListingEvidence} from '../../gallery/listing-readback.js';
import {readDesk,deskFunding} from '../../trading/desk-model.js';
import {createFc27GallerySaleReader} from '../ea/fc27-gallery-sales.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=reason=>{throw Error(reason);};
export async function createNativeTradingExecutionAdapter({root,plan,prices,canWrite,assertCurrent,readOnly=false,needsPurchases=true,onStage=()=>{},onDiagnostic=()=>{},
  checkEventSources=async()=>{},now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),buyFactory=createFc27PuzzleBuyAdapter,tradeFactory=createEaTradeAdapter}){
  plan=validateInvestmentPlan(plan,plan.context);
  const context=readFc27Context(root),service=root.services?.Item,repository=root.repositories?.Item;
  const functions=Object.fromEntries(['bid','move','list','searchTransferMarket','requestTransferItems','requestUnassignedItems'].map(k=>[k,service?.[k]]));
  if(Object.values(functions).some(fn=>typeof fn!=='function'))fail('DESK_EXECUTION_RUNTIME_UNAVAILABLE');
  const assert=()=>{assertCurrent();if(!same(context,readFc27Context(root))||root.services.Item!==service||root.repositories?.Item!==repository||Object.keys(functions).some(k=>functions[k]!==service[k]))fail('DESK_CONTEXT_CHANGED');};
  let reference=null,lastRequest=0,lastReadAt=-Infinity,cancelled=false;
  const purchaseQuotes=new Map(),exitQuotes=new Map();
  const bounded=task=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('DESK_EXECUTION_RESPONSE_UNCONFIRMED')),20000);
    Promise.resolve().then(task).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
  const pace=async()=>{assert();const left=3000-(now()-lastRequest);if(left>0)await sleep(left);assert();lastRequest=now();};
  const trade=tradeFactory(root),saleReader=createFc27GallerySaleReader(root);
  const readStatuses=new Set(['completed','accepted','rejected','blocked','unsupported','error','ambiguous','observed','not-requested']);
  const readMetadata=result=>({
    httpStatus:Number.isSafeInteger(result?.response?.status)&&result.response.status>=100&&result.response.status<=599?result.response.status:undefined,
    errorCode:[result?.response?.code,result?.error?.code,result?.errorCode].find(code=>Number.isSafeInteger(code)&&code>=0),
  });
  const readDiagnostic=(phase,status,mismatch,metadata)=>{
    try{Promise.resolve(onDiagnostic({area:'trading',event:'execution-response',phase,status,mismatch,...metadata})).catch(()=>{});}catch{/* Diagnostics only. */}
  };
  // Reviewed EA DAO getUnassignedPile/getTransferPile return success + 304
  // only for a clean repository. Domain getters return the pile's values();
  // set*Items marks endOfList and setCacheTimestamp supplies expiryTimestamp.
  // This is preflight/cache evidence, NEVER a post-write receipt on its own.
  const cacheReady=phase=>{
    const config={'purchase-state-read':['unassigned','getUnassignedItems','PURCHASED',6],
      'transfer-items-read':['transfer','getTransferItems','TRANSFER',5]}[phase];
    if(!config)return false;
    try{const [key,getter,enumKey,pile]=config,cache=repository?.[key];
      if(root.ItemPile?.[enumKey]!==pile||typeof repository?.isDirty!=='function'||repository.isDirty(pile)!==false
        ||!cache||cache.endOfList!==true||typeof cache.isCacheExpired!=='function'||cache.isCacheExpired()!==false
        ||!Number.isSafeInteger(cache.expiryTimestamp)||cache.expiryTimestamp<=now()||typeof cache.values!=='function'
        ||typeof repository[getter]!=='function'||typeof repository.numItemsInCache!=='function'||trade.inspectCapabilities().runtimeReady!==true)return false;
      const items=repository[getter](),values=cache.values();
      if(!Array.isArray(items)||!Array.isArray(values)||items.length>10000||!Number.isSafeInteger(cache.length)||cache.length!==items.length
        ||repository.numItemsInCache(pile)!==items.length||values.length!==items.length||new Set(items.map(item=>item?.id)).size!==items.length)return false;
      const entities=new Map(values.map(item=>[item?.id,item]));
      return items.every(item=>Number.isSafeInteger(item?.id)&&item.id>0&&Number.isSafeInteger(item.definitionId)&&item.definitionId>0
        &&item.pile===pile&&entities.get(item.id)===item);
    }catch{return false;}
  };
  // Keep the existing strict contracts. Export only fixed stages/statuses and
  // numeric metadata, never native messages, raw responses or item identities.
  const nativeRead=async(phase,task,{statusKey='status',accepted=['completed','accepted'],receipt=true,allowCached=false}={})=>{
    onStage(phase);let result;
    try{result=await bounded(task);assert();}catch(error){
      const metadata=readMetadata({response:{status:error?.httpStatus},errorCode:error?.errorCode});
      readDiagnostic(phase,'error','read-exception',metadata);
      throw Object.assign(error instanceof Error?error:Error('DESK_EXECUTION_RESPONSE_UNCONFIRMED'),
        {nativeReadPhase:phase,nativeReadStatus:'error',mismatch:'read-exception',...metadata});
    }
    const status=readStatuses.has(result?.[statusKey])?result[statusKey]:'unknown',metadata=readMetadata(result);
    const cached=allowCached&&result?.status==='completed'&&result?.response?.success===true&&result.response.status===304
      &&(phase!=='purchase-state-read'||result.steps?.length===1&&result.steps[0].method==='requestUnassignedItems'
        &&result.steps[0].response?.success===true&&result.steps[0].response?.status===304)&&cacheReady(phase);
    const mismatch=!accepted.includes(result?.[statusKey])?(receipt?'read-status-unconfirmed':'sale-status-unconfirmed')
      :receipt&&result?.response?.success!==true?'read-success-unconfirmed'
      :receipt&&!Number.isSafeInteger(result.response.status)?(result.response.status==null?'read-http-missing':'read-http-invalid')
      :receipt&&(result.response.status<200||result.response.status>=300)&&!cached?'read-http-rejected':null;
    readDiagnostic(phase,status,mismatch,metadata);
    if(mismatch)throw Object.assign(Error('DESK_EXECUTION_READ_UNCONFIRMED'),{nativeReadPhase:phase,nativeReadStatus:status,mismatch,...metadata});
    return result;
  };
  const read=async(force=false,receiptPhase=null)=>{assert();if(!force&&now()-lastReadAt<=1000)return;
    // The reviewed native buyer uses setDirty(PURCHASED) before receipt reads.
    // Invalidate only the relevant local pile so a pending write gets a fresh
    // native request, rather than looping on a legitimate cached 304.
    if(receiptPhase==='buy-pending'&&root.ItemPile?.PURCHASED===6&&typeof repository.setDirty==='function')repository.setDirty(6);
    await pace();await nativeRead('purchase-state-read',()=>trade.refreshPurchaseState(),{allowCached:receiptPhase!=='buy-pending'});
    if(['move-pending','list-pending','listed'].includes(receiptPhase)&&root.ItemPile?.TRANSFER===5&&typeof repository.setDirty==='function')repository.setDirty(5);
    await pace();await nativeRead('transfer-items-read',()=>trade.refreshTransferItems(),{allowCached:!['move-pending','list-pending','listed'].includes(receiptPhase)});assert();lastReadAt=now();};
  const seen=e=>trade.inspectPurchase({id:e.offer.itemId,definitionId:e.definitionId,pile:'unassigned'});
  const isEvent=row=>row?.strategy==='evo-event';
  const targetHold=row=>isEvent(row)&&row.event.exitMode==='target-hold';
  const approvedRow=row=>{if(!same(plan.rows.find(r=>r.definitionId===row.definitionId),row))fail('DESK_PLAN_INVALID');};
  const loadQuotes=async(rows,force=false)=>{
    onStage('reference-prices');const policy=await prices.readSettings();assert();
    const snapshot=await prices.load(rows.map(r=>r.definitionId),{purpose:'trading',sources:['futbin','futgg'],futbinBatch:false,...(force?{force:true}:{}),
      policy:{...policy,futbinPlatform:plan.context.platform==='pc'?'pc':'ps'},deadlineAt:now()+30000,isCurrent:()=>{assert();return true;}});assert();return snapshot;
  };
  const validQuotes=(row,q)=>{
    const valid=source=>q?.[source]?.source===source&&q[source].definitionId===row.definitionId&&q[source].platform===plan.context.platform
      &&q[source].season==='27'&&!q[source].error&&Number.isSafeInteger(q[source].price)&&q[source].price>=150
      &&q[source].fetchedAt<=now()&&q[source].expiresAt>now()
      &&(source!=='futbin'||q[source].futbinPlatform==null||q[source].futbinPlatform===(plan.context.platform==='pc'?'pc':'ps'))
      &&(q[source].sourceUpdatedAt==null||q[source].sourceUpdatedAt<=now()&&now()-q[source].sourceUpdatedAt<=1800000)
      &&(!isEvent(row)||Number.isSafeInteger(q[source].fetchedAt)&&now()-q[source].fetchedAt<=300000
        &&Number.isSafeInteger(q[source].expiresAt)&&q[source].price<=15000000
        &&(q[source].sourceUpdatedAt==null||Number.isSafeInteger(q[source].sourceUpdatedAt)));
    return valid('futbin')&&valid('futgg')&&Math.max(q.futbin.price,q.futgg.price)/Math.min(q.futbin.price,q.futgg.price)<=1.15;
  };
  const buyReferenceValid=(row,q)=>validQuotes(row,q)&&Math.min(q.futbin.price,q.futgg.price)>=(isEvent(row)?row.buyCap:row.sellPrice);
  const exactTransfer=(e,row)=>{const item=seen(e)?.candidate;
    if(e.definitionId!==row.definitionId||item?.item?.id!==e.offer.itemId||item.item.definitionId!==row.definitionId
      ||item.item.pile!=='transfer'||item.tradeable!==true||!['none','inactive'].includes(item.auction?.state))fail('DESK_EXECUTION_RECEIPT_UNCONFIRMED');return item;};
  const eventWritable=row=>{if(!targetHold(row))return;
    if(now()>=row.event.reviewAt)throw Object.assign(Error('DESK_EVENT_REVIEW_REQUIRED'),{notSent:true});
    const q=exitQuotes.get(row.definitionId);
    if(!validQuotes(row,q)||Math.min(q.futbin.price,q.futgg.price)<row.sellPrice)throw Object.assign(Error('DESK_EVENT_TARGET_NOT_READY'),{notSent:true});
  };
  const sourceCheck=async(row,notSent=false)=>{try{await checkEventSources(row);assert();}catch(error){if(notSent)error.notSent=true;throw error;}};
  let buyer=null;
  if(!readOnly&&needsPurchases){
    const snapshot=await loadQuotes(plan.rows);
    reference=new Map();
    for(const row of plan.rows){const q=snapshot.references?.[row.definitionId]?.quotes;
      // Only event rows have scenario exits. The legacy minimum-reference >=
      // fixed sell price guard is deliberately unchanged for every spread row.
      if(!buyReferenceValid(row,q))fail('DESK_EXECUTION_REFERENCE_CHANGED');
      if(isEvent(row))purchaseQuotes.set(row.definitionId,structuredClone(q));
      reference.set(row.definitionId,Math.min(q.futbin.price,q.futgg.price));
    }
    onStage('runtime-check');buyer=await buyFactory(root,{canWrite:()=>{assert();return canWrite();},assertTarget:assert,verifyCurrent:assert,
      verifySquad:assert,referencePrice:async row=>reference.get(row.definitionId),playerDetails:new Map(plan.rows.map(row=>[row.definitionId,{...row,_rating:row.rating}])),
      attempts:1,skipRejectedListings:true,wait:async()=>{await pace();}});
    await buyer.verifySquad({scope:traditionalJournalScope(context),entries:plan.rows.map(row=>({definitionId:row.definitionId}))});
  }
  const writable=row=>{assert();if(readOnly||cancelled||canWrite()!==true)fail('DESK_EXECUTION_NOT_SENT');if(row)eventWritable(row);};
  const permit=async(action,row=null)=>{await pace();await sourceCheck(row,true);writable(row);const p=await trade.acquireRequestPermit(action);
    await sourceCheck(row,true);writable(row);if(p.status!=='acquired')fail('DESK_EXECUTION_SERVICE_STOP');return {requestPermit:p.permit};};
  return {
    async capabilities(){if(now()-lastReadAt>10000)await read(true);const cap=trade.inspectCapabilities();
      if(!cap.runtimeReady)return {canTrade:false,balance:null,freeSlots:0};
      const {max,used}=cap.transferCapacity??{};
      const unassigned=root.repositories.Item.numItemsInCache(root.ItemPile.PURCHASED),unassignedMax=root.MAX_NEW_ITEMS;
      return {canTrade:cap.canTrade===true&&Number.isSafeInteger(unassigned)&&Number.isSafeInteger(unassignedMax)&&unassigned<unassignedMax,
        balance:cap.coins,freeSlots:Number.isSafeInteger(max)&&Number.isSafeInteger(used)?Math.max(0,max-used):0};},
    async find(row){await pace();assert();const offer=await buyer.find(row.definitionId,row.buyCap);assert();
      if(offer?.unavailable)fail('DESK_EXECUTION_SEARCH_UNCONFIRMED');return offer;},
    async buy(offer){await pace();const row=plan.rows.find(r=>r.definitionId===offer.definitionId);await sourceCheck(row,true);writable();
      if(isEvent(row)&&!buyReferenceValid(row,purchaseQuotes.get(row.definitionId)))throw Object.assign(Error('DESK_EXECUTION_REFERENCE_CHANGED'),{notSent:true});
      lastReadAt=-Infinity;try{return await buyer.buy(offer);}catch(error){if(error.message==='FC27_BUY_DISABLED')fail('DESK_EXECUTION_NOT_SENT');throw error;}},
    async move(e){await read();const item=seen(e)?.candidate?.item;if(item?.pile!=='unassigned')fail('DESK_EXECUTION_RECEIPT_UNCONFIRMED');
      const p=await permit('purchase-route');writable();lastReadAt=-Infinity;
      const result=await bounded(()=>{writable();return trade.routePurchasedItem(item,'transfer',p);});assert();return result;},
    async eventExit(e,row){approvedRow(row);if(!targetHold(row))fail('DESK_PLAN_INVALID');exitQuotes.delete(row.definitionId);
      await sourceCheck(row);await read(true);exactTransfer(e,row);
      if(now()>=row.event.reviewAt)return {ready:false,reviewRequired:true};
      const snapshot=await loadQuotes([row],true);await sourceCheck(row);assert();exactTransfer(e,row);
      const reviewRequired=now()>=row.event.reviewAt,q=snapshot.references?.[row.definitionId]?.quotes;
      if(!validQuotes(row,q))fail('DESK_EXECUTION_REFERENCE_CHANGED');
      const ready=!reviewRequired&&Math.min(q.futbin.price,q.futgg.price)>=row.sellPrice;
      if(ready)exitQuotes.set(row.definitionId,structuredClone(q));
      return {ready,reviewRequired};
    },
    async checkListing(e,row){approvedRow(row);await sourceCheck(row);await read();const item=exactTransfer(e,row);
      await pace();const limits=await nativeRead('price-limits-read',()=>trade.inspectPriceLimits(item.item,{refresh:true}),{statusKey:'refreshStatus',accepted:['completed']}),limit=limits.after;
      if(!limit?.hasPriceLimits||!Number.isSafeInteger(limit.minimum)||!Number.isSafeInteger(limit.maximum)||row.sellPrice<limit.minimum||row.sellPrice>limit.maximum)fail('DESK_EXECUTION_LISTING_LIMIT');
      await sourceCheck(row);assert();if(targetHold(row))eventWritable(row);
    },
    async list(e,row){const ref={id:e.offer.itemId,definitionId:e.definitionId,pile:'transfer'};
      approvedRow(row);const p=await permit('list',row);writable(row);exactTransfer(e,row);lastReadAt=-Infinity;
      return bounded(()=>{writable(row);return trade.listItem(ref,{startPrice:row.sellPrice,buyNow:row.sellPrice,durationSeconds:plan.durationSeconds},p);});},
    async reconcile(e,row){
      for(let attempt=0;attempt<3;attempt++){
        // Receipts always force independent reads; the tiny no-mutation cache
        // only removes redundant preflight reads, never creates a receipt.
        await read(true,e.phase);const item=seen(e),candidate=item?.candidate;
        if(candidate?.item?.id!==e.offer.itemId||candidate?.item?.definitionId!==e.definitionId)continue;
        if(e.phase==='buy-pending'&&(e.buyAcknowledged===true||item.purchasePrice===e.offer.price)&&candidate.item.pile==='unassigned')return {phase:'bought'};
        if(e.phase==='move-pending'&&candidate.item.pile==='transfer'&&['none','inactive'].includes(candidate.auction?.state))return {phase:'transfer'};
        if(e.phase==='list-pending'){
          const proof=galleryListingEvidence({item:{id:e.offer.itemId,definitionId:e.definitionId,pile:'transfer'},startPrice:row.sellPrice,buyNow:row.sellPrice,
            response:e.listAcknowledged?{success:true,status:200}:null},item);
          if(proof.matched)return {phase:'listed',listingTradeId:proof.listingTradeId};
        }
        if(e.phase==='listed'){
          await pace();const sales=await nativeRead('sale-receipts-read',()=>saleReader.refreshGallerySaleReceipts(),{accepted:['observed'],receipt:false});
          const receipt=sales.receipts.find(r=>r.itemId===e.offer.itemId&&r.definitionId===e.definitionId&&r.listingTradeId===e.listingTradeId);
          if(receipt?.sold===true&&Number.isSafeInteger(receipt.soldPrice)&&receipt.soldPrice>=row.sellPrice)return {phase:'sold',salePrice:receipt.soldPrice,soldAt:now()};
          return null;
        }
        if(attempt<2)await sleep(1000*(attempt+1));
      }return null;
    },cancel(){cancelled=true;buyer?.cancel();},
  };
}

export function createFc27TradingExecution({root,prices,get,set,liveEnabled,onProgress=()=>{},adapterFactory=createNativeTradingExecutionAdapter,diagnosticLog=null}){
  let session=null,bound=null,prepared=null,progress=null;
  const diagnostic=event=>{try{Promise.resolve(diagnosticLog?.record?.(event)).catch(()=>{});}catch{/* Diagnostics only. */}};
  const failure=(event,phase,error)=>diagnostic({area:'trading',event,phase:error?.nativeReadPhase??phase,status:'blocked',
    reason:/^(DESK|FC27)_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'DESK_EXECUTION_UNCONFIRMED',
    httpStatus:error?.httpStatus,errorCode:error?.errorCode,mismatch:error?.mismatch,transportPhase:error?.nativeReadStatus,
    methodPath:error?.methodPath,observedHash:error?.observedHash,expectedHash:error?.expectedHash});
  const create=()=>{
    const context=readFc27Context(root),deskContext=prices.context(),scope=traditionalJournalScope(context);
    const binding=JSON.stringify([context,deskContext]);if(bound===binding)return session;
    session?.stop();bound=binding;prepared=null;
    const assertCurrent=()=>{if(!same(context,readFc27Context(root))||!same(deskContext,prices.context()))fail('DESK_CONTEXT_CHANGED');};
    const persistence=createFc27TransactionPersistence({context,gmGetValue:get,gmSetValue:set,lockManager:root.navigator?.locks});
    session=createTradingExecutionSession({context:deskContext,scope,get,set,exclusive:persistence.exclusive,assertCurrent,onDiagnostic:diagnostic,onProgress:value=>{onProgress(value);progress?.(value);},
      checkOtherTransactions:async()=>{const record=await persistence.journal.read(scope);if(record&&!isTerminalTraditionalJournal(record))fail('FC27_RECOVERY_REQUIRED');
        await assertGalleryRelistSettled(get,scope);await assertNoGalleryListingPending(get,scope);
        if(await get(galleryPurchasePendingKey(scope),null)!==null)fail('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');},
      createAdapter:async(plan,options)=>{
        const eventRows=plan.rows.filter(row=>row.strategy==='evo-event');
        const checkEventSources=async(row=null)=>{if(!eventRows.length||row&&row.strategy!=='evo-event')return;
          assertCurrent();const raw=await get(eventStoreKey(deskContext.scope),null);assertCurrent();let store;
          try{store=readEventStore(raw,deskContext);}catch{fail('DESK_EVENT_SOURCE_REVOKED');}
          if((row?[row]:eventRows).some(r=>!store.rows.some(source=>{
            const post=source.post,entry=post.entry,nominated=post.players.filter(player=>player.nominationQuote
              &&post.text.toLowerCase().includes(player.nominationQuote.toLowerCase()));
            return source.url===r.event.sourceUrl&&source.status!=='failed'&&post.at===r.event.sourceAt
              &&entry?.ceiling===r.event.entryCeiling&&entry.strictBelow===r.event.strictBelow&&entry.quote.trim()===r.event.entryQuote
              &&!/[\u0000-\u001f]/.test(entry.quote)
              &&nominated.length===1&&eventMatches(r,nominated[0])
              &&(!nominated[0].version||/^(?:base|gold|rare gold|common gold|normal|普通|金卡|普通金卡)$/i.test(nominated[0].version))
              &&(r.event.targetBasis==='source'?post.targetPrice===r.sellPrice:post.targetPrice==null);
          })))fail('DESK_EVENT_SOURCE_REVOKED');
        };
        // Revocation removes write authority, not the right to observe an
        // already-listed native sale. Recovery must remain source-independent.
        if(options.readOnly!==true)await checkEventSources();
        const adapter=await adapterFactory({root,plan,prices,...options,checkEventSources,canWrite:()=>liveEnabled===true&&persistence.lock.hasExclusiveAccess(scope)&&options.canWrite()});
        const capabilities=adapter.capabilities.bind(adapter);return {...adapter,
          ...(eventRows.length?{eventExit:async(e,row)=>{await checkEventSources(row);const signal=await adapter.eventExit(e,row);await checkEventSources(row);return signal;},
            buy:async offer=>{try{await checkEventSources(plan.rows.find(r=>r.definitionId===offer.definitionId));}catch(error){error.notSent=true;throw error;}return adapter.buy(offer);},
            list:async(e,row)=>{try{await checkEventSources(row);}catch(error){error.notSent=true;throw error;}return adapter.list(e,row);}}:{}),
          capabilities:async()=>{if(options.readOnly!==true)await checkEventSources();
          const occupied=deskFunding(readDesk(await get(`fcat-fc27-trading-desk-v1:${deskContext.scope}`,null))).occupied;
          assertCurrent();const cap=await capabilities();if(options.readOnly!==true)await checkEventSources();assertCurrent();return {...cap,occupied};}};}});
    return session;
  };
  return Object.freeze({
    prepare(plan){create();validateInvestmentPlan(plan,prices.context());prepared=structuredClone(plan);
      const balance=root.services?.User?.getUser?.()?.getCurrency?.(root.GameCurrency?.COINS)?.amount;
      return {plan:structuredClone(plan),balance:Number.isSafeInteger(balance)&&balance>=0?balance:null};},
    async inspect(){try{return await create().inspect();}catch(error){failure('execution-state','inspect',error);throw error;}},
    async recover(){try{return await create().recover();}catch(error){failure('execution-result','readonly-recovery',error);throw error;}},
    async start({plan=null,resume=false,approved=false,eventExitsOnly=false,expectedPlanId=null,onProgress:callback=null}={}){let handedOff=false;try{const current=create();if(liveEnabled!==true)fail('DESK_EXECUTION_DISABLED');
      if(!resume&&(!prepared||!same(prepared,plan)))fail('DESK_EXECUTION_APPROVAL_REQUIRED');progress=callback;
      try{handedOff=true;return await current.execute({plan,resume,approved,expectedPlanId,...(eventExitsOnly===true?{eventExitsOnly:true}:{})});}finally{progress=null;}
      }catch(error){if(!handedOff)failure('execution-result','approval',error);throw error;}},
    stop(){session?.stop();},
  });
}
