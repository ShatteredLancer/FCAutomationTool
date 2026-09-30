// Presentation-only lookup into an already populated FSU price cache. It
// never starts a network request or asks EA for a missing price.
const validId = value => Number.isSafeInteger(value) && value > 0;

export function parseGalleryPriceResponse(input) {
  let response = input;
  if (typeof input === 'string') {
    try { response = JSON.parse(input); } catch { return Object.freeze({}); }
  }
  const result = Object.create(null);
  for (const entry of Array.isArray(response?.data) ? response.data : []) {
    const id = Number(entry?.eaId ?? entry?.definitionId), price = Number(entry?.price);
    if (validId(id) && Number.isSafeInteger(price) && price > 0) result[String(id)] = price;
  }
  return Object.freeze(result);
}

export function readCachedGalleryPrices(root, ids = []) {
  const data = root?.info?.roster?.data;
  const result = Object.create(null);
  if (!data || typeof data !== 'object') return result;
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!validId(id)) continue;
    const entry = data[String(id)] ?? data[id];
    const value = Number(entry?.n);
    if (Number.isSafeInteger(value) && value > 0) result[String(id)] = value;
  }
  return result;
}

export function readCachedGalleryPrice(root, id) {
  return readCachedGalleryPrices(root, [id])[String(id)] ?? null;
}
