import { purchasePriceCap, validPublicPrice } from '../gallery/public-price-policy.js';
import { roundGalleryListingPrice } from '../gallery/listing-candidates.js';
import { marketRatingRow, completeMarketRatingRow } from './market-rating-prices.js';
import { marketTaskAutoLists } from './market-task-policy.js';

const fail = reason => { throw Error(`MARKET_${reason}`); };

// Actual account platform only. A display preference for another platform is
// never an executable reference. Both uses FB first, GG only when FB is invalid.
export function marketTaskReference({ quotes, source, definitionId, context, now }) {
  if (!['futbin', 'futgg', 'both'].includes(source)) fail('REFERENCE_INVALID');
  const valid = key => {
    const q = quotes?.[key];
    return q?.source === key && q.definitionId === definitionId && q.season === context.season
      && q.platform === context.platform && !q.error && validPublicPrice(q.price)
      && Number.isSafeInteger(q.fetchedAt) && q.fetchedAt >= 0 && q.fetchedAt <= now
      && Number.isSafeInteger(q.expiresAt) && q.expiresAt > now && q.expiresAt > q.fetchedAt
      && (key !== 'futbin' || q.futbinPlatform == null || q.futbinPlatform === (context.platform === 'pc' ? 'pc' : 'ps'))
      && (q.sourceUpdatedAt == null || Number.isSafeInteger(q.sourceUpdatedAt)
        && q.sourceUpdatedAt <= now && now - q.sourceUpdatedAt <= 1800000);
  };
  const chosen = (source === 'both' ? ['futbin', 'futgg'] : [source]).find(valid);
  if (!chosen) fail('REFERENCE_UNAVAILABLE');
  return structuredClone(quotes[chosen]);
}

// No cost, desired profit or opposite-side price is accepted by this API.
// Fixed rules do not require a public quote. Explicit invalid fixed EA prices
// fail rather than silently changing the price the user saved.
export function marketTaskPrice({ side, task, player = null, quotes, source, definitionId,
  context, now, priceTiers, limits = null, rating = null }) {
  if (!['buy', 'sell'].includes(side)) fail('PRICE_INVALID');
  const buy = side === 'buy', settings = task.settings;
  if (!buy && !marketTaskAutoLists(task)) fail('HOLD_ONLY');
  const ratingRow=marketRatingRow(task,rating);
  if(task.ratingPrices&&!completeMarketRatingRow(ratingRow,task))fail('RATING_PRICE_UNAVAILABLE');
  const override = buy && player?.cap != null ? player.cap : null;
  const fixed = Boolean(ratingRow) || override !== null || (buy ? settings.buyRule : settings.sellRule) === 'fixed';
  const reference = fixed ? null : marketTaskReference({ quotes, source, definitionId, context, now });
  const value = ratingRow?.[buy?'buy':'sell'] ?? override ?? (buy ? settings.buyValue : settings.sellValue);
  const raw = fixed ? value : reference.price * value / 100;
  if (!Number.isFinite(raw) || raw < 150) fail('PRICE_INVALID');
  let price;
  if (buy) {
    price = purchasePriceCap({ maxBuy: Math.min(15000000, Math.floor(raw)), absoluteCap: settings.hardCap,
      eaLimits: limits, priceTiers });
  } else {
    // Validate the runtime tiers using the existing cap validator before using
    // the existing Enhancer-derived nearest-step SELL rounding.
    if (purchasePriceCap({ maxBuy: 15000000, priceTiers }) === null) fail('PRICE_INVALID');
    price = fixed ? raw : roundGalleryListingPrice(raw, priceTiers, 150);
    if (!validPublicPrice(price) || purchasePriceCap({ maxBuy: price, priceTiers }) !== price
      || limits && (price < limits.minimum || price > limits.maximum)) fail('PRICE_LIMIT');
  }
  if (price === null) fail('PRICE_LIMIT');
  return { price, reference, expiresAt: reference?.expiresAt ?? null };
}
