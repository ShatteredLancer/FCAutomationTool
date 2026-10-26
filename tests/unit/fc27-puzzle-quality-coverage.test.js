import { expect, it, vi } from 'vitest';
import observation from '../fixtures/fc27-puzzle-quality-coverage-2026-10-26.json';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { planFc27PuzzleShortageQueries } from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { parseFc27SbcRequirements, matchFc27SbcRequirements } from '../../src/fc27/sbc-requirements.js';
import { puzzleMaterialRules } from '../../src/fc27/puzzle-material-policy.js';

function fixture(missing = 'silver') {
  const input = puzzleFillFixture(), template = input.inventory.items[0];
  Object.assign(input.challenge, { setId: observation.setId, id: observation.challengeId,
    brickIndices: [6, 7, 8, 9, 10], rawRequirements: structuredClone(observation.requirements) });
  input.policy.maxRating = 82;
  // Enough gold by headcount, but every existing gold has a different nation:
  // selecting five violates max four nations irrespective of the silver card.
  input.inventory.items = missing === 'silver' ? Array.from({ length: 9 }, (_, index) => ({ ...template,
    id: index + 1, definitionId: 101 + index, rating: 78, nationId: index + 1, teamId: 11,
    leagueId: index < 5 ? 19 : 13 })) : [{ ...template, rating: 70, nationId: 1, teamId: 22, leagueId: 19 }];
  const card = { rarity: 0, nationId: 1, positions: [5], groups: [], special: false, evolution: false, cosmetic: false };
  const publicCards = [
    ...Array.from({ length: 5 }, (_, index) => ({ ...card, definitionId: 3000 + index, rating: 78, teamId: 11, leagueId: 19 })),
    ...Array.from({ length: 20 }, (_, index) => ({ ...card, definitionId: 4000 + index, rating: 70, teamId: 22,
      leagueId: index < 10 ? 19 : 13 })),
  ];
  return { input, publicCards };
}

it.each(['silver', 'gold'])('covers both required qualities even when only %s is missing by headcount', missing => {
  const { input } = fixture(missing), before = JSON.stringify(input);
  const result = planFc27PuzzleShortageQueries(input);
  expect(result.status).toBe('ready');
  expect(result.queries[0].level).toBe(missing);
  expect(new Set(result.queries.map(query => query.level))).toEqual(new Set(['gold', 'silver']));
  expect(result.queries.length).toBeLessThanOrEqual(3);
  expect(result.queries.every(query => query.count === 20)).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
});

it.each(['silver', 'gold'])('replaces incompatible owned material when %s is the only headcount shortage through the real Session', async missing => {
  const { input, publicCards } = fixture(missing), values = new Map();
  const template = input.inventory.items[0];
  input.inventory.items.push(
    { ...template, id: 90, definitionId: 990, rating: 78, nationId: 1, locked: true },
    { ...template, id: 91, definitionId: 991, rating: 78, nationId: 1, activeSquad: true },
    { ...template, id: 92, definitionId: 992, rating: 96, nationId: 1 },
  );
  const before = JSON.stringify(input);
  const transport = { readCatalogPage: vi.fn(async query => ({ status: 'observed', source: 'ea-defid', season: '27',
    query, observedAt: input.now, entries: publicCards.filter(card =>
      query.level === (card.rating < 75 ? 'silver' : 'gold') && (!query.league || card.leagueId === query.league)
      && (!query.team || card.teamId === query.team) && (!query.nation || card.nationId === query.nation)).slice(0, query.count) })),
    readQuotePage: vi.fn(), buy: vi.fn(), move: vi.fn(), save: vi.fn(), submit: vi.fn() };
  const prices = vi.fn(async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
    { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
      { schema: 2, source, definitionId, season: '27', platform: 'pc', price: definitionId >= 4000 ? 200 : 300,
        fetchedAt: input.now, sourceUpdatedAt: null, expiresAt: input.now + 300000, error: null }])) }])) }));
  const options = { createTransport: async () => transport, loadPublicPrices: prices, now: () => input.now,
    get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => values.set(key, structuredClone(value)) };
  const result = await createFc27PuzzleProcurementSession(options).plan(input, { optimizeMaterialValue: true, quoteCeiling: 300 });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'suggested', executable: false });
  const plan = result.plans[0], squad = Array(11).fill(null);
  for (const ref of plan.selectedOwned) squad[ref.slot] = input.inventory.items.find(item => item.id === ref.id);
  for (const ref of plan.purchases) squad[ref.slot] = publicCards.find(item => item.definitionId === ref.definitionId);
  const players = squad.filter(Boolean), rules = parseFc27SbcRequirements(input.challenge.rawRequirements, 6).rules;
  expect(players).toHaveLength(6);
  expect(players.filter(card => card.rating >= 75)).toHaveLength(5);
  expect(players.filter(card => card.rating >= 65 && card.rating < 75)).toHaveLength(1);
  expect(matchFc27SbcRequirements({ requirements: [...rules, ...puzzleMaterialRules(rules, 6)], squad: players,
    chemistry: plan.teamFacts.chemistry, teamRating: plan.teamFacts.teamRating, clubLinks: input.clubLinks }).status).toBe('satisfied');
  expect(plan.purchases.some(card => missing === 'silver' ? card.rating >= 75 : card.rating < 75)).toBe(true);
  expect(plan.selectedOwned.some(card => [90, 91, 92].includes(card.id))).toBe(false);
  expect(plan.purchases.every(card => card.estimatedUnitPrice <= 300)).toBe(true);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(50000);
  expect(transport.readCatalogPage.mock.calls.length).toBeLessThanOrEqual(3);
  for (const name of ['readQuotePage', 'buy', 'move', 'save', 'submit']) expect(transport[name]).not.toHaveBeenCalled();
  expect(JSON.stringify(input)).toBe(before);
  const reads = transport.readCatalogPage.mock.calls.length;
  expect((await createFc27PuzzleProcurementSession(options).plan(input, { optimizeMaterialValue: true, quoteCeiling: 300 })).status).toBe('suggested');
  expect(transport.readCatalogPage).toHaveBeenCalledTimes(reads);
});

it('does not add unnecessary qualities when the native minimum and material policy require a single tier', () => {
  const { input } = fixture();
  input.inventory.items = [];
  input.challenge.rawRequirements = observation.requirements.filter(row => row.pairs[0].key !== 17);
  const result = planFc27PuzzleShortageQueries(input);
  expect(result.queries.every(query => query.level === 'silver')).toBe(true);
  expect(result.queries.length).toBeLessThanOrEqual(3);
});
