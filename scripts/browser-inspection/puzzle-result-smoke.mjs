import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function exercisePuzzleResultPanel(page, directory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  await page.setContent('<!doctype html><title>Puzzle offline aggregate fixture</title>');
  const { outputFiles } = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-puzzle-result-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'PuzzlePanelSmoke', target: 'chrome120' });
  await page.addScriptTag({ content: outputFiles[0].text });
  const observed = JSON.parse(await readFile(path.join(root, 'tests/fixtures/fc27-puzzle-owned-recheck-observation.json'), 'utf8'));
  const mount = report => page.evaluate(report => globalThis.PuzzlePanelSmoke.mountFc27PuzzleResultPanel({
    document: globalThis.document, report }), report);
  await mount(observed);
  const panel = page.locator('#fcat-puzzle-readonly');
  if (await panel.locator('li').count() !== 11 || !(await panel.locator('section').textContent()).includes('本次 11 张通过')) {
    throw new Error('Observed exact Club check must be displayed as verified');
  }
  await mount({ ...observed, eaRatingDifferential: { status: 'verified' },
    eaChemistryDifferential: { status: 'verified' }, eaRequirementDifferential: { status: 'verified' } });
  if (!(await panel.locator('section').textContent()).includes('EA 条件：对照一致')
      || (await panel.locator('section').textContent()).includes('待验证')) throw new Error('Completed comparisons must replace stale Pending text');
  // Synthetic absent-check case, never relabel the stored real evidence.
  await mount({ ...observed, plan: { ...observed.plan, exactValidation: null } });
  if (await page.locator('#fcat-puzzle-readonly').count() !== 1
      || !(await panel.locator('section').textContent()).includes('未通过或尚未执行')
      || await panel.locator('button').count() !== 1) throw new Error('Puzzle panel replacement or read-only controls failed');
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const overflow = await panel.evaluate(host => {
      const section = host.shadowRoot.querySelector('section'); const rect = section.getBoundingClientRect();
      return rect.left < 0 || rect.right > globalThis.innerWidth || rect.top < 0 || rect.bottom > globalThis.innerHeight
        || section.scrollWidth > section.clientWidth;
    });
    if (overflow) throw new Error('Puzzle panel overflow');
    await panel.screenshot({ path: path.join(directory, `puzzle-result-${viewport.width}.png`) });
  }
  await mount({ ...observed, status: 'blocked', reason: '<img src=x onerror=alert(1)>',
    plan: { ...observed.plan, exactValidation: { status: 'blocked' } } });
  if (await panel.locator('li').count() || await panel.locator('img').count()
      || !(await panel.locator('section').textContent()).includes('未通过 · 不可执行')) throw new Error('Puzzle blocked result must clear stale slots and escape input');
  await panel.getByRole('button', { name: '关闭结果' }).click();
  if (await panel.count()) throw new Error('Puzzle close failed');
  console.log('Puzzle result offline smoke passed: real exact-check replay, synthetic missing check, blocked/XSS, close, desktop/mobile. No fresh EA validation implied.');
}
