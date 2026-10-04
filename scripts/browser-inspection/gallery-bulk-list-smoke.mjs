import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { priceTiers } from '../../tests/fixtures/enhancer-listing-price-reference.js';

// Trusted browser clicks with a synthetic service. No EA or price requests.
export async function exerciseGalleryBulkList(context) {
  const page = await context.newPage(), requests = [];
  page.on('request', request => requests.push(request.url()));
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    stdin: { contents: "export { mountFc27BulkListView } from './src/adapters/browser/fc27-bulk-list-view.js'; export { planGalleryListingPrices } from './src/gallery/listing-candidates.js';", resolveDir: path.resolve(import.meta.dirname, '../..') }, bundle: true, write: false,
    format: 'iife', globalName: 'BulkListSmoke', target: 'chrome120' });
  try {
    await page.setContent('<!doctype html><style>.fixture-ea-card{width:144px;height:100px;background:rgb(40,80,120)}</style><main></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(priceTiers => {
      const host = globalThis.document.querySelector('main'), shadow = host.attachShadow({ mode: 'open' });
      const candidates = Array.from({ length: 25 }, (_, index) => index + 11).map(id => ({ item: { id, definitionId: id + 100, pile: 'club' },
        name: `Player ${id}`, purchase: { tradeId: String(9000 + id) } }));
      const prices = Object.fromEntries(candidates.map(row => [row.item.definitionId, 1000]));
      const limits = Object.fromEntries(candidates.map(row => [row.item.id, { status: 'loaded', minimum: 150, maximum: 15000000 }]));
      globalThis.bulkCalls = []; globalThis.bulkCardCalls = []; globalThis.bulkDisposedCards = 0;
      globalThis.bulkSettings = { priceMode: 'fixed', fixedPrice: 200, fixedStartPrice: 150, durationSeconds: 3600, delaySeconds: [3, 5] };
      let planned;
      const service = {
        scheduleCapability: () => ({ enabled: false }),
        readSettings: async () => globalThis.bulkSettings,
        writeSettings: async value => { globalThis.bulkSettings = value; },
        prepare: async () => {
          if (globalThis.bulkMode === 'record-read') return { status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_JOURNAL_READ_FAILED' };
          if (globalThis.bulkMode === 'record-invalid') return { status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_JOURNAL_INVALID' };
          if (globalThis.bulkMode === 'prepare-error') throw Object.assign(new Error('FC27_GALLERY_LISTING_PRICE_LIMITS_UNAVAILABLE'), { phase: 'price-limits', httpStatus: 401 });
          return { status: 'ready', candidates, prices, priceTiers, liveEnabled: true };
        },
        readDisplayItem: item => item,
        plan: ({ selectedIds, settings, overridesByItem }) => (planned = globalThis.BulkListSmoke.planGalleryListingPrices({
          candidates: candidates.filter(row => selectedIds.includes(row.item.id)), settings, overridesByItem,
          marketPrices: prices, limitsByItem: limits, priceTiers, random: () => 0 })),
        execute: async args => {
          if (JSON.stringify(args.plan) !== JSON.stringify(planned)) throw new Error('changed plan');
          globalThis.bulkCalls.push({ plan: args.plan, settings: args.settings, approved: args.approved });
          if (globalThis.bulkMode === 'execute-error') throw Object.assign(new Error('FC27_GALLERY_LISTING_UNAVAILABLE'), { phase: 'execute', httpStatus: 429 });
          if (globalThis.bulkMode === 'unknown') return { status: 'partial', reason: 'FC27_GALLERY_LISTING_RESULT_UNKNOWN',
            entries: args.plan.entries.map((row, index) => ({ ...row, status: index ? 'pending' : 'unknown' })) };
          const entries = args.plan.entries.map((row, index) => ({ ...row, status: index ? 'rejected' : 'accepted' }));
          args.onProgress({ index: entries.length, total: entries.length, completed: entries.length, accepted: 1, rejected: entries.length - 1, skipped: 0, entries });
          return { status: 'completed', accepted: 1, entries };
        },
        inspect: async () => ({ status: 'observed', state: globalThis.bulkMode === 'unknown' ? 'active' : 'completed', runId: 'fixture-run' }), stop() {},
      };
      const nativeRenderer = { renderOwned({ parent, slot, raw }) {
        globalThis.bulkCardCalls.push({ host: parent === host, slot, id: raw.id });
        const card = globalThis.document.createElement('div'); card.className = 'fixture-ea-card'; card.textContent = `EA ${raw.id}`;
        if (slot) card.slot = slot;
        parent.append(card);
        card.__fcatDealloc = () => { globalThis.bulkDisposedCards++; card.remove(); };
        return card;
      } };
      globalThis.bulkView = globalThis.BulkListSmoke.mountFc27BulkListView({ document: globalThis.document,
        parent: shadow, host, nativeRenderer, service, accountScope: () => 'account-fixture' });
      return globalThis.bulkView.open();
    }, priceTiers);
    assert.equal(await page.locator('#gallery-listing-schedule').isVisible(), false);
    await page.getByRole('button', { name: '卡片视图', exact: true }).click();
    assert.equal(await page.locator('tbody tr').first().isVisible(), true, 'card mode must show the selected player rows');
    const assertCards = async ids => {
      assert.deepEqual(await page.locator('.fixture-ea-card').evaluateAll(cards => cards.map(card => ({
        id: Number(card.textContent.slice(3)), projected: card.assignedSlot?.isConnected === true,
        styled: globalThis.getComputedStyle(card).backgroundColor === 'rgb(40, 80, 120)',
      }))), ids.map(id => ({ id, projected: true, styled: true })));
      assert.equal(await page.evaluate(() => globalThis.bulkCardCalls.every(call => call.host && call.slot)), true);
    };
    await assertCards(Array.from({ length: 10 }, (_, i) => i + 11));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await assertCards(Array.from({ length: 10 }, (_, i) => i + 21));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await assertCards([31, 32, 33, 34, 35]);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await assertCards(Array.from({ length: 10 }, (_, i) => i + 21));
    await page.getByRole('button', { name: '表格视图', exact: true }).click();
    await assertCards([]);
    assert.equal(await page.locator('tbody tr:visible').count(), 25);
    await page.getByRole('button', { name: '卡片视图', exact: true }).click();
    await assertCards(Array.from({ length: 10 }, (_, i) => i + 21));
    await page.getByRole('button', { name: 'Percentage', exact: true }).click();
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '1000');
    assert.match(await page.locator('tbody tr').nth(10).textContent(), /950 → 1000/);
    await page.getByRole('button', { name: 'Steps', exact: true }).click();
    await page.getByLabel('价格档位', { exact: true }).fill('1');
    await page.getByLabel('时长', { exact: true }).click();
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '1100');
    assert.match(await page.locator('tbody tr').nth(10).textContent(), /1000 → 1100/);
    await page.getByRole('button', { name: 'Fixed', exact: true }).click();
    assert.equal(await page.getByLabel('Buy Now', { exact: true }).inputValue(), '200');
    assert.equal(await page.getByLabel('Start Bid', { exact: true }).inputValue(), '150');
    await page.getByLabel('Buy Now', { exact: true }).fill('300');
    await page.getByLabel('Start Bid', { exact: true }).click();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await assertCards([]);
    await page.evaluate(() => globalThis.bulkView.open());
    assert.equal(await page.getByLabel('Buy Now', { exact: true }).inputValue(), '300');
    await assertCards(Array.from({ length: 10 }, (_, i) => i + 11));
    await page.getByRole('button', { name: '挂牌 25 张', exact: true }).click();
    await page.waitForFunction(() => globalThis.document.querySelector('main').shadowRoot.querySelector('dialog output').textContent.includes('挂牌部分完成'));
    await assertCards([]);
    assert.equal(await page.locator('tbody tr').count(), 25);
    assert.match(await page.locator('tbody tr').nth(0).textContent(), /已挂牌/);
    assert.match(await page.locator('tbody tr').nth(1).textContent(), /失败/);
    assert.match(await page.locator('dialog output').first().textContent(), /挂牌部分完成 · 已挂牌 1 · 失败 24 · 跳过 0/);
    assert.equal(await page.getByRole('button', { name: '已完成', exact: true }).isDisabled(), true);
    const calls = await page.evaluate(() => globalThis.bulkCalls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].approved, true);
    assert.deepEqual(calls[0].plan.entries.map(row => row.buyNow), Array(25).fill(300));
    assert.equal(await page.evaluate(() => globalThis.bulkDisposedCards === globalThis.bulkCardCalls.length), true);
    for (const mode of ['unknown', 'execute-error', 'prepare-error']) {
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.evaluate(mode => { globalThis.bulkMode = mode; return globalThis.bulkView.open(); }, mode);
      if (mode !== 'prepare-error') await page.getByRole('button', { name: '挂牌 25 张', exact: true }).click();
      const message = await page.locator('dialog output').first().textContent();
      if (mode === 'unknown') {
        assert.match(message, /待处理 25.*未知回执/);
        assert.equal(await page.getByRole('button', { name: '核对并继续', exact: true }).isEnabled(), true);
      } else if (mode === 'execute-error') assert.match(message, /FC27_GALLERY_LISTING_UNAVAILABLE.*execute.*HTTP 429/);
      else {
        assert.match(message, /未发送挂牌请求.*FC27_GALLERY_LISTING_PRICE_LIMITS_UNAVAILABLE.*price-limits.*HTTP 401/);
        assert.equal(await page.getByRole('button', { name: '挂牌选中卡', exact: true }).isDisabled(), true);
      }
    }
    assert.deepEqual(requests, []);
    for (const mode of ['record-read', 'record-invalid']) {
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      const before = await page.evaluate(() => globalThis.bulkCalls.length);
      await page.evaluate(mode => { globalThis.bulkMode = mode; return globalThis.bulkView.open(); }, mode);
      assert.match(await page.locator('dialog output').first().textContent(), mode === 'record-read' ? /读取旧挂牌记录失败/ : /旧挂牌记录格式异常/);
      assert.equal(await page.getByRole('button', { name: '挂牌选中卡', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => globalThis.bulkCalls.length), before);
    }
    console.log('Offline Bulk List smoke passed: 25 cards / 3 pages, native slots/cleanup, three pricing modes with real planner, reopen, trusted single execution, per-card results, no requests.');
  } finally { await page.close(); }
}
