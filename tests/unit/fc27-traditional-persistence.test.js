import { describe, expect, it, vi } from 'vitest';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { createTraditionalJournal } from '../../src/fc27/traditional-journal.js';
import { createTraditionalExclusive, FC27_TRADITIONAL_WEB_LOCK } from '../../src/fc27/traditional-lock.js';
import { createFc27TransactionPersistence } from '../../src/adapters/browser/fc27-transaction-persistence.js';

const context = { schema: 1, season: '27', accountScope: 'synthetic-account', platform: 'pc' };
const scope = contextKey(context, 'traditional-sbc-journal');
const record = (overrides = {}) => ({ schema: 1, scope, operationId: 'operation-1', setId: 4, challengeId: 16,
  itemRefs: [{ id: 1, definitionId: 101, pile: 'club' }],
  reward: { scope: 'set', type: 'pack', value: 509, count: 1, tradable: false },
  rewardBaselineCount: 3, phase: 'save-pending', updatedAt: 1000, submitted: false, ...overrides });
const phases = [record(), record({ phase: 'saved' }), record({ phase: 'submit-pending', submitted: null }),
  record({ phase: 'submitted', submitted: true }), record({ phase: 'completed', submitted: true })];
function storeFixture() {
  const values = new Map();
  return { values,
    gmGetValue: vi.fn(async (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback),
    gmSetValue: vi.fn(async (key, value) => { values.set(key, structuredClone(value)); }),
  };
}
function journalFixture() {
  const x = storeFixture();
  return { ...x, journal: createTraditionalJournal({ context, ...x, hasExclusiveAccess: () => true }) };
}
function locksFixture() {
  let held = false;
  return { request: vi.fn(async (name, options, callback) => {
    if (held) return callback(null);
    held = true;
    try { return await callback({ name, mode: options.mode }); } finally { held = false; }
  }) };
}

describe('FC27 scoped GM journal', () => {
  it('persists one exact scope key and survives recreation without deleting pending evidence', async () => {
    const x = journalFixture();
    await expect(x.journal.read(scope)).resolves.toBeNull();
    await x.journal.write(scope, phases[0]);
    expect([...x.values.keys()]).toEqual([scope]);
    const restarted = createTraditionalJournal({ context, ...x, hasExclusiveAccess: () => true });
    await expect(restarted.read(scope)).resolves.toEqual(phases[0]);
    expect(restarted.remove).toBeUndefined(); expect(restarted.clear).toBeUndefined();
  });

  it.each(['completed', 'rejected'])('accepts only ordered checkpoints, then a new operation after %s', async terminal => {
    const x = journalFixture();
    for (const phase of phases.slice(0, 3)) await x.journal.write(scope, phase);
    if (terminal === 'completed') for (const phase of phases.slice(3)) await x.journal.write(scope, phase);
    else await x.journal.write(scope, record({ phase: 'rejected' }));
    await x.journal.write(scope, record({ operationId: 'operation-2', updatedAt: 1001 }));
    expect(x.values.size).toBe(1);
    await expect(x.journal.read(scope)).resolves.toEqual(record({ operationId: 'operation-2', updatedAt: 1001 }));
  });

  it.each([
    ['more than eleven refs', value => { value.itemRefs = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, definitionId: i + 101, pile: 'club' })); }],
    ['sparse refs', value => { value.itemRefs = Array(2); }],
    ['duplicate item', value => { value.itemRefs.push({ id: 1, definitionId: 102, pile: 'club' }); }],
    ['duplicate definition', value => { value.itemRefs.push({ id: 2, definitionId: 101, pile: 'club' }); }],
    ['missing reward', value => { delete value.reward; }],
    ['missing baseline', value => { delete value.rewardBaselineCount; }],
    ['negative baseline', value => { value.rewardBaselineCount = -1; }],
    ['unknown phase', value => { value.phase = 'unknown'; }],
    ['inconsistent outcome', value => { value.submitted = true; }],
    ['extra sensitive field', value => { value.token = 'private'; }],
    ['extra nested field', value => { value.itemRefs[0].raw = 'private'; }],
    ['wrong scope', value => { value.scope = 'foreign'; }],
    ['numeric operation id', value => { value.operationId = 1; }],
  ])('rejects %s without projecting it into a valid record', async (_label, corrupt) => {
    const x = journalFixture(); const value = record(); corrupt(value);
    await expect(x.journal.write(scope, value)).rejects.toThrow(/^FC27_/);
    expect(x.gmSetValue).not.toHaveBeenCalled();
    x.values.set(scope, value);
    await expect(x.journal.read(scope)).rejects.toThrow('FC27_RECOVERY_REQUIRED');
    expect(x.values.get(scope)).toEqual(value);
  });

  it.each([undefined, '', 'null', '{}', 'x'.repeat(20000), [], {}, false, 0])('does not treat corrupt storage case %# as empty', async raw => {
    const x = journalFixture(); x.values.set(scope, raw);
    await expect(x.journal.read(scope)).rejects.toThrow('FC27_RECOVERY_REQUIRED');
    await expect(x.journal.write(scope, record())).rejects.toThrow('FC27_RECOVERY_REQUIRED');
    expect(x.gmSetValue).not.toHaveBeenCalled();
  });

  it('does not execute getters when validating records', async () => {
    const x = journalFixture(); const getter = vi.fn(() => 1); const value = record();
    Object.defineProperty(value, 'schema', { get: getter });
    await expect(x.journal.write(scope, value)).rejects.toThrow(/^FC27_/);
    expect(getter).not.toHaveBeenCalled(); expect(x.gmSetValue).not.toHaveBeenCalled();
  });

  it('does not swallow read errors or leak their contents', async () => {
    const x = journalFixture(); x.gmGetValue.mockRejectedValue(new Error('private storage details'));
    await expect(x.journal.read(scope)).rejects.toThrow('FC27_JOURNAL_READ_UNCONFIRMED');
    await expect(x.journal.write(scope, record())).rejects.toThrow('FC27_JOURNAL_READ_UNCONFIRMED');
    expect(x.gmSetValue).not.toHaveBeenCalled();
  });

  it.each(['throw', 'no-write', 'wrong-readback'])('fails on %s and never silently repairs storage', async mode => {
    const x = journalFixture();
    x.gmSetValue.mockImplementation(async () => {
      if (mode === 'throw') throw new Error('private');
      if (mode === 'wrong-readback') x.values.set(scope, record({ updatedAt: 999 }));
    });
    await expect(x.journal.write(scope, record())).rejects.toThrow('FC27_JOURNAL_UNCONFIRMED');
    expect(x.gmSetValue).toHaveBeenCalledOnce();
  });

  it('awaits asynchronous GM persistence before reporting success', async () => {
    const x = journalFixture(); let release;
    x.gmSetValue.mockImplementation((key, value) => new Promise(resolve => {
      release = () => { x.values.set(key, value); resolve(); };
    }));
    let done = false;
    const pending = x.journal.write(scope, record()).then(() => { done = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(done).toBe(false); release(); await pending; expect(done).toBe(true);
  });

  it('keeps scopes distinct without hashes or old-season fallback', async () => {
    const x = journalFixture(); await x.journal.write(scope, record());
    const otherContext = { ...context, accountScope: 'another-account' };
    const otherScope = contextKey(otherContext, 'traditional-sbc-journal');
    const other = createTraditionalJournal({ context: otherContext, ...x, hasExclusiveAccess: () => true });
    await other.write(otherScope, record({ scope: otherScope }));
    expect(x.values.size).toBe(2);
    await expect(x.journal.read(otherScope)).rejects.toThrow('FC27_JOURNAL_SCOPE_UNVERIFIED');
    expect(() => createTraditionalJournal({ context: { ...context, season: '26' }, ...x })).toThrow(/^FC27_/);
  });

  it.each(['new-operation', 'jump-to-submit', 'identity-drift', 'reward-drift', 'time-reversal'])('blocks %s over a pending checkpoint', async kind => {
    const x = journalFixture(); await x.journal.write(scope, record()); x.gmSetValue.mockClear();
    const next = record({ phase: 'saved' });
    if (kind === 'new-operation') next.operationId = 'operation-2';
    if (kind === 'jump-to-submit') { next.phase = 'submit-pending'; next.submitted = null; }
    if (kind === 'identity-drift') next.itemRefs[0].id++;
    if (kind === 'reward-drift') next.reward.value++;
    if (kind === 'time-reversal') next.updatedAt--;
    await expect(x.journal.write(scope, next)).rejects.toThrow('FC27_JOURNAL_TRANSITION_UNVERIFIED');
    expect(x.gmSetValue).not.toHaveBeenCalled();
    await expect(x.journal.read(scope)).resolves.toEqual(record());
  });

  it('does not reuse a completed operation id or create a terminal record without a boundary', async () => {
    const x = journalFixture();
    await expect(x.journal.write(scope, phases.at(-1))).rejects.toThrow('FC27_JOURNAL_TRANSITION_UNVERIFIED');
    for (const phase of phases) await x.journal.write(scope, phase);
    await expect(x.journal.write(scope, record())).rejects.toThrow('FC27_JOURNAL_TRANSITION_UNVERIFIED');
  });
});

describe('FC27 persistence composition and Web Lock', () => {
  it('holds the fixed same-origin lock through every asynchronous checkpoint', async () => {
    const x = storeFixture(); const lockManager = locksFixture();
    const provider = createFc27TransactionPersistence({ context, ...x, lockManager });
    await provider.exclusive(scope, async () => {
      for (const phase of phases) await provider.journal.write(scope, phase);
      expect(await provider.journal.read(scope)).toEqual(phases.at(-1));
    });
    expect(lockManager.request).toHaveBeenCalledWith(FC27_TRADITIONAL_WEB_LOCK,
      { mode: 'exclusive', ifAvailable: true }, expect.any(Function));
    await expect(provider.journal.write(scope, record({ operationId: 'outside-lock' }))).rejects.toThrow('FC27_EXCLUSIVE_ACCESS_UNAVAILABLE');
    expect(provider.inspect()).toEqual({ storageAvailable: true, lockSupported: true, active: false });
    expect(JSON.stringify(provider.inspect())).not.toContain('synthetic-account');
  });

  it('does not fall back when GM or Web Locks are missing', async () => {
    const x = storeFixture(); const work = vi.fn();
    const noLock = createFc27TransactionPersistence({ context, ...x });
    expect(await noLock.exclusive(scope, work)).toBeNull(); expect(work).not.toHaveBeenCalled();
    expect(x.gmGetValue).not.toHaveBeenCalled();
    expect(() => createFc27TransactionPersistence({ context, lockManager: locksFixture() })).toThrow('FC27_JOURNAL_STORAGE_UNAVAILABLE');
  });

  it('blocks both same-instance and cross-instance overlap without reading an active journal', async () => {
    const x = storeFixture(); const lockManager = locksFixture();
    const first = createFc27TransactionPersistence({ context, ...x, lockManager });
    const second = createFc27TransactionPersistence({ context, ...x, lockManager });
    let release;
    const pending = first.exclusive(scope, () => new Promise(resolve => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const work = vi.fn(() => second.journal.read(scope));
    expect(await first.exclusive(scope, work)).toBeNull();
    expect(await second.exclusive(scope, work)).toBeNull();
    expect(work).not.toHaveBeenCalled(); expect(x.gmGetValue).not.toHaveBeenCalled();
    release(); await pending;
    expect(await second.exclusive(scope, () => 'available')).toBe('available');
  });

  it('releases the guard after thrown work and denies foreign scopes before lock requests', async () => {
    const lockManager = locksFixture(); const lock = createTraditionalExclusive({ context, lockManager });
    await expect(lock.run(scope, async () => { throw new Error('test'); })).rejects.toThrow('test');
    expect(lock.hasExclusiveAccess(scope)).toBe(false);
    expect(await lock.run(scope, async () => 'again')).toBe('again');
    lockManager.request.mockClear();
    await expect(lock.run('wrong', () => {})).rejects.toThrow('FC27_JOURNAL_SCOPE_UNVERIFIED');
    expect(lockManager.request).not.toHaveBeenCalled();
  });

  it('does not enter a late callback after a rejected lock request', async () => {
    let callback;
    const lock = createTraditionalExclusive({ context, lockManager: { request: async (_n, _o, work) => {
      callback = work; throw new Error('private');
    } } });
    const work = vi.fn();
    await expect(lock.run(scope, work)).rejects.toThrow('FC27_EXCLUSIVE_ACCESS_LOST');
    await expect(callback({ name: FC27_TRADITIONAL_WEB_LOCK, mode: 'exclusive' })).rejects.toThrow('FC27_EXCLUSIVE_ACCESS_LOST');
    expect(work).not.toHaveBeenCalled();
  });
});
