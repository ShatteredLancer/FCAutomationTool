import { afterEach, expect, it, vi } from 'vitest';
import { marketFixture, marketRow } from '../helpers/fc27-market-fixture.js';
import { puzzleBudgetFixture as fixture } from '../helpers/fc27-puzzle-budget-fixture.js';
import { createFc27PuzzleProcurementSession } from '../../src/fc27/puzzle-procurement-session.js';
import * as procurement from '../../src/fc27/puzzle-procurement.js';
import { createFc27PuzzleSearchBudget, finishPuzzleSearch,
  iterateFc27PuzzleCandidateRoutes } from '../../src/fc27/puzzle-preview.js';
import { formatFc27PuzzleProgress } from '../../src/adapters/browser/fc27-puzzle-native-button.js';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';
import { nationalityCapFixture } from '../helpers/fc27-puzzle-nationality-cap-fixture.js';

afterEach(() => vi.restoreAllMocks());

it('opts the production joint Session seam into cumulative 50k/100k/200k without extra catalog lanes', async () => {
  const { input, entries } = fixture();
  vi.spyOn(procurement, 'findFc27PuzzleRepairSeedCooperatively').mockResolvedValue({
    status: 'unavailable', reason: 'FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE' });
  const queries = [0, 20, 40].map(start => ({ level: 'gold', start, count: 20 }));
  vi.spyOn(procurement, 'planFc27PuzzleShortageQueries').mockImplementation((_input, _entries, { usedQueries = [] } = {}) =>
    ({ status: 'ready', queries: queries.filter(query => !usedQueries.some(used => used.start === query.start)) }));
  const readCatalogPage = vi.fn(async query => ({ status: 'observed', season: '27', source: 'ea-defid',
    observedAt: input.now, query, entries: entries.map(entry => ({ ...entry, definitionId: entry.definitionId + query.start })) }));
  const readQuotePage = vi.fn();
  const cache = new Map(), progress = [];
  const loadPublicPrices = vi.fn(async ids => ({ policy: { source: 'futgg' },
    references: Object.fromEntries(ids.map(definitionId => [definitionId, { definitionId, season: '27', platform: 'pc',
      quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, {
        schema: 2, source, definitionId, season: '27', platform: 'pc', price: 200,
        fetchedAt: input.now, sourceUpdatedAt: null, expiresAt: input.now + 300000, error: null,
      }])) }])) }));
  const result = await createFc27PuzzleProcurementSession({ now: () => input.now,
    get: async (key, fallback) => cache.get(key) ?? fallback,
    set: async (key, value) => cache.set(key, value),
    createTransport: async () => ({ readCatalogPage, readQuotePage }), loadPublicPrices,
  }).plan(input, { adaptiveSearch: true, onProgress: value => progress.push(value) });
  expect(result.reason, JSON.stringify(result.diagnostics)).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  expect(result.diagnostics.nodes).toBe(200000);
  expect([...new Set(progress.filter(value => value.budgetStage).map(value => value.maxNodes))]).toEqual([50000, 100000, 200000]);
  const searches = progress.filter(value => value.budgetStage);
  expect(searches.every((value, index) => !index || value.nodes >= searches[index - 1].nodes)).toBe(true);
  expect(searches.every(value => value.nodes <= value.maxNodes && value.maxNodes <= 200000)).toBe(true);
  expect(readCatalogPage).toHaveBeenCalledTimes(3);
  expect(readQuotePage).not.toHaveBeenCalled();
}, 30000);

it.each(['catalog', 'quote'])('retains a completed %s read across cancellation and reuses it only in the same account', async kind => {
  const input = marketFixture(), cache = new Map();
  input.inventory.items = [];
  let current = true, release, signal;
  const started = new Promise(resolve => { signal = resolve; });
  const response = new Promise(resolve => { release = resolve; });
  const readCatalogPage = vi.fn(async query => {
    if (kind === 'catalog' && readCatalogPage.mock.calls.length === 1) { signal(); await response; }
    return { status: 'observed', season: '27', source: 'ea-defid', query, observedAt: input.now,
      entries: input.catalog.entries };
  });
  const readQuotePage = vi.fn(async query => {
    if (kind === 'quote' && readQuotePage.mock.calls.length === 1) { signal(); await response; }
    return { status: 'observed', season: '27', platform: 'pc', source: 'ea-visible-buy-now',
      definitionId: query.definitionId, observedAt: input.now, eligible: 1, price: 200 };
  });
  const session = createFc27PuzzleProcurementSession({ now: () => input.now,
    get: async (key, fallback) => structuredClone(cache.get(key) ?? fallback),
    set: async (key, value) => cache.set(key, structuredClone(value)),
    createTransport: async () => ({ readCatalogPage, readQuotePage }),
  });
  const options = { adaptiveSearch: true,
    assertCurrent: () => { if (!current) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); } };
  const pending = session.plan(input, options);
  await started; current = false; release();
  expect(await pending).toMatchObject({ status: 'blocked', reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED' });
  const completed = [...cache.values()].find(row => row.kind === kind);
  expect(completed).toMatchObject({ state: 'observed', result: { status: 'observed' } });
  const catalogCalls = readCatalogPage.mock.calls.length, quoteCalls = readQuotePage.mock.calls.length;
  current = true;
  const second = await session.plan(input, options);
  expect(second.status, JSON.stringify(second.diagnostics)).toBe('suggested');
  expect(second.cacheHits).toBeGreaterThanOrEqual(1);
  expect(readCatalogPage).toHaveBeenCalledTimes(catalogCalls);
  if (kind === 'quote') expect(readQuotePage.mock.calls.slice(quoteCalls)
    .some(([query]) => query.definitionId === completed.result.definitionId)).toBe(false);
  const foreign = { ...input, context: { ...input.context, accountScope: 'another-synthetic-account' } };
  foreign.inventory = { ...input.inventory, context: foreign.context };
  foreign.policy = { ...input.policy, context: foreign.context };
  foreign.challenge = { ...input.challenge, context: foreign.context };
  expect((await session.plan(foreign, options)).status).toBe('suggested');
  expect(readCatalogPage).toHaveBeenCalledTimes(catalogCalls + 1);
  expect(second.plans[0].conceptPlan.status).toBe('prepared');
}, 30000);

it.each([['pending-set', false], ['pending-get', false], ['transport-setup', false], ['pending-get', true]])(
  'only releases its own unsent cache attempt on cancellation in %s (foreign pending=%s)', async (window, foreign) => {
    const input = marketFixture(), cache = new Map(); input.inventory.items = [];
    let current = true, release, signal, paused = false, pendingKey;
    const started = new Promise(resolve => { signal = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const pause = async () => { paused = true; signal(); await gate; };
    const readCatalogPage = vi.fn(async query => ({ status: 'observed', season: '27', source: 'ea-defid', query,
      observedAt: input.now, entries: input.catalog.entries }));
    const session = createFc27PuzzleProcurementSession({ now: () => input.now,
      get: async (key, fallback) => {
        const value = structuredClone(cache.get(key) ?? fallback);
        if (!paused && value?.state === 'pending' && window === 'pending-get') await pause();
        return value;
      },
      set: async (key, value) => {
        cache.set(key, structuredClone(value));
        if (value?.state === 'pending') pendingKey = key;
        if (!paused && value?.state === 'pending' && window === 'pending-set') await pause();
      },
      createTransport: async () => {
        if (!paused && window === 'transport-setup') await pause();
        return { readCatalogPage, readQuotePage: async query => ({ status: 'observed', season: '27', platform: 'pc',
          source: 'ea-visible-buy-now', definitionId: query.definitionId, observedAt: input.now, eligible: 1, price: 200 }) };
      },
    });
    const options = { adaptiveSearch: true,
      assertCurrent: () => { if (!current) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); } };
    const first = session.plan(input, options); await started;
    const foreignRecord = foreign ? { ...cache.get(pendingKey), at: input.now + 1 } : null;
    if (foreign) cache.set(pendingKey, foreignRecord);
    current = false; release();
    expect((await first).status).toBe('blocked');
    expect(readCatalogPage).not.toHaveBeenCalled();
    if (foreign) expect(cache.get(pendingKey)).toEqual(foreignRecord);
    else expect(cache.get(pendingKey)).toMatchObject({ state: 'cancelled', requestAttempted: false,
      reason: 'FC27_PUZZLE_FILL_TARGET_CHANGED' });
    current = true;
    const second = await session.plan(input, options);
    expect(second.status, JSON.stringify(second.diagnostics)).toBe(foreign ? 'blocked' : 'suggested');
    expect(readCatalogPage).toHaveBeenCalledTimes(foreign ? 0 : 1);
  });

it.each(['FC27_MARKET_HTTP_401', 'FC27_MARKET_HTTP_429', 'FC27_MARKET_HTTP_503', 'FC27_PURCHASE_READ_FAILED'])(
  'retains genuine attempted %s cache blocks even if cancellation happens during the failed response', async reason => {
    const input = marketFixture(), cache = new Map(); input.inventory.items = [];
    let current = true;
    const readCatalogPage = vi.fn(async () => { current = false; throw Error(reason); });
    const session = createFc27PuzzleProcurementSession({ now: () => input.now,
      get: async (key, fallback) => cache.get(key) ?? fallback, set: async (key, value) => cache.set(key, value),
      createTransport: async () => ({ readCatalogPage }),
    });
    const options = { assertCurrent: () => { if (!current) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); } };
    expect(await session.plan(input, options)).toMatchObject({ status: 'blocked', reason });
    expect([...cache.values()][0]).toMatchObject({ state: 'blocked', reason });
    current = true;
    expect(await session.plan(input, options)).toMatchObject({ status: 'blocked', reason, requests: 0 });
    expect(readCatalogPage).toHaveBeenCalledOnce();
  });

it('continues the same DFS past 50k, retains the fixed prefix, and stops soon after a valid incumbent', () => {
  const fixed = fixture(), adaptive = fixture();
  const fixedEvaluations = [], adaptiveEvaluations = [];
  const key = squad => squad.filter(Boolean).map(card => card.definitionId).join(',');
  fixed.input.evaluateSquad = squad => { fixedEvaluations.push(key(squad)); return { status: 'observed', teamRating: 69 }; };
  const legacy = procurement.suggestFc27PuzzleJointPurchases(fixed.input, fixed.entries, { maxNodes: 50000 });
  expect(legacy).toMatchObject({ reason: 'FC27_PUZZLE_SEARCH_LIMIT', nodes: 50000 });
  const budget = createFc27PuzzleSearchBudget(), progress = [];
  adaptive.input.evaluateSquad = squad => {
    adaptiveEvaluations.push(key(squad));
    return { status: 'observed', teamRating: budget.snapshot().budgetNodes > 60000 ? 75 : 69 };
  };
  const result = procurement.suggestFc27PuzzleJointPurchases(adaptive.input, adaptive.entries, {
    maxNodes: 200000, searchBudget: budget, onProgress: value => progress.push(value),
  });
  expect(result.status).toBe('suggested');
  expect(result.plans[0].teamFacts.teamRating).toBe(75);
  expect(result.nodes).toBeGreaterThan(60000); expect(result.nodes).toBeLessThan(100000);
  expect(adaptiveEvaluations.slice(0, fixedEvaluations.length)).toEqual(fixedEvaluations);
  expect(new Set(adaptiveEvaluations).size).toBe(adaptiveEvaluations.length);
  expect([...new Set(progress.map(value => value.budgetStage))]).toEqual([1, 2]);
  expect(budget.snapshot()).toMatchObject({ budgetNodes: result.nodes, budgetStage: 2, maxNodes: 100000 });
}, 30000);

it('shares exactly 200k among preferred quality, native fallback and multiple starts', () => {
  const { input, entries } = fixture();
  input.challenge.rawRequirements.push(marketRow(3, 1), marketRow(35, 1));
  const all = [...entries, ...entries.map(card => ({ ...card, definitionId: card.definitionId + 20, rating: 60 }))];
  const candidates = procurement.marketCandidates(input, all);
  const budget = createFc27PuzzleSearchBudget();
  const result = finishPuzzleSearch(iterateFc27PuzzleCandidateRoutes({ ...input, maxNodes: 200000, searchBudget: budget,
    pool: { status: 'candidates', required: 9, candidates },
    procurement: { priceAware: true, budget: 100000, maxPurchases: 9, costOf: () => 200 },
  }));
  expect(result.reason).toBe('FC27_PUZZLE_SEARCH_LIMIT');
  expect(result.nodes).toBe(200000);
  expect(result.routeBudgets.preferredNodes).toBeGreaterThan(0);
  expect(result.routeBudgets.fallbackNodes).toBeGreaterThan(0);
  expect(result.routeBudgets.preferredNodes + result.routeBudgets.fallbackNodes).toBe(200000);
  expect(result.strategyAttempts).toBeGreaterThan(2);
  expect(budget.takeNode()).toBe(false);
}, 30000);

it.each([50000, 100000])('cooperatively cancels the actual traversal after the %i stage boundary', async threshold => {
  const { input, entries } = fixture();
  const budget = createFc27PuzzleSearchBudget();
  let current = true;
  await expect(procurement.suggestFc27PuzzleJointPurchasesCooperatively(input, entries, {
    maxNodes: 200000, searchBudget: budget, sliceMs: 0, yieldControl: async () => {},
    onProgress: () => { if (budget.snapshot().budgetNodes > threshold) current = false; },
    assertCurrent: () => { if (!current) throw Error('FC27_PUZZLE_FILL_TARGET_CHANGED'); },
  })).rejects.toThrow('FC27_PUZZLE_FILL_TARGET_CHANGED');
  expect(budget.snapshot().budgetNodes).toBe(threshold + 1);
}, 30000);

it('never widens an explicit fixed maxNodes, and rejects malformed/oversized adaptive budgets', () => {
  const { input, entries } = fixture(), budget = createFc27PuzzleSearchBudget();
  const fixed = procurement.suggestFc27PuzzleJointPurchases(input, entries, { maxNodes: 100, searchBudget: budget });
  expect(fixed.nodes).toBe(100); expect(budget.snapshot().budgetNodes).toBe(100);
  for (const options of [{ maxNodes: 50001 }, { maxNodes: 200001, searchBudget: budget },
    { maxNodes: 200000, searchBudget: {} }, { maxNodes: 200000, searchBudget: budget, localOnly: true }]) {
    expect(procurement.suggestFc27PuzzleJointPurchases(input, entries, options).reason).toBe('FC27_PURCHASE_REPAIR_BUDGET_INVALID');
  }
  budget.markFeasible(); budget.accountFixed(49900);
  expect(budget.takeNode()).toBe(false);
  expect(() => budget.accountFixed(1)).toThrow('FC27_PUZZLE_BUDGET_INVALID');
  expect(budget.snapshot()).toMatchObject({ budgetStage: 1, budgetNodes: 50000, maxNodes: 50000 });
});

it.each([0, 50000])('reserves refinement inside the current feasible stage without adding nodes (prefix=%i)', prefix => {
  const budget = createFc27PuzzleSearchBudget({ refinementReserve: 6000 });
  for (let i = 0; i < prefix + 1; i++) expect(budget.takeNode()).toBe(true);
  budget.markFeasible();
  while (budget.takeNode()) { /* finish the unchanged feasibility/optimization slice */ }
  expect(budget.snapshot()).toMatchObject({ budgetNodes: prefix + 44000, maxNodes: prefix + 50000, budgetStage: prefix ? 2 : 1 });
  expect(budget.remainingForSearch()).toBe(0);
  expect(budget.remaining()).toBe(6000);
  budget.accountFixed(6000);
  expect(budget.remaining()).toBe(0);
  expect(budget.takeNode()).toBe(false);
  expect(() => budget.accountFixed(1)).toThrow('FC27_PUZZLE_BUDGET_INVALID');
});

it('does not invent reserved capacity if a solution is found near the stage limit', () => {
  const budget = createFc27PuzzleSearchBudget({ refinementReserve: 6000 });
  budget.accountFixed(49999); budget.markFeasible();
  expect(budget.takeNode()).toBe(false);
  expect(budget.remaining()).toBe(1);
  budget.accountFixed(1);
  expect(budget.snapshot()).toMatchObject({ budgetNodes: 50000, budgetStage: 1 });
  for (const refinementReserve of [-1, 1.1, 50000, NaN])
    expect(() => createFc27PuzzleSearchBudget({ refinementReserve })).toThrow('FC27_PUZZLE_BUDGET_INVALID');
});

it('shows and exports numeric stages without admitting nested/private evidence', async () => {
  const progress = { nodes: 100001, budgetNodes: 100001, maxNodes: 200000, budgetStage: 3, budgetStages: 3, nodeCap: 200000 };
  expect(formatFc27PuzzleProgress(progress)).toContain('搜索阶段 3 / 3');
  const store = new Map();
  const log = createFcatDiagnosticLog({ gmGetValue: async (key, fallback) => store.get(key) ?? fallback,
    gmSetValue: async (key, value) => store.set(key, value), version: '27.0.99', now: () => 1000 });
  await log.record({ area: 'puzzle', event: 'procurement-result', ...progress, account: 'private-account', payload: { secret: true } });
  const exported = await log.exportPayload();
  expect(exported.entries[0]).toMatchObject({ budgetNodes: 100001, maxNodes: 200000, budgetStage: 3, budgetStages: 3, nodeCap: 200000 });
  expect(JSON.stringify(exported)).not.toMatch(/private-account|secret/);
});

it('keeps the parent three-page/full-concept witness valid with the production adaptive opt-in', async () => {
  const { input, pages } = nationalityCapFixture(), cache = new Map(), progress = [];
  const original = JSON.stringify(input);
  const readCatalogPage = vi.fn(async query => ({ status: 'observed', season: '27', source: 'ea-defid', query,
    observedAt: input.now, entries: pages.find(page => JSON.stringify(page.query) === JSON.stringify(query))?.entries ?? [] }));
  const readQuotePage = vi.fn();
  const result = await createFc27PuzzleProcurementSession({ now: () => input.now,
    get: async (key, fallback) => cache.get(key) ?? fallback, set: async (key, value) => cache.set(key, value),
    createTransport: async () => ({ readCatalogPage, readQuotePage }),
    loadPublicPrices: async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
      { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
        { schema: 2, source, definitionId, season: '27', platform: 'pc', price: 200, fetchedAt: input.now,
          expiresAt: input.now + 300000, sourceUpdatedAt: null, error: null }])) }])) }),
  }).plan(input, { adaptiveSearch: true, onProgress: value => progress.push(value) });
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('suggested');
  expect(result.plans[0]).toMatchObject({ purchaseCount: 11, conceptPlan: { status: 'prepared' } });
  expect(result.plans[0].teamFacts.teamRating).toBeGreaterThanOrEqual(75);
  expect(result.plans[0].teamFacts.chemistry).toBeGreaterThanOrEqual(26);
  expect(readCatalogPage.mock.calls.map(([query]) => query)).toEqual(pages.map(page => page.query));
  expect(readQuotePage).not.toHaveBeenCalled();
  expect(result.diagnostics.nodes).toBeLessThan(50000);
  expect(result.diagnostics.budgetStage).toBe(1);
  expect(JSON.stringify(input)).toBe(original);
}, 30000);

it.each([0, 5000])('includes fixed coverage in the 200k TOTAL cap with %i nodes remaining', async gap => {
  const { input, entries } = fixture(), cache = new Map();
  input.evaluateSquad = () => ({ status: 'observed', teamRating: 75 });
  vi.spyOn(procurement, 'findFc27PuzzleRepairSeedCooperatively').mockResolvedValue({
    status: 'unavailable', reason: 'FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE' });
  const queries = [0, 20, 40].map(start => ({ level: 'gold', start, count: 20 }));
  vi.spyOn(procurement, 'planFc27PuzzleShortageQueries').mockImplementation((_input, _entries, { usedQueries = [] } = {}) =>
    ({ status: 'ready', queries: queries.filter(query => !usedQueries.some(used => used.start === query.start)) }));
  const original = procurement.suggestFc27PuzzleJointPurchasesCooperatively;
  let pass = 0; const fixedLimits = [];
  vi.spyOn(procurement, 'suggestFc27PuzzleJointPurchasesCooperatively').mockImplementation(async (input, entries, options) => {
    if (!options.searchBudget) {
      fixedLimits.push(options.maxNodes);
      options.onProgress?.({ nodes: Math.floor(options.maxNodes / 2), phase: 'local-market-search' });
      options.onProgress?.({ nodes: options.maxNodes, phase: 'local-market-search' });
      return { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', nodes: options.maxNodes, plans: [], truncated: true };
    }
    const nodes = options.maxNodes - (++pass === 3 ? gap : 0);
    options.searchBudget.accountFixed(nodes);
    if (pass < 3) return { status: 'blocked', reason: 'FC27_PUZZLE_SEARCH_LIMIT', nodes, plans: [], truncated: true };
    // Keep a genuinely validated full candidate; only work counts are mocked
    // to put the production coverage call exactly next to the hard boundary.
    const result = await original(input, entries, { ...options, searchBudget: null, maxNodes: 100 });
    expect(result.status).toBe('suggested');
    return { ...result, nodes };
  });
  const readCatalogPage = vi.fn(async query => ({ status: 'observed', season: '27', source: 'ea-defid', query,
    observedAt: input.now, entries: queries.some(used => JSON.stringify(used) === JSON.stringify(query))
      ? entries.map(card => ({ ...card, definitionId: card.definitionId + query.start })) : [] }));
  const list = vi.fn(async () => []), readQuotePage = vi.fn(), progress = [];
  const result = await createFc27PuzzleProcurementSession({ now: () => input.now,
    get: async (key, fallback) => cache.get(key) ?? fallback, set: async (key, value) => cache.set(key, value), list,
    loadCachedPrices: vi.fn(async () => ({ hintOnly: true, prices: new Map() })),
    createTransport: async () => ({ readCatalogPage, readQuotePage }),
    loadPublicPrices: async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
      { definitionId, season: '27', platform: 'pc', quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source,
        { schema: 2, source, definitionId, season: '27', platform: 'pc', price: 1000, fetchedAt: input.now,
          expiresAt: input.now + 300000, sourceUpdatedAt: null, error: null }])) }])) }),
  }).plan(input, { adaptiveSearch: true, onProgress: value => progress.push(value) });
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('suggested');
  expect(result.diagnostics).toMatchObject({ nodes: 200000, budgetNodes: 200000, maxNodes: 200000, nodeCap: 200000, budgetStage: 3 });
  expect(fixedLimits).toEqual(gap ? [gap] : []);
  if (gap) expect(progress.some(value => value.budgetNodes === 200000 - Math.ceil(gap / 2))).toBe(true);
  expect(list).not.toHaveBeenCalled();
  expect(readCatalogPage.mock.calls.length).toBeLessThanOrEqual(5);
  expect(readQuotePage).not.toHaveBeenCalled();
}, 30000);
