import { expect, it, vi } from 'vitest';
import { largeGoldClubFixture } from '../helpers/fc27-puzzle-gold-club-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';

// A pricing-boundary control, not Viva's private inventory/formation/prices.
function fixture(count=251) {
  const { input,pages }=largeGoldClubFixture(count);
  const cache=new Map();
  const loadPublicPrices=vi.fn(async ids=>({policy:{source:'futbin'},references:Object.fromEntries(ids.map(definitionId=>[
    definitionId,{definitionId,season:'27',platform:'pc',quotes:Object.fromEntries(['futgg','futbin'].map(source=>[source,
      {schema:2,source,definitionId,season:'27',platform:'pc',price:definitionId>=2001&&definitionId<4000?200:2000,
        fetchedAt:input.now,expiresAt:input.now+300000,sourceUpdatedAt:null,error:null}]))}]))}));
  const readCatalogPage=vi.fn(async query=>({status:'observed',source:'ea-defid',season:'27',query,observedAt:input.now,
    entries:pages.find(page=>JSON.stringify(page.query)===JSON.stringify(query))?.entries??[]}));
  const options={now:()=>input.now,get:async(key,fallback)=>structuredClone(cache.get(key)??fallback),
    set:async(key,value)=>cache.set(key,structuredClone(value)),loadPublicPrices,
    createTransport:async()=>({readCatalogPage,readQuotePage:vi.fn()})};
  return {input,options,loadPublicPrices,readCatalogPage};
}

it.each([250,251])('compares complete material costs against a priced owned baseline with %s safe definitions without widening the 250-ID loader',async count=>{
  const x=fixture(count);
  const result=await createFc27PuzzleProcurementSession(x.options).plan(x.input,{optimizeMaterialValue:true,materialCeiling:16000});
  expect(result.status,JSON.stringify(result)).toBe('suggested');
  expect(result.diagnostics.objective).toBe('material-value');
  expect(result.plans[0].materialValue).toBeLessThan(16000);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(22);
  expect(result.diagnostics.scopeTruncated).toBe(count>250);
  expect(x.loadPublicPrices.mock.calls.every(([ids])=>ids.length<=250)).toBe(true);
  expect(x.readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3);
  expect(result.globalMinimumProven).toBe(false);
  if(count>250) expect(result.plans[0].selectedOwned.some(item=>item.definitionId===x.input.inventory.items.at(-1).definitionId)).toBe(false);
},30000);

it('retains the original cash-feasibility fallback when there is no priced baseline to compare',async()=>{
  const x=fixture();
  const result=await createFc27PuzzleProcurementSession(x.options).plan(x.input,{optimizeMaterialValue:true});
  expect(result).toMatchObject({status:'suggested',diagnostics:{objective:'additional-coins',scopeTruncated:true},
    plans:[{materialValue:null,valueReason:'FC27_PUZZLE_VALUE_INCOMPLETE'}]});
});

it.each(['missing','expired'])('excludes %s owned values rather than treating them as free or falling back to the other source',async mode=>{
  const x=fixture(),load=x.loadPublicPrices.getMockImplementation(),unknown=10009;
  x.loadPublicPrices.mockImplementation(async(...args)=>{
    const snapshot=await load(...args),reference=snapshot.references[unknown];
    if(reference){
      reference.quotes.futgg.price=150;
      if(mode==='missing') reference.quotes.futbin.price=null;
      else {reference.quotes.futbin.fetchedAt=x.input.now-300001;reference.quotes.futbin.expiresAt=x.input.now-1;}
    }
    return snapshot;
  });
  const result=await createFc27PuzzleProcurementSession(x.options).plan(x.input,{optimizeMaterialValue:true,materialCeiling:16000});
  expect(result).toMatchObject({status:'suggested',diagnostics:{objective:'material-value',scopeTruncated:true,unknownCount:2}});
  expect(result.plans[0].materialValue).toBeLessThan(16000);
  expect(result.plans[0].selectedOwned.some(item=>[unknown,x.input.inventory.items.at(-1).definitionId].includes(item.definitionId))).toBe(false);
});

it('does not manufacture a cheaper plan from unquoted owned cards or replace the priced baseline with a more expensive squad',async()=>{
  const x=fixture(),load=x.loadPublicPrices.getMockImplementation();
  x.loadPublicPrices.mockImplementation(async(...args)=>{
    const snapshot=await load(...args);
    for(const row of Object.values(snapshot.references)) if(row.definitionId>=2001&&row.definitionId<4000) {
      row.quotes.futbin.price=3000; row.quotes.futgg.price=150;
    }
    return snapshot;
  });
  const result=await createFc27PuzzleProcurementSession(x.options).plan(x.input,{optimizeMaterialValue:true,materialCeiling:16000});
  expect(result.status).toBe('blocked');
  expect(result.plans).toEqual([]);
  expect(result.diagnostics).toMatchObject({objective:'material-value',scopeTruncated:true,unknownCount:1});
});
