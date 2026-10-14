import { parsePublicFutbinPrice } from './public-price-responses.js';

// Same public filtered-price endpoint used by FSU. This is quote batching,
// never a candidate database or an assertion that an omitted version is absent.
export async function readFutbinBatchPrices(ids, players, { season = '27', platform, request,
  check = async () => {}, now = () => Date.now(), cache = null, quoteTtlMs = 300000, force = false, cacheOnly = false, deadlineAt = null } = {}) {
  const rating = players.find(row => ids.includes(row?.definitionId ?? row?.eaId))?.rating;
  if (season !== '27' || !['pc', 'console'].includes(platform) || !Number.isSafeInteger(quoteTtlMs)
      || deadlineAt !== null && (!Number.isSafeInteger(deadlineAt) || deadlineAt < 0)
      || quoteTtlMs <= 0 || quoteTtlMs > 1800000 || typeof force !== 'boolean' || typeof cacheOnly !== 'boolean' || !Number.isSafeInteger(rating)
      || rating < 1 || rating > 99 || !ids.length || ids.length > 250
      || ids.some(id => !Number.isSafeInteger(id) || id <= 0
        || !players.some(row => (row.definitionId ?? row.eaId) === id && row.rating === rating))) {
    throw Error('FC27_PUBLIC_PRICE_PLAYER_INVALID');
  }
  const found = new Map(), seen = new Set(); let requests = 0;
  for (let page = 1; page <= 8 && found.size < ids.length; page++) {
    await check();
    if (deadlineAt !== null && now() >= deadlineAt) break;
    const key = `${season}:${platform}:${rating}:${page}`, saved = cache?.get(key);
    const cached = !force && Number.isSafeInteger(saved?.fetchedAt) && saved.fetchedAt <= now()
      && saved.fetchedAt + quoteTtlMs > now();
    let payload, fetchedAt;
    if (cached) { payload = { data: saved.rows }; fetchedAt = saved.fetchedAt; }
    else {
      if (cacheOnly) continue;
      const response = await request(`https://www.futbin.org/futbin/api/${season}/getFilteredPlayers?platform=${platform === 'pc' ? 'PC' : 'PS'}&rating=${rating}-${rating}&sort=rating&order=desc&page=${page}`);
      requests++;
      await check();
      try { payload = typeof response === 'string' ? JSON.parse(response) : response; }
      catch { throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID'); }
      fetchedAt = now();
    }
    if (!payload?.data || typeof payload.data !== 'object'
        || payload.errorcode != null && String(payload.errorcode) !== '200') throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    const rows = Object.values(payload.data), pageIds = new Set();
    if (rows.length > 100) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    for (const row of rows) {
      if (!Number.isSafeInteger(row?.resource_id) || row.resource_id <= 0 || row.rating !== rating
          || pageIds.has(row.resource_id)) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
      pageIds.add(row.resource_id);
      if (ids.includes(row.resource_id) && !found.has(row.resource_id)) {
        found.set(row.resource_id, { ...parsePublicFutbinPrice(payload, row.resource_id, platform, false), fetchedAt });
      }
    }
    if (!cached && cache) {
      cache.set(key, { fetchedAt, rows: rows.map(row => ({ resource_id: row.resource_id, rating: row.rating,
        pc_LCPrice: parsePublicFutbinPrice(payload, row.resource_id, 'pc', false).price,
        ps_LCPrice: parsePublicFutbinPrice(payload, row.resource_id, 'console', false).price })) });
      while (cache.size > 256) cache.delete(cache.keys().next().value);
    }
    const newCount = [...pageIds].filter(id => !seen.has(id)).length;
    for (const id of pageIds) seen.add(id);
    if (!newCount || rows.length < 32) break;
  }
  return { rows: [...found.values()], requests };
}
