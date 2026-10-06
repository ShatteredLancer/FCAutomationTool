import { expect, it, vi } from 'vitest';
import { readFc27GalleryPriceLimits } from '../../src/adapters/ea/fc27-gallery-price-limits.js';

const fixture = (transform = dto => dto) => {
  const read = vi.fn(ids => ({ observe(owner, callback) { callback(this, transform({ success: true, status: 200,
    response: { marketData: ids.map(defId => ({ defId, priceLimits: { minimum: 150, maximum: 10000 } })) } })); }, unobserve() {} }));
  return { read, root: { services: { Item: { transfersDao: { getItemMarketDataByDefId: read },
    requestMarketData: () => { throw Error('item-scoped request returned 403'); } } } } };
};
it('loads preview limits by version, never by old owned item ID, in Enhancer batches of 200', async () => {
  const f = fixture();
  const refs = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, definitionId: i + 1000 }));
  refs.push({ id: 999, definitionId: 1000 });
  const result = await readFc27GalleryPriceLimits(f.root, refs);
  expect(f.read.mock.calls.map(([ids]) => ids.length)).toEqual([200, 1]);
  expect(result[1]).toEqual({ status: 'loaded', minimum: 150, maximum: 10000 });
  expect(result[999]).toEqual(result[1]);
});
it('keeps omitted limits unknown instead of substituting an unrestricted global cap', async () => {
  const f = fixture(dto => ({ ...dto, response: { marketData: [] } }));
  expect(await readFc27GalleryPriceLimits(f.root, [{ id: 1, definitionId: 1000 }]))
    .toEqual({ 1: { status: 'unknown', minimum: null, maximum: null } });
});
it.each([401, 403, 429])('preserves HTTP %s and stops subsequent batches', async status => {
  const f = fixture(() => ({ success: false, status }));
  await expect(readFc27GalleryPriceLimits(f.root, Array.from({length:201},(_,i)=>({id:i+1,definitionId:i+1000}))))
    .rejects.toMatchObject({ message: 'FC27_GALLERY_LISTING_SERVICE_STOP', phase: 'price-limits', httpStatus: status });
  expect(f.read).toHaveBeenCalledTimes(1);
});
it('rejects unrelated or duplicate version responses and a changed account', async () => {
  const f = fixture(dto => { dto.response.marketData[0].defId = 999; return dto; });
  await expect(readFc27GalleryPriceLimits(f.root, [{id:1,definitionId:1000}])).rejects.toThrow('UNVERIFIED');
  const current = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw Error('ACCOUNT_CHANGED'); });
  await expect(readFc27GalleryPriceLimits(fixture().root, [{id:1,definitionId:1000}], current)).rejects.toThrow('ACCOUNT_CHANGED');
});
