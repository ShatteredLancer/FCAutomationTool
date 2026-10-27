import {build} from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';

export async function exerciseGalleryRoadmapRetention(context,directory,entryFile='src/adapters/browser/fc27-gallery-roadmap.js'){
  const bundle=await build({absWorkingDir:path.resolve(import.meta.dirname,'../..'),entryPoints:[entryFile],bundle:true,write:false,format:'iife',globalName:'RetainFixture',target:'chrome120'});
  const page=await context.newPage();
  try{
    await page.route('**/*',route=>route.abort());
    await page.setContent('<!doctype html><button id="open">Open</button>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const grades=['D','C','B','A','S'].map((name,i)=>({name,threshold:(i+1)*10,rewards:[{type:'event_token_1',count:1,value:[0,0,5,8,15][i]}]}));
      const sets=[{id:'futgg:1',name:'Club Alpha',slug:'alpha',requiredCards:1,grades},{id:'futgg:2',name:'Club Beta',slug:'beta',requiredCards:1,grades},
        {id:'futgg:3',name:'Shared League',slug:'league',requiredCards:2,grades:grades.map(grade=>({...grade,threshold:grade.threshold*2}))}];
      const catalog={source:'futgg',revision:'fixture',categories:[{id:'c',sets}],tags:[{id:1,name:'No-op',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',rules:[{attribute:'RARE',type:'COUNT',target:'ATTRIBUTE',values:['999']}],tiers:[{minItems:1,bonus:1}]}]};
      const targets=sets.map((set,i)=>({set,catalog,status:'observed',progressKey:'initial',pool:{revision:`pool-${i}`},
        progress:{season:'27',setId:i+1,complete:true,poolComplete:true,rows:(i===2?[1,2]:[i+1]).map(eaId=>({eaId,playerEaId:eaId,gradingScore:100,collected:false,firstOwned:false,rarityEaId:1}))}}));
      globalThis.retainCalls={prepare:0,reference:0,quote:0};globalThis.retainEvents=[];globalThis.enableRetainQuotes=false;
      globalThis.updateRetainCollection=()=>{targets[0].progress={...targets[0].progress,rows:targets[0].progress.rows.map(row=>({...row,collected:true,inClub:false}))};targets[0].progressKey='acquired-and-sold';};
      globalThis.RetainFixture.mountGalleryRoadmap({document:globalThis.document,parent:globalThis.document.body,button:globalThis.document.querySelector('#open'),
        read:()=>({active:true,scope:'fixture-account',catalog,targets}),prepare:async()=>{globalThis.retainCalls.prepare++;},readTimeout:async()=>30000,
        onDiagnostic:row=>globalThis.retainEvents.push(row),openSet:(...args)=>{globalThis.retainHandoff=args;},
        loadPrices:async ids=>{globalThis.retainCalls.quote++;if(!globalThis.enableRetainQuotes)throw Error('Unexpected quote in reference mode');
          return{source:'public-references',policy:{source:'futbin'},prices:Object.fromEntries(ids.map(id=>[id,500])),freshPrices:Object.fromEntries(ids.map(id=>[id,500])),references:{},expiresAt:Date.now()+300000};},
        referenceService:{load:async()=>{globalThis.retainCalls.reference++;return{source:'fodder',basis:'empty-collection-public-reference',platform:'console',fetchedAt:Date.now(),expiresAt:Date.now()+300000,
          sets:sets.map((set,i)=>({set,grades:set.grades.map(grade=>({grade:grade.name,cost:i===2?2000:1000,ids:i===2?[1,2]:[i+1],prices:i===2?[1000,1000]:[1000]}))}))};}}});
    });
    await page.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('button',{name:'生成整体方案',exact:true}).click();
    await page.getByText('整体路线已生成；进入具体合集后再确认操作。',{exact:true}).waitFor();
    assert.ok((await page.locator('.gallery-roadmap-dialog').innerText()).includes('84'));
    await page.getByRole('button',{name:'进入俱乐部 / 合集',exact:true}).first().click();
    assert.deepEqual(await page.evaluate(()=>globalThis.retainHandoff),['futgg:1','S']);
    await page.evaluate(()=>globalThis.updateRetainCollection());
    await page.getByRole('button',{name:'Open',exact:true}).click();
    await page.waitForFunction(()=>!globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
    const text=await page.locator('.gallery-roadmap-dialog').innerText();
    assert.ok(text.includes('Club Beta'),'Returning after acquisition must preserve unrelated routes');
    assert.ok(text.includes('Shared League'),'A shared version must update related collections without a full rerun');
    assert.ok(text.includes('本地计分已达目标'),'Visited task is retained and marked using the new collection evidence');
    assert.deepEqual(await page.evaluate(()=>globalThis.retainCalls),{prepare:1,reference:1,quote:0},'No all-catalog sync/reference/price read on return');
    assert.ok(await page.locator('[data-profile=tokens]').count());
    await page.locator('[data-profile=loss]').first().click();await page.locator('[data-profile=capital]').first().click();
    assert.deepEqual(await page.evaluate(()=>globalThis.retainCalls),{prepare:1,reference:1,quote:0},'Choosing a global route is local only');
    await page.screenshot({path:path.join(directory,'gallery-retained-return.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.gallery-roadmap-portfolios').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('[data-profile=capital]').first().evaluate(node=>{
      const bounds=node.getBoundingClientRect();return bounds.left>=0 && bounds.right<=globalThis.innerWidth;
    }),'Global portfolio choice remains inside the narrow viewport');
    await page.screenshot({path:path.join(directory,'gallery-retained-portfolios-mobile.png')});
    await page.setViewportSize({width:1280,height:800});
    await page.evaluate(()=>{globalThis.enableRetainQuotes=true;});
    await page.locator('input[type=checkbox]').check();
    await page.getByRole('button',{name:'继续深度优化',exact:true}).click();
    await page.waitForFunction(()=>!globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
    const deep=await page.evaluate(()=>globalThis.retainCalls);
    assert.equal(deep.prepare,1);assert.equal(deep.reference,1);assert.ok(deep.quote>0,'Mode switch only quotes needed deep candidates');
    await page.locator('input[type=checkbox]').uncheck();
    await page.getByRole('button',{name:'继续分析剩余',exact:true}).click();
    await page.waitForFunction(()=>!globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
    assert.deepEqual(await page.evaluate(()=>globalThis.retainCalls),deep,'Reference/deep mode switches reuse the same catalogue calculation');
    console.log('Gallery retained-return Chrome passed: global alternatives, S target-only handoff, acquired then sold, shared collection update, no repeat global sync/quotes; synthetic only.');
  }finally{await page.close();}
}
