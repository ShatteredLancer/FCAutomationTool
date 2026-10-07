import { readFc27Context } from '../ea/fc27-local-read.js';
import { createEaTradeAdapter } from '../ea/trade.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';
import { traditionalJournalScope, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { galleryPurchasePendingKey, galleryPurchaseKey } from '../../gallery/purchase-session.js';
import { projectGalleryListingReceipts } from '../../gallery/listing-candidates.js';
import { createGalleryBulkListSession, readGalleryBulkListRecovery, assertNoGalleryListingPending } from '../../gallery/bulk-list-session.js';
import { normalizeBulkRelistSnapshot, bulkRelistSnapshotFingerprint } from '../../trade/bulk-relist-snapshot.js';
import { createBulkRelistTransaction } from '../../trade/bulk-relist-transaction.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = value => structuredClone(value);
const fail = reason => { throw Error(reason); };
export const galleryRelistKey = scope => `fcat-fc27-gallery-auto-relist-v1:${scope}`;
const safe = error => /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_RELIST_UNCONFIRMED';
const positive = value => Number.isSafeInteger(value) && value > 0;

// Enhancer Auto Relist: 1/5/10 minute checks (default 10), unchanged
// auction prices, only Unsold. Batch scope uses exact individual listings;
// all scope alone uses the existing aggregate transaction/adapter call site.
// FCAT retains finite authorization (two runs) and durable unknown receipts.
export function createFc27GalleryRelist({ root, get, set, purchase, liveEnabled = false,
  adapterFactory = createEaTradeAdapter, now = Date.now, sleep, diagnosticLog } = {}) {
  let busy = false, stopped = false;
  const contextNow = () => readFc27Context(root);
  const read = async (context, scope) => {
    const raw = await get(galleryRelistKey(scope), null);
    if (raw === null) return null;
    if (raw.schema !== 1 || !same(raw.context, context) || raw.scope !== scope || typeof raw.id !== 'string' || !raw.id
      || !['batch', 'all'].includes(raw.range) || ![1, 5, 10].includes(raw.minutes)
      || !['armed', 'disarmed', 'running', 'blocked', 'completed'].includes(raw.status)
      || !positive(raw.nextAt) || !positive(raw.expiresAt) || !Number.isInteger(raw.runs) || raw.runs < 0 || raw.runs > 2
      || !Array.isArray(raw.items) || raw.items.length > 256
      || raw.items.some(ref => !positive(ref.id) || !positive(ref.definitionId))
      || new Set(raw.items.map(ref => ref.id)).size !== raw.items.length
      || raw.range === 'batch' && (!raw.items.length || typeof raw.purchaseBinding !== 'string' || !raw.purchaseBinding)
      || raw.pending !== null && (!Array.isArray(raw.pending) || !raw.pending.length || raw.pending.length > 100
        || raw.pending.some(row => !positive(row?.item?.id) || !positive(row?.item?.definitionId)
          || !positive(row.auction?.startingBid) || !positive(row.auction?.buyNowPrice)))) fail('FC27_GALLERY_RELIST_RECORD_INVALID');
    return copy(raw);
  };
  const write = async (scope, value) => {
    await set(galleryRelistKey(scope), copy(value));
    if (!same(await get(galleryRelistKey(scope), null), value)) fail('FC27_GALLERY_RELIST_RECORD_UNCONFIRMED');
  };
  const environment = () => {
    const context = contextNow(), scope = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue: get, gmSetValue: set, lockManager: root.navigator?.locks });
    const assert = () => { if (!same(context, contextNow())) fail('FC27_GALLERY_CONTEXT_CHANGED'); };
    const adapter = adapterFactory(root);
    const guard = async () => {
      assert();
      if (!liveEnabled || !persistence.lock.hasExclusiveAccess(scope)) fail('FC27_GALLERY_LISTING_DISABLED');
      const journal = await persistence.journal.read(scope);
      if (journal && !isTerminalTraditionalJournal(journal)) fail('FC27_RECOVERY_REQUIRED');
      if (await get(galleryPurchasePendingKey(scope), null)) fail('FC27_BUY_RECOVERY_REQUIRED');
      const circuit = await get(`fcat-fc27-gallery-listing-circuit-v1:${scope}`, null);
      if (circuit && (circuit.schema !== 1 || circuit.scope !== scope || typeof circuit.persistent !== 'boolean'
        || !Number.isSafeInteger(circuit.retryAt))) fail('FC27_GALLERY_LISTING_CIRCUIT_UNVERIFIED');
      if (circuit?.persistent || circuit?.retryAt > now()) fail('FC27_GALLERY_LISTING_CIRCUIT_OPEN');
      assert();
    };
    const response = async result => {
      const code = Number(result?.error?.code ?? result?.response?.status);
      if ([427, 429].includes(code)) {
        const value = { schema: 1, scope, persistent: code === 427, retryAt: code === 429 ? now() + 60000 : 0 };
        const key = `fcat-fc27-gallery-listing-circuit-v1:${scope}`;
        await set(key, value); if (!same(await get(key, null), value)) fail('FC27_GALLERY_LISTING_CIRCUIT_UNCONFIRMED');
      }
    };
    return { context, scope, persistence, assert, adapter, guard, response };
  };
  const recordEvent = state => { try { Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', event: 'listing-stage', phase: 'auto-relist',
    status: state.status, reason: state.reason, count: state.runs })).catch(() => {}); } catch { /* Diagnostic only. */ } };
  const api = {
    async read() {
      try { const context = contextNow(), scope = traditionalJournalScope(context); return await read(context, scope) ?? { status: 'absent', range: 'batch', minutes: 10 }; }
      catch (error) { return { status: 'blocked', reason: safe(error) }; }
    },
    async arm({ approved = false, range = 'batch', minutes = 10 } = {}) {
      if (!approved || !liveEnabled || !['batch', 'all'].includes(range) || ![1, 5, 10].includes(minutes)) return { status: 'blocked', reason: 'FC27_GALLERY_RELIST_APPROVAL_REQUIRED' };
      try {
        const env = environment();
        return await env.persistence.exclusive(env.scope, async () => {
          await env.guard(); const old = await read(env.context, env.scope);
          if (old && ['running', 'blocked', 'armed'].includes(old.status)) fail('FC27_GALLERY_RELIST_RECOVERY_REQUIRED');
          let snapshot = null, items = [];
          if (range === 'batch') {
            snapshot = await purchase.inspect(); env.assert();
            if (snapshot?.status !== 'observed') fail(snapshot?.reason ?? 'FC27_GALLERY_LISTING_NO_PURCHASE');
            const receipts = projectGalleryListingReceipts({ scope: env.scope, context: env.context,
              purchase: await get(galleryPurchaseKey(env.scope), null), pendingMarker: await get(galleryPurchasePendingKey(env.scope), null),
              expectedOperationId: snapshot.operationId, expectedBinding: snapshot.binding });
            if (receipts.status !== 'observed') fail(receipts.reason);
            items = receipts.entries.filter(row => positive(row.itemId) && positive(row.definitionId))
              .map(row => ({ id: row.itemId, definitionId: row.definitionId }));
            if (!items.length || new Set(items.map(row => row.id)).size !== items.length) fail('FC27_GALLERY_LISTING_NO_PURCHASE');
          }
          const value = { schema: 1, scope: env.scope, context: env.context, id: root.crypto.randomUUID(),
            range, minutes, status: 'armed', runs: 0, nextAt: now() + minutes * 60000, expiresAt: now() + 86400000,
            purchaseBinding: snapshot ? `${snapshot.operationId}:${snapshot.binding}` : null, items, reason: null, pending: null };
          env.assert(); await write(env.scope, value); return value;
        }) ?? { status: 'waiting-operation' };
      } catch (error) { return { status: 'blocked', reason: safe(error) }; }
    },
    async disarm() {
      stopped = true;
      try {
        const env = environment();
        return await env.persistence.exclusive(env.scope, async () => {
          env.assert(); const value = await read(env.context, env.scope);
          if (!value) return { status: 'absent' };
          if (value.status === 'running' || value.pending) fail('FC27_GALLERY_RELIST_RECOVERY_REQUIRED');
          value.status = 'disarmed'; value.reason = 'user-stopped'; await write(env.scope, value); return value;
        }) ?? { status: 'waiting-operation' };
      } catch (error) { return { status: 'blocked', reason: safe(error) }; }
    },
    async poll({ recover = false } = {}) {
      if (busy) return { status: 'waiting-operation' };
      busy = true; stopped = false;
      try {
        const env = environment();
        return await env.persistence.exclusive(env.scope, async () => {
          let value = await read(env.context, env.scope); env.assert();
          if (!value) return { status: 'absent' };
          if (!recover && value.status !== 'armed') return value;
          if (recover) {
            // Recovery is read-only and never converts an unconfirmed expired
            // auction into permission to send another relist request.
            if (!value.pending) {
              if (!['running', 'blocked'].includes(value.status)) return value;
              value.status = 'disarmed'; value.reason = 'reconciled-no-request'; await write(env.scope, value); return value;
            }
            if ((await env.adapter.refreshTransferItems()).status !== 'completed') fail('FC27_GALLERY_RELIST_RECOVERY_REQUIRED');
            env.assert();
            const exact = value.pending.every(row => {
              const current = env.adapter.inspectListingItem({ ...row.item, pile: 'transfer' })?.candidate;
              return current?.item.id === row.item.id && current.item.definitionId === row.item.definitionId
                && current.auction?.state === 'active' && current.auction.startingBid === row.auction.startingBid
                && current.auction.buyNowPrice === row.auction.buyNowPrice;
            });
            if (!exact) fail('FC27_GALLERY_RELIST_RECOVERY_REQUIRED');
            if (value.range === 'batch') await assertNoGalleryListingPending(get, env.scope, {
              set, context: env.context, assertCurrent: env.assert, createAdapter: () => env.adapter });
            value.status = 'disarmed'; value.pending = null; value.reason = 'reconciled';
            await write(env.scope, value); return value;
          }
          if (value.expiresAt <= now() || value.runs >= 2) {
            value.status = 'completed'; value.reason = 'authorization-expired'; await write(env.scope, value); return value;
          }
          if (value.nextAt > now()) return { ...value, status: 'waiting-time' };
          await env.guard();
          const previous = await readGalleryBulkListRecovery(get, env.scope);
          if (!['absent', 'clear'].includes(previous.status)) fail('FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED');
          if (value.range === 'batch') {
            const snapshot = await purchase.inspect(); env.assert();
            if (`${snapshot?.operationId}:${snapshot?.binding}` !== value.purchaseBinding) {
              value.status = 'blocked'; value.reason = 'FC27_GALLERY_LISTING_PURCHASE_CHANGED'; await write(env.scope, value); return value;
            }
          }
          if ((await env.adapter.refreshTransferItems()).status !== 'completed') fail('FC27_GALLERY_TRANSFER_UNCONFIRMED');
          env.assert();
          const before = normalizeBulkRelistSnapshot(env.adapter.inspectBulkRelistSnapshot());
          if (before.status !== 'loaded' || before.truncated
            || before.items.some(row => !positive(row.item.id) || !positive(row.item.definitionId))
            || new Set(before.items.map(row => row.item.id)).size !== before.items.length) fail('FC27_GALLERY_RELIST_SNAPSHOT_UNVERIFIED');
          const entries = value.range === 'all' ? before.items : before.items.filter(row => value.items.some(ref => ref.id === row.item.id && ref.definitionId === row.item.definitionId));
          if (!entries.length) {
            value.nextAt = now() + value.minutes * 60000; value.reason = 'skipped-empty';
            await write(env.scope, value); return value;
          }
          value.status = 'running'; await write(env.scope, value);
          // Durable running is an occurrence claim. The account Web Lock is
          // held through request and reconciliation; a reload cannot rerun it.
          const current = async () => {
            await env.guard();
            if (stopped || !same(await read(env.context, env.scope), value)) fail('FC27_GALLERY_RELIST_PLAN_CHANGED');
            if (value.range === 'batch') {
              const snapshot = await purchase.inspect(); env.assert();
              if (`${snapshot?.operationId}:${snapshot?.binding}` !== value.purchaseBinding) fail('FC27_GALLERY_LISTING_PURCHASE_CHANGED');
            }
          };
          let result;
          if (value.range === 'all') {
            const wrapped = { ...env.adapter, relistExpiredAuctions: async options => {
              await current(); value.pending = copy(before.items); await write(env.scope, value); env.assert();
              const response = await env.adapter.relistExpiredAuctions(options); await env.response(response);
              if (response.status === 'rejected') { value.pending = null; await write(env.scope, value); }
              return response;
            } };
            const token = root.crypto.randomUUID();
            result = await createBulkRelistTransaction({ getTradeAdapter: () => wrapped, now }).run({
              before, confirmationToken: token, confirmation: { action: 'bulk-relist', token,
                fingerprint: bulkRelistSnapshotFingerprint(before), expiresAt: now() + 60000 },
              runId: `${value.id}:${value.runs}`, beforeMutation: async () => { await current(); return true; } });
          } else {
            const session = createGalleryBulkListSession({ scope: env.scope, context: env.context, get, set,
              exclusive: async (_scope, task) => task(), tradeAdapter: env.adapter, assertCurrent: env.assert,
              checkOtherTransactions: env.guard, beforeMutation: async entry => {
                await current(); const original = entries.find(row => row.item.id === entry.item.id);
                const live = env.adapter.inspectListingItem(entry.item)?.candidate?.auction;
                if (String(live?.tradeId) !== String(original.auction.tradeId) || live.startingBid !== original.auction.startingBid
                  || live.buyNowPrice !== original.auction.buyNowPrice) fail('FC27_GALLERY_RELIST_PLAN_CHANGED');
                value.pending ??= []; value.pending.push(copy(original)); await write(env.scope, value);
              }, afterMutation: async (entry, result) => {
                await env.response(result);
                if (['rejected', 'not-found', 'moved'].includes(result?.status)) {
                  value.pending = value.pending?.filter(row => row.item.id !== entry.item.id) ?? null;
                  if (!value.pending?.length) value.pending = null;
                  await write(env.scope, value);
                }
              }, shouldStop: () => stopped, sleep });
            result = await session.execute({ approved: true, binding: `relist:${value.id}:${value.runs}`, entries: entries.map(row => ({
              item: row.item, name: row.name, purchase: { tradeId: String(row.auction.tradeId) },
              startPrice: row.auction.startingBid, buyNow: row.auction.buyNowPrice, durationSeconds: 3600 })) });
          }
          env.assert(); value.runs++; value.reason = result.reason ?? null;
          if (value.range === 'batch' && value.pending) {
            // A confirmed earlier card must not keep an unrelated later
            // unknown receipt pending after that earlier auction expires.
            const settled = new Set((result.entries ?? []).filter(row => ['accepted', 'rejected'].includes(row.status)).map(row => row.item.id));
            value.pending = value.pending.filter(row => !settled.has(row.item.id));
            if (!value.pending.length) value.pending = null;
          }
          if (result.status === 'completed') {
            if (value.range === 'all' && value.pending?.some(row => {
              const live = env.adapter.inspectListingItem({ ...row.item, pile: 'transfer' })?.candidate;
              return live?.item.definitionId !== row.item.definitionId || live.auction?.state !== 'active'
                || live.auction.startingBid !== row.auction.startingBid || live.auction.buyNowPrice !== row.auction.buyNowPrice;
            })) fail('FC27_GALLERY_RELIST_RECOVERY_REQUIRED');
            value.pending = null; value.status = value.runs < 2 ? 'armed' : 'completed'; value.nextAt = now() + value.minutes * 60000;
          }
          else value.status = stopped && !value.pending ? 'disarmed' : 'blocked';
          await write(env.scope, value); recordEvent(value); return value;
        }) ?? { status: 'waiting-operation' };
      } catch (error) { const result = { status: 'blocked', reason: safe(error) }; recordEvent(result); return result; }
      finally { busy = false; }
    },
    stop() { stopped = true; },
  };
  return Object.freeze(api);
}
