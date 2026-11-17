import path from 'node:path';
import { openProductionPanel, selectPanelTab } from './production-panel-inspection.mjs';

// Default: static-name UI only, useful after authentication failure. An explicit
// readVersions option permits one concept selection after a new login; neither
// mode probes health, searches auctions or performs trades.
export async function verifyMarketPlayerUi(context,page,directory,{readVersions=false}={}){
 const cdp=await context.newCDPSession(page),viewport=page.viewportSize()??await page.evaluate(()=>({width:globalThis.innerWidth,height:globalThis.innerHeight}));let opened=false,call;
 const nativeReady=await page.evaluate(()=>{
  let control;try{if(typeof globalThis.UTPlayerSearchControl!=='function')return 'unavailable';control=new globalThis.UTPlayerSearchControl();control.init();return control.getRootElement()?.querySelector('input')?'ready':'no-input';}
  catch{return 'initialization-failed';}finally{try{control?.dealloc();}catch{/* Incomplete detached control only. */}}
 });
 try{
  await openProductionPanel(context,page);await selectPanelTab(context,page,'trading');
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  const find=node=>{const a=node.attributes??[],i=a.indexOf('class');if(i>=0&&a[i+1].split(' ').includes('market-task-manager'))return node;for(const c of [...node.children??[],...node.shadowRoots??[]]){const r=find(c);if(r)return r;}return null;};
  const shadow=find(root)?.shadowRoots?.find(n=>n.shadowRootType==='closed');if(!shadow)return {status:'view-unavailable'};
  const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:shadow.backendNodeId,objectGroup:'player-ui'});
  call=async(fn,...args)=>{const r=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,returnByValue:true,functionDeclaration:fn.toString(),arguments:args.map(value=>({value}))});if(r.exceptionDetails)throw Error('PLAYER_UI_READ_FAILED');return r.result.value;};
  const click=async selector=>{const p=await call(function(s){const e=this.querySelector(s);if(!e||e.disabled||!e.checkVisibility())return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=this.elementFromPoint(x,y),outer=this.host.getRootNode();return (hit===e||e.contains(hit))&&outer.elementFromPoint(x,y)===this.host&&this.ownerDocument.elementFromPoint(x,y)===outer.host?{x,y}:null;},selector);if(!p)throw Error('PLAYER_UI_CONTROL_UNAVAILABLE');await page.mouse.click(p.x,p.y);};
  if(await call(function(){return !!this.querySelector('dialog[open]');}))return {status:'user-draft-open'};
  await click('#newTask');opened=true;await click('#addPlayer');await click('#playerSearch');await page.keyboard.type('Raya');
  const read=()=>call(function(){const input=this.getElementById('playerSearch'),dialog=this.getElementById('picker');return {native:!!this.querySelector('[data-fcat-native-player-search]'),names:[...this.querySelectorAll('.playerResultsList .btn-text')].map(e=>e.textContent),ratings:[...this.querySelectorAll('.playerResultsList .btn-subtext')].map(e=>e.textContent),input:input?.value,open:!!this.querySelector('.ut-player-search-control.is-open'),fits:dialog.scrollWidth<=dialog.clientWidth+1};});
  let desktop;for(let n=0;n<30;n++){desktop=await read();if(desktop.names.length)break;await page.waitForTimeout(100);}
  if(!desktop.native||!desktop.names.includes('David Raya'))throw Error('PLAYER_UI_NATIVE_NAMES_UNAVAILABLE');
  await page.screenshot({path:path.join(directory,'market-player-native-live-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);const mobile=await read();if(!mobile.fits)throw Error('PLAYER_UI_OVERFLOW');
  await page.screenshot({path:path.join(directory,'market-player-native-live-mobile.png')});
  await click('.ut-player-search-control .exit-btn');await page.waitForTimeout(100);const cleared=await read();if(cleared.input||cleared.open)throw Error('PLAYER_UI_CLEAR_FAILED');
  await click('[data-close="picker"]');await click('#addPlayer');const reopened=await read();if(reopened.input||reopened.open)throw Error('PLAYER_UI_REOPEN_FAILED');
  let versions=null;
  if(readVersions){
   await click('#playerSearch');await page.keyboard.type('Raya');
   for(let n=0;n<30;n++){if((await read()).names.length)break;await page.waitForTimeout(100);}
   await click('[data-player-identity="220901"]');
   for(let n=0;n<200;n++){
    versions=await call(function(){return {rows:[...this.querySelectorAll('#pickerRows [data-add]')].map(e=>({definitionId:e.dataset.add,text:e.parentElement.textContent})),message:this.getElementById('pickerRows').textContent};});
    if(!versions.message.includes('正在读取'))break;await page.waitForTimeout(100);
   }
   await page.screenshot({path:path.join(directory,'market-player-native-live-versions.png')});
  }
  return {status:readVersions?'observed-with-version-read':'observed-local-only',nativeReady,desktop,mobile,cleared,reopened,versionRead:readVersions,versions,taskSaves:0,taskStarts:0,eaMutations:0};
 }catch(error){await page.screenshot({path:path.join(directory,'market-player-ui-unavailable.png')}).catch(()=>{});return {status:'unavailable',nativeReady,reason:/^(PLAYER_UI|FC27_)[A-Z_]+$/.test(error.message)?error.message:'CONTROL_UNAVAILABLE',taskSaves:0,taskStarts:0,eaMutations:0};}finally{
  if(opened&&call)for(const selector of ['[data-close="picker"]','[data-close="editor"]']){
   const p=await call(function(s){const e=this.querySelector(s);if(!e?.checkVisibility())return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector).catch(()=>null);if(p)await page.mouse.click(p.x,p.y);
  }
  if(viewport)await page.setViewportSize(viewport);
  await cdp.send('Runtime.releaseObjectGroup',{objectGroup:'player-ui'}).catch(()=>{});await cdp.detach();
 }
}
