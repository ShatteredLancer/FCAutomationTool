import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyProductionGallery } from '../../scripts/browser-inspection/gallery-verification.mjs';
import { panelCall, waitForPanel, clickPanelControl } from '../../scripts/browser-inspection/production-panel-inspection.mjs';
import { createNetworkCollector } from '../../scripts/browser-inspection/probe.mjs';

vi.mock('../../scripts/browser-inspection/production-panel-inspection.mjs', () => ({
  panelCall: vi.fn(), waitForPanel: vi.fn(), clickPanelControl: vi.fn(),
}));
vi.mock('../../scripts/browser-inspection/probe.mjs', () => ({ createNetworkCollector: vi.fn() }));

describe('consolidated read-only Gallery verification', () => {
  const stops = [];
  const quote = { text: 'EA 250 金币 · 参考 300 金币', reason: '', visibleListings: 1 };
  beforeEach(() => {
    vi.resetAllMocks(); stops.length = 0;
    waitForPanel.mockResolvedValue(true);
    createNetworkCollector.mockImplementation(() => {
      const stop = vi.fn(); stops.push(stop);
      return { snapshot: () => ({ total: 0, capped: false }), stop };
    });
  });
  const fixture = (first = quote, repeat = first) => {
    for (const value of [{ purchase: { resumeVisible: false }, sync: {} }, '.gallery-open-set',
      '.missing-filter', '.gallery-card', first, repeat, {}]) panelCall.mockResolvedValueOnce(value);
    return { readGallery: vi.fn().mockResolvedValue({ status: 'observed' }), now: () => 1000, planning: false };
  };
  it('uses independent phase collectors and only browse/filter/compare clicks', async () => {
    const helpers = fixture();
    const result = await verifyProductionGallery({}, {}, 'Arsenal', helpers);
    expect(result.status).toBe('observed');
    expect(result.comparison.sameResult).toBe(true);
    expect(result.syncWait.status).toBe('idle');
    expect(result.samples.map(row => row.phase)).toEqual(['first-open', 'compare', 'compare-repeat', 'reopen']);
    expect(stops).toHaveLength(4);
    expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    expect(clickPanelControl.mock.calls.map(call => call[2])).toEqual([
      '.gallery-open-set', '.missing-filter', '.gallery-card .gallery-card-compare', '.gallery-card .gallery-card-compare',
    ]);
    expect(result).toMatchObject({ executable: false, liveExecutionEnabled: false,
      purchaseAcceptance: 'USER_PURCHASE_REQUIRED', syncAcceptance: 'SAME_SESSION_ONLY',
      networkCoverage: 'OFFICIAL_PAGE_RESPONSES_ONLY_EXCLUDES_GM_PUBLIC_REQUESTS' });
  });
  it('does not report verification success after a comparison failure', async () => {
    const result = await verifyProductionGallery({}, {}, 'Arsenal', fixture({ text: '失败', reason: 'FC27_MARKET_UNAVAILABLE' }));
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_MARKET_UNAVAILABLE' });
  });
  it('records changed comparison output instead of calling it cache reuse', async () => {
    const result = await verifyProductionGallery({}, {}, 'Arsenal', fixture(quote, { ...quote, text: 'EA 300 金币' }));
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_COMPARISON_CHANGED' });
  });
  it('returns a distinct reason when the background sync remains busy', async () => {
    let clock = 0;
    const helpers = fixture();
    const busy = { busy: true, state: { task: { active: true }, readerBusy: true }, note: '同步 EA 收集 1/1' };
    panelCall.mockReset();
    for (const value of [{ purchase: { resumeVisible: false }, sync: {} }, '.gallery-open-set', '.missing-filter',
      '.gallery-card', quote, quote, busy, busy]) panelCall.mockResolvedValueOnce(value);
    panelCall.mockResolvedValue(busy);
    const result = await verifyProductionGallery({}, {}, 'Arsenal', {
      ...helpers, now: () => { clock += 100; return clock; }, syncTimeoutMs: 250,
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_SYNC_STILL_RUNNING', syncWait: { status: 'timeout' } });
  });
  it('stops before clicks when the initial set read fails', async () => {
    const result = await verifyProductionGallery({}, {}, 'Arsenal', {
      readGallery: async () => ({ status: 'blocked', reason: 'FC27_GALLERY_SET_UNAVAILABLE' }),
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_SET_UNAVAILABLE', liveExecutionEnabled: false });
    expect(clickPanelControl).not.toHaveBeenCalled();
    expect(stops[0]).toHaveBeenCalledOnce();
  });
  it('allows a progressing sync beyond three minutes to finish within the bounded window', async () => {
    vi.useFakeTimers();
    try {
      const helpers = fixture();
      panelCall.mockReset();
      for (const value of [{ purchase: {}, sync: {} }, '.gallery-open-set', '.missing-filter',
        '.gallery-card', quote, quote]) panelCall.mockResolvedValueOnce(value);
      const startedAt = Date.now();
      panelCall.mockImplementation(async () => ({
        busy: Date.now() - startedAt < 210000,
        state: { task: { active: Date.now() - startedAt < 210000 } },
        note: 'sync progressing',
      }));
      const pending = verifyProductionGallery({}, {}, 'Arsenal', { ...helpers, now: () => Date.now() });
      await vi.advanceTimersByTimeAsync(210250);
      const result = await pending;
      expect(result.status).toBe('observed');
      expect(result.syncWait.status).toBe('idle');
      expect(result.syncWait.elapsedMs).toBeGreaterThan(180000);
      expect(result.syncWait.elapsedMs).toBeLessThan(300000);
    } finally { vi.useRealTimers(); }
  });
  it('cleans up collectors and never exports raw error content', async () => {
    const result = await verifyProductionGallery({}, {}, 'Arsenal', { readGallery: async () => { throw Error('private response'); } });
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_VERIFICATION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('private response');
    expect(stops[0]).toHaveBeenCalledOnce();
  });
  it('preserves the completed read and current control state on comparison timeout', async () => {
    const helpers = fixture();
    waitForPanel.mockResolvedValueOnce(true).mockRejectedValueOnce(Error('FC27_INSPECTION_PANEL_TIMEOUT'));
    const result = await verifyProductionGallery({}, {}, 'Arsenal', helpers);
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_INSPECTION_PANEL_TIMEOUT',
      phase: 'compare', initial: { status: 'observed' }, comparisonState: quote });
    expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  });
});
