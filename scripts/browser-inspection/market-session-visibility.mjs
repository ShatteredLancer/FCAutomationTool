// Explicit one-shot inspector command. Only our own blank cover is closed.
const stateKey = Symbol.for('fcat.inspector.session-visibility');
export async function setSessionMonitorBackground(context, page, background) {
  if (background) {
    const state = page[stateKey] ??= {};
    if (!state.cdp) {
      state.cdp = await context.newCDPSession(page);
      await state.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    }
    let cover = state.cover;
    if (!cover || cover.isClosed()) {
      cover = await context.newPage(); state.cover = cover;
      await cover.setContent('<!doctype html><title>FCAT session timing inspection</title><h1>FCAT：后台保活只读检查</h1><p>EA 页面仍在另一个标签页。此窗口不执行交易。</p>');
    }
    await cover.bringToFront();
    const window = await state.cdp.send('Browser.getWindowForTarget');
    state.window ??= { id: window.windowId, originalState: window.bounds.windowState };
    await state.cdp.send('Browser.setWindowBounds', { windowId: state.window.id, bounds: { windowState: 'minimized' } });
    await page.waitForFunction(() => globalThis.document.visibilityState === 'hidden', null, { timeout: 1500 }).catch(() => {});
  } else {
    const { cover, cdp, window } = page[stateKey] ?? {};
    if (cover && !cover.isClosed()) await cover.close();
    if (cdp) {
      if (window) await cdp.send('Browser.setWindowBounds', { windowId: window.id, bounds: { windowState: window.originalState } });
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await cdp.detach();
    }
    delete page[stateKey]; await page.bringToFront();
  }
  const cdp = page[stateKey]?.cdp;
  const window = cdp ? await cdp.send('Browser.getWindowForTarget') : null;
  return { status: 'visibility-observed', visibility: await page.evaluate(() => globalThis.document.visibilityState),
    windowState: window?.bounds?.windowState ?? null, requestsInitiated: 0 };
}
