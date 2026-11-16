import { expect, it, vi } from 'vitest';
import { tenSilverFixture } from '../helpers/fc27-puzzle-ten-silver-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { planFc27PuzzleShortageQueries } from '../../src/fc27/puzzle-procurement.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

function fixture() {
  const f = tenSilverFixture(), { input, silver, target, second, bronze } = f, memory = new Map();
  const transport = { readCatalogPage: vi.fn(async query => ({ status: 'observed', source: 'ea-defid', season: '27', query, observedAt: input.now,
    entries: (query.level==='bronze' ? bronze : query.team===2 ? target : query.team===3 ? second : silver)
      .filter(card => !query.team || card.teamId===query.team).slice(query.start,query.start+query.count) })),
    readQuotePage: vi.fn(), buy: vi.fn(), move: vi.fn(), save: vi.fn(), submit: vi.fn() };
  const options = { now: () => input.now,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback), set: async (key, value) => memory.set(key, structuredClone(value)),
    createTransport: async () => transport,
    loadPublicPrices: async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
      { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futbin','futgg'].map(source => [source,
        { schema: 2, source, definitionId, season: '27', platform: 'pc', price: source==='futbin' ? definitionId>=5000 ? 1000 : 200 : null,
          fetchedAt: input.now, expiresAt: input.now+300000, sourceUpdatedAt: null,
          error: source==='futbin' ? null : 'FC27_PUBLIC_PRICE_NOT_REQUESTED' }])) }])) }) };
  return { ...f, transport, options };
}
const run = (f, options={}) => createFc27PuzzleProcurementSession(f.options).plan(f.input,
  { optimizeMaterialValue: true, adaptiveSearch: true, ...options });
const noWrites = f => { for (const key of ['readQuotePage','buy','move','save','submit']) expect(f.transport[key]).not.toHaveBeenCalled(); };

it.each([true,false])('grows the silver backbone across clubs without exhausting stages (material value=%s)', async value => {
  const f = fixture(), { input, base, known } = f, before = JSON.stringify(input), progress = [];
  const facts = input.evaluateSquad(known.map((card, slot) => ({ ...base, ...card, slot })));
  const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules;
  expect(matchFc27SbcRequirements({ requirements: rules, squad: known, ...facts, clubLinks: input.clubLinks }).status).toBe('satisfied');
  const result = await run(f,{ optimizeMaterialValue: value, onProgress: value=>progress.push(value) });
  expect(result.status,JSON.stringify({reason:result.reason,diagnostics:result.diagnostics})).toBe('suggested');
  const plan=result.plans[0], squad=Array(11).fill(null), market=[...f.silver,...f.target,...f.second,...f.bronze];
  for(const ref of plan.selectedOwned) squad[ref.slot]=input.inventory.items.find(c=>c.id===ref.id);
  for(const ref of plan.purchases) squad[ref.slot]={...base,...market.find(c=>c.definitionId===ref.definitionId)};
  const actual=input.evaluateSquad(squad);
  expect(matchFc27SbcRequirements({requirements:rules,squad,...actual,clubLinks:input.clubLinks}).status).toBe('satisfied');
  expect(squad.filter(card=>card.rating>=65&&card.rating<75).length).toBeGreaterThanOrEqual(10);
  expect(new Set(squad.map(c=>c.definitionId)).size).toBe(11);
  expect(new Set(squad.map(c=>c.teamId)).size).toBeLessThanOrEqual(5);
  expect(f.transport.readCatalogPage.mock.calls.map(([query])=>query)).toEqual([
    {start:0,count:20,level:'silver'},{start:0,count:20,level:'silver',team:2},{start:0,count:20,level:'silver',team:3}]);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(10000);
  expect(result.diagnostics.budgetNodes).toBe(result.diagnostics.nodes);
  expect(progress.some(p=>p.phase==='local-market-search')).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
  const again=await run(f,{optimizeMaterialValue:value});
  expect(again.status).toBe('suggested');expect(again.requests).toBe(0);
  expect(again.plans[0].estimatedCost).toBe(plan.estimatedCost);
  noWrites(f);
  console.info('TEN_SILVER_CONTROL',JSON.stringify({value,nodes:result.diagnostics.nodes,chemistry:actual.chemistry,
    silver:squad.filter(c=>c.rating>=65&&c.rating<75).length,clubs:new Set(squad.map(c=>c.teamId)).size}));
});

it.each(['locked','activeSquad'])('does not use %s owned silver cards to redirect the new discovery lane', flag=>{
  const f=fixture();f.input.inventory.items.push(...Array.from({length:8},(_,i)=>({...f.base,id:9000+i,definitionId:9000+i,rating:65,teamId:1,[flag]:true})));
  const used=[{start:0,count:20,level:'silver'},{start:0,count:20,level:'silver',team:2}];
  const entries=[...f.silver,...f.target,...Array.from({length:8},(_,i)=>({...f.silver[0],definitionId:9500+i,teamId:1,special:true}))];
  expect(planFc27PuzzleShortageQueries(f.input,entries,{usedQueries:used}).queries[0]).toEqual({start:0,count:20,level:'silver',team:3});
});

it.each(['FC27_MARKET_HTTP_401','FC27_MARKET_HTTP_429'])('preserves %s during the new targeted page',async reason=>{
  const f=fixture(),read=f.transport.readCatalogPage.getMockImplementation();
  f.transport.readCatalogPage.mockImplementation(query=>{if(query.team===3)throw Error(reason);return read(query);});
  expect(await run(f)).toMatchObject({status:'blocked',reason,plans:[]});noWrites(f);
});

it('still blocks input changes after the third page instead of filling a stale result',async()=>{
  const f=fixture(),read=f.transport.readCatalogPage.getMockImplementation();let changed=false;
  f.transport.readCatalogPage.mockImplementation(async query=>{const page=await read(query);if(query.team===3)changed=true;return page;});
  expect(await run(f,{assertCurrent:()=>{if(changed)throw Error('FC27_PUZZLE_FILL_INPUTS_CHANGED');}}))
    .toMatchObject({status:'blocked',reason:'FC27_PUZZLE_FILL_INPUTS_CHANGED',plans:[]});noWrites(f);
});

it('keeps the original quote ceiling rather than raising it to reach missing silver targets',async()=>{
  const f=fixture();expect(await run(f,{quoteCeiling:150})).toMatchObject({status:'blocked',plans:[]});
  expect(f.input.marketPolicy.maxUnitPrice).toBe(2000);noWrites(f);
});

it('grows another silver club when one of six first-club versions has no selected-source quote',async()=>{
  const f=fixture(),load=f.options.loadPublicPrices;
  f.options.loadPublicPrices=async ids=>{
    const snapshot=await load(ids),row=snapshot.references[1104];
    if(row){row.quotes.futbin.price=null;row.quotes.futgg.price=150;row.quotes.futgg.error=null;}
    return snapshot;
  };
  const result=await run(f);
  expect(result.status).toBe('suggested');
  expect(result.plans[0].purchases.some(c=>c.definitionId===1104)).toBe(false);
  expect(result.diagnostics.excludedUnavailable).toBeGreaterThan(0);
  expect(result.diagnostics.nodes).toBeLessThan(10000);
  expect(f.transport.readCatalogPage.mock.calls.at(-1)[0]).toEqual({start:0,count:20,level:'silver',team:3});
  noWrites(f);
});
