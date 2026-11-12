import { expect, it, vi } from 'vitest';
import { nationalMinimumFixture } from '../helpers/fc27-puzzle-national-minimum-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

// Incident-shaped economics; synthetic entities, prices and formation, no live account.
it('values owned 85-rated material instead of treating it as a free substitute for a cheap purchase', async () => {
  const f = nationalMinimumFixture(), { input, template } = f;
  input.policy.maxRating=90;
  input.inventory.items=[85,83,83,82,81,81].map((rating,i)=>({...template,id:100+i,definitionId:5000+i,rating,
    nationId:1+i,leagueId:[1,4,4,5,5,6][i],teamId:[1,4,4,5,5,6][i]}));
  input.marketPolicy.maxUnitPrice=1000;
  const base={rating:65,nationId:1,positions:[5],rarity:0,groups:[],special:false,evolution:false,cosmetic:false,marketable:true};
  const silver=Array.from({length:5},(_,i)=>({...base,definitionId:6000+i,nationId:i<4?1:7,leagueId:[2,2,3,3,7][i],teamId:[2,2,3,3,7][i]}));
  const bronze={...base,definitionId:7000,rating:60,leagueId:1,teamId:1};
  let price85=2800;
  const price=id=>id===5000?price85:id===7000?200:500;
  const run=async value=>{
    const memory=new Map();
    const transport={readCatalogPage:vi.fn(async query=>({status:'observed',source:'ea-defid',season:'27',query,observedAt:input.now,
      entries:(query.level==='bronze'?[bronze]:query.level==='silver'?silver:[])
        .filter(card=>(!query.nation||card.nationId===query.nation)&&(!query.league||card.leagueId===query.league)).slice(query.start,query.start+query.count)})),
      readQuotePage:vi.fn(),buy:vi.fn(),move:vi.fn(),save:vi.fn(),submit:vi.fn()};
    const result=await createFc27PuzzleProcurementSession({createTransport:async()=>transport,now:()=>input.now,
      get:async(k,fallback)=>structuredClone(memory.get(k)??fallback),set:async(k,v)=>memory.set(k,structuredClone(v)),
      loadPublicPrices:async ids=>({policy:{source:'futbin'},references:Object.fromEntries(ids.map(definitionId=>[definitionId,
        {definitionId,season:'27',platform:'pc',quotes:Object.fromEntries(['futbin','futgg'].map(source=>[source,
          {schema:2,source,definitionId,season:'27',platform:'pc',price:source==='futbin'?price(definitionId):150,
            fetchedAt:input.now,expiresAt:input.now+300000,sourceUpdatedAt:null,error:null}]))}]))})})
      .plan(input,{optimizeMaterialValue:value,adaptiveSearch:true});
    expect(result.status,JSON.stringify({reason:result.reason,diagnostics:result.diagnostics})).toBe('suggested');
    for(const key of ['readQuotePage','buy','move','save','submit'])expect(transport[key]).not.toHaveBeenCalled();
    return result;
  };
  const cash=await run(false),value=await run(true),chosen=value.plans[0];
  expect(cash.diagnostics.objective).toBe('additional-coins');
  expect(cash.plans[0].selectedOwned.some(card=>card.rating===85)).toBe(true);
  expect(value.diagnostics.objective).toBe('material-value');
  expect(chosen.selectedOwned.some(card=>card.rating===85)).toBe(false);
  expect(chosen.estimatedCost).toBeGreaterThan(cash.plans[0].estimatedCost);
  const cashTotal=[...cash.plans[0].selectedOwned,...cash.plans[0].purchases].reduce((sum,card)=>sum+price(card.definitionId),0);
  expect(chosen.materialValue).toBeLessThan(cashTotal);
  const squad=Array(11).fill(null),market=[...silver,bronze];
  for(const ref of chosen.selectedOwned)squad[ref.slot]={...input.inventory.items.find(card=>card.id===ref.id),slot:ref.slot};
  for(const ref of chosen.purchases)squad[ref.slot]={...template,...market.find(card=>card.definitionId===ref.definitionId),slot:ref.slot};
  const facts=input.evaluateSquad(squad);
  expect(matchFc27SbcRequirements({requirements:parseFc27SbcRequirements(input.challenge.rawRequirements,11).rules,squad,
    chemistry:facts.chemistry,teamRating:facts.teamRating,clubLinks:input.clubLinks}).status).toBe('satisfied');
  console.info('OWNED_VALUE_EVIDENCE',JSON.stringify({cashOutlay:cash.plans[0].estimatedCost,cashMaterials:cashTotal,
    valueOutlay:chosen.estimatedCost,valueMaterials:chosen.materialValue,chemistry:facts.chemistry}));
  price85=150; const cheap85=await run(true);
  expect(cheap85.plans[0].selectedOwned.some(card=>card.rating===85)).toBe(true);
  expect(input.policy.maxRating).toBe(90);
});
