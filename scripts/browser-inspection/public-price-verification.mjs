import { openProductionPanel, selectPanelTab, panelCall, waitForPanel, clickPanelControl } from './production-panel-inspection.mjs';

// Read saved account settings and exercise only the public Gallery quote path.
// No setting saves, EA market searches or transaction controls are clicked.
export async function verifyPublicPrices(context, page, setName, { readGallery }) {
  await openProductionPanel(context, page);
  await selectPanelTab(context, page, 'settings');
  const settings = await waitForPanel(context, page, function () {
    const section = this.getElementById('public-price-settings');
    const sources = section?.querySelector('select[aria-label="读取公共报价来源"]');
    const reference = section?.querySelector('select[aria-label="购买 / 挂牌价格参考"]');
    if (!sources || sources.disabled || !reference || reference.disabled) return null;
    return { readSources: sources.value, source: reference.value, runtimeVersion: this.host.dataset.version };
  }, [], 15000);
  if (settings.readSources === 'futgg') return { status: 'blocked', reason: 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED', settings };
  const gallery = await readGallery(context, page, setName);
  if (gallery.status !== 'observed') return { ...gallery, settings };
  const selector = await panelCall(context, page, function (name) {
    const set = [...this.querySelectorAll('#gallery-set-list .gallery-set')].find(row =>
      row.querySelector('h4')?.textContent.trim().toLowerCase() === name.toLowerCase());
    return set ? `[data-set-id="${globalThis.CSS.escape(set.dataset.setId)}"] .gallery-open-set` : null;
  }, [setName]);
  if (!selector) return { status: 'blocked', reason: 'FC27_GALLERY_SET_UNAVAILABLE', settings };
  await clickPanelControl(context, page, selector);
  const cards = await waitForPanel(context, page, function () {
    const detail = this.getElementById('gallery-set-detail');
    const cards = [...(detail?.querySelectorAll('.gallery-card') ?? [])];
    if (!cards.length) return null;
    return cards.slice(0, 12).map(card => ({ definitionId: Number(card.dataset.definitionId),
      price: card.querySelector('.gallery-card-price')?.textContent?.trim() ?? null,
      priceState: card.querySelector('.gallery-card-price')?.dataset.priceState ?? null }));
  }, [], 60000);
  return { status: 'observed', settings, setName, cards, executable: false };
}
