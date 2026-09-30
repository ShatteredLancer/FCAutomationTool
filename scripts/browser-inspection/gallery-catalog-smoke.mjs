import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { mergeGalleryAccountProgress } from '../../src/gallery/progress.js';
import { futggGallery, fodderGallery, futggGalleryPool } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryCatalog(context, directory) {
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'GallerySmoke', target: 'chrome120' });
  const nativeBundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/ea/fc27-gallery-card.js'],
    bundle: true, write: false, format: 'iife', globalName: 'GalleryNativeSmoke', target: 'chrome120' });
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
    await host.locator('[data-set-id="futgg:30"]').waitFor();
    assert.equal(await page.evaluate(() => globalThis.galleryTimers.size), 1);
    assert.equal(await host.locator('#gallery-categories button').count(), 2);
    assert.match(await host.locator('#gallery-set-list').innerText(), /收集进度：未同步/);
    assert.match(await host.locator('#gallery-set-list').textContent(), /Club Badge/);
    await host.locator('#gallery-categories button').last().click();
    assert.equal(await host.locator('#gallery-categories button').last().getAttribute('aria-pressed'), 'true');
    await host.locator('#gallery-refresh').click();
    await host.locator('[data-set-id="fodder:league/example-club"]').waitFor();
    assert.match(await host.locator('#gallery-status').innerText(), /更新未成功，保留旧目录/);
    assert.match(await host.locator('#gallery-source-error').innerText(), /FUT\.GG 未连接（HTTP 403）/);
    assert.match(await host.locator('#gallery-set-list').textContent(), /未提供非代币奖励/);
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
      clubItems:[{definitionId:900002,owners:2}],
    });
    await page.evaluate(({catalog,progress}) => {
      globalThis.gallerySetCalls=0;globalThis.galleryScope='fixture-a';globalThis.galleryHold=false;
      globalThis.galleryNativeEnabled=false;globalThis.galleryNativeCreated=0;globalThis.galleryNativeDisposed=0;
      const renderer=globalThis.GalleryNativeSmoke.createFc27GalleryNativeRenderer({
        UTItemEntity:class{},factories:{Item:{createItem:raw=>({concept:true,definitionId:raw.resourceId,guidAssetId:raw.guidAssetId})}},
        UTItemViewFactory:{createLargeItem:()=>{
          globalThis.galleryNativeCreated++;const element=globalThis.document.createElement('div');element.className='fixture-ea-card';
          return {init(){},getRootElement:()=>element,assetsLoaded:new Map([['shell',true],['main',true]]),
            render(item){if(item.definitionId===900003)this.assetsLoaded.set('main',false);this.renderComplete();},
            renderComplete(){},dealloc(){globalThis.galleryNativeDisposed++;}};
        }},
      },{document:globalThis.document});
      globalThis.galleryProgressPanel=globalThis.GallerySmoke.mountFc27AcceptancePanel({document:globalThis.document,hostId:'gallery-progress-test',targets:()=>[],
        galleryNativeRenderer:{render:options=>globalThis.galleryNativeEnabled?renderer.render(options):null},
        galleryAssets:{club:id=>`https://www.ea.com/assets/club/${id}.png`,league:id=>`https://www.ea.com/assets/league/${id}.png`,nation:id=>`https://www.ea.com/assets/nation/${id}.png`,portrait:id=>`https://www.ea.com/assets/portrait/${id}.png`,category:()=>['https://www.ea.com/assets/league/13.png'],set:()=>['https://www.ea.com/assets/club/1.png']},
        galleryCatalog:{peek:async()=>null,load:async()=>({status:'observed',source:'futgg',catalog,fetchedAt:Date.now()}),refresh:async()=>({status:'blocked'})},
        galleryAccountScope:()=>globalThis.galleryScope,
        gallerySetLoader:async()=>{
          globalThis.gallerySetCalls++;
          const scope=globalThis.galleryScope;
          if(globalThis.galleryHold)await new Promise(resolve=>{globalThis.releaseGallery=resolve;});
          return {status:'observed',scope,progress,prices:{900001:8300,900002:12500,900003:4200},fetchedAt:Date.now(),runtimeCards:new Map(progress.rows.map(row=>[row.eaId,
            {resourceId:row.eaId,itemType:'player',dream:true,guidAssetId:`exact-${row.eaId}`}]))};
        },
      });globalThis.galleryProgressPanel.open();
    },{catalog,progress});
    const progressHost=page.locator('#gallery-progress-test');
    await progressHost.locator('#tab-gallery').click();
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
    await progressHost.locator('.gallery-native-card').first().waitFor();
    assert.equal(await page.evaluate(()=>globalThis.gallerySetCalls),1,'tab return reuses display DTOs');
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:800});
      assert.equal(await progressHost.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`Progress ${width} overflow`);
      await page.screenshot({path:path.join(directory,`gallery-progress-${width}.png`)});
    }
    await progressHost.getByRole('button',{name:'返回集合',exact:true}).click();
    assert.equal(await progressHost.locator('.gallery-native-card').count(),0);
    assert.equal(await page.evaluate(()=>globalThis.galleryNativeCreated-globalThis.galleryNativeDisposed),0);
    assert.match(await progressHost.locator('#gallery-set-list').innerText(),/已确认收集 1 \/ 目标 20/);
    await page.evaluate(()=>{globalThis.galleryHold=true;});
    await progressHost.getByRole('button',{name:'查看卡片',exact:true}).click();
    await page.waitForFunction(()=>typeof globalThis.releaseGallery==='function');
    await page.evaluate(()=>{globalThis.galleryScope='fixture-b';for(const tick of globalThis.galleryTimers.values())tick();globalThis.releaseGallery();});
    await page.waitForFunction(()=>globalThis.document.getElementById('gallery-progress-test').shadowRoot.getElementById('gallery-set-detail').hidden);
    assert.match(await progressHost.locator('#gallery-set-list').innerText(),/收集进度：未同步/);
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
      globalThis.scoringPanel=globalThis.GallerySmoke.mountFc27AcceptancePanel({document:globalThis.document,hostId:'gallery-score-test',targets:()=>[],
        galleryAccountScope:()=>globalThis.galleryScope,
        galleryCatalog:{peek:async()=>null,load:async()=>globalThis.scoringState,refresh:async()=>globalThis.scoringState},
        gallerySetLoader:async()=>{globalThis.scoringCalls++;return {status:'observed',scope:globalThis.galleryScope,progress};},
      });globalThis.scoringPanel.open();
    },{catalog:scoringCatalog,progress:scoringProgress});
    const scoringHost=page.locator('#gallery-score-test');
    await scoringHost.locator('#tab-gallery').click();
    await scoringHost.getByRole('button',{name:'查看卡片',exact:true}).click();
    await scoringHost.locator('.gallery-score').waitFor();
    assert.match(await scoringHost.locator('.gallery-score').innerText(),/300–1,800 分 · 等级待核实/);
    await scoringHost.locator('.gallery-score summary').click();
    assert.equal(await scoringHost.locator('.gallery-lineup li').count(),2);
    assert.match(await scoringHost.locator('.gallery-bonuses').innerText(),/未知项满足时 1,500/);
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
    planInput.data.categories[0].sets[0].requiredCards = 2;
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
      globalThis.planningDetail = { status: 'observed', scope: globalThis.galleryScope, progress,
        prices: { 900003: 200 }, priceError: 'HTTP 429', priceSnapshot: {
          prices: { 900003: 200 }, freshPrices: {}, stale: true, staleIds: [900003],
          expiresAt: null, retryAt: Date.now() + 300000,
        } };
      globalThis.planningPanel = globalThis.GallerySmoke.mountFc27AcceptancePanel({ document: globalThis.document,
        hostId: 'gallery-plan-test', targets: () => [], galleryAccountScope: () => globalThis.galleryScope,
        galleryCatalog: { peek: async () => null, load: async () => ({ status: 'observed', source: 'futgg', catalog }) },
        gallerySetLoader: async () => { globalThis.planningCalls++; return globalThis.planningDetail; },
      });
      globalThis.planningPanel.open();
    }, { catalog: normalizeGalleryCatalog('futgg', planInput), progress: planningProgress });
    const planningHost = page.locator('#gallery-plan-test');
    await planningHost.locator('#tab-gallery').click();
    await planningHost.getByRole('button', { name: '查看卡片', exact: true }).click();
    await planningHost.locator('.gallery-plan').waitFor();
    assert.match(await planningHost.locator('#gallery-set-detail').innerText(), /价格读取失败 · HTTP 429/);
    assert.match(await planningHost.locator('#gallery-set-detail').innerText(), /报价快照待更新/);
    assert.equal(await planningHost.locator('[data-price-state="snapshot"]').count(), 1);
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /报价未知/);
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
    assert.doesNotMatch(await planningHost.locator('#gallery-set-detail').innerText(), /价格读取失败|报价快照待更新/);
    assert.equal(await page.evaluate(() => globalThis.planningCalls), 2);
    await page.evaluate(() => {
      const original = globalThis.planningDetail.progress.rows[2];
      globalThis.planningDetail.progress = { ...globalThis.planningDetail.progress,
        rows: Array.from({ length: 128 }, (_, index) => ({ ...original, eaId: 900010 + index, collected: false })) };
    });
    await planningHost.locator('.gallery-plan select').selectOption('C');
    await planningHost.getByRole('button', { name: '生成方案', exact: true }).click();
    assert.match(await planningHost.locator('.gallery-plan-output').innerText(), /搜索预算耗尽，尚不能确认无解/);
    assert.equal(await page.evaluate(() => globalThis.planningCalls), 2);
    assert.deepEqual(requests.filter(url => !url.startsWith('https://www.ea.com/assets/')), []);
    console.log('Offline Gallery planning smoke passed: stale/error display, expired quote exclusion, repeated local plans/filters, reopen recovery and responsive layout.');
  } finally { await page.close(); }
}
