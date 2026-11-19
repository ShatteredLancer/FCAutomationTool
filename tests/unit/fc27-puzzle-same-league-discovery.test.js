import {expect,it,vi} from 'vitest';
import {puzzleFillFixture} from '../helpers/fc27-puzzle-fill-fixture.js';
import {marketRow} from '../helpers/fc27-market-fixture.js';
import {createFc27PuzzleProcurementSession} from '../../src/fc27/puzzle-procurement-session.js';
import {evaluateFc27PuzzleSquad} from '../../src/fc27/puzzle-evaluator.js';
import {parseFc27SbcRequirements,matchFc27SbcRequirements} from '../../src/fc27/sbc-requirements.js';
import {planPuzzleLeagueMinimumAffinity, planPuzzleCappedLeagueDiscovery} from '../../src/fc27/puzzle-query-affinity.js';

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

function cappedLeagueFixture({ missingPositionQuote = false } = {}) {
  const input = puzzleFillFixture(), base = input.inventory.items[0], memory = new Map(), trace = [];
  const positions = [1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 9];
  Object.assign(input.challenge, { setId: 116, id: 176, formation: { id: 16, positions }, rawRequirements: [
    marketRow(5, 4), marketRow(6, 3, -1, 1), marketRow(7, 2), marketRow(9, 5, -1, 1),
    marketRow(3, 2), marketRow(35, 18),
  ] });
  const spine = positions.map((position, i) => ({ ...base, definitionId: 1000 + i, marketable: true,
    rating: 70, leagueId: 40, teamId: 10 + Math.floor(i / 3), nationId: i % 2 + 1, positions: [position] }));
  input.policy.maxRating = 72;
  input.inventory.items = [
    { ...base, ...spine[0], id: 51, definitionId: 51, locked: true },
    { ...base, ...spine[1], id: 52, definitionId: 52, activeSquad: true },
    { ...base, ...spine[2], id: 53, definitionId: 53, rating: 79 },
    ...Array.from({ length: 101 }, (_, i) => ({ ...base, definitionId: 200 + i, id: 200 + i, rating: 79 })),
  ];
  Object.assign(input.marketPolicy, { budget: 6000, maxPurchases: 11, maxUnitPrice: 1000, availableCoins: 9000 });
  const noise = (definitionId, count, teamId, leagueId) => Array.from({ length: count }, (_, i) => ({
    ...spine[0], definitionId: definitionId + i, teamId, leagueId, nationId: 10 + i, positions: [1],
  }));
  const largeClub = noise(2000, 20, 91, 50), smallClub = noise(2100, 7, 142, 51);
  const start = [...spine.filter((_, i) => [0, 3, 6, 9].includes(i)), ...largeClub.slice(0, 5), ...smallClub.slice(0, 4),
    ...Array.from({ length: 7 }, (_, i) => ({ ...spine[i], definitionId: 3000 + i, leagueId: 60 + i,
      teamId: 60 + i, nationId: 60 + i }))];
  const backup = { ...spine.at(-1), definitionId: 1050, positions: [0] };
  const overRating = { ...spine.at(-1), definitionId: 1051, rating: 73 };
  // A valid 18+ chem squad can still use this off-position card after i=10 loses its quote.
  if (missingPositionQuote) start[19] = backup;
  const entries = [...start, ...spine, overRating, ...largeClub, ...smallClub];
  const transport = { readCatalogPage: vi.fn(async query => {
    trace.push({ query });
    const cards = query.level !== 'silver' ? [] : query.league === 40 ? [...spine, overRating]
      : query.team === 91 ? largeClub : query.team === 142 ? smallClub : query.league || query.team ? [] : start;
    const page = cards.slice(query.start, query.start + query.count);
    return { status: 'observed', source: 'ea-defid', season: '27', query,
      observedAt: input.now, entries: page, pageEndObserved: cards.length <= query.start + query.count };
  }), readQuotePage: vi.fn(), buy: vi.fn(), move: vi.fn(), save: vi.fn(), submit: vi.fn() };
  const loadPublicPrices = async ids => {
    trace.push({ ids });
    return { policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => {
      const price = missingPositionQuote && definitionId === 1010 ? null : definitionId === 1050 ? 200 : definitionId >= 2000 ? 400 : 250;
      return [definitionId, { definitionId, season: '27', platform: 'pc',
        quotes: Object.fromEntries(['futbin', 'futgg'].map(source => [source, { schema: 2, source,
          definitionId, season: '27', platform: 'pc', price, fetchedAt: input.now, expiresAt: input.now + 300000,
          sourceUpdatedAt: null, error: price === null ? 'FC27_PUBLIC_PRICE_NOT_FOUND' : null }])) }];
    })) };
  };
  const session = createFc27PuzzleProcurementSession({ createTransport: async () => transport, loadPublicPrices,
    now: () => input.now, get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)) });
  return { input, transport, trace, entries, spine, session };
}

it.each([false, true])('116/176 prices a position-complete multiclub league first (fallback=%s)', async missingPositionQuote => {
  const { input, trace, entries, spine, transport, session } = cappedLeagueFixture({ missingPositionQuote });
  const before = structuredClone(input.inventory);
  const run = () => session.plan(input, { optimizeMaterialValue: true, adaptiveSearch: true, quoteCeiling: 1000 });
  const result = await run();
  expect(result.status, JSON.stringify({ reason: result.reason, queries: result.queries, diagnostics: result.diagnostics })).toBe('suggested');
  expect(trace.slice(0, 3)).toEqual([
    { query: { start: 0, count: 20, level: 'silver' } },
    { query: { start: 0, count: 20, level: 'silver', league: 40 } },
    { ids: expect.arrayContaining(spine.map(card => card.definitionId)) },
  ]);
  expect(trace[2].ids).toHaveLength(11);
  const plan = result.plans[0], squad = Array(11).fill(null);
  expect(plan.selectedOwned).toEqual([]);
  for (const ref of plan.purchases) squad[ref.slot] = { ...input.inventory.items[0],
    ...entries.find(card => card.definitionId === ref.definitionId) };
  expect(squad.every(Boolean)).toBe(true);
  expect(new Set(squad.map(card => card.definitionId)).size).toBe(11);
  expect(matchFc27SbcRequirements({ requirements: parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules,
    squad, ...input.evaluateSquad(squad), clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(plan.purchases.some(card => card.definitionId === 1050)).toBe(missingPositionQuote);
  expect(plan.estimatedCost).toBe(missingPositionQuote ? 2700 : 2750);
  expect(result.diagnostics.budgetNodes).toBeLessThan(50000);
  expect(result.diagnostics.nodeCap).toBe(200000);
  expect(transport.readCatalogPage.mock.calls.length).toBe(2);
  expect(input.inventory).toEqual(before);
  expect(trace.flatMap(event => event.ids ?? []).filter(id => [51, 52, 53, 1051].includes(id))).toEqual([]);
  for (const name of ['readQuotePage', 'buy', 'move', 'save', 'submit']) expect(transport[name]).not.toHaveBeenCalled();
  if (!missingPositionQuote) {
    expect(trace.flatMap(event => event.ids ?? [])).toHaveLength(11);
    expect(result.diagnostics).toMatchObject({ searchComplete: false, optimalWithinPool: false });
    const warm = await run();
    expect(warm).toMatchObject({ status: 'suggested', requests: 0 });
  } else {
    expect(trace[3].ids).toContain(1050);
    expect(trace[3].ids).not.toContain(1010);
  }
});

it('does not count the same seat, version, or linked club twice in capped league discovery', () => {
  const { input, spine } = cappedLeagueFixture(), rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules;
  const goalkeeperOnly = Array.from({ length: 16 }, (_, i) => ({ ...spine[0], definitionId: 4000 + i,
    teamId: 100 + i % 4, leagueId: 10 }));
  const inputToRank = { candidates: [...goalkeeperOnly, ...spine, spine[0]], rules, slots: input.challenge.formation.positions,
    levels: ['silver'], usedQueries: [{ start: 0, count: 20, level: 'silver' }], resolveClub: id => id };
  const good = planPuzzleCappedLeagueDiscovery(inputToRank);
  expect(good.query.league).toBe(40);
  expect(good.focus.size).toBe(11);
  expect(planPuzzleCappedLeagueDiscovery({ ...inputToRank,
    resolveClub: id => id === 11 ? 10 : id }).focus).toBeNull();
  expect(planPuzzleCappedLeagueDiscovery({ ...inputToRank,
    candidates: [...goalkeeperOnly, ...spine.slice(0, -1), spine[0]] }).focus).toBeNull();
});
