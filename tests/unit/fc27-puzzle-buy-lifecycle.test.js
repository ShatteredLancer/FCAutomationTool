import { expect, it, vi } from 'vitest';
import { maintainPuzzleBuyLifecycle, puzzleBuyHistoryKey } from '../../src/fc27/puzzle-buy-lifecycle.js';
import { puzzleBuyKey, puzzleBuyPendingKey } from '../../src/fc27/puzzle-buy-session.js';

const context = { season: '27', accountScope: 'account', platform: 'pc' };
const record = (scope = 'fc27:account:pc') => ({ schema: 1, scope, context,
  target: { setId: 21, challengeId: 48 }, operationId: 'op', phase: 'ready', applied: [],
  entries: [{ slot: 0, definitionId: 100, state: 'club', itemId: 1 },
    { slot: 1, definitionId: 101, state: 'waiting' }] });

function fixture(state = 'retired') {
  const scope = 'fc27:account:pc', key = puzzleBuyKey(scope, { setId: 21, challengeId: 48 });
  const value = record(scope), memory = new Map([[puzzleBuyPendingKey(scope), { key, operationId: 'op' }], [key, value]]);
  const get = vi.fn(async (candidate, fallback) => structuredClone(memory.get(candidate) ?? fallback));
  const set = vi.fn(async (candidate, next) => memory.set(candidate, structuredClone(next)));
  return { scope, key, value, memory, get, set, targetState: async () => state,
    assertCurrent: () => {}, locate: vi.fn(async () => 'unknown') };
}

it('archives a retired target before clearing its activity marker', async () => {
  const f = fixture();
  const result = await maintainPuzzleBuyLifecycle({ ...f, context });
  expect(result).toMatchObject({ status: 'archived', reason: 'target-ended' });
  expect(f.memory.get(puzzleBuyPendingKey(f.scope))).toBeNull();
  expect(f.memory.get(puzzleBuyHistoryKey(f.scope, { setId: 21, challengeId: 48 }))[0].closure.autoRetryAllowed).toBe(false);
  expect(f.set.mock.calls.map(([key]) => key)).toEqual([puzzleBuyHistoryKey(f.scope, f.value.target), f.key, puzzleBuyPendingKey(f.scope)]);
});

it('keeps an unknown historical result non-retriable and never moves or buys', async () => {
  const f = fixture('active'); f.value.entries[0] = { slot: 0, definitionId: 100, state: 'buy-pending', itemId: 55, tradeId: '77', price: 200 };
  f.memory.set(f.key, structuredClone(f.value));
  const result = await maintainPuzzleBuyLifecycle({ ...f, context });
  expect(result).toMatchObject({ status: 'archived', reason: 'historical-unconfirmed', unknownCount: 1 });
  expect(f.locate).toHaveBeenCalledOnce();
  expect(f.memory.get(puzzleBuyPendingKey(f.scope))).toBeNull();
  expect(f.memory.get(f.key).closure.autoRetryAllowed).toBe(false);
});

it('fails closed when durable history cannot be written', async () => {
  const f = fixture(); f.set.mockRejectedValueOnce(new Error('disk'));
  await expect(maintainPuzzleBuyLifecycle({ ...f, context })).rejects.toThrow('FC27_BUY_JOURNAL_WRITE_FAILED');
  expect(f.memory.get(puzzleBuyPendingKey(f.scope))).not.toBeNull();
});

it('resumes a crash between archive and current-record writes without querying again', async () => {
  const f = fixture(), original = f.set.getMockImplementation();
  f.set.mockImplementationOnce(original).mockRejectedValueOnce(Error('disk'));
  await expect(maintainPuzzleBuyLifecycle({ ...f, context, now: () => 100 })).rejects.toThrow();
  f.set.mockImplementation(original);
  expect((await maintainPuzzleBuyLifecycle({ ...f, context, now: () => 200 })).status).toBe('archived');
  expect(f.memory.get(f.key).closure.at).toBe(100);
  expect(f.memory.get(puzzleBuyHistoryKey(f.scope, f.value.target))).toHaveLength(1);
});

it('does not archive a live incomplete target just because time passed', async () => {
  const f = fixture('active');
  expect((await maintainPuzzleBuyLifecycle({ ...f, context })).status).toBe('target-recovery');
  expect(f.set).not.toHaveBeenCalled(); expect(f.locate).not.toHaveBeenCalled();
});

it.each(['club', 'purchased', 'unknown'])('records %s observation once and never converts history into purchase permission', async location => {
  const f = fixture('active'); f.value.entries[0].state = 'buy-pending'; f.locate.mockResolvedValue(location);
  f.memory.set(f.key, structuredClone(f.value));
  await maintainPuzzleBuyLifecycle({ ...f, context });
  const closed = f.memory.get(f.key);
  expect(closed.entries[0].state).toBe('buy-pending');
  expect(closed.closure.observations).toEqual([{ slot: 0, location }]);
  expect(await maintainPuzzleBuyLifecycle({ ...f, context })).toEqual({ status: 'absent' });
  expect(f.locate).toHaveBeenCalledOnce();
});

it('retains the marker if account changes during a read', async () => {
  const f = fixture('active'); f.value.entries[0].state = 'buy-pending'; f.memory.set(f.key, structuredClone(f.value));
  let changed = false;
  f.locate.mockImplementation(async () => { changed = true; return 'club'; });
  await expect(maintainPuzzleBuyLifecycle({ ...f, context,
    assertCurrent: () => { if (changed) throw Error('FC27_BUY_CONTEXT_CHANGED'); } })).rejects.toThrow('CONTEXT_CHANGED');
  expect(f.set).not.toHaveBeenCalled();
});

it('does not treat waiting cards as a completed purchase when applied Club entries match', async () => {
  const f = fixture('active');
  f.value.applied = [structuredClone(f.value.entries[0])];
  f.memory.set(f.key, structuredClone(f.value));
  expect((await maintainPuzzleBuyLifecycle({ ...f, context })).status).toBe('target-recovery');
  expect(f.set).not.toHaveBeenCalled();
});

it('finishes an entirely applied batch without requesting the SBC catalogue', async () => {
  const f = fixture();
  f.value.entries.pop(); f.value.applied = structuredClone(f.value.entries);
  f.memory.set(f.key, structuredClone(f.value));
  f.targetState = vi.fn(async () => { throw Error('catalogue unavailable'); });
  expect(await maintainPuzzleBuyLifecycle({ ...f, context })).toMatchObject({ status: 'archived', reason: 'settled' });
  expect(f.targetState).not.toHaveBeenCalled();
});

it('retains both history and marker when closed-record readback differs', async () => {
  const f = fixture();
  f.set.mockImplementation(async (key, value) => {
    if (key !== f.key) f.memory.set(key, structuredClone(value));
  });
  await expect(maintainPuzzleBuyLifecycle({ ...f, context })).rejects.toThrow('FC27_BUY_JOURNAL_READBACK_FAILED');
  expect(f.memory.get(puzzleBuyPendingKey(f.scope))).not.toBeNull();
  expect(f.memory.get(puzzleBuyHistoryKey(f.scope, f.value.target))).toHaveLength(1);
});
