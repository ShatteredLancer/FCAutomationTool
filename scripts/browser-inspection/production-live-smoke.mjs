import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function exerciseProductionLivePanel(context, directory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'LivePanelSmoke', target: 'chrome120' });
  const page = await context.newPage();
  let externalRequests = 0;
  await page.route('**/*', route => { externalRequests++; return route.abort(); });
  try {
    await page.setContent('<!doctype html><title>FC27 synthetic Live confirmation</title><body></body>');
    // Open only this offline fixture's shadow root so Playwright can inspect controls.
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const state = globalThis.livePanelSmoke = { prepares: 0, executions: [], shortage: false, finish: null };
      const mount = liveEnabled => globalThis.LivePanelSmoke.mountFc27AcceptancePanel({ document: globalThis.document,
        hostId: 'live-smoke', title: 'FC Automation Tool', liveEnabled,
        targets: () => [{ setId: 4, name: 'Synthetic upgrade' }],
        prepare: async ({ setId, maxRating }) => {
          state.prepares++;
          return state.shortage ? { status: 'blocked', reason: 'SAFE_MATERIAL_SHORTAGE' }
            : { status: 'prepared', liveEnabled: true, setId, challengeId: 16, setName: 'Synthetic upgrade',
              maxRating, selectedCount: 11, ratings: Array(11).fill(60), packId: 509, packCount: 0 };
        },
        execute: approval => {
          state.executions.push(approval);
          return new Promise(resolve => { state.finish = () => resolve({ status: 'completed', submitted: true }); });
        },
        inspectRecovery: async () => ({ status: 'idle' }), resolveRecovery: async () => ({ status: 'resolved' }),
        checkInstallation: async () => ({ status: 'verified', synthetic: true }),
      });
      state.mount = mount; mount(true);
    });
    const host = page.locator('#live-smoke');
    const button = id => host.locator(`#${id}`);
    await host.locator('summary').click();
    assert.equal(await button('execute').isDisabled(), true);
    assert.equal(await button('status').innerText(), 'Live: single SBC');
    await button('prepare').evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.prepares), 0);
    const prepare = async () => {
      await button('prepare').click();
      await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    };
    await prepare();
    assert.equal(await button('execute').isEnabled(), true);
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.executions.length), 0);
    await button('rating').selectOption('83');
    assert.equal(await button('execute').isDisabled(), true);
    await button('rating').selectOption('74');
    await prepare();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await host.locator('details').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.screenshot({ path: path.join(directory, `production-live-panel-${width}.png`) });
    }
    await button('execute').click();
    assert.match(await button('approval').innerText(), /11 players, max OVR 74, once/);
    await page.screenshot({ path: path.join(directory, 'production-live-confirm-390.png') });
    await button('cancel').click();
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.executions.length), 0);
    await button('execute').click();
    await button('confirm').click();
    assert.equal(await button('execute').isDisabled(), true);
    assert.equal(await button('confirm').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => globalThis.livePanelSmoke.executions), [
      { approved: true, count: 1, setId: 4, challengeId: 16, maxRating: 74, maxPlayers: 11 },
    ]);
    await page.evaluate(() => globalThis.livePanelSmoke.finish());
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await button('execute').isDisabled(), true);
    await page.evaluate(() => { globalThis.livePanelSmoke.shortage = true; });
    await prepare();
    assert.equal(await button('status').innerText(), 'SAFE_MATERIAL_SHORTAGE');
    assert.equal(await button('execute').isDisabled(), true);
    await page.evaluate(() => {
      globalThis.document.getElementById('live-smoke').remove();
      globalThis.livePanelSmoke.shortage = false; globalThis.livePanelSmoke.mount(false);
    });
    await host.locator('summary').click();
    assert.equal(await button('status').innerText(), 'Live execution disabled');
    await prepare();
    assert.equal(await button('execute').isDisabled(), true);
    assert.equal(externalRequests, 0);
    await writeFile(path.join(directory, 'production-live-panel-self-test.json'), JSON.stringify({ schema: 1,
      source: 'synthetic callbacks only; no EA or Tampermonkey', userConfirmationRequired: true,
      cancelWithoutExecution: true, exactSingleApproval: true, staleUiPlanCleared: true,
      shortageBlocked: true, readonlyPanelBlocked: true, externalRequests }, null, 2));
    console.log('Production Live panel smoke passed: confirmation, cancel, single use, shortage and read-only isolation. Synthetic only.');
  } finally { await page.close(); }
}
