import {expect,it,vi} from 'vitest';
import {createFc27TradingDesk} from '../../src/adapters/browser/fc27-trading-desk.js';
import {readTradingCandidatePool,rankTradingSuggestions,evoClues} from '../../src/trading/shortlist.js';
import {emptyDesk,deskAlerts,deskExit} from '../../src/trading/desk-model.js';

const now=1793772000000;
const rows=Array.from({length:9},(_,i)=>({definitionId:100+i,futbinId:200+i,name:`Public ${i}`,rating:[80,82,84][i%3],
  price:900+i*100,closingPrice:900+i*100,referenceScore:300+i*40,fetchedAt:now,season:'27',platform:'console'}));
function fixture(intel=null){
  const data=new Map();let account='A',time=now;
  const prices={context:()=>({scope:account,season:'27',platform:'console'}),remember:vi.fn(),knownPlayers:()=>[],
    readSettings:vi.fn(async()=>({readSources:'both',source:'futbin'})),
    tradingCandidates:vi.fn(async()=>({rows,at:now,platform:'console',ratings:[80,82,84],requests:3})),
    load:vi.fn(async ids=>({references:Object.fromEntries(ids.map(id=>[id,{quotes:{futgg:{source:'futgg',season:'27',platform:'console',definitionId:id,
      price:rows.find(row=>row.definitionId===id).price,sourceUpdatedAt:now,fetchedAt:now,expiresAt:now+300000,error:null}}}]))}))};
  const service=createFc27TradingDesk({prices,intel,get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),
    locks:{request:async(_key,_options,task)=>task()},now:()=>time});
  return {prices,service,data,advance:ms=>{time+=ms;},changeAccount:()=>{account='B';}};
}
it('offers a bounded starter shortlist and concrete buy ceilings without user-supplied player IDs',async()=>{
  const f=fixture();const result=await f.service.discover();
  expect(result.suggestions.length).toBeGreaterThan(0);expect(result.suggestions.length).toBeLessThanOrEqual(6);
  expect(result.suggestions[0]).toMatchObject({status:'observe',sourceCount:2});
  expect(result.suggestions.every(row=>row.buyCeiling<row.price&&row.reason.length>0)).toBe(true);
  expect((await f.service.read()).state.watch).toEqual([]);
  expect(f.prices.tradingCandidates).toHaveBeenCalledTimes(1);
});
it('follows the generated shortlist without player input or EA actions, preserving exact quote timestamps',async()=>{
  const f=fixture();const report=await f.service.discover();await f.service.followSuggestions();
  const {state}=await f.service.read();expect(state.watch).toHaveLength(report.suggestions.length);
  expect(state.watch[0].plan.saleTarget).toBe(report.suggestions[0].resaleEstimate);
  expect(state.watch[0].latest.futgg.at).toBe(now);expect(state.watch[0].ask).toBe(0);
  expect(report.allocated).toBeLessThanOrEqual(10000);expect(f.prices.load.mock.calls[0][0].length).toBeLessThanOrEqual(12);
  expect(f.prices.load.mock.calls[0][1]).toMatchObject({sources:['futgg'],purpose:'trading',policy:{futbinPlatform:'ps'}});
  expect(f.prices.remember).not.toHaveBeenCalled();
});
it('rejects old advice and settings/positions changed in another tab instead of silently reusing caps',async()=>{
  const f=fixture();await f.service.discover();f.advance(300001);await expect(f.service.followSuggestions()).rejects.toThrow('EXPIRED');
  const g=fixture();await g.service.discover();await g.service.settings({capitalLimit:5000});
  await expect(g.service.followSuggestions()).rejects.toThrow('CHANGED');
});
it('cancels account-switched and user-cancelled discovery without notebook writes',async()=>{
  const f=fixture();let resolve;f.prices.tradingCandidates.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const pending=f.service.discover();while(!resolve)await Promise.resolve();f.changeAccount();resolve({rows,at:now,platform:'console'});
  await expect(pending).rejects.toThrow('CONTEXT_CHANGED');expect(f.data.size).toBe(0);
  await expect(f.service.discover({isCurrent:()=>false})).rejects.toThrow('CONTEXT_CHANGED');
});
it('keeps single-source suggestions explicit and does not turn a disabled source back on',async()=>{
  const f=fixture();f.prices.readSettings.mockResolvedValue({readSources:'futbin',source:'futbin'});
  const result=await f.service.discover();expect(result.suggestions.length).toBeGreaterThan(0);
  expect(result.suggestions.every(row=>row.sourceCount===1&&row.ggPrice===null)).toBe(true);expect(result.crossChecked).toBe(0);
  expect(f.prices.load).not.toHaveBeenCalled();
});
it('returns no suggestions when occupied funds exhaust the trial; does not spend hypothetical resale proceeds',async()=>{
  const f=fixture();await f.service.recordBuy({definitionId:500,buy:10000});
  const result=await f.service.discover();expect(result.suggestions).toEqual([]);expect(f.prices.tradingCandidates).not.toHaveBeenCalled();
});
it('retains the watch limit atomically and refuses to follow an ungenerated arbitrary card',async()=>{
  const f=fixture();for(let i=0;i<20;i++)await f.service.add({input:String(1000+i)});
  await f.service.discover();await expect(f.service.followSuggestions()).rejects.toThrow('WATCH_LIMIT');
  expect((await f.service.read()).state.watch).toHaveLength(20);
  await expect(f.service.followSuggestions({definitionId:999})).rejects.toThrow('PLAYER_INVALID');
});
it('models take-profit, loss review, time review and missing evidence without executing a sale',async()=>{
  const f=fixture();const report=await f.service.discover(),row=report.suggestions[0];await f.service.followSuggestions({definitionId:row.definitionId});
  let {state}=await f.service.read();const record={definitionId:row.definitionId,buy:row.buyCeiling,at:now,plan:state.watch[0].plan};
  expect(deskExit(state,record,now).status).toBe('take-profit');
  state.watch[0].plan={...state.watch[0].plan,saleTarget:9999};record.plan=state.watch[0].plan;
  expect(deskExit(state,record,now).status).toBe('hold');
  for(const q of Object.values(state.watch[0].latest)){q.price=record.buy;q.expiresAt=now+300000;}
  expect(deskExit(state,record,now).status).toBe('hold');
  for(const q of Object.values(state.watch[0].latest))q.price=150;
  expect(deskExit(state,record,now).status).toBe('risk-review');
  for(const q of Object.values(state.watch[0].latest)){q.price=record.buy+150;q.at=now+21600000;q.fetchedAt=q.at;q.expiresAt=q.at+300000;}
  expect(deskExit(state,record,now+21600000).status).toBe('time-review');
  state.watch=[];expect(deskExit(state,record,now).status).toBe('verify');
});
it('alerts on a public price touch without native quote input but never calls it verified profit',async()=>{
  const f=fixture();await f.service.settings({});const report=await f.service.discover();await f.service.followSuggestions({definitionId:report.suggestions[0].definitionId});
  const {state}=await f.service.read(),card=state.watch[0];
  for(const q of Object.values(card.latest))q.price=card.plan.buyCap;
  expect(deskAlerts(state,now)[0].kind).toBe('price-signal');expect(deskAlerts(state,now+1000)).toEqual([]);
  expect(card.ask).toBe(0);state.configured=false;expect(deskAlerts(state,now+1800001)).toEqual([]);
});
it('screens exactly three public pages and projects only small exact-version facts on the real market',async()=>{
  const request=vi.fn(async url=>{const rating=Number(new URL(url).searchParams.get('rating').split('-')[0]);
    return {errorcode:'200',data:[{ID:rating,resource_id:rating+1000,rating,raretype:0,playername:'Ordinary',ps_LCPrice:800,pc_LCPrice:900,
      ps_LCPClosing:850,itemScore:300,position:'CM',alternativePositions:'CDM, CAM',image:'x'.repeat(50000),private:'not projected'}]};});
  const pool=await readTradingCandidatePool({request,platform:'console',now:()=>now});
  expect(request).toHaveBeenCalledTimes(3);expect(pool.rows).toHaveLength(3);expect(pool.rows[0]).toMatchObject({price:800,closingPrice:850,positions:['CM','CDM','CAM']});
  expect(JSON.stringify(pool)).not.toContain('private');expect(JSON.stringify(pool).length).toBeLessThan(2000);
  expect(request.mock.calls.every(([url])=>new URL(url).searchParams.get('page')==='1')).toBe(true);
});
it('does not invent prices for unpriced/special cards or silently accept a malformed pool',async()=>{
  const request=vi.fn(async url=>{const rating=Number(new URL(url).searchParams.get('rating').split('-')[0]);return {data:[
    {ID:rating,resource_id:rating,rating,raretype:0,ps_LCPrice:null},{ID:rating+1000,resource_id:rating+1000,rating,raretype:12,ps_LCPrice:500}]};});
  expect((await readTradingCandidatePool({request,platform:'console',now:()=>now})).rows).toEqual([]);
  await expect(readTradingCandidatePool({request:async()=>({data:[{ID:1,resource_id:1,rating:99}]}),platform:'console'})).rejects.toThrow('INVALID');
});
it('adds bounded author-nominated name lookups, deduplicates overlap and never guesses between different people',async()=>{
  const request=vi.fn(async url=>{const q=new URL(url).searchParams;if(q.has('name'))return {data:q.get('name')==='Example player'?
    [{ID:900,resource_id:999,rating:76,raretype:0,playername:'Example player',ps_LCPrice:1000}]:
    [{ID:901,resource_id:998,rating:79,raretype:0,playername:'First Silva',ps_LCPrice:1000},{ID:902,resource_id:997,rating:80,raretype:0,playername:'Other Silva',ps_LCPrice:900}]};
    const rating=Number(q.get('rating').split('-')[0]);return {data:[{ID:rating,resource_id:rating,rating,raretype:0,playername:'Base',ps_LCPrice:900}]};});
  const pool=await readTradingCandidatePool({request,platform:'console',names:['Example player','Silva'],now:()=>now});
  expect(request).toHaveBeenCalledTimes(5);expect(pool.rows.find(row=>row.definitionId===999)).toMatchObject({rating:76,mentionQuery:'Example player'});
  expect(pool.rows.some(row=>[998,997].includes(row.definitionId))).toBe(false);expect(pool.unresolvedNames).toEqual(['Silva']);
});
it.each(['stale','future','platform','disagreement','fall','pump'])('rejects unsafe or unavailable cross-check evidence: %s',kind=>{
  const state=emptyDesk(),row={...rows[0]},gg={source:'futgg',definitionId:row.definitionId,season:'27',platform:'console',price:row.price,
    fetchedAt:now,sourceUpdatedAt:now,expiresAt:now+300000};
  if(kind==='stale')gg.sourceUpdatedAt=now-1800001;if(kind==='future')gg.sourceUpdatedAt=now+1;if(kind==='platform')gg.platform='pc';
  if(kind==='disagreement')gg.price=2000;if(kind==='fall')row.closingPrice=1500;if(kind==='pump')row.closingPrice=500;
  const result=rankTradingSuggestions({rows:[row],platform:'console',at:now},state,{[row.definitionId]:{quotes:{futgg:gg}}},now);
  if(['disagreement','fall','pump'].includes(kind))expect(result.suggestions).toEqual([]);
  else expect(result.suggestions[0].sourceCount).toBe(1);
});
it('considers same-name author-reply mentions even without complete EVO conditions; never proves eligibility',()=>{
  const state=emptyDesk();state.events=[{url:'https://x.com/FutSheriff/status/1',at:now,status:'leak',players:[{name:'Public 0',version:null}]}];
  const clues=evoClues(rows[0],state,now);expect(clues).toHaveLength(1);expect(clues[0].reason).toContain('待核验');
  state.events[0].status='failed';expect(evoClues(rows[0],state,now)).toEqual([]);
});
it('automatically directs name lookups from fresh explicit EVO nominations, not theme mentions',async()=>{
  const f=fixture({refresh:async()=>({posts:[{url:'https://x.com/FutSheriff/status/1',at:now,topic:'evo',text:'Public 0 fits.',evidence:'native-thread-author-reply',
    players:[{name:'Public 0',version:null,nominationQuote:'Public 0 fits.'},{name:'Theme',version:null,nominationQuote:null}]}]})});
  await f.service.refreshIntel();const result=await f.service.discover();
  expect(f.prices.tradingCandidates.mock.calls[0][0].names).toEqual(['Public 0']);
  expect(result.suggestions.some(row=>row.name==='Public 0'&&row.evo[0].reason.includes('原生线程'))).toBe(true);
});
