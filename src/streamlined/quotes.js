// A normal missing price is distinct from a source failure or stale price.
// Neither may silently become a valid, zero-cost candidate.
export function streamlinedQuoteFailure(references, source, ids, at, { requireFresh = true } = {}) {
  for (const id of ids) {
    const quote = references[id]?.quotes?.[source];
    if (quote?.error && quote.error !== 'FC27_PUBLIC_PRICE_PLAYER_INVALID') return quote.error;
    if (requireFresh && quote?.price != null && (quote.fetchedAt > at || quote.expiresAt <= at)) return 'FC27_STREAMLINED_QUOTES_EXPIRED';
  }
  return null;
}
