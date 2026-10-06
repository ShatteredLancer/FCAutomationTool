import { clickPanelControl, panelCall, waitForPanel, openProductionPanel, selectPanelTab } from './production-panel-inspection.mjs';
import { observePageUi } from './navigation.mjs';

// Open only the sellable-card preview. Never press the listing, resume or
// scheduling actions. The existing helper returns to the selected category.
export async function verifyGalleryListingPreview(context, page, setName, { readGallery, installCurrent = true }) {
  if (['--read-contracts', '--probe-reads'].includes(setName)) {
    const { probeGalleryListingReads } = await import(`./gallery-listing-read-probe.mjs?revision=${Date.now()}`);
    return probeGalleryListingReads(page, { readClub: setName === '--probe-reads' });
  }
  let installation = null, runtimeVersion = null;
  if (installCurrent) {
    const { installCurrentUserscript } = await import(`./install-current.mjs?revision=${Date.now()}`);
    installation = await installCurrentUserscript(context);
    if (!installation.installed) return { status: 'blocked', reason: installation.failure, executable: false };
    await page.reload({ waitUntil: 'domcontentloaded' });
    // EA briefly renders login content while restoring an existing session.
    // Wait for the installed navigation entry before interpreting that screen.
    await page.waitForFunction(() => globalThis.document.querySelector('.fcat-navigation-entry')?.checkVisibility()
      && ![...globalThis.document.querySelectorAll('.ut-login-content,.ut-loading-view')].some(node => node.checkVisibility()),
      {}, { timeout: 30000 }).catch(() => {});
    const ui = await observePageUi(page);
    if (ui?.structure?.includes('ut-logged-on-console')) return { status: 'blocked', reason: 'FC27_GALLERY_ACCOUNT_BUSY', executable: false, installation };
    if (!ui || ui.login || ui.loading) return { status: 'blocked', reason: 'FC27_GALLERY_LOGIN_REQUIRED', executable: false, installation, ui };
    await openProductionPanel(context, page);
    runtimeVersion = await panelCall(context, page, function () { return this.host.dataset.version; });
    if (runtimeVersion !== installation.version) return { status: 'blocked', reason: 'FC27_GALLERY_RUNTIME_VERSION_UNVERIFIED', executable: false, installation };
  }
  const purchased = setName === '--purchased';
  if (purchased) {
    await openProductionPanel(context, page);
    await selectPanelTab(context, page, 'gallery');
  } else {
    const gallery = await readGallery(context, page, setName);
    if (gallery.status !== 'observed') return gallery;
  }
  const toolbar = await panelCall(context, page, function () {
    const bounds = selector => {
      const node = this.querySelector(selector);
      if (!node?.checkVisibility()) return null;
      const { x, y, width, height, right } = node.getBoundingClientRect();
      return { x, y, width, height, right };
    };
    return { range: bounds('#gallery-list-range'), action: bounds('#gallery-list-purchased'),
      header: bounds('.gallery-header'), toolbar: bounds('.gallery-toolbar') };
  });
  if (installCurrent) await page.screenshot({ path: 'artifacts/fc27-browser/gallery-toolbar-live.png' });
  if (!purchased) {
  const selector = await panelCall(context, page, function (name) {
    const card = [...this.querySelectorAll('#gallery-set-list .gallery-set')].find(row =>
      row.textContent.toLowerCase().includes(name.toLowerCase()));
    return card ? `[data-set-id="${globalThis.CSS.escape(card.dataset.setId)}"] .gallery-open-set` : null;
  }, [setName]);
  if (!selector) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SET_UNAVAILABLE', executable: false };
  await clickPanelControl(context, page, selector);
  await waitForPanel(context, page, function () {
    return this.querySelector('#gallery-set-detail .gallery-card')?.checkVisibility() === true;
  }, [], 60000);
  await clickPanelControl(context, page, '#gallery-list-range');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  const selected = await panelCall(context, page, function () { return this.getElementById('gallery-list-range').value; });
  if (selected !== 'set') return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_RANGE_UNVERIFIED', executable: false };
  } else {
    await clickPanelControl(context, page, '#gallery-list-range');
    await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  }
  await clickPanelControl(context, page, '#gallery-list-purchased');
  try {
    const result = await waitForPanel(context, page, function () {
      const dialog = this.getElementById('gallery-bulk-list-dialog');
      const close = dialog?.querySelector('button[aria-label="关闭"]');
      if (!dialog?.open || !close || close.disabled) return null;
      const status = [...dialog.querySelectorAll('output')].map(node => node.textContent).join(' · ');
      const costs = [...dialog.querySelectorAll('tbody tr')].map(row => row.children[4]?.textContent?.trim());
      return { status: /FC27_|失败|不完整/.test(status) ? 'blocked' : 'observed', executable: false,
        rows: dialog.querySelectorAll('tbody tr').length, text: status.slice(0, 1200),
        purchaseCosts: { priced: costs.filter(value => /^\d+$/.test(value)).length,
          firstOwner: costs.filter(value => value === 'N/A').length, unknown: costs.filter(value => value === '未知').length },
        scheduleVisible: [...dialog.querySelectorAll('input[type="datetime-local"]')].some(node => node.checkVisibility()) };
    }, [], 120000);
    return { ...result, ...(installation ? { installation, runtimeVersion, toolbar } : {}) };
  } finally {
    await clickPanelControl(context, page, '#gallery-bulk-list-dialog button[aria-label="关闭"]').catch(() => {});
  }
}
