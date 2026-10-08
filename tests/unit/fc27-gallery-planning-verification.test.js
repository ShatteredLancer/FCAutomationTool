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
  const settingsFixture = () => {
    panelCall.mockResolvedValueOnce({ x: 100, y: 100 });
    const helpers = fixture();
    panelCall.mockResolvedValueOnce({ x: 100, y: 100 }).mockResolvedValueOnce('30');
    for (const value of [30, true, '60', true, 'result', 'result', true, true]) waitForPanel.mockResolvedValueOnce(value);
    const settingsPage = { ...page, evaluate: vi.fn().mockResolvedValue(true),
      mouse: { click: vi.fn().mockResolvedValue(undefined) },
      keyboard: { press: vi.fn().mockResolvedValue(undefined), type: vi.fn().mockResolvedValue(undefined) } };
    return { helpers: { ...helpers, timeoutSettings: 60 }, settingsPage };
  };
  it('saves the timeout, verifies tab-return retention and restores the original account setting', async () => {
    const { helpers, settingsPage } = settingsFixture();
    const result = await verifyGalleryPlanning({}, settingsPage, 'Arsenal', helpers);
    expect(result).toMatchObject({ status: 'observed', timeoutSettings: {
      originalSeconds: 30, requestedSeconds: 60, savedSeconds: 60, saved: true,
      restoredSeconds: 30, restored: true,
    } });
    expect(settingsPage.keyboard.type.mock.calls.map(row => row[0])).toEqual(['60', '30']);
    expect(clickPanelControl.mock.calls.map(row => row[2])).toEqual([
      '#gallery-planning-settings button', '.gallery-open-set', '.plan-generate', '.plan-overview',
      '.gallery-open-set', '#gallery-planning-settings button',
    ]);
  });
  it('reports restoration failure instead of returning a successful inspection', async () => {
    const { helpers, settingsPage } = settingsFixture();
    settingsPage.keyboard.type.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('private'));
    const result = await verifyGalleryPlanning({}, settingsPage, 'Arsenal', helpers);
    expect(result).toMatchObject({ status: 'blocked', reason: 'FC27_GALLERY_PLANNING_SETTINGS_NOT_RESTORED',
      timeoutSettings: { restoreFailed: true } });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('never restores a setting into a different account', async () => {
    const { helpers, settingsPage } = settingsFixture();
    settingsPage.evaluate.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await verifyGalleryPlanning({}, settingsPage, 'Arsenal', helpers);
    expect(result).toMatchObject({ status: 'blocked', timeoutSettings: { restoreFailed: true } });
    expect(settingsPage.keyboard.type.mock.calls.map(row => row[0])).toEqual(['60']);
  });
});
