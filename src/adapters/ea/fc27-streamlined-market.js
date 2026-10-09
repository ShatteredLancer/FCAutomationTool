import { readFc27Context, isFc27PlayerItem } from './fc27-local-read.js';
import { normalizeStreamlinedItem, integer, same, fail } from '../../streamlined/contract.js';
import { filterStreamlinedItems } from '../../streamlined/eligibility.js';
import { galleryReferenceQuote } from '../../gallery/public-price-policy.js';

// The exact-id concept read follows the already observed Gallery native
// searchConceptItems contract. Entities remain in memory; no owned-item claim.
export function createFc27StreamlinedMarket(root, { catalog, prices, now = () => Date.now() }) {
  const cache = new Map(); let busy = false;
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
  return async ({ input, check = () => {}, onProgress = () => {} }) => {
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
      const market = [], references = {}; let pricePolicy = null;
      for (let start = 0; start < filtered.items.length; start += 250) {
        assert(); onProgress({ phase: 'market-quotes', completed: start, total: filtered.items.length });
        const batch = filtered.items.slice(start, start + 250);
        const snapshot = await prices.load(batch.map(row => row.definitionId), { purpose: 'puzzle',
          rows: batch.map(item => { const raw = entities.get(item.definitionId); return { definitionId: item.definitionId,
            rating: item.rating, nationId: raw.nationId, leagueId: raw.leagueId, teamId: raw.teamId, preferredPosition: raw.preferredPosition }; }),
          isCurrent: () => { assert(); return true; } });
        assert();
        if (pricePolicy && !same(pricePolicy, snapshot.policy)) fail('PRICE_POLICY_CHANGED');
        pricePolicy = snapshot.policy; Object.assign(references, snapshot.references);
        for (const item of batch) {
          const quote = snapshot.references[item.definitionId]?.quotes?.[pricePolicy.source];
          if (!quote?.error && integer(quote?.price, 150, 15000000) && quote.fetchedAt <= now() && quote.expiresAt > now()) {
            const values = { [pricePolicy.source]: quote.price };
            const authority = galleryReferenceQuote(values, pricePolicy);
            if (!integer(authority.maxBuy, 150, 15000000)) continue;
            const raw = entities.get(item.definitionId);
            market.push({ ...item, price: quote.price, purchaseMaxBuy: authority.maxBuy, quote,
              priceReference: snapshot.references[item.definitionId], pricePolicy,
              nationId: raw.nationId, teamId: raw.teamId, preferredPosition: raw.preferredPosition });
          }
        }
      }
      return { market, references, pricePolicy, complete: false, candidateCount: projected.length };
    } finally { busy = false; }
  };
}
