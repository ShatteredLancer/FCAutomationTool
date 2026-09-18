import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function exerciseRunnerPanel(page, directory) {
  await page.setContent('<!doctype html><title>Runner offline UI fixture</title>');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-runner-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'RunnerPanelSmoke', target: 'chrome120' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    globalThis.runnerSmokeCalls = 0;
    globalThis.RunnerPanelSmoke.mountFc27RunnerPanel({ document: globalThis.document,
      read: () => ({ inputs: { status: 'observed', reason: 'FC27_TRANSACTION_UNVERIFIED',
        fsu: { readiness: 'provisional' }, club: { cachedPlayers: 41 } }, targets: [
        { setId: 6, name: 'Gold Upgrade' }, { setId: 7, name: '<img src=x onerror=alert(1)> Long synthetic challenge title' },
      ] }),
      preview: async () => {
        globalThis.runnerSmokeCalls++;
        return { status: 'insufficient', reason: 'SAFE_MATERIAL_SHORTAGE',
          plan: { required: 11, safeCandidates: 5, ratings: [] } };
      },
    });
  });
  const panel = page.locator('#fcat-fc27-preview');
  await panel.locator('summary').click();
  await panel.locator('#rating').selectOption('83');
  await panel.getByRole('button', { name: 'Preview squad' }).click();
  if (await panel.locator('#status').textContent() !== 'SAFE_MATERIAL_SHORTAGE'
      || await panel.locator('#counts').textContent() !== 'Safe candidates: 5 / 11 required') throw new Error('Runner shortage display failed');
  if (await panel.locator('img').count() || await page.evaluate(() => globalThis.runnerSmokeCalls) !== 1) throw new Error('Runner read-only command contract failed');
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const overflow = await panel.evaluate(element => {
      const details = element.shadowRoot.querySelector('details');
      const body = element.shadowRoot.querySelector('.body');
      const bounds = details.getBoundingClientRect();
      return bounds.left < 0 || bounds.right > globalThis.innerWidth || bounds.top < 0 || bounds.bottom > globalThis.innerHeight
        || body.scrollWidth > body.clientWidth;
    });
    if (overflow) throw new Error('Runner panel layout overflow');
    await panel.screenshot({ path: path.join(directory, `runner-panel-${viewport.width}.png`) });
  }
  await panel.getByRole('button', { name: 'Refresh local inputs' }).click();
  if (await panel.locator('#counts').textContent() !== '') throw new Error('Runner stale result retained');
  console.log('Runner panel offline smoke passed: shortage, escaping, refresh, desktop/mobile. No live transaction implied.');
}
