import { expect, it } from 'vitest';
import input from '../fixtures/fc27-gallery-cost-replay.json';
import { galleryPriceBands, galleryPriceBandSeedSteps } from '../../src/gallery/price-band-seeds.js';
import { refineGalleryCostSteps } from '../../src/gallery/cost-search.js';
import { summarizeGalleryScore } from '../../src/gallery/scoring.js';

const candidates = input.progress.rows.filter(row => !row.collected)
  .map(row => ({ id: row.eaId, price: input.prices[row.eaId], score: row.gradingScore }));
function firstSeed(steps) {
  let next;
  do { next = steps.next(); } while (!next.done && !next.value.ids);
  steps.return();
  return next.value;
}

it('prioritizes actual price jumps, keeps expensive routes, and ignores missing quotes', () => {
  expect(galleryPriceBands(candidates)[0]).toBe(3900);
  expect(galleryPriceBands(candidates).at(-1)).toBe(80500);
  expect(galleryPriceBands([{ price: null }, { price: 0 }, { price: 100 }, { price: 101 }, { price: 1000 }]))
    .toEqual([101, 100, 1000]);
  expect(galleryPriceBands(candidates.map(row => ({ ...row, price: row.price * 2 })))[0]).toBe(7800);
});

it('finds the combined bonus witness as its first complete seed with no owned purchases', () => {
  const before = structuredClone(input);
  const seed = firstSeed(galleryPriceBandSeedSteps({ targets: [input], candidates }));
  expect(seed.work).toBeLessThan(8000);
  expect(seed.ids).toHaveLength(12);
  expect(seed.ids.reduce((sum, id) => sum + input.prices[id], 0)).toBe(13850);
  expect(seed.ids.every(id => !input.progress.rows.find(row => row.eaId === id).collected)).toBe(true);
  const summary = summarizeGalleryScore({ ...input, progress: { ...input.progress,
    rows: input.progress.rows.map(row => seed.ids.includes(row.eaId) ? { ...row, collected: true, firstOwned: false } : row) } });
  expect(summary.low.total).toBe(7830);
  expect(input).toEqual(before);
});

it('unions shared exact versions once across targets', () => {
  const second = { ...input, set: { ...input.set, id: 'futgg:42' }, progress: { ...input.progress, setId: 42 } };
  const seed = firstSeed(galleryPriceBandSeedSteps({ targets: [input, second], candidates }));
  expect(seed.ids).toHaveLength(12);
  expect(new Set(seed.ids).size).toBe(12);
});

it('bounds score work and obeys cancellation during the first price band', () => {
  const steps = galleryPriceBandSeedSteps({ targets: [input], candidates, maxWork: 3 });
  expect([...steps]).toEqual([{ work: 1 }, { work: 2 }, { work: 3 }]);
  const cancelled = galleryPriceBandSeedSteps({ targets: [input], candidates });
  expect(cancelled.next().value).toEqual({ work: 1 });
  expect(cancelled.next(true).done).toBe(true);
});

it.each(['deadline', 'discard'])('closes seed work and preserves completed plans on %s', mode => {
  let closed = false;
  function* seeds() { try { yield { work: 1, ids: [2] }; yield { work: 2 }; } finally { closed = true; } }
  const steps = refineGalleryCostSteps({ initial: { ids: [1], cost: 100 }, candidates: [{ id: 2, price: 200 }],
    seedSteps: seeds(), maxEvaluations: 2, evaluate: ids => ({ ids, cost: 200 }),
    measure: state => ({ reached: state.ids.includes(2), progress: state.ids.includes(2) ? 1 : 0 }) });
  expect(steps.next().value).toMatchObject({ evaluations: 1 });
  if (mode === 'deadline') expect(steps.next(true).value.plans).toEqual([{ ids: [2], cost: 200 }]);
  else steps.return();
  expect(closed).toBe(true);
});
