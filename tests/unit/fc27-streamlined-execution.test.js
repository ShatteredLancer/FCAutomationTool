import { expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { createFc27StreamlinedExecution, assertStreamlinedOtherTransactions } from '../../src/adapters/browser/fc27-streamlined-execution.js';
import { createFc27StreamlinedProvider } from '../../src/adapters/ea/fc27-streamlined-provider.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { puzzleBuyPendingKey, puzzleBuyKey } from '../../src/fc27/puzzle-buy-session.js';
import { galleryPurchasePendingKey } from '../../src/gallery/purchase-session.js';
import { streamlinedPurchaseKey } from '../../src/streamlined/purchase-journal.js';

it('keeps unresolved purchases and malformed traditional records visible before any contribution', async () => {
  const f = streamlinedRuntime(), scope = traditionalJournalScope(f.plan.context);
  for (const key of [scope, puzzleBuyPendingKey(scope), galleryPurchasePendingKey(scope)]) {
    await expect(assertStreamlinedOtherTransactions(async (candidate, fallback) => candidate === key ? {} : fallback, f.plan.context)).rejects.toThrow();
  }
  await expect(assertStreamlinedOtherTransactions(async (_key, fallback) => fallback, f.plan.context)).resolves.toBeUndefined();
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

it('composes shared locking, durable GM, real readers, native eviction and page progress across two batches', async () => {
  const f = streamlinedRuntime(), selected = f.input.inventory.slice(0, 10), memory = new Map();
  const plan = createStreamlinedPlan({ context: f.input.context, challenge: f.input.challenge, policy: f.input.policy,
    result: { status: 'ready', items: selected, batches: [selected.slice(0, 5), selected.slice(5)], score: 200,
      progress: { target: 200, submitted: 0, added: 200, total: 200, remaining: 0, excess: 0, reached: true },
      purchaseCost: 0, materialValue: null, searchComplete: true } });
  let held = false;
  const get = async (key, fallback) => structuredClone(memory.get(key) ?? fallback);
  const set = vi.fn(async (key, value) => { expect(held).toBe(true); memory.set(key, structuredClone(value)); });
  f.replies.rows[0].submittedScore = 0;
  const writes = [], progress = [];
  const options = { context: f.plan.context, get, set, canWrite: () => true,
    lockManager: { request: async (name, options, task) => {
      if (held) return task(null);
      held = true; try { return await task({ name, mode: options.mode }); } finally { held = false; }
    } },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); expect(held).toBe(true); expect(f.root.info.base.clubCache.localDirty).toBe(true);
        writes.push(target.itemIds);
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
  const result = await execution.transaction.execute(plan, approval, { onProgress: p => progress.push(p) });
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

it.each(['absent', 'completed', 'other-target', 'changed-target', 'unknown', 'same-target'])('market recovery %s never grants EA write authority', async scenario => {
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
  const execution = await createFc27StreamlinedExecution(f.root, { context: plan.context,
    get: async (key, fallback) => structuredClone(memory.get(key) ?? fallback),
    set: async (key, value) => memory.set(key, structuredClone(value)), createPurchaseAdapter,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) } });
  const challenge = { ...plan.challenge, ...(scenario === 'other-target' ? { id: 999 } : {}),
    ...(scenario === 'changed-target' ? { targetScore: 999 } : {}) };
  if (scenario === 'changed-target') await expect(execution.recoverPurchase(challenge)).rejects.toThrow('CONTEXT_CHANGED');
  else { const outcome = await execution.recoverPurchase(challenge);
    expect(outcome.status, outcome.reason).toBe({ absent: 'absent', completed: 'completed',
      'other-target': 'recovery-required', unknown: 'recovery-required', 'same-target': 'recovered' }[scenario]); }
  if (['absent', 'completed', 'other-target', 'changed-target'].includes(scenario)) expect(createPurchaseAdapter).not.toHaveBeenCalled();
  expect(buyer.buy).not.toHaveBeenCalled(); expect(buyer.move).not.toHaveBeenCalled(); expect(buyer.contribute).not.toHaveBeenCalled();
  expect(f.calls).toHaveLength(0);
});
