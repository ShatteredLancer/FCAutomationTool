import {it,expect} from 'vitest';
import {readEventStore,eventCandidates,eventStoreKey} from '../../src/trading/event-candidates.js';
const now=1793858000000,context={scope:'test',season:'27',platform:'console'};
const url='https://x.com/ExampleSource/status/2118109323020898419';
const post={url,author:'ExampleSource',at:now-10000,text:'Camavinga under 1.5K. EVO leak.',topic:'evo',players:[{name:'Camavinga',version:null,nominationQuote:'Camavinga under 1.5K'}],entry:{ceiling:1500,strictBelow:true,quote:'under 1.5K'},targetPrice:null,evidence:'native-thread-post',threadChecked:true};
const state={schema:1,context,rows:[{url,post,status:'leak',included:true,exitMode:'target-hold',importedAt:now}]};
const pool={platform:'console',at:now,rows:[{definitionId:99,futbinId:88,name:'Eduardo Camavinga',mentionQuery:'Camavinga',rating:82,price:1500,fetchedAt:now,season:'27',platform:'console'}]};
const references={99:{quotes:{futgg:{source:'futgg',definitionId:99,season:'27',platform:'console',price:1500,fetchedAt:now,expiresAt:now+300000}}}};
const settings={unitLimit:2000,minProfit:150,buffer:100};
it('creates an explicitly selected one-card event scenario rather than requiring a current resale spread',()=>{
  const s=readEventStore(state,context),r=eventCandidates(s,pool,references,settings,now);
  expect(r.candidates).toHaveLength(1);expect(r.candidates[0]).toMatchObject({strategy:'evo-event',definitionId:99,buyCeiling:1400,resaleEstimate:1800,included:true,event:{sourceUrl:url,entryCeiling:1500,strictBelow:true,targetBasis:'required-return',exitMode:'target-hold',reviewAt:now+21600000}});
  expect(r.candidates[0].reason).toContain('不是预测');expect(eventStoreKey(context.scope)).toContain('test');
});
it('requires dual-source current exact versions and refuses ambiguous or missing nominations',()=>{
  expect(eventCandidates(state,pool,{},settings,now).candidates).toEqual([]);
  const p=structuredClone(pool);p.rows.push({...p.rows[0],definitionId:100});expect(eventCandidates(state,p,references,settings,now).candidates).toEqual([]);
  const s=structuredClone(state);s.rows[0].post.players[0].nominationQuote=null;expect(eventCandidates(s,pool,references,settings,now).candidates).toEqual([]);
});
it('does not use a unique rating-page sample to override an explicitly unresolved named search',()=>{
  const p={...structuredClone(pool),unresolvedNames:['Camavinga']};expect(eventCandidates(state,p,references,settings,now).candidates).toEqual([]);
  const sample=structuredClone(pool);delete sample.rows[0].mentionQuery;expect(eventCandidates(state,sample,references,settings,now).candidates).toEqual([]);
});
it('keeps revoked/old sources and stale/disagreeing/wrong-platform quotes out of executable candidates',()=>{
  for(const kind of ['failed','stale-post','stale-quote','platform','disagreement']){const s=structuredClone(state),q=structuredClone(references);
    if(kind==='failed')s.rows[0].status='failed';if(kind==='stale-post')s.rows[0].post.at=now-86400001;
    if(kind==='stale-quote')q[99].quotes.futgg.expiresAt=now;if(kind==='platform')q[99].quotes.futgg.platform='pc';if(kind==='disagreement')q[99].quotes.futgg.price=2000;
    expect(eventCandidates(s,pool,q,settings,now).candidates).toEqual([]);
  }
});
it('does not infer specific special versions from an unqualified player mention',()=>{
  const s=structuredClone(state);s.rows[0].post.players[0].version='Special card';expect(eventCandidates(s,pool,references,settings,now).candidates).toEqual([]);
});
it('keeps storage small, account-bound and separate from transaction journals',()=>{
  expect(readEventStore(null,context).rows).toEqual([]);expect(()=>readEventStore(state,{...context,scope:'other'})).toThrow('EVENT_STORAGE');
  expect(()=>readEventStore({...state,rows:Array(7).fill(state.rows[0])},context)).toThrow('EVENT_STORAGE');
  expect(()=>readEventStore({...state,extra:'x'.repeat(61000)},context)).toThrow('EVENT_STORAGE');
});
