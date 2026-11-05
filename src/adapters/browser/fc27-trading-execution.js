import {createTradingExecutionSession} from '../../trading/execution-session.js';
import {validateInvestmentPlan} from '../../trading/investment-plan.js';
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
export async function createNativeTradingExecutionAdapter({root,plan,prices,canWrite,assertCurrent,readOnly=false,needsPurchases=true,
  now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),buyFactory=createFc27PuzzleBuyAdapter,tradeFactory=createEaTradeAdapter}){
  const context=readFc27Context(root),service=root.services?.Item;
  const functions=Object.fromEntries(['bid','move','list','searchTransferMarket','requestTransferItems','requestUnassignedItems'].map(k=>[k,service?.[k]]));
  if(Object.values(functions).some(fn=>typeof fn!=='function'))fail('DESK_EXECUTION_RUNTIME_UNAVAILABLE');
  const assert=()=>{assertCurrent();if(!same(context,readFc27Context(root))||root.services.Item!==service||Object.keys(functions).some(k=>functions[k]!==service[k]))fail('DESK_CONTEXT_CHANGED');};
  let reference=null,lastRequest=0,lastReadAt=-Infinity;
  const bounded=task=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('DESK_EXECUTION_RESPONSE_UNCONFIRMED')),20000);
    Promise.resolve().then(task).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
  const pace=async()=>{assert();const left=3000-(now()-lastRequest);if(left>0)await sleep(left);assert();lastRequest=now();};
  const trade=tradeFactory(root),saleReader=createFc27GallerySaleReader(root);
  const verify=async result=>{assert();if(!['completed','accepted'].includes(result?.status)||result?.response?.success!==true
    ||!Number.isSafeInteger(result.response.status)||result.response.status<200||result.response.status>=300)fail('DESK_EXECUTION_READ_UNCONFIRMED');return result;};
  const read=async(force=false)=>{assert();if(!force&&now()-lastReadAt<=1000)return;
    await pace();await verify(await bounded(()=>trade.refreshPurchaseState()));await pace();await verify(await bounded(()=>trade.refreshTransferItems()));assert();lastReadAt=now();};
  const seen=e=>trade.inspectPurchase({id:e.offer.itemId,definitionId:e.definitionId,pile:'unassigned'});
  let buyer=null;
  if(!readOnly&&needsPurchases){
    const policy=await prices.readSettings();assert();
    const snapshot=await prices.load(plan.rows.map(r=>r.definitionId),{purpose:'trading',sources:['futbin','futgg'],futbinBatch:false,
      policy:{...policy,futbinPlatform:plan.context.platform==='pc'?'pc':'ps'},deadlineAt:now()+30000,isCurrent:()=>{assert();return true;}});assert();
    reference=new Map();
    for(const row of plan.rows){const q=snapshot.references?.[row.definitionId]?.quotes;
      const valid=source=>q?.[source]?.source===source&&q[source].definitionId===row.definitionId&&q[source].platform===plan.context.platform
        &&q[source].season==='27'&&!q[source].error&&Number.isSafeInteger(q[source].price)&&q[source].price>=150
        &&q[source].fetchedAt<=now()&&q[source].expiresAt>now()
        &&(source!=='futbin'||q[source].futbinPlatform==null||q[source].futbinPlatform===(plan.context.platform==='pc'?'pc':'ps'))
        &&(q[source].sourceUpdatedAt==null||q[source].sourceUpdatedAt<=now()&&now()-q[source].sourceUpdatedAt<=1800000);
      if(!valid('futbin')||!valid('futgg')||Math.min(q.futbin.price,q.futgg.price)<row.sellPrice
        ||Math.max(q.futbin.price,q.futgg.price)/Math.min(q.futbin.price,q.futgg.price)>1.15)fail('DESK_EXECUTION_REFERENCE_CHANGED');
      reference.set(row.definitionId,Math.min(q.futbin.price,q.futgg.price));
    }
    buyer=await buyFactory(root,{canWrite:()=>{assert();return canWrite();},assertTarget:assert,verifyCurrent:assert,
      verifySquad:assert,referencePrice:async row=>reference.get(row.definitionId),playerDetails:new Map(plan.rows.map(row=>[row.definitionId,{...row,_rating:row.rating}])),
      attempts:1,skipRejectedListings:true,wait:async()=>{await pace();}});
    await buyer.verifySquad({scope:traditionalJournalScope(context),entries:plan.rows.map(row=>({definitionId:row.definitionId}))});
  }
  const writable=()=>{assert();if(!canWrite())fail('DESK_EXECUTION_NOT_SENT');};
  const permit=async action=>{await pace();writable();const p=await trade.acquireRequestPermit(action);writable();if(p.status!=='acquired')fail('DESK_EXECUTION_SERVICE_STOP');return {requestPermit:p.permit};};
  return {
    async capabilities(){if(now()-lastReadAt>10000)await read(true);const cap=trade.inspectCapabilities();
      if(!cap.runtimeReady)return {canTrade:false,balance:null,freeSlots:0};
      const {max,used}=cap.transferCapacity??{};
      const unassigned=root.repositories.Item.numItemsInCache(root.ItemPile.PURCHASED),unassignedMax=root.MAX_NEW_ITEMS;
      return {canTrade:cap.canTrade===true&&Number.isSafeInteger(unassigned)&&Number.isSafeInteger(unassignedMax)&&unassigned<unassignedMax,
        balance:cap.coins,freeSlots:Number.isSafeInteger(max)&&Number.isSafeInteger(used)?Math.max(0,max-used):0};},
    async find(row){await pace();assert();const offer=await buyer.find(row.definitionId,row.buyCap);assert();
      if(offer?.unavailable)fail('DESK_EXECUTION_SEARCH_UNCONFIRMED');return offer;},
    async buy(offer){await pace();writable();lastReadAt=-Infinity;try{return await buyer.buy(offer);}catch(error){if(error.message==='FC27_BUY_DISABLED')fail('DESK_EXECUTION_NOT_SENT');throw error;}},
    async move(e){await read();const item=seen(e)?.candidate?.item;if(item?.pile!=='unassigned')fail('DESK_EXECUTION_RECEIPT_UNCONFIRMED');
      const p=await permit('purchase-route');writable();lastReadAt=-Infinity;
      const result=await bounded(()=>{writable();return trade.routePurchasedItem(item,'transfer',p);});assert();return result;},
    async checkListing(e,row){await read();const item=seen(e)?.candidate;
      if(item?.item?.pile!=='transfer'||item.tradeable!==true||!['none','inactive'].includes(item.auction?.state))fail('DESK_EXECUTION_RECEIPT_UNCONFIRMED');
      await pace();const limits=await bounded(()=>trade.inspectPriceLimits(item.item,{refresh:true}));assert();const limit=limits.after;
      if(limits.refreshStatus!=='completed'||limits.response?.success!==true||!Number.isSafeInteger(limits.response.status)||limits.response.status<200||limits.response.status>=300)fail('DESK_EXECUTION_READ_UNCONFIRMED');
      if(!limit?.hasPriceLimits||!Number.isSafeInteger(limit.minimum)||!Number.isSafeInteger(limit.maximum)||row.sellPrice<limit.minimum||row.sellPrice>limit.maximum)fail('DESK_EXECUTION_LISTING_LIMIT');
    },
    async list(e,row){const ref={id:e.offer.itemId,definitionId:e.definitionId,pile:'transfer'};
      const p=await permit('list');writable();lastReadAt=-Infinity;
      return bounded(()=>{writable();return trade.listItem(ref,{startPrice:row.sellPrice,buyNow:row.sellPrice,durationSeconds:plan.durationSeconds},p);});},
    async reconcile(e,row){
      for(let attempt=0;attempt<3;attempt++){
        // Receipts always force independent reads; the tiny no-mutation cache
        // only removes redundant preflight reads, never creates a receipt.
        await read(true);const item=seen(e),candidate=item?.candidate;
        if(candidate?.item?.id!==e.offer.itemId||candidate?.item?.definitionId!==e.definitionId)continue;
        if(e.phase==='buy-pending'&&(e.buyAcknowledged===true||item.purchasePrice===e.offer.price)&&candidate.item.pile==='unassigned')return {phase:'bought'};
        if(e.phase==='move-pending'&&candidate.item.pile==='transfer'&&['none','inactive'].includes(candidate.auction?.state))return {phase:'transfer'};
        if(e.phase==='list-pending'){
          const proof=galleryListingEvidence({item:{id:e.offer.itemId,definitionId:e.definitionId,pile:'transfer'},startPrice:row.sellPrice,buyNow:row.sellPrice,
            response:e.listAcknowledged?{success:true,status:200}:null},item);
          if(proof.matched)return {phase:'listed',listingTradeId:proof.listingTradeId};
        }
        if(e.phase==='listed'){
          await pace();const sales=await bounded(()=>saleReader.refreshGallerySaleReceipts());assert();if(sales.status!=='observed')fail('DESK_EXECUTION_READ_UNCONFIRMED');
          const receipt=sales.receipts.find(r=>r.itemId===e.offer.itemId&&r.definitionId===e.definitionId&&r.listingTradeId===e.listingTradeId);
          if(receipt?.sold===true&&Number.isSafeInteger(receipt.soldPrice)&&receipt.soldPrice>=row.sellPrice)return {phase:'sold',salePrice:receipt.soldPrice,soldAt:now()};
          return null;
        }
        if(attempt<2)await sleep(1000*(attempt+1));
      }return null;
    },cancel(){buyer?.cancel();},
  };
}

export function createFc27TradingExecution({root,prices,get,set,liveEnabled,onProgress=()=>{},adapterFactory=createNativeTradingExecutionAdapter}){
  let session=null,bound=null,prepared=null,progress=null;
  const create=()=>{
    const context=readFc27Context(root),deskContext=prices.context(),scope=traditionalJournalScope(context);
    const binding=JSON.stringify([context,deskContext]);if(bound===binding)return session;
    session?.stop();bound=binding;prepared=null;
    const assertCurrent=()=>{if(!same(context,readFc27Context(root))||!same(deskContext,prices.context()))fail('DESK_CONTEXT_CHANGED');};
    const persistence=createFc27TransactionPersistence({context,gmGetValue:get,gmSetValue:set,lockManager:root.navigator?.locks});
    session=createTradingExecutionSession({context:deskContext,scope,get,set,exclusive:persistence.exclusive,assertCurrent,onProgress:value=>{onProgress(value);progress?.(value);},
      checkOtherTransactions:async()=>{const record=await persistence.journal.read(scope);if(record&&!isTerminalTraditionalJournal(record))fail('FC27_RECOVERY_REQUIRED');
        await assertGalleryRelistSettled(get,scope);await assertNoGalleryListingPending(get,scope);
        if(await get(galleryPurchasePendingKey(scope),null)!==null)fail('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');},
      createAdapter:async(plan,options)=>{const adapter=await adapterFactory({root,plan,prices,...options,canWrite:()=>liveEnabled===true&&persistence.lock.hasExclusiveAccess(scope)&&options.canWrite()});
        const capabilities=adapter.capabilities.bind(adapter);return {...adapter,capabilities:async()=>{
          const occupied=deskFunding(readDesk(await get(`fcat-fc27-trading-desk-v1:${deskContext.scope}`,null))).occupied;
          assertCurrent();return {...await capabilities(),occupied};}};}});
    return session;
  };
  return Object.freeze({
    prepare(plan){create();validateInvestmentPlan(plan,prices.context());prepared=structuredClone(plan);
      const balance=root.services?.User?.getUser?.()?.getCurrency?.(root.GameCurrency?.COINS)?.amount;
      return {plan:structuredClone(plan),balance:Number.isSafeInteger(balance)&&balance>=0?balance:null};},
    inspect:()=>create().inspect(),recover:()=>create().recover(),
    async start({plan=null,resume=false,approved=false,onProgress:callback=null}={}){const current=create();if(liveEnabled!==true)fail('DESK_EXECUTION_DISABLED');
      if(!resume&&(!prepared||!same(prepared,plan)))fail('DESK_EXECUTION_APPROVAL_REQUIRED');progress=callback;
      try{return await current.execute({plan,resume,approved});}finally{progress=null;}},
    stop(){session?.stop();},
  });
}
