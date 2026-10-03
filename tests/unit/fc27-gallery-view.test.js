import { expect, it } from 'vitest';
import { sameGalleryRuntimeCards, galleryGradeSegments, selectGallerySetIcon, galleryPlanningStateKey } from '../../src/adapters/browser/fc27-gallery-view.js';

it('invalidates planning for business inputs, not display hydration or observation timestamps', () => {
  const detail = { status: 'observed', scope: 'a', progress: { complete: true,
    rows: [{ eaId: 1, gradingScore: 100, collected: true, firstOwned: false }, { eaId: 2, galleryScore: 200, collected: false }] },
    priceSnapshot: { freshPrices: { 2: 300 }, expiresAt: Date.now() + 300000 } };
  const key = galleryPlanningStateKey(detail);
  expect(galleryPlanningStateKey({ ...detail, runtimeCards: new Map([[1, {}]]), fetchedAt: Date.now() })).toBe(key);
  expect(galleryPlanningStateKey({ ...detail, progress: { ...detail.progress, rows: [...detail.progress.rows].reverse(), updatedAt: 100 } })).toBe(key);
  for (const field of ['collected', 'inClub', 'held', 'gradingScore', 'firstOwned', 'holographic', 'positions']) {
    const changed = structuredClone(detail); changed.progress.rows[1][field] = field === 'positions' ? ['ST'] : field === 'gradingScore' ? 201 : true;
    expect(galleryPlanningStateKey(changed)).not.toBe(key);
  }
  expect(galleryPlanningStateKey({ ...detail, priceSnapshot: { ...detail.priceSnapshot, freshPrices: { 2: 400 } } })).not.toBe(key);
  expect(galleryPlanningStateKey({ ...detail, stale: true })).not.toBe(key);
});

it('draws score progress before all counting cards are collected, as Enhancer yPt does', () => {
  const grades = [10, 1300, 1800, 2800, 4100].map((threshold, index) => ({ name: ['D','C','B','A','S'][index], threshold }));
  const segments = galleryGradeSegments(grades, { status: 'calculated', full: false, low: { total: 500 }, high: { total: 500 } });
  expect(segments[0]).toMatchObject({ reached: true, current: true, fraction: 1 });
  expect(segments[1].fraction).toBeCloseTo(490 / 1290);
  expect(segments.slice(2).map(s => s.fraction)).toEqual([0,0,0]);
});

it('uses the known lower score for an interval without discarding it or drawing the upper estimate', () => {
  const grades = [10,7000,52500].map(threshold => ({ threshold }));
  const segments = galleryGradeSegments(grades, { status: 'uncertain', full: false, low: { total: 12235 }, high: { total: 16332 } });
  expect(segments[1]).toMatchObject({ reached: true, current: true, fraction: 1 });
  expect(segments[2].fraction).toBeCloseTo(5235 / 45500);
});

it('keeps unknown/zero scores empty and handles equal thresholds like Enhancer', () => {
  const grades = [10,400,600].map(threshold => ({ threshold }));
  for (const summary of [null, { status: 'calculating' }, { low: { total: 0 } }]) {
    expect(galleryGradeSegments(grades, summary).map(s => s.fraction)).toEqual([0,0,0]);
  }
  expect(galleryGradeSegments(grades, { low: { total: 35 } })[1].fraction).toBeCloseTo(25/390);
  expect(galleryGradeSegments([{threshold:10},{threshold:10}], {low:{total:10}})[1]).toMatchObject({fraction:1,current:true,reached:true});
});

it('selects one valid set image, rather than rendering the category-style image list', () => {
  const a = 'https://www.ea.com/a.png', b = 'https://www.ea.com/b.png';
  expect(selectGallerySetIcon([a,a,b], () => 0.9)).toBe(b);
  expect(selectGallerySetIcon([a,a,a], () => 0.5)).toBe(a);
  expect(selectGallerySetIcon([a], () => 0.9)).toBe(a);
  expect(selectGallerySetIcon(['',null])).toBe(null);
});

it('detects same-sized runtime card replacements so Hero/Holographics are rerendered', () => {
  const previous = new Map([[101, { version: 'old' }], [102, { version: 'same' }]]);
  const replacement = new Map([[101, { version: 'new' }], [102, previous.get(102)]]);
  expect(sameGalleryRuntimeCards(previous, replacement)).toBe(false);
  expect(sameGalleryRuntimeCards(previous, new Map([[101, previous.get(101)], [102, previous.get(102)]]))).toBe(true);
});

it('does not treat a different key with equal size as the same card snapshot', () => {
  const previous = new Map([[101, {}]]);
  expect(sameGalleryRuntimeCards(previous, new Map([[102, previous.get(101)]]))).toBe(false);
  expect(sameGalleryRuntimeCards(previous, new Map())).toBe(false);
});
