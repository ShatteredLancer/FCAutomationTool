import { createGalleryPurchaseSession } from '../../gallery/purchase-session.js';
import { readGalleryListingSource } from '../../gallery/listing-candidates.js';
import { createFc27PuzzleBuyAdapter } from '../ea/fc27-puzzle-buy.js';
import { createFc27TransactionPersistence } from './fc27-transaction-persistence.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { traditionalJournalScope, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { puzzleBuyPendingKey } from '../../fc27/puzzle-buy-session.js';
import { isPuzzleQuoteCeiling } from '../../fc27/puzzle-procurement-policy.js';
import { createFsuReferencePrice } from '../../fc27/fsu-reference-price.js';
import { createFc27FutbinHttp } from './fc27-futbin-http.js';

export function createFc27GalleryPurchase({ root, gmGetValue, gmSetValue, gmRequest, reader, liveEnabled,
  readSettings = async () => ({ status: 'observed', queriesNumber: 5, quoteCeiling: null }) }) {
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
      shouldStop: () => stopped,
      checkOtherTransactions: async () => {
        const other = await persistence.journal.read(scope);
        if (other && !isTerminalTraditionalJournal(other)) throw new Error('FC27_RECOVERY_REQUIRED');
        if (await gmGetValue(puzzleBuyPendingKey(scope), null) !== null) throw new Error('FC27_BUY_RECOVERY_REQUIRED');
      },
      operationId: () => root.crypto.randomUUID(),
      createAdapter: async record => {
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
        if (record.entries.some(entry => entry.state === 'waiting' && rows.get(entry.definitionId)?.isCollected !== true && !players.has(entry.definitionId))) {
          throw new Error('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE');
        }
        const adapter = await createFc27PuzzleBuyAdapter(root, { assertTarget: account, referencePrice,
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
        });
        return Object.freeze({ ...adapter, find: definitionId => adapter.find(definitionId, settings.quoteCeiling ?? Infinity) });
      },
    });
    return buyer;
  };
  const purchase = async input => {
    if (input?.approved !== true || typeof input.isCurrent !== 'function') return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_APPROVAL_REQUIRED' };
    if (liveEnabled !== true) return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_DISABLED' };
    if (busy) return { status: 'blocked', reason: 'FC27_GALLERY_PURCHASE_BUSY' };
    busy = true; stopped = false;
    try { return await create(input).execute(input); }
    catch (error) { return { status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_GALLERY_PURCHASE_UNCONFIRMED' }; }
    finally { busy = false; }
  };
  purchase.inspect = async () => {
    try { return await create().inspect(); } catch { return { status: 'blocked', reason: 'FC27_GALLERY_CONTEXT_CHANGED' }; }
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
