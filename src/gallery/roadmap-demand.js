import { planGalleryRoadmapSteps } from './roadmap.js';
import { createGalleryRoadmapWork } from './roadmap-work.js';
import { runGalleryPlan } from './cooperative-plan.js';
import { selectGalleryRoadmapSteps } from './roadmap-selection.js';
import { isGalleryOwned, galleryCostSearchKeys } from './planner.js';
import { compileGalleryScoringRules } from './scoring.js';
import { selectGalleryCandidatePool } from './candidate-pool.js';
import { galleryCumulativeRewardQuantity } from './catalog-rewards.js';
import { forecastGalleryTurnover } from './turnover-budget.js';

const priced = value => Number.isSafeInteger(value) && value >= 150 && value <= 15000000;

// Idle expiry removes only affected independent routes. It never renews a
// quote or discards the separate Fodder overview / still-valid collections.
export function pruneGalleryDemandResult(result, now = Date.now()) {
  const keep = row => row.items.every(item => item.roadmapQuote?.expiresAt > now);
  const kept = result.route.filter(keep), byId = new Map(kept.map(row => [row.setId, row]));
  const funding = forecastGalleryTurnover({ steps: kept.map(row => ({ setId: row.setId, items: row.items })),
    capital: result.funding.capital, resaleDiscountBps: result.funding.resaleDiscountBps });
  const route = funding.steps.map((step, index) => ({ ...byId.get(step.setId), ...step, order: index + 1 }));
  return { ...result, quotesExpired: true, partial: true, status: route.length ? 'ready' : 'quotes-expired', funding, route,
    addedTokens: route.reduce((n, row) => n + row.addedTokens, 0),
    rows: result.rows.map(row => ({ ...row, options: row.options.filter(keep) })),
    selectedOptions: result.selectedOptions.filter(row => byId.has(row.setId)) };
}

// One frozen, read-only analysis. No persistence, approvals or transactions.
// Reference overview and independently quoted optimization are kept separate.
export function createGalleryDemandWork() {
  let binding, preview, jobs = [], policy = null, quotes = new Map(), attempted = new Set();
  const preflight = createGalleryRoadmapWork();
  const clear = () => {
    preflight.clear(); for (const job of jobs) job.work.clear();
    binding = null; preview = null; jobs = []; policy = null; quotes = new Map(); attempted = new Set();
  };
  const fresh = (id, at) => quotes.get(id)?.expiresAt > at ? quotes.get(id) : null;
  const selections = (job, limit) => {
    const { target } = job, compiled = compileGalleryScoringRules(target.catalog);
    if (compiled.status !== 'ready') return [];
    const candidates = target.progress.rows.filter(row => row.collected === false && !isGalleryOwned(row)
      && Number.isSafeInteger(row.gradingScore ?? row.galleryScore)).map(row => ({ id: row.eaId,
      score: row.gradingScore ?? row.galleryScore, price: target.prices?.[row.eaId], row,
      diversityKeys: galleryCostSearchKeys(row, compiled.tags) }));
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const selected = new Map();
    const add = candidate => { if (candidate && selected.size < limit) selected.set(candidate.id, candidate.row); };
    // Preserve earlier tiers, then inexpensive locally verified proposals.
    for (const id of job.ids) add(byId.get(id));
    for (const option of (job.forecast.options ?? []).slice().sort((a, b) =>
      a.items.reduce((n, row) => n + row.price, 0) - b.items.reduce((n, row) => n + row.price, 0))) {
      for (const item of option.items) add(byId.get(item.eaId));
    }
    for (const candidate of selectGalleryCandidatePool(candidates, limit)) add(candidate);
    return [...selected.values()];
  };
  const candidatesRemain = job => job.target.progress.rows.filter(row => row.collected === false && !isGalleryOwned(row)).length > job.ids.length;
  const usefulExpansion = job => {
    if (!candidatesRemain(job) || job.ids.length >= 96) return false;
    const options = job.result?.rows?.[0]?.options ?? [];
    // No usable route or an untested alternative with an unknown/lower cost
    // warrants another bounded tier, not a catalog-wide speculative read.
    if (!options.length) return true;
    const best = Math.min(...options.map(option => option.items.reduce((n, row) => n + row.price, 0)));
    return job.target.progress.rows.some(row => row.collected === false && !isGalleryOwned(row)
      && !job.ids.includes(row.eaId) && (!priced(job.target.prices?.[row.eaId]) || job.target.prices[row.eaId] < best));
  };
  const resultSteps = function* (options, at, stopped) {
    const rows = [];
    for (const job of jobs) {
      const row = job.shown?.rows?.[0];
      if (!row) continue;
      const value = structuredClone(row);
      value.options = value.options.filter(option => option.items.every(item => fresh(item.eaId, at)));
      // Shared versions must have one consistent still-fresh price everywhere.
      for (const option of value.options) for (const item of option.items) {
        const quote = fresh(item.eaId, at); item.price = quote.price;
        item.roadmapQuote = { source: policy.source, fetchedAt: quote.fetchedAt, expiresAt: quote.expiresAt };
      }
      if (row.options.length && !value.options.length) value.reason = 'quote-expired';
      rows.push(value);
    }
    const route = yield* selectGalleryRoadmapSteps({ rows, ...options });
    return { ...route, rows, fastReferences: false, demandDriven: true, partial: true,
      coverage: { total: binding.targets.length, inspected: rows.length, available: rows.filter(row => row.currentScore !== null).length,
        missing: 0, stopped: stopped || route.selectionStopped, gradesChecked: rows.reduce((n, row) => n + (row.checkedGrades?.length ?? 0), 0) },
      deepCoverage: { eligible: jobs.length, completed: jobs.filter(job => job.done).length,
        quoted: quotes.size, candidateLimit: 96, pending: jobs.filter(job => !job.done).length } };
  };
  const validResult = (at = Date.now()) => !jobs.some(job => job.shown?.rows?.some(row =>
    row.options.some(option => option.items.some(item => !fresh(item.eaId, at)))));
  return {
    clear, validResult,
    async run({ targets, options, load, current = () => true, checkpoint = current, stopped = () => false, maxMs,
      progress = () => {}, onPreview = () => {}, onResult = () => {}, onPhase = () => {},
      now = Date.now, clock = () => performance.now(), schedule, gradePlanner } = {}) {
      const key = JSON.stringify(options);
      if (binding && (binding.targets !== targets || binding.key !== key)) clear();
      if (!binding) {
        const owned = new Set(targets.flatMap(target => (target.progress?.rows ?? []).filter(isGalleryOwned).map(row => row.eaId)));
        binding = { targets, key, planningTargets: targets.map(target => !target.progress?.rows ? target : ({ ...target,
          progress: { ...target.progress, rows: target.progress.rows.map(row => owned.has(row.eaId) ? { ...row, held: true } : row) } })) };
      }
      const started = clock(), remaining = () => Math.max(0, maxMs - (clock() - started));
      const checking = () => { if (!current() || !checkpoint()) throw Error('FC27_GALLERY_ROADMAP_CONTEXT_CHANGED'); };
      const run = async steps => {
        const result = await runGalleryPlan({ next: finish => steps.next(finish || stopped()), return: () => steps.return() },
          { current, checkpoint, maxMs: remaining(), progress, ...(schedule ? { schedule } : {}), now: clock });
        checking(); return result;
      };
      checking();
      onPhase('planning');
      if (!preview || preview.coverage.stopped) {
        preview = await run(planGalleryRoadmapSteps({ ...options, targets: binding.planningTargets, fastReferences: true, work: preflight,
          previousRows: preview?.rows, previousSelection: preview?.selectedOptions }));
        if (!preview) { checking(); throw Error('FC27_GALLERY_ROADMAP_CONTEXT_CHANGED'); }
      }
      onPreview(preview);
      for (const [id, quote] of quotes) if (quote.expiresAt <= now()) attempted.delete(id);
      for (const job of jobs) if (job.input && job.ids.some(id => quotes.has(id) && !fresh(id, now()))) {
        job.input = null; job.result = null; job.done = false; job.work.clear();
        for (const id of job.ids) if (!fresh(id, now())) attempted.delete(id);
      }
      if (!preview.coverage.stopped && !jobs.length) {
        const byId = new Map(preview.rows.map(row => [row.setId, row]));
        jobs = binding.planningTargets.flatMap(target => {
          const row = byId.get(target.set.id), top = Math.max(...target.set.grades.map(grade =>
            galleryCumulativeRewardQuantity(target.set, grade.threshold, 'event_token_1')));
          if (!row || row.currentScore === null || row.reason === 'progress-unavailable'
              || target.progress.complete === false || !(top > row.baselineTokens)) return [];
          const ratios = row.options.map(option => option.items.reduce((n, item) => n + item.price, 0)
            / Math.max(1, option.projectedTokens - row.baselineTokens));
          return [{ target, forecast: row, rank: Math.min(...ratios), ids: [], tier: 24, work: createGalleryRoadmapWork(), done: false }];
        }).sort((a, b) => a.rank - b.rank || a.target.set.id.localeCompare(b.target.set.id));
      }
      // All jobs get a small first pass before expanding any one collection.
      while (!preview.coverage.stopped && remaining() > 0 && !stopped()) {
        checking();
        const job = jobs.filter(job => !job.done).sort((a, b) => a.tier - b.tier || a.rank - b.rank)[0];
        if (!job) break;
        if (!job.input) {
          const rows = selections(job, job.tier); job.ids = rows.map(row => row.eaId);
          const missing = rows.filter(row => !fresh(row.eaId, now()) && !attempted.has(row.eaId));
          for (let start = 0; start < missing.length && remaining() > 0 && !stopped(); start += 24) {
            onPhase('pricing');
            const batch = missing.slice(start, start + 24), deadlineAt = now() + Math.max(1, Math.floor(Math.min(15000, remaining())));
            let part;
            try {
              part = await load(batch.map(row => row.eaId), { rows: batch, purpose: 'roadmap', deadlineAt,
                ...(policy ? { policy } : {}), isCurrent: () => current() && checkpoint() && !stopped(),
                onProgress: value => { if (current() && !stopped()) progress({ ...value, quoteTotal: value.total, phase: 'pricing',
                  name: job.target.set.name, completed: jobs.filter(job => job.done).length, total: jobs.length }); } });
            } catch (error) { checking(); if (stopped()) break; throw error; }
            checking();
            if (stopped()) break;
            if (part?.source !== 'public-references' || !part.policy || policy && JSON.stringify(policy) !== JSON.stringify(part.policy))
              throw Error('FC27_PUBLIC_PRICE_RESPONSE_INVALID');
            policy ??= part.policy;
            for (const row of batch) {
              const id = row.eaId, price = part.freshPrices?.[id], evidence = part.references?.[id]?.quotes?.[policy.source];
              const expiresAt = evidence?.expiresAt ?? part.expiresAt, fetchedAt = evidence?.fetchedAt ?? now();
              if (priced(price) && Number.isSafeInteger(expiresAt) && expiresAt > now()
                  && Number.isSafeInteger(fetchedAt) && fetchedAt <= now()) quotes.set(id, { price, fetchedAt, expiresAt });
              if (fresh(id, now()) || !part.budgetExpired) attempted.add(id);
            }
            if (part.budgetExpired) break;
          }
          if (remaining() <= 0 || stopped()) break;
          const unresolved = rows.some(row => !fresh(row.eaId, now()) && !attempted.has(row.eaId));
          if (unresolved) break; // Yield to a later click, not an unbounded retry.
          const quoteRows = rows.filter(row => fresh(row.eaId, now()));
          const prices = Object.fromEntries(quoteRows.map(row => [row.eaId, fresh(row.eaId, now()).price]));
          job.input = [{ ...job.target, publicReference: null, forecastPriceBasis: null, priceSnapshot: null, prices,
            progress: { ...job.target.progress, candidateOnly: true, poolComplete: false,
              rows: job.target.progress.rows.filter(row => isGalleryOwned(row) || Object.hasOwn(prices, row.eaId)) } }];
        }
        onPhase('planning');
        job.result = await run(planGalleryRoadmapSteps({ ...options, targets: job.input,
          previousRows: job.result?.rows, previousSelection: job.result?.selectedOptions, work: job.work,
          ...(gradePlanner ? { gradePlanner } : {}) }));
        if (!job.result) { checking(); throw Error('FC27_GALLERY_ROADMAP_CONTEXT_CHANGED'); }
        // Retain completed options while a larger tier is being evaluated.
        if (job.shown) {
          const row = job.result.rows[0], previous = job.shown.rows[0];
          if (row && previous) for (const option of previous.options) {
            const existing = row.options.find(value => value.requestedGrade === option.requestedGrade);
            if (option.items.every(item => fresh(item.eaId, now())) && (!existing
                || option.items.reduce((n, item) => n + fresh(item.eaId, now()).price, 0)
                  < existing.items.reduce((n, item) => n + item.price, 0))) {
              row.options = row.options.filter(value => value.requestedGrade !== option.requestedGrade); row.options.push(structuredClone(option));
            }
          }
        }
        job.shown = structuredClone(job.result);
        if (!job.result.coverage.stopped) {
          job.done = !usefulExpansion(job);
          if (!job.done) { job.tier = Math.min(96, job.tier * 2); job.input = null; job.result = null; job.work.clear(); }
        }
        const result = await run(resultSteps(options, now(), true));
        if (result) onResult(result);
        if (job.shown.coverage.stopped) break;
      }
      onPhase('planning');
      const result = await run(resultSteps(options, now(), preview.coverage.stopped || jobs.some(job => !job.done)));
      return { result, preview };
    },
  };
}
