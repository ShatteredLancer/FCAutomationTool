import { expect, it, vi } from 'vitest';
import { createFc27StreamlinedPersistence } from '../../src/adapters/browser/fc27-streamlined-persistence.js';
import { createTraditionalExclusive, FC27_TRADITIONAL_WEB_LOCK } from '../../src/fc27/traditional-lock.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { testPlan } from '../helpers/streamlined.js';

function fixture() {
  const plan = testPlan(), values = new Map(); let current = plan.context, held = false;
  const lockManager = { request: vi.fn(async (name, options, task) => {
    if (held) return task(null);
    held = true; try { return await task({ name, mode: options.mode }); } finally { held = false; }
  }) };
  const options = { context: plan.context, lockManager, readContext: () => current,
    get: vi.fn(async (key, fallback) => structuredClone(values.get(key) ?? fallback)),
    set: vi.fn(async (key, value) => values.set(key, structuredClone(value))) };
  return { plan, values, options, persistence: createFc27StreamlinedPersistence(options),
    switchAccount: () => { current = { ...current, accountScope: 'another-account' }; } };
}

it('shares the traditional lock, persists under it and restores the exact record after recreation', async () => {
  const f = fixture(), p = f.persistence;
  expect(() => p.journal.begin(f.plan)).toThrow('EXCLUSIVE_ACCESS_REQUIRED');
  const release = await p.lock.acquire(f.plan.context);
  const record = await p.journal.begin(f.plan);
  const other = createTraditionalExclusive(f.options);
  expect(await other.run(traditionalJournalScope(f.plan.context), () => 'unsafe')).toBeNull();
  expect(await p.lock.acquire(f.plan.context)).toBeNull();
  expect(f.options.lockManager.request).toHaveBeenCalledWith(FC27_TRADITIONAL_WEB_LOCK,
    { mode: 'exclusive', ifAvailable: true }, expect.any(Function));
  await release(); await release();
  expect(await other.run(traditionalJournalScope(f.plan.context), () => 'available')).toBe('available');
  expect(await createFc27StreamlinedPersistence(f.options).journal.read(f.plan.context)).toEqual(record);
  expect(f.values.size).toBe(1);
});

it('holds the Web Lock while an already dispatched GM write settles', async () => {
  const f = fixture(); let finish;
  f.options.set.mockImplementation((key, value) => new Promise(resolve => {
    finish = () => { f.values.set(key, structuredClone(value)); resolve(); };
  }));
  const release = await f.persistence.lock.acquire(f.plan.context);
  const write = f.persistence.journal.begin(f.plan);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const released = vi.fn(); const releaseResult = release().then(released);
  const other = createTraditionalExclusive(f.options);
  expect(await other.run(traditionalJournalScope(f.plan.context), () => true)).toBeNull();
  expect(released).not.toHaveBeenCalled();
  finish(); await write; await releaseResult;
  expect(released).toHaveBeenCalledOnce();
});

it('rejects account drift and storage failures without leaking the lock', async () => {
  const f = fixture(), release = await f.persistence.lock.acquire(f.plan.context);
  f.options.set.mockRejectedValueOnce(Error('disk'));
  await expect(f.persistence.journal.begin(f.plan)).rejects.toThrow('JOURNAL_WRITE_FAILED');
  f.switchAccount();
  expect(() => f.persistence.journal.read(f.plan.context)).toThrow('CONTEXT_CHANGED');
  await release();
  expect(f.persistence.inspect().active).toBe(false);
});

it('returns unavailable or an explicit failure for missing, denied and broken native locks', async () => {
  const f = fixture();
  expect(await createFc27StreamlinedPersistence({ ...f.options, lockManager: null }).lock.acquire(f.plan.context)).toBeNull();
  for (const request of [async () => { throw Error('denied'); }, async (_name, _options, callback) => callback({ name: 'wrong', mode: 'exclusive' })]) {
    await expect(createFc27StreamlinedPersistence({ ...f.options, lockManager: { request } }).lock.acquire(f.plan.context)).rejects.toThrow('EXCLUSIVE_ACCESS_LOST');
  }
});
