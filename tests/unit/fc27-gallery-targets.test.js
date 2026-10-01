import { expect, it, vi } from 'vitest';
import { createGalleryTargetStore, reconcileGalleryTargets } from '../../src/gallery/targets.js';

const value = () => ({ targets: [{ setId: 'futgg:30', grade: 'C' }], budget: 0 });
function harness(options = {}) {
  const data = new Map();
  const get = vi.fn(async key => data.get(key) ?? null);
  const set = vi.fn(async (key, row) => { data.set(key, structuredClone(row)); });
  return { data, get, set, store: createGalleryTargetStore({ get, set, ...options }) };
}

it('persists only scoped target grades/budget and restores across instances', async () => {
  const t = harness();
  await t.store.save('account-a:pc:27', 'futgg', { ...value(), credentials: 'private', plan: { executable: true } });
  const next = createGalleryTargetStore(t);
  expect(await next.load('account-a:pc:27', 'futgg')).toEqual({ status: 'observed', ...value() });
  expect([...t.data.values()][0]).not.toHaveProperty('plan');
  expect([...t.data.values()][0]).not.toHaveProperty('credentials');
  expect(await next.load('account-b:pc:27', 'futgg')).toMatchObject({ targets: [], budget: null });
  expect(await next.load('account-a:pc:27', 'fodder')).toMatchObject({ targets: [], budget: null });
});

it('preserves empty targets, no budget, and explicit zero budget', async () => {
  const t = harness();
  for (const budget of [0, null, 15000000]) {
    await t.store.save('account-a', 'futgg', { targets: [], budget });
    expect(await t.store.load('account-a', 'futgg')).toMatchObject({ targets: [], budget });
  }
});

it('rejects malformed/duplicate/cross-source preferences without writing', async () => {
  const t = harness();
  for (const input of [{ targets: value().targets, budget: -1 }, { targets: [...value().targets, ...value().targets], budget: null },
    { targets: [{ setId: 'fodder:other', grade: 'C' }], budget: null }, { targets: [{ setId: 'futgg:30', grade: 'X' }], budget: null }]) {
    expect(await t.store.save('account-a', 'futgg', input)).toMatchObject({ status: 'unavailable' });
  }
  expect(t.set).not.toHaveBeenCalled();
});

it('treats damaged or differently bound records as unavailable rather than valid empty state', async () => {
  for (const record of [{ schema: 9 }, { schema: 1, scope: 'other', source: 'futgg', ...value() },
    { schema: 1, scope: 'account-a', source: 'futgg', targets: value().targets, budget: '0' }]) {
    const t = harness({ get: async () => record });
    expect(await t.store.load('account-a', 'futgg')).toMatchObject({ status: 'unavailable', reason: 'FC27_GALLERY_TARGETS_READ_FAILED' });
  }
});

it('isolates storage failures and permits the next save to recover', async () => {
  const set = vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(undefined);
  const t = harness({ get: async () => { throw new Error('private'); }, set });
  expect(await t.store.load('account-a', 'futgg')).toMatchObject({ status: 'unavailable' });
  expect(await t.store.save('account-a', 'futgg', value())).toMatchObject({ status: 'unavailable' });
  expect(await t.store.save('account-a', 'futgg', value())).toEqual({ status: 'observed' });
});

it('serializes rapid saves, capturing account and immutable snapshot before queued execution', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const set = vi.fn().mockImplementationOnce(async () => gate).mockResolvedValue(undefined);
  const t = harness({ set });
  const first = t.store.save('account-a', 'futgg', value());
  const input = value(); input.budget = 500;
  const second = t.store.save('account-a', 'futgg', input); input.budget = 600;
  const third = t.store.save('account-b', 'futgg', { targets: [], budget: null });
  await Promise.resolve(); expect(set).toHaveBeenCalledTimes(1); release();
  await Promise.all([first, second, third]);
  expect(set).toHaveBeenCalledTimes(3);
  expect(set.mock.calls[1][1]).toMatchObject({ scope: 'account-a', budget: 500 });
  expect(set.mock.calls[2][1]).toMatchObject({ scope: 'account-b', budget: null });
  expect(set.mock.calls[0][0]).not.toEqual(set.mock.calls[2][0]);
});

it('supports the catalogue composite slug identity for a Fodder collection', async () => {
  const t = harness();
  const input = { targets: [{ setId: 'fodder:premier-league/arsenal', grade: 'S' }], budget: null };
  await t.store.save('account-a', 'fodder', input);
  expect(await t.store.load('account-a', 'fodder')).toMatchObject(input);
});

it('waits for an in-flight preference save before restoring in the same store', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const t = harness({ set: async (key, row) => { await gate; t.data.set(key, row); } });
  const saving = t.store.save('account-a', 'futgg', value());
  const loading = t.store.load('account-a', 'futgg');
  await Promise.resolve();
  expect(t.get).not.toHaveBeenCalled();
  release();
  await saving;
  expect(await loading).toMatchObject(value());
});

it('retains stable goals on rename/threshold updates and removes missing grades or retired sets', () => {
  const catalog = { source: 'futgg', categories: [{ sets: [{ id: 'futgg:30', name: 'Renamed', grades: [{ name: 'C', threshold: 900 }] }] }] };
  const input = { targets: [...value().targets, { setId: 'futgg:31', grade: 'D' }], budget: 0 };
  expect(reconcileGalleryTargets(input, catalog)).toEqual(value());
  catalog.categories[0].sets[0].grades = [{ name: 'D' }];
  expect(reconcileGalleryTargets(input, catalog)).toEqual({ targets: [], budget: 0 });
  expect(input.targets).toHaveLength(2);
});
