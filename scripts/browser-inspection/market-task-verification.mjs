import path from 'node:path';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { openProductionPanel, selectPanelTab } from './production-panel-inspection.mjs';
import { checkMarketSession } from './market-session-check.mjs';
import { observeMarketSessionEvidence } from './market-session-evidence.mjs';
import { startRequestedSessionMonitor } from './market-session-monitor.mjs';
import { build } from 'esbuild';

// Empty selection verifies the production Watch reader with one authenticated
// read. It never bids, refreshes a selected auction, or exports item identities.
async function checkAuctionReader(page) {
  const bundle = await build({ stdin: { resolveDir: path.resolve(import.meta.dirname, '../..'), contents: `
    export { createMarketAuctionReader } from './src/adapters/ea/fc27-market-auctions.js';
    export { readFc27Context } from './src/adapters/ea/fc27-local-read.js';
    export { FC27_TRADITIONAL_WEB_LOCK } from './src/fc27/traditional-lock.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'AuctionReadCheck' });
  return page.evaluate(`(async () => { ${bundle.outputFiles[0].text}
    let requests=0, httpStatus=null, success=null;
    try {
      const binding=JSON.stringify(AuctionReadCheck.readFc27Context(globalThis));
      const assert=()=>{if(binding!==JSON.stringify(AuctionReadCheck.readFc27Context(globalThis)))throw Error('MARKET_CONTEXT_CHANGED');};
      const reader=AuctionReadCheck.createMarketAuctionReader({root:globalThis,assert,
        pace:async()=>{assert();if(++requests>1)throw Error('MARKET_INSPECTION_READ_LIMIT');},
        readable:result=>{httpStatus=result.response?.status??null;success=result.response?.success===true;
          if(result.status!=='completed'||!success||!Number.isSafeInteger(httpStatus)||httpStatus<200||httpStatus>=300)throw Error('MARKET_READ_UNCONFIRMED');}
      });
      await reader.ready();
      return await navigator.locks.request(AuctionReadCheck.FC27_TRADITIONAL_WEB_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock)return {status:'busy',methodsVerified:true,requests:0,eaMutations:0};
        const result=await reader.read([]);
        return {status:'observed',methodsVerified:true,requests,httpStatus,success,
          watchedCount:globalThis.repositories.Item.getWatchedItems().length,receipts:result.receipts.length,eaMutations:0};
      });
    } catch(error) {return {status:'blocked',reason:/^(MARKET|FC27)_[A-Z0-9_]+$/.test(error.message)?error.message:'UNVERIFIED',requests,httpStatus,success,eaMutations:0};}
  })()`);
}

// Read-only inspection of the nested, closed task view and EA session. Never creates/starts a
// task, approves a run, edits settings, or clicks an EA mutation control.
export async function verifyMarketTaskPage(context, page, directory) {
  const evidence = observeMarketSessionEvidence(page, directory);
  // A one-shot, inspector-authored request limits this invocation to name UI,
  // optionally one concept selection after a new login. Never repeats health.
  const localRequest=path.join(directory,'market-player-ui-request.json');
  const local=await readFile(localRequest,'utf8').then(JSON.parse).catch(()=>null);
  if(['local-names','player-versions','evidence-only','version-recovery','version-read'].includes(local?.mode)&&Number.isSafeInteger(local.at)&&Date.now()-local.at>=0&&Date.now()-local.at<60000){
    await unlink(localRequest);
    if(['version-recovery','version-read'].includes(local.mode)){
      const {inspectMarketPlayerRenewal}=await import(`./market-player-session-check.mjs?revision=${Date.now()}`);
      const result=await inspectMarketPlayerRenewal(page,{renew:local.mode==='version-recovery'});return {...result,httpEvidence:evidence.snapshot()};
    }
    if(local.mode==='evidence-only')return {status:'passive-evidence-only',httpEvidence:evidence.snapshot(),
      versionResources:await page.evaluate(()=>globalThis.performance.getEntriesByType('resource').filter(r=>{try{return new URL(r.name).pathname.includes('/defid');}catch{return false;}}).slice(-5).map(r=>({at:Math.round(globalThis.performance.timeOrigin+r.startTime),status:r.responseStatus??null,durationMs:Math.round(r.duration)}))),requestsInitiated:0};
    if(local.desktop===true)await page.setViewportSize({width:1280,height:720});
    const {verifyMarketPlayerUi}=await import(`./market-player-ui-check.mjs?revision=${Date.now()}`);
    return verifyMarketPlayerUi(context,page,directory,{readVersions:local.mode==='player-versions'});
  }
  const sessionHealth = await checkMarketSession(page, directory);
  if (sessionHealth.status !== 'online') return { status: 'session-unavailable', sessionHealth,
    httpEvidence: evidence.snapshot(), taskStarts: 0, taskSaves: 0, settingsWrites: 0, eaMutations: 0 };
  const monitor = await startRequestedSessionMonitor(page, directory);
  if (monitor) return { status: 'session-investigation', sessionHealth, monitor };
  const auctionReader = await checkAuctionReader(page);
  if (auctionReader.status !== 'observed') return { status:'auction-read-unavailable', sessionHealth, auctionReader,
    taskStarts:0,taskSaves:0,settingsWrites:0,eaMutations:0 };
  const publicMethods=await page.evaluate(()=>{
    const source=String(globalThis.UTHttpRequest),fallback=globalThis[source.match(/=(a0_0x[\da-f]+)/)?.[1]];
    return ['UTItemDAO.prototype.searchConceptItems','UTPlayerSearchEngine','UTItemSearchViewModel.prototype.setPlayerData'].map(path=>{
      const fn=path.split('.').reduce((o,k)=>o?.[k],globalThis),raw=typeof fn==='function'?String(fn):'';
      const aliases=new Map([...raw.matchAll(/(_0x[\da-f]+)=(a0_0x[\da-f]+)/g)].map(m=>[m[1],m[2]]));
      return {path,source:raw,decoded:raw.replace(/(_0x[\da-f]+|a0_0x[\da-f]+)\((0x[\da-f]+)\)/g,(call,name,n)=>{const d=globalThis[aliases.get(name)??name]??fallback;return typeof d==='function'?JSON.stringify(d(Number(n))):call;})};
    });
  });
  await writeFile(path.join(directory,'market-player-public-methods.json'),JSON.stringify(publicMethods,null,2));
  const playerSources=await page.evaluate(()=>{
    const root=globalThis,repo=root.repositories?.Item,data=repo?.getStaticData?.(),engine=typeof root.UTPlayerSearchEngine==='function'&&data?new root.UTPlayerSearchEngine(data):null;
    const hits=engine?.getEntriesForString('Raya',5)??[];
    return {staticCount:Array.isArray(data)?data.length:null,mask:root.ItemIdMask?.DATABASE,
      hits:hits.map(row=>Object.fromEntries(Object.entries(row).filter(([k,v])=>['id','rating','firstName','lastName','commonName','teamId','nationId','rareflag','leagueId','position'].includes(k)&&['string','number'].includes(typeof v)))),
      keys:hits[0]?Object.keys(hits[0]):[],
      login:!!root.document.querySelector('button.btn-standard.call-to-action')&&!(root.repositories?.Club?.items?.length),
      searchControl:typeof root.UTPlayerSearchControl==='function'?String(root.UTPlayerSearchControl.prototype.handleItemSelected).slice(0,3000):null};
  });
  if(playerSources.staticCount===0||playerSources.staticCount===null)return {status:'player-data-not-ready',playerSources};
  await openProductionPanel(context, page); await selectPanelTab(context, page, 'trading');
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = node => {
      const attrs = node.attributes ?? [], index = attrs.indexOf('class');
      if (index >= 0 && attrs[index + 1].split(' ').includes('market-task-manager')) return node;
      for (const child of [...node.children ?? [], ...node.shadowRoots ?? []]) { const hit = find(child); if (hit) return hit; }
      return null;
    };
    const host = find(root), shadow = host?.shadowRoots?.find(node => node.shadowRootType === 'closed');
    if (!shadow) throw Error('MARKET_INSPECTION_VIEW_UNAVAILABLE');
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'market-inspection' });
    const read = async () => {
      const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function () {
          const text = id => this.getElementById(id)?.textContent ?? null;
          const recover = this.getElementById('market-recover'), rect = recover?.getBoundingClientRect();
          const x = rect ? rect.x+rect.width/2 : 0, y = rect ? rect.y+rect.height/2 : 0, outer = this.host.getRootNode();
          const hit = this.elementFromPoint(x,y), uncovered = (hit === recover || recover?.contains(hit))
            && outer.elementFromPoint(x,y) === this.host && this.ownerDocument.elementFromPoint(x,y) === outer.host;
          return { status: text('toast'), runtime: text('market-runtime-status'), coordination: text('market-coordination-status'),
            sessionControl: !!this.getElementById('market-session-status'), sessionStatus: text('market-session-status'),
            searchControl: !!this.getElementById('market-search-status'), searchStatus: text('market-search-status'),
            recoveryPanel: !!this.getElementById('market-recovery-panel'),
            recoveryVisible: this.getElementById('market-recovery-panel')?.hidden === false,
            isolationRows: this.querySelectorAll('[data-recovery="isolate"]').length,
            isolatedRows: this.querySelectorAll('[data-recovery="handled"]').length,
            sources: [...this.getElementById('source')?.options ?? []].map(o => o.value),
            tasks: this.querySelectorAll('[data-action="start"]').length,
            canStart: this.querySelectorAll('[data-action="start"]:not(:disabled)').length,
            readonlyRecovery: !!recover && !recover.disabled,
            recoverPoint: rect && rect.width > 0 && rect.height > 0 && recover.checkVisibility() && uncovered ? {x,y}:null };
        }` });
      if (result.exceptionDetails) throw Error('MARKET_INSPECTION_READ_FAILED');
      return result.result.value;
    };
    let before;
    for (let i = 0; i < 50; i++) { before = await read(); if (!before.status?.includes('读取本地任务')) break; await page.waitForTimeout(100); }
    if (!before.recoverPoint || !before.readonlyRecovery) return { status: 'unavailable', ui: { ...before, recoverPoint: undefined } };
    await page.mouse.click(before.recoverPoint.x, before.recoverPoint.y);
    let after;
    for (let i = 0; i < 100; i++) { await page.waitForTimeout(100); after = await read(); if (after.runtime !== '核对交易接口' && after.readonlyRecovery && after.status !== before.status) break; }
    // Open a disposable draft solely to exercise the local catalog. Never save
    // it, start it, change account settings, or close an existing user draft.
    const inspectDraft = async () => {
      const value = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function () { return { open: !!this.querySelector('dialog[open]'),
          rows: this.querySelectorAll('#pool .picker-row').length, page: this.getElementById('poolPage')?.textContent,
          summary: this.getElementById('filterCount')?.textContent,
          pending: this.getElementById('pool')?.textContent?.includes('正在查找'),
          scheduleControl: !!this.getElementById('schedule-enabled'), scheduleEnabled: this.getElementById('schedule-enabled')?.checked }; }` });
      if (value.exceptionDetails) throw Error('MARKET_INSPECTION_READ_FAILED'); return value.result.value;
    };
    const clickDraft = async selector => {
      const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        arguments: [{ value: selector }], functionDeclaration: `function (selector) {
          const node = this.querySelector(selector); if (!node || node.disabled || !node.checkVisibility()) return null;
          node.scrollIntoView({block:'center'}); const r = node.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2;
          const outer=this.host.getRootNode(), hit=this.elementFromPoint(x,y);
          if (!(hit===node || node.contains(hit)) || outer.elementFromPoint(x,y)!==this.host
            || this.ownerDocument.elementFromPoint(x,y)!==outer.host) return null;
          return {x,y};
        }` });
      if (result.exceptionDetails || !result.result.value) return false;
      await page.mouse.click(result.result.value.x, result.result.value.y); return true;
    };
    let catalogPreview = { status: 'skipped-existing-dialog' }, ratingPreview=null, playerPreview=null;
    const biddingPreview=[];
    if (!(await inspectDraft()).open && await clickDraft('#newTask')) {
      try {
        if (await clickDraft('[data-mode="filter"]') && await clickDraft('#previewPool')) {
          let draft;
          for (let i = 0; i < 100; i++) { await page.waitForTimeout(100); draft = await inspectDraft(); if (!draft.pending) break; }
          catalogPreview = { status: 'observed', rows: draft.rows, page: draft.page, summary: draft.summary,
            scheduleControl: draft.scheduleControl, scheduleEnabled: draft.scheduleEnabled };
        } else catalogPreview = { status: 'control-unavailable' };
        const readNewControls=async()=>{
          const value=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,returnByValue:true,functionDeclaration:`function(){return {
            ratingMode:this.getElementById('rating-price-mode')?.value,ratingSummary:this.getElementById('rating-price-summary')?.textContent,
            ratingRows:this.querySelectorAll('#rating-price-rows .rating-grid').length,
            buyMode:this.getElementById('buyMode')?.value,afterBuy:this.getElementById('afterBuy')?.value,
            priceSides:[...new Set([...this.querySelectorAll('#rating-price-rows input[data-side]')].map(n=>n.dataset.side))],
            biddingOptions:[...this.getElementById('buyMode')?.options??[]].map(n=>n.value),
            nativeSearch:!!this.querySelector('[data-fcat-native-player-search]'),
            names:[...this.querySelectorAll('[data-player-identity]')].map(n=>({id:n.dataset.playerIdentity,text:n.textContent})),
            versions:[...this.querySelectorAll('#pickerRows [data-add]')].map(n=>({id:n.dataset.add,text:n.parentElement.textContent})),
            pickerText:this.getElementById('pickerRows')?.textContent};}`});
          if(value.exceptionDetails)throw Error('MARKET_INSPECTION_READ_FAILED');return value.result.value;
        };
        if(await clickDraft('#rating-price-mode')){
          await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
          const fields=await readNewControls();ratingPreview={mode:fields.ratingMode,summary:fields.ratingSummary,rows:fields.ratingRows};
          await page.screenshot({path:path.join(directory,'market-rating-live.png')});
          for(const [mode,steps] of [['bin',0],['bid',1],['both',2]]){
            if(!await clickDraft('#buyMode'))throw Error('MARKET_INSPECTION_CONTROL_UNAVAILABLE');
            await page.keyboard.press('Home');for(let n=0;n<steps;n++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
            const controls=await readNewControls();
            const expected=[...(mode==='bin'?['buy']:mode==='bid'?['bid']:['bid','buy']),'sell'];
            if(controls.buyMode!==mode||JSON.stringify(controls.priceSides)!==JSON.stringify(expected)||controls.ratingRows>5)throw Error('MARKET_INSPECTION_BIDDING_COLUMNS');
            biddingPreview.push({mode,rows:controls.ratingRows,sides:controls.priceSides,options:controls.biddingOptions});
          }
          if(!await clickDraft('#afterBuy'))throw Error('MARKET_INSPECTION_CONTROL_UNAVAILABLE');
          await page.keyboard.press('End');await page.keyboard.press('Enter');
          const hold=await readNewControls();
          if(hold.afterBuy!=='hold'||JSON.stringify(hold.priceSides)!==JSON.stringify(['bid','buy']))throw Error('MARKET_INSPECTION_HOLD_COLUMNS');
          biddingPreview.push({mode:hold.buyMode,afterBuy:hold.afterBuy,sides:hold.priceSides});
          await page.screenshot({path:path.join(directory,'market-bidding-live.png')});
        }
        if(await clickDraft('[data-mode="fixed"]')&&await clickDraft('#addPlayer')&&await clickDraft('#playerSearch')){
          try{
            await page.keyboard.type('Raya');let fields;
            for(let i=0;i<50;i++){await page.waitForTimeout(100);fields=await readNewControls();if(fields.names.length)break;}
            playerPreview={nativeSearch:fields.nativeSearch,names:fields.names,versions:[],requested:false};
            if(!fields.nativeSearch)throw Error('MARKET_INSPECTION_NATIVE_SEARCH_UNAVAILABLE');
            await page.screenshot({path:path.join(directory,'market-player-names-live.png')});
            if(fields.names.some(n=>n.id==='220901')&&await clickDraft('[data-player-identity="220901"]')){
              playerPreview.requested=true;
              for(let i=0;i<180;i++){await page.waitForTimeout(100);fields=await readNewControls();if(!fields.pickerText?.includes('正在读取'))break;}
              playerPreview.versions=fields.versions;playerPreview.status=fields.pickerText;
              await page.screenshot({path:path.join(directory,'market-player-versions-live.png')});
            }
          }finally{await clickDraft('[data-close="picker"]');}
        }
      } finally { await clickDraft('[data-close="editor"]'); }
    }
    const readBackground = () => page.evaluate(() => {
      const node = globalThis.document.getElementById('fcat-fc27-production-market-status');
      return { mounted: !!node, connected: node?.isConnected === true, hidden: node?.hidden ?? null };
    });
    const backgroundStatus = await readBackground();
    await selectPanelTab(context, page, 'sbc');
    const away = await readBackground();
    await selectPanelTab(context, page, 'trading');
    let returned;
    for (let i = 0; i < 50; i++) { returned = await read(); if (!returned.status?.includes('读取本地任务')) break; await page.waitForTimeout(100); }
    const navigation = { away, returned: { ...returned, recoverPoint: undefined }, background: await readBackground() };
    await page.screenshot({ path: path.join(directory, 'market-task-readonly.png') });
    return { status: 'observed', sessionHealth, auctionReader, biddingPreview, playerSources, before: { ...before, recoverPoint: undefined }, after: { ...after, recoverPoint: undefined },
      catalogPreview, ratingPreview, playerPreview, backgroundStatus, navigation, taskStarts: 0, taskSaves: 0, settingsWrites: 0, eaMutations: 0 };
  } finally { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'market-inspection' }).catch(() => {}); await cdp.detach(); }
}
