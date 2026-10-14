import { normalizeStreamlinedSettings, createStreamlinedSettings } from '../../streamlined/settings.js';
import { filterStreamlinedItems } from '../../streamlined/eligibility.js';
import { runStreamlinedPlan } from '../../streamlined/planner.js';
import { createStreamlinedPlan } from '../../streamlined/plan.js';
import { same, fail } from '../../streamlined/contract.js';
import { runStreamlinedRoutes, expandStreamlinedRoute } from '../../streamlined/routes.js';
import { streamlinedQuoteFailure } from '../../streamlined/quotes.js';
import { normalizeStreamlinedProtectionFailure } from '../../streamlined/protection.js';

// Execution is optional and only entered through the separate contribution action.
// Public quotes are read only on Solve,
// deduplicated by version, using the account's single purchase price source.
export function createFc27StreamlinedSession({ inspect, readInputs, readMarketCandidates = null, get, set, prices, diagnosticLog = null,
  now = () => Date.now(), schedule, createExecution = null } = {}) {
  const settings = createStreamlinedSettings({ get, set });
  let busy = false, stopRequested = false, preview = null, activeExecution = null, routePreview = null, planningRun = 0;
  const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_EXECUTION_UNAVAILABLE';
  const executionEvidence = error => {
    if (!error || typeof error !== 'object') return {};
    const evidence = {};
    if (typeof error.methodPath === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,159}$/.test(error.methodPath)) evidence.methodPath = error.methodPath;
    if (typeof error.observedHash === 'string' && (/^[a-f0-9]{64}$/.test(error.observedHash) || error.observedHash === 'oversized')) evidence.observedHash = error.observedHash;
    if (typeof error.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(error.expectedHash)) evidence.expectedHash = error.expectedHash;
    return evidence;
  };
  const log = row => { try { Promise.resolve(diagnosticLog?.record?.({ area: 'streamlined', event: 'plan', ...row })).catch(() => {}); } catch { /* diagnostic only */ } };
  const logRoute = (route, phase = 'selected') => {
    if (!route) return;
    log({ event: 'route-summary', phase, currentScore: route.score, count: route.count,
      estimatedCost: route.purchaseCost, materialValue: route.materialValue, totalValue: route.totalValue,
      routeInventoryCount: route.inventoryCount, routeMarketCount: route.marketCount,
      minBatches: route.minBatches, repeatPurchaseCount: route.repeatPurchaseCount });
    if (phase !== 'selected') return;
    for (const group of route.groups.slice(0, 16)) log({ event: 'route-group', source: group.source,
      phase: group.item.pile ?? 'market', definitionId: group.item.definitionId, rating: group.item.rating,
      unitScore: group.item.points, count: group.quantity, requestedCount: group.items.length,
      referencePrice: group.item.price, maxBuy: group.item.purchaseMaxBuy });
  };
  const capture = () => { const value = inspect(); if (!value?.context || !value.challenge) fail('PAGE_UNAVAILABLE'); return value; };
  const unchanged = origin => { const current = capture(); if (!same(current, origin)) fail('CONTEXT_CHANGED'); };
  return Object.freeze({
    async readSettings(global = false) { const origin = capture(); const value = await settings.read(origin.context, global ? null : origin.challenge.id); unchanged(origin); return { ...origin, settings: value }; },
    async saveSettings(value, global = false) { const origin = capture(); const result = await settings.save(origin.context, global ? null : origin.challenge.id, value); unchanged(origin); return result; },
    stop() {
      stopRequested = true;
      if (typeof activeExecution?.stop === 'function') activeExecution.stop();
      else activeExecution?.transaction?.stop?.();
    },
    clearPreview() { preview = null; routePreview = null; },
    resolveDisplayItem(ref) {
      if (!preview) return null;
      if (!preview.items.some(item => item.key === ref?.key && item.source === ref?.source
          && item.id === ref?.id && item.definitionId === ref?.definitionId)) return null;
      try { unchanged(preview.origin); return preview.input.resolveDisplayItem?.(ref) ?? null; }
      catch { return null; }
    },
    async plan(value, { onProgress = () => {} } = {}) {
      if (busy) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
      busy = true; stopRequested = false; preview = null; routePreview = null;
      const run = ++planningRun;
      const progress = row => { try { onProgress(row); } catch { /* display only */ } };
      try {
        const config = normalizeStreamlinedSettings(value), origin = capture();
        const input = readInputs(config); input.assertCurrent();
        const check = () => { unchanged(origin); input.assertCurrent(); if (stopRequested || run !== planningRun) fail('CANCELLED'); };
        // Wait locally: shared quote requests remain owned by the price service.
        // A stopped/closed preview must not wait for hundreds of queued reads.
        const waitRead = async (read, initial, progressStartedAt = null) => {
          const started = now(); let last = initial, active = true;
          const report = row => { if (active) { last = row; progress({ ...row, elapsedMs: now() - (progressStartedAt ?? started) }); } };
          report(initial);
          let timer, outcome = 'success', reason = null;
          try {
            return await Promise.race([
              Promise.resolve().then(() => read(report)),
              new Promise((_resolve, reject) => {
                timer = setInterval(() => {
                  try { check(); report(last); } catch (error) { reject(error); }
                }, 250);
              }),
            ]);
          } catch (error) { outcome = 'failed'; reason = safeReason(error); throw error; }
          finally {
            active = false; clearInterval(timer);
            log({ event: 'planning-read', phase: last.phase, source: last.source, status: outcome, reason,
              durationMs: Math.max(0, now() - started), count: last.completed, requestedCount: last.total });
          }
        };
        const filtered = filterStreamlinedItems(input.inventory, input);
        if (filtered.status !== 'observed') return filtered;
        // Explain exclusions without retaining physical or account identities.
        const inventoryByKey = new Map(input.inventory.map(item => [item.key, item]));
        const exclusionBuckets = new Map();
        for (const row of filtered.excludedRows ?? []) {
          const item = inventoryByKey.get(row.key);
          const key = JSON.stringify([row.reason, item?.pile ?? 'unknown', item?.rating ?? null]);
          const bucket = exclusionBuckets.get(key) ?? { reason: row.reason, pile: item?.pile ?? 'unknown', rating: item?.rating ?? null, count: 0 };
          bucket.count++;
          exclusionBuckets.set(key, bucket);
        }
        const inventorySelection = { readCount: input.inventory.length, eligibleCount: filtered.items.length,
          excluded: { ...filtered.excluded }, buckets: [...exclusionBuckets.values()]
            .sort((a, b) => b.count - a.count || String(a.reason).localeCompare(String(b.reason))).slice(0, 24) };
        for (const bucket of inventorySelection.buckets) {
          log({ event: 'inventory-exclusion', phase: bucket.reason, source: bucket.pile,
            rating: bucket.rating ?? undefined, count: bucket.count,
            inventoryMaxRating: input.policy.maxRating, fsuGoldMin: input.policy.goldRange[0],
            fsuGoldMax: input.policy.goldRange[1], onlyUntradeable: input.policy.onlyUntradeable });
        }
        const ids = [...new Set(filtered.items.map(i => i.definitionId))];
        const references = {}; let quoteSource = 'futgg', quoteReadError = null, purchaseAttempts = 3;
        if (prices && config.mode !== 'market') {
          const inventoryQuotesStartedAt = now();
          for (let offset = 0; offset < ids.length; offset += 250) {
            check();
            try {
              const batch = ids.slice(offset, offset + 250);
              const snapshot = await waitRead(report => prices.load(batch, { purpose: 'puzzle', rows: input.priceRows, futbinBatch: true,
                onProgress: p => report({ phase: 'quotes', source: p.source, completed: offset + p.index, total: ids.length }),
                isCurrent: () => { check(); return true; } }), { phase: 'quotes', completed: offset, total: ids.length }, inventoryQuotesStartedAt);
              if (offset && snapshot.policy.source !== quoteSource) fail('PRICE_POLICY_CHANGED');
              quoteSource = snapshot.policy.source; purchaseAttempts = snapshot.policy.purchaseAttempts ?? 3;
              Object.assign(references, snapshot.references);
              quoteReadError = streamlinedQuoteFailure(snapshot.references, quoteSource, batch, now(), { requireFresh: false });
              progress({ phase: 'quotes', source: quoteSource, completed: offset + batch.length, total: ids.length });
              log({ event: 'planning-read', phase: 'quotes', status: quoteReadError ? 'failed' : 'success',
                source: quoteSource, reason: quoteReadError, count: offset + batch.length, requestedCount: ids.length });
              if (quoteReadError) break;
            } catch (error) { quoteReadError = /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_QUOTES_UNAVAILABLE'; break; }
          }
          log({ event: 'planning-read', phase: 'inventory-quotes', status: quoteReadError ? 'failed' : 'success',
            source: quoteSource, reason: quoteReadError, durationMs: Math.max(0, now() - inventoryQuotesStartedAt),
            count: Object.keys(references).length, requestedCount: ids.length });
        }
        check();
        if (quoteReadError && config.mode === 'inventory-market' && typeof readMarketCandidates === 'function') {
          log({ status: 'blocked', reason: 'FC27_STREAMLINED_QUOTES_UNAVAILABLE', localReason: quoteReadError,
            source: quoteSource, requestedCount: ids.length });
          return { status: 'blocked', reason: 'FC27_STREAMLINED_QUOTES_UNAVAILABLE', quoteReadError,
            quoteSource, plan: null, liveExecutionEnabled: false };
        }
        let market = [], marketError = null;
        if (config.mode !== 'inventory' && typeof readMarketCandidates === 'function') {
          try {
            check(); const data = await waitRead(report => readMarketCandidates({ input, ids, quoteSource, references, check,
              onProgress: report }), { phase: 'catalog', completed: 0, total: 0 });
            market = Array.isArray(data) ? data : data.market;
            if (!Array.isArray(market)) fail('MARKET_CANDIDATES_UNVERIFIED');
            if (data.pricePolicy) {
              if (Object.keys(references).length && data.pricePolicy.source !== quoteSource) fail('PRICE_POLICY_CHANGED');
              quoteSource = data.pricePolicy.source;
              purchaseAttempts = data.pricePolicy.purchaseAttempts ?? 3;
            }
            // Reuse newer exact-version quotes already read by the market
            // provider, so a stock copy and its concept share one valuation.
            // Preserve the provider timestamp; this is not a cache renewal.
            const at = now();
            for (const id of ids) {
              const q = data.references?.[id]?.quotes?.[quoteSource];
              const old = references[id]?.quotes?.[quoteSource];
              if (q?.source === quoteSource && q.definitionId === id && !q.error
                  && Number.isSafeInteger(q.price) && q.price > 0 && q.price <= 15000000
                  && Number.isSafeInteger(q.fetchedAt) && q.fetchedAt <= at
                  && Number.isSafeInteger(q.expiresAt) && q.expiresAt > at
                  && (!old || q.fetchedAt > old.fetchedAt)) {
                references[id] = { ...references[id], quotes: { ...references[id]?.quotes, [quoteSource]: q } };
              }
            }
          } catch (error) { marketError = safeReason(error); market = []; }
        }
        check();
        // A mixed plan must never silently become inventory-only when its
        // market lane was requested and could not be verified. The inventory
        // mode remains the explicit escape hatch for users who accept that
        // scope; otherwise a catalog/market failure is a hard planning stop.
        const marketProvider = typeof readMarketCandidates === 'function';
        if (config.mode !== 'inventory' && marketProvider && (!market.length || marketError)) {
          const reason = 'FC27_STREAMLINED_MARKET_UNAVAILABLE';
          const unavailable = {
            status: 'blocked', reason, marketError: marketError ?? 'FC27_STREAMLINED_MARKET_EMPTY',
            marketAvailable: true, marketPending: true, plan: null, liveExecutionEnabled: false,
            policy: input.policy, inventoryStats: input.inventoryStats ?? null,
            quoteSource, quoteReadError,
          };
          log({ status: unavailable.status, reason, localReason: unavailable.marketError,
            marketRequested: true, inventoryCount: input.inventoryStats?.count });
          return unavailable;
        }
        check(); const quoteAt = now();
        quoteReadError ??= streamlinedQuoteFailure(references, quoteSource, ids, quoteAt, { requireFresh: false });
        if (quoteReadError && config.mode === 'inventory-market' && marketProvider) {
          log({ status: 'blocked', reason: 'FC27_STREAMLINED_QUOTES_UNAVAILABLE', localReason: quoteReadError, source: quoteSource });
          return { status: 'blocked', reason: 'FC27_STREAMLINED_QUOTES_UNAVAILABLE', quoteReadError,
            quoteSource, plan: null, liveExecutionEnabled: false };
        }
        const inventory = input.inventory.map(item => {
          const q = references[item.definitionId]?.quotes?.[quoteSource];
          const valid = q?.definitionId === item.definitionId && q?.source === quoteSource && !q.error
            && Number.isSafeInteger(q.price) && q.price > 0 && q.fetchedAt <= quoteAt && q.expiresAt > quoteAt;
          return { ...item, price: valid ? q.price : null, quote: valid ? q : null };
        });
        const eligibleKeys = new Set(filtered.items.map(item => item.key)), buckets = new Map();
        for (const item of [...inventory.filter(item => eligibleKeys.has(item.key)), ...market]) {
          const key = JSON.stringify([item.source, item.pile, item.rating, item.points]);
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { event: 'candidate-bucket', source: item.source, phase: item.pile ?? 'market',
              rating: item.rating, unitScore: item.points, count: 0, quotedCount: 0,
              cheapestPrice: null, bestPrice: null };
            buckets.set(key, bucket);
          }
          bucket.count++;
          if (item.price != null) {
            bucket.quotedCount++;
            bucket.cheapestPrice = Math.min(bucket.cheapestPrice ?? Infinity, item.price);
            bucket.bestPrice = Math.max(bucket.bestPrice ?? 0, item.price);
          }
        }
        // Aggregate values only: never raw inventory, account IDs or item IDs.
        for (const source of ['inventory', 'market']) for (const bucket of [...buckets.values()]
          .filter(row => row.source === source).sort((a, b) => b.count - a.count || b.unitScore - a.unitScore).slice(0, 16)) log(bucket);
        const options = { onProgress: p => { check(); progress(p); },
          stopped: () => { unchanged(origin); input.assertCurrent(); return stopRequested; }, schedule };
        let result, routes = [];
        if (market.length) {
          const output = await runStreamlinedRoutes({ ...input, inventory, market, mode: config.mode,
            objective: config.objective, quoteSource, quoteAt }, { ...options, now });
          routes = output.routes;
          if (routes.length && output.status !== 'cancelled') {
            const selected = config.objective === 'fewest-cards' ? routes.reduce((a,b) => a.count <= b.count ? a : b) : routes[0];
            result = { ...output, ...expandStreamlinedRoute(selected, input.challenge), route: selected, routes, selectedRoute: selected.id };
          } else result = output;
        } else result = await runStreamlinedPlan({ ...input, inventory, market, mode: config.mode, objective: config.objective,
          quoteSource, quoteAt, now }, options);
        check();
        const plan = ['ready', 'partial'].includes(result.status)
          ? createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy, result, objective: config.objective,
            execution: { purchaseAttempts, partialWaitMs: config.partialWaitMs } }) : null;
        let execution = null, executionReason = 'FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED', executionRecovery = null, executionError = null;
        if (plan && typeof createExecution === 'function') {
          try {
            execution = await createExecution(origin.context, plan); check();
            execution.prepare(plan); executionReason = null;
          } catch (error) { execution = null; executionError = error; executionReason = safeReason(error); executionRecovery = error?.recovery ?? null; }
          check();
        }
        if (plan) preview = { origin, input, items: result.items, plan, execution };
        if (plan && routes.length) routePreview = { origin, input, config, routes, result, quoteSource, marketError,
          inventorySelection, execution: plan.execution };
        const inventoryStats = input.inventoryStats ?? {};
        const excluded = result.excluded ?? {};
        const filteredInventoryCount = Object.values(filtered.excluded ?? {})
          .reduce((sum, count) => sum + (Number.isSafeInteger(count) ? count : 0), 0);
        log({ status: result.status, evaluations: result.nodes, currentScore: result.score, safeCandidates: result.candidateCount,
          count: result.batches?.length, estimatedCost: result.purchaseCost, unknownCount: result.unknownValueCount,
          objective: config.objective, priceSource: quoteSource, materialValue: result.materialValue,
          totalValue: result.materialValue == null ? null : result.purchaseCost + result.materialValue,
          onlyUntradeable: input.policy.onlyUntradeable,
          searchComplete: result.searchComplete,
          inventoryCount: inventoryStats.count, inventoryClubCount: inventoryStats.byPile?.club,
          inventoryStorageCount: inventoryStats.byPile?.storage,
          inventoryRawClubCount: inventoryStats.rawByPile?.club,
          inventoryRawStorageCount: inventoryStats.rawByPile?.storage,
          inventorySkippedNonPlayerCount: Object.values(inventoryStats.skippedNonPlayerByPile ?? {}).reduce((sum, count) => sum + count, 0),
          inventoryTradeableCount: inventoryStats.tradeability?.tradeable,
          inventoryUntradeableCount: inventoryStats.tradeability?.untradeable,
          inventoryTradeabilityUnknown: inventoryStats.tradeability?.unknown,
          eligibleInventoryCount: filtered.items.length,
          filteredInventoryCount,
          acceptedInventoryCount: result.items?.filter(item => item.source === 'inventory').length,
          routeInventoryCount: result.items?.filter(item => item.source === 'inventory').length,
          routeMarketCount: result.items?.filter(item => item.source === 'market').length,
          routeMaterialValue: result.materialValue,
          excludedTradeCount: excluded.trade,
          excludedPileCount: excluded.pile,
          excludedEligibilityCount: Object.entries(excluded)
            .filter(([key]) => key.startsWith('eligibility-'))
            .reduce((sum, [, count]) => sum + count, 0),
          excludedGoldRangeCount: filtered.excluded?.['fsu-gold-range'],
          fsuGoldMax: input.policy.goldRange?.[1],
          reason: result.reason });
        logRoute(result.route);
        for (const route of routes.filter(row => row.id !== result.route?.id).slice(0, 12)) logRoute(route, 'alternative');
        if (executionReason) log({ event: 'execution-preflight', status: 'blocked', reason: executionReason,
          ...executionEvidence(executionError), setId: executionRecovery?.setId, challengeId: executionRecovery?.challengeId,
          phase: executionRecovery?.phase });
        if (executionRecovery?.kind === 'puzzle-purchase') {
          for (const [phase, count] of Object.entries(executionRecovery.states ?? {})) {
            if (['waiting', 'buy-pending', 'bought', 'move-pending', 'move-rejected', 'club'].includes(phase)
                && Number.isSafeInteger(count) && count > 0 && count <= 32) {
              log({ event: 'purchase-recovery-state', phase, count,
                setId: executionRecovery.setId, challengeId: executionRecovery.challengeId });
            }
          }
        }
        return { ...result, plan, quoteSource, quoteReadError, marketError, marketAvailable: typeof readMarketCandidates === 'function',
          marketPending: config.mode !== 'inventory' && market.length === 0, policy: input.policy,
          inventoryStats: input.inventoryStats ?? null,
          inventorySelection,
          liveExecutionEnabled: !!execution, executionReason, executionRecovery };
      } catch (error) {
        const reason = /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_PLAN_UNAVAILABLE';
        const protectionFailure = reason === 'FC27_STREAMLINED_PROTECTION_UNVERIFIED'
          ? normalizeStreamlinedProtectionFailure(error.evidence) : null;
        log({ status: 'blocked', reason, ...protectionFailure });
        return { status: stopRequested ? 'cancelled' : 'blocked', reason, liveExecutionEnabled: false,
          ...(protectionFailure ? { protectionFailure } : {}) };
      } finally { busy = false; }
    },
    async selectRoute(routeId) {
      if (busy || !routePreview) return { status: 'blocked', reason: 'FC27_STREAMLINED_PLAN_CHANGED' };
      busy = true;
      try {
        const saved = routePreview; unchanged(saved.origin); saved.input.assertCurrent();
        const route = saved.routes.find(row => row.id === routeId); if (!route) fail('ROUTE_INVALID');
        const result = { ...expandStreamlinedRoute(route, saved.input.challenge), route };
        const plan = createStreamlinedPlan({ context: saved.input.context, challenge: saved.input.challenge,
          policy: saved.input.policy, result, objective: saved.config.objective,
          execution: saved.execution });
        let execution = null, executionReason = 'FC27_STREAMLINED_PURCHASE_PENDING', executionError = null;
        if (typeof createExecution === 'function') {
          try { execution = await createExecution(saved.origin.context, plan); unchanged(saved.origin); execution.prepare(plan); executionReason = null; }
          catch (error) { execution = null; executionError = error; executionReason = safeReason(error); }
        }
        unchanged(saved.origin); preview = { origin: saved.origin, input: saved.input, items: result.items, plan, execution };
        logRoute(route);
        if (executionReason) log({ event: 'execution-preflight', status: 'blocked', reason: executionReason,
          ...executionEvidence(executionError) });
        return { ...saved.result, ...result, plan, routes: saved.routes, selectedRoute: routeId, quoteSource: saved.quoteSource,
          marketAvailable: true, marketPending: false, marketError: saved.marketError, executionReason, liveExecutionEnabled: !!execution,
          policy: saved.input.policy, inventoryStats: saved.input.inventoryStats ?? null, inventorySelection: saved.inventorySelection };
      } catch (error) { preview = null; return { status: 'blocked', reason: safeReason(error) }; }
      finally { busy = false; }
    },
    async contribute({ fingerprint, batchIndices, allowPartial = false } = {}, callbacks = {}) {
      if (busy) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
      if (!preview?.execution || preview.plan.fingerprint !== fingerprint) return { status: 'blocked', reason: 'FC27_STREAMLINED_PLAN_CHANGED' };
      busy = true; stopRequested = false;
      const selected = preview;
      try {
        unchanged(selected.origin); activeExecution = selected.execution;
        const result = selected.plan.route?.groups?.some(group => group.source === 'market') && typeof activeExecution.purchase === 'function'
          ? await activeExecution.purchase(selected.plan, { approved: true, fingerprint, allowPartial }, callbacks)
          : await activeExecution.transaction.execute(selected.plan,
            { approved: true, fingerprint, batchIndices, allowPartial }, callbacks);
        if (preview === selected) {
          // Keep the same frozen plan for remaining batches, but acknowledge
          // progress changed by our own verified transaction for the next click.
          const current = capture();
          if (same(current.context, selected.origin.context) && current.challenge.id === selected.plan.challenge.id
              && current.challenge.setId === selected.plan.challenge.setId) selected.origin = current;
          else preview = null;
        }
        log({ event: 'contribution', status: result.status, reason: result.reason, currentScore: result.record?.submittedScore });
        return result;
      } catch (error) { return { status: 'blocked', reason: safeReason(error) }; }
      finally { activeExecution = null; busy = false; }
    },
    async recover() {
      if (busy) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
      preview = null; routePreview = null;
      if (typeof createExecution !== 'function') return { status: 'blocked', reason: 'FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED' };
      busy = true;
      try {
        const origin = capture(); activeExecution = await createExecution(origin.context); unchanged(origin);
        const materialization = typeof activeExecution.recoverMaterialization === 'function'
          ? await activeExecution.recoverMaterialization(origin.context) : { status: 'absent' };
        if (['recovery-required', 'blocked', 'replan-required'].includes(materialization.status)) {
          log({ event: 'recovery', status: materialization.status, reason: materialization.reason });
          return materialization;
        }
        const purchase = typeof activeExecution.recoverPurchase === 'function'
          ? await activeExecution.recoverPurchase(origin.challenge) : { status: 'absent' };
        if (['recovery-required', 'blocked', 'replan-required'].includes(purchase.status)) {
          log({ event: 'recovery', status: purchase.status, reason: purchase.reason });
          return purchase;
        }
        const contribution = await activeExecution.transaction.recover(origin.context,
          { setId: origin.challenge.setId, challengeId: origin.challenge.id });
        let result = ['recovery-required', 'blocked', 'replan-required'].includes(contribution.status) || purchase.status === 'absent'
          ? contribution : { ...purchase, contributionRecovery: contribution };
        if (materialization.status !== 'absent') {
          result = { ...result, materializationRecovery: materialization };
          if (result.status === 'absent' && materialization.status === 'recovered') {
            result = { ...materialization, ...result, status: 'recovered', materializationRecovery: materialization };
          }
        }
        const current = capture();
        if (!same(current.context, origin.context) || current.challenge.id !== origin.challenge.id
            || current.challenge.setId !== origin.challenge.setId) fail('CONTEXT_CHANGED');
        log({ event: 'recovery', status: result.status, reason: result.reason, currentScore: result.record?.submittedScore,
          setId: origin.challenge.setId, challengeId: origin.challenge.id });
        const record = result.record;
        if (record && !['recovery-required', 'replan-required', 'blocked'].includes(result.status)) {
          if (!same(current.context, record.context) || current.challenge.id !== record.plan.challenge.id
              || current.challenge.setId !== record.plan.challenge.setId) fail('CONTEXT_CHANGED');
          const completed = record.submittedScore >= record.plan.challenge.targetScore;
          if (!completed) activeExecution.prepare(record.plan);
          const input = readInputs({ maxRating: record.plan.policy.maxRating,
            marketMaxRating: record.plan.policy.marketMaxRating ?? record.plan.policy.maxRating });
          preview = completed ? null : { origin: current, input, items: record.plan.items, plan: record.plan, execution: activeExecution };
          return { ...result, preview: { ...record.plan, plan: record.plan, liveExecutionEnabled: !completed,
            quoteSource: record.plan.items.find(item => item.quote)?.quote?.source ?? 'unknown', record } };
        }
        return result;
      } catch (error) {
        preview = null;
        const result = { status: 'recovery-required', reason: safeReason(error) };
        log({ event: 'recovery', ...result });
        return result;
      }
      finally { activeExecution = null; busy = false; }
    },
  });
}
