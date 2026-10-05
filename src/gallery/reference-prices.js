// Public quotes shared by Gallery and Puzzle. EA auctions are execution
// offers, never reference prices. No EA service is accessible from here.
import { normalizeGalleryPricePolicy, galleryReferenceQuote, publicPriceSourceEnabled, validPublicPrice as validPrice } from './public-price-policy.js';
export { normalizeGalleryPricePolicy, galleryReferenceQuote, PUBLIC_PRICE_POLICY_KEY } from './public-price-policy.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const reasonOf = error => /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_PUBLIC_PRICE_UNAVAILABLE';
const keyOf = (source, options, id) => `fcat-public-quotes-v2:${options.season}:${options.platform}:${source}:${id}`;

export function createGalleryReferencePrices({ readFutgg, readFutbin, get = async (_key, fallback) => fallback,
  set = async () => {}, now = () => Date.now(), ttlMs = 300000, failureTtlMs = 30000, diagnosticLog = null }) {
  const cache = new Map(), pending = new Map(), cooldowns = new Map();
  let queue = Promise.resolve();
  const valid = (row, source, options, id) => row?.schema === 2 && row.source === source
    && row.season === options.season && row.platform === options.platform && row.definitionId === id
    && (row.price === null || validPrice(row.price)) && timestamp(row.fetchedAt) && row.fetchedAt <= now()
    && timestamp(row.expiresAt) && row.expiresAt > row.fetchedAt
    && (row.sourceUpdatedAt === null || timestamp(row.sourceUpdatedAt) && row.sourceUpdatedAt <= row.fetchedAt)
    && (row.error === null || typeof row.error === 'string' && /^FC27_[A-Z0-9_]+$/.test(row.error));
  const record = fields => { try { Promise.resolve(diagnosticLog?.record?.({ area: 'pricing', event: 'public-quote', ...fields })).catch(() => {}); } catch { /* Optional diagnostics. */ } };
  const ensure = (source, ids, options, byId, current, force, progress) => {
    // Reserve exact per-version promises synchronously, before storage awaits,
    // so overlapping Gallery/Puzzle reads share the same in-flight request.
    const freshIds = ids.filter(id => !pending.has(keyOf(source, options, id)));
    if (freshIds.length) {
      const task = queue.catch(() => {}).then(async () => {
        current();
        const missing = [];
        for (const id of freshIds) {
          const key = keyOf(source, options, id);
          let saved = cache.get(key);
          if (!saved) { try { saved = await get(key, null); } catch { /* Optional quote cache. */ } }
          if (valid(saved, source, options, id) && saved.expiresAt > now() && (!force || saved.error)
              && !['FC27_PUBLIC_PRICE_PLAYER_INVALID', 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED', 'FC27_PUBLIC_PRICE_FUTGG_DISABLED'].includes(saved.error)) {
            cache.set(key, saved);
            if (saved.error) cooldowns.set(`${source}:${options.season}:${options.platform}`, { retryAt: saved.expiresAt, reason: saved.error });
          } else missing.push(id);
        }
        let completed = ids.length - missing.length;
        progress({ source, index: completed, total: ids.length });
        current();
        const batchSize = source === 'futgg' ? 50 : 1;
        for (let start = 0; start < missing.length; start += batchSize) {
          current();
          const batch = missing.slice(start, start + batchSize), cooldownKey = `${source}:${options.season}:${options.platform}`;
          let rows = [], error = null, retryAt = null;
          const cooldown = cooldowns.get(cooldownKey);
          try {
            if (cooldown?.retryAt > now()) { retryAt = cooldown.retryAt; throw Error(cooldown.reason); }
            rows = source === 'futgg' ? await readFutgg(batch, options)
              : [await readFutbin(batch[0], byId.get(batch[0]), options)].filter(Boolean);
            if (!Array.isArray(rows) || rows.some(row => !batch.includes(row?.definitionId)
                || row.price !== null && !validPrice(row.price)
                || row.sourceUpdatedAt != null && (!timestamp(row.sourceUpdatedAt) || row.sourceUpdatedAt > now()))
                || new Set(rows.map(row => row.definitionId)).size !== rows.length) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
          } catch (failure) {
            error = reasonOf(failure); rows = [];
            retryAt ??= Math.max(now() + failureTtlMs, timestamp(failure?.retryAt) ? failure.retryAt : 0);
            // Bad/missing player metadata is local to that version, not an
            // outage. Network/payload failures stop request storms per source.
            if (!['FC27_PUBLIC_PRICE_PLAYER_INVALID', 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED', 'FC27_PUBLIC_PRICE_FUTGG_DISABLED'].includes(error)) cooldowns.set(cooldownKey, { retryAt, reason: error });
          }
          const fetchedAt = now(), expiresAt = error ? retryAt : fetchedAt + ttlMs;
          for (const id of batch) {
            const value = rows.find(row => row.definitionId === id);
            const entry = { schema: 2, source, ...options, definitionId: id, price: value?.price ?? null,
              fetchedAt, sourceUpdatedAt: value?.sourceUpdatedAt ?? null, expiresAt, error };
            const key = keyOf(source, options, id); cache.set(key, entry);
            try { await set(key, structuredClone(entry)); } catch { /* Memory cache remains usable. */ }
            record({ source, status: error ? 'failed' : entry.price === null ? 'missing' : 'success', reason: error,
              definitionId: id, referencePrice: entry.price, fetchedAt, sourceUpdatedAt: entry.sourceUpdatedAt, expiresAt });
          }
          completed += batch.length; progress({ source, index: completed, total: ids.length });
        }
      });
      queue = task.catch(() => {});
      for (const id of freshIds) {
        const key = keyOf(source, options, id);
        const result = task.then(() => cache.get(key)).finally(() => pending.delete(key));
        pending.set(key, result);
      }
    }
    return Promise.all(ids.map(id => pending.get(keyOf(source, options, id))));
  };
  return Object.freeze({
    async load(ids, { season = '27', platform, rows = [], policy = {}, force = false,
      sources = ['futgg', 'futbin'], forceSources = [], purpose = 'gallery',
      isCurrent = () => true, onProgress = () => {} } = {}) {
      policy = normalizeGalleryPricePolicy(policy);
      if (season !== '27' || !['pc', 'console'].includes(platform) || !Array.isArray(ids)
          || ids.length > 250 || ids.some(id => !positive(id))
          || !Array.isArray(sources) || !sources.length || sources.some(source => !['futgg', 'futbin'].includes(source))
          || new Set(sources).size !== sources.length || !Array.isArray(forceSources)
          || forceSources.some(source => !['futgg', 'futbin'].includes(source))) throw Error('FC27_PUBLIC_PRICE_INPUT_INVALID');
      const current = () => { if (!isCurrent()) throw Error('FC27_PUBLIC_PRICE_CONTEXT_CHANGED'); };
      const progress = value => { try { onProgress(value); } catch { /* UI cannot alter price reads. */ } };
      current();
      const unique = [...new Set(ids)], byId = new Map(rows.map(row => [row.eaId ?? row.definitionId, row]));
      // Puzzle and purchase approval only need the selected authority. Gallery
      // keeps the default dual-source display for comparison. Unrequested
      // sources receive an explicit evidence row so downstream approval can
      // distinguish "not requested" from a missing/failed quote.
      const requested = [...new Set(sources)].filter(source => publicPriceSourceEnabled(policy, source));
      const forced = new Set(forceSources);
      if (force === true) for (const source of requested) forced.add(source);
      const quotes = {}, options = { season, platform };
      for (const source of requested) {
        progress({ source, index: 0, total: unique.length });
        quotes[source] = await ensure(source, unique, options, byId, current, forced.has(source), progress); current();
        progress({ source, index: unique.length, total: unique.length });
      }
      const prices = {}, references = {}; let expiresAt = null;
      for (const [index, id] of unique.entries()) {
        const pair = Object.fromEntries(['futgg', 'futbin'].map(source => [source,
          requested.includes(source) ? structuredClone(quotes[source][index]) : {
            schema: 2, source, ...options, definitionId: id, price: null, fetchedAt: now(),
            sourceUpdatedAt: null, expiresAt: now() + 1, error: 'FC27_PUBLIC_PRICE_SOURCE_NOT_REQUESTED'
          }]));
        const ref = galleryReferenceQuote(Object.fromEntries(Object.entries(pair).map(([source, row]) =>
          [source, row && !row.error && row.expiresAt > now() ? row.price : null])), policy);
        references[id] = { ...ref, definitionId: id, season, platform, quotes: pair };
        if (ref.estimate !== null) {
          prices[id] = ref.estimate;
          expiresAt = Math.min(expiresAt ?? Infinity, pair[policy.source].expiresAt);
        }
      }
      return { prices, freshPrices: prices, references, policy, requestedSources: requested,
        source: 'public-references', expiresAt,
        missingIds: unique.filter(id => !Object.hasOwn(prices, id)), staleIds: [], stale: false };
    },
  });
}
