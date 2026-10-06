import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseGalleryAccounting(context, directory, outputDirectory) {
  const bundle = await build({ absWorkingDir: directory, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'AccountingSmoke', target: 'chrome120' });
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      globalThis.reads = 0; globalThis.reconciliations = 0; globalThis.scope = 'a';
      globalThis.release = null;
      globalThis.panel = globalThis.AccountingSmoke.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'accounting-smoke', targets: () => [],
        galleryAccountScope: () => globalThis.scope,
        galleryCatalog: { peek: async () => null, load: async () => ({ status: 'blocked', reason: 'OFFLINE_FIXTURE' }) },
        galleryAccounting: {
          inspect: async () => { globalThis.reads++; return { status: 'observed', entries: 0, sold: 0, spent: 0, netRevenue: 0, netCost: 0, tax: 0, grossRevenue: 0 }; },
          reconcile: async () => {
            globalThis.reconciliations++;
            return new Promise(resolve => { globalThis.release = resolve; });
          },
        } });
      globalThis.panel.open();
    });
    const host = page.locator('#accounting-smoke');
    await host.locator('#tab-gallery').click();
    const refresh = host.getByRole('button', { name: '核对出售成交' });
    await refresh.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => globalThis.reconciliations), 0);
    await refresh.click();
    assert.equal(await refresh.isDisabled(), true);
    await page.evaluate(() => globalThis.release({ status: 'observed', entries: 2, sold: 1,
      spent: 400, netRevenue: 475, netCost: -75, grossRevenue: 500, tax: 25, unknown: 1 }));
    await host.locator('#gallery-accounting-summary').filter({ hasText: '净成本 -75' }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.reconciliations), 1);
    assert.match(await host.locator('#gallery-accounting-summary').innerText(), /税后收入 475.*1 张状态待确认/);
    for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      assert.equal(await host.locator('.workbench').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      assert.equal(await refresh.evaluate(node => node.getBoundingClientRect().right <= globalThis.innerWidth), true);
      if (outputDirectory) await page.screenshot({ path: path.join(outputDirectory, `gallery-accounting-${name}.png`) });
    }
    await refresh.click();
    await page.evaluate(() => globalThis.release({ status: 'blocked', reason: 'FC27_GALLERY_ACCOUNTING_READ_FAILED' }));
    await host.locator('#gallery-accounting-summary').filter({ hasText: 'FC27_GALLERY_ACCOUNTING_READ_FAILED' }).waitFor();
    console.log('Gallery accounting smoke passed: local-only entry, empty-ledger refresh, explicit receipts, failure visibility, desktop/mobile; synthetic only.');
  } finally { await page.close(); }
}
