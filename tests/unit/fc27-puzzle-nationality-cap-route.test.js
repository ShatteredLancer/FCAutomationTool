import {expect,it,vi} from 'vitest';
import {nationalityCapFixture} from '../helpers/fc27-puzzle-nationality-cap-fixture.js';
import {planFc27PuzzleShortageQueries} from '../../src/fc27/puzzle-procurement.js';
import {evaluateFc27PuzzleSquad} from '../../src/fc27/puzzle-evaluator.js';
import {parseFc27SbcRequirements,matchFc27SbcRequirements} from '../../src/fc27/sbc-requirements.js';
import {createFc27PuzzleProcurementSession} from '../../src/fc27/puzzle-procurement-session.js';

it('has a fully native-valid three-club/three-league witness under the nationality cap',()=>{
  const {input,base,known}=nationalityCapFixture();
  const facts=evaluateFc27PuzzleSquad({squad:known.map((item,slot)=>({...base,...item,slot})),formation:input.challenge.formation,chemistry:input.chemistry,rating:input.chemistry.rating});
  expect(facts.status).toBe('observed');expect(facts.chemistry).toBeGreaterThanOrEqual(26);expect(facts.teamRating).toBeGreaterThanOrEqual(75);
  expect(matchFc27SbcRequirements({requirements:parseFc27SbcRequirements(input.challenge.rawRequirements,11).rules,squad:known,
    chemistry:facts.chemistry,teamRating:facts.teamRating,clubLinks:input.clubLinks}).status).toBe('satisfied');
});
it('does not deepen the dominant nationality after the compulsory club page when that nationality is capped',()=>{
  const {input,pages}=nationalityCapFixture();
  const route=planFc27PuzzleShortageQueries(input,pages[0].entries,{usedQueries:[pages[0].query]});
  expect(route.status).toBe('ready');expect(route.queries[0]).toEqual(pages[1].query);
  expect(route.queries.some(q=>q.nation===52)).toBe(false);
});
it('grows the undercovered complementary league after the broad read instead of another Spanish page',()=>{
  const {input,pages}=nationalityCapFixture();
  expect(planFc27PuzzleShortageQueries(input,[...pages[0].entries,...pages[1].entries],{usedQueries:pages.slice(0,2).map(p=>p.query)}).queries[0]).toEqual(pages[2].query);
});
it('preserves the legacy national lane when there is no national cap',()=>{
  const {input,pages}=nationalityCapFixture();input.challenge.rawRequirements.splice(1,1);
  expect(planFc27PuzzleShortageQueries(input,pages[0].entries,{usedQueries:[pages[0].query]}).queries[0]).toEqual({start:0,count:20,level:'gold',nation:52});
});
it('tries the other OR club when one club cannot supply four players under the national cap',()=>{
  const {input,pages}=nationalityCapFixture(),entries=pages[0].entries.map(item=>({...item,nationId:52}));
  const route=planFc27PuzzleShortageQueries(input,entries,{usedQueries:[pages[0].query]});
  expect(route.queries[0]).toEqual({start:0,count:20,level:'gold',team:241});expect(route.queries.some(q=>q.nation===52)).toBe(false);
});
it('checks nationality and positions jointly before trusting a club spine',()=>{
  const {input,pages,base,known}=nationalityCapFixture();input.challenge.rawRequirements.at(-1).pairs[0].values=[33];
  const entries=pages[0].entries.map(item=>({...item,...(item.nationId===52?{}:{positions:[27]})}));
  const witness=known.map(item=>({...item,teamId:item.teamId===240?241:item.teamId}));
  const facts=evaluateFc27PuzzleSquad({squad:witness.map((item,slot)=>({...base,...item,slot})),formation:input.challenge.formation,
    chemistry:input.chemistry,rating:input.chemistry.rating});
  expect(facts.chemistry).toBe(33);expect(matchFc27SbcRequirements({requirements:parseFc27SbcRequirements(input.challenge.rawRequirements,11).rules,
    squad:witness,chemistry:facts.chemistry,teamRating:facts.teamRating,clubLinks:input.clubLinks}).status).toBe('satisfied');
  expect(planFc27PuzzleShortageQueries(input,entries,{usedQueries:[pages[0].query]}).queries[0]).toEqual({start:0,count:20,level:'gold',team:241});
});
it('uses canonical club links for the backbone without forcing a linked identity into the final squad',()=>{
  const {input,pages}=nationalityCapFixture();input.clubLinks.links=[[1240,240]];input.chemistry.links=input.clubLinks;
  const entries=pages[0].entries.map((item,i)=>({...item,teamId:i%2?1240:240}));
  expect(planFc27PuzzleShortageQueries(input,entries,{usedQueries:[pages[0].query]}).queries[0]).toEqual(pages[1].query);
});
it.each(['locked','activeSquad'])('never uses %s owned cards as query anchors or relaxes their protection',flag=>{
  const {input,base,known}=nationalityCapFixture(),before=structuredClone(input.policy);
  const empty=planFc27PuzzleShortageQueries(input).queries;
  input.inventory.items=known.map((item,i)=>({...base,...item,id:900+i,[flag]:true}));
  expect(planFc27PuzzleShortageQueries(input).queries).toEqual(empty);expect(input.policy).toEqual(before);
});
it('deduplicates versions and does not repeat already-read pages',()=>{
  const {input,pages}=nationalityCapFixture(),usedQueries=pages.map(p=>p.query),entries=pages.flatMap(p=>p.entries);
  const route=planFc27PuzzleShortageQueries(input,[...entries,...entries],{usedQueries});
  expect(route.queries.length).toBeLessThanOrEqual(3);expect(route.queries.every(q=>!usedQueries.some(used=>JSON.stringify(used)===JSON.stringify(q)))).toBe(true);
  expect(route.queries.some(q=>q.nation===52)).toBe(false);
});
it('solves through the production procurement session using the original three-page limit without writes',async()=>{
  const {input,pages,card}=nationalityCapFixture(),data=new Map();
  const readCatalogPage=vi.fn(async query=>({status:'observed',season:'27',source:'ea-defid',query,observedAt:input.now,
    entries:pages.find(p=>JSON.stringify(p.query)===JSON.stringify(query))?.entries
      ??(query.nation===52?Array.from({length:20},(_,i)=>card(5000+query.start+i,i%4,100+i,13,52)):[])}));
  const session=createFc27PuzzleProcurementSession({now:()=>input.now,get:async(k,f)=>structuredClone(data.get(k)??f),set:async(k,v)=>data.set(k,structuredClone(v)),
    createTransport:async()=>({readCatalogPage,readQuotePage:vi.fn(()=>{throw Error('unexpected EA auction read');})}),
    loadPublicPrices:async ids=>({policy:{source:'futbin'},references:Object.fromEntries(ids.map(definitionId=>[definitionId,{definitionId,season:'27',platform:'pc',
      quotes:Object.fromEntries(['futbin','futgg'].map(source=>[source,{schema:2,source,definitionId,season:'27',platform:'pc',price:source==='futbin'?200:null,
        fetchedAt:input.now,expiresAt:input.now+300000,sourceUpdatedAt:null,error:source==='futbin'?null:'FC27_PUBLIC_PRICE_NOT_REQUESTED'}]))}]))})});
  const result=await session.plan(input);
  expect(result.status,JSON.stringify({reason:result.reason,queries:result.queries,diagnostics:result.diagnostics})).toBe('suggested');
  expect(result.plans[0].purchases).toHaveLength(11);expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(26);
  expect(readCatalogPage.mock.calls.map(([q])=>q)).toEqual(pages.map(p=>p.query));
  expect(result.plans[0].conceptPlan.status).toBe('prepared');
});
