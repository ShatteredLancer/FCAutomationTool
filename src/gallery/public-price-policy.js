// Shared purchase policy. Public references and actual auction offers are
// separate facts. This module has no runtime or network dependencies.
export const PUBLIC_PRICE_POLICY_KEY = 'fcat-fc27-public-price-policy-v1';
export const validPublicPrice = n => Number.isSafeInteger(n) && n >= 150 && n <= 15000000;
export function normalizeGalleryPricePolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('FC27_PUBLIC_PRICE_POLICY_INVALID');
  const readSources = value.readSources ?? (value.futbinEnabled === false ? 'futgg' : 'both');
  const policy = { source: value.source ?? (readSources === 'futbin' ? 'futbin' : 'futgg'), premiumMode: value.premiumMode ?? 'fixed', premium: value.premium ?? 0,
    purchaseAttempts: value.purchaseAttempts ?? 3, futbinEnabled: value.futbinEnabled ?? readSources !== 'futgg',
    futbinRefresh: value.futbinRefresh ?? 'cache', readSources,
    listingSource: value.listingSource ?? (readSources === 'futbin' ? 'futbin' : 'futgg') };
  if (!['futgg', 'futbin'].includes(policy.source) || !['fixed', 'percent'].includes(policy.premiumMode)
      || !Number.isSafeInteger(policy.premium) || policy.premium < 0
      || !Number.isSafeInteger(policy.purchaseAttempts) || policy.purchaseAttempts < 1
      || typeof policy.futbinEnabled !== 'boolean' || !policy.futbinEnabled && policy.source === 'futbin'
      || !['futgg', 'futbin', 'both'].includes(readSources) || policy.futbinEnabled !== (readSources !== 'futgg')
      || !['futgg', 'futbin'].includes(policy.listingSource)
      || readSources !== 'both' && (policy.source !== readSources || policy.listingSource !== readSources)
      || !['cache', 'force'].includes(policy.futbinRefresh)) throw Error('FC27_PUBLIC_PRICE_POLICY_INVALID');
  return Object.freeze(policy);
}
export const publicPriceSourceEnabled = (policy, source) =>
  (policy.readSources == null || policy.readSources === 'both' || policy.readSources === source)
  && (source !== 'futbin' || policy.futbinEnabled !== false);
export function galleryReferenceQuote(values, settings = {}) {
  const policy = normalizeGalleryPricePolicy(settings);
  const futgg = validPublicPrice(values?.futgg) ? values.futgg : null;
  const futbin = validPublicPrice(values?.futbin) ? values.futbin : null;
  const estimate = policy.source === 'futgg' ? futgg : futbin;
  const maxBuy = estimate === null ? null : Math.min(15000000, Math.floor(estimate
    + (policy.premiumMode === 'fixed' ? policy.premium : estimate * policy.premium / 100)));
  return { futgg, futbin, estimate, maxBuy, policy };
}
export function publicPricePolicyKey(scope) {
  if (typeof scope !== 'string' || !scope || scope.length > 1000) throw Error('FC27_PUBLIC_PRICE_SCOPE_INVALID');
  return `${PUBLIC_PRICE_POLICY_KEY}:${scope}`;
}
export function createPublicPricePolicyStore({ get, set }) {
  // Migrate account preferences only. Frozen plan/approval normalization must
  // retain its original fields and caps for journal validation.
  const currentSettings = value => {
    const policy = normalizeGalleryPricePolicy(value);
    return normalizeGalleryPricePolicy({ ...policy, listingSource: policy.source, futbinRefresh: 'cache' });
  };
  const read = async scope => {
    let saved;
    try { saved = await get(publicPricePolicyKey(scope), null); }
    catch { throw Error('FC27_PUBLIC_PRICE_POLICY_READ_FAILED'); }
    if (saved === null) return normalizeGalleryPricePolicy();
    if (saved?.schema !== 1 || saved.scope !== scope || !saved.policy) throw Error('FC27_PUBLIC_PRICE_POLICY_INVALID');
    return currentSettings(saved.policy);
  };
  return Object.freeze({ read, async save(scope, value) {
    const policy = currentSettings(value), key = publicPricePolicyKey(scope);
    try {
      await set(key, { schema: 1, scope, policy });
      if (JSON.stringify(await read(scope)) !== JSON.stringify(policy)) throw Error();
    } catch { throw Error('FC27_PUBLIC_PRICE_POLICY_SAVE_FAILED'); }
    return policy;
  } });
}
// EA's legal tiers are supplied by the adapter. Purchase ceilings always floor;
// Enhancer's nearest-step SELL rounding must never be used to raise a BUY cap.
export function purchasePriceCap({ maxBuy, approvedCap = null, absoluteCap = null, remainingBudget = null,
  balance = null, eaLimits = null, priceTiers }) {
  const limits = [maxBuy, approvedCap, absoluteCap, remainingBudget, balance, eaLimits?.maximum].filter(n => n != null);
  if (!validPublicPrice(maxBuy) || limits.some(n => !Number.isSafeInteger(n) || n < 0)
      || !Array.isArray(priceTiers) || !priceTiers.length || priceTiers.length > 32
      || priceTiers.some((tier, index) => !Number.isSafeInteger(tier?.min) || tier.min < 0
        || !Number.isSafeInteger(tier.inc) || tier.inc < 1 || index > 0 && tier.min >= priceTiers[index - 1].min)
      || eaLimits != null && (!validPublicPrice(eaLimits.minimum) || !validPublicPrice(eaLimits.maximum)
        || eaLimits.maximum < eaLimits.minimum)) return null;
  const cap = Math.min(...limits), tier = priceTiers.find(row => cap >= row.min);
  if (!tier) return null;
  const rounded = Math.floor(cap / tier.inc) * tier.inc;
  return rounded >= Math.max(150, eaLimits?.minimum ?? 150) ? rounded : null;
}
