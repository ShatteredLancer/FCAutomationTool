import { expect, it, vi } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';

function fixture() {
  const input = puzzleFillFixture(); input.challenge.rawRequirements[1].pairs[0].values = [33];
  input.inventory.items[10].positions = [7];
  const now = input.now;
  const card = { definitionId: 901, rating: 60, rarity: 0, nationId: 1, leagueId: 1, teamId: 11,
    positions: [5], groups: [], special: false, evolution: false, cosmetic: false };
  const cache = new Map();
  const transport = { readCatalogPage: vi.fn(async query => ({ status: 'observed', season: '27', source: 'ea-defid',
    query, observedAt: now, entries: [card] })),
  readQuotePage: vi.fn(async query => ({ status: 'observed', season: '27', platform: input.context.platform,
    source: 'ea-visible-buy-now', definitionId: query.definitionId, observedAt: now, eligible: 1, price: 300 })) };
  const options = { createTransport: vi.fn(async () => transport), now: () => now,
    get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback),
    set: async (key, value) => { cache.set(key, structuredClone(value)); } };
  return { input, now, cache, transport, options, session: createFc27PuzzleProcurementSession(options) };
}

it('queries only proven replacement versions, preserves untradeable-only, and reuses persisted reads after restart', async () => {
  const x = fixture(); const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', requests: 2, plans: [{ purchaseCount: 1, estimatedCost: 300,
    teamFacts: { chemistry: 33 }, requiresPurchasedMaterialApproval: true }], affordabilityVerified: false });
  expect(x.transport.readQuotePage).toHaveBeenCalledExactlyOnceWith({ definitionId: 901, start: 0, count: 20, maxBuy: 2000 });
  const again = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(again).toMatchObject({ status: 'suggested', requests: 0, cacheHits: 2 });
  expect(x.input.policy.onlyUntradeable).toBe(true);
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
});

it('persists a rate limit and never automatically retries it on another click', async () => {
  const x = fixture(); x.transport.readCatalogPage.mockRejectedValue(new Error('FC27_MARKET_HTTP_429'));
  expect(await x.session.plan(x.input)).toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_HTTP_429' });
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({ requests: 0, reason: 'FC27_MARKET_HTTP_429' });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
});

it('does not query prices for candidates that cannot meet the original full-squad requirements', async () => {
  const x = fixture(); x.transport.readCatalogPage.mockImplementation(async query => ({ status: 'observed', season: '27',
    source: 'ea-defid', query, observedAt: x.now, entries: [] }));
  expect((await x.session.plan(x.input)).status).toBe('blocked');
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it('refuses expired quotes and context drift instead of automatically querying again', async () => {
  const x = fixture(); await x.session.plan(x.input);
  const expired = createFc27PuzzleProcurementSession({ ...x.options, now: () => x.now + 600001 });
  expect(await expired.plan(x.input)).toMatchObject({ reason: 'FC27_PURCHASE_CACHE_EXPIRED', requests: 0 });
  expect(await x.session.plan(x.input, { assertCurrent: () => { throw new Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); } }))
    .toMatchObject({ reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED', requests: 0 });
});
