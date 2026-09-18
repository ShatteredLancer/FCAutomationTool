const TTL = 5 * 60 * 1000;
const COOLDOWN = 30 * 60 * 1000;
function market(platform) {
  const name = String(platform).split(':')[0].toLowerCase();
  if (['psn', 'ps3', 'ps4', 'ps5', 'xbox', 'xboxone', 'xboxseriesxs'].includes(name)) return 'console';
  if (name === 'pc') return 'pc';
  throw new Error('PRICE_PLATFORM_UNVERIFIED');
}
function ids(values) {
  if (!Array.isArray(values) || values.length > 50 || values.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('PRICE_IDS_INVALID');
  }
  return [...new Set(values)];
}
export function fc27PriceUrl(values, platform) {
  const suffix = market(platform) === 'pc' ? '&platform=pc' : '';
  return `https://www.fut.gg/api/fut/player-prices/27/?ids=${encodeURIComponent(ids(values).join(','))}${suffix}`;
}

// FC26's seasonless FUTNext fallback is deliberately not part of this provider.
export function createFc27Prices({ request, now = () => Date.now() }) {
  const cache = new Map();
  let busy = false;
  let blockedUntil = 0;
  return Object.freeze({ async load(values, platform) {
    const requested = ids(values);
    const group = market(platform);
    const key = id => `27:${group}:${id}`;
    const fresh = () => requested.map(id => cache.get(key(id))).filter(entry => entry && entry.expiresAt > now());
    const result = (reason = null) => {
      const quotes = fresh();
      return { season: '27', source: 'FUT.GG', platform: group, quotes,
        status: quotes.length === requested.length ? 'loaded' : quotes.length ? 'partial' : 'unavailable', reason };
    };
    const missing = requested.filter(id => !fresh().some(entry => entry.definitionId === id));
    if (!missing.length) return result();
    if (busy) return result('PRICE_BUSY');
    if (now() < blockedUntil) return result('PRICE_COOLDOWN');
    busy = true;
    try {
      const response = await request(fc27PriceUrl(missing, platform));
      if (response?.status !== 200) {
        blockedUntil = now() + COOLDOWN;
        return result(Number.isInteger(response?.status) ? `PRICE_HTTP_${response.status}` : 'PRICE_TRANSPORT_UNAVAILABLE');
      }
      if (typeof response.responseText !== 'string' || response.responseText.length > 200000) throw new Error('shape');
      const body = JSON.parse(response.responseText);
      if (!Array.isArray(body?.data) || body.data.length > 100) throw new Error('shape');
      const accepted = [];
      const seen = new Set();
      for (const entry of body.data) {
        if (!missing.includes(entry?.eaId)) continue;
        if (seen.has(entry.eaId)) throw new Error('duplicate');
        seen.add(entry.eaId);
        if (Number.isSafeInteger(entry.price) && entry.price > 0 && entry.price <= 15000000) {
          accepted.push({ definitionId: entry.eaId, price: entry.price, quotedAt: now(), expiresAt: now() + TTL });
        }
      }
      for (const entry of accepted) cache.set(key(entry.definitionId), Object.freeze(entry));
      while (cache.size > 500) cache.delete(cache.keys().next().value);
      return result();
    } catch {
      blockedUntil = now() + COOLDOWN;
      return result('PRICE_RESPONSE_UNVERIFIED');
    } finally { busy = false; }
  } });
}
