import { findFc27PuzzleRepairSeedCooperatively, planFc27PuzzleRepairQueries, suggestFc27PuzzlePurchasesCooperatively,
  planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchasesCooperatively, marketCandidates,
  puzzleOwnedValueCandidates, puzzleMarketValueCandidates, refineFc27PuzzleOwnedValue } from './puzzle-procurement.js';
import { createPurchasePriceApproval } from './purchase-price-approval.js';
import { prepareFc27PuzzleConceptPlan } from './puzzle-concept-plan.js';
import { traditionalJournalScope } from './traditional-journal.js';
import { parseFc27SbcRequirements } from './sbc-requirements.js';
import { allowedFc27MarketTiers } from './market-query-route.js';
import { readFc27PuzzleCatalogHints, yieldPuzzleHintTask } from './puzzle-catalog-hints.js';
import { DEFAULT_PUZZLE_QUOTE_CEILING, MAX_PUZZLE_QUOTE_PRICE, PUZZLE_MARKET_READ_LIMIT, isPuzzleQuoteCeiling } from './puzzle-procurement-policy.js';
import { comparePuzzlePlans, sortPuzzlePlans } from './puzzle-plan-ranking.js';

const safeReason = error => /^FC27_[A-Z0-9_]{1,100}$/.test(error?.message ?? '') ? error.message : 'FC27_PURCHASE_READ_FAILED';
const stop = reason => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false, plans: [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => Number.isSafeInteger(value) && value > 0;
const validPublicValue = value => Number.isSafeInteger(value) && value >= 150 && value <= MAX_PUZZLE_QUOTE_PRICE;
const AUTH_RETRY_DELAY = 30000;
// A soft search stop, not a price/purchase cap: two floor-price steps per
// normal card warrant no extra EA read. Costlier plans can use remaining pages.
const refinementCards = plan => plan.purchases
  .filter(card => card.estimatedUnitPrice > (card.rating < 75 ? 300 : 600))
  .sort((a, b) => b.estimatedUnitPrice - a.estimatedUnitPrice);
const matchesQuery = (card, query) => (!query.team || query.team === card.teamId)
  && (!query.league || query.league === card.leagueId) && (!query.nation || query.nation === card.nationId)
  && query.level === (card.rating < 65 ? 'bronze' : card.rating < 75 ? 'silver' : 'gold');
function refinementQueries(plan, pages, used, input) {
  const queries = [];
  const add = query => { if (!used.some(old => same(old, query)) && !queries.some(old => same(old, query))) queries.push(query); };
  const cards = refinementCards(plan);
  const required = input.challenge.slotCount - input.challenge.brickIndices.length;
  const parsed = parseFc27SbcRequirements(input.challenge.rawRequirements, required);
  const rating = parsed.status === 'observed' ? Math.max(0, ...parsed.rules
    .filter(rule => ['min-team-rating', 'exact-team-rating'].includes(rule.kind)).map(rule => rule.value)) : 0;
  if (cards.length && rating > 0 && rating <= 75
      || cards.some(card => card.rating >= 75) && parsed.status === 'observed' && rating <= 75
        && (plan.purchaseCount === 0 || parsed.rules.some(rule => ['from-clubs', 'from-leagues', 'from-nations'].includes(rule.kind)
          && rule.mode !== 'max' && rule.count > 0))) {
    const lower = allowedFc27MarketTiers(parsed.rules, input.policy).find(tier => tier.max < 75
      && !parsed.rules.some(rule => rule.kind === 'quality-count' && rule.mode !== 'max' && rule.count >= required
        && !rule.qualities.includes(tier.level === 'bronze' ? 1 : 2)));
    const league = parsed.rules.find(rule => rule.kind === 'from-leagues' && rule.mode === 'min' && rule.count > 0)?.ids[0]
      ?? plan.purchases.map(card => card.leagueId).sort((a,b) =>
        plan.purchases.filter(card => card.leagueId === b).length - plan.purchases.filter(card => card.leagueId === a).length)[0];
    // A rating-75 squad need not contain eleven golds. Spend one remaining
    // lane on a cheap connected tier before deepening the same gold page.
    // This is candidate discovery only; original full rating/chemistry and
    // material verification still decide whether any mix is actually valid.
    if (plan.purchaseCount === 0 && lower && id(cards[0]?.nationId)) {
      add({ start: 0, count: 20, level: lower.level, nation: cards[0].nationId });
    }
    if (lower && id(league)) add({ start: 0, count: 20, level: lower.level, league });
  }
  for (const card of cards) {
    for (const page of pages.filter(page => matchesQuery(card, page.query)
      || page.entries.some(entry => entry.definitionId === card.definitionId))) {
      if (page.pageEndObserved === false && page.entries.length === page.query.count) {
        add({ ...page.query, start: page.query.start + page.query.count });
      }
    }
  }
  if (queries.length) return queries;
  for (const card of cards) {
    const level = card.rating < 65 ? 'bronze' : card.rating < 75 ? 'silver' : 'gold';
    // Use only verified defid filters; position is assessed locally by the solver.
    add({ start: 0, count: 20, level, nation: card.nationId, league: card.leagueId });
    add({ start: 0, count: 20, level, nation: card.nationId });
    add({ start: 0, count: 20, level, league: card.leagueId });
  }
  // If the sampled lane was already exhausted, use a small number of
  // identity lanes around the expensive card instead of rereading its page.
  return queries;
}
// A method fingerprint/dependency failure happens before an EA request is
// sent. Keep its evidence for diagnostics, but allow the next explicit user
// action to probe the current runtime again (the page or script may have
// refreshed since the failure). It must never be treated as a stale quote or
// an authentication retry.
// A persisted catalog failure can predate a reviewed EA entity-chain fix.
// Allow the next explicit action to revalidate these local runtime gates once;
// quote/auth/auction failures remain sticky according to their own contracts.
const retryableRuntimeFailure = reason => /^FC27_MARKET_METHOD_\d+_(?:MISSING|CHANGED)$/.test(reason)
  || /^FC27_MARKET_ENTITY_UNVERIFIED(?:_[A-Z0-9_]+)?$/.test(reason)
  || reason === 'FC27_MARKET_ENTITY_FACTORY_FAILED';
const failureDetails = (reason, value) => {
  const match = /^FC27_MARKET_HTTP_([1-5]\d{2})$/.exec(reason);
  const eaCode = Object.getOwnPropertyDescriptor(value ?? {}, 'eaCode')?.value;
  const phase = Object.getOwnPropertyDescriptor(value ?? {}, 'phase')?.value;
  return { httpStatus: match ? Number(match[1]) : null,
    eaCode: Number.isSafeInteger(eaCode) && eaCode >= 0 && eaCode <= 0x7fffffff ? eaCode : null,
    failurePhase: typeof phase === 'string' && /^[a-z-]{1,40}$/.test(phase) ? phase : null };
};

// Injected read-only transport, durable per-query memo, no purchase/fill seam.
// Persist attempts before sending: repeated clicks and reloads reuse evidence
// or retain the recorded failure rather than automatically retrying EA.
// A new user action may renew an expired success or an explicit HTTP 401 after
// cooldown, or revalidate a method fingerprint locally. No same-action retry;
// pending and other failures stay blocked.
// The caller holds the account lock across this operation.
export function createFc27PuzzleProcurementSession({ createTransport, get, set, list = null,
  loadPublicPrices = null, loadCachedPrices = null, now = Date.now } = {}) {
  let busy = false;
  const ownedValues = async (input, { assertCurrent, onProgress, preferred = [] }) => {
    const safe = puzzleOwnedValueCandidates(input);
    const byDefinition = new Map();
    for (const item of [...preferred.map(key => safe.find(item => item.id === key)).filter(Boolean), ...safe]) {
      if (!byDefinition.has(item.definitionId)) byDefinition.set(item.definitionId, item);
    }
    // Keep the incumbent first, then value the cheapest quality tiers before
    // spending the bounded public-price batch on high-rated cards.  The old
    // insertion order could put a single eligible silver behind 250 gold
    // definitions, making material-value mode silently fall back to an
    // all-gold incumbent even though the silver card was usable.
    const preferredOrder = new Map(preferred.map((key, index) => [safe.find(item => item.id === key)?.definitionId, index])
      .filter(([definitionId]) => Number.isSafeInteger(definitionId)));
    const rows = [...byDefinition.values()].sort((a, b) =>
      (preferredOrder.has(a.definitionId) && preferredOrder.has(b.definitionId)
        ? preferredOrder.get(a.definitionId) - preferredOrder.get(b.definitionId)
        : Number(preferredOrder.has(b.definitionId)) - Number(preferredOrder.has(a.definitionId))) ||
      (preferredOrder.has(a.definitionId) || preferredOrder.has(b.definitionId) ? 0 :
        (Number.isInteger(a.rating) ? a.rating : 99) - (Number.isInteger(b.rating) ? b.rating : 99)) ||
      a.definitionId - b.definitionId).slice(0, 250);
    if (!rows.length) return { prices: new Map(), approval: null, candidateCount: safe.length };
    const platform = /^pc(?::|$)/i.test(input.context.platform) ? 'pc' : /^(psn|xbox)(?::|$)/i.test(input.context.platform) ? 'console' : null;
    const deadlineAt = now() + 90000;
    const read = async batch => {
      const snapshot = await loadPublicPrices(batch.map(item => item.definitionId), { purpose: 'puzzle', rows: batch, deadlineAt,
        isCurrent: () => { assertCurrent(); return true; }, onProgress });
      assertCurrent(); return snapshot;
    };
    // The approved loader accepts up to 250 IDs in one call. Keep the incumbent
    // and lowest-quality owned candidates at the front of that single batch;
    // splitting it into an incumbent request and an optional second request
    // added latency and could leave the silver candidate unpriced on timeout.
    const snapshot = await read(rows);
    assertCurrent();
    const approval = createPurchasePriceApproval({ scope: traditionalJournalScope(input.context), season: '27', platform,
      definitionIds: rows.map(item => item.definitionId), policy: snapshot.policy, references: snapshot.references, now: now() });
    return { prices: new Map(approval.rows.filter(row => row.estimate !== null).map(row => [row.definitionId, row.estimate])),
      approval, candidateCount: safe.length };
  };
  return Object.freeze({
  async optimizeOwned(input, preview, { assertCurrent = () => {}, onProgress = null } = {}) {
    if (!loadPublicPrices || preview?.status !== 'preview' || busy) return preview;
    busy = true;
    try {
      assertCurrent();
      const valued = await ownedValues(input, { assertCurrent,
        onProgress: value => onProgress?.({ phase: 'quote-read', quoteCompleted: value.index, quoteTotal: value.total }),
        preferred: preview.selected.map(item => item.id) });
      const result = await refineFc27PuzzleOwnedValue(input, preview, valued.prices, { assertCurrent, onProgress });
      assertCurrent();
      if (valued.approval?.rows.some(row => row.estimate !== null && row.quotes[valued.approval.policy.source].expiresAt <= now())) {
        return { ...preview, materialValue: null, valueReason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED' };
      }
      return { ...result, priceSource: valued.approval?.policy.source ?? null,
        valueExpiresAt: valued.prices.size ? Math.min(...valued.approval.rows.filter(row => row.estimate !== null)
          .map(row => row.quotes[valued.approval.policy.source].expiresAt)) : null,
        valueQuotedCount: valued.prices.size,
        valueCoverageComplete: valued.prices.size === new Set(puzzleOwnedValueCandidates(input).map(item => item.definitionId)).size };
    } catch (error) {
      assertCurrent();
      return { ...preview, materialValue: null, valueReason: safeReason(error) };
    } finally { busy = false; }
  },
  async plan(input, { assertCurrent = () => {}, quoteCeiling = DEFAULT_PUZZLE_QUOTE_CEILING,
    onProgress = null, optimizeMaterialValue = false, materialCeiling = null, ownedIncumbent = null } = {}) {
    if (busy) return stop('FC27_PURCHASE_BUSY');
    busy = true;
    let requests = 0; let cacheHits = 0; let transport;
    const diagnostics = { stage: 'repair-seed', route: null, catalogPages: 0, catalogCandidates: 0,
      usableCandidates: null, unpricedPlans: 0, localReason: null, checks: null, nodes: null,
      truncated: null, catalogAttempts: 0, quoteAttempts: 0,
      authRecoveries: 0, failureSource: null, httpStatus: null, eaCode: null, retryAfterSeconds: null,
      failurePhase: null, excludedUnavailable: 0, replans: 0, searchComplete: null,
      optimalWithinPool: null, estimatedCost: null, priceSource: null, search: null,
      initialEstimatedCost: null, refinementPasses: 0, optimizationBudgetExhausted: false, catalogQueries: [],
      seedMs: 0, catalogMs: 0, pricingMs: 0, searchMs: 0, hintMs: 0,
      localSearchNodes: 0, stageDurations: {}, planningStartedAt: now(),
      incumbentProvided: false, incumbentVerified: null, incumbentRejectReason: null,
      incumbentCandidateCount: null, incumbentSelectedCount: null };
    let lastReportedStage = diagnostics.stage;
    let lastStageAt = now();
    let quoteCompleted = 0; let quoteTotal = 0; let catalogTotal = 3;
    const closeStage = nextStage => {
      const elapsed = Math.max(0, now() - lastStageAt);
      diagnostics.stageDurations[lastReportedStage] = (diagnostics.stageDurations[lastReportedStage] ?? 0) + elapsed;
      const durationField = ({ 'owned-value-read': 'ownedValueDurationMs', 'catalog-read': 'catalogReadDurationMs',
        'quote-read': 'quoteReadDurationMs', 'local-market-search': 'localSearchDurationMs',
        'repair-seed': 'repairSeedDurationMs' })[lastReportedStage];
      if (durationField) diagnostics[durationField] = (diagnostics[durationField] ?? 0) + elapsed;
      lastReportedStage = nextStage; lastStageAt = now();
    };
    const measure = async (key, task) => {
      const started = now();
      try { return await task(); }
      finally { diagnostics[key] += Math.max(0, now() - started); }
    };
    const reportProgress = value => {
      const currentStage = value?.phase ?? diagnostics.stage;
      if (currentStage !== lastReportedStage) closeStage(currentStage);
      if (typeof onProgress !== 'function') return;
      try { onProgress({ ...value, phase: value?.phase ?? diagnostics.stage, nodes: value?.nodes ?? null,
        maxNodes: value?.maxNodes ?? null, checks: value?.checks ?? diagnostics.checks,
        catalogPages: diagnostics.catalogPages, catalogCandidates: diagnostics.catalogCandidates,
        usableCandidates: diagnostics.usableCandidates, catalogTotal, requests, cacheHits,
        quoteCompleted, quoteTotal, refinementPasses: diagnostics.refinementPasses,
        bestEstimatedCost: diagnostics.estimatedCost }); } catch { /* Presentation cannot affect procurement. */ }
    };
    let ownedBaseline = null;
    const finish = result => {
      closeStage(lastReportedStage);
      diagnostics.planningDurationMs = Math.max(0, now() - diagnostics.planningStartedAt);
      return { ...result, ...(ownedBaseline ? { ownedBaseline: { ...ownedBaseline } } : {}), quoteCeiling, requests, cacheHits, diagnostics: { ...diagnostics, cacheHits } };
    };
    let incumbent = null;
    let totalValueMode = false;
    let finishIncumbent = null;
    try {
      if (!isPuzzleQuoteCeiling(quoteCeiling)) return finish(stop('FC27_PURCHASE_PRICE_LIMIT_INVALID'));
      if (materialCeiling !== null && (!id(materialCeiling) || materialCeiling > 11 * MAX_PUZZLE_QUOTE_PRICE)) {
        return finish(stop('FC27_MARKET_POLICY_INVALID'));
      }
      const scope = traditionalJournalScope(input.context);
      assertCurrent();
      reportProgress();
      // A current, fully verified owned lineup is already a better search seed
      // than a relaxed-chemistry repair seed. Re-running the 50k repair search
      // here duplicated the initial inventory solve and delayed material-value
      // planning before any market candidate was considered.
      const hasOwnedIncumbent = ownedIncumbent?.status === 'preview'
        && Array.isArray(ownedIncumbent.selected)
        && ownedIncumbent.selected.length === input.challenge.slotCount - input.challenge.brickIndices.length;
      const seed = hasOwnedIncumbent ? { status: 'unavailable', reason: 'FC27_PURCHASE_REPAIR_SEED_NOT_NEEDED' }
        : await measure('seedMs', () => findFc27PuzzleRepairSeedCooperatively(input,
          value => reportProgress({ ...value, phase: 'repair-seed' }), { assertCurrent }));
      if (seed.status !== 'ready' && seed.reason !== 'FC27_PURCHASE_REPAIR_SEED_UNAVAILABLE'
          && seed.reason !== 'FC27_PURCHASE_REPAIR_SEED_NOT_NEEDED') return finish(seed);
      diagnostics.route = seed.status === 'ready' ? 'repair' : 'joint';
      diagnostics.stage = 'query-planning';
      const route = seed.status === 'ready' ? planFc27PuzzleRepairQueries(input, seed) : planFc27PuzzleShortageQueries(input);
      if (route.status !== 'ready') return finish(route);
      const cachedRead = async (kind, query) => {
        diagnostics.stage = kind === 'catalog' ? 'catalog-read' : 'quote-read';
        reportProgress();
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
            const runtimeFailure = stored.state === 'blocked' && retryableRuntimeFailure(reason);
            if (!runtimeFailure && (!authFailure || remaining > 0)) {
              Object.assign(diagnostics, failureDetails(reason, stored.details), { failureSource: 'cache',
                retryAfterSeconds: authFailure ? Math.ceil(remaining / 1000) : null });
              throw new Error(reason);
            }
            if (authFailure) diagnostics.authRecoveries++;
          } else {
            const ttl = kind === 'catalog' ? 86400000 : 600000;
            if (!id(stored.result?.observedAt) || stored.result.observedAt > now()) throw new Error('FC27_PURCHASE_CACHE_UNVERIFIED');
            if (now() - Math.min(stored.at, stored.result.observedAt) <= ttl) {
              cacheHits++; reportProgress(); return structuredClone(stored.result);
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
          reportProgress();
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
      const positionSkipped = new Set();
      const pages = []; let searchSpent = 0;
      const searchBudget = seed.status === 'ready' ? 20000 : 50000;
      const unavailable = new Set(); let hadPlans = false;
      const references = new Map(); let publicPolicy = null;
      const valueRequested = optimizeMaterialValue === true && typeof loadPublicPrices === 'function';
      totalValueMode = valueRequested;
      diagnostics.objective = 'additional-coins';
      diagnostics.ownedValueCandidateCount = 0; diagnostics.ownedValueQuotedCount = 0;
      diagnostics.ownedSilverValueQuotedCount = 0; diagnostics.ownedGoldValueQuotedCount = 0;
      diagnostics.ownedBronzeValueQuotedCount = 0; diagnostics.ownedValueDurationMs = 0;
      diagnostics.catalogReadDurationMs = 0; diagnostics.quoteReadDurationMs = 0;
      diagnostics.localSearchDurationMs = 0; diagnostics.repairSeedDurationMs = 0;
      let materialPrices = null;
      if (totalValueMode) {
        diagnostics.stage = 'owned-value-read'; diagnostics.objective = 'material-value';
        reportProgress();
        try {
          const valued = await measure('pricingMs', () => ownedValues(input, { assertCurrent, onProgress: value => {
            quoteCompleted = value.index; quoteTotal = value.total; reportProgress();
          }, preferred: ownedIncumbent?.selected?.map(item => item.id) ?? [] }));
          const allOwned = new Set(puzzleOwnedValueCandidates(input).map(item => item.definitionId)).size;
          const ownedByDefinition = new Map(puzzleOwnedValueCandidates(input).map(item => [item.definitionId, item]));
          const ownedDefinitions = [...ownedByDefinition.values()];
          diagnostics.ownedValueCandidateCount = allOwned;
          diagnostics.ownedValueQuotedCount = valued.prices.size;
          diagnostics.ownedSilverValueQuotedCount = ownedDefinitions
            .filter(item => item.rating >= 65 && item.rating < 75 && valued.prices.has(item.definitionId)).length;
          diagnostics.ownedGoldValueQuotedCount = ownedDefinitions
            .filter(item => item.rating >= 75 && valued.prices.has(item.definitionId)).length;
          diagnostics.ownedBronzeValueQuotedCount = ownedDefinitions
            .filter(item => item.rating < 65 && valued.prices.has(item.definitionId)).length;
          diagnostics.unknownCount = allOwned - valued.prices.size;
          const fullCoverage = diagnostics.unknownCount === 0;
          const pricedOwnedBaseline = hasOwnedIncumbent && ownedIncumbent.selected.every(ref =>
            validPublicValue(valued.prices.get(ref.definitionId)));
          // The bounded quoted subset is usable only with a fully priced
          // baseline, including the current owned lineup priced in this batch.
          totalValueMode = fullCoverage || materialCeiling !== null || pricedOwnedBaseline;
          materialPrices = totalValueMode ? valued.prices : null;
          diagnostics.scopeTruncated = !fullCoverage;
          if (valued.approval) {
            publicPolicy = valued.approval.policy;
            for (const row of valued.approval.rows) references.set(row.definitionId, row);
          }
        } catch (error) {
          assertCurrent(); totalValueMode = false; materialPrices = null;
          diagnostics.unknownCount = new Set(puzzleOwnedValueCandidates(input).map(item => item.definitionId)).size;
          diagnostics.localReason = safeReason(error);
        }
        diagnostics.scopeTruncated = diagnostics.unknownCount > 0;
        diagnostics.objective = totalValueMode ? 'material-value' : 'additional-coins';
      }
      // Price and retain the already fully validated owned solution as the
      // first candidate. It must survive a capped/failed market search, and it
      // lets the combined search compare real market replacements against the
      // same lineup without a separate 20k-node owned-only optimization pass.
      if (totalValueMode && ownedIncumbent?.status === 'preview') {
        const safe = puzzleOwnedValueCandidates(input);
        const selectedOwned = ownedIncumbent.selected.map(ref => safe.find(item => item.id === ref.id
          && item.definitionId === ref.definitionId && item.pile === ref.pile && item.rating === ref.rating));
        if (selectedOwned.length === input.challenge.slotCount - input.challenge.brickIndices.length && selectedOwned.every(item => item
            && validPublicValue(materialPrices.get(item.definitionId)))) {
          const inventoryValue = selectedOwned.reduce((sum, item) => sum + materialPrices.get(item.definitionId), 0);
          incumbent = [{ selectedOwned: ownedIncumbent.selected.map(ref => ({ ...ref })), purchases: [],
            purchaseCount: 0, estimatedCost: 0, inventoryValue, materialValue: inventoryValue,
            teamFacts: ownedIncumbent.teamFacts }];
          ownedBaseline = { materialValue: inventoryValue, priceSource: publicPolicy.source,
            valueExpiresAt: Math.min(...selectedOwned.map(item => references.get(item.definitionId)
              .quotes[publicPolicy.source].expiresAt)) };
          diagnostics.initialEstimatedCost = 0;
          diagnostics.materialValue = inventoryValue;
          diagnostics.inventoryValue = inventoryValue;
        }
      }
      // Preserve a fully owned feasible incumbent in total-value mode. If no
      // complete squad exists yet, first turn the chemistry repair seed into
      // a priced feasible plan, then continue with the bounded joint search.
      let jointSearch = ownedIncumbent?.status === 'preview' || seed.status !== 'ready';
      diagnostics.incumbentProvided = ownedIncumbent?.status === 'preview';
      const objective = () => totalValueMode ? 'material-value' : 'additional-coins';
      const planCost = plan => totalValueMode ? plan.materialValue : plan.estimatedCost;
      const refinementPlan = plan => !totalValueMode ? plan : { ...plan, purchases: [...plan.purchases,
        ...plan.selectedOwned.map(ref => ({ ...puzzleOwnedValueCandidates(input).find(item => item.id === ref.id),
          estimatedUnitPrice: materialPrices.get(ref.definitionId) }))] };
      if (jointSearch) diagnostics.route = 'joint';
      const priceCandidates = async candidates => {
        const eligible = puzzleMarketValueCandidates(input, candidates), kept = new Set(eligible.map(card => card.definitionId));
        for (const card of candidates) if (!kept.has(card.definitionId)) positionSkipped.add(card.definitionId);
        diagnostics.positionSkippedCount = positionSkipped.size;
        candidates = eligible;
        if (!candidates.length) return;
        diagnostics.stage = 'quote-read'; quoteTotal = candidates.length; quoteCompleted = 0; reportProgress();
        const snapshot = await measure('pricingMs', () => loadPublicPrices(candidates.map(item => item.definitionId), { purpose: 'puzzle', rows: candidates,
          ...(publicPolicy ? { policy: publicPolicy } : {}), isCurrent: () => { assertCurrent(); return true; },
          onProgress: value => { quoteCompleted = value.index; quoteTotal = value.total; reportProgress(); } }));
        assertCurrent();
        const platform = /^pc(?::|$)/i.test(input.context.platform) ? 'pc' : /^(psn|xbox)(?::|$)/i.test(input.context.platform) ? 'console' : null;
        const approved = createPurchasePriceApproval({ scope, season: '27', platform, policy: snapshot.policy,
          definitionIds: candidates.map(item => item.definitionId), references: snapshot.references, now: now() });
        if (publicPolicy && !same(publicPolicy, approved.policy)) throw Error('FC27_PUBLIC_PRICE_POLICY_INVALID');
        publicPolicy = approved.policy;
        for (const row of approved.rows) {
          references.set(row.definitionId, row);
          const usable = row.estimate !== null && (quoteCeiling === null || row.estimate <= quoteCeiling);
          quotes.set(row.definitionId, { price: usable ? row.estimate : null, observedAt: row.quotes[publicPolicy.source].fetchedAt });
          if (!usable) unavailable.add(row.definitionId);
        }
        diagnostics.excludedUnavailable = unavailable.size;
      };
      let coverageChecked = false;
      const refineCoverage = async () => {
        // Costly cash-only plans need the same bounded discovery pass as
        // material-value plans. A missing owned valuation is not evidence
        // that the sampled market route is already cheap.
        if (coverageChecked || !loadPublicPrices || !loadCachedPrices || !list
            || !refinementCards(refinementPlan(incumbent[0])).length) return;
        coverageChecked = true; diagnostics.stage = 'catalog-hints'; reportProgress();
        const hint = await measure('hintMs', () => readFc27PuzzleCatalogHints({ input, list, get, now, usedQueries,
          prices: new Map([...quotes].filter(([, quote]) => id(quote.price)).map(([id, quote]) => [id, quote.price])),
          materialPrices, costCeiling: planCost(incumbent[0]), assertCurrent,
          readPrices: ids => loadCachedPrices(ids, { policy: publicPolicy,
            isCurrent: () => { assertCurrent(); return true; } }) }));
        diagnostics.hintNodes = hint.nodes; diagnostics.hintPairs = hint.pairs;
        const directions = hint.queries.length ? hint.queries : refinementQueries(refinementPlan(incumbent[0]), pages, usedQueries, input)
          .sort((a, b) => ['team', 'nation', 'league'].filter(key => b[key]).length
            - ['team', 'nation', 'league'].filter(key => a[key]).length).slice(0, 2);
        if (!directions.length) return;
        catalogTotal = usedQueries.length + directions.filter(query => !usedQueries.some(used => same(used, query))).length;
        if (totalValueMode) diagnostics.initialMaterialValue = incumbent[0].materialValue;
        diagnostics.coveragePages = 0;
        const fresh = new Map();
        for (const query of directions) {
          const previousHits = cacheHits, page = await measure('catalogMs', () => cachedRead('catalog', query));
          if (page?.status !== 'observed' || page.season !== '27' || page.source !== 'ea-defid' || !same(page.query, query)
              || !id(page.observedAt) || page.observedAt > now() || now() - page.observedAt > 86400000
              || !Array.isArray(page.entries) || page.entries.length > query.count
              || new Set(page.entries.map(item => item?.definitionId)).size !== page.entries.length) throw Error('FC27_PURCHASE_CATALOG_UNVERIFIED');
          for (const card of page.entries) {
            if (entries.has(card.definitionId) && !same(entries.get(card.definitionId), card)) throw Error('FC27_PURCHASE_CATALOG_CHANGED');
            entries.set(card.definitionId, card); fresh.set(card.definitionId, card);
          }
          if (!usedQueries.some(used => same(used, query))) {
            usedQueries.push(query); diagnostics.catalogPages++; diagnostics.coveragePages++;
            diagnostics.catalogQueries.push({ ...query, returnedCount: page.entries.length, cached: cacheHits > previousHits });
          }
          diagnostics.catalogCandidates = entries.size; reportProgress();
        }
        // Keep the already-priced feasible scaffold as well as the two fresh
        // pages, so a cheaper replacement need not rebuild the whole squad.
        // This remains at most 40 + 11 public definitions, below the 60 cap.
        for (const card of incumbent[0].purchases) if (!fresh.has(card.definitionId)) {
          const entry = entries.get(card.definitionId);
          if (entry) fresh.set(card.definitionId, entry);
        }
        // Historical cards/prices never enter this search. Only newly read
        // native pages and the normal fresh selected-source approvals do.
        const candidates = marketCandidates(input, [...fresh.values()]);
        await priceCandidates(candidates.filter(card => !references.has(card.definitionId)));
        diagnostics.stage = 'local-market-search'; diagnostics.refinementPasses++;
        const result = await measure('searchMs', () => suggestFc27PuzzleJointPurchasesCooperatively(input,
          [...fresh.values()].filter(card => !unavailable.has(card.definitionId)), {
            prices: new Map([...quotes].map(([id, quote]) => [id, quote.price])), materialPrices,
            maxNodes: 20000, costCeiling: planCost(incumbent[0]), priceSource: publicPolicy.source,
            assertCurrent, yieldControl: yieldPuzzleHintTask,
            onProgress: value => reportProgress({ ...value, nodes: searchSpent + (value.nodes ?? 0), maxNodes: searchBudget + 20000 }),
          }));
        assertCurrent(); searchSpent += result.nodes ?? 0; diagnostics.nodes = searchSpent;
        diagnostics.search ??= { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
        for (const key of Object.keys(diagnostics.search)) diagnostics.search[key] += result.search?.[key] ?? 0;
        if (result.status === 'blocked' && !['SAFE_MATERIAL_SHORTAGE', 'FC27_PUZZLE_CONSTRAINT_SHORTAGE',
          'FC27_PUZZLE_NO_PLAN_FOUND', 'FC27_PUZZLE_SEARCH_LIMIT', 'FC27_PURCHASE_REPAIR_NO_PLAN'].includes(result.reason)) throw Error(result.reason);
        const better = result.plans?.[0];
        if (result.status === 'suggested' && better && Number.isSafeInteger(planCost(better))
            && planCost(better) < planCost(incumbent[0])) incumbent = [{ ...better,
          purchases: better.purchases.map(card => ({ ...card, estimatedUnitPrice: quotes.get(card.definitionId).price,
            priceReference: references.get(card.definitionId), priceSource: publicPolicy.source,
            quotedAt: quotes.get(card.definitionId).observedAt })) }];
        // Local exhaustion/completion is never a global minimum proof.
        diagnostics.searchComplete = false; diagnostics.optimalWithinPool = false;
      };
      finishIncumbent = async () => {
        await refineCoverage();
        assertCurrent();
        if (diagnostics.scopeTruncated) {
          diagnostics.searchComplete = false;
          diagnostics.optimalWithinPool = false;
        }
        if (loadPublicPrices && incumbent.some(plan => plan.purchases.some(card => {
          const quote = references.get(card.definitionId)?.quotes?.[publicPolicy.source];
          return !quote || quote.fetchedAt > now() || quote.expiresAt <= now();
        }))) throw new Error('FC27_BUY_REFERENCE_PRICE_EXPIRED');
        if (totalValueMode) {
          const expired = new Set(incumbent.flatMap(plan => plan.selectedOwned).filter(card => {
            const quote = references.get(card.definitionId)?.quotes?.[publicPolicy.source];
            return !quote || quote.fetchedAt > now() || quote.expiresAt <= now();
          }).map(card => card.definitionId));
          if (expired.size) {
            totalValueMode = false; diagnostics.scopeTruncated = true;
            diagnostics.unknownCount = expired.size; diagnostics.objective = 'unverified-material-value';
            diagnostics.localReason = 'FC27_BUY_REFERENCE_PRICE_EXPIRED';
            diagnostics.searchComplete = false; diagnostics.optimalWithinPool = false;
            incumbent = incumbent.map(plan => ({ ...plan, materialValue: null, inventoryValue: null,
              valueReason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED' }));
          }
        }
        incumbent = sortPuzzlePlans(incumbent, objective());
        diagnostics.estimatedCost = incumbent[0].estimatedCost;
        diagnostics.materialValue = incumbent[0].materialValue ?? null;
        diagnostics.inventoryValue = incumbent[0].inventoryValue ?? null;
        const valuedIds = new Set(incumbent.flatMap(plan => [...plan.selectedOwned, ...plan.purchases]
          .map(card => card.definitionId)));
        const expiries = [...valuedIds].map(definitionId => references.get(definitionId)?.quotes?.[publicPolicy?.source]?.expiresAt)
          .filter(Number.isSafeInteger);
        diagnostics.valueExpiresAt = expiries.length ? Math.min(...expiries) : null;
        const retainedBaseline = diagnostics.localReason !== null || diagnostics.searchComplete === false;
        return finish({ status: 'suggested', reason: retainedBaseline ? 'FC27_PURCHASE_BASELINE_RETAINED'
          : 'FC27_PURCHASE_PLAN_PRICED', executable: false,
          liveExecutionEnabled: false, plans: incumbent.slice(0, 3).map(plan => ({ ...plan,
            valueExpiresAt: diagnostics.valueExpiresAt,
            ...(totalValueMode && diagnostics.scopeTruncated ? { valueCoverageComplete: false,
              unpricedOwnedCount: diagnostics.unknownCount, valueReason: 'FC27_PUZZLE_VALUE_SCOPE_TRUNCATED' } : {}),
            ...(valueRequested && !totalValueMode ? { materialValue: null, inventoryValue: null,
              valueReason: plan.valueReason ?? 'FC27_PUZZLE_VALUE_INCOMPLETE' } : {}),
            conceptPlan: prepareFc27PuzzleConceptPlan({ challenge: input.challenge, plan: { ...plan, status: 'preview',
              setId: input.challenge.setId, challengeId: input.challenge.id } }) })), queries: usedQueries,
          seedChemistry: seed.teamFacts?.chemistry ?? null, requiredChemistry: seed.requiredChemistry ?? null,
          valueExpiresAt: diagnostics.valueExpiresAt, searchComplete: retainedBaseline ? false : diagnostics.searchComplete,
          optimalWithinPool: retainedBaseline ? false : diagnostics.optimalWithinPool,
          affordabilityVerified: false, globalMinimumProven: false,
          pending: ['EXPLICIT_PURCHASE_AND_MATERIAL_APPROVAL', 'LIVE_AUCTION_RECHECK', 'EXACT_PURCHASE_RECEIPTS', 'FRESH_INVENTORY_REPLAN'] });
      };
      // Candidate discovery starts around the already feasible material, not
      // a newly generated relaxed-chemistry seed. This only chooses read lanes;
      // the joint planner reconstructs and verifies the exact baseline afresh.
      const ownedPool = puzzleOwnedValueCandidates(input);
      const baselineCards = ownedIncumbent?.status === 'preview' && Array.isArray(ownedIncumbent.selected)
        ? ownedIncumbent.selected.map(ref => ownedPool.find(item => item.id === ref.id && item.definitionId === ref.definitionId
          && item.pile === ref.pile && item.rating === ref.rating)).filter(Boolean) : [];
      const baselineQueries = totalValueMode && baselineCards.length === input.challenge.slotCount - input.challenge.brickIndices.length
        ? refinementQueries({ purchaseCount: 0, purchases: baselineCards.map(item => ({ ...item,
          estimatedUnitPrice: materialPrices.get(item.definitionId) })) }, [], [], input) : [];
      let pendingQueries = [...baselineQueries, ...route.queries].filter((query, index, all) => all.findIndex(old => same(old, query)) === index);
      while (pendingQueries.length && usedQueries.length < 3) {
        if (loadPublicPrices && searchSpent >= searchBudget) {
          diagnostics.optimizationBudgetExhausted = true;
          diagnostics.searchComplete = false; diagnostics.optimalWithinPool = false;
          if (incumbent) return await finishIncumbent();
          diagnostics.localReason = 'FC27_PUZZLE_SEARCH_LIMIT'; break;
        }
        const query = pendingQueries.shift();
        const previousHits = cacheHits;
        const page = await measure('catalogMs', () => cachedRead('catalog', query)); usedQueries.push(query);
        if (page?.status !== 'observed' || page.season !== '27' || page.source !== 'ea-defid'
            || !same(page.query, query) || !id(page.observedAt) || page.observedAt > now()
            || now() - page.observedAt > 86400000 || !Array.isArray(page.entries) || page.entries.length > query.count
            || new Set(page.entries.map(item => item?.definitionId)).size !== page.entries.length) throw new Error('FC27_PURCHASE_CATALOG_UNVERIFIED');
        pages.push(page);
        diagnostics.catalogQueries.push({ ...query, returnedCount: page.entries.length, cached: cacheHits > previousHits });
        for (const entry of page.entries) {
          if (entries.has(entry.definitionId) && !same(entries.get(entry.definitionId), entry)) throw new Error('FC27_PURCHASE_CATALOG_CHANGED');
          entries.set(entry.definitionId, entry);
        }
        diagnostics.catalogPages++;
        diagnostics.catalogCandidates = entries.size;
        reportProgress();
        if (loadPublicPrices) {
          const candidates = marketCandidates(input, [...entries.values()]).filter(item => !references.has(item.definitionId));
          await priceCandidates(candidates);
        }
        // Each unsuccessful pass removes at least one public version from the
        // bounded catalog. Re-solve locally before requesting another page.
        for (;;) {
          assertCurrent(); diagnostics.stage = 'local-market-search';
          const available = [...entries.values()].filter(item => !unavailable.has(item.definitionId));
          const prices = loadPublicPrices ? new Map([...quotes].map(([id, quote]) => [id, quote.price])) : null;
          if (loadPublicPrices && searchSpent >= searchBudget) {
            diagnostics.optimizationBudgetExhausted = true;
            diagnostics.searchComplete = false; diagnostics.optimalWithinPool = false;
            if (incumbent) return await finishIncumbent();
            diagnostics.localReason = 'FC27_PUZZLE_SEARCH_LIMIT'; break;
          }
          // Preserve a slice for the remaining bounded catalog lanes. Without
          // an incumbent the old route gave page one the entire budget, so a
          // chemistry-heavy joint search could stop at 50k nodes before the
          // league/nation lanes were ever read. Every unresolved lane receives
          // a deterministic share; the final lane gets the remainder.
          const remainingLanes = Math.max(1, 4 - usedQueries.length);
          const passBudget = Math.max(1, Math.floor((searchBudget - searchSpent) / remainingLanes));
          const searchOptions = loadPublicPrices ? { costCeiling: incumbent ? planCost(incumbent[0]) : totalValueMode ? materialCeiling : null,
            ...(jointSearch ? { maxNodes: passBudget, materialPrices } : { maxChecks: passBudget }) } : {};
          const refining = incumbent !== null;
          if (refining) diagnostics.refinementPasses++;
          const searchProgress = value => reportProgress(loadPublicPrices ? { ...value,
            nodes: searchSpent + (value.nodes ?? 0), maxNodes: searchBudget,
            ...(seed.status === 'ready' ? { checks: searchSpent + (value.checks ?? 0) } : {}) } : value);
          // A partial quote batch may have produced a cash-feasible incumbent
          // that contains an unpriced owned card. It cannot be used as the
          // local-only material baseline; let the joint solver rebuild the
          // squad from the quoted owned subset and market candidates instead.
          const selectedOwnedDefinitions = new Set(incumbent?.[0]?.selectedOwned?.map(item => item.definitionId) ?? []);
          const hasQuotedLowerTierOwned = totalValueMode && Boolean(incumbent)
            && ownedPool.some(item => !selectedOwnedDefinitions.has(item.definitionId)
              && item.rating < 75 && validPublicValue(materialPrices?.get(item.definitionId)));
          const localOnlyMaterial = totalValueMode && hasOwnedIncumbent && Boolean(incumbent)
            && !hasQuotedLowerTierOwned
            && incumbent[0].selectedOwned.every(item => validPublicValue(materialPrices?.get(item.definitionId)))
            && incumbent[0].purchases.every(item => validPublicValue(prices?.get(item.definitionId)));
          reportProgress();
          const suggestion = await measure('searchMs', () => !jointSearch ? suggestFc27PuzzlePurchasesCooperatively(input, seed, available, {
            ...searchOptions, assertCurrent, prices, onProgress: searchProgress })
            : suggestFc27PuzzleJointPurchasesCooperatively(input, available, { ...searchOptions, assertCurrent, prices,
              incumbent: hasOwnedIncumbent || !totalValueMode ? (incumbent ? { status: 'preview',
                selected: [...incumbent[0].selectedOwned, ...incumbent[0].purchases] } : ownedIncumbent) : null,
              // A priced feasible incumbent makes a whole-squad 20k DFS an
              // expensive way to rediscover its ten unchanged cards. In
              // material-value mode, first compare bounded one/two-card
              // replacements against that exact lineup; unresolved global
              // optimality remains explicit instead of freezing the UI.
              localOnly: localOnlyMaterial,
              localSearchBudget: localOnlyMaterial ? 1600 : undefined,
              priceSource: publicPolicy?.source ?? null,
              onIncumbentCheck: value => { diagnostics.incumbentVerified = value.verified;
                diagnostics.incumbentRejectReason = value.reason ?? null;
                diagnostics.incumbentCandidateCount = value.candidateCount ?? null;
                diagnostics.incumbentSelectedCount = value.selectedCount ?? null; },
              onProgress: searchProgress }));
          diagnostics.usableCandidates = suggestion.marketCandidates ?? null;
          diagnostics.localSearchNodes += suggestion.localSearchNodes ?? 0;
          diagnostics.localReason = suggestion.reason ?? null;
          diagnostics.checks = suggestion.checks ?? null;
          diagnostics.nodes = suggestion.nodes ?? null;
          if (suggestion.search) {
            diagnostics.search ??= { combinationNodes: 0, placementNodes: 0, evaluations: 0, bounds: 0 };
            for (const key of Object.keys(diagnostics.search)) diagnostics.search[key] += suggestion.search[key] ?? 0;
          }
          if (loadPublicPrices) {
            searchSpent += suggestion.nodes ?? suggestion.checks ?? 0;
            diagnostics.nodes = searchSpent;
            if (seed.status === 'ready') diagnostics.checks = searchSpent;
          }
          diagnostics.truncated = suggestion.truncated ?? null;
          diagnostics.searchComplete = suggestion.searchComplete ?? null;
          diagnostics.optimalWithinPool = suggestion.optimalWithinPool ?? null;
          if (suggestion.routeBudgets) diagnostics.routeBudgets = suggestion.routeBudgets;
          if (refining && suggestion.status === 'blocked') {
            const complete = ['FC27_PUZZLE_NO_PLAN_FOUND', 'FC27_PURCHASE_REPAIR_NO_PLAN'].includes(suggestion.reason)
              && !suggestion.truncated;
            diagnostics.searchComplete = complete;
            diagnostics.optimalWithinPool = complete && seed.status !== 'ready';
          }
          diagnostics.estimatedCost = incumbent?.[0].estimatedCost ?? suggestion.estimatedCost ?? null;
          diagnostics.priceSource = suggestion.priceSource ?? publicPolicy?.source ?? null;
          // More catalog pages can repair a bounded candidate shortage, not
          // malformed prices/policies or unavailable evaluators. Keep the
          // actual cause rather than converting every failure to NO_PLAN.
          if (suggestion.status === 'blocked' && !['SAFE_MATERIAL_SHORTAGE',
            'FC27_PUZZLE_CONSTRAINT_SHORTAGE', 'FC27_PUZZLE_NO_PLAN_FOUND',
            'FC27_PUZZLE_SEARCH_LIMIT', 'FC27_PURCHASE_REPAIR_NO_PLAN'].includes(suggestion.reason)) {
            return finish({ ...suggestion, queries: usedQueries });
          }
          const plans = suggestion.plans ?? [];
          diagnostics.unpricedPlans = plans.length; hadPlans ||= plans.length > 0;
          let removed = false;
          for (const plan of plans) {
            quoteTotal = plan.purchases.length;
            quoteCompleted = plan.purchases.filter(item => quotes.get(item.definitionId)?.price > 0).length;
            for (const item of plan.purchases) {
              if (!quotes.has(item.definitionId)) {
                const quote = await measure('pricingMs', () => cachedRead('quote', { definitionId: item.definitionId, start: 0, count: 20, maxBuy: quoteCeiling }));
                if (quote?.status !== 'observed' || quote.season !== '27' || quote.platform !== input.context.platform
                    || quote.source !== 'ea-visible-buy-now' || quote.definitionId !== item.definitionId
                    || !id(quote.observedAt) || quote.observedAt > now() || now() - quote.observedAt > 600000
                    || !Number.isInteger(quote.eligible) || quote.eligible < 0 || quote.eligible > 20
                    || (quote.eligible === 0 ? quote.price !== null : !Number.isInteger(quote.price) || quote.price < 150
                      || quote.price > (quoteCeiling ?? MAX_PUZZLE_QUOTE_PRICE))) throw new Error('FC27_PURCHASE_QUOTE_UNVERIFIED');
                quotes.set(item.definitionId, quote);
                quoteCompleted = plan.purchases.filter(card => quotes.get(card.definitionId)?.price > 0).length;
                reportProgress();
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
            .map(plan => {
              const estimatedCost = plan.purchases.reduce((sum, item) => sum + quotes.get(item.definitionId).price, 0);
              const purchases = plan.purchases.map(item => ({ ...item,
                ...(loadPublicPrices ? { estimatedUnitPrice: quotes.get(item.definitionId).price,
                  priceReference: references.get(item.definitionId), priceSource: publicPolicy.source }
                  : { observedBuyNow: quotes.get(item.definitionId).price }), quotedAt: quotes.get(item.definitionId).observedAt }));
              let values = {};
              if (totalValueMode) {
                let inventoryValue = 0;
                let valueComplete = true;
                for (const ref of plan.selectedOwned) {
                  const owned = ownedPool.find(item => item.id === ref.id && item.definitionId === ref.definitionId
                    && item.pile === ref.pile && item.rating === ref.rating);
                  const price = owned && materialPrices.get(owned.definitionId);
                  if (!Number.isSafeInteger(price) || price < 150) {
                    valueComplete = false;
                    continue;
                  }
                  inventoryValue += price;
                }
                values = valueComplete
                  ? { inventoryValue, materialValue: inventoryValue + estimatedCost }
                  : { inventoryValue: null, materialValue: null,
                    valueReason: 'FC27_PUZZLE_VALUE_INCOMPLETE' };
              }
              return { ...plan, purchases, estimatedCost, ...values };
            })
            .filter(plan => !totalValueMode || Number.isSafeInteger(plan.materialValue)
              && (materialCeiling === null || plan.materialValue < materialCeiling))
            .sort((a, b) => comparePuzzlePlans(a, b, objective()));
          if (priced.length) {
            diagnostics.initialEstimatedCost ??= priced[0].estimatedCost;
            if (!incumbent || comparePuzzlePlans(priced[0], incumbent[0], objective()) < 0) incumbent = priced;
            diagnostics.estimatedCost = incumbent[0].estimatedCost;
            if (!loadPublicPrices || !totalValueMode && incumbent[0].estimatedCost === 0) return await finishIncumbent();
            const selectedDefinitions = new Set(incumbent[0].selectedOwned.map(item => item.definitionId));
            const hasUnusedOwned = ownedPool.some(item => !selectedDefinitions.has(item.definitionId));
            if (!jointSearch && hasUnusedOwned) {
              // The fixed repair seed can return a priced plan even when its
              // sampled cards are cheap. Search that same candidate page with
              // the full safe owned pool before deciding that more catalog
              // pages are unnecessary; otherwise compatible Club cards never
              // enter the combination search.
              jointSearch = true;
              diagnostics.route = 'joint';
              continue;
            }
            // Further catalog reads are only useful when the incumbent still
            // has expensive cards worth refining. The current page has already
            // had a full joint search against owned materials.
            if (!refinementCards(refinementPlan(incumbent[0])).length) return await finishIncumbent();
            break;
          }
          if (!removed) break;
          diagnostics.replans++;
        }
        if (incumbent) {
          if (!refinementCards(refinementPlan(incumbent[0])).length) return await finishIncumbent();
          if (searchSpent >= searchBudget) {
            diagnostics.optimizationBudgetExhausted = true;
            diagnostics.searchComplete = false; diagnostics.optimalWithinPool = false;
            return await finishIncumbent();
          }
          pendingQueries = [...refinementQueries(refinementPlan(incumbent[0]), pages, usedQueries, input), ...pendingQueries]
            .filter((candidate, index, all) => !usedQueries.some(used => same(used, candidate))
              && all.findIndex(other => same(other, candidate)) === index);
        } else if (seed.status !== 'ready' && usedQueries.length < 3) {
          const nextRoute = planFc27PuzzleShortageQueries(input,
            [...entries.values()].filter(item => !unavailable.has(item.definitionId)), { usedQueries });
          if (nextRoute.status !== 'ready') return finish(nextRoute);
          pendingQueries = [...nextRoute.queries, ...pendingQueries].filter((candidate, index, all) =>
            !usedQueries.some(used => same(used, candidate)) && all.findIndex(other => same(other, candidate)) === index);
        }
      }
      if (incumbent) return await finishIncumbent();
      const searchLimited = diagnostics.localReason === 'FC27_PUZZLE_SEARCH_LIMIT'
        || diagnostics.truncated === true && diagnostics.unpricedPlans === 0;
      return finish({ ...stop(searchLimited ? 'FC27_PUZZLE_SEARCH_LIMIT'
        : hadPlans ? 'FC27_PURCHASE_QUOTES_UNAVAILABLE' : 'FC27_PURCHASE_REPAIR_NO_PLAN'), queries: usedQueries });
    } catch (error) { diagnostics.localReason = safeReason(error); return finish(stop(diagnostics.localReason)); }
    finally { busy = false; }
  } });
}
