import assert from 'node:assert/strict';
import { build } from 'esbuild';

export async function exercisePuzzleBuyButton(context, root) {
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-puzzle-buy-button.js'],
    bundle: true, write: false, format: 'iife', globalName: 'BuySmoke', target: 'chrome120' });
  const page = await context.newPage();
  try {
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><style>button.btn-standard { display:block; }.ut-click-shield{display:none}.ut-click-shield.showing{display:block}</style><body><div id="requirements"></div><button id="exchange">Exchange</button><div class="ut-click-shield"><div class="loaderIcon" style="display:none"></div></div></body>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const slot = globalThis.document.createElement('div'); slot.className = 'ut-squad-slot-view'; slot.setAttribute('index', '1');
      const card = globalThis.document.createElement('div'); card.className = 'concept'; slot.append(card); globalThis.document.body.append(slot);
    });
    await page.evaluate(() => {
      const state = globalThis.buySmoke = { buys: [], stops: 0, finish: null, blocked: false };
      globalThis.BuySmoke.mountFc27PuzzleBuyButton({ document: globalThis.document,
        readTarget: () => ({ setId: 4, challengeId: 16, anchor: globalThis.document.getElementById('exchange'),
          purchaseAnchor: globalThis.document.getElementById('requirements'), squadSignature: 'concepts',
          slots: [null, { slot: 1, definitionId: 902, concept: true }] }),
        inspect: async () => state.blocked ? { status: 'blocked', reason: 'FC27_BUY_SQUAD_CHANGED' }
          : ({ status: 'ready', operationId: 'test', total: 2, remaining: 2, spent: 0, budget: 400 }),
        buy: (target, approval, callbacks) => {
          state.buys.push({ setId: target.setId, challengeId: target.challengeId, approval, current: callbacks.isCurrent() });
          callbacks.onProgress({ purchased: 1, total: 2, spent: 200, phase: 'search', index: 2,
            failures: [{ slot: 1, definitionId: 902, reason: 'FC27_BUY_LISTING_UNAVAILABLE' }] });
          return new Promise(resolve => { state.finish = () => resolve({ status: 'partial', reason: 'FC27_BUY_STOPPED', purchased: 1, spent: 200 }); });
        },
         stop: () => { state.stops++; },
        foregroundProgress: {
          start: () => globalThis.document.querySelector('.ut-click-shield').classList.add('showing'),
          update: progress => { state.foreground = `${progress.phase ?? 'progress'}:${progress.index ?? 0}/${progress.total ?? 0}`; },
          end: () => globalThis.document.querySelector('.ut-click-shield').classList.remove('showing'),
        },
      });
    });
    const box = page.locator('#fcat-fc27-puzzle-buy');
    const buy = box.getByRole('button', { name: /批量购买概念球员/ });
    await buy.waitFor();
    assert.equal(await box.locator('input,details').count(), 0);
    assert.equal(await box.evaluate(node => node.parentElement.id), 'requirements');
    assert.equal(await box.getByRole('button', { name: '停止购买', includeHidden: true }).isVisible(), false);
    await buy.evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.buySmoke.buys.length), 0);
    await buy.click();
    await page.waitForFunction(() => globalThis.buySmoke.buys.length === 1);
    assert.deepEqual(await page.evaluate(() => globalThis.buySmoke.buys[0]), { setId: 4, challengeId: 16,
      approval: { approved: true, budget: null, expectedOperationId: 'test' }, current: true });
    assert.equal(await buy.isDisabled(), true);
    assert.match(await box.innerText(), /已购买 1\/2/);
    assert.equal(await page.locator('.ut-squad-slot-view[index="1"] .fcat-cards-buyerror .icon_untradeable').count(), 1);
    assert.equal(await page.locator('.ut-click-shield').evaluate(node => node.classList.contains('showing')), true);
    assert.equal(await page.evaluate(() => globalThis.buySmoke.foreground), 'search:2/2');
    await box.getByRole('button', { name: '停止购买' }).click();
    assert.equal(await page.evaluate(() => globalThis.buySmoke.stops), 1);
    await page.evaluate(() => globalThis.buySmoke.finish());
    await page.waitForFunction(() => !globalThis.document.querySelector('#fcat-fc27-puzzle-buy button').disabled);
    assert.match(await box.innerText(), /已停止/);
    assert.equal(await box.getByRole('button', { name: '停止购买', includeHidden: true }).isVisible(), false);
    assert.equal(await page.evaluate(() => globalThis.buySmoke.buys.length), 1);
    assert.equal(await page.locator('.ut-click-shield').isVisible(), false);
    await buy.click();
    await page.waitForFunction(() => globalThis.buySmoke.buys.length === 2);
    await page.evaluate(() => { globalThis.buySmoke.blocked = true; globalThis.buySmoke.finish(); });
    await page.waitForFunction(() => globalThis.document.querySelector('#fcat-fc27-puzzle-buy')?.textContent.includes('阵容已被修改'));
    assert.equal(await box.isVisible(), true);
    console.log('Puzzle bulk-buy button smoke passed: native header, trusted click, loader, progress, stop; synthetic only.');
  } finally { await page.close(); }
}
