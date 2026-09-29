import { findFc27PuzzleRepairSeed, planFc27PuzzleRepairQueries, suggestFc27PuzzlePurchases,
  planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchases } from './puzzle-procurement.js';
import { prepareFc27PuzzleConceptPlan } from './puzzle-concept-plan.js';
import { traditionalJournalScope } from './traditional-journal.js';
import { DEFAULT_PUZZLE_QUOTE_CEILING, MAX_PUZZLE_QUOTE_PRICE, PUZZLE_MARKET_READ_LIMIT, isPuzzleQuoteCeiling } from './puzzle-procurement-policy.js';

const safeReason = error => /^FC27_[A-Z0-9_]{1,100}$/.test(error?.message ?? '') ? error.message : 'FC27_PURCHASE_READ_FAILED';
const stop = reason => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false, plans: [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => Number.isSafeInteger(value) && value > 0;
const AUTH_RETRY_DELAY = 30000;
const failureDetails = (reason, value) => {
  const match = /^FC27_MARKET_HTTP_([1-5]\d{2})$/.exec(reason);
  const eaCode = Object.getOwnPropertyDescriptor(value ?? {}, 'eaCode')?.value;
  return { httpStatus: match ? Number(match[1]) : null,
    eaCode: Number.isSafeInteger(eaCode) && eaCode >= 0 && eaCode <= 0x7fffffff ? eaCode : null };
};

// Injected read-only transport, durable per-query memo, no purchase/fill seam.
// Persist attempts before sending: repeated clicks and reloads reuse evidence
// or retain the recorded failure rather than automatically retrying EA.
// A new user action may renew an expired success or an explicit HTTP 401 after
// cooldown. No same-action retry; pending and other failures stay blocked.
// The caller holds the account lock across this operation.
export function createFc27PuzzleProcurementSession({ createTransport, get, set, now = Date.now } = {}) {
  let busy = false;
  return Object.freeze({ async plan(input, { assertCurrent = () => {}, quoteCeiling = DEFAULT_PUZZLE_QUOTE_CEILING } = {}) {
    if (busy) return stop('FC27_PURCHASE_BUSY');
    busy = true;
    let requests = 0; let cacheHits = 0; let transport;
    const diagnostics = { stage: 'repair-seed', route: null, catalogPages: 0, catalogCandidates: 0,
      usableCandidates: null, unpricedPlans: 0, localReason: null, checks: null, nodes: null,
      truncated: null, catalogAttempts: 0, quoteAttempts: 0,
      authRecoveries: 0, failureSource: null, httpStatus: null, eaCode: null, retryAfterSeconds: null,
      excludedUnavailable: 0, replans: 0 };
    const finish = result => ({ ...result, quoteCeiling, requests, cacheHits, diagnostics: { ...diagnostics, cacheHits } });
    try {
      if (!isPuzzleQuoteCeiling(quoteCeiling)) return finish(stop('FC27_PURCHASE_PRICE_LIMIT_INVALID'));
      const scope = traditionalJournalScope(input.context);
      assertCurrent();
      const seed = findFc27PuzzleRepairSeed(input);
      if (seed.status !== 'ready' && seed.reason !== 'FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE') return finish(seed);
      diagnostics.route = seed.status === 'ready' ? 'repair' : 'joint';
      diagnostics.stage = 'query-planning';
      const route = seed.status === 'ready' ? planFc27PuzzleRepairQueries(input, seed) : planFc27PuzzleShortageQueries(input);
      if (route.status !== 'ready') return finish(route);
      const cachedRead = async (kind, query) => {
        diagnostics.stage = kind === 'catalog' ? 'catalog-read' : 'quote-read';
        assertCurrent();
        const key = `fcat-fc27-puzzle-market:${scope}:${kind}:${JSON.stringify(query)}`;
        const stored = await get(key, null);
        assertCurrent();
        if (stored !== null) {
          if (stored?.schema !== 1 || stored.kind !== kind || !same(stored.query, query)
              || !id(stored.at) || stored.at > now()) throw new Error('FC27_PURCHASE_CACHE_UNVERIFIED');
          if (stored.state !== 'observed') {
            const reason = safeReason({ message: stored.reason ?? 'FC27_PURCHASE_READ_UNCONFIRMED' });
            const authFailure = stored.state === 'blocked' && reason === 'FC27_MARKET_HTTP_401';
            const remaining = Math.max(0, stored.at + AUTH_RETRY_DELAY - now());
            if (!authFailure || remaining > 0) {
              Object.assign(diagnostics, failureDetails(reason, stored.details), { failureSource: 'cache',
                retryAfterSeconds: authFailure ? Math.ceil(remaining / 1000) : null });
              throw new Error(reason);
            }
            diagnostics.authRecoveries++;
          } else {
            const ttl = kind === 'catalog' ? 86400000 : 600000;
            if (!id(stored.result?.observedAt) || stored.result.observedAt > now()) throw new Error('FC27_PURCHASE_CACHE_UNVERIFIED');
            if (now() - Math.min(stored.at, stored.result.observedAt) <= ttl) {
              cacheHits++; return structuredClone(stored.result);
            }
          }
        }
        // Budget exhaustion is not an attempted/ambiguous read. Never poison
        // the cache with a failure for a query that has not been sent.
        if (requests >= PUZZLE_MARKET_READ_LIMIT) throw new Error('FC27_PURCHASE_READ_BUDGET');
        const record = { schema: 1, kind, query, at: now(), state: 'pending' };
        await set(key, record);
        if (!same(await get(key, null), record)) throw new Error('FC27_PURCHASE_CACHE_UNVERIFIED');
        assertCurrent();
        let attempted = false;
        try {
          transport ??= await createTransport({ maxRequests: PUZZLE_MARKET_READ_LIMIT });
          assertCurrent(); requests++;
          diagnostics[kind === 'catalog' ? 'catalogAttempts' : 'quoteAttempts']++;
          attempted = true;
          const result = await (kind === 'catalog' ? transport.readCatalogPage(query) : transport.readQuotePage(query));
          await set(key, { ...record, state: 'observed', result });
          assertCurrent(); return result;
        } catch (error) {
          const reason = safeReason(error);
          const details = failureDetails(reason, Object.getOwnPropertyDescriptor(error ?? {}, 'marketFailure')?.value);
          Object.assign(diagnostics, details, { failureSource: attempted ? 'request' : 'transport',
            retryAfterSeconds: reason === 'FC27_MARKET_HTTP_401' ? AUTH_RETRY_DELAY / 1000 : null });
          await set(key, { ...record, at: now(), state: 'blocked', reason, details });
          throw error;
        }
      };
      const entries = new Map(); const quotes = new Map(); const usedQueries = [];
      const unavailable = new Set(); let hadPlans = false;
      let pendingQueries = route.queries.slice();
      while (pendingQueries.length && usedQueries.length < 3) {
        const query = pendingQueries.shift();
        const page = await cachedRead('catalog', query); usedQueries.push(query);
        if (page?.status !== 'observed' || page.season !== '27' || page.source !== 'ea-defid'
            || !same(page.query, query) || !id(page.observedAt) || page.observedAt > now()
            || now() - page.observedAt > 86400000 || !Array.isArray(page.entries) || page.entries.length > query.count
            || new Set(page.entries.map(item => item?.definitionId)).size !== page.entries.length) throw new Error('FC27_PURCHASE_CATALOG_UNVERIFIED');
        for (const entry of page.entries) {
          if (entries.has(entry.definitionId) && !same(entries.get(entry.definitionId), entry)) throw new Error('FC27_PURCHASE_CATALOG_CHANGED');
          entries.set(entry.definitionId, entry);
        }
        diagnostics.catalogPages++;
        diagnostics.catalogCandidates = entries.size;
        // Each unsuccessful pass removes at least one public version from the
        // bounded catalog. Re-solve locally before requesting another page.
        for (;;) {
          assertCurrent(); diagnostics.stage = 'local-market-search';
          const available = [...entries.values()].filter(item => !unavailable.has(item.definitionId));
          const suggestion = seed.status === 'ready' ? suggestFc27PuzzlePurchases(input, seed, available)
            : suggestFc27PuzzleJointPurchases(input, available);
          diagnostics.usableCandidates = suggestion.marketCandidates ?? null;
          diagnostics.localReason = suggestion.reason ?? null;
          diagnostics.checks = suggestion.checks ?? null;
          diagnostics.nodes = suggestion.nodes ?? null;
          diagnostics.truncated = suggestion.truncated ?? null;
          const plans = suggestion.plans ?? [];
          diagnostics.unpricedPlans = plans.length; hadPlans ||= plans.length > 0;
          let removed = false;
          for (const plan of plans) {
            for (const item of plan.purchases) {
              if (!quotes.has(item.definitionId)) {
                const quote = await cachedRead('quote', { definitionId: item.definitionId, start: 0, count: 20, maxBuy: quoteCeiling });
                if (quote?.status !== 'observed' || quote.season !== '27' || quote.platform !== input.context.platform
                    || quote.source !== 'ea-visible-buy-now' || quote.definitionId !== item.definitionId
                    || !id(quote.observedAt) || quote.observedAt > now() || now() - quote.observedAt > 600000
                    || !Number.isInteger(quote.eligible) || quote.eligible < 0 || quote.eligible > 20
                    || (quote.eligible === 0 ? quote.price !== null : !Number.isInteger(quote.price) || quote.price < 150
                      || quote.price > (quoteCeiling ?? MAX_PUZZLE_QUOTE_PRICE))) throw new Error('FC27_PURCHASE_QUOTE_UNVERIFIED');
                quotes.set(item.definitionId, quote);
              }
              if (quotes.get(item.definitionId).price === null) {
                unavailable.add(item.definitionId); removed = true; break;
              }
            }
            // Stop as soon as a complete valid plan has fresh prices.
            if (plan.purchases.every(item => quotes.get(item.definitionId)?.price > 0)) break;
          }
          diagnostics.excludedUnavailable = unavailable.size;
          const priced = plans.filter(plan => plan.purchases.every(item => quotes.get(item.definitionId)?.price > 0))
            .map(plan => ({ ...plan, purchases: plan.purchases.map(item => ({ ...item,
              observedBuyNow: quotes.get(item.definitionId).price, quotedAt: quotes.get(item.definitionId).observedAt })),
            estimatedCost: plan.purchases.reduce((sum, item) => sum + quotes.get(item.definitionId).price, 0) }))
            .sort((a, b) => a.purchaseCount - b.purchaseCount || a.estimatedCost - b.estimatedCost);
          if (priced.length) return finish({ status: 'suggested', reason: 'FC27_PURCHASE_PLAN_PRICED', executable: false,
            liveExecutionEnabled: false, plans: priced.slice(0, 3).map(plan => ({ ...plan,
              conceptPlan: prepareFc27PuzzleConceptPlan({ challenge: input.challenge, plan: { ...plan, status: 'preview',
                setId: input.challenge.setId, challengeId: input.challenge.id } }) })), requests, cacheHits, queries: usedQueries,
            seedChemistry: seed.teamFacts?.chemistry ?? null, requiredChemistry: seed.requiredChemistry ?? null,
            quoteCeiling, affordabilityVerified: false, globalMinimumProven: false,
            pending: ['EXPLICIT_PURCHASE_AND_MATERIAL_APPROVAL', 'LIVE_AUCTION_RECHECK', 'EXACT_PURCHASE_RECEIPTS', 'FRESH_INVENTORY_REPLAN'] });
          if (!removed) break;
          diagnostics.replans++;
        }
        if (seed.status !== 'ready' && usedQueries.length < 3) {
          const nextRoute = planFc27PuzzleShortageQueries(input, [...entries.values()]);
          if (nextRoute.status !== 'ready') return finish(nextRoute);
          pendingQueries = [...nextRoute.queries, ...pendingQueries].filter((candidate, index, all) =>
            !usedQueries.some(used => same(used, candidate)) && all.findIndex(other => same(other, candidate)) === index);
        }
      }
      const searchLimited = diagnostics.localReason === 'FC27_PUZZLE_SEARCH_LIMIT'
        || diagnostics.truncated === true && diagnostics.unpricedPlans === 0;
      return finish({ ...stop(searchLimited ? 'FC27_PUZZLE_SEARCH_LIMIT'
        : hadPlans ? 'FC27_PURCHASE_QUOTES_UNAVAILABLE' : 'FC27_PURCHASE_REPAIR_NO_PLAN'), queries: usedQueries });
    } catch (error) { return finish(stop(safeReason(error))); }
    finally { busy = false; }
  } });
}
