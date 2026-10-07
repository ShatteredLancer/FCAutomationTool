import { clickPanelControl, panelCall, waitForPanel, selectPanelTab } from './production-panel-inspection.mjs';

// Caller installs current source and verifies runtime first. Only settings and
// listing previews: no buy, move, listing, resume, or scheduling action.
export async function verifyGalleryTradeStyles(context, page, { readGallery } = {}) {
  await selectPanelTab(context, page, 'settings');
  const before = await waitForPanel(context, page, function () {
    const section = this.getElementById('gallery-trade-settings');
    const controls = section?.querySelectorAll('select');
    if (!controls?.length || controls[0].disabled) return null;
    return { destination: controls[0].value, style: controls[1].value,
      options: [...controls[1].options].map(option => option.value), version: this.host.dataset.version };
  }, [], 10000);
  const choose = async style => {
    await selectPanelTab(context, page, 'settings');
    await waitForPanel(context, page, function () { return this.querySelector('#gallery-trade-settings select')?.disabled === false; }, [], 10000);
    await clickPanelControl(context, page, '#gallery-trade-settings select[aria-label="Gallery 购买 / 挂牌风格"]');
    await page.keyboard.press(style === 'fodder' ? 'End' : 'Home'); await page.keyboard.press('Enter');
    await clickPanelControl(context, page, '#gallery-trade-settings button');
    await waitForPanel(context, page, function () { return this.querySelector('#gallery-trade-settings output')?.textContent.startsWith('已保存'); }, [], 10000);
  };
  const previews = []; let sellable = null;
  try {
    for (const style of ['enhancer', 'fodder']) {
      await choose(style); await selectPanelTab(context, page, 'gallery');
      await clickPanelControl(context, page, '#gallery-list-purchased');
      const observed = await waitForPanel(context, page, function (style) {
        const id = style === 'fodder' ? 'gallery-fodder-list-dialog' : 'gallery-bulk-list-dialog';
        const dialog = this.getElementById(id);
        if (!dialog?.open) return null;
        const buttons = [...dialog.querySelectorAll('button')];
        const close = style === 'fodder' ? buttons.find(node => /Cancel Esc|Close Esc/.test(node.textContent))
          : dialog.querySelector('button[aria-label="关闭"]');
        if (!close || close.disabled) return null;
        const bounds = dialog.getBoundingClientRect(), footer = dialog.querySelector('footer')?.getBoundingClientRect();
        return { style, id, rows: dialog.querySelectorAll(style === 'fodder' ? '.fd-row:not(.fd-head)' : 'tbody tr').length,
          reason: [...dialog.querySelectorAll('output')].map(node => node.textContent).join(' · ').slice(0, 800),
          fitsViewport: bounds.right <= globalThis.innerWidth && bounds.left >= 0,
          footerVisible: footer ? footer.bottom <= globalThis.innerHeight : null };
      }, [style], 120000);
      previews.push(observed);
      await page.screenshot({ path: `artifacts/fc27-browser/gallery-${style}-preview-current.png` });
      // Closing a modal cannot send a transaction. Selection and cancellation
      // are the only preview interactions in this inspector.
      await panelCall(context, page, function (id) { this.getElementById(id)?.close(); }, [observed.id]);
    }
    if (readGallery) {
      const { verifyGalleryListingPreview } = await import(`./gallery-listing-verification.mjs?revision=${Date.now()}`);
      sellable = await verifyGalleryListingPreview(context, page, 'Arsenal', { readGallery, installCurrent: false });
    }
  } finally { await choose(before.style); }
  const after = await panelCall(context, page, function () {
    return [...this.querySelectorAll('#gallery-trade-settings select')].map(node => node.value);
  });
  return { status: 'observed', executable: false, version: before.version, options: before.options, previews, sellable,
    preferencesRestored: after[0] === before.destination && after[1] === before.style };
}
