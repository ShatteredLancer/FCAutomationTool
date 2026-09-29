import { expect, it, vi } from 'vitest';
import { readFsuStyleAuctionPrices } from '../../src/fc27/fsu-auction-search.js';
const item = (tradeId, price) => ({ getAuctionData: () => ({ tradeId, buyNowPrice: price }) });
const options = search => ({ search, above: p => p + 50, below: p => p - 50, initial: 200, ceiling: 1000 });
it('follows the FSU empty-page price walk and stops at the first partial page', async () => {
  const card = item(1, 300), search = vi.fn(async p => p < 300 ? [] : [card]);
  expect(await readFsuStyleAuctionPrices(options(search))).toEqual([card]);
  expect(search.mock.calls.flat()).toEqual([200, 250, 300]);
});
it('narrows a full page and retains candidates without querying the same price twice', async () => {
  const cards = Array.from({ length: 21 }, (_, i) => item(i + 1, 200));
  const search = vi.fn(async p => p === 200 ? cards : []);
  expect(await readFsuStyleAuctionPrices(options(search))).toEqual(cards);
  expect(search.mock.calls.flat()).toEqual([200, 150]);
});
it('does not retry a rate limit, exceed the ceiling or use an unbounded number of searches', async () => {
  const search = vi.fn(async () => []);
  await readFsuStyleAuctionPrices(options(search)); expect(search).toHaveBeenCalledTimes(5);
  search.mockClear(); await readFsuStyleAuctionPrices({ ...options(search), ceiling: 250 });
  expect(search.mock.calls.flat()).toEqual([200, 250]);
  search.mockRejectedValue(Error('FC27_BUY_RATE_LIMITED')); search.mockClear();
  await expect(readFsuStyleAuctionPrices(options(search))).rejects.toThrow('FC27_BUY_RATE_LIMITED');
  expect(search).toHaveBeenCalledTimes(1);
});
