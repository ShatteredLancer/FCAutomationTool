import { isGalleryOwned } from './planner.js';

// Quote the same candidate set used for cost comparison. Never start this on
// category/tab navigation. The public service deduplicates across these sets.
export async function loadGalleryPriceSnapshot(inputRows, { load, current = () => true, onProgress = () => {} }) {
  const rows = new Map(inputRows.map(row => [row.eaId, row]));
  const ids = [...rows.keys()], snapshot = { source: 'public-references', prices: {}, freshPrices: {}, references: {}, expiresAt: null, policy: null };
  for (let start = 0; start < ids.length; start += 250) {
    if (!current()) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
    const batch = ids.slice(start, start + 250);
    const part = await load(batch, { rows: batch.map(id => rows.get(id)), ...(snapshot.policy ? { policy: snapshot.policy } : {}),
      isCurrent: current, onProgress: value => onProgress({ ...value, index: start + value.index, total: ids.length }) });
    if (!current()) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
    if (part?.source !== 'public-references' || !part.policy || snapshot.policy && JSON.stringify(part.policy) !== JSON.stringify(snapshot.policy))
      throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    snapshot.policy = part.policy;
    Object.assign(snapshot.prices, part.prices); Object.assign(snapshot.freshPrices, part.freshPrices); Object.assign(snapshot.references, part.references);
    if (part.expiresAt != null) snapshot.expiresAt = Math.min(snapshot.expiresAt ?? Infinity, part.expiresAt);
  }
  return snapshot;
}

export async function priceGalleryPlanningTargets(targets, options) {
  const owned = new Set(targets.flatMap(target => target.progress.rows.filter(isGalleryOwned).map(row => row.eaId)));
  const rows = targets.flatMap(target => target.progress.rows.filter(row => row.collected === false && !owned.has(row.eaId)));
  const snapshot = await loadGalleryPriceSnapshot(rows, options);
  return targets.map(target => ({ ...target, prices: { ...snapshot.freshPrices }, priceSnapshot: snapshot }));
}
