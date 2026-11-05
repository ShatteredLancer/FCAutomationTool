import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {readFile} from 'node:fs/promises';

export async function exerciseTradingDesk(context,directory){
  const bundle=await build({absWorkingDir:path.resolve(import.meta.dirname,'../..'),stdin:{contents:
    "export {mountFc27AcceptancePanel} from './src/adapters/browser/fc27-acceptance-panel.js';export {createFc27TradingDesk} from './src/adapters/browser/fc27-trading-desk.js';export {createFc27TradingIntel} from './src/adapters/browser/fc27-trading-intel.js';export {createTradingExecutionSession} from './src/trading/execution-session.js';",resolveDir:path.resolve(import.meta.dirname,'../..')},
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
  await exerciseTradingDiscovery(context,directory,bundle.outputFiles[0].text);
  await exerciseTradingPairing(context,directory,bundle.outputFiles[0].text);
  await exerciseTradingInvestment(context,directory,bundle.outputFiles[0].text);
}

async function exerciseTradingInvestment(context,directory,bundle){
  const page=await context.newPage();page.setDefaultTimeout(5000);let requests=0;page.on('request',()=>requests++);
  try{await page.setViewportSize({width:1400,height:1050});await page.setContent('<!doctype html><title>Investment execution — offline simulation</title>');await page.addScriptTag({content:bundle});
    await page.evaluate(()=>{
      const attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(o){return attach.call(this,{...o,mode:'open'});};
      const data=new Map([['protected-journal',{pending:true}]]),owned=new Map(),account={scope:'investment-test',season:'27',platform:'console'};
      globalThis.investCalls=[];globalThis.investData=data;let progress=null;
      const get=async(k,f)=>structuredClone(data.get(k)??f),set=async(k,v)=>data.set(k,structuredClone(v)),time=Date.now();
      const session=globalThis.TradingFixture.createTradingExecutionSession({context:account,scope:'investment-test',get,set,exclusive:async(_s,fn)=>fn(),
        createAdapter:async()=>({capabilities:async()=>({canTrade:true,balance:40000,freeSlots:20}),
          find:async row=>({definitionId:row.definitionId,itemId:10000+row.definitionId,tradeId:String(90000+row.definitionId),price:600}),
          buy:async offer=>{globalThis.investCalls.push('buy');owned.set(offer.itemId,'bought');return {...offer,status:'bought'};},
          move:async e=>{globalThis.investCalls.push('move');owned.set(e.offer.itemId,'transfer');},checkListing:async()=>{},
          list:async e=>{globalThis.investCalls.push('list');owned.set(e.offer.itemId,'listed');return {status:'accepted'};},
          reconcile:async e=>{const phase=owned.get(e.offer.itemId);return phase?{phase,...(phase==='listed'?{listingTradeId:String(80000+e.definitionId)}:{})}:null;},cancel(){}}),
        onProgress:value=>progress?.(value)});
      const execution={prepare:p=>({plan:p,balance:40000}),inspect:()=>session.inspect(),recover:()=>session.recover(),stop:()=>session.stop(),
        start:async options=>{progress=options.onProgress;try{return await session.execute(options);}finally{progress=null;}}};
      const rows=Array.from({length:3},(_,i)=>({definitionId:100+i,futbinId:200+i,name:`Candidate ${i}`,rating:80+i,price:1000,closingPrice:1000,fetchedAt:time,season:'27',platform:'console'}));
      const prices={context:()=>account,readSettings:async()=>({source:'futbin',readSources:'both'}),tradingCandidates:async()=>({rows,at:time,platform:'console'}),
        load:async ids=>({references:Object.fromEntries(ids.map(id=>[id,{quotes:{futgg:{source:'futgg',definitionId:id,season:'27',platform:'console',price:1000,fetchedAt:time,expiresAt:time+300000,sourceUpdatedAt:null,error:null}}}]))})};
      const service=globalThis.TradingFixture.createFc27TradingDesk({prices,execution,get,set,locks:{request:async(_k,_o,fn)=>fn()},id:()=> 'offline-investment-plan'});
      globalThis.investPanel=globalThis.TradingFixture.mountFc27AcceptancePanel({document:globalThis.document,hostId:'investment-test',targets:()=>[],tradingDesk:service});globalThis.investPanel.open();
    });
    const host=page.locator('#investment-test'),desk=host.locator('#page-trading');await host.locator('#tab-trading').click();
    await desk.getByText(/本轮结论：3 张/).waitFor();assert.deepEqual(await page.evaluate(()=>globalThis.investCalls),[]);
    assert.equal(await desk.getByRole('button',{name:'确认并开始自动交易',exact:true}).isDisabled(),true);
    await desk.getByLabel('本轮资金上限（可调整）',{exact:true}).fill('2500');await desk.getByLabel('本轮最低留存金币',{exact:true}).fill('20000');
    await desk.getByRole('button',{name:'生成可审核交易方案',exact:true}).click();await desk.getByText(/本批最多占用 2100.*2500/).waitFor();
    await desk.getByRole('button',{name:'移除方案球员 Candidate 2',exact:true}).click();await desk.getByText(/本批最多占用 1400.*2500/).waitFor();
    assert.deepEqual(await page.evaluate(()=>globalThis.investCalls),[]);
    await desk.getByRole('button',{name:'生成可审核交易方案',exact:true}).click();await desk.getByText(/本批最多占用 2100.*2500/).waitFor();
    assert.deepEqual(await page.evaluate(()=>globalThis.investCalls),[]);await desk.getByLabel('我已审核方案并同意真实买入和上架',{exact:true}).check();
    await desk.getByRole('button',{name:'确认并开始自动交易',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-investment-desktop.png')});
    await page.setViewportSize({width:390,height:1000});await desk.getByText(/本批最多占用 2100/).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-investment-mobile.png')});
    assert.equal(await desk.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
    await desk.getByRole('button',{name:'确认并开始自动交易',exact:true}).click();await desk.getByRole('status',{name:'自动交易进度',exact:true}).getByText(/等待成交.*已确认买入 3.*已实现税后盈亏 0/).waitFor();
    assert.deepEqual(await page.evaluate(()=>globalThis.investCalls),['buy','move','list','buy','move','list','buy','move','list']);
    await desk.getByRole('button',{name:'停止自动交易',exact:true}).click();await host.locator('#tab-sbc').click();await host.locator('#tab-trading').click();
    await desk.getByRole('status',{name:'自动交易进度',exact:true}).getByText(/未自动继续交易/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.investCalls.length),9);assert.deepEqual(await page.evaluate(()=>globalThis.investData.get('protected-journal')),{pending:true});assert.equal(requests,0);
    console.log('Trading investment Chrome passed: adjustable budget, whole-plan table, explicit checkbox and start, real session with simulated buy/move/list, listing-not-profit, stop/reopen/no restart, desktop/390px; no live EA/model/HTTP.');
  }finally{await page.close();}
}

async function exerciseTradingPairing(context,directory,bundle){
  const page=await context.newPage();page.setDefaultTimeout(2500);let requests=0;page.on('request',()=>requests++);
  try{await page.setViewportSize({width:1400,height:1000});await page.setContent('<!doctype html><title>Pairing feedback — offline</title>');await page.addScriptTag({content:bundle});
    await page.evaluate(()=>{
      const attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(o){return attach.call(this,{...o,mode:'open'});};
      globalThis.pairData=new Map();globalThis.pairCalls=[];globalThis.pairOffline=true;globalThis.pairReject=false;
      const get=async(k,f)=>structuredClone(globalThis.pairData.get(k)??f),set=async(k,v)=>globalThis.pairData.set(k,structuredClone(v));
      const intel=globalThis.TradingFixture.createFc27TradingIntel({get,set,gmRequest:o=>{globalThis.pairCalls.push(new URL(o.url).pathname);
        if(new URL(o.url).pathname==='/v1/refresh'){globalThis.pairRefresh=o;return;}
        if(new URL(o.url).pathname==='/v1/shutdown'&&!globalThis.pairOffline&&!globalThis.pairReject){globalThis.pairOffline=true;
          o.onload({status:200,responseText:'{"schema":1,"service":"fcat-trading-intel","status":"stopping"}'});
          globalThis.pairRefresh?.onload({status:503,responseText:'{"error":"DESK_INTEL_STOPPED"}'});return;}
        if(globalThis.pairOffline)o.onerror();else if(globalThis.pairReject)o.onload({status:401,responseText:'{"error":"DESK_INTEL_PAIRING_REQUIRED"}'});
        else o.onload({status:200,responseText:JSON.stringify({schema:1,service:'fcat-trading-intel',status:'ready',collecting:false})});}});
      const prices={context:()=>({scope:'pair-account',season:'27',platform:'console'}),knownPlayers:()=>[],remember(){},readSettings:async()=>({source:'futbin',readSources:'futbin'}),
        tradingCandidates:async()=>{await new Promise(r=>{globalThis.pairRelease=r;});return {rows:[],scanned:0,platform:'console',at:Date.now()};}};
      const service=globalThis.TradingFixture.createFc27TradingDesk({prices,intel,get,set,locks:{request:async(_k,_o,task)=>task()}});
      globalThis.pairPanel=globalThis.TradingFixture.mountFc27AcceptancePanel({document:globalThis.document,hostId:'pair-test',targets:()=>[],tradingDesk:service});globalThis.pairPanel.open();
    });
    const host=page.locator('#pair-test'),desk=host.locator('#page-trading');await host.locator('#tab-trading').click();await page.waitForFunction(()=>Boolean(globalThis.pairRelease));
    await desk.getByText('连接本机采集器（首次设置）',{exact:true}).click();await desk.getByLabel('本机采集器配对码',{exact:true}).fill('a'.repeat(48));
    await desk.getByRole('button',{name:'保存采集器连接',exact:true}).click();
    await desk.getByRole('status',{name:'采集器连接状态',exact:true}).getByText(/配对码已保存.*未连接/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.pairData.get('fcat-trading-intel-pairing-v1')==='a'.repeat(48)),true,'save is not silently ignored during candidate discovery');
    assert.equal(await desk.getByLabel('本机采集器配对码',{exact:true}).inputValue(),'');
    await page.evaluate(()=>{globalThis.pairOffline=false;});await desk.getByRole('button',{name:'检查连接（不采集）',exact:true}).click();
    await desk.getByRole('status',{name:'采集器连接状态',exact:true}).getByText(/配对码已保存.*已连接/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.pairCalls.includes('/v1/refresh')),false);assert.equal(requests,0);
    await desk.getByRole('button',{name:'停止本机采集器',exact:true}).click();
    await desk.getByRole('status',{name:'采集器连接状态',exact:true}).getByText(/已接受停止请求/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.pairData.get('fcat-trading-intel-pairing-v1')==='a'.repeat(48)),true);
    await page.evaluate(()=>{globalThis.pairOffline=false;});await desk.getByRole('button',{name:'检查连接（不采集）',exact:true}).click();
    await desk.getByRole('status',{name:'采集器连接状态',exact:true}).getByText(/配对码已保存.*已连接/).waitFor();
    await desk.getByRole('status',{name:'采集器连接状态',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-pairing-desktop.png')});
    await page.setViewportSize({width:390,height:900});await desk.getByRole('status',{name:'采集器连接状态',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-pairing-mobile.png')});
    assert.equal(await desk.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
    await page.evaluate(()=>{globalThis.pairRelease();});await desk.getByText(/样本 0 张/).waitFor();
    await host.locator('#tab-sbc').click();await host.locator('#tab-trading').click();
    await desk.getByRole('status',{name:'采集器连接状态',exact:true}).getByText(/配对码已保存（已回读）/).waitFor();
    await page.evaluate(()=>{globalThis.pairReject=true;});await desk.getByLabel('本机采集器配对码',{exact:true}).fill('b'.repeat(48));await desk.getByRole('button',{name:'保存采集器连接',exact:true}).click();
    await desk.getByRole('status',{name:'采集器连接状态',exact:true}).getByText(/保存未完成.*拒绝该配对码/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.pairData.get('fcat-trading-intel-pairing-v1')==='a'.repeat(48)),true);await page.evaluate(()=>{globalThis.pairRelease();});
    await desk.getByText(/样本 0 张/).waitFor();await page.evaluate(()=>{globalThis.pairReject=false;});
    await desk.getByRole('button',{name:'采集 X 线索并筛选',exact:true}).click();await page.waitForFunction(()=>Boolean(globalThis.pairRefresh));
    await desk.getByRole('button',{name:'停止本机采集器',exact:true}).click();await desk.getByRole('status',{name:'采集器连接状态',exact:true}).getByText(/已接受停止请求/).waitFor();
    await desk.getByText(/本次采集已取消/).waitFor();assert.equal(requests,0);
    console.log('Trading pairing Chrome passed: save/stop during discovery, cancel fake collection while busy, preserved pairing, desktop/390px; no live model, EA writes or HTTP.');
  }finally{await page.close();}
}

async function exerciseTradingDiscovery(context,directory,bundle){
  const page=await context.newPage();page.setDefaultTimeout(10000);let requests=0;page.on('request',()=>requests++);
  try{
    await page.setViewportSize({width:1400,height:1050});await page.setContent('<!doctype html><title>Automatic trading discovery — offline</title>');await page.addScriptTag({content:bundle});
    await page.evaluate(()=>{
      const attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
      globalThis.discoveryTime=Date.now();Date.now=()=>globalThis.discoveryTime;globalThis.discoveryReads=0;globalThis.discoveryIntelCalls=0;
      globalThis.discoveryAccount='A';globalThis.discoveryLow=false;globalThis.discoveryHold=false;
      const rows=Array.from({length:9},(_,i)=>({definitionId:100+i,futbinId:200+i,name:`Public ${i}`,rating:[80,82,84][i%3],
        price:900+i*100,closingPrice:900+i*100,referenceScore:300+i*40,fetchedAt:Date.now(),season:'27',platform:'console'}));
      const data=new Map([['protected-journal',{pending:true}]]);globalThis.discoveryData=data;
      const prices={context:()=>({scope:globalThis.discoveryAccount,season:'27',platform:'console'}),knownPlayers:()=>[],remember(){},readSettings:async()=>({readSources:'both',source:'futbin'}),
        tradingCandidates:async()=>{globalThis.discoveryReads++;if(globalThis.discoveryHold)await new Promise(r=>{globalThis.discoveryRelease=r;});return {rows,at:Date.now(),platform:'console',ratings:[80,82,84],scanned:96};},
        load:async ids=>({references:Object.fromEntries(ids.map(id=>[id,{quotes:Object.fromEntries(['futbin','futgg'].map(source=>[source,{source,definitionId:id,season:'27',platform:'console',
          price:globalThis.discoveryLow?600:rows.find(row=>row.definitionId===id).price,fetchedAt:Date.now(),expiresAt:Date.now()+300000,sourceUpdatedAt:Date.now(),error:null}]))}]))})};
      const intel={pair:async()=>{},refresh:async()=>{globalThis.discoveryIntelCalls++;return {schema:1,fetchedAt:Date.now(),costUsd:.01,warning:'Search evidence; replies may be incomplete.',posts:[
        {author:'FutSheriff',url:'https://x.com/FutSheriff/status/1234567890123456789',parentUrl:'https://x.com/FutSheriff/status/1234567890123456788',at:Date.now(),text:'Author mentions Public 2; full conditions unknown.',
          topic:'evo',players:[{name:'Public 2',version:null,nominationQuote:'Public 2'}],evo:null,evidence:'native-thread-author-reply',threadChecked:true}]};}};
      const service=globalThis.TradingFixture.createFc27TradingDesk({prices,intel,get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),locks:{request:async(_k,_o,task)=>task()}});
      globalThis.discoveryPanel=globalThis.TradingFixture.mountFc27AcceptancePanel({document:globalThis.document,hostId:'discovery-test',targets:()=>[],tradingDesk:service});globalThis.discoveryPanel.open();
    });
    const host=page.locator('#discovery-test'),desk=host.locator('#page-trading');assert.equal(await page.evaluate(()=>globalThis.discoveryReads),0);
    await host.locator('#tab-trading').click();await desk.getByText(/样本 96 张/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.discoveryReads),1);assert.equal(await page.evaluate(()=>globalThis.discoveryIntelCalls),0,'X collection is never automatic on opening/monitor');
    await desk.getByRole('heading',{name:'本轮候选 · 不用先填球员',exact:true}).waitFor();assert.equal(await desk.getByText(/等到 ≤/).count(),6);
    await desk.getByText('资金与利润设置（可手动调整）',{exact:true}).click();await desk.getByRole('button',{name:'保存资金设置',exact:true}).click();
    await desk.getByRole('button',{name:'重新分析候选',exact:true}).click();await desk.getByText(/样本 96 张/).waitFor();
    await desk.getByRole('button',{name:'跟踪本轮候选',exact:true}).click();
    assert.equal(await desk.getByLabel('当前原生买价',{exact:true}).count(),6);assert.equal(await desk.getByLabel('当前原生买价',{exact:true}).first().inputValue(),'');
    await page.evaluate(()=>{globalThis.discoveryLow=true;});await desk.getByRole('button',{name:'刷新报价',exact:true}).click();
    await desk.getByText(/公共参考价触及目标，利润待核实/).first().waitFor();
    await page.evaluate(()=>{globalThis.discoveryLow=false;});await desk.getByRole('button',{name:'采集 X 线索并筛选',exact:true}).click();await desk.getByText(/Author mentions Public 2/).waitFor();
    await desk.getByText(/原生线程＋同作者会话检索已执行/).waitFor();assert.equal(await page.evaluate(()=>globalThis.discoveryIntelCalls),1);
    await desk.getByText('资金与利润设置（可手动调整）',{exact:true}).click();
    const discovery=desk.getByRole('region',{name:'自动候选建议'});await discovery.getByRole('heading',{name:'本轮候选 · 不用先填球员',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-discovery-desktop.png')});
    await page.setViewportSize({width:390,height:900});await discovery.getByRole('heading',{name:'本轮候选 · 不用先填球员',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(directory,'trading-discovery-mobile.png')});assert.equal(await desk.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    await page.evaluate(()=>{globalThis.discoveryHold=true;});await desk.getByRole('button',{name:'重新分析候选',exact:true}).click();
    await page.waitForFunction(()=>Boolean(globalThis.discoveryRelease));await desk.getByRole('button',{name:'取消候选分析',exact:true}).click();
    await desk.getByText(/分析已取消/).waitFor();await page.evaluate(()=>{globalThis.discoveryRelease();});
    await host.locator('#tab-sbc').click();await page.evaluate(()=>{globalThis.discoveryHold=false;globalThis.discoveryAccount='B';});await host.locator('#tab-trading').click();
    await desk.getByText(/观察名单为空/).waitFor();assert.equal(await page.evaluate(()=>globalThis.discoveryData.has('fcat-fc27-trading-desk-v1:B')),false);
    assert.deepEqual(await page.evaluate(()=>globalThis.discoveryData.get('protected-journal')),{pending:true});assert.equal(requests,0);
    console.log('Automatic trading discovery Chrome passed: no player input, bounded recommendations, 10k aggregate budget, bulk follow, non-profit price-touch alerts, explicit X/reply collection only, cancel, account isolation, desktop/390px; no HTTP or EA writes.');
  }finally{await page.close();}
}
