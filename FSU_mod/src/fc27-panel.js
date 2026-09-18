export function mountFc27FsuPanel({ document: doc, actions }) {
  const host = doc.createElement('aside');
  host.id = 'fsu-fc27-local';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{position:fixed;right:12px;bottom:12px;z-index:20000;font:14px Arial,sans-serif;letter-spacing:0;color:#edf1f0}
    *{box-sizing:border-box} details{width:360px;max-width:calc(100vw - 24px);background:#242825;border:1px solid #616963;border-radius:6px}
    summary{padding:12px;cursor:pointer;font-weight:bold;color:#b8e899} .body{padding:0 12px 12px;max-height:calc(100dvh - 100px);overflow:auto}
    h2{font-size:15px;margin:16px 0 8px} label{display:flex;gap:8px;align-items:center;margin:7px 0;min-height:28px}
    label span{flex:1} input,select,button{font:inherit;min-height:34px;max-width:100%;color:#edf1f0;background:#353c36;border:1px solid #737b75;border-radius:4px;padding:5px}
    input[type=number]{width:64px} input[type=checkbox]{accent-color:#acd88e;width:18px;min-height:18px} input[type=text]{width:140px}
    button{cursor:pointer} button:disabled{opacity:.5;cursor:default} .bar{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
    select{width:100%} output{display:block;overflow-wrap:anywhere;line-height:1.5;color:#e4d69b;white-space:pre-line}
    table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed} th,td{padding:6px 3px;border-bottom:1px solid #48534a;overflow-wrap:anywhere;text-align:left}
    th:nth-child(1){width:40%} th:nth-child(2){width:14%} th:nth-child(3){width:30%} th:nth-child(4){width:16%}
    @media(pointer:coarse){button,select,input{min-height:44px;font-size:16px}label{min-height:36px}}
  </style><details><summary>FSU FC27 Local Preview</summary><div class="body">
    <output role="status" id="status">Not ready</output>
    <h2>Selection policy</h2><form id="policy">
      <label><input type="checkbox" name="onlyUntradeable" checked><span>Only untradeable</span></label>
      <label><input type="checkbox" name="excludeEvolution" checked disabled><span>Exclude Evolution</span></label>
      <label><input type="checkbox" name="protectFsuLockedPlayers"><span>Protect FSU locked players</span></label>
      <label><input type="checkbox" name="protectActiveSquad"><span>Protect active squad</span></label>
      <label><input type="checkbox" name="storageFirst" checked><span>Storage first</span></label>
      <label><span>Maximum OVR</span><input type="number" name="maxRating" min="1" max="99" value="74" required></label>
      <label><span>Gold OVR</span><input aria-label="Gold minimum" type="number" name="goldMin" min="75" max="99" value="75" required><input aria-label="Gold maximum" type="number" name="goldMax" min="75" max="99" value="82" required></label>
      <label><span>Excluded league IDs</span><input type="text" name="leagues" maxlength="1000"></label>
      <label><input type="checkbox" name="approved" required><span>Confirm this account's policy</span></label>
      <button type="submit">Save policy</button>
    </form>
    <h2>Club</h2><div class="bar"><button id="club">Read Club</button><button id="prices">Load prices</button></div>
    <table><thead><tr><th>Card</th><th>OVR</th><th>Price</th><th>Lock</th></tr></thead><tbody id="items"></tbody></table>
    <div class="bar"><button id="previous" aria-label="Previous page">&lt;</button><span id="page"></span><button id="next" aria-label="Next page">&gt;</button></div>
    <h2>Traditional SBC</h2><select id="challenge" aria-label="In-progress challenge"></select>
    <div class="bar"><button id="scan">Refresh targets</button><button id="preview">Preview squad</button></div>
    <output id="plan"></output>
  </div></details>`;
  const find = id => shadow.getElementById(id);
  const form = find('policy');
  let displayedContext = null;
  let snapshot = null;
  let page = 0;
  let targets = [];
  let quotes = new Map();
  let busy = false;
  const status = text => { find('status').textContent = text; };
  const pageItems = () => snapshot?.items.slice(page * 25, page * 25 + 25) ?? [];
  const safeError = error => /^(FSU|FC27|PRICE)_[A-Z_0-9]+$/.test(error?.message) ? error.message : 'FSU_OPERATION_UNAVAILABLE';
  async function run(action) {
    if (busy) return;
    busy = true;
    for (const button of shadow.querySelectorAll('button')) button.disabled = true;
    status('Reading...');
    try { await action(); } catch (error) { status(safeError(error)); }
    finally { busy = false; for (const button of shadow.querySelectorAll('button')) button.disabled = false; }
  }
  function rows() {
    const body = find('items');
    body.replaceChildren();
    const locks = actions.getLocks();
    for (const item of pageItems()) {
      const tr = doc.createElement('tr');
      const cachedQuote = quotes.get(item.definitionId);
      const quote = cachedQuote?.expiresAt > Date.now() ? cachedQuote : null;
      const price = quote ? `GG ${quote.price.toLocaleString()}` : Number.isSafeInteger(item.marketAverage) && item.marketAverage > 0
        ? `EA avg ${item.marketAverage.toLocaleString()}` : 'N/A';
      for (const text of [`#${item.definitionId}`, String(item.rating ?? '?'), price]) {
        const td = doc.createElement('td'); td.textContent = text; tr.append(td);
      }
      const td = doc.createElement('td');
      const checkbox = doc.createElement('input'); checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `Lock card ${item.definitionId}`);
      checkbox.checked = locks?.itemIds.includes(item.id) === true;
      checkbox.disabled = !locks;
      checkbox.addEventListener('change', () => run(async () => {
        try { actions.setItemLock(snapshot.context, item.id, checkbox.checked); status('Lock saved'); }
        finally { rows(); find('plan').textContent = ''; }
      }));
      td.append(checkbox); tr.append(td); body.append(tr);
    }
    find('page').textContent = `${snapshot?.items.length ? page + 1 : 0} / ${Math.ceil((snapshot?.items.length ?? 0) / 25)}`;
  }
  function refreshPolicy() {
    const context = actions.readContext();
    if (JSON.stringify(context) !== JSON.stringify(displayedContext)) {
      snapshot = null; quotes.clear(); targets = []; rows(); find('challenge').replaceChildren(); find('plan').textContent = '';
    }
    displayedContext = context;
    form.reset();
    const policy = actions.getPolicy();
    if (policy) {
      for (const key of ['onlyUntradeable', 'excludeEvolution', 'protectFsuLockedPlayers', 'protectActiveSquad', 'storageFirst']) form.elements[key].checked = policy[key];
      form.elements.maxRating.value = policy.maxRating;
      form.elements.goldMin.value = policy.goldRange[0]; form.elements.goldMax.value = policy.goldRange[1];
      form.elements.leagues.value = policy.excludedLeagueIds.join(',');
    }
    form.elements.approved.checked = false;
    status(policy ? 'Policy reviewed; inventory provisional' : 'Policy review required');
  }
  shadow.querySelector('details').addEventListener('toggle', () => {
    if (shadow.querySelector('details').open) { try { refreshPolicy(); } catch (error) { displayedContext = null; status(safeError(error)); } }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!event.isTrusted) return;
    run(async () => {
      const text = form.elements.leagues.value.trim();
      if (text && !/^\d+(?:\s*,\s*\d+)*$/.test(text)) throw new Error('FSU_POLICY_INVALID');
      const policy = Object.fromEntries(['onlyUntradeable', 'excludeEvolution', 'protectFsuLockedPlayers', 'protectActiveSquad', 'storageFirst']
        .map(key => [key, form.elements[key].checked]));
      Object.assign(policy, { maxRating: Number(form.elements.maxRating.value),
        goldRange: [Number(form.elements.goldMin.value), Number(form.elements.goldMax.value)],
        excludedLeagueIds: text ? text.split(',').map(Number) : [] });
      actions.savePolicy(displayedContext, policy, form.elements.approved.checked);
      find('plan').textContent = ''; status('Policy saved');
    });
  });
  find('club').addEventListener('click', () => run(async () => {
    snapshot = null; quotes.clear(); rows(); find('plan').textContent = '';
    snapshot = await actions.readClub(); page = 0; rows(); status(`Club: ${snapshot.items.length} players; provisional`);
  }));
  find('prices').addEventListener('click', () => run(async () => {
    if (!snapshot) throw new Error('FSU_INVENTORY_REQUIRED');
    const result = await actions.prices(snapshot.context, pageItems().map(item => item.definitionId));
    quotes = new Map(result.quotes.map(quote => [quote.definitionId, quote])); rows();
    status(`FUT.GG FC27: ${result.reason ?? result.status}`);
  }));
  for (const [id, offset] of [['previous', -1], ['next', 1]]) find(id).addEventListener('click', () => {
    page = Math.max(0, Math.min(page + offset, Math.ceil((snapshot?.items.length ?? 0) / 25) - 1)); quotes.clear(); rows();
  });
  find('scan').addEventListener('click', () => run(async () => {
    targets = actions.targets(); find('challenge').replaceChildren(); find('plan').textContent = '';
    for (const [index, target] of targets.entries()) {
      const option = doc.createElement('option'); option.value = String(index); option.textContent = target.name; find('challenge').append(option);
    }
    status(`In-progress challenges: ${targets.length}`);
  }));
  find('preview').addEventListener('click', () => run(async () => {
    const target = targets[Number(find('challenge').value)];
    if (!target) throw new Error('FSU_CHALLENGE_REQUIRED');
    find('plan').textContent = '';
    const result = await actions.preview(target);
    find('plan').textContent = result.status === 'preview'
      ? result.selected.map(item => `Slot ${item.slot + 1}: #${item.definitionId}, OVR ${item.rating}`).join('\n')
      : result.reason;
    status(result.status === 'preview' ? 'Preview verified; squad unchanged' : result.reason);
  }));
  doc.body.append(host);
  return () => host.remove();
}
