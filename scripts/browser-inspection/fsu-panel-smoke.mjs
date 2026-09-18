import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function exerciseFsuPanel(page, directory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['FSU_mod/src/fc27-panel.js'], bundle: true,
    write: false, format: 'iife', globalName: 'FsuPanelSmoke', target: 'chrome120' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    // Offline synthetic UI only. This does not install or validate a GM provider.
    globalThis.fsuSmoke = { saved: 0, locked: false };
    const context = { season: '27', accountScope: 'offline-only', platform: 'PSN:test' };
    const attachShadow = globalThis.Element.prototype.attachShadow;
    globalThis.Element.prototype.attachShadow = function(options) {
      return attachShadow.call(this, this.id === 'fsu-fc27-local' ? { ...options, mode: 'open' } : options);
    };
    try {
      globalThis.FsuPanelSmoke.mountFc27FsuPanel({ document: globalThis.document, actions: {
        readContext: () => context, getPolicy: () => null,
        getLocks: () => ({ itemIds: globalThis.fsuSmoke.locked ? [123] : [] }),
        savePolicy: (_context, _policy, approved) => { if (!approved) throw new Error('FSU_POLICY_APPROVAL_REQUIRED'); globalThis.fsuSmoke.saved++; },
        setItemLock: (_context, _id, value) => { globalThis.fsuSmoke.locked = value; },
        readClub: async () => ({ context, items: [{ id: 123, definitionId: 456, rating: 65, marketAverage: 500 }] }),
        prices: async () => ({ status: 'unavailable', reason: 'PRICE_HTTP_403', quotes: [] }),
        targets: () => [{ setId: 1, id: 2, name: 'A Brace' }],
        preview: async () => ({ status: 'preview', selected: [{ slot: 2, definitionId: 456, rating: 65 }] }),
      } });
    } finally { globalThis.Element.prototype.attachShadow = attachShadow; }
  });
  const host = page.locator('#fsu-fc27-local');
  await host.locator('summary').click();
  await host.getByLabel("Confirm this account's policy").check();
  await host.getByRole('button', { name: 'Save policy' }).click();
  await host.getByRole('button', { name: 'Read Club', exact: true }).click();
  if (!(await host.locator('#items').textContent()).includes('EA avg 500')) throw new Error('EA average display failed');
  await host.getByLabel('Lock card 456').check();
  await host.getByRole('button', { name: 'Load prices' }).click();
  await host.getByRole('button', { name: 'Refresh targets' }).click();
  await host.getByRole('button', { name: 'Preview squad' }).click();
  if (await page.evaluate(() => globalThis.fsuSmoke.saved !== 1 || globalThis.fsuSmoke.locked !== true)) throw new Error('FSU panel actions failed');
  if (!(await host.locator('#plan').textContent()).includes('Slot 3')) throw new Error('FSU panel preview failed');
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await host.locator('summary').scrollIntoViewIfNeeded();
    const overflow = await host.evaluate(element => {
      const details = element.shadowRoot.querySelector('details');
      const body = element.shadowRoot.querySelector('.body');
      const bounds = details.getBoundingClientRect();
      return bounds.left < 0 || bounds.right > globalThis.innerWidth || bounds.top < 0 || bounds.bottom > globalThis.innerHeight
        || body.scrollWidth > body.clientWidth;
    });
    if (overflow) throw new Error('FSU panel layout overflow');
    await page.screenshot({ path: path.join(directory, `fsu-panel-${viewport.width}.png`) });
  }
  await host.getByRole('button', { name: 'Load prices' }).click();
  if (!(await host.locator('#status').textContent()).includes('PRICE_HTTP_403')) throw new Error('FSU price error state failed');
  console.log('FSU panel offline smoke passed: policy, locks, price failure, preview, desktop/mobile. No EA/GM installation implied.');
}
