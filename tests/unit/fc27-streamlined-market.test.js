import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedCatalog } from '../../src/adapters/browser/fc27-streamlined-catalog.js';
import { createFc27StreamlinedMarket } from '../../src/adapters/ea/fc27-streamlined-market.js';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { filterStreamlinedItems } from '../../src/streamlined/eligibility.js';

it('discovers set/group candidates anonymously, caches requests, and never uses public points as EA proof', async () => {
  const f = streamlinedRuntime();
  const replies = [
    { game: '27', eaId: 31, challengeEaIds: [61], slug: '27-31-test' },
    { setEaId: 31, challenges: [{ challengeEaId: 61, scoreRequirement: 200,
      ps5: { rates: [{ overall: 74, rarityEaId: 0, score: 999 }] } }] },
    { challengeEaId: 61, overall: 74, rarityEaId: 0, platform: 'ps5', players: [{ player: { eaId: 101, overall: 74 }, gradingScore: 999, price: 999 }] },
  ];
  const request = vi.fn(options => options.onload({ status: 200, finalUrl: options.url, responseText: JSON.stringify({ data: replies.shift() }) }));
  const catalog = createFc27StreamlinedCatalog({ gmRequest: request, now: () => 100 });
  const input = { ...f.input, context: { ...f.input.context, platform: 'psn:test' } };
  const first = await catalog.load(input); expect(first.ids).toEqual([101]);
  expect(first).not.toHaveProperty('points'); expect(first).not.toHaveProperty('price');
  await catalog.load(input); expect(request).toHaveBeenCalledTimes(3);
  for (const [options] of request.mock.calls) {
    expect(options.anonymous).toBe(true); expect(options.headers).toBeUndefined(); expect(options.data).toBeUndefined();
  }
});

it('rejects wrong challenge/season data before requesting candidates', async () => {
  const f = streamlinedRuntime();
  const request = vi.fn(options => options.onload({ status: 200, responseText: JSON.stringify({ data: {
    game: '26', eaId: 31, challengeEaIds: [61], slug: '27-31-test' } }) }));
  const catalog = createFc27StreamlinedCatalog({ gmRequest: request });
  await expect(catalog.load({ ...f.input, context: { ...f.input.context, platform: 'psn:test' } })).rejects.toThrow('CATALOG_TARGET_CHANGED');
  expect(request).toHaveBeenCalledOnce();
});

it.each([99, 82])('discovers public score groups using the market ceiling %s, independently of stock protection', async marketMaxRating => {
  const f = streamlinedRuntime();
  const rates = [82, 84, 85, 86].map(overall => ({ overall, rarityEaId: 1, score: 100 }));
  const request = vi.fn(options => {
    const url = new URL(options.url), overall = Number(url.searchParams.get('overall'));
    const data = url.pathname.includes('/set/')
      ? { game: '27', eaId: 31, challengeEaIds: [61], slug: '27-31-test' }
      : overall ? { challengeEaId: 61, overall, rarityEaId: 1, platform: 'ps5', players: [{ player: { eaId: 1000 + overall, overall } }] }
        : { setEaId: 31, challenges: [{ challengeEaId: 61, scoreRequirement: 200, ps5: { rates } }] };
    options.onload({ status: 200, finalUrl: options.url, responseText: JSON.stringify({ data }) });
  });
  const catalog = createFc27StreamlinedCatalog({ gmRequest: request });
  const result = await catalog.load({ ...f.input, context: { ...f.input.context, platform: 'psn:test' },
    policy: { ...f.input.policy, maxRating: 82, marketMaxRating, goldRange: [75, 82] } });
  expect(result.ids).toEqual(marketMaxRating === 99 ? [1082, 1084, 1085, 1086] : [1082]);
  expect(request).toHaveBeenCalledTimes(marketMaxRating === 99 ? 6 : 3);
});

it('reads native concept points/eligibility, uses only selected public quote source and reuses exact concepts', async () => {
  const f = streamlinedRuntime(); f.root.UTSearchCriteriaDTO = class {};
  f.root.SearchType = { PLAYER: 'player' }; f.root.SearchCategory = { ANY: 'any' };
  const source = f.root.repositories.Item.club.items._collection[1];
  const entity = { ...source, definitionId: 101, _rating: 74, concept: true, sbsScore: 35 };
  const search = vi.fn(() => ({ observe: (owner, cb) => cb(null, { status: 200, success: true, response: { items: [entity] } }), unobserve() {} }));
  f.root.services.Item = { searchConceptItems: search };
  const prices = { load: vi.fn(async () => ({ policy: { source: 'futbin' }, references: { 101: { quotes: { futbin: {
    definitionId: 101, source: 'futbin', price: 200, fetchedAt: 1, expiresAt: 1000 } } } } })) };
  const reader = createFc27StreamlinedMarket(f.root, { catalog: { load: async () => ({ ids: [101] }) }, prices, now: () => 100 });
  const result = await reader({ input: f.input });
  expect(result.market[0]).toMatchObject({ points: 35, source: 'market', price: 200, scoreVerified: true, id: null });
  expect(f.input.eligibility.matches(result.market[0]).status).toBe('eligible');
  expect(prices.load.mock.calls[0][1].purpose).toBe('puzzle');
  await reader({ input: f.input }); expect(search).toHaveBeenCalledOnce();
  entity.sbsScore = null;
  expect((await reader({ input: f.input })).market).toEqual([]);
});

it.each([72, undefined, null, NaN, -1, 0.5])('excludes special or unknown rarity %s even when native eligibility matches', async rarity => {
  const f = streamlinedRuntime(); f.root.UTSearchCriteriaDTO = class {};
  f.root.SearchType = { PLAYER: 'player' }; f.root.SearchCategory = { ANY: 'any' };
  const source = f.root.repositories.Item.club.items._collection[1];
  const entity = { ...source, definitionId: 101, _rating: 86, _rareflag: rarity, concept: true, sbsScore: 4100 };
  const search = vi.fn(() => ({ observe: (_owner, cb) => cb(null, { status: 200, success: true, response: { items: [entity] } }), unobserve() {} }));
  f.root.services.Item = { searchConceptItems: search };
  const prices = { load: vi.fn(async () => ({ policy: { source: 'futgg' }, references: { 101: { quotes: { futgg: {
    definitionId: 101, source: 'futgg', price: 25000, fetchedAt: 1, expiresAt: 1000 } } } } })) };
  const reader = createFc27StreamlinedMarket(f.root, { catalog: { load: async () => ({ ids: [101] }) }, prices, now: () => 100 });
  const result = await reader({ input: f.input });
  expect(result.market).toEqual([]);
  expect(prices.load).not.toHaveBeenCalled();
});

it('compares ordinary 84 market candidates above stock 82 while retaining the explicit ceiling', async () => {
  const f = streamlinedRuntime(); f.root.UTSearchCriteriaDTO = class {};
  f.root.SearchType = { PLAYER: 'player' }; f.root.SearchCategory = { ANY: 'any' };
  const entity = { ...f.root.repositories.Item.club.items._collection[1], definitionId: 101,
    _rating: 84, _rareflag: 1, concept: true, sbsScore: 830 };
  f.root.services.Item = { searchConceptItems: () => ({ observe: (_owner, cb) => cb(null,
    { status: 200, success: true, response: { items: [entity] } }), unobserve() {} }) };
  const prices = { load: vi.fn(async () => ({ policy: { source: 'futgg' }, references: { 101: { quotes: { futgg: {
    definitionId: 101, source: 'futgg', price: 1100, fetchedAt: 1, expiresAt: 1000 } } } } })) };
  const reader = createFc27StreamlinedMarket(f.root, { catalog: { load: async () => ({ ids: [101] }) }, prices, now: () => 100 });
  const input = { ...f.input, policy: { ...f.input.policy, maxRating: 82, marketMaxRating: 99, goldRange: [75, 82] } };
  const result = await reader({ input });
  expect(result.market).toHaveLength(1);
  expect(filterStreamlinedItems(result.market, input).items).toHaveLength(1);
  expect(filterStreamlinedItems(result.market, { ...input, policy: { ...input.policy, marketMaxRating: 82 } }).items).toHaveLength(0);
  expect(result.market[0]).toMatchObject({ rating: 84, points: 830, price: 1100, special: false });
});
