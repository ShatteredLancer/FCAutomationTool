import { expect, it, vi } from 'vitest';
import { priceGalleryPlanningTargets } from '../../src/gallery/planning-prices.js';

const target = ids => ({ progress: { rows: ids.map(eaId => ({ eaId, collected: false })) }, prices: { 1: 90000 } });
const load = async ids => ({ source: 'public-references', policy: { source: 'futbin' },
  prices: Object.fromEntries(ids.map(id => [id, 200])), freshPrices: Object.fromEntries(ids.map(id => [id, 200])),
  references: Object.fromEntries(ids.map(id => [id, { definitionId: id }])), expiresAt: 5000 });
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
