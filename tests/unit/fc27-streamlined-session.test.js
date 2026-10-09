import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';
import { assertStreamlinedPlan } from '../../src/streamlined/plan.js';
import { normalizeStreamlinedSettings } from '../../src/streamlined/settings.js';

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
it('does not invent market capabilities, re-enable disabled sources or hide missing quotes', async () => {
  const f = setup();
  f.prices.load.mockRejectedValue(Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED'));
  expect(await f.session.plan({})).toMatchObject({ materialValue: null, unknownValueCount: 1, quoteReadError: 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED' });
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
