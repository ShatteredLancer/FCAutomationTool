// Incident-shaped aggregates; quotes, identities, API replies and historical pool are synthetic.
// State machines, journals, provider validation, materialization and reconciliation are production code.
import { afterEach, expect, it, vi } from 'vitest';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { finishNativeIo } from '../helpers/native-io-timers.js';
import { safeItem, eligibility } from '../helpers/streamlined.js';
import { readFc27StreamlinedInputs, projectFc27StreamlinedItem } from '../../src/adapters/ea/fc27-streamlined-read.js';
import { createFc27StreamlinedExecution } from '../../src/adapters/browser/fc27-streamlined-execution.js';
import { createFc27StreamlinedProvider } from '../../src/adapters/ea/fc27-streamlined-provider.js';
import { createFc27StreamlinedPurchaseAdapter } from '../../src/adapters/ea/fc27-streamlined-purchase.js';
import { createStreamlinedPurchaseJournal, streamlinedPurchaseKey } from '../../src/streamlined/purchase-journal.js';
import { decodeStoredValue } from '../../src/runtime/compact-storage.js';
import { createFc27StreamlinedPageMaintenance } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { createStreamlinedJournal } from '../../src/streamlined/journal.js';
import { runStreamlinedRoutes, expandStreamlinedRoute } from '../../src/streamlined/routes.js';
import { createStreamlinedPurchaseScope, approvedStreamlinedPurchaseRoute, initialStreamlinedPurchaseDemand } from '../../src/streamlined/purchase-scope.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';

afterEach(() => vi.useRealTimers());

async function fixture({ fault = null, innerState = 'rejected' } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T03:01:00Z'));
  const now = () => Date.now(), f = streamlinedRuntime({ targetScore: 16000 });
  f.root.info.build.untradeable = false; f.root.info.set.goldenrange = 90;
  f.root.ItemPile.PURCHASED = 1; f.root.MAX_NEW_ITEMS = 100; f.root.UTCurrencyInputControl = { PRICE_TIERS: [{ min: 0, inc: 50 }] };
  const events = []; const memory = new Map(), pending = new Map(), buys = [], moves = [], contributions = [], allAttempts = [];
  const forbiddenIds = [1, 2, 3, 4, 5, 6]; let serial = 1000, held = false, fired = false;
  f.root.repositories.Item.numItemsInCache = () => pending.size;
  const facts = { _rating: 84, sbsScore: 830, tradable: true, utasPile: 7 };
  f.state.playerFacts = facts;
  f.state.players = [{ id: 101, resourceId: 201 }, { id: 102, resourceId: 202 }];
  f.root.repositories.Item.club.items._collection = Object.fromEntries(f.state.players.map(raw => [raw.id, f.root.factories.Item.createItem(raw)]));
  const input = readFc27StreamlinedInputs(f.root), context = input.context;
  const originalChallenge = { ...input.challenge, submittedScore: 0, remainingScore: 16000 };
  const quote = (definitionId, price) => ({ definitionId, source: 'futbin', price, fetchedAt: now(), expiresAt: now() + 86400000 });
  const market = [201, 202, 203, 204, 205, 206, 207].map(definitionId => {
    const price = definitionId < 205 ? 850 : definitionId < 207 ? 900 : 2200;
    return { ...safeItem({ source: 'market', definitionId, points: definitionId === 207 ? 2100 : 830,
      rating: definitionId === 207 ? 85 : 84, price, quote: quote(definitionId, price) }),
      purchaseMaxBuy: price, pricePolicy: { source: 'futbin' } };
  });
  const inventory = [4100, 2100, 1800, 890].map((points, index) => safeItem({ id: index + 1, definitionId: index + 11,
    points, rating: 84, tradeable: true }));
  const original = { context, challenge: originalChallenge, policy: input.policy, eligibility,
    inventory, market, objective: 'inventory-first', mode: 'inventory-market', quoteSource: 'futbin', quoteAt: now() };
  const routes = await runStreamlinedRoutes(original);
  expect(routes.routes?.length, JSON.stringify(routes)).toBeGreaterThan(0);
  const result = { ...expandStreamlinedRoute(routes.routes[0], originalChallenge), route: routes.routes[0] };
  const plan = createStreamlinedPlan({ context, challenge: originalChallenge, policy: input.policy,
    objective: 'inventory-first', result, execution: { purchaseAttempts: 3, partialWaitMs: 60000,
      purchaseScope: createStreamlinedPurchaseScope(original) } });
  const get = async (key, fallback) => structuredClone(memory.get(key) ?? fallback);
  const set = async (key, value) => {
    if (fault === 'outer-checkpoint' && !fired && key === streamlinedPurchaseKey(context)) {
      const row = await decodeStoredValue(value);
      if (!row.contribution && row.consumedIds.length > 6) { fired = true; throw Error('synthetic outer checkpoint failure'); }
    }
    memory.set(key, structuredClone(value));
  };
  const outer = createStreamlinedPurchaseJournal({ get, set });
  const route = approvedStreamlinedPurchaseRoute(plan), entries = [];
  for (const [groupIndex, group] of route.groups.entries()) {
    if (group.source === 'inventory') for (const item of group.items.slice(0, group.quantity)) entries.push({
      key: `stock:${item.id}`, source: 'inventory', groupIndex, definitionId: item.definitionId, itemId: item.id,
      pile: item.pile, executionPile: item.executionPile, price: null, cap: null, tradeId: null, state: 'consumed' });
  }
  for (const [id, definitionId, price, state] of [[5, 205, 900, 'consumed'], [6, 206, 900, 'consumed'],
    [101, 201, 850, 'club'], [102, 202, 850, 'club']]) {
    const groupIndex = route.groups.findIndex(group => group.source === 'market' && group.items.some(item => item.definitionId === definitionId));
    entries.push({ key: `market:${id}`, source: 'market', groupIndex, definitionId, itemId: id,
      tradeId: String(7000 + id), price, cap: price, state });
  }
  const fulfilled = route.groups.map((_, index) => entries.filter(row => row.groupIndex === index && row.state === 'consumed').length);
  const demand = initialStreamlinedPurchaseDemand(plan, route);
  for (let index = 0; index < route.groups.length; index++) {
    const group = route.groups[index];
    demand[index] = group.source === 'inventory' ? fulfilled[index] : group.item.price === 850 ? 7 : fulfilled[index];
  }
  const record = await outer.write({ schema: 2, context, operationId: 'private-audit-original', revision: 0,
    plan, fingerprint: plan.fingerprint, challenge: plan.challenge, policy: plan.policy, route, budget: 8568, spent: 3500,
    submittedScore: 10550, consumedIds: forbiddenIds, confirmedBatches: 2, fulfilled, demand,
    contribution: null, completed: false, entries });
  f.challenge.submittedScore = 10550; f.replies.rows[0].submittedScore = 10550;
  f.replies.set.totalSubmittedScore = 10550; f.set.totalSubmittedScore = 10550;
  const prepared = await createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: {}, canWrite: () => false,
    createBuyer: async () => ({}), now });
  const initialMaterial = f.state.players.map(raw => ({ groupIndex: entries.find(row => row.itemId === raw.id).groupIndex,
    item: { ...projectFc27StreamlinedItem(f.root.factories.Item.createItem(raw), f.root, 'club'), purchaseReceipt: {
      operationId: record.operationId, itemId: raw.id, definitionId: raw.resourceId, tradeId: String(7000 + raw.id), price: 850 } } }));
  const rejectedPlan = await prepared.prepareContribution(initialMaterial, record);
  const inner = createStreamlinedJournal({ get, set, now });
  let rejection = await inner.begin(rejectedPlan);
  Object.assign(rejection.batches[0], { state: innerState, startingScore: 10550 });
  rejection = await inner.write(context, rejection, rejection.revision);
  const buyer = options => ({
    verifySquad: async () => options.verifyCurrent(),
    find: async (definitionId, cap) => {
      options.assertTarget();
      expect(f.state.players.some(raw => raw.resourceId === definitionId)).toBe(false);
      if (definitionId === 207 || fault === 'no-supply') return null;
      const price = definitionId < 205 ? 850 : 900;
      if (cap < price) return null;
      const itemId = ++serial;
      return { definitionId, itemId, tradeId: String(itemId + 10000), price };
    },
    buy: async entry => {
      expect(held && options.canWrite()).toBe(true);
      const saved = await outer.read(context);
      expect(saved.entries.find(row => row.itemId === entry.itemId).state).toBe('buy-pending');
      expect(saved.spent + entry.price).toBeLessThanOrEqual(8568);
      buys.push({ ...entry }); pending.set(entry.itemId, { ...entry });
      if (fault === 'buy-response-lost' && !fired) { fired = true; throw Error('FC27_BUY_RESPONSE_LOST'); }
      return { ...entry, status: 'bought' };
    },
    locate: async entry => f.state.players.some(raw => raw.id === entry.itemId && raw.resourceId === entry.definitionId)
      ? 'club' : pending.has(entry.itemId) ? 'purchased' : null,
    move: async entry => {
      expect(held && options.canWrite()).toBe(true); expect(pending.has(entry.itemId)).toBe(true);
      moves.push(entry.itemId); pending.delete(entry.itemId);
      f.state.players.push({ id: entry.itemId, resourceId: entry.definitionId });
      f.root.repositories.Item.club.items._collection[entry.itemId] = f.root.factories.Item.createItem({ id: entry.itemId, resourceId: entry.definitionId });
      if (fault === 'move-response-lost' && !fired) { fired = true; throw Error('FC27_BUY_MOVE_RESPONSE_LOST'); }
      return { status: 'bought' };
    }, afterPlayer: async () => {}, cancel() {},
  });
  const options = { context, get, set, now, canWrite: () => true, diagnosticLog: { record: row => events.push(row) },
    createMaintenance: async (root, options) => {
      const native = await createFc27StreamlinedPageMaintenance(root, options);
      return { ...native, apply: async (...args) => {
        if (fault === 'finalization-before' && !fired) { fired = true; throw Error('FC27_STREAMLINED_FINALIZATION_REQUIRED'); }
        const result = await native.apply(...args);
        if (fault === 'finalization-after' && !fired) { fired = true; throw Error('FC27_STREAMLINED_FINALIZATION_REQUIRED'); }
        return result;
      } };
    },
    lockManager: { request: async (name, options, task) => { held = true; try { return await task({ name, mode: options.mode }); } finally { held = false; } } },
    prices: { load: async ids => ({ references: Object.fromEntries(ids.map(id => [id, { quotes: { futbin: quote(id,
      id === 207 ? 2600 : id < 205 ? 850 : 900) } }])) }) },
    createPurchaseAdapter: (root, options) => createFc27StreamlinedPurchaseAdapter(root, { ...options, createBuyer: async (_root, callbacks) => buyer(callbacks) }),
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); expect(held).toBe(true); allAttempts.push([...target.itemIds]);
        expect(target.itemIds.some(id => forbiddenIds.includes(id))).toBe(false);
        expect(contributions.flat().some(id => target.itemIds.includes(id))).toBe(false);
        const points = target.itemIds.reduce((sum, id) => sum + (f.root.repositories.Item.club.items._collection[id]?.sbsScore ?? 0), 0);
        expect(points).toBeGreaterThan(0);
        contributions.push([...target.itemIds]);
        f.state.players = f.state.players.filter(row => !target.itemIds.includes(row.id));
        f.replies.rows[0].submittedScore += points;
        const complete = f.replies.rows[0].submittedScore >= 16000;
        if (complete) {
          f.replies.rows[0].status = 'COMPLETED'; f.replies.rows[0].timesCompleted = 1;
          f.replies.set = { ...f.set, totalSubmittedScore: f.replies.rows[0].submittedScore, timesCompleted: 1, challengesCompletedCount: 1 };
        }
        if (fault === 'contribution-response-lost' && !fired) { fired = true; throw Error('FC27_STREAMLINED_RESPONSE_LOST'); }
        if (fault === 'readback-exhausted' && !fired) {
          fired = true; f.replies.progressReplies = Array.from({ length: 3 }, () => ({ success: false, status: 500 }));
        }
        return { success: true, status: 200, response: { setId: 31, challengeId: 61,
          submittedScore: f.replies.rows[0].submittedScore, grantedChallengeAwards: complete ? [{ type: 'pack' }] : [] } };
      } }) }) };
  const execution = () => createFc27StreamlinedExecution(f.root, options);
  return { f, context, memory, outer, inner, plan, execution, buys, moves, contributions, allAttempts, fault, events,
    report: () => ({ score: f.replies.rows[0].submittedScore, buys: buys.length, spentNew: buys.reduce((sum, row) => sum + row.price, 0),
      moves: moves.length, contributedIds: contributions.flat(), held }) };
}

it('replays the incident-shaped recovery, buys the remaining five cards, completes, reloads, and never repeats a write', async () => {
  const f = await fixture();
  const initial = f.report();
  let execution = await f.execution();
  expect(await finishNativeIo(execution.recoverPurchase(f.plan.challenge))).toMatchObject({ status: 'recovered' });
  expect(f.report()).toEqual(initial);
  const result = await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }));
  expect(result, JSON.stringify({ status: result.status, reason: result.reason, score: result.record?.submittedScore, report: f.report(), events: f.events.filter(row => row.event === 'contribution-transaction') })).toMatchObject({
    status: 'completed', record: { spent: 7750, submittedScore: 16360, completed: true } });
  expect(f.buys).toHaveLength(5); expect(f.moves).toHaveLength(5);
  expect(f.contributions.flat()).toHaveLength(7);
  expect(new Set(f.contributions.flat()).size).toBe(7);
  expect(f.contributions.flat()).toEqual(expect.arrayContaining([101, 102]));
  const final = f.report(); execution = await f.execution();
  expect(await finishNativeIo(execution.recoverPurchase(f.plan.challenge))).toMatchObject({ status: 'completed' });
  expect(await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 })))
    .toMatchObject({ status: 'completed' });
  expect(f.report()).toEqual(final); expect(final.held).toBe(false);
  console.log('WHOLE_FLOW_AUDIT', JSON.stringify(final));
});

it.each(['buy-response-lost', 'move-response-lost', 'readback-exhausted', 'finalization-before', 'finalization-after', 'outer-checkpoint'])(
  'recovers %s then completes without repeating purchases, moves or confirmed contributions', async fault => {
    const f = await fixture({ fault }); let execution = await f.execution();
    const failed = await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }));
    expect(failed.status).not.toBe('completed');
    const before = f.report(); execution = await f.execution();
    const recovery = await finishNativeIo(execution.recoverPurchase(f.plan.challenge));
    expect(recovery, JSON.stringify({ status: recovery.status, reason: recovery.reason, fault })).toMatchObject({ status: 'recovered' });
    expect(f.report()).toEqual(before);
    const result = await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }));
    expect(result, JSON.stringify({ status: result.status, reason: result.reason, fault, report: f.report() }))
      .toMatchObject({ status: 'completed', record: { spent: 7750, submittedScore: 16360 } });
    expect(f.buys).toHaveLength(5); expect(f.moves).toHaveLength(5);
    expect(new Set(f.moves).size).toBe(5);
    expect(f.contributions.flat()).toHaveLength(7); expect(new Set(f.contributions.flat()).size).toBe(7);
    expect(f.contributions.flat().some(id => [1, 2, 3, 4, 5, 6].includes(id))).toBe(false);
  });

it('keeps an actually committed contribution with a lost response unresolved instead of resending', async () => {
  const f = await fixture({ fault: 'contribution-response-lost' }); let execution = await f.execution();
  const failed = await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }));
  expect(failed.status).toBe('recovery-required'); const before = f.report();
  for (let index = 0; index < 3; index++) {
    execution = await f.execution();
    expect((await finishNativeIo(execution.recoverPurchase(f.plan.challenge))).status).toBe('recovery-required');
    expect((await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }))).status)
      .toBe('recovery-required');
    expect(f.report()).toEqual(before);
  }
  expect(before.buys).toBe(2); expect(before.contributedIds).toHaveLength(4);
});

it('contributes already acquired cards then pauses truthfully when the approved market pool has no supply', async () => {
  const f = await fixture({ fault: 'no-supply' }), execution = await f.execution();
  const result = await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }));
  expect(result).toMatchObject({ status: 'paused', reason: 'FC27_STREAMLINED_PURCHASE_NO_SUPPLY', record: { spent: 3500, submittedScore: 12210 } });
  expect(f.buys).toHaveLength(0); expect(f.contributions.flat()).toEqual([101, 102]);
});

it.each(['pending', 'unknown'])('does not fold an unresolved %s wave into a larger new batch', async innerState => {
  const f = await fixture({ innerState }), execution = await f.execution();
  const before = f.report();
  expect((await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }))).status)
    .toBe('recovery-required');
  expect(f.report()).toEqual(before);
  expect((await f.inner.read(f.context)).batches[0].state).toBe(innerState);
});

it('stops after a purchase checkpoint, then resumes the same acquired entity without rebuying', async () => {
  const f = await fixture(); let execution = await f.execution(), stopped = false;
  const result = await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }, {
    onProgress: row => { if (row.phase === 'moving' && !stopped) { stopped = true; execution.stop(); } },
  }));
  expect(result.status).toBe('stopped'); expect(f.buys).toHaveLength(1); expect(f.moves).toHaveLength(0);
  const before = f.report(); execution = await f.execution();
  expect((await finishNativeIo(execution.recoverPurchase(f.plan.challenge))).status).toBe('recovered');
  expect(f.report()).toEqual(before);
  const complete = await finishNativeIo(execution.purchase(f.plan, { approved: true, fingerprint: f.plan.fingerprint, budget: 8568 }));
  expect(complete).toMatchObject({ status: 'completed', record: { spent: 7750, submittedScore: 16360 } });
  expect(f.buys).toHaveLength(5); expect(new Set(f.buys.map(row => row.itemId)).size).toBe(5);
  expect(f.moves).toHaveLength(5); expect(new Set(f.contributions.flat()).size).toBe(7);
});
