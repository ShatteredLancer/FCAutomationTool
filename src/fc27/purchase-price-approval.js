import { galleryReferenceQuote, normalizeGalleryPricePolicy, validPublicPrice } from '../gallery/public-price-policy.js';

const fail = () => { throw Error('FC27_BUY_PRICE_APPROVAL_INVALID'); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => integer(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sources = ['futgg', 'futbin'];
function copyQuotes(reference, definitionId, season, platform) {
  if (reference?.definitionId !== definitionId || reference.season !== season || reference.platform !== platform) fail();
  return Object.fromEntries(sources.map(source => {
    const row = reference.quotes?.[source];
    if (row?.schema !== 2 || row.source !== source || row.definitionId !== definitionId || row.season !== season || row.platform !== platform
        || row.price !== null && !validPublicPrice(row.price) || !integer(row.fetchedAt) || !integer(row.expiresAt) || row.expiresAt <= row.fetchedAt
        || row.sourceUpdatedAt !== null && (!integer(row.sourceUpdatedAt) || row.sourceUpdatedAt > row.fetchedAt)
        || row.error !== null && !/^FC27_[A-Z0-9_]+$/.test(row.error)) fail();
    return [source, { schema: 2, source, definitionId, season, platform, price: row.price,
      fetchedAt: row.fetchedAt, sourceUpdatedAt: row.sourceUpdatedAt, expiresAt: row.expiresAt, error: row.error }];
  }));
}
function projected(quotes, policy, now) {
  const values = Object.fromEntries(sources.map(source => [source,
    quotes[source].fetchedAt <= now && quotes[source].expiresAt > now && !quotes[source].error ? quotes[source].price : null]));
  const result = galleryReferenceQuote(values, policy), selected = quotes[policy.source];
  return { estimate: result.estimate, maxBuy: result.maxBuy,
    reason: selected.fetchedAt > now || selected.expiresAt <= now ? 'FC27_BUY_REFERENCE_PRICE_EXPIRED'
      : result.estimate === null ? 'FC27_BUY_REFERENCE_PRICE_UNAVAILABLE' : null };
}
// This serializable approval is separate from mutation entries. Updating a
// receipt or reconciling a saved squad must never rewrite its price authority.
export function createPurchasePriceApproval({ scope, definitionIds, references, policy, season, platform, overrides = {}, now = Date.now() }) {
  policy = normalizeGalleryPricePolicy(policy);
  if (typeof scope !== 'string' || !scope || scope.length > 1000 || season !== '27' || !['pc', 'console'].includes(platform)
      || !integer(now) || !Array.isArray(definitionIds) || !definitionIds.length || definitionIds.length > 256
      || definitionIds.some(value => !validId(value)) || new Set(definitionIds).size !== definitionIds.length) fail();
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
      || Object.keys(overrides).some(key => !definitionIds.includes(Number(key)) || !validPublicPrice(overrides[key]))) fail();
  const rows = definitionIds.map(definitionId => {
    const quotes = copyQuotes(references?.[definitionId], definitionId, season, platform);
    const price = projected(quotes, policy, now), overrideCap = overrides[definitionId];
    return { definitionId, quotes, ...price, ...(overrideCap === undefined ? {} : { overrideCap,
      maxBuy: price.maxBuy === null ? null : overrideCap }) };
  });
  return { schema: 1, scope, season, platform, approvedAt: now, policy: { ...policy }, rows };
}
export function validatePurchasePriceApproval(approval, scope, definitionIds) {
  if (!approval || approval.schema !== 1 || approval.scope !== scope || !Array.isArray(approval.rows)
      || !Array.isArray(definitionIds) || approval.rows.some(row => !definitionIds.includes(row?.definitionId))) fail();
  const rebuilt = createPurchasePriceApproval({ scope, definitionIds: approval.rows.map(row => row.definitionId),
    references: Object.fromEntries(approval.rows.map(row => [row.definitionId, { ...row, season: approval.season, platform: approval.platform }])),
    policy: approval.policy, season: approval.season, platform: approval.platform, now: approval.approvedAt,
    overrides: Object.fromEntries(approval.rows.filter(row => row.overrideCap !== undefined).map(row => [row.definitionId, row.overrideCap])) });
  // Both read preferences were added after price approvals shipped. Neither
  // changes a frozen price/cap. Validate legacy records in their original
  // shape; do not rewrite receipts or apply today's account policy to them.
  for (const field of ['futbinEnabled', 'futbinRefresh', 'readSources', 'listingSource']) {
    if (!Object.hasOwn(approval.policy, field)) delete rebuilt.policy[field];
  }
  if (!same(rebuilt, approval)) fail();
}
export function purchaseApprovedPrice(approval, definitionId, { now = approval?.approvedAt, fresh = null } = {}) {
  const row = approval?.rows?.find(value => value.definitionId === definitionId);
  if (!row) throw Error('FC27_BUY_PRICE_APPROVAL_REQUIRED');
  if (!integer(now)) fail();
  const quotes = fresh ? copyQuotes(fresh, definitionId, approval.season, approval.platform) : row.quotes;
  const current = projected(quotes, approval.policy, now);
  // Missing original authority stays missing. Refresh can lower a cap or
  // restore freshness, but increasing it requires a new explicit approval.
  // An explicit retry cap is a new, user-approved ceiling. It may exceed the
  // original account policy, but it still requires a fresh valid selected
  // public quote; missing/expired quotes never become a purchase authority.
  const maxBuy = row.overrideCap === undefined
    ? (row.maxBuy === null || current.maxBuy === null ? null : Math.min(row.maxBuy, current.maxBuy))
    // Retry overrides are explicit per-version authority. The public quote is
    // still required and fresh, but the account default premium must not
    // silently clamp the value the user just approved.
    : (row.overrideCap === null || current.estimate === null ? null : row.overrideCap);
  return { ...current, maxBuy,
    approvedCap: row.maxBuy, reason: row.reason ?? current.reason };
}
export const purchasePriceApprovalFor = (record, definitionId) => record.priceOverrides?.[definitionId] ?? record.priceApproval;
export async function ensurePurchasePriceApproval({ record, scope, preparePrices, persist, assertCurrent }) {
  if (!record.priceApproval && typeof preparePrices === 'function') {
    const approval = await preparePrices(structuredClone(record));
    assertCurrent();
    validatePurchasePriceApproval(approval, scope, record.entries.map(entry => entry.definitionId));
    // Refuse a partial grant before buying the first item, not midway through.
    for (const entry of record.entries.filter(entry => entry.state === 'waiting')) purchaseApprovedPrice(approval, entry.definitionId);
    record.priceApproval = structuredClone(approval);
    await persist();
    assertCurrent();
  }
  return record.priceApproval ?? null;
}
