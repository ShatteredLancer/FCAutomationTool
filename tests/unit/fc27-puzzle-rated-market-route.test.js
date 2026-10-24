import { expect, it, vi } from 'vitest';
import observation from '../fixtures/fc27-puzzle-rating-2026-10-24.json';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { planFc27MarketQueryRoute } from '../../src/fc27/market-query-route.js';
import { planFc27PuzzleShortageQueries, marketCandidates, suggestFc27PuzzleJointPurchases,
  puzzleOwnedValueCandidates } from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';

function fixture() {
  const input = puzzleFillFixture();
  Object.assign(input.challenge, { setId: observation.setId, id: observation.challengeId,
    rawRequirements: structuredClone(observation.requirements) });
  input.policy.maxRating = 82; input.inventory.items = [];
  const entries = Array.from({ length: 11 }, (_, index) => ({ definitionId: 5000 + index,
    rating: 75, rarity: 0, nationId: 1, leagueId: index < 2 ? 10 : 20 + Math.floor((index - 2) / 3),
    teamId: index === 0 ? 241 : index === 1 ? 243 : 500 + Math.floor((index - 2) / 3),
    positions: [5], groups: [], special: false, evolution: false, cosmetic: false }));
  return { input, entries };
}

it('does not spend all three 75-rated Challenge queries on bronze cards when quality is unrestricted', () => {
  const { input } = fixture(), before = JSON.stringify(input);
  const route = planFc27MarketQueryRoute(input);
  expect(route).toMatchObject({ status: 'ready', complete: false, executable: false });
  expect(route.queries).toHaveLength(3);
  expect(route.queries[0]).toMatchObject({ level: 'gold', team: 241 });
  expect(route.queries.some(query => query.level === 'gold' && !query.team)).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
});

it('retains a rating-capable tier in shortage follow-up queries instead of deriving a bronze-only route', () => {
  const { input } = fixture();
  for (const usedQueries of [[], [{ start: 0, count: 20, level: 'gold', team: 241 }]]) {
    const route = planFc27PuzzleShortageQueries(input, [], { usedQueries });
    expect(route.status).toBe('ready');
    expect(route.queries.length).toBeLessThanOrEqual(3);
    expect(route.queries.some(query => query.level === 'gold')).toBe(true);
  }
});

it.each([[64, 0, 'bronze'], [65, 0, 'silver'], [74, 0, 'silver'], [75, 0, 'gold'],
  [75, 2, 'gold'], [75, 1, 'bronze']])('orders tiers for rating %i scope %i without inventing a per-card minimum', (rating, scope, level) => {
  const { input } = fixture();
  input.challenge.rawRequirements = [{ count: -1, scope, pairs: [{ key: 19, values: [rating] }] }];
  const queries = planFc27MarketQueryRoute(input).queries;
  expect(queries[0].level).toBe(level);
  expect(new Set(queries.map(query => query.level))).toEqual(new Set(['bronze', 'silver', 'gold']));
});

it('keeps the original low-tier route without a rating floor, and honors explicit quality requirements', () => {
  const { input } = fixture();
  input.challenge.rawRequirements = structuredClone(observation.requirements).filter(row => row.pairs[0].key !== 19);
  expect(planFc27MarketQueryRoute(input).queries.every(query => query.level === 'bronze')).toBe(true);
  input.challenge.rawRequirements = [...structuredClone(observation.requirements),
    { count: -1, scope: 2, pairs: [{ key: 3, values: [2] }] }];
  expect(planFc27MarketQueryRoute(input).queries.every(query => query.level === 'silver')).toBe(true);
  input.challenge.rawRequirements = [input.challenge.rawRequirements.at(-1),
    { count: 6, scope: 0, pairs: [{ key: 17, values: [3] }] }];
  input.challenge.rawRequirements[0].scope = 0;
  const levels = new Set(planFc27PuzzleShortageQueries(input).queries.map(query => query.level));
  expect(levels).toEqual(new Set(['silver', 'gold']));
});

it('retains a cheaper silver/gold mixture when its complete squad rating meets 75', () => {
  const { input, entries } = fixture(); entries[10].rating = 74;
  const prices = new Map(entries.map(card => [card.definitionId, card.rating < 75 ? 150 : 300]));
  const result = suggestFc27PuzzleJointPurchases(input, entries, { prices });
  expect(result).toMatchObject({ status: 'suggested', estimatedCost: 3150 });
  expect(result.plans[0].purchases.some(card => card.rating === 74)).toBe(true);
  expect(result.plans[0].teamFacts.teamRating).toBeGreaterThanOrEqual(75);
});

it('does not lift the personal cap, gold range or owned lock/main-squad protections', () => {
  const { input, entries } = fixture(); input.policy.maxRating = 74;
  expect(planFc27MarketQueryRoute(input).queries.some(query => query.level === 'gold')).toBe(false);
  expect(marketCandidates(input, entries)).toEqual([]);
  input.policy.maxRating = 82; input.policy.goldRange = [80, 82];
  expect(marketCandidates(input, entries)).toEqual([]);
  expect(marketCandidates(input, [{ ...entries[0], rating: 80 }])).toHaveLength(1);
  const template = puzzleFillFixture().inventory.items[0];
  input.inventory.items = [
    { ...template, rating: 80, id: 90, definitionId: 9090, locked: true },
    { ...template, rating: 80, id: 91, definitionId: 9091, activeSquad: true },
  ];
  expect(puzzleOwnedValueCandidates(input)).toEqual([]);
  expect(input.policy).toMatchObject({ protectFsuLockedPlayers: true, protectActiveSquad: true, maxRating: 82, goldRange: [80, 82] });
});

it('plans a fully checked all-market squad for the pictured rating/chemistry rules without purchasing or saving', async () => {
  const { input, entries } = fixture(), cache = new Map(), before = JSON.stringify(input);
  const transport = { readCatalogPage: vi.fn(async query => ({ status: 'observed', source: 'ea-defid', season: '27',
    observedAt: input.now, query, entries: (query.level === 'gold' ? entries : entries.map(card => ({ ...card, rating: 60 })))
      .filter(card => !query.team || card.teamId === query.team) })),
    readQuotePage: vi.fn(), buy: vi.fn(), save: vi.fn(), move: vi.fn() };
  const prices = vi.fn(async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
    { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
      { schema: 2, source, definitionId, season: '27', platform: 'pc', price: 300, fetchedAt: input.now,
        sourceUpdatedAt: null, expiresAt: input.now + 300000, error: null }])) }])) }));
  const options = { createTransport: async () => transport, loadPublicPrices: prices, now: () => input.now,
    get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback),
    set: async (key, value) => cache.set(key, structuredClone(value)) };
  const result = await createFc27PuzzleProcurementSession(options).plan(input, { optimizeMaterialValue: true });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'suggested' });
  const plan = result.plans[0];
  expect(plan).toMatchObject({ purchaseCount: 11, selectedOwned: [], estimatedCost: 3300 });
  expect(plan.teamFacts.teamRating).toBeGreaterThanOrEqual(75);
  expect(plan.teamFacts.chemistry).toBeGreaterThanOrEqual(26);
  const squad = plan.purchases.map(card => entries.find(entry => entry.definitionId === card.definitionId));
  const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 11).rules;
  expect(matchFc27SbcRequirements({ requirements: rules, squad, chemistry: plan.teamFacts.chemistry,
    teamRating: plan.teamFacts.teamRating, clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  expect(transport.readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3);
  expect(JSON.stringify(input)).toBe(before);
  for (const method of ['readQuotePage', 'buy', 'save', 'move']) expect(transport[method]).not.toHaveBeenCalled();
  const readCount = transport.readCatalogPage.mock.calls.length;
  const again = await createFc27PuzzleProcurementSession(options).plan(input, { optimizeMaterialValue: true });
  expect(again.status).toBe('suggested');
  expect(transport.readCatalogPage).toHaveBeenCalledTimes(readCount);
});
