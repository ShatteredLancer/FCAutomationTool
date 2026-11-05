import {expect,it,vi} from 'vitest';
import {createInvestmentPlan,validateInvestmentPlan} from '../../src/trading/investment-plan.js';
import {createTradingExecutionSession,readTradingExecution,tradingExecutionKey} from '../../src/trading/execution-session.js';
import {createNativeTradingExecutionAdapter,createFc27TradingExecution} from '../../src/adapters/browser/fc27-trading-execution.js';
import {executionRuntime} from '../helpers/fc27-execution-runtime.js';
import {FC27_BUY_SERVICE_METHODS} from '../../src/adapters/ea/fc27-puzzle-buy.js';
import {readFc27Context} from '../../src/adapters/ea/fc27-local-read.js';
import {traditionalJournalScope} from '../../src/fc27/traditional-journal.js';
import {createEaTradeAdapter} from '../../src/adapters/ea/trade.js';

const at=1793851200000,context={scope:'event-fixture',season:'27',platform:'console'};
const sourceUrl='https://x.com/FutSheriff/status/1986119507514294272';
const event=(extra={})=>({sourceUrl,sourceAt:at-1000,entryCeiling:700,strictBelow:true,entryQuote:'Candidate under 700',exitMode:'target-hold',
  reviewAt:at+21600000,targetBasis:'required-return',status:'leak',evidence:'native-thread-post',...extra});
const quote=(source,price=700,time=at)=>({source,definitionId:901,season:'27',platform:'console',price,fetchedAt:time,expiresAt:time+300000,sourceUpdatedAt:null});
const suggestion=(extra={})=>({strategy:'evo-event',definitionId:901,name:'Candidate',rating:80,nationId:1,leagueId:2,teamId:3,preferredPosition:'CM',futbinId:501,
  sourceCount:2,ggQuote:{...quote('futgg'),definitionId:extra.definitionId??901},buyCeiling:700,resaleEstimate:1000,reason:'Fixed scenario, not a forecast',event:event(),...extra});
const makePlan=(rows=[suggestion()],extra={})=>createInvestmentPlan({advice:{platform:'console',validUntil:at+300000,suggestions:rows},context,now:at,id:'event-plan',...extra});

it('retains a frozen, explicitly scenario-based event, strict source ceiling and unchanged tax math',()=>{
  const p=makePlan();expect(p.rows[0]).toMatchObject({strategy:'evo-event',event:event(),quantity:1,buyCap:650,sellPrice:1000,expectedNet:300});
  expect(validateInvestmentPlan(p,context)).toEqual(p);expect(p.rows[0].event).not.toBe(event());
  const defaults=event();delete defaults.exitMode;delete defaults.reviewAt;
  expect(makePlan([suggestion({event:defaults})]).rows[0].event).toMatchObject({exitMode:'target-hold',reviewAt:at+21600000});
});
it.each([{sourceUrl:sourceUrl+'?s=20'},{sourceAt:at+1},{entryCeiling:700.5},{strictBelow:'true'},{entryQuote:'x'.repeat(181)},
  {exitMode:'loss-sale'},{reviewAt:at},{reviewAt:at+86400001},{targetBasis:'forecast'},{status:'live'},{evidence:'model-guess'}])('rejects invalid event authority (%j)',bad=>{
  expect(()=>makePlan([suggestion({event:event(bad)})])).toThrow('NO_CANDIDATES');
  const p=makePlan();p.rows[0].strategy='evo-event';p.rows[0].event=event(bad);expect(()=>validateInvestmentPlan(p,context)).toThrow('INVALID');
});
it('preserves legacy rows, six exact versions, aggregate/unit/existing exposure caps and strict-below rounding',()=>{
  const legacy=suggestion();delete legacy.event;delete legacy.strategy;
  expect(makePlan([legacy]).rows[0]).not.toHaveProperty('event');expect(makePlan([legacy]).rows[0].buyCap).toBe(700);
  expect(makePlan([suggestion({event:event({entryCeiling:1000}),buyCeiling:1200,resaleEstimate:1500})],{unitLimit:2000}).rows[0].buyCap).toBe(950);
  expect(makePlan([suggestion()],{unitLimit:600}).rows[0].buyCap).toBe(600);
  const rows=Array.from({length:8},(_,i)=>suggestion({definitionId:901+i}));expect(makePlan(rows).rows).toHaveLength(6);
  expect(makePlan([suggestion(),suggestion()]).rows).toHaveLength(1);
  expect(()=>makePlan([suggestion()],{capitalLimit:1000,existingCapital:400})).toThrow('NO_CANDIDATES');
  const p=makePlan();p.rows[0].buyCap=700;p.rows[0].expectedNet=250;p.allocated=700;p.expectedNet=250;
  expect(()=>validateInvestmentPlan(p,context)).toThrow('INVALID');
});

function engineFixture(){
  const data=new Map(),owned=new Map(),diagnostics=[];let time=at,current=true,inLock=false,session,options;
  const adapter={capabilities:vi.fn(async()=>({canTrade:true,balance:40000,freeSlots:50})),
    find:vi.fn(async row=>({definitionId:row.definitionId,itemId:row.definitionId+1000,tradeId:String(row.definitionId+9000),price:600})),
    buy:vi.fn(async offer=>{expect(inLock).toBe(true);owned.set(offer.itemId,'bought');return {...offer,status:'bought'};}),
    move:vi.fn(async e=>{owned.set(e.offer.itemId,'transfer');return {status:'completed'};}),
    eventExit:vi.fn(async()=>({ready:false,reviewRequired:time>=at+21600000})),checkListing:vi.fn(async()=>{}),
    list:vi.fn(async e=>{expect(data.get(tradingExecutionKey('scope')).entries.find(v=>v.definitionId===e.definitionId).phase).toBe('list-pending');
      owned.set(e.offer.itemId,'listed');return {status:'accepted',response:{success:true,status:200}};}),
    reconcile:vi.fn(async e=>{const phase=owned.get(e.offer.itemId);return phase?{phase,...(phase==='listed'?{listingTradeId:'9902'}:{})}:null;}),cancel:vi.fn()};
  const args={context,scope:'scope',get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),
    exclusive:async(_scope,fn)=>{inLock=true;try{return await fn();}finally{inLock=false;}},assertCurrent:()=>{if(!current)throw Error('DESK_CONTEXT_CHANGED');},
    createAdapter:vi.fn(async(_plan,opts)=>{options=opts;return adapter;}),now:()=>time,onDiagnostic:d=>diagnostics.push(d)};
  const reload=()=>session=createTradingExecutionSession(args);reload();
  return {adapter,data,owned,diagnostics,args,get session(){return session;},get options(){return options;},reload,advance:ms=>time+=ms,changeAccount:()=>current=false};
}
const run=f=>f.session.execute({plan:makePlan(),approved:true});
const exits=f=>f.session.execute({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});
it('buys/moves once, holds unlisted durably and counts held ownership',async()=>{
  const f=engineFixture(),r=await run(f);expect(r.record.status).toBe('waiting-events');expect(r.record.entries[0].phase).toBe('holding');
  expect(f.adapter.buy).toHaveBeenCalledOnce();expect(f.adapter.move).toHaveBeenCalledOnce();expect(f.adapter.list).not.toHaveBeenCalled();
  expect(f.diagnostics.at(-1)).toMatchObject({ownedCount:1,spent:600});expect(readTradingExecution(r.record,context)).toEqual(r.record);
  expect((await f.reload().inspect()).record.entries[0].phase).toBe('holding');
});
it('lists the frozen target once only when the public event exit is ready',async()=>{
  const f=engineFixture();await run(f);f.adapter.eventExit.mockResolvedValue({ready:true,reviewRequired:false});const r=await exits(f);
  expect(r.record.status).toBe('waiting-sales');expect(r.record.entries[0].phase).toBe('listed');expect(f.adapter.list).toHaveBeenCalledOnce();
  expect(f.adapter.list.mock.calls[0][1].sellPrice).toBe(1000);expect(f.options.needsPurchases).toBe(false);
  await f.reload().execute({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});expect(f.adapter.list).toHaveBeenCalledOnce();expect(f.adapter.buy).toHaveBeenCalledOnce();
});
it('lists an explicitly chosen immediate target without waiting for a scenario price trigger',async()=>{
  const f=engineFixture(),p=makePlan([suggestion({event:event({exitMode:'immediate-target'})})]);
  const r=await f.session.execute({plan:p,approved:true});expect(r.record.entries[0].phase).toBe('listed');expect(f.adapter.eventExit).not.toHaveBeenCalled();
});
it('keeps an unknown future listing across reload without duplicate dispatch',async()=>{
  const f=engineFixture();await run(f);f.adapter.eventExit.mockResolvedValue({ready:true});f.adapter.list.mockResolvedValue({status:'unknown'});
  const r=await exits(f);expect(r.record.status).toBe('recovery-required');expect(r.record.entries[0].phase).toBe('list-pending');
  await f.reload().recover();await exits(f);expect(f.adapter.list).toHaveBeenCalledOnce();expect(f.adapter.move).toHaveBeenCalledOnce();
});
it('pauses at the review deadline without loss sales or pending intents',async()=>{
  const f=engineFixture();await run(f);f.advance(21600000);f.adapter.eventExit.mockResolvedValue({ready:true});const r=await exits(f);
  expect(r.record).toMatchObject({status:'paused',reason:'DESK_EVENT_REVIEW_REQUIRED'});expect(r.record.entries[0].phase).toBe('holding');expect(f.adapter.list).not.toHaveBeenCalled();
});
it('rechecks the deadline after public quote awaits and after listing-limit awaits',async()=>{
  for(const stage of ['eventExit','checkListing']){const f=engineFixture();await run(f);f.adapter.eventExit.mockResolvedValue({ready:true});
    f.adapter[stage].mockImplementation(async()=>{f.advance(21600000);return {ready:true};});
    expect((await exits(f)).record.reason).toBe('DESK_EVENT_REVIEW_REQUIRED');expect(f.adapter.list).not.toHaveBeenCalled();}
});
it('event-only passes require resume+approval and never buy waiting rows or route bought/transfer rows',async()=>{
  const f=engineFixture();await expect(f.session.execute({plan:makePlan(),approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'})).rejects.toThrow('RESUME_REQUIRED');
  await expect(f.session.execute({resume:true,eventExitsOnly:true,expectedPlanId:'event-plan'})).rejects.toThrow('APPROVAL_REQUIRED');
  const p=makePlan([suggestion(),suggestion({definitionId:902}),suggestion({definitionId:903}),suggestion({definitionId:904})]);
  const entries=p.rows.map((row,i)=>({definitionId:row.definitionId,phase:['holding','waiting','bought','transfer'][i],offer:i===1?null:{definitionId:row.definitionId,itemId:1000+i,tradeId:String(9000+i),price:600}}));
  f.data.set(tradingExecutionKey('scope'),{schema:1,status:'paused',plan:p,entries,reason:null});f.adapter.eventExit.mockResolvedValue({ready:true});await exits(f);
  expect(f.adapter.list).toHaveBeenCalledOnce();expect(f.adapter.find).not.toHaveBeenCalled();expect(f.adapter.buy).not.toHaveBeenCalled();expect(f.adapter.move).not.toHaveBeenCalled();
});
it('a pending intent anywhere makes an event-only pass entirely read-only',async()=>{
  const f=engineFixture(),p=makePlan([suggestion(),suggestion({definitionId:902})]);
  const entries=p.rows.map((r,i)=>({definitionId:r.definitionId,phase:i?'buy-pending':'holding',offer:{definitionId:r.definitionId,itemId:1000+i,tradeId:String(9000+i),price:600}}));
  f.data.set(tradingExecutionKey('scope'),{schema:1,status:'recovery-required',plan:p,entries,reason:'DESK_EXECUTION_RECEIPT_UNCONFIRMED'});
  f.adapter.eventExit.mockResolvedValue({ready:true});expect((await exits(f)).record.status).toBe('recovery-required');expect(f.options.canWrite()).toBe(false);
  expect(f.options.readOnly).toBe(true);
  expect(f.adapter.list).not.toHaveBeenCalled();expect(f.adapter.buy).not.toHaveBeenCalled();
});
it.each(['eventExit','checkListing'])('honors stop and account switches after %s awaits',async stage=>{
  const f=engineFixture();await run(f);f.adapter.eventExit.mockResolvedValue({ready:true});f.adapter[stage].mockImplementation(async()=>{f.session.stop();return {ready:true};});
  const r=await exits(f);expect(r.record.status).toBe('paused');expect(r.record.entries[0].phase).toBe('holding');expect(f.adapter.list).not.toHaveBeenCalled();
  const g=engineFixture();await run(g);g.adapter.eventExit.mockResolvedValue({ready:true});g.adapter[stage].mockImplementation(async()=>{g.changeAccount();return {ready:true};});
  await expect(exits(g)).rejects.toThrow('CONTEXT_CHANGED');expect(g.adapter.list).not.toHaveBeenCalled();
});
it('recovery verifies holdings/signals read-only and retains failure evidence and waiting-events',async()=>{
  const f=engineFixture();await run(f);const key=tradingExecutionKey('scope');f.data.get(key).reason='DESK_EXECUTION_REFERENCE_CHANGED';
  f.adapter.eventExit.mockResolvedValue({ready:true});const r=await f.reload().recover();expect(r.record.status).toBe('waiting-events');
  expect(r.record.reason).toBe('DESK_EXECUTION_REFERENCE_CHANGED');expect(f.options.readOnly).toBe(true);expect(f.options.canWrite()).toBe(false);expect(f.adapter.list).not.toHaveBeenCalled();
  const before=structuredClone(f.data.get(key));f.adapter.eventExit.mockRejectedValue(Error('DESK_EXECUTION_READ_UNCONFIRMED'));
  await expect(f.session.recover()).rejects.toThrow('READ_UNCONFIRMED');expect(f.data.get(key)).toEqual(before);
});
it('rejects holdings on legacy/immediate rows but keeps unrelated journal evidence intact',async()=>{
  const f=engineFixture();await run(f);const r=f.data.get(tradingExecutionKey('scope'));r.entries[0].unknownEvidence={keep:true};expect(readTradingExecution(r,context).entries[0].unknownEvidence).toEqual({keep:true});
  r.plan.rows[0].event.exitMode='immediate-target';expect(()=>readTradingExecution(r,context)).toThrow('INVALID');
});

// All services/entities below are synthetic. The native buyer's reviewed hashes
// are supplied only by this fixture; no real runtime methods are approved.
function nativeFixture({strategy='evo-event',mode='target-hold'}={}){
  const {root}=executionRuntime(),data=new Map(),calls=[],unassigned=[],transfer=[];let time=Date.now(),coins=40000,publicPrice=700;
  let auction={tradeId:'9901',tradeState:'active',buyNowPrice:600,canBuy:()=>true,getSecondsRemaining:()=>60};
  const observable=reply=>({observe(_o,cb){cb(this,reply);},unobserve(){}});
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
    bid(card,price){calls.push(['bid',card.id,price]);coins-=price;card.purchasePrice=price;unassigned.push(card);auction={tradeState:'inactive'};return observable({success:true,status:200,data:{itemIds:[card.id]}});}
    move(card,pile){calls.push(['move',card.id,pile]);card.pile=pile;unassigned.splice(0);transfer.push(card);return observable({success:true,status:200,data:{itemIds:[card.id]}});}
    list(card,startPrice,buyNow,duration){calls.push(['list',card.id,startPrice,buyNow,duration]);auction={tradeId:9902,tradeState:'active',startingBid:startPrice,buyNowPrice:buyNow,currentBid:0};return observable({success:true,status:200});}
    searchTransferMarket(criteria){calls.push(['search',criteria.maxBuy]);return observable({success:true,status:200,data:{items:criteria.maxBuy>=600?[item]:[]}});}
    clearTransferMarketCache(){}
    requestUnassignedItems(){return observable({success:true,status:200,response:{items:unassigned}});}
    requestTransferItems(){return observable({success:true,status:200});}
    refreshAuctions(){return observable({success:true,status:200});}
    requestMarketData(){return observable({success:true,status:200});}
  }
  root.services.Item=new ItemService();root.repositories.Item.getUnassignedItems=()=>unassigned;root.repositories.Item.getTransferItems=()=>transfer;
  root.repositories.Item.getPileSize=()=>100;root.repositories.Item.numItemsInCache=p=>p===5?transfer.length:unassigned.length;root.repositories.Item.setDirty=()=>{};
  root.navigator={locks:{request:async(name,_o,fn)=>fn({name,mode:'exclusive'})}};
  const digest=root.crypto.subtle.digest,hashes=new Map(FC27_BUY_SERVICE_METHODS.map(([name,hash])=>[String(ItemService.prototype[name]),hash]));
  root.crypto.subtle.digest=async(algorithm,bytes)=>{const h=hashes.get(new TextDecoder().decode(bytes));return h?Uint8Array.from(Buffer.from(h,'hex')).buffer:digest(algorithm,bytes);};
  const prices={context:()=>context,readSettings:async()=>({source:'futbin',readSources:'both'}),load:vi.fn(async()=>({references:{901:{quotes:{futbin:quote('futbin',publicPrice,time),futgg:quote('futgg',publicPrice,time)}}}}))};
  const row=suggestion({strategy,event:event({sourceAt:time-1000,reviewAt:time+21600000,exitMode:mode}),ggQuote:quote('futgg',publicPrice,time)});
  if(strategy===null){delete row.strategy;delete row.event;}
  const plan=makePlan([row],{now:time,advice:{platform:'console',validUntil:time+300000,suggestions:[row]}}),scope=traditionalJournalScope(readFc27Context(root));
  const sourceKey=`fcat-fc27-trading-events-v1:${context.scope}`;
  const post={url:sourceUrl,author:'FutSheriff',at:time-1000,text:'Candidate under 700',topic:'evo',
    players:[{name:'Candidate',version:null,nominationQuote:'Candidate under 700'}],entry:{ceiling:700,strictBelow:true,quote:'Candidate under 700'},
    parentUrl:null,evidence:'native-thread-post',threadChecked:true,threadComplete:false,evo:null};
  data.set(sourceKey,{schema:1,context,rows:[{url:sourceUrl,post,status:'leak',included:true,exitMode:mode,importedAt:time}]});
  const adapterFactory=vi.fn(options=>createNativeTradingExecutionAdapter({...options,now:()=>time,sleep:async ms=>{time+=ms;}}));
  const args={root,prices,get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),liveEnabled:true,adapterFactory};
  let service=createFc27TradingExecution(args);
  return {root,item,prices,plan,data,calls,scope,sourceKey,adapterFactory,transfer,get service(){return service;},reload:()=>service=createFc27TradingExecution(args),
    now:()=>time,price:v=>publicPrice=v,advance:ms=>time+=ms,setAuction:v=>auction=v,sell:()=>auction={...auction,tradeState:'closed',currentBid:1000,isSold:()=>true}};
}
it('native event buy holds below target, rereads fresh dual quotes, then lists exact new entity and verifies isSold',async()=>{
  const f=nativeFixture();f.service.prepare(f.plan);expect((await f.service.start({plan:f.plan,approved:true})).record.status).toBe('waiting-events');
  expect(f.calls.filter(c=>c[0]!=='search')).toEqual([['bid',801,600],['move',801,5]]);f.price(1000);
  const r=await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});expect(r.record.entries[0].phase).toBe('listed');
  expect(f.calls.filter(c=>c[0]==='list')).toEqual([['list',801,1000,1000,3600]]);expect(f.prices.load.mock.calls.at(-1)[1]).toMatchObject({force:true,sources:['futbin','futgg']});
  f.sell();expect((await f.service.recover()).record.entries[0]).toMatchObject({phase:'sold',salePrice:1000,listingTradeId:'9902'});
});
it('native immediate-target keeps fresh native limits while leaving legacy minimum-reference guard unchanged',async()=>{
  const f=nativeFixture({mode:'immediate-target'});f.service.prepare(f.plan);expect((await f.service.start({plan:f.plan,approved:true})).record.entries[0].phase).toBe('listed');
  const g=nativeFixture({strategy:null});g.service.prepare(g.plan);expect((await g.service.start({plan:g.plan,approved:true})).record.reason).toBe('DESK_EXECUTION_REFERENCE_CHANGED');expect(g.calls).toEqual([]);
});
it.each(['platform','stale','discrepancy','below-cap','wrong-version'])('native event buy rejects %s quotes without relaxing legacy checks',async bad=>{
  const f=nativeFixture(),load=f.prices.load.getMockImplementation();f.prices.load.mockImplementation(async()=>{const r=await load(),q=r.references[901].quotes;
    if(bad==='platform')q.futgg.platform='pc';if(bad==='stale')q.futgg.expiresAt=0;if(bad==='discrepancy')q.futgg.price=900;
    if(bad==='below-cap')q.futgg.price=q.futbin.price=600;if(bad==='wrong-version')q.futbin.definitionId=902;return r;});
  f.service.prepare(f.plan);expect((await f.service.start({plan:f.plan,approved:true})).record.reason).toBe('DESK_EXECUTION_REFERENCE_CHANGED');expect(f.calls).toEqual([]);
});
it('native event exit requires BOTH public targets and the exact inactive Transfer entity',async()=>{
  const f=nativeFixture();f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.price(1000);
  const load=f.prices.load.getMockImplementation();f.prices.load.mockImplementation(async()=>{const r=await load();r.references[901].quotes.futgg.price=950;return r;});
  expect((await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'})).record.status).toBe('waiting-events');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
  f.prices.load.mockImplementation(load);f.item.id=802;expect((await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'})).record.status).toBe('paused');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});
it.each(['missing','failed'])('source authority %s stops before adapter creation, with old journals untouched',async state=>{
  const f=nativeFixture();if(state==='missing')f.data.delete(f.sourceKey);else f.data.get(f.sourceKey).rows[0].status='failed';
  const unknown={unknownEvidence:true},key=`fcat-fc27-trading.pending:${f.scope}`;f.data.set(key,unknown);f.service.prepare(f.plan);
  const r=await f.service.start({plan:f.plan,approved:true});expect(r.record.reason).toBe('DESK_EVENT_SOURCE_REVOKED');expect(f.adapterFactory).not.toHaveBeenCalled();expect(f.calls).toEqual([]);expect(f.data.get(key)).toEqual(unknown);
});
it('source revoked during a quote await stops future listing; live status still requires public target',async()=>{
  const f=nativeFixture();f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.data.get(f.sourceKey).rows[0].status='live';
  expect((await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'})).record.status).toBe('waiting-events');
  f.price(1000);const load=f.prices.load.getMockImplementation();f.prices.load.mockImplementation(async()=>{const r=await load();f.data.get(f.sourceKey).rows[0].status='failed';return r;});
  const r=await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});expect(r.record.reason).toBe('DESK_EVENT_SOURCE_REVOKED');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});

function cache304(f){
  const repo=f.root.repositories.Item;
  for(const [key,getter] of [['unassigned','getUnassignedItems'],['transfer','getTransferItems']]){
    repo[key]={endOfList:true,expiryTimestamp:f.now()+300000,isCacheExpired:()=>false,values:()=>repo[getter](),get length(){return this.values().length;}};
  }
  repo.isDirty=()=>false;
  const reply=()=>({observe(_o,cb){cb(this,{success:true,status:304});},unobserve(){}});
  f.root.services.Item.requestUnassignedItems=reply;f.root.services.Item.requestTransferItems=reply;
}
const readonlyNative=f=>f.adapterFactory({root:f.root,plan:f.plan,prices:f.prices,canWrite:()=>false,assertCurrent:()=>{},readOnly:true,needsPurchases:false});
it('requests an independent uncached native read for a pending buy instead of repeatedly accepting or rejecting the old cache',async()=>{
  const f=nativeFixture();cache304(f);const repo=f.root.repositories.Item,dirty=new Set();f.item.purchasePrice=600;f.setAuction({tradeState:'inactive'});
  repo.getUnassignedItems=()=>[f.item];repo.numItemsInCache=p=>p===6?1:0;repo.isDirty=p=>dirty.has(p);repo.setDirty=vi.fn(p=>dirty.add(p));
  f.root.services.Item.requestUnassignedItems=()=>({observe(_o,cb){const status=dirty.has(6)?200:304;dirty.delete(6);cb(this,{success:true,status,response:{items:[f.item]}});},unobserve(){}});
  const adapter=await readonlyNative(f),entry={definitionId:901,phase:'buy-pending',offer:{definitionId:901,itemId:801,tradeId:'9901',price:600},buyAcknowledged:true};
  await expect(adapter.reconcile(entry,f.plan.rows[0])).resolves.toMatchObject({phase:'bought'});expect(repo.setDirty).toHaveBeenCalledWith(6);expect(f.calls).toEqual([]);
});
it('304 business-success preflight accepts only initialized, complete, unexpired repository piles and does no EA writes',async()=>{
  const f=nativeFixture({strategy:null});cache304(f);const adapter=await readonlyNative(f);
  expect(await adapter.capabilities()).toMatchObject({canTrade:true,balance:40000,freeSlots:100});expect(f.calls).toEqual([]);
});
it.each(['missing','uninitialized','stale','dirty','bad-getter','bad-count','bad-item','wrong-pile','incomplete','missing-expiry'])('304 preflight rejects %s repository evidence',async bad=>{
  const f=nativeFixture({strategy:null});cache304(f);const repo=f.root.repositories.Item;
  if(bad==='missing')delete repo.unassigned;if(bad==='uninitialized')repo.unassigned.expiryTimestamp=0;if(bad==='stale')repo.unassigned.expiryTimestamp=f.now()-1;
  if(bad==='dirty')repo.isDirty=()=>true;if(bad==='bad-getter')repo.getUnassignedItems=()=>null;if(bad==='bad-count')repo.numItemsInCache=()=>1;
  if(bad==='bad-item')repo.getUnassignedItems=()=>[{id:null,definitionId:901,pile:6}];if(bad==='wrong-pile')repo.getUnassignedItems=()=>[{id:1,definitionId:901,pile:5}];
  if(bad==='incomplete')repo.unassigned.endOfList=false;if(bad==='missing-expiry')delete repo.unassigned.expiryTimestamp;
  const adapter=await readonlyNative(f);await expect(adapter.capabilities()).rejects.toThrow('READ_UNCONFIRMED');expect(f.calls).toEqual([]);
});
it.each([null,503])('never treats missing/5xx status as cached success (%s)',async status=>{
  const f=nativeFixture({strategy:null});cache304(f);f.root.services.Item.requestUnassignedItems=()=>({observe(_o,cb){cb(this,{success:true,status});},unobserve(){}});
  const adapter=await readonlyNative(f);await expect(adapter.capabilities()).rejects.toThrow('READ_UNCONFIRMED');
});
it('304 cache alone cannot confirm a pending buy/move/list after a write, even with a matching cached entity',async()=>{
  for(const phase of ['buy-pending','move-pending','list-pending','listed']){const f=nativeFixture();cache304(f);
    f.item.pile=phase==='buy-pending'?6:5;f.item.purchasePrice=600;
    if(phase==='buy-pending')f.root.repositories.Item.getUnassignedItems=()=>[f.item];else f.transfer.push(f.item);
    f.setAuction(phase==='list-pending'?{tradeId:9902,tradeState:'active',startingBid:1000,buyNowPrice:1000,currentBid:0}:{tradeState:'inactive'});
    f.root.repositories.Item.numItemsInCache=p=>p===f.item.pile?1:0;
    const adapter=await readonlyNative(f),entry={definitionId:901,phase,offer:{definitionId:901,itemId:801,tradeId:'9901',price:600},buyAcknowledged:true,listAcknowledged:true};
    await expect(adapter.reconcile(entry,f.plan.rows[0])).rejects.toThrow('READ_UNCONFIRMED');expect(f.calls).toEqual([]);}
});

it.each(['buy-pending','list-pending'])('source revoked after durable %s is proven not sent and rolls back, not unknown',async phase=>{
  const f=nativeFixture();f.service.prepare(f.plan);
  if(phase==='list-pending'){await f.service.start({plan:f.plan,approved:true});f.price(1000);}
  const set=f.data.set.bind(f.data);f.data.set=(key,value)=>{const result=set(key,value);
    if(key===tradingExecutionKey(f.scope)&&value.entries.some(e=>e.phase===phase))f.data.get(f.sourceKey).rows[0].status='failed';return result;};
  const r=await f.service.start(phase==='buy-pending'?{plan:f.plan,approved:true}:{resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});
  expect(r.record).toMatchObject({status:'paused',reason:'DESK_EVENT_SOURCE_REVOKED'});
  expect(r.record.entries[0].phase).toBe(phase==='buy-pending'?'waiting':'holding');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
  expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(phase==='buy-pending'?0:1);
});
it('source revoked during the native capacity read prevents any payment',async()=>{
  const f=nativeFixture(),original=f.root.services.Item.requestTransferItems;
  f.root.services.Item.requestTransferItems=function(...args){f.data.get(f.sourceKey).rows[0].status='failed';return original.apply(this,args);};
  f.service.prepare(f.plan);const r=await f.service.start({plan:f.plan,approved:true});expect(r.record.reason).toBe('DESK_EVENT_SOURCE_REVOKED');expect(f.calls).toEqual([]);
});
it('native permit await double-checks review deadline and restores holding with no list intent',async()=>{
  const f=nativeFixture(),factory=f.adapterFactory.getMockImplementation();
  f.adapterFactory.mockImplementation(options=>factory({...options,tradeFactory:root=>{const trade=createEaTradeAdapter(root),acquire=trade.acquireRequestPermit;
    return {...trade,acquireRequestPermit:async action=>{const permit=await acquire(action);if(action==='list')f.advance(21600000);return permit;}};}}));
  f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.price(1000);
  const r=await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});expect(r.record).toMatchObject({status:'paused',reason:'DESK_EVENT_REVIEW_REQUIRED'});
  expect(r.record.entries[0].phase).toBe('holding');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});
it('native public quote await respects stop without manufacturing a pending listing',async()=>{
  const f=nativeFixture();f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.price(1000);
  const load=f.prices.load.getMockImplementation();f.prices.load.mockImplementation(async()=>{const result=await load();f.service.stop();return result;});
  const r=await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});expect(r.record.status).toBe('paused');expect(r.record.entries[0].phase).toBe('holding');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});
it('native unknown event listing survives reload and read-only recovery without another list or buy',async()=>{
  const f=nativeFixture(),list=f.root.services.Item.list,transfer=f.root.services.Item.requestTransferItems;let failed=false;
  f.root.services.Item.list=function(...args){const result=list.apply(this,args);failed=true;return result;};
  f.root.services.Item.requestTransferItems=function(...args){return failed?{observe(_o,cb){cb(this,{success:false,status:503});},unobserve(){}}:transfer.apply(this,args);};
  f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.price(1000);
  const r=await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});expect(r.record.status).toBe('recovery-required');expect(r.record.entries[0].phase).toBe('list-pending');
  f.reload();expect((await f.service.inspect()).record.entries[0].phase).toBe('list-pending');failed=false;
  expect((await f.service.recover()).record.entries[0].phase).toBe('listed');await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});
  expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(1);
});
it.each(['active','closed','unknown'])('native event exit rejects an exact entity with %s auction, not just a different item',async state=>{
  const f=nativeFixture();f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.price(1000);f.setAuction({tradeId:999,tradeState:state});
  const r=await f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:'event-plan'});expect(r.record.reason).toBe('DESK_EXECUTION_RECEIPT_UNCONFIRMED');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});
it('304 price-limit response remains rejected even for an approved immediate event target',async()=>{
  const f=nativeFixture({mode:'immediate-target'});f.root.services.Item.requestMarketData=()=>({observe(_o,cb){cb(this,{success:true,status:304});},unobserve(){}});
  f.service.prepare(f.plan);const r=await f.service.start({plan:f.plan,approved:true});expect(r.record.reason).toBe('DESK_EXECUTION_READ_UNCONFIRMED');
  expect(r.record.entries[0].phase).toBe('transfer');expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});

it.each(['missing','failed'])('read-only actual-sale recovery remains available when the event source is %s',async state=>{
  const f=nativeFixture({mode:'immediate-target'});f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.sell();
  if(state==='missing')f.data.delete(f.sourceKey);else f.data.get(f.sourceKey).rows[0].status='failed';
  const before=f.calls.filter(c=>['bid','move','list'].includes(c[0]));const r=await f.reload().recover();
  expect(r.record.status).toBe('completed');expect(r.record.entries[0]).toMatchObject({phase:'sold',salePrice:1000,listingTradeId:'9902'});
  expect(f.calls.filter(c=>['bid','move','list'].includes(c[0]))).toEqual(before);
});
it('read-only recovery preserves confirmed sales even when a different holding has a revoked source',async()=>{
  const f=nativeFixture({mode:'immediate-target'});f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});f.sell();
  const key=tradingExecutionKey(f.scope),r=f.data.get(key),row=structuredClone(r.plan.rows[0]);row.definitionId=902;row.event.exitMode='target-hold';
  r.plan.rows.push(row);r.plan.allocated+=row.buyCap;r.plan.expectedNet+=row.expectedNet;
  r.entries.push({definitionId:902,phase:'holding',offer:{definitionId:902,itemId:802,tradeId:'9904',price:600}});r.status='waiting-events';
  f.data.get(f.sourceKey).rows[0].status='failed';
  const recovered=await f.reload().recover();expect(recovered.record.entries.map(e=>e.phase)).toEqual(['sold','holding']);
  expect(recovered.record).toMatchObject({status:'paused',reason:'DESK_EVENT_SOURCE_REVOKED'});expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);
});
it.each(['at','ceiling','strictBelow','quote','player','ambiguous-player','target'])('same-URL reimport changing frozen %s authority requires a new review',async field=>{
  const f=nativeFixture(),post=f.data.get(f.sourceKey).rows[0].post;
  if(field==='at')post.at--;if(field==='ceiling')post.entry.ceiling=750;if(field==='strictBelow')post.entry.strictBelow=false;
  if(field==='quote')post.entry.quote='under 700';if(field==='player')post.players[0].name='Other Candidate';
  if(field==='ambiguous-player')post.players.push({...post.players[0]});if(field==='target'){post.targetPrice=1200;post.targetQuote='under 700';}
  f.service.prepare(f.plan);const r=await f.service.start({plan:f.plan,approved:true});expect(r.record.reason).toBe('DESK_EVENT_SOURCE_REVOKED');
  expect(f.calls).toEqual([]);expect(f.adapterFactory).not.toHaveBeenCalled();
});
it('matches normalized trimmed entry evidence without changing the original source proof',async()=>{
  const f=nativeFixture(),post=f.data.get(f.sourceKey).rows[0].post;post.text='  Candidate under 700  ';post.entry.quote=post.text;
  const original=structuredClone(f.data.get(f.sourceKey));f.service.prepare(f.plan);
  expect((await f.service.start({plan:f.plan,approved:true})).record.status).toBe('waiting-events');expect(f.data.get(f.sourceKey)).toEqual(original);
});
it.each([undefined,null,'',' ','x'.repeat(101),17,'event\nplan'])('event-only execution requires a valid expectedPlanId (%j)',async expectedPlanId=>{
  const f=engineFixture();await run(f);const before=structuredClone([...f.data]);f.args.createAdapter.mockClear();
  await expect(f.session.execute({resume:true,approved:true,eventExitsOnly:true,expectedPlanId})).rejects.toThrow('DESK_EXECUTION_PLAN_ID_REQUIRED');
  expect(f.args.createAdapter).not.toHaveBeenCalled();expect([...f.data]).toEqual(before);expect(f.adapter.list).not.toHaveBeenCalled();
});
it.each([true,false])('checks the expected plan under the lock before touching another tab journal (event-only=%s)',async eventExitsOnly=>{
  const f=engineFixture();await run(f);const key=tradingExecutionKey('scope'),other=structuredClone(f.data.get(key));other.plan.id='another-tab-plan';
  const exclusive=f.args.exclusive;f.args.exclusive=(scope,fn)=>exclusive(scope,async()=>{f.data.set(key,structuredClone(other));return fn();});
  f.args.set=vi.fn(f.args.set);f.args.createAdapter.mockClear();f.reload();
  await expect(f.session.execute({resume:true,approved:true,eventExitsOnly,expectedPlanId:'event-plan'})).rejects.toThrow('DESK_EXECUTION_PLAN_MISMATCH');
  expect(f.data.get(key)).toEqual(other);expect(f.args.set).not.toHaveBeenCalled();expect(f.args.createAdapter).not.toHaveBeenCalled();
  expect(f.adapter.list).not.toHaveBeenCalled();expect(f.adapter.buy).toHaveBeenCalledOnce();expect(f.adapter.move).toHaveBeenCalledOnce();
});
it('production start forwards expectedPlanId and leaves a replacement journal untouched',async()=>{
  const f=nativeFixture();f.service.prepare(f.plan);await f.service.start({plan:f.plan,approved:true});
  f.data.get(tradingExecutionKey(f.scope)).plan.id='replacement-plan';const before=structuredClone([...f.data]);f.adapterFactory.mockClear();
  await expect(f.service.start({resume:true,approved:true,eventExitsOnly:true,expectedPlanId:f.plan.id})).rejects.toThrow('DESK_EXECUTION_PLAN_MISMATCH');
  expect([...f.data]).toEqual(before);expect(f.adapterFactory).not.toHaveBeenCalled();expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});
it.each(['TOTW','unknown','Thunderstruck'])('same-URL nomination changed to %s revokes both buy and future-list authority',async version=>{
  for(const stage of ['buy','target']){const f=nativeFixture();f.service.prepare(f.plan);
    if(stage==='target'){await f.service.start({plan:f.plan,approved:true});f.price(1000);}
    f.data.get(f.sourceKey).rows[0].post.players[0].version=version;f.adapterFactory.mockClear();
    const r=await f.service.start(stage==='buy'?{plan:f.plan,approved:true}:{resume:true,approved:true,eventExitsOnly:true,expectedPlanId:f.plan.id});
    expect(r.record.reason).toBe('DESK_EVENT_SOURCE_REVOKED');expect(f.adapterFactory).not.toHaveBeenCalled();
    expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(stage==='buy'?0:1);}
});
it.each([null,'base','gold','rare gold','common gold','normal','普通','金卡','普通金卡'])('retains the model ordinary-version eligibility for %j',async version=>{
  const f=nativeFixture();f.data.get(f.sourceKey).rows[0].post.players[0].version=version;f.service.prepare(f.plan);
  expect((await f.service.start({plan:f.plan,approved:true})).record.status).toBe('waiting-events');
});
