import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real diagnostic timing, synthetic rules/cards and a controlled clock only.
export async function exerciseGalleryForecastClock(context, directory) {
  const root = path.resolve(import.meta.dirname, '../..');
  const observed = JSON.parse(await readFile(path.join(root, 'tests/fixtures/gallery-forecast-expiry-2026-10-26.json'), 'utf8'));
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-gallery-roadmap.js'],
    bundle: true, write: false, format: 'iife', globalName: 'ClockFixture', target: 'chrome120' });
  const scenarios = [
    { name: 'diagnostic-clock' }, { name: 'sync-over-five-minutes', sync: 360000, total: 400000 },
    { name: 'idle-expiry', sync: 1000, total: 6000, idle: true }, { name: 'expired-continuation', partial: true },
    { name: 'deep-expired-quote', sync: 1000, total: 6000, deep: true, quoteExpired: true },
    { name: 'deep-fresh-quote', sync: 360000, total: 400000, deep: true },
    { name: 'expired-at-start', expiredStart: true }, { name: 'account-change', drift: 'scope' },
    { name: 'material-change', drift: 'material' },
  ];
  for (const scenario of scenarios) {
    const page = await context.newPage(); let requests = 0;
    page.on('request', request => { if (/^https?:/.test(request.url())) requests++; });
    try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><button id="open">Open</button>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ timing, scenario }) => {
      const base = Date.now(); let elapsed = 0, cpu = 0, scope = 'synthetic-account';
      Date.now = () => base + elapsed; performance.now = () => elapsed + (cpu += scenario.partial ? 20 : 0);
      const set = { id: 'futgg:1', categoryId: 'cat', name: 'Clock fixture', slug: 'clock-fixture', requiredCards: 1,
        grades: ['D','C','B','A','S'].map((name, i) => ({ name, threshold: 10 * (i + 1),
          rewards: [{ type: 'event_token_1', count: 1, value: [0,0,5,8,15][i] }] })) };
      const catalog = { source: 'futgg', revision: 'fixture-revision', categories: [{ id: 'cat', name: 'Fixture', sets: [set] }],
        tags: [{ id: 1, name: 'No-op', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
          rules: [{ attribute: 'RARE', type: 'COUNT', target: 'ATTRIBUTE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 1 }] }] };
      const target = { set, catalog, status: 'observed', progressKey: 'stable', progress: { season: '27', setId: 1, complete: true,
        poolComplete: true, rows: [{ eaId: 1, playerEaId: 1, gradingScore: 100, galleryScore: 100,
          collected: false, firstOwned: false, overall: 80, rarityEaId: 1 }] } };
      globalThis.clockEvents = []; globalThis.clockHandoff = null; globalThis.clockCalls = { sync: 0, quote: 0, reference: 0 };
      globalThis.forecastClock = value => { elapsed = value; };
      globalThis.clockPanel = globalThis.ClockFixture.mountGalleryRoadmap({ document: globalThis.document, parent: globalThis.document.body,
        button: globalThis.document.querySelector('#open'),
        read: () => ({ active: true, scope, catalog, targets: [target] }),
        prepare: async () => { globalThis.clockCalls.sync++; elapsed += scenario.sync ?? timing.sync; },
        readTimeout: async () => { elapsed = Math.max(elapsed, scenario.total ?? timing.total);
          if (scenario.drift === 'scope') scope = 'different-synthetic-account';
          if (scenario.drift === 'material') target.progressKey = 'changed';
          return scenario.partial ? 1 : timing.deadline; },
        onDiagnostic: row => globalThis.clockEvents.push(row), openSet: (...args) => { globalThis.clockHandoff = args; },
        loadPrices: async () => { globalThis.clockCalls.quote++; return { prices: { 1: 5000 }, freshPrices: { 1: 5000 },
          source: 'public-references', policy: { source: 'futbin' }, expiresAt: Date.now() + (scenario.quoteExpired ? -1 : 300000) }; },
        referenceService: { load: async () => { globalThis.clockCalls.reference++; elapsed += timing.reference; return {
          source: 'fodder', basis: 'empty-collection-public-reference', platform: 'console',
          fetchedAt: base, expiresAt: base + (scenario.expiredStart ? -1 : 300000),
          sets: [{ set, grades: set.grades.map(grade => ({ grade: grade.name, cost: 1000, ids: [1], prices: [1000] })) }],
        }; } },
      });
    }, { timing: observed.timing, scenario });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    if (scenario.deep) await page.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: '生成整体方案', exact: true }).click();
    await page.waitForFunction(() => !globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
    const dialog = page.locator('.gallery-roadmap-dialog');
    if (scenario.partial) {
      assert.ok((await dialog.innerText()).includes('已保留本轮结果'));
      let turns = 0;
      while (await page.getByRole('button', { name: '继续分析剩余', exact: true }).count() && turns++ < 10) {
        await page.getByRole('button', { name: '继续分析剩余', exact: true }).click();
        await page.waitForFunction(() => !globalThis.document.querySelector('.gallery-roadmap-controls + .row button').disabled);
      }
      assert.ok(turns < 10, 'Expired forecast continuation must complete without restarting');
    }
    if (scenario.idle) {
      assert.equal(await page.locator('.gallery-forecast-note').getAttribute('data-expired'), 'false');
      await page.evaluate(() => globalThis.forecastClock(400000));
      await page.locator('.gallery-forecast-note[data-expired=true]').waitFor();
    }
    const text = await dialog.innerText(), calls = await page.evaluate(() => globalThis.clockCalls);
    assert.equal(calls.sync, 1); assert.equal(calls.reference, 1); assert.equal(calls.quote, scenario.deep ? 1 : 0);
    const handoff = page.getByRole('button', { name: '进入俱乐部 / 合集', exact: true });
    if (scenario.quoteExpired || scenario.drift) {
      assert.equal(scenario.quoteExpired ? await page.locator('.gallery-roadmap-dialog > div[aria-live=polite]').getByRole('button', { name: '进入俱乐部 / 合集', exact: true }).count() : await handoff.count(), 0);
      const event = await page.evaluate(() => globalThis.clockEvents.filter(row => row.event === 'roadmap-plan').at(-1));
      if (scenario.quoteExpired) {
        assert.equal(await page.locator('.gallery-roadmap-preview').getByRole('button', { name: '进入俱乐部 / 合集', exact: true }).count(), 1);
        assert.equal(event.priceSource, 'demand-independent-quotes');
      } else assert.equal(event.reason, 'FC27_GALLERY_ROADMAP_CONTEXT_CHANGED');
    } else if (scenario.expiredStart) {
      assert.equal(await handoff.count(), 0); assert.ok(text.includes('Fodder 参考暂不可用'));
      assert.equal(await page.locator('.gallery-forecast-note').isVisible(), false);
    } else {
      assert.ok(text.includes(scenario.deep ? '按需深度分析已完成' : '整体路线已生成'), scenario.name);
      if (!scenario.deep) assert.ok(text.includes('参考缓存已过期'), 'Expired reference estimates must remain visibly labelled');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出分析快照', exact: true }).click();
      const file = path.join(directory, `gallery-forecast-${scenario.name}.json`); await (await download).saveAs(file);
      const exported = JSON.parse(await readFile(file, 'utf8')), price = exported.collections[0].prices[0];
      if (scenario.deep) {
        assert.equal(price.price, 1000); assert.equal(price.fresh, false); // Reference overview is not overwritten by independent quotes.
        assert.equal(exported.roadmap.route[0].quotedItems[0].price, 5000);
        assert.equal(exported.roadmap.route[0].quotedItems[0].fresh, true);
      }
      else {
        assert.equal(price.price, 1000); assert.equal(price.fresh, false); assert.equal(price.cacheExpired, true);
        assert.ok(price.capturedAt < price.expiresAt && price.expiresAt < exported.exportedAt);
        assert.equal(exported.roadmap.forecastReference.cacheExpired, true);
        await page.screenshot({ path: path.join(directory, 'gallery-forecast-clock.png') });
      }
      await handoff.last().click();
      assert.deepEqual(await page.evaluate(() => globalThis.clockHandoff), ['futgg:1', 'S'], 'Only a target, never estimated prices, crosses the club boundary');
    }
    assert.equal(requests, 0);
    } finally { await page.close(); }
  }
  console.log('Gallery forecast clock passed: long sync/expiry, labels/export/continuation, target-only handoff, independent quote expiry and account/material isolation; synthetic only.');
}
