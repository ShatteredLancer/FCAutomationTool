import { createEaTradeAdapter } from '../ea/trade.js';
import { createEaInventoryAdapter } from '../ea/inventory.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';
import { traditionalJournalScope, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { puzzleBuyPendingKey } from '../../fc27/puzzle-buy-session.js';
import { galleryPurchaseKey, galleryPurchasePendingKey } from '../../gallery/purchase-session.js';
import { projectGalleryListingReceipts, projectGalleryListingCandidates, planGalleryListingPrices } from '../../gallery/listing-candidates.js';
import { createGalleryBulkListSession, galleryListingCandidateAllowed } from '../../gallery/bulk-list-session.js';
import { createGalleryListingScheduleStore } from '../../gallery/listing-scheduler.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../fc27/traditional-lock.js';
import { assertGalleryRelistSettled } from '../../gallery/relist-recovery.js';

const fail = reason => { throw new Error(reason); };
const safe = error => /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_LISTING_UNAVAILABLE';
const stageError = (reason, phase, error = null) => {
  const value = new Error(reason); value.phase = phase;
  const code = Number(error?.error?.code ?? error?.response?.status ?? error?.status);
  if (Number.isSafeInteger(code) && code > 0) value.httpStatus = code;
  return value;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const circuitKey = scope => `fcat-fc27-gallery-listing-circuit-v1:${scope}`;
const settingsKey = scope => `fcat-fc27-gallery-list-settings-v1:${scope}`;
const normalizeSettings = value => {
  const mode = ['percentage', 'fixed', 'steps'].includes(value?.priceMode) ? value.priceMode : 'percentage';
  const range = Array.isArray(value?.percentageRange) && value.percentageRange.length === 2
    && value.percentageRange.every(number => Number.isFinite(number) && number >= 0 && number <= 200)
    ? [Math.min(...value.percentageRange), Math.max(...value.percentageRange)] : [100, 100];
  const durations = new Set([3600, 10800, 21600, 43200, 86400, 259200]);
  const durationSeconds = durations.has(value?.durationSeconds) ? value.durationSeconds : 3600;
  const steps = Number.isSafeInteger(value?.steps) && Math.abs(value.steps) <= 20 ? value.steps : 0;
  const delaySeconds = Array.isArray(value?.delaySeconds) && value.delaySeconds.length === 2
    && value.delaySeconds.every(number => Number.isFinite(number) && number >= 1 && number <= 15)
    ? [Math.min(...value.delaySeconds), Math.max(...value.delaySeconds)] : [3, 5];
  const price = value => Number.isSafeInteger(value) && value >= 150 && value <= 15000000 ? value : null;
  return { schema: 1, priceMode: mode, percentageRange: range, durationSeconds, steps, delaySeconds,
    playerView: value?.playerView === 'table' ? 'table' : 'cards',
    fixedPrice: price(value?.fixedPrice), fixedStartPrice: price(value?.fixedStartPrice) };
};
const readCircuit = async (get, scope) => {
  const value = await get(circuitKey(scope), null);
  if (!value) return { schema: 1, scope, persistent: false, retryAt: 0 };
  if (value.schema !== 1 || value.scope !== scope || typeof value.persistent !== 'boolean'
      || !Number.isSafeInteger(value.retryAt) || value.retryAt < 0) fail('FC27_GALLERY_LISTING_CIRCUIT_UNVERIFIED');
  return value;
};
const saveCircuit = async (get, set, scope, value) => {
  await set(circuitKey(scope), value);
  if (same(await get(circuitKey(scope), null), value) === false) fail('FC27_GALLERY_LISTING_CIRCUIT_UNCONFIRMED');
};

// Independent of FSU/Enhancer loading. EA writes remain in the sole trade.js
// listItem call site. Preparing and pricing never grants mutation permission.
export function createFc27GalleryListing({ root, gmGetValue: get, gmSetValue: set, purchase, loadPrices,
  liveEnabled = false, schedulingEnabled = false, diagnosticLog, adapterFactory = createEaTradeAdapter, sleep } = {}) {
  let busy = false, stopped = false, prepared = null, planned = null, publicApi = null;
  const sessionPrices = new Map();
  const stage = input => {
    try { return Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', event: 'listing-stage', ...input })).catch(() => false); }
    catch { return Promise.resolve(false); }
  };
  const create = ({ isCurrent = () => true, onProgress = () => {}, expectedPurchaseBinding = null } = {}) => {
    const context = readFc27Context(root), scope = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue: get, gmSetValue: set, lockManager: root.navigator?.locks });
    const assertCurrent = () => {
      if (!same(context, readFc27Context(root)) || !isCurrent()) fail('FC27_GALLERY_CONTEXT_CHANGED');
    };
    const adapter = adapterFactory(root);
    const checkOtherTransactions = async () => {
      await assertGalleryRelistSettled(get, scope);
      const other = await persistence.journal.read(scope);
      if (other && !isTerminalTraditionalJournal(other)) fail('FC27_RECOVERY_REQUIRED');
      if (await get(galleryPurchasePendingKey(scope), null) !== null) fail('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
      if (await get(puzzleBuyPendingKey(scope), null) !== null) fail('FC27_BUY_RECOVERY_REQUIRED');
    };
    const session = createGalleryBulkListSession({ scope, context, get, set, exclusive: persistence.exclusive,
      tradeAdapter: adapter, assertCurrent, checkOtherTransactions, shouldStop: () => stopped, sleep,
      beforeMutation: async () => {
        assertCurrent();
        const currentPurchase = await purchase.inspect();
        if (!currentPurchase || currentPurchase.status !== 'observed'
          || `${currentPurchase.operationId}:${currentPurchase.binding}` !== expectedPurchaseBinding) {
          fail('FC27_GALLERY_LISTING_PURCHASE_CHANGED');
        }
        const circuit = await readCircuit(get, scope);
        if (circuit.persistent) fail('FC27_GALLERY_LISTING_CIRCUIT_OPEN');
        if (circuit.retryAt > Date.now()) fail('FC27_GALLERY_LISTING_RATE_LIMIT_COOLDOWN');
        if (!liveEnabled || !persistence.lock.hasExclusiveAccess(scope)) fail('FC27_GALLERY_LISTING_DISABLED');
        await checkOtherTransactions();
      },
      afterMutation: async (_entry, result) => {
        const code = Number(result?.error?.code ?? result?.response?.status);
        if (code === 427) await saveCircuit(get, set, scope, { schema: 1, scope, persistent: true, retryAt: 0 });
        else if (code === 429) await saveCircuit(get, set, scope, { schema: 1, scope, persistent: false, retryAt: Date.now() + 60000 });
        else if (result?.status === 'accepted') await saveCircuit(get, set, scope, { schema: 1, scope, persistent: false, retryAt: 0 });
      },
      operationId: () => root.crypto.randomUUID(), onProgress: progress => {
        onProgress(progress);
        try { Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', event: 'bulk-list', phase: progress.phase,
          count: progress.completed, batchSize: progress.total, requestedCount: progress.total,
          quotedCount: progress.accepted })).catch(() => {}); } catch { /* Diagnostics only. */ }
      } });
    return { context, scope, persistence, assertCurrent, adapter, session, checkOtherTransactions };
  };
  const scheduleLockName = () => `${FC27_TRADITIONAL_WEB_LOCK}:gallery-listing-schedule`;
  const withScheduleLock = async task => {
    const locks = root.navigator?.locks, lockName = scheduleLockName();
    if (typeof locks?.request !== 'function') return { status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE' };
    try {
      return await locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock || lock.name !== lockName || lock.mode !== 'exclusive') return { status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE' };
        return task();
      });
    } catch (error) { return { status: 'blocked', reason: safe(error) }; }
  };
  const api = {
    // Display-only lookup in existing repositories. It grants no ownership or
    // listing authority and does not refresh inventory or call an EA service.
    readDisplayItem(ref) {
      if (!prepared || !same(prepared.context, readFc27Context(root))
        || !prepared.candidates.some(row => same(row.item, ref))) return null;
      return createEaInventoryAdapter(root).readPile(ref.pile).find(item =>
        Number(item?.id) === ref.id && Number(item?.definitionId) === ref.definitionId) ?? null;
    },
    scheduleCapability() {
      return { enabled: schedulingEnabled && liveEnabled,
        reason: schedulingEnabled ? (liveEnabled ? null : 'FC27_GALLERY_LISTING_DISABLED') : 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' };
    },
    async readSettings() {
      const context = readFc27Context(root), scope = traditionalJournalScope(context);
      const value = await get(settingsKey(scope), null);
      return normalizeSettings({ ...value, fixedPrice: null, fixedStartPrice: null, ...sessionPrices.get(scope) });
    },
    async writeSettings(value) {
      const context = readFc27Context(root), scope = traditionalJournalScope(context), normalized = normalizeSettings(value);
      const { fixedPrice, fixedStartPrice, ...persistent } = normalized;
      sessionPrices.set(scope, { fixedPrice, fixedStartPrice });
      await set(settingsKey(scope), persistent);
      return same(await get(settingsKey(scope), null), persistent) ? normalized : { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SETTINGS_UNCONFIRMED' };
    },
    async readSchedule({ purchaseSnapshot = null, sessionReady = true, at = Date.now() } = {}) {
      try {
        const context = readFc27Context(root), scope = traditionalJournalScope(context);
        const store = createGalleryListingScheduleStore({ get, set, scope, context });
        return await store.inspect({ purchase: purchaseSnapshot ?? await purchase.inspect(), sessionReady, at });
      } catch (error) { return { status: 'blocked', reason: safe(error) }; }
    },
    async pollSchedule({ isCurrent = () => true, onProgress } = {}) {
      if (!schedulingEnabled) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' };
      if (!liveEnabled) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_DISABLED' };
      if (busy) return { status: 'waiting-operation' };
      const state = await publicApi.readSchedule();
      if (state.status !== 'ready' && state.status !== 'missed') return state;
      return publicApi.tickSchedule({ approved: true, isCurrent, onProgress });
    },
    async saveSchedule({ approved = false, plan, settings, schedule } = {}) {
      if (!schedulingEnabled) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' };
      if (approved !== true) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_APPROVAL_REQUIRED' };
      if (schedule?.type !== 'once' || !Number.isSafeInteger(schedule.runAt) || schedule.runAt <= Date.now()) {
        return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_INPUT_INVALID' };
      }
      if (!planned || plan?.status !== 'observed' || !same(plan, planned)) {
        return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_PLAN_CHANGED' };
      }
      return withScheduleLock(async () => { try {
        const context = readFc27Context(root), scope = traditionalJournalScope(context);
        const purchaseSnapshot = await purchase.inspect();
        if (!same(prepared?.context, context) || !same(context, readFc27Context(root))) fail('FC27_GALLERY_CONTEXT_CHANGED');
        if (prepared?.binding !== `${purchaseSnapshot.operationId}:${purchaseSnapshot.binding}`) {
          return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_PURCHASE_CHANGED' };
        }
        const store = createGalleryListingScheduleStore({ get, set, scope, context });
        return await store.create({ purchase: purchaseSnapshot, plan: { ...plan, settings: settings ?? plan?.settings }, schedule, approved: true });
      } catch (error) { return { status: 'blocked', reason: safe(error) }; } });
    },
    async armSchedule({ approved = false } = {}) {
      if (!schedulingEnabled) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' };
      return withScheduleLock(async () => { try {
        const context = readFc27Context(root), scope = traditionalJournalScope(context);
        const store = createGalleryListingScheduleStore({ get, set, scope, context });
        const purchaseSnapshot = await purchase.inspect();
        const state = await store.inspect({ purchase: purchaseSnapshot, sessionReady: true, at: Date.now() });
        if (!same(context, readFc27Context(root))) fail('FC27_GALLERY_CONTEXT_CHANGED');
        if (state.status === 'blocked') return state;
        if (state.status !== 'disarmed') return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_STATE_LOCKED' };
        if (!liveEnabled || state.schedule?.schedule?.type !== 'once' || state.schedule.runCount !== 0
          || !(state.schedule.nextRunAt > Date.now())) {
          return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_INPUT_INVALID' };
        }
        return await store.arm({ approved });
      } catch (error) { return { status: 'blocked', reason: safe(error) }; } });
    },
    async disarmSchedule(reason) {
      return withScheduleLock(async () => { try {
        const context = readFc27Context(root), scope = traditionalJournalScope(context);
        return await createGalleryListingScheduleStore({ get, set, scope, context }).disarm(reason);
      } catch (error) { return { status: 'blocked', reason: safe(error) }; } });
    },
    async tickSchedule({ approved = false, isCurrent = () => true, onProgress } = {}) {
      if (!schedulingEnabled) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULER_PENDING' };
      if (approved !== true || typeof isCurrent !== 'function') return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_APPROVAL_REQUIRED' };
      try {
        return await withScheduleLock(async () => {
        const context = readFc27Context(root), scope = traditionalJournalScope(context);
        const store = createGalleryListingScheduleStore({ get, set, scope, context });
        const purchaseSnapshot = await purchase.inspect();
        const state = await store.inspect({ purchase: purchaseSnapshot, sessionReady: true, at: Date.now() });
        if (state.status === 'missed') {
          await store.checkpoint({ status: 'missed', reason: state.reason, at: Date.now() });
          return { ...state, schedule: await store.read() };
        }
        if (state.status !== 'ready') return state;
        const saved = state.schedule;
        if (!liveEnabled || saved.schedule.type !== 'once' || saved.runCount !== 0) {
          return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_INPUT_INVALID' };
        }
        const scheduleCurrent = () => isCurrent() && same(context, readFc27Context(root));
        if (!scheduleCurrent()) fail('FC27_GALLERY_CONTEXT_CHANGED');
        await store.checkpoint({ status: 'running', reason: null, at: Date.now(), runCount: saved.runCount });
        const preparedResult = await publicApi.prepare({ isCurrent: scheduleCurrent });
        if (preparedResult.status !== 'ready') {
          await store.checkpoint({ status: 'blocked', reason: preparedResult.reason || 'FC27_GALLERY_LISTING_RECOVERY_REQUIRED' });
          return preparedResult;
        }
        const freshPurchase = await purchase.inspect();
        if (freshPurchase.operationId !== saved.purchaseOperationId || freshPurchase.binding !== saved.purchaseBinding) {
          await store.checkpoint({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_PURCHASE_CHANGED' });
          return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_PURCHASE_CHANGED' };
        }
        const selectedIds = saved.entries.map(entry => entry.item.id);
        const overridesByItem = Object.fromEntries(saved.entries.map(entry => [entry.item.id, { buyNow: entry.buyNow, startPrice: entry.startPrice }]));
        const plannedResult = publicApi.plan({ selectedIds, settings: { ...(saved.listingSettings || {}), priceMode: 'fixed', durationSeconds: saved.entries[0].durationSeconds }, overridesByItem });
        const exact = plannedResult.status === 'observed' && plannedResult.entries.length === saved.entries.length
          && plannedResult.entries.every((entry, index) => {
            const prior = saved.entries[index];
            return same(entry.item, prior.item) && String(entry.purchase?.tradeId) === prior.purchaseTradeId
              && entry.startPrice === prior.startPrice && entry.buyNow === prior.buyNow
              && entry.durationSeconds === prior.durationSeconds;
          });
        if (!exact) {
          await store.checkpoint({ status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_ITEMS_CHANGED' });
          return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SCHEDULE_ITEMS_CHANGED' };
        }
        const result = await publicApi.execute({ approved: true, plan: plannedResult, settings: saved.listingSettings || {}, isCurrent: scheduleCurrent, onProgress });
        if (result.status === 'completed') {
          await store.checkpoint({ status: 'completed', reason: null,
            at: Date.now(), runCount: saved.runCount + 1 });
        } else {
          await store.checkpoint({ status: 'blocked', reason: result.reason || 'FC27_GALLERY_LISTING_RECOVERY_REQUIRED',
            at: Date.now(), runCount: saved.runCount });
        }
        return result;
        });
      } catch (error) { return { status: 'blocked', reason: safe(error) }; }
    },
    async prepare({ isCurrent = () => true } = {}) {
      if (busy) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_BUSY' };
      busy = true; prepared = null; planned = null;
      try {
        const env = create({ isCurrent }), info = await purchase.inspect(); env.assertCurrent();
        if (info?.status !== 'observed') fail(info?.reason ?? 'FC27_GALLERY_LISTING_NO_PURCHASE');
        const result = await env.persistence.exclusive(env.scope, async () => {
          await env.checkOtherTransactions(); env.assertCurrent();
          const circuit = await readCircuit(get, env.scope);
          if (circuit.persistent) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_CIRCUIT_OPEN' };
          if (circuit.retryAt > Date.now()) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_RATE_LIMIT_COOLDOWN', retryAt: circuit.retryAt };
          const old = await env.session.inspect();
          if (old.status === 'observed' && old.binding === `${info.operationId}:${info.binding}` && old.state !== 'completed') {
            return { ...old, status: 'resume-required' };
          }
          const source = projectGalleryListingReceipts({ scope: env.scope, context: env.context,
            purchase: await get(galleryPurchaseKey(env.scope), null), pendingMarker: await get(galleryPurchasePendingKey(env.scope), null),
            expectedOperationId: info.operationId, expectedBinding: info.binding });
          if (source.status !== 'observed') return source;
          const refreshed = await env.adapter.refreshTransferItems(); env.assertCurrent();
          if (refreshed?.status !== 'completed') {
            void stage({ phase: 'transfer-refresh', status: 'failed', reason: 'FC27_GALLERY_TRANSFER_UNCONFIRMED',
              httpStatus: Number(refreshed?.error?.code ?? refreshed?.response?.status) || undefined });
            throw stageError('FC27_GALLERY_TRANSFER_UNCONFIRMED', 'transfer-refresh', refreshed);
          }
          void stage({ phase: 'transfer-refresh', status: 'success' });
          const items = source.entries.flatMap(row => {
            const seen = env.adapter.inspectListingItem({ id: row.itemId, definitionId: row.definitionId, pile: 'club' });
            return seen?.status === 'loaded' ? [{ ...seen.candidate.item, tradeable: seen.candidate.tradeable,
              eligibleForListing: galleryListingCandidateAllowed(seen.candidate) }] : [];
          });
          const projected = projectGalleryListingCandidates({ source, items });
          if (projected.status !== 'observed') return projected;
          const limitsByItem = {}, candidates = [];
          const displayItems = new Map(createEaInventoryAdapter(root).readPile('club').map(item => [Number(item?.id), item]));
          for (const candidate of projected.entries) {
            const result = await env.adapter.inspectPriceLimits(candidate.item, { refresh: true }); env.assertCurrent();
            const code = Number(result?.error?.code ?? result?.response?.status);
            if ([401, 403, 427, 429].includes(code)) {
              void stage({ phase: 'price-limits', status: 'failed', reason: 'FC27_GALLERY_LISTING_SERVICE_STOP', httpStatus: code });
              throw stageError('FC27_GALLERY_LISTING_SERVICE_STOP', 'price-limits', result);
            }
            limitsByItem[candidate.item.id] = { status: result?.refreshStatus === 'completed' ? result.status : 'unknown',
              minimum: result?.after?.minimum, maximum: result?.after?.maximum };
            void stage({ phase: 'price-limits', status: result?.refreshStatus === 'completed' ? 'success' : 'unknown',
              reason: result?.refreshStatus === 'completed' ? undefined : 'FC27_GALLERY_PRICE_LIMITS_UNKNOWN' });
            const observed = env.adapter.inspectListingItem(candidate.item);
            const display = displayItems.get(candidate.item.id);
            // The purchase Journal is the only authoritative cost for this
            // batch. EA's display `lastSalePrice` describes a prior auction
            // and must never replace the exact purchase receipt.
            let previousListingPrice = null, boughtFor = candidate.purchase.purchasePrice;
            if (Number(display?.definitionId) === candidate.item.definitionId) {
              try {
                const auction = display.getAuctionData?.();
                const previous = auction?.currentBid > 0 ? null : auction?.isExpired?.() ? auction.startingBid : auction?.buyNowPrice;
                if (Number.isFinite(previous) && previous > 0) previousListingPrice = previous;
              } catch { /* Missing display metadata never changes eligibility. */ }
            }
            candidates.push({ ...candidate, name: observed?.candidate?.name ?? String(candidate.item.definitionId), boughtFor, previousListingPrice });
          }
          let quotes = null;
          try { quotes = candidates.length ? await loadPrices(candidates.map(e => e.item.definitionId), {
            rows: candidates.map(e => displayItems.get(e.item.id)).filter(Boolean), isCurrent: () => { env.assertCurrent(); return true; },
          }) : null; }
          catch (error) { quotes = null; void stage({ phase: 'quotes', status: 'failed', reason: 'FC27_GALLERY_QUOTES_UNAVAILABLE' }); }
          void stage({ phase: 'quotes', status: quotes?.expiresAt > Date.now() ? 'success' : 'unknown',
            quotedCount: Object.keys(quotes?.freshPrices ?? {}).length });
          env.assertCurrent();
          const prices = quotes?.expiresAt > Date.now() ? quotes.freshPrices ?? {} : {};
          const listingPriceSource = quotes?.listingPriceSource ?? 'futgg';
          const pricesBySource = Object.fromEntries(Object.entries(quotes?.references ?? {}).map(([id, ref]) => [id,
            Object.fromEntries(['futgg', 'futbin'].map(source => [source, ref.quotes?.[source]?.expiresAt > Date.now()
              && !ref.quotes[source].error ? ref.quotes[source].price : null]))]));
          const sourceLabel = listingPriceSource === 'futbin' ? 'FUTBIN' : 'FUT.GG';
          const tiers = root.UTCurrencyInputControl?.PRICE_TIERS;
          prepared = { context: env.context, scope: env.scope, binding: `${source.operationId}:${source.binding}`,
            candidates, limitsByItem, marketPrices: prices, priceTiers: tiers ? Array.from(tiers, t => ({ min: t.min, inc: t.inc })) : null,
            expiresAt: quotes?.expiresAt ?? 0, listingPriceSource };
          return { status: 'ready', source: sourceLabel, listingPriceSource, pricesBySource,
            requestedSources: quotes?.requestedSources ?? ['futgg'], candidates: structuredClone(candidates), skipped: projected.skipped,
            prices: structuredClone(prices), priceTiers: prepared.priceTiers,
            limitsByItem: structuredClone(limitsByItem), expiresAt: quotes?.expiresAt ?? 0, liveEnabled };
        });
        return result ?? { status: 'blocked', reason: 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE' };
      } catch (error) {
        void stage({ phase: error?.phase ?? 'prepare', status: 'failed', reason: safe(error), httpStatus: error?.httpStatus });
        return { status: 'blocked', reason: safe(error), phase: error?.phase ?? 'prepare', httpStatus: error?.httpStatus ?? null };
      }
      finally { busy = false; }
    },
    plan({ selectedIds, settings, overridesByItem = {}, previewPrices = null }) {
      if (!prepared || !same(prepared.context, readFc27Context(root))) return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' };
      const selected = new Set(selectedIds);
      const result = planGalleryListingPrices({ ...prepared, candidates: prepared.candidates.filter(e => selected.has(e.item.id)),
        marketPrices: prepared.expiresAt > Date.now() ? prepared.marketPrices : {},
        quoteExpired: prepared.expiresAt > 0 && prepared.expiresAt <= Date.now(), settings, overridesByItem, previewPrices });
      planned = result?.status === 'observed' ? structuredClone(result) : null;
      return result;
    },
    async execute({ approved, plan, settings, resume = false, expectedRunId, isCurrent, onProgress } = {}) {
      if (!approved || !liveEnabled || typeof isCurrent !== 'function') return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_APPROVAL_REQUIRED' };
      if (busy) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_BUSY' };
      busy = true; stopped = false;
      try {
        const expectedPurchaseBinding = resume ? (await create({ isCurrent }).session.inspect()).binding : prepared?.binding;
        const env = create({ isCurrent, onProgress, expectedPurchaseBinding }); env.assertCurrent();
        const currentPurchase = await purchase.inspect();
        if (currentPurchase?.status !== 'observed'
          || `${currentPurchase.operationId}:${currentPurchase.binding}` !== expectedPurchaseBinding) {
          fail('FC27_GALLERY_LISTING_PURCHASE_CHANGED');
        }
        const circuit = await readCircuit(get, env.scope);
        if (circuit.persistent) fail('FC27_GALLERY_LISTING_CIRCUIT_OPEN');
        if (circuit.retryAt > Date.now()) fail('FC27_GALLERY_LISTING_RATE_LIMIT_COOLDOWN');
        if (!resume && (!prepared || !same(prepared.context, env.context) || plan?.status !== 'observed'
          || !planned || !same(plan, planned)
          || !plan.entries?.length || plan.entries.some(e => !prepared.candidates.some(c => same(c.item, e.item) && same(c.purchase, e.purchase))))) fail('FC27_GALLERY_LISTING_PLAN_CHANGED');
        if (!resume && prepared.expiresAt <= Date.now() && plan.entries.some(e => e.priceOrigin === 'market')) {
          fail('FC27_GALLERY_LISTING_QUOTE_EXPIRED');
        }
        return await env.session.execute({ approved, entries: plan?.entries, binding: prepared?.binding,
          settings, resume, expectedRunId });
      } catch (error) {
        void stage({ phase: 'execute', status: 'failed', reason: safe(error), httpStatus: error?.httpStatus });
        return { status: 'blocked', reason: safe(error), phase: 'execute', httpStatus: error?.httpStatus ?? null };
      }
      finally { busy = false; }
    },
    async inspect() { try { return await create().session.inspect(); } catch (error) { return { status: 'blocked', reason: safe(error) }; } },
    stop() { stopped = true; },
  };
  publicApi = Object.freeze(api);
  return publicApi;
}
