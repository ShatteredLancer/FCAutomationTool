import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

// Actual sanitized planning input through real trusted UI clicks and browser
// deadlines. All providers are local: no EA session, quotes or purchases.
export async function exerciseGalleryCostReplay(context, directory) {
  const input = JSON.parse(await readFile(new URL('../../tests/fixtures/fc27-gallery-cost-replay.json', import.meta.url), 'utf8'));
  const raw = futggGallery();
  Object.assign(raw.data.categories[0].sets[0], input.set, { id: 41, name: 'Cost replay', slug: 'cost-replay',
    grades: input.set.grades.map(grade => ({ ...grade, rewards: [] })) });
  raw.data.tags = input.catalog.tags;
  const catalog = normalizeGalleryCatalog('futgg', raw);
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'], bundle: true, write: false,
    format: 'iife', globalName: 'GalleryReplaySmoke', target: 'chrome120' });
  const page = await context.newPage(), requests = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.setContent('<!doctype html><title>Gallery real diagnostic replay</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ input, catalog }) => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      globalThis.costReplayEvents = []; globalThis.costReplayReads = 0;
      globalThis.costReplayGaps = []; let last = performance.now();
      globalThis.costReplayHeartbeat = setInterval(() => {
        const now = performance.now(); globalThis.costReplayGaps.push(now - last); last = now;
      }, 25);
      const panel = globalThis.GalleryReplaySmoke.mountFc27AcceptancePanel({ document: globalThis.document,
        hostId: 'gallery-cost-replay', targets: () => [], galleryAccountScope: () => 'offline-replay',
        galleryDiagnosticLog: { record: event => { globalThis.costReplayEvents.push(event); } },
        galleryCatalog: { peek: async () => null, load: async () => ({ status: 'observed', source: 'futgg', catalog }) },
        gallerySetLoader: async () => {
          globalThis.costReplayReads++;
          return { status: 'observed', scope: 'offline-replay', progress: { ...input.progress,
            totals: { total: 33, collected: 3, missing: 30, unknown: 0 } }, prices: input.prices,
            priceSnapshot: { prices: input.prices, freshPrices: input.prices, stale: false, staleIds: [], expiresAt: Date.now() + 300000 } };
        },
      }); panel.open();
    }, { input, catalog });
    const host = page.locator('#gallery-cost-replay');
    await host.locator('#tab-gallery').click();
    await host.locator('#gallery-categories button').first().click();
    await host.getByRole('button', { name: '查看卡片', exact: true }).click();
    await host.locator('.gallery-plan select').selectOption('S');
    await host.getByRole('button', { name: '生成方案', exact: true }).click();
    await host.locator('.gallery-plan-output details').first().waitFor({ timeout: 20000 });
    const event = await page.evaluate(() => globalThis.costReplayEvents.find(row => row.event === 'grade-plan'));
    assert.equal(event.status, 'success');
    assert.ok(event.bestPrice <= 13850, `single replay cost ${event.bestPrice}`);
    assert.ok(event.bestScore >= 7800);
    const items = await host.locator('.gallery-plan-output details').first().locator('li').allTextContents();
    assert.equal(items.length, 12);
    assert.ok((await host.locator('.gallery-plan-output .gallery-reward-estimate').count()) >= 1,
      'single-set plan exposes the cumulative catalogue reward estimate');
    for (const id of [67297431, ...input.progress.rows.filter(row => row.collected).map(row => row.eaId)]) {
      assert.ok(items.every(text => !text.startsWith(`${id} `)), `excluded ${id}`);
    }
    await host.getByRole('button', { name: '各档费用', exact: true }).click();
    await host.locator('.gallery-grade-overview-row').nth(4).waitFor({ timeout: 15000 });
    const overview = await host.locator('.gallery-grade-overview-row').allTextContents();
    assert.ok(overview.every(text => text.includes('本档：') && text.includes('累计：')),
      'each grade cost exposes tier and cumulative reward estimates');
    assert.ok(overview.slice(0, 4).every(text => text.includes('已达到')));
    const sPrice = Number((await host.locator('.gallery-grade-overview-row').nth(4).locator('span').textContent()).replace(/[^0-9]/g, ''));
    assert.ok(sPrice > 0 && sPrice <= 13850, `overview replay cost ${sPrice}`);
    await host.getByRole('button', { name: '加入联合目标', exact: true }).click();
    await host.locator('#gallery-mode-joint').click();
    await host.locator('#gallery-joint-budget').fill('14000');
    await host.locator('#gallery-joint-plan').click();
    await host.locator('#gallery-joint-output details').first().waitFor({ timeout: 20000 });
    const joint = await page.evaluate(() => globalThis.costReplayEvents.find(row => row.event === 'joint-plan' && row.status === 'success'));
    assert.ok(joint?.bestPrice <= 13850, `joint replay cost ${joint?.bestPrice}`);
    const stats = await page.evaluate(() => {
      clearInterval(globalThis.costReplayHeartbeat);
      return { reads: globalThis.costReplayReads, maxGap: Math.max(...globalThis.costReplayGaps), beats: globalThis.costReplayGaps.length };
    });
    assert.equal(stats.reads, 1);
    assert.ok(stats.beats > 10);
    assert.ok(stats.maxGap < 1000, `heartbeat gap ${stats.maxGap}ms`);
    assert.deepEqual(requests, []);
    await page.screenshot({ path: path.join(directory, 'gallery-cost-replay.png') });
    console.log(`Gallery real-input offline replay passed: single ${event.bestPrice}/${event.bestScore}, overview ${sPrice}, joint ${joint.bestPrice}, one local read, max heartbeat gap ${Math.round(stats.maxGap)}ms. No live EA acceptance.`);
  } finally { await page.close(); }
}
