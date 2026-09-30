// Inspection only. Never dispatch a mouse click into a hidden panel or an EA
// click shield; closed-shadow controls still require a real trusted click.
export async function panelCall(context, page, fn, args = []) {
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fcat-fc27-production' });
    if (!nodeId) return null;
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.find(value => value.shadowRootType === 'closed');
    if (!shadow) return null;
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'agent-panel' });
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
      functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })) });
    if (result.exceptionDetails) throw new Error('FC27_INSPECTION_PANEL_READ_FAILED');
    return result.result?.value ?? null;
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'agent-panel' }).catch(() => {});
    await cdp.detach();
  }
}

export async function waitForPanel(context, page, fn, args = [], timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await panelCall(context, page, fn, args);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('FC27_INSPECTION_PANEL_TIMEOUT');
}

export async function clickPanelControl(context, page, selector, timeoutMs = 5000) {
  const point = await waitForPanel(context, page, function (selector) {
    const button = this.querySelector(selector);
    if (!button || button.disabled || !button.checkVisibility() || this.host.dataset.busy === 'true') return null;
    button.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    if (this.ownerDocument.elementFromPoint(x, y) !== this.host) return null;
    const hit = this.elementFromPoint(x, y);
    if (hit !== button && !button.contains(hit)) return null;
    return { x, y };
  }, [selector], timeoutMs);
  await page.mouse.click(point.x, point.y);
}

export async function openProductionPanel(context, page) {
  const entry = page.locator('.ut-tab-bar .fcat-navigation-entry');
  if (await entry.count() === 1) await entry.click({ timeout: 5000 });
  await waitForPanel(context, page, function () {
    // Navigation pages can be inside an absolutely positioned scroll host;
    // Chromium's checkVisibility() may remain false while the host is already
    // connected and explicitly displayed. Keep the trusted panel state check
    // bounded without treating a detached/hidden node as open.
    const visible = this.host.checkVisibility?.() || (this.host.isConnected && this.host.style.display === 'block');
    return visible && this.host.dataset.busy !== 'true';
  });
}

export async function selectPanelTab(context, page, id) {
  await clickPanelControl(context, page, `#tab-${id}`);
  await waitForPanel(context, page, function (id) {
    return this.host.dataset.activeTab === id && this.querySelector(`#page-${id}`)?.hidden === false;
  }, [id]);
}
