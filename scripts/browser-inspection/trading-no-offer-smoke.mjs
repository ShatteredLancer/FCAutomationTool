import assert from 'node:assert/strict';
import path from 'node:path';
import {tradingStyle} from '../../src/adapters/browser/fc27-trading-style.js';

export async function exerciseTradingNoOffer(context,directory,bundle){
  const page=await context.newPage();page.setDefaultTimeout(3000);let requests=0;page.on('request',()=>requests++);
  try{await page.setContent('<!doctype html><title>Trading no-offer — offline</title><div id="page-trading"><main class="trading-card"></main></div>');
    await page.addStyleTag({content:`body{background:#172630;color:#eaf1f4;font:14px Arial;padding:16px}button,input{font:inherit} ${tradingStyle}`});await page.addScriptTag({content:bundle});
    await page.evaluate(()=>{globalThis.setupNoOffer=()=>{
      const context={scope:'no-offer-test',season:'27',platform:'console'},data=new Map(),owned=new Map(),now=Date.now();globalThis.noOfferCalls=[];globalThis.noOfferTime=now;globalThis.noOfferAvailable=false;
      const quote=definitionId=>({source:'futgg',definitionId,season:'27',platform:'console',price:1000,fetchedAt:now,expiresAt:now+300000,error:null});
      const plan=globalThis.TradingFixture.createInvestmentPlan({context,id:'no-offer-plan',now,capitalLimit:40000,advice:{platform:'console',validUntil:now+300000,
        suggestions:Array.from({length:6},(_,i)=>({definitionId:901+i,name:`Candidate ${i}`,rating:80,sourceCount:2,ggQuote:quote(901+i),resaleEstimate:1000,buyCeiling:650,reason:'price spread'}))}});
      const session=globalThis.TradingFixture.createTradingExecutionSession({context,scope:'no-offer-test',get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),exclusive:async(_s,fn)=>fn(),
        now:()=>globalThis.noOfferTime,createAdapter:async()=>({capabilities:async()=>({canTrade:true,balance:40000,freeSlots:20}),find:async row=>{globalThis.noOfferCalls.push('search');return globalThis.noOfferAvailable&&row.definitionId===901
          ?{definitionId:901,itemId:1901,tradeId:'9901',price:600}:null;},
          buy:async offer=>{globalThis.noOfferCalls.push('buy');owned.set(offer.itemId,'bought');return {...offer,status:'bought'};},
          move:async e=>{globalThis.noOfferCalls.push('move');owned.set(e.offer.itemId,'transfer');},checkListing:async()=>{},
          list:async e=>{globalThis.noOfferCalls.push('list');owned.set(e.offer.itemId,'listed');return {status:'accepted'};},
          reconcile:async e=>owned.has(e.offer.itemId)?{phase:owned.get(e.offer.itemId),...(owned.get(e.offer.itemId)==='listed'?{listingTradeId:'9902'}:{})}:null,cancel(){}})});
      const service={executionAvailable:()=>true,prepareInvestment:async()=>({plan,balance:40000}),inspectInvestment:()=>session.inspect(),stopInvestment:()=>session.stop(),
        startInvestment:options=>session.execute(options),recoverInvestment:()=>{globalThis.noOfferCalls.push('recover');return session.recover();}};
      globalThis.noOfferView=globalThis.TradingFixture.mountTradingPlanView({document:globalThis.document,parent:globalThis.document.querySelector('main'),service,isCurrent:()=>true,now:()=>globalThis.noOfferTime,
        timers:{setInterval:fn=>{globalThis.noOfferTick=fn;return 1;},clearInterval:()=>{globalThis.noOfferTick=null;}}});
      globalThis.noOfferView.setActive(true);globalThis.noOfferView.setAdvice({suggestions:plan.rows});globalThis.noOfferData=data;
      };globalThis.setupNoOffer();
    });
    await page.getByRole('button',{name:'生成可审核交易方案',exact:true}).click();await page.getByLabel('我已审核方案并同意真实买入和上架',{exact:true}).check();
    await page.getByRole('button',{name:'确认并开始自动交易',exact:true}).click();
    const status=page.getByRole('status',{name:'自动交易进度',exact:true});await status.getByText(/本轮未买入.*6 张.*限价内合格挂单/).waitFor();
    assert.equal((await page.locator('main').innerText()).includes('本轮操作已暂停'),false);
    assert.equal(await page.getByRole('button',{name:'核对成交与持仓（只读）',exact:true}).isVisible(),false,'zero purchases have no receipt-recovery task');
    assert.equal(await page.getByRole('button',{name:'确认并继续未完成操作',exact:true}).isVisible(),false);
    assert.deepEqual(await page.evaluate(()=>globalThis.noOfferCalls),Array(6).fill('search'));
    await status.getByText(/60 秒.*自动重查/).waitFor();
    await page.evaluate(()=>{globalThis.noOfferTime+=60000;globalThis.noOfferTick();});
    await page.waitForFunction(()=>globalThis.noOfferCalls.length===12);
    await page.evaluate(()=>{globalThis.oldNoOfferTick=globalThis.noOfferTick;});
    await page.getByRole('button',{name:'停止自动交易',exact:true}).click();assert.equal(await page.evaluate(()=>globalThis.noOfferTick),null);
    await page.evaluate(()=>{globalThis.noOfferTime+=60000;globalThis.oldNoOfferTick();});
    assert.deepEqual(await page.evaluate(()=>globalThis.noOfferCalls),Array(12).fill('search'));
    await page.screenshot({path:path.join(directory,'trading-no-offer.png')});
    await page.evaluate(()=>{const [key,record]=[...globalThis.noOfferData][0];record.entries[0].reason='DESK_DISCOVERY_EXPIRED';globalThis.noOfferData.set(key,record);
      globalThis.noOfferView.setActive(false);globalThis.noOfferView.setActive(true);});
    await status.getByText(/本轮未买入.*5 张.*限价内合格挂单.*1 张.*过期/).waitFor();
    assert.equal((await page.locator('main').innerText()).includes('本轮操作已暂停'),false);
    assert.deepEqual(await page.evaluate(()=>globalThis.noOfferCalls),Array(12).fill('search'),'reopen does not search or buy');
    await page.evaluate(()=>{const [key,record]=[...globalThis.noOfferData][0];record.status='paused';record.reason='DESK_EXECUTION_REFERENCE_CHANGED';
      record.entries=record.entries.map(({definitionId})=>({definitionId,phase:'waiting',offer:null}));globalThis.noOfferData.set(key,record);
      globalThis.noOfferView.setActive(false);globalThis.noOfferView.setActive(true);});
    await status.getByText(/参考价.*变化.*重新生成.*审核/).waitFor();
    assert.equal(await page.getByRole('button',{name:'核对成交与持仓（只读）',exact:true}).isVisible(),false,'no submitted intent exists to reconcile');
    await page.evaluate(()=>{const [key,record]=[...globalThis.noOfferData][0];record.reason='DESK_EXECUTION_RECOVERY_REQUIRED';
      record.entries[0].buyAcknowledged=false;globalThis.noOfferData.set(key,record);globalThis.noOfferView.setActive(false);globalThis.noOfferView.setActive(true);});
    await status.getByText(/上轮仍有持仓或待核对结果/).waitFor();
    assert.equal(await page.getByRole('button',{name:'核对成交与持仓（只读）',exact:true}).isVisible(),true,'unknown evidence must retain recovery even with zero aggregate buys');
    await page.evaluate(()=>{globalThis.noOfferView.setActive(false);globalThis.document.querySelector('main').replaceChildren();globalThis.setupNoOffer();});
    await page.getByRole('button',{name:'生成可审核交易方案',exact:true}).click();await page.getByLabel('我已审核方案并同意真实买入和上架',{exact:true}).check();
    await page.getByRole('button',{name:'确认并开始自动交易',exact:true}).click();await status.getByText(/60 秒.*自动重查/).waitFor();
    await page.evaluate(()=>{globalThis.noOfferAvailable=true;globalThis.noOfferTime+=60000;globalThis.noOfferTick();});
    await status.getByText(/已确认买入 1.*已跳过 5/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.noOfferCalls.filter(c=>c==='buy').length),1,'delayed pass buys automatically without another approval');
    await page.evaluate(()=>{globalThis.noOfferTime+=60000;globalThis.noOfferTick();});
    await page.waitForFunction(()=>globalThis.noOfferCalls.filter(c=>c==='search').length===17);
    assert.equal(await page.evaluate(()=>globalThis.noOfferCalls.filter(c=>c==='buy').length),1,'already purchased version is never searched/bought again');
    await page.waitForFunction(()=>Boolean(globalThis.noOfferTick)&&globalThis.document.querySelector('.trading-generate button').disabled===false);
    await page.evaluate(()=>{globalThis.noOfferTime=[...globalThis.noOfferData][0][1].plan.expiresAt;globalThis.noOfferTick();});
    await status.getByText(/自动重查已到期/).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.noOfferCalls.filter(c=>c==='search').length),17,'original expiry prevents further buy searches');
    assert.equal(requests,0);console.log('Trading no-offer Chrome passed: six skipped, 60s automatic recheck/buy after one approval, no duplicate, stop/stale callback/reload disarm, original expiry, preserved unknown evidence; no HTTP/EA/model.');
  }finally{await page.close();}
}
