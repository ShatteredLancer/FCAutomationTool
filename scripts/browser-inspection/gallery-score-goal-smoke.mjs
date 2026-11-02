import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryScoreGoal(context, directory) {
  const page=await context.newPage(), root=path.resolve(import.meta.dirname,'../..');
  page.setDefaultTimeout(15000);
  const bundle=await build({absWorkingDir:root,entryPoints:['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle:true,write:false,format:'iife',globalName:'ScoreFixture',target:'chrome120'});
  const input=futggGallery(), base=input.data.categories[0].sets[0];
  base.requiredCards=1;
  base.grades.forEach((grade,index)=>{grade.threshold=(index+1)*10;});
  input.data.categories=['Club','League','Nation'].map((name,index)=>({id:index+1,name,slug:name.toLowerCase(),
    sets:[{...structuredClone(base),id:30+index,categoryId:index+1,name:`${name} Alpha`,slug:`${name.toLowerCase()}-alpha`}]}));
  input.data.tags=[{id:1,name:'No-op bonus',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',
    rules:[{type:'COUNT',target:'ATTRIBUTE',attribute:'RARE',values:['999']}],tiers:[{minItems:1,bonus:1}]}];
  const catalog=normalizeGalleryCatalog('futgg',input);
  let requests=0;page.on('request',()=>{requests++;});
  try {
    await page.setViewportSize({width:1400,height:1000});
    await page.setContent('<!doctype html><title>Gallery score goal — offline fixture</title>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(catalog=>{
      const attach=globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
      globalThis.scoreCalls={sync:0,buys:0,quotes:0};globalThis.scoreScope='fixture-a';globalThis.scoreAcquired=false;
      const prices={2:200};
      const row=(eaId,score,collected)=>({eaId,playerEaId:eaId,name:`Player ${eaId}`,version:'Gallery',overall:80,
        gradingScore:score,galleryScore:score,collected,inClub:false,held:null,firstOwned:false,holographic:false,
        positions:['ST'],skillMoves:3,weakFoot:3,nationEaId:1,clubEaId:1,leagueEaId:1,rarityEaId:1});
      const detail=setId=>({status:'observed',scope:globalThis.scoreScope,fetchedAt:Date.now(),prices,
        pool:{source:'futgg',setId,revision:`pool-${setId}`},
        priceSnapshot:{prices,freshPrices:prices,expiresAt:Date.now()+300000,policy:{source:'futbin'}},
        progress:{source:'ea-gallery-progress',season:'27',setId,complete:true,poolComplete:true,
          rows:[row(1,60,true),row(2,80,globalThis.scoreAcquired)],totals:{total:2,collected:globalThis.scoreAcquired?2:1,missing:globalThis.scoreAcquired?0:1,unknown:0}}});
      const sets=catalog.categories.flatMap(category=>category.sets);
      globalThis.scorePanel=globalThis.ScoreFixture.mountFc27AcceptancePanel({document:globalThis.document,targets:()=>[],hostId:'score-test',
        galleryAccountScope:()=>globalThis.scoreScope,
        galleryPlanningSettings:{scope:()=>globalThis.scoreScope,read:async()=>({timeoutMs:30000})},
        galleryCatalog:{peek:async()=>null,load:async()=>({source:'futgg',status:'observed',catalog})},
        galleryReference:{load:async()=>({source:'fodder',basis:'empty-collection-public-reference',platform:'console',
          fetchedAt:Date.now(),expiresAt:Date.now()+300000,sets:sets.map(set=>({key:set.slug,set,
            grades:set.grades.map(grade=>({grade:grade.name,cost:200,ids:[2],prices:[200]}))}))})},
        gallerySync:{state:()=>({synced:true,syncedAt:Date.now(),busy:false}),subscribe:()=>()=>{},stop(){},
          sync:async()=>{globalThis.scoreCalls.sync++;return {status:'observed',details:[30,31,32].map(detail)};},
          peekDetails:async()=>[30,31,32].map(detail)},
        gallerySetLoader:async({setId})=>detail(Number(setId.split(':')[1])),
        galleryPlanningPrices:async()=>{globalThis.scoreCalls.quotes++;return {source:'public-references',policy:{source:'futbin'},
          prices,freshPrices:prices,references:{2:{futbin:200,futgg:200,maxBuy:200}},expiresAt:Date.now()+300000};},
        purchaseGallery:async()=>{globalThis.scoreCalls.buys++;throw Error('No writes in fixture');}});
      globalThis.scorePanel.open();
    },catalog);
    const shadow=page.locator('#score-test');await shadow.locator('#tab-gallery').click();
    await shadow.getByRole('button',{name:'整体方案',exact:true}).click();
    const dialog=shadow.getByRole('dialog',{name:'全画廊整体方案'});
    await dialog.getByRole('button',{name:'生成整体方案',exact:true}).click();
    await dialog.getByText('整体路线已生成；进入具体合集后再确认操作。',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'进入俱乐部 / 合集',exact:true}).count(),0,'S-complete token plans need no purchases');
    await dialog.getByLabel('规划目标',{exact:true}).selectOption('score');
    await dialog.getByRole('button',{name:'生成整体方案',exact:true}).click();
    await dialog.getByText('整体路线已生成；进入具体合集后再确认操作。',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'进入俱乐部 / 合集',exact:true}).count(),3);
    assert.equal(await dialog.locator('[data-profile]').count(),3);
    assert.ok((await dialog.innerText()).includes('新增完整合集计算分（非 XP）'));
    const downloadPromise=page.waitForEvent('download');
    await dialog.getByRole('button',{name:'导出分析快照',exact:true}).click();
    const download=await downloadPromise,file=path.join(directory,'gallery-score-analysis-fixture.json');await download.saveAs(file);
    const exported=JSON.parse(await readFile(file,'utf8'));
    assert.equal(exported.roadmap.planningObjective,'score');assert.equal(exported.roadmap.addedScore,60);
    assert.equal(exported.roadmap.addedTokens,0);assert.equal(exported.roadmap.funding.totalPurchase,200);
    assert.ok(!JSON.stringify(exported).includes('fixture-a'));
    await page.screenshot({path:path.join(directory,'gallery-score-desktop.png')});
    await page.setViewportSize({width:390,height:900});await page.screenshot({path:path.join(directory,'gallery-score-mobile.png')});
    assert.ok((await dialog.boundingBox()).width<=390);
    await page.setViewportSize({width:1400,height:1000});
    const reads=await page.evaluate(()=>globalThis.scoreCalls.sync);
    await dialog.getByLabel('规划目标',{exact:true}).selectOption('tokens');
    assert.ok((await dialog.innerText()).includes('目录新增 token'));
    assert.equal(await dialog.getByRole('button',{name:'进入俱乐部 / 合集',exact:true}).count(),0);
    await dialog.getByLabel('规划目标',{exact:true}).selectOption('score');
    assert.equal(await dialog.getByRole('button',{name:'进入俱乐部 / 合集',exact:true}).count(),3);
    assert.equal(await page.evaluate(()=>globalThis.scoreCalls.sync),reads,'Mode switches reuse valid per-goal results');
    await dialog.getByRole('button',{name:'进入俱乐部 / 合集',exact:true}).first().click();
    const detail=shadow.locator('#gallery-set-detail'),select=detail.locator('.gallery-plan select');
    await select.waitFor();assert.equal(await select.inputValue(),'points:80');
    assert.equal(await detail.getByRole('button',{name:'加入联合目标',exact:true}).isEnabled(),false);
    await detail.getByRole('button',{name:'生成方案',exact:true}).click();
    await detail.locator('.gallery-plan-output').getByText(/找到 .* 个候选方案/).waitFor();
    await page.screenshot({path:path.join(directory,'gallery-score-numeric-handoff.png')});
    await shadow.getByRole('button',{name:'整体方案',exact:true}).click();
    assert.ok((await dialog.locator('.gallery-roadmap-execution').innerText()).includes('待核对/继续完成'),
      'Already S does not imply the numerical score target was reached');
    await dialog.locator('input[type=checkbox]').check();
    await dialog.getByRole('button',{name:'继续深度优化',exact:true}).click();
    await dialog.getByText('按需深度分析已完成本轮有界范围；未查范围及参考全貌保留，进入俱乐部前重新核价。',{exact:true}).waitFor();
    assert.ok((await dialog.innerText()).includes('新增完整合集计算分（非 XP）'));
    const deepDownloadPromise=page.waitForEvent('download');
    await dialog.getByRole('button',{name:'导出分析快照',exact:true}).click();
    const deepDownload=await deepDownloadPromise,deepFile=path.join(directory,'gallery-score-deep-analysis-fixture.json');
    await deepDownload.saveAs(deepFile);const deepExport=JSON.parse(await readFile(deepFile,'utf8'));
    assert.equal(deepExport.roadmap.planningObjective,'score');assert.equal(deepExport.roadmap.addedScore,60);
    assert.equal(deepExport.roadmap.demandDriven,true);assert.equal(deepExport.roadmap.funding.totalPurchase,200);
    assert.ok((await page.evaluate(()=>globalThis.scoreCalls.quotes))>0);
    assert.equal(await page.evaluate(()=>globalThis.scoreCalls.buys),0);
    assert.equal(requests,0,'No network or live EA traffic');
    console.log('Gallery score-goal fixture passed: shared purchases, 3 profiles, numeric handoff, mode retention; no EA writes.');
  } catch(error) {console.log((await page.locator('#score-test').getByRole('dialog',{name:'全画廊整体方案',includeHidden:true}).textContent()).slice(-5000));
    await page.screenshot({path:path.join(directory,'gallery-score-error.png')});throw error;
  } finally {await page.close();}
}
