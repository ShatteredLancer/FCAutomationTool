import { createFc27ClubReadTransport } from './fc27-club-read.js';
import { createFc27StreamlinedStorageReader } from './fc27-streamlined-storage-read.js';
import { createFc27StreamlinedProgressReader } from './fc27-streamlined-progress.js';
import { readFc27Context } from './fc27-local-read.js';
import { locateFc27StreamlinedPage } from './fc27-streamlined-read.js';
import { validateStreamlinedJournal } from '../../streamlined/journal.js';
import { integer, same, fail } from '../../streamlined/contract.js';
import { streamlinedResetProof } from '../../streamlined/completion.js';

// Readback only. Do not infer commitment from an emptied local repository or
// mutate that repository to manufacture absence. A completed zero-score cycle
// requires its exact durable completion receipt and independently read state.
export function createFc27StreamlinedReconciler(root, { now = () => Date.now(),
  createTransport = createFc27ClubReadTransport, createStorage = createFc27StreamlinedStorageReader,
  createProgress = createFc27StreamlinedProgressReader, nativeReauth = false, requirePage = true } = {}) {
  let busy = false;
  return Object.freeze({ async reconcile(record, batch) {
    if (busy) fail('BUSY');
    busy = true;
    try {
      validateStreamlinedJournal(record, readFc27Context(root));
      if (!same(record.batches[batch?.index], batch) || !['pending', 'unknown'].includes(batch.state)) fail('JOURNAL_INVALID');
      if (!batch.receipt) fail('RECEIPT_REQUIRED');
      const page = locateFc27StreamlinedPage(root), expected = record.plan.challenge;
      const assert = () => {
        const current = locateFc27StreamlinedPage(root);
        if (requirePage && (!page || !current || current.controller !== page.controller || current.setId !== expected.setId
            || current.challengeId !== expected.id) || !same(readFc27Context(root), record.context)) fail('CONTEXT_CHANGED');
      };
      assert();
      const effectivePile = ref => ref.executionPile ?? ref.pile;
      const clubRefs = batch.refs.filter(ref => effectivePile(ref) === 'club');
      const transport = clubRefs.length ? await createTransport(root, { nativeReauth }) : null;
      const ids = [...new Set(clubRefs.map(ref => ref.definitionId))], seen = new Set();
      let requests = 0;
      for (let offset = 0; offset < ids.length; offset += 50) {
        const definitionIds = ids.slice(offset, offset + 50);
        for (let start = 0; ; start += 250) {
          assert();
          if (start >= 20000) fail('INVENTORY_LIMIT');
          const rows = await transport.readPage({ start, count: 250, definitionIds });
          assert();
          if (!Array.isArray(rows) || rows.length > 250) fail('FRESH_ENTITY_UNVERIFIED');
          for (const row of rows) {
            // Extra query results cannot veto exact consumed-ID absence by
            // pile alone. Any selected ID still present, in any returned pile,
            // blocks confirmation below; malformed/conflicting IDs still stop.
            if (!row || !integer(row.id, 1) || !integer(row.definitionId, 1) || seen.has(row.id)
                || batch.refs.some(ref => ref.id === row.id && ref.definitionId !== row.definitionId)) fail('FRESH_ENTITY_UNVERIFIED');
            seen.add(row.id);
            if (batch.refs.some(ref => ref.id === row.id)) fail('MATERIAL_STILL_PRESENT');
          }
          if (rows.length < 250) break;
        }
      }
      requests += transport?.getRequestCount() ?? 0;
      if (batch.refs.some(ref => effectivePile(ref) === 'storage')) {
        const storage = await createStorage(root, { nativeReauth });
        assert();
        const rows = await storage.read();
        assert();
        if (!Array.isArray(rows) || rows.length > 20000) fail('FRESH_ENTITY_UNVERIFIED');
        for (const row of rows) {
          if (!row || !integer(row.id, 1) || !integer(row.definitionId, 1) || row.pile !== 'storage' || seen.has(row.id)
              || batch.refs.some(ref => ref.id === row.id && ref.definitionId !== row.definitionId)) fail('FRESH_ENTITY_UNVERIFIED');
          seen.add(row.id);
          if (batch.refs.some(ref => ref.id === row.id)) fail('MATERIAL_STILL_PRESENT');
        }
        requests += storage.getRequestCount();
      }
      // Read progress last so a long inventory read cannot make it stale.
      const progress = await createProgress(root, { now, requirePage }).read(expected);
      assert();
      if (progress?.fresh !== true || !integer(progress.observedAt) || now() < progress.observedAt
          || now() - progress.observedAt > 15000 || !progress.challenge) fail('PROGRESS_READ_UNVERIFIED');
      const current = progress.challenge;
      const changed = { ...expected, status: current.status, submittedScore: current.submittedScore, remainingScore: current.remainingScore };
      if (!same(current, changed)) fail('PROGRESS_CHANGED');
      const cycleReset = current.submittedScore === 0 && batch.receipt.challengeCompleted;
      const resetProof = cycleReset ? streamlinedResetProof(batch.receipt, expected, current, progress.timesCompleted) : null;
      if (cycleReset && !resetProof) {
        throw Object.assign(Error('FC27_STREAMLINED_CYCLE_RESET_UNVERIFIED'), {
          mismatch: batch.receipt.submittedScore < expected.targetScore ? 'completion-score-below-target'
            : integer(batch.receipt.previousTimesCompleted) && integer(progress.timesCompleted)
              && progress.timesCompleted !== batch.receipt.previousTimesCompleted
              && progress.timesCompleted !== batch.receipt.previousTimesCompleted + 1 ? 'cycle-count-conflict' : 'cycle-state-conflict',
          cycleCountBefore: batch.receipt.previousTimesCompleted, cycleCountAfter: progress.timesCompleted,
        });
      }
      if (!cycleReset && current.submittedScore !== batch.receipt.submittedScore) fail('PROGRESS_CHANGED');
      return { fresh: true, context: record.context, setId: expected.setId, challengeId: expected.id,
        observedAt: progress.observedAt, submittedScore: current.submittedScore, absent: structuredClone(batch.refs),
        challenge: current, timesCompleted: progress.timesCompleted,
        operationConfirmed: true, cycleResetConfirmed: cycleReset, cycleResetProof: resetProof, rewardConfirmed: false,
        requests: requests + (progress.attempts ?? 1) };
    } finally { busy = false; }
  } });
}
