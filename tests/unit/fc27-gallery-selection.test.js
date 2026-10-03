import { expect, it } from 'vitest';
import { filterGalleryCards, paginateGalleryCards, reconcileGallerySelection, selectCheapestGalleryCards, summarizeGallerySelection } from '../../src/gallery/selection.js';

const rows = [
  { eaId: 10, name: 'Beta', version: 'Gold', status: 'missing', collected: false, galleryScore: 50 },
  { eaId: 11, name: 'Alpha', version: 'Hero', status: 'collected', collected: true, galleryScore: 90 },
  { eaId: 12, name: 'Gamma', version: 'Silver', status: 'missing', collected: false, galleryScore: 70 },
  { eaId: 13, name: 'Delta', version: 'Gold', status: 'unknown', collected: null, galleryScore: 10 },
];

it('filters and sorts without mutating the pool', () => {
  expect(filterGalleryCards(rows, { filter: 'missing', order: 'name' }).map(row => row.eaId)).toEqual([10, 12]);
  expect(filterGalleryCards(rows, { query: 'hero' }).map(row => row.eaId)).toEqual([11]);
  expect(filterGalleryCards(rows, { order: 'price', prices: { 10: 600, 12: 200 } }).map(row => row.eaId)).toEqual([12, 10, 11, 13]);
  expect(rows.map(row => row.eaId)).toEqual([10, 11, 12, 13]);
});

it('paginates at a stable page size and clamps page', () => {
  const result = paginateGalleryCards(Array.from({ length: 49 }, (_, i) => ({ eaId: i + 1 })), { page: 9, pageSize: 24 });
  expect(result).toMatchObject({ page: 3, pages: 3, total: 49, pageSize: 24 });
  expect(result.rows).toHaveLength(1);
});

it('reconciles selection to currently missing exact versions', () => {
  const selection = new Map([['10', { name: 'old' }], ['11', { name: 'collected' }], ['99', { name: 'gone' }]]);
  expect([...reconcileGallerySelection(selection, rows).keys()]).toEqual(['10']);
});

it('selects the cheapest missing cards and summarizes unknown quotes', () => {
  expect(selectCheapestGalleryCards(rows, 2, { 10: 600, 12: 200 }).map(row => row.eaId)).toEqual([12, 10]);
  const summary = summarizeGallerySelection(new Map([['10', {}], ['12', {}]]), rows, { 10: 600 });
  expect(summary).toMatchObject({ count: 2, totalPrice: null, unknownPrice: true, score: 120 });
});

it.each([{ inClub: true }, { held: true }])('excludes held versions from selection, cost and cheapest purchases: %o', ownership => {
  const input = rows.map(row => row.eaId === 10 ? { ...row, ...ownership } : row);
  const selection = new Map([['10', {}], ['12', {}]]);
  expect([...reconcileGallerySelection(selection, input).keys()]).toEqual(['12']);
  expect(selectCheapestGalleryCards(input, 2, { 10: 1, 12: 200 }).map(row => row.eaId)).toEqual([12]);
  expect(summarizeGallerySelection(selection, input, { 10: 1, 12: 200 })).toMatchObject({ count: 1, totalPrice: 200 });
});
