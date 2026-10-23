import { afterEach, expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedExecution, assertStreamlinedOtherTransactions } from '../../src/adapters/browser/fc27-streamlined-execution.js';
import { createFc27StreamlinedProvider } from '../../src/adapters/ea/fc27-streamlined-provider.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { puzzleBuyPendingKey, puzzleBuyKey } from '../../src/fc27/puzzle-buy-session.js';
import { galleryPurchasePendingKey } from '../../src/gallery/purchase-session.js';
import { streamlinedPurchaseKey } from '../../src/streamlined/purchase-journal.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { installObservedStorage } from '../helpers/fc27-observed-storage-runtime.js';
import { observedSet } from '../helpers/fc27-observed-set-runtime.js';
import { readFc27StreamlinedInputs } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { createFcatDiagnosticLog } from '../../src/diagnostics/fcat-diagnostic-log.js';
import { finishNativeIo } from '../helpers/native-io-timers.js';
import { decodeStoredValue } from '../../src/runtime/compact-storage.js';

afterEach(() => vi.useRealTimers());

it.each(['unrelated', 'selected'])('checks only selected piles across five stock batches and never repeats confirmed writes: %s', async conflict => {
  vi.useFakeTimers();
  const f = streamlinedRuntime({ targetScore: 2820 }), memory = new Map(), diagnosticMemory = new Map();
  // Same 30/30/30/30/21 shape as the incident, with synthetic identities/scores.
  f.state.players = Array.from({ length: 141 }, (_, i) => ({ id: i + 1, resourceId: i + 101 }));
  f.root.repositories.Item.club.items._collection = Object.fromEntries(f.state.players.map(data => [data.id, f.root.factories.Item.createItem(data)]));
  const input = readFc27StreamlinedInputs(f.root), selected = input.inventory;
  const batches = Array.from({ length: 5 }, (_, i) => selected.slice(i * 30, i * 30 + 30));
  const plan = createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy,
    result: { status: 'ready', items: selected, batches, score: 2820,
      progress: { target: 2820, submitted: 0, added: 2820, total: 2820, remaining: 0, excess: 0, reached: true },
      purchaseCost: 0, materialValue: null, searchComplete: true } });
  f.replies.rows[0].submittedScore = 0;
  const writes = [];
  const diagnosticLog = createFcatDiagnosticLog({
    gmGetValue: async key => diagnosticMemory.get(key), gmSetValue: async (key, value) => diagnosticMemory.set(key, value) });
  const options = { context: plan.context, get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)), canWrite: () => true, diagnosticLog,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); writes.push([...target.itemIds]);
        f.state.players = f.state.players.filter(item => !target.itemIds.includes(item.id));
        f.replies.rows[0].submittedScore += target.itemIds.length * 20;
        if (writes.length === 4) {
          f.state.players.push({ id: 999, resourceId: 1001 });
          f.state.playerFactsById = { [conflict === 'selected' ? 121 : 999]: { utasPile: 9 } };
          f.state.clubQueryMode = 'bulk-extra';
        }
        const complete = f.replies.rows[0].submittedScore === 2820;
        if (complete) {
          f.replies.rows[0].status = 'COMPLETED'; f.replies.rows[0].timesCompleted = 1;
          f.replies.set = { ...f.set, totalSubmittedScore: 2820, timesCompleted: 1, challengesCompletedCount: 1 };
        }
        return { success: true, status: 200, response: { setId: 31, challengeId: 61,
          submittedScore: f.replies.rows[0].submittedScore, grantedChallengeAwards: complete ? [{ type: 'pack' }] : null } };
      } }) }) };
  const execute = async () => {
    const execution = await createFc27StreamlinedExecution(f.root, options);
    execution.prepare(plan);
    const pending = execution.transaction.execute(plan, { approved: true, fingerprint: plan.fingerprint, batchIndices: [0, 1, 2, 3, 4] });
    return finishNativeIo(pending);
  };
  let result = await execute();
  if (conflict === 'selected') {
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_FRESH_ENTITY_UNVERIFIED' });
    expect(writes).toHaveLength(4);
    const saved = await decodeStoredValue(memory.get(contextKey(plan.context, 'streamlined-contribution')));
    expect(saved.submittedScore).toBe(2400);
    expect(saved.batches.map(row => row.state)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'waiting']);
    expect((await diagnosticLog.exportPayload()).transactionResults.at(-1)).toMatchObject({
      mismatch: 'selected-club-read', responseCount: 22, foreignCount: 1,
      wrongPileCount: 1, identityMismatchCount: 0, factoryMismatchCount: 0 });
    f.state.playerFactsById = { 999: { utasPile: 9 } };
    result = await execute();
  }
  expect(result.status, result.reason).toBe('completed');
  expect(writes.map(ids => ids.length)).toEqual([30, 30, 30, 30, 21]);
  expect(new Set(writes.flat()).size).toBe(141); expect(writes.flat()).not.toContain(999);
  expect(result.record.submittedScore).toBe(2820);
});

async function approvalWindow({ elapsed, explicitExpiry, budget = 750, offerPrice = null, findElapsed = null }) {
  const f = streamlinedRuntime(), memory = new Map(), started = 1000;
  let at = started;
  f.root.crypto.randomUUID = () => 'approval-window';
  const market = { ...f.plan.items[0], source: 'market', id: null, key: 'market:101:0', price: 200, purchaseMaxBuy: 250 };
  // Exercise production approval wiring and procurement; no native writes.
  const plan = { ...f.plan, route: { groups: [{ source: 'market', quantity: 1, item: market, items: [market] }] } };
  delete plan.schema; delete plan.fingerprint;
  const buyer = { assertCurrent: vi.fn(), readState: vi.fn(async record => {
    at = started + elapsed;
    return { submittedScore: record.submittedScore, freeSlots: 30, heldDefinitions: [] };
  }), materialize: vi.fn(async () => []), find: vi.fn(async () => {
    if (findElapsed !== null) at = started + findElapsed;
    return offerPrice === null ? null : { definitionId: market.definitionId, itemId: 401, tradeId: '501', price: offerPrice };
  }), buy: vi.fn(), move: vi.fn(), contribute: vi.fn() };
  const execution = await createFc27StreamlinedExecution(f.root, { context: plan.context, now: () => at,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)), canWrite: () => true,
    createPurchaseAdapter: async () => buyer,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) } });
  const result = await execution.purchase(plan, { approved: true, fingerprint: JSON.stringify(plan), budget,
    ...(explicitExpiry !== undefined ? { expiresAt: started + explicitExpiry } : {}) });
  return { f, buyer, result };
}

it.each([11 * 60000, 30 * 60000 - 1])('keeps the default purchase approval active after %i ms without raising budget or version cap', async elapsed => {
  const { f, buyer, result } = await approvalWindow({ elapsed });
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', record: { budget: 750, spent: 0 } });
  expect(buyer.find).toHaveBeenCalledOnce(); expect(buyer.find.mock.calls[0][1]).toBe(250);
  for (const key of ['buy', 'move', 'contribute']) expect(buyer[key]).not.toHaveBeenCalled();
  expect(f.calls).toHaveLength(0);
});

it.each([30 * 60000, 30 * 60000 + 1])('stops at the fixed 30-minute deadline after %i ms', async elapsed => {
  const { buyer, result } = await approvalWindow({ elapsed });
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED', record: { budget: 750, spent: 0 } });
  for (const key of ['find', 'buy', 'move', 'contribute']) expect(buyer[key]).not.toHaveBeenCalled();
});

it('retains an explicitly shorter approval deadline', async () => {
  const { buyer, result } = await approvalWindow({ elapsed: 10 * 60000, explicitExpiry: 10 * 60000 });
  expect(result.reason).toBe('FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED'); expect(buyer.find).not.toHaveBeenCalled();
});

it('does not renew approval when an active search crosses the 30-minute deadline', async () => {
  const { buyer, result } = await approvalWindow({ elapsed: 20 * 60000, findElapsed: 30 * 60000, offerPrice: 200 });
  expect(result.reason).toBe('FC27_STREAMLINED_PURCHASE_APPROVAL_EXPIRED'); expect(buyer.find).toHaveBeenCalledOnce();
  expect(buyer.buy).not.toHaveBeenCalled(); expect(result.record.entries).toEqual([]);
});

it('still rejects an above-cap offer during the extended window', async () => {
  const { buyer, result } = await approvalWindow({ elapsed: 11 * 60000, offerPrice: 251 });
  expect(result).toMatchObject({ reason: 'FC27_STREAMLINED_PURCHASE_OFFER_CHANGED', record: { budget: 750, spent: 0 } });
  expect(buyer.find.mock.calls[0][1]).toBe(250); expect(buyer.buy).not.toHaveBeenCalled();
});

it('still lowers the search cap to the unchanged remaining budget during the extended window', async () => {
  const { buyer, result } = await approvalWindow({ elapsed: 11 * 60000, budget: 200 });
  expect(result).toMatchObject({ reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', record: { budget: 200, spent: 0 } });
  expect(buyer.find.mock.calls[0][1]).toBe(200); expect(buyer.buy).not.toHaveBeenCalled();
});

it.each(['non-expiring', 'rebased-expiry', 'invalid-hub', 'reset-count-unchanged', 'reset-count-missing', 'reset-count-conflict'])('settles mixed Storage/Club with public native contracts: %s', async scenario => {
  const at = Math.floor(Date.now() / 1000) * 1000, endTime = scenario === 'non-expiring' ? 0 : observedSet(at).endTime;
  const f = streamlinedRuntime({ targetScore: 100, mixedStorage: true, endTime }), memory = new Map();
  installObservedStorage(f);
  f.replies.rows[0].submittedScore = 0;
  let writes = 0; const diagnosticLog = { record: vi.fn() };
  const execution = await createFc27StreamlinedExecution(f.root, { context: f.plan.context,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)), canWrite: () => true, diagnosticLog,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); writes++;
        f.state.players = f.state.players.filter(item => !target.itemIds.includes(item.id));
        f.storage.payload = f.storage.payload.filter(item => !target.itemIds.includes(item.id));
        f.replies.rows[0].submittedScore = 100; f.replies.rows[0].timesCompleted = 1; f.replies.rows[0].status = 'COMPLETED';
        f.replies.set = { ...f.set, totalSubmittedScore: 100, timesCompleted: 1, challengesCompletedCount: 1 };
        if (endTime) f.replies.set = observedSet(at + 1501, { endTime: 3599, combinedSubmittedChallengeScore: 100,
          timesCompleted: 1, challengesCompletedCount: 1 });
        if (scenario === 'invalid-hub') f.replies.set.challengesCompletedCount = null;
        if (scenario.startsWith('reset-count-')) {
          Object.assign(f.replies.rows[0], { submittedScore: 0, status: 'NOT_STARTED',
            timesCompleted: scenario === 'reset-count-missing' ? undefined : scenario === 'reset-count-conflict' ? 2 : 0 });
          Object.assign(f.replies.set, { totalSubmittedScore: 0, timesCompleted: 1, challengesCompletedCount: 0 });
        }
        return { success: true, status: 200, response: { setId: 31, challengeId: 61, submittedScore: 100,
          grantedChallengeAwards: [{ type: 'pack' }] } };
      } }) }),
  });
  execution.prepare(f.plan);
  expect(writes).toBe(0);
  const result = await execution.transaction.execute(f.plan, { approved: true, fingerprint: f.plan.fingerprint, batchIndices: [0] });
  if (scenario === 'reset-count-conflict') {
    expect(result).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED' });
    expect(result.confirmation).toBeUndefined();
    expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'contribution-readback', mismatch: 'cycle-count-conflict', cycleCountBefore: 0, cycleCountAfter: 2 }));
    expect((await execution.transaction.recover(f.plan.context)).status).toBe('recovery-required');
    expect(writes).toBe(1);
    f.replies.rows[0].timesCompleted = 0;
    expect((await execution.transaction.recover(f.plan.context)).status).toBe('recovered');
  } else if (scenario === 'invalid-hub') {
    expect(result).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_SET_CHALLENGE_COUNT_UNVERIFIED',
      confirmation: { submittedScore: 100, targetScore: 100, completed: true, finalizationPending: true } });
    expect(result.record.submittedScore).toBe(0); expect(result.record.batches[0].state).toBe('unknown');
    expect((await execution.transaction.recover(f.plan.context)).confirmation).toEqual(result.confirmation);
    expect(writes).toBe(1);
    f.replies.set.challengesCompletedCount = 1;
    expect((await execution.transaction.recover(f.plan.context)).status).toBe('recovered');
  } else expect(result.status, result.reason).toBe('completed');
  expect(writes).toBe(1);
  expect(f.calls.filter(row => row.kind === 'storage')).toHaveLength(['invalid-hub', 'reset-count-conflict'].includes(scenario) ? 4 : 2);
  expect((await execution.transaction.recover(f.plan.context)).status).toBe('observed');
  expect(writes).toBe(1); expect(f.challenge.submittedScore).toBe(scenario.startsWith('reset-count-') ? 0 : 100);
  if (scenario.startsWith('reset-count-')) {
    expect((await execution.journal.read(f.plan.context)).submittedScore).toBe(100);
    expect((await execution.journal.read(f.plan.context)).rewardState).toBe('unknown');
    expect(f.challenge.timesCompleted).toBe(0); // Never manufacture a local increment.
  }
  expect(f.set.endTime).toBe(endTime);
});

it('blocks Club-only contribution before any EA request when another target has an unknown move', async () => {
  const f = streamlinedRuntime(), key = contextKey(f.plan.context, 'streamlined-materialization');
  const memory = new Map([[key, { schema: 1, entries: [{ id: 901, definitionId: 1901,
    pile: 'unassigned', setId: 99, challengeId: 199, state: 'pending' }] }]]);
  const execution = await createFc27StreamlinedExecution(f.root, { context: f.plan.context,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)), canWrite: () => true,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) } });
  expect(await execution.transaction.execute(f.plan, { approved: true, fingerprint: f.plan.fingerprint,
    batchIndices: [0], allowPartial: true })).toMatchObject({ status: 'blocked',
    reason: 'FC27_STREAMLINED_MATERIALIZE_RECOVERY_REQUIRED' });
  expect(f.calls).toHaveLength(0);
  expect(memory.get(key).entries[0].state).toBe('pending');
});

it('confirms an old exact move under the shared lock without EA mutations', async () => {
  const f = streamlinedRuntime(), key = contextKey(f.plan.context, 'streamlined-materialization');
  const memory = new Map([[key, { schema: 1, entries: [{ id: 1, definitionId: 101,
    pile: 'transfer', setId: 99, challengeId: 199, state: 'pending' }] }]]);
  let held = false;
  const set = vi.fn(async (key, value) => { expect(held).toBe(true); memory.set(key, structuredClone(value)); });
  const execution = await createFc27StreamlinedExecution(f.root, { context: f.plan.context,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback), set,
    lockManager: { request: async (name, options, task) => {
      held = true; try { return await task({ name, mode: options.mode }); } finally { held = false; }
    } } });
  expect(await execution.recoverMaterialization()).toMatchObject({ status: 'recovered', confirmed: 1 });
  expect(memory.get(key).entries[0].state).toBe('confirmed');
  expect(set).toHaveBeenCalledOnce(); expect(held).toBe(false);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ kind: 'request', method: 'POST', body: { defId: '101' } });
  expect(f.calls[0].url).toMatch(/\/club$/);
});

it('keeps unresolved purchases and malformed traditional records visible before any contribution', async () => {
  const f = streamlinedRuntime(), scope = traditionalJournalScope(f.plan.context);
  for (const key of [scope, puzzleBuyPendingKey(scope), galleryPurchasePendingKey(scope)]) {
    await expect(assertStreamlinedOtherTransactions(async (candidate, fallback) => candidate === key ? {} : fallback, f.plan.context)).rejects.toThrow();
  }
  await expect(assertStreamlinedOtherTransactions(async (_key, fallback) => fallback, f.plan.context)).resolves.toBeUndefined();
});

it('prepares a real market-only plan without owned cache refs, writes or EA requests', async () => {
  const f = streamlinedRuntime(), market = f.plan.items.map((item, index) => ({ ...item,
    source: 'market', id: null, key: `market:${item.definitionId}:${index}`, price: 200 }));
  const plan = createStreamlinedPlan({ context: f.plan.context, challenge: f.plan.challenge, policy: f.plan.policy,
    result: { ...f.plan, items: market, batches: [market], materialValue: 0, purchaseCost: market.length * 200,
      route: { groups: [{ source: 'market', quantity: market.length, items: market }] } } });
  const get = async (_key, fallback) => fallback, set = vi.fn();
  const execution = await createFc27StreamlinedExecution(f.root, { context: plan.context, get, set,
    canWrite: () => true, lockManager: { request: vi.fn() } });
  expect(execution.prepare(plan)).toBe(true);
  expect(set).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  expect(Object.keys(f.root.repositories.Item.club.items._collection)).toHaveLength(11);
});

it('does not let a valid Puzzle purchase marker block an unrelated contribution', async () => {
  const f = streamlinedRuntime(), scope = traditionalJournalScope(f.plan.context);
  const target = { setId: 19, challengeId: 43 }, key = puzzleBuyKey(scope, target);
  const record = { schema: 1, scope, context: f.plan.context, target, operationId: 'fixture', phase: 'save-pending', applied: [],
    entries: [{ slot: 0, definitionId: 100, itemId: 1, state: 'club' },
      { slot: 1, definitionId: 101, itemId: 2, state: 'buy-pending' }] };
  const memory = new Map([[puzzleBuyPendingKey(scope), { key, operationId: 'fixture' }], [key, record]]);
  const set = vi.fn(), createMaintenance = vi.fn();
  const options = { context: f.plan.context, get: async (key, fallback) => memory.get(key) ?? fallback,
    set, createMaintenance };
  await expect(createFc27StreamlinedExecution(f.root, options)).resolves.toBeDefined();
  expect(set).not.toHaveBeenCalled(); expect(createMaintenance).toHaveBeenCalledOnce(); expect(f.calls).toHaveLength(0);
  expect(memory.get(key)).toBe(record);
  await expect(assertStreamlinedOtherTransactions(async (candidate, fallback) => {
    if (candidate === key) throw Error('disk read failed');
    return memory.get(candidate) ?? fallback;
  }, f.plan.context)).rejects.toThrow('FC27_BUY_JOURNAL_READ_FAILED');
  const foreign = `fcat-fc27-puzzle-buy:other:19:43`, reads = [];
  await expect(assertStreamlinedOtherTransactions(async (candidate, fallback) => {
    reads.push(candidate);
    return candidate === puzzleBuyPendingKey(scope) ? { key: foreign, operationId: 'fixture' } : fallback;
  }, f.plan.context)).rejects.toThrow('FC27_BUY_JOURNAL_UNCONFIRMED');
  expect(reads).not.toContain(foreign);
});

it.each(['none', 'transient-read', 'rate-limit', 'read-426', 'read-512', 'read-exhausted', 'readback-426', 'readback-512', 'readback-stop', 'cooldown-stop', 'cooldown-context'])('composes two batches without resending the settled first batch: %s', async failure => {
  const timed = failure === 'transient-read' || failure.startsWith('read') || failure.startsWith('cooldown-');
  if (timed) vi.useFakeTimers();
  const f = streamlinedRuntime(), selected = f.input.inventory.slice(0, 10), memory = new Map();
  const plan = createStreamlinedPlan({ context: f.input.context, challenge: f.input.challenge, policy: f.input.policy,
    result: { status: 'ready', items: selected, batches: [selected.slice(0, 5), selected.slice(5)], score: 200,
      progress: { target: 200, submitted: 0, added: 200, total: 200, remaining: 0, excess: 0, reached: true },
      purchaseCost: 0, materialValue: null, searchComplete: true } });
  let held = false;
  const get = async (key, fallback) => structuredClone(memory.get(key) ?? fallback);
  const set = vi.fn(async (key, value) => { expect(held).toBe(true); memory.set(key, structuredClone(value)); });
  f.replies.rows[0].submittedScore = 0;
  const status = failure === 'transient-read' ? 503 : failure.endsWith('-426') ? 426 : failure.startsWith('read') ? 512 : 429;
  if (failure !== 'none' && !failure.startsWith('cooldown-')) f.replies.progressReplies = [
    ...Array.from({ length: failure.startsWith('readback-') ? 1 : 2 }, () => ({})),
    ...Array.from({ length: failure === 'read-exhausted' ? 3 : 1 }, () => ({ success: false, status }))];
  const writes = [], writeTimes = [], progress = [], diagnosticLog = { record: vi.fn(async row => {
    if (failure === 'readback-stop' && row.phase === 'contribution-progress-backoff') execution.transaction.stop();
    return true;
  }) };
  const options = { context: f.plan.context, get, set, canWrite: () => true, diagnosticLog,
    lockManager: { request: async (name, options, task) => {
      if (held) return task(null);
      held = true; try { return await task({ name, mode: options.mode }); } finally { held = false; }
    } },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); expect(held).toBe(true); expect(f.root.info.base.clubCache.localDirty).toBe(true);
        writes.push(target.itemIds); writeTimes.push(Date.now());
        f.state.players = f.state.players.filter(item => !target.itemIds.includes(item.id));
        f.replies.rows[0].submittedScore += target.itemIds.length * 20;
        const complete = f.replies.rows[0].submittedScore === 200;
        if (complete) {
          f.replies.rows[0].timesCompleted = 1; f.replies.rows[0].status = 'COMPLETED';
          f.replies.set = { ...f.set, totalSubmittedScore: 200, timesCompleted: 1, challengesCompletedCount: 1 };
        }
        return { success: true, status: 200, response: { setId: 31, challengeId: 61,
          submittedScore: f.replies.rows[0].submittedScore, grantedChallengeAwards: complete ? [{ type: 'pack' }] : null } };
      } }) }),
  };
  const execution = await createFc27StreamlinedExecution(f.root, options);
  execution.prepare(plan);
  expect(writes).toHaveLength(0); expect(set).not.toHaveBeenCalled();
  const approval = { approved: true, fingerprint: plan.fingerprint, batchIndices: [0, 1] };
  const pending = execution.transaction.execute(plan, approval, { onProgress: p => {
    progress.push(p);
    if (p.phase === 'batch-cooldown' && failure === 'cooldown-stop') execution.transaction.stop();
    if (p.phase === 'batch-cooldown' && failure === 'cooldown-context') f.user.selectedPersona = 444;
  } });
  if (timed) await vi.advanceTimersByTimeAsync(failure === 'transient-read' ? 4501 : failure === 'read-exhausted' ? 12001 : 6001);
  let result = await pending;
  if (failure === 'readback-stop') {
    expect(result).toMatchObject({ status: 'stopped', record: { submittedScore: 100 } });
    expect(writes).toHaveLength(1); expect(result.record.batches.map(batch => batch.state)).toEqual(['confirmed', 'waiting']);
    expect(f.calls.filter(row => row.kind === 'progress')).toHaveLength(3); expect(vi.getTimerCount()).toBe(0); return;
  }
  if (failure.startsWith('cooldown-')) {
    expect(result).toMatchObject(failure === 'cooldown-stop' ? { status: 'stopped' }
      : { status: 'blocked', reason: expect.stringMatching(/^FC27_(STREAMLINED_CONTEXT_CHANGED|CONTEXT_UNAVAILABLE)$/) });
    expect(writes).toHaveLength(1); expect(f.calls.filter(row => row.kind === 'progress')).toHaveLength(2);
    const record = memory.get(contextKey(plan.context, 'streamlined-contribution'));
    expect(record.batches.map(batch => batch.state)).toEqual(['confirmed', 'waiting']); return;
  }
  if (failure === 'rate-limit' || failure === 'read-exhausted') {
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_PROGRESS_READ_FAILED', httpStatus: status,
      record: { submittedScore: 100, batches: [{ state: 'confirmed' }, { state: 'waiting' }] } });
    expect(writes).toHaveLength(1);
    expect(f.calls.filter(row => row.kind === 'progress')).toHaveLength(failure === 'read-exhausted' ? 5 : 3);
    expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ phase: 'contribution-validation',
      reason: 'FC27_STREAMLINED_PROGRESS_READ_FAILED', httpStatus: status, attempt: failure === 'read-exhausted' ? 3 : 1, attemptLimit: 3, currentScore: 100 }));
    const resumed = await createFc27StreamlinedExecution(f.root, options);
    result = await resumed.transaction.execute(plan, approval, { onProgress: p => progress.push(p) });
  }
  expect(result.status).toBe('completed'); expect(result.record.rewardState).toBe('unknown');
  expect(f.challenge.submittedScore).toBe(200); expect(f.challenge.status).toBe('COMPLETED');
  expect(f.challenge.timesCompleted).toBe(1); expect(f.set.totalSubmittedScore).toBe(200);
  expect(Object.keys(f.root.repositories.Item.club.items._collection)).toEqual(['11']);
  expect(progress.filter(p => p.phase === 'confirmed').map(p => p.submittedScore)).toEqual([100, 200]);
  expect(held).toBe(false);
  const restarted = await createFc27StreamlinedExecution(f.root, options);
  expect((await restarted.transaction.recover(plan.context)).status).toBe('observed');
  expect((await restarted.transaction.execute(plan, approval)).status).toBe('completed');
  expect(writes).toHaveLength(2);
  expect(progress).toContainEqual(expect.objectContaining({ phase: 'batch-cooldown' }));
  expect(writeTimes[1] - writeTimes[0]).toBeGreaterThanOrEqual(3000);
  expect(writes.filter(ids => ids.includes(1))).toHaveLength(1);
});

it('recovers a mixed-pile contribution after the final checkpoint fails without consuming twice', async () => {
  const f = streamlinedRuntime({ mixedStorage: true }), memory = new Map();
  let held = false, failCheckpoint = true, writes = 0;
  const options = { context: f.plan.context, canWrite: () => true,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => {
      expect(held).toBe(true);
      if (failCheckpoint && value?.batches?.[0]?.state === 'confirmed') throw Error('synthetic GM failure');
      memory.set(key, structuredClone(value));
    },
    lockManager: { request: async (name, options, task) => {
      if (held) return task(null);
      held = true; try { return await task({ name, mode: options.mode }); } finally { held = false; }
    } },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); writes++;
        f.state.players = f.state.players.filter(item => !target.itemIds.includes(item.id));
        f.storage.payload = [{ id: 502, resourceId: 101, pile: 8 }];
        f.replies.rows[0].submittedScore = 100;
        return { success: true, status: 200, response: { setId: 31, challengeId: 61, submittedScore: 100 } };
      } }) }),
  };
  f.replies.rows[0].submittedScore = 0;
  const club = f.root.repositories.Item.club.items._collection, storage = f.root.repositories.Item.storage._collection;
  club[900] = { ...club[1], id: 900 };
  storage[502] = { ...storage[501], id: 502 };
  const execution = await createFc27StreamlinedExecution(f.root, options);
  execution.prepare(f.plan);
  const approval = { approved: true, fingerprint: f.plan.fingerprint, batchIndices: [0], allowPartial: true };
  expect((await execution.transaction.execute(f.plan, approval)).status).toBe('blocked');
  expect(writes).toBe(1);
  const pending = await execution.journal.read(f.plan.context);
  expect(pending.batches[0]).toMatchObject({ state: 'pending', receipt: { status: 'accepted' } });
  expect(storage[501]).toBeUndefined(); expect(club[1]).toBeUndefined();
  expect(storage[502]).toBeDefined(); expect(club[900]).toBeDefined();
  failCheckpoint = false;
  const restarted = await createFc27StreamlinedExecution(f.root, options);
  expect((await restarted.transaction.recover(f.plan.context)).status).toBe('recovered');
  expect((await restarted.transaction.execute(f.plan, approval)).status).toBe('partial');
  expect(writes).toBe(1); expect(f.challenge.submittedScore).toBe(100);
  expect(f.set.totalSubmittedScore).toBe(100); expect(held).toBe(false);
});

it.each(['absent', 'completed', 'other-target', 'changed-target', 'unknown', 'same-target'])('market recovery %s never grants EA write authority and forwards bounded diagnostics', async scenario => {
  const f = streamlinedRuntime(), memory = new Map(), market = { ...f.plan.items[0], source: 'market', id: null,
    key: 'market:101:0', price: 200, purchaseMaxBuy: 250 };
  const plan = { ...f.plan, route: { groups: [{ source: 'market', quantity: 1, item: market, items: [market] }] } };
  // This contract fixture exercises the journal orchestration independently
  // of the already-tested production plan fingerprint parser.
  delete plan.schema; delete plan.fingerprint;
  const record = { schema: 1, context: plan.context, operationId: 'fixture', revision: 1, plan,
    fingerprint: JSON.stringify(plan), challenge: plan.challenge, policy: plan.policy, route: plan.route,
    budget: 250, spent: 200, submittedScore: 0, fulfilled: [0], consumedIds: [], contribution: null, completed: false,
    entries: [{ key: 'fixture:0', source: 'market', groupIndex: 0, state: 'club', definitionId: market.definitionId,
      itemId: 401, tradeId: '501', price: 200, cap: 250 }] };
  if (scenario === 'completed') { record.completed = true; record.submittedScore = plan.challenge.targetScore;
    record.fulfilled = [1]; record.consumedIds = [401]; record.entries[0].state = 'consumed'; }
  if (scenario === 'unknown') record.entries[0].state = 'move-pending';
  if (scenario !== 'absent') memory.set(streamlinedPurchaseKey(plan.context), record);
  const buyer = { assertCurrent: vi.fn(), verifySquad: vi.fn(), locate: vi.fn(async () => scenario === 'unknown' ? 'unknown' : 'club'), cancel: vi.fn(),
    buy: vi.fn(), move: vi.fn(), contribute: vi.fn() };
  const createPurchaseAdapter = vi.fn(async () => buyer);
  const diagnosticLog = { record: vi.fn(async () => true) };
  const execution = await createFc27StreamlinedExecution(f.root, { context: plan.context,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)), createPurchaseAdapter, diagnosticLog,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) } });
  const challenge = { ...plan.challenge, ...(scenario === 'other-target' ? { id: 999 } : {}),
    ...(scenario === 'changed-target' ? { targetScore: 999 } : {}) };
  { const outcome = await execution.recoverPurchase(challenge);
    expect(outcome.status, outcome.reason).toBe({ absent: 'absent', completed: 'completed',
      'other-target': 'recovery-required', 'changed-target': 'recovery-required', unknown: 'recovery-required', 'same-target': 'recovered' }[scenario]); }
  if (['absent', 'completed', 'other-target', 'changed-target'].includes(scenario)) expect(createPurchaseAdapter).not.toHaveBeenCalled();
  if (scenario === 'same-target') {
    createPurchaseAdapter.mock.calls[0][1].onEvent({ stage: 'contribution-readback', status: 'blocked',
      reason: 'FC27_STREAMLINED_RECEIPT_REQUIRED', count: 2, currentScore: 430, targetScore: 1250,
      httpStatus: 503, localReason: 'FC27_NATIVE_ERROR_521', attempt: 3, attemptLimit: 3,
      methodPath: 'methods.search', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64),
      accountScope: 'secret', itemIds: [123456], raw: { token: 'secret' } });
    expect(diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ area: 'streamlined', event: 'contribution-transaction',
      phase: 'contribution-readback', status: 'blocked', reason: 'FC27_STREAMLINED_RECEIPT_REQUIRED',
      httpStatus: 503, localReason: 'FC27_NATIVE_ERROR_521', attempt: 3, attemptLimit: 3,
      methodPath: 'methods.search', observedHash: 'a'.repeat(64), expectedHash: 'b'.repeat(64),
      count: 2, currentScore: 430, targetScore: 1250 }));
    expect(JSON.stringify(diagnosticLog.record.mock.calls)).not.toMatch(/secret|itemIds|accountScope|123456|"raw"/);
  }
  expect(buyer.buy).not.toHaveBeenCalled(); expect(buyer.move).not.toHaveBeenCalled(); expect(buyer.contribute).not.toHaveBeenCalled();
  expect(f.calls).toHaveLength(0);
});
