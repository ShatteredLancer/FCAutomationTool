import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exercisePublicPriceSettings(context) {
  const page = await context.newPage(), requests = [];
  page.on('request', request => requests.push(request.url()));
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    stdin: { contents: "export { mountFc27PriceSettings } from './src/adapters/browser/fc27-price-settings.js'; export { createPublicPricePolicyStore } from './src/gallery/public-price-policy.js';", resolveDir: path.resolve(import.meta.dirname, '../..') },
    bundle: true, write: false, format: 'iife', globalName: 'PriceSettingsSmoke', target: 'chrome120' });
  try {
    await page.setContent('<main></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      globalThis.priceScope = 'account-a'; globalThis.priceWrites = 0; globalThis.priceBroken = false;
      const data = new Map();
      const store = globalThis.PriceSettingsSmoke.createPublicPricePolicyStore({ get: async (key, fallback) => data.get(key) ?? fallback,
        set: async (key, value) => { if (globalThis.priceBroken) throw Error('private'); globalThis.priceWrites++; data.set(key, value); } });
      globalThis.priceView = globalThis.PriceSettingsSmoke.mountFc27PriceSettings({ document: globalThis.document, parent: globalThis.document.querySelector('main'),
        service: { scope: () => globalThis.priceScope, readSettings: () => store.read(globalThis.priceScope), saveSettings: value => store.save(globalThis.priceScope, value) } });
      await globalThis.priceView.refresh();
    });
    assert.equal(await page.getByLabel('读取公共报价来源', { exact: true }).inputValue(), 'both');
    assert.equal(await page.getByLabel('挂牌基准来源', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('FUTBIN 价格更新', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).inputValue(), 'futgg');
    assert.equal(await page.getByLabel('每卡购买尝试次数', { exact: true }).inputValue(), '3');
    const validity = page.getByLabel('报价有效期（分钟）', { exact: true });
    assert.equal(await validity.inputValue(), '5');
    await page.getByLabel('读取公共报价来源', { exact: true }).selectOption('futbin');
    assert.equal(await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).inputValue(), 'futbin');
    await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).selectOption('futbin');
    await page.getByLabel('允许超过参考价', { exact: true }).selectOption('percent');
    await page.getByLabel('溢价数值', { exact: true }).fill('10');
    await page.getByLabel('每卡购买尝试次数', { exact: true }).fill('4');
    await validity.fill('30');
    assert.match(await page.locator('output').first().textContent(), /FUTBIN.*10%/);
    await page.getByRole('button', { name: '保存价格设置' }).click();
    assert.match(await page.locator('output').last().textContent(), /已保存/);
    await page.evaluate(() => { globalThis.priceScope = 'account-b'; return globalThis.priceView.refresh(); });
    assert.equal(await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).inputValue(), 'futgg');
    assert.equal(await page.getByLabel('溢价数值', { exact: true }).inputValue(), '0');
    assert.equal(await validity.inputValue(), '5');
    await page.evaluate(() => { globalThis.priceScope = 'account-a'; return globalThis.priceView.refresh(); });
    assert.equal(await page.getByLabel('溢价数值', { exact: true }).inputValue(), '10');
    assert.equal(await validity.inputValue(), '30');
    for (const invalid of ['0', '31', '1.5', '']) {
      await validity.fill(invalid);
      await page.getByRole('button', { name: '保存价格设置' }).click();
      assert.match(await page.locator('output').last().textContent(), /设置无效/);
      assert.equal(await page.evaluate(() => globalThis.priceWrites), 1);
    }
    await page.evaluate(() => globalThis.priceView.refresh());
    assert.equal(await validity.inputValue(), '30');
    await page.getByLabel('每卡购买尝试次数', { exact: true }).fill('0');
    await page.getByRole('button', { name: '保存价格设置' }).click();
    assert.match(await page.locator('output').last().textContent(), /设置无效/);
    assert.equal(await page.evaluate(() => globalThis.priceWrites), 1);
    await page.getByLabel('每卡购买尝试次数', { exact: true }).fill('4');
    await page.evaluate(() => { globalThis.priceBroken = true; });
    await page.getByRole('button', { name: '保存价格设置' }).click();
    assert.match(await page.locator('output').last().textContent(), /保存失败/);
    await page.evaluate(() => { globalThis.priceBroken = false; globalThis.priceScope = 'account-b'; });
    await page.getByRole('button', { name: '保存价格设置' }).click();
    assert.match(await page.locator('output').last().textContent(), /账号已变化/);
    assert.equal(await page.getByRole('button', { name: '保存价格设置' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => globalThis.priceWrites), 1);
    await page.evaluate(() => { globalThis.priceScope = 'account-a'; return globalThis.priceView.refresh(); });
    await page.getByLabel('读取公共报价来源', { exact: true }).selectOption('futgg');
    await page.getByRole('button', { name: '保存价格设置' }).click();
    await page.evaluate(() => globalThis.priceView.refresh());
    assert.equal(await page.getByLabel('读取公共报价来源', { exact: true }).inputValue(), 'futgg');
    assert.equal(await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).inputValue(), 'futgg');
    await page.getByLabel('读取公共报价来源', { exact: true }).selectOption('both');
    await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).selectOption('futbin');
    await page.getByRole('button', { name: '保存价格设置' }).click();
    await page.evaluate(() => globalThis.priceView.refresh());
    assert.equal(await page.getByLabel('读取公共报价来源', { exact: true }).inputValue(), 'both');
    assert.deepEqual(requests, []);
    console.log('Public price settings smoke passed: defaults, source/premium/attempts, quote lifetime persistence and bounds, account switch, invalid input and failed writes; no trade/network calls.');
  } finally { await page.close(); }
}
