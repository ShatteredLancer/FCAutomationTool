import { summarizeGalleryScoreSteps } from './scoring.js';
import { isGalleryOwned } from './planner.js';
import { isCapturedFodderForecastTarget } from './fodder-planning-reference.js';

// Revalidate a public empty-collection lineup against the current exact local
// versions, ownership and rules. Price inputs are explicitly either forecast
// estimates or independent quotes; neither grants spending authority. No
// foreign score or aggregate public cost proves a personal plan.
export function* verifyGalleryReferenceSteps({ target, proposal, capital = null, summarize = summarizeGalleryScoreSteps,
  allowCapturedForecast = false, refine = true } = {}) {
  const { progress, prices, set, catalog } = target;
  if (target.publicReference?.basis !== 'empty-collection-public-reference'
      || target.publicReference.expiresAt <= Date.now() && !(allowCapturedForecast && isCapturedFodderForecastTarget(target))
      || progress?.complete === false
      || !Array.isArray(proposal?.ids) || !proposal.ids.length) return null;
  const rows = new Map(progress.rows.map(row => [row.eaId, row]));
  if (rows.size !== progress.rows.length || new Set(proposal.ids).size !== proposal.ids.length) return null;
  const existing = progress.rows.filter(isGalleryOwned), selected = [], items = [];
  if (existing.some(row => !Number.isSafeInteger(row.gradingScore) || row.gradingScore < 0)) return null;
  for (const id of proposal.ids) {
    const row = rows.get(id); if (!row) return null;
    if (isGalleryOwned(row)) continue;
    const price = prices?.[id], score = row.gradingScore ?? row.galleryScore;
    if (row.collected !== false || !Number.isSafeInteger(price) || price < 150 || price > 15000000
        || capital !== null && price > capital || !Number.isSafeInteger(score) || score < 0) return null;
    selected.push({ ...row, gradingScore: score, firstOwned: false, collected: true });
    items.push({ ...row, price, score, scoreSource: row.gradingScore == null ? 'catalog' : 'ea' });
  }
  const measure = function* (picked) {
    return yield* summarize({ set, catalog, progress: { ...progress,
      rows: [...existing.map(row => ({ ...row, collected: true })), ...picked] } });
  };
  const threshold = set.grades.find(grade => grade.name === proposal.grade)?.threshold;
  if (threshold == null) return null;
  let summary = null;
  if (!refine && proposal.ids.length === set.requiredCards) {
    const purchased = new Map(selected.map(row => [row.eaId, row]));
    // A complete public lineup is a conservative witness, even when extra
    // owned cards might make another lineup better. It is independently
    // rescored locally; the later pass can improve/trim it with all owned.
    summary = yield* summarize({ set, catalog, progress: { ...progress,
      rows: proposal.ids.map(id => purchased.get(id) ?? { ...rows.get(id), collected: true }) } });
  }
  if (!summary?.full || summary.low?.total < threshold) summary = yield* measure(selected);
  if (!summary?.full || summary.low?.total < threshold || threshold == null) return null;
  // Existing cards outside the public lineup may make some purchases redundant.
  // One bounded expensive-first removal pass is enough for the fast overview.
  if (refine && existing.length) for (const item of items.slice().sort((a, b) => b.price - a.price).slice(0, 32)) {
    const trial = yield* measure(selected.filter(row => row.eaId !== item.eaId));
    if (trial?.full && trial.low?.total >= threshold) {
      selected.splice(selected.findIndex(row => row.eaId === item.eaId), 1);
      items.splice(items.findIndex(row => row.eaId === item.eaId), 1); summary = trial;
    }
    if (yield { phase: 'reference-validation', cards: items.length }) break;
  }
  return { reached: true, score: summary.low.total, items, totalPrice: items.reduce((sum, row) => sum + row.price, 0),
    estimated: items.some(row => row.scoreSource !== 'ea'), referenceVerified: true };
}
