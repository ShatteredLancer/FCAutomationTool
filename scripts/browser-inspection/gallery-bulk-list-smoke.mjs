import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { priceTiers } from '../../tests/fixtures/enhancer-listing-price-reference.js';
import { fc27WorkbenchMarkup } from '../../src/adapters/browser/fc27-workbench-view.js';

// Trusted browser clicks with a synthetic service. No EA or price requests.
export async function exerciseGalleryBulkList(context, previewPath = null, { scheduleEnabled = false } = {}) {
  const page = await context.newPage(), requests = [];
  page.on('request', request => requests.push(request.url()));
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    stdin: { contents: "export { mountFc27BulkListView } from './src/adapters/browser/fc27-bulk-list-view.js'; export { planGalleryListingPrices } from './src/gallery/listing-candidates.js';", resolveDir: path.resolve(import.meta.dirname, '../..') }, bundle: true, write: false,
    format: 'iife', globalName: 'BulkListSmoke', target: 'chrome120' });
  try {
    await page.setContent('<!doctype html><style>.fixture-ea-card{width:144px;height:100px;background:rgb(40,80,120)}</style><main></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ priceTiers, workbenchMarkup, scheduleEnabled }) => {
      const host = globalThis.document.querySelector('main'), shadow = host.attachShadow({ mode: 'open' });
      // Keep the real container's generic button/input rules: isolated styles
      // previously hid the 40px minimum-height regression on both chevrons.
      const template = globalThis.document.createElement('template');
      template.innerHTML = workbenchMarkup;
      shadow.append(...template.content.querySelectorAll('style'));
      host.style.display = 'block';
      const candidates = Array.from({ length: 25 }, (_, index) => index + 11).map(id => ({ item: { id, definitionId: id + 100, pile: 'club' },
        name: `Player ${id}`, purchase: { tradeId: String(9000 + id) } }));
      Object.assign(candidates[0], { boughtFor: 150, boughtForSource: 'ea', purchase: null });
      Object.assign(candidates[1], { boughtFor: null, boughtForSource: 'first-owner', purchase: null });
      Object.assign(candidates[2], { boughtFor: null, boughtForSource: 'unknown', purchase: null });
      const prices = Object.fromEntries(candidates.map(row => [row.item.definitionId, 1000]));
      const limits = Object.fromEntries(candidates.map(row => [row.item.id, { status: 'loaded', minimum: 150, maximum: 15000000 }]));
      globalThis.bulkCalls = []; globalThis.bulkCardCalls = []; globalThis.bulkDisposedCards = 0;
      globalThis.bulkRandomCalls = 0;
      Math.random = () => { globalThis.bulkRandomCalls++; return 0; };
      globalThis.bulkSettings = { priceMode: 'fixed', fixedPrice: 200, fixedStartPrice: 150, durationSeconds: 3600, delaySeconds: [3, 5] };
      let planned;
      const service = {
        scheduleCapability: () => ({ enabled: scheduleEnabled }),
        readSettings: async () => globalThis.bulkSettings,
        writeSettings: async value => { globalThis.bulkSettings = value; },
        prepare: async () => {
          if (globalThis.bulkMode === 'record-read') return { status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_JOURNAL_READ_FAILED' };
          if (globalThis.bulkMode === 'record-invalid') return { status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_JOURNAL_INVALID' };
          if (globalThis.bulkMode === 'prepare-error') throw Object.assign(new Error('FC27_GALLERY_LISTING_PRICE_LIMITS_UNAVAILABLE'), { phase: 'price-limits', httpStatus: 401 });
          return { status: 'ready', candidates: candidates.slice(0, globalThis.bulkPreviewCount ?? candidates.length), prices, priceTiers, liveEnabled: true,
            source: 'FUTBIN', requestedSources: ['futgg', 'futbin'],
            pricesBySource: Object.fromEntries(candidates.map(row => [row.item.definitionId, { futgg: 950, futbin: 1000 }])) };
        },
        readDisplayItem: item => item,
        plan: ({ selectedIds, settings, overridesByItem, previewPrices }) => (planned = globalThis.BulkListSmoke.planGalleryListingPrices({
          candidates: candidates.filter(row => selectedIds.includes(row.item.id)), settings, overridesByItem, previewPrices,
          marketPrices: prices, limitsByItem: limits, priceTiers, random: () => 0 })),
        execute: async args => {
          if (JSON.stringify(args.plan) !== JSON.stringify(planned)) throw new Error('changed plan');
          globalThis.bulkCalls.push({ plan: args.plan, settings: args.settings, approved: args.approved });
          if (globalThis.bulkMode === 'execute-error') throw Object.assign(new Error('FC27_GALLERY_LISTING_UNAVAILABLE'), { phase: 'execute', httpStatus: 429 });
          if (globalThis.bulkMode === 'unknown') return { status: 'partial', reason: 'FC27_GALLERY_LISTING_RESULT_UNKNOWN',
            entries: args.plan.entries.map((row, index) => ({ ...row, status: index ? 'pending' : 'unknown' })) };
          const entries = args.plan.entries.map((row, index) => ({ ...row, status: index ? 'rejected' : 'accepted' }));
          args.onProgress({ index: entries.length, total: entries.length, completed: entries.length, accepted: 1, rejected: entries.length - 1, skipped: 0, entries });
          if (globalThis.bulkMode === 'held') await new Promise(resolve => { globalThis.bulkRelease = resolve; });
          return { status: 'completed', accepted: 1, entries };
        },
        inspect: async () => ({ status: 'observed', state: globalThis.bulkMode === 'unknown' ? 'active' : 'completed', runId: 'fixture-run' }), stop() { globalThis.bulkStopped = true; },
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
    }, { priceTiers, workbenchMarkup: fc27WorkbenchMarkup(), scheduleEnabled });
    const dialog = page.locator('#gallery-bulk-list-dialog');
    const assertClosed = async () => {
      assert.deepEqual(await dialog.evaluate(node => ({ open: node.open,
        display: globalThis.getComputedStyle(node).display, boxes: node.getClientRects().length })),
      { open: false, display: 'none', boxes: 0 }, 'closed Bulk List must not appear or occupy space in any tab');
    };
    await assertClosed();
    assert.equal(await page.evaluate(() => globalThis.bulkCalls.length), 0);
    await page.evaluate(() => globalThis.bulkView.open());
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.evaluate(node => globalThis.getComputedStyle(node).display), 'block');
    assert.equal(await page.getByRole('button', { name: '关闭', exact: true }).textContent(), '×');
    assert.match(await page.locator('.list-source').textContent(), /FUT.GG \+ FUTBIN · 基准 FUTBIN/);
    assert.equal(await page.locator('thead th').count(), 6);
    assert.deepEqual(await page.locator('tbody tr').evaluateAll(rows => rows.slice(0, 3).map(row => row.children[4].textContent)),
      ['150', 'N/A', '未知']);
    assert.equal(await page.locator('tbody tr').first().locator('.list-profit').textContent(), '40');
    const assertLayout = async () => {
      const layout = await dialog.evaluate(node => {
        const groups = [...node.querySelectorAll('.list-group')].map(group => group.getBoundingClientRect());
        const table = node.querySelector('.list-table-wrap');
        return { stacked: groups[1].top >= groups[0].bottom && groups[2].top >= groups[1].bottom,
          horizontal: node.scrollWidth > node.clientWidth + 1 || table.scrollWidth > table.clientWidth + 1,
          innerScroll: table.scrollHeight > table.clientHeight + 1,
          scrollable: globalThis.getComputedStyle(node).overflowY === 'auto' };
      });
      assert.deepEqual(layout, { stacked: true, horizontal: false, innerScroll: false, scrollable: true });
      const currency = await page.locator('.listing-currency').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({
        input: node.querySelector('input').getBoundingClientRect().height,
        arrows: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height),
        icons: [...node.querySelectorAll('svg')].map(svg => [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height]),
      })));
      assert.ok(currency.length > 0);
      for (const control of currency) assert.deepEqual(control, { input: 40, arrows: [20, 20], icons: [[15, 15], [15, 15]] });
    };
    const assertActionsReachable = async () => {
      for (const fraction of [0, .5, 1]) {
        const layout = await dialog.evaluate((node, fraction) => {
          node.scrollTop = fraction * (node.scrollHeight - node.clientHeight);
          const box = node.getBoundingClientRect(), footer = node.querySelector('.list-footer');
          const buttons = [...footer.querySelectorAll('button')].filter(button => !button.hidden);
          return { overflow: node.scrollHeight > node.clientHeight,
            visible: buttons.every(button => {
              const rect = button.getBoundingClientRect();
              const hit = node.getRootNode().elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
              return rect.top >= Math.max(0, box.top) && rect.bottom <= Math.min(globalThis.innerHeight, box.bottom)
                && (hit === button || button.contains(hit));
            }) };
        }, fraction);
        assert.equal(layout.overflow, true, 'long listing must scroll the dialog, not clip it');
        assert.equal(layout.visible, true, `action buttons must be visible and hit-testable at scroll ${fraction}`);
      }
      await dialog.evaluate(node => { node.scrollTop = 0; });
    };
    await assertLayout();
    await page.setViewportSize({ width: 640, height: 800 });
    await assertLayout();
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.equal(await page.locator('#gallery-listing-schedule').isVisible(), scheduleEnabled);
    await page.getByRole('button', { name: '卡片视图', exact: true }).click();
    assert.equal(await page.locator('tbody tr').first().isVisible(), true, 'card mode must show the selected player rows');
    const assertCards = async ids => {
      assert.deepEqual(await page.locator('.fixture-ea-card').evaluateAll(cards => cards.map(card => ({
        id: Number(card.textContent.slice(3)), projected: card.assignedSlot?.isConnected === true,
        styled: globalThis.getComputedStyle(card).backgroundColor === 'rgb(40, 80, 120)',
      }))), ids.map(id => ({ id, projected: true, styled: true })));
      assert.equal(await page.evaluate(() => globalThis.bulkCardCalls.every(call => call.host && call.slot)), true);
      if (ids.length) {
        const cards = await page.locator('.list-card:visible').evaluateAll(nodes => nodes.map(node => ({
          height: node.getBoundingClientRect().height, scale: globalThis.getComputedStyle(node.querySelector('slot')).transform,
        })));
        for (const card of cards) assert.deepEqual(card, { height: 50, scale: 'matrix(0.5, 0, 0, 0.5, 0, 0)' });
        await assertLayout();
      }
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
    assert.equal(await page.locator('thead th').nth(2).textContent(), 'FUTBIN');
    assert.equal(await page.locator('tbody tr').first().locator('td').nth(2).textContent(), '1000');
    assert.equal(await page.locator('tbody tr:visible').count(), 25);
    const legacyVisible = await dialog.evaluate(node => {
      node.scrollTop = 0;
      const footer = node.querySelector('.list-footer'); footer.style.position = 'static';
      const visible = footer.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom;
      footer.style.removeProperty('position');
      return visible;
    });
    assert.equal(legacyVisible, false, 'ordinary-flow footer reproduces the long-list missing actions');
    const assertReachable = async locator => {
      await locator.scrollIntoViewIfNeeded();
      assert.equal(await locator.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const hit = node.getRootNode().elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit === node || node.contains(hit);
      }), true, 'scrolled content must not be covered by the sticky actions');
    };
    for (const viewport of [{ width: 1280, height: 720 }, { width: 640, height: 600 }, { width: 390, height: 667 }]) {
      await page.setViewportSize(viewport);
      await assertLayout();
      await assertActionsReachable();
      if (previewPath) await page.screenshot({ path: previewPath.replace(/\.png$/, `-long-${viewport.width}.png`) });
      await assertReachable(page.getByLabel('选择 Player 35', { exact: true }));
      if (scheduleEnabled) {
        await page.locator('#gallery-listing-schedule').evaluate(node => { node.open = true; });
        await assertActionsReachable();
        await assertReachable(page.getByLabel('挂牌时间', { exact: true }));
        await assertReachable(page.getByRole('button', { name: '保存计划', exact: true }));
        await page.locator('#gallery-listing-schedule').evaluate(node => { node.open = false; });
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: '卡片视图', exact: true }).click();
    assert.equal(await page.locator('thead th').nth(2).textContent(), 'Previously Listed');
    await assertCards(Array.from({ length: 10 }, (_, i) => i + 21));
    await page.getByRole('button', { name: 'Percentage', exact: true }).click();
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '1000');
    assert.match(await page.getByLabel('Player 21 Buy Now', { exact: true }).getAttribute('title'), /950 → 1000/);
    const randomCount = () => page.evaluate(() => globalThis.bulkRandomCalls);
    const initialDraws = await randomCount();
    await page.getByLabel('选择 Player 21', { exact: true }).uncheck();
    await page.getByLabel('选择 Player 21', { exact: true }).check();
    await page.getByLabel('时长', { exact: true }).selectOption('10800');
    await page.getByRole('button', { name: 'Percentage', exact: true }).click();
    assert.equal(await randomCount(), initialDraws, 'selection, duration and unchanged mode do not rerandomize');
    await page.getByLabel('最低百分比', { exact: true }).fill('90');
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '900');
    await page.getByLabel('Player 21 Buy Now', { exact: true }).fill('777');
    const beforeOverride = await randomCount();
    await page.getByLabel('Player 21 Buy Now', { exact: true }).press('Enter');
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '800');
    assert.equal(await randomCount(), beforeOverride + 25, 'override memo recalculates all rows, even overridden ones');
    await page.getByLabel('最高百分比', { exact: true }).fill('110');
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '800', 'settings retain manual overrides');
    await page.getByLabel('Player 21 Buy Now', { exact: true }).fill('');
    await page.getByLabel('Player 21 Buy Now', { exact: true }).press('Enter');
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '900', 'empty override returns to automatic price');
    const track = page.locator('.listing-range-control').first();
    await track.scrollIntoViewIfNeeded();
    const bounds = await track.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height / 2, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.getByLabel('最低百分比', { exact: true }).inputValue(), '80');
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '800');
    await page.getByLabel('最高百分比', { exact: true }).fill('70');
    assert.equal(await page.getByLabel('最高百分比', { exact: true }).inputValue(), '110', 'endpoints cannot cross');
    const beforeDelay = await randomCount();
    await page.getByLabel('最少秒数', { exact: true }).fill('4');
    assert.equal(await randomCount(), beforeDelay, 'delay changes do not change prices');
    await page.getByLabel('最多秒数', { exact: true }).fill('2');
    assert.equal(await page.getByLabel('最多秒数', { exact: true }).inputValue(), '5');
    await page.getByLabel('最低百分比', { exact: true }).fill('100');
    await page.getByLabel('最高百分比', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Steps', exact: true }).click();
    await page.getByLabel('价格档位', { exact: true }).fill('1');
    await page.getByLabel('时长', { exact: true }).click();
    assert.equal(await page.getByLabel('Player 21 Buy Now', { exact: true }).inputValue(), '1100');
    assert.match(await page.getByLabel('Player 21 Buy Now', { exact: true }).getAttribute('title'), /1000 → 1100/);
    const playerPrice = page.getByLabel('Player 21 Buy Now', { exact: true });
    await playerPrice.fill('200'); await playerPrice.press('Enter');
    await page.getByRole('button', { name: 'Player 21 Buy Now 增加', exact: true }).click();
    assert.equal(await playerPrice.inputValue(), '250', 'user-approved EA step replaces Enhancer +250');
    await playerPrice.fill('275');
    await page.getByRole('button', { name: 'Player 21 Buy Now 增加', exact: true }).click();
    assert.equal(await playerPrice.inputValue(), '300', 'pointerdown must not round the draft before stepping');
    await playerPrice.fill('10000'); await playerPrice.press('ArrowDown');
    assert.equal(await playerPrice.inputValue(), '9900');
    await playerPrice.fill(''); await playerPrice.press('Enter');
    await page.getByRole('button', { name: 'Fixed', exact: true }).click();
    assert.equal(await page.getByLabel('Buy Now', { exact: true }).inputValue(), '200');
    assert.equal(await page.getByLabel('Start Bid', { exact: true }).inputValue(), '150');
    await page.getByRole('button', { name: 'Buy Now 增加', exact: true }).click();
    assert.equal(await page.getByLabel('Buy Now', { exact: true }).inputValue(), '250');
    await page.getByRole('button', { name: 'Start Bid 增加', exact: true }).click();
    assert.equal(await page.getByLabel('Start Bid', { exact: true }).inputValue(), '200');
    await page.getByLabel('Buy Now', { exact: true }).fill('777');
    await page.getByLabel('Buy Now', { exact: true }).press('Enter');
    assert.equal(await page.getByLabel('Buy Now', { exact: true }).inputValue(), '800');
    await page.getByLabel('Start Bid', { exact: true }).fill('1000');
    await page.getByLabel('Start Bid', { exact: true }).press('Enter');
    assert.equal(await page.getByLabel('Buy Now', { exact: true }).inputValue(), '1100');
    await page.getByLabel('Start Bid', { exact: true }).fill('150');
    await page.getByLabel('Start Bid', { exact: true }).press('Enter');
    assert.equal(await page.getByLabel('Start Bid', { exact: true }).inputValue(), '200');
    await page.getByLabel('Start Bid', { exact: true }).fill('1000');
    await page.getByLabel('Start Bid', { exact: true }).press('Enter');
    await page.getByLabel('Buy Now', { exact: true }).fill('300');
    await page.getByLabel('Start Bid', { exact: true }).click();
    assert.equal(await page.getByLabel('Start Bid', { exact: true }).inputValue(), '250');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await assertClosed();
    await assertCards([]);
    await page.evaluate(() => globalThis.bulkView.open());
    await page.keyboard.press('Escape');
    await assertClosed();
    await page.evaluate(() => globalThis.bulkView.open());
    await page.locator('.fixture-ea-card').first().waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Buy Now', { exact: true }).inputValue(), '300');
    await assertCards(Array.from({ length: 10 }, (_, i) => i + 11));
    await page.evaluate(() => { globalThis.bulkMode = 'held'; });
    await page.getByRole('button', { name: '挂牌 25 张', exact: true }).click();
    await page.getByRole('button', { name: '停止', exact: true }).waitFor({ state: 'visible' });
    await assertActionsReachable();
    await page.getByRole('button', { name: '停止', exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.bulkStopped), true);
    assert.equal(await page.evaluate(() => globalThis.bulkCalls.length), 1);
    await page.evaluate(() => { globalThis.bulkRelease(); });
    await page.waitForFunction(() => globalThis.document.querySelector('main').shadowRoot.querySelector('dialog output').textContent.includes('挂牌部分完成'));
    await assertActionsReachable();
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
    assert.deepEqual(calls[0].plan.entries.map(row => row.startPrice), Array(25).fill(250));
    assert.deepEqual(calls[0].settings.delaySeconds, [4, 5]);
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
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await assertClosed();
    await page.evaluate(() => {
      globalThis.bulkMode = null; globalThis.bulkPreviewCount = 2;
      globalThis.bulkSettings = { ...globalThis.bulkSettings, priceMode: 'percentage', percentageRange: [105, 110] };
      return globalThis.bulkView.open();
    });
    assert.equal(await page.locator('.list-selection').textContent(), '2 of 2 row(s) selected.');
    await assertLayout();
    if (previewPath) {
      await page.setViewportSize({ width: 900, height: 1200 });
      await dialog.evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: previewPath });
    }
    console.log('Offline Bulk List smoke passed: initially hidden, close/Escape/cancel/reopen, 25 cards / 3 pages, native slots/cleanup, trusted dual-slider drag, non-crossing inputs, override memo, input rounding/coupling, frozen request prices, per-card results, no requests.');
  } finally { await page.close(); }
}
