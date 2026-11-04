import { expect, it } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';
import { readFc27PuzzleCatalogHints } from '../../src/fc27/puzzle-catalog-hints.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';

it('evaluates a cheap historical direction against the current feasible scaffold, not as a standalone nine-card replacement',async()=>{
  const input=puzzleFillFixture(),base=input.inventory.items[0];input.policy.maxRating=82;
  input.challenge.brickIndices=[9,10];
  input.challenge.rawRequirements=[marketRow(5,4),marketRow(6,3,-1,1),marketRow(7,4,-1,1),marketRow(17,3,6),marketRow(19,70),marketRow(35,24)];
  input.inventory.items=[{...base,id:1,definitionId:70001,rating:72,nationId:18,leagueId:19,teamId:40}];
  const scaffold=Array.from({length:8},(_,i)=>({definitionId:80001+i,rating:78,rarity:0,groups:[],nationId:18,leagueId:19,
    teamId:10+Math.floor(i/3),positions:[5],special:false,evolution:false,cosmetic:false}));
  const incumbent={status:'preview',selected:[...scaffold.map((c,slot)=>({catalogRef:`fc27:${c.definitionId}`,definitionId:c.definitionId,rating:c.rating,slot})),
    {id:1,definitionId:70001,pile:'club',rating:72,slot:8}]};
  const cheap={...scaffold[0],definitionId:90001},query={start:0,count:20,level:'gold',nation:18};
  const key=`fcat-fc27-puzzle-market:${traditionalJournalScope(input.context)}:catalog:${JSON.stringify(query)}`;
  const result=await readFc27PuzzleCatalogHints({input,list:async()=>[key],get:async()=>({schema:1,kind:'catalog',state:'observed',query,at:input.now-172800000,
    result:{status:'observed',source:'ea-defid',season:'27',query,observedAt:input.now-172800000,entries:[scaffold[1],cheap]}}),
    readPrices:async()=>({hintOnly:true,prices:new Map([[cheap.definitionId,700]])}),prices:new Map(scaffold.map(c=>[c.definitionId,2500])),
    materialPrices:null,usedQueries:[],costCeiling:20000,now:()=>input.now,scaffold,incumbent});
  expect(result.queries).toEqual([query]);expect(result.nodes).toBeLessThanOrEqual(24000);
  expect(Object.keys(result).sort()).toEqual(['nodes','pairs','queries']);
});

it('keeps a gold upgrade direction in the bounded sample when cheap bronze floors ignore an eight-gold requirement',async()=>{
  const input=puzzleFillFixture(),base=input.inventory.items[0];input.policy.maxRating=82;input.challenge.brickIndices=[9,10];
  input.challenge.rawRequirements=[marketRow(5,4),marketRow(6,3,-1,1),marketRow(17,3,8),marketRow(19,70),marketRow(35,24)];
  input.inventory.items=[{...base,id:1,definitionId:70001,rating:78,nationId:18,leagueId:19,teamId:40}];
  const scaffold=Array.from({length:8},(_,i)=>({definitionId:80001+i,rating:78,rarity:0,groups:[],nationId:18,leagueId:19,
    teamId:10+Math.floor(i/3),positions:[5],special:false,evolution:false,cosmetic:false}));
  const incumbent={status:'preview',selected:[...scaffold.map((c,slot)=>({catalogRef:`fc27:${c.definitionId}`,definitionId:c.definitionId,rating:c.rating,slot})),
    {id:1,definitionId:70001,pile:'club',rating:78,slot:8}]};
  const prices=new Map(scaffold.map(c=>[c.definitionId,2500])),history=new Map(),cached=new Map();
  const add=(query,entries)=>{
    const key=`fcat-fc27-puzzle-market:${traditionalJournalScope(input.context)}:catalog:${JSON.stringify(query)}`;
    history.set(key,{schema:1,kind:'catalog',state:'observed',query,at:input.now-172800000,
      result:{status:'observed',source:'ea-defid',season:'27',query,observedAt:input.now-172800000,entries}});
  };
  for(let i=0;i<13;i++){
    const card={...scaffold[0],definitionId:90000+i,rating:64,teamId:100+i};cached.set(card.definitionId,150);
    add({start:0,count:20,level:'bronze',team:100+i},[card]);
  }
  const gold=scaffold.slice(0,2).map((card,i)=>({...card,definitionId:91000+i}));gold.forEach(c=>cached.set(c.definitionId,700));
  const query={start:0,count:20,level:'gold',nation:18};add(query,gold);
  const result=await readFc27PuzzleCatalogHints({input,list:async()=>[...history.keys()],get:async key=>history.get(key),
    readPrices:async()=>({hintOnly:true,prices:cached}),prices,materialPrices:null,usedQueries:[],costCeiling:20000,
    now:()=>input.now,scaffold,incumbent});
  expect(result.queries).toContainEqual(query);expect(result.pairs).toBeLessThanOrEqual(12);expect(result.nodes).toBeLessThanOrEqual(24000);
});
