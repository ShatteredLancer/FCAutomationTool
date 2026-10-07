import { galleryPurchaseKey, galleryPurchasePendingKey, validateGalleryPurchaseRecord } from './purchase-session.js';
import { traditionalJournalScope } from '../fc27/traditional-journal.js';

const id = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blocked = reason => ({ status: 'blocked', reason, entries: [] });
const pendingStates = new Set(['buy-pending', 'bought', 'move-pending', 'move-rejected']);

// This is a receipt projection, not proof of current ownership or authority to
// list. 'collected' means skipped BEFORE buying, not a purchased entity.
export function projectGalleryListingReceipts({ purchase, scope, context, expectedOperationId, expectedBinding,
  pendingMarker = null } = {}) {
  try {
    if (traditionalJournalScope(context) !== scope) return blocked('FC27_GALLERY_LISTING_SCOPE_CHANGED');
    validateGalleryPurchaseRecord(purchase, scope, context);
    if (!expectedOperationId || purchase.operationId !== expectedOperationId
        || !expectedBinding || purchase.binding !== expectedBinding) return blocked('FC27_GALLERY_LISTING_PURCHASE_CHANGED');
    if (pendingMarker !== null || purchase.entries.some(entry => pendingStates.has(entry.state))) {
      return blocked('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
    }
    if (purchase.destination !== 'unassigned' && purchase.collection?.status !== 'confirmed') return blocked('FC27_GALLERY_COLLECTION_UNCONFIRMED');
    const acquired = purchase.entries.filter(entry => ['club', 'unassigned'].includes(entry.state));
    if (new Set(acquired.map(entry => entry.itemId)).size !== acquired.length
        || new Set(acquired.map(entry => entry.tradeId)).size !== acquired.length) {
      return blocked('FC27_GALLERY_LISTING_RECEIPT_CONFLICT');
    }
    return { status: 'observed', scope, context: structuredClone(context), operationId: purchase.operationId,
      binding: purchase.binding, entries: acquired.map(entry => ({ itemId: entry.itemId, definitionId: entry.definitionId,
        tradeId: entry.tradeId, purchasePrice: entry.price, ...(entry.state === 'unassigned' ? { pile: 'unassigned' } : {}) })),
      skipped: purchase.entries.filter(entry => !['club', 'unassigned'].includes(entry.state)).map(entry => ({ definitionId: entry.definitionId,
        reason: entry.state === 'collected' ? 'already-collected-not-purchased' : 'not-purchased' })),
      executionEnabled: false };
  } catch { return blocked('FC27_GALLERY_LISTING_PURCHASE_UNCONFIRMED'); }
}

// Snapshot DTOs only. Ownership/protection flags must be resolved by the EA
// adapter before calling this helper. No getters or raw entities in the plan.
export function projectGalleryListingCandidates({ source, items } = {}) {
  if (source?.status !== 'observed' || !Array.isArray(source.entries) || !Array.isArray(items)) {
    return blocked('FC27_GALLERY_LISTING_INPUT_UNCONFIRMED');
  }
  if (!Array.isArray(source.skipped) || source.entries.some(row => !id(row?.itemId) || !id(row?.definitionId))
      || new Set(source.entries.map(row => row.itemId)).size !== source.entries.length
      || items.some(item => !id(item?.id) || !id(item?.definitionId))
      || new Set(items.map(item => item.id)).size !== items.length) return blocked('FC27_GALLERY_LISTING_ITEM_CONFLICT');
  const byId = new Map(items.map(item => [item.id, item]));
  const entries = [], skipped = [...source.skipped];
  for (const receipt of source.entries) {
    const item = byId.get(receipt.itemId);
    let reason = null;
    if (!item || item.definitionId !== receipt.definitionId) reason = 'purchased-item-not-found';
    else if (!['club', 'unassigned', 'transfer'].includes(item.pile)) reason = 'purchased-item-no-longer-in-club';
    else if (item.tradeable !== true) reason = 'not-tradeable';
    else if (item.eligibleForListing !== true) reason = 'listing-protection-unconfirmed';
    if (reason) { skipped.push({ itemId: receipt.itemId, definitionId: receipt.definitionId, reason }); continue; }
    entries.push({ item: { id: item.id, definitionId: item.definitionId, pile: item.pile }, purchase: { ...receipt } });
  }
  return { status: 'observed', operationId: source.operationId, entries, skipped, count: entries.length, executionEnabled: false };
}

export async function readGalleryListingSource({ scope, context, expectedOperationId, expectedBinding,
  get, exclusive, assertCurrent } = {}) {
  try {
    const result = await exclusive(scope, async () => {
      assertCurrent();
      const key = galleryPurchaseKey(scope), pendingKey = galleryPurchasePendingKey(scope);
      const purchase = structuredClone(await get(key, null)), marker = structuredClone(await get(pendingKey, null));
      assertCurrent();
      const source = projectGalleryListingReceipts({ purchase, scope, context, expectedOperationId, expectedBinding, pendingMarker: marker });
      if (source.status !== 'observed') return source;
      const current = await get(key, null), pending = await get(pendingKey, null);
      assertCurrent();
      if (!same(purchase, current) || !same(marker, pending)) return blocked('FC27_GALLERY_LISTING_PURCHASE_CHANGED');
      return source;
    });
    return result ?? blocked('FC27_GALLERY_PURCHASE_BUSY');
  } catch (error) {
    return blocked(/^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_LISTING_SOURCE_UNAVAILABLE');
  }
}

export const GALLERY_LISTING_MIN_PRICE = 150;
export const GALLERY_LISTING_MAX_PRICE = 14999000;

function normalizeTiers(input) {
  if (!Array.isArray(input) || !input.length || input.length > 32
      || input.some((tier, index) => !Number.isSafeInteger(tier?.min) || tier.min < 0
        || !id(tier.inc) || index > 0 && tier.min >= input[index - 1].min)) return null;
  return input.map(({ min, inc }) => ({ min, inc }));
}

function tierFor(value, tiers, direction) {
  return tiers.find(tier => direction > 0 ? value >= tier.min : value > tier.min) ?? null;
}

function tierUpper(tier, tiers) {
  const index = tiers.indexOf(tier);
  return index === 0 ? GALLERY_LISTING_MAX_PRICE : Math.max(0, tiers[index - 1]?.min - 1);
}

// Independent implementation of the observed Enhancer tier behavior.
// PRICE_TIERS is injected; this module does not read EA globals.
export function moveGalleryListingPrice(value, steps, priceTiers) {
  const tiers = normalizeTiers(priceTiers);
  let current = value, remaining = steps;
  if (!Number.isFinite(current) || current < 0 || current > 15000000
      || !Number.isSafeInteger(steps) || Math.abs(steps) > 20 || !tiers) return null;
  while (remaining !== 0) {
    const direction = remaining > 0 ? 1 : -1;
    if (direction > 0 && current >= GALLERY_LISTING_MAX_PRICE) return GALLERY_LISTING_MAX_PRICE;
    const tier = tierFor(current, tiers, direction);
    if (!tier) return current;
    const capacity = direction > 0
      ? Math.floor((tierUpper(tier, tiers) - current) / tier.inc) + 1
      : Math.floor((current - tier.min) / tier.inc) + (current % tier.inc !== 0 ? 1 : 0);
    if (capacity <= 0) return null;
    if (Math.abs(remaining) <= capacity) {
      return Math.max(tier.min, Math.min(GALLERY_LISTING_MAX_PRICE,
        Math.round((current + remaining * tier.inc) / tier.inc) * tier.inc));
    }
    current += direction * capacity * tier.inc;
    remaining -= direction * capacity;
  }
  return current;
}

export function roundGalleryListingPrice(value, priceTiers, minimum = 0) {
  const tiers = normalizeTiers(priceTiers), numeric = value;
  if (!tiers || !Number.isFinite(numeric) || !Number.isFinite(minimum)) return null;
  const tier = tierFor(numeric, tiers, 1);
  return tier ? Math.max(minimum, Math.min(GALLERY_LISTING_MAX_PRICE, Math.round(numeric / tier.inc) * tier.inc))
    : Math.max(numeric, minimum);
}

function readValue(map, key) { return map instanceof Map ? map.get(key) : map?.[key]; }
function percentage(range, random) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const [min, max] = range, sample = random();
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 200 || max < min
      || !Number.isFinite(sample) || sample < 0 || sample > 1) return null;
  return Math.round(sample * (max - min) + min);
}
function limitsOf(value) {
  if (value?.status !== 'loaded') return null;
  const { minimum, maximum } = value;
  return Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum) && minimum >= GALLERY_LISTING_MIN_PRICE
    && maximum >= minimum && maximum <= 15000000 ? { minimum, maximum } : null;
}

// Enhancer gMt/yMt: price ALL rows before applying the override map. This
// calculation deliberately precedes eligibility/limits checks. A rejected
// preview (including zero) must remain frozen when selection changes.
export function previewGalleryListingPrices({ candidates = [], marketPrices = {}, settings = {},
  priceTiers, overridesByItem = {}, random = Math.random } = {}) {
  const result = {};
  for (const candidate of candidates) {
    const quote = readValue(marketPrices, candidate.item.definitionId), market = quote?.price ?? quote;
    let value = null;
    if (settings.priceMode === 'fixed') value = settings.fixedPrice ?? null;
    else if (Number.isFinite(market)) {
      if (settings.priceMode === 'steps') value = moveGalleryListingPrice(market, settings.steps ?? 0, priceTiers);
      else {
        const pct = percentage(settings.percentageRange ?? [100, 100], random);
        if (pct !== null) value = roundGalleryListingPrice(market * pct / 100, priceTiers);
      }
    }
    result[candidate.item.id] = readValue(overridesByItem, candidate.item.id) ?? value;
  }
  return result;
}

export function planGalleryListingPrices({ candidates = [], marketPrices = new Map(), settings = {}, limitsByItem = new Map(),
  priceTiers = null, overridesByItem = new Map(), previewPrices = null, quoteExpired = false, random = Math.random } = {}) {
  const mode = settings.priceMode ?? 'percentage', duration = settings.durationSeconds ?? 3600;
  if (!['fixed', 'percentage', 'steps'].includes(mode)
      || ![3600, 10800, 21600, 43200, 86400, 259200].includes(duration)
      || !Array.isArray(candidates) || candidates.some(row => !id(row?.item?.id) || !id(row?.item?.definitionId))
      || new Set(candidates.map(row => row.item.id)).size !== candidates.length) return blocked('FC27_GALLERY_LISTING_SETTINGS_INVALID');
  const output = [], skipped = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const itemId = candidate.item.id, definitionId = candidate.item.definitionId;
    const quote = readValue(marketPrices, definitionId), market = quote?.price ?? quote;
    const override = readValue(overridesByItem, itemId);
    const overrideBuyNow = override && typeof override === 'object' ? override.buyNow : override;
    const overrideStartPrice = override && typeof override === 'object' ? override.startPrice : null;
    const automatic = overrideBuyNow == null && mode !== 'fixed';
    if (automatic && (quoteExpired || !Number.isFinite(market) || market < GALLERY_LISTING_MIN_PRICE)) {
      skipped.push({ itemId, definitionId, reason: quoteExpired ? 'market-price-expired' : 'market-price-unavailable' }); continue;
    }
    let buyNow;
    if (overrideBuyNow != null) buyNow = overrideBuyNow;
    else if (previewPrices !== null) buyNow = readValue(previewPrices, itemId);
    else if (mode === 'fixed') buyNow = settings.fixedPrice;
    else if (!Number.isFinite(market) || market < GALLERY_LISTING_MIN_PRICE) {
      skipped.push({ itemId, definitionId, reason: 'market-price-unavailable' }); continue;
    } else if (mode === 'steps') {
      buyNow = moveGalleryListingPrice(market, settings.steps ?? 0, priceTiers);
      if (buyNow === null) { skipped.push({ itemId, definitionId, reason: 'price-tiers-unavailable' }); continue; }
    } else {
      const pct = percentage(settings.percentageRange ?? [100, 100], random);
      buyNow = pct === null ? null : roundGalleryListingPrice(market * pct / 100, priceTiers);
      if (pct === null) { skipped.push({ itemId, definitionId, reason: 'percentage-range-invalid' }); continue; }
    }
    if (!Number.isFinite(buyNow) || buyNow < GALLERY_LISTING_MIN_PRICE || buyNow > 15000000) {
      skipped.push({ itemId, definitionId, reason: 'listing-price-invalid' }); continue;
    }
    const startPrice = overrideStartPrice != null ? overrideStartPrice : mode === 'fixed' && settings.fixedStartPrice != null
      ? settings.fixedStartPrice : moveGalleryListingPrice(buyNow, -1, priceTiers);
    if (!Number.isFinite(startPrice) || startPrice < GALLERY_LISTING_MIN_PRICE || startPrice > buyNow) {
      skipped.push({ itemId, definitionId, reason: 'start-price-invalid' }); continue;
    }
    const limits = limitsOf(readValue(limitsByItem, itemId));
    if (!limits) { skipped.push({ itemId, definitionId, reason: 'price-limits-unavailable' }); continue; }
    if (startPrice < limits.minimum || buyNow > limits.maximum) {
      skipped.push({ itemId, definitionId, reason: 'price-out-of-range' }); continue;
    }
    output.push({ ...candidate, startPrice, buyNow,
      durationSeconds: duration,
      priceMode: mode, priceOrigin: automatic ? 'market' : 'manual',
      marketPrice: Number.isFinite(market) ? market : null, priceLimits: limits, adjusted: false });
  }
  return { status: 'observed', entries: output, skipped, count: output.length, executionEnabled: false };
}
