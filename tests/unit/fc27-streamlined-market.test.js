import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedCatalog } from '../../src/adapters/browser/fc27-streamlined-catalog.js';
import { createFc27StreamlinedMarket } from '../../src/adapters/ea/fc27-streamlined-market.js';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { filterStreamlinedItems } from '../../src/streamlined/eligibility.js';
import { createGalleryReferencePrices } from '../../src/gallery/reference-prices.js';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import expiryEvidence from '../fixtures/fc27-streamlined-quote-expiry-2026-10-12.json';
import rollingExpiryEvidence from '../fixtures/fc27-streamlined-rolling-expiry-2026-10-13.json';

function expiringMarket(count = expiryEvidence.marketCandidateCount, { rolling = false } = {}) {
  const f = streamlinedRuntime({ targetScore: 12000 });
  let time = 1000000;
  f.root.UTSearchCriteriaDTO = class {};
  f.root.SearchType = { PLAYER: 'player' }; f.root.SearchCategory = { ANY: 'any' };
  const ids = Array.from({ length: count }, (_, index) => 101 + index);
  const entities = ids.map(definitionId => ({ ...f.root.repositories.Item.club.items._collection[1],
    definitionId, _rating: 84, _rareflag: 1, concept: true, sbsScore: 830 }));
  const search = vi.fn(criteria => ({ observe: (_owner, cb) => cb(null, { status: 200, success: true,
    response: { items: entities.filter(item => criteria.defId.includes(item.definitionId)) } }), unobserve() {} }));
  f.root.services.Item = { searchConceptItems: search };
  const cached = { schema: 2, source: 'futbin', season: '27', platform: 'console', definitionId: 101,
    price: 200, fetchedAt: time - expiryEvidence.quoteTtlMs + expiryEvidence.cachedRemainingMs,
    expiresAt: time + expiryEvidence.cachedRemainingMs, sourceUpdatedAt: null, error: null };
  const storage = new Map([['fcat-public-quotes-v2:27:console:futbin:101', structuredClone(cached)]]);
  if (rolling) {
    const { expiredCacheCount, perReadMs } = rollingExpiryEvidence.replay;
    for (let index = 0; index < expiredCacheCount; index++) {
      const definitionId = 101 + index;
      storage.set(`fcat-public-quotes-v2:27:console:futbin:${definitionId}`, { ...cached, definitionId });
    }
    const definitionId = 101 + expiredCacheCount;
    const remaining = (count - expiredCacheCount - 1) * perReadMs + Math.floor(expiredCacheCount * perReadMs / 2);
    storage.set(`fcat-public-quotes-v2:27:console:futbin:${definitionId}`, { ...cached, definitionId,
      fetchedAt: time - expiryEvidence.quoteTtlMs + remaining, expiresAt: time + remaining });
  }
  const readFutgg = vi.fn(), readFutbin = vi.fn(async definitionId => {
    time += rolling ? rollingExpiryEvidence.replay.perReadMs : Math.ceil(expiryEvidence.marketReadDurationMs / (count - 1));
    return { definitionId, price: definitionId === 101 ? 250 : 500 };
  });
  const shared = createGalleryReferencePrices({ readFutgg, readFutbin, now: () => time,
    get: async (key, fallback) => structuredClone(storage.get(key) ?? fallback),
    set: async (key, value) => storage.set(key, structuredClone(value)) });
  const policy = { readSources: 'futbin', source: 'futbin', premium: 50 };
  const prices = { load: vi.fn((selected, options) => shared.load(selected,
    { ...options, platform: 'console', sources: ['futbin'], policy, quoteTtlMs: expiryEvidence.quoteTtlMs })) };
  const diagnosticLog = { record: vi.fn() };
  const reader = createFc27StreamlinedMarket(f.root, { catalog: { load: async () => ({ ids }) }, prices, diagnosticLog, now: () => time });
  return { f, prices, reader, cached, storage, diagnosticLog, readFutbin, readFutgg, search, now: () => time };
}

it('recovers the rolling expiry window: refreshing 51 stale cache entries must not leave the next entry expiring', async () => {
  const f = expiringMarket(rollingExpiryEvidence.replay.candidateCount, { rolling: true });
  const result = await f.reader({ input: f.f.input });
  expect(result.market).toHaveLength(166);
  expect(f.prices.load.mock.calls.map(([ids]) => ids.length)).toEqual([166, 52]);
  expect(f.prices.load.mock.calls[1][0]).toEqual(Array.from({ length: 52 }, (_, index) => 101 + index));
  expect(f.readFutbin).toHaveBeenCalledTimes(166);
  expect(f.readFutgg).not.toHaveBeenCalled();
  expect(result.market.every(row => row.quote.expiresAt > f.now())).toBe(true);
  expect(f.diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'market-quote-window',
    source: 'futbin', phase: 'refresh', requestedCount: 166, count: 52, durationMs: 71364 }));
});

it('reuses sufficiently fresh cache and the recovered quotes on the next generation without forced whole-pool reads', async () => {
  const f = expiringMarket(166, { rolling: true }), key = 'fcat-public-quotes-v2:27:console:futbin:266';
  const healthy = { ...f.cached, definitionId: 266, fetchedAt: f.now(), expiresAt: f.now() + expiryEvidence.quoteTtlMs };
  f.storage.set(key, structuredClone(healthy));
  await f.reader({ input: f.f.input });
  expect(f.prices.load.mock.calls[0][1]).not.toHaveProperty('forceSources');
  expect(f.prices.load.mock.calls[1][1].forceSources).toEqual(['futbin']);
  expect(f.prices.load.mock.calls[1][0]).not.toContain(266);
  expect(f.readFutbin.mock.calls.some(([id]) => id === 266)).toBe(false);
  expect(f.storage.get(key)).toEqual(healthy);
  const reads = f.readFutbin.mock.calls.length;
  expect((await f.reader({ input: f.f.input })).market).toHaveLength(166);
  expect(f.readFutbin).toHaveBeenCalledTimes(reads);
  expect(f.prices.load.mock.calls).toHaveLength(3);
});

it('keeps real refresh failures and cooldowns fail-closed without falling back or extending old prices', async () => {
  const f = expiringMarket(166, { rolling: true }), read = f.readFutbin.getMockImplementation();
  f.readFutbin.mockImplementation(async id => {
    if (id === 101) throw Error('FC27_PUBLIC_PRICE_HTTP_429');
    return read(id);
  });
  await expect(f.reader({ input: f.f.input })).rejects.toThrow('FC27_PUBLIC_PRICE_HTTP_429');
  expect(f.prices.load).toHaveBeenCalledTimes(2);
  // One failed refresh plus two already in flight; no later network reads.
  expect(f.readFutbin).toHaveBeenCalledTimes(117);
  expect(f.readFutgg).not.toHaveBeenCalled();
  expect(f.cached).toMatchObject({ price: 200, expiresAt: 1010000 });
  expect(f.f.calls.some(call => ['bid', 'move', 'submit', 'contribute'].includes(call.kind))).toBe(false);
});

it('produces a frozen plan after rolling expiration recovery and regenerates without journal writes or new price requests', async () => {
  const f = expiringMarket(166, { rolling: true }), set = vi.fn();
  const session = createFc27StreamlinedSession({ prices: f.prices, readMarketCandidates: f.reader,
    readInputs: () => ({ ...f.f.input, inventory: [] }),
    inspect: () => ({ context: f.f.input.context, challenge: f.f.input.challenge }),
    get: async (_key, fallback) => fallback, set, now: f.now });
  const first = await session.plan({ mode: 'inventory-market' });
  expect(first).toMatchObject({ status: 'ready', quoteSource: 'futbin', marketError: null, purchaseCost: 3750 });
  expect(first.plan.route.groups[0].item).toMatchObject({ price: 250, purchaseMaxBuy: 300 });
  const second = await session.plan({ mode: 'inventory-market' });
  expect(second).toMatchObject({ status: 'ready', purchaseCost: 3750 });
  expect(f.readFutbin).toHaveBeenCalledTimes(166);
  expect(set).not.toHaveBeenCalled();
});

it('refreshes only quotes expiring during the logged 166-version FUTBIN read, preserving timestamps and caps', async () => {
  const f = expiringMarket(), progress = [];
  const result = await f.reader({ input: f.f.input, onProgress: row => progress.push(row) });
  expect(result.market).toHaveLength(expiryEvidence.marketCandidateCount);
  expect(f.prices.load.mock.calls.map(([ids]) => ids.length)).toEqual([166, 1]);
  expect(f.prices.load.mock.calls[1][0]).toEqual([101]);
  expect(f.prices.load.mock.calls[1][1]).not.toHaveProperty('force', true);
  expect(f.prices.load.mock.calls[1][1].forceSources).toEqual(['futbin']);
  expect(f.readFutbin).toHaveBeenCalledTimes(166);
  expect(f.readFutgg).not.toHaveBeenCalled();
  expect(result.market.find(item => item.definitionId === 101)).toMatchObject({ price: 250, purchaseMaxBuy: 300,
    quote: { fetchedAt: f.now(), expiresAt: f.now() + expiryEvidence.quoteTtlMs } });
  expect(f.cached.price).toBe(200);
  expect(f.cached.expiresAt).toBe(1010000);
  expect(progress).toContainEqual(expect.objectContaining({ phase: 'market-quotes', source: 'futbin', refresh: true, total: 1 }));
  expect(f.f.calls.some(call => ['bid', 'move', 'submit', 'contribute'].includes(call.kind))).toBe(false);
});

it('refreshes an earlier quote batch after later batches without exceeding the public loader limit', async () => {
  const f = expiringMarket(251);
  const result = await f.reader({ input: f.f.input });
  expect(result.market).toHaveLength(251);
  expect(f.prices.load.mock.calls.map(([ids]) => ids.length)).toEqual([250, 1, 1]);
  expect(f.prices.load.mock.calls.at(-1)[0]).toEqual([101]);
});

it('produces a frozen mixed-scope plan after expiration recovery without trading or writing journals', async () => {
  const f = expiringMarket(), set = vi.fn();
  const session = createFc27StreamlinedSession({ prices: f.prices, readMarketCandidates: f.reader,
    readInputs: () => ({ ...f.f.input, inventory: [] }),
    inspect: () => ({ context: f.f.input.context, challenge: f.f.input.challenge }),
    get: async (_key, fallback) => fallback, set, now: f.now });
  const result = await session.plan({ mode: 'inventory-market' });
  expect(result).toMatchObject({ status: 'ready', quoteSource: 'futbin', marketError: null, purchaseCost: 3750 });
  expect(result.plan).not.toBeNull();
  expect(result.plan.route.groups[0].item).toMatchObject({ price: 250, purchaseMaxBuy: 300 });
  expect(set).not.toHaveBeenCalled();
});

it('splits more than 250 expired references into bounded refreshes', async () => {
  const f = expiringMarket(251);
  f.prices.load.mockImplementation(async ids => ({ policy: { source: 'futbin' },
    references: Object.fromEntries(ids.map(definitionId => [definitionId, { quotes: { futbin: {
      definitionId, source: 'futbin', price: 200, fetchedAt: 1,
      expiresAt: f.prices.load.mock.calls.length <= 2 ? 2 : f.now() + 300000, error: null,
    } } }])) }));
  expect((await f.reader({ input: f.f.input })).market).toHaveLength(251);
  expect(f.prices.load.mock.calls.map(([ids]) => ids.length)).toEqual([250, 1, 250, 1]);
});

it.each(['FC27_BUY_REFERENCE_TIMEOUT', 'FC27_PUBLIC_PRICE_HTTP_429'])('does not retry source failure %s or keep a cheaper old quote after failed refresh', async reason => {
  const f = expiringMarket(2), load = f.prices.load.getMockImplementation(); let policy;
  f.prices.load.mockImplementationOnce(async (...args) => { const result = await load(...args); policy = result.policy; return result; })
    .mockImplementationOnce(async () => ({ policy,
    references: { 101: { quotes: { futbin: { definitionId: 101, source: 'futbin', price: null, error: reason } } } } }));
  await expect(f.reader({ input: f.f.input })).rejects.toThrow(reason);
  expect(f.prices.load).toHaveBeenCalledTimes(2);
  expect(f.readFutgg).not.toHaveBeenCalled();
});

it.each(['stale', 'source-change', 'cancelled'])('stops after one expired-quote recovery for %s without looping', async mode => {
  const f = expiringMarket(2), load = f.prices.load.getMockImplementation();
  let policy, cancelled = false;
  f.prices.load.mockImplementationOnce(async (...args) => { const result = await load(...args); policy = result.policy; return result; })
    .mockImplementationOnce(async () => {
    if (mode === 'cancelled') cancelled = true;
    return { policy: mode === 'source-change' ? { ...policy, source: 'futgg' } : policy,
      references: { 101: { quotes: { futbin: f.cached } } } };
  });
  await expect(f.reader({ input: f.f.input, check: () => {
    if (cancelled) throw Error('FC27_STREAMLINED_CANCELLED');
  } })).rejects.toThrow({ stale: 'FC27_STREAMLINED_QUOTES_EXPIRED', 'source-change': 'FC27_STREAMLINED_PRICE_POLICY_CHANGED',
    cancelled: 'FC27_STREAMLINED_CANCELLED' }[mode]);
  expect(f.prices.load).toHaveBeenCalledTimes(2);
  if (mode === 'stale') expect(f.diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({
    source: 'futbin', phase: 'validate', status: 'failed', reason: 'FC27_STREAMLINED_QUOTES_EXPIRED',
    definitionId: 101, fetchedAt: f.cached.fetchedAt, expiresAt: f.cached.expiresAt,
  }));
});

it('does not turn a normal missing market price into an expiration refresh', async () => {
  const f = expiringMarket(2);
  f.prices.load.mockResolvedValue({ policy: { source: 'futbin' }, references: {
    101: { quotes: { futbin: { definitionId: 101, source: 'futbin', price: null, error: null } } },
    102: { quotes: { futbin: { definitionId: 102, source: 'futbin', price: 200,
      fetchedAt: f.now(), expiresAt: f.now() + 300000, error: null } } },
  } });
  expect((await f.reader({ input: f.f.input })).market.map(item => item.definitionId)).toEqual([102]);
  expect(f.prices.load).toHaveBeenCalledOnce();
});

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

it('includes a public 83 tail bucket omitted by the selected platform recommended rates', async () => {
  const f = streamlinedRuntime();
  const request = vi.fn(options => {
    const url = new URL(options.url), overall = Number(url.searchParams.get('overall'));
    const data = url.pathname.includes('/set/')
      ? { game: '27', eaId: 31, challengeEaIds: [61], slug: '27-31-test' }
      : overall ? { challengeEaId: 61, overall, rarityEaId: 0, platform: 'pc', players: [{ player: { eaId: 1000 + overall, overall } }] }
        : { setEaId: 31, challenges: [{ challengeEaId: 61, scoreRequirement: 200,
          pc: { rates: [{ overall: 84, rarityEaId: 0, score: 830 }] } }],
          routeGroups: [{ overall: 84, rarityEaId: 0 }, { overall: 83, rarityEaId: 0 }] };
    options.onload({ status: 200, finalUrl: options.url, responseText: JSON.stringify({ data }) });
  });
  const result = await createFc27StreamlinedCatalog({ gmRequest: request }).load({ ...f.input,
    context: { ...f.input.context, platform: 'pc:test' }, policy: { ...f.input.policy, marketMaxRating: 99 } });
  expect(result.ids).toEqual([1083, 1084]);
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.filter(([o]) => o.url.includes('overall=')).every(([o]) => o.url.includes('platform=pc'))).toBe(true);
});

it.each([99, 82])('discovers public score groups using the market ceiling %s, independently of stock protection', async marketMaxRating => {
  const f = streamlinedRuntime();
  const rates = [82, 84, 85, 86].map(overall => ({ overall, rarityEaId: 1, score: 100 }));
  const request = vi.fn(options => {
    const url = new URL(options.url), overall = Number(url.searchParams.get('overall'));
    const data = url.pathname.includes('/set/')
      ? { game: '27', eaId: 31, challengeEaIds: [61], slug: '27-31-test' }
      : overall ? { challengeEaId: 61, overall, rarityEaId: 1, platform: 'ps5', players: [{ player: { eaId: 1000 + overall, overall } }] }
        : { setEaId: 31, challenges: [{ challengeEaId: 61, scoreRequirement: 200, ps5: { rates } }],
          routeGroups: rates.map(({ overall, rarityEaId }) => ({ overall, rarityEaId })) };
    options.onload({ status: 200, finalUrl: options.url, responseText: JSON.stringify({ data }) });
  });
  const catalog = createFc27StreamlinedCatalog({ gmRequest: request });
  const result = await catalog.load({ ...f.input, context: { ...f.input.context, platform: 'psn:test' },
    policy: { ...f.input.policy, maxRating: 82, marketMaxRating, goldRange: [75, 82] } });
  expect(result.ids).toEqual(marketMaxRating === 99 ? [1082, 1084, 1085, 1086] : [1082]);
  expect(request).toHaveBeenCalledTimes(marketMaxRating === 99 ? 6 : 3);
});

it.each([{}, [{ overall: 83 }], Array(101).fill({ overall: 83, rarityEaId: 0 })])('rejects malformed or unbounded optional public group descriptors', async routeGroups => {
  const f = streamlinedRuntime();
  const replies = [
    { game: '27', eaId: 31, challengeEaIds: [61], slug: '27-31-test' },
    { setEaId: 31, challenges: [{ challengeEaId: 61, scoreRequirement: 200,
      pc: { rates: [{ overall: 84, rarityEaId: 0, score: 830 }] } }], routeGroups },
  ];
  const request = vi.fn(options => options.onload({ status: 200, responseText: JSON.stringify({ data: replies.shift() }) }));
  await expect(createFc27StreamlinedCatalog({ gmRequest: request }).load({ ...f.input,
    context: { ...f.input.context, platform: 'pc:test' } })).rejects.toThrow('CATALOG_RULES_CHANGED');
  expect(request).toHaveBeenCalledTimes(2);
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

it('does not hide a low-price quote timeout behind the only expensive cached candidate', async () => {
  const f = streamlinedRuntime(); f.root.UTSearchCriteriaDTO = class {};
  f.root.SearchType = { PLAYER: 'player' }; f.root.SearchCategory = { ANY: 'any' };
  const source = f.root.repositories.Item.club.items._collection[1];
  const entities = [
    { ...source, definitionId: 101, _rating: 84, concept: true, sbsScore: 830 },
    { ...source, definitionId: 102, _rating: 86, concept: true, sbsScore: 4100 },
  ];
  f.root.services.Item = { searchConceptItems: () => ({ observe: (_owner, cb) => cb(null,
    { status: 200, success: true, response: { items: entities } }), unobserve() {} }) };
  const prices = { load: vi.fn(async (_ids, options) => {
    options.onProgress({ source: 'futbin', index: 1, total: 2 });
    return { policy: { source: 'futbin' }, references: {
      101: { quotes: { futbin: { definitionId: 101, error: 'FC27_BUY_REFERENCE_TIMEOUT', price: null } } },
      102: { quotes: { futbin: { definitionId: 102, source: 'futbin', price: 41000, fetchedAt: 1, expiresAt: 1000 } } },
    } };
  }) };
  const progress = [];
  const reader = createFc27StreamlinedMarket(f.root, { catalog: { load: async () => ({ ids: [101,102] }) }, prices, now: () => 100 });
  await expect(reader({ input: f.input, onProgress: row => progress.push(row) })).rejects.toThrow('FC27_BUY_REFERENCE_TIMEOUT');
  expect(progress).toContainEqual(expect.objectContaining({ phase: 'market-quotes', source: 'futbin', completed: 1, total: 2 }));
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
