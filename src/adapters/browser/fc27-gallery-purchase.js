import { createGalleryPurchaseSession } from '../../gallery/purchase-session.js';
import { readGalleryListingSource } from '../../gallery/listing-candidates.js';
import { createFc27PuzzleBuyAdapter } from '../ea/fc27-puzzle-buy.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { traditionalJournalScope, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { isPuzzleQuoteCeiling } from '../../fc27/puzzle-procurement-policy.js';
import { createFsuReferencePrice } from '../../fc27/fsu-reference-price.js';
import { createFc27FutbinHttp } from './fc27-futbin-http.js';

export function createFc27GalleryPurchase({ root, gmGetValue, gmSetValue, gmRequest, reader, liveEnabled, tradePreferences = null,
  readSettings = async () => ({ status: 'observed', queriesNumber: 5, quoteCeiling: null }), publicPrices = null, diagnosticLog = null, accounting = null }) {
  let busy = false, stopped = false;
  const create = ({ onProgress, isCurrent = () => true } = {}) => {
    const context = readFc27Context(root), scope = traditionalJournalScope(context);
    const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager: root.navigator.locks });
    const account = () => {
      if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root)) || !isCurrent()) throw new Error('FC27_GALLERY_CONTEXT_CHANGED');
    };
    const referencePrice = createFsuReferencePrice({ season: context.season, platform: context.platform,
      get: gmGetValue, set: gmSetValue, request: createFc27FutbinHttp(gmRequest) });
    const buyer = createGalleryPurchaseSession({ scope, context, get: gmGetValue, set: gmSetValue,
      exclusive: persistence.exclusive, assertCurrent: account, onProgress,
      readDestination: async () => tradePreferences ? (await tradePreferences.read()).destination : 'club',
      onPurchaseRecord: accounting ? record => accounting.recordPurchase(record) : null,
      shouldStop: () => stopped,
      preparePrices: publicPrices ? record => publicPrices.preparePurchase(record, { isCurrent: () => { account(); return !stopped; },
        onProgress: value => onProgress?.({ ...value, phase: 'reference-prices', total: value.total, purchased: 0, completed: 0, spent: 0 }) }) : null,
      checkOtherTransactions: async () => {
        const other = await persistence.journal.read(scope);
        if (other && !isTerminalTraditionalJournal(other)) throw new Error('FC27_RECOVERY_REQUIRED');
        // Puzzle purchase history is scoped to its own target; it is not a
        // global Gallery lock. The Puzzle session owns exact-target recovery.
      },
      operationId: () => root.crypto.randomUUID(),
      createAdapter: async (record, callbacks = {}) => {
        const settings = await readSettings(); account();
        if (settings?.status !== 'observed' || !Number.isSafeInteger(settings.queriesNumber) || settings.queriesNumber < 1
            || !isPuzzleQuoteCeiling(settings.quoteCeiling)) throw new Error('FC27_PUZZLE_POLICY_INVALID');
        record.quoteCeiling = settings.quoteCeiling;
        const fresh = await reader.readVersions(record.entries.map(entry => entry.definitionId)); account();
        if (fresh.status !== 'observed' || fresh.stale) throw new Error(fresh.reason ?? 'FC27_GALLERY_COLLECTION_UNCONFIRMED');
        const rows = new Map(fresh.rows.map(row => [row.definitionId, row]));
        const players = new Map(fresh.rows.filter(row => row.cardData).map(row => [row.definitionId, {
          _rating: row.cardData.rating, nationId: row.cardData.nation, teamId: row.cardData.teamId,
          leagueId: row.cardData.leagueId, preferredPosition: row.cardData.preferredPosition,
        }]));
        publicPrices?.remember([...players].map(([definitionId, fields]) => ({ definitionId, ...fields })));
        if (record.entries.some(entry => entry.state === 'waiting' && rows.get(entry.definitionId)?.isCollected !== true && !players.has(entry.definitionId))) {
          throw new Error('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE');
        }
        const adapter = await createFc27PuzzleBuyAdapter(root, { assertTarget: account, referencePrice, onSearch: callbacks.onSearch,
          refreshReference: publicPrices ? async (definitionId, policy) =>
            (await publicPrices.load([definitionId], { purpose: 'purchase', policy, isCurrent: () => { account(); return !stopped; } })).references[definitionId] : null,
          attempts: settings.queriesNumber,
          canWrite: () => liveEnabled === true && persistence.lock.hasExclusiveAccess(scope),
          verifyCurrent: account, playerDetails: players,
          collectionState: definitionId => rows.get(definitionId)?.isCollected,
          confirmCollection: async ids => {
            if (!ids.length) return { status: 'confirmed', confirmed: 0 };
            const result = await reader.readVersions(ids); account();
            const confirmed = result.rows?.filter(row => row.isCollected === true).map(row => row.definitionId) ?? [];
            return { status: result.status === 'observed' && confirmed.length === ids.length ? 'confirmed' : 'pending',
              confirmed: confirmed.length, total: ids.length, reason: result.reason ?? null };
          },
        }).catch(async error => {
          // Method-check failures occur before search/bid and must survive
          // Gallery sync floods without exporting source or account data.
          try {
            if (error?.message === 'FC27_TRANSACTION_METHOD_UNREVIEWED') {
              await diagnosticLog?.record?.({ area: 'gallery', event: 'purchase-method-check', phase: 'prepare',
                status: 'blocked', reason: error.message, method: error.methodPath, observedHash: error.observedHash });
            }
          } catch { /* Diagnostics never replace the original purchase failure. */ }
          throw error;
        });
        return Object.freeze({ ...adapter, find: (definitionId, cap = Infinity) => adapter.find(definitionId, Math.min(cap, settings.quoteCeiling ?? Infinity)) });
      },
    });
    return buyer;
  };
  const purchase = async input => {
    if (input?.approved !== true || typeof input.isCurrent !== 'function') return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_APPROVAL_REQUIRED' };
    if (liveEnabled !== true) return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_DISABLED' };
    if (busy) return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_BUSY' };
    busy = true; stopped = false;
    try {
      const result = await create(input).execute(input);
      try { await diagnosticLog?.record?.({ area: 'gallery', event: 'purchase-outcome', phase: 'execute',
        status: result.status, reason: result.reason, count: result.purchased ?? 0, spent: result.spent ?? 0 }); } catch { /* diagnostics only */ }
      return result;
    }
    catch (error) { return { status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_PURCHASE_UNCONFIRMED' }; }
    finally { busy = false; }
  };
  purchase.inspect = async () => {
    try {
      const context = readFc27Context(root), result = await create().inspect();
      if (result.retryContext) {
        const settings = await readSettings();
        if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw Error();
        result.retryContext = { ...result.retryContext, absoluteCap: settings.quoteCeiling,
          balance: root.services.User.getUser()?.getCurrency(root.GameCurrency.COINS)?.amount,
          priceTiers: root.UTCurrencyInputControl?.PRICE_TIERS?.map(row => ({ min: row.min, inc: row.inc })) };
      }
      return result;
    } catch { return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' }; }
  };
  purchase.preview = async items => {
    if (!publicPrices || !Array.isArray(items) || !items.length) throw Error('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE');
    const context = readFc27Context(root), scope = traditionalJournalScope(context);
    const assert = () => { if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root))) throw Error('FC27_GALLERY_CONTEXT_CHANGED'); };
    const plan = items.map(item => ({ ...item, definitionId: item.definitionId ?? item.eaId }));
    publicPrices.remember(plan);
    const approval = await publicPrices.preparePurchase({ scope, plan, entries: plan.map(item => ({ definitionId: item.definitionId, state: 'waiting' })) }); assert();
    const settings = await readSettings(); assert();
    const preferences = tradePreferences ? await tradePreferences.read() : { destination: 'club', style: 'enhancer' }; assert();
    return { approval, destination: preferences.destination, balance: root.services.User.getUser()?.getCurrency(root.GameCurrency.COINS)?.amount,
      absoluteCap: settings.quoteCeiling, priceTiers: root.UTCurrencyInputControl?.PRICE_TIERS?.map(row => ({ min: row.min, inc: row.inc })),
      items: plan.map(item => ({ ...item, priceReference: { ...approval.rows.find(row => row.definitionId === item.definitionId),
        season: approval.season, platform: approval.platform }, pricePolicy: approval.policy })) };
  };
  if (publicPrices) purchase.refreshPrices = async (ids, options) => {
    const policy = await publicPrices.readSettings(), references = {};
    for (let i = 0; i < ids.length; i += 250) Object.assign(references, (await publicPrices.load(ids.slice(i, i + 250), { ...options, purpose: 'purchase', policy })).references);
    return { policy, references };
  };
  purchase.stop = () => { stopped = true; };
  // Explicit read only: does not construct the buyer or query collection,
  // inventory, prices, or EA. All writes remain in their own transactions.
  purchase.listingSource = async ({ expectedOperationId, expectedBinding, isCurrent = () => true } = {}) => {
    if (busy) return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_BUSY', entries: [] };
    try {
      const context = readFc27Context(root), scope = traditionalJournalScope(context);
      const persistence = createFc27TransactionPersistence({ context, gmGetValue, gmSetValue, lockManager: root.navigator.locks });
      return await readGalleryListingSource({ scope, context, expectedOperationId, expectedBinding,
        get: gmGetValue, exclusive: persistence.exclusive, assertCurrent: () => {
          if (JSON.stringify(context) !== JSON.stringify(readFc27Context(root)) || !isCurrent()) throw Error('FC27_GALLERY_CONTEXT_CHANGED');
        } });
    } catch { return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED', entries: [] }; }
  };
  return Object.freeze(purchase);
}
