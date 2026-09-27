import { describeCatalogRule, describeCatalogRewards, describePreparedRequirement } from '../../fc27/sbc-presentation.js';

export function mountFc27AcceptancePanel({ document, targets, inspectCatalog = null, inspectPuzzle = null, prepare, execute, fillPuzzle = null, inspectRecovery, resolveRecovery, checkInstallation,
  inspectPuzzlePolicy = null, setPuzzleMaxRating = null,
  hostId = 'fcat-fc27-acceptance', title = 'FC Automation Tool - FC27 Acceptance', version = null, liveEnabled = false }) {
  if (!document?.body || document.getElementById(hostId)) return;
  const host = document.createElement('aside'); host.id = hostId;
  if (version) host.dataset.version = version;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:12px;bottom:12px;z-index:100002;font:13px/1.45 Arial,sans-serif;color:#edf1ef;letter-spacing:0}
    *{box-sizing:border-box;letter-spacing:0}details{width:min(460px,calc(100vw - 24px));background:#202724;border:1px solid #67736c;border-radius:6px}
    summary{padding:12px;cursor:pointer;font-weight:600}.body{padding:0 12px 12px;max-height:calc(100dvh - 100px);overflow:auto}
    label{display:grid;gap:4px;margin:8px 0}select,button,input{font:inherit;min-height:36px;padding:7px;border:1px solid #67736c;border-radius:4px;color:inherit;background:#303b35;max-width:100%}
    select{width:100%}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap}
    output{display:block;min-height:38px;overflow-wrap:anywhere;border-top:1px solid #526159;padding-top:8px;color:#f3d89a}
    #requirements,#squad{margin-top:8px;color:#c2d9cb;overflow-wrap:anywhere}ul{margin:4px 0 0 18px;padding:0}.requirement{margin-top:8px;padding-top:6px;border-top:1px solid #39483f}
    small{display:block;color:#9caea3;margin-top:4px}#squad ol{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:0;gap:6px}#squad li{background:#303b35;padding:8px;border-radius:4px}
    #detail{margin-top:6px;overflow-wrap:anywhere;color:#c2d9cb}dialog{max-width:min(360px,calc(100vw - 24px));color:#edf1ef;background:#202724;border:1px solid #67736c;border-radius:6px}dialog::backdrop{background:#0009}
  </style><details><summary></summary><div class="body">
    <div class="row"><button id="refresh" title="Refresh targets" aria-label="Refresh targets">&#8635;</button><button id="gm">Check GM</button><button id="hold">Check tab lock</button></div>
    <label>SBC<select id="target"></select></label><label>Max OVR<select id="rating"><option>74</option><option>83</option></select></label>
    <div id="puzzle-settings"><label>解题球员最高评分（金卡默认 82）<input id="puzzle-rating" type="number" min="1" max="99" step="1" value="82"></label><button id="puzzle-policy-save">保存解题上限</button><small>铜银按本阵品质条件选材；最低银卡＋至少 2 金按 2 金＋其余银卡解题。金卡仍受 FSU 范围限制，缺料不自动增加金卡或提高评分；已保存的更低上限继续有效。</small></div>
    <div class="row"><button id="catalog">Read requirements</button><button id="puzzle">Plan Puzzle</button><button id="prepare">Verify squad</button><button id="execute" disabled>Submit once</button><button id="fill" disabled>Fill and save once</button></div>
    <div class="row"><button id="recovery">Check recovery</button><button id="resolve" disabled>Confirm recovery</button></div>
    <output id="status">Live execution disabled</output><div id="detail"></div><div id="requirements" aria-live="polite"></div><div id="squad"></div>
  </div></details><dialog><p id="approval"></p><div class="row"><button id="cancel">Cancel</button><button id="confirm">Confirm</button></div></dialog>`;
  const node = id => shadow.getElementById(id);
  node('puzzle-settings').hidden = typeof setPuzzleMaxRating !== 'function';
  shadow.querySelector('summary').textContent = title;
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
    for (const button of shadow.querySelectorAll('button,select,input')) button.disabled = busy;
    node('execute').disabled = busy || liveEnabled !== true || plan?.liveEnabled !== true;
    node('fill').disabled = busy || liveEnabled !== true || puzzlePlan?.fillReady !== true || typeof fillPuzzle !== 'function';
    node('resolve').disabled = busy || recovery?.status !== 'recoverable';
    node('catalog').disabled = busy || !node('target').value || typeof inspectCatalog !== 'function';
    node('puzzle').disabled = busy || !node('target').value || typeof inspectPuzzle !== 'function';
    node('prepare').disabled = busy || !node('target').value;
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
  on('puzzle-policy-save', () => {
    if (typeof setPuzzleMaxRating !== 'function') return;
    const value = Number(node('puzzle-rating').value); clear();
    void run(async () => {
      const result = await setPuzzleMaxRating(value);
      return { ...result, reason: result.status === 'observed' ? `解题评分上限已保存：${result.maxRating}` : result.reason };
    });
  });
  shadow.querySelector('details').addEventListener('toggle', () => {
    if (!shadow.querySelector('details').open || busy || typeof inspectPuzzlePolicy !== 'function') return;
    void run(async () => {
      const result = await inspectPuzzlePolicy();
      if (result.status === 'observed') node('puzzle-rating').value = String(result.maxRating);
      return result;
    });
  });
  on('gm', () => { clear(); void run(() => checkInstallation(false)); });
  on('hold', () => { clear(); void run(() => checkInstallation(true)); });
  on('catalog', () => { clear(); void run(() => inspectCatalog({ setId: Number(node('target').value) })); });
  on('puzzle', () => { clear(); void run(() => inspectPuzzle({ setId: Number(node('target').value) })); });
  on('prepare', () => { clear(); void run(() => prepare({ setId: Number(node('target').value), maxRating: Number(node('rating').value) })); });
  on('recovery', () => { clear(); void run(inspectRecovery); });
  const dialog = shadow.querySelector('dialog');
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
  document.body.append(host); renderTargets(); update();
  return Object.freeze({
    triggerPuzzle: ({ setId, challengeId }) => {
      if (busy || !Number.isSafeInteger(setId) || typeof inspectPuzzle !== 'function') return;
      shadow.querySelector('details').open = true;
      renderTargets(); node('target').value = String(setId);
      clear(); void run(() => inspectPuzzle({ setId, challengeId }));
    },
    element: host,
  });
}
