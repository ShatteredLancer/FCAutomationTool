import {it,expect} from 'vitest';
import {marketNativeRuntime} from '../helpers/market-native-runtime.js';
import {createFc27MarketTaskNative} from '../../src/adapters/browser/fc27-market-task-native.js';
import {MARKET_AUCTION_METHODS} from '../../src/adapters/ea/fc27-market-auctions.js';
import {defaultTradingTaskSettings} from '../../src/trading/task-model.js';
import {createTradingTaskStore} from '../../src/adapters/browser/fc27-trading-task-store.js';
import {createMarketCoordinator} from '../../src/adapters/browser/fc27-market-coordinator.js';
import {createMarketTaskScheduler} from '../../src/trading/market-task-scheduler.js';
import {createMarketTaskProvider} from '../../src/trading/market-task-provider.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

async function fixture(){
 const f=marketNativeRuntime(),watched=[],observable=value=>({observe(o,cb){cb(this,value);},unobserve(){}});
 f.root.ItemPile.INBOX=2;
 const proto=Object.getPrototypeOf(f.root.services.Item);
 proto.requestWatchedItems=function(){f.calls.push(['read','watch']);return observable({success:true,status:f.hooks.watchStatus??200});};
 f.root.services.Item.itemDao={getWatchPile(){}};
 f.root.repositories.Item.getWatchedItems=()=>watched;
 const objects={service:proto,dao:f.root.services.Item.itemDao,repository:f.root.repositories.Item};
 const hashes=new Map(MARKET_AUCTION_METHODS.map(([path,hash])=>{const [o,k]=path.split('.');return [String(objects[o][k]),hash];}));
 const digest=f.root.crypto.subtle.digest;f.root.crypto.subtle.digest=async(a,b)=>{const h=hashes.get(new TextDecoder().decode(b));return h?Uint8Array.from(Buffer.from(h,'hex')).buffer:digest(a,b);};
 const native=await createFc27MarketTaskNative({...f,assertCurrent:()=>{},assertProtected:()=>true,checkOtherTransactions:async()=>{}});
 const task={id:'t',mode:'fixed',settings:{...defaultTradingTaskSettings(),buyMode:'bid',bidRule:'fixed',bidValue:800},players:[{definitionId:901}]};
 const card=f.makeCard(101,901,'market',1000);
 Object.assign(card.auction,{startingBid:600,currentBid:0,tradeOwner:false,bidState:'none',isActiveTrade(){return this.tradeState==='active';},isHighestBid(){return this.bidState==='highest';},isWon(){return this.tradeState==='closed'&&this.bidState==='highest';},isClosedTrade(){return this.tradeState==='closed';},isExpired(){return this.tradeState==='expired';},canBid(price){return price>this.currentBid&&price<this.buyNowPrice;}});
 f.hooks.search=()=>({success:true,status:200,data:{items:[card]}});
 f.hooks.bid=(i,price)=>{i.auction.currentBid=price;i.auction.bidState='highest';if(!watched.includes(i))watched.push(i);return {success:true,status:200,data:{itemIds:[i.id]}};};
 const search={kind:'search',definitionId:901,searchMode:'bid',maxBuy:null,maxBid:800};
 const bid={kind:'bid',itemId:'101',definitionId:901,tradeId:'9101',coins:600};
 const send=action=>native.send({task,action,beforeDispatch:()=>{}});
 return {...f,native,task,card,watched,search,bid,send};
}
it('searches with maxBid, confirms a live bid without treating it as a purchase, and reads winning evidence',async()=>{
 const f=await fixture();let criteria;f.hooks.search=c=>{criteria=c;return {success:true,status:200,data:{items:[f.card]}};};
 const found=await f.send(f.search);expect(found.offers[0]).toMatchObject({currentBid:0,startingBid:600,buyNow:1000});
 expect(criteria.maxBid).toBe(800);expect(criteria.maxBuy).not.toBe(800);
 expect(await f.send(f.bid)).toMatchObject({status:'confirmed',receipt:{coins:600}});
 expect(f.unassigned).toHaveLength(0);
 expect((await f.native.readAuctions([f.bid])).receipts[0].state).toBe('leading');
 f.card.auction.tradeState='closed';expect((await f.native.readAuctions([f.bid])).receipts[0].state).toBe('won');
});
it('reads outbid/lost, never infers failure from missing or failed reads',async()=>{
 const f=await fixture();await f.send(f.search);await f.send(f.bid);
 f.card.auction.bidState='outbid';f.card.auction.currentBid=650;
 expect((await f.native.readAuctions([f.bid])).receipts[0].state).toBe('outbid');
 f.card.auction.tradeState='closed';expect((await f.native.readAuctions([f.bid])).receipts[0].state).toBe('lost');
 f.watched.length=0;expect((await f.native.readAuctions([f.bid])).receipts).toEqual([]);
 f.hooks.watchStatus=401;await expect(f.native.readAuctions([f.bid])).rejects.toThrow();
});
it('Both can buy a BIN offer from its native bid search without changing the cap',async()=>{
 const f=await fixture();f.task.settings.buyMode='both';f.search.maxBuy=1100;f.hooks.bid=null;
 const found=await f.send(f.search);expect(found.offers[0].buyNow).toBe(1000);
 const result=await f.send({...f.bid,kind:'buy',coins:1000});
 expect(result).toMatchObject({status:'confirmed',receipt:{coins:1000}});expect(f.unassigned).toHaveLength(1);
});
it('Both covers separate BIN/bid criteria and checks original player/rating pricing before each action',async()=>{
 const f=await fixture(),settings={source:'futbin',perSearch:2},context={scope:'test',season:'27',platform:'console'};
 f.task.settings={...f.task.settings,buyMode:'both',buyRule:'fixed',buyValue:800};f.task.players[0].qty=null;
 const provider=createMarketTaskProvider({native:f.native,context,assertCurrent:()=>{},now:f.now,loadQuotes:async()=>{throw Error('no quotes');}});
 const ledger={intents:[],holdings:[]};await provider.begin({task:f.task,settings});
 let action=await provider.prepare({task:f.task,settings,ledger});expect(action).toMatchObject({searchMode:'bin',maxBuy:800,maxBid:800});
 await provider.accept({action,response:{sent:true,status:'confirmed',offers:[]},ledger});
 action=await provider.prepare({task:f.task,settings,ledger});expect(action).toMatchObject({searchMode:'bid',maxBuy:800,maxBid:800});
 await provider.preflight({task:f.task,settings,action,ledger});
 const response=await provider.send({action,beforeDispatch:()=>{}});await provider.accept({action,response,ledger});
 action=await provider.prepare({task:f.task,settings,ledger});expect(action).toMatchObject({kind:'bid',coins:600});
 await expect(provider.preflight({task:{...f.task,settings:{...f.task.settings,bidValue:500}},settings,action,ledger})).rejects.toThrow('ACTION_CHANGED');
});
it.each([false,true])('moves an exactly won watch entity with Unassigned cache presence %s through the same protected dispatch',async inUnassigned=>{
 const f=await fixture();await f.send(f.search);await f.send(f.bid);f.card.auction.tradeState='closed';
 if(inUnassigned){f.card.pile=6;f.unassigned.push(f.card);}
 const action={kind:'move',itemId:'101',definitionId:901,coins:0,wonAuction:{...f.bid}};
 await f.native.preflight({task:f.task,action});
 expect(await f.send(action)).toMatchObject({status:'confirmed'});expect(f.calls).toContainEqual(['move',101,5]);
});
it('retains authentication errors when moving a won auction, without falsely confirming ownership transfer',async()=>{
 const f=await fixture();await f.send(f.search);await f.send(f.bid);f.card.auction.tradeState='closed';
 f.hooks.move=()=>({success:false,status:401});
 const result=await f.send({kind:'move',itemId:'101',definitionId:901,coins:0,wonAuction:{...f.bid}});
 expect(result).toMatchObject({status:'rejected',code:401});expect(f.transfer).toHaveLength(0);
});
it('checks stop after async reads and refuses stale auction terms or unsupported mode',async()=>{
 const f=await fixture();await f.send(f.search);f.card.auction.currentBid=700;
 await expect(f.send(f.bid)).rejects.toThrow('OFFER_CHANGED');expect(f.calls.some(c=>c[0]==='bid')).toBe(false);
 f.card.auction.currentBid=0;f.task.settings.buyMode='bin';await expect(f.send(f.bid)).rejects.toThrow();
});
it('pins the observed public watch methods and replays the native DAO refreshing the full repository before filtering won cards',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/fc27-market-bid-public-methods.json',import.meta.url),'utf8'));
 for(const row of fixture.methods)expect(createHash('sha256').update(row.source).digest('hex')).toBe(row.hash);
 expect(MARKET_AUCTION_METHODS.map(r=>r[1])).toEqual(fixture.methods.slice(0,3).map(r=>r.hash));
 const rows=[{id:1,getAuctionData:()=>({isWon:()=>false})},{id:2,getAuctionData:()=>({isWon:()=>true})}],stored=[];let reply,path;
 const globals={_0x436f56:null,EAObservable:class{notify(r){reply=r;}},UTHttpResponseDTO:class{},
  ItemPile:{INBOX:2},GAME_NAME:'fc27',Date,JSUtils:{assignPropertyValues:(a,b)=>Object.assign(b,a),isObject:o=>typeof o==='object'},
  UTHttpRequest:class{setPath(p){path=p;}},factories:{Item:{generateItemsFromAuctionData:()=>rows}},
  services:{UTUtasRequestQueue:{send:()=>({observe(owner,cb){cb({unobserve(){}},{success:true,status:200,response:{auctionInfo:[]}});}})}}};
 const fn=vm.runInNewContext('('+fixture.methods[1].decoded+')',globals);
 fn.call({itemRepo:{isDirty:()=>true,setWatchedItems:r=>stored.push(...r),setCacheTimestamp(){}},authDelegate:{}},false);
 expect(path).toBe('/ut/game/fc27/watchlist');expect(stored).toEqual(rows);expect(reply.response.items).toEqual([rows[1]]);
});
it('keeps an unacknowledged missing bid unknown and blocks a watched-method replacement',async()=>{
 const f=await fixture();await f.send(f.search);f.hooks.bid=()=>({success:true,status:200,data:{}});
 expect(await f.send(f.bid)).toMatchObject({status:'unknown'});
 expect(await f.native.reconcile(f.bid,{recovery:true})).toMatchObject({status:'unknown'});
 const writes=f.calls.filter(c=>c[0]==='bid').length;
 f.root.services.Item.requestWatchedItems=()=>{};
 await expect(f.native.readAuctions([f.bid])).rejects.toThrow();expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(writes);
});
it.each(['hold','list','deadline'])('runs production task/store/journal/native bid, outbid, rebid, win, move and %s',async scenario=>{
 const afterBuy=scenario==='deadline'?'hold':scenario;
 const f=await fixture(),data=new Map(),context={scope:'test',season:'27',platform:'console'};
 const get=async(k,d)=>structuredClone(data.get(k)??d),set=async(k,v)=>data.set(k,structuredClone(v)),locks={request:async(n,o,fn)=>fn({name:n,mode:'exclusive'})};
 const taskStore=createTradingTaskStore({context:()=>context,get,set,locks,id:()=> 't',now:f.now});
 const coordinator=createMarketCoordinator({context:()=>context,get,set,locks});
 const snapshot=await taskStore.saveTask({...await taskStore.read(),input:{name:'Bid workflow',mode:'fixed',
  settings:{...f.task.settings,afterBuy,sellRule:'fixed',sellValue:900},players:[{definitionId:901,name:'Synthetic',rating:84,cap:null,qty:1}],owned:[],excluded:[],
  ...(scenario==='deadline'?{schedule:{repeat:'once',zone:'UTC',start:'1970-01-01T00:00',end:'1970-01-01T00:18',sell:null}}:{})}});
 const provider=createMarketTaskProvider({native:f.native,context,assertCurrent:()=>{},now:f.now,loadQuotes:async()=>{throw Error('no quotes expected');}});
 let serial=0,complete=false;
 if(scenario==='deadline'){const bid=f.hooks.bid;f.hooks.bid=(...args)=>{const result=bid(...args);f.advance(120000);return result;};}
 f.hooks.auctions=()=>{
  const bids=f.calls.filter(c=>c[0]==='bid').length;
  if(scenario==='deadline'){f.card.auction.bidState='highest';f.card.auction.tradeState='closed';return;}
  if(bids===1){f.card.auction.bidState='outbid';f.card.auction.currentBid=650;}
  if(bids===2){f.card.auction.bidState='highest';f.card.auction.tradeState='closed';}
 };
 const scheduler=createMarketTaskScheduler({taskStore,coordinator,provider,enabled:true,now:f.now,random:()=>0,id:()=>`r${++serial}`,
  wait:async ms=>{await f.sleep(ms);if(f.now()>1300000)throw Error('workflow deadline');},onStatus:state=>{
   if(!complete&&state.evidence.some(e=>e.counts[0]===1)&&(afterBuy==='list'?state.evidence.some(e=>e.counts[1]===1):f.calls.some(c=>c[0]==='move'))){complete=true;scheduler.pauseAll();}
  }});
 await scheduler.run({approved:true,snapshot,taskIds:['t']});
 expect(complete,JSON.stringify(scheduler.inspect())).toBe(true);
 const ledger=(await coordinator.inspect()).ledger;
 expect(f.calls.filter(c=>c[0]==='bid').map(c=>c[2])).toEqual(scenario==='deadline'?[600]:[600,700]);
 const cost=scenario==='deadline'?600:700;
 expect(ledger.auctions).toHaveLength(1);expect(ledger.auctions[0]).toMatchObject({state:'won',coins:cost});
 expect(ledger.holdings[0]).toMatchObject({cost,phase:afterBuy==='list'?'listed':'transfer'});
 expect(ledger.intents.some(i=>i.phase==='pending')).toBe(false);
 const writes=f.calls.filter(c=>['bid','move','list'].includes(c[0])).length;
 await scheduler.recover();expect(f.calls.filter(c=>['bid','move','list'].includes(c[0]))).toHaveLength(writes);
 if(afterBuy==='hold')expect(f.calls.some(c=>c[0]==='list')).toBe(false);
});
