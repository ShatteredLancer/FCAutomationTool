import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

export async function exerciseGalleryJoint(context, directory) {
  const page = await context.newPage();
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'], bundle: true, write: false,
    format: 'iife', globalName: 'GalleryJointSmoke', target: 'chrome120' });
  const input = futggGallery();
  const a = input.data.categories[0].sets[0]; a.requiredCards = 2; a.name = 'Club Alpha';
  a.grades.forEach((grade, index) => { grade.threshold = 250 + index * 100;
    grade.rewards = [{ type: 'event_token_1', count: 1, value: index + 5, label: `${index + 5} Tokens` }]; });
  const b = structuredClone(a); b.id = 31; b.name = 'League Beta'; b.slug = 'league-beta';
  input.data.categories[0].sets.push(b);
  input.data.tags = [{ id: 1, name: 'No bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'RARE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }];
  const catalog = normalizeGalleryCatalog('futgg', input);
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.setContent('<!doctype html><title>Gallery joint offline fixture</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(catalog => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
      globalThis.jointScope = 'fixture-account-a'; globalThis.jointCalls = 0;
      const row = (eaId, gradingScore, collected) => ({ eaId, playerEaId: eaId, name: `Player ${eaId}`, version: 'Gallery',
        gradingScore, galleryScore: gradingScore, collected, firstOwned: false, holographic: false, overall: 80,
        nationEaId: 1, clubEaId: 1, leagueEaId: 1, rarityEaId: 1, positions: ['ST'], status: collected ? 'collected' : 'missing' });
      globalThis.jointState = { status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() };
      globalThis.jointSnapshot = { prices: { 3: 70, 4: 50, 7: 50 }, freshPrices: { 3: 70, 4: 50, 7: 50 },
        expiresAt: Date.now() + 300000, stale: false, staleIds: [] };
      globalThis.jointPanel = globalThis.GalleryJointSmoke.mountFc27AcceptancePanel({ document: globalThis.document,
        hostId: 'gallery-joint-test', targets: () => [], galleryAccountScope: () => globalThis.jointScope,
        galleryCatalog: { peek: async () => null, load: async () => globalThis.jointState, refresh: async () => globalThis.jointState },
        gallerySetLoader: async ({ setId }) => {
          globalThis.jointCalls++;
          const setA = setId === 'futgg:30';
          const rows = [row(setA ? 1 : 5, 100, true), row(setA ? 2 : 6, 100, true), row(3, 150, false), row(setA ? 4 : 7, 150, false)];
          return { status: 'observed', scope: globalThis.jointScope, priceSnapshot: globalThis.jointSnapshot, prices: globalThis.jointSnapshot.prices,
            progress: { season: '27', setId: Number(setId.slice(6)), complete: true, rows, totals: { total: 4, collected: 2, missing: 2, unknown: 0 } } };
        },
      }); globalThis.jointPanel.open();
    }, catalog);
    const host = page.locator('#gallery-joint-test');
    await host.locator('#tab-gallery').click();
    assert.equal(await page.evaluate(() => globalThis.jointCalls), 0);
    // Gallery now follows Enhancer's two-level browse flow: the home screen
    // contains categories only, so enter the fixture category before opening
    // either collection.
    await host.locator('#gallery-categories button').first().click();
    for (const id of ['30', '31']) {
      await host.locator(`[data-set-id="futgg:${id}"]`).getByRole('button', { name: '查看卡片', exact: true }).click();
      await host.getByRole('button', { name: '加入联合目标', exact: true }).click();
      await host.getByRole('button', { name: '返回集合', exact: true }).click();
    }
    await host.locator('#gallery-mode-joint').click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 2);
    assert.equal(await page.evaluate(() => globalThis.jointCalls), 2);
    await host.locator('#gallery-joint-budget').fill('70');
    await host.locator('#gallery-joint-plan').click();
    assert.match(await host.locator('#gallery-joint-output').innerText(), /方案 1 · 1 张 · 70/);
    assert.match(await host.locator('#gallery-joint-output').innerText(), /共用 2 个目标/);
    assert.match(await host.locator('#gallery-joint-output').innerText(), /奖励为目录内容/);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await host.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `Joint ${width} overflow`);
      await page.screenshot({ path: path.join(directory, `gallery-joint-${width}.png`) });
    }
    await host.locator('#gallery-joint-plan').click();
    assert.equal(await page.evaluate(() => globalThis.jointCalls), 2);
    await host.locator('#gallery-joint-budget').fill('69');
    assert.equal(await host.locator('#gallery-joint-output').textContent(), '');
    await host.locator('#gallery-joint-plan').click();
    assert.match(await host.locator('#gallery-joint-output').innerText(), /当前预算不足|尚不能确认无解/);
    await host.locator('#gallery-joint-budget').fill('70');
    await host.locator('.gallery-joint-target select').first().selectOption('C');
    assert.equal(await host.locator('#gallery-joint-output').textContent(), '');
    await host.locator('.gallery-joint-target select').first().selectOption('D');
    await page.evaluate(() => { globalThis.jointSnapshot.expiresAt = Date.now() - 1; });
    await host.locator('#gallery-joint-plan').click();
    assert.match(await host.locator('#gallery-joint-output').innerText(), /缺少有效报价/);
    await page.evaluate(() => { globalThis.jointSnapshot.expiresAt = Date.now() + 300000; });
    await host.locator('#gallery-joint-plan').click();
    await page.evaluate(() => { globalThis.jointState = structuredClone(globalThis.jointState);
      globalThis.jointState.catalog.tags[0].tiers[0].bonus = 1; globalThis.jointState.catalog.revision = 'rule-change'; });
    await host.locator('#gallery-refresh').click();
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-joint-test').shadowRoot.getElementById('gallery-joint-output').textContent === '');
    assert.equal(await page.evaluate(() => globalThis.jointCalls), 2, 'tag update invalidates locally without EA reread');
    await host.locator('.gallery-joint-target button').first().click();
    assert.equal(await host.locator('.gallery-joint-target').count(), 1);
    await host.locator('#gallery-joint-plan').click();
    await page.evaluate(() => { globalThis.jointState = structuredClone(globalThis.jointState);
      globalThis.jointState.catalog.categories[0].sets = globalThis.jointState.catalog.categories[0].sets.filter(set => set.id !== 'futgg:31');
      globalThis.jointState.catalog.revision = 'set-removed'; });
    await host.locator('#gallery-refresh').click();
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-joint-test').shadowRoot.querySelectorAll('.gallery-joint-target').length === 0);
    assert.equal(await host.locator('#gallery-joint-output').textContent(), '');
    await host.locator('#gallery-mode-browse').click();
    await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
    await host.getByRole('button', { name: '加入联合目标', exact: true }).click();
    await host.locator('#gallery-mode-joint').click();
    assert.equal(await page.evaluate(() => globalThis.jointCalls), 3);
    await page.evaluate(() => { globalThis.jointScope = 'fixture-account-b'; });
    await page.waitForFunction(() => globalThis.document.getElementById('gallery-joint-test').shadowRoot.querySelectorAll('.gallery-joint-target').length === 0);
    assert.equal(await host.locator('.gallery-joint-target').count(), 0);
    assert.equal(await host.locator('#gallery-joint-plan').isDisabled(), true);
    assert.equal(await page.evaluate(() => globalThis.jointCalls), 3);
    assert.deepEqual(requests, []);
    console.log('Offline Gallery joint smoke passed: shared exact version, budget/expired quotes, grade/remove, rule/account invalidation, repeated plans without reads and desktop/mobile.');
  } finally { await page.close(); }
}
