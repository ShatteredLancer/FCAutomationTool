import {it,expect,vi} from 'vitest';
import {marketNativeRuntime} from '../helpers/market-native-runtime.js';
import {createFc27MarketTaskNative} from '../../src/adapters/browser/fc27-market-task-native.js';
import {createMarketTaskProvider} from '../../src/trading/market-task-provider.js';
import {createMarketTaskScheduler} from '../../src/trading/market-task-scheduler.js';
import {createTradingTaskStore} from '../../src/adapters/browser/fc27-trading-task-store.js';
import {createMarketCoordinator} from '../../src/adapters/browser/fc27-market-coordinator.js';
import {defaultTradingTaskSettings,normalizeTradingTaskInput} from '../../src/trading/task-model.js';
import {marketTaskEvidence} from '../../src/trading/market-coordination.js';
import {marketSellMatches} from '../../src/trading/market-sell-selection.js';

const selection={ratingMin:88,ratingMax:88,pile:'all'};
const input=()=>({name:'Sell 88',mode:'sell',settings:{...defaultTradingTaskSettings(),sellRule:'fixed',sellValue:14000},players:[],owned:[],excluded:[],sellSelection:selection});
async function fixture(){
 const f=marketNativeRuntime(),context={scope:'test',season:'27',platform:'console'},data=new Map();
 const get=async(k,d)=>structuredClone(data.get(k)??d),set=async(k,v)=>data.set(k,structuredClone(v));
 const locks={request:async(name,_o,cb)=>cb({name,mode:'exclusive'})};
 const coordinator=createMarketCoordinator({context:()=>context,get,set,locks});
 const store=createTradingTaskStore({context:()=>context,get,set,locks,now:f.now,id:()=> 'sell',readEvidence:async id=>marketTaskEvidence((await coordinator.inspect()).ledger,id)});
 const snapshot=await store.saveTask({...await store.read(),input:input()});
 let current=true;const protectedIds=new Set(),native=await createFc27MarketTaskNative({...f,assertCurrent:()=>{if(!current)throw Error('TASKS_CONTEXT_CHANGED');},assertProtected:item=>!protectedIds.has(item.id),checkOtherTransactions:async()=>{}});
 const quotes=vi.fn(()=>{throw Error('Unexpected quotes');});
 const provider=createMarketTaskProvider({context,native,assertCurrent:()=>{},loadQuotes:quotes,now:f.now});
 const scheduler=createMarketTaskScheduler({taskStore:store,coordinator,provider,enabled:true,now:f.now,wait:async ms=>f.advance(ms)});
 const card=(id,pile='transfer',rating=88)=>{const c=f.makeCard(id,1000+id,pile);c._rating=rating;c.rating=rating;c._itemPriceLimits.maximum=50000;return c;};
 return {...f,context,store,snapshot,coordinator,native,provider,scheduler,card,protectedIds,quotes,invalidate:()=>{current=false;}};
}
it('persists rating rules with no manual list, copies them, and removes them on switching back to manual',async()=>{
 const f=await fixture();expect((await f.store.read()).store.tasks[0].sellSelection).toEqual(selection);
 const task=f.snapshot.store.tasks[0];
 const manual=await f.store.saveTask({...f.snapshot,id:task.id,input:{...input(),sellSelection:null,owned:[{itemId:'1',definitionId:1001,name:'A',pile:'transfer'}]}});
 expect(manual.store.tasks[0]).not.toHaveProperty('sellSelection');
 for(const v of [{...selection,ratingMin:89},{...selection,pile:'storage'},{...selection,ratingMin:0}])expect(()=>normalizeTradingTaskInput({...input(),sellSelection:v})).toThrow();
 expect(()=>normalizeTradingTaskInput({...input(),sellSelection:null})).toThrow('SELECTION_EMPTY');
 expect(marketSellMatches(selection,{rating:undefined,pile:'transfer'})).toBe(false);
});
it('discovers fresh matching entities across three piles, excluding protected, nontradeable and wrong ratings',async()=>{
 const f=await fixture();f.card(1);f.card(2,'club');f.card(3,'unassigned');f.card(4,'transfer',87);f.card(5);f.protectedIds.add(5);
 const unt=f.card(6);unt.untradeable=true;unt.isTradeable=()=>false;
 const rows=await f.native.discoverOwned({task:f.snapshot.store.tasks[0]});
 expect(rows.map(r=>r.itemId)).toEqual(['1','3','2']);expect(f.calls.filter(c=>['list','move','bid','search'].includes(c[0]))).toHaveLength(0);
});
it('continuously discovers a newly acquired card, never lists the same entity twice, and stops on user pause',async()=>{
 const f=await fixture();f.card(1);f.card(2,'club');f.card(3,'unassigned');f.card(4,'transfer',87);f.card(5);f.protectedIds.add(5);
 let added=false,ticks=0;
 f.scheduler.subscribe(()=>{
   if(!added&&f.now()>1300000){f.card(6);added=true;}
   if(f.calls.filter(c=>c[0]==='list').length===4||++ticks>4000)f.scheduler.pauseAll();
 });
 await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect(f.calls.filter(c=>c[0]==='list').map(c=>c[1]),JSON.stringify(f.scheduler.inspect())).toEqual([1,3,2,6]);
 expect(f.calls.filter(c=>['search','bid'].includes(c[0]))).toHaveLength(0);expect(f.quotes).not.toHaveBeenCalled();
 const ledger=(await f.coordinator.inspect()).ledger;expect(ledger.holdings).toHaveLength(4);expect(ledger.intents.every(i=>i.phase==='confirmed')).toBe(true);
 const writes=f.calls.length;f.advance(600000);expect(f.calls).toHaveLength(writes);
});
it('cancels during the fresh scan without claiming, moving or listing any material',async()=>{
 const f=await fixture();f.card(1,'club');f.hooks.scan=()=>f.scheduler.pauseAll();
 await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect((await f.coordinator.inspect()).ledger.holdings).toHaveLength(0);
 expect(f.calls.filter(c=>['list','move','bid'].includes(c[0]))).toHaveLength(0);
});
it('rescans after restart and lists external cards before an already claimed Club holding',async()=>{
 const f=await fixture();f.card(1,'club');f.card(2,'transfer');f.card(3,'unassigned');
 await f.coordinator.withOwner(o=>o.control(t=>t.checkpoint(l=>{l.holdings.push({taskId:'sell',itemId:'1',definitionId:1001,cost:500,phase:'held',listingTradeId:null,salePrice:null});})));
 f.scheduler.subscribe(()=>{if(f.calls.filter(c=>c[0]==='list').length===3)f.scheduler.pauseAll();});
 await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect(f.calls.filter(c=>c[0]==='list').map(c=>c[1])).toEqual([2,3,1]);
 expect((await f.coordinator.inspect()).ledger.holdings.find(h=>h.itemId==='1')).toMatchObject({cost:500,phase:'listed'});
});
it('skips another task’s holding while listing unrelated matching cards',async()=>{
 const f=await fixture();f.card(1);f.card(2);
 await f.coordinator.withOwner(o=>o.control(t=>t.checkpoint(l=>{l.holdings.push({taskId:'other',itemId:'1',definitionId:1001,cost:500,phase:'transfer',listingTradeId:null,salePrice:null});})));
 f.scheduler.subscribe(()=>{if(f.calls.some(c=>c[0]==='list'))f.scheduler.pauseAll();});
 await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect(f.calls.filter(c=>c[0]==='list').map(c=>c[1])).toEqual([2]);
});
it('pauses on authentication failure with zero material writes and no fallback to cached matches',async()=>{
 const f=await fixture();f.card(1);f.hooks.readStatus=401;
 await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect((await f.coordinator.inspect()).ledger.stopped).toBe('authentication');
 expect(f.calls.filter(c=>['list','move','bid'].includes(c[0]))).toHaveLength(0);
});
it('keeps unknown listing receipts pending rather than discovering and listing the entity again',async()=>{
 const f=await fixture();f.card(1);f.hooks.list=()=>({success:true,status:200});
 await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);
 expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
});
it('does not claim a card that becomes protected after discovery',async()=>{
 const f=await fixture();f.card(1);let scanned=false;
 f.scheduler.subscribe(status=>{
   if(status.tasks[0]?.candidateScope?.complete){scanned=true;f.protectedIds.add(1);}
   if(scanned&&status.tasks[0]?.state==='waiting')f.scheduler.pauseAll();
 });
 await f.scheduler.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect((await f.coordinator.inspect()).ledger.holdings).toHaveLength(0);
 expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(0);
});
