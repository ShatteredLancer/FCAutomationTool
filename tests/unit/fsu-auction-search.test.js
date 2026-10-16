import { expect, it, vi } from 'vitest';
import { readFsuStyleAuctionPrices } from '../../src/fc27/fsu-auction-search.js';
import ceilingCase from '../fixtures/fc27-purchase-ceiling-2026-10-16.json';
import { priceTiers, referencePrices } from '../fixtures/enhancer-listing-price-reference.js';
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

it.each([[650,[350,400,500,550,650]], [800,[350,450,550,650,800]]])('spreads empty searches over the approved %i interval without adding requests', async (ceiling, expected) => {
  const search = vi.fn(async () => []);
  const wait = vi.fn();
  const found = await readFsuStyleAuctionPrices({ ...options(search), initial: ceilingCase.referencePrice,
    ceiling, attempts: ceilingCase.queriesPerAttempt, spreadCeiling: true, priceTiers, wait });
  expect(search.mock.calls.flat()).toEqual(expected);
  expect(found).toEqual([]);
  expect(wait.mock.calls).toEqual(Array(4).fill([0.2,0.5]));
});

it('uses the effective ceiling when only one search is allowed, and never searches at zero attempts', async () => {
  const search = vi.fn(async () => []);
  await readFsuStyleAuctionPrices({ ...options(search), initial: 350, ceiling: 650, attempts: 1, spreadCeiling: true, priceTiers });
  expect(search.mock.calls.flat()).toEqual([650]);
  search.mockClear();
  await readFsuStyleAuctionPrices({ ...options(search), attempts: 0, spreadCeiling: true, priceTiers });
  expect(search).not.toHaveBeenCalled();
});

it('preserves early partial results and full-page narrowing instead of jumping after finding offers', async () => {
  const search = vi.fn(async p => p >= 250 ? [item(1,250)] : []);
  await readFsuStyleAuctionPrices({ ...options(search), spreadCeiling: true, priceTiers });
  expect(search.mock.calls.flat()).toEqual([200,400]);
  search.mockClear(); search.mockImplementation(async p => p >= 200 ? Array.from({ length: 21 }, (_, i) => item(i+1,200)) : []);
  await readFsuStyleAuctionPrices({ ...options(search), spreadCeiling: true, priceTiers });
  expect(search.mock.calls.flat()).toEqual([200,150]);
});

it('does not repeat the cap, invent an infinite search, or continue after an explicit service failure', async () => {
  const search = vi.fn(async () => []);
  await readFsuStyleAuctionPrices({ ...options(search), ceiling: 250, spreadCeiling: true, priceTiers });
  expect(search.mock.calls.flat()).toEqual([200,250]);
  search.mockClear();
  await readFsuStyleAuctionPrices({ ...options(search), ceiling: Infinity, spreadCeiling: true, priceTiers });
  expect(search.mock.calls.flat()).toEqual([200,250,300,350,400]);
  search.mockClear(); search.mockResolvedValue({ success: false, status: 429 });
  const onSearchFailure = vi.fn();
  await readFsuStyleAuctionPrices({ ...options(search), spreadCeiling: true, priceTiers, onSearchFailure });
  expect(search.mock.calls.flat()).toEqual([200]);
  expect(onSearchFailure).toHaveBeenCalledWith({ success: false, status: 429 });
});

it.each([[900,1200,[900,950,1000,1100,1200]], [950,1100,[950,1000,1100]],
  [9500,10500,[9500,9700,10000,10250,10500]]])('rounds a spread across EA price tiers: %i to %i', async (initial, ceiling, expected) => {
  const search = vi.fn(async () => []), prices = referencePrices(priceTiers);
  await readFsuStyleAuctionPrices({ search, initial, ceiling, attempts: 5, spreadCeiling: true, priceTiers,
    above: p => prices.step(p, 1), below: p => prices.step(p, -1) });
  expect(search.mock.calls.flat()).toEqual(expected);
});
