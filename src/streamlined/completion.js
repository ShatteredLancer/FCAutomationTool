import { integer, same } from './contract.js';

// Use only after an owned fresh read has verified the exact consumed entities
// are absent and the same challenge/rules still match the durable plan. This
// is proof of this receipt's completed cycle, never approval for the next one.
export function streamlinedResetProof(receipt, expected, current, timesCompleted) {
  if (receipt?.schema !== 1 || receipt.status !== 'accepted' || receipt.challengeCompleted !== true
      || receipt.challengeId !== expected?.id || receipt.setId !== expected.setId
      || !integer(expected.targetScore, 1) || !integer(receipt.submittedScore, expected.targetScore)
      || !integer(receipt.challengeAwardCount, 0, 100) || !integer(receipt.setAwardCount, 0, 100)
      || receipt.challengeAwardCount + receipt.setAwardCount === 0
      || current?.id !== expected.id || current.setId !== expected.setId || current.submittedScore !== 0
      || current.targetScore !== expected.targetScore || !same(current.context, expected.context)
      || ![receipt.previousTimesCompleted, timesCompleted].every(value => value == null || integer(value))) return null;
  const previous = receipt.previousTimesCompleted;
  if (integer(previous) && integer(timesCompleted)) {
    if (timesCompleted === previous + 1) return 'challenge-count';
    // Known contradictory counters are not a missing-counter compatibility case.
    if (timesCompleted !== previous) return null;
  }
  if (current.status === 'COMPLETED') return 'receipt-completed-state';
  if (['UNLIMITED', 'LIMITED', 'REFRESH'].includes(expected.repeatabilityMode)
      && ['NOT_STARTED', 'IN_PROGRESS'].includes(current.status)) return 'receipt-reset-state';
  return null;
}
