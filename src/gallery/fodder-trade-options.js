import { roundGalleryListingPrice, moveGalleryListingPrice } from './listing-candidates.js';
import { purchasePriceCap } from './public-price-policy.js';

// Fodder 1.3.3 sc / AI / xI / jI: presentation and per-batch options.
// FCAT's explicitly approved public-source ceiling remains authoritative.
export function normalizeFodderBuyOptions(value) {
  if (!value || !Number.isInteger(value.minPct) || !Number.isInteger(value.maxPct)
    || value.minPct < 75 || value.maxPct > 200 || value.minPct > value.maxPct
    || value.minPct % 5 || value.maxPct % 5 || !Number.isInteger(value.tries) || value.tries < 1 || value.tries > 5) {
    throw Error('FC27_GALLERY_BATCH_OPTIONS_INVALID');
  }
  return { minPct: value.minPct, maxPct: value.maxPct, tries: value.tries };
}
export function fodderAttemptCap({ options, estimate, attempt, maxBuy, priceTiers }) {
  const { minPct, maxPct, tries } = normalizeFodderBuyOptions(options);
  const pct = tries === 1 ? minPct : minPct + (maxPct - minPct) * Math.min(tries - 1, Math.max(0, attempt - 1)) / (tries - 1);
  const target = Math.max(200, roundGalleryListingPrice(estimate * pct / 100, priceTiers) ?? 0);
  return purchasePriceCap({ maxBuy, approvedCap: target, priceTiers });
}
export function fodderListingPreview({ candidates, prices, priceTiers, from = 'market', adjustment = 0, overrides = {} }) {
  if (!['market', 'paid'].includes(from) || !Number.isSafeInteger(adjustment)) throw Error('FC27_GALLERY_BATCH_OPTIONS_INVALID');
  const bins = {}, origins = {};
  for (const row of candidates) {
    const id = row.item.id, def = row.item.definitionId;
    const sibling = candidates.find(other => other.item.definitionId === def && other.item.id !== id && overrides[other.item.id] != null);
    const typed = overrides[id] ?? (sibling ? overrides[sibling.item.id] : null);
    const paid = row.boughtFor ?? row.purchase?.purchasePrice;
    const usePaid = from === 'paid' && paid > 0;
    const base = usePaid ? paid : prices[def];
    bins[id] = typed ?? (base > 0 ? Math.max(200, roundGalleryListingPrice(base * Math.max(0, 100 + adjustment) / 100, priceTiers) ?? 0) : null);
    origins[id] = typed != null ? 'manual' : usePaid ? 'paid' : 'market';
  }
  return { bins, origins };
}
export function planFodderListings({ candidates, selectedIds, prices, priceTiers, limitsByItem, durationSeconds,
  quoteExpired = false, quoteExpiresAt = null, now = Date.now(), ...options }) {
  const { bins, origins } = fodderListingPreview({ candidates, prices, priceTiers, ...options });
  const selected = new Set(selectedIds), entries = [], skipped = [];
  for (const row of candidates.filter(row => selected.has(row.item.id))) {
    const limits = limitsByItem[row.item.id], raw = bins[row.item.id], origin = origins[row.item.id];
    const expiry = quoteExpiresAt?.[row.item.definitionId];
    let reason = origin === 'market' && (expiry == null ? quoteExpired : expiry <= now) ? 'market-price-expired' : !(raw > 0) ? 'market-price-unavailable'
      : limits?.status !== 'loaded' ? 'price-limits-unavailable' : null;
    let buyNow = raw, startPrice = null;
    if (!reason) {
      buyNow = Math.min(raw, limits.maximum);
      if (buyNow <= limits.minimum) buyNow = moveGalleryListingPrice(limits.minimum, 1, priceTiers);
      startPrice = Math.max(limits.minimum, moveGalleryListingPrice(buyNow, -1, priceTiers) ?? 0);
      if (!Number.isSafeInteger(buyNow) || buyNow > limits.maximum || startPrice >= buyNow) reason = 'price-out-of-range';
    }
    if (reason) skipped.push({ itemId: row.item.id, reason });
    else entries.push({ ...row, startPrice, buyNow, durationSeconds, priceOrigin: origin, adjusted: buyNow !== raw,
      ...(origin === 'market' && expiry != null ? { quoteExpiresAt: expiry } : {}) });
  }
  return { status: 'observed', entries, skipped, bins, origins };
}
