import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryReplan(context, directory) {
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'], bundle: true, write: false,
    format: 'iife', globalName: 'GalleryReplanSmoke', target: 'chrome120' });
  const input = futggGallery(), first = input.data.categories[0].sets[0];
  first.requiredCards = 3;
  first.grades.forEach((grade, index) => { grade.threshold = 300 + index * 100; });
  const second = structuredClone(first); second.id = 31; second.name = 'Shared versions'; second.slug = 'shared-versions';
  input.data.categories[0].sets.push(second);
  input.data.tags = [{ id: 1, name: 'No bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'RARE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }];
  const catalog = normalizeGalleryCatalog('futgg', input);
  for (const mode of ['single', 'joint']) {
    const page = await context.newPage(), requests = [];
    page.on('request', request => requests.push(request.url()));
    try {
      await page.setContent('<!doctype html><title>Gallery replanning offline fixture</title>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(catalog => {
        const attach = globalThis.Element.prototype.attachShadow;
        globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
        globalThis.replanScope = 'fixture-a'; globalThis.replanPurchases = []; globalThis.replanReads = 0;
        const row = (eaId, collected = false) => ({ eaId, playerEaId: eaId, name: `Player ${eaId}`, version: 'Gold',
          gradingScore: 100, galleryScore: 100, collected, firstOwned: false, holographic: false, overall: 80,
          rarityEaId: 1, positions: ['ST'], status: collected ? 'collected' : 'missing' });
        const purchase = async args => {
          const ids = args.items.map(item => item.eaId);
          globalThis.replanPurchases.push({ ids, budget: args.budget });
          const attempt = globalThis.replanPurchases.length;
          const acquired = attempt === 1 ? [{ definitionId: 2, state: 'club', price: 200 }] : [];
          const failure = attempt === 1 ? 3 : 4;
          if (attempt === 3) return { status: 'purchased', spent: 300, purchased: 1,
            results: [{ definitionId: 5, state: 'club', price: 300 }], collection: { status: 'confirmed' } };
          return { status: 'partial', reason: 'FC27_GALLERY_NO_LISTING', spent: attempt === 1 ? 200 : 0,
            purchased: acquired.length, results: [...acquired, { definitionId: failure, state: 'waiting' }],
            failures: [{ definitionId: failure, reason: 'FC27_GALLERY_NO_LISTING' }], collection: { status: 'confirmed' } };
        };
        purchase.inspect = async () => ({ status: 'absent' });
        globalThis.replanPanel = globalThis.GalleryReplanSmoke.mountFc27AcceptancePanel({ document: globalThis.document,
          hostId: 'gallery-replan-test', targets: () => [], galleryAccountScope: () => globalThis.replanScope,
          purchaseGallery: purchase,
          galleryCatalog: { peek: async () => null,
            load: async () => ({ status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() }) },
          gallerySetLoader: async ({ setId }) => {
            globalThis.replanReads++;
            return { status: 'observed', scope: globalThis.replanScope,
              prices: { 2: 200, 3: 200, 4: 250, 5: 300 },
              progress: { season: '27', setId: Number(setId.slice(6)), complete: true,
                rows: [row(setId === 'futgg:30' ? 1 : 9, true), row(2), row(3), row(4), row(5)],
                totals: { total: 5, collected: 1, missing: 4, unknown: 0 } } };
          },
        }); globalThis.replanPanel.open();
      }, catalog);
      const host = page.locator('#gallery-replan-test');
      await host.locator('#tab-gallery').click();
      await host.locator('#gallery-categories button').first().click();
      await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
      let output = host.locator('#gallery-set-detail .gallery-plan-output');
      if (mode === 'joint') {
        await host.getByRole('button', { name: '加入联合目标', exact: true }).click();
        await host.getByRole('button', { name: '返回集合', exact: true }).click();
        await host.locator('[data-set-id="futgg:31"]').getByRole('button', { name: '查看卡片', exact: true }).click();
        await host.getByRole('button', { name: '加入联合目标', exact: true }).click();
        await host.locator('#gallery-mode-joint').click();
        await host.locator('#gallery-joint-budget').fill('800');
        await host.locator('#gallery-joint-plan').click();
        output = host.locator('#gallery-joint-output');
      } else await host.getByRole('button', { name: '生成方案', exact: true }).click();
      const initial = output.locator('details').first();
      await initial.waitFor();
      if ((await initial.getAttribute('open')) === null) await initial.locator('summary').click();
      await initial.getByRole('button', { name: '批量购买', exact: true }).click();
      for (const id of [4, 5]) {
        await host.getByRole('button', { name: '重新规划剩余目标', exact: true }).click();
        const replacement = output.locator('details').first();
        await replacement.waitFor();
        assert.match(await replacement.locator('summary').innerText(), /1 张/);
        await replacement.locator('summary').click();
        assert.match(await replacement.innerText(), new RegExp(`Player ${id}`));
        await replacement.getByRole('button', { name: '购买替代方案', exact: true }).click();
      }
      assert.deepEqual(await page.evaluate(() => globalThis.replanPurchases), [
        { ids: [2, 3], budget: mode === 'joint' ? 800 : null },
        { ids: [4], budget: mode === 'joint' ? 600 : null },
        { ids: [5], budget: mode === 'joint' ? 600 : null },
      ]);
      assert.equal(await page.evaluate(() => globalThis.replanReads), mode === 'joint' ? 2 : 1);
      assert.match(await host.locator('#gallery-purchase-message').innerText(), /购买完成/);
      await page.screenshot({ path: path.join(directory, `gallery-replan-${mode}.png`) });
      assert.deepEqual(requests, []);
    } finally { await page.close(); }
  }
  console.log('Offline Gallery replanning smoke passed: single/joint, two failures, cumulative budget, no rebuy and no extra reads. Synthetic only.');
}
