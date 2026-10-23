const RETRY_MS = [1000, 2000];
const tradeId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const retryable = new Set(['transfer-refresh', 'item-unavailable', 'item-pile', 'auction-none', 'auction-inactive', 'auction-unknown', 'trade-id']);

// Exact owned entity + frozen prices still apply. A closed auction is evidence
// of a completed listing, NOT proof of a sale. Require a durable positive listing
// acknowledgement for that case; absence/expiry alone never clears an unknown.
export function galleryListingEvidence(entry, seen) {
  const candidate = seen?.candidate, auction = candidate?.auction;
  if (seen?.status !== 'loaded' || !candidate) return { mismatch: 'item-unavailable' };
  if (candidate.item?.id !== entry.item.id || candidate.item.definitionId !== entry.item.definitionId) return { mismatch: 'item-identity' };
  if (candidate.item.pile !== 'transfer') return { mismatch: 'item-pile' };
  if (entry.action === 'transfer') return ['none', 'inactive'].includes(auction?.state)
    ? { matched: true } : { mismatch: 'transfer-not-idle' };
  const closedAcknowledged = auction?.state === 'closed' && entry.response?.success === true
    && Number.isSafeInteger(entry.response.status) && entry.response.status >= 200 && entry.response.status < 300;
  if (auction?.state !== 'active' && !closedAcknowledged) return {
    mismatch: ['none', 'inactive', 'closed', 'unknown'].includes(auction?.state) ? `auction-${auction.state}` : 'auction-unknown',
  };
  if (auction.startingBid !== entry.startPrice) return { mismatch: 'starting-bid' };
  if (auction.buyNowPrice !== entry.buyNow) return { mismatch: 'buy-now' };
  if (typeof auction.tradeId === 'number' && !Number.isSafeInteger(auction.tradeId)
      || !tradeId(String(auction.tradeId ?? ''))) return { mismatch: 'trade-id' };
  return { matched: true, listingTradeId: String(auction.tradeId), listingState: auction.state };
}

// Only refresh/inspect: no list/move/permit method is called, on any retry or
// recovery path. All pending entries share at most three Transfer refreshes.
export async function reconcileGalleryListings(entries, { adapter, assertCurrent = () => {}, shouldStop = () => false,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onCheck = () => {} } = {}) {
  const pending = new Set(entries); let confirmed = 0;
  for (let attempt = 1; pending.size && attempt <= 3; attempt++) {
    if (attempt > 1) {
      if (shouldStop()) break;
      await sleep(RETRY_MS[attempt - 2]); assertCurrent();
      if (shouldStop()) break;
    }
    assertCurrent(); let fresh;
    try { fresh = await adapter.refreshTransferItems(); }
    catch (error) {
      if (/^FC27_/.test(error?.message ?? '')) throw error;
      fresh = { status: 'error', error: { code: Number(error?.status ?? error?.code) || null } };
    }
    assertCurrent();
    const httpStatus = Number(fresh?.error?.code ?? fresh?.response?.status) || null;
    const hardStop = fresh?.status === 'unsupported' || httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408
      || ['rate-limit', 'session-expired', 'permission-denied', 'auction-operation-blocked', 'captcha', 'stopped-by-user'].includes(fresh?.error?.kind);
    const readable = fresh?.status === 'completed' && !hardStop && !(httpStatus >= 400) && fresh?.response?.success !== false;
    let canRetry = false;
    for (const entry of pending) {
      const evidence = readable
        ? galleryListingEvidence(entry, adapter.inspectListingItem({ ...entry.item, pile: 'transfer' })) : { mismatch: 'transfer-refresh' };
      assertCurrent();
      // Report the check, not a durable accepted count: the caller persists
      // the confirmed entry before publishing its accepted progress event.
      try { onCheck({ attempt, attemptLimit: 3, status: evidence.matched ? 'success' : 'unconfirmed',
        mismatch: evidence.mismatch ?? 'matched', ...(httpStatus ? { httpStatus } : {}) }); } catch { /* Counts/reasons only. */ }
      if (evidence.matched) {
        if (entry.action !== 'transfer') {
          entry.listingTradeId = evidence.listingTradeId; entry.listingState = evidence.listingState;
        }
        entry.status = 'accepted'; entry.reason = null; pending.delete(entry); confirmed++;
      } else canRetry ||= retryable.has(evidence.mismatch);
    }
    if (hardStop || !canRetry || shouldStop()) break;
  }
  return { complete: pending.size === 0, confirmed };
}
