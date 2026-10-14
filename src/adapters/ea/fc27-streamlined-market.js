import { readFc27Context, isFc27PlayerItem } from './fc27-local-read.js';
import { normalizeStreamlinedItem, integer, same, fail } from '../../streamlined/contract.js';
import { filterStreamlinedItems } from '../../streamlined/eligibility.js';
import { galleryReferenceQuote } from '../../gallery/public-price-policy.js';
import { streamlinedQuoteFailure, streamlinedQuoteCoverage, fatalStreamlinedQuoteFailure, validStreamlinedQuote } from '../../streamlined/quotes.js';

// The exact-id concept read follows the already observed Gallery native
// searchConceptItems contract. Entities remain in memory; no owned-item claim.
export function createFc27StreamlinedMarket(root, { catalog, prices, diagnosticLog = null, now = () => Date.now() }) {
  const cache = new Map(); let busy = false;
  const record = fields => {
    try { Promise.resolve(diagnosticLog?.record?.({ area: 'streamlined', event: 'market-quote-window', ...fields })).catch(() => {}); }
    catch { /* Diagnostics cannot alter planning. */ }
  };
  const request = criteria => new Promise((resolve, reject) => {
    const owner = {}; let observable, done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { observable?.unobserve(owner); } catch { /* Only our observer. */ }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(Error('FC27_STREAMLINED_MARKET_TIMEOUT')), 16000);
    try { observable = root.services.Item.searchConceptItems(criteria);
      observable.observe(owner, (_sender, reply) => finish(null, reply));
    } catch { finish(Error('FC27_STREAMLINED_MARKET_READ_FAILED')); }
  });
  return async ({ input, check = () => {}, onProgress = () => {}, quoteDeadlineAt = null, allowPartialQuotes = false }) => {
    if (busy) fail('BUSY'); busy = true;
    try {
      const assert = () => { check(); input.assertCurrent(); if (!same(readFc27Context(root), input.context)) fail('CONTEXT_CHANGED'); };
      assert();
      const result = await catalog.load({ ...input, check: assert, onProgress }); assert();
      if (!Array.isArray(result.ids) || result.ids.length > 3000) fail('MARKET_CANDIDATES_UNVERIFIED');
      if (root.GAME_NAME !== 'fc27' || typeof root.UTSearchCriteriaDTO !== 'function'
          || typeof root.services?.Item?.searchConceptItems !== 'function') fail('MARKET_RUNTIME_UNVERIFIED');
      const contextKey = JSON.stringify(input.context), entities = new Map(), missing = [];
      for (const id of result.ids) {
        const row = cache.get(`${contextKey}:${id}`);
        if (row && now() - row.at < 300000) entities.set(id, row.entity); else missing.push(id);
      }
      for (let start = 0; start < missing.length; start += 100) {
        const batch = missing.slice(start, start + 100), seen = new Set();
        for (let offset = 0; offset < 1000; offset += 250) {
          assert(); onProgress({ phase: 'market-validation', completed: start, total: missing.length });
          const criteria = new root.UTSearchCriteriaDTO();
          Object.assign(criteria, { type: root.SearchType.PLAYER, category: root.SearchCategory.ANY, defId: batch, count: 250, offset });
          const reply = await request(criteria); assert();
          if (reply?.success !== true || reply.status !== 200) fail(integer(reply?.status, 100, 599) ? `MARKET_HTTP_${reply.status}` : 'MARKET_RESPONSE_INVALID');
          const rows = (reply.response ?? reply.data)?.items;
          if (!Array.isArray(rows) || rows.length > 250) fail('MARKET_RESPONSE_INVALID');
          for (const entity of rows) {
            if (!integer(entity?.definitionId, 1)) fail('MARKET_IDENTITY_INVALID');
            if (!batch.includes(entity.definitionId)) continue; // EA may expand the database family.
            if (seen.has(entity.definitionId)) fail('MARKET_IDENTITY_INVALID');
            seen.add(entity.definitionId); entities.set(entity.definitionId, entity);
            cache.set(`${contextKey}:${entity.definitionId}`, { at: now(), entity });
          }
          if (rows.length < 250 || batch.every(id => seen.has(id))) break;
          if (offset === 750) fail('MARKET_READ_LIMIT');
        }
      }
      assert();
      const projected = [];
      for (const entity of entities.values()) {
        const cosmetics = entity.cosmetics, hyper = entity._hyperCosmeticDTOs;
        if (!isFc27PlayerItem(entity) || entity.concept !== true || entity.upgrades !== null
            || !Array.isArray(cosmetics) || !hyper || typeof hyper !== 'object'
            || cosmetics.length || Object.keys(hyper).length || !integer(entity.sbsScore, 1)
            || !integer(entity._rareflag, 0, 1)) continue;
        const item = normalizeStreamlinedItem({ source: 'market', definitionId: entity.definitionId,
          points: entity.sbsScore, scoreVerified: true, rating: entity._rating, leagueId: entity.leagueId,
          nationId: entity.nationId, teamId: entity.teamId, preferredPosition: entity.preferredPosition,
          special: Number(entity._rareflag) > 1, evolution: false, cosmetic: false, academyEnrolled: false, protected: Number(entity._rareflag) > 1,
          name: entity.name ?? entity.lastName ?? null });
        input.registerMarketEntity(item, entity); projected.push(item);
      }
      const filtered = filterStreamlinedItems(projected, input);
      if (filtered.status !== 'observed') throw Error(filtered.reason);
      const references = {}, quotesStartedAt = now(); let pricePolicy = null, quoteReadError = null;
      for (let start = 0; start < filtered.items.length; start += 250) {
        assert(); onProgress({ phase: 'market-quotes', completed: start, total: filtered.items.length });
        const batch = filtered.items.slice(start, start + 250);
        const snapshot = await prices.load(batch.map(row => row.definitionId), { purpose: 'puzzle', futbinBatch: true, deadlineAt: quoteDeadlineAt,
          onProgress: p => onProgress({ phase: 'market-quotes', source: p.source,
            completed: start + p.index, total: filtered.items.length }),
          rows: batch.map(item => { const raw = entities.get(item.definitionId); return { definitionId: item.definitionId,
            rating: item.rating, nationId: raw.nationId, leagueId: raw.leagueId, teamId: raw.teamId, preferredPosition: raw.preferredPosition }; }),
          isCurrent: () => { assert(); return true; } });
        assert();
        if (pricePolicy && !same(pricePolicy, snapshot.policy)) fail('PRICE_POLICY_CHANGED');
        pricePolicy = snapshot.policy; Object.assign(references, snapshot.references);
        // A cached quote can be valid when this batch starts and expire while
        // the remaining FUTBIN versions are fetched. Strict callers still stop
        // on source errors; planning can explicitly retain the verified subset.
        const quoteError = streamlinedQuoteFailure(snapshot.references, pricePolicy.source,
          batch.map(row => row.definitionId), now(), { requireFresh: false });
        if (fatalStreamlinedQuoteFailure(quoteError)) throw Error(quoteError);
        quoteReadError ??= quoteError ?? (snapshot.budgetExpired ? 'FC27_STREAMLINED_QUOTE_BUDGET' : null);
        if (quoteReadError && (!allowPartialQuotes || fatalStreamlinedQuoteFailure(quoteReadError))) throw Error(quoteReadError);
      }

      const ids = filtered.items.map(row => row.definitionId), checkedAt = now();
      // Cover another read-sized wait, not only quotes already expired. A
      // second cache cohort can otherwise expire during the refresh itself.
      // This is a refresh threshold, never an extension of quote validity.
      const refreshWindowMs = Math.max(0, checkedAt - quotesStartedAt);
      const staleIds = ids.filter(id => {
        const quote = references[id]?.quotes?.[pricePolicy?.source];
        return quote?.price != null && Number.isSafeInteger(quote.expiresAt) && quote.expiresAt <= checkedAt + refreshWindowMs;
      });
      if (staleIds.length) record({ source: pricePolicy.source, phase: 'refresh', status: 'started',
        requestedCount: ids.length, count: staleIds.length, durationMs: refreshWindowMs });
      for (let start = 0; start < staleIds.length; start += 250) {
        assert();
        const batch = staleIds.slice(start, start + 250);
        onProgress({ phase: 'market-quotes', source: pricePolicy.source, completed: start,
          total: staleIds.length, refresh: true });
        const refresh = await prices.load(batch, { purpose: 'puzzle', futbinBatch: true, deadlineAt: quoteDeadlineAt, forceSources: [pricePolicy.source],
          rows: batch.map(id => {
            const raw = entities.get(id);
            return { definitionId: id, rating: raw?._rating, nationId: raw?.nationId,
              leagueId: raw?.leagueId, teamId: raw?.teamId, preferredPosition: raw?.preferredPosition };
          }),
          onProgress: p => onProgress({ phase: 'market-quotes', source: p.source,
            completed: start + p.index, total: staleIds.length, refresh: true }),
          isCurrent: () => { assert(); return true; } });
        assert();
        if (!same(pricePolicy, refresh.policy)) fail('PRICE_POLICY_CHANGED');
        Object.assign(references, refresh.references);
        const refreshError = streamlinedQuoteFailure(refresh.references, pricePolicy.source, batch, now(), { requireFresh: false });
        if (fatalStreamlinedQuoteFailure(refreshError)) throw Error(refreshError);
        quoteReadError ??= refreshError ?? (refresh.budgetExpired ? 'FC27_STREAMLINED_QUOTE_BUDGET' : null);
        if (quoteReadError && (!allowPartialQuotes || fatalStreamlinedQuoteFailure(quoteReadError))) throw Error(quoteReadError);
      }
      const quoteAt = now();
      const quoteError = streamlinedQuoteFailure(references, pricePolicy?.source, ids, quoteAt);
      if (quoteError) {
        const invalidIds = ids.filter(id => streamlinedQuoteFailure(references, pricePolicy?.source, [id], quoteAt));
        for (const id of invalidIds.slice(0, 3)) {
          const quote = references[id]?.quotes?.[pricePolicy?.source];
          record({ source: pricePolicy?.source, phase: 'validate', status: 'failed', reason: quoteError,
            requestedCount: ids.length, count: invalidIds.length, definitionId: id, fetchedAt: quote?.fetchedAt,
            expiresAt: quote?.expiresAt, durationMs: Math.max(0, quoteAt - quotesStartedAt) });
        }
        quoteReadError ??= quoteError;
        if (!allowPartialQuotes) throw Error(quoteError);
      }
      const quoteCoverage = streamlinedQuoteCoverage(references, pricePolicy?.source, ids, quoteAt);
      record({ source: pricePolicy?.source, phase: 'coverage', status: quoteCoverage.valid === ids.length ? 'success' : quoteCoverage.valid ? 'partial' : 'failed',
        requestedCount: ids.length, count: quoteCoverage.valid, unknownCount: quoteCoverage.failed + quoteCoverage.missing,
        reason: quoteReadError, durationMs: Math.max(0, quoteAt - quotesStartedAt) });
      const market = [];
      for (const item of filtered.items) {
        const quote = references[item.definitionId]?.quotes?.[pricePolicy.source];
        if (validStreamlinedQuote(quote, pricePolicy.source, item.definitionId, quoteAt) && integer(quote.price, 150, 15000000)) {
          const authority = galleryReferenceQuote({ [pricePolicy.source]: quote.price }, pricePolicy);
          if (!integer(authority.maxBuy, 150, 15000000)) continue;
          const raw = entities.get(item.definitionId);
          market.push({ ...item, price: quote.price, purchaseMaxBuy: authority.maxBuy, quote,
            priceReference: references[item.definitionId], pricePolicy,
            nationId: raw.nationId, teamId: raw.teamId, preferredPosition: raw.preferredPosition });
        }
      }
      onProgress({ phase: 'market-quotes', source: pricePolicy?.source, completed: filtered.items.length, total: filtered.items.length });
      return { market, references, pricePolicy, quoteReadError, quoteCoverage, complete: false, candidateCount: projected.length };
    } finally { busy = false; }
  };
}
