import { expect, it, vi } from 'vitest';
import { createGalleryMarketComparison } from '../../src/gallery/market-comparison.js';
const quote = id => ({ status: 'observed', definitionId: id, executable: false, price: 250, listings: [] });
it('coalesces one exact-version read and reuses its account-scoped quote', async () => {
  let scope = 'a', time = 1000;
  const readQuotePage = vi.fn(async query => quote(query.definitionId));
  const createTransport = vi.fn(async () => ({ readQuotePage }));
  const service = createGalleryMarketComparison({ createTransport, scope: () => scope, now: () => time, wait: vi.fn(async () => {}) });
  const first = service.compare(10), second = service.compare(10);
  expect(first).toBe(second);
  expect(await first).toMatchObject({ price: 250, cached: false });
  expect(await service.compare(10)).toMatchObject({ cached: true });
  expect(readQuotePage).toHaveBeenCalledTimes(1);
  expect(createTransport).toHaveBeenCalledWith({ maxRequests: 1, quotesOnly: true });
  expect(readQuotePage).toHaveBeenCalledWith({ definitionId: 10, start: 0, count: 20, maxBuy: null });
  scope = 'b'; time += 1000;
  await service.compare(10);
  expect(readQuotePage).toHaveBeenCalledTimes(2);
});
it('drops a late result after account change and never retries an error', async () => {
  let scope = 'a', release;
  const readQuotePage = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const service = createGalleryMarketComparison({ createTransport: async () => ({ readQuotePage }), scope: () => scope });
  const task = service.compare(10);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  scope = 'b'; release(quote(10));
  expect(await task).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_COMPARE_SCOPE_CHANGED' });
  const failed = vi.fn(async () => { throw Error('FC27_MARKET_HTTP_429'); });
  const blocked = createGalleryMarketComparison({ createTransport: async () => ({ readQuotePage: failed }), scope: () => 'a' });
  expect(await blocked.compare(10)).toMatchObject({ reason: 'FC27_MARKET_HTTP_429' });
  expect(await blocked.compare(11)).toMatchObject({ reason: 'FC27_GALLERY_COMPARE_COOLDOWN' });
  expect(failed).toHaveBeenCalledTimes(1);
});
it('rejects another version and never exposes an executable result', async () => {
  const createTransport = async () => ({ readQuotePage: async () => quote(99) });
  expect(await createGalleryMarketComparison({ createTransport, scope: () => 'a' }).compare(10))
    .toMatchObject({ status: 'blocked', executable: false, reason: 'FC27_GALLERY_COMPARE_RESPONSE_UNVERIFIED' });
});

it('records redacted request, response and failure phases without exposing version identity', async () => {
  const entries = [];
  const diagnosticLog = { record: value => { entries.push(value); return Promise.resolve(true); } };
  const service = createGalleryMarketComparison({
    createTransport: async () => ({ readQuotePage: async () => quote(10) }),
    scope: () => 'a', diagnosticLog,
  });
  await service.compare(10);
  expect(entries.map(entry => [entry.event, entry.phase, entry.status])).toEqual([
    ['market-compare', 'request', 'started'], ['market-compare', 'response', 'success'],
  ]);
  expect(entries.every(entry => !Object.hasOwn(entry, 'definitionId'))).toBe(true);
});
