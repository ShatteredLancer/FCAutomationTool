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

async function setup(state) {
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
  const market = { ...plan.items[0], source: 'market', id: null, key: 'market:101:0', price: 200, purchaseMaxBuy: 250 };
  const oldPlan = { ...plan, challenge: { ...plan.challenge, setId: 71, id: 999 },
    route: { groups: [{ source: 'market', quantity: 1, item: market, items: [market] }] } };
  delete oldPlan.schema; delete oldPlan.fingerprint;
  const entry = { key: 'old:0', source: 'market', groupIndex: 0, state: state === 'contribution' ? 'club' : state,
    definitionId: market.definitionId, itemId: 401, tradeId: '501', price: 200, cap: 250 };
  if (state === 'waiting') Object.assign(entry, { itemId: null, tradeId: null, price: null, cap: null });
  const old = { schema: 1, context: plan.context, operationId: 'old-run', revision: 1, plan: oldPlan,
    fingerprint: JSON.stringify(oldPlan), challenge: oldPlan.challenge, policy: plan.policy, route: oldPlan.route,
    budget: 250, spent: ['waiting', 'rejected', 'buy-pending'].includes(state) ? 0 : 200,
    submittedScore: state === 'consumed' ? 20 : 0, fulfilled: [state === 'consumed' ? 1 : 0],
    consumedIds: state === 'consumed' ? [401] : [], completed: false,
    contribution: state === 'contribution' ? { material: [{ groupIndex: 0,
      item: { id: 401, definitionId: market.definitionId, points: market.points } }] } : null, entries: [entry] };
  memory.set(streamlinedPurchaseKey(plan.context), structuredClone(old));
  const createPurchaseAdapter = vi.fn(async () => { throw Error('Foreign recovery must not create an EA adapter'); });
  const createExecution = async context => createFc27StreamlinedExecution(f.root, { context, get, set, diagnosticLog,
    canWrite: () => true, createPurchaseAdapter,
    lockManager: { request: async (name, options, task) => task({ name, mode: options.mode }) },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); mutations(target.itemIds);
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

it.each(['buy-pending', 'bought', 'move-pending', 'club', 'contribution'])('keeps foreign %s unresolved while showing the current confirmed score', async state => {
  const f = await setup(state), before = structuredClone([...f.memory]);
  const result = await f.session.recover();
  expect(result).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_OTHER_TARGET_PURCHASE_RECOVERY_REQUIRED',
    recovery: { setId: 71, challengeId: 999, purchasesSettled: false }, record: { submittedScore: 100 } });
  expect(result.preview).toBeUndefined();
  expect((await f.session.contribute({ fingerprint: f.plan.fingerprint, batchIndices: [1] })).status).toBe('blocked');
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
  expect(await f.session.recover()).toMatchObject({ status: 'recovery-required',
    recovery: { pendingWriteCount: 1, purchasesSettled: false } });
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
