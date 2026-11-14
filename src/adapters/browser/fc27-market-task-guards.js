import { readFc27Context } from '../ea/fc27-local-read.js';
import { readFc27StreamlinedProtection } from '../ea/fc27-protection-read.js';
import { traditionalJournalScope, normalizeTraditionalJournal, isTerminalTraditionalJournal } from '../../fc27/traditional-journal.js';
import { readPuzzleBuyPending } from '../../fc27/puzzle-buy-lifecycle.js';
import { fc27ConceptPendingKey } from '../../fc27/puzzle-concept-session.js';
import { readPuzzleReservations } from '../../fc27/puzzle-reservations.js';
import { readFc27PuzzleFillRecords } from '../../fc27/puzzle-fill-journal.js';
import { galleryPurchasePendingKey } from '../../gallery/purchase-session.js';
import { assertNoGalleryListingPending } from '../../gallery/bulk-list-session.js';
import { assertGalleryRelistSettled } from '../../gallery/relist-recovery.js';
import { createGalleryListingScheduleStore } from '../../gallery/listing-scheduler.js';
import { createStreamlinedJournal } from '../../streamlined/journal.js';
import { createStreamlinedPurchaseJournal, streamlinedPurchaseReservedIds } from '../../streamlined/purchase-journal.js';
import { createStreamlinedMaterializationJournal } from '../../streamlined/materialization-journal.js';
import { tradingExecutionKey, readTradingExecution } from '../../trading/execution-session.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw Error(`MARKET_${reason}`); };
const noWrite = () => fail('GUARD_WRITE_FORBIDDEN');

// Pure local journal checks under the shared native lock. No maintenance,
// auto-archiving, inferred receipts, or FSU SBC quality/league restrictions.
export function createFc27MarketTaskGuards({ root, get, context: marketContext, assertCurrent }) {
  const nativeContext = readFc27Context(root), scope = traditionalJournalScope(nativeContext);
  const assert = () => {
    assertCurrent();
    if (scope !== marketContext.scope || !same(nativeContext, readFc27Context(root))) fail('CONTEXT_CHANGED');
  };
  const read = async (key, fallback) => { assert(); const value = await get(key, fallback); assert(); return value; };
  const contribution = createStreamlinedJournal({ get: read, set: noWrite });
  const purchase = createStreamlinedPurchaseJournal({ get: read, set: noWrite });
  const materialization = createStreamlinedMaterializationJournal({ context: nativeContext, get: read, set: noWrite, assertCurrent: assert });
  const schedule = createGalleryListingScheduleStore({ context: nativeContext, scope, get: read, set: noWrite });
  let reserved = null;
  return Object.freeze({
    async checkOtherTransactions() {
      assert(); reserved = null; const ids = new Set();
      const add = values => { for (const id of values) { if (!Number.isSafeInteger(id) || id <= 0) fail('RESERVATION_UNVERIFIED'); ids.add(id); } };
      const raw = await read(scope, null);
      if (raw !== null && !isTerminalTraditionalJournal(normalizeTraditionalJournal(scope, raw))) fail('OTHER_SBC_PENDING');
      if (await read(fc27ConceptPendingKey(scope), null) !== null) fail('OTHER_SBC_PENDING');
      for (const record of await readFc27PuzzleFillRecords(read, nativeContext)) {
        if (record.phase === 'save-pending') fail('OTHER_SBC_PENDING');
        add(record.itemRefs.map(ref => ref.id));
      }
      const puzzle = await readPuzzleBuyPending(read, scope, nativeContext);
      if (puzzle) {
        if (puzzle.record.phase === 'save-pending' || puzzle.record.entries.some(e => ['buy-pending', 'move-pending'].includes(e.state))) fail('OTHER_PURCHASE_PENDING');
        add(puzzle.record.entries.filter(e => e.state !== 'waiting').map(e => e.itemId));
      }
      const reservations = await readPuzzleReservations(read, scope);
      add(reservations.targets.flatMap(t => t.itemRefs.map(ref => ref.id)));
      if (await read(galleryPurchasePendingKey(scope), null) !== null) fail('OTHER_PURCHASE_PENDING');
      await assertNoGalleryListingPending(read, scope); await assertGalleryRelistSettled(read, scope);
      const listing = await schedule.read();
      if (listing?.status === 'running') fail('OTHER_LISTING_PENDING');
      if (listing?.armed && listing.enabled) add(listing.entries.map(e => e.item.id));
      const relist = await read(`fcat-fc27-gallery-auto-relist-v1:${scope}`, null);
      if (relist?.status === 'armed') {
        if (!same(relist.context, nativeContext) || !['batch', 'all'].includes(relist.range) || !Array.isArray(relist.items)) fail('RESERVATION_UNVERIFIED');
        // A legacy 'all' relister may touch any new holding. Disarm it in
        // Gallery before starting the independent task owner.
        if (relist.range === 'all') fail('OTHER_RELIST_ARMED');
        add(relist.items.map(row => row.id));
      }
      await materialization.assertSettled();
      const plan = await contribution.read(nativeContext);
      if (plan?.batches.some(b => ['pending', 'unknown'].includes(b.state))) fail('OTHER_CONTRIBUTION_PENDING');
      if (plan) add(plan.batches.filter(b => b.state === 'waiting').flatMap(b => b.refs.map(ref => ref.id)));
      const procurement = await purchase.read(nativeContext);
      if (procurement && !await purchase.isRetired(procurement)) {
        if (procurement.contribution || procurement.entries.some(e => ['buy-pending', 'move-pending'].includes(e.state))) fail('OTHER_PURCHASE_PENDING');
        add(streamlinedPurchaseReservedIds(procurement));
      }
      add(await purchase.reservedIds(nativeContext));
      const investment = readTradingExecution(await read(tradingExecutionKey(scope), null), marketContext);
      if (investment?.entries.some(e => ['buy-pending', 'move-pending', 'list-pending'].includes(e.phase))) fail('OTHER_INVESTMENT_PENDING');
      if (investment) add(investment.entries.filter(e => ['bought', 'transfer', 'holding', 'listed'].includes(e.phase)).map(e => e.offer.itemId));
      assert(); reserved = ids;
    },
    assertProtected(item) {
      assert(); if (reserved === null) fail('GUARDS_UNAVAILABLE');
      const protection = readFc27StreamlinedProtection(root);
      if (!Number.isSafeInteger(item?.id) || item.id <= 0) fail('HOLDING_UNAVAILABLE');
      return !reserved.has(item.id) && !protection.lockedItemIds.includes(item.id) && !protection.activeSquadItemIds.includes(item.id);
    },
  });
}
