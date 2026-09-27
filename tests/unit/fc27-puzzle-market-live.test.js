import { expect, it, vi } from 'vitest';
import { inspectPuzzleMarketLive } from '../../scripts/browser-inspection/puzzle-market-live.mjs';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

it('does not inspect a non Web App page', async () => {
  const page = { url: () => 'https://example.test/', evaluate: vi.fn() };
  expect(await inspectPuzzleMarketLive(page, 19, 43)).toMatchObject({
    status: 'blocked', reason: 'WEB_APP_REQUIRED', executable: false, liveExecutionEnabled: false,
  });
  expect(page.evaluate).not.toHaveBeenCalled();
});

it('rejects malformed challenge identifiers before building a page probe', async () => {
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn() };
  expect(await inspectPuzzleMarketLive(page, 0, 43)).toMatchObject({
    status: 'blocked', reason: 'FC27_MARKET_ROUTE_INPUT_INVALID',
  });
  expect(page.evaluate).not.toHaveBeenCalled();
});

it('builds a bounded read-only route and never exposes a write command', async () => {
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn(async source => {
    expect(typeof source).toBe('string');
    expect(source).toContain('createFc27MarketReadTransport');
    expect(source).toContain('readCatalogPage');
    expect(source).toContain('readQuotePage');
    expect(source).not.toMatch(/placeBid|createOrder|submitSbc/);
    return { status: 'blocked', reason: 'FC27_MARKET_ROUTE_OBSERVED', executable: false };
  }) };
  await expect(inspectPuzzleMarketLive(page, 19, 43)).resolves.toMatchObject({
    status: 'blocked', reason: 'FC27_MARKET_ROUTE_OBSERVED', executable: false,
  });
  expect(page.evaluate).toHaveBeenCalledOnce();
});
