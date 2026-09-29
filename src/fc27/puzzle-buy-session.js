// One batch is bound to one account, saved concept draft and current squad.
// No EA objects cross this boundary. A dispatch marker precedes each mutation.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw new Error(reason); };
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const safeReason = e => /^FC27_[A-Z0-9_]+$/.test(e?.message ?? '') ? e.message : 'FC27_BUY_UNCONFIRMED';
export const puzzleBuyKey = (scope, target) => `fcat-fc27-puzzle-buy:${scope}:${target.setId}:${target.challengeId}`;
export const puzzleBuyPendingKey = scope => `fcat-fc27-puzzle-buy-pending:${scope}`;
export const conceptDraftKey = (scope, target) => `fcat-fc27-concept-draft:${scope}:${target.setId}:${target.challengeId}`;
const settled = record => Array.isArray(record?.entries) && record.entries.every(e => !['buy-pending', 'bought', 'move-pending'].includes(e.state)) && record.phase !== 'save-pending';

export function createFc27PuzzleBuySession({ scope, context, get, set, exclusive, loadDraft,
  createAdapter, assertCurrent, shouldStop = () => false, onProgress = () => {} } = {}) {
  const store = async (key, value) => {
    await set(key, structuredClone(value));
    if (!same(await get(key, null), value)) fail('FC27_BUY_JOURNAL_UNCONFIRMED');
  };
  const check = record => {
    if (!record || record.schema !== 1 || record.scope !== scope || !same(record.context, context)
        || !Array.isArray(record.entries) || record.entries.length > 32
        || record.entries.some(e => !integer(e.slot) || e.slot > 31 || !integer(e.definitionId, 1)
          || !['waiting', 'buy-pending', 'bought', 'move-pending', 'move-rejected', 'club'].includes(e.state)
          || e.state !== 'waiting' && (!integer(e.itemId, 1) || (e.source === 'owned'
            ? e.state !== 'club' || e.tradeId !== '0' || e.price !== 0
            : typeof e.tradeId !== 'string' || !/^[1-9]\d{0,19}$/.test(e.tradeId) || !integer(e.price, 150))))
        || new Set(record.entries.map(e => e.slot)).size !== record.entries.length
        || !['ready', 'save-pending', 'saved'].includes(record.phase)) fail('FC27_BUY_JOURNAL_UNCONFIRMED');
  };
  const summary = record => {
    const entries = Array.isArray(record?.entries) ? record.entries : [];
    const acquired = entries.filter(e => ['bought', 'move-pending', 'move-rejected', 'club'].includes(e.state));
    return { purchased: acquired.filter(e => e.source !== 'owned').length, reused: acquired.filter(e => e.source === 'owned').length,
      fulfilled: acquired.length, total: entries.length, spent: acquired.reduce((sum, e) => sum + (integer(e.price) ? e.price : 0), 0) };
  };
  return Object.freeze({
    async execute(target, { budget, quoteCeiling = null, expectedOperationId, approved = false, recoverOnly = false } = {}) {
      let adapter; let record;
      try {
        target = { setId: target?.setId, challengeId: target?.challengeId };
        if (!integer(target.setId, 1) || !integer(target.challengeId, 1)) fail('FC27_BUY_PLAN_CHANGED');
        if (approved !== true || !integer(budget) || budget > 165000000
            || quoteCeiling !== null && (!integer(quoteCeiling, 150) || quoteCeiling > 15000000)) fail('FC27_BUY_APPROVAL_REQUIRED');
        return await exclusive(scope, async () => {
          assertCurrent();
          const draft = await loadDraft(target);
          if (!draft || draft.phase !== 'saved' || draft.operationId !== expectedOperationId
              || !same(draft.plan.context, context)) fail('FC27_BUY_PLAN_CHANGED');
          const key = puzzleBuyKey(scope, target);
          const pending = await get(puzzleBuyPendingKey(scope), null);
          if (pending !== null && (pending.key !== key || pending.operationId !== draft.operationId)) fail('FC27_BUY_RECOVERY_REQUIRED');
          record = await get(key, null);
          if (record) {
            check(record);
            if (record.operationId !== draft.operationId) {
              if (!settled(record) || pending) fail('FC27_BUY_RECOVERY_REQUIRED');
              record = null;
            } else if (!same(record.base, draft.plan)) fail('FC27_BUY_PLAN_CHANGED');
          }
          record ??= { schema: 1, scope, context, operationId: draft.operationId, target,
            base: draft.plan, phase: 'ready', applied: [], entries: draft.plan.slots.filter(s => s?.kind === 'concept')
              .map(s => ({ slot: s.slot, definitionId: s.definitionId, state: 'waiting' })) };
          check(record);
          if (!same(record.target, target) || !same(record.base.context, context)
              || record.entries.length !== record.base.slots.filter(s => s?.kind === 'concept').length
              || record.entries.some(e => record.base.slots[e.slot]?.kind !== 'concept'
                || record.base.slots[e.slot].definitionId !== e.definitionId)
              || !Array.isArray(record.applied) || record.applied.some(e => e.state !== 'club'
                || !record.entries.some(entry => same(entry, e)))) fail('FC27_BUY_JOURNAL_UNCONFIRMED');
          adapter = await createAdapter();
          // Server and local page must agree before any new spending. A save
          // whose response was lost is read back without sending another PUT.
          if (record.phase === 'save-pending') {
            await adapter.recoverSave(record);
            record.applied = record.entries.filter(e => e.state === 'club').map(e => ({ ...e }));
            record.phase = 'saved'; await store(key, record);
            await store(puzzleBuyPendingKey(scope), null);
          }
          for (const entry of record.entries.filter(e => ['buy-pending', 'bought', 'move-pending', 'move-rejected'].includes(e.state))) {
            const location = await adapter.locate(entry);
            if (location === 'club') entry.state = 'club';
            else if (location === 'purchased') entry.state = 'bought';
            else fail('FC27_BUY_RECEIPT_UNCONFIRMED');
          }
          await store(key, record);
          await adapter.verifySquad(record);
          await store(key, record);
          const persist = () => store(key, record);
          const mark = async () => {
            await store(puzzleBuyPendingKey(scope), { key, operationId: record.operationId });
            await persist();
          };
          const report = (phase = 'progress', entry = null, extra = {}) => {
            try {
              const index = entry ? record.entries.indexOf(entry) : -1;
              onProgress({ ...summary(record), failures: failures.map(item => ({ ...item })), phase,
                index: index >= 0 ? index + 1 : null, total: record.entries.length,
                ...(entry ? { slot: entry.slot, definitionId: entry.definitionId } : {}), ...extra });
            } catch { /* UI only. */ }
          };
          let stopReason = null;
          const failures = [];
          try {
            for (const entry of record.entries) {
              if (entry.state === 'club') continue;
              try {
              // An uncertain purchase is reconciled by exact item identity;
              // absence alone never authorizes a second bid.
              if (['buy-pending', 'bought', 'move-pending'].includes(entry.state)) {
                const location = await adapter.locate(entry);
                if (location === 'club') { entry.state = 'club'; await persist(); }
                else if (location === 'purchased') { entry.state = 'bought'; await persist(); }
                else fail('FC27_BUY_RECEIPT_UNCONFIRMED');
              }
              if (entry.state === 'waiting') {
                assertCurrent();
                if (recoverOnly || shouldStop()) { stopReason = 'FC27_BUY_STOPPED'; break; }
                const remaining = budget - summary(record).spent;
                await adapter.verifyCurrent(record);
                report('search', entry);
                const quote = await adapter.find(entry.definitionId, quoteCeiling ?? Infinity);
                if (!quote) { failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: 'FC27_BUY_NO_LISTING' }); report('failed', entry, { reason: 'FC27_BUY_NO_LISTING' }); continue; }
                if (quote.unavailable) { failures.push({ slot: entry.slot, definitionId: entry.definitionId,
                  reason: quote.reason, httpStatus: quote.httpStatus, errorCode: quote.errorCode }); report('failed', entry, quote); continue; }
                if (quote.definitionId !== entry.definitionId || !integer(quote.itemId, 1)
                    || !integer(quote.price, 150)
                    || quoteCeiling !== null && quote.price > quoteCeiling
                    || typeof quote.tradeId !== 'string' || !/^[1-9]\d{0,19}$/.test(quote.tradeId)) fail('FC27_BUY_QUOTE_UNVERIFIED');
                report('price-ready', entry, { price: quote.price });
                if (quote.price > remaining) {
                  failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: 'FC27_BUY_BUDGET_EXCEEDED' });
                  report('failed', entry, { reason: 'FC27_BUY_BUDGET_EXCEEDED', price: quote.price }); continue;
                }
                assertCurrent();
                if (shouldStop()) { stopReason = 'FC27_BUY_STOPPED'; break; }
                Object.assign(entry, quote, { state: 'buy-pending' }); await mark();
                report('buying', entry, { price: entry.price });
                // Exactly one native Buy Now call. Never resend on timeout.
                const receipt = await adapter.buy(entry);
                if (receipt.status === 'rejected') {
                  entry.state = 'waiting'; await persist();
                  failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: receipt.reason,
                    httpStatus: receipt.httpStatus, errorCode: receipt.errorCode }); report('failed', entry, receipt); continue;
                }
                if (receipt.status !== 'bought' || receipt.itemId !== entry.itemId
                    || receipt.definitionId !== entry.definitionId || receipt.tradeId !== entry.tradeId
                    || receipt.price !== entry.price) fail('FC27_BUY_RECEIPT_UNCONFIRMED');
                entry.state = 'bought'; await persist(); report('bought', entry, { price: entry.price });
              }
              if (entry.state === 'bought') {
                entry.state = 'move-pending'; await mark();
                report('moving', entry, { price: entry.price });
                const moved = await adapter.move(entry);
                if (moved?.status === 'rejected') {
                  entry.state = 'move-rejected'; await persist();
                  failures.push({ slot: entry.slot, definitionId: entry.definitionId, reason: moved.reason,
                    httpStatus: moved.httpStatus, errorCode: moved.errorCode }); report('failed', entry, moved); continue;
                }
                if (await adapter.locate(entry) !== 'club') fail('FC27_BUY_MOVE_UNCONFIRMED');
                entry.state = 'club'; await persist(); report('completed', entry, { price: entry.price });
              }
              } finally { report('progress', entry); await adapter.afterPlayer?.(); }
            }
          } catch (e) { stopReason = safeReason(e); }
          // Save only after all in-flight receipts settle. Stopping cannot turn
          // an unknown purchase into a reusable authorization or duplicate buy.
          record.lastResult = { reason: stopReason ?? failures[0]?.reason ?? 'FC27_BUY_COMPLETED', failures };
          await persist();
          if (!settled(record)) return { status: 'recovery-required', ...record.lastResult, ...summary(record) };
          const acquired = record.entries.filter(e => e.state === 'club');
          if (!same(acquired, record.applied)) {
            const result = await adapter.save(record, async () => { record.phase = 'save-pending'; await mark(); });
            record.applied = (result?.applied ?? acquired).map(e => ({ ...e })); record.phase = 'saved'; await persist();
          }
          await store(puzzleBuyPendingKey(scope), null);
          return { status: acquired.length === record.entries.length ? 'purchased' : 'partial',
            ...record.lastResult, ...summary(record), saved: acquired.length > 0 && record.applied.length === acquired.length,
            replacementPending: record.applied.length !== acquired.length, submitted: false };
        });
      } catch (e) {
        // Diagnostic only. Mandatory dispatch evidence has already been stored.
        if (record) {
          record.lastResult = { reason: safeReason(e), failures: record.lastResult?.failures ?? [] };
          try { await set(`fcat-fc27-puzzle-buy-last:${scope}`, { target: record.target, ...record.lastResult, ...summary(record) }); }
          catch { /* Keep original reason; never mutate the journal outside its lock. */ }
        }
        return { status: record && !settled(record) ? 'recovery-required' : 'blocked', reason: safeReason(e),
          ...(record ? summary(record) : {}), submitted: false };
      }
      finally { adapter?.cancel?.(); }
    },
  });
}
