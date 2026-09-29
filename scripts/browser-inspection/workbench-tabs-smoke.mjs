import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

// Exercises only the installed workbench's navigation; never clicks business
// controls, changes settings or reads EA repositories/services.
export async function inspectInstalledWorkbenchTabs(context, page, directory) {
  const entry = page.locator('.ut-tab-bar .fcat-navigation-entry');
  await entry.click();
  await page.locator('#fcat-fc27-production[data-navigation-page]').waitFor({ state: 'visible' });
  const cdp = await context.newCDPSession(page);
  const requests = [];
  const record = request => {
    const url = new URL(request.url());
    if (url.protocol === 'https:') requests.push({ method: request.method(), path: url.pathname });
  };
  try {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fcat-fc27-production' });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.find(value => value.shadowRootType === 'closed');
    assert.ok(shadow, 'Installed closed shadow root required');
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'workbench-tabs' });
    const call = async (fn, args = []) => {
      const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId,
        functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: true });
      if (result.exceptionDetails) throw Error('WORKBENCH_INSPECTION_FAILED');
      return result.result.value;
    };
    const tabs = await call(function () { return [...this.querySelectorAll('[role=tab]')].map(node => ({ id: node.id, text: node.textContent })); });
    assert.equal(tabs.length, 9);
    const duplicateTitleHidden = await call(function () {
      return this.querySelector('.workbench > details > summary').getBoundingClientRect().height === 0;
    });
    assert.equal(duplicateTitleHidden, true);
    const clickTab = async id => {
      const point = await call(function (id) {
        const button = this.getElementById(id);
        button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, [id]);
      await page.mouse.click(point.x, point.y);
      const state = await call(function () {
        const panels = [...this.querySelectorAll('[role=tabpanel]')].filter(node => !node.hidden);
        return { selected: this.querySelector('[role=tab][aria-selected=true]')?.id,
          visible: panels.map(node => node.id), heading: panels[0]?.querySelector('h2')?.textContent,
          maxRating: this.getElementById('puzzle-rating').value };
      });
      if (state.selected !== id) {
        await page.screenshot({ path: path.join(directory, 'workbench-tabs-failure.png') });
        throw Error(`WORKBENCH_TAB_CLICK_MISSED: ${JSON.stringify({ id, point, state, viewport: page.viewportSize() })}`);
      }
      assert.deepEqual(state.visible, [id.replace('tab-', 'page-')]);
      return state;
    };
    // Wait for native navigation animation before judging geometry/screenshots.
    await page.waitForTimeout(350);
    page.on('request', record);
    const states = [];
    for (const tab of tabs) states.push(await clickTab(tab.id));
    await clickTab('tab-market');
    await page.locator('.ut-tab-bar .icon-home').click();
    await entry.click();
    await page.locator('#fcat-fc27-production').waitFor({ state: 'visible' });
    await page.waitForTimeout(350);
    assert.equal(await call(function () { return this.host.dataset.activeTab; }), 'market');
    await clickTab('tab-sbc');
    await page.waitForTimeout(350);
    const desktop = await call(function () {
      const rect = this.host.getBoundingClientRect();
      return { x: rect.x, width: rect.width, overflow: this.host.scrollWidth > this.host.clientWidth + 1 };
    });
    assert.equal(desktop.overflow, false);
    await page.screenshot({ path: path.join(directory, 'workbench-tabs-desktop.png') });
    const originalSize = page.viewportSize();
    let mobile; let compact;
    try {
      await page.setViewportSize({ width: 900, height: 844 });
      await page.waitForTimeout(350);
      await clickTab('tab-settings'); await clickTab('tab-sbc');
      compact = await call(function () {
        const bar = this.querySelector('[role=tablist]');
        return { overflow: this.host.scrollWidth > this.host.clientWidth + 1,
          tabsScrollable: bar.scrollWidth > bar.clientWidth };
      });
      assert.equal(compact.overflow, false); assert.equal(compact.tabsScrollable, true);
      await page.screenshot({ path: path.join(directory, 'workbench-tabs-compact.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(350);
      if (await page.getByText('Resize Window', { exact: true }).isVisible()) {
        mobile = { status: 'blocked', reason: 'EA_RESIZE_WINDOW_OVERLAY' };
      } else {
        await clickTab('tab-settings'); await clickTab('tab-sbc');
        mobile = { status: 'verified' };
      }
      await page.screenshot({ path: path.join(directory, 'workbench-tabs-mobile.png') });
    } finally { if (originalSize) await page.setViewportSize(originalSize); }
    await clickTab('tab-sbc');
    const report = { tabs, states, desktop, compact, mobile, requests,
      duplicateTitleHidden, nativeReturnRetainsTab: true, businessControlsClicked: false, settingsChanged: false, passed: true };
    await writeFile(path.join(directory, 'workbench-tabs-live.json'), JSON.stringify(report, null, 2));
    return { passed: true, tabCount: tabs.length, desktop, compact, mobile, observedRequests: requests.length };
  } finally {
    page.off('request', record);
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'workbench-tabs' }).catch(() => {});
    await cdp.detach();
  }
}
