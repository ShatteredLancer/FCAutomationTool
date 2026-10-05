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
    await host.locator('#gallery-relist-recover').click();
    assert.equal(await start.isDisabled(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await host.locator('.workbench').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    console.log('Gallery relist controls passed: dropdown/interval, explicit start, active lock, stop/recovery, narrow layout; synthetic only.');
  } finally { await page.close(); }
}
