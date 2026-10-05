import { validPublicPrice } from '../gallery/public-price-policy.js';

// Shapes verified against anonymous FC27 endpoints, 2026-10-04.
export function parsePublicFutggPrices(payload, ids, platform) {
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID'); } }
  if (!Array.isArray(payload?.data) || !['pc', 'console'].includes(platform)) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
  const seen = new Set(), expectedPlatform = platform === 'console' ? 'ps5' : 'pc';
  return payload.data.map(row => {
    if (!ids.includes(row?.eaId) || seen.has(row.eaId) || row.platform !== expectedPlatform) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    seen.add(row.eaId);
    const sourceUpdatedAt = row.priceUpdatedAt == null ? null : Date.parse(row.priceUpdatedAt);
    if (sourceUpdatedAt !== null && !Number.isSafeInteger(sourceUpdatedAt)) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    return { definitionId: row.eaId, price: validPublicPrice(row.price) ? row.price : null, sourceUpdatedAt };
  });
}

export function parsePublicFutbinPrice(payload, definitionId, platform, minimal) {
  if (!['pc', 'console'].includes(platform)) throw Error('FC27_PUBLIC_PRICE_INPUT_INVALID');
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID'); } }
  if (!payload?.data || typeof payload.data !== 'object'
      || payload.errorcode != null && String(payload.errorcode) !== '200') throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
  const matches = Object.values(payload.data).filter(row => Number(row?.[minimal ? 'Player_Resource' : 'resource_id']) === definitionId);
  if (matches.length > 1) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
  if (!matches.length) return { definitionId, price: null, sourceUpdatedAt: null };
  const row = matches[0];
  // Filter replies carry both markets; minimal replies carry the explicitly
  // requested market in LCPrice. Never pick the other market or a base card.
  const value = minimal ? row.LCPrice ?? row[platform === 'pc' ? 'pc_LCPrice' : 'ps_LCPrice'] ?? row.price
    : row[platform === 'pc' ? 'pc_LCPrice' : 'ps_LCPrice'] ?? row.LCPrice ?? row.price;
  return { definitionId, price: validPublicPrice(value) ? value : null, sourceUpdatedAt: null };
}
