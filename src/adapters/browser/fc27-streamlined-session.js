import { normalizeStreamlinedSettings, createStreamlinedSettings } from '../../streamlined/settings.js';
import { filterStreamlinedItems } from '../../streamlined/eligibility.js';
import { runStreamlinedPlan } from '../../streamlined/planner.js';
import { createStreamlinedPlan } from '../../streamlined/plan.js';
import { same, fail } from '../../streamlined/contract.js';

// Execution is optional and only entered through the separate contribution action.
// Public quotes are read only on Solve,
// deduplicated by version, using the account's single purchase price source.
export function createFc27StreamlinedSession({ inspect, readInputs, readMarketCandidates = null, get, set, prices, diagnosticLog = null,
  now = () => Date.now(), schedule, createExecution = null } = {}) {
  const settings = createStreamlinedSettings({ get, set });
  let busy = false, stopRequested = false, preview = null, activeExecution = null;
  const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_EXECUTION_UNAVAILABLE';
  const log = row => { try { Promise.resolve(diagnosticLog?.record?.({ area: 'streamlined', event: 'plan', ...row })).catch(() => {}); } catch { /* diagnostic only */ } };
  const capture = () => { const value = inspect(); if (!value?.context || !value.challenge) fail('PAGE_UNAVAILABLE'); return value; };
  const unchanged = origin => { const current = capture(); if (!same(current, origin)) fail('CONTEXT_CHANGED'); };
  return Object.freeze({
    async readSettings(global = false) { const origin = capture(); const value = await settings.read(origin.context, global ? null : origin.challenge.id); unchanged(origin); return { ...origin, settings: value }; },
    async saveSettings(value, global = false) { const origin = capture(); const result = await settings.save(origin.context, global ? null : origin.challenge.id, value); unchanged(origin); return result; },
    stop() { stopRequested = true; activeExecution?.transaction.stop(); },
    clearPreview() { preview = null; },
    resolveDisplayItem(ref) {
      if (!preview || !preview.items.some(item => item.id === ref?.id && item.definitionId === ref?.definitionId)) return null;
      try { unchanged(preview.origin); return preview.input.resolveDisplayItem?.(ref) ?? null; }
      catch { return null; }
    },
    async plan(value, { onProgress = () => {} } = {}) {
      if (busy) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
      busy = true; stopRequested = false; preview = null;
      const progress = row => { try { onProgress(row); } catch { /* display only */ } };
      try {
        const config = normalizeStreamlinedSettings(value), origin = capture();
        const input = readInputs(config); input.assertCurrent();
        const check = () => { unchanged(origin); input.assertCurrent(); if (stopRequested) fail('CANCELLED'); };
        const filtered = filterStreamlinedItems(input.inventory, input);
        if (filtered.status !== 'observed') return filtered;
        const ids = [...new Set(filtered.items.map(i => i.definitionId))];
        const references = {}; let quoteSource = 'futgg', quoteReadError = null;
        // No EA or third-party private catalogue lookup. Market provider remains
        // absent until native points/qualification and routes can be established.
        if (prices && config.mode !== 'market') {
          for (let offset = 0; offset < ids.length; offset += 250) {
            check(); progress({ phase: 'quotes', completed: offset, total: ids.length });
            try {
              const snapshot = await prices.load(ids.slice(offset, offset + 250), { purpose: 'puzzle', rows: input.priceRows,
                isCurrent: () => { check(); return true; } });
              if (offset && snapshot.policy.source !== quoteSource) fail('PRICE_POLICY_CHANGED');
              quoteSource = snapshot.policy.source; Object.assign(references, snapshot.references);
            } catch (error) { quoteReadError = /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_QUOTES_UNAVAILABLE'; break; }
          }
        }
        check();
        const quoteAt = now();
        let market = [];
        if (config.mode !== 'inventory' && typeof readMarketCandidates === 'function') {
          check(); market = await readMarketCandidates({ input, ids, quoteSource, references });
          if (!Array.isArray(market)) fail('MARKET_CANDIDATES_UNVERIFIED');
        }
        const inventory = input.inventory.map(item => {
          const q = references[item.definitionId]?.quotes?.[quoteSource];
          const valid = q?.definitionId === item.definitionId && q?.source === quoteSource && !q.error
            && Number.isSafeInteger(q.price) && q.price > 0 && q.fetchedAt <= quoteAt && q.expiresAt > quoteAt;
          return { ...item, price: valid ? q.price : null, quote: valid ? q : null };
        });
        const result = await runStreamlinedPlan({ ...input, inventory, market, mode: config.mode, objective: config.objective,
          quoteSource, quoteAt, now }, { onProgress: p => { check(); progress(p); },
          stopped: () => { unchanged(origin); input.assertCurrent(); return stopRequested; }, schedule });
        check();
        const plan = ['ready', 'partial'].includes(result.status)
          ? createStreamlinedPlan({ context: input.context, challenge: input.challenge, policy: input.policy, result, objective: config.objective }) : null;
        let execution = null, executionReason = 'FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED', executionRecovery = null;
        if (plan && typeof createExecution === 'function') {
          try {
            execution = await createExecution(origin.context); check();
            execution.prepare(plan); executionReason = null;
          } catch (error) { execution = null; executionReason = safeReason(error); executionRecovery = error?.recovery ?? null; }
          check();
        }
        if (plan) preview = { origin, input, items: result.items, plan, execution };
        log({ status: result.status, evaluations: result.nodes, currentScore: result.score, safeCandidates: result.candidateCount,
          count: result.batches?.length, estimatedCost: result.purchaseCost, unknownCount: result.unknownValueCount,
          searchComplete: result.searchComplete, reason: result.reason });
        if (executionReason) log({ event: 'execution-preflight', status: 'blocked', reason: executionReason,
          setId: executionRecovery?.setId, challengeId: executionRecovery?.challengeId, phase: executionRecovery?.phase });
        if (executionRecovery?.kind === 'puzzle-purchase') {
          for (const [phase, count] of Object.entries(executionRecovery.states ?? {})) {
            if (['waiting', 'buy-pending', 'bought', 'move-pending', 'move-rejected', 'club'].includes(phase)
                && Number.isSafeInteger(count) && count > 0 && count <= 32) {
              log({ event: 'purchase-recovery-state', phase, count,
                setId: executionRecovery.setId, challengeId: executionRecovery.challengeId });
            }
          }
        }
        return { ...result, plan, quoteSource, quoteReadError, marketAvailable: typeof readMarketCandidates === 'function',
          marketPending: config.mode !== 'inventory' && market.length === 0, policy: input.policy,
          liveExecutionEnabled: !!execution, executionReason, executionRecovery };
      } catch (error) {
        const reason = /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_PLAN_UNAVAILABLE';
        log({ status: 'blocked', reason });
        return { status: stopRequested ? 'cancelled' : 'blocked', reason, liveExecutionEnabled: false };
      } finally { busy = false; }
    },
    async contribute({ fingerprint, batchIndices, allowPartial = false } = {}, callbacks = {}) {
      if (busy) return { status: 'blocked', reason: 'FC27_STREAMLINED_BUSY' };
      if (!preview?.execution || preview.plan.fingerprint !== fingerprint) return { status: 'blocked', reason: 'FC27_STREAMLINED_PLAN_CHANGED' };
      busy = true; stopRequested = false;
      const selected = preview;
      try {
        unchanged(selected.origin); activeExecution = selected.execution;
        const result = await activeExecution.transaction.execute(selected.plan,
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
      preview = null;
      if (typeof createExecution !== 'function') return { status: 'blocked', reason: 'FC27_STREAMLINED_WRITE_CONTRACT_UNVERIFIED' };
      busy = true;
      try {
        const origin = capture(); activeExecution = await createExecution(origin.context); unchanged(origin);
        const result = await activeExecution.transaction.recover(origin.context,
          { setId: origin.challenge.setId, challengeId: origin.challenge.id });
        const current = capture();
        if (!same(current.context, origin.context) || current.challenge.id !== origin.challenge.id
            || current.challenge.setId !== origin.challenge.setId) fail('CONTEXT_CHANGED');
        log({ event: 'recovery', status: result.status, reason: result.reason, currentScore: result.record?.submittedScore,
          setId: origin.challenge.setId, challengeId: origin.challenge.id });
        const record = result.record;
        if (record && !['recovery-required', 'replan-required'].includes(result.status)) {
          if (!same(current.context, record.context) || current.challenge.id !== record.plan.challenge.id
              || current.challenge.setId !== record.plan.challenge.setId) fail('CONTEXT_CHANGED');
          activeExecution.prepare(record.plan);
          const input = readInputs({ maxRating: record.plan.policy.maxRating });
          preview = { origin: current, input, items: record.plan.items, plan: record.plan, execution: activeExecution };
          return { ...result, preview: { ...record.plan, plan: record.plan, liveExecutionEnabled: true,
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
