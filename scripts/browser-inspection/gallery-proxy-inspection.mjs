import { panelCall, waitForPanel, clickPanelControl, openProductionPanel, selectPanelTab } from './production-panel-inspection.mjs';

const PROBE_PROXY = 'https://www.fut.gg/fcat-gallery-probe-unavailable';
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_PROBE_FAILED';

// Only a reversible local Gallery setting and anonymous catalog reads. No EA
// inventory, progress, trade or SBC service is called by this probe.
export async function inspectGalleryFallback(context, page) {
  const result = { status: 'blocked', reason: 'FC27_GALLERY_FALLBACK_UNVERIFIED', stages: {}, restoration: { needed: false } };
  let original;
  let attemptedSave = false;
  const writeProxy = async value => {
    await selectPanelTab(context, page, 'settings');
    await panelCall(context, page, function (value) {
      const input = this.querySelector('#gallery-proxy');
      if (!input?.checkVisibility()) throw new Error('FC27_GALLERY_PROXY_INPUT_UNAVAILABLE');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, [value]);
    await clickPanelControl(context, page, value ? '#gallery-proxy-save' : '#gallery-proxy-clear');
    return waitForPanel(context, page, function (value) {
      let receipt; try { receipt = JSON.parse(this.host.dataset.result ?? 'null'); } catch { return null; }
      if (this.host.dataset.busy === 'true' || receipt?.status !== 'observed' || receipt.proxy !== value
          || this.querySelector('#gallery-proxy')?.value !== value) return null;
      return { confirmed: true };
    }, [value]);
  };
  try {
    await openProductionPanel(context, page);
    await selectPanelTab(context, page, 'settings');
    original = await panelCall(context, page, function () { return this.querySelector('#gallery-proxy')?.value; });
    if (typeof original !== 'string' || original === PROBE_PROXY) throw new Error('FC27_GALLERY_PROXY_BASELINE_UNVERIFIED');
    attemptedSave = true;
    result.stages.saved = await writeProxy(PROBE_PROXY);
    await selectPanelTab(context, page, 'gallery');
    // Entry may itself refresh an expired snapshot. Wait for that one before
    // deciding whether an explicit update is needed; never double-fetch.
    const readCatalog = () => waitForPanel(context, page, function () {
      if (this.querySelector('#gallery-refresh')?.disabled) return null;
      return { source: this.querySelector('#gallery-source')?.textContent,
        status: this.querySelector('#gallery-status')?.textContent,
        sets: this.querySelectorAll('.gallery-set').length,
        poolButtons: this.querySelectorAll('.gallery-open-set').length,
        cards: this.querySelectorAll('.gallery-card').length };
    }, [], 40000);
    let after = await readCatalog();
    if (after.source !== 'Fodder · 回退目录') {
      await clickPanelControl(context, page, '#gallery-refresh');
      after = await readCatalog();
    }
    result.stages.catalog = after;
    result.fallbackObserved = after.source === 'Fodder · 回退目录' && after.sets > 0 && after.poolButtons === 0 && after.cards === 0;
    if (result.fallbackObserved) { result.status = 'observed'; result.reason = 'FC27_GALLERY_FALLBACK_OBSERVED'; }
  } catch (error) { result.reason = safeReason(error); }
  finally {
    if (attemptedSave) {
      result.restoration = { needed: true, confirmed: false };
      try { result.restoration = { needed: true, ...await writeProxy(original) }; }
      catch (error) { result.restoration.reason = safeReason(error); result.status = 'blocked'; }
      // The input and receipt only attest the running instance. Reload/storage
      // restoration is a separate check, never claimed from setting the input.
      result.restoration.persistedAcrossReload = false;
      try { await selectPanelTab(context, page, 'gallery'); } catch { /* Preserve both prior outcomes. */ }
    }
  }
  return result;
}
