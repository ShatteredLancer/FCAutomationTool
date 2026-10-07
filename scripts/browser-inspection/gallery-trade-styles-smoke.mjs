import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { priceTiers } from '../../tests/fixtures/enhancer-listing-price-reference.js';
import { fc27WorkbenchMarkup } from '../../src/adapters/browser/fc27-workbench-view.js';

// All trade services are synthetic. Trusted clicks never reach EA.
export async function exerciseGalleryTradeStyles(context, directory = null) {
  const page = await context.newPage();
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({ stdin: { contents: `
    export { mountFc27BulkListView } from './src/adapters/browser/fc27-bulk-list-view.js';
    export { mountFc27FodderBuyView } from './src/adapters/browser/fc27-fodder-buy-view.js';
    export { mountFc27FodderListView } from './src/adapters/browser/fc27-fodder-list-view.js';
    export { mountGalleryTradeSettings } from './src/adapters/browser/fc27-gallery-trade-settings.js';
    export { planFodderListings } from './src/gallery/fodder-trade-options.js';
    export { planGalleryListingPrices } from './src/gallery/listing-candidates.js';
    `, resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'TradeStyleSmoke', target: 'chrome120' });
  try {
    await page.setContent('<!doctype html><main></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ priceTiers, markup }) => {
      const document = globalThis.document, host = document.querySelector('main'), parent = host.attachShadow({ mode: 'open' });
      host.style.display = 'block';
      const template = document.createElement('template'); template.innerHTML = markup;
      parent.append(...template.content.querySelectorAll('style'));
      const api = globalThis.TradeStyleSmoke;
      globalThis.styleAccount = 'a'; globalThis.styleCalls = [];
      const scope = () => globalThis.styleAccount;
      let preferences = { destination: 'club', style: 'enhancer' };
      const settings = api.mountGalleryTradeSettings({ document, parent, service: {
        scope, read: async () => preferences, save: async value => { preferences = value; globalThis.savedStylePreferences = value; },
      } });
      settings.refresh();
      const candidates = Array.from({ length: 30 }, (_, i) => ({ item: { id: i + 1, definitionId: i < 2 ? 100 : i + 100, pile: 'club' }, name: `Player ${i + 1}`, boughtFor: 200, purchase: { tradeId: String(900 + i) } }));
      const prices = Object.fromEntries(candidates.map(row => [row.item.definitionId, 600]));
      const limitsByItem = Object.fromEntries(candidates.map(row => [row.item.id, { status: 'loaded', minimum: 150, maximum: 10000 }]));
      const service = {
        readSettings: async () => ({ durationSeconds: 3600, priceMode: 'fixed', fixedPrice: 600, fixedStartPrice: 550, delaySeconds: [3,5] }),
        writeSettings: async () => {}, scheduleCapability: () => ({ enabled: false }),
        prepare: async () => ({ status: 'ready', candidates, prices, priceTiers, limitsByItem, liveEnabled: true, source: 'FUT.GG', expiresAt: Date.now() + 60000 }),
        readDisplayItem: item => ({ ...item, rating: 72, rareflag: 0 }),
        plan: args => api.planGalleryListingPrices({ candidates: candidates.filter(row => args.selectedIds.includes(row.item.id)), marketPrices: prices, priceTiers, limitsByItem, ...args }),
        planFodder: args => api.planFodderListings({ candidates, prices, priceTiers, limitsByItem, ...args }),
        planTransfer: ({ selectedIds }) => ({ status: 'observed', entries: candidates.filter(row => selectedIds.includes(row.item.id)).map(row => ({ ...row, action: 'transfer' })) }),
        refreshQuotes: async () => { if (globalThis.quoteFailure) throw Error('FC27_GALLERY_QUOTES_UNAVAILABLE'); return { prices, expiresAt: Date.now() + 60000 }; },
        execute: async args => { globalThis.styleCalls.push({ action: 'list', plan: args.plan }); return { status: 'completed', completed: args.plan.entries.length, total: args.plan.entries.length, accepted: args.plan.entries.length, entries: args.plan.entries.map(row => ({ ...row, status: 'accepted' })) }; },
        inspect: async () => ({ status: 'observed', state: 'completed' }), stop() {},
      };
      const purchase = async args => {
        if (args.resume) {
          globalThis.lastStyleRetry = args.retry;
          if (globalThis.retryThrows) throw Error('FC27_TEST_RETRY_FAILED');
          args.onProgress({ ...globalThis.retryFixture, phase: 'buying', definitionId: 101 });
          await new Promise(resolve => { globalThis.releasePurchase = resolve; });
          // The session exception path has only thin item results; inspect
          // must supply durable attempt/price details for the result editor.
          return { ...globalThis.retryFixture, results: globalThis.retryFixture.results.map(({ reference, attempt, ...row }) => row) };
        }
        globalThis.styleCalls.push({ action: 'buy', options: args.batchOptions });
        if (globalThis.holdPurchase) await new Promise(resolve => { globalThis.releasePurchase = resolve; });
        const result = { status: 'purchased', total: args.items.length, completed: args.items.length, purchased: args.items.length, spent: args.items.length * 200,
          results: args.items.map(item => ({ definitionId: item.definitionId, name: item.name, state: 'unassigned', price: 200 })) };
        args.onProgress(result); return result;
      };
      purchase.preview = async items => ({ items: items.map(row => ({ ...row, priceReference: { estimate: 200 } })), destination: 'unassigned', priceTiers,
        approval: { policy: { source: 'futgg', purchaseAttempts: 3 }, rows: items.map(row => ({ definitionId: row.definitionId, estimate: 200, maxBuy: 200 })) } });
      purchase.inspect = async () => globalThis.retryFixture ?? ({ operationId: 'test-buy' }); purchase.stop = () => { globalThis.stoppedStylePurchase = true; globalThis.releasePurchase?.(); };
      globalThis.enhancerStyle = api.mountFc27BulkListView({ document, parent, host, service, accountScope: scope });
      globalThis.createFodderStyles = () => {
        globalThis.fodderListStyle = api.mountFc27FodderListView({ document, parent, service, accountScope: scope });
        globalThis.fodderBuyStyle = api.mountFc27FodderBuyView({ document, parent, purchase, accountScope: scope });
      };
      globalThis.buyStyleInput = { items: Array.from({ length: 30 }, (_, i) => ({ definitionId: i + 100, name: `Player ${i}`, overall: 72 })), binding: 'fixture' };
    }, { priceTiers, markup: fc27WorkbenchMarkup() });
    await page.getByLabel('Gallery 购卡去向', { exact: true }).selectOption('unassigned');
    await page.getByLabel('Gallery 购买 / 挂牌风格', { exact: true }).selectOption('fodder');
    await page.getByRole('button', { name: '保存 Gallery 交易设置', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => globalThis.savedStylePreferences), { destination: 'unassigned', style: 'fodder' });
    await page.evaluate(() => globalThis.enhancerStyle.open());
    const enhancer = page.locator('#gallery-bulk-list-dialog');
    const appearance = () => enhancer.evaluate(node => { const style = globalThis.getComputedStyle(node); return [style.width, style.backgroundColor, style.borderRadius, style.fontSize]; });
    const original = await appearance();
    await enhancer.evaluate(node => node.close());
    await page.evaluate(() => globalThis.createFodderStyles());
    await page.evaluate(() => globalThis.fodderListStyle.open());
    const listing = page.locator('#gallery-fodder-list-dialog');
    assert.equal(await listing.locator('.fd-row').count(), 31);
    const footerVisible = dialog => dialog.locator('footer').evaluate(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= globalThis.innerHeight; });
    assert.equal(await footerVisible(listing), true);
    const firstPrice = listing.getByRole('spinbutton', { name: 'Player 1 Buy Now', exact: true });
    assert.equal(await firstPrice.inputValue(), '600');
    await listing.getByRole('button', { name: '+10%', exact: true }).click();
    assert.equal(await firstPrice.inputValue(), '650');
    await listing.getByRole('button', { name: 'Player 1 Buy Now 增加', exact: true }).click();
    assert.equal(await firstPrice.inputValue(), '700');
    assert.equal(await listing.getByRole('spinbutton', { name: 'Player 2 Buy Now', exact: true }).inputValue(), '700');
    await listing.getByRole('button', { name: 'Bought for', exact: true }).click();
    assert.equal(await listing.getByRole('spinbutton', { name: 'Player 3 Buy Now', exact: true }).inputValue(), '200');
    await page.evaluate(() => { globalThis.quoteFailure = true; });
    await listing.getByRole('button', { name: 'Check market prices', exact: true }).click();
    assert.match(await listing.getByRole('status').innerText(), /QUOTES_UNAVAILABLE/);
    if (directory) await page.screenshot({ path: path.join(directory, 'gallery-fodder-list.png') });
    await listing.getByRole('button', { name: 'Send to Transfer List', exact: true }).click();
    assert.equal(await listing.getByRole('button', { name: 'Completed', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => globalThis.styleCalls[0].plan.entries.every(row => row.action === 'transfer')), true);
    await listing.getByRole('button', { name: 'Close Esc', exact: true }).click();
    await page.evaluate(() => globalThis.enhancerStyle.open());
    assert.deepEqual(await appearance(), original, 'Fodder CSS must not change Enhancer appearance');
    await enhancer.evaluate(node => node.close());
    await page.evaluate(() => globalThis.fodderBuyStyle.open(globalThis.buyStyleInput));
    const buy = page.locator('#gallery-fodder-buy-dialog');
    assert.equal(await footerVisible(buy), true);
    await buy.getByLabel('Highest price %', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await buy.getByLabel('Highest price %', { exact: true }).inputValue(), '105');
    await buy.getByRole('button', { name: '2', exact: true }).click();
    if (directory) await page.screenshot({ path: path.join(directory, 'gallery-fodder-buy.png') });
    await page.evaluate(() => { globalThis.holdPurchase = true; });
    await buy.getByRole('button', { name: 'Auto-buy 30 players Enter', exact: true }).click();
    await buy.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForFunction(() => globalThis.stoppedStylePurchase);
    assert.deepEqual(await page.evaluate(() => globalThis.styleCalls[1].options), { minPct: 100, maxPct: 105, tries: 2 });
    await buy.getByRole('button', { name: 'Close Esc', exact: true }).click();
    await page.evaluate(({ priceTiers }) => {
      const policy = { source: 'futgg', purchaseAttempts: 3 };
      const reference = { estimate: 400, maxBuy: 400, policy,
        quotes: { futgg: { price: 400, fetchedAt: Date.now(), expiresAt: Date.now() + 60000 } } };
      globalThis.retryFixture = { status: 'partial', operationId: 'test-retry', total: 2, completed: 1, purchased: 1, spent: 200,
        results: [{ definitionId: 100, name: 'Bought player', state: 'unassigned', price: 200 },
          { definitionId: 101, name: 'Failed player', state: 'waiting', reference, attempt: { failed: true } }],
        retryContext: { operationId: 'test-retry', key: 'fixture', balance: 5000, absoluteCap: 5000, priceTiers, policy } };
      return globalThis.fodderBuyStyle.open({ resume: true });
    }, { priceTiers });
    await buy.locator('.fd-retry-row input[type=number]').fill('450');
    await buy.getByRole('button', { name: 'Retry selected (1)', exact: true }).click();
    assert.equal(await buy.locator('.fd-buy-layout').isVisible(), true, 'retry must return to the Fodder purchase progress screen');
    assert.match(await buy.locator('.fd-buy-layout').innerText(), /Failed player/);
    assert.equal(await buy.locator('progress').filter({ visible: true }).count(), 1);
    assert.equal(await buy.locator('.fd-retry-row input[type=number]').inputValue(), '450');
    assert.equal(await buy.locator('.fd-retry-row input[type=number]').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => globalThis.lastStyleRetry.items), [{ definitionId: 101, maxBuy: 450 }]);
    if (directory) await page.screenshot({ path: path.join(directory, 'gallery-fodder-retry-progress.png') });
    await buy.getByRole('button', { name: 'Stop', exact: true }).click();
    await buy.getByRole('button', { name: 'Retry selected (1)', exact: true }).waitFor();
    assert.equal(await buy.locator('.fd-retry-row input[type=number]').inputValue(), '400', 'inspect restores the durable price after a thin response');
    await page.evaluate(() => { globalThis.retryThrows = true; });
    await buy.getByRole('button', { name: 'Retry selected (1)', exact: true }).click();
    await page.waitForFunction(() => globalThis.document.querySelector('main').shadowRoot.querySelector('.fd-retry-error')?.textContent.includes('FC27_TEST_RETRY_FAILED'));
    assert.equal(await buy.locator('.fd-retry-screen').isVisible(), true);
    await buy.getByRole('button', { name: 'Close Esc', exact: true }).click();
    await page.evaluate(() => {
      globalThis.retryThrows = false;
      globalThis.retryFixture.results[1].attempt = { failed: false, used: 0 };
      return globalThis.fodderBuyStyle.open({ resume: true });
    });
    assert.equal(await buy.getByRole('button', { name: 'Refresh prices', exact: true }).isDisabled(), true);
    await buy.getByRole('button', { name: 'Continue pending (1)', exact: true }).click();
    assert.equal(await buy.locator('.fd-buy-layout').isVisible(), true);
    assert.equal(await page.evaluate(() => globalThis.lastStyleRetry), undefined, 'continue must preserve the existing grant, not create a retry grant');
    await buy.getByRole('button', { name: 'Stop', exact: true }).click();
    await buy.getByRole('button', { name: 'Close Esc', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => globalThis.fodderListStyle.open());
    assert.equal(await footerVisible(listing), true);
    assert.equal(await listing.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    await listing.getByRole('button', { name: 'Cancel Esc', exact: true }).click();
    await page.evaluate(() => globalThis.fodderBuyStyle.open(globalThis.buyStyleInput));
    assert.equal(await footerVisible(buy), true);
    assert.equal(await buy.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    console.log('Gallery trade styles smoke passed: separate UIs, settings, prices, transfer-only, stop, long/narrow layout.');
  } finally { await page.close(); }
}
