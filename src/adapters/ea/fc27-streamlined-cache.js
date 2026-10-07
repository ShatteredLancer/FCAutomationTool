import { ownData } from '../../fc27/prelaunch-contract.js';
import { readFc27Context } from './fc27-local-read.js';
import { verifyFc27Methods } from './fc27-transaction-transport.js';
import { validateStreamlinedJournal } from '../../streamlined/journal.js';
import { integer, same, fail } from '../../streamlined/contract.js';

export const FC27_STREAMLINED_CACHE_METHODS = Object.freeze([
  ['methods.evict', 'acd7929f9787fbed3b9a6054e91bcb233bc3a6b108bf196ad2351703fefe9d65'],
  ['methods.removeFromSbc', '11fa8a557c49a4e26eacdf4f2ee9e9b3dd13de5e9599d27ba9e88e9737e9abe1'],
  ['methods.resetSquads', 'f128540456b6809e245749138960535f8b5946f8d6774960586f9804ac2bf0d8'],
  ['methods.dirty', '9059b7d8d555643b025c9c6f2e956436da952e3e857720bdce9b4bff70e1de53'],
]);

// Native local eviction, never native submission or _applyOneClickSubmission:
// the latter also creates rewards, advances counters and may write favourites.
// Only server-confirmed exact consumption may evict cached items. This module
// does not stand in for the separate native progress/reward lifecycle adapter.
export async function createFc27StreamlinedCache(root, { now = () => Date.now() } = {}) {
  const context = readFc27Context(root), service = root.services?.SBC, squad = root.services?.Squad;
  const methods = { evict: service?._evictSubmittedItems, removeFromSbc: service?.removeItemsById,
    resetSquads: squad?.resetSquadsCache, dirty: root.events?.markClubCacheDirty };
  const verified = await verifyFc27Methods({ methods, crypto: root.crypto }, FC27_STREAMLINED_CACHE_METHODS);
  const assert = () => {
    verified();
    if (!same(readFc27Context(root), context) || root.services?.SBC !== service || root.services?.Squad !== squad
        || service._evictSubmittedItems !== methods.evict || service.removeItemsById !== methods.removeFromSbc
        || squad.resetSquadsCache !== methods.resetSquads || root.events?.markClubCacheDirty !== methods.dirty) fail('CACHE_RUNTIME_CHANGED');
  };
  const item = (pile, id) => {
    const repo = ownData(ownData(root.repositories, 'Item'), pile);
    const collection = ownData(ownData(repo, 'items'), '_collection');
    if (pile === 'club' && (!collection || typeof collection !== 'object')) fail('CACHE_UNVERIFIED');
    // Storage may be an EA Dictionary itself rather than a Club repository.
    const storage = pile === 'storage' ? ownData(repo, '_collection') : undefined;
    if (repo && !collection && !storage) fail('CACHE_UNVERIFIED');
    return ownData(collection ?? storage, String(id));
  };
  const validateRefs = refs => {
    if (!Array.isArray(refs) || !refs.length || new Set(refs.map(ref => ref.id)).size !== refs.length
        || refs.some(ref => !integer(ref.id, 1) || !integer(ref.definitionId, 1) || !['club', 'storage'].includes(ref.pile))) fail('CACHE_UNVERIFIED');
    // Inspect every identity before the first removal. Same-version other
    // copies remain untouched; a reused ID or unexpected pile stops cleanup.
    for (const ref of refs) {
      const cached = item(ref.pile, ref.id);
      if (cached && (ownData(cached, 'id') !== ref.id || ownData(cached, 'definitionId') !== ref.definitionId)
          || item(ref.pile === 'club' ? 'storage' : 'club', ref.id)) fail('CACHE_IDENTITY_CHANGED');
    }
  };
  const dirty = () => {
    assert(); methods.dirty.call(root.events, 'FC27 Streamlined SBC');
    if (ownData(ownData(ownData(root.info, 'base'), 'clubCache'), 'localDirty') !== true) fail('CACHE_UNVERIFIED');
  };
  return Object.freeze({ assert,
    prepare(refs) { assert(); validateRefs(refs); },
    dirty,
    apply(record, batch, evidence) {
      assert(); validateStreamlinedJournal(record, context);
      if (!same(record.batches[batch?.index], batch) || !['pending', 'unknown'].includes(batch.state)
          || !batch.receipt || evidence?.fresh !== true || evidence.operationConfirmed !== true
          || !same(evidence.context, context) || evidence.setId !== record.plan.challenge.setId
          || evidence.challengeId !== record.plan.challenge.id || !same(evidence.absent, batch.refs)
          || !integer(evidence.observedAt) || evidence.observedAt > now() || now() - evidence.observedAt > 15000
          || evidence.submittedScore !== batch.receipt.submittedScore) fail('CACHE_EVIDENCE_REQUIRED');
      validateRefs(batch.refs); dirty();
      // Repeating this after a cache/GM failure is safe: native eviction accepts
      // already-absent entities, while still clearing cached squad references.
      methods.evict.call(service, batch.refs.map(ref => ref.id));
      assert();
      if (batch.refs.some(ref => item('club', ref.id) || item('storage', ref.id))) fail('CACHE_RECONCILIATION_UNCONFIRMED');
      return true;
    },
  });
}
