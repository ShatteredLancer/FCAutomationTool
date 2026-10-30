import { evaluateGalleryLineup, galleryRuleKeys, createGalleryScoreSummarizer } from './scoring.js';
import { refineGalleryCostSteps } from './cost-search.js';
import { galleryPriceBands } from './price-band-seeds.js';

// Search complete scoring lineups, not purchase supersets that each need a
// second best-subset search. Zero is incremental cost for an owned version,
// never a fabricated quote for a missing card. The caller fully verifies the
// few winning purchases with its normal scorer before publishing them.
export function* searchGalleryLineupCosts({ existing, candidates, set, catalog, compiled, threshold, maxEvaluations }) {
  const required = set.requiredCards;
  const byId = new Map();
  for (const row of existing) if (row.gradingScore > 0) byId.set(row.eaId, { row, price: 0 });
  for (const candidate of candidates) if (candidate.price > 0 && candidate.score.value > 0) {
    byId.set(candidate.id, { row: { ...candidate.row, gradingScore: candidate.score.value, firstOwned: false }, price: candidate.price });
  }
  if (byId.size < required || ![...byId.values()].some(value => value.price > 0)) return null;
  const pool = [...byId].map(([id, value]) => ({ id, price: value.price, score: value.row.gradingScore,
    diversityKeys: galleryRuleKeys(value.row, compiled.tags) }));
  let bestPrice = null;
  const evaluate = ids => {
    const rows = ids.map(id => byId.get(id).row), summary = evaluateGalleryLineup(rows, compiled);
    const cost = ids.reduce((sum, id) => sum + byId.get(id).price, 0);
    if (summary.total >= threshold && (bestPrice === null || cost < bestPrice)) bestPrice = cost;
    return { ids, cost, missingPrices: false,
      score: summary.total, diversityKey: summary.tags.map(tag => `${tag.id}:${tag.count}:${tag.pct}`).join('|') };
  };
  const initial = evaluate(pool.slice().sort((a, b) => a.price - b.price || b.score - a.score || a.id - b.id)
    .slice(0, required).map(row => row.id));
  // Preserve the old affordable-pool/combined-bonus route once per band.
  // This warm start is bounded once, not repeated for every purchase superset.
  function* seeds() {
    let work = 0;
    const summary = createGalleryScoreSummarizer(catalog, { fastTotals: true });
    const bands = galleryPriceBands(pool);
    // Large already-full leagues often need several replacements rather than
    // one nominal missing slot. Give the complete priced pool one scoring
    // witness before a cheap band spends the shared 16k warm-start budget.
    // The normal cost search still compares cheaper candidates afterward.
    if (existing.length >= required * 2 && candidates.length >= required * 2) bands.unshift(Infinity);
    for (const price of bands) {
      const rows = [...byId.values()].filter(value => value.price <= price).map(value => ({ ...value.row, collected: true }));
      const scorer = summary.steps({ set, catalog, progress: { season: '27', complete: true,
        setId: catalog.source === 'fodder' ? set.id : Number(set.id.split(':').at(-1)), rows } });
      let next;
      try {
        next = scorer.next();
        while (!next.done) {
          if ((yield { work: ++work }) || work >= 16000) return;
          next = scorer.next();
        }
      } finally { scorer.return(); }
      if (next.value.full && (yield { ids: next.value.lineup.map(row => row.eaId), work })) return;
    }
  }
  const search = refineGalleryCostSteps({ initial, candidates: pool, evaluate, maxEvaluations,
    seedSteps: seeds(), allowZeroCosts: true, measure: state => ({ reached: state.score >= threshold,
      progress: Math.min(1, state.score / Math.max(1, threshold)), diversityKey: state.diversityKey }) });
  let next;
  try {
    next = search.next();
    while (!next.done) next = search.next(yield { ...next.value, bestPrice });
  } finally { search.return(); }
  const result = next.value;
  return { ...result, plans: result.plans.sort((a, b) => a.cost - b.cost || b.score - a.score) };
}
