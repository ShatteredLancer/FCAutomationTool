import {it,expect,vi} from 'vitest';
import {createFc27TradingDesk} from '../../src/adapters/browser/fc27-trading-desk.js';
import {eventStoreKey} from '../../src/trading/event-candidates.js';
const now=1793858000000,url='https://x.com/ExampleSource/status/2118109323020898419';
const root={url,author:'ExampleSource',at:now-10000,text:'Camavinga under 1.5K EVO',topic:'evo',players:[{name:'Camavinga',version:null,nominationQuote:'Camavinga under 1.5K'}],entry:{ceiling:1500,strictBelow:true,quote:'under 1.5K'},targetPrice:null,evidence:'native-thread-post',threadChecked:true};
function fixture(data=new Map([['old-journal',{pending:true}]])){let scope='A';const context=()=>({scope,season:'27',platform:'console'}),start=vi.fn();
  const card={definitionId:99,futbinId:88,name:'Camavinga',mentionQuery:'Camavinga',rating:82,price:1500,fetchedAt:now,season:'27',platform:'console'};
  const intel={importPost:vi.fn(async()=>({schema:1,requestUrl:url,posts:[root],fetchedAt:now}))};
  const prices={context,readSettings:async()=>({source:'futbin',readSources:'both'}),tradingCandidates:vi.fn(async()=>({rows:[card],at:now,platform:'console'})),load:vi.fn(async()=>({references:{99:{quotes:{futgg:{source:'futgg',definitionId:99,season:'27',platform:'console',price:1500,fetchedAt:now,expiresAt:now+300000}}}}}))};
  const service=createFc27TradingDesk({prices,intel,execution:{prepare:plan=>({plan}),start},get:async(k,d)=>structuredClone(data.get(k)??d),set:async(k,v)=>data.set(k,structuredClone(v)),locks:{request:async(_k,_o,fn)=>fn()},now:()=>now,id:()=> 'event-plan'});
  return {service,intel,prices,data,start,context,change:()=>{scope='B';}};
}
it('imports only on request, reads one name not the whole catalogue and requires inclusion before minting an event plan',async()=>{
  const f=fixture();expect(f.intel.importPost).not.toHaveBeenCalled();const imported=await f.service.importEvent({url});expect(imported.store.rows[0].included).toBe(false);
  const analysis=await f.service.analyzeEvents();expect(analysis.candidates[0].strategy).toBe('evo-event');expect(f.prices.tradingCandidates.mock.calls[0][0]).toMatchObject({namesOnly:true,names:['Camavinga']});expect(f.start).not.toHaveBeenCalled();
  await f.service.setEvent({url,included:true});const advice=await f.service.discover();expect(advice.suggestions[0].strategy).toBe('evo-event');
  const result=await f.service.prepareInvestment({capitalLimit:2000});expect(result.plan.rows[0].event).toMatchObject({sourceUrl:url,exitMode:'target-hold'});expect(result.plan.allocated).toBe(1400);
  expect(f.data.get('old-journal')).toEqual({pending:true});expect(f.intel.importPost).toHaveBeenCalledTimes(1);expect(f.start).not.toHaveBeenCalled();
});
it('revocation removes the event from future plans and rejects stale prepared authority without new network collection',async()=>{
  const f=fixture();await f.service.importEvent({url});await f.service.setEvent({url,included:true});await f.service.discover();
  await f.service.setEvent({url,status:'failed'});await expect(f.service.prepareInvestment()).rejects.toThrow('DISCOVERY');
  const a=await f.service.analyzeEvents();expect(a.candidates).toEqual([]);expect(f.data.get(eventStoreKey('A')).rows[0].status).toBe('failed');expect(f.intel.importPost).toHaveBeenCalledTimes(1);
});
it('abandons a delayed cross-account import instead of storing it under the new account',async()=>{
  const f=fixture();let finish;f.intel.importPost.mockImplementation(()=>new Promise(r=>{finish=r;}));const pending=f.service.importEvent({url});for(let i=0;i<30&&!finish;i++)await Promise.resolve();f.change();finish({schema:1,requestUrl:url,posts:[root],fetchedAt:now});
  await expect(pending).rejects.toThrow('CONTEXT_CHANGED');expect(f.data.has(eventStoreKey('A'))).toBe(false);expect(f.data.has(eventStoreKey('B'))).toBe(false);
});
it('never resurrects a removed source from an older in-flight import response',async()=>{
  const f=fixture();await f.service.importEvent({url});let finish;f.intel.importPost.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const pending=f.service.importEvent({url}),outcome=pending.then(value=>({value}),error=>({error}));for(let i=0;i<30&&!finish;i++)await Promise.resolve();
  await f.service.setEvent({url,remove:true});finish({schema:1,requestUrl:url,posts:[root],fetchedAt:now});
  expect((await outcome).error?.message).toMatch(/CONTEXT_CHANGED|SOURCE_CHANGED/);expect((await f.service.eventState()).store.rows).toEqual([]);
});
it('checks persisted revision under the event-store lock when a different tab removes the source',async()=>{
  const data=new Map(),a=fixture(data),b=fixture(data);await a.service.importEvent({url});let finish;
  a.intel.importPost.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const pending=a.service.importEvent({url}),outcome=pending.then(value=>({value}),error=>({error}));
  for(let i=0;i<30&&!finish;i++)await Promise.resolve();await b.service.setEvent({url,remove:true});finish({schema:1,requestUrl:url,posts:[root],fetchedAt:now});
  expect((await outcome).error?.message).toBe('DESK_EVENT_SOURCE_CHANGED');expect((await a.service.eventState()).store.rows).toEqual([]);
});
