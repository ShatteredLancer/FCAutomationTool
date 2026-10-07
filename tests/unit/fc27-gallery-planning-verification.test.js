import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyGalleryPlanning } from '../../scripts/browser-inspection/gallery-planning-verification.mjs';
import { panelCall, waitForPanel, clickPanelControl, selectPanelTab } from '../../scripts/browser-inspection/production-panel-inspection.mjs';

vi.mock('../../scripts/browser-inspection/production-panel-inspection.mjs', () => ({
  panelCall: vi.fn(), waitForPanel: vi.fn(), clickPanelControl: vi.fn(), selectPanelTab: vi.fn(),
}));

describe('installed Gallery planning acceptance', () => {
  const output = { plan: '方案 1：200 金币', overview: 'S 200 金币', overviewRows: ['S 200 金币'], grade: 'S', gradeRows: 5, cards: 24 };
  const page = { waitForTimeout: vi.fn().mockResolvedValue(undefined) };
  beforeEach(() => { vi.resetAllMocks(); waitForPanel.mockResolvedValue('result'); });
  const fixture = (after = output, categories = true) => {
    for (const value of ['.gallery-open-set', '.plan-generate', '.plan-overview', output, categories,
      '.gallery-open-set', after]) panelCall.mockResolvedValueOnce(value);
    return { readGallery: vi.fn().mockResolvedValue({ status: 'observed' }) };
  };
  it('checks plan, per-grade costs and tab-return persistence without transaction clicks', async () => {
    const helpers = fixture();
    const result = await verifyGalleryPlanning({}, page, 'Arsenal', helpers);
    expect(result).toMatchObject({ status: 'observed', planRetained: true, overviewRetained: true,
      categoriesOnly: true, planningOutcome: 'candidate-or-achieved', executable: false, liveExecutionEnabled: false });
    expect(clickPanelControl.mock.calls.map(row => row[2])).toEqual([
      '.gallery-open-set', '.plan-generate', '.plan-overview', '.gallery-open-set',
    ]);
    expect(selectPanelTab.mock.calls.map(row => row[2])).toEqual(['settings', 'gallery']);
    expect(helpers.readGallery).toHaveBeenCalledTimes(2);
  });
  it.each([
    [{ ...output, plan: '' }, true], [{ ...output, overview: '', overviewRows: [] }, true], [output, false],
    [{ ...output, overviewRows: ['S 300 金币'] }, true],
  ])('fails acceptance when retained output or category-only navigation is lost', async (after, categories) => {
    const result = await verifyGalleryPlanning({}, page, 'Arsenal', fixture(after, categories));
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PLAN_DISPLAY_NOT_RETAINED' });
  });
  it('stops before UI operations when the set cannot be read', async () => {
    const result = await verifyGalleryPlanning({}, page, 'Arsenal', {
      readGallery: async () => ({ status: 'blocked', reason: 'FC27_GALLERY_SET_UNAVAILABLE' }),
    });
    expect(result.reason).toBe('FC27_GALLERY_SET_UNAVAILABLE');
    expect(clickPanelControl).not.toHaveBeenCalled();
  });
  it('retains partial grade results when a stale-data footer replaces the timeout note', async () => {
    const result = await verifyGalleryPlanning({}, page, 'Arsenal', fixture({
      ...output, overview: 'S 200 金币数据或报价已更新，保留上次各档费用；请重新计算。',
    }));
    expect(result).toMatchObject({ status: 'observed', overviewRetained: true });
  });
  it('reports the failed phase without exposing arbitrary exceptions', async () => {
    const helpers = fixture();
    waitForPanel.mockResolvedValueOnce(true).mockRejectedValueOnce(Error('private response'));
    const result = await verifyGalleryPlanning({}, page, 'Arsenal', helpers);
    expect(result).toMatchObject({ status: 'blocked', phase: 'plan', reason: 'FC27_GALLERY_PLANNING_VERIFICATION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('private response');
  });
});
