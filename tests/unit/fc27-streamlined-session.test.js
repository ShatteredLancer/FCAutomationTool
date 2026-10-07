import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { challenge, safeItem, policy, eligibility } from '../helpers/streamlined.js';

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
