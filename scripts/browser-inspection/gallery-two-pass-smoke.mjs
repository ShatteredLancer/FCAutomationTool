import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';

export async function exerciseGalleryTwoPass(context,directory){
  const bundle=await build({absWorkingDir:path.resolve(import.meta.dirname,'../..'),
    entryPoints:['src/adapters/browser/fc27-gallery-roadmap.js'],bundle:true,write:false,format:'iife',globalName:'TwoPass',target:'chrome120'});
  const page=await context.newPage();
  try{
    await page.route('**/*',route=>route.abort());
    await page.setContent('<!doctype html><style>body{background:#17252e;color:#ddd;font:14px Arial}dialog{background:#21343e;color:#ddd}button,input,select{padding:8px}</style><button id="open">Open</button>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      globalThis.twoPass={hold:true,scope:'fixture',sync:0,references:0,quotes:0,events:[],release:null};
      const state=globalThis.twoPass,realTimer=globalThis.setTimeout;
      globalThis.setTimeout=(callback,delay,...args)=>{
        if(delay===0 && state.hold && globalThis.document.querySelector('.gallery-roadmap-status')?.textContent.includes('删冗余优化')){
          state.release=()=>{state.release=null;realTimer(callback,0,...args);};return -1;
        }
        return realTimer(callback,delay,...args);
      };
      const realNow=performance.now.bind(performance);let offset=0;
      performance.now=()=>realNow()+(offset+=0.4);
      const grades=['D','C','B','A','S'].map((name,i)=>({name,threshold:150,
        rewards:[{type:'event_token_1',count:1,value:[0,0,5,13,28][i]}]}));
      const sets=[1,2].map(id=>({id:`futgg:${id}`,name:`Club ${id}`,slug:`club-${id}`,requiredCards:2,grades}));
      const catalog={source:'futgg',revision:'fixture',categories:[{id:'c',sets}],tags:[{id:1,name:'No-op',
        bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',rules:[{attribute:'RARE',type:'COUNT',target:'ATTRIBUTE',values:['999']}],tiers:[{minItems:1,bonus:0}]}]};
      const targets=sets.map((set,i)=>({set,catalog,status:'observed',progressKey:'stable',progress:{season:'27',setId:i+1,
        complete:true,poolComplete:true,rows:[1,2,3].map(n=>({eaId:(i+1)*10+n,playerEaId:(i+1)*10+n,gradingScore:100,
          collected:n===3,firstOwned:false,rarityEaId:1,overall:80}))}}));
      globalThis.TwoPass.mountGalleryRoadmap({document:globalThis.document,parent:globalThis.document.body,
        button:globalThis.document.querySelector('#open'),read:()=>({active:true,scope:state.scope,catalog,targets}),
        prepare:async()=>{state.sync++;},readTimeout:async()=>30000,onDiagnostic:row=>state.events.push(row),openSet:()=>{},
        loadPrices:async()=>{state.quotes++;throw Error('Fast overview must not query prices');},
        referenceService:{load:async()=>{state.references++;return {source:'fodder',basis:'empty-collection-public-reference',
          platform:'console',fetchedAt:Date.now(),expiresAt:Date.now()+300000,sets:sets.map((set,i)=>({set,
            grades:grades.map(grade=>({grade:grade.name,cost:3000,ids:[(i+1)*10+1,(i+1)*10+2],prices:[1000,2000]}))}))};}}});
    });
    await page.getByRole('button',{name:'Open',exact:true}).click();
    await page.getByRole('button',{name:'生成整体方案',exact:true}).click();
    await page.waitForFunction(()=>typeof globalThis.twoPass.release==='function');
    const live=await page.locator('.gallery-roadmap-dialog').innerText();
    assert.ok(live.includes('参考核验 2/2 · 待优化 2'), 'All locally verified references must be visible before the removal pass');
    assert.ok(live.includes('6,000'),'First pass keeps the conservatively verified purchase set');
    await page.getByRole('button',{name:'停止分析',exact:true}).click();
    await page.evaluate(()=>{globalThis.twoPass.hold=false;globalThis.twoPass.release();});
    await page.getByRole('button',{name:'继续分析剩余',exact:true}).waitFor();
    const pending=page.locator('details').filter({has:page.locator('summary', {hasText:'待完成合集'})}).last();
    await pending.locator('summary').click();
    assert.ok((await pending.innerText()).includes('等待'));
    await page.screenshot({path:path.join(directory,'gallery-two-pass-paused.png')});
    await page.setViewportSize({width:390,height:844});
    await pending.scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.gallery-roadmap-dialog').evaluate(node=>node.getBoundingClientRect().width<=390));
    await page.screenshot({path:path.join(directory,'gallery-two-pass-mobile.png')});
    await page.setViewportSize({width:1280,height:800});
    await page.getByRole('button',{name:'继续分析剩余',exact:true}).click();
    await page.getByText('整体路线已生成；进入具体合集后再确认操作。',{exact:true}).waitFor();
    const final=await page.locator('.gallery-roadmap-dialog').innerText();
    assert.ok(final.includes('参考核验 2/2 · 待优化 0'));
    assert.ok(final.includes('2,000'),'Second pass must retain the original scorer removal savings');
    const values=await page.evaluate(()=>globalThis.twoPass);
    assert.equal(values.sync,1);assert.equal(values.references,1);assert.equal(values.quotes,0);
    assert.ok(values.events.some(row=>row.event==='roadmap-plan' && row.microSteps>0 && row.validationMs>=0));
    await page.screenshot({path:path.join(directory,'gallery-two-pass-complete.png')});
    await page.evaluate(()=>{globalThis.twoPass.hold=true;});
    await page.getByRole('button',{name:'重新生成整体方案',exact:true}).click();
    await page.waitForFunction(()=>typeof globalThis.twoPass.release==='function');
    await page.evaluate(()=>{globalThis.twoPass.scope='different-account';globalThis.twoPass.hold=false;globalThis.twoPass.release();});
    await page.waitForFunction(()=>!globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
    assert.equal(await page.getByRole('button',{name:'进入俱乐部 / 合集',exact:true,includeHidden:true}).count(),0,
      'Account change at refinement resume must remove all old execution handoffs');
    console.log('Gallery two-pass Chrome passed: verified overview before refinement, Stop/Continue without re-sync, pending task timings, 6000->2000 original scorer savings, account isolation at refinement resume, desktop/390px; no EA access.');
  }finally{await page.close();}
}
