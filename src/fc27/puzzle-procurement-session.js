import { findFc27PuzzleRepairSeed, planFc27PuzzleRepairQueries, suggestFc27PuzzlePurchases } from './puzzle-procurement.js';
import { traditionalJournalScope } from './traditional-journal.js';

const safeReason = error => /^FC27_[A-Z0-9_]{1,100}$/.test(error?.message ?? '') ? error.message : 'FC27_PURCHASE_READ_FAILED';
const stop = reason => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false, plans: [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => Number.isSafeInteger(value) && value > 0;

// Injected read-only transport, durable per-query memo, no purchase/fill seam.
// Persist attempts before sending: repeated clicks and reloads reuse evidence
// or retain the recorded failure rather than automatically retrying EA.
export function createFc27PuzzleProcurementSession({ createTransport, get, set, now = Date.now } = {}) {
  let busy = false;
  return Object.freeze({ async plan(input, { assertCurrent = () => {} } = {}) {
    if (busy) return stop('FC27_PURCHASE_BUSY');
    busy = true;
    let requests = 0; let cacheHits = 0; let transport;
    try {
      const scope = traditionalJournalScope(input.context);
      assertCurrent();
      const seed = findFc27PuzzleRepairSeed(input);
      if (seed.status !== 'ready') return seed;
      const route = planFc27PuzzleRepairQueries(input, seed);
      if (route.status !== 'ready') return route;
      const cachedRead = async (kind, query) => {
        assertCurrent();
        const key = `fcat-fc27-puzzle-market:${scope}:${kind}:${JSON.stringify(query)}`;
        const stored = await get(key, null);
        assertCurrent();
        if (stored !== null) {
          if (stored?.schema !== 1 || stored.kind !== kind || !same(stored.query, query)
              || !id(stored.at) || stored.at > now()) throw new Error('FC27_PURCHASE_CACHE_UNVERIFIED');
          if (stored.state !== 'observed') throw new Error(stored.reason ?? 'FC27_PURCHASE_READ_UNCONFIRMED');
          if (now() - stored.at > (kind === 'catalog' ? 86400000 : 600000)) throw new Error('FC27_PURCHASE_CACHE_EXPIRED');
          cacheHits++; return structuredClone(stored.result);
        }
        const record = { schema: 1, kind, query, at: now(), state: 'pending' };
        await set(key, record);
        if (!same(await get(key, null), record)) throw new Error('FC27_PURCHASE_CACHE_UNVERIFIED');
        assertCurrent();
        try {
          transport ??= await createTransport();
          assertCurrent(); requests++;
          const result = await (kind === 'catalog' ? transport.readCatalogPage(query) : transport.readQuotePage(query));
          await set(key, { ...record, state: 'observed', result });
          assertCurrent(); return result;
        } catch (error) {
          await set(key, { ...record, state: 'blocked', reason: safeReason(error) });
          throw error;
        }
      };
      const entries = new Map(); const quotes = new Map(); const usedQueries = [];
      let lastSuggestion;
      for (const query of route.queries) {
        const page = await cachedRead('catalog', query); usedQueries.push(query);
        if (page?.status !== 'observed' || page.season !== '27' || page.source !== 'ea-defid'
            || !same(page.query, query) || !id(page.observedAt) || page.observedAt > now()
            || now() - page.observedAt > 86400000 || !Array.isArray(page.entries) || page.entries.length > query.count
            || new Set(page.entries.map(item => item?.definitionId)).size !== page.entries.length) throw new Error('FC27_PURCHASE_CATALOG_UNVERIFIED');
        for (const entry of page.entries) {
          if (entries.has(entry.definitionId) && !same(entries.get(entry.definitionId), entry)) throw new Error('FC27_PURCHASE_CATALOG_CHANGED');
          entries.set(entry.definitionId, entry);
        }
        assertCurrent();
        lastSuggestion = suggestFc27PuzzlePurchases(input, seed, [...entries.values()]);
        const plans = lastSuggestion.plans ?? [];
        for (const plan of plans) for (const item of plan.purchases) {
          if (quotes.has(item.definitionId) || quotes.size >= 4) continue;
          const quote = await cachedRead('quote', { definitionId: item.definitionId, start: 0, count: 20, maxBuy: 2000 });
          if (quote?.status !== 'observed' || quote.season !== '27' || quote.platform !== input.context.platform
              || quote.source !== 'ea-visible-buy-now' || quote.definitionId !== item.definitionId
              || !id(quote.observedAt) || quote.observedAt > now() || now() - quote.observedAt > 600000
              || !Number.isInteger(quote.eligible) || quote.eligible < 0 || quote.eligible > 20
              || (quote.eligible === 0 ? quote.price !== null : !Number.isInteger(quote.price) || quote.price < 150 || quote.price > 2000)) {
            throw new Error('FC27_PURCHASE_QUOTE_UNVERIFIED');
          }
          quotes.set(item.definitionId, quote);
        }
        const priced = plans.filter(plan => plan.purchases.every(item => quotes.get(item.definitionId)?.price > 0))
          .map(plan => ({ ...plan, purchases: plan.purchases.map(item => ({ ...item,
            observedBuyNow: quotes.get(item.definitionId).price, quotedAt: quotes.get(item.definitionId).observedAt })),
          estimatedCost: plan.purchases.reduce((sum, item) => sum + quotes.get(item.definitionId).price, 0) }))
          .sort((a, b) => a.purchaseCount - b.purchaseCount || a.estimatedCost - b.estimatedCost);
        if (priced.length) return { status: 'suggested', reason: 'FC27_PURCHASE_PLAN_PRICED', executable: false,
          liveExecutionEnabled: false, plans: priced.slice(0, 3), requests, cacheHits, queries: usedQueries,
          seedChemistry: seed.teamFacts.chemistry, requiredChemistry: seed.requiredChemistry,
          quoteCeiling: 2000, affordabilityVerified: false, globalMinimumProven: false,
          pending: ['EXPLICIT_PURCHASE_AND_MATERIAL_APPROVAL', 'LIVE_AUCTION_RECHECK', 'EXACT_PURCHASE_RECEIPTS', 'FRESH_INVENTORY_REPLAN'] };
      }
      return { ...stop(lastSuggestion?.plans?.length ? 'FC27_PURCHASE_QUOTES_UNAVAILABLE' : 'FC27_PURCHASE_REPAIR_NO_PLAN'), requests, cacheHits, queries: usedQueries };
    } catch (error) { return { ...stop(safeReason(error)), requests, cacheHits }; }
    finally { busy = false; }
  } });
}
