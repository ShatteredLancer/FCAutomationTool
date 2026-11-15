import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { futggGallery } from '../../tests/fixtures/fc27-gallery.js';

// Public category labels/counts from the two user screenshots; no account data.
const categories = [
  ['rarities', 'Rarities', 10],
  ['premier-league', 'Premier League / Barclays WSL', 24],
  ['laliga', 'LALIGA EA SPORTS / Liga F Moeve', 26],
  ['bundesliga', 'Bundesliga / Frauen-Bundesliga', 20],
  ['ligue-1', "Ligue 1 McDonald's / Arkema PL", 22],
  ['serie-a', 'Serie A Enilive', 20], ['leagues', 'Leagues', 12],
  ['roshn-saudi-league', 'ROSHN Saudi League', 18], ['mls', 'MLS', 30],
  ['national-women-s-soccer-league', "National Women's Soccer League", 16],
];
const expected = [...categories.slice(1, 7), categories[0], ...categories.slice(7)].map(row => row[1]);

export async function exerciseGalleryCategoryOrder(context, directory, panelBundle) {
  const raw = futggGallery(), template = raw.data.categories[0].sets[0];
  let nextId = 1000;
  raw.data.categories = categories.map(([slug, name, count], i) => ({ id: i + 1, slug, name,
    sets: Array.from({ length: count }, (_, n) => ({ ...template, id: ++nextId, categoryId: i + 1,
      name: `${name} Set ${n + 1}`, slug: `set-${n + 1}` })) }));
  const catalog = normalizeGalleryCatalog('futgg', raw);
  raw.data.categories.reverse();
  const fresh = normalizeGalleryCatalog('futgg', raw);
  const page = await context.newPage(), requests = [];
  page.on('request', request => requests.push(request.url()));
  try {
    await page.setContent('<!doctype html><title>Gallery category order offline control</title>');
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    });
    await page.addScriptTag({ content: panelBundle });
    await page.evaluate(({ catalog, fresh }) => {
      const state = value => ({ status: 'observed', source: 'futgg', catalog: value, fetchedAt: Date.now() });
      globalThis.categoryPoolReads = 0;
      globalThis.categoryOrderPanel = globalThis.GalleryCardsSmoke.mountFc27AcceptancePanel({ document: globalThis.document,
        hostId: 'category-order-test', targets: () => [], galleryCatalog: {
          peek: async () => state(catalog),
          load: () => new Promise(resolve => { globalThis.finishCategoryRefresh = () => resolve(state(fresh)); }),
        }, gallerySetLoader: async () => { globalThis.categoryPoolReads++; return { status: 'blocked' }; },
      });
      globalThis.categoryOrderPanel.open();
    }, { catalog, fresh });
    const host = page.locator('#category-order-test');
    const names = host.locator('.gallery-category-name');
    await host.locator('#tab-gallery').click();
    await names.last().waitFor();
    assert.deepEqual(await names.allTextContents(), expected, 'cached public order must match Enhancer home, not put Rarities first');
    await host.locator('#gallery-categories button').last().click();
    assert.equal(await host.locator('#gallery-set-list .gallery-set').count(), 16);
    assert.match(await host.locator('#gallery-set-list h4').first().textContent(), /Set 1$/);
    await host.locator('#gallery-back').click();
    assert.deepEqual(await names.allTextContents(), expected);
    await page.evaluate(() => globalThis.finishCategoryRefresh());
    await page.waitForFunction(() => !globalThis.document.getElementById('category-order-test').shadowRoot.getElementById('gallery-refresh').disabled);
    assert.deepEqual(await names.allTextContents(), expected, 'fresh source reordering must not change the confirmed home order');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await host.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
      await page.screenshot({ path: path.join(directory, `gallery-category-order-${width}.png`) });
    }
    assert.equal(await page.evaluate(() => globalThis.categoryPoolReads), 0);
    assert.deepEqual(requests, []);
    console.log('Gallery home order passed: all 10 screenshot categories, cached/fresh order, NWSL entry/return, original set order, desktop/390px, zero requests.');
  } finally { await page.close(); }
}
