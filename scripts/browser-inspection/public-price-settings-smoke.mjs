import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function exercisePublicPriceSettings(context) {
  const page = await context.newPage(), requests = [];
  page.on('request', request => requests.push(request.url()));
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    stdin: { contents: "export { mountFc27PriceSettings } from './src/adapters/browser/fc27-price-settings.js'; export { createPublicPricePolicyStore } from './src/gallery/public-price-policy.js'; export { createFc27PublicPrices } from './src/adapters/browser/fc27-public-prices.js';", resolveDir: path.resolve(import.meta.dirname, '../..') },
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
    assert.equal(await page.getByLabel('读取公共报价来源', { exact: true }).inputValue(), 'futbin');
    assert.equal(await page.getByLabel('挂牌基准来源', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('FUTBIN 价格更新', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).inputValue(), 'futbin');
    assert.equal(await page.getByLabel('每卡购买尝试次数', { exact: true }).inputValue(), '3');
    const futbinPlatform = page.getByLabel('FUTBIN Reference Platform', { exact: true });
    assert.equal(await futbinPlatform.inputValue(), 'ps');
    await futbinPlatform.selectOption('pc');
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
    assert.equal(await futbinPlatform.inputValue(), 'ps');
    assert.equal(await page.getByLabel('购买 / 挂牌价格参考', { exact: true }).inputValue(), 'futbin');
    assert.equal(await page.getByLabel('溢价数值', { exact: true }).inputValue(), '0');
    assert.equal(await validity.inputValue(), '5');
    await page.evaluate(() => { globalThis.priceScope = 'account-a'; return globalThis.priceView.refresh(); });
    assert.equal(await futbinPlatform.inputValue(), 'pc');
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
    const batch = await page.evaluate(async () => {
      const data = new Map(), urls = [];
      const root = { APP_YEAR_SHORT: 27, APP_YEAR: 2027, services: { User: { currentUserId: 1,
        repository: { _collection: { 1: { id: 1, selectedPersona: 2, _personas: { _collection: {
          2: { id: 2, _sku: 'FFA27PS5', clubs: { _collection: {
            FFA27PS5: { sku: 'FFA27PS5', year: 2027, platform: 'psn' },
          } } },
        } } } } } } } };
      const rows = Array.from({ length: 28 }, (_, index) => ({ definitionId: 1000 + index,
        rating: index < 14 ? 84 : 85 }));
      const service = globalThis.PriceSettingsSmoke.createFc27PublicPrices({ root,
        get: async (key, fallback) => data.get(key) ?? fallback,
        set: async (key, value) => data.set(key, structuredClone(value)),
        transport: { getPrices: async () => { throw Error('UNEXPECTED_FUTGG_READ'); } },
        gmRequest: options => {
          urls.push(options.url);
          const rating = Number(new URL(options.url).searchParams.get('rating')?.split('-')[0]);
          options.onload({ status: 200, responseText: JSON.stringify({ errorcode: '200', data: rows
            .filter(row => row.rating === rating).map(row => ({ resource_id: row.definitionId,
              rating, ps_LCPrice: 650, pc_LCPrice: 900 })) }) });
        } });
      const initial = rows.filter(row => ![1012, 1013, 1026, 1027].includes(row.definitionId));
      const snapshots = [await service.load(initial.map(row => row.definitionId), { rows })];
      for (const [purpose, id] of [['puzzle', 1012], ['purchase', 1013], ['listing', 1026], ['streamlined', 1027]]) {
        snapshots.push(await service.load([id], { purpose, rows }));
      }
      return { requests: urls.length, batchOnly: urls.every(url => url.includes('platform=PS&rating=')),
        sources: snapshots.map(snapshot => snapshot.requestedSources),
        prices: snapshots.map(snapshot => Object.values(snapshot.prices)),
        originalTime: snapshots[0].references[1000].quotes.futbin.fetchedAt,
        reusedTime: snapshots[1].references[1012].quotes.futbin.fetchedAt };
    });
    assert.equal(batch.requests, 2);
    assert.equal(batch.batchOnly, true);
    assert.deepEqual(batch.sources, Array.from({ length: 5 }, () => ['futbin']));
    assert.deepEqual(batch.prices.map(values => values.length), [24, 1, 1, 1, 1]);
    assert.equal(batch.prices.every(values => values.every(value => value === 650)), true);
    assert.equal(batch.originalTime, batch.reusedTime);
    assert.deepEqual(requests, []);
    console.log('Public price settings smoke passed: FUTBIN/PS defaults, settings persistence, validation, two synthetic rating requests for 24 versions and cross-purpose page reuse; no trade/network calls.');
  } finally { await page.close(); }
}
