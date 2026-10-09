import { expect, it, vi } from 'vitest';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import * as procurement from '../../src/fc27/puzzle-procurement.js';

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

function publicPrices(x, priceOf) {
  return vi.fn(async ids => ({ policy: { source: 'futgg' },
    references: Object.fromEntries(ids.map(definitionId => [definitionId, { definitionId,
      season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, {
        schema: 2, source, definitionId, season: '27', platform: 'pc', price: priceOf(definitionId),
        fetchedAt: x.now, sourceUpdatedAt: null, expiresAt: x.now + 300000, error: null,
      }])) }])) }));
}

function refinementFixture(joint = false) {
  const x = fixture();
  if (joint) x.input.inventory.items.pop();
  const original = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await original(query);
    return { ...page, entries: Array.from({ length: query.start === 0 ? 20 : 1 }, (_, index) => ({
      ...page.entries[0], definitionId: query.start === 0 ? 901 + index : 921,
      ...(query.start === 0 && index > 0 ? { special: true } : {}),
    })), pageEndObserved: query.start !== 0 };
  });
  return x;
}

it.each([false, true])('prices all eligible Puzzle candidates before solving with zero EA quotes (joint=%s)', async joint => {
  const x = fixture();
  if (joint) x.input.inventory.items.pop();
  const original = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await original(query);
    return { ...page, entries: [page.entries[0], { ...page.entries[0], definitionId: 902 }] };
  });
  const loadPublicPrices = vi.fn(async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
    { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
      { schema: 2, source, definitionId, season: '27', platform: 'pc', price: definitionId === 901 ? 5000 : 200,
        fetchedAt: x.now, sourceUpdatedAt: null, expiresAt: x.now + 300000, error: null }])) }])) }));
  const result = await createFc27PuzzleProcurementSession({ ...x.options, loadPublicPrices }).plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', requests: 1 });
  expect(result.diagnostics.route).toBe(joint ? 'joint' : 'repair');
  expect(result.plans[0]).toMatchObject({ estimatedCost: 200,
    purchases: [{ definitionId: 902, estimatedUnitPrice: 200, priceSource: 'futgg' }] });
  expect(result.plans[0].purchases[0].observedBuyNow).toBeUndefined();
  expect(result.plans[0].conceptPlan).toMatchObject({ status: 'prepared', estimatedCost: 200 });
  expect(loadPublicPrices.mock.calls[0][0]).toEqual([901,902]);
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it('never falls back to EA or another source when the selected public quote is missing', async () => {
  const x = fixture();
  const loadPublicPrices = async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
    { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
      { schema: 2, source, definitionId, season: '27', platform: 'pc', price: source === 'futgg' ? null : 200,
        fetchedAt: x.now, sourceUpdatedAt: null, expiresAt: x.now + 300000, error: null }])) }])) });
  const result = await createFc27PuzzleProcurementSession({ ...x.options, loadPublicPrices }).plan(x.input);
  expect(result.status).toBe('blocked'); expect(result.plans).toEqual([]);
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
  expect(result.diagnostics.excludedUnavailable).toBe(1);
});

it('keeps the cheaper two-card repair first through pricing and concept-plan preparation without extra requests', async () => {
  const x = fixture(); x.input.challenge.rawRequirements[1].pairs[0].values = [31];
  const original = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await original(query), card = page.entries[0];
    return { ...page, entries: [card, ...[902, 903].map(definitionId => ({ ...card,
      definitionId, nationId: 2, leagueId: 2, teamId: 22 }))] };
  });
  const loadPublicPrices = vi.fn(async ids => ({ policy: { source: 'futgg' },
    references: Object.fromEntries(ids.map(definitionId => [definitionId, { definitionId,
      season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, { schema: 2, source, definitionId,
        season: '27', platform: 'pc', price: definitionId === 901 ? 5000 : 200,
        fetchedAt: x.now, sourceUpdatedAt: null, expiresAt: x.now + 300000, error: null }])) }])) }));
  const result = await createFc27PuzzleProcurementSession({ ...x.options, loadPublicPrices }).plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', requests: 1,
    plans: [{ purchaseCount: 2, estimatedCost: 400, conceptPlan: { estimatedCost: 400 } },
      { purchaseCount: 1, estimatedCost: 5000 }],
    diagnostics: { estimatedCost: 400, priceSource: 'futgg' } });
  expect(loadPublicPrices).toHaveBeenCalledOnce();
  expect(x.transport.readCatalogPage).toHaveBeenCalledOnce();
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it('retains a joint evaluator failure instead of fetching extra pages and reporting no plan', async () => {
  const x = fixture(); x.input.inventory.items.pop(); x.input.evaluateSquad = null;
  const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE', requests: 1,
    diagnostics: { route: 'joint', localReason: 'FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE', nodes: 0 } });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it('skips joint search with empty market pages and reuses the bounded no-plan result', async () => {
  const x = fixture();
  x.input.challenge.rawRequirements[1].scope = 2;
  x.input.inventory.items = Array.from({ length: 25 }, (_, i) => ({ ...x.input.inventory.items[0],
    id: i + 1, definitionId: 101 + i, positions: [7] }));
  x.transport.readCatalogPage.mockImplementation(async query => ({ status: 'observed', season: '27',
    source: 'ea-defid', query, observedAt: x.now, entries: [] }));
  const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PURCHASE_REPAIR_NO_PLAN',
    diagnostics: { route: 'joint', localReason: 'FC27_PURCHASE_REPAIR_NO_PLAN', nodes: 0,
      truncated: false, quoteAttempts: 0 } });
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
  const repeat = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(repeat).toMatchObject({ reason: 'FC27_PURCHASE_REPAIR_NO_PLAN', requests: 0 });
}, 30000);

it('queries only proven replacement versions, preserves untradeable-only, and reuses persisted reads after restart', async () => {
  const x = fixture(); const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', requests: 2, plans: [{ purchaseCount: 1, estimatedCost: 300,
    teamFacts: { chemistry: 33 }, requiresPurchasedMaterialApproval: true }], affordabilityVerified: false });
  expect(x.transport.readQuotePage).toHaveBeenCalledExactlyOnceWith({ definitionId: 901, start: 0, count: 20, maxBuy: null });
  const again = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(again).toMatchObject({ status: 'suggested', requests: 0, cacheHits: 2 });
  expect(result.diagnostics).toMatchObject({ route: 'repair', catalogCandidates: 1, usableCandidates: 1,
    catalogAttempts: 1, quoteAttempts: 1, cacheHits: 0 });
  expect(again.diagnostics).toMatchObject({ catalogAttempts: 0, quoteAttempts: 0, cacheHits: 2 });
  expect(x.input.policy.onlyUntradeable).toBe(true);
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
});

it('reports catalog, search and completed quote counters on real awaits and cached reads', async () => {
  const x = fixture(); const progress = [];
  const result = await x.session.plan(x.input, { onProgress: value => progress.push(value) });
  expect(result.status).toBe('suggested');
  expect(progress).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'catalog-read', catalogPages: 1, catalogCandidates: 1 }),
    expect.objectContaining({ phase: 'local-market-search', nodes: expect.any(Number), maxNodes: 20000 }),
    expect.objectContaining({ phase: 'quote-read', quoteCompleted: 1, quoteTotal: 1, requests: 2 }),
  ]));
  const cached = [];
  expect((await x.session.plan(x.input, { onProgress: value => cached.push(value) })).requests).toBe(0);
  expect(cached.at(-1)).toMatchObject({ quoteCompleted: 1, quoteTotal: 1, requests: 0, cacheHits: 2 });
});

it('focuses the next catalog page from observed clubs and reuses the complete route on another click', async () => {
  const x = fixture(); x.input.inventory.items = [];
  x.input.challenge.rawRequirements = [
    { count: -1, scope: 0, pairs: [{ key: 3, values: [1] }] },
    { count: -1, scope: 1, pairs: [{ key: 9, values: [4] }] },
    { count: -1, scope: 2, pairs: [{ key: 35, values: [33] }] },
  ];
  const cards = Array.from({ length: 11 }, (_, index) => ({ definitionId: 901 + index, rating: 60,
    rarity: 0, nationId: 1, leagueId: 1, teamId: 123, positions: [5], groups: [],
    special: false, evolution: false, cosmetic: false }));
  x.transport.readCatalogPage.mockImplementation(async query => ({ status: 'observed', season: '27',
    source: 'ea-defid', query, observedAt: x.now, entries: query.team === 123 ? cards : cards.slice(0, 3) }));
  const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', plans: [{ purchaseCount: 11 }],
    diagnostics: { catalogPages: 2, catalogAttempts: 2, quoteAttempts: 11 } });
  expect(x.transport.readCatalogPage.mock.calls.map(([query]) => query)).toEqual([
    { start: 0, count: 20, level: 'bronze' }, { start: 0, count: 20, level: 'bronze', team: 123 },
  ]);
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({
    status: 'suggested', requests: 0, cacheHits: 13,
  });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(11);
});

it('persists a rate limit and never automatically retries it on another click', async () => {
  const x = fixture(); x.transport.readCatalogPage.mockRejectedValue(new Error('FC27_MARKET_HTTP_429'));
  expect(await x.session.plan(x.input)).toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_HTTP_429' });
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({ requests: 0, reason: 'FC27_MARKET_HTTP_429' });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
});

it.each(['FC27_MARKET_METHOD_0_CHANGED', 'FC27_MARKET_METHOD_7_MISSING'])('re-probes cached %s on the next explicit action', async reason => {
  const x = fixture();
  x.options.createTransport.mockRejectedValueOnce(new Error(reason));
  expect(await x.session.plan(x.input)).toMatchObject({ status: 'blocked', reason, requests: 0 });
  x.transport.readCatalogPage.mockImplementationOnce(async query => ({ status: 'observed', season: '27', source: 'ea-defid',
    query, observedAt: x.now, entries: [{ definitionId: 901, rating: 60, rarity: 0, nationId: 1, leagueId: 1,
      teamId: 11, positions: [5], groups: [], special: false, evolution: false, cosmetic: false }] }));
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({ status: 'suggested', requests: 2,
    diagnostics: { failureSource: null } });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
});

it('checks a still-unknown runtime only once per explicit click without sending a request', async () => {
  const x = fixture();
  x.options.createTransport.mockRejectedValue(new Error('FC27_MARKET_METHOD_0_CHANGED'));
  for (let i = 0; i < 2; i++) {
    expect(await x.session.plan(x.input)).toMatchObject({ reason: 'FC27_MARKET_METHOD_0_CHANGED', requests: 0 });
    expect(x.options.createTransport).toHaveBeenCalledTimes(i + 1);
  }
  expect(x.transport.readCatalogPage).not.toHaveBeenCalled();
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it.each(['catalog', 'quote'])('recovers a cached %s 401 on a later action, retaining successful data', async kind => {
  const x = fixture(); let clock = x.now;
  const options = { ...x.options, now: () => clock };
  const method = kind === 'catalog' ? 'readCatalogPage' : 'readQuotePage';
  const success = x.transport[method].getMockImplementation();
  x.transport[method].mockRejectedValueOnce(Object.assign(new Error('FC27_MARKET_HTTP_401'), {
    marketFailure: { httpStatus: 401, eaCode: 1234, response: 'secret' },
  }));
  const failed = await createFc27PuzzleProcurementSession(options).plan(x.input);
  expect(failed).toMatchObject({ reason: 'FC27_MARKET_HTTP_401', diagnostics: {
    failureSource: 'request', httpStatus: 401, eaCode: 1234, retryAfterSeconds: 30, authRecoveries: 0,
  } });
  expect(JSON.stringify([...x.cache.values()])).not.toContain('secret');
  clock += 29999;
  expect(await createFc27PuzzleProcurementSession(options).plan(x.input)).toMatchObject({
    reason: 'FC27_MARKET_HTTP_401', requests: 0, diagnostics: { failureSource: 'cache', retryAfterSeconds: 1 },
  });
  expect(x.transport[method]).toHaveBeenCalledTimes(1);
  clock++;
  x.transport[method].mockImplementation(async query => ({ ...await success(query), observedAt: clock }));
  expect(await createFc27PuzzleProcurementSession(options).plan(x.input)).toMatchObject({
    status: 'suggested', diagnostics: { authRecoveries: 1, failureSource: null },
  });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(kind === 'catalog' ? 2 : 1);
  expect(x.transport[method]).toHaveBeenCalledTimes(2);
  expect(await createFc27PuzzleProcurementSession(options).plan(x.input)).toMatchObject({ requests: 0, cacheHits: 2 });
});

it('recovers legacy 401 records without clearing journals and stops after one fresh failure', async () => {
  const x = fixture(); await x.session.plan(x.input);
  const key = [...x.cache.keys()].find(key => key.includes(':quote:'));
  const old = x.cache.get(key);
  x.cache.set(key, { schema: 1, kind: old.kind, query: old.query, at: x.now - 30000,
    state: 'blocked', reason: 'FC27_MARKET_HTTP_401' });
  const journal = { phase: 'save-pending' }; x.cache.set('unrelated-journal', journal);
  x.transport.readQuotePage.mockRejectedValue(new Error('FC27_MARKET_HTTP_401'));
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({
    reason: 'FC27_MARKET_HTTP_401', requests: 1, cacheHits: 1,
    diagnostics: { authRecoveries: 1, failureSource: 'request', retryAfterSeconds: 30 },
  });
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({
    requests: 0, diagnostics: { failureSource: 'cache', authRecoveries: 0 },
  });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(2);
  expect(x.cache.get('unrelated-journal')).toEqual(journal);
});

it('retries a cached market entity failure after the reviewed factory chain changes', async () => {
  const x = fixture();
  await x.session.plan(x.input);
  const key = [...x.cache.keys()].find(value => value.includes(':catalog:'));
  const old = x.cache.get(key);
  x.cache.set(key, { schema: 1, kind: old.kind, query: old.query, at: x.now - 1000,
    state: 'blocked', reason: 'FC27_MARKET_ENTITY_UNVERIFIED' });
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', requests: 1,
    diagnostics: { failureSource: null, catalogAttempts: 1 } });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(2);
});

it.each(['pending', 'unknown', '403', '429', '500'])('does not renew %s as an authentication failure', async state => {
  const x = fixture(); await x.session.plan(x.input);
  const key = [...x.cache.keys()].find(key => key.includes(':quote:'));
  const record = x.cache.get(key); delete record.result;
  Object.assign(record, { at: x.now - 6000000, state: /^\d+$/.test(state) ? 'blocked' : state,
    reason: `FC27_MARKET_HTTP_${/^\d+$/.test(state) ? state : '401'}` });
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({ status: 'blocked', requests: 0 });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(1);
});

it('does not overwrite an eligible 401 record if the current target changes during its read', async () => {
  const x = fixture(); await x.session.plan(x.input);
  const key = [...x.cache.keys()].find(key => key.includes(':quote:'));
  const record = { ...x.cache.get(key), state: 'blocked', reason: 'FC27_MARKET_HTTP_401', at: x.now - 30000 };
  delete record.result; x.cache.set(key, record);
  let changed = false;
  const session = createFc27PuzzleProcurementSession({ ...x.options, get: async (k, fallback) => {
    const result = await x.options.get(k, fallback); if (k === key) changed = true; return result;
  } });
  expect(await session.plan(x.input, { assertCurrent: () => {
    if (changed) throw new Error('FC27_PUZZLE_FILL_TARGET_CHANGED');
  } })).toMatchObject({ reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED', requests: 0 });
  expect(x.cache.get(key)).toEqual(record);
});

it('does not query prices for candidates that cannot meet the original full-squad requirements', async () => {
  const x = fixture(); x.transport.readCatalogPage.mockImplementation(async query => ({ status: 'observed', season: '27',
    source: 'ea-defid', query, observedAt: x.now, entries: [] }));
  expect(await x.session.plan(x.input)).toMatchObject({ status: 'blocked', reason: 'FC27_PURCHASE_REPAIR_NO_PLAN',
    diagnostics: { stage: 'local-market-search', catalogCandidates: 0, usableCandidates: 0, quoteAttempts: 0,
      localReason: 'FC27_PURCHASE_REPAIR_NO_PLAN' } });
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it('keeps the quote-stage failure evidence without issuing additional requests', async () => {
  const x = fixture(); x.transport.readQuotePage.mockRejectedValue(new Error('FC27_MARKET_HTTP_429'));
  expect(await x.session.plan(x.input)).toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_HTTP_429',
    diagnostics: { stage: 'quote-read', catalogCandidates: 1, unpricedPlans: expect.any(Number),
      catalogAttempts: 1, quoteAttempts: 1 } });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(1);
});

it('refreshes only expired successful quotes once and reuses the renewed result', async () => {
  const x = fixture(); await x.session.plan(x.input);
  x.transport.readQuotePage.mockImplementation(async query => ({ status: 'observed', season: '27', platform: x.input.context.platform,
    source: 'ea-visible-buy-now', definitionId: query.definitionId, observedAt: x.now + 600001, eligible: 1, price: 350 }));
  const expired = createFc27PuzzleProcurementSession({ ...x.options, now: () => x.now + 600001 });
  expect(await expired.plan(x.input)).toMatchObject({ status: 'suggested', requests: 1, cacheHits: 1,
    plans: [{ estimatedCost: 350 }] });
  expect(await expired.plan(x.input)).toMatchObject({ status: 'suggested', requests: 0, cacheHits: 2 });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(2);
});

it('retains a failed renewal after expiry without falling back to the old quote or retrying', async () => {
  const x = fixture(); await x.session.plan(x.input);
  x.transport.readQuotePage.mockRejectedValue(new Error('FC27_MARKET_HTTP_429'));
  const options = { ...x.options, now: () => x.now + 600001 };
  expect(await createFc27PuzzleProcurementSession(options).plan(x.input)).toMatchObject({ reason: 'FC27_MARKET_HTTP_429', requests: 1, plans: [] });
  expect(await createFc27PuzzleProcurementSession(options).plan(x.input)).toMatchObject({ reason: 'FC27_MARKET_HTTP_429', requests: 0, plans: [] });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(2);
});

it('refuses context drift before querying', async () => {
  const x = fixture();
  expect(await x.session.plan(x.input, { assertCurrent: () => { throw new Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); } }))
    .toMatchObject({ reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED', requests: 0 });
});

it('stops quoting alternatives after the first complete priced repair plan', async () => {
  const x = fixture();
  const catalog = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await catalog(query);
    page.entries = Array.from({ length: 8 }, (_, index) => ({ ...page.entries[0], definitionId: 901 + index }));
    return page;
  });
  expect(await x.session.plan(x.input)).toMatchObject({ status: 'suggested', requests: 2 });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(1);
});

it.each([false, true])('refines a high-cost plan with a cheaper next page (joint=%s)', async joint => {
  const x = fixture();
  if (joint) x.input.inventory.items.pop();
  const catalog = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await catalog(query);
    const base = page.entries[0];
    const entries = Array.from({ length: query.start === 0 ? 20 : 1 }, (_, index) => ({
      ...base, definitionId: query.start === 0 ? 901 + index : 921,
      ...(query.start === 0 && index > 0 ? { special: true } : {}),
    }));
    return { ...page, entries, pageEndObserved: query.start !== 0 };
  });
  const loadPublicPrices = publicPrices(x, definitionId => definitionId === 921 ? 200 : 10000);
  const result = await createFc27PuzzleProcurementSession({ ...x.options, loadPublicPrices }).plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', plans: [{ estimatedCost: 200 }], diagnostics: {
    catalogAttempts: 2, catalogCandidates: 21, estimatedCost: 200,
  } });
  expect(result.plans[0].purchases[0]).toMatchObject({ definitionId: 921, estimatedUnitPrice: 200 });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(2);
});

it.each([false, true])('retains the incumbent when later candidates cost more, reusing pages after restart (joint=%s)', async joint => {
  const x = refinementFixture(joint);
  const loadPublicPrices = publicPrices(x, id => id === 921 ? 12000 : 10000);
  const options = { ...x.options, loadPublicPrices };
  const first = await createFc27PuzzleProcurementSession(options).plan(x.input);
  expect(first).toMatchObject({ status: 'suggested', plans: [{ estimatedCost: 10000 }], diagnostics: {
    initialEstimatedCost: 10000, estimatedCost: 10000, refinementPasses: 2,
  } });
  expect(first.diagnostics.nodes).toBeLessThanOrEqual(joint ? 50000 : 20000);
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(3);
  const second = await createFc27PuzzleProcurementSession(options).plan(x.input);
  expect(second).toMatchObject({ status: 'suggested', requests: 0, cacheHits: 3, plans: [{ estimatedCost: 10000 }] });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(3);
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it('does not paginate an explicitly exhausted catalog lane', async () => {
  const x = refinementFixture();
  const original = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => ({ ...await original(query), pageEndObserved: true }));
  const result = await createFc27PuzzleProcurementSession({ ...x.options, loadPublicPrices: publicPrices(x, () => 10000) }).plan(x.input);
  expect(result.status).toBe('suggested');
  expect(x.transport.readCatalogPage.mock.calls.every(([query]) => query.start === 0)).toBe(true);
});

it.each(['FC27_MARKET_HTTP_401', 'FC27_MARKET_HTTP_429'])('does not hide a later catalog %s behind a valid incumbent', async reason => {
  const x = refinementFixture();
  const original = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    if (query.start > 0) throw Error(reason);
    return original(query);
  });
  const result = await createFc27PuzzleProcurementSession({ ...x.options, loadPublicPrices: publicPrices(x, () => 10000) }).plan(x.input);
  expect(result).toMatchObject({ status: 'blocked', reason, plans: [], diagnostics: { initialEstimatedCost: 10000 } });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(2);
});

it('refuses context drift during refinement even when the first plan was valid', async () => {
  const x = refinementFixture(); let changed = false;
  const original = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await original(query); if (query.start > 0) changed = true; return page;
  });
  expect(await createFc27PuzzleProcurementSession({ ...x.options, loadPublicPrices: publicPrices(x, () => 10000) }).plan(x.input,
    { assertCurrent: () => { if (changed) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); } }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED', plans: [] });
});

it('keeps the valid incumbent when a new candidate lacks the selected public quote, without EA quote fallback', async () => {
  const x = refinementFixture();
  const result = await createFc27PuzzleProcurementSession({ ...x.options,
    loadPublicPrices: publicPrices(x, id => id === 921 ? null : 10000) }).plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', plans: [{ estimatedCost: 10000 }], diagnostics: { excludedUnavailable: 1 } });
  expect(x.transport.readQuotePage).not.toHaveBeenCalled();
});

it('rechecks incumbent quote expiry before returning after refinement', async () => {
  const x = refinementFixture(); let clock = x.now;
  const original = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await original(query);
    if (query.start > 0) clock += 300001;
    return { ...page, observedAt: clock };
  });
  expect(await createFc27PuzzleProcurementSession({ ...x.options, now: () => clock,
    loadPublicPrices: publicPrices(x, () => 10000) }).plan(x.input))
    .toMatchObject({ status: 'blocked', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED', plans: [] });
});

it('retains the improved total cost when a third lane produces no cheaper result', async () => {
  const x = refinementFixture();
  const original = x.transport.readCatalogPage.getMockImplementation();
  let pageIndex = 0;
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await original(query);
    if (++pageIndex === 3) return { ...page, entries: [{ ...page.entries[0], definitionId: 922 }] };
    return page;
  });
  const result = await createFc27PuzzleProcurementSession({ ...x.options,
    loadPublicPrices: publicPrices(x, id => id === 921 ? 800 : 10000) }).plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', plans: [{ estimatedCost: 800 }], diagnostics: {
    initialEstimatedCost: 10000, estimatedCost: 800, refinementPasses: 2,
  } });
});

it.each([false, true])('uses the last remaining search unit and retains the incumbent at exhaustion (joint=%s)', async joint => {
  const x = refinementFixture(joint);
  const budget = joint ? 50000 : 20000;
  const method = joint ? 'suggestFc27PuzzleJointPurchasesCooperatively' : 'suggestFc27PuzzlePurchasesCooperatively';
  const original = procurement[method]; let pass = 0;
  const spy = vi.spyOn(procurement, method).mockImplementation(async (...args) => {
    const options = args.at(-1);
    expect(options[joint ? 'maxNodes' : 'maxChecks']).toBe(pass ? 1 : budget);
    if (pass++) return { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', plans: [], truncated: true,
      ...(joint ? { nodes: 1 } : { checks: 1 }) };
    const result = await original(...args);
    return { ...result, ...(joint ? { nodes: budget - 1 } : { checks: budget - 1 }) };
  });
  try {
    const result = await createFc27PuzzleProcurementSession({ ...x.options,
      loadPublicPrices: publicPrices(x, () => 10000) }).plan(x.input);
    expect(result).toMatchObject({ status: 'suggested', plans: [{ estimatedCost: 10000 }], diagnostics: {
      initialEstimatedCost: 10000, nodes: budget, optimizationBudgetExhausted: true,
      searchComplete: false, optimalWithinPool: false,
    } });
    expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(2);
  } finally { spy.mockRestore(); }
});

it('continues to procurement and persists a full concept plan when an owned slot is missing', async () => {
  const x = fixture(); x.input.inventory.items.pop();
  const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', plans: [{ purchaseCount: 1,
    conceptPlan: { status: 'prepared', purchaseCount: 1, slots: expect.any(Array) } }] });
  expect(result.plans[0].conceptPlan.slots.filter(slot => slot.kind === 'concept')).toHaveLength(1);
  const again = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(again.requests).toBe(0);
});

it('prices every missing slot in an eleven-card concept plan and reuses all reads after restart', async () => {
  const x = fixture();
  x.input.challenge.slotCount = 11;
  x.input.challenge.formation = { id: 16, positions: Array(11).fill(5) };
  x.input.challenge.rawRequirements = [{ count: -1, scope: 2, pairs: [{ key: 3, values: [1] }] }];
  x.input.inventory.items = [];
  const entries = Array.from({ length: 11 }, (_, index) => ({ definitionId: 2000 + index,
    rating: 60, nationId: 2, teamId: 10 + index, leagueId: 2, positions: [5], rarity: 0,
    groups: [], special: false, evolution: false, cosmetic: false }));
  x.transport.readCatalogPage.mockImplementation(async query => ({ status: 'observed', season: '27', source: 'ea-defid',
    query, observedAt: x.now, entries }));
  x.transport.readQuotePage.mockImplementation(async query => ({ status: 'observed', season: '27',
    platform: x.input.context.platform, source: 'ea-visible-buy-now', definitionId: query.definitionId,
    observedAt: x.now, eligible: 1, price: 200 }));
  const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', requests: 12,
    plans: [{ purchaseCount: 11, estimatedCost: 2200, conceptPlan: { status: 'prepared', purchaseCount: 11 } }] });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(11);
  expect(new Set(x.transport.readQuotePage.mock.calls.map(([query]) => query.definitionId)).size).toBe(11);
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input))
    .toMatchObject({ status: 'suggested', requests: 0, cacheHits: 12 });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(11);
});

it.each([false, true])('replans without an unavailable version using the same catalog (joint=%s)', async joint => {
  const x = fixture(); if (joint) x.input.inventory.items.pop();
  const catalog = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await catalog(query); page.entries.push({ ...page.entries[0], definitionId: 902 }); return page;
  });
  const quote = x.transport.readQuotePage.getMockImplementation();
  x.transport.readQuotePage.mockImplementation(async query => ({ ...await quote(query),
    eligible: query.definitionId === 901 ? 0 : 1, price: query.definitionId === 901 ? null : 300 }));
  const result = await x.session.plan(x.input);
  expect(result).toMatchObject({ status: 'suggested', requests: 3, diagnostics: { excludedUnavailable: 1, replans: joint ? 1 : 0 },
    plans: [{ purchases: [{ definitionId: 902 }], conceptPlan: { status: 'prepared' } }] });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(1);
  expect(x.transport.readQuotePage.mock.calls.map(([q]) => q.definitionId)).toEqual([901, 902]);
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input)).toMatchObject({ status: 'suggested', requests: 0 });
});

it('reports unavailable quotes when the sampled candidates are exhausted, without querying a version twice', async () => {
  const x = fixture(); const quote = x.transport.readQuotePage.getMockImplementation();
  x.transport.readQuotePage.mockImplementation(async query => ({ ...await quote(query), eligible: 0, price: null }));
  expect(await x.session.plan(x.input)).toMatchObject({ reason: 'FC27_PURCHASE_QUOTES_UNAVAILABLE',
    diagnostics: { excludedUnavailable: 1 } });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(1);
});

it.each([null, 5000])('accepts quotes above 2000 within the configured ceiling %j', async quoteCeiling => {
  const x = fixture(); const quote = x.transport.readQuotePage.getMockImplementation();
  x.transport.readQuotePage.mockImplementation(async query => ({ ...await quote(query), price: 4500 }));
  expect(await x.session.plan(x.input, { quoteCeiling })).toMatchObject({ status: 'suggested', quoteCeiling,
    plans: [{ estimatedCost: 4500, conceptPlan: { status: 'prepared' } }] });
  expect(x.transport.readQuotePage).toHaveBeenCalledExactlyOnceWith({ definitionId: 901, start: 0, count: 20, maxBuy: quoteCeiling });
});

it('keeps quote caches separate across price settings and reuses catalog data', async () => {
  const x = fixture(); const quote = x.transport.readQuotePage.getMockImplementation();
  x.transport.readQuotePage.mockImplementation(async query => ({ ...await quote(query),
    eligible: query.maxBuy === 2000 ? 0 : 1, price: query.maxBuy === 2000 ? null : 4500 }));
  expect(await x.session.plan(x.input, { quoteCeiling: 2000 })).toMatchObject({ reason: 'FC27_PURCHASE_QUOTES_UNAVAILABLE', quoteCeiling: 2000 });
  const count = x.transport.readCatalogPage.mock.calls.length;
  expect(await x.session.plan(x.input, { quoteCeiling: 5000 })).toMatchObject({ status: 'suggested', requests: 1 });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(count);
  expect(await x.session.plan(x.input, { quoteCeiling: 2000 })).toMatchObject({ reason: 'FC27_PURCHASE_QUOTES_UNAVAILABLE', requests: 0 });
  expect(x.transport.readQuotePage).toHaveBeenCalledTimes(2);
});

it('rejects an over-ceiling quote rather than silently increasing the setting', async () => {
  const x = fixture(); const quote = x.transport.readQuotePage.getMockImplementation();
  x.transport.readQuotePage.mockImplementation(async query => ({ ...await quote(query), price: 4500 }));
  expect(await x.session.plan(x.input, { quoteCeiling: 3000 })).toMatchObject({ reason: 'FC27_PURCHASE_QUOTE_UNVERIFIED', plans: [] });
});

it('continues after a read budget stop using cached observations without poisoning unsent queries', async () => {
  const x = fixture(); const catalog = x.transport.readCatalogPage.getMockImplementation();
  x.transport.readCatalogPage.mockImplementation(async query => {
    const page = await catalog(query);
    page.entries = Array.from({ length: 20 }, (_, i) => ({ ...page.entries[0], definitionId: 901 + i + (query.team ? 0 : 20) }));
    return page;
  });
  const quote = x.transport.readQuotePage.getMockImplementation();
  x.transport.readQuotePage.mockImplementation(async query => ({ ...await quote(query),
    eligible: query.definitionId === 925 ? 1 : 0, price: query.definitionId === 925 ? 300 : null }));
  expect(await x.session.plan(x.input)).toMatchObject({ reason: 'FC27_PURCHASE_READ_BUDGET', requests: 25 });
  expect([...x.cache.values()].every(record => record.state === 'observed')).toBe(true);
  expect(x.options.createTransport).toHaveBeenCalledWith({ maxRequests: 25 });
  const catalogs = x.transport.readCatalogPage.mock.calls.length;
  const resumed = await createFc27PuzzleProcurementSession(x.options).plan(x.input);
  expect(resumed).toMatchObject({ status: 'suggested', requests: 2, plans: [{ purchases: [{ definitionId: 925 }] }] });
  expect(x.transport.readCatalogPage).toHaveBeenCalledTimes(catalogs);
  const ids = x.transport.readQuotePage.mock.calls.map(([query]) => query.definitionId);
  expect(new Set(ids).size).toBe(ids.length);
});
