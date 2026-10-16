import { expect, it } from 'vitest';
import { challenge } from '../helpers/streamlined.js';
import { normalizeStreamlinedContributionReply } from '../../src/streamlined/contribution.js';
import { streamlinedResetProof } from '../../src/streamlined/completion.js';

const fixture = () => {
  const expected = challenge({ scoreRequirement: 100, repeatabilityMode: 'REFRESH' });
  const current = { ...expected, submittedScore: 0, status: 'NOT_STARTED' };
  const receipt = normalizeStreamlinedContributionReply({ success: true, status: 200, response: {
    challengeId: expected.id, setId: expected.setId, submittedScore: 100, grantedChallengeAwards: [{ type: 'pack' }] } },
  { challengeId: expected.id, setId: expected.setId, previousScore: 0, previousTimesCompleted: 0, itemIds: [1] });
  return { expected, current, receipt };
};

it.each([0, null, undefined, 1])('classifies valid completion with observed child counter %s without inventing a counter', count => {
  const f = fixture();
  expect(streamlinedResetProof(f.receipt, f.expected, f.current, count)).toBe(count === 1 ? 'challenge-count' : 'receipt-reset-state');
  expect(f.receipt.previousTimesCompleted).toBe(0);
});

it.each([2, -1, '1', NaN])('rejects malformed or known conflicting counters: %s', count => {
  const f = fixture();
  expect(streamlinedResetProof(f.receipt, f.expected, f.current, count)).toBe(null);
});

it('does not treat reset state alone, a partial receipt or a mismatched target as completion', () => {
  const f = fixture();
  for (const patch of [{ schema: 2 }, { challengeCompleted: false }, { challengeAwardCount: 0 },
    { submittedScore: 99 }, { challengeId: 999 }, { setId: 999 }]) {
    expect(streamlinedResetProof({ ...f.receipt, ...patch }, f.expected, f.current, 0)).toBe(null);
  }
  for (const patch of [{ submittedScore: 20 }, { targetScore: 101 }, { id: 999 }, { context: {} }]) {
    expect(streamlinedResetProof(f.receipt, f.expected, { ...f.current, ...patch }, 0)).toBe(null);
  }
});

it('requires a native completed state for non-repeatable or unknown-mode zero-score readback', () => {
  const f = fixture();
  for (const repeatabilityMode of ['NON_REPEATABLE', null, 'UNKNOWN']) {
    const expected = { ...f.expected, repeatabilityMode }, current = { ...f.current, repeatabilityMode };
    expect(streamlinedResetProof(f.receipt, expected, current, 0)).toBe(null);
    expect(streamlinedResetProof(f.receipt, expected, { ...current, status: 'COMPLETED' }, 0)).toBe('receipt-completed-state');
  }
});

it('can settle a legacy valid receipt without a child-counter baseline, not upgrade it to a new cycle', () => {
  const f = fixture(), { previousTimesCompleted: _old, ...receipt } = f.receipt;
  expect(streamlinedResetProof(receipt, f.expected, f.current, null)).toBe('receipt-reset-state');
  expect(receipt).not.toHaveProperty('previousTimesCompleted');
});

it('rejects known rollback even with a valid completion receipt and reset state', () => {
  const f = fixture();
  expect(streamlinedResetProof({ ...f.receipt, previousTimesCompleted: 1 }, f.expected, f.current, 0)).toBe(null);
});
