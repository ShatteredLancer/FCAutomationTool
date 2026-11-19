import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';
import { exerciseGalleryCategoryOrder } from './gallery-category-order-smoke.mjs';

// Public league presentation order; scores and collection below are synthetic.
const leagues = [
  [108, 'Premier League', 13], [100, 'Barclays WSL', 2216],
  [111, "Ligue 1 McDonald's", 16], [115, 'Arkema Première Ligue', 2218],
  [109, 'LALIGA EA SPORTS', 53], [121, 'Liga F', 2222],
  [103, 'Serie A', 31], [122, 'Bundesliga', 19],
  [120, 'Google Pixel Frauen-Bundesliga', 2215], [155, 'ROSHN Saudi League', 350],
  [173, 'MLS', 39], [193, 'NWSL', 2221],
];

export async function exerciseGallerySetCards(context, directory) {
  const page = await context.newPage();
  const requests = [];
  const dto = futggGallery();
  const template = dto.data.categories[0].sets[0];
  dto.data.categories[0] = { id: 1, slug: 'leagues', name: 'Leagues', sets: leagues.map(([id, name, league]) => ({
    ...template, id, name, slug: `league-${id}`, requiredCards: 30,
    conditions: { leagues: [league] },
    grades: template.grades.map((grade, index) => ({ ...grade, threshold: [10000, 50000, 100000, 300000, 1000000][index] })),
  })) };
  dto.data.tags = [{ id: 1, name: 'First Owner', bonusType: 'ITEM_SCORE_PERCENTAGE', thresholdType: 'ITEM_COUNT',
    rules: [{ type: 'COUNT', target: 'ATTRIBUTE', attribute: 'FIRST_OWNED', values: ['1'] }], tiers: [{ minItems: 20, bonus: 100 }] }];
  const catalog = normalizeGalleryCatalog('futgg', dto);
  const bundle = await build({ absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'], bundle: true, write: false,
    format: 'iife', globalName: 'GalleryCardsSmoke', target: 'chrome120' });
  await exerciseGalleryCategoryOrder(context, directory, bundle.outputFiles[0].text);
  try {
    // Deterministic local emblem stand-ins: mapping to actual EA IDs is tested
    // against production-entry separately. This smoke never uses the network.
    await page.route('https://www.ea.com/assets/gallery-fixture/**', async route => {
      requests.push(route.request().url());
      const label = new URL(route.request().url()).pathname.split('/').at(-1).replace('.svg', '');
      await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="46"><path d="M3 4h34v24L20 43 3 28z" fill="#d6e8e1"/><text x="20" y="25" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#213d34">${label}</text></svg>` });
    });
    await page.setContent('<!doctype html><title>Gallery set cards — synthetic offline preview</title>');
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(({ catalog, leagues }) => {
      const details = leagues.map(([id, , league], index) => ({ status: 'observed', scope: 'cards-fixture',
        progress: { source: 'futgg', season: '27', setId: id, complete: true, poolComplete: true,
          totals: { total: 35, collected: 35, unknown: 0 },
          rows: Array.from({ length: 35 }, (_, i) => ({ eaId: 900000 + i, playerEaId: 800000 + i,
            collected: true, firstOwned: true, galleryScore: 1000 + index * 250 + i * 100,
            gradingScore: 1000 + index * 250 + i * 100, overall: 80, nationEaId: 1, clubEaId: i + 1,
            leagueEaId: league, rarityEaId: 1, positions: ['ST'], name: `Fixture ${i}` })) } }));
      const state = { status: 'observed', source: 'futgg', catalog, fetchedAt: Date.now() };
      globalThis.cardsLoads = 0;
      globalThis.cardsDetails = details;
      globalThis.cardArtCreated = 0;
      for (const detail of details) detail.runtimeCards = new Map(detail.progress.rows.map(row => [row.eaId, row]));
      globalThis.cardsPanel = globalThis.GalleryCardsSmoke.mountFc27AcceptancePanel({ document: globalThis.document, hostId: 'gallery-cards-test', targets: () => [],
        galleryAccountScope: () => 'cards-fixture',
        galleryNativeRenderer: { render({ parent, slot }) {
          globalThis.cardArtCreated++;
          const art = globalThis.document.createElement('div');
          art.slot = slot;
          parent.append(art);
          return art;
        } },
        galleryDiagnosticLog: { record(entry) {
          if (entry.event === 'set-open') globalThis.lastSetOpen = entry;
        } },
        galleryAssets: { category: () => ['https://www.ea.com/assets/gallery-fixture/13.svg'],
          set: name => [`https://www.ea.com/assets/gallery-fixture/${leagues.find(row => row[1] === name)[2]}.svg`],
          reward: type => type === 'event_token_1' ? 'https://www.ea.com/assets/gallery-fixture/T.svg' : '' },
        galleryCatalog: { peek: async () => null, load: async () => state },
        gallerySetLoader: async ({ set, onPreview }) => {
          globalThis.cardsLoads++;
          globalThis.reportCardsPreview = onPreview;
          if (globalThis.holdCardsLoad) await new Promise(resolve => { globalThis.finishCardsLoad = resolve; });
          return details.find(row => `futgg:${row.progress.setId}` === set.id);
        },
        gallerySync: { subscribe: callback => { globalThis.cardsNotify = callback; return () => {}; },
          state: () => ({ synced: true }), peekDetails: async () => details, stop() {} },
      });
      globalThis.cardsPanel.open();
    }, { catalog, leagues });
    const host = page.locator('#gallery-cards-test');
    await host.locator('#tab-gallery').click();
    await host.locator('#gallery-categories button').first().click();
    const cards = host.locator('#gallery-set-list .gallery-set');
    await page.waitForFunction(() => [...globalThis.document.getElementById('gallery-cards-test').shadowRoot.querySelectorAll('.gallery-set-total')]
      .filter(node => /[0-9]/.test(node.textContent)).length === 12);
    assert.deepEqual(await cards.locator('h4').allTextContents(), leagues.map(row => row[1]));
    assert.equal(await cards.locator('.gallery-collected').first().textContent(), '已收集 30 / 30');
    assert.match(await cards.locator('.gallery-collected').first().getAttribute('title'), /35/);
    assert.match(await cards.locator('.gallery-set-bonus').first().textContent(), /\(\+[\d,]+\)/);
    assert.equal(await cards.locator('.gallery-reward-token-value').count(), 12);
    for (const [width, columns] of [[1280, 3], [900, 2], [390, 1]]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await host.locator('#gallery-set-list').evaluate(node => globalThis.getComputedStyle(node).gridTemplateColumns.split(' ').length), columns);
      assert.equal(await host.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
      assert.equal(await cards.evaluateAll(nodes => nodes.some(node => node.scrollWidth > node.clientWidth + 1)), false);
      await page.screenshot({ path: path.join(directory, `gallery-set-cards-${width}.png`), fullPage: true });
      await cards.last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(directory, `gallery-set-cards-last-${width}.png`), fullPage: true });
      await cards.first().scrollIntoViewIfNeeded();
    }
    const nwsl = host.locator('.gallery-set[data-set-id="futgg:193"]');
    assert.match(await nwsl.locator('img.gallery-set-icon').getAttribute('src'), /2221\.svg$/);
    await nwsl.locator('.gallery-watch').click();
    assert.equal(await page.evaluate(() => globalThis.cardsLoads), 0);
    assert.equal(await nwsl.locator('.gallery-watch').getAttribute('aria-pressed'), 'true');
    await nwsl.locator('.gallery-open-set').focus();
    await page.keyboard.press('Enter');
    await host.locator('#gallery-set-detail').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => globalThis.cardsLoads), 1);
    await host.locator('#gallery-back').click();
    await nwsl.waitFor();
    // Late score updates must update the total and bonus together.
    const previousTotal = await nwsl.locator('.gallery-set-total').textContent();
    const previousBonus = await nwsl.locator('.gallery-set-bonus').textContent();
    await page.evaluate(() => {
      const detail = globalThis.cardsDetails.at(-1);
      globalThis.cardsDetails[globalThis.cardsDetails.length - 1] = { ...detail,
        progress: { ...detail.progress, rows: detail.progress.rows.map(row => ({ ...row,
          galleryScore: row.galleryScore * 2, gradingScore: row.gradingScore * 2 })) } };
      globalThis.cardsNotify();
    });
    await page.waitForFunction(previous => {
      const value = globalThis.document.getElementById('gallery-cards-test').shadowRoot
        .querySelector('.gallery-set[data-set-id="futgg:193"] .gallery-set-total')?.textContent;
      return value && value !== previous;
    }, previousTotal);
    assert.notEqual(await nwsl.locator('.gallery-set-bonus').textContent(), previousBonus);
    await nwsl.locator('img.gallery-set-icon').dispatchEvent('error');
    assert.equal(await nwsl.locator('.gallery-set-icon-fallback').isVisible(), true);
    assert.ok(requests.every(url => url.startsWith('https://www.ea.com/assets/gallery-fixture/')));
    // The category has the account's rows. Reopening must paint the first page
    // even when the foreground read cannot complete. No network or images.
    await page.evaluate(() => { globalThis.holdCardsLoad = true; globalThis.lastSetOpen = null; });
    await nwsl.locator('.gallery-open-set').click();
    await page.waitForFunction(() => typeof globalThis.finishCardsLoad === 'function');
    assert.equal(await host.locator('#gallery-set-detail .gallery-player-meta strong').count(), 24);
    assert.equal(await host.locator('#gallery-set-detail .gallery-card-select').count(), 0);
    const rendered = await page.evaluate(() => globalThis.cardArtCreated);
    await host.locator('.gallery-player-art slot').first().evaluate(slot => {
      globalThis.previewCardArt = slot.assignedElements()[0];
    });
    await page.evaluate(() => globalThis.finishCardsLoad());
    await host.locator('.gallery-card-page').waitFor();
    assert.equal(await page.evaluate(() => globalThis.cardArtCreated), rendered);
    assert.equal(await host.locator('.gallery-player-art slot').first().evaluate(slot =>
      !!globalThis.previewCardArt && slot.assignedElements()[0] === globalThis.previewCardArt), true);
    const timing = await page.evaluate(() => globalThis.lastSetOpen);
    assert.ok(timing.firstListMs <= timing.durationMs);
    console.log('Cached set detail (synthetic Chrome):', JSON.stringify(timing), 'native cards rebuilt after validation: 0');
    assert.equal(await page.evaluate(() => globalThis.cardsLoads), 2);
    await host.getByRole('button', { name: '同步当前集合' }).click();
    await page.waitForFunction(() => globalThis.cardsLoads === 3);
    await page.evaluate(() => globalThis.reportCardsPreview({ pool: { items: [
      { eaId: 183, cardName: 'Public pool player', rarityName: 'Rare', overall: 84 },
    ] } }));
    await host.locator('.gallery-player-meta strong', { hasText: 'Public pool player' }).waitFor();
    assert.equal(await host.locator('.gallery-card-select').count(), 0);
    await host.locator('#gallery-back').click();
    await page.evaluate(() => {
      globalThis.reportCardsPreview(globalThis.cardsDetails.at(-1));
      globalThis.finishCardsLoad();
    });
    assert.equal(await host.locator('#gallery-set-detail').isVisible(), false);
    assert.equal(await host.locator('#gallery-set-detail .gallery-card').count(), 0);
    console.log('Offline Gallery set cards passed: 12 leagues, source order, capped count, total + bonus, rewards, 3/2/1 columns, watch, keyboard, updates and icon fallback.');
  } finally { await page.close(); }
}
