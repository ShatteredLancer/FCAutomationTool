import { expect, it, vi } from 'vitest';
import replay from '../fixtures/fc27-puzzle-chemistry-affinity-2026-10-26.json';
import { planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases } from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { evaluateFc27PuzzleSquad } from '../../src/fc27/puzzle-evaluator.js';
import { matchFc27SbcRequirements, parseFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { puzzleMaterialRules } from '../../src/fc27/puzzle-material-policy.js';
import { planPuzzleNationalityAffinity } from '../../src/fc27/puzzle-query-affinity.js';
const fixture = () => {
  const input = structuredClone(replay.input);
  input.evaluateSquad = squad => evaluateFc27PuzzleSquad({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  return input;
};
const merged = pages => [...new Map(pages.flatMap(page => page.entries).map(item => [item.definitionId, item])).values()];

it('reproduces zero placements in the original three pages with the actual six open positions', () => {
  const input = fixture(), before = JSON.stringify(input);
  const result = suggestFc27PuzzleJointPurchases(input, merged(replay.pages.slice(0, 3)));
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_NO_PLAN_FOUND',
    search: { placementNodes: 0, evaluations: 0 } });
  expect(input.challenge.brickIndices).toEqual([5, 6, 7, 8, 9]);
  expect(JSON.stringify(input)).toBe(before);
});

it('uses the remaining page for a complementary gold nationality lane rather than more silver', () => {
  const input = fixture(), entries = merged(replay.pages.slice(0, 2));
  const usedQueries = replay.pages.slice(0, 2).map(page => page.query);
  const result = planFc27PuzzleShortageQueries(input, entries, { usedQueries });
  expect(result.queries).toEqual([...usedQueries, { start: 0, count: 20, level: 'gold', nation: 21 }]);
});

it('does not use protected owned players or over-cap public cards as affinity anchors', () => {
  const input = fixture(), template = input.inventory.items[0];
  for (let index = 0; index < 8; index++) input.inventory.items.push({ ...template, id: 4000 + index,
    definitionId: 910001 + index, nationId: 111, rating: 78, positions: [0, 3, 5, 7, 25],
    locked: index < 4, activeSquad: index >= 4 });
  const entries = merged(replay.pages.slice(0, 2));
  entries.push({ ...entries[0], definitionId: 920001, nationId: 111, positions: [0, 3, 5, 7, 25] },
    { ...entries[20], definitionId: 920002, nationId: 111, rating: 96, positions: [0, 3, 5, 7, 25] });
  const before = JSON.stringify(input);
  expect(planFc27PuzzleShortageQueries(input, entries).queries[2]).toEqual({ start: 0, count: 20, level: 'gold', nation: 21 });
  expect(JSON.stringify(input)).toBe(before);
});

it('keeps the old league fallback when chemistry is absent or no cross-quality nation can play in position', () => {
  const input = fixture();
  input.challenge.rawRequirements = input.challenge.rawRequirements.filter(rule => rule.pairs[0].key !== 35);
  expect(planFc27PuzzleShortageQueries(input, merged(replay.pages.slice(0, 2))).queries[2])
    .toEqual({ start: 0, count: 20, level: 'silver', league: 19 });
  const material = [{ qualities: [3], count: 5 }, { qualities: [2], count: 1 }];
  const base = { material, formation: replay.input.challenge.formation, brickIndices: replay.input.challenge.brickIndices };
  const card = { definitionId: 1, rating: 78, nationId: 21, positions: [0] };
  expect(planPuzzleNationalityAffinity({ ...base, candidates: [card] })).toBeNull();
  expect(planPuzzleNationalityAffinity({ ...base, candidates: [card,
    { ...card, definitionId: 2, rating: 65, positions: [10] }] })).toBeNull();
  expect(planPuzzleNationalityAffinity({ ...base, candidates: [card], formation: null })).toBeNull();
  expect(planPuzzleNationalityAffinity({ ...base, candidates: [card], material: [material[0]] })).toBeNull();
});

it('queries the dominant required tier, counts flexible cards only once and skips used affinity lanes', () => {
  const formation = { positions: [0, 3, 5, 5, 7, 10, 10, 12, 16, 18, 25] }, brickIndices = [5, 6, 7, 8, 9];
  const candidates = [
    { definitionId: 1, rating: 65, nationId: 11, positions: [0, 3, 5, 7, 25] },
    { definitionId: 2, rating: 78, nationId: 11, positions: [25] },
    { definitionId: 3, rating: 65, nationId: 22, positions: [0] },
    { definitionId: 4, rating: 78, nationId: 22, positions: [3] },
    { definitionId: 5, rating: 65, nationId: 22, positions: [5] },
  ];
  const input = { candidates, formation, brickIndices, material: [{ qualities: [2], count: 5 }, { qualities: [3], count: 1 }] };
  expect(planPuzzleNationalityAffinity(input)).toEqual({ start: 0, count: 20, level: 'silver', nation: 22 });
  expect(planPuzzleNationalityAffinity({ ...input, usedQueries: [{ start: 0, count: 20, level: 'silver', nation: 22 }] }))
    .toEqual({ start: 0, count: 20, level: 'silver', nation: 11 });
});

it('produces a fully validated plan through the priced Session, reuses caches and never transacts', async () => {
  const input = fixture(), values = new Map(), before = JSON.stringify(input);
  const transport = { readCatalogPage: vi.fn(async query => {
    const page = replay.pages.find(page => JSON.stringify(page.query) === JSON.stringify(query)
      || Object.keys(page.query).length === Object.keys(query).length && Object.keys(query).every(key => query[key] === page.query[key]));
    expect(page, JSON.stringify(query)).toBeDefined();
    return { status: 'observed', source: 'ea-defid', season: '27', observedAt: input.now, query, entries: page.entries };
  }), readQuotePage: vi.fn(), buy: vi.fn(), move: vi.fn(), save: vi.fn(), submit: vi.fn() };
  const prices = vi.fn(async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId =>
    [definitionId, { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
      { schema: 2, source, definitionId, season: '27', platform: 'pc', price: 300, fetchedAt: input.now,
        sourceUpdatedAt: null, expiresAt: input.now + 300000, error: null }])) }])) }));
  const options = { createTransport: async () => transport, loadPublicPrices: prices, now: () => input.now,
    get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => values.set(key, structuredClone(value)) };
  const result = await createFc27PuzzleProcurementSession(options).plan(input, { optimizeMaterialValue: true, quoteCeiling: 300 });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'suggested', executable: false });
  expect(transport.readCatalogPage.mock.calls.map(([query]) => query)).toEqual([
    replay.pages[0].query, replay.pages[1].query, replay.pages[3].query]);
  const plan = result.plans[0], squad = Array(11).fill(null), publicCards = merged(replay.pages);
  for (const ref of plan.selectedOwned) squad[ref.slot] = input.inventory.items.find(card => card.id === ref.id);
  for (const ref of plan.purchases) squad[ref.slot] = { ...publicCards.find(card => card.definitionId === ref.definitionId),
    type: 'player', concept: false, academyEnrolled: false };
  const players = squad.filter(Boolean), facts = input.evaluateSquad(squad);
  const rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 6).rules;
  expect(facts).toMatchObject({ status: 'observed' });
  expect(facts.chemistry).toBeGreaterThanOrEqual(16);
  expect(players).toHaveLength(6);
  expect(players.filter(card => card.rating >= 75)).toHaveLength(5);
  expect(players.filter(card => card.rating >= 65 && card.rating < 75)).toHaveLength(1);
  expect(matchFc27SbcRequirements({ requirements: [...rules, ...puzzleMaterialRules(rules, 6)],
    squad: players, chemistry: facts.chemistry, teamRating: facts.teamRating, clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  expect(result.requests).toBeLessThanOrEqual(3);
  expect(plan.purchases.every(card => card.estimatedUnitPrice <= 300)).toBe(true);
  for (const name of ['readQuotePage', 'buy', 'move', 'save', 'submit']) expect(transport[name]).not.toHaveBeenCalled();
  expect(JSON.stringify(input)).toBe(before);
  expect((await createFc27PuzzleProcurementSession(options).plan(input, { optimizeMaterialValue: true, quoteCeiling: 300 })).status).toBe('suggested');
  expect(transport.readCatalogPage).toHaveBeenCalledTimes(3);
});
