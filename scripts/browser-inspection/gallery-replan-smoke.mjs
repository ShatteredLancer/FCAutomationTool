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
  for (const mode of ['single', 'public', 'restored', 'stale', 'tab', 'joint', 'joint-tab', 'untrusted', 'account', 'purchase-read', 'purchase-invalid', 'purchase-receipt', 'purchase-write']) {
    const joint = mode.startsWith('joint');
    const page = await context.newPage(), requests = [];
    page.on('request', request => requests.push(request.url()));
    try {
      await page.setContent('<!doctype html><title>Gallery replanning offline fixture</title>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ catalog, mode }) => {
        const attach = globalThis.Element.prototype.attachShadow;
        globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
        globalThis.replanScope = 'fixture-a'; globalThis.replanPurchases = []; globalThis.replanReads = 0;
        globalThis.replanDiagnostics = [];
        globalThis.publicPlanningCalls = [];
        const records = new Map(); globalThis.quoteDelta = 0;
        const row = (eaId, collected = false) => ({ eaId, playerEaId: eaId, name: `Player ${eaId}`, version: 'Gold',
          gradingScore: 100, galleryScore: 100, collected, firstOwned: false, holographic: false, overall: 80,
          rarityEaId: 1, positions: ['ST'], status: collected ? 'collected' : 'missing' });
        const purchase = async args => {
          const purchaseFailure = { 'purchase-read': 'FC27_GALLERY_PURCHASE_JOURNAL_READ_FAILED',
            'purchase-write': 'FC27_GALLERY_PURCHASE_JOURNAL_WRITE_FAILED',
            'purchase-invalid': 'FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED',
            'purchase-receipt': 'FC27_GALLERY_PURCHASE_RECEIPT_UNCONFIRMED' }[globalThis.replanFailureMode];
          if (purchaseFailure) return { status: 'blocked', reason: purchaseFailure, purchased: 0, spent: 0 };
          const ids = args.items.map(item => item.eaId);
          if (mode === 'public' && args.items.some(item => item.priceReference?.policy?.source !== 'futgg')) throw Error('Missing planned reference');
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
        purchase.inspect = async () => globalThis.replanFailureMode === 'purchase-read'
          ? { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_JOURNAL_READ_FAILED' } : { status: 'absent' };
        globalThis.mountReplanPanel = () => { globalThis.replanPanel = globalThis.GalleryReplanSmoke.mountFc27AcceptancePanel({ document: globalThis.document,
          hostId: 'gallery-replan-test', targets: () => [], galleryAccountScope: () => globalThis.replanScope,
          purchaseGallery: purchase,
          galleryPlanningPrices: mode !== 'public' ? null : async (ids, options) => {
            globalThis.publicPlanningCalls.push(ids);
            options.onProgress({ source: 'futgg', index: ids.length, total: ids.length });
            const prices = Object.fromEntries(ids.map(id => [id, ({ 2: 200, 3: 200, 4: 250, 5: 300 })[id]]));
            const policy = { source: 'futgg', premiumMode: 'fixed', premium: 0, purchaseAttempts: 3 };
            return { source: 'public-references', prices, freshPrices: prices, policy, expiresAt: Date.now() + 300000,
              references: Object.fromEntries(ids.map(id => [id, { definitionId: id, policy, futgg: prices[id], futbin: prices[id] + 50 }])) };
          },
          galleryDiagnosticLog: { record: value => { globalThis.replanDiagnostics.push(value); } },
          galleryPlanStore: { save: async (scope, source, id, record) => { records.set(`${scope}:${source}:${id}`, structuredClone(record)); },
            load: async (scope, source, id) => { await new Promise(resolve => setTimeout(resolve, 20));
              const record = records.get(`${scope}:${source}:${id}`); return record ? { status: 'observed', record: structuredClone(record) } : { status: 'absent' }; } },
          galleryCatalog: { peek: async () => null,
            load: async () => ({ status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() }) },
          gallerySetLoader: async ({ setId }) => {
            globalThis.replanReads++;
            return { status: 'observed', scope: globalThis.replanScope,
              prices: { 2: 200 + globalThis.quoteDelta, 3: 200, 4: 250, 5: 300 },
              progress: { season: '27', setId: Number(setId.slice(6)), complete: true,
                rows: [row(setId === 'futgg:30' ? 1 : 9, true), row(2), row(3), row(4), row(5)],
                totals: { total: 5, collected: 1, missing: 4, unknown: 0 } } };
          },
        }); globalThis.replanPanel.open(); }; globalThis.mountReplanPanel();
      }, { catalog, mode });
      await page.evaluate(mode => { globalThis.replanFailureMode = mode; }, mode);
      const host = page.locator('#gallery-replan-test');
      await host.locator('#tab-gallery').click();
      if (mode === 'purchase-read') {
        await host.locator('#gallery-purchase-journal-status').waitFor({ state: 'visible' });
        assert.match(await host.locator('#gallery-purchase-journal-status').innerText(), /读取旧购买记录失败/);
        assert.equal(await host.locator('#gallery-purchase-resume').isVisible(), false);
      }
      await host.locator('#gallery-categories button').first().click();
      await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
      let output = host.locator('#gallery-set-detail .gallery-plan-output');
      if (mode === 'public') assert.deepEqual(await page.evaluate(() => globalThis.publicPlanningCalls), [], 'navigation must not trigger dual-source reads');
      if (joint) {
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
      if (mode === 'public') assert.deepEqual(await page.evaluate(() => globalThis.publicPlanningCalls), [[2,3,4,5]], 'all unowned candidates are quoted once before planning');
      if (mode === 'tab' || mode === 'joint-tab') {
        await host.locator('#tab-settings').click();
        await host.locator('#tab-gallery').click();
        assert.equal(await host.locator('#gallery-categories').isVisible(), true, 'returning to Gallery opens categories');
        if (joint) await host.locator('#gallery-mode-joint').click();
        else {
          await host.locator('#gallery-categories button').first().click();
          await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
        }
        await output.locator('details').first().waitFor();
      }
      if (mode === 'restored') {
        await page.evaluate(() => { globalThis.replanPanel.close(); globalThis.replanPanel.element.remove(); globalThis.mountReplanPanel(); });
        await host.locator('#tab-gallery').click();
        await host.locator('#gallery-categories button').first().click();
        await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
        output = host.locator('#gallery-set-detail .gallery-plan-output');
        await output.locator('details').first().waitFor();
      }
      if (mode === 'single' || mode === 'stale') {
        if (mode === 'stale') await page.evaluate(() => { globalThis.quoteDelta = 50; });
        await host.getByRole('button', { name: '返回集合', exact: true }).click();
        await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
        output = host.locator('#gallery-set-detail .gallery-plan-output');
        await output.locator('details').first().waitFor();
        assert.match(await output.locator('details').first().locator('summary').innerText(), /方案 1/);
      }
      const reopened = output.locator('details').first();
      if ((await reopened.getAttribute('open')) === null) await reopened.locator('summary').click();
      if (mode === 'untrusted') {
        await reopened.getByRole('button', { name: '批量购买', exact: true }).evaluate(button => button.click());
        assert.match(await reopened.locator('.gallery-purchase-error').textContent(), /请直接点击/);
        assert.deepEqual(await page.evaluate(() => globalThis.replanPurchases), []);
        assert.equal(await page.evaluate(() => globalThis.replanDiagnostics.at(-1)?.reason), 'FC27_GALLERY_PURCHASE_CLICK_UNTRUSTED');
      }
      if (mode === 'account') {
        // Mutate only the synthetic account fixture, with no interval poll
        // between account change and the trusted click.
        await reopened.getByRole('button', { name: '批量购买', exact: true }).evaluate(button => {
          button.addEventListener('pointerdown', () => { globalThis.replanScope = 'fixture-b'; }, { once: true });
        });
        await reopened.getByRole('button', { name: '批量购买', exact: true }).click();
        assert.equal(await page.evaluate(() => globalThis.replanDiagnostics.some(event => event.reason === 'FC27_GALLERY_ACCOUNT_CHANGED')), true);
        assert.deepEqual(await page.evaluate(() => globalThis.replanPurchases), []);
        assert.deepEqual(requests, []);
        continue;
      }
      await reopened.getByRole('button', { name: '批量购买', exact: true }).click();
      if (mode.startsWith('purchase-')) {
        await host.locator('#gallery-purchase-close').waitFor({ state: 'visible' });
        const message = await host.locator('#gallery-purchase-message').innerText();
        assert.match(message, { 'purchase-read': /读取旧购买记录失败/, 'purchase-invalid': /购买记录格式或保存状态无法确认/,
          'purchase-receipt': /买入结果无法确认/, 'purchase-write': /写入购买记录失败/ }[mode]);
        assert.doesNotMatch(message, /旧挂牌/);
        assert.equal(await host.locator('.gallery-replan-ready').count(), 0);
        assert.deepEqual(requests, []);
        continue;
      }
      if (mode === 'stale') {
        assert.match(await reopened.locator('.gallery-purchase-error').textContent(), /重新生成方案/);
        assert.deepEqual(await page.evaluate(() => globalThis.replanPurchases), []);
        // Reverting to the same facts must re-enable the saved plan, rather
        // than leaving a sticky stale flag from the intervening refresh.
        await page.evaluate(() => { globalThis.quoteDelta = 0; });
        await host.getByRole('button', { name: '返回集合', exact: true }).click();
        await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
        const restored = output.locator('details').first(); await restored.waitFor();
        await restored.locator('summary').click();
        await restored.getByRole('button', { name: '批量购买', exact: true }).click();
      }
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
        { ids: [2, 3], budget: joint ? 800 : null },
        { ids: [4], budget: joint ? 600 : null },
        { ids: [5], budget: joint ? 600 : null },
      ]);
      assert.equal(await page.evaluate(() => globalThis.replanReads), mode === 'stale' ? 3 : ['untrusted', 'public'].includes(mode) ? 1 : 2);
      assert.match(await host.locator('#gallery-purchase-message').innerText(), /购买完成/);
      await page.screenshot({ path: path.join(directory, `gallery-replan-${mode}.png`) });
      assert.deepEqual(requests, []);
    } finally { await page.close(); }
  }
  console.log('Offline Gallery replanning smoke passed: single/joint across tabs, restored/stale plans, two failures, cumulative budget, no rebuy and no extra reads. Synthetic only.');
}
