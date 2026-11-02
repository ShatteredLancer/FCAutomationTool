import { expect, it, vi } from 'vitest';
import { enterNativeSbc, enterNativeSbcReadOnly, enterNativeSet, observePageUi } from '../../scripts/browser-inspection/navigation.mjs';
import { WEB_APP_URL } from '../../scripts/browser-inspection/automatic.mjs';

function pageFixture(visible = ['.ut-home-hub-view', '.ut-tab-bar-item.icon-sbc']) {
  const click = vi.fn();
  return { click, waitForFunction: vi.fn(async () => {}), url: () => WEB_APP_URL, locator: selector => ({
    count: async () => visible.includes(selector) ? 1 : 0,
    isVisible: async () => true, evaluateAll: async () => [], click,
    filter: () => ({ count: async () => 0 }),
  }) };
}
it('bounds native challenge and modal diagnostics without reading the account header', async () => {
  const page = pageFixture(), original = page.locator;
  const validClasses = Array.from({ length: 10 }, (_, i) => `native-${i}`);
  const action = { textContent: `   Go   ${'x'.repeat(200)} `, disabled: true,
    classList: ['invalid value', 'x'.repeat(62), ...validClasses],
    parentElement: { classList: ['private value', ...validClasses] }, getClientRects: () => [{}] };
  const modal = { textContent: 'x'.repeat(900),
    querySelector: () => ({ textContent: 't'.repeat(200) }),
    querySelectorAll: () => Array.from({ length: 10 }, () => ({ textContent: 'b'.repeat(200), disabled: false })) };
  const selectors = [];
  page.locator = selector => {
    selectors.push(selector);
    const locator = original(selector);
    if (selector === '.ut-sbc-challenges-view button') locator.evaluateAll = async fn => fn(Array(30).fill(action));
    if (selector === '.view-modal-container') locator.evaluateAll = async fn => fn(Array(3).fill(modal));
    return locator;
  };
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'hidden' }));
  try {
    const ui = await observePageUi(page);
    expect(ui.challengeActions).toHaveLength(24);
    expect(ui.challengeActions[0]).toEqual({ text: `Go ${'x'.repeat(97)}`, disabled: true, visible: false,
      classes: validClasses.slice(0, 8), parentClasses: validClasses.slice(0, 8) });
    expect(ui.modalText).toHaveLength(2);
    expect(ui.modalText[0]).toEqual({ title: 't'.repeat(160), text: 'x'.repeat(600),
      buttons: Array.from({ length: 8 }, () => ({ text: 'b'.repeat(100), disabled: false })) });
    expect(selectors).not.toContain('body');
    expect(page.click).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
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
it('opens only the unique visible unselected All category when the requested set is hidden', async () => {
  const page = pageFixture(['.ut-sbc-hub-view']);
  const original = page.locator;
  const allClick = vi.fn();
  let count = 1, visible = true, classes = 'ea-filter-bar-item-view';
  const filter = vi.fn(() => ({ count: async () => count, isVisible: async () => visible,
    getAttribute: async () => classes, click: allClick }));
  page.locator = selector => selector === '.ut-sbc-hub-view button.ea-filter-bar-item-view'
    ? { filter } : original(selector);
  expect(await enterNativeSbcReadOnly(page, { title: 'Sample' })).toBe('ALL_SETS_FILTER_OPENED');
  expect(filter).toHaveBeenCalledWith({ hasText: /^All$/ });
  expect(allClick).toHaveBeenCalledOnce();
  classes += ' selected';
  expect(await enterNativeSbcReadOnly(page, { title: 'Sample' })).toBe('SET_TILE_AMBIGUOUS_OR_MISSING');
  classes = ''; visible = false;
  expect(await enterNativeSbcReadOnly(page, { title: 'Sample' })).toBe('SET_TILE_AMBIGUOUS_OR_MISSING');
  visible = true; count = 2;
  expect(await enterNativeSbcReadOnly(page, { title: 'Sample' })).toBe('SET_TILE_AMBIGUOUS_OR_MISSING');
  expect(allClick).toHaveBeenCalledOnce();
  expect(page.click).not.toHaveBeenCalled();
});
it('keeps read-only navigation out of loading pages and dialogs', async () => {
  for (const extra of ['.view-modal-container', '.ut-loading-view']) {
    const page = pageFixture(['.ut-sbc-hub-view', extra]);
    expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
    expect(page.click).not.toHaveBeenCalled();
  }
  expect(await enterNativeSbcReadOnly(pageFixture())).toBe('SBC_HUB_OPENED');
});
it('returns from a native challenge list only when its entry button proves no editor is open', async () => {
  const page = pageFixture(['.ut-sbc-challenges-view', '.ut-tab-bar-item.icon-sbc']);
  const original = page.locator;
  let count = 1, visible = true;
  page.locator = selector => selector === '.ut-sbc-challenges-view button.btn-standard.primary'
    ? { filter: () => ({ count: async () => count, isVisible: async () => visible }) }
    : original(selector);
  expect(await enterNativeSbcReadOnly(page)).toBe('SBC_HUB_OPENED');
  expect(page.click).toHaveBeenCalledOnce();
  count = 0;
  expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
  count = 2;
  expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
  count = 1; visible = false;
  expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
  expect(page.click).toHaveBeenCalledOnce();
});
it('recognizes the public native challenge-list structure without an entry button', async () => {
  const visible = ['.ut-sbc-challenges-view', '.ut-tab-bar-item.icon-sbc'];
  const page = pageFixture(visible), original = page.locator;
  let listCount = 1, rowCount = 4, rowVisible = true;
  page.locator = selector => selector === '.ut-sbc-challenges-view--challenges'
    ? { count: async () => listCount, isVisible: async () => true }
    : selector === '.ut-sbc-challenges-view--challenges .ut-sbc-challenge-table-row-view'
      ? { count: async () => rowCount, first: () => ({ isVisible: async () => rowVisible }) }
      : original(selector);
  expect(await enterNativeSbcReadOnly(page)).toBe('SBC_HUB_OPENED');
  for (const count of [0, 51]) {
    rowCount = count;
    expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
  }
  rowCount = 4; rowVisible = false;
  expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
  rowVisible = true; listCount = 2;
  expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
  listCount = 1;
  for (const blocker of ['.view-modal-container', '.ut-login-content', '.ut-loading-view', '.ut-sbc-set-view', '.ut-one-click-sbc-work-area-view']) {
    visible.push(blocker);
    expect(await enterNativeSbcReadOnly(page)).toBe('NATIVE_HOME_NOT_CONFIRMED');
    visible.pop();
  }
  expect(page.click).toHaveBeenCalledOnce();
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
