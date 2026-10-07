import { maintainPuzzleBuyLifecycle } from '../../fc27/puzzle-buy-lifecycle.js';
import { createTraditionalExclusive } from '../../fc27/traditional-lock.js';
import { traditionalJournalScope } from '../../fc27/traditional-journal.js';
import { readFc27Context } from '../ea/fc27-local-read.js';
import { createFc27ClubReadTransport } from '../ea/fc27-club-read.js';
import { createFc27TransactionTransport } from '../ea/fc27-transaction-transport.js';
import { verifyFc27Methods } from '../ea/fc27-transaction-transport.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Cached *positive* completed/expired facts are sufficient. A missing Set in a
// partial or uninitialized catalogue is unknown, never automatic retirement.
export function puzzlePurchaseTargetState(root, target, now = Date.now()) {
  const repo = root.services?.SBC?.repository ?? root.repositories?.SBC;
  const set = repo?.getSetById?.(target.setId);
  if (!set) return 'unknown';
  if (set.isComplete?.() === true) return 'completed';
  if (Number.isFinite(set.endTime) && set.endTime > 0 && set.endTime * 1000 <= now) return 'retired';
  const challenge = set.getChallenges?.()?.find(row => row.id === target.challengeId);
  if (challenge && challenge.status === 'COMPLETED') return 'completed';
  return 'active';
}

const catalogueChecks = new Map();
// Missing cache entries are not retirement evidence. One reviewed DAO catalogue
// GET confirms absence; share it per account for five minutes (including errors).
export async function readPuzzlePurchaseTargetState(root, target, assertCurrent) {
  const cached = puzzlePurchaseTargetState(root, target);
  if (cached !== 'unknown') return cached;
  const context = readFc27Context(root), key = JSON.stringify(context), at = Date.now();
  let check = catalogueChecks.get(key);
  if (!check || at - check.at >= 300000) {
    const promise = (async () => {
      const dao = root.services?.SBC?.sbcDAO;
      const runtime = await verifyFc27Methods({ dao, crypto: root.crypto }, [
        ['dao.getSets', '17c14dbd7d26929eb04ad616ef088bdc076ba3a81f08788aa83ccd239581ea2c']]);
      assertCurrent(); runtime();
      return new Promise((resolve, reject) => {
        const owner = {}; let observable, done = false;
        const finish = (error, rows) => {
          if (done) return; done = true; clearTimeout(timer);
          try { observable?.unobserve(owner); } catch { /* Own observer only. */ }
          error ? reject(error) : resolve(rows);
        };
        const timer = setTimeout(() => finish(Error('FC27_BUY_CATALOG_TIMEOUT')), 15000);
        try {
          observable = dao.getSets();
          observable.observe(owner, (_sender, reply) => {
            if (done) return;
            try {
              assertCurrent(); runtime();
              const raw = reply?.response?.sets?._collection ?? reply?.response?.sets;
              const rows = raw && typeof raw === 'object' ? Object.values(raw) : null;
              if (reply?.success !== true || reply.status !== 200 || !rows || rows.length > 500
                  || rows.some(row => !Number.isSafeInteger(row?.id) || row.id <= 0)
                  || new Set(rows.map(row => row.id)).size !== rows.length) throw Error('FC27_BUY_CATALOG_UNCONFIRMED');
              finish(null, rows.map(row => row.id));
            } catch (error) { finish(error); }
          });
        } catch (error) { finish(error); }
      });
    })().catch(() => null);
    if (catalogueChecks.size >= 8) catalogueChecks.delete(catalogueChecks.keys().next().value);
    check = { at, promise }; catalogueChecks.set(key, check);
  }
  const ids = await check.promise; assertCurrent();
  return ids ? ids.includes(target.setId) ? 'active' : 'retired' : 'unknown';
}

export async function maintainFc27PuzzlePurchases(root, { get, set, diagnosticLog = null, requestedTarget = null,
  targetState = null } = {}) {
  const context = readFc27Context(root), scope = traditionalJournalScope(context);
  const assertCurrent = () => {
    if (!same(context, readFc27Context(root))) throw Error('FC27_BUY_CONTEXT_CHANGED');
  };
  const lock = createTraditionalExclusive({ context, lockManager: root.navigator?.locks });
  let club, transport, locations;
  try {
    const result = await lock.run(scope, () => maintainPuzzleBuyLifecycle({ scope, context, get, set, assertCurrent,
      targetState: targetState ?? (target => readPuzzlePurchaseTargetState(root, target, assertCurrent)), requestedTarget,
      locate: async (entry, entries) => {
        if (!locations) locations = (async () => {
          club = await createFc27ClubReadTransport(root, { nativeReauth: true });
          const ids = [...new Set(entries.map(row => row.definitionId))];
          const rows = await club.readPage({ start: 0, count: 250, definitionIds: ids }); assertCurrent();
          const found = new Map(entries.filter(e => rows.some(row => row.id === e.itemId && row.definitionId === e.definitionId))
            .map(e => [e.itemId, 'club']));
          if (found.size < entries.length) {
            transport = await createFc27TransactionTransport(root);
            const reply = await transport.request('unassigned'); assertCurrent();
            const items = reply?.success === true && reply.status === 200 ? reply.response?.items : null;
            if (Array.isArray(items)) for (const e of entries) {
              if (!found.has(e.itemId) && items.some(item => item.id === e.itemId
                  && (item.resourceId ?? item.definitionId) === e.definitionId)) found.set(e.itemId, 'purchased');
            }
          }
          return found;
        })();
        return (await locations).get(entry.itemId) ?? 'unknown';
      } }));
    if (result?.status === 'archived') {
      try { await diagnosticLog?.record?.({ area: 'puzzle', event: 'purchase-history', status: result.status,
        reason: `FC27_BUY_${result.reason.toUpperCase().replaceAll('-', '_')}`, setId: result.setId,
        challengeId: result.challengeId, count: result.count, unknownCount: result.unknownCount }); } catch { /* diagnostic only */ }
    }
    return result ?? { status: 'busy' };
  } finally { club?.cancel?.(); transport?.cancel?.(); }
}
