import { clickPanelControl, panelCall, waitForPanel, openProductionPanel, selectPanelTab } from './production-panel-inspection.mjs';

// Navigation and DOM reads only: do not open individual sets, force sync,
// compare prices, plan, buy, list or resume any transaction.
export async function verifyGalleryCategories(context, page) {
  await openProductionPanel(context, page);
  await selectPanelTab(context, page, 'gallery');
  for (let i = 0; i < 2; i++) {
    if (!await panelCall(context, page, function () { return this.getElementById('gallery-back')?.checkVisibility(); })) break;
    await clickPanelControl(context, page, '#gallery-back');
  }
  const snapshot = () => panelCall(context, page, function () {
    return { version: this.host.dataset.version, note: this.getElementById('gallery-progress-note')?.textContent,
      sync: JSON.parse(this.getElementById('gallery-sync')?.dataset.syncState ?? 'null'),
      categories: [...this.querySelectorAll('#gallery-categories button')].map(button => ({
        id: button.dataset.categoryId, name: button.querySelector('strong')?.textContent,
        text: button.querySelector('.gallery-category-score')?.textContent,
        counts: JSON.parse(button.querySelector('.gallery-category-score')?.dataset.scoreCounts ?? 'null'),
      })) };
  });
  await waitForPanel(context, page, function () { return !!this.querySelector('.gallery-category-score[data-score-counts]');
  }, [], 15000);
  const before = await snapshot(), categories = [];
  for (const category of before.categories) {
    await clickPanelControl(context, page, `#gallery-categories [data-category-id=${JSON.stringify(category.id)}]`);
    const sets = await panelCall(context, page, function () {
      return [...this.querySelectorAll('#gallery-set-list .gallery-set')].map(card => ({
        id: card.dataset.setId, name: card.querySelector('h4')?.textContent,
        score: card.querySelector('.gallery-summary')?.textContent,
      }));
    });
    categories.push({ id: category.id, sets });
    await clickPanelControl(context, page, '#gallery-back');
  }
  // Let the existing cooperative queue paint; no explicit sync or load.
  const deadline = Date.now() + 30000;
  let after = await snapshot();
  while ((after.categories.some(category => category.counts?.pending > 0) || after.sync?.busy || after.sync?.task?.active)
      && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250)); after = await snapshot();
  }
  await page.screenshot({ path: 'artifacts/fc27-browser/gallery-category-live.png' });
  return { status: 'observed', executable: false, before, categories, after };
}
