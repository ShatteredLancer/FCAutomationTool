import { expect, it, vi } from 'vitest';
import { createFc27TransactionPersistence } from '../../src/adapters/browser/fc27-transaction-persistence.js';
import { createFc27PuzzleFillPersistence } from '../../src/fc27/puzzle-fill-journal.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../src/fc27/traditional-lock.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';

function fixture({ context = { season: '27', accountScope: 'test-account', platform: 'local' }, data = new Map() } = {}) {
  const scope = traditionalJournalScope(context);
  const gmGetValue = vi.fn(async (key, fallback) => structuredClone(data.get(key) ?? fallback));
  const gmSetValue = vi.fn(async (key, value) => { data.set(key, structuredClone(value)); });
  const lockManager = { request: vi.fn(async (name, _options, task) => task({ name, mode: 'exclusive' })) };
  const traditional = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager });
  const store = createFc27PuzzleFillPersistence({ context, gmGetValue, gmSetValue,
    lock: traditional.lock, lockScope: scope });
  const record = { schema: 1, kind: 'puzzle-fill', scope, operationId: 'operation-1', setId: 19, challengeId: 43,
    phase: 'save-pending', submitted: false, updatedAt: 1000,
    itemRefs: Array.from({ length: 11 }, (_, slot) => ({ id: slot + 1, definitionId: slot + 101, pile: 'club', slot })) };
  return { scope, record, store, traditional, gmGetValue, gmSetValue, lockManager, data };
}

it('uses the traditional Web Lock but an isolated GM key, and persists exact pending/saved records', async () => {
  const x = fixture();
  await x.store.exclusive(x.scope, async () => {
    expect(await x.store.journal.read(x.scope)).toBeNull();
    await x.store.journal.write(x.scope, x.record);
    await x.store.journal.write(x.scope, { ...x.record, phase: 'saved', updatedAt: 1001 });
    expect((await x.store.journal.read(x.scope)).phase).toBe('saved');
    expect(await x.traditional.journal.read(x.scope)).toBeNull();
  });
  expect(x.lockManager.request.mock.calls[0][0]).toBe(FC27_TRADITIONAL_WEB_LOCK);
  expect([...x.data.keys()][0]).toMatch(/^fcat-fc27-puzzle-fill:/);
});

it('rejects reads, writes and clears outside the lock or with another account scope', async () => {
  const x = fixture();
  await expect(x.store.journal.read(x.scope)).rejects.toThrow('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
  await expect(x.store.journal.write(x.scope, x.record)).rejects.toThrow('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
  await expect(x.store.journal.clear(x.scope, x.record)).rejects.toThrow('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
  await x.store.exclusive(x.scope, async () => {
    await expect(x.store.journal.read('other')).rejects.toThrow('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
  });
});

it.each(['slots', 'definitions', 'items', 'pile', 'submitted', 'phase'])('rejects invalid %s without writing', async kind => {
  const x = fixture(); const record = structuredClone(x.record);
  if (kind === 'slots') record.itemRefs[1].slot = 0;
  if (kind === 'definitions') record.itemRefs[1].definitionId = 101;
  if (kind === 'items') record.itemRefs[1].id = 1;
  if (kind === 'pile') record.itemRefs[1].pile = 'storage';
  if (kind === 'submitted') record.submitted = true;
  if (kind === 'phase') record.phase = 'completed';
  await x.store.exclusive(x.scope, async () => {
    await expect(x.store.journal.write(x.scope, record)).rejects.toThrow('FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED');
  });
  expect(x.gmSetValue).not.toHaveBeenCalled();
});

it('blocks replacement of uncertain records but allows a new operation after verified save', async () => {
  const x = fixture(); await x.store.exclusive(x.scope, async () => {
    await x.store.journal.write(x.scope, x.record);
    await expect(x.store.journal.write(x.scope, { ...x.record, operationId: 'operation-2' }))
      .rejects.toThrow('FC27_PUZZLE_FILL_JOURNAL_TRANSITION_UNVERIFIED');
    await x.store.journal.write(x.scope, { ...x.record, phase: 'saved' });
    await x.store.journal.write(x.scope, { ...x.record, operationId: 'operation-2' });
    expect((await x.store.journal.read(x.scope)).operationId).toBe('operation-2');
  });
});

it('requires the exact recovery record and confirms deletion', async () => {
  const x = fixture(); await x.store.exclusive(x.scope, async () => {
    await x.store.journal.write(x.scope, x.record);
    await expect(x.store.journal.clear(x.scope, { ...x.record, operationId: 'wrong' }))
      .rejects.toThrow('FC27_PUZZLE_FILL_RECOVERY_REQUIRED');
    await x.store.journal.clear(x.scope, x.record);
    expect(await x.store.journal.read(x.scope)).toBeNull();
  });
});

it('accepts explicit v2 bricks, rejects truncated legacy records and prevents brick drift', async () => {
  const x = fixture();
  const record = { ...x.record, schema: 2, brickIndices: [0], itemRefs: x.record.itemRefs.slice(1) };
  await x.store.exclusive(x.scope, async () => {
    await expect(x.store.journal.write(x.scope, { ...record, schema: 1 })).rejects.toThrow('FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED');
    await expect(x.store.journal.write(x.scope, { ...record, brickIndices: [1] })).rejects.toThrow('FC27_PUZZLE_FILL_JOURNAL_UNVERIFIED');
    await x.store.journal.write(x.scope, record);
    await x.store.journal.write(x.scope, { ...record, phase: 'saved' });
    expect((await x.store.journal.read(x.scope)).brickIndices).toEqual([0]);
  });
});

it('isolates pending records by Challenge and records the account identity', async () => {
  const x = fixture();
  const other = { ...x.record, setId: 21, challengeId: 48, operationId: 'operation-2',
    account: { accountScope: 'test-account', platform: 'local' } };
  await x.store.exclusive(x.scope, async () => {
    await x.store.journal.write(x.scope, x.record);
    await x.store.journal.write(x.scope, other);
    expect(await x.store.journal.read(x.scope, { setId: 19, challengeId: 43 })).toMatchObject({ setId: 19, challengeId: 43 });
    expect(await x.store.journal.read(x.scope, { setId: 21, challengeId: 48 })).toMatchObject({ setId: 21, challengeId: 48, account: { accountScope: 'test-account' } });
    expect((await x.store.journal.list(x.scope)).map(record => `${record.setId}:${record.challengeId}`)).toEqual(['19:43', '21:48']);
  });
});

it('rejects a record carrying a different account identity before writing it', async () => {
  const x = fixture();
  await x.store.exclusive(x.scope, async () => {
    await expect(x.store.journal.write(x.scope, { ...x.record,
      account: { accountScope: 'another-account', platform: 'local' } }))
      .rejects.toThrow('FC27_PUZZLE_FILL_JOURNAL_ACCOUNT_CONFLICT');
  });
  expect([...x.data.keys()].some(key => key.includes(':19:43'))).toBe(false);
});

it('clears a matching legacy record without leaving it available through fallback', async () => {
  const x = fixture();
  const key = `fcat-fc27-puzzle-fill:${contextKey({ season: '27', accountScope: 'test-account', platform: 'local' }, 'puzzle-fill')}`;
  x.data.set(key, x.record);
  await x.store.exclusive(x.scope, async () => {
    expect(await x.store.journal.read(x.scope, { setId: 21, challengeId: 48 })).toBeNull();
    await x.store.journal.clear(x.scope, x.record);
    expect(await x.store.journal.list(x.scope)).toEqual([]);
  });
});

it.each([{ accountScope: 'another-account', platform: 'local' }, { accountScope: 'test-account', platform: 'ps:another-sku' }])(
  'keeps the same Challenge separate for account/platform %j', async identity => {
    const a = fixture(); const b = fixture({ context: { season: '27', ...identity }, data: a.data });
    await a.store.exclusive(a.scope, () => a.store.journal.write(a.scope, a.record));
    await b.store.exclusive(b.scope, async () => {
      expect(await b.store.journal.read(b.scope, { setId: 19, challengeId: 43 })).toBeNull();
      expect(await b.store.journal.list(b.scope)).toEqual([]);
      await b.store.journal.write(b.scope, { ...b.record, operationId: 'account-b' });
    });
    await a.store.exclusive(a.scope, async () => {
      expect(await a.store.journal.read(a.scope, { setId: 19, challengeId: 43 })).toEqual(a.record);
    });
  });
