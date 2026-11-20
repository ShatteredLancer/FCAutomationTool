import { parsePublicFutbinPrice } from './public-price-responses.js';
import { MAX_PUZZLE_RATED_FODDER_LANES } from './puzzle-procurement-policy.js';

const ratedPage = (platform, rating, page) =>
  `https://www.futbin.org/futbin/api/27/getFilteredPlayers?platform=${platform === 'pc' ? 'PC' : 'PS'}&rating=${rating}-${rating}&sort=rating&order=desc&page=${page}`;
const cachePage = (cache, key, rows, fetchedAt) => {
  if (!cache) return;
  cache.set(key, { fetchedAt, rows: rows.map(row => ({ resource_id: row.resource_id, rating: row.rating, raretype: row.raretype,
    pc_LCPrice: parsePublicFutbinPrice({ data: [row] }, row.resource_id, 'pc', false).price,
    ps_LCPrice: parsePublicFutbinPrice({ data: [row] }, row.resource_id, 'console', false).price })) });
  while (cache.size > 256) cache.delete(cache.keys().next().value);
};

// Discovery only. EA re-reads these exact definitions and the selected quote
// source supplies purchase prices; FUTBIN prices here just rank each lane.
export async function readFc27RatedFodderIds(ratings, { platform, request, check = async () => {},
  now = () => Date.now(), cache = null, quoteTtlMs = 300000 } = {}) {
  if (!['pc', 'console'].includes(platform) || !Array.isArray(ratings) || ratings.length > MAX_PUZZLE_RATED_FODDER_LANES
      || ratings.some(rating => !Number.isSafeInteger(rating) || rating < 75 || rating > 99)) {
    throw Error('FC27_PUBLIC_PRICE_PLAYER_INVALID');
  }
  const read = async rating => {
    await check();
    const key = `27:${platform}:${rating}:1`, old = cache?.get(key);
    const cached = old && old.fetchedAt <= now() && old.fetchedAt + quoteTtlMs > now()
      && old.rows.every(row => Number.isSafeInteger(row.raretype));
    const reply = cached ? { data: old.rows } : await request(ratedPage(platform, rating, 1)); await check();
    let payload;
    try { payload = typeof reply === 'string' ? JSON.parse(reply) : reply; }
    catch { throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID'); }
    if (!payload?.data || typeof payload.data !== 'object'
        || payload.errorcode != null && String(payload.errorcode) !== '200') throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    const rows = Object.values(payload.data);
    if (rows.length > 100 || new Set(rows.map(row => row?.resource_id)).size !== rows.length
        || rows.some(row => row?.rating !== rating || !Number.isSafeInteger(row.resource_id)
          || row.resource_id < 1 || row.resource_id > 0x7fffffff)) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    if (!cached) cachePage(cache, key, rows, now());
    return rows.filter(row => [0, 1].includes(row.raretype)).map(row => ({
      id: row.resource_id, price: parsePublicFutbinPrice({ data: [row] }, row.resource_id, platform, false).price,
    })).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.id - b.id).map(row => row.id);
  };
  const lanes = [], grades = [...new Set(ratings)];
  for (let offset = 0; offset < grades.length; offset += 2) {
    lanes.push(...await Promise.all(grades.slice(offset, offset + 2).map(read)));
  }
  return lanes;
}

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
      const response = await request(ratedPage(platform, rating, page));
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
    if (!cached) cachePage(cache, key, rows, fetchedAt);
    const newCount = [...pageIds].filter(id => !seen.has(id)).length;
    for (const id of pageIds) seen.add(id);
    if (!newCount || rows.length < 32) break;
  }
  return { rows: [...found.values()], requests };
}
