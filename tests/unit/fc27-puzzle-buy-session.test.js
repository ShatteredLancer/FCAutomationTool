import { expect, it, vi } from 'vitest';
import { createFc27PuzzleBuySession, puzzleBuyKey, puzzleBuyPendingKey, puzzleBuyHistoryKey } from '../../src/fc27/puzzle-buy-session.js';

function fixture(count = 2) {
  const scope = 'account'; const context = { season: '27', accountScope: 'account', platform: 'pc' };
  const target = { setId: 4, challengeId: 16 }; const data = new Map(); const locations = new Map();
  const draft = { phase: 'saved', operationId: 'test', plan: { context,
    slots: Array.from({ length: count }, (_, slot) => ({ slot, kind: 'concept', definitionId: 900 + slot })) } };
  let stopped = false;
  const adapter = { verifySquad: vi.fn(), verifyCurrent: vi.fn(),
    find: vi.fn(async definitionId => ({ definitionId, itemId: definitionId + 1000, tradeId: String(definitionId + 2000), price: 200 })),
    buy: vi.fn(async entry => { locations.set(entry.itemId, 'purchased'); return { ...entry, status: 'bought' }; }),
    locate: vi.fn(async entry => locations.get(entry.itemId) ?? 'unknown'),
    move: vi.fn(async entry => { locations.set(entry.itemId, 'club'); }),
    save: vi.fn(async (_record, before) => { await before(); }), recoverSave: vi.fn(), cancel: vi.fn() };
  const session = () => createFc27PuzzleBuySession({ scope, context,
    get: async (key, fallback) => structuredClone(data.get(key) ?? fallback), set: async (key, value) => { data.set(key, structuredClone(value)); },
    exclusive: async (_scope, task) => task(), loadDraft: async () => draft, assertCurrent: () => {},
    createAdapter: async () => adapter, shouldStop: () => stopped });
  const run = (options = {}) => session().execute(target, { approved: true, budget: 400, expectedOperationId: 'test', ...options });
  return { run, adapter, data, draft, locations, target, scope, stop: () => { stopped = true; } };
}

it('buys serially, records exact receipts, moves to Club and saves once without submitting', async () => {
  const x = fixture(); const result = await x.run();
  expect(result).toMatchObject({ status: 'purchased', purchased: 2, spent: 400, saved: true, submitted: false });
  expect(x.adapter.buy).toHaveBeenCalledTimes(2); expect(x.adapter.save).toHaveBeenCalledTimes(1);
  expect(x.data.get(puzzleBuyPendingKey(x.scope))).toBeNull();
  expect(await x.run()).toMatchObject({ status: 'purchased', spent: 400 });
  expect(x.adapter.buy).toHaveBeenCalledTimes(2); expect(x.adapter.save).toHaveBeenCalledTimes(1);
});


it('never replays an archived approval; a new explicit batch keeps its history intact', async () => {
  const x = fixture(); await x.run();
  const key = puzzleBuyKey(x.scope, x.target), closed = { ...x.data.get(key), closure: { schema: 1, autoRetryAllowed: false } };
  x.data.set(key, closed); x.data.set(puzzleBuyHistoryKey(x.scope, x.target), [structuredClone(closed)]);
  expect((await x.run()).reason).toBe('FC27_BUY_ARCHIVED_APPROVAL_EXPIRED');
  expect(x.adapter.buy).toHaveBeenCalledTimes(2);
  x.draft.operationId = 'new-click'; x.draft.closedOperationId = closed.operationId;
  expect((await x.run({ expectedOperationId: 'new-click' })).status).toBe('purchased');
  expect(x.data.get(puzzleBuyHistoryKey(x.scope, x.target))).toEqual([closed]);
});

it('preserves settled history when the current squad starts a different purchase batch', async () => {
  const x = fixture(); await x.run();
  const key = puzzleBuyKey(x.scope, x.target), previous = structuredClone(x.data.get(key));
  x.draft.operationId = 'new-current-squad';
  expect((await x.run({ expectedOperationId: 'new-current-squad' })).status).toBe('purchased');
  expect(x.data.get(puzzleBuyHistoryKey(x.scope, x.target))).toEqual([
    { ...previous, closure: expect.objectContaining({ reason: 'settled', autoRetryAllowed: false }) },
  ]);
  expect(x.data.get(key).operationId).toBe('new-current-squad');
});

it('emits FSU-style foreground phases for every card in serial order', async () => {
  const phases = [];
  const x = fixture();
  const original = x.run;
  // Recreate the small fixture with the progress callback exposed without
  // changing the production approval or journal contract.
  const context = { season: '27', accountScope: 'account', platform: 'pc' };
  const data = x.data; const target = x.target; const draft = x.draft;
  const session = createFc27PuzzleBuySession({ scope: x.scope, context,
    get: async (key, fallback) => structuredClone(data.get(key) ?? fallback),
    set: async (key, value) => { data.set(key, structuredClone(value)); },
    exclusive: async (_scope, task) => task(), loadDraft: async () => draft, assertCurrent: () => {},
    createAdapter: async () => x.adapter, onProgress: progress => { if (progress.phase !== 'progress') phases.push(`${progress.index}/${progress.total}:${progress.phase}`); },
  });
  await session.execute(target, { approved: true, budget: 400, expectedOperationId: 'test' });
  expect(phases).toEqual([
    '1/2:search', '1/2:price-ready', '1/2:buying', '1/2:bought', '1/2:moving', '1/2:completed',
    '2/2:search', '2/2:price-ready', '2/2:buying', '2/2:bought', '2/2:moving', '2/2:completed',
  ]);
  expect(original).toBeTypeOf('function');
});
it('persists a buy-pending marker before calling the native buyer', async () => {
  const x = fixture();
  x.adapter.buy.mockImplementation(async entry => {
    expect(x.data.get(puzzleBuyKey(x.scope, x.target)).entries.find(e => e.slot === entry.slot).state).toBe('buy-pending');
    expect(x.data.get(puzzleBuyPendingKey(x.scope))).toMatchObject({ operationId: 'test' });
    return { ...entry, status: 'bought' };
  });
  expect((await x.run()).status).toBe('purchased');
});
it('stops at the configured budget, saves progress and continues only remaining purchases', async () => {
  const x = fixture();
  expect(await x.run({ budget: 200 })).toMatchObject({ status: 'partial', spent: 200, reason: 'FC27_BUY_BUDGET_EXCEEDED' });
  expect(await x.run({ budget: 7000 })).toMatchObject({ status: 'purchased', spent: 400 });
  expect(x.adapter.buy).toHaveBeenCalledTimes(2);
});
it('keeps an unknown buy pending across restart and never buys it again on absence', async () => {
  const x = fixture(); x.adapter.buy.mockResolvedValue({ status: 'unknown' });
  expect((await x.run()).status).toBe('recovery-required');
  expect(await x.run()).toMatchObject({ status: 'recovery-required', reason: 'FC27_BUY_RECEIPT_UNCONFIRMED' });
  expect(x.adapter.buy).toHaveBeenCalledTimes(1); expect(x.adapter.move).not.toHaveBeenCalled();
});
it('recovers a lost buy response by exact ownership and does not rebuy the first card', async () => {
  const x = fixture();
  x.adapter.buy.mockImplementationOnce(async entry => { x.locations.set(entry.itemId, 'purchased'); throw new Error('FC27_BUY_RESPONSE_UNCONFIRMED'); });
  expect((await x.run()).status).toBe('recovery-required');
  expect(await x.run()).toMatchObject({ status: 'purchased', purchased: 2, spent: 400 });
  expect(x.adapter.buy.mock.calls.map(([e]) => e.definitionId)).toEqual([900, 901]);
});
it('reconciles a lost save response without issuing another PUT or buying again', async () => {
  const x = fixture(); x.adapter.save.mockImplementationOnce(async (_record, before) => { await before(); throw new Error('FC27_BUY_SAVE_UNCONFIRMED'); });
  expect((await x.run()).status).toBe('recovery-required');
  expect((await x.run()).status).toBe('purchased');
  expect(x.adapter.recoverSave).toHaveBeenCalledTimes(1); expect(x.adapter.save).toHaveBeenCalledTimes(1);
  expect(x.adapter.buy).toHaveBeenCalledTimes(2);
});
it('honors stop after settling the current purchase and move', async () => {
  const x = fixture(); x.adapter.buy.mockImplementationOnce(async entry => { x.stop(); return { ...entry, status: 'bought' }; });
  expect(await x.run()).toMatchObject({ status: 'partial', purchased: 1, reason: 'FC27_BUY_STOPPED' });
  expect(x.adapter.move).toHaveBeenCalledTimes(1); expect(x.adapter.save).toHaveBeenCalledTimes(1);
});
it.each([{ approved: false }, { budget: null }, { expectedOperationId: 'different' }])('rejects missing or stale approval %j', async options => {
  const x = fixture(); expect((await x.run(options)).status).toBe('blocked'); expect(x.adapter.buy).not.toHaveBeenCalled();
});
it('refuses an over-cap quote before dispatch, without silently increasing the cap', async () => {
  const x = fixture(); x.adapter.find.mockResolvedValue({ definitionId: 900, itemId: 1900, tradeId: '2900', price: 4500 });
  expect(await x.run({ budget: 10000, quoteCeiling: 2000 })).toMatchObject({ status: 'partial', reason: 'FC27_BUY_QUOTE_UNVERIFIED', spent: 0 });
  expect(x.adapter.buy).not.toHaveBeenCalled();
});
it('blocks another target while a dispatched receipt is unknown', async () => {
  const x = fixture(); x.data.set(puzzleBuyPendingKey(x.scope), { key: 'another-target', operationId: 'test' });
  expect(await x.run()).toMatchObject({ reason: 'FC27_BUY_RECOVERY_REQUIRED' }); expect(x.adapter.find).not.toHaveBeenCalled();
});

it('continues a six-card FSU-style batch past a missing listing and retries only that card on the next click', async () => {
  const x = fixture(6);
  x.adapter.find.mockImplementation(async definitionId => definitionId === 902 ? null
    : { definitionId, itemId: definitionId + 1000, tradeId: String(definitionId + 2000), price: 200 });
  expect(await x.run({ budget: 1200 })).toMatchObject({ status: 'partial', purchased: 5, spent: 1000,
    failures: [{ slot: 2, definitionId: 902, reason: 'FC27_BUY_NO_LISTING' }] });
  x.adapter.find.mockResolvedValue({ definitionId: 902, itemId: 1902, tradeId: '2902', price: 200 });
  expect(await x.run({ budget: 1200 })).toMatchObject({ status: 'purchased', purchased: 6 });
  expect(x.adapter.buy.mock.calls.map(([e]) => e.definitionId)).toEqual([900, 901, 903, 904, 905, 902]);
});

it.each(['FC27_BUY_LISTING_CHANGED', 'FC27_BUY_LISTING_UNAVAILABLE'])('continues after an explicitly rejected listing: %s', async reason => {
  const x = fixture(6); x.adapter.buy.mockResolvedValueOnce({ status: 'rejected', reason });
  expect(await x.run({ budget: 1200 })).toMatchObject({ status: 'partial', purchased: 5 });
  expect(x.adapter.buy).toHaveBeenCalledTimes(6);
});

it.each(['FC27_BUY_REJECTED', 'FC27_BUY_LISTING_UNAVAILABLE'])('continues after an explicit negative receipt: %s', async reason => {
  const x = fixture(6); x.adapter.buy.mockResolvedValueOnce({ status: 'rejected', reason });
  expect(await x.run({ budget: 1200 })).toMatchObject({ purchased: 5, reason });
  expect(x.adapter.buy).toHaveBeenCalledTimes(6);
});

it('continues after an explicit move failure and resumes its known receipt without rebuying', async () => {
  const x = fixture(6);
  x.adapter.move.mockResolvedValueOnce({ status: 'rejected', reason: 'FC27_BUY_MOVE_REJECTED' });
  expect(await x.run({ budget: 1200 })).toMatchObject({ status: 'partial', purchased: 6, spent: 1200 });
  expect(x.adapter.buy).toHaveBeenCalledTimes(6);
  expect(await x.run({ budget: 1200 })).toMatchObject({ status: 'purchased', purchased: 6, spent: 1200 });
  expect(x.adapter.buy).toHaveBeenCalledTimes(6);
});
