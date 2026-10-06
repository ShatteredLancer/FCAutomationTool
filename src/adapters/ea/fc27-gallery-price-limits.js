// Enhancer HBe.getPriceLimitByDefIds / sht / e1e: price inputs read version
// limits in batches of at most 200. Owned item IDs belong to execution checks.
export async function readFc27GalleryPriceLimits(root, refs, assertCurrent = () => {}) {
  const dao = root.services?.Item?.transfersDao;
  const read = dao?.getItemMarketDataByDefId;
  if (typeof read !== 'function') throw Object.assign(Error('FC27_GALLERY_PRICE_LIMITS_UNAVAILABLE'), { phase: 'price-limits' });
  const ids = [...new Set(refs.map(ref => ref.definitionId))];
  const limits = new Map();
  for (let offset = 0; offset < ids.length; offset += 200) {
    assertCurrent();
    const batch = ids.slice(offset, offset + 200);
    if (batch.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('FC27_GALLERY_LISTING_ITEM_CHANGED');
    const reply = read.call(dao, batch);
    const dto = await new Promise((resolve, reject) => {
      const owner = {}; let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true; clearTimeout(timer);
        try { reply?.unobserve?.(owner); } catch { /* Own observer only. */ }
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(Error('FC27_GALLERY_PRICE_LIMITS_TIMEOUT')), 20000);
      try { reply.observe(owner, (_sender, value) => finish(null, value)); }
      catch { finish(Error('FC27_GALLERY_PRICE_LIMITS_UNAVAILABLE')); }
    });
    assertCurrent();
    if (dto?.success !== true) throw Object.assign(Error('FC27_GALLERY_LISTING_SERVICE_STOP'),
      { phase: 'price-limits', httpStatus: Number(dto?.status) || null });
    const rows = dto.response?.marketData;
    if (!Array.isArray(rows) || rows.length > batch.length) throw Error('FC27_GALLERY_PRICE_LIMITS_UNVERIFIED');
    const seen = new Set();
    for (const row of rows) {
      if (!batch.includes(row?.defId) || seen.has(row.defId)) throw Error('FC27_GALLERY_PRICE_LIMITS_UNVERIFIED');
      seen.add(row.defId);
      const minimum = row.priceLimits?.minimum, maximum = row.priceLimits?.maximum;
      if (Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum) && minimum >= 150 && maximum >= minimum) {
        limits.set(row.defId, { status: 'loaded', minimum, maximum });
      }
    }
  }
  return Object.fromEntries(refs.map(ref => [ref.id, limits.get(ref.definitionId) ?? { status: 'unknown', minimum: null, maximum: null }]));
}
