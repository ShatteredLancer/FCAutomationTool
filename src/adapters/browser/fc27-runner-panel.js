import { createRunnerPanelController } from '../../fc27/runner-panel.js';

export function mountFc27RunnerPanel({ document, read, preview }) {
  if (!document?.body || document.getElementById('fcat-fc27-preview')) return null;
  const host = document.createElement('aside');
  host.id = 'fcat-fc27-preview';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:12px;bottom:12px;z-index:100001;font:13px/1.45 Arial,sans-serif;letter-spacing:0;color:#edf1ef}
    *{box-sizing:border-box;letter-spacing:0}details{width:min(370px,calc(100vw - 24px));border:1px solid #596560;border-radius:6px;background:#202724;box-shadow:0 6px 24px #0005}
    summary{padding:12px;cursor:pointer;font-weight:600}summary span{float:right;color:#88dcc2;font-size:11px}
    .body{padding:0 12px 12px;max-height:calc(100dvh - 90px);overflow:auto}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #526159;padding:6px 0 10px;color:#bdc7c1}
    button,select{font:inherit;max-width:100%;color:inherit;background:#303b35;border:1px solid #64746b;border-radius:4px;padding:7px;min-height:34px}
    button{cursor:pointer}button:disabled{cursor:default;opacity:.5}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #8ee5c3;outline-offset:2px}
    #refresh{width:34px;padding:4px;font-size:20px}label{display:grid;gap:4px;margin-top:10px;color:#c1ccc5}select{width:100%;min-width:0}
    .controls{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end}#preview{background:#245849;border-color:#639e86}
    dl{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:12px 0}dt{color:#aebdb4}dd{margin:0;text-align:right;overflow-wrap:anywhere}
    output{display:block;padding:10px 0 0;border-top:1px solid #526159;overflow-wrap:anywhere;color:#f3d89a;min-height:38px}#counts{color:#d7e8de;margin-top:6px}#ratings{color:#a9c7b7;overflow-wrap:anywhere;margin-top:4px}
  </style><details><summary>FC Automation Tool <span>PREVIEW</span></summary><div class="body">
    <header><span>FC27 &middot; Read only</span><button id="refresh" title="Refresh local inputs" aria-label="Refresh local inputs">&#8635;</button></header>
    <dl><dt>FSU</dt><dd id="fsu">Unknown</dd><dt>Club cache</dt><dd id="club">Unknown</dd><dt>Live execution</dt><dd>Disabled</dd></dl>
    <label>SBC<select id="target"><option value="">No cached targets</option></select></label>
    <div class="controls"><label>Max OVR<select id="rating"><option value="74">74</option><option value="83">83</option></select></label><button id="preview" disabled>Preview squad</button></div>
    <output id="status" role="status">Not checked</output><div id="counts"></div><div id="ratings"></div>
  </div></details>`;
  const node = id => shadow.getElementById(id);
  let ready = false;
  let busy = false;
  const enable = () => { node('preview').disabled = busy || !ready || !node('target').value; };
  const controller = createRunnerPanelController({ read, preview, publish: state => {
    busy = state.busy;
    const { inputs, targets } = state.snapshot;
    ready = inputs.status === 'observed';
    const previous = node('target').value;
    node('target').replaceChildren();
    for (const target of targets) {
      const option = document.createElement('option');
      option.value = String(target.setId); option.textContent = target.name;
      node('target').append(option);
    }
    if (!targets.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'No cached targets'; node('target').append(option);
    } else if (targets.some(target => String(target.setId) === previous)) node('target').value = previous;
    node('fsu').textContent = inputs.fsu?.readiness ?? 'Unknown';
    node('club').textContent = inputs.club ? `${inputs.club.cachedPlayers} / partial` : 'Unknown';
    for (const id of ['refresh', 'target', 'rating']) node(id).disabled = busy;
    enable();
    node('status').textContent = busy ? 'Reading...' : state.result?.reason ?? inputs.reason;
    const plan = state.result?.plan;
    node('counts').textContent = plan ? `Safe candidates: ${plan.safeCandidates ?? '?'} / ${plan.required} required` : '';
    node('ratings').textContent = plan?.ratings?.length ? `Selected OVR: ${plan.ratings.join(', ')}` : '';
  } });
  node('refresh').addEventListener('click', () => controller.refresh());
  node('preview').addEventListener('click', () => { void controller.preview(Number(node('target').value), Number(node('rating').value)); });
  node('target').addEventListener('change', () => controller.refresh());
  node('rating').addEventListener('change', () => controller.refresh());
  document.body.append(host);
  controller.refresh();
  return { dispose() { controller.dispose(); host.remove(); } };
}
