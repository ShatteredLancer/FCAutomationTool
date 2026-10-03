import { expect, it } from 'vitest';
import { moveGalleryListingPrice, roundGalleryListingPrice, planGalleryListingPrices } from '../../src/gallery/listing-candidates.js';
import { referencePrices, priceTiers } from '../fixtures/enhancer-listing-price-reference.js';

const reference = referencePrices(priceTiers);
const candidates = [{ item: { id: 11, definitionId: 101, pile: 'club' } }];
const input = { candidates, priceTiers, marketPrices: new Map([[101, 1000]]),
  limitsByItem: new Map([[11, { status: 'loaded', minimum: 150, maximum: 15000000 }]]) };

it('compares tier rounding and all UI step choices against the captured reference', () => {
  const values = [150, 200, 750, 777, 950, 999, 1000, 1001, 1100, 9900, 9999, 10000, 10001,
    10250, 49750, 49999, 50000, 50001, 50500, 99500, 99999, 100000, 100001, 101000, 1000000];
  for (const value of values) {
    expect(roundGalleryListingPrice(value, priceTiers), `round ${value}`).toBe(reference.round(value));
    for (let steps = -20; steps <= 20; steps++) {
      expect(moveGalleryListingPrice(value, steps, priceTiers), `${value} / ${steps}`).toBe(reference.step(value, steps));
    }
  }
});
it('handles null fixed Start Bid and ignores stale fixed Start Bid outside fixed mode', () => {
  expect(planGalleryListingPrices({ ...input, settings: { priceMode: 'fixed', fixedPrice: 1000, fixedStartPrice: null } }).entries[0])
    .toMatchObject({ buyNow: 1000, startPrice: 950 });
  expect(planGalleryListingPrices({ ...input, settings: { priceMode: 'percentage', fixedStartPrice: 800 } }).entries[0])
    .toMatchObject({ buyNow: 1000, startPrice: 950 });
});
it('retains fixed BIN and exact per-item overrides without silently changing prices', () => {
  expect(planGalleryListingPrices({ ...input, settings: { priceMode: 'fixed', fixedPrice: 777, fixedStartPrice: 700 } }).entries[0])
    .toMatchObject({ buyNow: 777, startPrice: 700 });
  expect(planGalleryListingPrices({ ...input, marketPrices: new Map(), overridesByItem: new Map([[11, 600]]) }).entries[0])
    .toMatchObject({ buyNow: 600, startPrice: 550 });
  expect(planGalleryListingPrices({ ...input, overridesByItem: new Map([[101, 600]]) }).entries[0].buyNow).toBe(1000);
  expect(planGalleryListingPrices({ ...input, settings: { priceMode: 'fixed', fixedPrice: 15000000 } }).entries[0])
    .toMatchObject({ buyNow: 15000000, startPrice: reference.step(15000000, -1) });
});
it('uses the reference integer random percentage including zero and both endpoints', () => {
  const marketPrices = new Map([[101, 10000]]);
  for (const sample of [0, 0.49, 0.5, 0.51, 1]) {
    const result = planGalleryListingPrices({ ...input, marketPrices, settings: { percentageRange: [99, 101] }, random: () => sample });
    expect(result.entries[0].buyNow).toBe(reference.round(10000 * Math.round(sample * 2 + 99) / 100));
  }
  const zero = planGalleryListingPrices({ ...input, settings: { percentageRange: [0, 0] } });
  expect(zero.entries).toEqual([]); // Price zero is computed, then rejected, never replaced by 100%.
});
it('accepts all reference durations and rejects malformed configuration', () => {
  for (const durationSeconds of [3600, 10800, 21600, 43200, 86400, 259200]) {
    expect(planGalleryListingPrices({ ...input, settings: { durationSeconds } }).entries[0].durationSeconds).toBe(durationSeconds);
  }
  for (const settings of [{ durationSeconds: 0 }, { priceMode: 'invented' }]) {
    expect(planGalleryListingPrices({ ...input, settings }).status).toBe('blocked');
  }
  for (const tiers of [[], [...priceTiers].reverse(), [{ min: 0, inc: 0 }]]) {
    expect(moveGalleryListingPrice(1000, 1, tiers)).toBeNull();
  }
  expect(moveGalleryListingPrice(1000, Infinity, priceTiers)).toBeNull();
  expect(moveGalleryListingPrice(14999000, 20, priceTiers)).toBe(14999000);
});
it('skips unknown or out-of-range limits without clamping or stopping other rows', () => {
  for (const limits of [{ status: 'failed' }, { status: 'loaded', minimum: 1000, maximum: 2000 },
    { status: 'loaded', minimum: 150, maximum: 900 }]) {
    const result = planGalleryListingPrices({ ...input, limitsByItem: new Map([[11, limits]]) });
    expect(result.entries).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  }
  expect(planGalleryListingPrices({ ...input, marketPrices: new Map(), settings: { priceMode: 'fixed', fixedPrice: 1000 } }).entries).toHaveLength(1);
  expect(planGalleryListingPrices({ ...input, marketPrices: new Map([[101, null]]) }).entries).toEqual([]);
});
