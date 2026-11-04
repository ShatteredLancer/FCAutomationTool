import {expect,it,vi} from 'vitest';
import {puzzleFillFixture} from '../helpers/fc27-puzzle-fill-fixture.js';
import {marketRow} from '../helpers/fc27-market-fixture.js';
import {createFc27PuzzleProcurementSession} from '../../src/fc27/puzzle-procurement-session.js';
import {evaluateFc27PuzzleSquad} from '../../src/fc27/puzzle-evaluator.js';
import {parseFc27SbcRequirements,matchFc27SbcRequirements} from '../../src/fc27/sbc-requirements.js';
import {planPuzzleLeagueMinimumAffinity} from '../../src/fc27/puzzle-query-affinity.js';

// Screenshot requirement shape, not the unexported account/formation/cards.
it('uses a dominant-quality league page before three unrelated tier pages exhaust discovery',async()=>{
  const input=puzzleFillFixture(),template=input.inventory.items[0];
  input.challenge.setId=77;input.challenge.id=117;input.challenge.brickIndices=[9,10];
  input.challenge.rawRequirements=[marketRow(5,4),marketRow(6,3,-1,1),marketRow(7,4,-1,1),marketRow(17,3,6),marketRow(19,70),marketRow(35,24)];
  input.policy.maxRating=82;input.policy.goldRange=[75,90];
  input.inventory.items=[1,2].map((id)=>({...template,id,definitionId:100+id,rating:64,nationId:1,teamId:30,leagueId:99,state:'free'}));
  input.marketPolicy={budget:10000,maxPurchases:9,maxUnitPrice:500,minimumRetainedCoins:1000,availableCoins:20000};
  const basic={rarity:0,nationId:1,positions:[5],groups:[],special:false,evolution:false,cosmetic:false,marketable:true};
  const gold=Array.from({length:6},(_,i)=>({...basic,definitionId:1000+i,rating:78,nationId:1+Math.floor(i/2),teamId:i<3?10:20,leagueId:19}));
  const bronze={...basic,definitionId:2000,rating:64,teamId:30,leagueId:19};
  const decoys=Array.from({length:18},(_,i)=>({...basic,definitionId:3000+i,rating:78,nationId:10+i,teamId:40+i,leagueId:40+i,positions:[0]}));
  const first=[...gold.slice(0,2),...decoys],all=[...gold,bronze,...decoys],values=new Map();
  const known=[...input.inventory.items,...gold,bronze].map((item,slot)=>({...template,...item,slot}));
  const facts=evaluateFc27PuzzleSquad({squad:[...known,null,null],formation:input.challenge.formation,chemistry:input.chemistry,rating:input.chemistry.rating});
  expect(matchFc27SbcRequirements({requirements:parseFc27SbcRequirements(input.challenge.rawRequirements,9).rules,squad:known,
    chemistry:facts.chemistry,teamRating:facts.teamRating,clubLinks:input.clubLinks}).status,JSON.stringify(facts)).toBe('satisfied');
  const transport={readCatalogPage:vi.fn(async query=>({status:'observed',source:'ea-defid',season:'27',query,observedAt:input.now,
    entries:(query.level==='gold'?(query.league||query.nation||query.team?[...gold,...decoys]:first):query.level==='bronze'?[bronze]:[])
      .filter(card=>(!query.league||card.leagueId===query.league)&&(!query.nation||card.nationId===query.nation)&&(!query.team||card.teamId===query.team)).slice(0,query.count),pageEndObserved:true})),
    readQuotePage:vi.fn(),buy:vi.fn(),move:vi.fn(),save:vi.fn(),submit:vi.fn()};
  const loadPublicPrices=async ids=>({policy:{source:'futgg'},references:Object.fromEntries(ids.map(definitionId=>[definitionId,{
    definitionId,season:'27',platform:'pc',quotes:Object.fromEntries(['futgg','futbin'].map(source=>[source,{schema:2,source,definitionId,season:'27',platform:'pc',price:200,
      fetchedAt:input.now,sourceUpdatedAt:null,expiresAt:input.now+300000,error:null}]))}]))});
  const before=JSON.stringify(input);
  const result=await createFc27PuzzleProcurementSession({createTransport:async()=>transport,loadPublicPrices,now:()=>input.now,
    get:async(key,fallback)=>structuredClone(values.get(key) ?? fallback),set:async(key,value)=>values.set(key,structuredClone(value))})
    .plan(input,{optimizeMaterialValue:true,quoteCeiling:500});
  expect(result.status,JSON.stringify({reason:result.reason,queries:result.queries,diagnostics:result.diagnostics})).toBe('suggested');
  const plan=result.plans[0],squad=Array(11).fill(null);
  for(const row of plan.selectedOwned)squad[row.slot]=input.inventory.items.find(item=>item.id===row.id);
  for(const row of plan.purchases)squad[row.slot]={...template,...all.find(item=>item.definitionId===row.definitionId)};
  const check=input.evaluateSquad(squad);
  expect(matchFc27SbcRequirements({requirements:parseFc27SbcRequirements(input.challenge.rawRequirements,9).rules,squad:squad.filter(Boolean),
    chemistry:check.chemistry,teamRating:check.teamRating,clubLinks:input.clubLinks}).status).toBe('satisfied');
  expect(transport.readCatalogPage.mock.calls.some(([query])=>query.level==='gold' && query.league===19)).toBe(true);
  expect(transport.readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3);expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  for(const name of ['readQuotePage','buy','move','save','submit'])expect(transport[name]).not.toHaveBeenCalled();
  expect(JSON.stringify(input)).toBe(before);
});

const affinity=()=>({candidates:[{definitionId:1,rating:78,leagueId:19,teamId:1,positions:[5]},
  {definitionId:2,rating:78,leagueId:19,teamId:2,positions:[5]},
  ...Array.from({length:6},(_,i)=>({definitionId:100+i,rating:78,leagueId:13,teamId:3,positions:[0]}))],
  material:[{qualities:[3],count:6},{qualities:[1],count:3}],rules:[{kind:'same-league',mode:'min',value:4},{kind:'same-club',mode:'max',value:3}],
  formation:{positions:Array(11).fill(5)},brickIndices:[9,10],usedQueries:[{start:0,count:20,level:'gold'}],resolveClub:id=>id});
it('ranks usable open-position support instead of a larger off-position league',()=>{
  const input=affinity(),before=JSON.stringify(input);
  expect(planPuzzleLeagueMinimumAffinity(input)).toEqual({start:0,count:20,level:'gold',league:19});
  expect(JSON.stringify(input)).toBe(before);
});
it('preserves same-club capacity and linked-club identities when ranking the league sample',()=>{
  const input=affinity();input.candidates=[...Array.from({length:6},(_,i)=>({definitionId:100+i,rating:78,leagueId:19,teamId:i<3?1:2,positions:[5]})),
    ...Array.from({length:4},(_,i)=>({definitionId:200+i,rating:78,leagueId:13,teamId:i<2?3:4,positions:[5]}))];
  input.resolveClub=id=>id===2?1:id;
  expect(planPuzzleLeagueMinimumAffinity(input).league).toBe(13);
});
it('requires a real same-league minimum and broad dominant-tier evidence, with no duplicate query',()=>{
  const input=affinity();expect(planPuzzleLeagueMinimumAffinity({...input,usedQueries:[]})).toBeNull();
  expect(planPuzzleLeagueMinimumAffinity({...input,rules:[{kind:'same-league',mode:'max',value:4}]})).toBeNull();
  expect(planPuzzleLeagueMinimumAffinity({...input,material:[{qualities:[3],count:4}]})).toBeNull();
  const query=planPuzzleLeagueMinimumAffinity(input);input.usedQueries.push(query);expect(planPuzzleLeagueMinimumAffinity(input)).toBeNull();
});
it('retains policy exclusions and fails back without a reliable club resolver or position support',()=>{
  const input=affinity();expect(planPuzzleLeagueMinimumAffinity({...input,excludedLeagueIds:[19]})).toBeNull();
  expect(planPuzzleLeagueMinimumAffinity({...input,resolveClub:null})).toBeNull();
  expect(planPuzzleLeagueMinimumAffinity({...input,formation:{positions:Array(11).fill(1)}})).toBeNull();
  expect(planPuzzleLeagueMinimumAffinity()).toBeNull();
});
