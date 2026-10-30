import { expect, it, vi } from 'vitest';
import { priceGalleryPlanningTargets, loadGalleryPriceSnapshot } from '../../src/gallery/planning-prices.js';

const target = ids => ({ progress: { rows: ids.map(eaId => ({ eaId, collected: false })) }, prices: { 1: 90000 } });
const load = async ids => ({ source: 'public-references', policy: { source: 'futbin' },
  prices: Object.fromEntries(ids.map(id => [id, 200])), freshPrices: Object.fromEntries(ids.map(id => [id, 200])),
  references: Object.fromEntries(ids.map(id => [id, { definitionId: id }])), expiresAt: 5000 });
it('quotes all 341 display cards including collected cards in legal batches', async () => {
  const rows = Array.from({ length: 341 }, (_, i) => ({ eaId: i + 1, collected: i < 11 }));
  const loader = vi.fn(async (ids, options) => ({ ...await load(ids, options), expiresAt: ids[0] === 1 ? 5000 : 4000 }));
  const result = await loadGalleryPriceSnapshot(rows, { load: loader });
  expect(loader.mock.calls.map(([ids]) => ids.length)).toEqual([250, 91]);
  expect(Object.keys(result.references)).toHaveLength(341);
  expect(result.freshPrices[1]).toBe(200);
  expect(result.expiresAt).toBe(4000);
  expect(loader.mock.calls[1][1].policy).toEqual({ source: 'futbin' });
});
it('rejects interrupted or changed-source display batches instead of publishing a mixed snapshot', async () => {
  const rows = Array.from({ length: 251 }, (_, i) => ({ eaId: i + 1 }));
  const loader = vi.fn(async ids => ({ ...await load(ids), policy: { source: ids[0] === 1 ? 'futgg' : 'futbin' } }));
  await expect(loadGalleryPriceSnapshot(rows, { load: loader })).rejects.toThrow('RESPONSE_INVALID');
  let current = true;
  await expect(loadGalleryPriceSnapshot(rows, { current: () => current, load: async ids => {
    current = false; return load(ids);
  } })).rejects.toThrow('CONTEXT_CHANGED');
});
it('does not quote unknown or held versions and preserves their collection facts', async () => {
  const t = target([1, 2, 3]); t.progress.rows[0].collected = null; t.progress.rows[1].held = true;
  const before = structuredClone(t), loader = vi.fn(load);
  await priceGalleryPlanningTargets([t], { load: loader });
  expect(loader.mock.calls[0][0]).toEqual([3]); expect(t).toEqual(before);
});
it('deduplicates overlapping sets, excludes owned cards and replaces every EA/old cost together', async () => {
  const targets = [target([1,2,3]), target([2,3,4])]; targets[0].progress.rows[0].collected = true;
  const before = structuredClone(targets), loader = vi.fn(load);
  const result = await priceGalleryPlanningTargets(targets, { load: loader });
  expect(loader).toHaveBeenCalledTimes(1); expect(loader.mock.calls[0][0]).toEqual([2,3,4]);
  expect(result[0].prices).toEqual({ 2: 200, 3: 200, 4: 200 });
  expect(result[0].priceSnapshot).toBe(result[1].priceSnapshot); expect(targets).toEqual(before);
});
it('batches at the verified service limit, freezes the policy and exposes cancellable progress', async () => {
  const loader = vi.fn(load), progress = [];
  await priceGalleryPlanningTargets([target(Array.from({ length: 251 }, (_, i) => i + 1))], { load: loader, onProgress: p => progress.push(p) });
  expect(loader.mock.calls.map(([ids]) => ids.length)).toEqual([250,1]);
  expect(loader.mock.calls[1][1].policy).toEqual({ source: 'futbin' });
  const stopped = vi.fn(load);
  await expect(priceGalleryPlanningTargets([target([1])], { load: stopped, current: () => false })).rejects.toThrow('CONTEXT_CHANGED');
  expect(stopped).not.toHaveBeenCalled();
});

it('renews only near-expiry authority quotes once, without extending old timestamps or reading comparison sources', async () => {
  const now = 1000000, t = target([1, 2]), policy = { source: 'futbin' };
  const reference = (id, fetchedAt) => ({ definitionId: id, quotes: { futbin: {
    fetchedAt, expiresAt: fetchedAt + 300000, price: 200, error: null } } });
  const first = { source: 'public-references', policy, prices: { 1: 200, 2: 200 }, freshPrices: { 1: 200, 2: 200 },
    references: { 1: reference(1, now - 275000), 2: reference(2, now) }, expiresAt: now + 25000 };
  const before = structuredClone(first);
  const loader = vi.fn(async (ids, options) => options.force ? {
    source: 'public-references', policy, prices: { 1: 250 }, freshPrices: { 1: 250 },
    references: { 1: { ...reference(1, now), estimate: 250 } }, expiresAt: now + 300000,
  } : structuredClone(first));
  const [priced] = await priceGalleryPlanningTargets([t], { load: loader, now: () => now });
  expect(loader.mock.calls.map(([ids]) => ids)).toEqual([[1, 2], [1]]);
  expect(loader.mock.calls.every(([, options]) => options.purpose === 'gallery-plan' && options.deadlineAt === now + 90000)).toBe(true);
  expect(loader.mock.calls[1][1]).toMatchObject({ force: true, policy });
  expect(priced.prices).toEqual({ 1: 250, 2: 200 });
  expect(priced.priceSnapshot.expiresAt).toBe(now + 300000);
  expect(first).toEqual(before);
});

it.each([false, true])('reports missing planning prices rather than launching an unpriced league search (budget expired: %s)', async budgetExpired => {
  const loader = vi.fn(async () => ({ source: 'public-references', policy: { source: 'futbin' }, prices: {}, freshPrices: {},
    references: {}, expiresAt: null, budgetExpired }));
  await expect(priceGalleryPlanningTargets([target([1])], { load: loader })).rejects
    .toThrow(budgetExpired ? 'FC27_GALLERY_PLAN_PRICE_TIMEOUT' : 'FC27_GALLERY_PLAN_PRICE_UNAVAILABLE');
  expect(loader).toHaveBeenCalledTimes(1);
});

it('shares one price deadline across league pages and leaves display-only reads unchanged', async () => {
  let now = 1000000;
  const loader = vi.fn(async ids => { now += 100; return load(ids); });
  const [priced] = await priceGalleryPlanningTargets([target(Array.from({ length: 309 }, (_, i) => i + 1))], { load: loader, now: () => now });
  expect(loader.mock.calls.map(([ids]) => ids.length)).toEqual([250, 59]);
  expect(loader.mock.calls.every(([, options]) => options.deadlineAt === 1090000 && options.purpose === 'gallery-plan')).toBe(true);
  expect(Object.keys(priced.prices)).toHaveLength(309);
  loader.mockClear(); await loadGalleryPriceSnapshot([{ eaId: 1 }], { load: loader });
  expect(loader.mock.calls[0][1].purpose).toBeUndefined();
  expect(loader.mock.calls[0][1].deadlineAt).toBeUndefined();
});

it.each(['failed', 'source-changed', 'cancelled'])('does not reuse old authority prices when renewal is %s', async mode => {
  const now = 1000000; let current = true;
  const loader = vi.fn(async (_ids, options) => {
    if (options.force) {
      if (mode === 'cancelled') current = false;
      return { ...await load([1]), policy: { source: mode === 'source-changed' ? 'futgg' : 'futbin' },
        prices: {}, freshPrices: {}, references: {}, expiresAt: null };
    }
    return { ...await load([1]), expiresAt: now + 25000, references: { 1: { quotes: { futbin: {
      fetchedAt: now - 275000, expiresAt: now + 25000, price: 200, error: null } } } } };
  });
  await expect(priceGalleryPlanningTargets([target([1])], { load: loader, now: () => now, current: () => current })).rejects
    .toThrow(mode === 'failed' ? 'PRICE_UNAVAILABLE' : mode === 'source-changed' ? 'RESPONSE_INVALID' : 'CONTEXT_CHANGED');
  expect(loader).toHaveBeenCalledTimes(2);
});
