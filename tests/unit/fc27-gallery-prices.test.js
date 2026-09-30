import { expect, it } from 'vitest';
import { parseGalleryPriceResponse, readCachedGalleryPrice, readCachedGalleryPrices } from '../../src/gallery/prices.js';

it('parses the FC27 FUT.GG batch response and ignores malformed prices', () => {
  expect(parseGalleryPriceResponse(JSON.stringify({ data: [
    { eaId: 900001, price: 8300 }, { definitionId: 900002, price: '12500' },
    { eaId: 0, price: 500 }, { eaId: 900003, price: 0 }, { eaId: 900004, price: 'bad' },
  ] }))).toEqual({ '900001': 8300, '900002': 12500 });
  expect(parseGalleryPriceResponse('{bad json')).toEqual({});
});

it('reads only already populated FSU prices by definition id', () => {
  const root = { info: { roster: { data: { '900001': { n: 550000, y: 1 }, '900002': { n: 0 }, '900003': { n: 'bad' } } } } };
  expect(readCachedGalleryPrices(root, [900001, 900002, 900003, 0])).toEqual({ '900001': 550000 });
  expect(readCachedGalleryPrice(root, 900001)).toBe(550000);
  expect(readCachedGalleryPrice(root, 900002)).toBeNull();
});

it('does not request or invent missing prices', () => {
  const root = { info: { roster: { data: {} } } };
  expect(readCachedGalleryPrices(root, [900001])).toEqual({});
  expect(readCachedGalleryPrice(root, 900001)).toBeNull();
});
