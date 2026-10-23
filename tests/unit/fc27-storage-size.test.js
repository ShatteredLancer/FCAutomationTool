import { expect, it } from 'vitest';
import { createGalleryScoreCache } from '../../src/gallery/score-cache.js';
import { createGalleryMappingCache } from '../../src/gallery/mapping-cache.js';
import { createStreamlinedJournal } from '../../src/streamlined/journal.js';
import { testPlan } from '../helpers/streamlined.js';
import { decodeStoredValue } from '../../src/runtime/compact-storage.js';

const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const memory = () => {
  const values = new Map();
  return { values, get: async (key, fallback) => structuredClone(values.get(key) ?? fallback),
    set: async (key, value) => { values.set(key, structuredClone(value)); } };
};
it('compacts full unknown transaction evidence without making it disappear on reload', async () => {
  const store = memory(), journal = createStreamlinedJournal(store), plan = testPlan();
  const record = await journal.begin(plan);
  record.batches[0].state = 'unknown';
  record.evidence = { opaqueFutureField: 'complete-transaction-evidence;'.repeat(20000) };
  const written = await journal.write(plan.context, record, record.revision);
  expect(bytes([...store.values.values()][0])).toBeLessThan(64 * 1024);
  expect(await createStreamlinedJournal(store).read(plan.context)).toEqual(written);
  await expect(createStreamlinedJournal(store).begin(plan)).rejects.toThrow('RECOVERY_REQUIRED');
});
it('bounds score checkpoints by UTF-8 bytes rather than character count', async () => {
  const store = memory(), cache = createGalleryScoreCache(store);
  await cache.write('fixture-a', Array.from({ length: 8 }, (_, i) => ({ id: String(i), key: '球'.repeat(100000),
    summary: { status: 'calculated', lineup: [], low: { total: 1 }, high: { total: 1 } } })));
  expect(bytes([...store.values.values()][0])).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(bytes(await decodeStoredValue([...store.values.values()][0]))).toBeLessThanOrEqual(2 * 1024 * 1024);
});
it('bounds mapping checkpoints and reloads the newest retained entries', async () => {
  const store = memory(), cache = createGalleryMappingCache({ ...store, now: () => 100 });
  const state = await cache.read('fixture-a', 'futgg');
  for (let i = 0; i < 100; i++) state.rows.set(String(i), { setId: String(i), signature: 'x'.repeat(90000),
    poolRevision: '1', mappedAt: 100 });
  await cache.save(state, '1');
  expect(bytes([...store.values.values()][0])).toBeLessThanOrEqual(2 * 1024 * 1024);
  expect(bytes(await decodeStoredValue([...store.values.values()][0]))).toBeLessThanOrEqual(2 * 1024 * 1024);
  const restored = await createGalleryMappingCache({ ...store, now: () => 100 }).read('fixture-a', 'futgg');
  expect(restored.rows.has('99')).toBe(true);
  expect(restored.rows.size).toBeLessThan(100);
});
it('does not write oversized cache metadata even when the row list is empty', async () => {
  const store = memory(), cache = createGalleryMappingCache(store), state = await cache.read('fixture-a', 'futgg');
  await cache.save(state, 'x'.repeat(3 * 1024 * 1024));
  expect(store.values.size).toBe(0);
});
