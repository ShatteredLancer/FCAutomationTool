// Exact Gallery version purchase journal. It deliberately has no SBC or EA
// page knowledge; those facts are supplied by the injected adapter.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => Number.isSafeInteger(value) && value > 0;
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_PURCHASE_UNCONFIRMED';
const states = new Set(['waiting', 'buy-pending', 'bought', 'move-pending', 'move-rejected', 'club', 'collected']);
export const galleryPurchaseKey = scope => `fcat-fc27-gallery-purchase:${scope}`;
export const galleryPurchasePendingKey = scope => `fcat-fc27-gallery-purchase-pending:${scope}`;
const pending = record => record.entries.some(entry => ['buy-pending', 'bought', 'move-pending', 'move-rejected'].includes(entry.state));
const quote = (value, definitionId) => value?.definitionId === definitionId && id(value.itemId)
  && typeof value.tradeId === 'string' && /^[1-9]\d{0,19}$/.test(value.tradeId)
  && Number.isSafeInteger(value.price) && value.price >= 150 && value.price <= 15000000;
const summary = record => {
  const entries = record?.entries ?? [], acquired = entries.filter(entry => ['bought', 'move-pending', 'move-rejected', 'club'].includes(entry.state));
  return { total: entries.length, purchased: acquired.length, completed: entries.filter(entry => ['club', 'collected'].includes(entry.state)).length,
    spent: acquired.reduce((sum, entry) => sum + (entry.price ?? 0), 0) };
};
const itemResults = record => (record?.entries ?? []).map((entry, index) => ({ definitionId: entry.definitionId,
  name: record?.plan?.[index]?.name ?? '', state: entry.state,
  price: !['waiting', 'collected', 'buy-pending'].includes(entry.state) ? entry.price : null,
  reason: record.lastResult?.failures?.find(row => row.definitionId === entry.definitionId)?.reason ?? null }));
function validate(record, scope, context) {
  if (!record || record.schema !== 1 || record.scope !== scope || !same(record.context, context)
      || typeof record.operationId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(record.operationId)
      || typeof record.binding !== 'string' || !record.binding || record.binding.length > 12000
      || record.budget != null && (!Number.isSafeInteger(record.budget) || record.budget < 0 || record.budget > 165000000)
      || !Array.isArray(record.plan) || !Array.isArray(record.entries)
      || record.plan.length < 1 || record.plan.length > 256 || record.entries.length !== record.plan.length
      || new Set(record.plan.map(item => item.definitionId)).size !== record.plan.length
      || record.entries.some((entry, index) => !id(entry.definitionId) || entry.definitionId !== record.plan[index].definitionId
        || !states.has(entry.state) || !['waiting', 'collected'].includes(entry.state) && !quote(entry, entry.definitionId))) throw new Error('FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED');
}
export function createGalleryPurchaseSession({ scope, context, get, set, exclusive, createAdapter,
  assertCurrent = () => {}, checkOtherTransactions = async () => {}, shouldStop = () => false, onProgress = () => {}, operationId = () => `gallery-${Date.now()}-${Math.random().toString(16).slice(2)}` } = {}) {
  const key = galleryPurchaseKey(scope), pendingKey = galleryPurchasePendingKey(scope);
  const write = async (storageKey, value) => { await set(storageKey, structuredClone(value)); if (!same(await get(storageKey, null), value)) throw new Error('FC27_GALLERY_PURCHASE_JOURNAL_UNCONFIRMED'); };
  return Object.freeze({
    async inspect() { try { assertCurrent(); const record = await get(key, null); assertCurrent();
      if (!record) return { status: 'absent' }; validate(record, scope, context);
      return { status: 'observed', recovery: pending(record), remaining: record.entries.filter(entry => entry.state === 'waiting').length,
        operationId: record.operationId, collection: record.collection, results: itemResults(record), ...summary(record) };
    } catch (error) { return { status: 'blocked', reason: safeReason(error) }; } },
    async execute({ items, binding, resume = false, expectedOperationId = null, budget = null, quoteCeiling = null, approved = false } = {}) {
      if (approved !== true || !resume && (!Array.isArray(items) || !items.length || items.length > 256 || typeof binding !== 'string' || !binding || binding.length > 12000)
          || budget !== null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 165000000)
          || quoteCeiling !== null && (!Number.isSafeInteger(quoteCeiling) || quoteCeiling < 150 || quoteCeiling > 15000000)) return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_APPROVAL_REQUIRED' };
      let record, adapter;
      try {
        const result = await exclusive(scope, async () => {
          assertCurrent(); await checkOtherTransactions(); record = await get(key, null); const oldPending = await get(pendingKey, null); assertCurrent();
          if (record) validate(record, scope, context);
          if (oldPending && (!record || oldPending.operationId !== record.operationId)) throw new Error('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
          if (resume && (!record || expectedOperationId !== record.operationId)) throw new Error('FC27_GALLERY_PURCHASE_PLAN_CHANGED');
          const plan = resume ? record.plan : items.map(item => ({ definitionId: item.definitionId ?? item.eaId,
            name: typeof item.name === 'string' ? item.name.slice(0, 120) : '' }));
          if (resume) { binding = record.binding; budget = record.budget ?? null; }
          if (plan.some(item => !id(item.definitionId)) || new Set(plan.map(item => item.definitionId)).size !== plan.length) throw new Error('FC27_GALLERY_PURCHASE_PLAN_CHANGED');
          const changed = record && (!same(record.binding, binding) || !same(record.plan, plan));
          if (changed && (oldPending || pending(record))) throw new Error('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
          if (changed) await write(`${key}:${record.operationId}`, record);
          if (!record || changed) record = { schema: 1, scope, context, operationId: operationId(), binding, budget,
            plan: structuredClone(plan), entries: plan.map(item => ({ definitionId: item.definitionId, state: 'waiting' })) };
          else if (!resume) record.budget = budget;
          validate(record, scope, context); await write(key, record); adapter = await createAdapter(record); await adapter.verifySquad(record);
          const failures = [], save = () => write(key, record), mark = async () => { await write(pendingKey, { schema: 1, operationId: record.operationId }); await save(); };
          const report = (phase, entry, extra = {}) => { try { onProgress({ ...summary(record), phase,
            index: entry ? record.entries.indexOf(entry) + 1 : 0, definitionId: entry?.definitionId ?? null, failures: [...failures], ...extra }); } catch {} };
          let stopReason = null;
          for (const entry of record.entries) {
            if (entry.state === 'club' || entry.state === 'collected') continue;
            try {
              assertCurrent(); await adapter.verifyCurrent(record);
              if (['buy-pending', 'bought', 'move-pending', 'move-rejected'].includes(entry.state)) {
                const located = await adapter.locate(entry); if (located === 'club') entry.state = 'club'; else if (located === 'purchased') entry.state = 'bought'; else throw new Error('FC27_GALLERY_PURCHASE_RECEIPT_UNCONFIRMED'); await save();
              }
              if (entry.state === 'waiting') {
                if (shouldStop()) { stopReason = 'FC27_GALLERY_PURCHASE_STOPPED'; break; }
                const collectionState = await adapter.collectionState(entry.definitionId);
                if (typeof collectionState !== 'boolean') throw new Error('FC27_GALLERY_COLLECTION_UNCONFIRMED');
                if (collectionState) { entry.state = 'collected'; await save(); report('already-collected', entry); continue; }
                report('search', entry); const found = await adapter.find(entry.definitionId, quoteCeiling ?? Infinity);
                if (!found || found.unavailable) { failures.push({ definitionId: entry.definitionId, reason: found?.reason ?? 'FC27_GALLERY_NO_LISTING' }); report('failed', entry); continue; }
                if (!quote(found, entry.definitionId) || quoteCeiling !== null && found.price > quoteCeiling) throw new Error('FC27_BUY_QUOTE_UNVERIFIED');
                if (budget !== null && summary(record).spent + found.price > budget) { failures.push({ definitionId: entry.definitionId, reason: 'FC27_GALLERY_BUDGET_EXCEEDED', observedPrice: found.price }); report('failed', entry); continue; }
                assertCurrent(); await adapter.verifyCurrent(record);
                if (shouldStop()) { stopReason = 'FC27_GALLERY_PURCHASE_STOPPED'; break; }
                Object.assign(entry, found, { state: 'buy-pending' }); await mark();
                assertCurrent(); await adapter.verifyCurrent(record);
                if (shouldStop()) { const definitionId = entry.definitionId; Object.keys(entry).forEach(field => delete entry[field]);
                  Object.assign(entry, { definitionId, state: 'waiting' }); await save(); stopReason = 'FC27_GALLERY_PURCHASE_STOPPED'; break; }
                report('buying', entry);
                const receipt = await adapter.buy(entry);
                if (receipt?.status === 'rejected') {
                  const definitionId = entry.definitionId; for (const field of Object.keys(entry)) delete entry[field];
                  Object.assign(entry, { definitionId, state: 'waiting' }); await save();
                  failures.push({ definitionId, reason: receipt.reason }); report('failed', entry); continue;
                }
                if (receipt?.status !== 'bought' || !quote(receipt, entry.definitionId) || receipt.itemId !== entry.itemId || receipt.tradeId !== entry.tradeId || receipt.price !== entry.price) throw new Error('FC27_GALLERY_PURCHASE_RECEIPT_UNCONFIRMED');
                entry.state = 'bought'; await save(); report('bought', entry);
              }
              if (entry.state === 'bought') { entry.state = 'move-pending'; await mark(); report('moving', entry); const moved = await adapter.move(entry); if (moved?.status === 'rejected') { entry.state = 'move-rejected'; failures.push({ definitionId: entry.definitionId, reason: moved.reason }); await save(); continue; } if (await adapter.locate(entry) !== 'club') throw new Error('FC27_GALLERY_MOVE_UNCONFIRMED'); entry.state = 'club'; await save(); report('completed', entry); }
            } catch (error) { stopReason = safeReason(error); break; }
            finally { report('progress', entry); try { await adapter.afterPlayer?.(); } catch (error) { stopReason ??= safeReason(error); } }
            if (stopReason) break;
          }
          record.lastResult = { reason: stopReason ?? failures[0]?.reason ?? 'FC27_GALLERY_PURCHASE_COMPLETED', failures }; await save();
          if (pending(record)) return { status: 'recovery-required', ...record.lastResult, results: itemResults(record), ...summary(record) };
          try { record.collection = await adapter.confirmCollection(record.entries.filter(entry => ['club', 'collected'].includes(entry.state)).map(entry => entry.definitionId)); }
          catch (error) { record.collection = { status: 'pending', reason: safeReason(error) }; }
          assertCurrent(); await save();
          if (record.collection?.status === 'confirmed' || summary(record).spent === 0) await write(pendingKey, null);
          else await write(pendingKey, { schema: 1, operationId: record.operationId });
          return { status: record.entries.every(entry => ['club', 'collected'].includes(entry.state)) ? 'purchased' : 'partial', ...record.lastResult, results: itemResults(record), ...summary(record), collection: record.collection, submitted: false };
        });
        return result ?? { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_BUSY' };
      } catch (error) { return { status: record && pending(record) ? 'recovery-required' : 'blocked', reason: safeReason(error), results: itemResults(record), ...summary(record) }; }
      finally { adapter?.cancel?.(); }
    },
  });
}
