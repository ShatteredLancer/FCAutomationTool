import { expect, it, vi } from 'vitest';
import { compactFc27Storage, streamlinedStorageKey } from '../../src/adapters/browser/fc27-storage-maintenance.js';
import { createCompactStorage, decodeStoredValue, encodeStoredValue } from '../../src/runtime/compact-storage.js';
import { createStreamlinedJournal, streamlinedJournalKey } from '../../src/streamlined/journal.js';
import { createStreamlinedPurchaseJournal, streamlinedPurchaseKey, streamlinedRetiredPurchaseKey } from '../../src/streamlined/purchase-journal.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../src/fc27/traditional-lock.js';
import { trimGalleryDerivedCaches } from '../../src/gallery/cache-budget.js';
import { testPlan } from '../helpers/streamlined.js';
import { contextKey } from '../../src/fc27/prelaunch-contract.js';
import { galleryDerivedCacheKey } from '../../src/gallery/cache-budget.js';

const memory = () => {
  const values = new Map();
  return { values, list: async () => [...values.keys()], get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: vi.fn(async (key, value) => { values.set(key, structuredClone(value)); }) };
};
const locks = { request: async (name, options, task) => {
  expect(name).toBe(FC27_TRADITIONAL_WEB_LOCK); expect(options).toEqual({ mode: 'exclusive', ifAvailable: true });
  return task({ name, mode: 'exclusive' });
} };
const evidence = () => ({ futureEvidence: '完整回执;pending;unknown;'.repeat(6000) });
async function rawContribution(store) {
  const plan = testPlan(), context = plan.context;
  const journal = createStreamlinedJournal(store), record = await journal.begin(plan);
  record.batches[0].state = 'unknown'; Object.assign(record, evidence());
  store.values.set(streamlinedJournalKey(context), record);
  return record;
}
it('losslessly migrates full journals/history and leaves protected/foreign keys byte-identical', async () => {
  const store = memory(), record = await rawContribution(store), key = streamlinedJournalKey(record.context);
  store.values.set(`${key}:history:1`, structuredClone(record));
  const protectedKeys = ['lock_26', 'set', 'build', contextKey(record.context, 'gallery-collection'),
    'fcat-fc27-gallery-purchase:fixture', 'fcat-fc27-diagnostic-log-v1', `${key}:approval`,
    key.replace('"27"', '"26"'), key.replace('streamlined-contribution', 'streamlined-settings')];
  for (const key of protectedKeys) store.values.set(key, { opaque: 'protected;'.repeat(20000) });
  const before = new Map([...store.values].map(([key, value]) => [key, JSON.stringify(value)]));
  const report = await compactFc27Storage({ ...store, locks });
  expect(report).toMatchObject({ status: 'completed', compacted: 2, failed: 0 });
  expect(report.afterBytes).toBeLessThan(report.beforeBytes / 10);
  expect(await createStreamlinedJournal(store).read(record.context)).toEqual(record);
  for (const [key, value] of store.values) expect(JSON.stringify(await decodeStoredValue(value))).toBe(before.get(key));
  for (const key of protectedKeys) expect(JSON.stringify(store.values.get(key))).toBe(before.get(key));
  await expect(createStreamlinedJournal(store).begin(record.plan)).rejects.toThrow('RECOVERY_REQUIRED');
  expect((await compactFc27Storage({ ...store, locks })).compacted).toBe(0);
});
it('preserves buy-pending/move-pending, retired reservations and cross-account isolation', async () => {
  const store = memory(), context = testPlan().context;
  const item = { definitionId: 123, points: 20, price: 200, purchaseMaxBuy: 250 };
  const make = (scope, state) => ({ schema: 1, context: scope, operationId: `fixture-${state}`, revision: 1,
    fingerprint: 'fixture', challenge: { id: 24, setId: 9, targetScore: 40, selectionLimit: 1 }, policy: {},
    route: { groups: [{ source: 'market', quantity: 1, item, items: [item] }] }, budget: 250,
    spent: state === 'buy-pending' ? 0 : 200, submittedScore: 0, completed: false, contribution: null,
    entries: [{ key: 'market:0', source: 'market', state, groupIndex: 0, definitionId: 123,
      itemId: 456, tradeId: '789', cap: 250, price: 200 }], consumedIds: [], fulfilled: [0], ...evidence() });
  const a = make(context, 'buy-pending'), other = { ...context, accountScope: 'fixture-other' }, b = make(other, 'move-pending');
  store.values.set(streamlinedPurchaseKey(context), a); store.values.set(streamlinedPurchaseKey(other), b);
  const retired = { ...make(context, 'club'), operationId: 'retired' };
  retired.entries[0].itemId = 457;
  store.values.set(streamlinedRetiredPurchaseKey(context), [{ reason: 'user-abandoned', at: 1, record: retired }]);
  const before = new Map([...store.values].map(([key, value]) => [key, structuredClone(value)]));
  expect((await compactFc27Storage({ ...store, locks })).compacted).toBe(3);
  const journal = createStreamlinedPurchaseJournal(store);
  expect(await journal.read(context)).toEqual(a); expect(await journal.read(other)).toEqual(b);
  expect(await journal.reservedIds(context)).toEqual([457]);
  for (const [key, value] of before) expect(await decodeStoredValue(store.values.get(key))).toEqual(value);
  const written = await journal.write(a, 1);
  expect(store.values.get(streamlinedPurchaseKey(context)).fcatStorage).toBe('fcat-gzip-json-v1');
  await expect(journal.archive(written)).rejects.toThrow('PURCHASE_RECOVERY_REQUIRED');
  const consumed = structuredClone(written);
  consumed.entries[0].state = 'consumed'; consumed.spent = 200; consumed.fulfilled = [1];
  consumed.consumedIds = [456]; consumed.submittedScore = 40; consumed.completed = true;
  const settled = await journal.write(consumed, written.revision); await journal.archive(settled);
  const history = `${streamlinedPurchaseKey(context)}:history:${settled.operationId}:${settled.revision}`;
  expect(store.values.get(history).fcatStorage).toBe('fcat-gzip-json-v1');
  expect(await decodeStoredValue(store.values.get(history))).toEqual(settled);
});
it.each([null, { request: async (_name, _opts, task) => task(null) }])('defers journals when the transaction lock is absent/busy', async locks => {
  const store = memory(); await rawContribution(store); const before = JSON.stringify([...store.values]); store.set.mockClear();
  expect(await compactFc27Storage({ ...store, locks })).toMatchObject({ status: 'deferred', deferred: 1, compacted: 0 });
  expect(JSON.stringify([...store.values])).toBe(before); expect(store.set).not.toHaveBeenCalled();
});
it('re-reads only after acquiring the transaction lock and keeps the newest pending revision', async () => {
  const store = memory(), record = await rawContribution(store), key = streamlinedJournalKey(record.context);
  const newer = { ...record, revision: 9, futureEvidence: 'new-receipt;'.repeat(20000) };
  const racingLocks = { request: async (name, _opts, task) => { store.values.set(key, newer); return task({ name, mode: 'exclusive' }); } };
  expect((await compactFc27Storage({ ...store, locks: racingLocks })).compacted).toBe(1);
  expect(await createStreamlinedJournal(store).read(record.context)).toEqual(newer);
});
it('never turns damaged compression into an empty journal or retries past a failed write', async () => {
  const store = memory(), record = await rawContribution(store), key = streamlinedJournalKey(record.context);
  const packed = await encodeStoredValue(record);
  for (const bad of [{ ...packed, data: 'invalid' }, { ...packed, bytes: 1 }, { ...packed, fcatStorage: 'future-v2' }]) {
    store.values.set(key, bad);
    await expect(createStreamlinedJournal(store).read(record.context)).rejects.toThrow('JOURNAL_READ_FAILED');
    const set = vi.fn();
    expect((await compactFc27Storage({ ...store, set, locks })).failed).toBe(1); expect(set).not.toHaveBeenCalled();
  }
  store.values.set(key, record);
  expect((await compactFc27Storage({ ...store, set: async () => { throw Error('disk'); }, locks })).status).toBe('partial');
  expect(store.values.get(key)).toEqual(record);
});
it('bounds only optional derived caches across accounts, retaining the newest cache', async () => {
  const store = memory(), keepKey = 'fcat-fc27-gallery-score:"scope-9"';
  for (let i = 0; i < 10; i++) store.values.set(`fcat-fc27-gallery-score:"scope-${i}"`, {
    schema: 1, engine: 1, scope: `scope-${i}`, entries: [] });
  const record = await rawContribution(store), key = streamlinedJournalKey(record.context), before = JSON.stringify(store.values.get(key));
  expect(await trimGalleryDerivedCaches({ ...store, keepKey })).toBe(2);
  expect(store.values.get(keepKey)).not.toBeNull(); expect(JSON.stringify(store.values.get(key))).toBe(before);
  expect([...store.values.values()].filter(v => v?.engine === 1)).toHaveLength(8);
});
it('supports legacy raw storage and platforms without compression without altering records', async () => {
  const value = evidence(), codec = createCompactStorage(memory());
  expect(await decodeStoredValue(value)).toBe(value);
  const previous = globalThis.CompressionStream;
  try { globalThis.CompressionStream = undefined; expect(await encodeStoredValue(value)).toBe(value); }
  finally { globalThis.CompressionStream = previous; }
  await codec.set('fixture', value); expect(await codec.get('fixture', null)).toEqual(value);
  expect(streamlinedStorageKey('lock_26')).toBeNull();
  expect(streamlinedStorageKey(`${streamlinedJournalKey(testPlan().context)}:retired`)).toBeNull();
});
it('enforces the aggregate byte budget even below the key-count limit', async () => {
  const store = memory();
  for (let i = 0; i < 5; i++) store.values.set(`fcat-fc27-gallery-score:"scope-${i}"`, {
    schema: 1, engine: 1, scope: `scope-${i}`, entries: ['x'.repeat(2 * 1024 * 1024 - 200)] });
  expect(await trimGalleryDerivedCaches({ ...store, keepKey: 'fcat-fc27-gallery-score:"scope-4"' })).toBeGreaterThan(0);
  const total = [...store.values].reduce((sum, [key, value]) => sum + (value ? Buffer.byteLength(JSON.stringify({ [key]: `o${JSON.stringify(value)}` })) : 0), 0);
  expect(total).toBeLessThanOrEqual(8 * 1024 * 1024);
});
it.each(['futgg', 'fodder'])('recognizes the real %s mapping cache source for compaction and budgets', source => {
  expect(galleryDerivedCacheKey(`fcat-fc27-gallery-mapping:27:${source}:fixture`)).toEqual({ kind: 'mapping', source, scope: 'fixture' });
});
