// Synthetic native responses; production buyer, journals, provider and transaction.
import { afterEach, expect, it, vi } from 'vitest';
import { priceTiers } from '../fixtures/enhancer-listing-price-reference.js';
import { streamlinedRuntime } from '../helpers/fc27-streamlined-runtime.js';
import { safeItem } from '../helpers/streamlined.js';
import { createFc27StreamlinedExecution } from '../../src/adapters/browser/fc27-streamlined-execution.js';
import { createFc27StreamlinedProvider } from '../../src/adapters/ea/fc27-streamlined-provider.js';
import { createFc27StreamlinedReconciler } from '../../src/adapters/ea/fc27-streamlined-reconciliation.js';
import { createFc27StreamlinedPurchaseAdapter } from '../../src/adapters/ea/fc27-streamlined-purchase.js';
import { createFc27PuzzleBuyAdapter, FC27_BUY_SERVICE_METHODS } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { createStreamlinedProcurement } from '../../src/streamlined/procurement.js';
import { createStreamlinedPurchaseJournal } from '../../src/streamlined/purchase-journal.js';
import { streamlinedJournalKey } from '../../src/streamlined/journal.js';

import { createFc27StreamlinedPageMaintenance } from '../../src/adapters/ea/fc27-streamlined-page.js';
import { createStreamlinedPlan } from '../../src/streamlined/plan.js';

import { decodeStoredValue } from '../../src/runtime/compact-storage.js';

afterEach(() => vi.useRealTimers());
const copy = value => structuredClone(value);
const barrier = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const locks = { request: async (name, options, task) => task({ name, mode: options.mode }) };
const marketPlan = f => {
  const market = { ...safeItem({ id: null, source: 'market', definitionId: 901, rating: 60, price: 200, purchaseMaxBuy: 200,
    quote: { source: 'futbin', definitionId: 901, price: 200, fetchedAt: 1, expiresAt: 100000 } }), purchaseMaxBuy: 200 };
  return { context: f.plan.context, challenge: { ...f.plan.challenge, targetScore: 20, remainingScore: 20 }, policy: f.plan.policy,
    items: [market], route: { groups: [{ source: 'market', quantity: 1, item: market, items: [market] }] } };
};
const canonicalMarketPlan = f => {
  const p = marketPlan(f); return createStreamlinedPlan({ context: p.context, challenge: p.challenge, policy: p.policy, result: {
    status: 'ready', items: p.items, batches: [p.items], route: p.route, score: 20, purchaseCost: 200, materialValue: 0, searchComplete: true,
    progress: { target: 20, submitted: 0, added: 20, total: 20, remaining: 0, excess: 0, reached: true } } });
};
const approval = plan => ({ approved: true, fingerprint: plan.fingerprint ?? JSON.stringify(plan), budget: 200, attempts: 2, expiresAt: 100000 });

it.each([[500, null], [503, null], [403, 'ids'], [500, 'ids'], [400, 'malformed']])(
  'retains an ambiguous bid intent for status %s and evidence %s without replacement spending', async (status, evidence) => {
  const f = streamlinedRuntime({ targetScore: 20 }), plan = canonicalMarketPlan(f), memory = new Map();
  const journal = createStreamlinedPurchaseJournal({ get: (key, fallback) => copy(memory.get(key) ?? fallback), set: (key, value) => memory.set(key, copy(value)) });
  const bids = [], owned = [], events = []; let driver;
  const observable = reply => ({ observe(_owner, cb) { cb(this, reply); }, unobserve() {} });
  const cards = [801, 802].map(id => ({ ...f.root.factories.Item.createItem({ id, resourceId: 901 }),
    getAuctionData: () => ({ tradeId: String(id + 1000), buyNowPrice: 200, canBuy: () => true, getSecondsRemaining: () => 60 }) }));
  class ItemService {
    clearTransferMarketCache() {}
    requestUnassignedItems() { return observable({ success: true, status: 200, response: { items: owned } }); }
    searchTransferMarket() { return observable({ success: true, status: 200, data: { items: cards.filter(card => !owned.includes(card)) } }); }
    bid(card, price) {
      bids.push({ itemId: card.id, price }); owned.push(card); // server commits before the response fault
      if (bids.length === 1) return observable({ success: false, status, ...(evidence ? { data: { itemIds: evidence === 'malformed' ? {} : [card.id] } } : {}) });
      driver.stop(); return observable({ success: true, status: 200, data: { itemIds: [card.id] } });
    }
    move() { throw Error('unexpected move'); }
  }
  const digest = f.root.crypto.subtle.digest, hashes = new Map(FC27_BUY_SERVICE_METHODS.map(([key, hash]) => [String(ItemService.prototype[key]).replace(/\r\n/g, '\n'), hash]));
  f.root.crypto.subtle.digest = async (algorithm, bytes) => {
    const hash = hashes.get(new TextDecoder().decode(bytes).replace(/\r\n/g, '\n'));
    return hash ? Uint8Array.from(Buffer.from(hash, 'hex')).buffer : digest(algorithm, bytes);
  };
  Object.assign(f.root, { MAX_NEW_ITEMS: 100, GameCurrency: { COINS: 'COINS' }, SearchType: { PLAYER: 'player' }, SearchCategory: { ANY: 'any' },
    ItemSearchFeature: { MARKET: 'market' }, UTSearchCriteriaDTO: class {},
    UTBucketedItemSearchViewModel: class { defaultSearchCriteria = {}; updateSearchCriteria(criteria) { this.searchCriteria = { ...criteria }; } },
    UTCurrencyInputControl: { PRICE_TIERS: priceTiers, getIncrementAboveVal: n => n + 50, getIncrementBelowVal: n => n - 50 },
    PINEventType: { PAGE_VIEW: 1 }, PIN_PAGEVIEW_EVT_TYPE: 1, UtasErrorCode: { PERMISSION_DENIED: 461 } });
  f.root.ItemPile.PURCHASED = 6; f.root.services.Item = new ItemService();
  f.root.services.PIN = { sendData() {} }; f.root.services.User.getUser = () => ({ getCurrency: () => ({ amount: 10000 }) });
  f.root.repositories.Item.numItemsInCache = () => owned.length; f.root.repositories.Item.setDirty = () => {};
  const createAdapter = () => createFc27StreamlinedPurchaseAdapter(f.root, { plan, persistence: { inspect: () => ({ active: true }) }, canWrite: () => true,
    now: () => 1000, onEvent: row => events.push(row), createBuyer: (root, options) => createFc27PuzzleBuyAdapter(root, { ...options, wait: async () => {} }) });
  driver = createStreamlinedProcurement({ journal, lock: { acquire: async () => () => {} }, adapter: await createAdapter(), operationId: () => 'fault-bid', now: () => 1000 });
  const result = await driver.execute(plan, approval(plan));
  console.info('F1_EVIDENCE', JSON.stringify({ status: result.status, reason: result.reason, bids, actualSpend: bids.reduce((s, b) => s + b.price, 0),
    durableSpend: (await journal.read(plan.context))?.spent, budget: result.record?.budget, entries: result.record?.entries.map(e => ({ itemId: e.itemId, state: e.state })), bidEvents: events.filter(e => e.stage === 'bid') }));
  expect(bids).toHaveLength(1);
  expect(result.record.entries).toMatchObject([{ state: 'buy-pending' }]);
  const fresh = createStreamlinedProcurement({ journal, lock: { acquire: async () => () => {} }, adapter: await createAdapter(), operationId: () => 'read-only', now: () => 1000 });
  const recovered = await fresh.execute(plan, null, { reconcileOnly: true });
  expect(recovered).toMatchObject({ status: 'recovered', record: { spent: 200, budget: 200, entries: [{ state: 'bought' }] } });
  expect(bids).toHaveLength(1);
});

it('F2a: Stop during asynchronous purchase adapter construction must survive driver creation', async () => {
  const f = streamlinedRuntime({ targetScore: 20 }), plan = canonicalMarketPlan(f), memory = new Map(), entered = barrier(), proceed = barrier();
  const counts = { buy: 0, move: 0, contribution: 0 }; f.root.crypto.randomUUID = () => 'stop-construction';
  const row = safeItem({ id: 801, definitionId: 901 });
  const synthetic = { assertCurrent: async () => {}, readState: async record => ({ submittedScore: record.submittedScore, freeSlots: 30, heldDefinitions: [] }),
    find: async () => ({ itemId: 801, definitionId: 901, tradeId: '1801', price: 200 }), buy: async entry => { counts.buy++; return { ...entry, status: 'bought' }; },
    move: async () => { counts.move++; }, locate: async () => 'club', materialize: async entries => entries.map(e => ({ groupIndex: e.groupIndex, item: row })),
    prepareContribution: async material => ({ material }), contribute: async () => { counts.contribution++; return { confirmed: true, submittedScore: 20 }; }, cancel() {} };
  const execution = await createFc27StreamlinedExecution(f.root, { context: plan.context, now: () => 1000, canWrite: () => true,
    get: (key, fallback) => copy(memory.get(key) ?? fallback), set: (key, value) => memory.set(key, copy(value)), lockManager: locks,
    createPurchaseAdapter: async () => { entered.resolve(); await proceed.promise; return synthetic; } });
  const pending = execution.purchase(plan, approval(plan)); await entered.promise;
  execution.stop(); proceed.resolve(); const result = await pending;
  console.info('F2a_EVIDENCE', JSON.stringify({ status: result.status, reason: result.reason, counts, spent: result.record?.spent, score: result.record?.submittedScore }));
  expect(result.reason).not.toBe('FC27_STREAMLINED_PURCHASE_JOURNAL_INVALID'); expect(counts.buy).toBe(0);
});

async function nativeContribution({ mode = 'none', reset = false, purchase = false, targetScore = 100 } = {}) {
  const f = streamlinedRuntime({ targetScore }), memory = new Map(), entered = barrier(), proceed = barrier();
  f.replies.rows[0].submittedScore = 0;
  f.root.ItemPile.PURCHASED = 6; f.root.MAX_NEW_ITEMS = 100; f.root.repositories.Item.numItemsInCache = () => 0; f.root.crypto.randomUUID = () => 'outer-audit';
  let fault = mode, writes = 0, failRead = false, heldDuringSend = false, execution;
  const get = async (key, fallback) => { if (failRead) { failRead = false; throw Error('one transient storage read failure'); } return copy(memory.get(key) ?? fallback); };
  const set = async (key, value) => {
    const decoded = await decodeStoredValue(value), batch = decoded?.batches?.[0];
    if (fault === 'confirmed-write' && batch?.state === 'confirmed') { fault = 'none'; throw Error('one transient final checkpoint write failure'); }
    if (fault === 'receipt-write-always' && batch?.receipt) throw Error('persistent synthetic receipt storage failure');
    if (fault === 'receipt-write' && batch?.receipt) { fault = 'none'; throw Error('one transient storage write failure'); }
    if (fault === 'outer-write' && decoded?.consumedIds?.length > 0 && !decoded.contribution) { fault = 'none'; throw Error('one transient outer write failure'); }
    memory.set(key, copy(value));
    if (fault === 'intent-stop' && batch?.state === 'pending' && !batch.receipt) { fault = 'none'; entered.resolve(); await proceed.promise; }
    if (fault === 'receipt-readback' && batch?.receipt) { fault = 'none'; failRead = true; }
    if (fault === 'outer-checkpoint' && decoded?.completed) { fault = 'none'; throw Error('outer checkpoint'); }
  };
  const create = () => createFc27StreamlinedExecution(f.root, { context: f.plan.context, now: () => 1000, get, set, canWrite: () => true, lockManager: locks,
    ...(purchase ? { createPurchaseAdapter: (root, options) => createFc27StreamlinedPurchaseAdapter(root, { ...options, createBuyer: purchase === 'native' ? (root, options) => createFc27PuzzleBuyAdapter(root, { ...options, wait: async () => {} }) : async () => ({ verifySquad() {}, cancel() {} }) }) } : {}),
    createMaintenance: async (root, options) => {
      const raw = await createFc27StreamlinedPageMaintenance(root, options);
      return { ...raw, apply: async (...args) => { const result = await raw.apply(...args); if (fault === 'finalization') { fault = 'none'; throw Error('FC27_STREAMLINED_FINALIZATION_REQUIRED'); } return result; } };
    },
    createProvider: (root, options) => createFc27StreamlinedProvider(root, { ...options,
      createReconciler: (root, options) => {
        const raw = createFc27StreamlinedReconciler(root, options);
        return { reconcile: async (...args) => { if (fault === 'readback') { fault = 'none'; throw Error('FC27_STREAMLINED_PROGRESS_READ_FAILED'); } return raw.reconcile(...args); } };
      },
      createTransport: async () => ({ request: async (_action, target, before) => {
        await before(); heldDuringSend = true; writes++;
        if (fault === 'second-rejected' && writes === 2) { fault = 'none'; return { success: false, status: 401 }; }
        const score = f.replies.rows[0].submittedScore + target.itemIds.length * 20;
        const completed = score >= f.plan.challenge.targetScore;
        f.state.players = f.state.players.filter(item => !target.itemIds.includes(item.id));
        Object.assign(f.replies.rows[0], { submittedScore: reset ? 0 : score, status: reset ? 'NOT_STARTED' : completed ? 'COMPLETED' : 'IN_PROGRESS',
          timesCompleted: (f.replies.rows[0].timesCompleted ?? 0) + Number(completed) });
        Object.assign(f.replies.set, { totalSubmittedScore: reset ? 0 : score, timesCompleted: f.replies.rows[0].timesCompleted, challengesCompletedCount: reset ? 0 : Number(completed) });
        return { success: true, status: 200, response: { setId: 31, challengeId: 61, submittedScore: score, grantedChallengeAwards: completed ? [{}] : [] } };
      } }) }) });
  execution = await create(); execution.prepare(f.plan);
  const run = () => execution.transaction.execute(f.plan, { approved: true, fingerprint: f.plan.fingerprint, batchIndices: [0], allowPartial: true });
  return { f, memory, get, set, create, run, execution, entered, proceed, writes: () => writes,
    stored: async () => decodeStoredValue(memory.get(streamlinedJournalKey(f.plan.context))) };
}

it('F2b: Stop after pending persistence but before transport dispatch must not consume cards', async () => {
  const h = await nativeContribution({ mode: 'intent-stop' });
  const pending = h.run(); await h.entered.promise; h.execution.stop(); h.proceed.resolve(); const result = await pending;
  console.info('F2b_EVIDENCE', JSON.stringify({ status: result.status, writes: h.writes(), batch: (await h.stored()).batches[0].state, score: result.record?.submittedScore }));
  expect(h.writes()).toBe(0);
});

it('F3: a one-off accepted-receipt storage failure must retain a completion recovery path', async () => {
  const h = await nativeContribution({ mode: 'receipt-write' }); const first = await h.run(), before = await h.stored();
  const outcomes = [];
  for (let i = 0; i < 2; i++) { const fresh = await h.create(); const callCount = h.f.calls.length; const recovery = await fresh.transaction.recover(h.f.plan.context);
    outcomes.push({ status: recovery.status, reason: recovery.reason, reads: h.f.calls.length - callCount }); }
  console.info('F3_EVIDENCE', JSON.stringify({ first: { status: first.status, reason: first.reason }, persisted: { state: before.batches[0].state, hasReceipt: !!before.batches[0].receipt },
    outcomes, writes: h.writes(), serverScore: h.f.replies.rows[0].submittedScore, serverItemsRemaining: h.f.state.players.filter(p => h.f.selected.some(s => s.id === p.id)).length }));
  expect(first.status).toBe('completed'); expect(before.batches[0].receipt.status).toBe('accepted');
  expect(outcomes.every(row => row.status === 'observed')).toBe(true); expect(h.writes()).toBe(1);
});

it('keeps a permanently unstored accepted receipt unresolved and never resends the contribution', async () => {
  const h = await nativeContribution({ mode: 'receipt-write-always' });
  const result = await h.run(); expect(result.status).not.toBe('completed');
  for (let i = 0; i < 3; i++) {
    const fresh = await h.create();
    expect(await fresh.transaction.recover(h.f.plan.context)).toMatchObject({ status: 'recovery-required', reason: 'FC27_STREAMLINED_RECEIPT_REQUIRED' });
    expect(h.writes()).toBe(1);
  }
});
