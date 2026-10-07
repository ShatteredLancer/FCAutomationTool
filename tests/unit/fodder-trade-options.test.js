import { expect, it } from 'vitest';
import { fodderAttemptCap, fodderListingPreview, planFodderListings, normalizeFodderBuyOptions } from '../../src/gallery/fodder-trade-options.js';
import { priceTiers } from '../fixtures/enhancer-listing-price-reference.js';

it('interpolates Fodder attempts, uses the minimum for one attempt, and never exceeds the frozen cap', () => {
  const params = { estimate: 1000, maxBuy: 1050, priceTiers, options: { minPct: 75, maxPct: 200, tries: 3 } };
  expect([1,2,3].map(attempt => fodderAttemptCap({ ...params, attempt }))).toEqual([750,1000,1000]);
  expect(fodderAttemptCap({ ...params, options: { ...params.options, tries: 1 }, attempt: 1 })).toBe(750);
  expect(fodderAttemptCap({ ...params, estimate: 200, maxBuy: 200, attempt: 3 })).toBe(200);
});
it.each([{ minPct: 70, maxPct: 100, tries: 3 }, { minPct: 100, maxPct: 95, tries: 3 }, { minPct: 100, maxPct: 101, tries: 3 }, { minPct: 100, maxPct: 100, tries: 6 }])('rejects invalid batch options %j', value => {
  expect(() => normalizeFodderBuyOptions(value)).toThrow('FC27_GALLERY_BATCH_OPTIONS_INVALID');
});
const candidates = [1,2,3].map(id => ({ item: { id, definitionId: id === 3 ? 200 : 100, pile: 'club' }, boughtFor: id === 1 ? 400 : null }));
const base = { candidates, prices: { 100: 1000, 200: 200 }, priceTiers };
it('uses additive adjustments, paid fallback and manual same-version inheritance without changing other versions', () => {
  expect(fodderListingPreview({ ...base, adjustment: 10 }).bins).toEqual({ 1: 1100, 2: 1100, 3: 200 });
  expect(fodderListingPreview({ ...base, from: 'paid', adjustment: 10 }).bins).toEqual({ 1: 450, 2: 1100, 3: 200 });
  expect(fodderListingPreview({ ...base, adjustment: 20, overrides: { 1: 250 } }).bins).toEqual({ 1: 250, 2: 250, 3: 250 });
  expect(fodderListingPreview({ ...base, adjustment: 0, overrides: { 1: 250, 2: 300 } }).bins).toEqual({ 1: 250, 2: 300, 3: 200 });
});
it('clamps to native limits and leaves market expiry independent of manual/paid prices', () => {
  const limitsByItem = Object.fromEntries(candidates.map(row => [row.item.id, { status: 'loaded', minimum: 150, maximum: 900 }]));
  const plan = planFodderListings({ ...base, selectedIds: [1,2,3], limitsByItem, durationSeconds: 3600 });
  expect(plan.entries.map(row => [row.startPrice, row.buyNow])).toEqual([[850,900],[850,900],[150,200]]);
  const expired = planFodderListings({ ...base, selectedIds: [1,2,3], limitsByItem, durationSeconds: 3600, quoteExpired: true, from: 'paid' });
  expect(expired.entries.map(row => row.item.id)).toEqual([1]);
  expect(expired.skipped.map(row => row.reason)).toEqual(['market-price-expired','market-price-expired']);
});
it('permits a refreshed selected version without extending an unrefreshed version expiry', () => {
  const plan = planFodderListings({ ...base, selectedIds: [1,2,3], durationSeconds: 3600, quoteExpired: true,
    quoteExpiresAt: { 100: 1100, 200: 900 }, now: 1000,
    limitsByItem: Object.fromEntries(candidates.map(row => [row.item.id, { status: 'loaded', minimum: 150, maximum: 10000 }])) });
  expect(plan.entries.map(row => row.item.id)).toEqual([1,2]);
  expect(plan.skipped).toEqual([{ itemId: 3, reason: 'market-price-expired' }]);
});
