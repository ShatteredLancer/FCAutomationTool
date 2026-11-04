import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {normalizeGalleryCatalog} from '../../src/gallery/catalog.js';
import {futggGallery} from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryScoreHeroes(context,directory){
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const bundle=await build({absWorkingDir:path.resolve(import.meta.dirname,'../..'),entryPoints:['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle:true,write:false,format:'iife',globalName:'HeroesFixture',target:'chrome120'});
  const input=futggGallery(),base=input.data.categories[0].sets[0];base.requiredCards=1;
  base.grades.forEach((grade,index)=>{grade.threshold=(index+1)*100;});
  input.data.categories=[{...input.data.categories[0],sets:['Club A','League B','Heroes control'].map((name,index)=>({
    ...structuredClone(base),id:30+index,name,slug:`control-${index}`,requiredCards:index===2?5:1}))}];
  input.data.tags=[{id:1,name:'No bonus',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',rules:[{
    type:'COUNT',target:'ATTRIBUTE',attribute:'RARE',values:['999']}],tiers:[{minItems:1,bonus:0}]}];
  const catalog=normalizeGalleryCatalog('futgg',input);let requests=0;page.on('request',()=>{requests++;});
  try{
    await page.setViewportSize({width:1400,height:1000});await page.setContent('<!doctype html><title>Five-Hero score planning — offline control</title>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(catalog=>{
      const attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
      const sets=catalog.categories[0].sets,prices={1:150,2:150,11:1000,12:1000,13:200};
      const ids=id=>id===30?[11]:id===31?[12]:[1,2,11,12,13];
      const detail=setId=>({status:'observed',scope:'fixture',pool:{source:'futgg',revision:`pool-${setId}`},prices,
        priceSnapshot:{prices,freshPrices:prices,expiresAt:Date.now()+300000,policy:{source:'futbin'}},
        progress:{season:'27',setId,complete:true,poolComplete:true,totals:{total:ids(setId).length,collected:setId===32?2:0,missing:setId===32?3:1,unknown:0},rows:ids(setId).map(eaId=>({eaId,playerEaId:eaId,
          name:`Hero ${eaId}`,version:'Control',overall:80,gradingScore:10000,galleryScore:10000,collected:eaId<10,
          ...(globalThis.heroPending && setId===32 && [11,12].includes(eaId)?{held:true,inClub:true}:{}),
          firstOwned:false,holographic:false,positions:['ST'],clubEaId:1,leagueEaId:1,nationEaId:1,rarityEaId:1,weakFoot:3,skillMoves:3}))}});
      globalThis.heroBuys=0;globalThis.heroPending=false;
      globalThis.mountHeroesFixture=hostId=>globalThis.HeroesFixture.mountFc27AcceptancePanel({document:globalThis.document,hostId,targets:()=>[],galleryAccountScope:()=> 'fixture',
        galleryCatalog:{peek:async()=>null,load:async()=>({source:'futgg',status:'observed',catalog})},gallerySetLoader:async({setId})=>detail(Number(setId.split(':')[1])),
        gallerySync:{state:()=>({synced:true,busy:false}),subscribe:()=>()=>{},stop(){},peekDetails:async()=>[30,31,32].map(detail),sync:async()=>({status:'observed',details:[30,31,32].map(detail)})},
        galleryReference:{load:async()=>({source:'fodder',basis:'empty-collection-public-reference',platform:'console',fetchedAt:Date.now(),expiresAt:Date.now()+300000,
          sets:sets.map(set=>{const versions=ids(Number(set.id.split(':')[1]));return {key:set.slug,set,grades:set.grades.map(grade=>({grade:grade.name,
            cost:versions.reduce((sum,id)=>sum+prices[id],0),ids:versions,prices:versions.map(id=>prices[id])}))};})})},
        galleryPlanningPrices:async()=>({source:'public-references',policy:{source:'futbin'},prices,freshPrices:prices,expiresAt:Date.now()+300000}),
        purchaseGallery:async()=>{globalThis.heroBuys++;throw Error('No writes in control');}});
      globalThis.heroPanel=globalThis.mountHeroesFixture('hero-score-test');globalThis.heroPanel.open();
    },catalog);
    const panel=page.locator('#hero-score-test');await panel.locator('#tab-gallery').click();
    await panel.getByRole('button',{name:'整体方案',exact:true}).click();
    const dialog=panel.getByRole('dialog',{name:'全画廊整体方案'});await dialog.getByLabel('规划目标',{exact:true}).selectOption('score');
    await dialog.getByRole('button',{name:'生成整体方案',exact:true}).click();
    await dialog.getByText('整体路线已生成；进入具体合集后再确认操作。',{exact:true}).waitFor();
    const heroRow=dialog.locator('.gallery-roadmap-table tr').filter({hasText:'Heroes control'})
      .filter({has:page.getByRole('button',{name:'进入俱乐部 / 合集',exact:true})});
    const rowText=await heroRow.innerText();assert.ok(rowText.includes('1 张 / 2 张'));
    assert.ok(rowText.includes('已有 2＋需补 3 → 5/5'));assert.ok(rowText.includes('尚未确认收藏，不是当前已有卡'));
    await heroRow.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'gallery-score-heroes-dependencies.png')});
    await heroRow.getByRole('button',{name:'进入俱乐部 / 合集',exact:true}).click();
    const detail=panel.locator('#gallery-set-detail');await detail.getByRole('button',{name:'生成方案',exact:true}).click();
    await detail.getByText('已有可计分 2 人＋本方案采购 3 人＝最终计分 5/5 人',{exact:true}).waitFor();
    await page.screenshot({path:path.join(directory,'gallery-score-heroes-complete.png')});
    await page.evaluate(()=>{
      globalThis.heroPanel.close();globalThis.heroPending=true;
      globalThis.heroPanel=globalThis.mountHeroesFixture('hero-score-pending');globalThis.heroPanel.open();
    });
    const pending=page.locator('#hero-score-pending');await pending.locator('#tab-gallery').click();
    await pending.getByRole('button',{name:'整体方案',exact:true}).click();
    const pendingDialog=pending.getByRole('dialog',{name:'全画廊整体方案'});
    await pendingDialog.getByLabel('规划目标',{exact:true}).selectOption('score');
    await pendingDialog.getByRole('button',{name:'生成整体方案',exact:true}).click();
    await pendingDialog.getByText('存在仅持有但尚未确认画廊收集的卡，不当作已满员；请同步收藏状态，不要重复购买这些卡',{exact:false}).first().waitFor({state:'attached'});
    assert.equal(await pendingDialog.locator('.gallery-roadmap-table tr').filter({hasText:'Heroes control'})
      .filter({has:page.getByRole('button',{name:'进入俱乐部 / 合集',exact:true})}).count(),0);
    const reason=pendingDialog.getByText('Heroes control · 存在仅持有但尚未确认画廊收集的卡，不当作已满员；请同步收藏状态，不要重复购买这些卡',{exact:false});
    await reason.locator('xpath=ancestor::details[1]').locator(':scope > summary').click();
    await reason.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'gallery-score-heroes-pending.png')});
    assert.equal(await page.evaluate(()=>globalThis.heroBuys),0);assert.equal(requests,0);
    console.log('Gallery score Heroes control passed: 2 existing + 3 missing, 1 unique/2 pending shared, full 3-card club handoff, held-unconfirmed blocked without repurchase; no writes.');
  }catch(error){console.log(await page.locator('#hero-score-pending').count()?await page.locator('#hero-score-pending').getByRole('dialog').innerText():await page.locator('#hero-score-test #gallery-set-detail').innerText());throw error;}
  finally{await page.close();}
}
