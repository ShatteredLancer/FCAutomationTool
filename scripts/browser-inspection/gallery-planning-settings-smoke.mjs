import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseGalleryPlanningSettings(context) {
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root,
    stdin: { contents: "export { mountGalleryPlanningSettings } from './src/adapters/browser/fc27-gallery-planning-settings.js'; export { createGalleryPlanningSettings } from './src/gallery/planning-settings.js';", resolveDir: root },
    bundle: true, write: false, format: 'iife', globalName: 'PlanningSettingsSmoke', target: 'chrome120' });
  try {
    await page.setContent('<main></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      globalThis.planningScope = 'account-a'; const data = new Map();
      const service = globalThis.PlanningSettingsSmoke.createGalleryPlanningSettings({ scope: () => globalThis.planningScope,
        get: async (key, fallback) => data.get(key) ?? fallback, set: async (key, value) => data.set(key, structuredClone(value)) });
      globalThis.planningView = globalThis.PlanningSettingsSmoke.mountGalleryPlanningSettings({ document: globalThis.document,
        parent: globalThis.document.querySelector('main'), service });
      return globalThis.planningView.refresh();
    });
    const input = page.getByLabel('方案计算时间上限（秒）', { exact: true });
    assert.equal(await input.inputValue(), '30');
    await input.fill('60');
    await page.getByRole('button', { name: '保存 Gallery 方案设置', exact: true }).click();
    assert.match(await page.locator('output').innerText(), /已保存/);
    await page.evaluate(() => { globalThis.planningScope = 'account-b'; return globalThis.planningView.refresh(); });
    assert.equal(await input.inputValue(), '30');
    await input.fill('301');
    await page.getByRole('button', { name: '保存 Gallery 方案设置', exact: true }).click();
    assert.match(await page.locator('output').innerText(), /请输入/);
    await page.evaluate(() => { globalThis.planningScope = 'account-a'; return globalThis.planningView.refresh(); });
    assert.equal(await input.inputValue(), '60');
    console.log('Gallery planning settings smoke passed: default, account isolation, save and bounds.');
  } finally { await page.close(); }
}
