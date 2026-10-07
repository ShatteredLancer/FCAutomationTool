import { createEaTradeAdapter } from '../ea/trade.js';
import { createEaInventoryAdapter } from '../ea/inventory.js';
import { planFodderListings } from '../../gallery/fodder-trade-options.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';
import { traditionalJournalScope, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { galleryPurchaseKey, galleryPurchasePendingKey } from '../../gallery/purchase-session.js';
import { projectGalleryListingReceipts, projectGalleryListingCandidates, planGalleryListingPrices } from '../../gallery/listing-candidates.js';
import { createGalleryBulkListSession, galleryListingCandidateAllowed } from '../../gallery/bulk-list-session.js';
import { createGalleryListingScheduleStore } from '../../gallery/listing-scheduler.js';
import { FC27_TRADITIONAL_WEB_LOCK } from '../../fc27/traditional-lock.js';
import { assertGalleryRelistSettled } from '../../gallery/relist-recovery.js';
import { createFc27GalleryListingInventory, galleryListingInventoryRuntime } from '../ea/fc27-gallery-listing-inventory.js';
import { readFc27GalleryPriceLimits } from '../ea/fc27-gallery-price-limits.js';

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
  liveEnabled = false, schedulingEnabled = false, diagnosticLog, accounting = null, adapterFactory = createEaTradeAdapter,
  inventoryFactory = createFc27GalleryListingInventory, readPriceLimits = readFc27GalleryPriceLimits, sleep } = {}) {
  let busy = false, stopped = false, prepared = null, planned = null, publicApi = null;
  const sessionPrices = new Map();
  const stage = input => {
    try { return Promise.resolve(diagnosticLog?.record?.({ area: 'gallery', event: 'listing-stage', ...input })).catch(() => false); }
    catch { return Promise.resolve(false); }
  };
  const create = ({ isCurrent = () => true, onProgress = () => {}, expectedPurchaseBinding = null, setSource = null, inventory = null } = {}) => {
    const context = readFc27Context(root), scope = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue: get, gmSetValue: set, lockManager: root.navigator?.locks });
    const assertCurrent = () => {
      if (!same(context, readFc27Context(root)) || !isCurrent()) fail('FC27_GALLERY_CONTEXT_CHANGED');
    };
    if (setSource && !inventory) inventory = inventoryFactory(root, { assertCurrent });
    const adapter = adapterFactory(inventory ? galleryListingInventoryRuntime(root, inventory) : root);
    const assertSource = async () => {
      if (setSource) return;
      const currentPurchase = await purchase.inspect();
      if (!currentPurchase || currentPurchase.status !== 'observed'
        || `${currentPurchase.operationId}:${currentPurchase.binding}` !== expectedPurchaseBinding) fail('FC27_GALLERY_LISTING_PURCHASE_CHANGED');
    };
    const checkOtherTransactions = async () => {
      await assertGalleryRelistSettled(get, scope);
      const other = await persistence.journal.read(scope);
      if (other && !isTerminalTraditionalJournal(other)) fail('FC27_RECOVERY_REQUIRED');
      if (await get(galleryPurchasePendingKey(scope), null) !== null) fail('FC27_GALLERY_PURCHASE_RECOVERY_REQUIRED');
      // Puzzle purchase history is scoped to its own target and does not block
      // Gallery listing. Unknown entries remain historical and non-retriable.
    };
    const session = createGalleryBulkListSession({ scope, context, get, set, exclusive: persistence.exclusive,
      tradeAdapter: adapter, assertCurrent, checkOtherTransactions, shouldStop: () => stopped, sleep,
      beforeMutation: async entry => {
        assertCurrent();
        await assertSource();
        if (setSource) await inventory.validate(entry.item);
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
    return { context, scope, persistence, assertCurrent, adapter, session, checkOtherTransactions, inventory, assertSource };
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
      if (prepared.setSource && ref.pile === 'club') return prepared.inventory.resolve(ref)?.item ?? null;
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
      if (prepared?.setSource) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_SET_SCHEDULE_UNSUPPORTED' };
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
    async prepare({ isCurrent = () => true, target = null } = {}) {
      if (busy) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_BUSY' };
      busy = true; prepared = null; planned = null;
      try {
        const setSource = target ? { kind: 'set', setId: target.set?.id } : null;
        if (setSource && (typeof setSource.setId !== 'string' || !/^(futgg|fodder):[a-zA-Z0-9/_-]+$/.test(setSource.setId)
          || setSource.setId.length > 240)) fail('FC27_GALLERY_LISTING_SET_UNAVAILABLE');
        const env = create({ isCurrent, setSource }), info = setSource ? null : await purchase.inspect(); env.assertCurrent();
        if (!setSource && info?.status !== 'observed') fail(info?.reason ?? 'FC27_GALLERY_LISTING_NO_PURCHASE');
        const binding = setSource ? `set:${setSource.setId}` : `${info.operationId}:${info.binding}`;
        const result = await env.persistence.exclusive(env.scope, async () => {
          await env.checkOtherTransactions(); env.assertCurrent();
          const circuit = await readCircuit(get, env.scope);
          if (circuit.persistent) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_CIRCUIT_OPEN' };
          if (circuit.retryAt > Date.now()) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_RATE_LIMIT_COOLDOWN', retryAt: circuit.retryAt };
          const old = await env.session.inspect();
          if (old.status === 'observed' && old.binding === binding && old.state !== 'completed') {
            return { ...old, status: 'resume-required' };
          }
          const source = setSource ? null : projectGalleryListingReceipts({ scope: env.scope, context: env.context,
            purchase: await get(galleryPurchaseKey(env.scope), null), pendingMarker: await get(galleryPurchasePendingKey(env.scope), null),
            expectedOperationId: info.operationId, expectedBinding: info.binding });
          if (!setSource && source.status !== 'observed') return source;
          const refreshed = await env.adapter.refreshTransferItems(); env.assertCurrent();
          if (refreshed?.status !== 'completed') {
            void stage({ phase: 'transfer-refresh', status: 'failed', reason: 'FC27_GALLERY_TRANSFER_UNCONFIRMED',
              httpStatus: Number(refreshed?.error?.code ?? refreshed?.response?.status) || undefined });
            throw stageError('FC27_GALLERY_TRANSFER_UNCONFIRMED', 'transfer-refresh', refreshed);
          }
          void stage({ phase: 'transfer-refresh', status: 'success' });
          if (setSource || source.entries.some(row => row.pile === 'unassigned')) {
            const fresh = await env.adapter.refreshPurchaseState({ destination: 'unassigned' }); env.assertCurrent();
            if (fresh?.status !== 'completed') fail('FC27_GALLERY_UNASSIGNED_UNCONFIRMED');
          }
          const refs = setSource ? await env.inventory.scan(target) : source.entries.map(row => ({ id: row.itemId, definitionId: row.definitionId, pile: row.pile ?? 'club' }));
          env.assertCurrent();
          const items = refs.flatMap(ref => {
            const seen = env.adapter.inspectListingItem(ref);
            return seen?.status === 'loaded' ? [{ ...seen.candidate.item, tradeable: seen.candidate.tradeable,
              eligibleForListing: galleryListingCandidateAllowed(seen.candidate) }] : [];
          });
          const projected = setSource ? { status: 'observed', skipped: [], entries: items.filter(item => item.tradeable === true && item.eligibleForListing === true)
            .map(item => ({ item: { id: item.id, definitionId: item.definitionId, pile: item.pile }, purchase: null })) }
            : projectGalleryListingCandidates({ source, items });
          if (projected.status !== 'observed') return projected;
          const limitsByItem = projected.entries.length
            ? await readPriceLimits(root, projected.entries.map(candidate => candidate.item), env.assertCurrent) : {};
          const candidates = [];
          const displayItems = new Map(['club', 'unassigned', 'transfer'].flatMap(pile => createEaInventoryAdapter(root).readPile(pile)).map(item => [Number(item?.id), item]));
          if (setSource) for (const ref of refs) {
            const item = env.inventory.resolve(ref)?.item;
            if (item) displayItems.set(ref.id, item);
          }
          for (const candidate of projected.entries) {
            env.assertCurrent();
            const known = limitsByItem[candidate.item.id]?.status === 'loaded';
            void stage({ phase: 'price-limits', status: known ? 'success' : 'unknown',
              reason: known ? undefined : 'FC27_GALLERY_PRICE_LIMITS_UNKNOWN' });
            const observed = env.adapter.inspectListingItem(candidate.item);
            const display = displayItems.get(candidate.item.id);
            // Exact receipts take precedence. Enhancer oMt uses the owned
            // entity's lastSalePrice for Bought For, including non-FCAT buys.
            // This display cost never creates a purchase receipt or authority.
            let previousListingPrice = null, boughtFor = candidate.purchase?.purchasePrice ?? null;
            let boughtForSource = boughtFor > 0 ? 'receipt' : 'unknown';
            if (Number(display?.id) === candidate.item.id && Number(display?.definitionId) === candidate.item.definitionId) {
              try {
                if (boughtForSource !== 'receipt') {
                  const price = display.lastSalePrice;
                  if (Number.isSafeInteger(price) && price > 0) { boughtFor = price; boughtForSource = 'ea'; }
                  else if (price === 0 && display.owners === 1) boughtForSource = 'first-owner';
                }
              } catch { /* Unavailable cost is unknown, not a first-owner claim. */ }
              try {
                const auction = display.getAuctionData?.();
                const previous = auction?.currentBid > 0 ? null : auction?.isExpired?.() ? auction.startingBid : auction?.buyNowPrice;
                if (Number.isFinite(previous) && previous > 0) previousListingPrice = previous;
              } catch { /* Missing display metadata never changes eligibility. */ }
            }
            candidates.push({ ...candidate, name: observed?.candidate?.name ?? String(candidate.item.definitionId), boughtFor, boughtForSource, previousListingPrice });
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
          prepared = { context: env.context, scope: env.scope, binding, setSource, inventory: env.inventory,
            candidates, limitsByItem, marketPrices: prices, priceTiers: tiers ? Array.from(tiers, t => ({ min: t.min, inc: t.inc })) : null,
            expiresAt: quotes?.expiresAt ?? 0, listingPriceSource,
            quoteExpiresAt: Object.fromEntries(candidates.map(row => [row.item.definitionId, quotes?.expiresAt ?? 0])) };
          return { status: 'ready', source: sourceLabel, listingPriceSource, pricesBySource, ...(setSource ? { listingScope: setSource } : {}),
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
    planFodder(options) {
      if (!prepared || !same(prepared.context, readFc27Context(root))) return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' };
      planned = planFodderListings({ ...options, candidates: prepared.candidates, prices: prepared.marketPrices,
        priceTiers: prepared.priceTiers, limitsByItem: prepared.limitsByItem, quoteExpiresAt: prepared.quoteExpiresAt,
        quoteExpired: prepared.expiresAt <= Date.now() });
      return structuredClone(planned);
    },
    async refreshQuotes({ isCurrent = () => true, definitionIds = null } = {}) {
      if (busy || !prepared) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_BUSY' };
      const previous = prepared; busy = true; stopped = false;
      try {
      const ids = [...new Set(previous.candidates.map(row => row.item.definitionId))].filter(id => !definitionIds || definitionIds.includes(id));
      if (!ids.length) return { prices: structuredClone(previous.marketPrices), expiresAt: previous.expiresAt };
      const quotes = await loadPrices(ids, { force: true, isCurrent: () => isCurrent() && !stopped });
      if (!isCurrent() || prepared !== previous || !same(previous.context, readFc27Context(root))) fail('FC27_GALLERY_CONTEXT_CHANGED');
      if (stopped) fail('FC27_GALLERY_BULK_LIST_STOPPED');
      if (quotes.listingPriceSource && quotes.listingPriceSource !== previous.listingPriceSource) fail('FC27_GALLERY_LISTING_PLAN_CHANGED');
      const merged = { ...previous.marketPrices };
      for (const id of ids) {
        delete merged[id]; if (quotes.freshPrices?.[id] > 0) merged[id] = quotes.freshPrices[id];
        prepared.quoteExpiresAt[id] = quotes.expiresAt ?? 0;
      }
      prepared.marketPrices = merged;
      prepared.expiresAt = ids.length === new Set(previous.candidates.map(row => row.item.definitionId)).size
        ? quotes.expiresAt : Math.min(previous.expiresAt, quotes.expiresAt); planned = null;
      return { prices: structuredClone(prepared.marketPrices), expiresAt: prepared.expiresAt };
      } finally { busy = false; }
    },
    planTransfer({ selectedIds }) {
      if (!prepared || !same(prepared.context, readFc27Context(root))) return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' };
      const ids = new Set(selectedIds);
      planned = { status: 'observed', entries: prepared.candidates.filter(row => ids.has(row.item.id))
        .map(row => ({ ...row, action: 'transfer', startPrice: null, buyNow: null, durationSeconds: null })), skipped: [] };
      return structuredClone(planned);
    },
    async execute({ approved, plan, settings, resume = false, expectedRunId, isCurrent, onProgress } = {}) {
      if (!approved || !liveEnabled || typeof isCurrent !== 'function') return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_APPROVAL_REQUIRED' };
      if (busy) return { status: 'blocked', reason: 'FC27_GALLERY_LISTING_BUSY' };
      busy = true; stopped = false;
      try {
        const old = resume ? await create({ isCurrent }).session.inspect() : null;
        const expectedPurchaseBinding = resume ? old.binding : prepared?.binding;
        const setSource = resume ? old.source : prepared?.setSource;
        const env = create({ isCurrent, onProgress, expectedPurchaseBinding, setSource,
          inventory: resume ? null : prepared?.inventory }); env.assertCurrent();
        await env.assertSource();
        if (resume && setSource) for (const entry of old.entries ?? []) {
          if (entry.status === 'pending') await env.inventory.hydrate(entry.item);
        }
        if (resume && old.entries?.some(entry => entry.status === 'pending' && entry.item.pile === 'unassigned')) {
          const refreshed = await env.adapter.refreshPurchaseState({ destination: 'unassigned' }); env.assertCurrent();
          if (refreshed?.status !== 'completed') fail('FC27_GALLERY_UNASSIGNED_UNCONFIRMED');
        }
        const circuit = await readCircuit(get, env.scope);
        if (circuit.persistent) fail('FC27_GALLERY_LISTING_CIRCUIT_OPEN');
        if (circuit.retryAt > Date.now()) fail('FC27_GALLERY_LISTING_RATE_LIMIT_COOLDOWN');
        if (!resume && (!prepared || !same(prepared.context, env.context) || plan?.status !== 'observed'
          || !planned || !same(plan, planned)
          || !plan.entries?.length || plan.entries.some(e => !prepared.candidates.some(c => same(c.item, e.item) && same(c.purchase, e.purchase))))) fail('FC27_GALLERY_LISTING_PLAN_CHANGED');
        if (!resume && plan.entries.some(e => e.priceOrigin === 'market' && (e.quoteExpiresAt ?? prepared.expiresAt) <= Date.now())) {
          fail('FC27_GALLERY_LISTING_QUOTE_EXPIRED');
        }
        const result = await env.session.execute({ approved, entries: plan?.entries, binding: prepared?.binding, source: setSource ?? undefined,
          settings, resume, expectedRunId });
        const entries = Array.isArray(result?.entries) ? result.entries : [];
        const acceptedCount = entries.filter(entry => entry.status === 'accepted').length;
        const rejectedCount = entries.filter(entry => entry.status === 'rejected').length;
        const skippedCount = entries.filter(entry => entry.status === 'skipped').length;
        const unknownCount = entries.filter(entry => ['list-pending', 'unknown'].includes(entry.status)).length;
        if (accounting && entries.some(entry => entry.status === 'accepted' && entry.action !== 'transfer')) {
          // Set mode includes cards that were never bought by FCAT. Update
          // existing exact cost rows only; unknown cost must not become zero.
          const ledger = setSource ? await accounting.inspect() : null;
          const receipts = entries.filter(entry => entry.status === 'accepted' && entry.action !== 'transfer' && (!setSource
            || ledger?.ledger?.entries?.some(row => row.itemId === entry.item.id && row.definitionId === entry.item.definitionId)));
          const accountingResult = ledger?.status === 'blocked' ? ledger
            : receipts.length ? await accounting.recordListings(receipts) : { status: 'observed' };
          if (accountingResult?.status === 'blocked') {
            void stage({ event: 'listing-accounting', phase: 'readback', status: 'failed', reason: accountingResult.reason,
              count: acceptedCount });
            result.accountingWarning = accountingResult.reason;
          }
        }
        void stage({ event: 'listing-result', phase: 'execute', status: result?.status ?? 'blocked',
          reason: result?.reason ?? null, count: acceptedCount, acceptedCount, rejectedCount, skippedCount, unknownCount,
          requestedCount: entries.length });
        return result;
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
