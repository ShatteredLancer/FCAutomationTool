import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { planFc27MarketQueryRoute, selectFc27MarketQuoteVersions } from '../../src/fc27/market-query-route.js';

const challenge = {
  slotCount: 11, brickIndices: [],
  rawRequirements: [
    { count: 1, scope: 0, pairs: [{ key: 10, values: [27, 7] }] },
    { count: -1, scope: 0, pairs: [{ key: 3, values: [2] }] },
  ],
};
const policy = { maxRating: 74, excludedLeagueIds: [] };
const liveObservation = JSON.parse(readFileSync(new URL('../fixtures/fc27-puzzle-market-route-observation.json', import.meta.url), 'utf8'));

it('plans at most three requirement-focused catalog queries', () => {
  const result = planFc27MarketQueryRoute({ challenge, policy });
  expect(result).toMatchObject({ status: 'ready', complete: false, executable: false });
  expect(result.queries.length).toBeLessThanOrEqual(3);
  expect(result.queries.some(query => query.nation === 27 || query.nation === 7)).toBe(true);
  expect(result.queries.every(query => query.count === 20 && query.start === 0)).toBe(true);
});

it('fails closed for unknown requirements and invalid policy', () => {
  expect(planFc27MarketQueryRoute({ challenge: { ...challenge,
    rawRequirements: [{ count: -1, scope: 0, pairs: [{ key: 999, values: [1] }] }] }, policy }).reason)
    .toBe('FC27_REQUIREMENT_UNSUPPORTED');
  expect(planFc27MarketQueryRoute({ challenge, policy: { ...policy, maxRating: 0 } }).reason)
    .toBe('FC27_MARKET_POLICY_UNVERIFIED');
});

it('selects distinct safe public definitions and does not claim complete coverage', () => {
  const page = { status: 'observed', season: '27', source: 'ea-defid', complete: false,
    entries: [1, 2, 3].map((id, index) => ({ definitionId: id, rating: 65 + index,
      nationId: 27, leagueId: 10, teamId: id, rarity: 0, positions: [5], groups: [],
      special: false, evolution: false, cosmetic: false })) };
  const result = selectFc27MarketQuoteVersions({ pages: [page, { ...page, entries: [page.entries[0]] }],
    inventory: { items: [{ definitionId: 2, nationId: 27, leagueId: 10 }] }, policy, limit: 4 });
  expect(result).toMatchObject({ status: 'ready', observedVersions: 3, eligibleVersions: 2, complete: false });
  expect(result.definitionIds).toEqual([1, 3]);
});

it('quotes an eligible version from each queried requirement lane before generic fillers', () => {
  const entry = (definitionId, nationId) => ({ definitionId, rating: 65,
    nationId, leagueId: 10, teamId: definitionId, rarity: 0, positions: [5], groups: [],
    special: false, evolution: false, cosmetic: false });
  const page = (nation, entries) => ({ status: 'observed', season: '27', source: 'ea-defid',
    complete: false, query: nation ? { start: 0, count: 20, level: 'silver', nation }
      : { start: 0, count: 20, level: 'silver' }, entries });
  const pages = [page(27, [entry(1, 27)]), page(7, [entry(2, 7)]),
    page(null, [entry(3, 21), entry(4, 21), entry(5, 21), entry(6, 21)])];
  const inventory = { items: Array.from({ length: 8 }, (_, index) => ({
    definitionId: 100 + index, nationId: 21, leagueId: 10 })) };
  const result = selectFc27MarketQuoteVersions({ pages, inventory, policy, limit: 4 });
  expect(result.definitionIds).toHaveLength(4);
  expect(result.definitionIds).toContain(1);
  expect(result.definitionIds).toContain(2);
  expect(result).toMatchObject({ complete: false, executable: false });
});

it('rejects a page that is already presented as complete', () => {
  const page = { status: 'observed', season: '27', source: 'ea-defid', complete: true, entries: [] };
  expect(selectFc27MarketQuoteVersions({ pages: [page], inventory: { items: [] }, policy }).reason)
    .toBe('FC27_MARKET_CATALOG_UNVERIFIED');
});

it('replays the sanitized FC27 Challenge market observation without treating it as executable', () => {
  expect(liveObservation).toMatchObject({ setId: 19, challengeId: 43,
    inventory: { status: 'provisional', complete: false },
    inspectionPolicy: { maxRating: 74, onlyUntradeable: true },
    marketRoute: { reason: 'FC27_MARKET_ROUTE_OBSERVED', requests: 7,
      complete: false, executable: false, materialPolicyBlocked: true } });
  expect(liveObservation.marketRoute.selectedDefinitionIds).toHaveLength(4);
  expect(liveObservation.marketRoute.quotes.every(quote => Number.isSafeInteger(quote.price))).toBe(true);
  const result = selectFc27MarketQuoteVersions({ pages: liveObservation.marketRoute.pages,
    inventory: { items: Array.from({ length: 8 }, (_, index) => ({
      definitionId: 900000 + index, nationId: 21, leagueId: 2215 })) }, policy, limit: 4 });
  const nations = result.definitionIds.map(id => liveObservation.marketRoute.pages
    .flatMap(page => page.entries).find(entry => entry.definitionId === id)?.nationId);
  expect(nations).toContain(27);
  expect(nations).toContain(7);
  expect(result).toMatchObject({ observedVersions: 60, complete: false, executable: false });
});
