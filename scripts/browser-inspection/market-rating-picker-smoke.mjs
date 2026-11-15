import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseMarketRatingPicker(context,directory){
 const bundle=await build({stdin:{resolveDir:path.resolve(import.meta.dirname,'../..'),contents:`
 export {mountFc27MarketTasks} from './src/adapters/browser/fc27-market-task-view.js';
 export {createTradingTaskStore} from './src/adapters/browser/fc27-trading-task-store.js';
 export {createFc27MarketPlayerPicker} from './src/adapters/ea/fc27-market-player-picker.js';
 `},bundle:true,write:false,format:'iife',globalName:'RatingFixture'});
 const page=await context.newPage(),errors=[];let requests=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',()=>requests++);
 try{
  await page.setViewportSize({width:1280,height:900});await page.setContent('<!doctype html><div id="parent"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
   const a=globalThis.RatingFixture,attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(o){return attach.call(this,{...o,mode:'open'});};
   const data=new Map(),ctx={scope:'rating-fixture',season:'27',platform:'console'};let id=0;
   const service=a.createTradingTaskStore({context:()=>ctx,get:async(k,d)=>structuredClone(data.get(k)??d),set:async(k,v)=>data.set(k,structuredClone(v)),locks:{request:async(_n,_o,fn)=>fn()},id:()=>`task-${++id}`});globalThis.ratingStore=service;
   const names=[{id:101,rating:88,commonName:'David Raya'},{id:202,rating:79,commonName:'Rayan'}];globalThis.versionRequests=0;
   const picker=a.createFc27MarketPlayerPicker({context:()=>ctx,root:{ItemIdMask:{DATABASE:0xffffff},repositories:{Item:{getStaticData:()=>names}},UTPlayerSearchEngine:class{getEntriesForString(q){return q.toLowerCase().includes('raya')?names:[];}}},
    createTransport:async()=>({readPlayerVersions:async({playerId})=>{globalThis.versionRequests++;return {entries:Array.from({length:7},(_,i)=>({definitionId:playerId+0x1000000*i,rating:88+i,rarity:i?3:1,evolution:false,cosmetic:false})),pageEndObserved:true};}})});
   a.mountFc27MarketTasks({document:globalThis.document,parent:globalThis.document.getElementById('parent'),tab:globalThis.document.createElement('button'),service,playerPicker:picker}).setActive(true);
  });
  const v=page.locator('.market-task-manager');await v.locator('#newTask').click();await v.locator('[data-mode=filter]').click();await v.locator('#taskName').fill('分档任务');
  await v.locator('#ratingMin').fill('83');await v.locator('#ratingMax').fill('90');await v.locator('#rating-price-mode').selectOption('rating');
  assert.equal(await v.locator('#rating-price-rows .rating-grid').count(),5);assert.equal(await v.locator('#buyFields').isVisible(),false);
  const field=(r,side)=>v.locator(`input[data-rating="${r}"][data-side="${side}"]`);
  await field(83,'buy').fill('800');await field(83,'sell').fill('1000');await field(83,'sell').press('Tab');
  await v.getByRole('button',{name:'83 挂牌价 增加',exact:true}).click();assert.equal(await field(83,'sell').inputValue(),'1100');
  await v.getByRole('button',{name:'83 挂牌价 减少',exact:true}).click();await v.getByRole('button',{name:'83 挂牌价 减少',exact:true}).click();assert.equal(await field(83,'sell').inputValue(),'950');
  assert.equal(await field(84,'sell').inputValue(),'');await v.locator('#rating-price-expand').click();assert.equal(await v.locator('#rating-price-rows .rating-grid').count(),8);
  await field(89,'buy').fill('1500');await field(89,'sell').fill('1800');await field(89,'sell').press('Tab');
  await v.locator('#ratingMax').fill('85');await v.locator('#taskName').click();assert.match(await v.locator('#rating-price-summary').textContent(),/1 \/ 3/);
  await page.screenshot({path:path.join(directory,'market-rating-editor-desktop.png')});
  await v.locator('#taskForm button[type=submit]').click();await v.locator('#tasks .task-name').getByText('分档任务',{exact:true}).waitFor();
  let task=await page.evaluate(async()=>(await globalThis.ratingStore.read()).store.tasks[0]);assert.deepEqual(task.ratingPrices['89'],{buy:1500,sell:1800});assert.equal(task.settings.ratingMax,85);
  await v.locator('[data-action=edit]').click();assert.equal(await field(83,'sell').inputValue(),'950');await v.locator('#ratingMax').fill('90');await v.locator('#taskName').click();await v.locator('#rating-price-expand').click();assert.equal(await field(89,'buy').inputValue(),'1500');
  await page.setViewportSize({width:390,height:844});await v.locator('#rating-price-mode').scrollIntoViewIfNeeded();assert.equal(await v.locator('#editor').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.screenshot({path:path.join(directory,'market-rating-editor-mobile.png')});
  await v.locator('[data-mode=fixed]').click();assert.equal(await v.locator('#rating-prices').isVisible(),false);await v.locator('#addPlayer').click();await v.locator('#playerSearch').fill('Raya');await v.locator('[data-player-identity="101"]').waitFor();assert.equal(await page.evaluate(()=>globalThis.versionRequests),0);
  await v.locator('[data-player-identity="101"]').click();await v.locator('[data-add="101"]').waitFor();assert.equal(await v.locator('#pickerRows [data-add]').count(),5);await v.locator('[data-player-next]').click();assert.equal(await v.locator('#pickerRows [data-add]').count(),2);
  const chosen=101+0x1000000*5;await v.locator(`[data-add="${chosen}"]`).click();assert.equal(await v.locator(`[data-add="${chosen}"]`).isDisabled(),true);assert.equal(await page.evaluate(()=>globalThis.versionRequests),1);
  await v.locator('[data-close=picker]').click();await v.locator('#taskForm button[type=submit]').click();await v.locator('#toast').getByText('任务已保存，尚未启动。',{exact:true}).waitFor();
  task=await page.evaluate(async()=>(await globalThis.ratingStore.read()).store.tasks[0]);assert.equal(task.mode,'fixed');assert.equal(task.players[0].definitionId,chosen);assert.equal(task.ratingPrices,undefined);
  // New filter task: buy-only rows require no hidden sale price and retain
  // the hold setting across save/copy/reopen. Changing back requires sell data.
  await v.locator('#newTask').click();await v.locator('[data-mode=filter]').click();await v.locator('#taskName').fill('Hold only');
  await v.locator('#afterBuy').selectOption('hold');await v.locator('#rating-price-mode').selectOption('rating');
  assert.equal(await v.locator('#sellRule').isVisible(),false);assert.equal(await v.locator('#duration').isVisible(),false);assert.equal(await v.locator('#relist').isVisible(),false);
  assert.equal(await v.locator('input[data-side=sell]').count(),0);
  await field(84,'buy').fill('1100');await field(84,'buy').press('Tab');
  await v.locator('#market-schedule summary').click();await v.locator('#schedule-enabled').check();
  assert.equal(await v.locator('#schedule-sell').isVisible(),false);await v.locator('#schedule-enabled').uncheck();
  await v.locator('#taskForm button[type=submit]').click();await v.locator('#tasks .task-name').getByText('Hold only',{exact:true}).waitFor();
  task=await page.evaluate(async()=>(await globalThis.ratingStore.read()).store.tasks[1]);assert.equal(task.settings.afterBuy,'hold');assert.deepEqual(task.ratingPrices['84'],{buy:1100,sell:null});
  assert.match(await v.locator('[data-action=detail][data-id="task-2"]').locator('..').innerText(),/Hold only/);
  await v.locator('[data-action=detail][data-id="task-2"]').click();
  assert.match(await v.locator('#taskDetailBody').innerText(),/After buying: Hold only/);
  assert.doesNotMatch(await v.locator('#taskDetailBody').innerText(),/卖出：|重挂：/);
  await v.locator('[data-close=taskDetail]').click();
  await v.locator('[data-action=copy][data-id="task-2"]').click();
  await v.locator('[data-action=edit][data-id="task-3"]').waitFor();await v.locator('[data-action=edit][data-id="task-3"]').click();
  assert.equal(await v.locator('#afterBuy').inputValue(),'hold');assert.equal(await field(84,'buy').inputValue(),'1100');
  await v.locator('#afterBuy').selectOption('list');assert.equal(await field(84,'sell').inputValue(),'');assert.equal(await v.locator('#duration').isVisible(),true);
  await v.locator('#taskForm button[type=submit]').click();assert.equal(await v.locator('#editor').isVisible(),true);
  await field(84,'sell').fill('1400');await field(84,'sell').press('Tab');
  await v.locator('#afterBuy').selectOption('hold');await v.locator('#afterBuy').selectOption('list');assert.equal(await field(84,'sell').inputValue(),'1400');
  await v.locator('#taskForm button[type=submit]').click();await v.locator('#editor').waitFor({state:'hidden'});
  task=await page.evaluate(async()=>(await globalThis.ratingStore.read()).store.tasks[2]);assert.equal(task.settings.afterBuy,'list');assert.equal(task.ratingPrices['84'].sell,1400);
  assert.deepEqual(errors,[]);assert.equal(requests,0);
  console.log('Rating/picker Chrome passed: separate prices, EA tier arrows, partial/range retention, saved/reopened configs, five visible rows/versions, native-name then exact-version selection, 390px; zero network/EA writes.');
 }catch(error){console.error({errors,ui:await page.locator('#editor').textContent(),fields:await page.locator('#editor input,#editor select').evaluateAll(nodes=>nodes.map(n=>({id:n.id,value:n.value})))});await page.screenshot({path:path.join(directory,'market-rating-failure.png')});throw error;}finally{await page.close();}
}
