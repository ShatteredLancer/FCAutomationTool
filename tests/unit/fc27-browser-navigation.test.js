import { expect, it, vi } from 'vitest';
import { enterNativeSbc, enterNativeSbcReadOnly, enterNativeSet, observePageUi } from '../../scripts/browser-inspection/navigation.mjs';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

function pageFixture(visible = ['.ut-home-hub-view', '.ut-tab-bar-item.icon-sbc']) {
  const click = vi.fn();
  return { click, waitForFunction: vi.fn(async () => {}), url: () => WEB_APP_URL, locator: selector => ({
    count: async () => visible.includes(selector) ? 1 : 0,
    isVisible: async () => true, evaluateAll: async () => [], click,
  }) };
}
it('opens only the unique requested native title, never a plugin action', async () => {
  const page = pageFixture(['.ut-sbc-hub-view']);
  const original = page.locator, headerClick = vi.fn();
  let names = ['Intro to Streamlined SBCs', 'Gold Upgrade'];
  page.locator = selector => selector === '.ut-sbc-set-tile-view' ? {
    count: async () => names.length, evaluateAll: async () => [],
    nth: i => ({ isVisible: async () => true, click: page.click, getAttribute: async () => '',
      locator: () => ({ count: async () => 1, textContent: async () => names[i], click: headerClick }) }),
  } : original(selector);
  const options = { title: 'Intro to Streamlined SBCs' };
  expect(await enterNativeSbcReadOnly(page, options)).toBe('SET_OPENED');
  expect(headerClick).toHaveBeenCalledOnce();
  expect(page.click).not.toHaveBeenCalled();
  names = ['Gold Upgrade'];
  expect(await enterNativeSbcReadOnly(page, options)).toBe('SET_TILE_AMBIGUOUS_OR_MISSING');
  names = [options.title, options.title];
  expect(await enterNativeSbcReadOnly(page, options)).toBe('SET_TILE_AMBIGUOUS_OR_MISSING');
  names = Array(101).fill(options.title);
  expect(await enterNativeSbcReadOnly(page, options)).toBe('SET_SCAN_LIMIT');
  expect(headerClick).toHaveBeenCalledOnce();
});
it('keeps read-only navigation out of loading pages and dialogs', async () => {
  for (const extra of ['.view-modal-container', '.ut-loading-view']) {
    const page = pageFixture(['.ut-sbc-hub-view', extra]);
    expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
    expect(page.click).not.toHaveBeenCalled();
  }
  expect(await enterNativeSbcReadOnly(pageFixture())).toBe('SBC_HUB_OPENED');
});
it('does not click completed or disabled sets, and never reports an unconfirmed click as entry', async () => {
  const page = pageFixture(['.ut-sbc-hub-view']);
  const original = page.locator;
  let classes = 'ut-sbc-set-tile-view disabled complete';
  const header = { count: async () => 1, textContent: async () => 'Sample', click: page.click };
  const tile = { isVisible: async () => true, getAttribute: async name => name === 'class' ? classes : null,
    locator: () => header };
  page.locator = selector => selector === '.ut-sbc-set-tile-view'
    ? { count: async () => 1, nth: () => tile, evaluateAll: async () => [] } : original(selector);
  const runtime = { sbc: { sets: { samples: [{ id: 7, name: 'Sample' }] } } };
  const readers = [() => enterNativeSbcReadOnly(page, { title: 'Sample' }),
    () => enterNativeSet(page, runtime, 7, { extensionsDisabled: true })];
  for (const read of readers) {
    classes = 'disabled complete'; expect(await read()).toBe('SET_COMPLETED');
    classes = 'disabled'; expect(await read()).toBe('SET_DISABLED');
  }
  expect(page.click).not.toHaveBeenCalled();
  classes = ''; page.waitForFunction.mockRejectedValue(new Error('No transition'));
  for (const read of readers) expect(await read()).toBe('SET_OPEN_UNCONFIRMED');
  expect(page.click).toHaveBeenCalledTimes(2);
});
it('confirms visible native destination, excluding a lingering hub, login, loading and dialogs', async () => {
  const page = pageFixture();
  expect(await enterNativeSbcReadOnly(page)).toBe('SBC_HUB_OPENED');
  const [predicate, args, options] = page.waitForFunction.mock.calls[0];
  expect(options.timeout).toBe(4000);
  const visible = new Set();
  vi.stubGlobal('document', { querySelectorAll: selector => visible.has(selector) ? [{ getClientRects: () => [{}] }] : [] });
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  try {
    expect(predicate(args)).toBe(false);
    visible.add('.ut-sbc-hub-view'); expect(predicate(args)).toBe(true);
    for (const selector of ['.ut-login-content', '.view-modal-container', '.ut-loading-view']) {
      visible.add(selector); expect(predicate(args)).toBe(false); visible.delete(selector);
    }
    const destination = { ...args, selectors: ['.ut-one-click-sbc-work-area-view'], hub: '.ut-sbc-hub-view' };
    visible.add('.ut-one-click-sbc-work-area-view'); expect(predicate(destination)).toBe(false);
    visible.delete('.ut-sbc-hub-view'); expect(predicate(destination)).toBe(true);
  } finally { vi.unstubAllGlobals(); }
  page.waitForFunction.mockRejectedValue(new Error('No transition'));
  expect(await enterNativeSbcReadOnly(page)).toBe('SBC_TAB_UNCONFIRMED');
});
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
  const tile = { click: page.click, isVisible: async () => true, getAttribute: async () => '',
    locator: () => ({ count: async () => 1, textContent: async () => 'Intro to SBCs', click: page.click }) };
  let tileCount = 1;
  page.locator = selector => selector === '.ut-sbc-set-tile-view'
    ? { count: async () => tileCount, nth: () => tile, evaluateAll: async () => [] } : original(selector);
  const runtime = { sbc: { sets: { samples: [{ id: 1, name: 'Intro to SBCs' }] } } };
  expect(await enterNativeSet(page, runtime, 1)).toBe('EXTENSIONS_NOT_ISOLATED');
  expect(await enterNativeSet(page, runtime, 2, { extensionsDisabled: true })).toBe('SET_IDENTITY_UNAVAILABLE');
  expect(page.click).not.toHaveBeenCalled();
  expect(await enterNativeSet(page, runtime, 1, { extensionsDisabled: true })).toBe('SET_OPENED');
  tileCount = 2;
  expect(await enterNativeSet(page, runtime, 1, { extensionsDisabled: true })).toBe('SET_TILE_AMBIGUOUS_OR_MISSING');
  expect(page.click).toHaveBeenCalledOnce();
});
