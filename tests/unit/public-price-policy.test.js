import { expect, it } from 'vitest';
import { createPublicPricePolicyStore, publicPricePolicyKey, purchasePriceCap, normalizeGalleryPricePolicy } from '../../src/gallery/public-price-policy.js';

const tiers = [{ min: 100000, inc: 1000 }, { min: 50000, inc: 500 }, { min: 10000, inc: 250 }, { min: 1000, inc: 100 }, { min: 0, inc: 50 }];
it('persists account quote lifetime and defaults older accounts to five minutes', async () => {
  const data = new Map(), store = createPublicPricePolicyStore({ get: async (key, fallback) => data.get(key) ?? fallback,
    set: async (key, value) => data.set(key, value) });
  expect((await store.read('a')).quoteValidityMinutes).toBe(5);
  await store.save('a', { quoteValidityMinutes: 30 });
  expect((await store.read('a')).quoteValidityMinutes).toBe(30);
  expect((await store.read('b')).quoteValidityMinutes).toBe(5);
});
it.each([0, 31, 1.5, '10', NaN])('rejects invalid quote lifetime %s', quoteValidityMinutes => {
  expect(() => normalizeGalleryPricePolicy({ quoteValidityMinutes })).toThrow('FC27_PUBLIC_PRICE_POLICY_INVALID');
});
it('migrates account preferences to one reference and cache without changing frozen policy normalization', async () => {
  const legacy = { source: 'futbin', listingSource: 'futgg', futbinRefresh: 'force' };
  const data = new Map([[publicPricePolicyKey('a'), { schema: 1, scope: 'a', policy: legacy }]]);
  const store = createPublicPricePolicyStore({ get: async (key, fallback) => data.get(key) ?? fallback,
    set: async (key, value) => data.set(key, value) });
  expect(await store.read('a')).toMatchObject({ source: 'futbin', listingSource: 'futbin', futbinRefresh: 'cache' });
  expect(normalizeGalleryPricePolicy(legacy)).toMatchObject(legacy);
  expect(await store.save('a', legacy)).toMatchObject({ source: 'futbin', listingSource: 'futbin', futbinRefresh: 'cache' });
});
it('defaults legacy settings to enabled and rejects contradictory source/read settings', () => {
  expect(normalizeGalleryPricePolicy({ source: 'futbin' }).futbinEnabled).toBe(true);
  expect(() => normalizeGalleryPricePolicy({ source: 'futbin', futbinEnabled: false })).toThrow('FC27_PUBLIC_PRICE_POLICY_INVALID');
  expect(() => normalizeGalleryPricePolicy({ futbinEnabled: 'false' })).toThrow('FC27_PUBLIC_PRICE_POLICY_INVALID');
});
it('supports FUT.GG, FUTBIN and Both with an independent listing reference in Both mode', () => {
  expect(normalizeGalleryPricePolicy({ readSources: 'futgg' })).toMatchObject({ readSources: 'futgg', source: 'futgg', listingSource: 'futgg', futbinEnabled: false });
  expect(normalizeGalleryPricePolicy({ readSources: 'futbin' })).toMatchObject({ readSources: 'futbin', source: 'futbin', listingSource: 'futbin', futbinEnabled: true });
  expect(normalizeGalleryPricePolicy({ readSources: 'both', source: 'futbin', listingSource: 'futgg' }))
    .toMatchObject({ readSources: 'both', source: 'futbin', listingSource: 'futgg' });
  expect(() => normalizeGalleryPricePolicy({ readSources: 'futgg', source: 'futbin' })).toThrow('FC27_PUBLIC_PRICE_POLICY_INVALID');
  expect(() => normalizeGalleryPricePolicy({ readSources: 'both', listingSource: 'third-party' })).toThrow('FC27_PUBLIC_PRICE_POLICY_INVALID');
});
it.each([[200, 200], [275, 250], [999, 950], [1099, 1000], [10199, 10000], [50999, 50500], [100999, 100000]])
('never rounds a purchase cap %s upwards', (maxBuy, expected) => {
  expect(purchasePriceCap({ maxBuy, priceTiers: tiers })).toEqual(expected);
});
it('intersects explicit per-card cap, budget, balance, EA limits and frozen approval', () => {
  expect(purchasePriceCap({ maxBuy: 800, absoluteCap: 650, remainingBudget: 530, balance: 900,
    eaLimits: { minimum: 150, maximum: 700 }, approvedCap: 500, priceTiers: tiers })).toBe(500);
  expect(purchasePriceCap({ maxBuy: 800, balance: 149, priceTiers: tiers })).toBeNull();
  expect(purchasePriceCap({ maxBuy: 200, eaLimits: { minimum: 600, maximum: 10000 }, priceTiers: tiers })).toBeNull();
  expect(purchasePriceCap({ maxBuy: 200, remainingBudget: 0, priceTiers: tiers })).toBeNull();
  expect(purchasePriceCap({ maxBuy: 200, remainingBudget: -1, priceTiers: tiers })).toBeNull();
  expect(purchasePriceCap({ maxBuy: 200, priceTiers: [] })).toBeNull();
});
it('saves by account, never migrates global spending settings, and verifies writes', async () => {
  const data = new Map([['fcat-fc27-public-price-policy-v1', { source: 'futbin', premium: 1000 }]]);
  const store = createPublicPricePolicyStore({ get: async (key, fallback) => data.get(key) ?? fallback,
    set: async (key, value) => data.set(key, structuredClone(value)) });
  expect((await store.read('account-a')).source).toBe('futgg');
  await store.save('account-a', { source: 'futbin', premium: 50 });
  expect((await store.read('account-a')).premium).toBe(50);
  expect((await store.read('account-b')).premium).toBe(0);
  data.set(publicPricePolicyKey('account-a'), { schema: 1, scope: 'account-b', policy: {} });
  await expect(store.read('account-a')).rejects.toThrow('FC27_PUBLIC_PRICE_POLICY_INVALID');
});
it('does not default after storage corruption or failure', async () => {
  const broken = createPublicPricePolicyStore({ get: async () => { throw Error('secret'); }, set: async () => {} });
  await expect(broken.read('a')).rejects.toThrow('FC27_PUBLIC_PRICE_POLICY_READ_FAILED');
  const silent = createPublicPricePolicyStore({ get: async (_key, fallback) => fallback, set: async () => {} });
  await expect(silent.save('a', { premium: 100 })).rejects.toThrow('FC27_PUBLIC_PRICE_POLICY_SAVE_FAILED');
});
