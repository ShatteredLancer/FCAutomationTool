import { panelCall, waitForPanel, clickPanelControl } from './production-panel-inspection.mjs';
import { createNetworkCollector } from './probe.mjs';

// Only browse/filter/compare and local planning controls are activated;
// buying, listing, claiming and full sync are absent from this acceptance pass.
export async function verifyProductionGallery(context, page, setName,
  // A full EA Gallery merge can legitimately exceed three minutes. Keep the
  // observation bounded while allowing a progressing reader to finish.
  { readGallery, now = () => Date.now(), syncTimeoutMs = 300000, planning = true } = {}) {
  const samples = [];
  let phase = 'initial', initial = null, comparisonState = null;
  const measure = async (phase, run) => {
    const start = now(), collector = createNetworkCollector(context);
    try { return await run(); }
    finally { samples.push({ phase, elapsedMs: now() - start, network: collector.snapshot() }); collector.stop(); }
  };
  const readSyncSnapshot = () => panelCall(context, page, function () {
    const button = this.getElementById('gallery-sync');
    if (!button) return null;
    let state = null;
    try { state = button.dataset.syncState ? JSON.parse(button.dataset.syncState) : null; } catch { /* Diagnostic only. */ }
    return { busy: button.disabled === true, state,
      note: this.getElementById('gallery-progress-note')?.textContent?.slice(0, 300) ?? '',
      modal: this.getElementById('gallery-sync-dialog')?.open ?? false };
  });
  const waitForSyncIdle = async (timeoutMs = 300000) => {
    const startedAt = now(), observations = [];
    let last = null, nextSample = 0;
    while (now() - startedAt < timeoutMs) {
      last = await readSyncSnapshot();
      if (!last) return { status: 'unavailable', elapsedMs: now() - startedAt, samples: observations, final: null };
      const state = last.state ?? {};
      if (now() >= nextSample) {
        observations.push({ atMs: now() - startedAt, busy: last.busy, note: last.note,
          task: state.task ?? null, readerBusy: state.readerBusy ?? null, progress: state.progress ?? null });
        nextSample = now() + 1000;
      }
      if (!last.busy && !state.task?.active && !state.readerBusy) {
        return { status: 'idle', elapsedMs: now() - startedAt, samples: observations, final: last };
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { status: 'timeout', elapsedMs: now() - startedAt, samples: observations, final: last };
  };
  try {
  phase = 'first-open';
  initial = await measure('first-open', () => readGallery(context, page, setName));
  if (initial.status !== 'observed') return { status: 'blocked', reason: initial.reason, samples,
    executable: false, liveExecutionEnabled: false };
  const purchaseAndSync = await panelCall(context, page, function () {
    const visible = id => this.getElementById(id)?.checkVisibility() === true;
    return {
      purchase: { resumeVisible: visible('gallery-purchase-resume'),
        warning: visible('gallery-purchase-journal-status') ? this.getElementById('gallery-purchase-journal-status').textContent.slice(0, 500) : null },
      sync: { lastSync: this.getElementById('gallery-sync-time')?.textContent?.slice(0, 120) ?? '',
        progress: this.getElementById('gallery-progress-note')?.textContent?.slice(0, 300) ?? '',
        busy: this.getElementById('gallery-sync')?.disabled ?? null,
        state: (() => { try { return JSON.parse(this.getElementById('gallery-sync')?.dataset?.syncState ?? 'null'); } catch { return null; } })(),
        modal: this.getElementById('gallery-sync-dialog')?.open ?? false },
    };
  });
  const selector = await panelCall(context, page, function (name) {
    const card = [...this.querySelectorAll('#gallery-set-list .gallery-set')].find(node =>
      node.querySelector('h4')?.textContent?.trim()?.toLowerCase() === name.toLowerCase());
    return card ? `[data-set-id="${globalThis.CSS.escape(card.dataset.setId)}"] .gallery-open-set` : null;
  }, [setName]);
  if (!selector) throw Error('FC27_GALLERY_SET_BUTTON_UNAVAILABLE');
  await clickPanelControl(context, page, selector);
  await waitForPanel(context, page, function () {
    const root = this.getElementById('gallery-set-detail');
    return root && !root.hidden && root.querySelectorAll('.gallery-card').length > 0;
  }, [], 15000);
  const missingFilter = await panelCall(context, page, function () {
    const button = [...this.querySelectorAll('#gallery-set-detail .gallery-card-filters button')].find(node => node.textContent.trim() === '未收集');
    return button ? `#gallery-set-detail .gallery-card-filters button:nth-child(${[...button.parentElement.children].indexOf(button) + 1})` : null;
  });
  if (missingFilter) await clickPanelControl(context, page, missingFilter);
  const compareSelector = await panelCall(context, page, function () {
    const card = this.querySelector('#gallery-set-detail .gallery-card:has(.gallery-card-compare)');
    return card ? `#gallery-set-detail .gallery-card[data-definition-id="${globalThis.CSS.escape(card.dataset.definitionId)}"]` : null;
  });
  let comparison = { status: 'skipped', reason: 'NO_VISIBLE_UNCOLLECTED_CARD' };
  if (compareSelector) {
    const compare = async () => {
      await clickPanelControl(context, page, `${compareSelector} .gallery-card-compare`);
      try {
      await waitForPanel(context, page, function (selector) {
        const button = this.querySelector(`${selector} .gallery-card-compare`);
        const text = this.querySelector(`${selector} .gallery-market-comparison`)?.textContent ?? '';
        return button && !button.disabled && text && !text.includes('读取 EA');
      }, [compareSelector], 20000);
      } finally {
      comparisonState = await panelCall(context, page, function (selector) {
        const root = this.querySelector(selector), line = root?.querySelector('.gallery-market-comparison');
        return { text: line?.textContent?.slice(0, 500) ?? '', reason: line?.title?.slice(0, 120) ?? '',
          cardPresent: !!root, buttonDisabled: root?.querySelector('.gallery-card-compare')?.disabled ?? null,
          activeTab: this.host.dataset.activeTab, detailHidden: this.getElementById('gallery-set-detail')?.hidden ?? null,
          visibleListings: root?.querySelectorAll('.gallery-market-listings small').length ?? 0 };
      }, [compareSelector]).catch(() => null);
      }
      return comparisonState;
    };
    phase = 'compare';
    const first = await measure('compare', compare);
    comparisonState = first;
    phase = 'compare-repeat';
    const repeat = await measure('compare-repeat', compare);
    comparison = { status: first.text.startsWith('EA ') ? 'observed' : 'blocked', first, repeat,
      sameResult: JSON.stringify(first) === JSON.stringify(repeat) };
  }
  phase = 'reopen';
  const reopened = await measure('reopen', () => readGallery(context, page, setName));
  const syncWait = reopened.status === 'observed' ? await waitForSyncIdle(syncTimeoutMs)
    : { status: 'skipped', elapsedMs: 0, samples: [], final: null };
  const finalSync = await panelCall(context, page, function () {
    const button = this.getElementById('gallery-sync'); let state = null;
    try { state = JSON.parse(button?.dataset?.syncState ?? 'null'); } catch { /* Diagnostic only. */ }
    return { lastSync: this.getElementById('gallery-sync-time')?.textContent?.slice(0, 120) ?? '',
      progress: this.getElementById('gallery-progress-note')?.textContent?.slice(0, 300) ?? '',
      busy: button?.disabled ?? null, state,
      modal: this.getElementById('gallery-sync-dialog')?.open ?? false };
  });
  const reason = reopened.status !== 'observed' ? reopened.reason
    : comparison.status === 'blocked' ? comparison.first.reason || 'FC27_GALLERY_COMPARISON_FAILED'
      : comparison.status === 'observed' && !comparison.sameResult ? 'FC27_GALLERY_COMPARISON_CHANGED'
        : syncWait.status === 'timeout' ? 'FC27_GALLERY_SYNC_STILL_RUNNING' : undefined;
  // Agent sessions stay open across inspection edits; refresh this helper too.
  const planningVerification = !reason && planning
    ? await (await import(`./gallery-planning-verification.mjs?revision=${Date.now()}`))
      .verifyGalleryPlanning(context, page, setName, { readGallery, timeoutSettings: 30 }) : null;
  const finalReason = reason ?? (planningVerification?.status === 'blocked' ? planningVerification.reason : undefined);
  return { status: finalReason ? 'blocked' : 'observed', reason: finalReason, planningVerification,
    runtimeVersion: initial.overview?.runtimeVersion ?? null,
    purchaseAndSync, finalSync, syncWait, comparison, samples, requestedSet: setName,
    networkCoverage: 'OFFICIAL_PAGE_RESPONSES_ONLY_EXCLUDES_GM_PUBLIC_REQUESTS',
    purchaseAcceptance: 'USER_PURCHASE_REQUIRED', syncAcceptance: 'SAME_SESSION_ONLY',
    executable: false, liveExecutionEnabled: false };
  } catch (error) {
    return { status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_VERIFICATION_FAILED',
      phase, initial, comparisonState, samples, requestedSet: setName, executable: false, liveExecutionEnabled: false };
  }
}
