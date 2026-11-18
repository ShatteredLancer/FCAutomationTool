// Page-lifetime presentation only. No timer, EA request or start permission;
// the small UI preference is local to the browser page and does not authorize execution.
const positionNumber = value => Number.isFinite(Number(value)) ? Math.max(8, Math.round(Number(value))) : null;

export function mountMarketBackgroundStatus({ document, runtime, id, preferenceKey = id, storage = null }) {
  if (!runtime || !document?.body) return;
  const host = document.createElement('aside'); host.id = id; host.hidden = true;
  // The host contains only the compact status bar. It remains movable so the
  // user can place it over an unused corner; the settings toggle can hide it.
  host.style.cssText = 'position:fixed;right:max(12px, env(safe-area-inset-right, 0px));bottom:max(76px, calc(env(safe-area-inset-bottom, 0px) + 12px));z-index:10000;max-width:calc(100vw - 24px);pointer-events:auto';
  const storageKey = `fcat-market-status:${String(preferenceKey).slice(0, 180)}`;
  const readPreferences = () => {
    try {
      const value = JSON.parse(storage?.getItem(storageKey) ?? 'null');
      return { visible: value?.visible !== false, position: value?.position ?? null };
    } catch { return { visible: true, position: null }; }
  };
  const preferences = readPreferences();
  const savePreferences = () => {
    try { storage?.setItem(storageKey, JSON.stringify(preferences)); } catch { /* UI preference only. */ }
  };
  const applyPosition = () => {
    const left = positionNumber(preferences.position?.left), top = positionNumber(preferences.position?.top);
    if (left === null || top === null) return;
    host.style.left = `${left}px`; host.style.top = `${top}px`;
    host.style.right = 'auto'; host.style.bottom = 'auto';
  };
  applyPosition();
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host([hidden]){display:none!important}*{box-sizing:border-box}
    .bar{display:flex;align-items:center;gap:10px;max-width:100%;padding:8px 10px;border:1px solid #48606d;border-radius:8px;background:#172b36;color:#edf8fc;box-shadow:0 2px 8px #0005;font:13px/1.4 Arial,sans-serif;pointer-events:auto;cursor:move;user-select:none;touch-action:none}
    output{min-width:0;overflow-wrap:anywhere}button{flex:none;padding:6px 9px;border:1px solid #86d7c8;border-radius:5px;background:#23483f;color:#e9fff9;cursor:pointer;font:inherit}button:disabled{opacity:.55;cursor:default}
    @media(max-width:520px){.bar{gap:7px;padding:6px 8px;font-size:12px}.bar button{padding:5px 7px}}
  </style><div class="bar"><output role="status" aria-live="polite"></output><button type="button">Pause all</button></div>`;
  const output = shadow.querySelector('output'), pause = shadow.querySelector('button');
  let status = runtime.inspect();
  let dragging = null;
  const clampPosition = (left, top) => {
    const width = host.offsetWidth || 240, height = host.offsetHeight || 40;
    return { left: Math.max(8, Math.min(Math.round(left), Math.max(8, document.defaultView.innerWidth - width - 8))),
      top: Math.max(8, Math.min(Math.round(top), Math.max(8, document.defaultView.innerHeight - height - 8))) };
  };
  const keepInViewport = () => {
    if (!preferences.position) return;
    const position = clampPosition(preferences.position.left, preferences.position.top);
    preferences.position = position; host.style.left = `${position.left}px`; host.style.top = `${position.top}px`;
    host.style.right = 'auto'; host.style.bottom = 'auto'; savePreferences();
  };
  const finishDrag = event => {
    if (!dragging || (event && event.pointerId !== undefined && dragging.pointerId !== null && event.pointerId !== dragging.pointerId)) return;
    try { shadow.querySelector('.bar').releasePointerCapture?.(dragging.pointerId); } catch { /* Already released. */ }
    dragging = null; savePreferences();
  };
  const moveDrag = (clientX, clientY, pointerId = null) => {
    if (!dragging || (pointerId !== null && pointerId !== dragging.pointerId)) return;
    const position = clampPosition(clientX - dragging.dx, clientY - dragging.dy);
    host.style.left = `${position.left}px`; host.style.top = `${position.top}px`;
    host.style.right = 'auto'; host.style.bottom = 'auto'; preferences.position = position;
  };
  const beginDrag = event => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (dragging || event.button !== 0 || path.some(node => node?.tagName === 'BUTTON') || event.target?.closest?.('button')) return;
    const rect = host.getBoundingClientRect(); dragging = { pointerId: event.pointerId ?? null, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    if (event.pointerId !== undefined) bar.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const bar = shadow.querySelector('.bar');
  const view = document.defaultView;
  bar.addEventListener('pointerdown', beginDrag); bar.addEventListener('mousedown', beginDrag);
  host.addEventListener('pointerdown', beginDrag); host.addEventListener('mousedown', beginDrag);
  bar.addEventListener('pointermove', event => moveDrag(event.clientX, event.clientY, event.pointerId));
  view?.addEventListener('mousemove', event => moveDrag(event.clientX, event.clientY));
  bar.addEventListener('pointerup', finishDrag); bar.addEventListener('pointercancel', finishDrag);
  view?.addEventListener('mouseup', finishDrag);
  view?.addEventListener('resize', keepInViewport);
  const render = () => {
    const rows = status?.tasks ?? [];
    const active = rows.filter(row => ['running', 'queued', 'waiting'].includes(row.state));
    const review = rows.some(row => row.state === 'review');
    const paused = rows.some(row => row.state === 'paused');
    host.hidden = preferences.visible === false || (!status?.busy && !active.length && !review && !paused && !status?.reason);
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
  return Object.freeze({
    isVisible: () => preferences.visible !== false,
    setVisible(value) { preferences.visible = value !== false; savePreferences(); render(); },
    resetPosition() { delete preferences.position; host.style.left = ''; host.style.top = ''; host.style.right = 'max(12px, env(safe-area-inset-right, 0px))'; host.style.bottom = 'max(76px, calc(env(safe-area-inset-bottom, 0px) + 12px))'; savePreferences(); },
    element: host,
    dispose() { unsubscribe?.(); view?.removeEventListener('mousemove', moveDrag); view?.removeEventListener('mouseup', finishDrag); view?.removeEventListener('resize', keepInViewport); host.remove(); },
  });
}
