import {expect,it,vi} from 'vitest';
import {executionRuntime} from '../helpers/fc27-execution-runtime.js';
import {FC27_BUY_SERVICE_METHODS} from '../../src/adapters/ea/fc27-puzzle-buy.js';
import {createNativeTradingExecutionAdapter,createFc27TradingExecution} from '../../src/adapters/browser/fc27-trading-execution.js';
import {createInvestmentPlan} from '../../src/trading/investment-plan.js';
import {readFc27Context} from '../../src/adapters/ea/fc27-local-read.js';
import {traditionalJournalScope} from '../../src/fc27/traditional-journal.js';
import {createFcatDiagnosticLog} from '../../src/diagnostics/fcat-diagnostic-log.js';
import {tradingExecutionKey} from '../../src/trading/execution-session.js';

function fixture({diagnosticLog=null,searchReply=null}={}){
  const {root}=executionRuntime(),data=new Map(),calls=[],unassigned=[],transfer=[];let time=Date.now(),coins=40000,auction={tradeId:'9901',tradeState:'active',buyNowPrice:600,canBuy:()=>true,getSecondsRemaining:()=>60};
  const context={scope:'native-test',season:'27',platform:'console'},observable=reply=>({observe(_o,cb){cb(this,reply);},unobserve(){}});
  Object.assign(root.ItemPile,{PURCHASED:6,CLUB:7,TRANSFER:5});root.MAX_NEW_ITEMS=100;root.GameCurrency={COINS:'COINS'};root.TradeAccessLevel={ALLOWED:1};
  root.SearchType={PLAYER:'player'};root.SearchCategory={ANY:'any'};root.ItemSearchFeature={MARKET:1};
  root.UTSearchCriteriaDTO=class{constructor(){this.type=null;this.category=null;this.defId=[];this.maxBuy=0;}};
  root.UTBucketedItemSearchViewModel=class{defaultSearchCriteria={};updateSearchCriteria(c){this.searchCriteria={...c};}};
  root.UTCurrencyInputControl={PRICE_TIERS:[{min:150,inc:50},{min:1000,inc:100}],getIncrementAboveVal:n=>n+50,getIncrementBelowVal:n=>n-50};
  root.PINEventType={PAGE_VIEW:'view'};root.PIN_PAGEVIEW_EVT_TYPE='page';root.services.PIN={sendData(){}};root.UtasErrorCode={PERMISSION_DENIED:461};
  root.services.User.getUser=()=>({tradeAccess:1,coins,getCurrency:()=>({amount:coins})});
  const item=Object.assign(root.factories.Item.createItem({id:801,resourceId:901}),{type:'player',_rating:80,untradeable:false,tradable:true,
    isTradeable:()=>true,isPlayer:()=>true,isDuplicate:()=>false,pile:6,getAuctionData:()=>auction,_itemPriceLimits:{minimum:150,maximum:10000}});
  class ItemService{
    bid(card,price){calls.push(['bid',card.id,price]);coins-=price;card.purchasePrice=price;unassigned.push(card);auction={tradeState:'inactive'};
      return observable({success:true,status:200,data:{itemIds:[card.id]}});}
    move(card,pile){calls.push(['move',card.id,pile]);card.pile=pile;unassigned.splice(0);transfer.push(card);return observable({success:true,status:200,data:{itemIds:[card.id]}});}
    list(card,startPrice,buyNow,duration){calls.push(['list',card.id,startPrice,buyNow,duration]);auction={tradeId:9902,tradeState:'active',startingBid:startPrice,buyNowPrice:buyNow,currentBid:0};return observable({success:true,status:200});}
    searchTransferMarket(criteria){calls.push(['search',criteria.maxBuy]);return observable(searchReply?searchReply(criteria,item):{success:true,status:200,data:{items:criteria.maxBuy>=600?[item]:[]}});}
    clearTransferMarketCache(){}
    requestUnassignedItems(){return observable({success:true,status:200,response:{items:unassigned}});}
    requestTransferItems(){return observable({success:true,status:200});}
    refreshAuctions(){return observable({success:true,status:200});}
    requestMarketData(){return observable({success:true,status:200});}
  }
  root.services.Item=new ItemService();root.repositories.Item.getUnassignedItems=()=>unassigned;root.repositories.Item.getTransferItems=()=>transfer;
  root.repositories.Item.getPileSize=()=>100;root.repositories.Item.numItemsInCache=p=>p===5?transfer.length:unassigned.length;
  root.repositories.Item.setDirty=()=>{};root.navigator={locks:{request:async(name,_o,fn)=>fn({name,mode:'exclusive'})}};
  const digest=root.crypto.subtle.digest,hashes=new Map(FC27_BUY_SERVICE_METHODS.map(([name,hash])=>[String(ItemService.prototype[name]),hash]));
  root.crypto.subtle.digest=async(algorithm,bytes)=>{const h=hashes.get(new TextDecoder().decode(bytes));return h?Uint8Array.from(Buffer.from(h,'hex')).buffer:digest(algorithm,bytes);};
  const quote=source=>({source,definitionId:901,season:'27',platform:'console',price:1000,fetchedAt:time,expiresAt:time+300000,sourceUpdatedAt:null,error:null});
  const prices={context:()=>context,readSettings:async()=>({source:'futbin',readSources:'both'}),load:vi.fn(async()=>({references:{901:{quotes:{futbin:quote('futbin'),futgg:quote('futgg')}}}}))};
  const plan=createInvestmentPlan({context,id:'native-plan',now:time,advice:{platform:'console',validUntil:time+300000,suggestions:[{definitionId:901,name:'New purchase only',rating:80,
    nationId:1,leagueId:2,teamId:3,preferredPosition:'CM',sourceCount:2,ggQuote:quote('futgg'),resaleEstimate:1000,buyCeiling:650,reason:'price spread'}]}});
  const adapterFactory=options=>createNativeTradingExecutionAdapter({...options,now:()=>time,sleep:async ms=>{time+=ms;}});
  const service=createFc27TradingExecution({root,prices,get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),liveEnabled:true,adapterFactory,diagnosticLog});
  return {root,prices,plan,service,data,calls,transfer,context,adapterFactory,advance:ms=>time+=ms,sell:()=>{auction={...auction,tradeState:'closed',currentBid:1000,isSold:()=>true};},scope:traditionalJournalScope(readFc27Context(root))};
}
it('runs the real desk session through the original EA buyer/mover/lister and independent readback',async()=>{
  const f=fixture();const prepared=f.service.prepare(f.plan);expect(prepared.balance).toBe(40000);expect(f.calls).toEqual([]);
  const result=await f.service.start({plan:f.plan,approved:true});expect(result.record.reason).toBeNull();expect(result.record.status).toBe('waiting-sales');
  expect(f.calls.filter(c=>c[0]==='bid')).toEqual([['bid',801,600]]);expect(f.calls.filter(c=>c[0]==='move')).toEqual([['move',801,5]]);
  expect(f.calls.filter(c=>c[0]==='list')).toEqual([['list',801,1000,1000,3600]]);expect(f.transfer).toHaveLength(1);
  f.sell();expect((await f.service.recover()).record.entries[0]).toMatchObject({phase:'sold',salePrice:1000,listingTradeId:'9902'});
  expect(f.calls.filter(c=>['bid','move','list'].includes(c[0]))).toHaveLength(3);
});
it.each(['empty','above-cap','valid'])('distinguishes native search results at the unchanged reviewed cap (%s)',async mode=>{
  const log=createFcatDiagnosticLog({gmGetValue:async()=>null,gmSetValue:async()=>{},version:'27.0.99'});
  const f=fixture({diagnosticLog:log,searchReply:(_criteria,item)=>({success:true,status:200,data:{items:mode==='empty'?[]:mode==='above-cap'
    ?[{...item,getAuctionData:()=>({...item.getAuctionData(),buyNowPrice:700})}]:[item]},privateToken:'PRIVATE_SEARCH_TOKEN'})});
  f.service.prepare(f.plan);const result=await f.service.start({plan:f.plan,approved:true}),out=await log.exportPayload();
  expect(f.calls.filter(c=>c[0]==='search')).toEqual([['search',650]]);
  expect(out.criticalEntries).toContainEqual(expect.objectContaining({area:'trading',event:'execution-search',phase:'search',definitionId:901,
    maxBuy:650,referencePrice:1000,searchCeiling:650,attempt:1,attemptLimit:1,httpStatus:200,count:mode==='empty'?0:1}));
  expect(out.transactionResults).toContainEqual(expect.objectContaining({area:'trading',event:'execution-offer',definitionId:901,maxBuy:650,
    status:mode==='valid'?'accepted':'skipped',acceptedCount:mode==='valid'?1:0,responseCount:mode==='empty'?0:1,
    ...(mode==='valid'?{actualPrice:600}:{reason:'DESK_EXECUTION_NO_OFFER'})}));
  expect(JSON.stringify(out)).not.toMatch(/PRIVATE_SEARCH_TOKEN|native-test|itemId|tradeId|accountScope/);
  if(mode==='valid'){expect(result.record.status).toBe('waiting-sales');expect(f.calls.filter(c=>c[0]==='bid')).toEqual([['bid',801,600]]);}
  else{expect(result.record.status).toBe('completed');expect(result.record.entries[0]).toMatchObject({phase:'skipped',reason:'DESK_EXECUTION_NO_OFFER',offer:null});
    expect(f.calls.filter(c=>['bid','move','list'].includes(c[0]))).toEqual([]);
    const reads=f.calls.length;await f.service.recover();expect(f.calls).toHaveLength(reads);}
});
it.each([401,429,503])('exports native search failures without misreporting no offer or retrying (%i)',async status=>{
  const log=createFcatDiagnosticLog({gmGetValue:async()=>null,gmSetValue:async()=>{},version:'27.0.99'});
  const f=fixture({diagnosticLog:log,searchReply:()=>({success:false,status,error:{code:461},data:{items:[]}})});
  f.service.prepare(f.plan);const result=await f.service.start({plan:f.plan,approved:true}),out=await log.exportPayload();
  expect(result.record.reason).toBe('DESK_EXECUTION_SEARCH_UNCONFIRMED');expect(result.record.entries[0].phase).toBe('waiting');
  expect(f.calls).toEqual([['search',650]]);
  expect(out.criticalEntries).toContainEqual(expect.objectContaining({event:'execution-search',phase:'search',httpStatus:status,errorCode:461}));
  expect(out.transactionResults).toContainEqual(expect.objectContaining({event:'execution-offer',status:'blocked',reason:'DESK_EXECUTION_SEARCH_UNCONFIRMED',httpStatus:status}));
  expect(out.transactionResults.some(e=>e.reason==='DESK_EXECUTION_NO_OFFER')).toBe(false);
});
it('logs the exact public references that revoke a plan without buying or increasing a cap',async()=>{
  const log=createFcatDiagnosticLog({gmGetValue:async()=>null,gmSetValue:async()=>{},version:'27.0.99'}),f=fixture({diagnosticLog:log});
  const load=f.prices.load.getMockImplementation();f.prices.load.mockImplementation(async()=>{const r=await load();r.references[901].quotes.futbin.price=950;return r;});
  f.service.prepare(f.plan);expect((await f.service.start({plan:f.plan,approved:true})).record.reason).toBe('DESK_EXECUTION_REFERENCE_CHANGED');
  expect((await log.exportPayload()).criticalEntries).toContainEqual(expect.objectContaining({event:'execution-reference',definitionId:901,
    phase:'reference-prices',status:'blocked',futbinPrice:950,futggPrice:1000,referencePrice:950,maxBuy:650,reason:'DESK_EXECUTION_REFERENCE_CHANGED'}));
  expect(f.calls).toEqual([]);
});
it('forwards delayed recheck to the native buyer at the same cap and buys only once',async()=>{
  let available=false;const f=fixture({searchReply:(_c,item)=>({success:true,status:200,data:{items:available?[item]:[]}})});
  f.service.prepare(f.plan);expect((await f.service.start({plan:f.plan,approved:true})).record.entries[0].phase).toBe('skipped');
  available=true;const result=await f.service.start({resume:true,retryNoOffer:true,expectedPlanId:f.plan.id,approved:true});
  expect(result.record.plan).toEqual(f.plan);expect(result.record.status).toBe('waiting-sales');
  expect(f.calls.filter(c=>c[0]==='search')).toEqual([['search',650],['search',650]]);
  expect(f.calls.filter(c=>c[0]==='bid')).toEqual([['bid',801,600]]);
  await expect(f.service.start({resume:true,retryNoOffer:true,expectedPlanId:f.plan.id,approved:true})).rejects.toThrow('DESK_RECHECK_NO_CANDIDATES');
  expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(1);
});
it('rechecks the original expiry after durable intent/pacing and before native payment',async()=>{
  const f=fixture();f.service.prepare(f.plan);let expired=false;
  const result=await f.service.start({plan:f.plan,approved:true,onProgress:record=>{if(!expired&&record.entries.some(e=>e.phase==='buy-pending')){expired=true;f.advance(300001);}}});
  expect(result.record.reason).toBe('DESK_PLAN_EXPIRED');expect(result.record.entries[0]).toMatchObject({phase:'waiting',offer:null});
  expect(f.calls.filter(c=>['bid','move','list'].includes(c[0]))).toEqual([]);
});
it('cannot execute a changed or unprepared plan, and does not trade just because X or a page opens',async()=>{
  const f=fixture();await f.service.inspect();await f.service.recover();expect(f.calls).toEqual([]);
  await expect(f.service.start({plan:f.plan,approved:true})).rejects.toThrow('APPROVAL_REQUIRED');f.service.prepare(f.plan);
  await expect(f.service.start({plan:{...f.plan,capitalLimit:30000},approved:true})).rejects.toThrow('APPROVAL_REQUIRED');expect(f.calls).toEqual([]);
});
it('exports the precise failed automatic-trading stage and reviewed-method evidence without a payment or private identities',async()=>{
  const log=createFcatDiagnosticLog({gmGetValue:async()=>null,gmSetValue:async()=>{},version:'27.0.96'}),f=fixture({diagnosticLog:log});
  Object.getPrototypeOf(f.root.services.Item).bid=vi.fn();f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});
  const out=await log.exportPayload();expect(out.transactionResults.at(-1)).toMatchObject({area:'trading',event:'execution-result',phase:'runtime-check',status:'paused',
    reason:'FC27_TRANSACTION_METHOD_UNREVIEWED',methodPath:'service.bid',requestedCount:1});
  expect(out.transactionResults.at(-1).observedHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(out)).not.toMatch(/native-test|itemId|tradeId|accountScope/);expect(f.root.services.Item.bid).not.toHaveBeenCalled();
});
it('exports a restored old paused journal without repeating the trade or rereading the market',async()=>{
  const f=fixture(),load=f.prices.load.getMockImplementation();f.prices.load.mockImplementation(async()=>{const r=await load();r.references[901].quotes.futbin.price=500;return r;});
  f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});const before=structuredClone([...f.data]),reads=f.prices.load.mock.calls.length;
  const log=createFcatDiagnosticLog({gmGetValue:async()=>null,gmSetValue:async()=>{},version:'27.0.96'});
  const upgraded=createFc27TradingExecution({root:f.root,prices:f.prices,get:async(k,fallback)=>structuredClone(f.data.get(k)??fallback),
    set:async(k,v)=>f.data.set(k,structuredClone(v)),liveEnabled:true,diagnosticLog:log,adapterFactory:f.adapterFactory});
  await upgraded.inspect();expect((await log.exportPayload()).transactionResults.at(-1)).toMatchObject({area:'trading',event:'execution-state',phase:'inspect',source:'stored-journal',status:'paused',reason:'DESK_EXECUTION_REFERENCE_CHANGED'});
  expect(f.calls).toEqual([]);expect(f.prices.load).toHaveBeenCalledTimes(reads);expect([...f.data]).toEqual(before);
});
it.each(['throw','reject'])('keeps exact native buy/move/list behavior when the optional diagnostic sink fails (%s)',async mode=>{
  const log={record:()=>{if(mode==='throw')throw Error('private diagnostic failure');return Promise.reject(Error('private diagnostic failure'));}},f=fixture({diagnosticLog:log});
  f.service.prepare(f.plan);const result=await f.service.start({plan:f.plan,approved:true});expect(result.record.status).toBe('waiting-sales');
  expect(f.calls.filter(c=>['bid','move','list'].includes(c[0]))).toEqual([['bid',801,600],['move',801,5],['list',801,1000,1000,3600]]);
});
it('preserves ad main unknown journals and refuses simultaneous unsettled Gallery work',async()=>{
  const f=fixture(),key=`fcat-fc27-gallery-purchase-pending:${f.scope}`,value={unknown:true};f.data.set(key,value);f.service.prepare(f.plan);
  await expect(f.service.start({plan:f.plan,approved:true})).rejects.toThrow('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
  expect(f.data.get(key)).toEqual(value);expect(f.calls).toEqual([]);
});
it('revalidates public prices before any payment and never chases a lowered sell reference',async()=>{
  const f=fixture(),load=f.prices.load.getMockImplementation();f.prices.load.mockImplementation(async()=>{const r=await load();r.references[901].quotes.futbin.price=500;return r;});
  f.service.prepare(f.plan);const result=await f.service.start({plan:f.plan,approved:true});expect(result.record.reason).toBe('DESK_EXECUTION_REFERENCE_CHANGED');expect(f.calls).toEqual([]);
});
it('leaves an unknown native listing intent intact when readback is lost, and never lists it again',async()=>{
  const f=fixture(),original=f.root.services.Item.list;let failRead=false;
  f.root.services.Item.list=function(...args){const r=original.apply(this,args);failRead=true;return r;};
  f.root.services.Item.requestTransferItems=()=>({observe(_o,cb){cb(this,{success:!failRead,status:failRead?503:200});},unobserve(){}});
  f.service.prepare(f.plan);const first=await f.service.start({plan:f.plan,approved:true});expect(first.record.status).toBe('recovery-required');
  failRead=false;const recovered=await f.service.recover();expect(recovered.record.entries[0].phase).toBe('listed');
  await f.service.start({resume:true,approved:true});expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(1);
});
it.each([401,403,429,503])('does not list on a failed price-limit refresh even when cached limits look valid (%i)',async status=>{
  const f=fixture();f.root.services.Item.requestMarketData=()=>({observe(_o,cb){cb(this,{success:false,status});},unobserve(){}});
  f.service.prepare(f.plan);const r=await f.service.start({plan:f.plan,approved:true});expect(r.record.status).toBe('paused');
  expect(r.record.entries[0].phase).toBe('transfer');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(1);
});
it.each([
  ['requestUnassignedItems','purchase-state-read',{success:false,status:503,error:{code:461,message:'PRIVATE_NATIVE_MESSAGE'}},'read-status-unconfirmed'],
  ['requestTransferItems','transfer-items-read',{success:true},'read-http-missing'],
  ['requestTransferItems','transfer-items-read',{success:true,status:503,code:461},'read-http-rejected'],
  ['requestMarketData','price-limits-read',{success:false,status:429,error:{code:461}},'read-status-unconfirmed'],
])('exports the exact failed native read and fixed mismatch/HTTP metadata (%s)',async(method,phase,reply,mismatch)=>{
  const log=createFcatDiagnosticLog({gmGetValue:async()=>null,gmSetValue:async()=>{},version:'27.0.96'}),f=fixture({diagnosticLog:log});
  f.root.services.Item[method]=()=>({observe(_o,cb){cb(this,reply);},unobserve(){}});f.service.prepare(f.plan);
  const result=await f.service.start({plan:f.plan,approved:true}),out=await log.exportPayload();
  expect(result.record.reason).toBe('DESK_EXECUTION_READ_UNCONFIRMED');
  const read=out.criticalEntries.find(entry=>entry.event==='execution-response'&&entry.phase===phase&&entry.mismatch===mismatch);
  expect(read).toBeDefined();expect(out.transactionResults.at(-1)).toMatchObject({phase,reason:'DESK_EXECUTION_READ_UNCONFIRMED',mismatch});
  if(reply.status!==undefined)expect(read.httpStatus).toBe(reply.status);else expect(read).not.toHaveProperty('httpStatus');
  if(reply.error?.code||reply.code)expect(read.errorCode).toBe(461);
  expect(JSON.stringify(out)).not.toMatch(/PRIVATE_NATIVE_MESSAGE|native-test|itemId|tradeId|accountScope/);
  expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
  if(method!=='requestMarketData')expect(f.calls).toEqual([]);
});
it('locates a failed sale-receipt read without re-listing or discarding the last confirmed listing',async()=>{
  const log=createFcatDiagnosticLog({gmGetValue:async()=>null,gmSetValue:async()=>{},version:'27.0.96'}),f=fixture({diagnosticLog:log});
  f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});
  const before=structuredClone(f.data.get(tradingExecutionKey(f.scope)));
  f.root.services.Item.refreshAuctions=()=>({observe(_o,cb){cb(this,{success:false,status:503});},unobserve(){}});
  await expect(f.service.recover()).rejects.toThrow('DESK_EXECUTION_READ_UNCONFIRMED');
  const out=await log.exportPayload();expect(out.transactionResults.at(-1)).toMatchObject({phase:'sale-receipts-read',mismatch:'sale-status-unconfirmed'});
  expect(f.data.get(tradingExecutionKey(f.scope))).toEqual(before);expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);
});
it('rechecks old pristine READ_UNCONFIRMED through real native reads, preserving failure and using no quotes or mutations',async()=>{
  const f=fixture(),key=tradingExecutionKey(f.scope),old={schema:1,status:'paused',reason:'DESK_EXECUTION_READ_UNCONFIRMED',plan:f.plan,
    entries:f.plan.rows.map(row=>({definitionId:row.definitionId,phase:'waiting',offer:null}))};f.data.set(key,old);
  let success=false;const purchase=vi.fn(()=>({observe(_o,cb){cb(this,{success,status:success?200:503});},unobserve(){}}));
  f.root.services.Item.requestUnassignedItems=purchase;
  await expect(f.service.recover()).rejects.toThrow('DESK_EXECUTION_READ_UNCONFIRMED');expect(f.data.get(key)).toEqual(old);
  success=true;const result=await f.service.recover();expect(result.record.reason).toBeNull();expect(result.record.entries).toEqual(old.entries);
  expect(purchase).toHaveBeenCalledTimes(2);expect(f.prices.load).not.toHaveBeenCalled();expect(f.calls).toEqual([]);
});
