import { summarizeGalleryScoreSteps, compileGalleryScoringRules, evaluateGalleryLineup } from './scoring.js';

const owned = row => row.collected === true || row.inClub === true || row.held === true;

// Explore every priced frontier cheaply before another full bonus search.
// This is a verified seed, not a new score formula or a per-card spending cap.
// Already-full collections may need several purchases together; selecting
// only the nominal missing slots cannot discover that replacement route.
export function* galleryAffordableLineupSeedSteps({ targets, candidates }) {
  const byId = new Map(candidates.filter(row => row.price > 0).map(row => [row.id, row]));
  const prepared = targets.map(target => ({ ...target, compiled: compileGalleryScoringRules(target.catalog),
    ownedIds: new Set(target.progress.rows.filter(owned).map(row => row.eaId)),
    threshold: target.threshold ?? (Number.isSafeInteger(target.targetGrade) ? target.targetGrade
      : target.set.grades.find(grade => grade.name === target.targetGrade)?.threshold),
    rows: target.progress.rows.filter(row => owned(row) || byId.has(row.eaId)).map(row => owned(row)
      ? { ...row, collected: true } : { ...row, gradingScore: byId.get(row.eaId).score, collected: true, firstOwned: false })
      .sort((a, b) => b.gradingScore - a.gradingScore
        || (byId.get(a.eaId)?.price ?? 0) - (byId.get(b.eaId)?.price ?? 0) || a.eaId - b.eaId) }));
  if (prepared.some(target => target.compiled.status !== 'ready' || !Number.isSafeInteger(target.threshold))) return;
  let best = null, work = 0;
  for (const price of [...new Set([...byId.values()].map(row => row.price))].sort((a, b) => a - b)) {
    const ids = new Set(); let reached = true;
    for (const target of prepared) {
      const lineup = target.rows.filter(row => row.gradingScore > 0 && (target.ownedIds.has(row.eaId)
        || byId.get(row.eaId)?.price <= price)).slice(0, target.set.requiredCards);
      if (lineup.length < target.set.requiredCards || evaluateGalleryLineup(lineup, target.compiled).total < target.threshold) { reached = false; break; }
      for (const row of lineup) if (!target.ownedIds.has(row.eaId)) ids.add(row.eaId);
    }
    if (reached && ids.size) {
      const cost = [...ids].reduce((sum, id) => sum + byId.get(id).price, 0);
      if (!best || cost < best.cost) best = { ids: [...ids], cost };
    }
    if (yield { work: ++work }) return;
  }
  if (best) yield { ids: best.ids, work };
}

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
  const seen = new Set(); let work = 0, fastSeeded = false;
  for (const price of galleryPriceBands(candidates)) {
    const ids = new Set(); let complete = true;
    for (const target of targets) {
      const rows = target.progress.rows.filter(row => owned(row)
        || byId.get(row.eaId)?.price > 0 && byId.get(row.eaId).price <= price)
        .map(row => owned(row) ? { ...row, collected: true } : { ...row,
          gradingScore: byId.get(row.eaId).score, collected: true, firstOwned: false });
      const steps = summarizeGalleryScoreSteps({ ...target, progress: { ...target.progress,
        season: '27', setId: target.catalog.source === 'fodder' ? target.set.id : Number(target.set.id.split(':').at(-1)), complete: true, rows } });
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
    if (!fastSeeded) {
      fastSeeded = true;
      const fast = galleryAffordableLineupSeedSteps({ targets, candidates });
      try {
        for (const step of fast) {
          work++;
          const key = step.ids?.slice().sort((a, b) => a - b).join(',');
          const ids = key && !seen.has(key) ? step.ids : undefined;
          if (ids) seen.add(key);
          if ((yield { work, ...(ids ? { ids } : {}) }) || work >= maxWork) return;
        }
      } finally { fast.return(); }
    }
    if (work >= maxWork) return;
  }
}
