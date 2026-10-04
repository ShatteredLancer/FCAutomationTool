import { describeCatalogRule, describeCatalogRewards, describePreparedRequirement } from '../../fc27/sbc-presentation.js';
import { fc27WorkbenchMarkup, bindFc27WorkbenchTabs } from './fc27-workbench-view.js';
import { mountFc27GalleryView } from './fc27-gallery-view.js';

export function mountFc27AcceptancePanel({ document, targets, inspectCatalog = null, inspectPuzzle = null, prepare, execute, fillPuzzle = null, inspectRecovery, resolveRecovery, checkInstallation,
  inspectPuzzlePolicy = null, setPuzzleMaxRating = null, setPuzzlePolicy = null, galleryCatalog = null, gallerySetLoader = null, galleryPriceLoader = null, galleryAccountScope = undefined,
  galleryProxy = '', setGalleryProxy = null, galleryAssets = null, galleryPrices = null, galleryMarketCompare = null, galleryDiagnosticLog = null, galleryNativeRenderer = null, galleryTargetStore = null, galleryPlanStore = null, gallerySync = null, purchaseGallery = null, galleryListing = null, galleryFirstOwnerHistory = null,
  exportDiagnostics = null, hostId = 'fcat-fc27-acceptance', title = 'FC Automation Tool - FC27 Acceptance', version = null, liveEnabled = false }) {
  if (!document?.body || document.getElementById(hostId)) return;
  const host = document.createElement('aside'); host.id = hostId;
  if (version) host.dataset.version = version;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = fc27WorkbenchMarkup();
  const gallery = mountFc27GalleryView({ document, shadow, host, provider: galleryCatalog, loadSet: gallerySetLoader, loadPrices: galleryPriceLoader, accountScope: galleryAccountScope, assets: galleryAssets, prices: galleryPrices, marketCompare: galleryMarketCompare, diagnosticLog: galleryDiagnosticLog, nativeRenderer: galleryNativeRenderer, targetStore: galleryTargetStore, planStore: galleryPlanStore, sync: gallerySync, purchase: purchaseGallery, listing: galleryListing, setFirstOwner: galleryFirstOwnerHistory });
  const selectTab = bindFc27WorkbenchTabs(shadow, host, id => gallery.setActive(id === 'gallery'));
  const node = id => shadow.getElementById(id);
  node('workbench-version').textContent = version ?? title;
  node('workbench-mode').textContent = liveEnabled === true ? '已开放现有单次操作；提交需单独确认。' : '当前为只读模式。';
  node('gallery-proxy-card').hidden = typeof setGalleryProxy !== 'function';
  node('diagnostic-export-card').hidden = typeof exportDiagnostics !== 'function';
  node('gallery-proxy').value = typeof galleryProxy === 'function' ? String(galleryProxy() || '') : String(galleryProxy || '');
  node('puzzle-settings').hidden = typeof setPuzzleMaxRating !== 'function' && typeof setPuzzlePolicy !== 'function';
  node('puzzle-quote-setting').hidden = typeof setPuzzlePolicy !== 'function';
  node('puzzle-queries-setting').hidden = typeof setPuzzlePolicy !== 'function';
  shadow.querySelector('summary').textContent = `${title}　×`;
  node('status').textContent = liveEnabled === true ? 'Live: single SBC' : 'Live execution disabled';
  let busy = false; let plan = null; let puzzlePlan = null; let recovery = null; let action = null;
  const renderTargets = () => {
    const previous = node('target').value;
    node('target').replaceChildren();
    for (const target of targets()) {
      const option = document.createElement('option'); option.value = String(target.setId); option.textContent = target.name;
      node('target').append(option);
    }
    if ([...node('target').options].some(option => option.value === previous)) node('target').value = previous;
  };
  const update = () => {
    for (const button of shadow.querySelectorAll('button:not([role="tab"]),select,input')) {
      if (!button.closest('#page-gallery')) button.disabled = busy;
    }
    node('execute').disabled = busy || liveEnabled !== true || plan?.liveEnabled !== true;
    node('fill').disabled = busy || liveEnabled !== true || puzzlePlan?.fillReady !== true || typeof fillPuzzle !== 'function';
    node('resolve').disabled = busy || recovery?.status !== 'recoverable';
    node('catalog').disabled = busy || !node('target').value || typeof inspectCatalog !== 'function';
    node('puzzle').disabled = busy || !node('target').value || typeof inspectPuzzle !== 'function';
    node('prepare').disabled = busy || !node('target').value;
    node('export-diagnostics').disabled = busy || typeof exportDiagnostics !== 'function';
  };
  const appendText = (parent, tag, text) => {
    const element = document.createElement(tag); element.textContent = text; parent.append(element); return element;
  };
  const clear = () => {
    plan = null; puzzlePlan = null; recovery = null; action = null;
    node('requirements').replaceChildren(); node('squad').replaceChildren(); node('detail').textContent = '';
    node('status').textContent = node('target').value ? 'Choose Read requirements or Verify squad' : 'No cached SBCs. Open EA SBC once, then refresh.';
    delete host.dataset.result;
  };
  const renderPlan = result => {
    node('requirements').replaceChildren();
    appendText(node('requirements'), 'div', 'Verified plan requirements');
    const rules = appendText(node('requirements'), 'ul', '');
    for (const rule of result.requirements ?? []) appendText(rules, 'li', describePreparedRequirement(rule));
    const squad = node('squad'); squad.replaceChildren();
    appendText(squad, 'div', 'Selected slots · exact material checked');
    const list = appendText(squad, 'ol', '');
    for (const item of result.selected ?? []) appendText(list, 'li', `Slot ${item.slot + 1} · ${item.rating} OVR · ${item.pile}`);
    appendText(squad, 'small', 'Untradeable ordinary cards only. Confirm once saves and submits this plan; materials are checked again before saving.');
  };
  const renderCatalog = result => {
    const target = node('requirements'); target.replaceChildren();
    if (result?.status !== 'observed') return;
    const heading = document.createElement('div');
    heading.textContent = `${result.setName ?? 'SBC'} · ${result.challenges.length} challenge${result.challenges.length === 1 ? '' : 's'}`;
    target.append(heading);
    appendText(target, 'small', 'Requirements from this EA read. Layout and submission eligibility are checked by Verify squad.');
    appendText(target, 'small', `Set rewards (cached, unverified): ${describeCatalogRewards(result.setRewards?.rewards)}`);
    if (result.challenges.length !== 1) appendText(target, 'div', 'Multi-challenge planning is not supported yet.');
    for (const challenge of result.challenges) {
      const block = document.createElement('div'); block.className = 'requirement';
      const title = document.createElement('div');
      title.textContent = `${challenge.name ?? `Challenge ${challenge.id}`} · ${challenge.status ?? 'unknown'} · ${challenge.eligibilityOperation ?? 'unknown'} rules`;
      block.append(title);
      if (challenge.status !== 'IN_PROGRESS') appendText(block, 'small', 'Not ready for planning. Unstarted challenges need EA initialization; this read does not start them.');
      if (challenge.eligibilityOperation !== 'AND') appendText(block, 'small', 'Unsupported requirement combination.');
      const list = document.createElement('ul');
      for (const rule of challenge.requirements ?? []) {
        const item = document.createElement('li');
        const description = describeCatalogRule(rule);
        item.textContent = description.label;
        appendText(item, 'small', description.raw);
        list.append(item);
      }
      if (!challenge.requirements?.length) {
        const item = document.createElement('li'); item.textContent = 'No requirement rows observed'; list.append(item);
      }
      block.append(list);
      appendText(block, 'small', `Challenge rewards (this read): ${describeCatalogRewards(challenge.rewards)}`);
      target.append(block);
    }
  };
  const renderPuzzle = result => {
    plan = null; puzzlePlan = result;
    node('requirements').replaceChildren(); node('squad').replaceChildren();
    appendText(node('requirements'), 'div', `Puzzle · Set ${result.setId} / Challenge ${result.challengeId}`);
    appendText(node('requirements'), 'small', result.fillReady === true
      ? `Ready for confirmed save · untradeable ordinary Club cards, max OVR ${result.policy?.maxRating ?? '?'}. No SBC submission.`
      : `Preview only · untradeable ordinary Club cards, max OVR ${result.policy?.maxRating ?? '?'}. No saving or submission.`);
    const rules = appendText(node('requirements'), 'ul', '');
    for (const rule of result.rules ?? []) appendText(rules, 'li', JSON.stringify(rule.source));
    const facts = result.plan?.teamFacts;
    appendText(node('squad'), 'div', `Local rating ${facts?.teamRating ?? '?'} · chemistry ${facts?.chemistry ?? '?'} · selected ${result.plan?.selectedCount ?? 0}/${result.plan?.required ?? '?'}`);
    appendText(node('squad'), 'small', `Exact Club check: ${result.plan?.exactValidation?.status ?? 'unavailable'} · fill preflight: ${result.plan?.fillPreflight?.status ?? 'unavailable'}`);
    appendText(node('squad'), 'small', result.fillReady === true
      ? 'Exact Club check passed. Confirm once to fill and save this squad only; it will not submit the SBC or open rewards.'
      : 'Local rule checks are not server acceptance. Puzzle fill is unavailable until the save contract is verified.');
    const list = appendText(node('squad'), 'ol', '');
    for (const [index, slot] of (result.plan?.slots ?? []).entries()) {
      appendText(list, 'li', `Slot ${slot + 1} · ${result.plan.ratings[index]} OVR · club`);
    }
  };
  const run = async task => {
    if (busy) return;
    busy = true; update(); node('status').textContent = 'Checking...'; host.dataset.busy = 'true';
    try {
      const result = await task();
      if (result.status === 'prepared') { plan = result; renderPlan(result); }
      if (result.status === 'recoverable') recovery = result;
      if (result.status === 'observed' && result.challenges) renderCatalog(result);
      if (result.status === 'preview' && result.plan) renderPuzzle(result);
      node('status').textContent = result.reason ?? result.status;
      node('detail').textContent = result.status === 'prepared'
        ? `${result.setName}: ${result.selectedCount} players; OVR ${result.ratings.join(', ')}; pack ${result.packId}`
        : result.synthetic ? `GM ${result.persistedPreviously ? 'restored' : 'written'}; ${result.phase}` : '';
      host.dataset.result = JSON.stringify(result);
    } catch (error) {
      const reason = /^FC27_[A-Z_]+$/.test(error?.message) ? error.message : 'FC27_ACCEPTANCE_UNCONFIRMED';
      node('status').textContent = reason; host.dataset.result = JSON.stringify({ status: 'blocked', reason });
    } finally { busy = false; host.dataset.busy = 'false'; update(); }
  };
  const on = (id, callback) => node(id).addEventListener('click', event => { if (event.isTrusted && !busy) callback(); });
  on('refresh', () => { renderTargets(); clear(); update(); });
  on('gallery-proxy-save', () => {
    if (typeof setGalleryProxy !== 'function') return;
    void run(async () => {
      const result = await setGalleryProxy(node('gallery-proxy').value);
      node('gallery-proxy').value = result.proxy || '';
      return { ...result, reason: result.proxy ? 'Gallery FUT.GG 转发代理已保存；下次更新目录时生效' : 'Gallery FUT.GG 转发代理已清除；将尝试直连' };
    });
  });
  on('gallery-proxy-clear', () => {
    if (typeof setGalleryProxy !== 'function') return;
    void run(async () => {
      const result = await setGalleryProxy('');
      node('gallery-proxy').value = '';
      return { ...result, reason: 'Gallery FUT.GG 转发代理已清除；将尝试直连' };
    });
  });
  on('export-diagnostics', () => {
    if (typeof exportDiagnostics !== 'function') return;
    void run(async () => {
      node('diagnostic-export-status').textContent = '正在导出…';
      try {
        const result = await exportDiagnostics();
        node('diagnostic-export-status').textContent = `已导出 ${result.count ?? 0} 条日志`;
        return { status: 'observed', reason: 'FC27_DIAGNOSTICS_EXPORTED', ...result };
      } catch {
        node('diagnostic-export-status').textContent = '导出失败，请重试';
        return { status: 'blocked', reason: 'FC27_DIAGNOSTICS_EXPORT_FAILED' };
      }
    });
  });
  on('puzzle-policy-save', () => {
    if (typeof setPuzzleMaxRating !== 'function' && typeof setPuzzlePolicy !== 'function') return;
    const value = Number(node('puzzle-rating').value); clear();
    const priceText = node('puzzle-quote-ceiling').value.trim();
    void run(async () => {
      const result = typeof setPuzzlePolicy === 'function'
        ? await setPuzzlePolicy({ maxRating: value, quoteCeiling: priceText === '' ? null : Number(priceText),
          queriesNumber: Number(node('puzzle-queries').value) })
        : await setPuzzleMaxRating(value);
      return { ...result, reason: result.status === 'observed'
        ? `解题设置已保存：最高评分 ${result.maxRating}；补卡单卡报价${result.quoteCeiling == null ? '不限' : `上限 ${result.quoteCeiling} 金币`}` : result.reason };
    });
  });
  shadow.querySelector('details').addEventListener('toggle', () => {
    if (!shadow.querySelector('details').open || busy || liveEnabled !== true || typeof inspectPuzzlePolicy !== 'function') return;
    void run(async () => {
      const result = await inspectPuzzlePolicy();
      if (result.status === 'observed') {
        node('puzzle-rating').value = String(result.maxRating);
        node('puzzle-quote-ceiling').value = result.quoteCeiling == null ? '' : String(result.quoteCeiling);
        node('puzzle-queries').value = String(result.queriesNumber ?? 5);
      }
      return result;
    });
  });
  on('gm', () => { clear(); void run(() => checkInstallation(false)); });
  on('hold', () => { clear(); void run(() => checkInstallation(true)); });
  on('catalog', () => { clear(); void run(() => inspectCatalog({ setId: Number(node('target').value) })); });
  on('puzzle', () => { clear(); void run(() => inspectPuzzle({ setId: Number(node('target').value) })); });
  on('prepare', () => { clear(); void run(() => prepare({ setId: Number(node('target').value), maxRating: Number(node('rating').value) })); });
  on('recovery', () => { clear(); void run(inspectRecovery); });
  const dialog = node('action-approval-dialog');
  on('execute', () => {
    if (liveEnabled !== true || plan?.liveEnabled !== true) return;
    action = 'execute'; node('approval').textContent = `${plan.setName}: submit ${plan.selectedCount} players, max OVR ${plan.maxRating}, once.`; dialog.showModal();
  });
  on('fill', () => {
    if (liveEnabled !== true || puzzlePlan?.fillReady !== true) return;
    action = 'fill';
    node('approval').textContent = `Set ${puzzlePlan.setId} / Challenge ${puzzlePlan.challengeId}: fill ${puzzlePlan.plan?.selectedCount ?? '?'} untradeable ordinary Club players, max OVR ${puzzlePlan.policy?.maxRating ?? '?'}, and save once. No SBC submission or reward opening.`;
    dialog.showModal();
  });
  on('resolve', () => {
    if (!recovery) return;
    action = 'resolve'; node('approval').textContent = `Record ${recovery.outcome} for SBC ${recovery.setId}. No save or submit request.`; dialog.showModal();
  });
  on('cancel', () => { action = null; dialog.close(); });
  dialog.addEventListener('cancel', () => { action = null; });
  on('confirm', () => {
    dialog.close();
    if (action === 'execute' && plan) {
      const current = plan; clear();
      void run(() => execute({ approved: true, count: 1, setId: current.setId, challengeId: current.challengeId,
        maxRating: current.maxRating, maxPlayers: current.selectedCount }));
    } else if (action === 'fill' && puzzlePlan) {
      const current = puzzlePlan; clear();
      void run(() => fillPuzzle({ approved: true, action: 'fill-only', count: 1,
        setId: current.setId, challengeId: current.challengeId, maxPlayers: current.plan?.selectedCount, maxRating: current.policy?.maxRating }));
    } else if (action === 'resolve' && recovery) { clear(); void run(() => resolveRecovery(true)); }
    action = null;
  });
  for (const id of ['target', 'rating']) node(id).addEventListener('change', () => { clear(); update(); });
  document.body.append(host); host.style.display = 'none'; renderTargets(); update();
  const open = container => {
    if (container?.append) {
      container.append(host); host.dataset.navigationPage = 'true';
      shadow.querySelector('summary').textContent = title;
    }
    host.style.display = 'block'; shadow.querySelector('details').open = true;
    gallery.setActive(host.dataset.activeTab === 'gallery');
    renderTargets(); update();
    if (!busy && liveEnabled === true && typeof inspectPuzzlePolicy === 'function') {
      void run(async () => {
        const result = await inspectPuzzlePolicy();
        if (result.status === 'observed') {
          node('puzzle-rating').value = String(result.maxRating);
          node('puzzle-quote-ceiling').value = result.quoteCeiling == null ? '' : String(result.quoteCeiling);
          node('puzzle-queries').value = String(result.queriesNumber ?? 5);
        }
        return result;
      });
    }
  };
  const close = () => { if (!busy) { gallery.setActive(false); host.style.display = 'none'; shadow.querySelector('details').open = false; } };
  shadow.querySelector('summary').addEventListener('click', event => {
    if (host.dataset.navigationPage) { event.preventDefault(); return; }
    if (event.isTrusted && !busy) { event.preventDefault(); close(); }
  });
  return Object.freeze({
    open,
    close,
    triggerPuzzle: ({ setId, challengeId }) => {
      if (busy || !Number.isSafeInteger(setId) || typeof inspectPuzzle !== 'function') return;
      shadow.querySelector('details').open = true;
      selectTab('sbc'); shadow.querySelector('[data-sbc-advanced]').open = true;
      renderTargets(); node('target').value = String(setId);
      clear(); void run(() => inspectPuzzle({ setId, challengeId }));
    },
    element: host,
  });
}
