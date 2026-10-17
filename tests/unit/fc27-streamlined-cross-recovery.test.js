import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedExecution } from '../../src/adapters/browser/fc27-streamlined-execution.js';
import { createFc27StreamlinedSession } from '../../src/adapters/browser/fc27-streamlined-session.js';
import { createFc27StreamlinedProvider } from '../../src/adapters/ea/fc27-streamlined-provider.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { createStreamlinedJournal, streamlinedJournalKey } from '../../src/streamlined/journal.js';
import { streamlinedPurchaseKey } from '../../src/streamlined/purchase-journal.js';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';
import { streamlinedExecutionMessage } from '../../src/adapters/browser/fc27-streamlined-panel.js';
import { assertStreamlinedRecoveryIsolation } from '../../src/streamlined/recovery-isolation.js';
import { readFc27StreamlinedInputs } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { streamlinedProgress } from '../../src/streamlined/contract.js';

async function setup(state, { reservedId = 401, copyOfId = null, beforeDispatch = null } = {}) {
  const f = streamlinedRuntime(), memory = new Map(), mutations = vi.fn(), diagnosticLog = { record: vi.fn() };
  const get = async (key, fallback) => structuredClone(memory.get(key) ?? fallback);
  const set = vi.fn(async (key, value) => memory.set(key, structuredClone(value)));
  const selected = f.input.inventory.slice(0, 10);
  const plan = createStreamlinedPlan({ context: f.input.context, challenge: f.input.challenge, policy: f.input.policy,
    result: { status: 'ready', items: selected, batches: [selected.slice(0, 5), selected.slice(5)], score: 200,
      progress: { target: 200, submitted: 0, added: 200, total: 200, remaining: 0, excess: 0, reached: true },
      purchaseCost: 0, materialValue: null, searchComplete: true } });
  const journal = createStreamlinedJournal({ get, set });
  let record = await journal.begin(plan);
  Object.assign(record.batches[0], { state: 'confirmed', startingScore: 0,
    receipt: normalizeStreamlinedContributionReply({ success: true, status: 200,
      response: { setId: 31, challengeId: 61, submittedScore: 100 } },
    { setId: 31, challengeId: 61, previousScore: 0, itemIds: selected.slice(0, 5).map(item => item.id) }) });
  record.submittedScore = 100; await journal.write(plan.context, record, record.revision);
  f.challenge.submittedScore = 100; f.replies.rows[0].submittedScore = 100;
  const consumed = selected.slice(0, 5).map(item => item.id);
  f.state.players = f.state.players.filter(item => !consumed.includes(item.id));
  consumed.forEach(id => f.root.repositories.Item.club.items.remove(id));
  const source = plan.items.find(item => item.id === (copyOfId ?? reservedId)) ?? plan.items[0];
  const market = { ...source, source: 'market', id: null, key: `market:${source.definitionId}:0`, price: 200, purchaseMaxBuy: 250 };
  const oldPlan = { ...plan, challenge: { ...plan.challenge, setId: 71, id: 999, name: 'Old synthetic SBC' },
    route: { groups: [{ source: 'market', quantity: 1, item: market, items: [market] }] } };
  delete oldPlan.schema; delete oldPlan.fingerprint;
  const entry = { key: 'old:0', source: 'market', groupIndex: 0, state: state === 'contribution' ? 'club' : state,
    definitionId: market.definitionId, itemId: reservedId, tradeId: '501', price: 200, cap: 250 };
  if (state === 'waiting') Object.assign(entry, { itemId: null, tradeId: null, price: null, cap: null });
  const old = { schema: 1, context: plan.context, operationId: 'old-run', revision: 1, plan: oldPlan,
    fingerprint: JSON.stringify(oldPlan), challenge: oldPlan.challenge, policy: plan.policy, route: oldPlan.route,
    budget: 250, spent: ['waiting', 'rejected', 'buy-pending'].includes(state) ? 0 : 200,
    submittedScore: state === 'consumed' ? 20 : 0, fulfilled: [state === 'consumed' ? 1 : 0],
    consumedIds: state === 'consumed' ? [reservedId] : [], completed: false, contribution: null, entries: [entry] };
  if (state === 'contribution') {
    const item = { ...source, id: reservedId, key: `item:${reservedId}`, price: 200 };
    const batchPlan = createStreamlinedPlan({ context: plan.context, challenge: oldPlan.challenge, policy: plan.policy,
      result: { status: 'partial', items: [item], batches: [[item]], score: 20,
        progress: { target: 200, submitted: 0, added: 20, total: 20, remaining: 180, excess: 0, reached: false },
        purchaseCost: 0, materialValue: 200, searchComplete: true } });
    old.contribution = { batchPlan, material: [{ groupIndex: 0, item }], dispatched: true };
  }
  memory.set(streamlinedPurchaseKey(plan.context), structuredClone(old));
  const createPurchaseAdapter = vi.fn(async () => { throw Error('Foreign recovery must not create an EA adapter'); });
  const createExecution = async context => createFc27StreamlinedExecution(f.root, { context, get, set, diagnosticLog,
    canWrite: () => true, createPurchaseAdapter,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await beforeDispatch?.(); await before(); mutations(target.itemIds);
        f.state.players = f.state.players.filter(item => !target.itemIds.includes(item.id));
        Object.assign(f.replies.rows[0], { submittedScore: 200, timesCompleted: 1, status: 'COMPLETED' });
        f.replies.set = { ...f.set, totalSubmittedScore: 200, timesCompleted: 1, challengesCompletedCount: 1 };
        return { success: true, status: 200, response: { setId: 31, challengeId: 61,
          submittedScore: 200, grantedChallengeAwards: [{ type: 'pack' }] } };
      } }) }),
  });
  const current = () => ({ ...f.input.challenge, submittedScore: f.challenge.submittedScore,
    remainingScore: 200 - f.challenge.submittedScore });
  const session = createFc27StreamlinedSession({ get, set, createExecution, diagnosticLog,
    inspect: () => ({ context: plan.context, challenge: current() }),
    readInputs: () => ({ ...f.input, challenge: current(), inventory: f.input.inventory.filter(item => !consumed.includes(item.id)) }) });
  set.mockClear();
  return { ...f, session, memory, get, set, old, plan, mutations, createExecution, createPurchaseAdapter, diagnosticLog };
}

it.each(['waiting', 'rejected', 'consumed'])('restores the current partial contribution past settled foreign %s history', async state => {
  const f = await setup(state);
  const result = await f.session.recover();
  expect(result).toMatchObject({ status: 'observed', record: { submittedScore: 100,
    batches: [{ state: 'confirmed' }, { state: 'waiting' }] }, preview: { liveExecutionEnabled: true, plan: f.plan } });
  expect(f.set).not.toHaveBeenCalled(); expect(f.mutations).not.toHaveBeenCalled();
  expect(f.createPurchaseAdapter).not.toHaveBeenCalled();
  expect(await f.get(streamlinedPurchaseKey(f.plan.context))).toEqual(f.old);
  const before = await f.get(streamlinedJournalKey(f.plan.context));
  expect((await f.session.recover()).record).toEqual(before);
  const completed = await f.session.contribute({ fingerprint: f.plan.fingerprint, batchIndices: [0, 1] });
  expect(completed.status, completed.reason).toBe('completed');
  expect(f.mutations).toHaveBeenCalledExactlyOnceWith(f.plan.batches[1].map(item => item.id));
  expect(await f.get(streamlinedPurchaseKey(f.plan.context))).toEqual(f.old);
});

it('restores disjoint stock-only work without settling or executing a foreign purchase', async () => {
  const f = await setup('club'), old = structuredClone(f.old);
  const result = await f.session.recover();
  expect(result).toMatchObject({ status: 'observed', record: { submittedScore: 100 },
    warning: { reason: 'FC27_STREAMLINED_FOREIGN_PURCHASE_ISOLATED' }, preview: { liveExecutionEnabled: true } });
  expect(f.mutations).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled();
  expect(f.diagnosticLog.record.mock.calls.filter(([row]) => row.event === 'recovery')
    .some(([row]) => row.status === 'recovery-required')).toBe(false);
  expect((await f.session.contribute({ fingerprint: f.plan.fingerprint, batchIndices: [0, 1] })).status).toBe('completed');
  expect(f.mutations).toHaveBeenCalledExactlyOnceWith(f.plan.batches[1].map(item => item.id));
  expect(await f.get(streamlinedPurchaseKey(f.plan.context))).toEqual(old);
});

it.each(['lock', 'roster'])('continues a recovered remainder after an unrelated %s changes', async change => {
  const f = await setup('club');
  if (change === 'lock') f.root.info.lock.push(9999);
  else {
    f.root.info.squad[0] = 9999;
    f.root.repositories.Squad.squads._collection[902]._collection[7]._players[0]._item.id = 9999;
  }
  expect((await f.session.recover()).preview.liveExecutionEnabled).toBe(true);
  const result = await f.session.contribute({ fingerprint: f.plan.fingerprint, batchIndices: [1] });
  expect(result.status, result.reason).toBe('completed');
  expect(f.mutations).toHaveBeenCalledExactlyOnceWith(f.plan.batches[1].map(item => item.id));
});

function replacementPlan(f, { challenge: overrides = {}, alterItems = () => {} } = {}) {
  const input = readFc27StreamlinedInputs(f.root), challenge = { ...input.challenge, ...overrides };
  const items = structuredClone(input.inventory.slice(-5)); alterItems(items);
  const score = items.reduce((sum, item) => sum + item.points, 0), progress = streamlinedProgress(challenge, score);
  return createStreamlinedPlan({ context: input.context, challenge, policy: input.policy,
    result: { status: progress.reached ? 'ready' : 'partial', items, batches: [items], score, progress,
      purchaseCost: 0, materialValue: null, searchComplete: true } });
}

it.each(['observed', 'old-card-locked', 'policy-change', 'old-card-missing'])('replans a %s partial stock journal without losing its confirmed record', async scenario => {
  const f = await setup('club'), key = streamlinedJournalKey(f.plan.context);
  const previous = structuredClone(f.memory.get(key));
  if (scenario === 'old-card-locked') f.root.info.lock.push(6);
  if (scenario === 'policy-change') f.root.info.set.goldenrange = 80;
  if (scenario === 'old-card-missing') {
    f.state.players = f.state.players.filter(item => item.id !== 6); f.root.repositories.Item.club.items.remove(6);
  }
  const next = replacementPlan(f), items = next.items;
  const execution = await f.createExecution(f.plan.context); execution.prepare(next);
  const result = await execution.transaction.execute(next, { approved: true, fingerprint: next.fingerprint, batchIndices: [0] });
  expect(result.status, result.reason).toBe('completed');
  expect(f.mutations).toHaveBeenCalledExactlyOnceWith(items.map(item => item.id));
  expect([...f.memory].some(([storedKey, row]) => storedKey.startsWith(`${key}:history:`)
    && JSON.stringify(row) === JSON.stringify(previous))).toBe(true);
  expect(f.memory.get(key).plan.fingerprint).toBe(next.fingerprint);
  expect(f.memory.get(streamlinedPurchaseKey(f.plan.context))).toEqual(f.old);
});

it.each(['pending', 'unknown', 'missing-receipt', 'progress-changed', 'wrong-score', 'wrong-target',
  'consumed-card', 'external', 'purchased', 'not-approved', 'archive-failed', 'archive-conflict'])('does not discard the old record while replanning %s', async scenario => {
  const f = await setup('club'), key = streamlinedJournalKey(f.plan.context), saved = f.memory.get(key);
  if (['pending', 'unknown'].includes(scenario)) Object.assign(saved.batches[1], { state: scenario, startingScore: 100 });
  if (scenario === 'missing-receipt') delete saved.batches[0].receipt;
  if (scenario === 'progress-changed') saved.batches[0].progressChanged = true;
  const previous = structuredClone(saved), next = replacementPlan(f, {
    challenge: scenario === 'wrong-score' ? { submittedScore: 99, remainingScore: 101 }
      : scenario === 'wrong-target' ? { id: 62 } : {},
    alterItems: items => {
      if (scenario === 'consumed-card') items[0] = structuredClone(f.plan.items[0]);
      if (scenario === 'external') Object.assign(items[0], { pile: 'unassigned', executionPile: 'club' });
      if (scenario === 'purchased') items[0].purchaseReceipt = { itemId: items[0].id };
    } });
  if (scenario === 'archive-failed') f.set.mockImplementationOnce(async () => { throw Error('synthetic disk failure'); });
  if (scenario === 'archive-conflict') f.memory.set(`${key}:history:${saved.revision}`, { conflicting: true });
  const execution = await f.createExecution(f.plan.context); execution.prepare(next);
  const result = await execution.transaction.execute(next, { approved: scenario !== 'not-approved', fingerprint: next.fingerprint,
    batchIndices: [0], allowPartial: true });
  expect(result.status).toBe('blocked');
  expect(f.memory.get(key)).toEqual(previous); expect(f.mutations).not.toHaveBeenCalled();
  expect(f.memory.get(streamlinedPurchaseKey(f.plan.context))).toEqual(f.old);
});

it('retains an archived original through a failed new checkpoint and retries without duplicate contribution', async () => {
  const f = await setup('club'), key = streamlinedJournalKey(f.plan.context), previous = structuredClone(f.memory.get(key));
  const next = replacementPlan(f), write = f.set.getMockImplementation(); let failed = false;
  f.set.mockImplementation(async (storedKey, value) => {
    if (!failed && storedKey === key && value.plan.fingerprint === next.fingerprint) {
      failed = true; throw Error('synthetic checkpoint failure');
    }
    return write(storedKey, value);
  });
  const execution = await f.createExecution(f.plan.context); execution.prepare(next);
  const approve = { approved: true, fingerprint: next.fingerprint, batchIndices: [0] };
  expect(await execution.transaction.execute(next, approve)).toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_JOURNAL_WRITE_FAILED' });
  expect(f.memory.get(key)).toEqual(previous); expect(f.mutations).not.toHaveBeenCalled();
  expect(f.memory.get(`${key}:history:${previous.revision}`)).toEqual(previous);
  expect((await execution.transaction.execute(next, approve)).status).toBe('completed');
  expect(f.mutations).toHaveBeenCalledExactlyOnceWith(next.items.map(item => item.id));
  expect([...f.memory.keys()].filter(storedKey => storedKey.startsWith(`${key}:history:`))).toHaveLength(1);
});

it('revalidates live progress after an approved stock replan and before dispatch', async () => {
  const f = await setup('club'), next = replacementPlan(f);
  f.replies.rows[0].submittedScore = 101;
  const execution = await f.createExecution(f.plan.context); execution.prepare(next);
  expect(await execution.transaction.execute(next, { approved: true, fingerprint: next.fingerprint, batchIndices: [0] }))
    .toMatchObject({ status: 'blocked', reason: 'FC27_STREAMLINED_PROGRESS_CHANGED' });
  expect(f.mutations).not.toHaveBeenCalled();
});

it('generates and executes a fresh protected remainder through the production session without a recovery loop', async () => {
  const f = await setup('club'), key = streamlinedJournalKey(f.plan.context), previous = structuredClone(f.memory.get(key));
  f.root.info.lock.push(6);
  const session = createFc27StreamlinedSession({ get: f.get, set: f.set, createExecution: f.createExecution,
    inspect: () => { const input = readFc27StreamlinedInputs(f.root); return { context: input.context, challenge: input.challenge }; },
    readInputs: settings => readFc27StreamlinedInputs(f.root, settings) });
  const settings = (await session.readSettings()).settings;
  const result = await session.plan({ ...settings, objective: 'inventory-first', sources: ['club'] });
  expect(result.status, result.reason).toBe('ready'); expect(result.liveExecutionEnabled).toBe(true);
  expect(result.plan.challenge.submittedScore).toBe(100);
  expect(result.plan.items.map(item => item.id).sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11]);
  expect(f.memory.get(key)).toEqual(previous); expect(f.mutations).not.toHaveBeenCalled();
  expect((await session.contribute({ fingerprint: result.plan.fingerprint, batchIndices: [0] })).status).toBe('completed');
  expect(f.mutations).toHaveBeenCalledOnce();
  expect(f.memory.get(`${key}:history:${previous.revision}`)).toEqual(previous);
});

it.each(['buy-pending', 'bought', 'move-pending', 'club', 'contribution'])('isolates foreign %s without settling it or spending its materials', async state => {
  const f = await setup(state), before = structuredClone([...f.memory]);
  const result = await f.session.recover();
  expect(result).toMatchObject({ status: 'observed', warning: { reason: 'FC27_STREAMLINED_FOREIGN_PURCHASE_ISOLATED' },
    purchaseRecovery: { recovery: { setId: 71, challengeId: 999, purchasesSettled: false } },
    preview: { liveExecutionEnabled: true }, record: { submittedScore: 100 } });
  expect([...f.memory]).toEqual(before); expect(f.set).not.toHaveBeenCalled();
  expect(f.mutations).not.toHaveBeenCalled(); expect(f.createPurchaseAdapter).not.toHaveBeenCalled();
  expect(f.diagnosticLog.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'recovery',
    setId: 71, challengeId: 999, purchasesSettled: false, currentScore: 100 }));
});

it('explains the exact old target instead of exposing an unexplained error code', () => {
  const message = streamlinedExecutionMessage('FC27_STREAMLINED_OTHER_TARGET_PURCHASE_RECOVERY_REQUIRED',
    { setId: 71, challengeId: 999, pendingWriteCount: 1, unconsumedPurchaseCount: 2 });
  expect(message).toContain('Set 71 / Challenge 999');
  expect(message).toContain('1'); expect(message).toContain('2');
  expect(message).toContain('不会重复买入');
});

it('does not trust completed=true to suppress an unresolved foreign write', async () => {
  const f = await setup('buy-pending');
  const saved = await f.get(streamlinedPurchaseKey(f.plan.context)); saved.completed = true;
  f.memory.set(streamlinedPurchaseKey(f.plan.context), saved);
  expect(await f.session.recover()).toMatchObject({ status: 'observed',
    purchaseRecovery: { recovery: { pendingWriteCount: 1, purchasesSettled: false } } });
  expect(f.set).not.toHaveBeenCalled(); expect(f.mutations).not.toHaveBeenCalled();
});

it('keeps an unresolved foreign purchase blocking when no current contribution exists', async () => {
  const f = await setup('club'); f.memory.delete(streamlinedJournalKey(f.plan.context));
  const result = await f.session.recover();
  expect(result).toMatchObject({ status: 'recovery-required', recovery: { unconsumedPurchaseCount: 1 } });
  expect(result.record).toBeUndefined(); expect(result.preview).toBeUndefined();
  expect(f.set).not.toHaveBeenCalled(); expect(f.mutations).not.toHaveBeenCalled();
});

it('does not treat malformed foreign history as safely settled', async () => {
  const f = await setup('consumed'), before = structuredClone([...f.memory]);
  f.memory.get(streamlinedPurchaseKey(f.plan.context)).spent = 0;
  expect(await f.session.recover()).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_PURCHASE_JOURNAL_INVALID' });
  expect(f.set).not.toHaveBeenCalled(); expect(f.mutations).not.toHaveBeenCalled();
  expect(await f.get(streamlinedJournalKey(f.plan.context))).toEqual(new Map(before).get(streamlinedJournalKey(f.plan.context)));
});

it('blocks the same physical card but not another copy of the same version', async () => {
  const blocked = await setup('club', { reservedId: 6 });
  expect(await blocked.session.recover()).toMatchObject({ status: 'recovery-required',
    reason: 'FC27_STREAMLINED_FOREIGN_PURCHASE_MATERIAL_RESERVED', record: { submittedScore: 100 } });
  expect(blocked.mutations).not.toHaveBeenCalled(); expect(blocked.set).not.toHaveBeenCalled();
  const separate = await setup('club', { copyOfId: 6 });
  expect(await separate.session.recover()).toMatchObject({ status: 'observed', preview: { liveExecutionEnabled: true } });
});

it('rechecks isolation inside the native dispatch callback after validation', async () => {
  const replacement = await setup('club', { reservedId: 6 });
  const f = await setup('club', { beforeDispatch: () => f.memory.set(streamlinedPurchaseKey(f.plan.context), structuredClone(replacement.old)) });
  expect((await f.session.recover()).preview.liveExecutionEnabled).toBe(true);
  const result = await f.session.contribute({ fingerprint: f.plan.fingerprint, batchIndices: [1] });
  expect(result).toMatchObject({ status: 'rejected', reason: 'FC27_STREAMLINED_FOREIGN_PURCHASE_MATERIAL_RESERVED' });
  expect(f.mutations).not.toHaveBeenCalled();
  expect(await f.get(streamlinedPurchaseKey(f.plan.context))).toEqual(replacement.old);
});

it('does not need to reopen or contact an expired historical SBC to isolate its reservation', async () => {
  const f = await setup('club'), old = f.memory.get(streamlinedPurchaseKey(f.plan.context));
  old.challenge.endTime = 1;
  const before = structuredClone(old);
  expect(await f.session.recover()).toMatchObject({ status: 'observed', preview: { liveExecutionEnabled: true } });
  expect(f.createPurchaseAdapter).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  expect(await f.get(streamlinedPurchaseKey(f.plan.context))).toEqual(before);
});

it('blocks an unverified historical contribution scope without clearing the marker', async () => {
  const f = await setup('contribution'); delete f.memory.get(streamlinedPurchaseKey(f.plan.context)).contribution.batchPlan;
  expect(await f.session.recover()).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_FOREIGN_PURCHASE_SCOPE_UNVERIFIED' });
  expect(f.set).not.toHaveBeenCalled(); expect(f.mutations).not.toHaveBeenCalled();
});

it.each(['external', 'market', 'receipt'])('does not isolate a %s route as ordinary stock', async kind => {
  const f = await setup('club'), items = structuredClone(f.plan.items);
  if (kind === 'external') Object.assign(items[5], { pile: 'unassigned', executionPile: 'club' });
  if (kind === 'market') Object.assign(items[5], { source: 'market', id: null, key: `market:${items[5].definitionId}:0`, price: 200 });
  if (kind === 'receipt') items[5].purchaseReceipt = { itemId: items[5].id };
  const plan = createStreamlinedPlan({ context: f.plan.context, challenge: f.plan.challenge, policy: f.plan.policy,
    result: { ...f.plan, items, batches: [items.slice(0, 5), items.slice(5)], purchaseCost: kind === 'market' ? 200 : 0 } });
  expect(() => assertStreamlinedRecoveryIsolation(plan, [{ id: items[5].id, definitionId: items[5].definitionId,
    points: 20, pile: items[5].pile }], f.old)).toThrow('FOREIGN_PURCHASE_SCOPE_BLOCKED');
});

it.each(['confirmed', 'rejected', 'waiting', 'pending', 'unknown', 'confirmed-no-receipt', 'scope-changed', 'checkpoint-failed'])('hands off a matching historical %s result before replacing its inner journal', async scenario => {
  const state = ['confirmed-no-receipt', 'scope-changed', 'checkpoint-failed'].includes(scenario) ? 'confirmed' : scenario;
  const f = await setup('contribution'), batchPlan = f.old.contribution.batchPlan;
  f.memory.delete(streamlinedJournalKey(f.plan.context));
  const seed = createStreamlinedJournal({ get: f.get, set: f.set });
  let previous = await seed.begin(batchPlan);
  previous.batches[0].state = state;
  if (state !== 'waiting') previous.batches[0].startingScore = 0;
  if (['confirmed', 'pending', 'unknown'].includes(state)) previous.batches[0].receipt = normalizeStreamlinedContributionReply({
    success: true, status: 200, response: { setId: 71, challengeId: 999, submittedScore: 20 } },
  { setId: 71, challengeId: 999, previousScore: 0, itemIds: [401] });
  if (state === 'confirmed') previous.submittedScore = 20;
  if (scenario === 'confirmed-no-receipt') delete previous.batches[0].receipt;
  previous = await seed.write(f.plan.context, previous, previous.revision);
  if (scenario === 'scope-changed') f.memory.get(streamlinedPurchaseKey(f.plan.context)).contribution.batchPlan = f.plan;
  const before = structuredClone(await f.get(streamlinedPurchaseKey(f.plan.context)));
  if (scenario === 'checkpoint-failed') f.set.mockImplementationOnce(async () => { throw Error('synthetic disk failure'); });
  const items = f.plan.batches[1], next = createStreamlinedPlan({ context: f.plan.context, policy: f.plan.policy,
    challenge: { ...f.plan.challenge, submittedScore: 100, remainingScore: 100 },
    result: { status: 'ready', items, batches: [items], score: 100,
      progress: { target: 200, submitted: 100, added: 100, total: 200, remaining: 0, excess: 0, reached: true },
      purchaseCost: 0, materialValue: null, searchComplete: true } });
  const execution = await f.createExecution(f.plan.context); execution.prepare(next);
  const result = await execution.transaction.execute(next, { approved: true, fingerprint: next.fingerprint, batchIndices: [0] });
  const old = await f.get(streamlinedPurchaseKey(f.plan.context));
  if (['pending', 'unknown'].includes(state) || ['confirmed-no-receipt', 'scope-changed', 'checkpoint-failed'].includes(scenario)) {
    expect(result.status).toBe('blocked'); expect(old).toEqual(before);
    expect(await seed.read(f.plan.context)).toEqual(previous); expect(f.mutations).not.toHaveBeenCalled();
  } else {
    expect(result.status, result.reason).toBe('completed'); expect(old.contribution).toBeNull();
    expect(old).toMatchObject({ submittedScore: state === 'confirmed' ? 20 : 0,
      consumedIds: state === 'confirmed' ? [401] : [], completed: false });
    expect(old.entries[0].state).toBe(state === 'confirmed' ? 'consumed' : 'club');
    expect(f.mutations).toHaveBeenCalledExactlyOnceWith(items.map(item => item.id));
  }
});
