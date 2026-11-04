import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {readFile} from 'node:fs/promises';

export async function exerciseTradingDesk(context,directory){
  const bundle=await build({absWorkingDir:path.resolve(import.meta.dirname,'../..'),stdin:{contents:
    "export {mountFc27AcceptancePanel} from './src/adapters/browser/fc27-acceptance-panel.js';export {createFc27TradingDesk} from './src/adapters/browser/fc27-trading-desk.js';",resolveDir:path.resolve(import.meta.dirname,'../..')},
    bundle:true,write:false,format:'iife',globalName:'TradingFixture',target:'chrome120'});
  const page=await context.newPage();page.setDefaultTimeout(10000);let requests=0;page.on('request',()=>{requests++;});
  try{
    await page.setViewportSize({width:1400,height:1050});await page.setContent('<!doctype html><title>Trading desk — offline</title>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
      globalThis.deskTime=Date.now();Date.now=()=>globalThis.deskTime;
      globalThis.deskData=new Map([['protected-journal',{pending:true}],['fsu-locks',[99]]]);globalThis.deskAccount='A';globalThis.deskReads=0;
      globalThis.deskTimer=null;globalThis.setInterval=callback=>{globalThis.deskTimer=callback;return 1;};globalThis.clearInterval=()=>{globalThis.deskTimer=null;};
      let serial=0;
      const prices={context:()=>({scope:globalThis.deskAccount,season:'27',platform:'console'}),knownPlayers:()=>[],remember(){},readSettings:async()=>({source:'futbin',readSources:'both'}),
        load:async()=>{globalThis.deskReads++;return {references:{11:{quotes:Object.fromEntries(['futbin','futgg'].map(source=>[source,{definitionId:11,season:'27',platform:'console',
          source,price:1000,fetchedAt:Date.now(),sourceUpdatedAt:Date.now(),expiresAt:Date.now()+300000,error:null}]))}}};}};
      const service=globalThis.TradingFixture.createFc27TradingDesk({prices,get:async(k,f)=>structuredClone(globalThis.deskData.get(k)??f),set:async(k,v)=>globalThis.deskData.set(k,structuredClone(v)),
        locks:{request:async(_key,_options,task)=>task()},id:()=>`manual-${++serial}`});
      globalThis.deskPanel=globalThis.TradingFixture.mountFc27AcceptancePanel({document:globalThis.document,hostId:'desk-test',targets:()=>[],tradingDesk:service});globalThis.deskPanel.open();
    });
    const host=page.locator('#desk-test'),desk=host.locator('#page-trading');await host.locator('#tab-trading').click();
    await desk.getByText(/账面余额 40,000/).waitFor();assert.equal(await page.evaluate(()=>globalThis.deskReads),0);
    await desk.getByText('资金与利润设置（可手动调整）',{exact:true}).click();await desk.getByLabel('试仓总上限',{exact:true}).fill('12000');
    await desk.getByLabel('最低保留金币',{exact:true}).fill('20000');await desk.getByRole('button',{name:'保存资金设置',exact:true}).click();
    await desk.getByText(/可用试仓 12,000/).waitFor();
    await desk.getByText('添加观察球员',{exact:true}).click();await desk.getByLabel('FUTBIN FC27 链接 / EA版本ID').fill('11');
    await desk.getByLabel('球员名称（可选）').fill('Example player');await desk.getByRole('button',{name:'加入观察',exact:true}).click();
    await desk.getByRole('heading',{name:'Example player · EA 11',exact:true}).waitFor();assert.equal(await page.evaluate(()=>globalThis.deskReads),0);
    await desk.getByRole('button',{name:'刷新报价',exact:true}).click();await desk.getByText(/FUTBIN（绿）：1000/).waitFor();
    await desk.getByLabel('当前原生买价',{exact:true}).fill('600');await desk.getByLabel('保守可卖价',{exact:true}).fill('1000');
    await desk.getByRole('button',{name:'核价并评估',exact:true}).click();await desk.getByRole('heading',{name:'机会提醒 · 1 条未读',exact:true}).waitFor();
    await desk.getByText(/建议买入上限 700/).waitFor();await desk.getByRole('button',{name:'刷新报价',exact:true}).click();
    await desk.getByRole('heading',{name:'机会提醒 · 1 条未读',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.deskData.get('fcat-fc27-trading-desk-v1:A').watch[0].series.futgg.length),1);
    await desk.getByRole('button',{name:'机会标为已读',exact:true}).click();await desk.getByRole('heading',{name:'机会提醒 · 0 条未读',exact:true}).waitFor();
    await desk.getByLabel('我已在官方应用实际买入一张',{exact:true}).check();await desk.getByRole('button',{name:'记录已买入（只记账）',exact:true}).click();
    await desk.getByText(/试仓占用 600\/12,000/).waitFor();
    await desk.getByLabel('实际卖出价',{exact:true}).fill('1000');await desk.getByLabel('我已在官方应用实际卖出',{exact:true}).check();
    await desk.getByRole('button',{name:'记录已卖出（只记账）',exact:true}).click();await desk.getByText(/税后净利 350/).waitFor();
    await desk.getByText('X 消息线索（手动录入，多来源）',{exact:true}).click();await desk.getByLabel('X 原帖链接',{exact:true}).fill('https://x.com/FutPoliceLeaks/status/123456');
    await desk.getByLabel('消息备注',{exact:true}).fill('Unconfirmed SBC; no buy authority');await desk.getByRole('button',{name:'保存消息线索',exact:true}).click();
    await desk.getByRole('link',{name:'FutPoliceLeaks · leak',exact:true}).waitFor();
    const [download]=await Promise.all([page.waitForEvent('download'),desk.getByRole('button',{name:'导出本地记录',exact:true}).click()]);
    const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(exported.manualRecords,true);
    assert.equal(exported.state.records[0].sell,1000);assert.equal(JSON.stringify(exported).includes('protected-journal'),false);
    await desk.getByRole('heading',{name:'机会提醒 · 0 条未读',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-desk-desktop.png')});
    await page.setViewportSize({width:390,height:900});await desk.getByText(/建议买入上限 700/).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(directory,'trading-desk-mobile.png')});
    assert.equal(await desk.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'desk fits narrow viewport');
    await desk.getByRole('button',{name:'开始观察（每 5 分钟）',exact:true}).click();await desk.getByRole('button',{name:'停止观察',exact:true}).waitFor();
    await page.evaluate(()=>{globalThis.deskTime+=300001;globalThis.deskTimer();});
    await desk.getByText(/历史机会，当前需重新核价/).waitFor();
    await page.evaluate(()=>{globalThis.deskAccount='B';});await desk.getByRole('button',{name:'刷新报价',exact:true}).click();
    await desk.getByText('账号已变化，请重新打开交易观察。',{exact:true}).waitFor();assert.equal(await desk.getByText(/Example player/).count(),0);
    assert.equal(await page.evaluate(()=>globalThis.deskData.has('fcat-fc27-trading-desk-v1:B')),false);
    await host.locator('#tab-sbc').click();await host.locator('#tab-trading').click();await desk.getByText(/观察名单为空/).waitFor();
    assert.deepEqual(await page.evaluate(()=>globalThis.deskData.get('protected-journal')),{pending:true});
    assert.deepEqual(await page.evaluate(()=>globalThis.deskData.get('fsu-locks')),[99]);assert.equal(requests,0);
    console.log('Trading desk Chrome passed: configurable capital, dual-source bounded history, deduplicated alerts, manual ledger/X notes, monitoring stop, account isolation, desktop/390px; no EA writes/HTTP.');
  }catch(error){console.log(await page.locator('#desk-test #page-trading').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth,overflow:[...node.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>node.getBoundingClientRect().right+1).map(x=>({tag:x.tagName,text:x.textContent.slice(0,70),width:x.getBoundingClientRect().width})).slice(0,8)})));throw error;}
  finally{await page.close();}
}
