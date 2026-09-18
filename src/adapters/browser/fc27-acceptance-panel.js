export function mountFc27AcceptancePanel({ document, targets, prepare, execute, inspectRecovery, resolveRecovery, checkInstallation,
  hostId = 'fcat-fc27-acceptance', title = 'FC Automation Tool - FC27 Acceptance', version = null }) {
  if (!document?.body || document.getElementById(hostId)) return;
  const host = document.createElement('aside'); host.id = hostId;
  if (version) host.dataset.version = version;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:12px;bottom:12px;z-index:100002;font:13px/1.45 Arial,sans-serif;color:#edf1ef;letter-spacing:0}
    *{box-sizing:border-box;letter-spacing:0}details{width:min(370px,calc(100vw - 24px));background:#202724;border:1px solid #67736c;border-radius:6px}
    summary{padding:12px;cursor:pointer;font-weight:600}.body{padding:0 12px 12px;max-height:calc(100dvh - 100px);overflow:auto}
    label{display:grid;gap:4px;margin:8px 0}select,button{font:inherit;min-height:36px;padding:7px;border:1px solid #67736c;border-radius:4px;color:inherit;background:#303b35;max-width:100%}
    select{width:100%}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap}
    output{display:block;min-height:38px;overflow-wrap:anywhere;border-top:1px solid #526159;padding-top:8px;color:#f3d89a}
    #detail{margin-top:6px;overflow-wrap:anywhere;color:#c2d9cb}dialog{max-width:min(360px,calc(100vw - 24px));color:#edf1ef;background:#202724;border:1px solid #67736c;border-radius:6px}dialog::backdrop{background:#0009}
  </style><details><summary></summary><div class="body">
    <div class="row"><button id="refresh" title="Refresh targets" aria-label="Refresh targets">&#8635;</button><button id="gm">Check GM</button><button id="hold">Check tab lock</button></div>
    <label>SBC<select id="target"></select></label><label>Max OVR<select id="rating"><option>74</option><option>83</option></select></label>
    <div class="row"><button id="prepare">Verify squad</button><button id="execute" disabled>Submit once</button></div>
    <div class="row"><button id="recovery">Check recovery</button><button id="resolve" disabled>Confirm recovery</button></div>
    <output id="status">Live execution disabled</output><div id="detail"></div>
  </div></details><dialog><p id="approval"></p><div class="row"><button id="cancel">Cancel</button><button id="confirm">Confirm</button></div></dialog>`;
  const node = id => shadow.getElementById(id);
  shadow.querySelector('summary').textContent = title;
  let busy = false; let plan = null; let recovery = null; let action = null;
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
    for (const button of shadow.querySelectorAll('button,select')) button.disabled = busy;
    node('execute').disabled = busy || plan?.liveEnabled !== true;
    node('resolve').disabled = busy || recovery?.status !== 'recoverable';
  };
  const run = async task => {
    if (busy) return;
    busy = true; update(); node('status').textContent = 'Checking...'; host.dataset.busy = 'true';
    try {
      const result = await task();
      if (result.status === 'prepared') plan = result;
      if (result.status === 'recoverable') recovery = result;
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
  on('refresh', () => { plan = null; recovery = null; renderTargets(); update(); });
  on('gm', () => { void run(() => checkInstallation(false)); });
  on('hold', () => { void run(() => checkInstallation(true)); });
  on('prepare', () => { plan = null; recovery = null; void run(() => prepare({ setId: Number(node('target').value), maxRating: Number(node('rating').value) })); });
  on('recovery', () => { plan = null; recovery = null; void run(inspectRecovery); });
  const dialog = shadow.querySelector('dialog');
  on('execute', () => {
    if (plan?.liveEnabled !== true) return;
    action = 'execute'; node('approval').textContent = `${plan.setName}: submit ${plan.selectedCount} players, max OVR ${plan.maxRating}, once.`; dialog.showModal();
  });
  on('resolve', () => {
    if (!recovery) return;
    action = 'resolve'; node('approval').textContent = `Record ${recovery.outcome} for SBC ${recovery.setId}. No save or submit request.`; dialog.showModal();
  });
  on('cancel', () => { action = null; dialog.close(); });
  on('confirm', () => {
    dialog.close();
    if (action === 'execute' && plan) {
      const current = plan; plan = null;
      void run(() => execute({ approved: true, count: 1, setId: current.setId, challengeId: current.challengeId,
        maxRating: current.maxRating, maxPlayers: current.selectedCount }));
    } else if (action === 'resolve' && recovery) { recovery = null; void run(() => resolveRecovery(true)); }
    action = null;
  });
  for (const id of ['target', 'rating']) node(id).addEventListener('change', () => { plan = null; recovery = null; update(); });
  document.body.append(host); renderTargets(); update();
}
