import { it, expect, vi } from 'vitest';
import { createFc27MarketTraffic } from '../../src/adapters/browser/fc27-market-traffic.js';
import { defaultTradingPublicSettings } from '../../src/trading/task-model.js';
import { marketCoordinationKey } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { emptyMarketCoordination } from '../../src/trading/market-coordination.js';
import { registerFc27MarketTraffic } from '../../src/adapters/ea/fc27-market-traffic.js';
import { fc27TrafficRuntime } from '../../src/adapters/ea/fc27-market-traffic-runtime.js';
import { marketTaskNativeRuntime } from '../../src/adapters/ea/fc27-market-task-runtime.js';
async function fixture(){
 let clock=100000,serial=0,ctx={scope:'one',season:'27',platform:'console'},settings=defaultTradingPublicSettings(),queue=Promise.resolve();const data=new Map();
 const locks={request:async(_n,_o,fn)=>{const prior=queue;let release;queue=new Promise(r=>{release=r;});await prior;try{return await fn();}finally{release();}}};
 const options={context:()=>ctx,get:async(k,d)=>structuredClone(data.get(k)??d),set:async(k,v)=>data.set(k,structuredClone(v)),locks,
  readSettings:()=>settings,now:()=>clock,random:()=>0,sleep:async ms=>{clock+=ms;},id:()=>`id${++serial}`};
 return {gate:createFc27MarketTraffic(options),other:createFc27MarketTraffic(options),options,data,ctx,settings,advance:n=>{clock+=n;},switch:()=>{ctx={...ctx,scope:'two'};},now:()=>clock};
}
it('counts every dispatched search including empty, rejected and thrown responses, but not public reads',async()=>{
 const f=await fixture();for(const result of [{success:true,data:{items:[]}},{success:false,status:500}])await f.gate.run('search',()=>{},()=>result);
 await expect(f.gate.run('search',()=>{},()=>{throw Error('network timeout');})).rejects.toThrow('timeout');
 expect((await f.gate.inspect()).gate.hour).toBe(3);
});
it('never sends if persistence cannot be verified and conservatively retains sent reservations on receipt-save failure',async()=>{
 const f=await fixture(),send=vi.fn();let writes=0;
 const gate=createFc27MarketTraffic({...f.options,set:async(k,v)=>{if(++writes===1)return;await f.options.set(k,v);}});
 await expect(gate.run('search',()=>{},send)).rejects.toMatchObject({message:'MARKET_TRAFFIC_SAVE_UNVERIFIED',notSent:true});expect(send).not.toHaveBeenCalled();
 const other=createFc27MarketTraffic({...f.options,set:async(k,v)=>{if(++writes===3)throw Error('disk');await f.options.set(k,v);}});
 await expect(other.run('search',()=>{},()=>({success:true}))).rejects.toMatchObject({message:'disk',notSent:false});
 expect((await f.gate.inspect()).gate).toMatchObject({hour:1,uncertain:1});
});
it('an exact no-send cancellation after reservation releases quota without changing historical counts',async()=>{
 const f=await fixture();
 await expect(f.gate.run('search',()=>{},()=>{throw Error('cancelled');},{exactDispatch:true})).rejects.toMatchObject({notSent:true});
 expect((await f.gate.inspect()).gate).toMatchObject({hour:0,uncertain:0});
});
it('persisted throttle survives reload, policy reductions do not reset usage, malformed storage fails closed',async()=>{
 const f=await fixture();await f.gate.run('search',()=>{},()=>({success:true}));f.settings.hourLimit=1;
 expect((await f.other.inspect()).gate.nextAt).toBe(3700000);
 await f.gate.signal('authentication');await expect(f.other.run('move',()=>{},vi.fn())).rejects.toThrow('STOPPED');
 f.data.get(marketCoordinationKey(f.ctx)+':traffic').writes.buy=-1;await expect(f.other.inspect()).rejects.toThrow('INVALID');
});
it('checks storage bounds before sending and leaves the prior valid window intact',async()=>{
 const f=await fixture();f.settings.dayLimit=20000;f.settings.hourLimit=20000;
 await f.gate.inspect();const key=marketCoordinationKey(f.ctx)+':traffic';
 const prior=f.data.get(key);prior.ledger.searches=Array.from({length:10000},(_,i)=>({id:`old-${i}`,at:99000,status:'sent'}));
 const send=vi.fn();await expect(f.gate.run('search',()=>{},send)).rejects.toMatchObject({message:'MARKET_TRAFFIC_STORAGE_LIMIT',notSent:true});
 expect(send).not.toHaveBeenCalled();expect(f.data.get(key).ledger.searches).toHaveLength(10000);
 f.advance(86400000);await f.gate.run('search',()=>{},()=>({success:true}));expect((await f.gate.inspect()).gate.day).toBe(1);
});
it('a receipt read stays available during a stop, and a read authentication error stops other callers',async()=>{
 const f=await fixture();const root={services:{Item:{requestTransferItems:()=>({success:false,status:401}),list:vi.fn()}}};registerFc27MarketTraffic(root,f.gate);
 const runtime=fc27TrafficRuntime(root);expect(await runtime.services.Item.requestTransferItems()).toMatchObject({status:401});
 await expect(runtime.services.Item.list()).rejects.toThrow('FC27_MARKET_TRAFFIC_STOPPED');expect(root.services.Item.list).not.toHaveBeenCalled();
 expect(await runtime.services.Item.requestTransferItems()).toMatchObject({status:401});
});
it('legacy mutation checks cancellation and price eligibility after shared spacing, leaving native methods untouched',async()=>{
 const f=await fixture();await f.gate.run('list',()=>{},()=>({success:true}));
 const list=vi.fn(()=>({success:true})),root={services:{Item:{list}}};registerFc27MarketTraffic(root,f.gate);
 const runtime=fc27TrafficRuntime(root,{check:async(kind,args)=>{expect(kind).toBe('list');expect(args[2]).toBe(700);if(f.now()>100000)throw Error('price expired or stopped');}});
 await expect(runtime.services.Item.list({},650,700)).rejects.toThrow('price expired');expect(list).not.toHaveBeenCalled();expect(root.services.Item.list).toBe(list);
});
it('queued task dispatch cannot outlive its original boundary after its caller times out',async()=>{
 const f=await fixture();let release;
 const held=f.gate.run('search',()=>{},()=>new Promise(r=>{release=r;}));
 while(!release)await Promise.resolve();
 const send=vi.fn(),root={services:{Item:{searchTransferMarket:send}}};registerFc27MarketTraffic(root,f.other);
 const facade=marketTaskNativeRuntime(root);let pending;
 await facade.dispatch({beforeDispatch:vi.fn(),onBlocked:vi.fn()},()=>{pending=facade.runtime.services.Item.searchTransferMarket({});pending.catch(()=>{});});
 release({success:true});await held;
 await expect(pending).rejects.toThrow('MARKET_NOT_SENT');expect(send).not.toHaveBeenCalled();
});
it('serializes two callers and shares spacing instead of granting each a separate budget',async()=>{
 const f=await fixture(),calls=[];await Promise.all([f.gate,f.other].map(g=>g.run('search',()=>{},()=>{calls.push(f.now());return {success:true};})));
 expect(calls).toEqual([100000,107000]);expect((await f.gate.inspect()).gate.hour).toBe(2);
});
it('serializes zero-delay task listings and keeps ordinary buy, move and legacy listing spacing',async()=>{
 const f=await fixture(),calls=[];let active=0;
 await f.gate.run('buy',()=>{},()=>({success:true}));
 await Promise.all([f.gate,f.other].map(g=>g.run('list',()=>{},async()=>{
   expect(++active).toBe(1);calls.push(f.now());await Promise.resolve();active--;return {success:true};
 },{wait:false,taskListing:true})));
 expect(calls).toEqual([100000,100000]);
 for(const kind of ['buy','move','list']){
   await expect(f.gate.run(kind,()=>{},vi.fn(),{wait:false})).rejects.toThrow('MARKET_TRAFFIC_WAIT');
 }
 await expect(f.gate.run('buy',()=>{},vi.fn(),{wait:false,taskListing:true,taskListingMove:true})).rejects.toThrow('MARKET_TRAFFIC_WAIT');
 await f.gate.run('move',()=>{},()=>({success:true}),{wait:false,taskListingMove:true});
 await f.gate.signal('authentication');const send=vi.fn();
 await expect(f.gate.run('list',()=>{},send,{wait:false,taskListing:true})).rejects.toThrow('STOPPED');
 expect(send).not.toHaveBeenCalled();
 expect((await f.gate.inspect()).writes).toEqual({buy:1,move:1,list:2,relist:0});
});
it('returns a resumable wait without dispatch when a task cannot take the shared slot',async()=>{
 const f=await fixture(),send=vi.fn();await f.gate.run('search',()=>{},()=>({success:true}));
 await expect(f.other.run('search',()=>{},send,{wait:false})).rejects.toMatchObject({message:'MARKET_TRAFFIC_WAIT',retryAt:107000});expect(send).not.toHaveBeenCalled();
});
it('does not hold a legacy owner while waiting for a full hour quota',async()=>{
 const f=await fixture();f.settings.hourLimit=1;await f.gate.run('search',()=>{},()=>({success:true}));
 const send=vi.fn();await expect(f.other.run('search',()=>{},send)).rejects.toMatchObject({message:'MARKET_TRAFFIC_WAIT',retryAt:3700000});expect(send).not.toHaveBeenCalled();
});
it('a throttle in one module prevents both search and mutation in another without clearing evidence',async()=>{
 const f=await fixture();await f.gate.run('search',()=>{},()=>({success:false,status:429}));
 const send=vi.fn();for(const kind of ['search','buy','list'])await expect(f.other.run(kind,()=>{},send)).rejects.toThrow('STOPPED');
 expect(send).not.toHaveBeenCalled();expect((await f.gate.inspect()).gate.hour).toBe(1);
 await f.gate.clear();await f.other.run('list',()=>{},()=>({success:true}));expect((await f.gate.inspect()).writes.list).toBe(1);
});
it('cancels while awaiting spacing and preserves scope on account changes',async()=>{
 const f=await fixture();await f.gate.run('search',()=>{},()=>({success:true}));let checks=0;const send=vi.fn();
 await expect(f.other.run('search',()=>{if(++checks>2)throw Error('cancel');},send)).rejects.toThrow('cancel');expect(send).not.toHaveBeenCalled();
 await expect(f.gate.run('list',()=>{},()=>{f.switch();return {success:true};})).rejects.toThrow('CONTEXT_CHANGED');expect((await f.gate.inspect()).writes.list).toBe(0);
});
it('seeds the old task search history once without discarding transaction records',async()=>{
 const f=await fixture(),ledger=emptyMarketCoordination();ledger.searches=[{id:'old',at:f.now()-10000,status:'sent'}];
 const key=marketCoordinationKey(f.ctx);f.data.set(key,{context:f.ctx,ledger});
 await f.gate.run('search',()=>{},()=>({success:true}));expect((await f.other.inspect()).gate.hour).toBe(2);expect(f.data.get(key).ledger.searches).toHaveLength(1);
 f.data.get(key).ledger.searches.push({id:'new-local',at:f.now(),status:'sent'});expect((await f.gate.inspect()).gate.hour).toBe(2);
});
