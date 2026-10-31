import { expect, it, vi } from 'vitest';
import observed from '../fixtures/fc27-puzzle-catalog-coverage.json';
import { puzzleFillFixture } from '../helpers/fc27-puzzle-fill-fixture.js';
import { evaluateFc27PuzzleSquad, boundFc27PuzzleChemistry } from '../../src/fc27/puzzle-evaluator.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { puzzleMarketValueCandidates } from '../../src/fc27/puzzle-procurement.js';

function fixture() {
  const input = puzzleFillFixture(), now = input.now;
  input.challenge = { ...observed.challenge, context: input.context };
  input.chemistry = structuredClone(observed.chemistry); input.clubLinks = structuredClone(observed.clubLinks);
  input.policy.maxRating = 85; input.policy.goldRange = [75, 90]; input.inventory.items = structuredClone(observed.owned);
  input.policy.lockedItemIds = []; input.policy.activeSquadItemIds = [];
  input.evaluateSquad = squad => evaluateFc27PuzzleSquad({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  input.boundSquad = squad => boundFc27PuzzleChemistry({ squad, formation: input.challenge.formation,
    chemistry: input.chemistry, rating: input.chemistry.rating });
  const scope = traditionalJournalScope(input.context), cache = new Map(), prices = new Map(observed.prices);
  for (const page of observed.pages) {
    const at = now - page.ageHours * 3600000;
    cache.set(`fcat-fc27-puzzle-market:${scope}:catalog:${JSON.stringify(page.query)}`, {
      schema: 1, kind: 'catalog', query: page.query, at, state: 'observed', result: {
        status: 'observed', source: 'ea-defid', season: '27', query: page.query, observedAt: at,
        entries: page.entries, pageEndObserved: page.pageEndObserved,
      },
    });
  }
  const readCatalogPage = vi.fn(async query => {
    const page = [...observed.pages, ...(observed.fallbackPages ?? [])].find(page => JSON.stringify(page.query) === JSON.stringify(query));
    if (!page) throw Error('FC27_UNEXPECTED_FIXTURE_QUERY');
    return { status: 'observed', source: 'ea-defid', season: '27', query, observedAt: now,
      entries: structuredClone(page.entries), pageEndObserved: page.pageEndObserved };
  });
  const loadPublicPrices = vi.fn(async ids => ({ policy: { source: 'futbin', futbinPlatform: 'ps' },
    references: Object.fromEntries(ids.map(definitionId => [definitionId, { definitionId, season: '27', platform: 'pc',
      quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, { schema: 2, source, futbinPlatform: 'ps', definitionId,
        season: '27', platform: 'pc', price: prices.get(definitionId) ?? null,
        fetchedAt: now, expiresAt: now + 300000, sourceUpdatedAt: null, error: null }])) }])) }));
  const options = { now: () => now, get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback),
    set: async (key, value) => cache.set(key, structuredClone(value)), list: async () => [...cache.keys()],
    loadPublicPrices, loadCachedPrices: async ids => ({ hintOnly: true,
      prices: new Map(ids.filter(id => prices.has(id)).map(id => [id, prices.get(id)])) }),
    createTransport: async () => ({ readCatalogPage, readQuotePage: () => { throw Error('No auction reads'); } }),
  };
  return { input, now, cache, prices, options, readCatalogPage, loadPublicPrices };
}

it('widens the real first-page 65/75 sample through fresh native reads before accepting a costly plan', async () => {
  const x = fixture();
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result.status, JSON.stringify(result)).toBe('suggested');
  expect(result.plans[0].materialValue).toBeLessThanOrEqual(6000);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(20);
  expect([...result.plans[0].purchases, ...result.plans[0].selectedOwned].filter(card => card.rating >= 75)).toHaveLength(4);
  expect(x.readCatalogPage.mock.calls).toHaveLength(2);
  expect(result.queries).toHaveLength(5);
  expect(result.diagnostics.nodes).toBeLessThanOrEqual(70000);
  expect(result.diagnostics.hintNodes).toBeLessThanOrEqual(24000);
  expect(result.globalMinimumProven).toBe(false);
});

it('does not quote versions with no usable position when the native chemistry minimum requires all seven in position', async () => {
  const x = fixture();
  const slots = x.input.challenge.formation.positions.filter((_position, index) => !x.input.challenge.brickIndices.includes(index));
  const impossible = new Set(observed.pages.flatMap(page => page.entries).filter(card => !card.positions.some(position => slots.includes(position)))
    .map(card => card.definitionId));
  expect(impossible.size).toBeGreaterThan(0);
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result.status).toBe('suggested');
  expect(x.loadPublicPrices.mock.calls.flatMap(([ids]) => ids).filter(id => impossible.has(id))).toEqual([]);
  expect(result.plans[0].materialValue).toBeLessThanOrEqual(6000);
});

it.each([18,19,20])('only prunes off-position price candidates when the native chemistry floor proves it at %i/7', minimum => {
  const x = fixture(); x.input.challenge.rawRequirements.find(rule => rule.pairs[0].key === 35).pairs[0].values = [minimum];
  const wing = { ...observed.pages[0].entries[0], definitionId: 8000901, positions: [25] };
  const result = puzzleMarketValueCandidates(x.input, [wing]);
  expect(result.some(card => card.definitionId === wing.definitionId)).toBe(minimum <= 18);
});

it('does not infer a position-pruning proof from unsupported chemistry profiles', () => {
  const x = fixture(); x.input.chemistry.profiles.complete = false;
  const wing = { ...observed.pages[0].entries[0], definitionId: 8000901, positions: [25] };
  expect(puzzleMarketValueCandidates(x.input, [wing])).toHaveLength(1);
});

it('does not price provably unusable owned cards or mislabel them as unknown material value', async () => {
  const x = fixture(), extra = { ...x.input.inventory.items[0], id: 1001, definitionId: 8000901, positions: [25] };
  x.input.inventory.items.push(extra); x.prices.set(extra.definitionId, 200);
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result.status).toBe('suggested');
  expect(x.loadPublicPrices.mock.calls.flatMap(([ids]) => ids)).not.toContain(extra.definitionId);
  expect(result.diagnostics).toMatchObject({ unknownCount: 0, scopeTruncated: false });
});

it.each(['empty', 'expensive'])('retains the freshly priced incumbent when historical directions are now %s', async mode => {
  const baseline = fixture();
  const original = await createFc27PuzzleProcurementSession({ ...baseline.options, list: null })
    .plan(baseline.input, { optimizeMaterialValue: true });
  const x = fixture(), read = x.readCatalogPage.getMockImplementation();
  x.readCatalogPage.mockImplementation(async query => {
    const page = await read(query);
    if (mode === 'empty') return { ...page, entries: [] };
    for (const card of page.entries) x.prices.set(card.definitionId, 1000000);
    return page;
  });
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result.status).toBe('suggested');
  expect(result.plans[0].materialValue).toBe(original.plans[0].materialValue);
  expect(result.plans[0].purchases.map(card => card.definitionId)).toEqual(original.plans[0].purchases.map(card => card.definitionId));
  expect(x.readCatalogPage).toHaveBeenCalledTimes(2);
});

it.each(['FC27_MARKET_HTTP_401', 'FC27_MARKET_HTTP_403', 'FC27_MARKET_HTTP_429'])('does not bypass %s during native coverage renewal', async reason => {
  const x = fixture(); x.readCatalogPage.mockRejectedValue(Error(reason));
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result).toMatchObject({ status: 'blocked', reason, plans: [] });
  expect(x.readCatalogPage).toHaveBeenCalledTimes(1);
});

it('does not replay a pending historical read or erase unrelated transaction evidence', async () => {
  const x = fixture(), key = 'fcat-fc27-puzzle-buy-pending:synthetic';
  const pending = { operationId: 'receipt-to-reconcile', state: 'buy-pending' };
  x.cache.set(key, pending);
  const cached = x.options.loadCachedPrices;
  x.options.loadCachedPrices = async (...args) => {
    const result = await cached(...args);
    for (const [name, row] of x.cache) if (row?.at < x.now - 86400000) x.cache.set(name, { ...row, state: 'pending' });
    return result;
  };
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_PURCHASE_READ_UNCONFIRMED' });
  expect(x.readCatalogPage).not.toHaveBeenCalled();
  expect(x.cache.get(key)).toEqual(pending);
});

it('awaits coverage refinement under the busy guard', async () => {
  const x = fixture(); let release;
  const ready = new Promise(resolve => { release = resolve; });
  const cached = x.options.loadCachedPrices;
  x.options.loadCachedPrices = async (...args) => { await ready; return cached(...args); };
  const session = createFc27PuzzleProcurementSession(x.options);
  const planning = session.plan(x.input, { optimizeMaterialValue: true });
  expect(await session.plan(x.input)).toMatchObject({ status: 'blocked', reason: 'FC27_PURCHASE_BUSY' });
  release();
  expect((await planning).status).toBe('suggested');
});

it('still blocks expired final prices after the extra coverage reads', async () => {
  const x = fixture(); let time = x.now;
  x.options.now = () => time;
  const read = x.readCatalogPage.getMockImplementation();
  x.readCatalogPage.mockImplementation(async query => {
    const page = await read(query); time = x.now + 300001;
    return { ...page, observedAt: time };
  });
  expect(await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED', plans: [] });
});

it('does not read another account catalogue or turn its cheap history into a plan', async () => {
  const x = fixture(), get = vi.fn(x.options.get);
  x.options.get = get;
  x.options.list = async () => ['fcat-fc27-puzzle-market:foreign:catalog:{"start":0,"count":20,"level":"gold"}'];
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result.status).toBe('suggested');
  expect(get.mock.calls.some(([key]) => key.includes(':foreign:'))).toBe(false);
  expect(x.readCatalogPage.mock.calls.every(([query]) => query.start === 20)).toBe(true);
});

it('still widens targeted native pages when there is no catalogue history to guide it', async () => {
  const x = fixture(); x.options.list = async () => [];
  const result = await createFc27PuzzleProcurementSession(x.options).plan(x.input, { optimizeMaterialValue: true });
  expect(result.status, JSON.stringify(result)).toBe('suggested');
  expect(result.plans[0].materialValue).toBeLessThanOrEqual(12050);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(20);
  expect(x.readCatalogPage).toHaveBeenCalledTimes(2);
  expect(result.queries).toContainEqual({ start: 20, count: 20, level: 'gold', nation: 45 });
});
