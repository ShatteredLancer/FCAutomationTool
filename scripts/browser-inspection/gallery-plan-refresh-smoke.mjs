import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

// Production UI, synthetic public data/quotes, no EA or market requests.
export async function exerciseGalleryPlanRefresh(context, directory, only = null) {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'ClubFixture', target: 'chrome120' });
  const input = futggGallery(), set = input.data.categories[0].sets[0];
  set.requiredCards = 1; set.grades.forEach((grade, i) => { grade.threshold = 100 + i * 100; });
  input.data.categories[0].sets.push({ ...structuredClone(set), id: 31, name: 'Other club', slug: 'other-club' });
  input.data.tags = [{ id: 1, name: 'No bonus', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'RARE', values: ['999'] }], tiers: [{ minItems: 1, bonus: 0 }] }];
  const catalog = normalizeGalleryCatalog('futgg', input);
  for (const scenario of ['normal', 'same', 'unrelated', 'unrelated-followed', 'overview', 'rules', 'tags', 'material', 'detail', 'cancel', 'error', 'account', 'leave', 'diagnostics',
    'compute-same', 'compute-material', 'compute-expiry', 'overview-compute', 'focus-quotes', 'focus-compute', 'overview-focus',
    'expiry-return', 'overview-expiry-return', 'cancel-return', 'error-return', 'unrelated-redraw', 'notice-account', 'rules-return', 'choice-redraw']) {
    if (only && !only.includes(scenario)) continue;
    const page = await context.newPage(); let network = 0;
    page.on('request', () => { network++; });
    try {
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><title>Single club planning refresh fixture</title>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const compute = scenario.startsWith('compute-') || ['overview-compute', 'focus-compute', 'expiry-return', 'overview-expiry-return', 'notice-account'].includes(scenario);
      const caseCatalog = structuredClone(catalog);
      if (compute) { caseCatalog.categories[0].sets[0].requiredCards = 2; caseCatalog.categories[0].sets[0].grades.forEach(grade => { grade.threshold = 1000; }); }
      await page.evaluate(({ catalog, compute }) => {
        const attach = globalThis.Element.prototype.attachShadow;
        globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
        const interval = globalThis.setInterval;
        globalThis.clubTicks = []; globalThis.clubEvents = []; globalThis.clubCalls = 0; globalThis.clubQuoteCalls = 0;
        globalThis.clubQuoteStarted = false; globalThis.clubQuoteRelease = null; globalThis.clubScope = 'fixture';
        globalThis.clubCatalog = catalog; globalThis.clubQuoteError = false; globalThis.clubHold = true;
        const timeout = globalThis.setTimeout;
        globalThis.clubComputePaused = false; globalThis.clubPauseCompute = false;
        globalThis.setTimeout = (callback, ms, ...args) => {
          if (ms === 0 && globalThis.clubPauseCompute && !globalThis.clubComputePaused) {
            globalThis.clubComputePaused = true;
            globalThis.clubResumeCompute = () => timeout(callback, 0, ...args);
            return timeout(() => {}, 60000);
          }
          return timeout(callback, ms, ...args);
        };
        globalThis.setInterval = (callback, ms) => { globalThis.clubTicks.push({ callback, ms }); return interval(callback, ms); };
        const row = { eaId: 900003, playerEaId: 900003, name: 'Fixture player', gradingScore: 500, galleryScore: 500,
          collected: false, firstOwned: false, holographic: false, overall: 80, nationEaId: 1, clubEaId: 1,
          leagueEaId: 1, rarityEaId: 1, positions: ['ST'], status: 'missing' };
        globalThis.clubDetail = { status: 'observed', scope: 'fixture', progress: { season: '27', source: 'futgg', setId: 30,
          complete: true, rows: compute ? [100, 500, 600].map((score, i) => ({ ...row, eaId: 900003 + i, playerEaId: 900003 + i, gradingScore: score, galleryScore: score })) : [row],
          totals: { total: compute ? 3 : 1, collected: 0, missing: compute ? 3 : 1, unknown: 0 } } };
        globalThis.clubPanel = globalThis.ClubFixture.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'club-fixture', targets: () => [],
          galleryAccountScope: () => globalThis.clubScope,
          galleryCatalog: { peek: async () => null, load: async () => {
            globalThis.clubCalls++; return { status: 'observed', source: 'futgg', catalog: structuredClone(globalThis.clubCatalog), fetchedAt: Date.now() };
          }, refresh: async () => {
            globalThis.clubCalls++; return { status: 'observed', source: 'futgg', catalog: structuredClone(globalThis.clubCatalog), fetchedAt: Date.now() };
          } },
          gallerySetLoader: async () => globalThis.clubDetail,
          gallerySync: { state: () => ({ synced: true, busy: false }), stop() {},
            subscribe: callback => { globalThis.clubNotify = callback; return () => {}; },
            peekDetails: async () => globalThis.clubSyncDetails ?? [] },
          galleryPlanningPrices: async (ids, options) => {
            globalThis.clubQuoteCalls++; globalThis.clubQuoteStarted = true;
            if (globalThis.clubHold) await new Promise(resolve => { globalThis.clubQuoteRelease = resolve; });
            if (globalThis.clubQuoteError) throw Error('FC27_PUBLIC_PRICE_HTTP_503');
            options.onProgress?.({ source: 'fixture', index: ids.length, total: ids.length });
            const prices = Object.fromEntries(ids.map((id, i) => [id, compute ? 200 * (i + 1) : 200]));
            globalThis.clubQuoteSnapshot = { source: 'public-references', policy: { source: 'futbin' }, prices, freshPrices: prices,
              references: {}, expiresAt: Date.now() + 300000 };
            return globalThis.clubQuoteSnapshot;
          }, galleryDiagnosticLog: { record: async event => globalThis.clubEvents.push(event) },
          galleryPlanningSettings: { scope: () => globalThis.clubScope, read: async () => ({ timeoutMs: 5000 }) },
        }); globalThis.clubPanel.open();
      }, { catalog: caseCatalog, compute });
      const host = page.locator('#club-fixture');
      await host.locator('#tab-gallery').click();
      await host.locator('#gallery-categories button').first().click();
      if (scenario === 'unrelated-followed') await host.getByRole('button', { name: '关注集合 Other club', exact: true }).click();
      await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
      const overview = ['overview', 'overview-compute', 'overview-focus', 'overview-expiry-return'].includes(scenario);
      if (['expiry-return', 'choice-redraw'].includes(scenario)) await host.locator('.gallery-plan select').first().selectOption('A');
      if (scenario === 'choice-redraw') {
        await host.getByRole('button', { name: '未收集', exact: true }).click();
        assert.equal(await host.locator('.gallery-plan select').first().inputValue(), 'A', 'A detail redraw must not silently change the requested grade');
      }
      await host.getByRole('button', { name: overview ? '各档费用' : '生成方案', exact: true }).click();
      await page.waitForFunction(() => globalThis.clubQuoteStarted);
      if (['same', 'unrelated', 'unrelated-followed', 'unrelated-redraw', 'overview', 'rules', 'rules-return', 'tags'].includes(scenario)) {
        await page.evaluate(scenario => {
          const sets = globalThis.clubCatalog.categories[0].sets;
          if (scenario.startsWith('unrelated')) sets[1].grades[0].threshold++;
          if (scenario === 'unrelated-redraw') globalThis.clubCatalog.revision = 'unrelated-next-revision';
          if (scenario.startsWith('rules')) sets[0].grades[0].threshold++;
          if (scenario === 'tags') globalThis.clubCatalog.tags[0].tiers[0].bonus++;
        }, scenario);
        // Explicit refresh still exercises in-flight observations. Routine
        // timer/visibility checks have their own deferred-refresh scenarios.
        await host.locator('#gallery-refresh').evaluate(button => button.click());
        await page.waitForFunction(() => globalThis.clubCalls === 2);
        await page.waitForFunction(() => !globalThis.document.querySelector('#club-fixture').shadowRoot.querySelector('#gallery-refresh').disabled);
        if (scenario === 'unrelated-redraw') await host.getByRole('button', { name: '未收集', exact: true }).click();
      }
      if (['focus-quotes', 'overview-focus'].includes(scenario)) {
        await page.evaluate(() => {
          Object.defineProperty(globalThis.document, 'visibilityState', { configurable: true, value: 'hidden' });
          globalThis.document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(globalThis.document, 'visibilityState', { configurable: true, value: 'visible' });
          globalThis.document.dispatchEvent(new Event('visibilitychange'));
          for (const tick of globalThis.clubTicks) if (tick.ms === 300000) { tick.callback(); tick.callback(); }
        });
        assert.equal(await page.evaluate(() => globalThis.clubCalls), 1, 'Routine return/timer refresh must wait for this plan');
      }
      if (['material', 'detail'].includes(scenario)) {
        await page.evaluate(scenario => {
          const detail = structuredClone(globalThis.clubDetail);
          if (scenario === 'material') detail.progress.rows[0].collected = true;
          else detail.progress.updatedAt = Date.now();
          globalThis.clubSyncDetails = [detail]; globalThis.clubNotify();
        }, scenario);
      }
      if (scenario.startsWith('cancel')) await host.getByRole('button', { name: '取消', exact: true }).click();
      if (scenario.startsWith('error')) await page.evaluate(() => { globalThis.clubQuoteError = true; });
      if (scenario === 'diagnostics') await page.evaluate(() => { globalThis.clubEvents.push = () => { throw Error('fixture-log-failed'); }; });
      if (scenario === 'account') await page.evaluate(() => { globalThis.clubScope = 'new-account'; });
      if (scenario === 'leave') await host.getByRole('button', { name: '返回集合', exact: true }).click();
      await page.evaluate(compute => {
        if (compute) {
          globalThis.clubPauseCompute = true;
          const now = performance.now.bind(performance); let tick = 0;
          performance.now = () => now() + (tick += 20);
        }
        globalThis.clubHold = false; globalThis.clubQuoteRelease();
      }, compute);
      if (compute) {
        await page.waitForFunction(() => globalThis.clubComputePaused);
        await page.evaluate(scenario => {
          if (scenario === 'compute-material') {
            const detail = structuredClone(globalThis.clubDetail); detail.progress.rows[0].collected = true;
            globalThis.clubSyncDetails = [detail]; globalThis.clubNotify();
          } else if (['compute-expiry', 'expiry-return', 'overview-expiry-return', 'notice-account'].includes(scenario)) globalThis.clubDetail.priceSnapshot.expiresAt = Date.now() - 1;
          else if (scenario === 'focus-compute') {
            globalThis.document.dispatchEvent(new Event('visibilitychange'));
            for (const tick of globalThis.clubTicks) if (tick.ms === 300000) { tick.callback(); tick.callback(); }
          }
        }, scenario);
        if (scenario === 'compute-same' || scenario === 'overview-compute') {
          await host.locator('#gallery-refresh').evaluate(button => button.click());
          await page.waitForFunction(() => globalThis.clubCalls === 2);
        }
        if (scenario === 'focus-compute') assert.equal(await page.evaluate(() => globalThis.clubCalls), 1);
        await page.evaluate(() => { globalThis.clubPauseCompute = false; globalThis.clubResumeCompute(); });
      }
      if (scenario === 'account' || scenario === 'leave') {
        await page.waitForFunction(() => globalThis.clubEvents.some(event => event.status === 'cancelled'));
        assert.equal(await host.locator('.gallery-plan-output').count(), scenario === 'account' ? 1 : 0);
        assert.doesNotMatch(await host.locator('#gallery-set-detail').innerText(), /找到 1 个候选方案/);
      } else {
        await page.waitForFunction(() => !globalThis.document.querySelector('#club-fixture').shadowRoot.querySelector('.gallery-plan .row button').disabled);
        const output = await host.locator(overview ? '.gallery-grade-overview' : '.gallery-plan-output').innerText();
        if (['rules', 'rules-return', 'tags', 'material', 'compute-material', 'compute-expiry', 'expiry-return', 'overview-expiry-return', 'notice-account'].includes(scenario)) {
          assert.match(await host.locator('.gallery-plan').innerText(), /更新|变化/);
          assert.ok((await page.evaluate(() => globalThis.clubEvents)).some(event => event.status === 'cancelled' && /CHANGED/.test(event.reason)));
          if (['compute-expiry', 'expiry-return'].includes(scenario)) assert.equal(await page.evaluate(() =>
            globalThis.clubEvents.find(event => event.status === 'cancelled').replayInput?.lineupSearch), true,
          'An interrupted computation must retain its sanitized-replay input as well');
        } else if (scenario.startsWith('cancel') || scenario.startsWith('error')) {
          assert.match(output, scenario.startsWith('cancel') ? /已取消/ : /失败|暂不可/);
          if (scenario.endsWith('-return')) {
            await page.evaluate(() => globalThis.document.dispatchEvent(new Event('visibilitychange')));
            await page.waitForFunction(() => globalThis.clubCalls === 2);
            await page.waitForFunction(() => !globalThis.document.querySelector('#club-fixture').shadowRoot.querySelector('#gallery-refresh').disabled);
            assert.match(await host.locator('.gallery-plan-output').innerText(), scenario.startsWith('cancel') ? /已取消/ : /失败|暂不可/);
          }
          await page.evaluate(() => { globalThis.clubQuoteError = false; });
          await host.getByRole('button', { name: '生成方案', exact: true }).click();
          await page.waitForFunction(() => !globalThis.document.querySelector('#club-fixture').shadowRoot.querySelector('.gallery-plan .row button').disabled);
          assert.match(await host.locator('.gallery-plan-output').innerText(), /找到 1 个候选方案/);
        } else assert.match(output, overview ? compute ? /1,000 金币/ : /200 金币/ : compute ? /找到 \d+ 个候选方案/ : /找到 1 个候选方案/, `${scenario}: refresh must not silently cancel planning`);
      }
      if (['focus-quotes', 'focus-compute', 'overview-focus', 'expiry-return', 'overview-expiry-return'].includes(scenario)) {
        if (scenario.includes('expiry')) await page.evaluate(() => globalThis.document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => globalThis.clubCalls === 2);
        await page.waitForFunction(() => !globalThis.document.querySelector('#club-fixture').shadowRoot.querySelector('#gallery-refresh').disabled);
        assert.equal(await page.evaluate(() => globalThis.clubCalls), 2, 'Coalesce repeated deferred checks into one refresh');
        assert.match(await host.locator(overview ? '.gallery-grade-overview' : '.gallery-plan-output').innerText(),
          scenario.includes('expiry') ? /报价已更新或到期/ : overview ? /200 金币/ : /找到 \d+ 个候选方案/,
          'Returning to the window must retain the result or terminal explanation');
        if (scenario === 'expiry-return') {
          assert.equal(await host.locator('.gallery-plan select').first().inputValue(), 'A', 'Keep the requested grade with its terminal explanation');
          await host.locator('.gallery-plan-output').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(directory, 'gallery-plan-return-notice-desktop.png') });
          await page.setViewportSize({ width: 390, height: 800 });
          await host.locator('.gallery-plan-output').scrollIntoViewIfNeeded();
          assert.equal(await host.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
          await page.screenshot({ path: path.join(directory, 'gallery-plan-return-notice-mobile.png') });
        }
        if (scenario === 'overview-expiry-return') {
          await host.getByRole('button', { name: '生成方案', exact: true }).click();
          await page.waitForFunction(() => !globalThis.document.querySelector('#club-fixture').shadowRoot.querySelector('.gallery-plan .row button').disabled);
          assert.match(await host.locator('.gallery-plan-output').innerText(), /找到 \d+ 个候选方案/);
          assert.equal(await host.locator('.gallery-plan-notice').count(), 0, 'A successful retry must not retain another mode\'s old error');
        }
      }
      if (scenario === 'rules-return') {
        await page.evaluate(() => globalThis.document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForFunction(() => globalThis.clubCalls === 3);
        await page.waitForFunction(() => !globalThis.document.querySelector('#club-fixture').shadowRoot.querySelector('#gallery-refresh').disabled);
        assert.match(await host.locator('.gallery-plan-output').innerText(), /更新|变化/);
      }
      if (scenario === 'notice-account') {
        await page.evaluate(() => {
          globalThis.clubScope = 'new-account'; globalThis.clubDetail.scope = 'new-account';
          globalThis.document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => globalThis.clubCalls === 2);
        await host.locator('#gallery-categories button').first().click();
        await host.locator('[data-set-id="futgg:30"]').getByRole('button', { name: '查看卡片', exact: true }).click();
        assert.doesNotMatch(await host.locator('.gallery-plan-output').innerText(), /报价已更新或到期/,
          'A different account must not inherit the interrupted plan notice');
      }
      if (scenario === 'same') {
        assert.equal(await page.evaluate(() => globalThis.clubQuoteCalls), 1, 'A same-content refresh must not restart quoting');
        await page.screenshot({ path: path.join(directory, 'gallery-plan-refresh-desktop.png') });
        await page.setViewportSize({ width: 390, height: 800 });
        assert.equal(await host.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
        await page.screenshot({ path: path.join(directory, 'gallery-plan-refresh-mobile.png') });
      }
      assert.equal(network, 0, 'Planning regression must have zero external requests');
      console.log(`Single club refresh scenario passed: ${scenario}`);
    } finally { await page.close(); }
  }
}
