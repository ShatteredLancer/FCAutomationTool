import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { mergeGalleryAccountProgress } from '../../src/gallery/progress.js';
import { futggGallery, fodderGallery, futggGalleryPool, futggTruncatedGalleryPool } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryCatalog(context, directory) {
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'GallerySmoke', target: 'chrome120' });
  const nativeBundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/ea/fc27-gallery-card.js'],
    bundle: true, write: false, format: 'iife', globalName: 'GalleryNativeSmoke', target: 'chrome120' });
  const entityBundle = await build({ absWorkingDir: root, entryPoints: ['tests/helpers/fc27-gallery-entity.js'],
    bundle: true, write: false, format: 'iife', globalName: 'GalleryEntitySmoke', target: 'chrome120' });
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.setContent('<!doctype html><title>Gallery offline fixture</title>');
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      globalThis.galleryTimers = new Map();
      const setIntervalOriginal = globalThis.setInterval;
      const clearIntervalOriginal = globalThis.clearInterval;
      globalThis.setInterval = (callback, delay) => {
        const id = setIntervalOriginal(callback, delay);
        globalThis.galleryTimers.set(id, callback);
        return id;
      };
      globalThis.clearInterval = id => { globalThis.galleryTimers.delete(id); clearIntervalOriginal(id); };
      Object.defineProperty(globalThis, 'services', { get() { throw Error('EA_SERVICES_NOT_ALLOWED'); } });
      Object.defineProperty(globalThis, 'repositories', { get() { throw Error('EA_REPOS_NOT_ALLOWED'); } });
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.addScriptTag({ content: nativeBundle.outputFiles[0].text });
    await page.addScriptTag({ content: entityBundle.outputFiles[0].text });
    await page.addStyleTag({ content: '.fixture-ea-card{width:144px;height:200px;background:rgb(10, 20, 30)}' });
    const catalog = normalizeGalleryCatalog('futgg', futggGallery());
    const fallback = normalizeGalleryCatalog('fodder', fodderGallery());
    await page.evaluate(({ catalog, fallback }) => {
      globalThis.galleryCalls = { peek: 0, load: 0, refresh: 0 };
      const state = { status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now(), changes: { added: [] } };
      globalThis.galleryPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({ document: globalThis.document, targets: () => [],
        prepare: async () => ({ status: 'blocked' }), execute: async () => ({ status: 'blocked' }),
        inspectRecovery: async () => ({ status: 'blocked' }), resolveRecovery: async () => ({ status: 'blocked' }),
        checkInstallation: async () => ({ status: 'blocked' }),
        galleryCatalog: {
          peek: async () => { globalThis.galleryCalls.peek++; return null; },
          load: async () => { globalThis.galleryCalls.load++; return state; },
          refresh: async () => { globalThis.galleryCalls.refresh++; return { ...state, source: 'fodder', catalog: fallback,
            stale: true, reason: 'FC27_GALLERY_CATALOG_REFRESH_FAILED', sourceErrors: { futgg: 'HTTP 403' },
            fetchedAt: Date.now() - 3600000 }; },
        },
      });
      globalThis.galleryPanel.open();
    }, { catalog, fallback });
    const host = page.locator('#fcat-fc27-acceptance');
    assert.equal(await page.evaluate(() => globalThis.galleryCalls.load), 0);
    await host.locator('#tab-gallery').click();
    await host.locator('#gallery-categories button').first().waitFor();
    assert.equal(await host.locator('#gallery-set-list .gallery-set').count(), 0);
    assert.equal(await host.locator('#gallery-categories button').count(), 1);
    assert.doesNotMatch(await host.locator('#gallery-categories').innerText(), /全部/);
    assert.equal(await host.locator('.gallery-reward-token').count(), 0, 'Enhancer hides rewards without an EA event-token icon');
    await host.locator('#gallery-categories button').first().click();
    await host.locator('[data-set-id="futgg:30"]').waitFor();
    assert.equal(await page.evaluate(() => globalThis.galleryTimers.size), 1);
    assert.match(await host.locator('#gallery-set-list').innerText(), /\? \/ 20/);
    assert.match(await host.locator('[data-set-id="futgg:30"] .gallery-grade-diamond').first().getAttribute('title'), /Club Badge/);
    assert.ok(await host.locator('[data-set-id="futgg:30"] .gallery-summary').count() === 1);
    assert.equal(await host.locator('[data-set-id="futgg:30"] .gallery-reward-token').count(), 0);
    assert.match(await host.locator('[data-set-id="futgg:30"] .gallery-score-caption').innerText(), /Base score/);
    await host.locator('#gallery-refresh').click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-fc27-acceptance').shadowRoot.getElementById('gallery-refresh').disabled);
    await host.locator('#gallery-categories button').first().click();
    await host.locator('[data-set-id="fodder:league/example-club"]').waitFor();
    assert.match(await host.locator('#gallery-status').textContent(), /更新未成功，保留旧目录/);
    assert.match(await host.locator('#gallery-source-error').innerText(), /FUT\.GG 未连接（HTTP 403）/);
    assert.match(await host.locator('[data-set-id="fodder:league\/example-club"] .gallery-grade-diamond').first().getAttribute('title'), /未提供非代币奖励/);
    assert.equal(await host.locator('img').count(), 0);
    assert.deepEqual(await page.evaluate(() => globalThis.galleryCalls), { peek: 2, load: 1, refresh: 1 });
    await host.evaluate(element => {
      const display = element.style.display;
      element.style.display = 'none';
      for (const tick of globalThis.galleryTimers.values()) tick();
      element.style.display = display;
    });
    assert.deepEqual(await page.evaluate(() => globalThis.galleryCalls), { peek: 2, load: 1, refresh: 1 });
    await host.locator('#tab-sbc').click();
    assert.equal(await page.evaluate(() => globalThis.galleryTimers.size), 0);
    await host.locator('#tab-gallery').click();
    await page.waitForFunction(() => globalThis.document.getElementById('fcat-fc27-acceptance').shadowRoot.getElementById('gallery-source').textContent === 'FUT.GG');
    await host.locator('#gallery-categories button').first().click();
    await host.locator('[data-set-id="futgg:30"]').waitFor();
    assert.equal(await page.evaluate(() => globalThis.galleryTimers.size), 1);
    assert.deepEqual(requests, []);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await host.evaluate(element => element.scrollWidth > element.clientWidth + 1);
      assert.equal(overflow, false, `Gallery width ${width} overflow`);
      await page.screenshot({ path: path.join(directory, `gallery-catalog-${width}.png`) });
    }
    console.log('Offline Gallery catalogue smoke passed: navigation, source, fallback, unknown progress, no EA/HTTP calls.');

    await page.evaluate(() => globalThis.galleryPanel.close());
    const progress = mergeGalleryAccountProgress(normalizeGalleryPool('futgg', futggGalleryPool(), 30), {
      conceptItems: [{definitionId:900001,isCollected:true,gradingScore:100},{definitionId:900002,isCollected:false}],
      // Keep the second version genuinely missing for the selection smoke;
      // an EA Club-held version is intentionally excluded from purchase.
      clubItems:[],
    });
    await page.evaluate(({catalog,progress}) => {
      globalThis.gallerySetCalls=0;globalThis.galleryScope='fixture-a';globalThis.galleryHold=false;
      globalThis.galleryNativeEnabled=false;globalThis.galleryNativeCreated=0;globalThis.galleryNativeDisposed=0;
      const renderer=globalThis.GalleryNativeSmoke.createFc27GalleryNativeRenderer({
        UTItemEntity:globalThis.GalleryEntitySmoke.GalleryItemEntity,
        factories:{Item:{createItem:globalThis.GalleryEntitySmoke.galleryEntityFromDto}},
        UTItemViewFactory:{createLargeItem:()=>{
          globalThis.galleryNativeCreated++;const element=globalThis.document.createElement('div');element.className='fixture-ea-card';
          return {init(){},getRootElement:()=>element,assetsLoaded:new Map([['shell',true],['main',true]]),
            render(item){if(item.definitionId===900003)this.assetsLoaded.set('main',false);this.renderComplete();},
            renderComplete(){},dealloc(){globalThis.galleryNativeDisposed++;}};
        }},
      },{document:globalThis.document});
      globalThis.galleryProgressPanel=globalThis.GallerySmoke.mountFc27AcceptancePanel({document:globalThis.document,hostId:'gallery-progress-test',targets:()=>[],
        purchaseGallery:async()=>{throw Error('PURCHASE_NOT_ALLOWED_IN_DISPLAY_TEST');},
        galleryNativeRenderer:{render:options=>globalThis.galleryNativeEnabled?renderer.render(options):null},
        galleryAssets:{reward:type=>type==='event_token_1'?'https://www.ea.com/assets/token/1.png':null,club:id=>`https://www.ea.com/assets/club/${id}.png`,league:id=>`https://www.ea.com/assets/league/${id}.png`,nation:id=>`https://www.ea.com/assets/nation/${id}.png`,portrait:id=>`https://www.ea.com/assets/portrait/${id}.png`,category:()=>['https://www.ea.com/assets/league/13.png'],set:()=>['https://www.ea.com/assets/club/1.png','https://www.ea.com/assets/club/1.png','https://www.ea.com/assets/club/2.png']},
        galleryCatalog:{peek:async()=>null,load:async()=>({status:'observed',source:'futgg',catalog,fetchedAt:Date.now()}),refresh:async()=>({status:'blocked'})},
        galleryAccountScope:()=>globalThis.galleryScope,
        gallerySetLoader:async()=>{
          globalThis.gallerySetCalls++;
          const scope=globalThis.galleryScope;
          if(globalThis.galleryHold)await new Promise(resolve=>{globalThis.releaseGallery=resolve;});
          return {status:'observed',scope,progress,prices:{900001:8300,900002:12500,900003:4200},fetchedAt:Date.now(),runtimeCards:new Map(progress.rows.map(row=>{
            const dto={resourceId:row.eaId,itemType:'player',dream:true,guidAssetId:`exact-${row.eaId}`,
              rating:89,rareflag:22,attributeArray:[88,86,90,80,45,78],hyperCosmetics:{1:3}};
            return [row.eaId,row.eaId===900001?globalThis.GalleryEntitySmoke.galleryEntityFromDto(dto):dto];
          }))};
        },
      });globalThis.galleryProgressPanel.open();
    },{catalog:{...catalog,tags:[{id:1,name:'First Owner',bonusType:'ITEM_SCORE_PERCENTAGE',thresholdType:'ITEM_COUNT',
      rules:[{type:'COUNT',target:'ATTRIBUTE',attribute:'FIRST_OWNED',values:['1']}],tiers:[{minItems:20,bonus:5}]}]},progress});
    const progressHost=page.locator('#gallery-progress-test');
    await progressHost.locator('#tab-gallery').click();
    assert.equal(await progressHost.locator('.gallery-category-rewards [data-reward-type="badge"]').count(),0,'item identifiers are not reward amounts');
    assert.equal(await progressHost.locator('.gallery-category-rewards [data-reward-type="event_token_1"] .gallery-reward-token-value').innerText(),'100');
    await progressHost.locator('#gallery-categories button').first().click();
    assert.equal(await progressHost.locator('.gallery-set-icon').count(),1,'Enhancer renders a single image per set');
    const selectedSetIcon = await progressHost.locator('.gallery-set-icon').getAttribute('src');
    assert.equal(await page.evaluate(()=>globalThis.gallerySetCalls),0);
    await progressHost.getByRole('button',{name:'查看卡片',exact:true}).click();
    await progressHost.locator('.gallery-card').first().waitFor();
    assert.equal(await progressHost.locator('.gallery-card').count(),3);
    assert.match(await progressHost.locator('#gallery-set-detail').innerText(),/1\/20/);
    assert.equal(await progressHost.locator('.gallery-card').first().locator('.gallery-status-icon').nth(1).getAttribute('aria-label'),'Club 状态未知');
    assert.equal(await progressHost.locator('.gallery-card').first().locator('.gallery-status-icon').nth(2).getAttribute('aria-label'),'First Owner 未知');
    assert.ok(await progressHost.locator('.gallery-emblem').count() >= 2);
    assert.ok(await progressHost.locator('.gallery-category-icon').count() >= 1);
    assert.ok(await progressHost.locator('.gallery-set-icon').count() >= 1);
    assert.equal(await progressHost.locator('.gallery-text-card').count(),3);
    assert.equal(await progressHost.locator('.gallery-player-card > input').count(),0,'selection controls must not occupy a card grid column');
    assert.equal(await progressHost.locator('.gallery-player-art > .gallery-card-select').count(),1);
    await progressHost.locator('.gallery-card-select').first().click();
    assert.equal(await progressHost.getByRole('button',{name:'Buy 1',exact:true}).isEnabled(),true);
    assert.equal(await progressHost.locator('.gallery-player-portrait,.gallery-player-card-image,.gallery-ea-card').count(),0);
    assert.ok(await progressHost.locator('.gallery-card-price').count() >= 1);
    assert.match(await progressHost.locator('.gallery-card-price').first().innerText(), /8,300/);
    assert.ok((await progressHost.locator('.gallery-grade-diamond').count()) >= 5);
    await progressHost.getByRole('button',{name:'待核实',exact:true}).click();
    assert.equal(await progressHost.locator('.gallery-card').count(),1);
    assert.equal(await page.evaluate(()=>globalThis.gallerySetCalls),1);
    await progressHost.getByRole('button',{name:'全部',exact:true}).click();
    await page.evaluate(()=>{globalThis.galleryNativeEnabled=true;});
    await progressHost.getByRole('button',{name:'全部',exact:true}).click();
    assert.equal(await progressHost.locator('.gallery-native-card').count(),3,'keep the native view alive while EA retries artwork');
    await page.waitForFunction(()=>globalThis.document.getElementById('gallery-progress-test').querySelectorAll('.gallery-native-card').length===2,{},{timeout:18000});
    assert.equal(await progressHost.locator('.gallery-native-card').count(),2);
    assert.equal(await progressHost.locator('.gallery-text-card').count(),1,'image failure has exactly one text fallback');
    assert.ok((await progressHost.locator('.gallery-text-card').innerText()).includes(progress.rows[2].name));
    assert.equal(await progressHost.evaluate(el=>{
      const native=el.querySelector('.gallery-native-card');
      return native.parentElement===el && native.assignedSlot!=null && globalThis.getComputedStyle(native.firstElementChild).backgroundColor==='rgb(10, 20, 30)';
    }),true,'native cards are slotted light DOM and inherit EA stylesheet');
    await progressHost.locator('#tab-sbc').click();
    assert.equal(await progressHost.locator('.gallery-native-card').count(),0);
    assert.equal(await page.evaluate(()=>globalThis.galleryNativeCreated-globalThis.galleryNativeDisposed),0);
    await progressHost.locator('#tab-gallery').click();
    assert.equal(await progressHost.locator('.gallery-native-card').count(),0,'return lands on category home');
    assert.equal(await progressHost.locator('.gallery-set').count(),0);
    await progressHost.locator('#gallery-categories button').first().click();
    await progressHost.getByRole('button',{name:'查看卡片',exact:true}).click();
    await progressHost.locator('.gallery-native-card').first().waitFor();
    assert.equal(await page.evaluate(()=>globalThis.gallerySetCalls),2,'explicit set reopen invokes the cache-aware loader');
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:800});
      assert.ok(await progressHost.locator('.gallery-card-select').first().evaluate(el=>{
        const box=el.getBoundingClientRect();return box.width > 40 && box.height >= 36;
      }),`card Buy control stays usable at ${width}px`);
      assert.equal(await progressHost.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`Progress ${width} overflow`);
      await page.screenshot({path:path.join(directory,`gallery-progress-${width}.png`)});
    }
    await progressHost.getByRole('button',{name:'返回集合',exact:true}).click();
    assert.equal(await progressHost.locator('.gallery-set-icon').count(),1);
    assert.equal(await progressHost.locator('.gallery-set-icon').getAttribute('src'),selectedSetIcon,'keep the selected image across progress rerenders');
    await page.waitForFunction(()=>globalThis.document.getElementById('gallery-progress-test').shadowRoot.querySelector('.gallery-set .gallery-grade-bar i')?.style.width==='100%');
    assert.ok(await progressHost.locator('.gallery-set .gallery-grade-bar i').first().evaluate(el=>el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0),'known score is painted with fewer than required cards');
    assert.equal(await progressHost.locator('.gallery-native-card').count(),0);
    assert.equal(await page.evaluate(()=>globalThis.galleryNativeCreated-globalThis.galleryNativeDisposed),0);
    assert.match(await progressHost.locator('#gallery-set-list').innerText(),/1 \/ 20/);
    await page.evaluate(()=>{globalThis.galleryHold=true;});
    await progressHost.getByRole('button',{name:'查看卡片',exact:true}).click();
    await page.waitForFunction(()=>typeof globalThis.releaseGallery==='function');
    await page.evaluate(()=>{globalThis.galleryScope='fixture-b';for(const tick of globalThis.galleryTimers.values())tick();globalThis.releaseGallery();});
    await page.waitForFunction(()=>globalThis.document.getElementById('gallery-progress-test').shadowRoot.getElementById('gallery-set-detail').hidden);
    await progressHost.locator('#gallery-categories button').first().click();
    assert.match(await progressHost.locator('#gallery-set-list').innerText(),/\? \/ 20/);
    assert.deepEqual(requests.filter(url=>!url.startsWith('https://www.ea.com/assets/')),[]);
    console.log('Offline Gallery progress smoke passed: exact-set lazy load, filters, back, account change/late response, unknown fields, responsive layout.');

    await page.evaluate(() => globalThis.galleryProgressPanel.close());
    const scoringInput = futggGallery();
    scoringInput.data.categories[0].sets[0].requiredCards = 2;
    scoringInput.data.tags = [{ id: 1, name: 'First Owner', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
      rules: [{type:'COUNT',target:'ATTRIBUTE',attribute:'FIRST_OWNED',values:['1']}], tiers:[{minItems:2,bonus:500}] }];
    const scoringCatalog = normalizeGalleryCatalog('futgg', scoringInput);
    const scoringProgress = mergeGalleryAccountProgress(normalizeGalleryPool('futgg',futggGalleryPool(),30), {
      conceptItems:[{definitionId:900001,isCollected:true,gradingScore:100},{definitionId:900002,isCollected:true,gradingScore:200},
        {definitionId:900003,isCollected:false,gradingScore:300}], clubItems:[{definitionId:900001,owners:1}],
    });
    await page.evaluate(({catalog,progress})=>{
      globalThis.scoringState={status:'observed',source:'futgg',catalog,fetchedAt:Date.now()};
      globalThis.scoringCalls=0;
      globalThis.foCalls=[]; globalThis.foFail=false;
      globalThis.scoringPanel=globalThis.GallerySmoke.mountFc27AcceptancePanel({document:globalThis.document,hostId:'gallery-score-test',targets:()=>[],
        galleryAccountScope:()=>globalThis.galleryScope,
        galleryCatalog:{peek:async()=>null,load:async()=>globalThis.scoringState,refresh:async()=>globalThis.scoringState},
        gallerySetLoader:async()=>{globalThis.scoringCalls++;return {status:'observed',scope:globalThis.galleryScope,progress};},
        galleryFirstOwnerHistory: async (definitionId, firstOwned) => {
          globalThis.foCalls.push([definitionId, firstOwned]);
          if (globalThis.foFail) throw Error('FO_WRITE_FAILED');
          return { status: 'observed', definitionId, firstOwned };
        },
      });globalThis.scoringPanel.open();
    },{catalog:scoringCatalog,progress:scoringProgress});
    const scoringHost=page.locator('#gallery-score-test');
    await scoringHost.locator('#tab-gallery').click();
    await scoringHost.locator('#gallery-categories button').first().click();
    await scoringHost.getByRole('button',{name:'查看卡片',exact:true}).click();
    await scoringHost.locator('.gallery-score').waitFor();
    await page.waitForFunction(()=>globalThis.document.getElementById('gallery-score-test').shadowRoot
      .querySelector('.gallery-score')?.textContent.includes('300–1,800'));
    assert.match(await scoringHost.locator('.gallery-score').innerText(),/300–1,800 分 · 等级待核实/);
    assert.equal(await scoringHost.locator('#gallery-set-detail .gallery-grade-diamond.is-reached').count(),1,'known lower score advances D while the text still marks the grade uncertain');
    assert.equal(await scoringHost.locator('#gallery-set-detail .gallery-grade-bar i').first().evaluate(el=>el.style.width),'100%');
    await scoringHost.locator('.gallery-score summary').click();
    assert.equal(await scoringHost.locator('.gallery-lineup li').count(),2);
    assert.match(await scoringHost.locator('.gallery-bonuses').innerText(),/未知项满足时 1,500/);
    assert.equal(await scoringHost.locator('.gallery-first-owner-toggle').count(), 1,
      'only collected unknown FO offers marking; known FO and missing cards do not');
    const fo = scoringHost.locator('.gallery-first-owner-toggle').first();
    assert.equal(await fo.innerText(), '标记历史 FO');
    await fo.click();
    assert.equal(await fo.innerText(), '清除历史 FO');
    assert.equal(await scoringHost.locator('.gallery-player-flags [aria-label="First Owner"]').count(), 2);
    await scoringHost.locator('.gallery-first-owner-toggle').first().click();
    assert.equal(await scoringHost.locator('.gallery-first-owner-toggle').first().innerText(), '标记历史 FO');
    assert.equal(await scoringHost.locator('.gallery-player-flags [aria-label="First Owner"]').count(), 1,
      'clearing the manual declaration retains the other card’s observed FO');
    assert.deepEqual(await page.evaluate(() => globalThis.foCalls), [[900002, true], [900002, null]]);
    await page.evaluate(() => { globalThis.foFail = true; });
    await scoringHost.locator('.gallery-first-owner-toggle').first().click();
    assert.match(await scoringHost.locator('.gallery-first-owner-error').innerText(), /保存失败/);
    await page.evaluate(() => { globalThis.foFail = false; });
    await scoringHost.getByRole('button',{name:'已收集',exact:true}).click();
    assert.equal(await scoringHost.locator('.gallery-card').count(),2);
    assert.equal(await page.evaluate(()=>globalThis.scoringCalls),1);
    // Tag-only changes recompute locally; do not reread EA or retain old score.
    await page.evaluate(()=>{globalThis.scoringState=structuredClone(globalThis.scoringState);
      globalThis.scoringState.catalog.tags[0].tiers[0].bonus=100;
      globalThis.scoringState.catalog.revision='fixture-rule-change';});
    await scoringHost.locator('#gallery-refresh').click();
    await page.waitForFunction(()=>globalThis.document.getElementById('gallery-score-test').shadowRoot.querySelector('.gallery-score').textContent.includes('300–600'));
    assert.equal(await page.evaluate(()=>globalThis.scoringCalls),1);
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:800});
      assert.equal(await scoringHost.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`Score ${width} overflow`);
    }
    await scoringHost.getByRole('button',{name:'返回集合',exact:true}).click();
    assert.match(await scoringHost.locator('#gallery-set-list').innerText(),/300–600 分/);
    await page.evaluate(()=>{globalThis.galleryScope='score-next-account';for(const tick of globalThis.galleryTimers.values())tick();});
    assert.doesNotMatch(await scoringHost.locator('#gallery-set-list').innerText(),/300–600 分/);
    assert.deepEqual(requests.filter(url=>!url.startsWith('https://www.ea.com/assets/') && !url.startsWith('https://game-assets.fut.gg/')),[]);
    console.log('Offline Gallery scoring smoke passed: interval, lineup/bonus details, filtering, rule update without EA reread, back, account isolation and narrow viewport.');

    await page.evaluate(() => globalThis.scoringPanel.close());
    const planInput = futggGallery();
    planInput.data.categories[0].sets[0].requiredCards = 3;
    planInput.data.categories[0].sets[0].grades[0].threshold = 400;
    planInput.data.tags = [{ id: 1, name: 'No bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
      rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'RARE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }];
    const planningProgress = mergeGalleryAccountProgress(normalizeGalleryPool('futgg', futggGalleryPool(), 30), {
      conceptItems: [{ definitionId: 900001, isCollected: true, gradingScore: 100 },
        { definitionId: 900002, isCollected: true, gradingScore: 200 },
        { definitionId: 900003, isCollected: false, gradingScore: 300 }],
    });
    await page.evaluate(({ catalog, progress }) => {
      globalThis.planningCalls = 0;
      globalThis.compareCalls = 0;
      globalThis.planningSettingsReads = 0;
      globalThis.planningSettingsBroken = false;
      globalThis.planningDetail = { status: 'observed', scope: globalThis.galleryScope, progress,
        prices: { 900003: 200 }, priceError: 'HTTP 429', priceSnapshot: {
          prices: { 900003: 200 }, freshPrices: {}, stale: true, staleIds: [900003],
          expiresAt: null, retryAt: Date.now() + 300000,
        } };
      globalThis.planningPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({ document: globalThis.document,
        hostId: 'gallery-plan-test', targets: () => [], galleryAccountScope: () => globalThis.galleryScope,
        galleryPlanningSettings: { scope: () => globalThis.galleryScope, read: async () => {
          globalThis.planningSettingsReads++;
          if (globalThis.planningSettingsBroken) throw Error('fixture-read-failed');
          return { timeoutMs: 5000 };
        } },
        galleryCatalog: { peek: async () => null, load: async () => ({ status: 'observed', source: 'futgg', catalog }) },
        gallerySetLoader: async () => { globalThis.planningCalls++; return globalThis.planningDetail; },
        galleryMarketCompare: async () => {
          globalThis.compareCalls++;
          return globalThis.compareCalls === 1
            ? { status: 'blocked', reason: 'FC27_MARKET_METHOD_7_CHANGED' }
            : { status: 'observed', price: 200, listings: [{ buyNow: 200, expires: 59 }] };
        },
      });
      globalThis.planningPanel.open();
    }, { catalog: normalizeGalleryCatalog('futgg', planInput), progress: planningProgress });
    const planningHost = page.locator('#gallery-plan-test');
    await planningHost.locator('#tab-gallery').click();
    await planningHost.locator('#gallery-categories button').first().click();
    await planningHost.getByRole('button', { name: '查看卡片', exact: true }).click();
    await planningHost.locator('.gallery-plan').waitFor();
    assert.match(await planningHost.locator('#gallery-set-detail').innerText(), /价格读取失败 · HTTP 429/);
    assert.match(await planningHost.locator('#gallery-set-detail').innerText(), /报价快照待更新/);
    assert.equal(await planningHost.locator('[data-price-state="snapshot"]').count(), 1);
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /报价未知/);
    assert.equal(await page.evaluate(() => globalThis.planningSettingsReads), 1, 'new plans read the account deadline once');
    await planningHost.locator('.gallery-plan-output summary').first().click();
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /1 张卡缺少报价/);
    // A fresh quote that expires while the detail remains open cannot leak
    // into a later local plan. No timer or new network read is necessary.
    await page.evaluate(() => {
      globalThis.planningDetail.priceSnapshot = { prices: { 900003: 200 }, freshPrices: { 900003: 200 },
        stale: false, staleIds: [], expiresAt: Date.now() - 1 };
    });
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /报价未知/);
    await planningHost.getByRole('button', { name: '全部', exact: true }).click();
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.planningCalls), 1);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await planningHost.evaluate(element => element.scrollWidth > element.clientWidth + 1), false,
        `Plan ${width} overflow`);
      await page.screenshot({ path: path.join(directory, `gallery-plan-${width}.png`) });
    }
    await planningHost.getByRole('button', { name: '返回集合', exact: true }).click();
    await page.evaluate(() => { globalThis.planningDetail.priceError = null;
      globalThis.planningDetail.priceSnapshot = { prices: { 900003: 200 }, freshPrices: { 900003: 200 },
        stale: false, staleIds: [], expiresAt: Date.now() + 300000 }; });
    await planningHost.getByRole('button', { name: '查看卡片', exact: true }).click();
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /200/);
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /目录奖励预估/);
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /累计奖励/);
    assert.doesNotMatch(await planningHost.locator('#gallery-set-detail').innerText(), /价格读取失败|报价快照待更新/);
    assert.equal(await page.evaluate(() => globalThis.planningCalls), 2);
    const planBeforeCompare = await planningHost.locator('.gallery-plan-output').innerText();
    await planningHost.getByRole('button', { name: '比价', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-market-comparison').innerText(), /FC27_MARKET_METHOD_7_CHANGED/);
    assert.equal(await planningHost.locator('.gallery-plan-output').innerText(), planBeforeCompare);
    assert.equal(await page.evaluate(() => globalThis.compareCalls), 1);
    await planningHost.getByRole('button', { name: '比价', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-market-comparison').innerText(), /EA 200 金币/);
    assert.match(await planningHost.locator('.gallery-market-listings').innerText(), /EA 可见报价 1 条/);
    assert.equal(await planningHost.locator('.gallery-plan-output').innerText(), planBeforeCompare);
    assert.equal(await page.evaluate(() => globalThis.compareCalls), 2);
    assert.equal(await page.evaluate(() => globalThis.planningCalls), 2);
    const deadlineReads = await page.evaluate(() => globalThis.planningSettingsReads);
    await planningHost.getByRole('button', { name: '各档费用', exact: true }).click();
    await planningHost.locator('.gallery-grade-overview-row').nth(4).waitFor();
    const rewardRows = await planningHost.locator('.gallery-grade-overview-row').allTextContents();
    assert.ok(rewardRows.every(text => text.includes('本档：') && text.includes('累计：')));
    assert.match(rewardRows[0], /Club Badge ×1/);
    assert.match(rewardRows[4], /Gallery Tokens ×100/);
    assert.equal(await page.evaluate(() => globalThis.planningSettingsReads), deadlineReads + 1, 'overview freezes one account timeout for all grades');
    assert.equal(await page.evaluate(() => globalThis.planningCalls), 2, 'reward display adds no account reads');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await planningHost.locator('.gallery-grade-overview').scrollIntoViewIfNeeded();
      assert.equal(await planningHost.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({ path: path.join(directory, `gallery-single-rewards-${width}.png`) });
    }
    await page.evaluate(() => {
      const original = globalThis.planningDetail.progress.rows[2];
      globalThis.planningDetail.progress = { ...globalThis.planningDetail.progress,
        rows: Array.from({ length: 128 }, (_, index) => ({ ...original, eaId: 900010 + index, collected: false })) };
    });
    await planningHost.locator('.gallery-plan select').selectOption('C');
    await page.evaluate(() => {
      globalThis.planningHeartbeats = 0;
      globalThis.planningHeartbeatTimer = globalThis.setInterval(() => globalThis.planningHeartbeats++, 16);
    });
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.querySelector('#gallery-plan-test').shadowRoot
      .querySelector('.gallery-plan button').disabled, null, { timeout: 20000 });
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /(?:搜索预算耗尽|本次计算达到时间上限|有界搜索未找到方案)，尚不能确认无解/);
    assert.ok(await page.evaluate(() => { globalThis.clearInterval(globalThis.planningHeartbeatTimer);
      return globalThis.planningHeartbeats > 1; }), 'planning yields to browser heartbeat');
    assert.equal(await page.evaluate(() => globalThis.planningCalls), 2);
    await page.evaluate(() => { globalThis.planningSettingsBroken = true; });
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /方案计算设置读取失败/);
    await page.evaluate(() => { globalThis.planningSettingsBroken = false; });
    await planningHost.getByRole('button', { name: '返回集合', exact: true }).click();
    await page.evaluate(() => {
      globalThis.planningDetail.status = 'blocked'; globalThis.planningDetail.reason = 'FC27_GALLERY_HTTP_401';
      globalThis.planningDetail.progress = { ...globalThis.planningDetail.progress, complete: false,
        totals: { ...globalThis.planningDetail.progress.totals, total: 128, collected: 0, missing: 0, unknown: 128 },
        rows: globalThis.planningDetail.progress.rows.map(row => ({ ...row, collected: null })) };
    });
    await planningHost.getByRole('button', { name: '查看卡片', exact: true }).click();
    await planningHost.locator('.gallery-big-count').waitFor();
    assert.equal(await planningHost.locator('.gallery-big-count').innerText(), '?/3');
    assert.match(await planningHost.locator('#gallery-set-detail').innerText(), /账号状态未同步 · FC27_GALLERY_HTTP_401/);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await planningHost.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      await page.screenshot({ path: path.join(directory, `gallery-unsynced-${width}.png`) });
    }
    await planningHost.getByRole('button', { name: '返回集合', exact: true }).click();
    const limitedPool = normalizeGalleryPool('futgg', futggTruncatedGalleryPool(30), 30);
    const limitedProgress = mergeGalleryAccountProgress(limitedPool, {
      conceptItems: limitedPool.items.map(row => ({ definitionId: row.eaId, isCollected: true, gradingScore: row.score })),
    });
    await page.evaluate(({ pool, progress }) => {
      globalThis.planningDetail = { status: 'observed', scope: globalThis.galleryScope, pool, progress };
    }, { pool: limitedPool, progress: limitedProgress });
    await planningHost.getByRole('button', { name: '查看卡片', exact: true }).click();
    assert.equal(await planningHost.locator('#gallery-set-detail .gallery-player-card').count(), 24);
    assert.match(await planningHost.locator('.gallery-card-page').innerText(), /1-24 \/ 100/);
    await planningHost.getByRole('button', { name: '下一页', exact: true }).click();
    assert.equal(await planningHost.locator('#gallery-set-detail .gallery-player-card').count(), 24);
    assert.match(await planningHost.locator('.gallery-card-page').innerText(), /25-48 \/ 100/);
    await planningHost.getByRole('button', { name: '上一页', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-overview').innerText(), /高分候选 100 \/ 全部 19489/);
    assert.match(await planningHost.locator('.gallery-overview').innerText(), /候选内已收集/);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await planningHost.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
      await page.screenshot({ path: path.join(directory, `gallery-top100-${width}.png`) });
    }
    assert.deepEqual(requests.filter(url => !url.startsWith('https://www.ea.com/assets/')), []);
    console.log('Offline Gallery planning smoke passed: stale/error display, quote exclusion, repeated local plans, heartbeat/cancel, unknown progress and responsive layout.');
  } finally { await page.close(); }
}
