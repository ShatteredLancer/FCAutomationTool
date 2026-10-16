import { expect, it, vi } from 'vitest';
import shape from '../fixtures/fc27-puzzle-capped-club-or-2026-10-16.json';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';

function fixture() {
  const input = puzzleFillFixture();
  input.policy.maxRating = 82;
  input.challenge.rawRequirements = structuredClone(shape.requirements);
  let index = 0;
  const template = input.inventory.items[0];
  input.inventory.items = shape.ownedGroups.flatMap(group => Array.from({ length: group.count }, (_, offset) => ({
    ...template, id: ++index, definitionId: 100 + index, rating: group.rating,
    teamId: group.teamId + (group.distinctTeams ? offset : 0),
  })));
  const pages = shape.pages.map((page, pageIndex) => ({ query: page.query,
    entries: Array.from({ length: page.count }, (_, offset) => ({ definitionId: 1000 + pageIndex * 20 + offset,
      rating: page.rating, teamId: page.query.team, nationId: 1, leagueId: 1, positions: [5],
      rarity: 0, groups: [], special: false, evolution: false, cosmetic: false })) }));
  return { input, pages };
}

it('reserves one OR identity page and both quality lanes of a dense filler club under the four-club cap', () => {
  const { input } = fixture();
  expect(planFc27PuzzleShortageQueries(input).queries).toEqual([
    { start: 0, count: 20, level: 'silver', team: 9011 },
    { start: 0, count: 20, level: 'bronze', team: 101 },
    { start: 0, count: 20, level: 'silver', team: 101 },
  ]);
});

it('does not reread an owned OR identity and keeps the paired club quality lanes', () => {
  const { input, pages } = fixture();
  input.inventory.items[8] = { ...input.inventory.items[8], teamId: 9012 };
  expect(planFc27PuzzleShortageQueries(input).queries.slice(0, 2)).toEqual([
    { start: 0, count: 20, level: 'bronze', team: 101 },
    { start: 0, count: 20, level: 'silver', team: 101 },
  ]);
  const usedQueries = [pages[0].query];
  expect(planFc27PuzzleShortageQueries(input, pages[0].entries, { usedQueries }).queries)
    .not.toContainEqual(pages[1].query);
});

it('tries the other OR club after an empty first identity page without repeating it', () => {
  const { input, pages } = fixture();
  const route = planFc27PuzzleShortageQueries(input, [], { usedQueries: [pages[0].query] });
  expect(route.queries[0]).toEqual(pages[1].query);
  expect(route.queries).not.toContainEqual(pages[0].query);
  expect(route.queries).toHaveLength(3);
});

it('does not count protected owned anchors or forbidden market versions as satisfying the identity', () => {
  const { input, pages } = fixture();
  input.inventory.items[8] = { ...input.inventory.items[8], teamId: 9012, locked: true };
  expect(planFc27PuzzleShortageQueries(input, pages[0].entries.map(item => ({ ...item, special: true }))).queries[0])
    .toEqual(pages[0].query);
});

it('resolves linked clubs without treating an owned anchor as a missing OR alternative', () => {
  const { input } = fixture();
  input.clubLinks.links = [[9901, 9012]];
  input.inventory.items[8] = { ...input.inventory.items[8], teamId: 9901 };
  expect(planFc27PuzzleShortageQueries(input).queries[0]).toEqual({ start: 0, count: 20, level: 'bronze', team: 101 });
});

it('retains a filler discovery lane when no safe filler club is known instead of assuming the anchor has bronze cards', () => {
  const { input, pages } = fixture();
  input.inventory.items = [];
  const genericBronze = { start: 0, count: 20, level: 'bronze' };
  expect(planFc27PuzzleShortageQueries(input).queries).toEqual([pages[0].query, genericBronze]);
  expect(planFc27PuzzleShortageQueries(input, pages[0].entries, { usedQueries: [pages[0].query] }).queries[0])
    .toEqual(genericBronze);
});

it('reproduces complete structural rejection of the old three pages, not a 50000-node exhaustion', () => {
  const { input, pages } = fixture();
  const entries = pages.slice(0, 3).flatMap(page => page.entries);
  const result = suggestFc27PuzzleJointPurchases(input, entries, { prices: new Map(entries.map(row => [row.definitionId, 200])) });
  expect(result).toMatchObject({ status: 'blocked', localReason: 'FC27_PUZZLE_NO_PLAN_FOUND',
    truncated: false, search: { placementNodes: 0, evaluations: 0 } });
  expect(result.nodes).toBeLessThan(50000);
});

it('replays query, public pricing, joint solve, concept preparation and persisted cache reuse within the original budgets', async () => {
  const { input, pages } = fixture();
  const records = new Map();
  const readCatalogPage = vi.fn(async query => ({ status: 'observed', season: '27', source: 'ea-defid',
    observedAt: input.now, query, entries: pages.find(page => JSON.stringify(page.query) === JSON.stringify(query))?.entries ?? [] }));
  const readQuotePage = vi.fn();
  const options = { now: () => input.now, get: async (key, fallback) => structuredClone(records.get(key) ?? fallback),
    set: async (key, value) => { records.set(key, structuredClone(value)); },
    createTransport: async () => ({ readCatalogPage, readQuotePage }),
    loadPublicPrices: vi.fn(async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
      { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
        { schema: 2, source, definitionId, season: '27', platform: 'pc', price: source === 'futbin' ? 200 : null,
          fetchedAt: input.now, sourceUpdatedAt: null, expiresAt: input.now + 300000,
          error: source === 'futbin' ? null : 'FC27_PUBLIC_PRICE_NOT_REQUESTED' }])) }])) })) };
  const result = await createFc27PuzzleProcurementSession(options).plan(input);
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'suggested', requests: 3, plans: [{ conceptPlan: { status: 'prepared' } }] });
  expect(readCatalogPage.mock.calls.map(([query]) => query)).toEqual([pages[0].query, pages[2].query, pages[3].query]);
  const plan = result.plans[0], cards = [...plan.selectedOwned, ...plan.purchases];
  expect(cards).toHaveLength(11);
  expect(cards.filter(card => card.rating < 65)).toHaveLength(8);
  expect(cards.filter(card => card.rating >= 65 && card.rating < 75)).toHaveLength(3);
  const actual = [...plan.selectedOwned.map(ref => input.inventory.items.find(item => item.id === ref.id)), ...plan.purchases];
  expect(new Set(actual.map(item => item.teamId)).size).toBeLessThanOrEqual(4);
  expect(actual.some(item => [9011, 9012].includes(item.teamId))).toBe(true);
  expect(new Set(actual.map(item => item.definitionId)).size).toBe(11);
  expect(plan.teamFacts.chemistry).toBeGreaterThanOrEqual(14);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  expect(result.diagnostics.catalogQueries).toEqual([pages[0], pages[2], pages[3]].map(page => ({
    ...page.query, returnedCount: page.entries.length, cached: false })));
  expect(readQuotePage).not.toHaveBeenCalled();
  const again = await createFc27PuzzleProcurementSession(options).plan(input);
  expect(again).toMatchObject({ status: 'suggested', requests: 0, cacheHits: 3 });
  expect(readCatalogPage).toHaveBeenCalledTimes(3);
  expect(again.diagnostics.catalogQueries.every(query => query.cached)).toBe(true);
  expect(input.policy.onlyUntradeable).toBe(true);
}, 30000);
