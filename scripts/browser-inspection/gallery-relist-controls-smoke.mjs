import assert from 'node:assert/strict';
import { build } from 'esbuild';

export async function exerciseGalleryRelistControls(context, directory) {
  const bundle = await build({ absWorkingDir: directory, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'RelistSmoke', target: 'chrome120' });
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      globalThis.arms = []; globalThis.stops = 0; globalThis.relistState = { status: 'absent' };
      globalThis.panel = globalThis.RelistSmoke.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'relist-smoke', targets: () => [],
        galleryCatalog: { peek: async () => null, load: async () => ({ status: 'blocked', reason: 'OFFLINE_FIXTURE' }) },
        galleryListing: { prepare: async () => ({ status: 'blocked', reason: 'OFFLINE_FIXTURE' }) },
        galleryAccountScope: () => 'fixture', galleryRelist: {
          read: async () => globalThis.relistState,
          arm: async args => { globalThis.arms.push(args); return globalThis.relistState = { ...args, status: 'armed', runs: 0 }; },
          stop: () => { globalThis.stops++; },
          disarm: async () => globalThis.relistState = { status: 'disarmed' },
          poll: async () => globalThis.relistState = { status: 'disarmed' },
        } });
      globalThis.panel.open();
    });
    const host = page.locator('#relist-smoke');
    await host.locator('#tab-gallery').click();
    const range = host.getByLabel('自动重挂范围'), minutes = host.getByLabel('重挂检查间隔');
    const start = host.getByRole('button', { name: '自动重挂', exact: true });
    assert.equal(await range.inputValue(), 'batch');
    assert.equal(await minutes.inputValue(), '10');
    await range.selectOption('all'); await minutes.selectOption('5');
    assert.deepEqual(await page.evaluate(() => globalThis.arms), []);
    await start.click();
    assert.deepEqual(await page.evaluate(() => globalThis.arms), [{ approved: true, range: 'all', minutes: 5 }]);
    assert.equal(await range.isDisabled(), true); assert.equal(await minutes.isDisabled(), true);
    await host.locator('#gallery-relist-stop').click();
    assert.equal(await range.isDisabled(), false);
    await range.selectOption('batch'); await minutes.selectOption('1'); await start.click();
    assert.deepEqual(await page.evaluate(() => globalThis.arms[1]), { approved: true, range: 'batch', minutes: 1 });
    await host.locator('#gallery-relist-stop').click();
    await page.evaluate(() => { globalThis.relistState = { status: 'blocked', pending: [{}] }; });
    await page.waitForFunction(() => globalThis.document.querySelector('#relist-smoke').shadowRoot.querySelector('#gallery-relist-start').disabled);
    assert.equal(await host.locator('#gallery-relist-recover').isVisible(), true);
    // Reproduce the complete toolbar, including recovery and synchronization.
    // A full-width listing selector previously forced all following actions down.
    await host.locator('#gallery-sync').evaluate(node => { node.hidden = false; });
    await host.locator('#gallery-sync-time').evaluate(node => { node.textContent = '上次同步 2026/10/6 16:55:45'; });
    for (const width of [1440, 1024, 650, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await host.evaluate(node => {
        const root = node.shadowRoot;
        const rect = selector => {
          const { x, y, width, height, right } = root.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height, right };
        };
        return { select: rect('#gallery-list-range'), action: rect('#gallery-list-purchased'),
          toolbar: rect('.gallery-toolbar'), heading: rect('.gallery-header'),
          workbench: rect('.workbench'), overflow: root.querySelector('.workbench').scrollWidth > root.querySelector('.workbench').clientWidth };
      });
      assert.ok(bounds.select.width < 180, `listing range must stay compact at ${width}px: ${JSON.stringify(bounds)}`);
      assert.ok(Math.abs(bounds.select.y - bounds.action.y) < 1, `listing selector/action must stay together at ${width}px`);
      assert.ok(bounds.action.x >= bounds.select.right, `listing action follows range at ${width}px`);
      assert.equal(bounds.overflow, false, `toolbar must not overflow at ${width}px`);
      assert.ok(bounds.toolbar.right <= bounds.workbench.right, `toolbar stays inside panel at ${width}px`);
      if (width === 1440) assert.ok(bounds.heading.height <= 90, 'desktop toolbar must not expand into three rows');
      await page.screenshot({ path: `${directory}/artifacts/fc27-browser/gallery-toolbar-${width}.png` });
    }
    await host.locator('#gallery-relist-recover').click();
    assert.equal(await start.isDisabled(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await host.locator('.workbench').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    console.log('Gallery relist controls passed: dropdown/interval, explicit start, active lock, stop/recovery, narrow layout; synthetic only.');
  } finally { await page.close(); }
}
