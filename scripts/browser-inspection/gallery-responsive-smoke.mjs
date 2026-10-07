import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

// Exercise the reported entry: Settings -> Gallery with many cached account
// projections. No EA/HTTP reads or purchases; this measures main-thread stalls.
export async function exerciseGalleryResponsive(context) {
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'], bundle: true, write: false,
    format: 'iife', globalName: 'GalleryResponsive', target: 'chrome120' });
  const raw = futggGallery(), base = raw.data.categories[0].sets[0];
  raw.data.categories[0].sets = Array.from({length:127}, (_,i) => ({...base,
    id:1000+i, slug:`set-${i}`, name:`Set ${i}`, requiredCards:11}));
  raw.data.categories.push({id:2, slug:'pending', name:'Pending data', sets:[
    {...base, id:2000, categoryId:2, slug:'missing', name:'Missing pool'},
    {...base, id:2001, categoryId:2, slug:'unknown', name:'Unknown score'}]});
  raw.data.categories.push({id:3, slug:'intervals', name:'Intervals', sets:[
    {...base, id:3000, categoryId:3, slug:'interval', name:'Interval score', requiredCards:1}]});
  raw.data.tags = [{id:1,name:'Rare',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',
    rules:[{attribute:'RARE',type:'COUNT',target:'ATTRIBUTE',values:['1']}],tiers:[{minItems:5,bonus:50}]}];
  const catalog = normalizeGalleryCatalog('futgg',raw), page = await context.newPage();
  try {
    await page.setContent('<!doctype html><title>Gallery responsiveness</title>');
    await page.evaluate(() => {
      const attach=globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
    });
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(catalog => {
      const details=catalog.categories[0].sets.map(set=>({status:'observed',scope:'fixture',
        pool:{source:'futgg',setId:Number(set.id.slice(6)),revision:'pool'},
        progress:{season:'27',source:'futgg',setId:Number(set.id.slice(6)),complete:true,
          totals:{total:100,collected:80,missing:20,unknown:0},
          rows:Array.from({length:100},(_,i)=>({eaId:i+1,playerEaId:i+1,name:`Player ${i}`,overall:80,
            gradingScore:100+i,collected:i<80,status:i<80?'collected':'missing',rarityEaId:i%2,firstOwned:true}))}}));
      const value={status:'observed',source:'futgg',catalog};
      details.unshift({status:'observed',scope:'fixture',pool:{source:'futgg',setId:3000,revision:'pool'},
        progress:{season:'27',source:'futgg',setId:3000,complete:false,
          rows:[{eaId:3000,playerEaId:3000,overall:80,collected:true,gradingScore:100,rarityEaId:1,firstOwned:true}],
          totals:{total:1,collected:1,missing:0,unknown:0}}});
      details.unshift({status:'observed',scope:'fixture',pool:{source:'futgg',setId:2001,revision:'pool'},
        progress:{season:'27',source:'futgg',setId:2001,complete:true,
          rows:[{eaId:2001,playerEaId:2001,overall:80,collected:true,gradingScore:null}],
          totals:{total:1,collected:1,missing:0,unknown:0}}});
      globalThis.responsivePanel=globalThis.GalleryResponsive.mountFc27AcceptancePanel({document:globalThis.document,hostId:'responsive',targets:()=>[],
        galleryAccountScope:()=> 'fixture',galleryCatalog:{peek:async()=>value,load:async()=>value},
        gallerySetLoader:async({setId})=>details.find(row=>`futgg:${row.pool.setId}`===setId),
        gallerySync:{state:()=>({synced:true,syncedAt:Date.now()}),peekDetails:async()=>structuredClone(details),subscribe:()=>()=>{},stop:()=>{}},
        galleryPurchase:async()=>{throw Error('must not buy');}});
      globalThis.responsivePanel.open();
      globalThis.maxGalleryGap=0; let last=performance.now();
      globalThis.galleryHeartbeat=setInterval(()=>{const now=performance.now();globalThis.maxGalleryGap=Math.max(globalThis.maxGalleryGap,now-last);last=now;},20);
    },catalog);
    const host=page.locator('#responsive');
    await host.locator('#tab-settings').click();
    await host.locator('#tab-gallery').click();
    assert.equal(await host.locator('.gallery-set').count(),0,'entry must not rebuild cached set cards');
    await page.waitForFunction(()=>Number(globalThis.document.getElementById('responsive').shadowRoot
      .querySelector('.gallery-category-score progress')?.value)>0);
    assert.match(await host.locator('.gallery-category-score').first().innerText(), /已计分 \d+\/127/,
      'category home must show background scoring without opening a category');
    await page.waitForFunction(()=>JSON.parse(globalThis.document.getElementById('responsive').shadowRoot
      .querySelectorAll('.gallery-category-score')[1]?.dataset.scoreCounts ?? '{}').unavailable === 1);
    assert.equal(await host.locator('.gallery-category-score').nth(1).innerText(), '已计分 0/2');
    await page.waitForFunction(()=>globalThis.document.getElementById('responsive').shadowRoot
      .querySelectorAll('.gallery-category-score')[2]?.textContent.includes('已计分 1/1'));
    assert.equal(await host.locator('.gallery-category-score').nth(2).innerText(), '已计分 1/1',
      'a finished partial score counts as completed without annotations on the category home');
    await page.screenshot({path:'artifacts/fc27-browser/gallery-category-scoring.png'});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await host.locator('.gallery-category-score').first().evaluate(node=>node.getBoundingClientRect().right<=390));
    await page.screenshot({path:'artifacts/fc27-browser/gallery-category-scoring-narrow.png'});
    await page.setViewportSize({width:1280,height:800});
    await host.locator('#gallery-categories button').first().click();
    await page.waitForFunction(()=>globalThis.document.getElementById('responsive').shadowRoot.querySelectorAll('.gallery-summary').length===127);
    await page.waitForFunction(()=>[...globalThis.document.getElementById('responsive').shadowRoot.querySelectorAll('.gallery-summary')]
      .some(row=>/^[\d,]+ 分$/.test(row.textContent)));
    assert.equal(await host.locator('.gallery-set').count(),127);
    await host.locator('#gallery-back').click();
    await page.waitForFunction(()=>globalThis.document.getElementById('responsive').shadowRoot
      .querySelector('.gallery-category-score span')?.textContent.includes('已计分 127/127'));
    assert.match(await host.locator('.gallery-category-score').first().innerText(), /已计分 127\/127/,
      'returning from a category must refresh its aggregate score count');
    await host.locator('#gallery-categories button').first().click();
    // Switching away must interrupt pending work; returning reuses completed
    // entries even though peekDetails creates new projection object identities.
    const completed=await host.locator('.gallery-set').evaluateAll(cards=>cards.filter(card=>/^[\d,]+ 分$/.test(card.querySelector('.gallery-summary')?.textContent)).map(card=>card.dataset.setId));
    const switchAt=Date.now(); await host.locator('#tab-settings').click();
    assert.ok(Date.now()-switchAt<1500,'Settings remains clickable during background scoring');
    await host.locator('#tab-gallery').click();
    assert.equal(await host.locator('.gallery-set').count(),0,'return must only show categories');
    await host.locator('#gallery-categories button').first().click();
    const reused=await host.locator('.gallery-set').evaluateAll((cards,ids)=>cards.filter(card=>ids.includes(card.dataset.setId)).every(card=>!card.querySelector('.gallery-summary')?.textContent.includes('计分中')),completed);
    assert.ok(reused,'unchanged completed scores survive tab return and new projections');
    const maxGap=await page.evaluate(()=>{globalThis.clearInterval(globalThis.galleryHeartbeat);return globalThis.maxGalleryGap;});
    assert.ok(maxGap<750,`Gallery main-thread heartbeat stalled ${Math.round(maxGap)}ms`);
    await host.locator('#tab-settings').click();
    console.log(`Offline Gallery responsiveness passed: 127 cached sets, 100 versions/set, Settings roundtrip, score reuse; max heartbeat gap ${Math.round(maxGap)}ms.`);
  } finally {await page.close();}
}
