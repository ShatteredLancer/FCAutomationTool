import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';
import { assertStreamlinedPlan } from '../../src/streamlined/plan.js';
import { normalizeStreamlinedSettings } from '../../src/streamlined/settings.js';
import { createGalleryReferencePrices } from '../../src/gallery/reference-prices.js';

it('bounds a real shared inventory quote read to 90 seconds and reports valid coverage once, not contradictory success/failure', async () => {
  vi.useFakeTimers();
  try {
    const c = challenge({ scoreRequirement: 100 }), diagnosticLog = { record: vi.fn() };
    let finish;
    const readFutbin = vi.fn(id => id === 1 ? Promise.resolve({ definitionId: 1, price: 1000 })
      : new Promise(resolve => { finish = resolve; }));
    const shared = createGalleryReferencePrices({ readFutbin });
    const prices = { load: (ids, options) => shared.load(ids, { ...options, platform: 'console', sources: ['futbin'], policy: { source: 'futbin' } }) };
    const session = createFc27StreamlinedSession({ prices, diagnosticLog,
      inspect: () => ({ context: c.context, challenge: c }), get: async () => null, set: async () => {},
      readInputs: () => ({ context: c.context, challenge: c, policy, eligibility,
        inventory: [safeItem({ id: 1, definitionId: 1, points: 100 }), safeItem({ id: 2, definitionId: 2, points: 100 })], assertCurrent() {} }) });
    const pending = session.plan({ mode: 'inventory' });
    await vi.advanceTimersByTimeAsync(90000);
    const result = await pending;
    expect(result).toMatchObject({ status: 'ready', quoteReadError: 'FC27_STREAMLINED_QUOTE_BUDGET',
      plan: { execution: { quoteLimited: true } }, quoteCoverage: { inventory: { requested: 2, valid: 1, missing: 1 } } });
    expect(result.items.map(i => i.id)).toEqual([1]);
    const events = diagnosticLog.record.mock.calls.map(([r]) => r).filter(r => r.event === 'planning-read' && r.phase === 'inventory-quotes');
    expect(events).toEqual([expect.objectContaining({ status: 'partial', count: 1, requestedCount: 2, unknownCount: 1, durationMs: 90000 })]);
    finish({ definitionId: 2, price: 1200 }); await vi.advanceTimersByTimeAsync(0);
    expect(result.items).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('retains only bounded protection evidence at the planning failure seam and performs no further reads or writes', async () => {
  const c = challenge(), diagnosticLog = { record: vi.fn() }, prices = { load: vi.fn() }, createExecution = vi.fn(), set = vi.fn();
  const error = Error('FC27_STREAMLINED_PROTECTION_UNVERIFIED');
  error.evidence = { phase: 'protection-slot-list', count: 11, requiredSlots: 23, mismatch: 'length',
    itemId: 123456, account: 'private-account', token: 'private-token' };
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
    readInputs: () => { throw error; }, diagnosticLog, prices, createExecution, get: async () => null, set });
  const result = await session.plan({});
  expect(result).toMatchObject({ status: 'blocked', reason: error.message, liveExecutionEnabled: false,
    protectionFailure: { phase: 'protection-slot-list', count: 11, requiredSlots: 23, mismatch: 'length' } });
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ phase: 'protection-slot-list', count: 11, requiredSlots: 23 }));
  expect(JSON.stringify([result, diagnosticLog.record.mock.calls])).not.toMatch(/private-|itemId|123456|token/);
  expect(prices.load).not.toHaveBeenCalled(); expect(createExecution).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});

it('reports total inventory quote elapsed time across both 250-version chunks and retains a stage summary', async () => {
  const c = challenge({ scoreRequirement: 100 }), diagnosticLog = { record: vi.fn() }, progress = [];
  const inventory = Array.from({ length: 251 }, (_, i) => safeItem({ id: i + 1, definitionId: i + 1, points: 100 }));
  let time = 100; const prices = { load: vi.fn(async (ids, options) => {
    time += prices.load.mock.calls.length === 1 ? 5000 : 7000;
    options.onProgress({ source: 'futbin', index: ids.length, total: ids.length });
    return { policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(definitionId => [definitionId,
      { quotes: { futbin: { source: 'futbin', definitionId, price: 1000, fetchedAt: time, expiresAt: time + 300000 } } }])) };
  }) };
  const session = createFc27StreamlinedSession({ diagnosticLog, prices, now: () => time,
    inspect: () => ({ context: c.context, challenge: c }), get: async () => null, set: async () => {},
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, inventory,
      priceRows: inventory, assertCurrent() {} }) });
  expect((await session.plan({ mode: 'inventory' }, { onProgress: row => progress.push(row) })).status).toBe('ready');
  expect(progress.filter(row => row.phase === 'quotes' && row.elapsedMs != null).at(-1).elapsedMs).toBe(12000);
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'planning-read', phase: 'inventory-quotes',
    durationMs: 12000, requestedCount: 251, count: 251, source: 'futbin' }));
  expect(prices.load.mock.calls.every(([_ids, options]) => options.futbinBatch === true)).toBe(true);
});

it('migrates settings without relaxing stock protection and validates the separate market ceiling', () => {
  expect(normalizeStreamlinedSettings({ maxRating: 82 })).toMatchObject({ maxRating: 82, marketMaxRating: 99 });
  expect(normalizeStreamlinedSettings({ maxRating: 82, marketMaxRating: 85 })).toMatchObject({ maxRating: 82, marketMaxRating: 85 });
  expect(() => normalizeStreamlinedSettings({ marketMaxRating: 100 })).toThrow('SETTINGS_INVALID');
});

it('selects alternate compressed routes without fetching again or granting purchase/contribution authority', async () => {
  const c = challenge({ scoreRequirement: 100 }), item = (id, points, price) => safeItem({ source: 'market', definitionId: id, points, price,
    quote: { source: 'futgg', definitionId: id, price, fetchedAt: 1, expiresAt: 1000 } });
  const readMarketCandidates = vi.fn(async () => ({ market: [item(1, 10, 150), item(2, 100, 2000)], pricePolicy: { source: 'futgg' } }));
  const inspect = () => ({ context: c.context, challenge: c });
  const native = { name: 'native concept' }, resolveDisplayItem = vi.fn(() => native);
  const session = createFc27StreamlinedSession({ inspect, get: async () => null, set: async () => {}, now: () => 100,
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, inventory: [], assertCurrent() {}, resolveDisplayItem }), readMarketCandidates });
  const result = await session.plan({ mode: 'market' });
  expect(result.routes).toHaveLength(2); expect(result.purchaseCost).toBe(1500);
  expect(session.resolveDisplayItem({ ...result.items[0], key: 'market:1:999' })).toBeNull();
  const copy = result.items[1];
  expect(copy.key).toBe('market:1:1');
  expect(session.resolveDisplayItem(copy)).toBe(native);
  for (const change of [{ definitionId: 999 }, { id: 3 }, { source: 'inventory' }]) {
    expect(session.resolveDisplayItem({ ...copy, ...change })).toBeNull();
  }
  expect(resolveDisplayItem).toHaveBeenCalledOnce();
  const next = await session.selectRoute(result.routes[1].id);
  expect(next.purchaseCost).toBe(2000); expect(next.items).toHaveLength(1); expect(next.liveExecutionEnabled).toBe(false);
  expect(readMarketCandidates).toHaveBeenCalledOnce();
  session.clearPreview(); expect((await session.selectRoute(result.routes[0].id)).status).toBe('blocked');
});

it('selects the cheaper total-value market route while allowing zero-purchase stock without another request', async () => {
  const c = challenge({ scoreRequirement: 100 });
  const prices = { load: vi.fn(async () => ({ policy: { source: 'futgg' }, references: {
    2: { quotes: { futgg: { source: 'futgg', definitionId: 2, price: 30000, fetchedAt: 1, expiresAt: 1000 } } },
  } })) };
  const readMarketCandidates = vi.fn(async () => ({ market: [safeItem({ source: 'market', definitionId: 901,
    points: 25, price: 2000, quote: { source: 'futgg', definitionId: 901, price: 2000, fetchedAt: 1, expiresAt: 1000 } })] }));
  const diagnosticLog = { record: vi.fn() };
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }), diagnosticLog,
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility,
      inventory: [safeItem({ points: 100, price: 30000 })], assertCurrent() {} }),
    prices, readMarketCandidates, get: async () => null, set: async () => {}, now: () => 100 });
  const result = await session.plan({});
  expect(result).toMatchObject({ purchaseCost: 8000, materialValue: 0, plan: { objective: 'lowest-value' }, liveExecutionEnabled: false });
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ objective: 'lowest-value',
    priceSource: 'futgg', estimatedCost: 8000, materialValue: 0, totalValue: 8000 }));
  const stock = result.routes.find(r => r.purchaseCost === 0);
  const selected = await session.selectRoute(stock.id);
  expect(selected).toMatchObject({ purchaseCost: 0, materialValue: 30000, liveExecutionEnabled: false });
  expect(assertStreamlinedPlan(selected.plan)).toBe(selected.plan);
  expect(prices.load).toHaveBeenCalledOnce(); expect(readMarketCandidates).toHaveBeenCalledOnce();
  expect(await session.plan({ objective: 'lowest-coins' })).toMatchObject({ purchaseCost: 0, materialValue: 30000 });
});

it('logs bounded score and price buckets and selected repeats without account or physical item identities', async () => {
  const c = challenge({ scoreRequirement: 12000 }), diagnosticLog = { record: vi.fn() };
  const quotes = price => ({ source: 'futgg', definitionId: 101, price, fetchedAt: 1, expiresAt: 1000 });
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }), diagnosticLog,
    get: async () => null, set: async () => {}, now: () => 100,
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, assertCurrent() {},
      inventory: [safeItem({ id: 123456789, definitionId: 101, points: 830, rating: 84 })] }),
    prices: { load: async () => ({ policy: { source: 'futgg' }, references: { 101: { quotes: { futgg: quotes(2000) } } } }) },
    readMarketCandidates: async () => ({ market: [safeItem({ source: 'market', definitionId: 901,
      points: 830, rating: 84, price: 700, quote: { ...quotes(700), definitionId: 901 } })] }) });
  const result = await session.plan({});
  expect(result.route).toMatchObject({ marketCount: 15, minBatches: 15, repeatPurchaseCount: 14 });
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'candidate-bucket', source: 'inventory',
    phase: 'club', rating: 84, unitScore: 830, count: 1, quotedCount: 1, cheapestPrice: 2000, bestPrice: 2000 }));
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'route-group', source: 'market',
    rating: 84, unitScore: 830, count: 15, referencePrice: 700, requestedCount: 1 }));
  expect(JSON.stringify(diagnosticLog.record.mock.calls)).not.toContain('123456789');
});

it('keeps owned entities in the final TOTW preview and frozen plan without extra price reads', async () => {
  const c = challenge({ scoreRequirement: 12000 }), diagnosticLog = { record: vi.fn() };
  const inventory = Array.from({ length: 8 }, (_, i) => safeItem({ id: 100 + i, definitionId: 100 + i,
    points: 830, rating: 84, pile: i < 3 ? 'storage' : 'club' }));
  const quote = (definitionId, price) => ({ definitionId, source: 'futgg', price, fetchedAt: 1, expiresAt: 1000 });
  const prices = { load: vi.fn(async ids => ({ policy: { source: 'futgg' },
    references: Object.fromEntries(ids.map(id => [id, { quotes: { futgg: quote(id, 800) } }])) })) };
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }), diagnosticLog,
    get: async () => null, set: async () => {}, now: () => 100, schedule: async () => {}, prices,
    readInputs: () => ({ context: c.context, challenge: c, inventory, eligibility, assertCurrent() {},
      policy: { ...policy, maxRating: 99, goldRange: [75, 97], onlyUntradeable: false } }),
    readMarketCandidates: async () => ({ market: [[901, 830, 800, 84], [902, 5500, 5200, 87]]
      .map(([definitionId, points, price, rating]) => safeItem({ source: 'market', definitionId,
        points, price, rating, quote: quote(definitionId, price) })) }) });
  const result = await session.plan({ mode: 'inventory-market' });
  expect(result.route).toMatchObject({ totalValue: 11600, materialValue: 6400, purchaseCost: 5200,
    inventoryCount: 8, marketCount: 1, score: 12140 });
  expect(result.items.filter(item => item.source === 'inventory').map(item => item.id).sort((a,b) => a-b))
    .toEqual(inventory.map(item => item.id));
  expect(assertStreamlinedPlan(result.plan)).toBe(result.plan);
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'plan',
    routeInventoryCount: 8, routeMarketCount: 1, estimatedCost: 5200, totalValue: 11600 }));
  const selected = await session.selectRoute(result.route.id);
  expect(selected.items).toEqual(result.items);
  expect(prices.load).toHaveBeenCalledOnce();
});

it.each([83, 85])('explains inventory protection with FSU max %s without extra quote reads', async goldenMax => {
  const c = challenge({ scoreRequirement: 1240 }), diagnosticLog = { record: vi.fn() };
  const stock = [safeItem({ id: 123456781, definitionId: 101, rating: 84, points: 830 }),
    safeItem({ id: 123456782, definitionId: 102, rating: 83, points: 410, pile: 'storage' }),
    safeItem({ id: 123456783, definitionId: 103, rating: 85, points: 2100, pile: 'storage' }),
    safeItem({ id: 123456784, definitionId: 104, rating: 83, points: 410, tradeable: true })];
  const quote = (definitionId, price) => ({ source: 'futgg', definitionId, price, fetchedAt: 1, expiresAt: 1000 });
  const prices = { load: vi.fn(async ids => ({ policy: { source: 'futgg' }, references: Object.fromEntries(ids.map(id =>
    [id, { quotes: { futgg: quote(id, id === 103 ? 5000 : 700) } }])) })) };
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }), diagnosticLog,
    get: async () => null, set: async () => {}, now: () => 100, prices,
    readInputs: () => ({ context: c.context, challenge: c, policy: { ...policy, goldRange: [75, goldenMax] },
      eligibility, assertCurrent() {}, inventory: stock }),
    readMarketCandidates: async () => ({ market: [safeItem({ source: 'market', definitionId: 901,
      rating: 84, points: 830, price: 700, quote: quote(901, 700) })] }) });
  const result = await session.plan({});
  expect(result.inventorySelection).toMatchObject({ readCount: 4, eligibleCount: goldenMax === 83 ? 1 : 3,
    excluded: goldenMax === 83 ? { 'fsu-gold-range': 2, untradeable: 1 } : { untradeable: 1 } });
  if (goldenMax === 83) {
    expect(result.inventorySelection.buckets).toEqual(expect.arrayContaining([
      { reason: 'fsu-gold-range', pile: 'club', rating: 84, count: 1 },
      { reason: 'fsu-gold-range', pile: 'storage', rating: 85, count: 1 }]));
    expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'inventory-exclusion',
      phase: 'fsu-gold-range', source: 'club', rating: 84, count: 1, fsuGoldMax: 83 }));
    expect(result.route).toMatchObject({ inventoryCount: 1, marketCount: 1 });
    expect(prices.load.mock.calls[0][0]).toEqual([102]);
  } else {
    expect(result.route).toMatchObject({ inventoryCount: 2, marketCount: 0 });
    expect(prices.load.mock.calls[0][0]).toEqual([101, 102, 103]);
  }
  expect(result.items.every(item => item.source !== 'inventory' || item.tradeable === false)).toBe(true);
  expect(prices.load).toHaveBeenCalledOnce();
  expect(JSON.stringify(diagnosticLog.record.mock.calls)).not.toMatch(/12345678/);
  const alternative = result.routes.find(route => route.id !== result.route.id);
  const next = await session.selectRoute(alternative?.id ?? result.route.id);
  expect(next.inventorySelection).toEqual(result.inventorySelection);
  expect(next.policy).toEqual(result.policy);
});

it.each([
  ['newer selected-source quote', { source: 'futgg', fetchedAt: 20, expiresAt: 1000 }, 1],
  ['older quote', { source: 'futgg', fetchedAt: 0, expiresAt: 1000 }, 0],
  ['other-source quote', { source: 'futbin', fetchedAt: 20, expiresAt: 1000 }, 0],
  ['expired quote', { source: 'futgg', fetchedAt: 20, expiresAt: 50 }, 0],
  ['wrong-version quote', { source: 'futgg', definitionId: 999, fetchedAt: 20, expiresAt: 1000 }, 0],
])('reconciles stock valuation with %s without another quote request', async (_label, fields, inventoryCount) => {
  const c = challenge({ scoreRequirement: 100 });
  const old = { source: 'futgg', definitionId: 101, price: 900, fetchedAt: 1, expiresAt: 1000 };
  const current = { ...old, price: 700, fetchedAt: 20 };
  const prices = { load: vi.fn(async () => ({ policy: { source: 'futgg' },
    references: { 101: { quotes: { futgg: old } } } })) };
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
    get: async () => null, set: async () => {}, now: () => 100, prices,
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, assertCurrent() {},
      inventory: [safeItem({ id: 11, definitionId: 101, points: 100 })] }),
    readMarketCandidates: async () => ({ pricePolicy: { source: 'futgg' },
      market: [safeItem({ source: 'market', definitionId: 101, points: 100, price: 700, quote: current })],
      references: { 101: { quotes: { futgg: { ...current, ...fields } } } } }) });
  const result = await session.plan({});
  expect(result.route.inventoryCount).toBe(inventoryCount);
  if (inventoryCount) expect(result.items[0].quote).toEqual(current);
  else expect(result.routes.find(route => route.marketCount === 0).materialValue).toBe(900);
  expect(prices.load).toHaveBeenCalledOnce();
});

function setup(overrides = {}) {
  const c = challenge({ scoreRequirement: 40 }), context = c.context, store = new Map();
  const input = { context, challenge: c, policy, eligibility, inventory: [safeItem({ points: 40 })], assertCurrent: vi.fn(), priceRows: [] };
  const inspect = vi.fn(() => ({ context, challenge: c }));
  const prices = { load: vi.fn(async () => ({ policy: { source: 'futbin' }, references: { 2: { quotes: { futbin: {
    definitionId: 2, source: 'futbin', price: 300, fetchedAt: 10, expiresAt: 100 } } } } })) };
  const session = createFc27StreamlinedSession({ inspect, readInputs: () => input, prices, now: () => 20,
    get: async (key, fallback) => store.get(key) ?? fallback, set: async (key, value) => store.set(key, structuredClone(value)), ...overrides });
  return { session, input, prices, inspect, store };
}

it.each([undefined, 'record-identity'])('logs the actual budget and offer mismatch=%s without inferring it from estimates', async mismatch => {
  const diagnosticLog = { record: vi.fn() }, purchase = vi.fn(async (plan, approval) => ({ status: 'paused',
    reason: mismatch ? 'FC27_STREAMLINED_PURCHASE_OFFER_CHANGED' : 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', mismatch,
    record: { plan, budget: approval.budget, spent: 300, submittedScore: 0, challenge: plan.challenge,
      entries: [{ source: 'market', state: 'consumed', itemId: 123456, tradeId: '987654' }], consumedIds: [123456], confirmedBatches: 1 } }));
  const f = setup({ diagnosticLog,
    readMarketCandidates: async () => ({ pricePolicy: { source: 'futbin' }, market: [safeItem({ source: 'market',
      definitionId: 201, points: 40, price: 300, purchaseMaxBuy: 300,
      quote: { source: 'futbin', definitionId: 201, price: 300, fetchedAt: 10, expiresAt: 100 } })] }),
    createExecution: async () => ({ prepare() {}, purchase }) });
  f.input.inventory = [];
  const result = await f.session.plan({ mode: 'market' });
  expect(result.purchaseCost).toBe(300);
  await f.session.contribute({ fingerprint: result.plan.fingerprint, budget: 999, acknowledgeQuoteCoverage: true });
  expect(purchase).toHaveBeenCalledWith(result.plan, expect.objectContaining({ budget: 999 }), expect.any(Object));
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'contribution',
    approvedBudget: 999, spent: 300, remainingBudget: 699, mismatch, pendingWriteCount: 0, unconsumedPurchaseCount: 0,
    contributedCount: 1, confirmedBatches: 1, purchasesSettled: true }));
  expect(JSON.stringify(diagnosticLog.record.mock.calls)).not.toMatch(/123456|987654|itemId|tradeId/);
});

it('keeps verified quoted stock when all verified market quotes fail, but never downgrades a failed catalog', async () => {
  const readMarketCandidates = vi.fn(async () => ({ market: [], pricePolicy: { source: 'futbin' },
    quoteReadError: 'FC27_BUY_REFERENCE_TIMEOUT', quoteCoverage: { requested: 3, valid: 0, failed: 3, missing: 0 } }));
  const f = setup({ readMarketCandidates });
  const result = await f.session.plan({ mode: 'inventory-market' });
  expect(result).toMatchObject({ status: 'ready', marketPending: false, quoteCoverage: { limited: true },
    plan: { execution: { quoteLimited: true } } });
  expect(result.items.map(item => item.id)).toEqual([1]);
  readMarketCandidates.mockRejectedValue(Error('FC27_STREAMLINED_CATALOG_UNAVAILABLE'));
  expect(await f.session.plan({ mode: 'inventory-market' })).toMatchObject({ status: 'blocked',
    reason: 'FC27_STREAMLINED_MARKET_UNAVAILABLE', plan: null });
});

it('retains quote acknowledgement requirements after journal recovery without rewriting the frozen plan', async () => {
  let record;
  const execute = vi.fn(), recover = vi.fn(async () => ({ status: 'observed', record }));
  const f = setup({ createExecution: async () => ({ prepare() {}, transaction: { recover, execute } }) });
  f.input.inventory.push(safeItem({ id: 3, definitionId: 4, points: 40 }));
  const result = await f.session.plan({ mode: 'inventory' });
  expect(result.plan.execution.quoteLimited).toBe(true);
  record = { context: f.input.context, plan: result.plan, submittedScore: 0,
    batches: result.plan.batches.map(() => ({ state: 'waiting' })) };
  const restored = await f.session.recover();
  expect(restored.preview.plan.fingerprint).toBe(result.plan.fingerprint);
  expect(restored.preview.plan.execution.quoteLimited).toBe(true);
  expect(await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).toMatchObject({
    status: 'blocked', reason: 'FC27_STREAMLINED_QUOTE_CONFIRMATION_REQUIRED' });
  expect(execute).not.toHaveBeenCalled();
  assertStreamlinedPlan(restored.preview.plan);
});

it('does not let an earlier timeout hide a later source-disabled failure across inventory chunks', async () => {
  const f = setup(), createExecution = vi.fn();
  f.input.inventory = Array.from({ length: 251 }, (_, i) => safeItem({ id: i + 1, definitionId: i + 1, points: 40 }));
  f.prices.load.mockImplementation(async ids => ({ policy: { source: 'futbin' }, references: Object.fromEntries(ids.map(id => [id,
    { quotes: { futbin: id === 1 || id === 251 ? { definitionId: id, source: 'futbin', price: null,
      error: id === 1 ? 'FC27_BUY_REFERENCE_TIMEOUT' : 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED' }
      : { definitionId: id, source: 'futbin', price: 300, fetchedAt: 10, expiresAt: 100 } } }])) }));
  const session = createFc27StreamlinedSession({ inspect: f.inspect, readInputs: () => f.input, prices: f.prices, now: () => 20,
    get: async () => null, set: async () => {}, createExecution });
  expect(await session.plan({ mode: 'inventory' })).toMatchObject({ status: 'blocked',
    reason: 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED', liveExecutionEnabled: false });
  expect(createExecution).not.toHaveBeenCalled();
});
it('forwards per-version inventory quote progress instead of remaining at zero until the batch finishes', async () => {
  const f = setup(), progress = [];
  f.prices.load.mockImplementation(async (_ids, options) => {
    options.onProgress({ source: 'futbin', index: 1, total: 1 });
    return { policy: { source: 'futbin' }, references: {} };
  });
  await f.session.plan({ mode: 'inventory' }, { onProgress: row => progress.push(row) });
  expect(progress).toContainEqual(expect.objectContaining({ phase: 'quotes', source: 'futbin', completed: 1, total: 1 }));
});

it('keeps a selected-source partial route pending explicit coverage acknowledgement after a timeout', async () => {
  const market = vi.fn(async () => ({ market: [safeItem({ source: 'market', definitionId: 901,
    points: 4100, price: 41000, quote: { source: 'futbin', definitionId: 901, price: 41000, fetchedAt: 1, expiresAt: 1000 } })] }));
  const purchase = vi.fn(async () => ({ status: 'stopped' }));
  const f = setup({ readMarketCandidates: market, createExecution: async () => ({ prepare() {}, purchase }) });
  f.prices.load.mockResolvedValue({ policy: { source: 'futbin' }, references: {
    2: { quotes: { futbin: { source: 'futbin', definitionId: 2, price: null, error: 'FC27_BUY_REFERENCE_TIMEOUT' } } },
  } });
  const result = await f.session.plan({ mode: 'inventory-market' });
  expect(result).toMatchObject({ status: 'ready', quoteReadError: 'FC27_BUY_REFERENCE_TIMEOUT',
    quoteCoverage: { limited: true, inventory: { requested: 1, valid: 0, failed: 1 } },
    plan: { execution: { quoteLimited: true } } });
  expect(result.items.every(item => item.source === 'market' && item.quote.source === 'futbin')).toBe(true);
  expect(market).toHaveBeenCalledOnce();
  expect(await f.session.contribute({ fingerprint: result.plan.fingerprint })).toMatchObject({ status: 'blocked',
    reason: 'FC27_STREAMLINED_QUOTE_CONFIRMATION_REQUIRED' });
  expect(purchase).not.toHaveBeenCalled();
  await f.session.contribute({ fingerprint: result.plan.fingerprint, acknowledgeQuoteCoverage: true });
  expect(purchase).toHaveBeenCalledOnce();
});

it('shows elapsed waiting and stops promptly during an unresolved shared quote read', async () => {
  vi.useFakeTimers();
  try {
    const f = setup({ now: () => Date.now() }), progress = [];
    let finish;
    f.prices.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.session.plan({}, { onProgress: row => progress.push(row) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(progress).toContainEqual(expect.objectContaining({ phase: 'quotes', completed: 0, elapsedMs: 1000 }));
    f.session.stop();
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ status: 'cancelled', reason: 'FC27_STREAMLINED_CANCELLED' });
    finish({ policy: { source: 'futbin' }, references: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('excludes unquoted inventory even when market quotes are healthy; never treats it as free', async () => {
  const readMarketCandidates = vi.fn(async () => ({ market: [safeItem({ source: 'market', definitionId: 901,
    points: 40, price: 200, quote: { source: 'futbin', definitionId: 901, price: 200, fetchedAt: 1, expiresAt: 1000 } })],
    pricePolicy: { source: 'futbin' } }));
  const f = setup({ readMarketCandidates });
  f.prices.load.mockResolvedValue({ policy: { source: 'futbin' }, references: {
    2: { quotes: { futbin: { definitionId: 2, source: 'futbin', price: null, error: null } } },
  } });
  expect(await f.session.plan({ mode: 'inventory-market' })).toMatchObject({ status: 'ready', purchaseCost: 200,
    materialValue: 0, quoteReadError: null });
  expect(await f.session.plan({ mode: 'inventory' })).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_QUOTES_UNAVAILABLE',
    quoteCoverage: { limited: true, inventory: { requested: 1, valid: 0, missing: 1 } }, plan: null });
});

it('does not renew an expired inventory quote or block healthy market routes after a long stock read', async () => {
  const readMarketCandidates = vi.fn(async () => ({ market: [safeItem({ source: 'market', definitionId: 901,
    points: 40, price: 200, quote: { source: 'futbin', definitionId: 901, price: 200, fetchedAt: 10, expiresAt: 1000 } })],
    pricePolicy: { source: 'futbin' } }));
  const f = setup({ readMarketCandidates });
  f.prices.load.mockResolvedValue({ policy: { source: 'futbin' }, references: {
    2: { quotes: { futbin: { definitionId: 2, source: 'futbin', price: 150, fetchedAt: 1, expiresAt: 20 } } },
  } });
  const result = await f.session.plan({ mode: 'inventory-market' });
  expect(result).toMatchObject({ status: 'ready', purchaseCost: 200, materialValue: 0 });
  expect(result.routes.some(r => r.purchaseCost === 0)).toBe(false);
  expect(result.plan.execution.quoteLimited).toBe(true);
});

it('stops a stalled market read and prevents the old callback from re-entering a new plan', async () => {
  vi.useFakeTimers();
  try {
    let firstCheck, finish;
    const readMarketCandidates = vi.fn().mockImplementationOnce(({ check }) => {
      firstCheck = check; return new Promise(resolve => { finish = resolve; });
    }).mockResolvedValue({ market: [] });
    const f = setup({ readMarketCandidates });
    const pending = f.session.plan({ mode: 'market' });
    await vi.advanceTimersByTimeAsync(250);
    f.session.stop(); await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ status: 'cancelled' });
    expect(await f.session.plan({ mode: 'market' })).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_MARKET_UNAVAILABLE' });
    expect(firstCheck).toThrow('FC27_STREAMLINED_CANCELLED');
    finish({ market: [] }); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('loads only the shared selected source and displays a frozen inventory preview', async () => {
  const f = setup(), result = await f.session.plan({});
  expect(result).toMatchObject({ status: 'ready', purchaseCost: 0, materialValue: 300, quoteSource: 'futbin', marketPending: true, liveExecutionEnabled: false });
  expect(f.prices.load).toHaveBeenCalledWith([2], expect.objectContaining({ purpose: 'puzzle' }));
  expect(f.store.size).toBe(0); // preview does not create a contribution Journal
});
it('blocks a mixed plan when market candidates cannot be verified instead of falling back to inventory', async () => {
  const diagnosticLog = { record: vi.fn() };
  const f = setup({ diagnosticLog, readMarketCandidates: vi.fn(async () => {
    throw Error('FC27_STREAMLINED_CATALOG_HTTP_403');
  }) });
  const result = await f.session.plan({ mode: 'inventory-market' });
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_MARKET_UNAVAILABLE',
    marketError: 'FC27_STREAMLINED_CATALOG_HTTP_403', marketPending: true, plan: null, liveExecutionEnabled: false });
  expect(result.items).toBeUndefined();
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({
    status: 'blocked', reason: 'FC27_STREAMLINED_MARKET_UNAVAILABLE', marketRequested: true,
  }));
});
it('keeps inventory-only mode explicit when the market provider is unavailable', async () => {
  const f = setup({ readMarketCandidates: vi.fn(async () => { throw Error('FC27_STREAMLINED_CATALOG_HTTP_403'); }) });
  const result = await f.session.plan({ mode: 'inventory' });
  expect(result).toMatchObject({ status: 'ready', purchaseCost: 0, marketPending: false, liveExecutionEnabled: false });
});
it('blocks an empty verified market lane in mixed mode rather than claiming a complete inventory plan', async () => {
  const f = setup({ readMarketCandidates: vi.fn(async () => ({ market: [] })) });
  const result = await f.session.plan({ mode: 'inventory-market' });
  expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_MARKET_UNAVAILABLE',
    marketError: 'FC27_STREAMLINED_MARKET_EMPTY', plan: null });
});
it('planning never executes; only the separate exact-plan contribution action does, and Stop is forwarded', async () => {
  const transaction = { execute: vi.fn(async () => ({ status: 'partial' })), stop: vi.fn() };
  const createExecution = vi.fn(async () => ({ prepare: () => true, transaction }));
  const f = setup({ createExecution }), result = await f.session.plan({});
  expect(result.liveExecutionEnabled).toBe(true); expect(transaction.execute).not.toHaveBeenCalled();
  expect((await f.session.contribute({ fingerprint: 'wrong', batchIndices: [0] })).status).toBe('blocked');
  transaction.execute.mockImplementationOnce(async () => { f.session.stop(); return { status: 'stopped' }; });
  expect((await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).status).toBe('stopped');
  expect(transaction.execute).toHaveBeenCalledOnce(); expect(transaction.stop).toHaveBeenCalledOnce();
  f.session.clearPreview();
  expect((await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).status).toBe('blocked');
});
it('shows execution preparation errors without losing a usable preview or bypassing them', async () => {
  const f = setup({ createExecution: async () => { throw Error('FC27_STREAMLINED_CACHE_UNVERIFIED'); } });
  const result = await f.session.plan({});
  expect(result).toMatchObject({ status: 'ready', liveExecutionEnabled: false, executionReason: 'FC27_STREAMLINED_CACHE_UNVERIFIED' });
  expect((await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).status).toBe('blocked');
});

it('keeps recovery target and reason on preview and records the failed preflight', async () => {
  const recovery = { kind: 'puzzle-purchase', setId: 19, challengeId: 43, phase: 'save-pending', states: { club: 3, 'buy-pending': 1 } };
  const diagnosticLog = { record: vi.fn() };
  const f = setup({ diagnosticLog, createExecution: async () => { throw Object.assign(Error('FC27_BUY_RECOVERY_REQUIRED'), { recovery }); } });
  expect(await f.session.plan({})).toMatchObject({ status: 'ready', liveExecutionEnabled: false,
    executionReason: 'FC27_BUY_RECOVERY_REQUIRED', executionRecovery: recovery });
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'execution-preflight',
    reason: 'FC27_BUY_RECOVERY_REQUIRED', setId: 19, challengeId: 43 }));
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'purchase-recovery-state', phase: 'club', count: 3 }));
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'purchase-recovery-state', phase: 'buy-pending', count: 1 }));
});

it('records the exact unreviewed method evidence needed for a safe runtime review', async () => {
  const diagnosticLog = { record: vi.fn() };
  const error = Object.assign(Error('FC27_TRANSACTION_METHOD_UNREVIEWED'), {
    methodPath: 'dao.submitPlayers', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64),
  });
  const f = setup({ diagnosticLog, createExecution: async () => { throw error; } });
  await f.session.plan({});
  expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'execution-preflight',
    reason: 'FC27_TRANSACTION_METHOD_UNREVIEWED', methodPath: 'dao.submitPlayers',
    observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64) }));
});
it('does not invent market capabilities, re-enable disabled sources or hide missing quotes', async () => {
  const f = setup();
  f.prices.load.mockRejectedValue(Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED'));
  expect(await f.session.plan({})).toMatchObject({ status: 'blocked', reason: 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED', liveExecutionEnabled: false });
  f.prices.load.mockClear();
  expect(await f.session.plan({ mode: 'market' })).toMatchObject({ status: 'unavailable', marketAvailable: false });
  expect(f.prices.load).not.toHaveBeenCalled();
});
it('persists per-account/per-challenge settings, keeps global defaults separate and detects context changes', async () => {
  const f = setup();
  await f.session.saveSettings({ maxRating: 74 });
  await f.session.saveSettings({ maxRating: 64 }, true);
  expect((await f.session.readSettings()).settings.maxRating).toBe(74);
  f.prices.load.mockImplementation(async () => { f.input.assertCurrent.mockImplementation(() => { throw Error('FC27_STREAMLINED_CONTEXT_CHANGED'); }); return { policy: { source: 'futgg' }, references: {} }; });
  expect(await f.session.plan({})).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_CONTEXT_CHANGED' });
});

it('freezes shared retry policy and partial wait without changing the material protection policy', async () => {
  const c = challenge({ scoreRequirement: 100 }), candidate = (id, points, price) => safeItem({ source: 'market', definitionId: id, points, price,
    quote: { source: 'futgg', definitionId: id, price, fetchedAt: 1, expiresAt: 1000 } });
  const session = createFc27StreamlinedSession({ inspect: () => ({ context: c.context, challenge: c }),
    get: async () => null, set: async () => {}, now: () => 100,
    readInputs: () => ({ context: c.context, challenge: c, policy, eligibility, inventory: [], assertCurrent() {} }),
    readMarketCandidates: async () => ({ market: [candidate(1, 10, 150), candidate(2, 100, 2000)],
      pricePolicy: { source: 'futgg', purchaseAttempts: 7 } }) });
  const first = await session.plan({ mode: 'market', partialWaitMs: 12000 });
  expect(first.plan.execution).toEqual({ purchaseAttempts: 7, partialWaitMs: 12000 });
  expect(first.plan.policy).toEqual(policy); expect(assertStreamlinedPlan(first.plan)).toBe(first.plan);
  const next = await session.selectRoute(first.routes[1].id);
  expect(next.plan.execution).toEqual(first.plan.execution);
  expect(() => assertStreamlinedPlan({ ...next.plan, execution: { purchaseAttempts: 10, partialWaitMs: 12000 } })).toThrow('PLAN_CHANGED');
  expect(normalizeStreamlinedSettings().partialWaitMs).toBe(60000);
  expect(() => normalizeStreamlinedSettings({ partialWaitMs: -1 })).toThrow('SETTINGS_INVALID');
});
it('keeps native display entities outside serializable plans and drops them when preview closes or context changes', async () => {
  const f = setup(), raw = { native: true };
  f.input.resolveDisplayItem = vi.fn(() => raw);
  expect(f.session.resolveDisplayItem(f.input.inventory[0])).toBeNull();
  const result = await f.session.plan({});
  expect(f.session.resolveDisplayItem(result.items[0])).toBe(raw);
  expect(JSON.stringify(result)).not.toContain('native');
  expect(f.session.resolveDisplayItem({ ...result.items[0], id: 999 })).toBeNull();
  f.inspect.mockImplementation(() => { throw Error('FC27_STREAMLINED_CONTEXT_CHANGED'); });
  expect(f.session.resolveDisplayItem(result.items[0])).toBeNull();
  f.session.clearPreview();
  expect(f.session.resolveDisplayItem(result.items[0])).toBeNull();
});

function recoverySetup() {
  const prepare = vi.fn();
  const transaction = { execute: vi.fn(), recover: vi.fn(), stop: vi.fn() };
  const diagnosticLog = { record: vi.fn() };
  const f = setup({ diagnosticLog, createExecution: async () => ({ prepare, transaction }) });
  return { ...f, transaction, prepare, diagnosticLog };
}

it('checks old material moves before purchase/contribution recovery and never turns them into a preview', async () => {
  const recoverMaterialization = vi.fn(async () => ({ status: 'recovery-required',
    reason: 'FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED',
    recovery: { kind: 'streamlined-materialization', setId: 99, challengeId: 199, pendingCount: 1 } }));
  const recoverPurchase = vi.fn(async () => ({ status: 'absent' }));
  const transaction = { recover: vi.fn(async () => ({ status: 'absent' })), execute: vi.fn() };
  const f = setup({ createExecution: async () => ({ prepare() {}, transaction, recoverPurchase, recoverMaterialization }) });
  const planned = await f.session.plan({});
  expect(await f.session.recover()).toMatchObject({ status: 'recovery-required', recovery: { setId: 99, challengeId: 199 } });
  expect(recoverPurchase).not.toHaveBeenCalled(); expect(transaction.recover).not.toHaveBeenCalled();
  expect((await f.session.contribute({ fingerprint: planned.plan.fingerprint })).status).toBe('blocked');
  recoverMaterialization.mockResolvedValue({ status: 'recovered', confirmed: 1 });
  expect(await f.session.recover()).toMatchObject({ status: 'recovered', materializationRecovery: { confirmed: 1 } });
  expect(recoverPurchase).toHaveBeenCalledOnce(); expect(transaction.recover).toHaveBeenCalledOnce();
  expect(transaction.execute).not.toHaveBeenCalled();
});

it('restores the market run rather than displaying its last contribution as the whole plan', async () => {
  const recoverPurchase = vi.fn(), transaction = { recover: vi.fn(), execute: vi.fn() }, prepare = vi.fn();
  const f = setup({ createExecution: async () => ({ prepare, transaction, recoverPurchase }) });
  const result = await f.session.plan({});
  const record = { context: f.input.context, plan: result.plan, submittedScore: 0, entries: [], fulfilled: [], completed: false };
  recoverPurchase.mockResolvedValue({ status: 'recovered', record });
  transaction.recover.mockResolvedValue({ status: 'observed', record: { plan: { fingerprint: 'last-wave' } } });
  expect(await f.session.recover()).toMatchObject({ status: 'recovered', preview: { plan: result.plan, record },
    contributionRecovery: { status: 'observed' } });
  expect(recoverPurchase).toHaveBeenCalledWith(f.input.challenge);
  expect(transaction.execute).not.toHaveBeenCalled();
});

it('does not revive a preview or continue contribution when purchase recovery is uncertain', async () => {
  const recoverPurchase = vi.fn(async () => ({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_RECOVERY_REQUIRED' }));
  const transaction = { recover: vi.fn(), execute: vi.fn() };
  const f = setup({ createExecution: async () => ({ prepare() {}, transaction, recoverPurchase }) });
  const result = await f.session.plan({});
  expect(await f.session.recover()).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_RECOVERY_REQUIRED' });
  expect(transaction.recover).not.toHaveBeenCalled();
  expect((await f.session.contribute({ fingerprint: result.plan.fingerprint })).status).toBe('blocked');
});

it('completed market recovery stays disabled and does not require a new writable challenge', async () => {
  const recoverPurchase = vi.fn(), prepare = vi.fn();
  const transaction = { recover: vi.fn(async () => ({ status: 'absent' })) };
  const f = setup({ createExecution: async () => ({ prepare, transaction, recoverPurchase }) });
  const result = await f.session.plan({}); prepare.mockImplementation(() => { throw Error('FC27_STREAMLINED_INITIATION_UNVERIFIED'); });
  recoverPurchase.mockResolvedValue({ status: 'completed', record: { context: f.input.context, plan: result.plan, completed: true, submittedScore: 40 } });
  expect(await f.session.recover()).toMatchObject({ status: 'completed', preview: { liveExecutionEnabled: false } });
  expect(prepare).toHaveBeenCalledTimes(1);
});

it('binds recovery to the displayed target and invalidates the old preview when no recovery is needed', async () => {
  const f = recoverySetup(), result = await f.session.plan({});
  f.transaction.recover.mockResolvedValue({ status: 'absent' });
  expect(await f.session.recover()).toEqual({ status: 'absent' });
  expect(f.transaction.recover).toHaveBeenCalledWith(f.input.context, { setId: f.input.challenge.setId, challengeId: f.input.challenge.id });
  expect((await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).reason)
    .toBe('FC27_STREAMLINED_PLAN_CHANGED');
  expect(f.transaction.execute).not.toHaveBeenCalled();
});

it('shows the other target recovery reason without reviving the current preview', async () => {
  const f = recoverySetup(); await f.session.plan({});
  f.transaction.recover.mockResolvedValue({ status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED',
    recovery: { setId: 48, challengeId: 85 } });
  expect(await f.session.recover()).toMatchObject({ status: 'recovery-required',
    reason: 'FC27_STREAMLINED_OTHER_TARGET_RECOVERY_REQUIRED', recovery: { setId: 48, challengeId: 85 } });
  expect(f.transaction.recover).toHaveBeenCalledWith(f.input.context, { setId: f.input.challenge.setId, challengeId: f.input.challenge.id });
  expect(f.prepare).toHaveBeenCalledOnce();
});

it('keeps same-target recovery and blocks reuse of a preview after storage or account failure', async () => {
  const f = recoverySetup(), result = await f.session.plan({});
  const record = { context: f.input.context, plan: result.plan, submittedScore: 0, batches: [{ state: 'waiting' }] };
  f.transaction.recover.mockResolvedValue({ status: 'observed', record });
  expect(await f.session.recover()).toMatchObject({ status: 'observed', preview: { plan: result.plan } });
  expect(f.transaction.recover).toHaveBeenCalledOnce();
  f.transaction.recover.mockRejectedValue(Error('FC27_STREAMLINED_JOURNAL_READ_FAILED'));
  expect(await f.session.recover()).toMatchObject({ reason: 'FC27_STREAMLINED_JOURNAL_READ_FAILED' });
  expect((await f.session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).reason)
    .toBe('FC27_STREAMLINED_PLAN_CHANGED');
  expect(f.diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'recovery',
    status: 'recovery-required', reason: 'FC27_STREAMLINED_JOURNAL_READ_FAILED' }));
  f.transaction.recover.mockRejectedValue(Error('FC27_STREAMLINED_CONTEXT_CHANGED'));
  expect(await f.session.recover()).toMatchObject({ reason: 'FC27_STREAMLINED_CONTEXT_CHANGED' });
  expect(f.transaction.recover).toHaveBeenCalledTimes(3);
});

it('accepts its own verified recovery progress but rejects a real target switch during recovery', async () => {
  const f = recoverySetup(), result = await f.session.plan({});
  const record = { context: f.input.context, plan: result.plan, submittedScore: 40, batches: [{ state: 'confirmed' }] };
  f.transaction.recover.mockImplementationOnce(async () => {
    f.inspect.mockReturnValue({ context: f.input.context, challenge: { ...f.input.challenge, submittedScore: 40 } });
    return { status: 'recovered', record };
  });
  expect(await f.session.recover()).toMatchObject({ status: 'recovered', preview: { record } });
  f.transaction.recover.mockImplementationOnce(async () => {
    f.inspect.mockReturnValue({ context: f.input.context, challenge: { ...f.input.challenge, id: 999 } });
    return { status: 'recovered', record };
  });
  expect(await f.session.recover()).toMatchObject({ reason: 'FC27_STREAMLINED_CONTEXT_CHANGED' });
  expect(f.transaction.execute).not.toHaveBeenCalled();
});
