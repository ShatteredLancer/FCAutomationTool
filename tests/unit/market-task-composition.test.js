import { it, expect, vi } from 'vitest';
import { marketNativeRuntime } from '../helpers/market-native-runtime.js';
import { createFc27MarketTaskExecution } from '../../src/adapters/browser/fc27-market-task-execution.js';
import { createFc27MarketTaskNative } from '../../src/adapters/browser/fc27-market-task-native.js';
import { createTradingTaskStore } from '../../src/adapters/browser/fc27-trading-task-store.js';
import { createMarketCoordinator } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { defaultTradingTaskSettings } from '../../src/trading/task-model.js';
import { createFc27MarketTraffic } from '../../src/adapters/browser/fc27-market-traffic.js';
import { registerFc27MarketTraffic } from '../../src/adapters/ea/fc27-market-traffic.js';
import listingIncident from '../fixtures/trading-list-rejection-20261116.json';

async function fixture(mode = 'sell', shared = false, rating = 84) {
  const f = marketNativeRuntime(), data = new Map(), context = { scope: traditionalJournalScope(readFc27Context(f.root)), season: '27', platform: 'pc' };
  const get = async (key, fallback) => structuredClone(data.get(key) ?? fallback), set = async (key, value) => {
    await f.hooks.persist?.(key, value); data.set(key, structuredClone(value));
  };
  const locks = { request: async (name, _options, callback) => callback({ name, mode: 'exclusive' }) };
  let taskSequence=0;
  const store = createTradingTaskStore({ context: () => context, get, set, locks, now: f.now, id: () => taskSequence++===0?'sell':`task${taskSequence}` });
  const coordinator = createMarketCoordinator({ context: () => context, get, set, locks });
  const traffic=createFc27MarketTraffic({context:()=>context,get,set,locks,readSettings:async()=>(await store.read()).store.settings,now:f.now,sleep:f.sleep});
  if(shared)registerFc27MarketTraffic(f.root,traffic);
  f.makeCard(201, 901, 'transfer');
  const snapshot = await store.saveTask({ ...await store.read(), input: { name: 'Synthetic sale', mode,
    settings: { ...defaultTradingTaskSettings(), buyRule: 'fixed', buyValue: 800, sellRule: 'fixed', sellValue: 700,
      ratingMin: rating, ratingMax: rating, quality: 'gold', league: 10, perVersion: 1 }, players: [], excluded: [],
    owned: [{ itemId: '201', definitionId: 901, name: 'Synthetic', pile: 'transfer' }] } });
  const gmRequest = vi.fn(() => { throw Error('unexpected public request'); });
  const createNative = vi.fn(options => createFc27MarketTaskNative({ ...options, ...f }));
  const diagnosticLog = { record: vi.fn() };
  const runtime = createFc27MarketTaskExecution({ root: f.root, get, set, taskStore: store, coordinator, gmRequest, diagnosticLog,
    readCatalog: () => [{ definitionId: 901, playerId: 901, name: 'Known public', rating, rarity: 0, leagueId: 10 }],
    transport: {}, liveEnabled: true, now: f.now, createNative });
  return { ...f, data, store, coordinator, snapshot, runtime, gmRequest, createNative,traffic, diagnosticLog };
}
async function batchFixture(afterBuy = 'list', settings = {}) {
  const f = await fixture('filter', true);
  const task = f.snapshot.store.tasks[0];
  const { name, mode, players, owned, excluded } = task;
  let snapshot = await f.store.saveTask({ ...f.snapshot, id: task.id, input: { name, mode, players, owned, excluded,
    settings: { ...task.settings, afterBuy, perVersion: 3, ...settings } } });
  snapshot = await f.store.saveSettings({ ...snapshot, settings: { ...snapshot.store.settings, perSearch: 3 } });
  f.makeCard(103, 901, 'market', 700); f.makeCard(101, 901, 'market', 500); f.makeCard(102, 901, 'market', 600);
  let ticks = 0, overflow = null;
  f.runtime.subscribe(s => {
    // Presentation exceptions are intentionally isolated by the runtime. End a
    // broken synthetic loop explicitly so the workflow assertions can fail.
    if (++ticks === 2001) { overflow = { tasks:s.tasks, calls:f.calls.slice(-15) }; f.runtime.pauseAll(); }
    const active = s.tasks.filter(t => ['queued','waiting','running'].includes(t.state));
    // Do not make a sleeping task ready while another task still has a turn.
    const at = active.length && active.every(t => t.state === 'waiting')
      ? Math.min(...active.map(t => t.nextAt)) : null;
    if (at > f.now()) f.advance(at - f.now());
  });
  return { ...f, snapshot, overflow: () => overflow };
}
it('pauses an initial 400 listing rejection once, retaining the holding for an explicit retry', async () => {
  const f = await fixture('sell',true); let sends=0;
  const event=listingIncident.events[0];
  f.hooks.list=()=>{
    // Prevent the broken implementation from looping forever in the red control.
    if(++sends===3)f.runtime.pauseAll();
    return {success:false,status:event.httpStatus,error:{code:event.errorCode}};
  };
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  expect(sends).toBe(1);
  expect(f.runtime.inspect().tasks[0]).toMatchObject({state:'paused',reason:'MARKET_LIST_REJECTED'});
  let ledger=(await f.coordinator.inspect()).ledger;
  expect(ledger.holdings[0]).toMatchObject({phase:'transfer',cost:null});
  expect(ledger.intents.map(i=>i.phase)).toEqual(['rejected']);
  await f.runtime.recover(); expect(sends).toBe(1);
  f.hooks.list=null; let stopped=false;
  f.runtime.subscribe(s=>{if(!stopped&&s.evidence?.some(e=>e.counts[1]===1)){stopped=true;f.runtime.pauseAll();}});
  await f.runtime.run({approved:true,snapshot:await f.store.read(),taskIds:['sell']});
  ledger=(await f.coordinator.inspect()).ledger;
  expect(ledger.intents.map(i=>i.phase)).toEqual(['rejected','confirmed']);
  expect(f.calls.filter(c=>c[0]==='bid')).toEqual([]);
  expect(f.calls.filter(c=>c[0]==='list').at(-1)).toEqual(['list',201,650,700,3600]);
});
it('keeps a 512 listing unresolved and blocks clearing the global pause without a receipt',async()=>{
  const f=await fixture('sell',true);
  const response=listingIncident.events[2];f.hooks.list=()=>({success:false,status:response.httpStatus,error:{code:response.errorCode}});
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);
  expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
  for(let check=0;check<listingIncident.followupRecovery.count;check++)await f.runtime.recover();
  await expect(f.runtime.acknowledgeStop({approved:true})).rejects.toThrow('MARKET_RECOVERY_REQUIRED');
  expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);
  expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
});
it.each([false,true])('resolves an old pending listing from fresh unlisted evidence without inventing a receipt (auction %s)',async hasAuction=>{
  const f=await fixture('sell',true);
  f.hooks.list=()=>({success:false,status:512,error:{code:512}});
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  const before=(await f.coordinator.inspect()).ledger;
  f.advance(120000);
  f.transfer[0].auction={tradeState:'inactive',currentBid:0,isSold:()=>false,isActiveTrade:()=>false,
    ...(hasAuction?{tradeId:19201}: {tradeId:0})};
  await f.runtime.recover();
  const after=(await f.coordinator.inspect()).ledger;
  expect(after.intents[0]).toMatchObject({phase:'resolved',receipt:null,resolution:{kind:'unlisted'}});
  expect(after.intents[0].listing).toEqual(before.intents[0].listing);
  expect(after.holdings).toEqual(before.holdings);
  expect(after.stopped).not.toBeNull();
  expect(f.calls.filter(c=>c[0]==='list')).toHaveLength(1);
  await f.runtime.acknowledgeStop({approved:true});
  expect((await f.coordinator.inspect()).ledger.stopped).toBeNull();
  expect((await f.traffic.inspect()).ledger.stopped).toBeNull();
  await f.runtime.recover();
  expect(f.calls.filter(c=>['list','bid','move'].includes(c[0]))).toHaveLength(1);
});
it.each(['cancel','save-failed','401'])('retains the pending listing and shared pause when recovery is %s',async fault=>{
  const f=await fixture('sell',true);
  f.hooks.list=()=>({success:false,status:512});
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  f.advance(120000);
  f.transfer[0].auction={tradeId:19201,tradeState:'inactive',currentBid:0,isSold:()=>false,isActiveTrade:()=>false};
  if(fault==='cancel')f.hooks.auctions=()=>f.runtime.pauseAll();
  if(fault==='save-failed')f.hooks.persist=(_k,v)=>{if(v.ledger?.intents.some(i=>i.phase==='resolved'))throw Error('storage unavailable');};
  if(fault==='401')f.hooks.readStatus=401;
  if(fault==='401')await f.runtime.recover();
  else await expect(f.runtime.recover()).rejects.toThrow();
  expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
  await expect(f.runtime.acknowledgeStop({approved:true})).rejects.toThrow('MARKET_RECOVERY_REQUIRED');
  expect((await f.traffic.inspect()).ledger.stopped).not.toBeNull();
  expect(f.calls.filter(c=>['list','move','bid'].includes(c[0]))).toHaveLength(1);
  expect(f.diagnosticLog.record.mock.calls.map(c=>c[0])).toContainEqual(expect.objectContaining({phase:'resume-check',reason:'MARKET_RECOVERY_REQUIRED'}));
});
it('pauses only the rejected listing task while another explicitly started task can finish',async()=>{
 const f=await fixture('sell',true);f.makeCard(202,902,'transfer');
 const settings=f.snapshot.store.tasks[0].settings;
 const snapshot=await f.store.saveTask({...f.snapshot,input:{name:'Other sale',mode:'sell',settings,players:[],excluded:[],
   owned:[{itemId:'202',definitionId:902,name:'Other',pile:'transfer'}]}});
 let calls=0;f.hooks.list=card=>{
   if(++calls>3)f.runtime.pauseAll();
   if(card.id===201)return {success:false,status:400};
   card.auction={tradeId:19202,tradeState:'active',startingBid:650,buyNowPrice:700,currentBid:0};
   return {success:true,status:200};
 };
 let stopped=false;
 f.runtime.subscribe(s=>{if(!stopped&&s.evidence?.some(e=>e.counts[1]===1)){stopped=true;f.runtime.pauseAll();}});
 await f.runtime.run({approved:true,snapshot,taskIds:['sell','task2']});
 expect(f.calls.filter(c=>c[0]==='list').map(c=>c[1])).toEqual([201,202]);
 expect((await f.coordinator.inspect()).ledger.holdings.map(h=>h.phase)).toEqual(['transfer','listed']);
});
it.each(['list', 'hold'])('finishes the search purchase batch before moving or listing (%s)', async afterBuy => {
  const f = await batchFixture(afterBuy); let stopped = false;
  f.hooks.persist = (_key, value) => {
    if (!stopped && value.ledger?.holdings.filter(h => h.phase === (afterBuy === 'list' ? 'listed' : 'transfer')).length === 3) {
      stopped = true; f.runtime.pauseAll();
    }
  };
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  const operations = f.calls.filter(c => ['search','bid','move','list'].includes(c[0]));
  expect(operations.slice(0,4)).toEqual([['search',901,800],['bid',101,500],['bid',102,600],['bid',103,700]]);
  expect(operations.filter(c => c[0] === 'search')).toHaveLength(1);
  expect(operations.filter(c => c[0] === 'move')).toHaveLength(3);
  expect(operations.filter(c => c[0] === 'list')).toHaveLength(afterBuy === 'list' ? 3 : 0);
  expect((await f.coordinator.inspect()).ledger.holdings.map(h => h.cost)).toEqual([500,600,700]);
});
it('reserves Transfer capacity before sending another batch payment', async () => {
  const f = await batchFixture('hold'); f.root.repositories.Item.getPileSize = () => 2;
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['bid','move','list'].includes(c[0])).map(c => c.slice(0,2))).toEqual([['bid',101],['move',101]]);
  expect(f.runtime.inspect().tasks[0].reason).toBe('MARKET_TRANSFER_FULL');
  expect((await f.coordinator.inspect()).ledger.holdings[0].phase).toBe('transfer');
});
it.each(['spendCap','taskCap','unassigned'])('drains confirmed batch purchases before pausing for %s', async limit => {
  const f = await batchFixture('list', limit === 'unassigned' ? {} : { [limit]: 1000 });
  if (limit === 'unassigned') f.root.MAX_NEW_ITEMS = 1;
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['bid','move','list'].includes(c[0])).map(c => c.slice(0,2))).toEqual([['bid',101],['move',101],['list',101]]);
  expect(f.runtime.inspect().tasks[0].reason).toBe(limit === 'spendCap' ? 'MARKET_SPEND_CAP' : limit === 'taskCap' ? 'MARKET_HOLDING_CAP' : 'MARKET_FUNDS_OR_CAPACITY');
  expect((await f.coordinator.inspect()).ledger.intents.every(i => i.phase === 'confirmed')).toBe(true);
});
it('continues the remaining batch after an explicit lost auction without rebidding or replacing it', async () => {
  const f = await batchFixture('hold'); let failed = false, stopped = false;
  f.hooks.persist = (_key, value) => {
    if (!failed && value.ledger?.holdings.length === 1) {
      failed = true; f.hooks.bid = () => { f.hooks.bid = null; return { success: false, status: 403, error: { code: 461 } }; };
    }
    if (!stopped && value.ledger?.holdings.filter(h => h.phase === 'transfer').length === 2) { stopped = true; f.runtime.pauseAll(); }
  };
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['search','bid','move'].includes(c[0])).map(c => c.slice(0,2))).toEqual([
    ['search',901],['bid',101],['bid',102],['bid',103],['move',101],['move',103]]);
  const ledger = (await f.coordinator.inspect()).ledger;
  expect(ledger.intents.filter(i => i.kind === 'buy').map(i => i.phase)).toEqual(['confirmed','rejected','confirmed']);
});
it.each(['unknown','authentication','denied','throttle'])('does not drain or continue when the second batch purchase is %s', async failure => {
  const f = await batchFixture(); let armed = false;
  f.hooks.persist = (_key, value) => {
    if (!armed && value.ledger?.holdings.length === 1) {
      armed = true; f.hooks.bid = () => failure === 'unknown' ? { success: false, status: 500, data: { itemIds: [102] } }
        : { success: false, status: { authentication:401, denied:403, throttle:429 }[failure] };
    }
  };
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['bid','move','list'].includes(c[0])).map(c => c.slice(0,2))).toEqual([['bid',101],['bid',102]]);
  const ledger = (await f.coordinator.inspect()).ledger;
  expect(ledger.holdings[0].phase).toBe('held');
  expect(ledger.intents.filter(i => i.kind === 'buy')[1].phase).toBe(failure === 'unknown' ? 'pending' : 'rejected');
});
it('pauses between batch buys and resumes by moving existing holdings before a new search', async () => {
  const f = await batchFixture('hold'); let paused = false, finished = false;
  f.hooks.persist = (_key, value) => {
    if (!paused && value.ledger?.holdings.length === 1) { paused = true; f.runtime.pauseAll(); }
  };
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['bid','move','list'].includes(c[0])).map(c => c[0])).toEqual(['bid']);
  const before = f.calls.length;
  f.hooks.persist = (_key, value) => {
    if (!finished && value.ledger?.holdings.filter(h => h.phase === 'transfer').length === 3) { finished = true; f.runtime.pauseAll(); }
  };
  await f.runtime.run({ approved: true, snapshot: await f.store.read(), taskIds: ['sell'] });
  expect(f.calls.slice(before).filter(c => ['search','bid','move','list'].includes(c[0]))[0]).toEqual(['move',101,5]);
  expect(f.calls.filter(c => c[0] === 'bid').map(c => c[1])).toEqual([101,102,103]);
});
it.each(['version','expired'])('finishes confirmed cards when remaining batch candidates hit %s', async limit => {
  const f = await batchFixture('hold', limit === 'version' ? {perVersion:1} : {}); let changed = false, stopped = false;
  f.hooks.persist = (_key, value) => {
    if (!changed && value.ledger?.holdings.length === 1) { changed = true; if (limit === 'expired') f.advance(301000); }
    if (!stopped && value.ledger?.holdings[0]?.phase === 'transfer') { stopped = true; f.runtime.pauseAll(); }
  };
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['bid','move','list'].includes(c[0])).map(c => c.slice(0,2))).toEqual([['bid',101],['move',101]]);
});
it('gives another task turns during a search batch without mixing holdings or exceeding shared capacity', async () => {
  const f = await batchFixture('hold'); f.makeCard(104,902); f.root.repositories.Item.getPileSize = () => 5;
  const settings = f.snapshot.store.tasks[0].settings;
  const snapshot = await f.store.saveTask({ ...f.snapshot, input: { name:'Other',mode:'fixed',settings,
    players:[{definitionId:902,name:'Other card',rating:84,cap:null,qty:1}],owned:[],excluded:[] } });
  let stopped = false;
  f.hooks.persist = (_key,value) => {
    if (!stopped && value.ledger?.holdings.filter(h=>h.phase==='transfer').length===4) { stopped=true; f.runtime.pauseAll(); }
  };
  await f.runtime.run({approved:true,snapshot,taskIds:['sell','task2']});
  expect(f.overflow()).toBeNull();
  const writes=f.calls.filter(c=>['bid','move','list'].includes(c[0]));
  expect(writes.filter(c=>c[0]==='bid').map(c=>c[1]).sort()).toEqual([101,102,103,104]);
  expect(writes.findIndex(c=>c[0]==='bid'&&c[1]===104)).toBeLessThan(writes.findIndex(c=>c[0]==='move'&&c[1]===103));
  expect(writes.filter(c=>c[0]==='list')).toEqual([]);
  const ledger=(await f.coordinator.inspect()).ledger;
  expect(ledger.holdings.filter(h=>h.taskId==='sell').map(h=>h.itemId)).toEqual(['101','102','103']);
  expect(ledger.holdings.filter(h=>h.taskId==='task2').map(h=>h.itemId)).toEqual(['104']);
});
it.each([false,true])('holds a native purchase on Transfer List, then lists that same item after editing (shared=%s)',async shared=>{
 const f=await fixture('filter',shared);f.makeCard(101,901);
 const {name,mode,settings,players,owned,excluded}=f.snapshot.store.tasks[0];
 let snapshot=await f.store.saveTask({...f.snapshot,id:'sell',input:{name,mode,players,owned,excluded,
   settings:{...settings,afterBuy:'hold'},ratingPrices:{84:{buy:800,sell:null}}}});
 let stopped=false;
 f.hooks.persist=(_key,value)=>{if(!stopped&&value.ledger?.holdings.some(h=>h.itemId==='101'&&h.phase==='transfer')){stopped=true;f.runtime.pauseAll();}};
 await f.runtime.run({approved:true,snapshot,taskIds:['sell']});
 expect(f.calls.filter(c=>['bid','move','list'].includes(c[0])).map(c=>c[0])).toEqual(['bid','move']);
 expect((await f.coordinator.inspect()).ledger.holdings).toMatchObject([{itemId:'101',phase:'transfer',cost:600}]);
 f.hooks.persist=()=>{};
 snapshot=await f.store.saveTask({...await f.store.read(),id:'sell',input:{name,mode,players,owned,excluded,
   settings:{...settings,afterBuy:'list'},ratingPrices:{84:{buy:800,sell:1400}}}});
 let listed=false;f.runtime.subscribe(s=>{if(!listed&&s.evidence?.some(e=>e.counts[1]===1)){listed=true;f.runtime.pauseAll();}});
 await f.runtime.run({approved:true,snapshot,taskIds:['sell']});
 expect(f.calls.filter(c=>['bid','move','list'].includes(c[0])).map(c=>c[0])).toEqual(['bid','move','list']);
 expect(f.calls.filter(c=>c[0]==='list')[0]).toEqual(['list',101,1300,1400,3600]);
 expect(f.gmRequest).not.toHaveBeenCalled();
});
it.each(['full','budget'])('stops immediate hold-only buying at %s without listing or another payment',async limit=>{
 const f=await fixture('filter');f.makeCard(101,901);f.makeCard(102,901);
 if(limit==='full')f.root.repositories.Item.getPileSize=()=>2;
 const {name,mode,settings,players,owned,excluded}=f.snapshot.store.tasks[0];
 const snapshot=await f.store.saveTask({...f.snapshot,id:'sell',input:{name,mode,players,owned,excluded,
   settings:{...settings,afterBuy:'hold',perVersion:null,spendCap:limit==='budget'?600:null}}});
 await f.runtime.run({approved:true,snapshot,taskIds:['sell']});
 expect(f.calls.filter(c=>['bid','move','list'].includes(c[0])).map(c=>c[0])).toEqual(['bid','move']);
 expect(f.runtime.inspect().tasks[0]).toMatchObject({state:'paused',reason:limit==='full'?'MARKET_TRANSFER_FULL':'MARKET_SPEND_CAP'});
 expect((await f.coordinator.inspect()).ledger.holdings[0]).toMatchObject({phase:'transfer',cost:600});
});
it.each([false,true])('buys the first search hit in the same turn with no intervening inventory read or pacing (shared=%s)', async shared => {
  const f=await fixture('filter',shared); const card=f.makeCard(101,901);
  let hitAt,hitIndex,dispatchAt,between,stopped=false;
  f.hooks.search=()=>{hitAt=f.now();hitIndex=f.calls.length;return {success:true,status:200,data:{items:[card]}};};
  f.hooks.bid=()=>{dispatchAt=f.now();between=f.calls.slice(hitIndex,-1);return {success:false,status:403};};
  f.runtime.subscribe(s=>{if(!stopped&&s.tasks[0]?.state==='paused'){stopped=true;}});
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(1);
  expect(between).toEqual([]);expect(dispatchAt-hitAt).toBe(0);
  expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('rejected');
});
it.each(['stop','dirty','inventory','expired','storage-failure'])('blocks a hit changed at the durable buy intent: %s', async change => {
  const f=await fixture('filter',true);f.makeCard(101,901);let changed=false,stopped=false;
  f.hooks.persist=(_key,value)=>{
    if(changed||!value.ledger?.intents?.some(i=>i.kind==='buy'&&i.phase==='pending'))return;
    changed=true;
    if(change==='stop')f.runtime.pauseAll();
    if(change==='dirty')f.root.repositories.Item.setDirty(6);
    if(change==='inventory')f.makeCard(301,902,'unassigned');
    if(change==='expired')f.advance(16000);
    if(change==='storage-failure')throw Error('synthetic persistence failure');
  };
  f.runtime.subscribe(s=>{
    if(changed&&!stopped&&s.phase==='prepare'){stopped=true;f.runtime.pauseAll();}
  });
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  expect(changed).toBe(true);expect(f.calls.filter(c=>c[0]==='bid')).toEqual([]);
  const intents=(await f.coordinator.inspect()).ledger.intents;
  if(change!=='storage-failure')expect(intents.map(i=>i.phase)).toEqual(['rejected']);
});
it('does not let a search hit bypass a preceding shared write cooldown',async()=>{
  const f=await fixture('filter',true);f.makeCard(101,901);let armed=false,stopped=false;
  f.hooks.persist=async(key,value)=>{
    if(!armed&&key.endsWith(':traffic')&&value.writes.buy===0&&value.ledger.searches.some(s=>s.status==='sent')){
      armed=true;value.nextWriteAt=f.now()+3000;
    }
  };
  f.runtime.subscribe(s=>{if(!stopped&&s.tasks.some(t=>t.reason==='MARKET_TRAFFIC_WAIT')){stopped=true;f.runtime.pauseAll();}});
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  expect(armed).toBe(true);expect(f.calls.some(c=>c[0]==='bid')).toBe(false);
});
it('finishes each first hit before switching tasks and preserves per-task holdings',async()=>{
  const f=await fixture('filter',true);f.makeCard(101,901);f.makeCard(102,902);
  const settings=f.snapshot.store.tasks[0].settings;
  const snapshot=await f.store.saveTask({...await f.store.read(),input:{name:'Second',mode:'fixed',settings,
    players:[{definitionId:902,name:'B',rating:84,cap:null,qty:1}],owned:[],excluded:[]}});
  let stopped=false;
  f.runtime.subscribe(s=>{
    if(!stopped&&s.evidence?.reduce((sum,e)=>sum+e.counts[0],0)===2){stopped=true;f.runtime.pauseAll();}
    const at=s.tasks.find(t=>t.state==='waiting'&&t.nextAt>f.now())?.nextAt;if(at)f.advance(at-f.now());
  });
  await f.runtime.run({approved:true,snapshot,taskIds:['sell','task2']});
  expect(f.calls.filter(c=>['search','bid'].includes(c[0])).map(c=>c.slice(0,2))).toEqual([
    ['search',901],['bid',101],['search',902],['bid',102]]);
  expect((await f.coordinator.inspect()).ledger.holdings.map(h=>[h.taskId,h.itemId])).toEqual([['sell','101'],['task2','102']]);
});
it('preserves an ambiguous buy receipt and never retries the same offer',async()=>{
  const f=await fixture('filter',true);f.makeCard(101,901);
  f.hooks.bid=()=>({success:false,status:403,error:{code:461},data:{itemIds:[101]}});
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
  await f.runtime.recover();
  expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(1);
  expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('pending');
});
it.each([false,true])('composes production protections/store/provider/native through selected Transfer sale (common gate=%s)', async shared => {
  const f = await fixture('sell',shared); expect(f.createNative).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  f.runtime.subscribe(s => { if (s.evidence?.some(e => e.counts[1] === 1) && s.tasks.some(t => ['queued', 'running'].includes(t.state))) f.runtime.pauseAll(); });
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  const ledger = (await f.coordinator.inspect()).ledger;
  expect(ledger.holdings).toMatchObject([{ itemId: '201', phase: 'listed', cost: null }]);
  expect(f.calls.filter(c => ['bid', 'move', 'list'].includes(c[0]))).toEqual([['list', 201, 650, 700, 3600]]);
  await f.runtime.recover(); expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(1);
  expect(f.gmRequest).not.toHaveBeenCalled();
  if(shared)expect((await f.traffic.inspect()).writes.list).toBe(1);
});
it.each([false,true])('runs filter through the production composition and exact native rules (common gate=%s)', async shared => {
  const f = await fixture('filter',shared); f.makeCard(101, 901);
  expect(f.runtime.inspect().modes).toContain('filter');
  let stopped = false;
  f.runtime.subscribe(s => { if (!stopped && s.evidence?.some(e => e.counts[0] === 1)) { stopped = true; f.runtime.pauseAll(); } });
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => c[0] === 'bid')).toEqual([['bid', 101, 600]]);
  expect(f.calls.filter(c => ['move','list'].includes(c[0]))).toEqual([]);
  expect((await f.coordinator.inspect()).ledger.holdings[0]).toMatchObject({ definitionId: 901, cost: 600, phase: 'held' });
  expect(f.runtime.inspect().tasks[0].candidateScope).toMatchObject({ known: 1, matched: 1, complete: false });
  expect(f.gmRequest).not.toHaveBeenCalled();
  if(shared)expect((await f.traffic.inspect()).gate.hour).toBe(1);
});

it('retains distinct HTTP and EA rejection codes and buys a new offer without rebidding the lost auction', async () => {
  const f = await fixture('filter', true); f.makeCard(101, 901);
  const next = f.makeCard(102, 901); let searches = 0;
  f.hooks.search = () => ({success:true,status:200,data:{items:++searches === 1 ? [f.market[0]] : [next]}});
  f.root.UtasErrorCode = { PERMISSION_DENIED: 461 };
  f.hooks.bid = () => { f.hooks.bid = null; f.advance(20000); return { success: false, status: 403, error: { code: 461, message: 'private-server-detail' }, data: { itemIds: [] } }; };
  let finished=false;
  f.runtime.subscribe(s => {
    if (!finished && s.evidence?.some(e => e.counts[0] === 1)) { finished=true; f.runtime.pauseAll(); }
    const at=s.tasks.find(t=>t.state==='waiting'&&t.nextAt>f.now())?.nextAt; if(at)f.advance(at-f.now());
  });
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  const events = f.diagnosticLog.record.mock.calls.map(([event]) => event).filter(e => e.event === 'task-native');
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'buy', transportPhase: 'before-dispatch', definitionId: 901, actualPrice: 600 }),
    expect.objectContaining({ phase: 'buy', transportPhase: 'native-response', httpStatus: 403, errorCode: 461,
      definitionId: 901, actualPrice: 600, localReason: 'FC27_MARKET_PERMISSION_DENIED' }),
  ]));
  expect(JSON.stringify(events)).not.toMatch(/private-server-detail|itemId|tradeId/);
  expect(f.calls.filter(c => c[0] === 'bid')).toEqual([['bid', 101, 600], ['bid', 102, 600]]);
  expect(f.calls.some(c => ['move', 'list'].includes(c[0]))).toBe(false);
  const ledger = (await f.coordinator.inspect()).ledger;
  expect(ledger.stopped).toBeNull(); expect(ledger.intents.map(i=>i.phase)).toEqual(['rejected','confirmed']);
  expect((await f.traffic.inspect()).ledger.stopped).toBeNull();
});
it.each([undefined,403,999])('pauses an unexplained 403/%s without calling it throttling', async code => {
  const f=await fixture('filter',true);f.makeCard(101,901);
  f.hooks.bid=()=>({success:false,status:403,error:{code}});
  await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
  expect(f.runtime.inspect().tasks[0].reason).toBe('MARKET_PURCHASE_DENIED');
  expect(f.runtime.inspect().traffic.ledger.stopped).toBe('manual');
  expect((await f.traffic.inspect()).ledger.stopped).toBe('manual');
  expect((await f.coordinator.inspect()).ledger.intents[0].phase).toBe('rejected');
  expect(f.calls.filter(c=>c[0]==='bid')).toHaveLength(1);
});
it.each([false,true])('renews an unlimited task lease after native pacing crosses sixty seconds (common gate=%s)', async shared => {
  const f = await fixture('filter', shared); f.makeCard(101, 901);
  let delayed = false, stopped = false;
  f.hooks.sleep = () => { if (!delayed) { delayed = true; f.advance(61000); } };
  f.runtime.subscribe(s => { if (!stopped && s.evidence?.some(e => e.counts[0] === 1)) { stopped = true; f.runtime.pauseAll(); } });
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => c[0] === 'bid')).toEqual([['bid', 101, 600]]);
  expect(f.runtime.inspect().tasks[0].reason).not.toBe('MARKET_TIME_LIMIT');
  expect((await f.coordinator.inspect()).ledger.intents.filter(i => i.kind === 'buy')).toHaveLength(1);
});
it('keeps polling empty 88-rating searches at the approved 11250 ceiling across lease renewals', async () => {
  const f = await fixture('filter', true, 88), original = f.snapshot.store.tasks[0], start = f.now();
  const { name, mode, settings, players, owned, excluded } = original;
  const snapshot = await f.store.saveTask({ ...f.snapshot, id: 'sell', input: { name, mode, settings, players, owned, excluded,
    ratingPrices: { 88: { buy: 11250, sell: 14000 } } } });
  let last = null, count = 0;
  f.hooks.sleep = () => f.advance(21000);
  f.runtime.subscribe(s => {
    if (s.lastSearch?.confirmed && s.lastSearch.at !== last) {
      last = s.lastSearch.at; count++;
      if (count === 8) f.runtime.pauseAll(); else f.advance(20000);
    }
  });
  await f.runtime.run({ approved: true, snapshot, taskIds: ['sell'] });
  expect(f.now() - start).toBeGreaterThan(300000);
  expect(f.calls.filter(c => c[0] === 'search')).toEqual(Array.from({ length: 8 }, () => ['search', 901, 11250]));
  expect(f.calls.filter(c => ['bid','move','list'].includes(c[0]))).toEqual([]);
  expect(f.runtime.inspect()).toMatchObject({ lastSearch: { responseCount: 0, acceptedCount: 0, searchCeiling: 11250, confirmed: true } });
  expect(f.runtime.inspect().tasks[0].reason).toBe('MARKET_USER_STOP');
  const searches = f.diagnosticLog.record.mock.calls.map(c => c[0]).filter(e => e.phase === 'search');
  expect(searches).toHaveLength(8);
  expect(searches.every(e => e.definitionId === 901 && e.rating === 88 && e.searchCeiling === 11250 && e.responseCount === 0 && e.acceptedCount === 0)).toBe(true);
  expect((await f.traffic.inspect()).gate.hour).toBe(8);
  expect(f.gmRequest).not.toHaveBeenCalled();
});
it.each([['limit',false], ['limit',true], ['stop',false], ['stop',true]])('still blocks the actual send when %s intervenes during lease renewal (common gate=%s)', async (kind, shared) => {
  const f = await fixture('filter', shared), original = f.snapshot.store.tasks[0], start = f.now();
  const { name, mode, players, owned, excluded } = original;
  const snapshot = kind === 'limit' ? await f.store.saveTask({ ...f.snapshot, id: 'sell', input: {
    name, mode, players, owned, excluded, settings: { ...original.settings, runMinutes: 1 }
  } }) : f.snapshot;
  let delayed = false, stopped = false;
  f.hooks.sleep = () => { if (!delayed) { delayed = true; f.advance(61000); } };
  f.hooks.persist = (_key, value) => {
    if (kind === 'stop' && !stopped && value.ledger?.clocks?.some(c => c.lease?.at > start)) {
      stopped = true; f.runtime.pauseAll();
    }
  };
  await f.runtime.run({ approved: true, snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['search','bid','move','list'].includes(c[0]))).toEqual([]);
  expect(f.runtime.inspect().tasks[0].reason).toBe(kind === 'limit' ? 'MARKET_TIME_LIMIT' : 'MARKET_USER_STOP');
  if (shared) expect((await f.traffic.inspect()).gate.hour).toBe(0);
});
it('a production preflight 401 propagates to other FCAT modules without sending a payment',async()=>{
 const f=await fixture('filter',true);f.hooks.readStatus=401;
 await f.runtime.run({approved:true,snapshot:f.snapshot,taskIds:['sell']});
 expect((await f.traffic.inspect()).ledger.stopped).toBe('authentication');
 const send=vi.fn();await expect(f.traffic.run('buy',()=>{},send)).rejects.toThrow('STOPPED');expect(send).not.toHaveBeenCalled();
 expect(f.calls.filter(c=>['bid','move','list'].includes(c[0]))).toEqual([]);
});
it.each([false,true])('executes rating-specific fixed buy/list rules or blocks native rating drift (drift=%s)',async drift=>{
 const f=await fixture('filter'),card=f.makeCard(101,901);
 if(drift)card._rating=85;
 const {name,mode,settings,players,owned,excluded}=f.snapshot.store.tasks[0];
 const snapshot=await f.store.saveTask({...f.snapshot,id:'sell',input:{name,mode,settings:{...settings,ratingMax:85,buyRule:'percent',buyValue:85,sellRule:'reference',sellValue:100},players,owned,excluded,
 ratingPrices:{84:{buy:800,sell:1400},85:{buy:900,sell:1600}}}});
 let stopped=false;f.runtime.subscribe(s=>{if(!stopped&&s.evidence?.some(e=>e.counts[1]===1)){stopped=true;f.runtime.pauseAll();}});
 await f.runtime.run({approved:true,snapshot,taskIds:['sell']});
 const writes=f.calls.filter(c=>['bid','move','list'].includes(c[0]));
 if(drift)expect(writes).toEqual([]);
 else{expect(writes.map(c=>c[0])).toEqual(['bid','move','list']);expect(writes.at(-1)).toEqual(['list',101,1300,1400,3600]);}
 expect(f.gmRequest).not.toHaveBeenCalled();
});
it.each([false,true])('carries scheduled purchase and sale through production native composition (common gate=%s)', async shared => {
  const f=await fixture('filter',shared);f.makeCard(101,901);
  const {name,mode,settings,players,owned,excluded}=f.snapshot.store.tasks[0];
  const snapshot=await f.store.saveTask({...f.snapshot,id:'sell',input:{name,mode,settings,players,owned,excluded,
    schedule:{repeat:'once',zone:'UTC',start:'1970-01-01T00:00',end:null,sell:null}}});
  let stopped=false;
  f.runtime.subscribe(s=>{if(!stopped&&s.evidence?.some(e=>e.counts[1]===1)){stopped=true;f.runtime.pauseAll();}});
  await f.runtime.run({approved:true,snapshot,taskIds:['sell']});
  expect(f.calls.filter(c=>['bid','move','list'].includes(c[0])).map(c=>c[0])).toEqual(['bid','move','list']);
  expect((await f.coordinator.inspect()).ledger.holdings).toMatchObject([{phase:'listed',sellAt:0,cost:600}]);
});
it.each(['rating','league','rarity'])('rejects native %s changes between the frozen filter catalog and actual payment', async field => {
  const f = await fixture('filter'), card = f.makeCard(101, 901);
  if (field === 'rating') card._rating = 85;
  if (field === 'league') card.leagueId = 13;
  if (field === 'rarity') card._rareflag = 3;
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.some(c => c[0] === 'bid')).toBe(false);
  expect((await f.coordinator.inspect()).ledger.intents).toMatchObject([{ kind: 'buy', phase: 'rejected' }]);
  expect((await f.coordinator.inspect()).ledger.holdings).toEqual([]);
});
it('blocks protected selected cards in the actual production composition without dispatch or deleting the task', async () => {
  const f = await fixture(); f.root.info.lock.push(201);
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['bid', 'move', 'list'].includes(c[0]))).toEqual([]);
  expect(f.runtime.inspect().reason).toBe('MARKET_HOLDING_PROTECTED');
  expect((await f.store.read()).store.tasks).toHaveLength(1);
  expect((await f.coordinator.inspect()).ledger.intents).toEqual([]);
});
