import { validateStreamlinedPurchase } from './purchase-journal.js';
import { validateStreamlinedJournal, isUnsentStreamlinedJournal } from './journal.js';
import { same, integer, fail } from './contract.js';

// Before replacing the single contribution journal, finish any matching outer
// purchase bookkeeping from its durable inner result. Otherwise a crash between
// the two checkpoints can leave an orphan marker after the proof is overwritten.
// This does not read EA, retry a transaction or infer an outcome from expiry.
export function projectStreamlinedPurchaseHandoff(purchase, previous) {
  if (!purchase?.contribution || !previous) return null;
  validateStreamlinedPurchase(purchase, previous.context);
  validateStreamlinedJournal(previous, previous.context);
  const marker = purchase.contribution, old = previous.plan.challenge;
  if (old.setId !== purchase.challenge.setId || old.id !== purchase.challenge.id) return null;
  if (marker.batchPlan?.fingerprint !== previous.plan.fingerprint || previous.batches.length !== 1
      || !same(previous.plan.items, marker.material.map(row => row.item))
      || old.submittedScore !== purchase.submittedScore || old.targetScore !== purchase.challenge.targetScore) {
    fail('PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED');
  }
  const next = structuredClone(purchase), batch = previous.batches[0];
  if (isUnsentStreamlinedJournal(previous) || batch.state === 'rejected') {
    next.contribution = null;
    return validateStreamlinedPurchase(next, previous.context);
  }
  if (['pending', 'unknown'].includes(batch.state)) return null;
  const maximum = purchase.submittedScore + marker.material.reduce((sum, row) => sum + row.item.points, 0);
  if (batch.state !== 'confirmed' || batch.receipt?.status !== 'accepted'
      || batch.receipt.submittedScore !== previous.submittedScore
      || !integer(previous.submittedScore, purchase.submittedScore + 1, maximum)) fail('PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED');
  for (const row of marker.material) {
    const entry = next.entries.find(item => item.itemId === row.item.id && item.definitionId === row.item.definitionId);
    if (!entry || !['ready', 'club'].includes(entry.state) || next.consumedIds.includes(entry.itemId)) fail('PURCHASE_IDENTITY_CONFLICT');
    entry.state = 'consumed'; next.consumedIds.push(entry.itemId); next.fulfilled[row.groupIndex]++;
  }
  next.submittedScore = previous.submittedScore; next.contribution = null;
  next.completed = next.submittedScore >= next.challenge.targetScore;
  next.confirmedBatches = (next.confirmedBatches ?? 0) + 1;
  next.progressChanged = next.submittedScore !== maximum && !next.completed;
  return validateStreamlinedPurchase(next, previous.context);
}
