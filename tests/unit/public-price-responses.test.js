import { expect, it } from 'vitest';
import { parsePublicFutbinPrice as bin, parsePublicFutggPrices as gg } from '../../src/fc27/public-price-responses.js';
import { futbinFiltered, futbinMinimalPC, futbinMinimalPS, futggPC, futggPS } from '../fixtures/fc27-public-prices.js';
it('replays both public markets and keeps source time separate from fetch time', () => {
  expect(bin(futbinFiltered, 71494, 'pc', false)).toEqual({ definitionId: 71494, price: 700, sourceUpdatedAt: null });
  expect(bin(futbinFiltered, 71494, 'console', false).price).toBe(650);
  expect(bin(futbinMinimalPC, 71494, 'pc', true).price).toBe(700);
  expect(bin(futbinMinimalPS, 71494, 'console', true).price).toBe(650);
  expect(gg(futggPC, [71494,73562], 'pc')[0]).toEqual({ definitionId: 71494, price: 650, sourceUpdatedAt: Date.parse('2026-10-04T02:31:08.528236Z') });
  expect(gg(futggPS, [71494,73562], 'console')[1].price).toBe(650);
});
it('does not substitute another version, platform, malformed response, or missing price', () => {
  expect(bin(futbinFiltered, 71495, 'pc', false).price).toBeNull();
  expect(bin({ data: [{ resource_id: 71494, ps_LCPrice: 200 }] }, 71494, 'pc', false).price).toBeNull();
  expect(() => gg(futggPC, [71494,73562], 'console')).toThrow();
  expect(() => gg(futggPC, [71494], 'pc')).toThrow();
  expect(() => gg({ data: [futggPC.data[0], futggPC.data[0]] }, [71494], 'pc')).toThrow();
  expect(() => bin({ errorcode: '429', data: [] }, 71494, 'pc', false)).toThrow();
  expect(() => bin('bad json', 71494, 'pc', true)).toThrow();
});
