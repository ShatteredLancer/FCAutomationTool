import { expect, it, vi } from 'vitest';
import { minimumQualityFixture } from '../helpers/fc27-puzzle-minimum-quality-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';
import { previewFc27PuzzleSquad } from '../../src/fc27/puzzle-preview.js';
import { planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { prepareFc27PuzzleFillPlan } from '../../src/fc27/puzzle-fill-plan.js';
import { prepareFc27PuzzleConceptDraft, validateFc27PuzzleConceptDraft } from '../../src/fc27/puzzle-concept-draft.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

it.each([1, 2])('admits necessary higher-quality identity cards above native minimum %i through owned and concept verification', tier => {
  const { input, entries, owned, need } = minimumQualityFixture(tier), before = JSON.stringify(input);
  const mixed = suggestFc27PuzzleJointPurchases(input, entries, { prices: new Map(entries.map(card => [card.definitionId, 200])) });
  expect(mixed, JSON.stringify(mixed)).toMatchObject({ status: 'suggested' });
  const suggestion = mixed.plans[0];
  expect(suggestion.purchases.filter(card => card.rating >= 75)).toHaveLength(need);
  expect(mixed.nodes).toBeLessThanOrEqual(50000);
  const priced = { ...suggestion, purchases: suggestion.purchases.map(card => ({ ...card, estimatedUnitPrice: 200 })) };
  const draft = prepareFc27PuzzleConceptDraft(input, priced);
  expect(draft, JSON.stringify(draft)).toMatchObject({ status: 'prepared' });
  expect(validateFc27PuzzleConceptDraft(draft, input, [])).toMatchObject({ status: 'verified' });
  expect(JSON.stringify(input)).toBe(before);
  input.inventory.items = owned();
  const preview = previewFc27PuzzleSquad(input);
  expect(preview).toMatchObject({ status: 'preview' });
  expect(prepareFc27PuzzleFillPlan(input, preview)).toMatchObject({ status: 'prepared' });
});

it.each([1, 2])('retains required club/nation query lanes for a single preferred tier %i', tier => {
  const { input, nation } = minimumQualityFixture(tier);
  const route = planFc27PuzzleShortageQueries(input);
  expect(route.queries.length).toBeLessThanOrEqual(3);
  expect(route.queries[0]).toMatchObject({ level: 'gold', team: 1001 });
  expect(route.queries.some(query => query.nation === nation && query.level === (tier === 1 ? 'bronze' : 'silver'))).toBe(true);
  expect(route.queries.every(query => query.count === 20)).toBe(true);
});

it.each([1,2])('widens league diversity after the compulsory identity/nation pages for tier %i',tier=>{
  const {input,entries,nation}=minimumQualityFixture(tier),level=tier===1?'bronze':'silver';
  const usedQueries=[{start:0,count:20,level:'gold',team:1001},{start:0,count:20,level,nation}];
  const route=planFc27PuzzleShortageQueries(input,entries.map(card=>({...card,leagueId:1})),{usedQueries});
  expect(route.queries[0]).toEqual({start:0,count:20,level});
});

it.each([1, 2])('solves the minimum-%i identity shape through the real bounded Procurement Session without writes', async tier => {
  const { input, entries, nation } = minimumQualityFixture(tier), cache = new Map(), before = JSON.stringify(input);
  const transport = { readCatalogPage: vi.fn(async query => ({ status: 'observed', source: 'ea-defid', season: '27',
    observedAt: input.now, query, entries: entries.filter(card => query.level === (card.rating < 65 ? 'bronze' : card.rating < 75 ? 'silver' : 'gold')
      && (!query.team || card.teamId === query.team) && (!query.nation || card.nationId === query.nation)
      && (!query.league || card.leagueId === query.league)).slice(query.start, query.start + query.count) })),
    readQuotePage: vi.fn(async query => ({ season: '27', platform: input.context.platform, source: 'ea-visible-buy-now',
      status: 'observed', definitionId: query.definitionId, observedAt: input.now, eligible: 1, price: 200 })),
    buy: vi.fn(), move: vi.fn(), save: vi.fn(), submit: vi.fn() };
  const session = createFc27PuzzleProcurementSession({ createTransport: async () => transport, now: () => input.now,
    get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback), set: async (key, value) => cache.set(key, structuredClone(value)) });
  const result = await session.plan(input, { quoteCeiling: 250 });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'suggested' });
  const plan = result.plans[0], squad = Array(11).fill(null);
  for (const card of plan.purchases) squad[card.slot] = entries.find(item => item.definitionId === card.definitionId);
  const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules;
  expect(matchFc27SbcRequirements({ requirements: rules, squad, chemistry: plan.teamFacts.chemistry,
    teamRating: plan.teamFacts.teamRating, clubLinks: input.clubLinks })).toMatchObject({ status: 'satisfied' });
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  expect(transport.readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3);
  expect(transport.readCatalogPage.mock.calls.some(([query]) => query.team === 1001)).toBe(true);
  expect(transport.readCatalogPage.mock.calls.some(([query]) => query.nation === nation)).toBe(true);
  const count = transport.readCatalogPage.mock.calls.length;
  expect((await session.plan(input, { quoteCeiling: 250 })).status).toBe('suggested');
  expect(transport.readCatalogPage).toHaveBeenCalledTimes(count);
  expect(JSON.stringify(input)).toBe(before);
  for (const name of ['buy', 'move', 'save', 'submit']) expect(transport[name]).not.toHaveBeenCalled();
});

it('keeps a feasible low-quality composition ahead of higher-quality alternatives', () => {
  const { input, owned, need } = minimumQualityFixture(1);
  input.inventory.items = owned();
  input.inventory.items.push(...input.inventory.items.slice(0, need).map(card => ({ ...card, id: card.id + 100, definitionId: card.definitionId + 100, rating: 60 })));
  const result = previewFc27PuzzleSquad(input);
  expect(result).toMatchObject({ status: 'preview' });
  expect(result.selected.every(ref => ref.rating < 65)).toBe(true);
});

it.each([150, 500, 600])('compares full squad cost across native-valid quality vectors, preferring the low tier only on a tie (%i)', price => {
  const { input, entries } = minimumQualityFixture(1);
  input.challenge.rawRequirements = [marketRow(3, 1)]; entries[0].rating = 60;
  const extra = { ...entries[1], definitionId: 6000, rating: 80 };
  const prices = new Map([...entries.map((card, index) => [card.definitionId, index ? 500 : 200]), [extra.definitionId, price]]);
  const result = suggestFc27PuzzleJointPurchases(input, [...entries, extra], { prices });
  expect(result.status).toBe('suggested');
  const chosen = result.plans[0].purchases;
  expect(chosen.reduce((sum, card) => sum + prices.get(card.definitionId), 0)).toBe(price < 500 ? 4850 : 5200);
  expect(chosen.some(card => card.definitionId === 6000)).toBe(price < 500);
  expect(result.nodes).toBeLessThanOrEqual(50000);
  expect(prepareFc27PuzzleConceptDraft(input, { ...result.plans[0], purchases: chosen.map(card => ({
    ...card, estimatedUnitPrice: prices.get(card.definitionId) })) }).status).toBe('prepared');
});

it('retains explicit native quality ceilings, FSU gold range, locks/main squad and personal caps', () => {
  const { input, entries, owned } = minimumQualityFixture(2);
  input.challenge.rawRequirements.push(marketRow(3, 2, -1, 1));
  expect(suggestFc27PuzzleJointPurchases(input, entries).status).toBe('blocked');
  expect(planFc27PuzzleShortageQueries(input).queries.every(query => query.level !== 'gold')).toBe(true);
  input.inventory.items = owned();
  expect(planFc27PuzzleShortageQueries(input).queries[0]).toMatchObject({team:1001,level:'silver'});
  input.inventory.items = [];
  input.challenge.rawRequirements.pop(); input.policy.maxRating = 74;
  expect(suggestFc27PuzzleJointPurchases(input, entries).status).toBe('blocked');
  input.policy.maxRating = 85; input.policy.goldRange = [81, 85];
  expect(suggestFc27PuzzleJointPurchases(input, entries).status).toBe('blocked');
  input.policy.goldRange = [75, 83]; input.inventory.items = owned();
  input.inventory.items[0].locked = true; input.inventory.items[1].activeSquad = true;
  expect(previewFc27PuzzleSquad(input).status).toBe('blocked');
});

it('shares one node budget across the preference and native-quality phases without resetting progress', () => {
  const { input, owned } = minimumQualityFixture(1);
  input.inventory.items = owned();
  input.inventory.items.forEach(card=>{card.rating=60;});
  const base=input.inventory.items[0];
  input.inventory.items.push({...base,id:99,definitionId:999,rating:80});
  input.evaluateSquad = squad=>({status:'observed',chemistry:squad.some(card=>card.rating===80)?33:0,teamRating:65});
  const progress=[];
  const result=previewFc27PuzzleSquad({...input,maxNodes:300,onProgress:value=>progress.push(value)});
  expect(result).toMatchObject({status:'preview',materialPreference:'native-quality-fallback',maxNodes:300});
  expect(result.nodes).toBeLessThanOrEqual(300);
  expect(result.nodes).toBe(Object.values(result.search).reduce((sum,value)=>sum+value,0));
  expect(progress.every(value=>value.maxNodes===300 && value.nodes<=300)).toBe(true);
  expect(progress.every((value,index)=>!index || value.nodes>=progress[index-1].nodes)).toBe(true);
});
