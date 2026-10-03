import { summarizeGalleryScoreSteps } from './scoring.js';

const owned = row => row.collected === true || row.inClub === true || row.held === true;

// Price bands are search routes, never purchase limits. Explore the largest
// relative price jumps first, then the full priced pool. The same scoring
// implementation chooses combined bonus tiers inside each affordable pool.
export function galleryPriceBands(candidates, limit = 8) {
  const prices = [...new Set(candidates.map(row => row.price)
    .filter(price => Number.isSafeInteger(price) && price > 0))].sort((a, b) => a - b);
  if (!prices.length) return [];
  const gaps = prices.slice(0, -1).map((price, i) => ({ price, jump: prices[i + 1] / price }))
    .sort((a, b) => b.jump - a.jump || a.price - b.price);
  return [...gaps.slice(0, limit - 1).map(row => row.price), prices.at(-1)];
}

export function* galleryPriceBandSeedSteps({ targets, candidates, maxWork = 16000 }) {
  const byId = new Map(candidates.map(row => [row.id, row]));
  const seen = new Set(); let work = 0;
  for (const price of galleryPriceBands(candidates)) {
    const ids = new Set(); let complete = true;
    for (const target of targets) {
      const rows = target.progress.rows.filter(row => owned(row)
        || byId.get(row.eaId)?.price > 0 && byId.get(row.eaId).price <= price)
        .map(row => owned(row) ? { ...row, collected: true } : { ...row,
          gradingScore: byId.get(row.eaId).score, collected: true, firstOwned: false });
      const steps = summarizeGalleryScoreSteps({ ...target, progress: { ...target.progress,
        season: '27', setId: Number(target.set.id.split(':').at(-1)), complete: true, rows } });
      let next;
      try {
        next = steps.next();
        while (!next.done) {
          work++;
          if ((yield { work }) || work >= maxWork) return;
          next = steps.next();
        }
      } finally {
        steps.return();
      }
      if (!next.value.full) { complete = false; break; }
      for (const row of next.value.lineup) if (!owned(target.progress.rows.find(original => original.eaId === row.eaId))) ids.add(row.eaId);
    }
    const key = [...ids].sort((a, b) => a - b).join(',');
    if (complete && ids.size && !seen.has(key)) {
      seen.add(key);
      if (yield { ids: [...ids], work }) return;
    }
    if (work >= maxWork) return;
  }
}
