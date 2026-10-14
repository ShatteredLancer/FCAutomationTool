import { expect, it, vi } from 'vitest';
import { readFutbinBatchPrices } from '../../src/fc27/futbin-batch-prices.js';

const players = Array.from({ length: 12 }, (_, i) => ({ definitionId: i + 1, rating: 84 }));
const payload = rows => JSON.stringify({ errorcode: '200', data: rows });
const row = (id, pc = 1000) => ({ resource_id: id, rating: 84, pc_LCPrice: pc, ps_LCPrice: 2500 });

it('retains exact hits on the last page but starts no later page after a planning deadline', async () => {
  let time = 100;
  const request = vi.fn(async () => { time = 200; return payload([row(1), ...Array.from({ length: 31 }, (_, i) => row(i + 100))]); });
  const result = await readFutbinBatchPrices(players.map(p => p.definitionId), players,
    { platform: 'pc', request, now: () => time, deadlineAt: 150 });
  expect(result.requests).toBe(1);
  expect(result.rows).toEqual([expect.objectContaining({ definitionId: 1, price: 1000, fetchedAt: 200 })]);
  expect(request).toHaveBeenCalledOnce();
});

it('reads exact-version prices across real 32-row pages without substituting another platform', async () => {
  let time = 1000;
  const request = vi.fn(async () => { time += 100; return request.mock.calls.length === 1
    ? payload([row(1), ...Array.from({ length: 31 }, (_, i) => row(100 + i))])
    : payload(players.slice(1).map(p => row(p.definitionId))); });
  const result = await readFutbinBatchPrices(players.map(p => p.definitionId), players,
    { platform: 'pc', request, now: () => time });
  expect(result.requests).toBe(2);
  expect(result.rows).toHaveLength(12);
  expect(result.rows[0]).toMatchObject({ definitionId: 1, price: 1000, fetchedAt: 1100 });
  expect(result.rows.at(-1).fetchedAt).toBe(1200);
  expect(request.mock.calls[0][0]).toContain('rating=84-84');
  expect(request.mock.calls[1][0]).toContain('page=2');
});

it('returns only exact hits after bounded pagination; omitted versions remain unresolved for individual fallback', async () => {
  const request = vi.fn(async () => payload(Array.from({ length: 32 }, (_, i) => row(100 + i))));
  const result = await readFutbinBatchPrices(players.map(p => p.definitionId), players, { platform: 'pc', request });
  expect(result.rows).toEqual([]);
  expect(result.requests).toBeLessThanOrEqual(8);
});

it('keeps null prices explicit and uses console quotes only for console', async () => {
  const request = vi.fn(async () => payload([row(1, null), { ...row(2), ps_LCPrice: null }]));
  const pc = await readFutbinBatchPrices([1, 2], players, { platform: 'pc', request });
  expect(pc.rows.map(p => p.price)).toEqual([null, 1000]);
  const consoleResult = await readFutbinBatchPrices([1, 2], players, { platform: 'console', request });
  expect(consoleResult.rows.map(p => p.price)).toEqual([2500, null]);
});

it('stops between pages on source disable/context change and never treats 429 as a partial success', async () => {
  const request = vi.fn(async () => payload(Array.from({ length: 32 }, (_, i) => row(100 + i))));
  const check = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(Error('FC27_PUBLIC_PRICE_FUTBIN_DISABLED'));
  await expect(readFutbinBatchPrices([1], players, { platform: 'pc', request, check })).rejects.toThrow('FUTBIN_DISABLED');
  expect(request).toHaveBeenCalledTimes(1);
  request.mockRejectedValueOnce(Error('FC27_BUY_REFERENCE_HTTP_429'));
  await expect(readFutbinBatchPrices([1], players, { platform: 'pc', request })).rejects.toThrow('HTTP_429');
});

it('rejects malformed, duplicate and mixed-rating batch responses', async () => {
  for (const body of ['{}', payload([row(1), row(1)]), payload([{ ...row(1), rating: 85 }])]) {
    await expect(readFutbinBatchPrices([1], players, { platform: 'pc', request: async () => body }))
      .rejects.toThrow('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
  }
});

it('shares compact pages across quote batches without extending their age, and explicit refresh bypasses them', async () => {
  let time = 1000; const cache = new Map();
  const request = vi.fn(async () => payload([row(1), row(2)]));
  const options = { platform: 'pc', request, now: () => time, cache, quoteTtlMs: 60000 };
  await readFutbinBatchPrices([1], players, options);
  time = 2000;
  const second = await readFutbinBatchPrices([2], players, options);
  expect(second.requests).toBe(0);
  expect(second.rows[0].fetchedAt).toBe(1000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([...cache.values()])).not.toContain('playerimage');
  await readFutbinBatchPrices([2], players, { ...options, force: true });
  expect(request).toHaveBeenCalledTimes(2);
  time = 62000;
  await readFutbinBatchPrices([1], players, options);
  expect(request).toHaveBeenCalledTimes(3);
});
