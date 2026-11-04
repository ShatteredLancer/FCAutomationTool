import {expect,it,vi} from 'vitest';
import {emptyDesk,deskSettings,deskFunding,deskOpportunity,deskAlerts,deskTrend,observeDeskQuote,readDesk,validDeskEvent,DESK_LIMITS} from '../../src/trading/desk-model.js';
import {createFc27TradingDesk,tradingDeskKey} from '../../src/adapters/browser/fc27-trading-desk.js';
import {readFc27TradingCandidates} from '../../src/adapters/ea/fc27-trading-candidates.js';
const time=1793764800000;
const card=()=>({definitionId:11,name:'Public player',ask:600,sell:1000,checkedAt:time,series:{futbin:[],futgg:[]},latest:{}});
const quote=(source,extra={})=>({definitionId:11,season:'27',platform:'console',source,price:1000,fetchedAt:time,expiresAt:time+300000,sourceUpdatedAt:time,error:null,...extra});
const ready=()=>{const state=emptyDesk(),row=card();state.configured=true;state.watch=[row];for(const source of ['futbin','futgg'])observeDeskQuote(row,source,quote(source),'console',time);return state;};
it('starts with a configurable 10k trial rather than a hard execution cap',()=>{
  expect(emptyDesk().settings).toMatchObject({startingCoins:40000,capitalLimit:10000,reserveCoins:30000});
  expect(deskSettings({capitalLimit:25000,reserveCoins:5000,unitLimit:5000}).capitalLimit).toBe(25000);
  expect(()=>deskSettings({reserveCoins:50000})).toThrow();expect(()=>deskSettings({capitalLimit:1.5})).toThrow();
});
it('separates manual cash, occupied cost and realized net profit without spending unsold proceeds',()=>{
  const state=emptyDesk();state.records=[{buy:2000,sell:null},{buy:1000,sell:2000}];
  expect(deskFunding(state)).toEqual({cash:38900,occupied:2000,realized:900,available:8000});
  state.settings.capitalLimit=1500;expect(deskFunding(state).available).toBe(0);
});
it('requires fresh exact-version dual quotes and manually checked native prices before alerting',()=>{
  const state=ready(),row=state.watch[0];expect(deskOpportunity(state,row,time)).toMatchObject({status:'opportunity',cap:700,profit:350});
  row.ask=800;expect(deskOpportunity(state,row,time).status).toBe('watch');row.ask=600;
  expect(deskOpportunity(state,row,time+300001).status).toBe('watch');row.checkedAt=0;expect(deskOpportunity(state,row,time).status).toBe('watch');
});
it('does not treat the preset cash example as verified funds before the user saves settings',()=>{
  const state=ready();state.configured=false;expect(deskAlerts(state,time)).toEqual([]);expect(deskOpportunity(state,state.watch[0],time).reason).toContain('资金设置');
});
it('never mixes a PC override into a console line or another version into a quote',()=>{
  const row=card();observeDeskQuote(row,'futbin',quote('futbin',{futbinPlatform:'pc'}),'console',time);
  expect(row.series.futbin).toEqual([]);expect(row.latest.futbin.error).toBe('unavailable');
  observeDeskQuote(row,'futgg',quote('futgg',{definitionId:12}),'console',time);expect(row.series.futgg).toEqual([]);
});
it('does not manufacture samples from cache hits, repeated source timestamps or future observations',()=>{
  const row=card();observeDeskQuote(row,'futgg',quote('futgg'),'console',time);
  observeDeskQuote(row,'futgg',quote('futgg'),'console',time+1000);
  observeDeskQuote(row,'futgg',quote('futgg',{fetchedAt:time+1000,expiresAt:time+301000}),'console',time+1000);
  expect(row.series.futgg).toHaveLength(1);
  observeDeskQuote(row,'futgg',quote('futgg',{sourceUpdatedAt:time+10000}),'console',time);expect(row.series.futgg).toHaveLength(1);
});
it('never replaces a newer valid observation with an older shortlist/cache snapshot',()=>{
  const row=card();observeDeskQuote(row,'futgg',quote('futgg',{price:1100,fetchedAt:time+1000,sourceUpdatedAt:time+1000,expiresAt:time+301000}),'console',time+1000);
  observeDeskQuote(row,'futgg',quote('futgg',{price:1000}),'console',time+2000);
  expect(row.latest.futgg.price).toBe(1100);expect(row.latest.futgg.at).toBe(time+1000);
});
it('bounds observations to a rolling week with separate short/older buckets',()=>{
  const row=card();for(let i=0;i<2500;i++){const now=time+i*300000;observeDeskQuote(row,'futbin',quote('futbin',{fetchedAt:now,expiresAt:now+300000,sourceUpdatedAt:null,price:1000+i}),'console',now);}
  expect(row.series.futbin.length).toBeLessThanOrEqual(DESK_LIMITS.points);expect(row.series.futbin[0].at).toBeGreaterThanOrEqual(time+2499*300000-7*86400000);
});
it('shows insufficient trend evidence rather than inventing an hourly/day/week return',()=>{
  expect(deskTrend([{at:time,price:1000}],time,3600000)).toBeNull();
  expect(deskTrend([{at:time-3600000,price:1000},{at:time,price:900}],time,3600000)).toBeCloseTo(-10);
  const state=ready();state.watch[0].series.futgg=[{at:time-3600000,price:1200},{at:time,price:1000}];
  expect(deskOpportunity(state,state.watch[0],time).reason).toContain('跌幅');
});
it('deduplicates identical opportunities for 30 minutes and does not treat X leaks as signals',()=>{
  const state=ready();expect(deskAlerts(state,time)).toHaveLength(1);expect(deskAlerts(state,time+1000)).toEqual([]);
  state.watch[0].latest.futgg={error:'unavailable',at:time};expect(deskAlerts(state,time+2000)).toEqual([]);
  expect(validDeskEvent({url:'https://x.com/FutPoliceLeaks/status/12345',status:'leak',note:'Unconfirmed',at:time})).toBe(true);
  expect(validDeskEvent({url:'https://example.com/status/12345',status:'leak',note:'',at:time})).toBe(false);
});
it('validates stored sample evidence and rejects oversized or corrupt notebooks instead of erasing them',()=>{
  const state=ready();expect(readDesk(state).watch).toHaveLength(1);
  state.watch[0].latest.futgg={price:1000,at:time,fetchedAt:time,expiresAt:time+999999999};expect(()=>readDesk(state)).toThrow();
  expect(()=>readDesk({...emptyDesk(),extra:'x'.repeat(DESK_LIMITS.bytes)})).toThrow();
});
function fixture(){
  const data=new Map([['protected-journal',{pending:true}],['fsu-locks',[1,2]]]);let account='A',n=0,queue=Promise.resolve();
  const prices={context:()=>({scope:account,season:'27',platform:'console'}),knownPlayers:()=>[],remember:vi.fn(),readSettings:async()=>({source:'futbin',readSources:'both'}),
    resolveTradingPlayer:vi.fn(async()=>({definitionId:11,name:'From link'})),load:vi.fn(async()=>({references:{11:{quotes:{futbin:quote('futbin'),futgg:quote('futgg')}}}}))};
  const service=createFc27TradingDesk({prices,get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),
    locks:{request:(_k,_options,task)=>{const run=queue.then(task);queue=run.catch(()=>{});return run;}},now:()=>time,id:()=>`manual-${++n}`});
  return {service,prices,data,switchAccount:()=>{account='B';}};
}
it('loads local data without requests, refreshes public quotes only on demand, and preserves protected stores',async()=>{
  const f=fixture();expect((await f.service.read()).state.settings.capitalLimit).toBe(10000);expect(f.prices.load).not.toHaveBeenCalled();
  await f.service.add({input:'11',name:'Example'});await f.service.refresh();
  expect(f.prices.load.mock.calls[0][1]).toMatchObject({purpose:'trading',futbinBatch:false,policy:{futbinPlatform:'ps'}});
  expect((await f.service.read()).state.watch[0].series.futgg).toHaveLength(1);
  expect(f.data.get('protected-journal')).toEqual({pending:true});expect(f.data.get('fsu-locks')).toEqual([1,2]);
});
it('serializes notebook edits, preserves manual positions across budget changes and prevents a second sale',async()=>{
  const f=fixture();await Promise.all([f.service.add({input:'11'}),f.service.add({input:'12'})]);
  expect((await f.service.read()).state.watch).toHaveLength(2);
  await f.service.recordBuy({definitionId:11,name:'Example',buy:1000});
  await f.service.settings({...DESK_DEFAULTS_FOR_TEST(),capitalLimit:5000});
  const record=(await f.service.read()).state.records[0];await f.service.recordSale({recordId:record.id,sell:2000});
  await expect(f.service.recordSale({recordId:record.id,sell:2000})).rejects.toThrow('ALREADY_CLOSED');
  expect(deskFunding((await f.service.read()).state).realized).toBe(900);
});
const DESK_DEFAULTS_FOR_TEST=()=>emptyDesk().settings;
it('isolates accounts and cancels delayed reads before any cross-account notebook write',async()=>{
  const f=fixture();await f.service.add({input:'11'});let release;
  f.prices.load.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const pending=f.service.refresh();
  while(!release)await Promise.resolve();f.switchAccount();release({references:{}});
  await expect(pending).rejects.toThrow('CONTEXT_CHANGED');expect((await f.service.read()).state.watch).toEqual([]);
  expect(f.data.get(tradingDeskKey('A')).watch[0].series.futgg).toEqual([]);
});
it('retains manual history when removing a watched card and blocks overflow without pruning',async()=>{
  const f=fixture();await f.service.add({input:'11'});await f.service.recordBuy({definitionId:11,name:'Example',buy:500});await f.service.remove(11);
  expect((await f.service.read()).state.records).toHaveLength(1);
  const saved=f.data.get(tradingDeskKey('A'));saved.watch=Array.from({length:20},(_,i)=>({...card(),definitionId:i+1}));
  f.data.set(tradingDeskKey('A'),saved);await expect(f.service.add({input:'99'})).rejects.toThrow('WATCH_LIMIT');
  expect(f.data.get(tradingDeskKey('A')).watch).toHaveLength(20);
});
it('keeps a fully populated bounded quote notebook below the independent storage budget',()=>{
  const state=emptyDesk();state.watch=Array.from({length:20},(_,i)=>({...card(),definitionId:i+1,name:'卡'.repeat(100),
    series:Object.fromEntries(['futbin','futgg'].map(source=>[source,Array.from({length:120},(_,n)=>({at:time-n*900000,price:1000,fetchedAt:time-n*900000,expiresAt:time-n*900000+300000}))]))}));
  expect(new TextEncoder().encode(JSON.stringify(readDesk(state))).length).toBeLessThan(DESK_LIMITS.bytes);
});
it('reads cached public candidate facts without exposing EA entity IDs or requesting inventory',()=>{
  const mutation=vi.fn(),raw={id:123,definitionId:11,rating:80,type:'player',name:'Example',nationId:1,leagueId:1,teamId:1,preferredPosition:12};
  const root={repositories:{Item:{club:{items:[raw]}}},services:{Item:{move:mutation,bid:mutation,list:mutation}}};
  const result=readFc27TradingCandidates(root);expect(result[0]).toMatchObject({definitionId:11,name:'Example',rating:80});
  expect(Object.hasOwn(result[0],'id')).toBe(false);expect(mutation).not.toHaveBeenCalled();expect(readFc27TradingCandidates({})).toEqual([]);
});
it('keeps trading quotes on the real PC market even if the general reference setting points at PS',async()=>{
  const f=fixture();f.prices.context=()=>({scope:'A',season:'27',platform:'pc'});
  f.prices.readSettings=async()=>({source:'futbin',readSources:'both',futbinPlatform:'ps'});
  f.prices.load.mockResolvedValue({references:{11:{quotes:{futbin:quote('futbin',{platform:'pc',futbinPlatform:'pc'}),futgg:quote('futgg',{platform:'pc'})}}}});
  await f.service.add({input:'11'});await f.service.refresh();
  expect(f.prices.load.mock.calls[0][1].policy.futbinPlatform).toBe('pc');
  expect((await f.service.read()).state.watch[0].series.futbin).toHaveLength(1);
});
it('canonicalizes shared X links and updates the same original post instead of inflating source counts',async()=>{
  const f=fixture();await f.service.event({url:'https://x.com/FutPoliceLeaks/status/12345?s=20&t=tracking',note:'leak',status:'leak'});
  await f.service.event({url:'https://x.com/FutPoliceLeaks/status/12345',note:'live',status:'live'});
  const {state}=await f.service.read();expect(state.events).toHaveLength(1);expect(state.events[0]).toMatchObject({url:'https://x.com/FutPoliceLeaks/status/12345',status:'live'});
  await expect(f.service.event({url:'https://x.com.evil.example/FutPoliceLeaks/status/12345',note:'',status:'leak'})).rejects.toThrow('EVENT_INVALID');
});
it('does not overwrite shared Puzzle/Gallery lookup metadata with a bare watched ID',async()=>{
  const f=fixture();await f.service.add({input:'11'});
  expect(f.prices.remember.mock.calls.flatMap(call=>call[0])).toEqual([]);
  f.prices.knownPlayers=()=>[{definitionId:12,name:'Full metadata',rating:80,nationId:1,leagueId:2,teamId:3,preferredPosition:12}];
  f.service.candidates();expect(f.prices.remember.mock.calls.at(-1)[0][0]).toMatchObject({definitionId:12,nationId:1,teamId:3});
});
