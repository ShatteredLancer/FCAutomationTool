// Page-lifetime presentation only. No timer, persistence, EA request or start
// permission: the existing runtime owns all execution and receipt handling.
export function mountMarketBackgroundStatus({ document, runtime, id }) {
  if (!runtime || !document?.body) return;
  const host = document.createElement('aside'); host.id = id; host.hidden = true;
  host.style.cssText = 'position:fixed;right:12px;bottom:76px;z-index:10000;max-width:calc(100vw - 24px)';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host([hidden]){display:none!important}*{box-sizing:border-box}
    .bar{display:flex;align-items:center;gap:10px;max-width:100%;padding:8px 10px;border:1px solid #48606d;border-radius:8px;background:#172b36;color:#edf8fc;box-shadow:0 2px 8px #0005;font:13px/1.4 Arial,sans-serif}
    output{min-width:0;overflow-wrap:anywhere}button{flex:none;padding:6px 9px;border:1px solid #86d7c8;border-radius:5px;background:#23483f;color:#e9fff9;cursor:pointer;font:inherit}button:disabled{opacity:.55;cursor:default}
  </style><div class="bar"><output role="status" aria-live="polite"></output><button type="button">Pause all</button></div>`;
  const output = shadow.querySelector('output'), pause = shadow.querySelector('button');
  let status = runtime.inspect();
  const render = () => {
    const rows = status?.tasks ?? [];
    const active = rows.filter(row => ['running', 'queued', 'waiting'].includes(row.state));
    const review = rows.some(row => row.state === 'review');
    const paused = rows.some(row => row.state === 'paused');
    host.hidden = !status?.busy && !active.length && !review && !paused && !status?.reason;
    pause.disabled = !status?.busy && !active.length;
    const scheduled = active.length && active.every(row => row.reason === 'MARKET_SCHEDULE_WAIT');
    output.textContent = `FCAT · ${review ? 'Trading needs review' : active.length
      ? `Trading ${scheduled ? 'scheduled' : 'active'} · ${active.length}`
      : status?.busy ? status.phase === 'initialize' ? 'Starting trading' : 'Finishing current operation'
        : 'Trading paused'}`;
    host.title = 'Tasks continue across FCAT and EA pages. Refreshing or closing the Web App ends this run. Open Market trading for details.';
    if (status?.reason) host.title += ` (${status.reason})`;
  };
  pause.addEventListener('click', event => { if (event.isTrusted && !pause.disabled) runtime.pauseAll(); });
  document.body.append(host);
  const unsubscribe = runtime.subscribe(value => { status = value; render(); });
  render();
  return () => { unsubscribe?.(); host.remove(); };
}
