import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseMarketTaskSchedule(context,directory){
 const bundle=await build({stdin:{resolveDir:path.resolve(import.meta.dirname,'../..'),contents:`
 export {mountFc27MarketTasks} from './src/adapters/browser/fc27-market-task-view.js';
 export {createTradingTaskStore} from './src/adapters/browser/fc27-trading-task-store.js';
 export {createMarketCoordinator} from './src/adapters/browser/fc27-market-coordinator.js';
 export {createMarketTaskScheduler} from './src/trading/market-task-scheduler.js';
 export {createMarketTaskProvider} from './src/trading/market-task-provider.js';
 export {defaultTradingTaskSettings} from './src/trading/task-model.js';
 `},bundle:true,write:false,format:'iife',globalName:'ScheduleFixture'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url()==='https://fcat-offline.invalid/schedule'?route.fulfill({contentType:'text/html',body:'<!doctype html><div id="parent"></div>'}):route.abort());
 try{
  await page.goto('https://fcat-offline.invalid/schedule');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(async()=>{
   const a=globalThis.ScheduleFixture,attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(o){return attach.call(this,{...o,mode:'open'});};
   const state=globalThis.scheduleSmoke={time:Date.UTC(2030,0,1,7),calls:[],used:99},data=new Map(),ctx={scope:'schedule-fixture',season:'27',platform:'console'};let serial=0;
   const get=async(k,d)=>structuredClone(data.get(k)??d),set=async(k,v)=>data.set(k,structuredClone(v));
   const service=a.createTradingTaskStore({context:()=>ctx,get,set,locks:globalThis.navigator.locks,id:()=> 'one'}),coord=a.createMarketCoordinator({context:()=>ctx,get,set,locks:globalThis.navigator.locks});
   const input={name:'08:00 buy / 14:00 list',mode:'fixed',settings:{...a.defaultTradingTaskSettings(),buyRule:'fixed',buyValue:700,sellRule:'fixed',sellValue:800},
    players:[{definitionId:901,name:'Fixture',rating:84,version:'gold',cap:null,qty:null}],owned:[],excluded:[],schedule:{repeat:'once',zone:'UTC',start:'2030-01-01T08:00',end:null,sell:'2030-01-01T14:00'}};
   await service.saveTask({...await service.read(),input});
   const native={priceTiers:()=>[{min:0,inc:50}],preflight:async({action})=>{if(state.used===100&&['search','buy','move'].includes(action.kind))throw Error('MARKET_TRANSFER_FULL');return {ready:true,freeSlots:100-state.used,balance:10000};},
    send:async({action,beforeDispatch})=>{beforeDispatch();state.calls.push({kind:action.kind,time:state.time});if(action.kind==='search')return {sent:true,status:'confirmed',offers:[{itemId:'1',tradeId:'2',definitionId:901,coins:600}]};if(action.kind==='move')state.used++;
     return {sent:true,status:'confirmed',receipt:{itemId:'1',definitionId:901,coins:action.coins,tradeId:action.kind==='buy'?'2':action.kind==='list'?'3':null}};},
    readSales:async rows=>rows.map(h=>({itemId:h.itemId,definitionId:h.definitionId,tradeId:h.listingTradeId,sold:true,price:800})),reconcile:async()=>({status:'unknown'})};
   const provider=a.createMarketTaskProvider({context:ctx,native,assertCurrent(){},loadQuotes:()=>{throw Error('No quote request');},now:()=>state.time,id:()=>String(++serial)});
   const scheduler=a.createMarketTaskScheduler({taskStore:service,coordinator:coord,provider,enabled:true,now:()=>state.time,id:()=>String(++serial),random:()=>0,
    wait:async ms=>{const wake=scheduler.inspect().tasks.filter(t=>t.reason==='MARKET_SCHEDULE_WAIT'&&t.nextAt>state.time);state.time=wake.length?Math.min(...wake.map(t=>t.nextAt)):state.time+ms;}});
   state.scheduler=scheduler;state.coord=coord;
   a.mountFc27MarketTasks({document:globalThis.document,parent:globalThis.document.getElementById('parent'),tab:globalThis.document.createElement('button'),service,readCoordination:()=>coord.inspect(),runtime:scheduler}).setActive(true);
  });
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.waitForSelector('#schedule-start');
  assert.equal(await page.locator('#schedule-start').inputValue(),'2030-01-01T08:00');
  assert.equal(await page.locator('#schedule-end').inputValue(),'');
  await page.setViewportSize({width:390,height:844});await page.locator('#schedule-sell').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'market-schedule-mobile.png')});
  await page.locator('[data-close="editor"]').first().click();
  await page.locator('[data-action="start"]').click();await page.locator('#confirmYes').click();
  await page.waitForFunction(()=>globalThis.scheduleSmoke.scheduler.inspect().tasks.some(t=>t.state==='completed'));
  const result=await page.evaluate(async()=>({calls:globalThis.scheduleSmoke.calls,ledger:(await globalThis.scheduleSmoke.coord.inspect()).ledger}));
  assert.deepEqual(result.calls.map(c=>c.kind),['search','buy','move','list']);
  assert.ok(result.calls.slice(0,3).every(c=>c.time>=Date.UTC(2030,0,1,8)&&c.time<Date.UTC(2030,0,1,14)));
  assert.equal(result.calls[3].time,Date.UTC(2030,0,1,14));assert.equal(result.ledger.schedules[0].buyClosed,'full');
  assert.ok(result.ledger.clocks[0].elapsedMs<60000);assert.deepEqual(errors,[]);
  console.log('Scheduled market Chrome passed: saved times, optional full capacity, 390px editor, trusted start, 08:00 buy/move and 14:00 list, pure wait not charged; simulated EA only.');
 }finally{await page.close();}
}
