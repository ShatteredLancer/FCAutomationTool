import { expect, it, vi } from 'vitest';
import { createFc27Prices, fc27PriceUrl } from '../../FSU_mod/src/enhancements/prices.js';

it('uses only FC27 and verified platform mapping; never the seasonless fallback', () => {
  expect(fc27PriceUrl([123, 456], 'PSN:sku')).toBe('https://www.fut.gg/api/fut/player-prices/27/?ids=123%2C456');
  expect(fc27PriceUrl([123], 'pc:sku')).toContain('&platform=pc');
  expect(() => fc27PriceUrl([123], 'unknown:sku')).toThrow('PLATFORM');
});
it('keeps platform caches separate and filters foreign, duplicate, zero and malformed quotes', async () => {
  const request = vi.fn(async () => ({ status: 200, responseText: JSON.stringify({ data: [
    { eaId: 123, price: 800 }, { eaId: 999, price: 200 }, { eaId: 456, price: null },
  ] }) }));
  const prices = createFc27Prices({ request });
  expect(await prices.load([123, 456], 'PSN:sku')).toMatchObject({ status: 'partial', quotes: [{ definitionId: 123, price: 800 }] });
  await prices.load([123], 'PSN:sku');
  expect(request).toHaveBeenCalledTimes(1);
  await prices.load([123], 'pc:sku');
  expect(request).toHaveBeenCalledTimes(2);
});
it('opens a bounded cooldown after 403 and does not invent prices or call a fallback', async () => {
  let now = 0;
  const request = vi.fn(async () => ({ status: 403, responseText: '<html>blocked</html>' }));
  const prices = createFc27Prices({ request, now: () => now });
  expect(await prices.load([123], 'PSN:sku')).toMatchObject({ status: 'unavailable', reason: 'PRICE_HTTP_403', quotes: [] });
  expect(await prices.load([123], 'PSN:sku')).toMatchObject({ reason: 'PRICE_COOLDOWN' });
  expect(request).toHaveBeenCalledTimes(1);
  now = 30 * 60 * 1000 + 1;
  await prices.load([123], 'PSN:sku');
  expect(request).toHaveBeenCalledTimes(2);
});
it('rejects ambiguous duplicate IDs and handles request failure without leaking raw responses', async () => {
  const prices = createFc27Prices({ request: async () => ({ status: 200,
    responseText: JSON.stringify({ data: [{ eaId: 123, price: 5 }, { eaId: 123, price: 8 }] }) }) });
  expect(await prices.load([123], 'PSN:sku')).toMatchObject({ status: 'unavailable', quotes: [] });
  const failing = createFc27Prices({ request: async () => { throw new Error('secret'); } });
  expect(JSON.stringify(await failing.load([123], 'PSN:sku'))).not.toContain('secret');
});
