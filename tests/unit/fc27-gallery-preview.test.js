import { expect, it } from 'vitest';
import { previewGallerySelectionSteps, planGalleryGradeOverviewSteps } from '../../src/gallery/preview.js';
const exhaust = steps => { let next; do { next = steps.next(); } while (!next.done); return next.value; };
const catalog = { source: 'futgg', tags: [{ id: 1, name: 'FO', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
  rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'FIRST_OWNED', values: ['1'] }], tiers: [{ minItems: 1, bonus: 100 }] }] };
const set = { id: 'futgg:30', requiredCards: 2, grades: [{ name: 'D', threshold: 200 }, { name: 'S', threshold: 500 }] };
const progress = { season: '27', setId: 30, complete: true, rows: [
  { eaId: 1, collected: true, firstOwned: false, gradingScore: 100 },
  { eaId: 2, collected: false, firstOwned: true, gradingScore: null, galleryScore: 100 },
] };
it('previews the selected exact version as a purchase, never granting FO bonus', () => {
  const before = structuredClone(progress);
  const summary = exhaust(previewGallerySelectionSteps({ set, catalog, progress, selectedIds: [2] }));
  expect(summary).toMatchObject({ selectedCount: 1, estimated: true, full: true, low: { total: 200 }, grade: 'D' });
  expect(progress).toEqual(before);
});
it('retains unknown collection facts and ignores unknown/collected selected IDs', () => {
  const value = exhaust(previewGallerySelectionSteps({ set, catalog, progress: { ...progress, complete: false }, selectedIds: [1, 9] }));
  expect(value).toMatchObject({ status: 'partial', grade: null, selectedCount: 0 });
});
it('returns all grade costs and distinguishes an unreachable grade', () => {
  const output = exhaust(planGalleryGradeOverviewSteps({ set, catalog, progress, prices: { 2: 200 } }));
  expect(output.grades).toHaveLength(2);
  expect(output.grades[0]).toMatchObject({ status: 'ready', candidate: { totalPrice: 200 } });
  expect(output.grades[1].status).not.toBe('ready');
});
