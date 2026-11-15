import { it, expect, vi } from 'vitest';
import { createMarketTaskScheduler } from '../../src/trading/market-task-scheduler.js';
import { createMarketTaskProvider } from '../../src/trading/market-task-provider.js';
import { createTradingTaskStore } from '../../src/adapters/browser/fc27-trading-task-store.js';
import { createMarketCoordinator } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { defaultTradingTaskSettings } from '../../src/trading/task-model.js';
const at=s=>Date.parse(`2026-11-16T${s}:00Z`);
async function fixture({slots=2,end=null,sell='2026-11-16T14:00',repeat='once',afterBuy='list',perSearch=1}={}){
 let time=at('07:00'),id=0,used=100-slots,copies=0;const calls=[],data=new Map(),context={scope:'scheduled',season:'27',platform:'console'};
 const get=async(k,d)=>structuredClone(data.get(k)??d),set=async(k,v)=>data.set(k,structuredClone(v));
 const locks={request:async(name,options,fn)=>fn({name,mode:'exclusive'})},now=()=>time;
 const store=createTradingTaskStore({context:()=>context,get,set,locks,now,id:()=> 'task'});
 const coordinator=createMarketCoordinator({context:()=>context,get,set,locks});
 const input={name:'Scheduled',mode:'fixed',settings:{...defaultTradingTaskSettings(),afterBuy,buyRule:'fixed',buyValue:700,sellRule:'fixed',sellValue:800,runMinutes:10},
  players:[{name:'Card',definitionId:901,rating:84,version:'gold',cap:null,qty:null}],owned:[],excluded:[],
  schedule:{repeat,zone:'UTC',start:repeat==='once'?'2026-11-16T08:00':'08:00',end,sell}};
 let snapshot=await store.saveTask({...await store.read(),input});
 if(perSearch!==1)snapshot=await store.saveSettings({...snapshot,settings:{...snapshot.store.settings,perSearch}});
 const hooks={};
 const native={priceTiers:()=>[{min:0,inc:50}],
  async preflight({action}){if(hooks.preflight)await hooks.preflight(action);if(['buy','search','move'].includes(action.kind)&&used>=100)throw Error('MARKET_TRANSFER_FULL');return {ready:true,freeSlots:100-used,balance:100000};},
  async send({action,beforeDispatch}){if(hooks.send)await hooks.send(action);beforeDispatch();calls.push({kind:action.kind,at:time});if(hooks.afterDispatch)hooks.afterDispatch(action);
   if(action.kind==='search')return {status:'confirmed',sent:true,offers:Array.from({length:perSearch},()=>({itemId:String(++copies),tradeId:String(copies+100),definitionId:901,coins:600}))};
   if(action.kind==='move')used++;
   return {status:'confirmed',sent:true,receipt:{itemId:action.itemId,definitionId:901,tradeId:action.kind==='move'?null:action.kind==='list'?`listing${action.itemId}`:action.tradeId,coins:action.coins}};
  },
  async readSales(rows){return rows.map(h=>({itemId:h.itemId,definitionId:h.definitionId,tradeId:h.listingTradeId,sold:true,price:800}));},
  reconcile:async()=>({status:'unknown'}),verifySession:async()=>({ready:true})};
 const quotes=vi.fn(()=>{throw Error('fixed needs no quotes');});
 const provider=createMarketTaskProvider({context,native,loadQuotes:quotes,assertCurrent(){},now,id:()=>`a${++id}`});
 const statuses=[];
 const scheduler=createMarketTaskScheduler({taskStore:store,coordinator,provider,enabled:true,now,id:()=>`w${++id}`,random:()=>0,
  wait:async ms=>{const pending=scheduler.inspect().tasks.filter(t=>t.reason==='MARKET_SCHEDULE_WAIT'&&t.nextAt>time);time=pending.length?Math.min(...pending.map(t=>t.nextAt)):time+ms;if(hooks.wait)await hooks.wait();},
  onStatus:s=>{statuses.push(s);if(statuses.length>2000)throw Error('too many cycles');}});
 return {input,store,coordinator,snapshot,scheduler,calls,quotes,hooks,statuses,now,setTime:t=>{time=t;},free:()=>{used=0;},
  run:()=>scheduler.run({approved:true,snapshot,taskIds:['task']})};
}
it('ends a scheduled batch at reserved capacity, then lists at the original sale time',async()=>{
 const f=await fixture({slots:2,perSearch:3});await f.run();
 expect(f.calls.filter(c=>c.kind!=='sales').map(c=>c.kind)).toEqual(['search','buy','buy','move','move','list','list']);
 expect(f.calls.filter(c=>c.kind==='list').every(c=>c.at===at('14:00'))).toBe(true);
 const ledger=(await f.coordinator.inspect()).ledger;
 expect(ledger.schedules[0].buyClosed).toBe('full');expect(ledger.holdings.every(h=>h.phase==='sold')).toBe(true);
});
it('drops remaining batch offers at the buy cutoff and retains the separate sale time',async()=>{
 const f=await fixture({slots:3,perSearch:3,end:'2026-11-16T09:00'});
 f.hooks.afterDispatch=a=>{if(a.kind==='buy')f.setTime(at('09:00'));};
 await f.run();expect(f.calls.filter(c=>c.kind!=='sales').map(c=>c.kind)).toEqual(['search','buy','move','list']);
 expect(f.calls.find(c=>c.kind==='list').at).toBe(at('14:00'));
 expect((await f.coordinator.inspect()).ledger.schedules[0].buyClosed).toBe('deadline');
});
it('buys and moves to capacity in hold mode, then explicitly lists the original holdings without rebuying',async()=>{
 const f=await fixture({afterBuy:'hold'});await f.run();
 expect(f.calls.map(c=>c.kind)).toEqual(['search','buy','move','search','buy','move']);
 let ledger=(await f.coordinator.inspect()).ledger;
 expect(ledger.holdings.map(h=>h.phase)).toEqual(['transfer','transfer']);
 expect(ledger.schedules[0].buyClosed).toBe('full');expect(f.now()).toBeLessThan(at('14:00'));
 const snapshot=await f.store.saveTask({...await f.store.read(),id:'task',input:{...f.input,settings:{...f.input.settings,afterBuy:'list'}}});
 await f.scheduler.run({approved:true,snapshot,taskIds:['task']});
 ledger=(await f.coordinator.inspect()).ledger;
 expect(f.calls.filter(c=>c.kind==='buy')).toHaveLength(2);expect(f.calls.filter(c=>c.kind==='list')).toHaveLength(2);
 expect(ledger.holdings.every(h=>h.phase==='sold'&&h.cost===600)).toBe(true);expect(f.quotes).not.toHaveBeenCalled();
});
it('finishes a hold-only move after the buy cutoff without listing',async()=>{
 const f=await fixture({afterBuy:'hold',slots:1,end:'2026-11-16T09:00'});
 f.hooks.afterDispatch=a=>{if(a.kind==='buy')f.setTime(at('09:00'));};
 await f.run();expect(f.calls.map(c=>c.kind)).toEqual(['search','buy','move']);
 expect((await f.coordinator.inspect()).ledger.holdings[0]).toMatchObject({phase:'transfer',cost:600});
});
it('waits until eight, fills the two remaining slots, then lists at fourteen without buying again',async()=>{
 const f=await fixture();const result=await f.run();expect(result.reason).toBeNull();
 expect(f.calls.filter(c=>c.kind==='buy')).toHaveLength(2);
 expect(f.calls.filter(c=>c.kind==='list')).toHaveLength(2);
 expect(f.calls.every(c=>c.at>=at('08:00'))).toBe(true);
 expect(f.calls.filter(c=>c.kind==='list').every(c=>c.at>=at('14:00'))).toBe(true);
 const l=(await f.coordinator.inspect()).ledger;
 expect(l.schedules[0].buyClosed).toBe('full');expect(l.holdings.every(h=>h.phase==='sold'&&h.sellAt===at('14:00'))).toBe(true);
 expect(l.clocks[0].elapsedMs).toBeLessThan(60000);expect(f.quotes).not.toHaveBeenCalled();
 f.free();await f.run();expect(f.calls.filter(c=>c.kind==='buy')).toHaveLength(2);
});
it('closes buying at the deadline even when search returned before the final payment boundary',async()=>{
 const f=await fixture({end:'2026-11-16T09:00'});
 f.hooks.send=a=>{if(a.kind==='buy')f.setTime(at('09:00'));};
 await f.run();expect(f.calls.map(c=>c.kind)).toEqual(['search']);
 const l=(await f.coordinator.inspect()).ledger;
 expect(l.schedules[0].buyClosed).toBe('deadline');expect(l.intents[0].phase).toBe('rejected');expect(l.holdings).toEqual([]);
});
it('an initially full list closes only the scheduled buy phase with zero quotes/search/buy',async()=>{
 const f=await fixture({slots:0});await f.run();
 expect(f.calls).toEqual([]);expect(f.quotes).not.toHaveBeenCalled();
 expect((await f.coordinator.inspect()).ledger.schedules[0].buyClosed).toBe('full');
});
it('pause during scheduled wait revokes authority and sends nothing',async()=>{
 const f=await fixture();f.hooks.wait=()=>f.scheduler.pauseAll();await f.run();expect(f.calls).toEqual([]);
 expect((await f.coordinator.inspect()).ledger.clocks??[]).toEqual([]);
});
it('preserves schedule on readback, and disabling it removes the stored schedule',async()=>{
 const f=await fixture();const read=await f.store.read();expect(read.store.tasks[0].schedule).toEqual(f.input.schedule);
 const off=await f.store.saveTask({...read,id:'task',input:{...f.input,schedule:null}});expect(off.store.tasks[0].schedule).toBeUndefined();
});
it('daily repeat starts a new round only the next day and preserves old costs and sale gates',async()=>{
 const f=await fixture({slots:1,repeat:'daily',sell:'14:00'});let second=false;
 f.hooks.wait=()=>{if(f.now()>=at('08:00')+86400000&&!second){second=true;f.free();}if(f.now()>at('08:00')+86400000+1000)f.scheduler.pauseAll();};
 // Stop after the next day's first purchase, without advancing through days.
 f.hooks.afterDispatch=a=>{if(second&&a.kind==='buy')f.scheduler.pauseAll();};
 await f.run();
 expect(f.calls.filter(c=>c.kind==='buy')).toHaveLength(2);
 const l=(await f.coordinator.inspect()).ledger;
 expect(l.holdings).toHaveLength(2);expect(l.holdings[0].sellAt).toBe(at('14:00'));expect(l.holdings[1].sellAt).toBe(at('14:00')+86400000);
 expect(l.intents.filter(i=>i.kind==='buy'&&i.phase==='confirmed')).toHaveLength(2);
});
it('a bought card still moves and lists when its receipt crosses the buy cutoff',async()=>{
 const f=await fixture({slots:1,end:'2026-11-16T09:00'});
 f.hooks.afterDispatch=a=>{if(a.kind==='buy')f.setTime(at('09:00'));};
 await f.run();expect(f.calls.filter(c=>c.kind==='buy')).toHaveLength(1);expect(f.calls.filter(c=>c.kind==='list')).toHaveLength(1);
 expect((await f.coordinator.inspect()).ledger.holdings[0].phase).toBe('sold');
});
it('an immediate-sale schedule retains the existing buy/move/list order',async()=>{
 const f=await fixture({slots:1,sell:null});await f.run();
 expect(f.calls.map(c=>c.kind)).toEqual(['search','buy','move','list']);
 expect(f.calls.at(-1).at).toBeLessThan(at('14:00'));
});
