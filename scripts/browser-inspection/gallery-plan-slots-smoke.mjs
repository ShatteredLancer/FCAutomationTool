import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {normalizeGalleryCatalog} from '../../src/gallery/catalog.js';
import {futggGallery} from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryPlanSlots(context,directory){
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const bundle=await build({absWorkingDir:path.resolve(import.meta.dirname,'../..'),entryPoints:['src/adapters/browser/fc27-acceptance-panel.js'],bundle:true,write:false,format:'iife',globalName:'SlotsFixture',target:'chrome120'});
 const input=futggGallery(),set=input.data.categories[0].sets[0];set.name='Scoring slots control';set.requiredCards=15;
 set.grades.forEach((grade,i)=>{grade.threshold=(i+1)*100;});
 input.data.tags=[{id:1,name:'No bonus',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',rules:[{type:'COUNT',target:'ATTRIBUTE',attribute:'RARE',values:['999']}],tiers:[{minItems:1,bonus:0}]}];
 const catalog=normalizeGalleryCatalog('futgg',input);let requests=0;page.on('request',()=>{requests++;});
 try{
  await page.setViewportSize({width:1400,height:1000});await page.setContent('<!doctype html><title>Gallery scoring slots control — offline</title>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(catalog=>{
   const attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
   const rows=Array.from({length:15},(_,i)=>({eaId:i+1,playerEaId:i+1,name:`Player ${i+1}`,gradingScore:100,galleryScore:100,overall:80,collected:i===0,held:i===0,firstOwned:false,holographic:false,positions:['ST'],clubEaId:1,leagueEaId:1,nationEaId:1,rarityEaId:1,weakFoot:3,skillMoves:3}));
   const prices=Object.fromEntries(rows.slice(1).map(row=>[row.eaId,200]));
   globalThis.slotsCalls={buys:0};
   const detail={status:'observed',scope:'fixture',pool:{source:'futgg',revision:'pool'},priceSnapshot:{prices,freshPrices:prices,expiresAt:Date.now()+300000},prices,
    progress:{season:'27',setId:30,complete:true,poolComplete:true,rows,totals:{total:15,collected:1,missing:14,unknown:0}}};
   globalThis.mountSlotsPanel=hostId=>globalThis.SlotsFixture.mountFc27AcceptancePanel({document:globalThis.document,hostId,targets:()=>[],galleryAccountScope:()=> 'fixture',
    galleryCatalog:{peek:async()=>null,load:async()=>({source:'futgg',status:'observed',catalog})},gallerySetLoader:async()=>detail,
    galleryPlanStore:{save:async(_scope,_source,_id,record)=>{globalThis.slotsSaved=structuredClone(record);},load:async()=>{
      if(!globalThis.slotsCorrupt)return {status:'unavailable'};
      const record=structuredClone(globalThis.slotsSaved);
      record.plan.plans=record.plan.plans.map(candidate=>({...candidate,items:candidate.items.slice(0,-1),scoringLineupIds:null}));
      return {status:'observed',record};}},
    purchaseGallery:async()=>{globalThis.slotsCalls.buys++;throw Error('No writes in fixture');}});
   globalThis.slotsPanel=globalThis.mountSlotsPanel('slots-test');globalThis.slotsPanel.open();
  },catalog);
  const panel=page.locator('#slots-test');await panel.locator('#tab-gallery').click();
  await panel.locator('#gallery-categories button').first().click();
  await panel.locator('[data-set-id="futgg:30"]').getByRole('button',{name:'查看卡片',exact:true}).click();const detail=panel.locator('#gallery-set-detail');
  await detail.getByRole('button',{name:'生成方案',exact:true}).click();
  await detail.locator('.gallery-plan-output').getByText(/找到 .* 个候选方案/).waitFor();
  assert.ok((await detail.locator('.gallery-plan-output').innerText()).includes('已有可计分 1 人＋本方案采购 14 人＝最终计分 15/15 人'),'A 14-card shopping list must explain its fifteenth, already-collected scoring player');
  await detail.getByText('本方案复用的已收集卡（1 人）',{exact:true}).click();
  assert.ok((await detail.locator('.gallery-plan-output').innerText()).includes('Player 1'));
  await page.screenshot({path:path.join(directory,'gallery-plan-slots-desktop.png')});await page.setViewportSize({width:390,height:900});
  await detail.locator('.gallery-plan-completeness').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(directory,'gallery-plan-slots-mobile.png')});
  await page.setViewportSize({width:1400,height:1000});
  await page.evaluate(()=>{globalThis.slotsPanel.close();globalThis.slotsCorrupt=true;globalThis.mountSlotsPanel('slots-incomplete').open();});
  const stale=page.locator('#slots-incomplete');await stale.locator('#tab-gallery').click();
  await stale.locator('#gallery-categories button').first().click();
  await stale.locator('[data-set-id="futgg:30"]').getByRole('button',{name:'查看卡片',exact:true}).click();
  const bad=stale.locator('#gallery-set-detail .gallery-plan-output');
  await bad.getByText('本方案计分人数未核验完整：14/15 人；请重新生成，暂不购买。',{exact:true}).waitFor();
  assert.equal(await bad.locator('.gallery-purchase').count(),0,'An incomplete retained plan must not offer purchases even with its original material binding');
  await bad.locator('.gallery-plan-completeness').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(directory,'gallery-plan-slots-incomplete.png')});
  assert.equal(await page.evaluate(()=>globalThis.slotsCalls.buys),0);assert.equal(requests,0);
  console.log('Gallery plan slots UI passed: 14 purchases + 1 existing = 15 scoring players, reused identities visible; offline, no writes.');
 }finally{await page.close();}
}
