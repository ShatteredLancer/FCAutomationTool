// A normal missing price is distinct from a source failure or stale price.
// Neither may silently become a valid, zero-cost candidate.
export const STREAMLINED_QUOTE_BUDGET_MS = 90000;
export const fatalStreamlinedQuoteFailure = reason => /(?:CONTEXT_CHANGED|CANCELLED|PRICE_POLICY_CHANGED|_DISABLED|INPUT_INVALID)$/.test(reason ?? '');

export function streamlinedQuoteCoverage(references, source, ids, at) {
  const result = { requested: new Set(ids).size, valid: 0, failed: 0, missing: 0 };
  for (const id of new Set(ids)) {
    if (validStreamlinedQuote(references[id]?.quotes?.[source], source, id, at)) result.valid++;
    else if (references[id]?.quotes?.[source]?.error) result.failed++;
    else result.missing++;
  }
  return result;
}

export function validStreamlinedQuote(q, source, id, at) {
  return q?.definitionId === id && q.source === source && !q.error
    && Number.isSafeInteger(q.price) && q.price > 0 && q.price <= 15000000
    && Number.isSafeInteger(q.fetchedAt) && q.fetchedAt <= at
    && Number.isSafeInteger(q.expiresAt) && q.expiresAt > at;
}

export function streamlinedQuoteFailure(references, source, ids, at, { requireFresh = true } = {}) {
  let failure = null;
  for (const id of ids) {
    const quote = references[id]?.quotes?.[source];
    if (quote?.error && quote.error !== 'FC27_PUBLIC_PRICE_PLAYER_INVALID') {
      if (fatalStreamlinedQuoteFailure(quote.error)) return quote.error;
      failure ??= quote.error;
    }
    if (requireFresh && quote?.price != null && (quote.fetchedAt > at || quote.expiresAt <= at)) failure ??= 'FC27_STREAMLINED_QUOTES_EXPIRED';
  }
  return failure;
}
