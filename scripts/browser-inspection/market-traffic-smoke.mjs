import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseMarketTraffic(context){
 const bundle=await build({stdin:{resolveDir:path.resolve(import.meta.dirname,'../..'),contents:`
 export {createFc27MarketTraffic} from './src/adapters/browser/fc27-market-traffic.js';
 export {defaultTradingPublicSettings} from './src/trading/task-model.js';
 `},bundle:true,write:false,format:'iife',globalName:'TrafficFixture'});
 const pages=await Promise.all([context.newPage(),context.newPage()]),errors=[];
 try{
  for(const page of pages){
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>route.request().url()==='https://fcat-traffic.invalid/'?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Offline common market gate</title>'}):route.abort());
   await page.goto('https://fcat-traffic.invalid/');await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.evaluate(()=>{
    const a=globalThis.TrafficFixture;globalThis.sent=0;globalThis.time=100000;
    globalThis.traffic=a.createFc27MarketTraffic({context:()=>({scope:'synthetic',season:'27',platform:'console'}),locks:navigator.locks,
     get:async(k,d)=>JSON.parse(localStorage.getItem(k)??JSON.stringify(d)),set:async(k,v)=>localStorage.setItem(k,JSON.stringify(v)),
     readSettings:a.defaultTradingPublicSettings,now:()=>globalThis.time,random:()=>0});
   });
  }
  await pages[0].evaluate(()=>localStorage.clear());
  await Promise.all(pages.map(p=>p.evaluate(()=>globalThis.traffic.inspect())));
  const attempts=await Promise.all(pages.map(p=>p.evaluate(async()=>{try{await globalThis.traffic.run('search',()=>{},()=>{globalThis.sent++;return {success:true};},{wait:false});return 'sent';}catch(e){return e.message;}})));
  assert.deepEqual(attempts.sort(),['MARKET_TRAFFIC_WAIT','sent']);
  assert.equal(await pages[1].evaluate(async()=>(await globalThis.traffic.inspect()).gate.hour),1);
  await pages[0].evaluate(()=>globalThis.traffic.signal('throttle'));
  assert.equal(await pages[1].evaluate(async()=>{try{await globalThis.traffic.run('buy',()=>{},()=>{globalThis.sent++;});}catch(e){return e.message;}}),'MARKET_TRAFFIC_STOPPED');
  // Reloading the other tab does not reset the persisted search budget/stop.
  const before=await pages[1].evaluate(()=>JSON.stringify(localStorage));await pages[1].reload();
  assert.equal(await pages[1].evaluate(()=>JSON.stringify(localStorage)),before);
  assert.deepEqual(errors,[]);
  console.log('Common FCAT market gate: two real browser tabs share Web Locks, one search slot and persistent stop; no EA traffic.');
 }finally{await Promise.all(pages.map(p=>p.close()));}
}
