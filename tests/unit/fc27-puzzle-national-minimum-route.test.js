import { expect, it, vi } from 'vitest';
import { nationalMinimumFixture as fixture } from '../helpers/fc27-puzzle-national-minimum-fixture.js';
import { marketRow } from '../helpers/fc27-market-fixture.js';
import { planFc27PuzzleShortageQueries } from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { planPuzzleNationalMinimumAffinity } from '../../src/fc27/puzzle-query-affinity.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

it('targets the required silver nationality across leagues rather than deepening a capped bronze cluster', () => {
  const f = fixture();
  const route = planFc27PuzzleShortageQueries(f.input, [...f.bronze, ...f.silver], { usedQueries: f.pages });
  const remaining = route.queries.filter(query => !f.pages.some(old => JSON.stringify(old)===JSON.stringify(query)));
  expect(remaining[0]).toEqual({ start: 0, count: 20, level: 'silver', nation: 1 });
});
it('solves the eleven-player same-nation/min-silver/capped-league shape through the bounded production Session without writes', async () => {
  const f = fixture(), { input } = f, memory = new Map(), before = JSON.stringify(input);
  const witness = [...f.bronze.slice(0,3), ...f.target.slice(0,5), ...input.inventory.items.slice(2,5)];
  const facts = input.evaluateSquad(witness.map((row,slot) => ({ ...f.template, ...row, slot })));
  const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules;
  expect(matchFc27SbcRequirements({ requirements: rules, squad: witness, chemistry: facts.chemistry,
    teamRating: facts.teamRating, clubLinks: input.clubLinks }).status, JSON.stringify(facts)).toBe('satisfied');
  const transport = { readCatalogPage: vi.fn(async query => ({ status: 'observed', season: '27', source: 'ea-defid', query,
    observedAt: input.now, entries: (query.level==='bronze' ? f.bronze : query.nation===1 ? f.target : f.silver)
      .filter(row => !query.nation || row.nationId===query.nation).slice(query.start,query.start+query.count) })),
    readQuotePage: vi.fn(), buy: vi.fn(), move: vi.fn(), save: vi.fn(), submit: vi.fn() };
  const session = createFc27PuzzleProcurementSession({ createTransport: async () => transport, now: () => input.now,
    get: async (key,fallback) => structuredClone(memory.get(key)??fallback), set: async (key,value) => memory.set(key,structuredClone(value)),
    loadPublicPrices: async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
      { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futbin','futgg'].map(source => [source, { schema: 2, source, definitionId, season: '27', platform: 'pc', price: source==='futbin'?200:null,
        fetchedAt: input.now, expiresAt: input.now+300000, sourceUpdatedAt: null, error: source==='futbin'?null:'FC27_PUBLIC_PRICE_NOT_REQUESTED' }])) }])) }) });
  const result = await session.plan(input);
  expect(result.status, JSON.stringify({ reason: result.reason, queries: result.queries, diagnostics: result.diagnostics })).toBe('suggested');
  expect(transport.readCatalogPage.mock.calls.map(([query]) => query)).toEqual([...f.pages, { start: 0, count: 20, level: 'silver', nation: 1 }]);
  const plan = result.plans[0], squad = Array(11).fill(null), all = [...f.bronze,...f.silver,...f.target];
  for (const ref of plan.selectedOwned) squad[ref.slot] = input.inventory.items.find(row => row.id===ref.id);
  for (const ref of plan.purchases) squad[ref.slot] = all.find(row => row.definitionId===ref.definitionId);
  const check = input.evaluateSquad(squad.map((row,slot) => ({ ...f.template, ...row, slot })));
  expect(matchFc27SbcRequirements({ requirements: rules, squad, chemistry: check.chemistry, teamRating: check.teamRating, clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(transport.readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3); expect(result.diagnostics.nodes).toBeLessThanOrEqual(200000);
  expect(JSON.stringify(input)).toBe(before);
  console.info('NATIONAL_MINIMUM_EVIDENCE', JSON.stringify({ nodes: result.diagnostics.nodes, chemistry: check.chemistry, count: squad.length, purchases: plan.purchases.length, cost: plan.estimatedCost }));
  for (const key of ['readQuotePage','buy','move','save','submit']) expect(transport[key]).not.toHaveBeenCalled();
});

const affinity = () => {
  const f = fixture();
  return { candidates: [...f.bronze, ...f.silver], rules: parseFc27SbcRequirements(f.input.challenge.rawRequirements, 11).rules,
    required: 11, usedQueries: f.pages, allowedLevels: ['bronze', 'silver', 'gold'], excludedLeagueIds: [] };
};
it('keeps the initial broad reads and guards the new route to a native national minimum constrained by a league cap', () => {
  const f = fixture(); expect(planFc27PuzzleShortageQueries(f.input).queries.slice(0,2)).toEqual(f.pages);
  const input = affinity(); expect(planPuzzleNationalMinimumAffinity()).toBeNull();
  expect(planPuzzleNationalMinimumAffinity({ ...input, usedQueries: [f.pages[0]] })).toBeNull();
  for (const kind of ['same-nation','same-league','quality-count'])
    expect(planPuzzleNationalMinimumAffinity({ ...input, rules: input.rules.filter(rule => rule.kind!==kind) })).toBeNull();
  expect(planPuzzleNationalMinimumAffinity({ ...input, rules: input.rules.map(rule => rule.kind==='same-nation' ? { ...rule, mode: 'max' } : rule) })).toBeNull();
  expect(planPuzzleNationalMinimumAffinity({ ...input, rules: input.rules.map(rule => rule.kind==='same-league' ? { ...rule, value: 5 } : rule) })).toBeNull();
});
it('preserves quality and league exclusions and does not repeat an already sampled national page', () => {
  const input = affinity(); expect(planPuzzleNationalMinimumAffinity({ ...input, allowedLevels: ['bronze','gold'] })).toBeNull();
  expect(planPuzzleNationalMinimumAffinity({ ...input, excludedLeagueIds: [2] })).toBeNull();
  expect(planPuzzleNationalMinimumAffinity({ ...input, usedQueries: [...input.usedQueries, { start: 0, count: 20, level: 'silver', nation: 1 }] })).toBeNull();
});
it('deduplicates physical copies and retains the established fallback when national support is already sufficient', () => {
  const input = affinity(), candidate = input.candidates.find(row => row.nationId===1);
  const repeated = { ...input, candidates: [...input.candidates, ...Array(20).fill(candidate)] };
  expect(planPuzzleNationalMinimumAffinity(repeated)).toEqual({ start: 0, count: 20, level: 'silver', nation: 1 });
  const enough = { ...input, candidates: [...input.candidates, ...[1,2,3].map((i) => ({ ...candidate, definitionId: 9000+i, leagueId: 1+i%2 }))] };
  expect(planPuzzleNationalMinimumAffinity(enough)).toBeNull();
});
it.each(['locked','activeSquad'])('does not use %s inventory as national query support', flag => {
  const f = fixture(), before = JSON.stringify(f.input.policy);
  f.input.inventory.items.push(...Array.from({ length: 8 }, (_,i) => ({ ...f.template, id: 900+i, definitionId: 8000+i,
    rating: 70, nationId: 77, leagueId: 1+i%3, [flag]: true })));
  const route = planFc27PuzzleShortageQueries(f.input, [...f.bronze,...f.silver], { usedQueries: f.pages });
  expect(route.queries.at(-1)).toEqual({ start: 0, count: 20, level: 'silver', nation: 1 });
  expect(JSON.stringify(f.input.policy)).toBe(before);
});

it('keeps compulsory club discovery ahead of the new generic national affinity', () => {
  const f = fixture(); f.input.challenge.rawRequirements.push(marketRow(12, 77, 1));
  const route = planFc27PuzzleShortageQueries(f.input, [...f.bronze,...f.silver], { usedQueries: f.pages });
  expect(route.queries[0].team).toBe(77); expect(route.queries.length).toBeLessThanOrEqual(3);
});
