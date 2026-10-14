// Public quotes shared by Gallery and Puzzle. EA auctions are execution
// offers, never reference prices. No EA service is accessible from here.
import { normalizeGalleryPricePolicy, galleryReferenceQuote, publicPriceSourceEnabled, validPublicPrice as validPrice } from './public-price-policy.js';
export { normalizeGalleryPricePolicy, galleryReferenceQuote, PUBLIC_PRICE_POLICY_KEY } from './public-price-policy.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const reasonOf = error => /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_PUBLIC_PRICE_UNAVAILABLE';
const platformSuffix = (source, options) => source === 'futbin' && options.futbinPlatform ? `:${options.futbinPlatform}` : '';
const keyOf = (source, options, id) => `fcat-public-quotes-v2:${options.season}:${options.platform}:${source}:${id}${platformSuffix(source, options)}`;
const cooldownKeyOf = (source, options) => `${source}:${options.season}:${options.platform}${platformSuffix(source, options)}`;

export function createGalleryReferencePrices({ readFutgg, readFutbin, readFutbinBatch = null, get = async (_key, fallback) => fallback,
  set = async () => {}, now = () => Date.now(), ttlMs = 300000, failureTtlMs = 30000, diagnosticLog = null }) {
  const cache = new Map(), pending = new Map(), cooldowns = new Map();
  let queue = Promise.resolve();
  const valid = (row, source, options, id) => row?.schema === 2 && row.source === source
    && row.season === options.season && row.platform === options.platform && row.definitionId === id
    && (source !== 'futbin' || row.futbinPlatform === options.futbinPlatform)
    && (row.price === null || validPrice(row.price)) && timestamp(row.fetchedAt) && row.fetchedAt <= now()
    && timestamp(row.expiresAt) && row.expiresAt > row.fetchedAt
    && (row.sourceUpdatedAt === null || timestamp(row.sourceUpdatedAt) && row.sourceUpdatedAt <= row.fetchedAt)
    && (row.error === null || typeof row.error === 'string' && /^FC27_[A-Z0-9_]+$/.test(row.error));
  const record = fields => { try { Promise.resolve(diagnosticLog?.record?.({ area: 'pricing', event: 'public-quote', ...fields })).catch(() => {}); } catch { /* Optional diagnostics. */ } };
  // Reproject successful cache entries per caller without extending a frozen
  // snapshot or changing the original fetch time. Error cooldowns are separate.
  const lifetime = (row, duration) => row && !row.error ? { ...row, expiresAt: row.fetchedAt + duration } : row;
  const ensure = (source, ids, options, byId, current, force, progress, duration, futbinBatch, deadlineAt) => {
    const withinBudget = () => deadlineAt === null || now() < deadlineAt;
    // Reserve exact per-version promises synchronously, before storage awaits,
    // so overlapping Gallery/Puzzle reads share the same in-flight request.
    const freshIds = ids.filter(id => !pending.has(keyOf(source, options, id)));
    if (freshIds.length) {
      const task = queue.catch(() => {}).then(async () => {
        const startedAt = now(); let requests = 0;
        current();
        const missing = [];
        for (const id of freshIds) {
          const key = keyOf(source, options, id);
          let saved = cache.get(key);
          if (!saved) { try { saved = await get(key, null); } catch { /* Optional quote cache. */ } }
          if (valid(saved, source, options, id)) saved = lifetime(saved, duration);
          if (valid(saved, source, options, id) && saved.expiresAt > now() && (!force || saved.error)
              && !['FC27_PUBLIC_PRICE_PLAYER_INVALID', 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED', 'FC27_PUBLIC_PRICE_FUTGG_DISABLED'].includes(saved.error)) {
            cache.set(key, saved);
            if (saved.error) cooldowns.set(cooldownKeyOf(source, options), { retryAt: saved.expiresAt, reason: saved.error });
          } else missing.push(id);
        }
        let completed = ids.length - missing.length;
        progress({ source, index: completed, total: ids.length });
        current();
        const batchSize = source === 'futgg' ? 50 : 1;
        const jobs = [], fallbackJobs = [], grouped = new Map();
        if (source === 'futbin' && futbinBatch && typeof readFutbinBatch === 'function') {
          for (const id of missing) {
            const rating = byId.get(id)?.rating;
            const group = grouped.get(rating) ?? []; group.push(id); grouped.set(rating, group);
          }
        }
        const bulkIds = new Set();
        for (const [rating, batch] of grouped) if (Number.isSafeInteger(rating) && rating >= 1 && rating <= 99 && batch.length >= 12) {
          jobs.push({ ids: batch, bulk: true }); for (const id of batch) bulkIds.add(id);
        }
        const singles = missing.filter(id => !bulkIds.has(id));
        for (let offset = 0; offset < singles.length; offset += batchSize) jobs.push({ ids: singles.slice(offset, offset + batchSize), bulk: false });
        let next = 0, sourceFailure = null;
        const readBatch = async () => {
          current();
          const job = jobs[next++], batch = job.ids, cooldownKey = cooldownKeyOf(source, options);
          let rows = [], error = null, retryAt = null;
          const cooldown = sourceFailure ?? cooldowns.get(cooldownKey);
          try {
            if (sourceFailure || cooldown?.retryAt > now()) {
              retryAt = Math.max(cooldown.retryAt, now() + 1); throw Error(cooldown.reason);
            }
            requests++;
            if (job.bulk) {
              const result = await readFutbinBatch(batch, batch.map(id => byId.get(id)), { ...options, check: current, force, quoteTtlMs: duration,
                ...(deadlineAt !== null ? { deadlineAt } : {}) });
              if (!Number.isSafeInteger(result?.requests) || result.requests < 0 || result.requests > 8) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
              requests += result.requests - 1; rows = result.rows;
            } else rows = source === 'futgg' ? await readFutgg(batch, options)
              : [await readFutbin(batch[0], byId.get(batch[0]), { ...options,
                ...(deadlineAt !== null ? { deadlineAt, check: current } : {}) })].filter(Boolean);
            if (!Array.isArray(rows) || rows.some(row => !batch.includes(row?.definitionId)
                || row.price !== null && !validPrice(row.price)
                || job.bulk && (!timestamp(row.fetchedAt) || row.fetchedAt > now())
                || row.sourceUpdatedAt != null && (!timestamp(row.sourceUpdatedAt) || row.sourceUpdatedAt > now()))
                || new Set(rows.map(row => row.definitionId)).size !== rows.length) throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
          } catch (failure) {
            error = reasonOf(failure); rows = [];
            // A local planning deadline is not a provider outage and must not
            // poison another caller's cache/circuit with a synthetic failure.
            if (deadlineAt !== null && error === 'FC27_STREAMLINED_QUOTE_BUDGET') return;
            if (deadlineAt !== null && /(?:CONTEXT_CHANGED|CANCELLED)$/.test(error)) throw failure;
            retryAt ??= Math.max(now() + failureTtlMs, timestamp(failure?.retryAt) ? failure.retryAt : 0);
            // Bad/missing player metadata is local to that version, not an
            // outage. Network/payload failures stop request storms per source.
            if (!['FC27_PUBLIC_PRICE_PLAYER_INVALID', 'FC27_PUBLIC_PRICE_FUTBIN_DISABLED', 'FC27_PUBLIC_PRICE_FUTGG_DISABLED'].includes(error)) {
              sourceFailure ??= { retryAt, reason: error };
              cooldowns.set(cooldownKey, { retryAt, reason: error });
            }
          }
          const completedIds = job.bulk && !error ? batch.filter(id => rows.some(row => row.definitionId === id)) : batch;
          if (job.bulk && !error) for (const id of batch) if (!completedIds.includes(id)) fallbackJobs.push({ ids: [id], bulk: false });
          for (const id of completedIds) {
            const value = rows.find(row => row.definitionId === id);
            const fetchedAt = job.bulk && !error ? value.fetchedAt : now(), expiresAt = error ? retryAt : fetchedAt + duration;
            const entry = { schema: 2, source, ...options, definitionId: id, price: value?.price ?? null,
              fetchedAt, sourceUpdatedAt: value?.sourceUpdatedAt ?? null, expiresAt, error };
            const key = keyOf(source, options, id); cache.set(key, entry);
            try { await set(key, structuredClone(entry)); } catch { /* Memory cache remains usable. */ }
            record({ source, status: error ? 'failed' : entry.price === null ? 'missing' : 'success', reason: error,
              definitionId: id, referencePrice: entry.price, fetchedAt, sourceUpdatedAt: entry.sourceUpdatedAt, expiresAt });
          }
          completed += completedIds.length; progress({ source, index: completed, total: ids.length });
        };
        // Keep the shared queue held until every worker settles, including
        // cancellation. A later caller must not overlap abandoned requests.
        const workers = source === 'futbin' ? 3 : 1;
        const drain = () => Promise.allSettled(Array.from({ length: Math.min(workers, jobs.length) }, async () => {
          while (next < jobs.length && withinBudget()) await readBatch();
        }));
        const settled = await drain();
        if (!settled.some(result => result.status === 'rejected') && fallbackJobs.length) {
          jobs.splice(0, jobs.length, ...fallbackJobs); next = 0;
          settled.push(...await drain());
        }
        const failed = settled.find(result => result.status === 'rejected');
        record({ source, event: 'quote-batch', phase: 'complete', status: failed ? 'failed' : sourceFailure ? 'failed' : completed < ids.length ? 'partial' : 'success',
          requestedCount: freshIds.length, cached: missing.length === 0, count: missing.length,
          requests, batchSize: workers, durationMs: Math.max(0, now() - startedAt) });
        if (failed) throw failed.reason;
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
      isCurrent = () => true, onProgress = () => {}, quoteTtlMs = ttlMs, futbinBatch = false, deadlineAt = null } = {}) {
      policy = normalizeGalleryPricePolicy(policy);
      if (!Number.isSafeInteger(quoteTtlMs) || quoteTtlMs <= 0 || quoteTtlMs > 1800000
          || season !== '27' || !['pc', 'console'].includes(platform) || !Array.isArray(ids)
          || ids.length > 250 || ids.some(id => !positive(id))
          || !Array.isArray(sources) || !sources.length || sources.some(source => !['futgg', 'futbin'].includes(source))
          || deadlineAt !== null && !timestamp(deadlineAt)
          || typeof futbinBatch !== 'boolean' || new Set(sources).size !== sources.length || !Array.isArray(forceSources)
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
      const quotes = {}, baseOptions = { season, platform }; let budgetExpired = false;
      for (const source of requested) {
        const options = { ...baseOptions, ...(source === 'futbin' && policy.futbinPlatform ? { futbinPlatform: policy.futbinPlatform } : {}) };
        progress({ source, index: 0, total: unique.length });
        const startedAt = now(); let timer;
        const loading = ensure(source, unique, options, byId, current, forced.has(source), progress, quoteTtlMs, futbinBatch, deadlineAt);
        let values;
        try {
          values = deadlineAt === null ? await loading : await Promise.race([loading,
            new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, deadlineAt - now())); })]);
        } finally { clearTimeout(timer); }
        current();
        if (values === null) {
          // A snapshot does not release the queue or pending reservations.
          // In-flight readers settle normally; no new jobs start past the deadline.
          values = unique.map(id => {
            const row = cache.get(keyOf(source, options, id));
            return valid(row, source, options, id) && (!forced.has(source) || row.fetchedAt >= startedAt) ? row : undefined;
          });
        }
        quotes[source] = values.map(row => lifetime(row, quoteTtlMs));
        if (deadlineAt !== null && now() >= deadlineAt && quotes[source].some(row => !row || row.error || !validPrice(row.price) || row.expiresAt <= now())) budgetExpired = true;
        progress({ source, index: quotes[source].filter(Boolean).length, total: unique.length });
      }
      const prices = {}, references = {}; let expiresAt = null;
      for (const [index, id] of unique.entries()) {
        const pair = Object.fromEntries(['futgg', 'futbin'].map(source => [source,
          requested.includes(source) ? structuredClone(quotes[source][index]) : {
            schema: 2, source, ...baseOptions, definitionId: id, price: null, fetchedAt: now(),
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
        source: 'public-references', expiresAt, ...(deadlineAt !== null ? { budgetExpired } : {}),
        missingIds: unique.filter(id => !Object.hasOwn(prices, id)), staleIds: [], stale: false };
    },
  });
}
