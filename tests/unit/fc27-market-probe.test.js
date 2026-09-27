import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { inspectFc27MarketRuntime } from '../../scripts/browser-inspection/market-probe.mjs';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

const observation = JSON.parse(readFileSync(new URL('../fixtures/fc27-market-probe-observation.json', import.meta.url), 'utf8'));

it('attaches a planner-compatible projection to the real probe report without another EA request', async () => {
  const probe = structuredClone(observation.probe);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1790387152536);
  const page = { url: () => WEB_APP_URL, evaluate: vi.fn(async () => probe) };
  try {
    const report = await inspectFc27MarketRuntime(page);
    expect(report).toMatchObject({ status: 'observed', reason: 'FC27_MARKET_SAMPLE_OBSERVED', requests: 4,
      planningSnapshot: { status: 'ready', executable: false, liveExecutionEnabled: false,
        marketAvailabilityVerified: false, coverage: { quotedVersions: 3, catalogEntries: 20 } } });
    expect(report.catalog).toEqual(probe.catalog);
    expect(report.planningSnapshot.data).not.toHaveProperty('marketPolicy');
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls[0][0]).not.toContain('projectFc27EaMarketSnapshot');
  } finally { now.mockRestore(); }
});

it.each(['expired', 'platform'])('keeps read success distinct from unavailable planning evidence: %s', async mode => {
  const probe = structuredClone(observation.probe);
  if (mode === 'platform') delete probe.quotes[0].platform;
  const now = vi.spyOn(Date, 'now').mockReturnValue(1790387152536 + (mode === 'expired' ? 600001 : 0));
  try {
    const report = await inspectFc27MarketRuntime({ url: () => WEB_APP_URL, evaluate: async () => probe });
    expect(report.status).toBe('observed');
    expect(report.planningSnapshot).toMatchObject({ status: 'blocked', executable: false });
    expect(report.planningSnapshot).not.toHaveProperty('data');
  } finally { now.mockRestore(); }
});

it('preserves blocked probe reasons without constructing a planning snapshot', async () => {
  const probe = { status: 'blocked', reason: 'FC27_MARKET_HTTP_429', requests: 1, liveExecutionEnabled: false };
  expect(await inspectFc27MarketRuntime({ url: () => WEB_APP_URL, evaluate: async () => probe })).toEqual(probe);
});

it('does not evaluate anything on a non-Web-App page', async () => {
  const page = { url: () => 'https://example.com/', evaluate: vi.fn() };
  expect(await inspectFc27MarketRuntime(page)).toMatchObject({ status: 'blocked', reason: 'WEB_APP_REQUIRED' });
  expect(page.evaluate).not.toHaveBeenCalled();
});
