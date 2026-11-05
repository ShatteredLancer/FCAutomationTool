import assert from 'node:assert/strict';
import path from 'node:path';

export async function exerciseTradingEvents(context,directory,bundle){
  const page=await context.newPage();page.setDefaultTimeout(6000);let requests=0;page.on('request',()=>requests++);
  try{await page.setViewportSize({width:1400,height:1050});await page.setContent('<!doctype html><title>EVO event portfolio — offline simulation</title>');await page.addScriptTag({content:bundle});
    await page.evaluate(()=>{
      const attach=globalThis.Element.prototype.attachShadow;globalThis.Element.prototype.attachShadow=function(o){return attach.call(this,{...o,mode:'open'});};
      globalThis.eventTime=Date.now();Date.now=()=>globalThis.eventTime;globalThis.eventCalls=[];globalThis.eventPrice=1500;globalThis.eventImports=0;globalThis.eventTimers=new Map();let tid=0;
      globalThis.setInterval=fn=>{globalThis.eventTimers.set(++tid,fn);return tid;};globalThis.clearInterval=id=>globalThis.eventTimers.delete(id);
      const context={scope:'event-test',season:'27',platform:'console'},data=new Map([['old-journal',{pending:true}]]),owned=new Map();globalThis.eventData=data;globalThis.eventAccount='event-test';let progress=null,serial=0;
      const get=async(k,f)=>structuredClone(data.get(k)??f),set=async(k,v)=>data.set(k,structuredClone(v));
      const session=globalThis.TradingFixture.createTradingExecutionSession({context,scope:'event-test',get,set,now:()=>Date.now(),exclusive:async(_s,fn)=>fn(),
        onProgress:value=>progress?.(value),createAdapter:async()=>({capabilities:async()=>({canTrade:true,balance:40000,freeSlots:20}),
          find:async r=>({definitionId:r.definitionId,itemId:901,tradeId:'9901',price:1300}),buy:async offer=>{globalThis.eventCalls.push('buy');owned.set(offer.itemId,'bought');return {...offer,status:'bought'};},
          move:async e=>{globalThis.eventCalls.push('move');owned.set(e.offer.itemId,'transfer');},eventExit:async(_e,r)=>({ready:globalThis.eventPrice>=r.sellPrice,reviewRequired:Date.now()>=r.event.reviewAt}),
          checkListing:async()=>{},list:async e=>{globalThis.eventCalls.push('list');owned.set(e.offer.itemId,'listed');return {status:'accepted'};},
          reconcile:async e=>{const phase=owned.get(e.offer.itemId);return phase?{phase,...(phase==='listed'?{listingTradeId:'9902'}:{})}:null;},cancel(){}})});
      const execution={prepare:plan=>({plan,balance:40000}),inspect:()=>session.inspect(),recover:()=>session.recover(),stop:()=>session.stop(),start:async options=>{progress=options.onProgress;try{return await session.execute(options);}finally{progress=null;}}};
      const url='https://x.com/ExampleSource/status/2118109323020898419',post={url,author:'ExampleSource',at:Date.now()-10000,text:'Camavinga under 1.5K. EVO leak; exact conditions unknown.',topic:'evo',players:[{name:'Camavinga',version:null,nominationQuote:'Camavinga under 1.5K'}],entry:{ceiling:1500,strictBelow:true,quote:'under 1.5K'},targetPrice:null,evidence:'native-thread-post',threadChecked:true};
      const intel={importPost:async()=>{globalThis.eventImports++;return {schema:1,requestUrl:url,posts:[post],fetchedAt:Date.now()};}},card={definitionId:99,futbinId:88,name:'Camavinga',mentionQuery:'Camavinga',rating:82,price:1500,season:'27',platform:'console'};
      const prices={context:()=>({...context,scope:globalThis.eventAccount}),readSettings:async()=>({source:'futbin',readSources:'both'}),tradingCandidates:async()=>({rows:[{...card,fetchedAt:Date.now()}],at:Date.now(),platform:'console'}),load:async()=>({references:{99:{quotes:{futgg:{source:'futgg',definitionId:99,season:'27',platform:'console',price:1500,fetchedAt:Date.now(),expiresAt:Date.now()+300000}}}}})};
      const service=globalThis.TradingFixture.createFc27TradingDesk({prices,intel,execution,get,set,locks:{request:async(_k,_o,fn)=>fn()},now:()=>Date.now(),id:()=>`event-${++serial}`});
      globalThis.eventPanel=globalThis.TradingFixture.mountFc27AcceptancePanel({document:globalThis.document,hostId:'event-test',targets:()=>[],tradingDesk:service});globalThis.eventPanel.open();
    });
    const host=page.locator('#event-test'),desk=host.locator('#page-trading');await host.locator('#tab-trading').click();await desk.getByText(/本轮结论：1 张/).waitFor();
    await desk.getByRole('tab',{name:'候选与线索',exact:true}).click();await desk.getByLabel('事件原帖链接',{exact:true}).fill('https://x.com/ExampleSource/status/2118109323020898419');
    await desk.getByRole('button',{name:'读取帖子并核价',exact:true}).click();await desk.getByText(/审核目标 1800/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.eventImports),1);assert.deepEqual(await page.evaluate(()=>globalThis.eventCalls),[]);
    await desk.getByRole('button',{name:'纳入整批方案',exact:true}).click();await desk.getByText(/Camavinga.*已纳入整批候选/).waitFor();
    await desk.getByRole('tab',{name:'投资与执行',exact:true}).click();await desk.getByLabel('本轮资金上限（可调整）',{exact:true}).fill('2000');
    await desk.getByRole('button',{name:'生成可审核交易方案',exact:true}).click();await desk.getByText(/本批最多占用 1400.*2000/).waitFor();
    await desk.getByText('EVO 消息仓 · 先持有再触价上架',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>globalThis.eventCalls),[]);
    await desk.getByLabel('我已审核方案并同意真实买入和上架',{exact:true}).check();await desk.getByRole('button',{name:'确认并开始自动交易',exact:true}).click();
    await desk.getByRole('status',{name:'自动交易进度',exact:true}).getByText(/消息仓持有.*已启动本页触价监测/).waitFor();assert.deepEqual(await page.evaluate(()=>globalThis.eventCalls),['buy','move']);
    await desk.getByRole('heading',{name:'交易台',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-event-desktop.png')});
    await page.setViewportSize({width:390,height:950});await desk.getByRole('region',{name:'自动交易持仓',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(directory,'trading-event-mobile.png')});
    assert.equal(await desk.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
    await page.evaluate(()=>{globalThis.eventAccount='B';globalThis.previousEventTicks=[...globalThis.eventTimers.values()];for(const fn of globalThis.previousEventTicks)fn();globalThis.eventAccount='event-test';globalThis.eventPrice=1900;for(const fn of globalThis.previousEventTicks)fn();});
    assert.deepEqual(await page.evaluate(()=>globalThis.eventCalls),['buy','move'],'an observed A/B/A account switch permanently disarms the old grant');
    await host.locator('#tab-sbc').click();await host.locator('#tab-trading').click();await desk.getByRole('status',{name:'自动交易进度',exact:true}).getByText(/尚未启动触价监测/).waitFor();
    await page.evaluate(()=>{globalThis.eventPrice=1900;for(const fn of [...globalThis.eventTimers.values()])fn();});assert.deepEqual(await page.evaluate(()=>globalThis.eventCalls),['buy','move'],'reopen never re-arms an old price trigger');
    await page.evaluate(()=>{globalThis.eventPrice=1500;});
    await desk.getByLabel('我已审核方案并同意真实买入和上架',{exact:true}).check();await desk.getByRole('button',{name:'确认并继续未完成操作',exact:true}).click();
    await desk.getByRole('status',{name:'自动交易进度',exact:true}).getByText(/消息仓持有.*已启动本页触价监测/).waitFor();
    await page.evaluate(()=>{globalThis.eventPrice=1900;for(const fn of [...globalThis.eventTimers.values()])fn();});
    await desk.getByRole('status',{name:'自动交易进度',exact:true}).getByText(/等待成交.*已实现税后盈亏 0/).waitFor();assert.deepEqual(await page.evaluate(()=>globalThis.eventCalls),['buy','move','list']);
    await page.evaluate(()=>{for(const fn of [...globalThis.eventTimers.values()])fn();});assert.deepEqual(await page.evaluate(()=>globalThis.eventCalls),['buy','move','list'],'read-only receipt checks never relist');
    assert.deepEqual(await page.evaluate(()=>globalThis.eventData.get('old-journal')),{pending:true});assert.equal(requests,0);
    console.log('EVO event Chrome passed: explicit post import, unique version/dual-price scenario, inclusion and frozen budget, real session synthetic buy/move/hold, target listing after explicit resume, reload disarms and no duplicate listing; desktop/390px, no HTTP/EA/Grok.');
  }finally{await page.close();}
}
