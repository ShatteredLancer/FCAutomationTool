import { pageKind } from './probe.mjs';

const SELECTORS = Object.freeze({ home: '.ut-home-hub-view', homeView: '.ut-home-view', sbc: '.ut-sbc-hub-view',
  homeSbcTile: '.ut-tile-hub-sbc', homeObjectiveTile: '.ut-tile-hub-objective',
  set: '.ut-sbc-set-view', challenges: '.ut-sbc-challenges-view', streamlined: '.ut-one-click-sbc-work-area-view',
  sbcTab: '.ut-tab-bar-item.icon-sbc', modal: '.view-modal-container',
  login: '.ut-login-content', loading: '.ut-loading-view' });

export async function observePageUi(page) {
  if (pageKind(page.url()) !== 'web-app') return null;
  const result = {};
  for (const [name, selector] of Object.entries(SELECTORS)) {
    const nodes = page.locator(selector);
    const count = await nodes.count();
    result[name] = count === 1 ? await nodes.isVisible() : count === 0 ? false : null;
  }
  const containers = page.locator('.ut-navigation-container-view--content');
  result.structure = await containers.evaluateAll(nodes => {
    const result = new Set();
    let visited = 0;
    function visit(node, depth) {
      if (depth > 3 || ++visited > 60) return;
      for (const name of node.classList) if (/^ut-[a-z-]{1,70}$/.test(name)) result.add(name);
      for (const child of Array.from(node.children).slice(0, 12)) visit(child, depth + 1);
    }
    for (const node of nodes.slice(0, 2)) visit(node, 0);
    return [...result].slice(0, 40);
  });
  // Only native SBC titles, never the account header or a whole-page text dump.
  result.setTitles = await page.locator('.ut-sbc-set-tile-view .tileHeader').evaluateAll(nodes =>
    nodes.slice(0, 100).map(node => (node.textContent || '').trim().slice(0, 160)));
  result.setActions = await page.locator('.ut-sbc-set-tile-view').evaluateAll(nodes => nodes.slice(0, 100).map(node => ({
    title: (node.querySelector('.tileHeader')?.textContent || '').trim().slice(0, 160),
    classes: Array.from(node.classList).slice(0, 12),
    status: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 400),
    actions: Array.from(node.querySelectorAll('button')).slice(0, 4).map(button => ({
      text: (button.textContent || '').trim().slice(0, 100), disabled: button.disabled,
      classes: Array.from(button.classList).filter(name => /^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(name)).slice(0, 8),
    })),
  })));
  result.publicScripts = await page.locator('script[src]').evaluateAll(nodes => nodes.slice(0, 40).flatMap(node => {
    try {
      const url = new URL(node.src);
      if (url.protocol !== 'https:' || !['www.ea.com', 'www.easports.com'].includes(url.hostname)
          || !/^\/ea-sports-fc\/ultimate-team\/web-app\/js\/[\w.-]+\.js$/.test(url.pathname)) return [];
      return [url.origin + url.pathname];
    } catch { return []; }
  }));
  return result;
}

// Only a native Home -> SBC tab transition is permitted. Never leave a squad,
// dismiss a dialog, or invoke a plugin's solver to obtain diagnostic evidence.
export async function enterNativeSbc(page, { extensionsDisabled = false } = {}) {
  if (!extensionsDisabled) return 'EXTENSIONS_NOT_ISOLATED';
  const ui = await observePageUi(page);
  if (!ui || !(ui.home === true || ui.homeView === true || ui.homeSbcTile === true && ui.homeObjectiveTile === true)
      || ui.sbcTab !== true || ui.modal !== false
      || ui.loading !== false || ui.set !== false || ui.challenges !== false) return 'NATIVE_HOME_NOT_CONFIRMED';
  try {
    await page.locator(SELECTORS.sbcTab).click({ timeout: 3000 });
    return 'SBC_TAB_REQUESTED';
  } catch { return 'SBC_TAB_UNCONFIRMED'; }
}

// Read-only navigation used by the FC27 Streamlined inspector.  This performs
// only native navigation and does not invoke FCAT/FSU/Futto automation,
// select materials, or issue an EA write request. It is kept
// separate from enterNativeSbc so the older isolated-baseline checks retain
// their extension isolation contract.
export async function enterNativeSbcReadOnly(page, { title = '83+ Upgrade' } = {}) {
  const ui = await observePageUi(page);
  if (ui?.sbc === true && ui.modal === false && ui.loading === false) {
    const tiles = page.locator('.ut-sbc-set-tile-view');
    const count = await tiles.count();
    if (count > 100) return 'SET_SCAN_LIMIT';
    const matches = [];
    for (let i = 0; i < count; i++) {
      const tile = tiles.nth(i), header = tile.locator('.tileHeader');
      if (await header.count() === 1 && (await header.textContent())?.trim() === title && await tile.isVisible()) matches.push(tile);
    }
    if (matches.length !== 1) return 'SET_TILE_AMBIGUOUS_OR_MISSING';
    return openNativeTile(page, matches[0]);
  }
  if (!ui || !(ui.home === true || ui.homeView === true || ui.homeSbcTile === true && ui.homeObjectiveTile === true)
      || ui.sbcTab !== true || ui.modal !== false || ui.loading !== false
      || ui.set !== false || ui.challenges !== false || ui.streamlined !== false) return 'NATIVE_HOME_NOT_CONFIRMED';
  try {
    await page.locator(SELECTORS.sbcTab).click({ timeout: 3000 });
    await waitForNativeView(page, [SELECTORS.sbc]);
    return 'SBC_HUB_OPENED';
  } catch { return 'SBC_TAB_UNCONFIRMED'; }
}

async function waitForNativeView(page, selectors) {
  await page.waitForFunction(({ selectors, blockers, hub }) => {
    const visible = selector => Array.from(globalThis.document.querySelectorAll(selector)).some(node =>
      node.getClientRects().length > 0 && globalThis.getComputedStyle(node).visibility !== 'hidden');
    return !blockers.some(visible) && (!hub || !visible(hub)) && selectors.some(visible);
  }, { selectors, blockers: [SELECTORS.login, SELECTORS.modal, SELECTORS.loading],
    hub: selectors.includes(SELECTORS.sbc) ? null : SELECTORS.sbc }, { timeout: 4000 });
}

async function openNativeTile(page, tile) {
  try {
    const classes = (await tile.getAttribute('class') ?? '').split(/\s+/);
    if (classes.includes('complete')) return 'SET_COMPLETED';
    if (classes.includes('disabled') || await tile.getAttribute('aria-disabled') === 'true') return 'SET_DISABLED';
    // Only the native title, away from favourite/info/plugin buttons.
    await tile.locator('.tileHeader').click({ timeout: 3000 });
    await waitForNativeView(page, [SELECTORS.streamlined, SELECTORS.set, SELECTORS.challenges]);
    return 'SET_OPENED';
  } catch { return 'SET_OPEN_UNCONFIRMED'; }
}

export async function enterNativeSet(page, runtime, setId, { extensionsDisabled = false } = {}) {
  if (!extensionsDisabled) return 'EXTENSIONS_NOT_ISOLATED';
  const ui = await observePageUi(page);
  if (!ui || ui.sbc !== true || ui.modal !== false || ui.loading !== false) return 'NATIVE_SBC_HUB_NOT_CONFIRMED';
  const sets = runtime.sbc.sets.samples.filter(set => set.id === setId);
  if (sets.length !== 1 || typeof sets[0].name !== 'string' || !sets[0].name.trim()) return 'SET_IDENTITY_UNAVAILABLE';
  const title = sets[0].name.trim();
  const tiles = page.locator('.ut-sbc-set-tile-view');
  const count = await tiles.count();
  if (count > 30) return 'SET_SCAN_LIMIT';
  const matches = [];
  for (let i = 0; i < count; i++) {
    const tile = tiles.nth(i);
    const header = tile.locator('.tileHeader');
    if (await header.count() === 1 && (await header.textContent())?.trim() === title && await tile.isVisible()) matches.push(tile);
  }
  if (matches.length !== 1) return 'SET_TILE_AMBIGUOUS_OR_MISSING';
  return openNativeTile(page, matches[0]);
}
