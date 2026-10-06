import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function exercisePurchaseResults(context, directory) {
  const bundle = await build({ absWorkingDir: directory, entryPoints: ['src/adapters/browser/fc27-purchase-results.js'],
    bundle: true, write: false, format: 'iife', globalName: 'ResultsSmoke', target: 'chrome120' });
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><body style="background:#202724;color:white;margin:12px"><main></main></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const now = Date.now(), policy = { source: 'futgg', premiumMode: 'fixed', premium: 0, purchaseAttempts: 3 };
      const reference = id => ({ definitionId: id, season: '27', platform: 'pc', policy, maxBuy: 200,
        quotes: Object.fromEntries(['futgg','futbin'].map(source => [source, { schema: 2, source, definitionId: id, season: '27', platform: 'pc',
          price: source === 'futgg' ? 200 : 250, fetchedAt: now, expiresAt: now + 300000, sourceUpdatedAt: null, error: null }])) });
      globalThis.retries = []; globalThis.refreshes = []; globalThis.resumes = 0; globalThis.resultsCurrent = true;
      globalThis.resultFixture = { status: 'partial', spent: 200,
        retryContext: { operationId: 'one', key: 'key', policy, balance: 1000, remainingBudget: 1000,
          priceTiers: [{ min: 100000, inc: 1000 }, { min: 50000, inc: 500 }, { min: 10000, inc: 250 }, { min: 1000, inc: 100 }, { min: 150, inc: 50 }, { min: 0, inc: 150 }] },
        results: [{ definitionId: 1, state: 'club', price: 200, name: 'Succeeded' },
          ...[2,3].map(definitionId => ({ definitionId, state: 'waiting', name: 'Failed player', reference: reference(definitionId),
            reason: 'FC27_BUY_NO_LISTING', attempt: { used: 3, limit: 3, total: 3, round: 1, failed: true } }))] };
      globalThis.resultsUI = globalThis.ResultsSmoke.mountFc27PurchaseResults({ document: globalThis.document, parent: globalThis.document.querySelector('main'),
        isCurrent: () => globalThis.resultsCurrent,
        retry: value => { globalThis.retries.push(value); return new Promise(resolve => { globalThis.finishRetry = resolve; }); },
        resume: () => { globalThis.resumes++; },
        refreshPrices: async ids => { globalThis.refreshes.push(ids); const refs = Object.fromEntries(ids.map(id => [id, reference(id)]));
          for (const ref of Object.values(refs)) ref.quotes.futgg.price = 250;
          return { references: refs, policy }; } });
      globalThis.resultsUI.show(globalThis.resultFixture);
    });
    const row = id => page.locator(`[data-definition-id="${id}"]`);
    assert.equal(await page.locator('input[type=checkbox]:checked').count(), 2);
    assert.equal(await row(1).isVisible(), false);
    const retryPrice = row(2).locator('input[type=number]');
    const increase = row(2).getByRole('button', { name: /增加$/ });
    await increase.click();
    assert.equal(await retryPrice.inputValue(), '250');
    assert.equal(await row(3).locator('input[type=number]').inputValue(), '200');
    await retryPrice.fill('950'); await increase.click();
    assert.equal(await retryPrice.inputValue(), '1000');
    await increase.click(); // Account balance caps arrows; typed input is still validated.
    assert.equal(await retryPrice.inputValue(), '1000');
    await retryPrice.press('ArrowDown');
    assert.equal(await retryPrice.inputValue(), '950');
    await retryPrice.fill('200'); await increase.scrollIntoViewIfNeeded();
    const arrowBox = await increase.boundingBox();
    await page.mouse.move(arrowBox.x + arrowBox.width / 2, arrowBox.y + arrowBox.height / 2);
    await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(await retryPrice.inputValue(), '250', 'hold and release produce only one step');
    await retryPrice.fill('275'); await increase.click();
    assert.equal(await retryPrice.inputValue(), '300', 'unrounded buy cap moves once');
    assert.equal(await page.evaluate(() => globalThis.retries.length), 0);
    await row(2).locator('input[type=number]').fill('300');
    await page.getByRole('button', { name: '刷新参考价', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => globalThis.refreshes), [[2,3]]);
    assert.equal(await row(2).locator('input[type=number]').inputValue(), '300');
    await row(3).locator('input[type=checkbox]').uncheck();
    await page.getByLabel('批量溢价').fill('100');
    await page.getByRole('button', { name: '应用到所选卡', exact: true }).click();
    assert.equal(await row(2).locator('input[type=number]').inputValue(), '350');
    await page.getByLabel('批量溢价').fill('100');
    await page.getByRole('button', { name: '应用到所选卡', exact: true }).click();
    assert.equal(await row(2).locator('input[type=number]').inputValue(), '350', 'no compounding');
    await row(2).locator('input[type=number]').fill('275');
    assert.equal(await page.getByRole('button', { name: /重试所选/ }).isDisabled(), true);
    await row(2).locator('input[type=number]').fill('1500');
    assert.equal(await page.getByRole('button', { name: /重试所选/ }).isDisabled(), true);
    await row(2).locator('input[type=number]').fill('300');
    await page.getByRole('button', { name: /重试所选/ }).evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.retries.length), 0);
    await page.getByRole('button', { name: /重试所选/ }).click();
    assert.equal(await page.evaluate(() => globalThis.retries.length), 1);
    assert.deepEqual(await page.evaluate(() => globalThis.retries[0].items), [{ definitionId: 2, maxBuy: 300 }]);
    assert.equal(await page.getByRole('button', { name: /重试所选/ }).isDisabled(), true);
    await page.evaluate(() => globalThis.finishRetry());
    await page.waitForFunction(() => ![...globalThis.document.querySelectorAll('button')].find(n => n.textContent.startsWith('重试所选')).disabled);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    for (const state of ['buy-pending','bought','move-pending','move-rejected']) {
      await page.evaluate(state => {
        const value = structuredClone(globalThis.resultFixture); value.results[0].state = state;
        globalThis.resultsUI.show(value);
      }, state);
      assert.equal(await page.getByRole('button', { name: /重试所选/ }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '核对并继续', exact: true }).isVisible(), true);
    }
    await page.evaluate(() => {
      const value = structuredClone(globalThis.resultFixture); value.results[1].attempt = null;
      globalThis.resultsUI.show(value); globalThis.resultsCurrent = false;
    });
    await page.getByRole('button', { name: '继续未处理', exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.resumes), 0);
    const fixture = await page.evaluate(() => globalThis.resultFixture);
    await exercisePurchaseSurfaces(context, directory, fixture);
    console.log('Purchase results smoke passed: selected-only cap edits, quote refresh, non-compounding, budget/tiers, trusted click, recovery, narrow layout.');
  } finally { await page.close(); }
}

async function exercisePurchaseSurfaces(context, directory, fixture) {
  for (const kind of ['gallery', 'puzzle']) {
    const entry = kind === 'gallery' ? 'fc27-acceptance-panel' : 'fc27-puzzle-buy-button';
    const bundle = await build({ absWorkingDir: directory, entryPoints: [`src/adapters/browser/${entry}.js`],
      bundle: true, write: false, format: 'iife', globalName: 'SurfaceSmoke', target: 'chrome120' });
    const page = await context.newPage();
    try {
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><body><div id="requirements"></div><button id="exchange">Exchange</button></body>');
      // SBC lives in EA's light DOM; Gallery lives inside the Workbench shadow.
      // Global native defaults must not change the shared dialog geometry.
      await page.addStyleTag({ content: 'dialog{margin:0;font:11px serif}button{display:block;margin:16px}label{margin:12px 0}small{font-size:10px}' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ kind, fixture }) => {
        const doc = globalThis.document;
        globalThis.surfaceBuys = []; globalThis.surfaceStops = 0;
        const observed = { ...fixture, status: kind === 'gallery' ? 'observed' : 'ready', operationId: 'one', remaining: 2,
          completed: false, purchased: 1, total: 3, recovery: false };
        const refreshPrices = async () => ({ policy: fixture.retryContext.policy,
          references: Object.fromEntries(fixture.results.filter(row => row.reference).map(row => [row.definitionId, row.reference])) });
        const run = (approval, callbacks) => {
          globalThis.surfaceBuys.push(approval);
          callbacks.onProgress({ ...fixture, phase: 'moving', definitionId: 2, purchased: 2, completed: 1, index: 2, total: 7,
            results: [fixture.results[0], { ...fixture.results[1], state: 'move-pending', price: 250, reason: null,
              reference: { ...fixture.results[1].reference, maxBuy: 300 } },
              { ...fixture.results[2], attempt: null, name: '', reason: null },
              ...[4,5,6,7].map(definitionId => ({ definitionId, state: 'waiting', name: 'Waiting player' }))] });
          return new Promise(resolve => { globalThis.finishSurface = () => resolve({ ...fixture,
            purchased: 2, spent: 450, results: fixture.results.map(row => row.definitionId === 2 ? { ...row, state: 'club', price: 250 } : row) }); });
        };
        if (kind === 'puzzle') {
          globalThis.SurfaceSmoke.mountFc27PuzzleBuyButton({ document: doc, wait: async () => {}, refreshPrices,
            readPlayerName: id => id === 3 ? 'Cached player' : null,
            readTarget: () => ({ setId: 4, challengeId: 16, squadSignature: 'concept', anchor: doc.getElementById('exchange'),
              purchaseAnchor: doc.getElementById('requirements') }), inspect: async () => observed,
            buy: (_target, approval, callbacks) => run(approval, callbacks), stop: () => { globalThis.surfaceStops++; } });
        } else {
          const attach = globalThis.Element.prototype.attachShadow;
          globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
          const purchase = args => run(args, args); purchase.inspect = async () => observed;
          purchase.refreshPrices = refreshPrices; purchase.stop = () => { globalThis.surfaceStops++; };
          const panel = globalThis.SurfaceSmoke.mountFc27AcceptancePanel({ document: doc, hostId: 'purchase-surface', targets: () => [],
            galleryAccountScope: () => 'account', purchaseGallery: purchase,
            galleryCatalog: { peek: async () => null, load: async () => ({ status: 'blocked', reason: 'FC27_GALLERY_UNAVAILABLE' }) } });
          panel.open();
        }
      }, { kind, fixture });
      let dialog;
      if (kind === 'gallery') {
        const host = page.locator('#purchase-surface'); await host.locator('#tab-gallery').click();
        await host.locator('#gallery-purchase-resume').click(); dialog = host.locator('#gallery-purchase-dialog');
      } else {
        await page.locator('#fcat-fc27-puzzle-buy').getByRole('button', { name: /查看购买结果/ }).click();
        dialog = page.locator('#fcat-puzzle-purchase-dialog');
      }
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await dialog.evaluate(node => node.classList.contains('fcat-purchase-dialog')), true, 'both entry points use the shared window');
      assert.equal(await dialog.getByRole('progressbar', { name: '购买处理进度' }).count(), 1);
      const header = dialog.locator('.purchase-dialog-header');
      const aligned = await header.evaluate(node => {
        const title = node.querySelector('strong').getBoundingClientRect();
        const button = [...node.querySelectorAll('button')].find(item => !item.hidden).getBoundingClientRect();
        return Math.abs(title.y + title.height / 2 - button.y - button.height / 2) < 2;
      });
      assert.equal(aligned, true, 'title and action share one aligned header');
      assert.equal(await dialog.locator('.purchase-quote-details[open]').count(), 0, 'quote diagnostics start collapsed');
      assert.equal(await page.evaluate(() => globalThis.surfaceBuys.length), 0, 'opening results cannot buy');
      await dialog.locator('[data-definition-id="3"] input[type=checkbox]').uncheck();
      const retryInput = dialog.locator('[data-definition-id="2"] input[type=number]');
      await retryInput.fill('250');
      await dialog.locator('[data-definition-id="2"]').getByRole('button', { name: /增加$/ }).click();
      assert.equal(await retryInput.inputValue(), '300');
      const sizes = await dialog.locator('[data-definition-id="2"] .listing-currency').evaluate(node => ({
        input: node.querySelector('input').getBoundingClientRect().height,
        arrows: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height),
      }));
      assert.deepEqual(sizes, { input: 40, arrows: [20,20] });
      await dialog.getByRole('button', { name: /重试所选/ }).click();
      await page.waitForFunction(() => globalThis.surfaceBuys.length === 1);
      assert.deepEqual(await page.evaluate(() => globalThis.surfaceBuys[0].retry.items), [{ definitionId: 2, maxBuy: 300 }]);
      assert.equal(await dialog.locator('[data-definition-id]').count(), 7, 'complete foreground list while purchasing');
      assert.equal(await dialog.getByRole('progressbar').evaluate(node => node.value), 1);
      assert.equal(await dialog.getByRole('progressbar').evaluate(node => node.max), 7);
      assert.equal(await dialog.locator('[data-definition-id="2"] .purchase-state').innerText(), '入库中');
      assert.equal(await dialog.locator('[data-active=true]').count(), 1);
      assert.equal(await dialog.locator('.purchase-dialog-results').evaluate(node => node.scrollTop), 0, 'new batch starts at the list header');
      assert.equal(await dialog.locator('[data-definition-id="3"] strong').innerText(), kind === 'puzzle' ? 'Cached player' : '球员 #3');
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        const compact = await dialog.locator('[data-definition-id="3"]').evaluate(node => {
          const name = node.querySelector('strong').getBoundingClientRect(), price = node.querySelector('.purchase-price').getBoundingClientRect();
          return { height: node.getBoundingClientRect().height, sameLine: Math.abs(name.y - price.y) < 4 };
        });
        assert.ok(compact.height < 90, `compact pending row at ${width}px: ${compact.height}`);
        if (width === 1280) assert.equal(compact.sameLine, true, 'name/status/price share the desktop row');
        const geometry = await dialog.evaluate(node => {
          const rect = node.getBoundingClientRect(), header = node.querySelector('.purchase-dialog-header').getBoundingClientRect();
          return { centered: Math.abs(rect.x + rect.width / 2 - globalThis.innerWidth / 2) < 2,
            contained: rect.x >= 0 && rect.right <= globalThis.innerWidth && rect.y >= 0 && rect.bottom <= globalThis.innerHeight,
            noHorizontalScroll: node.scrollWidth <= node.clientWidth, headerVisible: header.y >= rect.y && header.bottom <= rect.bottom };
        });
        assert.deepEqual(geometry, { centered: true, contained: true, noHorizontalScroll: true, headerVisible: true });
        await page.screenshot({ path: path.join(directory, `artifacts/fc27-browser/${kind}-purchase-window-${width}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      const stop = kind === 'gallery' ? dialog.locator('#gallery-purchase-stop') : dialog.getByRole('button', { name: '停止购买' });
      await stop.click(); assert.equal(await page.evaluate(() => globalThis.surfaceStops), 1);
      await page.evaluate(() => globalThis.finishSurface());
      await dialog.locator('.purchase-completed summary').first().waitFor();
      assert.match(await dialog.locator('.purchase-completed summary').first().innerText(), /已完成 2 张/);
      assert.equal(await dialog.locator('input[type=checkbox]').count(), 1);
      console.log(`${kind} retry surface passed: journal review, one trusted selected retry, foreground list, stop, retained result.`);
    } finally { await page.close(); }
  }
}
