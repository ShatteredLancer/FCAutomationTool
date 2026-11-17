import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseMarketTaskProvider(context) {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ stdin: { contents: `
    export { createMarketTaskProvider } from './src/trading/market-task-provider.js';
    export { createMarketTaskScheduler } from './src/trading/market-task-scheduler.js';
    export { createTradingTaskStore } from './src/adapters/browser/fc27-trading-task-store.js';
    export { createMarketCoordinator } from './src/adapters/browser/fc27-market-coordinator.js';
    export { defaultTradingTaskSettings } from './src/trading/task-model.js';
    export { marketTaskReport } from './src/trading/market-task-report.js';
  `, resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'marketProviderTest', platform: 'browser' });
  const page = await context.newPage(), errors = []; let requests = 0;
  page.on('pageerror', error => errors.push(error.message));
  const url = 'https://fcat-offline.invalid/market-provider';
  await page.route('**/*', route => route.request().url() === url ? route.fulfill({ contentType: 'text/html', body: '<html><body>Offline market task check</body></html>' })
    : (requests++, route.abort()));
  try {
    await page.goto(url); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const api = globalThis.marketProviderTest, data = new Map(), context = { scope: 'offline', season: '27', platform: 'console' };
      let time = 1000000, serial = 0, taskSerial = 0, quotes = 0, stopped = false, delayed = false;
      let searchScope=null, sameHitScope=false, locksHeldAtBuy=0;
      const calls = [], get = async (k, fallback) => structuredClone(data.get(k) ?? fallback), set = async (k, v) => data.set(k, structuredClone(v));
      const store = api.createTradingTaskStore({ context: () => context, get, set, locks: navigator.locks, now: () => time, id: () => `t${++taskSerial}` });
      const coordinator = api.createMarketCoordinator({ context: () => context, get, set, locks: navigator.locks });
      const settings = { ...api.defaultTradingTaskSettings(), buyRule: 'fixed', buyValue: 800, sellRule: 'fixed', sellValue: 700 };
      let snapshot = await store.saveTask({ ...await store.read(), input: { name: 'Fixed', mode: 'fixed', settings,
        players: [{ name: 'Test', definitionId: 901, rating: 84, version: 'gold', cap: null, qty: 1 }], owned: [], excluded: [] } });
      snapshot = await store.saveTask({ ...snapshot, input: { name: 'Sell', mode: 'sell', settings, players: [], excluded: [],
        owned: [{ itemId: '201', definitionId: 902, name: 'Owned', pile: 'club' }] } });
      const native = {
        priceTiers: () => [{ min: 1000, inc: 100 }, { min: 0, inc: 50 }],
        inspectOwned: async row => ({ ...row, eligible: true, cost: null }),
        preflight: async () => ({ ready: true, balance: 10000, freeSlots: 20 }),
        send: async ({ action, beforeDispatch, beforeRequest, executionScope }) => {
          await Promise.resolve();
          if(action.kind==='search')searchScope=executionScope;
          if(action.kind==='buy'){
            sameHitScope=Boolean(executionScope)&&executionScope===searchScope;
            locksHeldAtBuy=(await navigator.locks.query()).held.length;
          }
          if (!delayed && action.kind === 'search') { delayed = true; time += 61000; }
          await beforeRequest(); beforeDispatch(); calls.push([action.taskId, action.kind]);
          if (action.kind === 'search') return { status: 'confirmed', sent: true, offers: [{ itemId: '101', definitionId: 901, tradeId: '501', coins: 600 }] };
          return { status: 'confirmed', receipt: { itemId: action.itemId, definitionId: action.definitionId, coins: action.coins,
            tradeId: action.kind === 'list' ? `7${action.itemId}` : action.tradeId ?? null } };
        },
        readSales: async holdings => holdings.map(h => ({ itemId: h.itemId, definitionId: h.definitionId, tradeId: h.listingTradeId, price: 700, sold: true })),
        reconcile: async () => ({ status: 'unknown', receipt: null }), verifySession: async () => ({ ready: true }),
      };
      const provider = api.createMarketTaskProvider({ native, context, assertCurrent() {}, now: () => time,
        id: () => `a${++serial}`, loadQuotes: async () => { quotes++; return {}; } });
      const scheduler = api.createMarketTaskScheduler({ taskStore: store, coordinator, provider, enabled: true,
        now: () => time, random: () => 0, id: () => `r${++serial}`, wait: async ms => { time += ms; },
        onStatus: state => { if (!stopped && state.evidence.reduce((sum, e) => sum + e.counts[2], 0) === 2) { stopped = true; scheduler.pauseAll(); } } });
      await scheduler.run({ approved: true, snapshot, taskIds: ['t1', 't2'] });
      const ledger = (await coordinator.inspect()).ledger, before = calls.length;
      await scheduler.recover();
      return { stopped, calls, quotes, sameHitScope, locksHeldAtBuy, recoveryWrites: calls.length - before, searches: ledger.searches.length,
        fixed: api.marketTaskReport(ledger, 't1'), sell: api.marketTaskReport(ledger, 't2') };
    });
    assert.equal(result.stopped, true); assert.equal(result.quotes, 0); assert.equal(result.recoveryWrites, 0);
    assert.equal(result.searches, 1); assert.equal(result.calls.filter(row => row[1] === 'buy').length, 1);
    assert.deepEqual(result.calls.slice(0,2),[['t1','search'],['t1','buy']]);
    assert.equal(result.sameHitScope,true);assert.ok(result.locksHeldAtBuy>=3);
    assert.equal(result.fixed.realizedProfit, 65); assert.equal(result.sell.realizedProfit, null);
    assert.equal(result.fixed.sold, 1); assert.equal(result.sell.sold, 1);
    const batches = await page.evaluate(async () => {
      const api = globalThis.marketProviderTest, results = [];
      for (const variant of ['list','hold','reject-list']) {
        const afterBuy = variant === 'hold' ? 'hold' : 'list', rejectList = variant === 'reject-list';
        const data = new Map(), calls = [], context = {scope:`batch-${afterBuy}`,season:'27',platform:'console'};
        let serial = 0, time = 1000000, paused = false;
        const get = async (k,d) => structuredClone(data.get(k) ?? d), set = async (k,v) => data.set(k,structuredClone(v));
        const store = api.createTradingTaskStore({context:()=>context,get,set,locks:navigator.locks,now:()=>time,id:()=> 'batch'});
        const coordinator = api.createMarketCoordinator({context:()=>context,get,set,locks:navigator.locks});
        let snapshot = await store.saveTask({...await store.read(),input:{name:'Batch',mode:'fixed',
          settings:{...api.defaultTradingTaskSettings(),afterBuy,buyRule:'fixed',buyValue:800,sellRule:'fixed',sellValue:900},
          players:[{name:'Card',definitionId:901,rating:84,cap:null,qty:3}],owned:[],excluded:[]}});
        snapshot = await store.saveSettings({...snapshot,settings:{...snapshot.store.settings,perSearch:3}});
        const native = {
          priceTiers:()=>[{min:0,inc:50}], preflight:async()=>({ready:true,balance:10000,freeSlots:20}),
          async send({action,beforeRequest,beforeDispatch}) {
            await beforeRequest();beforeDispatch();calls.push([action.kind,action.itemId ?? null]);
            if(action.kind==='search')return {status:'confirmed',sent:true,offers:[3,1,2].map(n=>({
              itemId:String(100+n),definitionId:901,tradeId:String(500+n),coins:400+n*100}))};
            if(action.kind==='buy'&&action.itemId==='102')return {status:'rejected',sent:true,receipt:null,code:461,category:'offer-rejected'};
            if(action.kind==='list'&&rejectList){
              if(calls.filter(c=>c[0]==='list').length>2)scheduler.pauseAll();
              return {status:'rejected',sent:true,receipt:null,code:400};
            }
            return {status:'confirmed',sent:true,receipt:{itemId:action.itemId,definitionId:901,coins:action.coins,
              tradeId:action.kind==='list'?`7${action.itemId}`:action.tradeId??null}};
          },
          readSales:async()=>[], reconcile:async()=>({status:'unknown'}), verifySession:async()=>({ready:true})
        };
        const provider=api.createMarketTaskProvider({native,context,assertCurrent(){},now:()=>time,id:()=>`a${++serial}`,loadQuotes:async()=>{throw Error('unexpected quotes');}});
        const scheduler=api.createMarketTaskScheduler({taskStore:store,coordinator,provider,enabled:true,now:()=>time,
          id:()=>`r${++serial}`,random:()=>0,wait:async ms=>{time+=ms;},onStatus:s=>{
            const count=s.evidence[0]?.counts;
            if(!paused&&(afterBuy==='hold'?count?.[0]===2&&calls.filter(c=>c[0]==='move').length===2:count?.[1]===2)){
              paused=true;scheduler.pauseAll();
            }
          }});
        await scheduler.run({approved:true,snapshot,taskIds:['batch']});
        results.push({afterBuy,rejectList,calls,state:scheduler.inspect().tasks[0],phases:(await coordinator.inspect()).ledger.holdings.map(h=>h.phase)});
      }
      return results;
    });
    for (const batch of batches) {
      assert.deepEqual(batch.calls.slice(0,4),[['search',null],['buy','101'],['buy','102'],['buy','103']]);
      assert.equal(batch.calls.filter(c=>c[0]==='search').length,1);
      if(batch.rejectList){
        assert.deepEqual(batch.phases,['transfer','held']);
        assert.equal(batch.calls.filter(c=>c[0]==='list').length,1);
        assert.equal(batch.state.state,'paused');assert.equal(batch.state.reason,'MARKET_LIST_REJECTED');
      }else{
        assert.deepEqual(batch.phases,Array(2).fill(batch.afterBuy==='list'?'listed':'transfer'));
        assert.equal(batch.calls.filter(c=>c[0]==='list').length,batch.afterBuy==='list'?2:0);
      }
    }
    assert.equal(requests, 0); assert.deepEqual(errors, []);
    console.log('Market provider Chrome passed: real provider/scheduler/Web Locks with simulated native port, fixed buy and selected Club sale, bounded batch buys before moves/listings, explicit rejection continuation, hold-only, exact receipts, no requests.');
  } finally { await page.close(); }
}
