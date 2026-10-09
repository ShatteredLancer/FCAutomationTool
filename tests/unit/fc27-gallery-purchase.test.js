import { expect, it, vi } from 'vitest';
import { createGalleryPurchaseSession, galleryPurchaseKey, galleryPurchasePendingKey } from '../../src/gallery/purchase-session.js';
import { createPurchasePriceApproval } from '../../src/fc27/purchase-price-approval.js';
import { priceTiers } from '../fixtures/enhancer-listing-price-reference.js';

function fixture() {
  const store = new Map(), calls = [], locations = new Map(), collected = new Map([[10, false], [11, false]]);
  const context = { season: '27', accountScope: 'fixture', platform: 'pc:fixture' };
  const control = { current: true, buy: null, move: null, quote: null, writeFailure: false, stop: false };
  const adapter = {
    verifySquad: vi.fn(), verifyCurrent: vi.fn(),
    collectionState: async id => collected.get(id),
    find: async definitionId => { calls.push(['find', definitionId]); return control.quote?.(definitionId) ?? { definitionId, itemId: definitionId + 100, tradeId: String(definitionId + 1000), price: 200 }; },
    buy: async entry => { calls.push(['buy', entry.definitionId]); const reply = control.buy?.(entry); if (reply) return reply; locations.set(entry.itemId, 'purchased'); return { ...entry, status: 'bought' }; },
    move: async entry => { calls.push(['move', entry.definitionId]); const reply = control.move?.(entry); if (reply) return reply; locations.set(entry.itemId, 'club'); },
    locate: async (entry, options) => locations.get(entry.itemId) ?? (options?.allowAbsent ? 'absent' : 'unknown'), afterPlayer: vi.fn(), cancel: vi.fn(),
    confirmCollection: async ids => ({ status: 'confirmed', ids }),
  };
  const args = { scope: 'fixture-scope', context, get: key => store.get(key) ?? null,
    set: (key, value) => { if (control.writeFailure) throw Error('storage unavailable'); store.set(key, structuredClone(value)); },
    exclusive: async (_scope, task) => task(), createAdapter: async () => adapter, operationId: () => 'test-operation',
    assertCurrent: () => { if (!control.current) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); }, shouldStop: () => control.stop };
  const input = { items: [{ eaId: 10 }, { eaId: 11 }], binding: 'revision-fixture', approved: true };
  return { args, adapter, store, calls, control, locations, collected, input, create: () => createGalleryPurchaseSession(args) };
}

it.each(['club', 'unassigned'])('settles a legacy confirmed %s purchase no longer held without rebuying or claiming its current location', async destination => {
  const f = fixture(); f.args.readDestination = async () => destination;
  const input = { ...f.input, items: [{ eaId: 10 }] };
  f.store.set(galleryPurchaseKey(f.args.scope), { schema: 1, scope: f.args.scope, context: f.args.context,
    operationId: 'test-operation', binding: input.binding, budget: null, destination,
    plan: [{ definitionId: 10, name: '' }],
    entries: [{ definitionId: 10, itemId: 110, tradeId: '1010', price: 200, state: 'bought' }] });
  f.store.set(galleryPurchasePendingKey(f.args.scope), { schema: 1, operationId: 'test-operation' });
  expect(await f.create().execute({ approved: true, resume: true, expectedOperationId: 'test-operation' }))
    .toMatchObject({ status: 'purchased', purchased: 1, completed: 1, spent: 200, destination });
  expect(f.calls).toEqual([]);
  expect(f.store.get(galleryPurchaseKey(f.args.scope)).entries[0].state).toBe(destination === 'club' ? 'acquired' : 'unassigned');
  expect(f.store.get(galleryPurchasePendingKey(f.args.scope))).toBeNull();
});

it('does not lock the next batch when Club delivery completed but Gallery scoring is pending', async () => {
  const f = fixture(); f.adapter.confirmCollection = async () => ({ status: 'pending', confirmed: 0 });
  expect(await f.create().execute(f.input)).toMatchObject({ status: 'purchased', completed: 2 });
  expect(f.store.get(galleryPurchasePendingKey(f.args.scope))).toBeNull();
  expect(await f.create().execute({ ...f.input, binding: 'next-plan' }))
    .toMatchObject({ status: 'purchased', spent: 0 });
  expect(f.calls.filter(([kind]) => kind === 'buy')).toHaveLength(2);
});

it('projects legacy Unassigned recovery read-only, and settles it durably before starting a changed plan', async () => {
  const f = fixture(); f.args.readDestination = async () => 'unassigned';
  await f.create().execute(f.input);
  const key = galleryPurchaseKey(f.args.scope), marker = galleryPurchasePendingKey(f.args.scope);
  const saved = f.store.get(key); saved.entries[0].state = 'bought';
  f.store.set(marker, { schema: 1, operationId: saved.operationId });
  const before = structuredClone([...f.store]);
  expect(await f.create().inspect()).toMatchObject({ recovery: false, completed: 2 });
  expect([...f.store]).toEqual(before);
  f.args.readDestination = async () => 'club';
  expect(await f.create().execute({ ...f.input, binding: 'new-plan' }))
    .toMatchObject({ status: 'purchased', destination: 'club', spent: 0 });
  expect(f.calls.filter(([kind]) => kind === 'buy')).toHaveLength(2);
  expect(f.store.get(`${key}:test-operation`).entries[0].state).toBe('unassigned');
  expect(f.store.get(marker)).toBeNull();
});
it('buys exact versions, moves then confirms collection independently, and repeats with zero mutations', async () => {
  const f = fixture(); expect(await f.create().execute(f.input)).toMatchObject({ status: 'purchased', spent: 400, purchased: 2, completed: 2, collection: { status: 'confirmed' } });
  expect(f.calls).toEqual([['find',10],['buy',10],['move',10],['find',11],['buy',11],['move',11]]);
  await f.create().execute(f.input); expect(f.calls).toHaveLength(6);
});

it('freezes Fodder attempt options across stop/resume without changing default policy or raising the approved ceiling', async () => {
  const f = fixture(), at = Date.now(), caps = [];
  const references = Object.fromEntries([10,11].map(definitionId => [definitionId, { definitionId, season: '27', platform: 'pc',
    quotes: Object.fromEntries(['futgg','futbin'].map(source => [source, { schema: 2, source, definitionId, season: '27', platform: 'pc',
      price: 1000, fetchedAt: at, expiresAt: at + 60000, sourceUpdatedAt: null, error: null }])) }]));
  f.args.preparePrices = async () => createPurchasePriceApproval({ scope: f.args.scope, season: '27', platform: 'pc',
    definitionIds: [10,11], references, policy: { source: 'futgg', premiumMode: 'fixed', premium: 0, purchaseAttempts: 5 }, now: at });
  f.adapter.priceContext = async () => ({ priceTiers, balance: 10000 });
  f.adapter.find = async (definitionId, cap) => { caps.push([definitionId, cap]); f.control.stop = caps.length === 1;
    return { unavailable: true, reason: 'FC27_BUY_NO_LISTING' }; };
  const input = { ...f.input, batchOptions: { minPct: 75, maxPct: 125, tries: 3 } };
  expect(await f.create().execute(input)).toMatchObject({ status: 'partial', reason: 'FC27_GALLERY_PURCHASE_STOPPED' });
  f.control.stop = false;
  await f.create().execute({ ...f.input, resume: true, expectedOperationId: 'test-operation', batchOptions: { minPct: 200, maxPct: 200, tries: 1 } });
  expect(caps).toEqual([[10,750],[10,1000],[10,1000],[11,750],[11,1000],[11,1000]]);
  const saved = f.store.get(galleryPurchaseKey(f.args.scope));
  expect(saved.batchOptions).toEqual(input.batchOptions);
  expect(saved.priceApproval.policy.purchaseAttempts).toBe(5);
  expect(saved.attempts[10]).toMatchObject({ limit: 3, used: 3, failed: true });
});

it('leaves exact bought items in Unassigned without moving or claiming collection; repeats do not rebuy', async () => {
  const f = fixture(); f.args.readDestination = async () => 'unassigned';
  f.adapter.confirmCollection = async () => ({ status: 'pending', confirmed: 0 });
  expect(await f.create().execute(f.input)).toMatchObject({ status: 'purchased', completed: 2, purchased: 2, spent: 400,
    destination: 'unassigned', collection: { status: 'pending' } });
  expect(f.calls).toEqual([['find',10],['buy',10],['find',11],['buy',11]]);
  expect(f.store.get(galleryPurchasePendingKey(f.args.scope))).toBeNull();
  f.args.readDestination = async () => 'club';
  await f.create().execute(f.input); expect(f.calls).toHaveLength(4);
});
it('freezes destination for interrupted recovery and checks the exact purchased item before completion', async () => {
  const f = fixture(); f.args.readDestination = async () => 'unassigned'; f.control.buy = () => ({ status: 'unknown' });
  expect((await f.create().execute(f.input)).status).toBe('recovery-required');
  f.args.readDestination = async () => 'club'; f.locations.set(110, 'purchased'); f.control.buy = null;
  expect(await f.create().execute(f.input)).toMatchObject({ status: 'purchased', destination: 'unassigned', spent: 400 });
  expect(f.calls).toEqual([['find',10],['buy',10],['find',11],['buy',11]]);
  const absent = fixture(); absent.args.readDestination = async () => 'unassigned';
  absent.adapter.locate = async () => 'unknown';
  expect((await absent.create().execute(absent.input)).status).toBe('purchased');
  expect(absent.calls).toEqual([['find',10],['buy',10],['find',11],['buy',11]]);
});

it('runs accounting only after durable purchase writes and never repeats a buy because accounting failed', async () => {
  const f = fixture();
  f.args.onPurchaseRecord = vi.fn(async record => {
    expect(f.store.get(galleryPurchaseKey(f.args.scope))).toEqual(record);
    throw Error('offline ledger');
  });
  expect(await f.create().execute(f.input)).toMatchObject({ status: 'purchased', spent: 400,
    accountingWarning: 'FC27_GALLERY_ACCOUNTING_UNAVAILABLE' });
  expect(f.args.onPurchaseRecord).toHaveBeenCalled();
  await f.create().execute(f.input);
  expect(f.calls.filter(([name]) => name === 'buy')).toHaveLength(2);
});
it('skips already collected versions without rebuying and keeps unknown state blocked', async () => {
  const f = fixture(); f.collected.set(10, true); expect(await f.create().execute(f.input)).toMatchObject({ status: 'purchased', spent: 200, completed: 2 });
  expect((await f.create().inspect()).status).toBe('observed'); expect(f.calls.filter(([name]) => name === 'buy')).toEqual([['buy',11]]);
  const unknown = fixture(); unknown.collected.set(10, null); expect((await unknown.create().execute(unknown.input)).reason).toBe('FC27_GALLERY_COLLECTION_UNCONFIRMED'); expect(unknown.calls).toEqual([]);
});
it.each([401,403,429])('continues explicit %i single-card buy rejection like FSU', async status => {
  const f = fixture(); f.control.buy = entry => entry.definitionId === 10 ? { status: 'rejected', reason: 'FC27_BUY_REJECTED', httpStatus: status } : null;
  expect(await f.create().execute(f.input)).toMatchObject({ status: 'partial', spent: 200, purchased: 1 });
  expect(f.calls.filter(([name]) => name === 'buy')).toEqual([['buy',10],['buy',11]]);
});
it('continues unavailable search and applies the explicit total budget without using estimates as ceilings', async () => {
  const f = fixture(); f.control.quote = id => id === 10 ? { unavailable: true, reason: 'FC27_BUY_NO_LISTING' } : null;
  expect(await f.create().execute(f.input)).toMatchObject({ status: 'partial', spent: 200 });
  const limited = fixture(); expect(await limited.create().execute({ ...limited.input, budget: 200 })).toMatchObject({ status: 'partial', spent: 200 });
  expect(limited.calls.filter(([name]) => name === 'buy')).toEqual([['buy',10]]);
});
it('records the actual rejected-budget quote for local replanning without bidding', async () => {
  const f = fixture(); f.control.quote = definitionId => ({ definitionId, itemId: definitionId + 100,
    tradeId: String(definitionId + 1000), price: definitionId === 10 ? 200 : 600 });
  const outcome = await f.create().execute({ ...f.input, budget: 500 });
  expect(outcome).toMatchObject({ status: 'partial', spent: 200, collection: { status: 'confirmed' },
    failures: [{ definitionId: 11, reason: 'FC27_GALLERY_BUDGET_EXCEEDED', observedPrice: 600 }] });
  expect(f.calls).toEqual([['find',10],['buy',10],['move',10],['find',11]]);
  expect(f.store.get(galleryPurchaseKey(f.args.scope)).lastResult.failures[0].observedPrice).toBe(600);
});
it('retains unknown bid receipt and forbids rebuy after reload until exact location is confirmed', async () => {
  const f = fixture(); f.control.buy = () => ({ status: 'unknown' });
  expect((await f.create().execute(f.input)).status).toBe('recovery-required');
  expect(f.store.get(galleryPurchasePendingKey(f.args.scope))).not.toBeNull();
  await f.create().execute(f.input); expect(f.calls.filter(([name]) => name === 'buy')).toHaveLength(1);
  f.locations.set(110, 'club'); f.control.buy = null; expect(await f.create().execute(f.input)).toMatchObject({ status: 'purchased', spent: 400 });
  expect(f.calls.filter(([name]) => name === 'buy')).toEqual([['buy',10],['buy',11]]);
});
it('keeps move rejection recoverable while continuing other cards', async () => {
  const f = fixture(); f.control.move = entry => entry.definitionId === 10 ? { status: 'rejected', reason: 'FC27_BUY_MOVE_REJECTED' } : null;
  expect(await f.create().execute(f.input)).toMatchObject({ status: 'recovery-required', spent: 400, purchased: 2 });
  f.control.move = null; expect((await f.create().execute(f.input)).status).toBe('purchased');
  expect(f.calls.filter(([name]) => name === 'buy')).toHaveLength(2);
});
it('blocks different plans while a transaction is unresolved and preserves all receipts', async () => {
  const f = fixture(); f.control.buy = () => ({ status: 'unknown' }); await f.create().execute(f.input);
  const before = structuredClone(f.store.get(galleryPurchaseKey(f.args.scope)));
  expect((await f.create().execute({ ...f.input, binding: 'different' })).reason).toBe('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
  expect(f.store.get(galleryPurchaseKey(f.args.scope))).toEqual(before);
});
it('does not dispatch without approval, persistence, lock or current account', async () => {
  for (const kind of ['approval','persistence','lock','account']) {
    const f = fixture(); if (kind === 'persistence') f.control.writeFailure = true; if (kind === 'lock') f.args.exclusive = async () => null; if (kind === 'account') f.control.current = false;
    await f.create().execute({ ...f.input, approved: kind !== 'approval' }); expect(f.calls).toEqual([]);
  }
});
it('stops before spending, rejects wrong receipt, and does not treat collection failure as purchase failure', async () => {
  const f = fixture(); f.control.stop = true; expect(await f.create().execute(f.input)).toMatchObject({ status: 'partial', spent: 0 }); expect(f.calls).toEqual([]);
  const wrong = fixture(); wrong.control.buy = entry => ({ ...entry, status: 'bought', itemId: 999 }); expect((await wrong.create().execute(wrong.input)).status).toBe('recovery-required');
  const sync = fixture(); sync.adapter.confirmCollection = async () => ({ status: 'pending' }); expect(await sync.create().execute(sync.input)).toMatchObject({ status: 'purchased', collection: { status: 'pending' }, spent: 400 });
});
it('resumes the persisted exact plan without relying on stale UI candidates or prices', async () => {
  const f = fixture(); f.control.buy = () => ({ status: 'unknown' }); await f.create().execute(f.input);
  const observed = await f.create().inspect(); f.locations.set(110, 'club'); f.control.buy = null;
  expect(await f.create().execute({ resume: true, expectedOperationId: observed.operationId, approved: true })).toMatchObject({ status: 'purchased', spent: 400 });
  expect(f.calls.filter(([name]) => name === 'buy')).toHaveLength(2);
});
it.each([149,15000001])('rejects invalid %i buy-now prices before mutation', async price => {
  const f = fixture(); f.control.quote = definitionId => ({ definitionId, itemId: 110, tradeId: '1010', price });
  expect((await f.create().execute(f.input)).reason).toBe('FC27_BUY_QUOTE_UNVERIFIED'); expect(f.calls.filter(([name]) => name === 'buy')).toEqual([]);
});
it('rechecks account and stop after price search, before persisting and dispatching a buy', async () => {
  for (const kind of ['account','stop']) {
    const f = fixture(); f.adapter.find = async definitionId => {
      if (kind === 'account') f.control.current = false; else f.control.stop = true;
      return { definitionId, itemId: 110, tradeId: '1010', price: 200 };
    };
    await f.create().execute(f.input); expect(f.calls).toEqual([]);
  }
});
it('blocks corrupt journals, foreign pending transactions and keeps collection-read failure distinct', async () => {
  const corrupt = fixture(); await corrupt.create().execute(corrupt.input);
  const record = corrupt.store.get(galleryPurchaseKey(corrupt.args.scope)); record.plan[1].definitionId = 10;
  expect((await corrupt.create().inspect()).status).toBe('blocked');
  const other = fixture(); other.args.checkOtherTransactions = async () => { throw Error('FC27_BUY_RECOVERY_REQUIRED'); };
  await other.create().execute(other.input); expect(other.calls).toEqual([]);
  const failed = fixture(); failed.adapter.confirmCollection = async () => { throw Error('FC27_GALLERY_HTTP_401'); };
  expect(await failed.create().execute(failed.input)).toMatchObject({ status: 'purchased', collection: { status: 'pending' }, spent: 400 });
  await failed.create().execute(failed.input); expect(failed.calls.filter(([name]) => name === 'buy')).toHaveLength(2);
});
