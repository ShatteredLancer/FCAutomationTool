import { puzzleFillFixture } from './fc27-puzzle-fill-fixture.js';
import { marketRow } from './fc27-market-fixture.js';
import { boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';
import { matchFc27SbcRequirements, parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';

export function ratingPruneFixture() {
  const input = puzzleFillFixture(), base = input.inventory.items[0], prices = new Map();
  input.policy.maxRating = 82;
  input.challenge.brickIndices = [9,10];
  input.challenge.rawRequirements = [marketRow(5,4), marketRow(6,3,-1,1), marketRow(7,4,-1,1),
    marketRow(17,3,6), marketRow(19,70), marketRow(35,24)];
  input.inventory.items = Array.from({ length:7 }, (_,i) => ({ ...base, id:i+1, definitionId:70000+i,
    rating:i<5?65:75, teamId:100+i, nationId:45, leagueId:13 }));
  const entries = Array.from({ length:58 }, (_,i) => ({ definitionId:80000+i, rating:i<20?64:75,
    teamId:200+i, leagueId:13, nationId:45, positions:[5], rarity:0, groups:[], special:false, evolution:false, cosmetic:false }));
  entries.forEach(card => prices.set(card.definitionId, card.rating<75?200:1000));
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad, formation:input.challenge.formation,
    chemistry:input.chemistry, rating:input.chemistry.rating });
  const verify = selected => {
    const squad=Array(11).fill(null);
    selected.forEach((card,slot)=>{squad[slot]={...base,...card};});
    const facts=input.evaluateSquad(squad);
    return {facts,validation:matchFc27SbcRequirements({requirements:parseFc27SbcRequirements(input.challenge.rawRequirements,9).rules,
      squad:squad.filter(Boolean),chemistry:facts.chemistry,teamRating:facts.teamRating,clubLinks:input.clubLinks})};
  };
  return { input, entries, prices, verify };
}

export async function runRatingPruneSession(optimizeMaterialValue = false) {
  const x=ratingPruneFixture(),cache=new Map(),reads=[],writes=[],before=JSON.stringify(x.input);
  const result=await createFc27PuzzleProcurementSession({now:()=>x.input.now,
    get:async(key,fallback)=>structuredClone(cache.get(key)??fallback),set:async(key,value)=>cache.set(key,structuredClone(value)),
    list:async()=>[],loadCachedPrices:async()=>({hintOnly:true,prices:new Map()}),
    loadPublicPrices:async ids=>({policy:{source:'futbin'},references:Object.fromEntries(ids.map(definitionId=>[definitionId,{
      definitionId,season:'27',platform:'pc',quotes:Object.fromEntries(['futbin','futgg'].map(source=>[source,{
        schema:2,source,definitionId,season:'27',platform:'pc',price:x.prices.get(definitionId)??1000,
        fetchedAt:x.input.now,expiresAt:x.input.now+300000,sourceUpdatedAt:null,error:null}]))}]))}),
    createTransport:async()=>{
      const write=()=>{writes.push('unexpected-write');throw Error('No EA writes in planning');};
      return {buy:write,move:write,save:write,submit:write,readCatalogPage:async query=>{
        reads.push(query);
        const rows=x.entries.filter(card=>query.level===(card.rating<65?'bronze':card.rating<75?'silver':'gold')
          &&(!query.league||query.league===card.leagueId)&&(!query.nation||query.nation===card.nationId)
          &&(!query.team||query.team===card.teamId)).slice(query.start,query.start+query.count);
        return {status:'observed',source:'ea-defid',season:'27',query,observedAt:x.input.now,entries:rows,pageEndObserved:rows.length<query.count};
      }};
    },
  }).plan(x.input,{optimizeMaterialValue});
  return {result,reads,writes,inputUnchanged:before===JSON.stringify(x.input)};
}
