import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { openProductionPanel, selectPanelTab } from './production-panel-inspection.mjs';
import { checkMarketSession } from './market-session-check.mjs';

// Read-only inspection of the nested, closed task view and EA session. Never creates/starts a
// task, approves a run, edits settings, or clicks an EA mutation control.
export async function verifyMarketTaskPage(context, page, directory) {
  const sessionHealth = await checkMarketSession(page, directory);
  if (sessionHealth.status !== 'online') return { status: 'session-unavailable', sessionHealth,
    taskStarts: 0, taskSaves: 0, settingsWrites: 0, eaMutations: 0 };
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
            names:[...this.querySelectorAll('[data-player-identity]')].map(n=>({id:n.dataset.playerIdentity,text:n.parentElement.textContent})),
            versions:[...this.querySelectorAll('#pickerRows [data-add]')].map(n=>({id:n.dataset.add,text:n.parentElement.textContent})),
            pickerText:this.getElementById('pickerRows')?.textContent};}`});
          if(value.exceptionDetails)throw Error('MARKET_INSPECTION_READ_FAILED');return value.result.value;
        };
        if(await clickDraft('#rating-price-mode')){
          await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
          const fields=await readNewControls();ratingPreview={mode:fields.ratingMode,summary:fields.ratingSummary,rows:fields.ratingRows};
          await page.screenshot({path:path.join(directory,'market-rating-live.png')});
        }
        if(await clickDraft('[data-mode="fixed"]')&&await clickDraft('#addPlayer')&&await clickDraft('#playerSearch')){
          try{
            await page.keyboard.type('Raya');let fields;
            for(let i=0;i<50;i++){await page.waitForTimeout(100);fields=await readNewControls();if(fields.names.length)break;}
            playerPreview={names:fields.names,versions:[],requested:false};
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
    return { status: 'observed', sessionHealth, playerSources, before: { ...before, recoverPoint: undefined }, after: { ...after, recoverPoint: undefined },
      catalogPreview, ratingPreview, playerPreview, backgroundStatus, navigation, taskStarts: 0, taskSaves: 0, settingsWrites: 0, eaMutations: 0 };
  } finally { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'market-inspection' }).catch(() => {}); await cdp.detach(); }
}
