import { isGalleryOwned } from './planner.js';

// Quote the same candidate set used for cost comparison. Never start this on
// category/tab navigation. The public service deduplicates across these sets.
export async function loadGalleryPriceSnapshot(inputRows, { load, current = () => true, onProgress = () => {},
  purpose = null, deadlineAt = null, force = false, policy = null, autoDisplay = false, now = () => Date.now() }) {
  const rows = new Map(inputRows.map(row => [row.eaId, row]));
  const ids = [...rows.keys()], snapshot = { source: 'public-references', prices: {}, freshPrices: {}, references: {}, expiresAt: null, policy: null };
  // Detail navigation must not reserve hundreds of shared quote promises
  // ahead of the user's bounded planning job. Explicit price/plan reads keep
  // their full candidate scope; small club auto-display stays unchanged.
  if (autoDisplay && ids.length > 64) return { ...snapshot, deferred: true };
  for (let start = 0; start < ids.length; start += 250) {
    if (!current()) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
    if (deadlineAt !== null && now() >= deadlineAt) { snapshot.budgetExpired = true; break; }
    const batch = ids.slice(start, start + 250);
    const part = await load(batch, { rows: batch.map(id => rows.get(id)), ...((snapshot.policy ?? policy) ? { policy: snapshot.policy ?? policy } : {}),
      ...(purpose ? { purpose } : {}), ...(deadlineAt !== null ? { deadlineAt } : {}), ...(force ? { force: true } : {}),
      isCurrent: current, onProgress: value => onProgress({ ...value, index: start + value.index, total: ids.length }) });
    if (!current()) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED');
    if (part?.source !== 'public-references' || !part.policy
        || (snapshot.policy ?? policy) && JSON.stringify(part.policy) !== JSON.stringify(snapshot.policy ?? policy))
      throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
    snapshot.policy = part.policy;
    Object.assign(snapshot.prices, part.prices); Object.assign(snapshot.freshPrices, part.freshPrices); Object.assign(snapshot.references, part.references);
    if (part.budgetExpired) snapshot.budgetExpired = true;
    if (part.expiresAt != null) snapshot.expiresAt = Math.min(snapshot.expiresAt ?? Infinity, part.expiresAt);
  }
  return snapshot;
}

export async function priceGalleryPlanningTargets(targets, options) {
  const owned = new Set(targets.flatMap(target => target.progress.rows.filter(isGalleryOwned).map(row => row.eaId)));
  const rows = targets.flatMap(target => target.progress.rows.filter(row => row.collected === false && !owned.has(row.eaId)));
  const now = options.now ?? (() => Date.now());
  const bounded = { ...options, now, purpose: 'gallery-plan', deadlineAt: now() + 90000 };
  const snapshot = await loadGalleryPriceSnapshot(rows, bounded);
  // A large league can finish inside the quote TTL yet start with cached
  // prices that have only a few seconds left. Refresh just those versions
  // once, within the same read deadline. Never re-date the cached evidence.
  const renew = [...new Map(rows.filter(row => {
    const quote = snapshot.references[row.eaId]?.quotes?.[snapshot.policy?.source];
    return snapshot.freshPrices[row.eaId] > 0 && quote && !quote.error
      && Number.isSafeInteger(quote.fetchedAt) && Number.isSafeInteger(quote.expiresAt)
      && quote.expiresAt - now() < Math.min(60000, (quote.expiresAt - quote.fetchedAt) / 3);
  }).map(row => [row.eaId, row])).values()];
  if (renew.length) {
    const fresh = await loadGalleryPriceSnapshot(renew, { ...bounded, force: true, policy: snapshot.policy });
    for (const row of renew) { delete snapshot.prices[row.eaId]; delete snapshot.freshPrices[row.eaId]; }
    Object.assign(snapshot.prices, fresh.prices); Object.assign(snapshot.freshPrices, fresh.freshPrices);
    Object.assign(snapshot.references, fresh.references);
    if (fresh.budgetExpired) snapshot.budgetExpired = true;
  }
  // A long batch/renewal may outlive another page. Do not pass expired
  // authority evidence to the planner or substitute an old fallback price.
  for (const id of Object.keys(snapshot.freshPrices)) {
    const quote = snapshot.references[id]?.quotes?.[snapshot.policy?.source];
    if (quote && (quote.error || quote.fetchedAt > now() || quote.expiresAt <= now())) {
      delete snapshot.prices[id]; delete snapshot.freshPrices[id];
    }
  }
  const expiries = Object.keys(snapshot.freshPrices).map(id => snapshot.references[id]?.quotes?.[snapshot.policy?.source]?.expiresAt)
    .filter(value => Number.isSafeInteger(value));
  if (expiries.length) snapshot.expiresAt = Math.min(...expiries);
  if (rows.length && !Object.keys(snapshot.freshPrices).length)
    throw Error(snapshot.budgetExpired ? 'FC27_GALLERY_PLAN_PRICE_TIMEOUT' : 'FC27_GALLERY_PLAN_PRICE_UNAVAILABLE');
  return targets.map(target => ({ ...target, prices: { ...snapshot.freshPrices }, priceSnapshot: snapshot }));
}
