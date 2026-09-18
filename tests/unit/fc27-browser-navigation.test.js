import { expect, it, vi } from 'vitest';
import { enterNativeSbc, enterNativeSet, observePageUi } from '../../scripts/browser-inspection/navigation.mjs';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

function pageFixture(visible = ['.ut-home-hub-view', '.ut-tab-bar-item.icon-sbc']) {
  const click = vi.fn();
  return { click, url: () => WEB_APP_URL, locator: selector => ({
    count: async () => visible.includes(selector) ? 1 : 0,
    isVisible: async () => true, evaluateAll: async () => [], click,
  }) };
}
it('allows only an isolated native Home to SBC tab transition', async () => {
  const page = pageFixture();
  expect(await enterNativeSbc(page, { extensionsDisabled: true })).toBe('SBC_TAB_REQUESTED');
  expect(page.click).toHaveBeenCalledOnce();
});
it('recognizes the observed FC27 home tiles without the old home wrapper', async () => {
  const page = pageFixture(['.ut-tile-hub-sbc', '.ut-tile-hub-objective', '.ut-tab-bar-item.icon-sbc']);
  expect(await enterNativeSbc(page, { extensionsDisabled: true })).toBe('SBC_TAB_REQUESTED');
  expect(page.click).toHaveBeenCalledOnce();
});
it('does not navigate with extensions, modals, a squad/set, or an unsupported page', async () => {
  const page = pageFixture();
  expect(await enterNativeSbc(page)).toBe('EXTENSIONS_NOT_ISOLATED');
  expect(page.click).not.toHaveBeenCalled();
  for (const extra of ['.view-modal-container', '.ut-sbc-set-view', '.ut-sbc-challenges-view', '.ut-loading-view']) {
    const blocked = pageFixture(['.ut-home-hub-view', '.ut-tab-bar-item.icon-sbc', extra]);
    expect(await enterNativeSbc(blocked, { extensionsDisabled: true })).toBe('NATIVE_HOME_NOT_CONFIRMED');
    expect(blocked.click).not.toHaveBeenCalled();
  }
  page.url = () => 'https://accounts.ea.com/';
  expect(await observePageUi(page)).toBeNull();
});
it('requires an isolated hub and a unique native tile whose title matches the observed set ID', async () => {
  const page = pageFixture(['.ut-sbc-hub-view']);
  const original = page.locator;
  const tile = { click: page.click, isVisible: async () => true,
    locator: () => ({ count: async () => 1, textContent: async () => 'Intro to SBCs' }) };
  let tileCount = 1;
  page.locator = selector => selector === '.ut-sbc-set-tile-view'
    ? { count: async () => tileCount, nth: () => tile, evaluateAll: async () => [] } : original(selector);
  const runtime = { sbc: { sets: { samples: [{ id: 1, name: 'Intro to SBCs' }] } } };
  expect(await enterNativeSet(page, runtime, 1)).toBe('EXTENSIONS_NOT_ISOLATED');
  expect(await enterNativeSet(page, runtime, 2, { extensionsDisabled: true })).toBe('SET_IDENTITY_UNAVAILABLE');
  expect(page.click).not.toHaveBeenCalled();
  expect(await enterNativeSet(page, runtime, 1, { extensionsDisabled: true })).toBe('SET_OPEN_REQUESTED');
  tileCount = 2;
  expect(await enterNativeSet(page, runtime, 1, { extensionsDisabled: true })).toBe('SET_TILE_AMBIGUOUS_OR_MISSING');
  expect(page.click).toHaveBeenCalledOnce();
});
