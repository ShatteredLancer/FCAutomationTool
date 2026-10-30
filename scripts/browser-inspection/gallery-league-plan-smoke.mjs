import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

// Full production UI and planner; synthetic league/quotes, no EA requests.
export async function exerciseGalleryLeaguePlan(context, directory) {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
    export { mountFc27AcceptancePanel } from './src/adapters/browser/fc27-acceptance-panel.js';
    export { loadGalleryPriceSnapshot } from './src/gallery/planning-prices.js';
  ` },
    bundle: true, write: false, format: 'iife', globalName: 'LeagueFixture', target: 'chrome120' });
  const input = futggGallery(), set = input.data.categories[0].sets[0];
  set.requiredCards = 30; set.name = 'Synthetic league';
  set.grades.forEach((grade, i) => { grade.threshold = [10, 1000, 3000, 6000, 9000][i]; });
  input.data.tags = [{ id: 1, name: 'No bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }];
  const catalog = normalizeGalleryCatalog('futgg', input);
  for (const mode of ['renew', 'unavailable', 'timeout']) {
    const page = await context.newPage();
    try {
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><title>League planning offline regression</title>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ catalog, mode }) => {
        const attach = globalThis.Element.prototype.attachShadow;
        globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
        const rows = Array.from({ length: 389 }, (_, i) => ({ eaId: 10000 + i, playerEaId: 10000 + i,
          name: `Synthetic ${i}`, gradingScore: i < 80 ? 1 : i < 359 ? 2 : 100,
          galleryScore: i < 80 ? 1 : i < 359 ? 2 : 100, overall: 75, rarityEaId: 1,
          nationEaId: 1, clubEaId: 1, leagueEaId: 1, positions: ['ST'], collected: i < 80,
          firstOwned: false, holographic: false }));
        globalThis.leagueReads = []; globalThis.leagueEvents = []; globalThis.leagueEagerReads = 0;
        globalThis.leaguePanel = globalThis.LeagueFixture.mountFc27AcceptancePanel({ document: globalThis.document,
          hostId: 'league-fixture', targets: () => [], galleryAccountScope: () => 'fixture',
          galleryCatalog: { peek: async () => null, load: async () => ({ status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() }) },
          gallerySetLoader: async () => {
            const priceSnapshot = await globalThis.LeagueFixture.loadGalleryPriceSnapshot(rows, { autoDisplay: true,
              load: async () => { globalThis.leagueEagerReads++; throw Error('Eager display pricing would occupy the planning queue'); } });
            return { status: 'observed', scope: 'fixture', priceSnapshot, prices: priceSnapshot.prices,
              progress: { source: 'futgg', season: '27', setId: 30, complete: true, rows,
                totals: { total: 389, collected: 80, missing: 309, unknown: 0 } } };
          },
          galleryPlanningPrices: async (ids, options) => {
            globalThis.leagueReads.push({ ids, purpose: options.purpose, deadlineAt: options.deadlineAt, force: !!options.force });
            const now = Date.now(), prices = {}, references = {};
            for (const id of ids) {
              if (mode !== 'renew') continue;
              const price = id >= 10359 ? 1000 : 200;
              const fetchedAt = id === 10080 && !options.force ? now - 275000 : now;
              prices[id] = price;
              references[id] = { definitionId: id, quotes: { futbin: { fetchedAt, expiresAt: fetchedAt + 300000, price, error: null } } };
            }
            return { source: 'public-references', policy: { source: 'futbin' }, prices, freshPrices: prices, references,
              expiresAt: mode === 'renew' ? now + 25000 : null, budgetExpired: mode === 'timeout' };
          }, galleryDiagnosticLog: { record: async event => globalThis.leagueEvents.push(event) },
          galleryPlanningSettings: { scope: () => 'fixture', read: async () => ({ timeoutMs: 10000 }) },
        }); globalThis.leaguePanel.open();
      }, { catalog, mode });
      const host = page.locator('#league-fixture');
      await host.locator('#tab-gallery').click();
      await host.locator('#gallery-categories button').first().click();
      await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
      assert.equal(await page.evaluate(() => globalThis.leagueEagerReads), 0);
      assert.equal(await host.getByText('大合集展示报价按需读取；点击“生成方案”时按所选来源核价，不预查全目录。', { exact: true }).isVisible(), true);
      await host.locator('.gallery-plan select').first().selectOption('B');
      await host.getByRole('button', { name: '生成方案', exact: true }).click();
      await page.waitForFunction(() => !globalThis.document.querySelector('#league-fixture').shadowRoot.querySelector('.gallery-plan .row button').disabled,
        null, { timeout: 30000 });
      const output = await host.locator('.gallery-plan-output').innerText();
      const reads = await page.evaluate(() => globalThis.leagueReads);
      assert.ok(reads.every(read => read.purpose === 'gallery-plan' && Number.isSafeInteger(read.deadlineAt)));
      if (mode === 'renew') {
        assert.match(output, /找到 \d+ 个候选方案/);
        assert.deepEqual(reads.map(read => read.ids.length), [250, 59, 1]);
        assert.equal(reads[2].force, true); assert.deepEqual(reads[2].ids, [10080]);
        const result = await page.evaluate(() => globalThis.leagueEvents.find(event => event.event === 'grade-plan' && event.status === 'success'));
        assert.ok(result.bestScore >= 3000); assert.ok(result.evaluations <= 30000);
        await host.locator('.gallery-plan-output').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(directory, 'gallery-league-plan-desktop.png') });
        await page.setViewportSize({ width: 390, height: 800 });
        assert.equal(await host.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        await page.screenshot({ path: path.join(directory, 'gallery-league-plan-mobile.png') });
      } else {
        assert.match(output, mode === 'timeout' ? /90 秒上限/ : /没有返回可用报价/);
        assert.equal(reads.length, 2);
      }
    } finally { await page.close(); }
  }
  console.log('Gallery league planning Chrome passed: 389 versions/30 scoring slots, targeted one-time renewal, shared price deadline, explicit unavailable/timeout, desktop/mobile; synthetic, no EA access.');
}
