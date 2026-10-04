const TERMINAL = new Set(['accepted', 'rejected', 'skipped']);
const MUTATING = new Set(['list-pending', 'unknown']);
const DURATIONS = new Set([3600, 10800, 21600, 43200, 86400, 259200]);
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameItem = (a, b) => a?.id === b?.id && a?.definitionId === b?.definitionId && a?.pile === b?.pile;
const id = value => Number.isSafeInteger(value) && value > 0;
const tradeId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const fail = reason => { throw new Error(reason); };
const safeReason = error => /^FC27_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'FC27_GALLERY_BULK_LIST_UNCONFIRMED';
export const FC27_GALLERY_BULK_LIST_SCHEMA = 1;
export const FC27_GALLERY_BULK_LIST_KEY_PREFIX = 'fcat-fc27-gallery-bulk-list-v1:';
export const galleryBulkListKey = scope => `${FC27_GALLERY_BULK_LIST_KEY_PREFIX}${scope}`;
const validPrices = entry => Number.isSafeInteger(entry.startPrice) && entry.startPrice >= 150
  && Number.isSafeInteger(entry.buyNow) && entry.buyNow >= entry.startPrice && entry.buyNow <= 15000000 && DURATIONS.has(entry.durationSeconds);
const validRef = ref => id(ref?.id) && id(ref?.definitionId) && ['club', 'transfer'].includes(ref.pile);
const validDelay = value => Array.isArray(value) && value.length === 2
  && value.every(v => Number.isFinite(v) && v >= 1 && v <= 15) && value[0] <= value[1];

export function normalizeGalleryBulkListJournal(input) {
  if (!input || input.schema !== 1 || typeof input.scope !== 'string' || !input.scope || !input.context
    || typeof input.runId !== 'string' || !input.runId || typeof input.binding !== 'string' || !input.binding
    || !['active', 'completed', 'recovery-required'].includes(input.status) || !validDelay(input.delaySeconds)
    || !Array.isArray(input.entries) || !input.entries.length || input.entries.length > 256
    || new Set(input.entries.map(e => e?.item?.id)).size !== input.entries.length
    || input.entries.some(e => !validRef(e?.item) || !tradeId(e.purchaseTradeId) || !validPrices(e)
      || !['pending', 'list-pending', 'unknown', 'accepted', 'rejected', 'skipped'].includes(e.status)
      || e.status === 'accepted' && !tradeId(e.listingTradeId))) return null;
  return clone(input);
}

export async function assertNoGalleryListingPending(get, scope, recoveryOptions = null) {
  const recovery = await readGalleryBulkListRecovery(get, scope);
  if (recovery.status === 'absent' || recovery.status === 'clear') return;
  if (recoveryOptions && recovery.status === 'observed') {
    await reconcileGalleryListingPending({ ...recoveryOptions, get, scope });
    return;
  }
  if (recovery.status !== 'observed' || recovery.pending > 0) {
    fail('FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED');
  }
}

const confirmActiveListing = (entry, seen) => {
  const candidate = seen?.candidate, auction = candidate?.auction;
  if (seen?.status !== 'loaded' || candidate.item?.id !== entry.item.id
    || candidate.item?.definitionId !== entry.item.definitionId || candidate.item?.pile !== 'transfer'
    || auction?.state !== 'active' || auction.startingBid !== entry.startPrice || auction.buyNowPrice !== entry.buyNow
    || !tradeId(String(auction.tradeId ?? ''))) return false;
  entry.listingTradeId = String(auction.tradeId); entry.status = 'accepted'; entry.reason = null;
  return true;
};

// Caller must hold the account transaction lock. No listing/buying/moving is
// performed; only exact active-auction evidence or a durable explicit rejection
// can settle an old intent. Missing/expired auctions are not proof of failure.
async function reconcileGalleryListingPending({ get, set, scope, context, assertCurrent, createAdapter }) {
  assertCurrent();
  const key = galleryBulkListKey(scope), raw = await get(key, null);
  const record = normalizeGalleryBulkListJournal(raw);
  if (!record || record.scope !== scope || !same(record.context, context)) fail('FC27_GALLERY_BULK_LIST_CONTEXT_CHANGED');
  assertCurrent();
  let adapter = null, fresh = null, changed = false;
  for (const entry of record.entries.filter(e => MUTATING.has(e.status))) {
    if (entry.reason === 'FC27_GALLERY_LISTING_SERVICE_STOP' && entry.response?.success === false
        && [401, 403, 427, 429].includes(entry.response.status)) {
      entry.status = 'rejected'; entry.reason = 'FC27_GALLERY_LISTING_REJECTED'; changed = true;
      continue;
    }
    if (!adapter) {
      adapter = createAdapter();
      fresh = await adapter.refreshTransferItems(); assertCurrent();
    }
    if (fresh?.status === 'completed') {
      changed = confirmActiveListing(entry, adapter.inspectListingItem({ ...entry.item, pile: 'transfer' })) || changed;
    }
  }
  assertCurrent();
  if (changed) {
    record.status = record.entries.some(e => MUTATING.has(e.status)) ? 'recovery-required'
      : record.entries.every(e => TERMINAL.has(e.status)) ? 'completed' : 'active';
    if (record.status !== 'recovery-required') record.lastReason = null;
    record.updatedAt = Date.now();
    if (!same(await get(key, null), raw)) fail('FC27_GALLERY_BULK_LIST_JOURNAL_UNCONFIRMED');
    assertCurrent(); await set(key, clone(record)); assertCurrent();
    if (!same(await get(key, null), record)) fail('FC27_GALLERY_BULK_LIST_JOURNAL_UNCONFIRMED');
  }
  if (record.entries.some(e => MUTATING.has(e.status))) fail('FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED');
}

// Read-only, bounded state used by purchase preflight and diagnostics. It never
// refreshes Transfer, changes a Journal, or grants a listing/purchase permit.
export async function readGalleryBulkListRecovery(get, scope) {
  const raw = await get(galleryBulkListKey(scope), null);
  if (raw === null) return { status: 'absent', total: 0, pending: 0 };
  const record = normalizeGalleryBulkListJournal(raw);
  if (!record) return { status: 'invalid', total: 0, pending: 0, reason: 'FC27_GALLERY_BULK_LIST_JOURNAL_INVALID' };
  if (record.scope !== scope) return { status: 'foreign', total: record.entries.length, pending: 0,
    reason: 'FC27_GALLERY_BULK_LIST_CONTEXT_CHANGED' };
  const pending = record.entries.filter(e => MUTATING.has(e.status));
  return { status: pending.length ? 'observed' : 'clear', state: record.status,
    total: record.entries.length, pending: pending.length,
    byStatus: Object.fromEntries([...new Set(record.entries.map(e => e.status))]
      .map(status => [status, record.entries.filter(e => e.status === status).length])),
    runId: record.runId, lastReason: record.lastReason ?? null };
}

export function galleryListingCandidateAllowed(candidate) {
  return candidate?.tradeable === true && candidate.evolution === false && candidate.limitedUse === false
    && candidate.concept === false && candidate.academyEnrolled === false
    && ['none', 'inactive'].includes(candidate.auction?.state);
}

const summary = record => ({ total: record.entries.length,
  completed: record.entries.filter(e => TERMINAL.has(e.status)).length,
  accepted: record.entries.filter(e => e.status === 'accepted').length,
  rejected: record.entries.filter(e => e.status === 'rejected').length,
  skipped: record.entries.filter(e => e.status === 'skipped').length,
  pending: record.entries.filter(e => !TERMINAL.has(e.status)).length });
const mustStop = result => [401, 403, 427, 429].includes(result?.error?.code ?? result?.response?.status)
  || ['rate-limit', 'session-expired', 'permission-denied', 'auction-operation-blocked', 'captcha'].includes(result?.error?.kind);

// Enhancer xAe behavior: selected order, per-item skips/rejections, 3–5s delay.
// FCAT integration differences: durable write intent, exact readback, and
// stopping unknown/429/427 outcomes. Prices are frozen by the approved preview.
export function createGalleryBulkListSession({ scope, context, get, set, exclusive, tradeAdapter,
  assertCurrent = () => {}, checkOtherTransactions = async () => {}, beforeMutation = async () => {},
  afterMutation = async () => {},
  shouldStop = () => false, onProgress = () => {}, random = Math.random,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  operationId = () => `gallery-list-${Date.now()}-${Math.random().toString(16).slice(2)}` } = {}) {
  const key = galleryBulkListKey(scope);
  const read = async () => {
    let raw;
    try { raw = await get(key, null); }
    catch { fail('FC27_GALLERY_BULK_LIST_JOURNAL_READ_FAILED'); }
    if (raw === null) return null;
    const value = normalizeGalleryBulkListJournal(raw);
    if (!value) fail('FC27_GALLERY_BULK_LIST_JOURNAL_INVALID');
    if (value.scope !== scope || !same(value.context, context)) fail('FC27_GALLERY_BULK_LIST_CONTEXT_CHANGED');
    return value;
  };
  const storeConfirmed = async (storageKey, record) => {
    try {
      await set(storageKey, clone(record));
      if (!same(await get(storageKey, null), record)) fail('FC27_GALLERY_BULK_LIST_JOURNAL_UNCONFIRMED');
    } catch (error) {
      if (error?.message === 'FC27_GALLERY_BULK_LIST_JOURNAL_UNCONFIRMED') throw error;
      fail('FC27_GALLERY_BULK_LIST_JOURNAL_WRITE_FAILED');
    }
  };
  const write = async record => {
    record.updatedAt = now();
    if (!normalizeGalleryBulkListJournal(record)) fail('FC27_GALLERY_BULK_LIST_JOURNAL_INVALID');
    await storeConfirmed(key, record);
  };
  const report = (record, phase, index) => {
    try { onProgress({ phase, index, ...summary(record), entries: clone(record.entries) }); } catch { /* Presentation only. */ }
  };
  const reconcile = async entry => {
    assertCurrent();
    const fresh = await tradeAdapter.refreshTransferItems(); assertCurrent();
    const seen = fresh?.status === 'completed' ? tradeAdapter.inspectListingItem({ ...entry.item, pile: 'transfer' }) : null;
    return confirmActiveListing(entry, seen);
  };
  return Object.freeze({
    async inspect() {
      assertCurrent(); const record = await read(); assertCurrent();
      return record ? { status: 'observed', state: record.status, ...summary(record), runId: record.runId,
        binding: record.binding, entries: clone(record.entries), lastReason: record.lastReason } : { status: 'absent' };
    },
    async execute({ approved = false, entries, binding, settings = {}, resume = false, expectedRunId = null } = {}) {
      const delaySeconds = settings.delaySeconds ?? [3, 5];
      if (!approved || !validDelay(delaySeconds) || !resume && (typeof binding !== 'string' || !binding
        || !Array.isArray(entries) || !entries.length || entries.length > 256
        || new Set(entries.map(e => e?.item?.id)).size !== entries.length
        || entries.some(e => !validRef(e?.item) || !tradeId(String(e.purchase?.tradeId ?? '')) || !validPrices(e)))) {
        return { status: 'blocked', reason: 'FC27_GALLERY_BULK_LIST_APPROVAL_REQUIRED' };
      }
      let record;
      try {
        const outcome = await exclusive(scope, async () => {
          assertCurrent(); await checkOtherTransactions(); assertCurrent();
          const previous = await read(); assertCurrent();
          if (resume) {
            if (!previous || previous.runId !== expectedRunId) fail('FC27_GALLERY_BULK_LIST_PLAN_CHANGED');
            record = previous;
          } else {
            if (previous?.binding === binding) {
              if (previous.entries.some(e => MUTATING.has(e.status))) fail('FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED');
              if (previous.status === 'active') fail('FC27_GALLERY_BULK_LIST_RESUME_REQUIRED');
            }
            if (previous && previous.binding !== binding) {
              // A different purchase batch does not resume the previous one.
              // Keep its evidence, and never relist an unresolved exact item.
              if (previous.entries.some(e => MUTATING.has(e.status) && entries.some(next => next.item.id === e.item.id))) {
                fail('FC27_GALLERY_BULK_LIST_RECOVERY_REQUIRED');
              }
              const archiveKey = `${key}:archive:${previous.runId}`;
              await storeConfirmed(archiveKey, previous);
              assertCurrent();
            }
            record = { schema: 1, scope, context: clone(context), runId: operationId(), binding, delaySeconds: [...delaySeconds],
              status: 'active', createdAt: now(), updatedAt: now(), lastReason: null,
              entries: entries.map(e => ({ item: clone(e.item), name: String(e.name ?? '').slice(0, 120),
                purchaseTradeId: String(e.purchase.tradeId), listingTradeId: null,
                startPrice: e.startPrice, buyNow: e.buyNow, durationSeconds: e.durationSeconds,
                status: 'pending', reason: null, response: null })) };
            await write(record);
          }
          record.lastReason = null;
          for (let index = 0; index < record.entries.length; index++) {
            const entry = record.entries[index];
            if (TERMINAL.has(entry.status)) continue;
            assertCurrent();
            if (MUTATING.has(entry.status)) {
              if (entry.reason === 'FC27_GALLERY_LISTING_SERVICE_STOP' && entry.response?.success === false
                  && [401, 403, 427, 429].includes(entry.response.status)) {
                entry.status = 'rejected'; entry.reason = 'FC27_GALLERY_LISTING_REJECTED';
                await write(record); report(record, 'rejected', index + 1); continue;
              }
              if (!await reconcile(entry)) fail('FC27_GALLERY_BULK_LIST_RECOVERY_UNCONFIRMED');
              await write(record); report(record, 'accepted', index + 1); continue;
            }
            if (shouldStop()) { record.lastReason = 'FC27_GALLERY_BULK_LIST_STOPPED'; break; }
            const inspect = () => tradeAdapter.inspectListingItem(entry.item);
            const current = inspect();
            const exact = value => value?.status === 'loaded' && sameItem(value.candidate?.item, entry.item);
            let skip = !exact(current) ? 'FC27_GALLERY_LISTING_ITEM_CHANGED'
              : !galleryListingCandidateAllowed(current.candidate) ? 'FC27_GALLERY_LISTING_ITEM_PROTECTED' : null;
            const capacity = tradeAdapter.inspectCapabilities().transferCapacity;
            if (!skip && entry.item.pile !== 'transfer' && (!Number.isFinite(capacity?.free) || capacity.free <= 0)) skip = 'FC27_GALLERY_TRANSFER_FULL_OR_UNKNOWN';
            if (!skip) {
              const limits = await tradeAdapter.inspectPriceLimits(entry.item, { refresh: true }); assertCurrent();
              if (mustStop(limits)) { record.lastReason = 'FC27_GALLERY_LISTING_SERVICE_STOP'; break; }
              const min = limits?.after?.minimum, max = limits?.after?.maximum;
              if (limits?.refreshStatus !== 'completed' || !Number.isSafeInteger(min) || !Number.isSafeInteger(max)
                || entry.startPrice < min || entry.buyNow > max) skip = 'FC27_GALLERY_LISTING_PRICE_OUT_OF_RANGE';
            }
            if (skip) { entry.status = 'skipped'; entry.reason = skip; await write(record); report(record, 'skipped', index + 1); continue; }
            const permit = await tradeAdapter.acquireRequestPermit('list'); assertCurrent();
            if (permit?.status !== 'acquired') { record.lastReason = 'FC27_GALLERY_LISTING_PERMIT_BLOCKED'; break; }
            if (shouldStop()) { record.lastReason = 'FC27_GALLERY_BULK_LIST_STOPPED'; break; }
            await beforeMutation(entry); assertCurrent();
            const final = inspect();
            if (!exact(final) || !galleryListingCandidateAllowed(final.candidate)) fail('FC27_GALLERY_LISTING_ITEM_CHANGED');
            entry.status = 'list-pending'; await write(record); assertCurrent();
            report(record, 'listing', index + 1);
            const result = await tradeAdapter.listItem(entry.item, entry, { requestPermit: permit.permit });
            await afterMutation(entry, result); assertCurrent();
            entry.response = result?.response ? { success: result.response.success === true,
              status: Number(result.response.status) || null, code: Number(result.response.code) || null } : null;
            if (result?.status === 'accepted') {
              await write(record);
              if (!await reconcile(entry)) {
                entry.status = 'unknown'; entry.reason = record.lastReason = 'FC27_GALLERY_LISTING_READBACK_UNCONFIRMED';
              }
            } else if (mustStop(result)) {
              entry.status = result?.status === 'rejected' ? 'rejected' : 'unknown';
              entry.reason = record.lastReason = 'FC27_GALLERY_LISTING_SERVICE_STOP';
            } else if (['rejected', 'not-found', 'moved'].includes(result?.status)) {
              entry.status = 'rejected'; entry.reason = 'FC27_GALLERY_LISTING_REJECTED';
            } else { entry.status = 'unknown'; entry.reason = record.lastReason = 'FC27_GALLERY_LISTING_RESULT_UNKNOWN'; }
            await write(record); report(record, entry.status, index + 1);
            if (MUTATING.has(entry.status) || mustStop(result)) break;
            const [min, max] = record.delaySeconds;
            await sleep((min + random() * (max - min)) * 1000);
          }
          record.status = record.entries.some(e => MUTATING.has(e.status)) ? 'recovery-required'
            : record.entries.every(e => TERMINAL.has(e.status)) ? 'completed' : 'active';
          await write(record);
          return { status: record.status === 'completed' ? 'completed' : 'partial', reason: record.lastReason,
            runId: record.runId, entries: clone(record.entries), ...summary(record) };
        });
        return outcome ?? { status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE' };
      } catch (error) {
        return { status: 'blocked', reason: safeReason(error), runId: record?.runId ?? null,
          entries: clone(record?.entries ?? []), ...(record ? summary(record) : {}) };
      }
    },
  });
}
