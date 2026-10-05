import { expect, it, vi } from 'vitest';
import { createGalleryPurchaseSession, galleryPurchaseKey } from '../../src/gallery/purchase-session.js';
import { createFc27PuzzleBuySession, puzzleBuyKey } from '../../src/fc27/puzzle-buy-session.js';
import { createPurchasePriceApproval } from '../../src/fc27/purchase-price-approval.js';
import { priceTiers } from '../fixtures/enhancer-listing-price-reference.js';

function fixture(kind) {
  const scope = 'account', context = { season: '27', accountScope: scope, platform: 'pc' }, target = { setId: 4, challengeId: 16 };
  const data = new Map(), locations = new Map(), control = { price: 200, reference: 200, stop: false, failWrite: false };
  const plan = { context, slots: [10,11].map((definitionId, slot) => ({ slot, definitionId, kind: 'concept' })) };
  const preparePrices = vi.fn(async record => createPurchasePriceApproval({ scope, season: '27', platform: 'pc', now: 1000,
    definitionIds: record.entries.filter(e => e.state === 'waiting').map(e => e.definitionId),
    references: Object.fromEntries([10,11].map(definitionId => [definitionId, { definitionId, season: '27', platform: 'pc',
      quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, { schema: 2, source, season: '27', platform: 'pc',
        definitionId, price: source === 'futgg' ? control.reference : 250, fetchedAt: 900, sourceUpdatedAt: null, expiresAt: 300900, error: null }])) }])) }));
  const adapter = { verifySquad: vi.fn(), verifyCurrent: vi.fn(), collectionState: async () => false,
    priceContext: () => ({ balance: 10000, absoluteCap: null, priceTiers }),
    find: vi.fn(async definitionId => ({ definitionId, itemId: definitionId + 100, tradeId: String(definitionId + 1000), price: control.price })),
    buy: vi.fn(async entry => { locations.set(entry.itemId, 'purchased'); return { ...entry, status: 'bought' }; }),
    move: vi.fn(async entry => { locations.set(entry.itemId, 'club'); }), locate: async entry => locations.get(entry.itemId) ?? 'unknown',
    save: async (_record, before) => { await before(); }, confirmCollection: async () => ({ status: 'confirmed' }), cancel() {} };
  const key = kind === 'gallery' ? galleryPurchaseKey(scope) : puzzleBuyKey(scope, target);
  const deps = { scope, context, get: async (key, fallback) => structuredClone(data.get(key) ?? fallback),
    set: async (key, value) => { if (control.failWrite && value?.priceApproval) throw Error('FC27_BUY_JOURNAL_UNCONFIRMED'); data.set(key, structuredClone(value)); },
    exclusive: async (_scope, task) => task(), createAdapter: async () => adapter, assertCurrent() {},
    preparePrices, shouldStop: () => control.stop, loadDraft: async () => ({ phase: 'saved', operationId: 'test', plan }) };
  const run = options => kind === 'gallery'
    ? createGalleryPurchaseSession(deps).execute({ items: [{ eaId: 10 }, { eaId: 11 }], binding: 'plan', approved: true, ...options })
    : createFc27PuzzleBuySession(deps).execute(target, { budget: 10000, expectedOperationId: 'test', approved: true, ...options });
  return { run, control, adapter, data, key, preparePrices, locations, deps };
}
for (const kind of ['gallery', 'puzzle']) {
  it(`${kind}: reloads a completed pre-preference approval without rebuying receipts`, async () => {
    const f = fixture(kind); await f.run();
    const record = f.data.get(f.key);
    delete record.priceApproval.policy.futbinEnabled;
    delete record.priceApproval.policy.futbinRefresh;
    expect(await f.run()).toMatchObject({ status: 'purchased', spent: 400 });
    expect(f.adapter.buy).toHaveBeenCalledTimes(2);
    expect(f.data.get(f.key).priceApproval.policy).not.toHaveProperty('futbinRefresh');
  });
  it(`${kind}: rejects a 600-coin EA offer under a frozen 200 cap before any bid`, async () => {
    const f = fixture(kind); f.control.price = 600;
    expect(await f.run()).toMatchObject({ reason: 'FC27_BUY_QUOTE_UNVERIFIED', spent: 0 });
    expect(f.adapter.find).toHaveBeenCalledWith(10, 200);
    expect(f.adapter.buy).not.toHaveBeenCalled();
    expect(f.data.get(f.key).priceApproval.rows[0].maxBuy).toBe(200);
  });
  it(`${kind}: exhausted attempts stay exhausted after price/preferences rise or restart`, async () => {
    const f = fixture(kind); f.adapter.find.mockResolvedValue(null);
    await f.run(); f.control.reference = 600; f.control.price = 500;
    expect(await f.run()).toMatchObject({ status: 'partial', spent: 0 });
    expect(f.preparePrices).toHaveBeenCalledTimes(1);
    expect(f.adapter.find).toHaveBeenCalledTimes(6);
    expect(f.adapter.find.mock.calls.every(([, cap]) => cap === 200)).toBe(true);
    expect(f.adapter.buy).not.toHaveBeenCalled();
  });
  it(`${kind}: resumes a stopped batch without increasing its prior absolute search ceiling`, async () => {
    const f = fixture(kind);
    f.adapter.find.mockImplementationOnce(async () => { f.control.stop = true; return null; });
    const first = await f.run({ quoteCeiling: 150 });
    expect(first.results[0].reference.maxBuy).toBe(150);
    expect(first.results[0].attempt).toMatchObject({ used: 1, failed: false });
    expect(first.results[1].attempt).toBeNull();
    f.control.stop = false;
    expect(await f.run({ quoteCeiling: 600 })).toMatchObject({ reason: 'FC27_BUY_QUOTE_UNVERIFIED', spent: 0 });
    expect(f.adapter.find).toHaveBeenLastCalledWith(10, 150);
    expect(f.adapter.buy).not.toHaveBeenCalled();
  });
  it(`${kind}: retries a failed move by receipt, never by another purchase`, async () => {
    const f = fixture(kind); f.adapter.move.mockResolvedValueOnce({ status: 'rejected', reason: 'FC27_BUY_MOVE_REJECTED' });
    await f.run();
    expect(f.adapter.buy).toHaveBeenCalledTimes(2);
    expect(await f.run()).toMatchObject({ status: 'purchased', spent: 400 });
    expect(f.adapter.buy).toHaveBeenCalledTimes(2);
  });
  it(`${kind}: retries only a selected failed version with a new explicit cap and rejects repeated approval`, async () => {
    const f = fixture(kind); f.adapter.find.mockResolvedValue(null);
    const first = await f.run(); const now = Date.now();
    const reference = { ...first.results[0].reference, definitionId: 10 };
    for (const quote of Object.values(reference.quotes)) { quote.fetchedAt = now; quote.expiresAt = now + 300000; }
    const retry = { key: first.retryContext.key, operationId: first.retryContext.operationId, items: [{ definitionId: 10, maxBuy: 300 }],
      references: { 10: reference }, policy: { ...reference.policy, purchaseAttempts: 2 } };
    f.adapter.find.mockImplementation(async definitionId => ({ definitionId, itemId: definitionId + 100, tradeId: String(definitionId + 1000), price: 250 }));
    const next = await f.run({ retry });
    expect(next).toMatchObject({ status: 'partial', spent: 250 });
    expect(f.adapter.buy).toHaveBeenCalledTimes(1); expect(f.adapter.find).toHaveBeenLastCalledWith(10, 300);
    expect(next.results[0].attempt).toMatchObject({ used: 1, total: 4, round: 2, limit: 2 });
    expect(next.results[1].attempt).toMatchObject({ used: 3, total: 3, round: 1 });
    expect((await f.run({ retry })).reason).toBe('FC27_BUY_RETRY_CHANGED');
    expect(f.adapter.buy).toHaveBeenCalledTimes(1);
  });
  it(`${kind}: final allowed attempt can succeed, while explicit unknown/restricted failures are not looped`, async () => {
    const f = fixture(kind); f.adapter.find.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect(await f.run()).toMatchObject({ status: 'purchased', spent: 400 });
    expect(f.adapter.find).toHaveBeenCalledTimes(4);
    const denied = fixture(kind); denied.adapter.buy.mockResolvedValue({ status: 'rejected', reason: 'FC27_BUY_LISTING_UNAVAILABLE', httpStatus: 429 });
    expect(await denied.run()).toMatchObject({ status: 'partial', spent: 0 });
    expect(denied.adapter.buy).toHaveBeenCalledTimes(2);
  });
  it(`${kind}: skips chosen-source missing prices instead of buying at the other source`, async () => {
    const f = fixture(kind); f.control.reference = null;
    expect(await f.run()).toMatchObject({ status: 'partial', reason: 'FC27_BUY_REFERENCE_PRICE_UNAVAILABLE', spent: 0 });
    expect(f.adapter.find).not.toHaveBeenCalled(); expect(f.adapter.buy).not.toHaveBeenCalled();
  });
  it(`${kind}: persists approval before dispatch and keeps it independent of receipts`, async () => {
    const f = fixture(kind);
    f.adapter.buy.mockImplementation(async entry => {
      expect(f.data.get(f.key).priceApproval.rows.find(r => r.definitionId === entry.definitionId).maxBuy).toBe(200);
      f.locations.set(entry.itemId, 'purchased'); return { ...entry, status: 'bought' };
    });
    expect(await f.run()).toMatchObject({ status: 'purchased', spent: 400 });
    await f.run(); expect(f.adapter.buy).toHaveBeenCalledTimes(2);
  });
  it(`${kind}: failed approval persistence dispatches no search or bid`, async () => {
    const f = fixture(kind); f.control.failWrite = true; await f.run();
    expect(f.adapter.find).not.toHaveBeenCalled(); expect(f.adapter.buy).not.toHaveBeenCalled();
  });
  it(`${kind}: unknown receipts reconcile without a new quote or second bid`, async () => {
    const f = fixture(kind); f.adapter.buy.mockResolvedValueOnce({ status: 'unknown' });
    expect((await f.run()).status).toBe('recovery-required');
    f.control.reference = 600;
    expect((await f.run()).status).toBe('recovery-required'); expect(f.adapter.buy).toHaveBeenCalledTimes(1);
    f.locations.set(110, 'club');
    expect(await f.run()).toMatchObject({ status: 'purchased', spent: 400 });
    expect(f.adapter.buy.mock.calls.map(([e]) => e.definitionId)).toEqual([10,11]);
    expect(f.preparePrices).toHaveBeenCalledTimes(1);
  });
  it(`${kind}: upgrades an old receipt without rebuying its version or requiring its price`, async () => {
    const f = fixture(kind); f.deps.preparePrices = null;
    f.adapter.buy.mockImplementationOnce(async entry => { f.locations.set(entry.itemId, 'purchased'); f.control.stop = true; return { ...entry, status: 'bought' }; });
    await f.run(); f.control.stop = false; f.deps.preparePrices = f.preparePrices;
    expect(await f.run()).toMatchObject({ status: 'purchased', spent: 400 });
    expect(f.data.get(f.key).priceApproval.rows.map(r => r.definitionId)).toEqual([11]);
    expect(f.adapter.buy).toHaveBeenCalledTimes(2);
  });
}
