import { validateStreamlinedPurchase } from './purchase-journal.js';
import { validateStreamlinedJournal, isUnsentStreamlinedJournal } from './journal.js';
import { same, integer, fail } from './contract.js';
import { streamlinedPurchaseContributionPlan } from './recovery-isolation.js';

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
  const bound = streamlinedPurchaseContributionPlan(purchase);
  if (bound.fingerprint !== previous.plan.fingerprint) {
    const reserved = new Set([...bound.items.map(item => item.id), ...purchase.entries
      .filter(entry => ['ready', 'buy-pending', 'bought', 'move-pending', 'club'].includes(entry.state)).map(entry => entry.itemId)]);
    if (previous.plan.items.some(item => reserved.has(item.id))) {
      const error = Error('FC27_STREAMLINED_PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED');
      error.mismatch = 'purchase-history-overlap'; throw error;
    }
    return null; // A disjoint stock cycle is not this marker's missing receipt.
  }
  if (previous.batches.length !== 1
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
