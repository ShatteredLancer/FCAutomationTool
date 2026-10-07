import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/streamlined-83-upgrade.json';
import { normalizeStreamlinedChallenge, normalizeStreamlinedItem, streamlinedProgress, streamlinedPlanFingerprint } from '../../src/streamlined/contract.js';

describe('Streamlined contract', () => {
  it('normalizes the observed 83+ challenge without inventing limits', () => {
    const challenge = normalizeStreamlinedChallenge({ ...fixture.challenge, context: fixture.context });
    expect(challenge).toMatchObject({ id: 61, setId: 31, targetScore: 2500, submittedScore: 0, selectionLimit: 30, isOneClick: true });
    expect(challenge.repeats).toBeNull();
  });
  it('keeps malformed or traditional data blocked', () => {
    expect(() => normalizeStreamlinedChallenge({ ...fixture.challenge, context: fixture.context, isOneClick: false })).toThrow('FC27_STREAMLINED_CONTRACT_UNVERIFIED');
    expect(normalizeStreamlinedItem({ id: 1, definitionId: 2, sbsScore: '20' })).toMatchObject({ points: null, scoreVerified: false });
  });
  it('separates submitted, added and remaining score', () => {
    expect(streamlinedProgress({ targetScore: 2500, submittedScore: 400 }, 2100)).toMatchObject({ total: 2500, remaining: 0, reached: true });
  });
  it('fingerprint changes when exact item identity changes', () => {
    const challenge = normalizeStreamlinedChallenge({ ...fixture.challenge, context: fixture.context });
    const items = fixture.items.map(normalizeStreamlinedItem);
    const changed = fixture.items.map((x, i) => normalizeStreamlinedItem(i === 0 ? { ...x, id: 9999 } : x));
    const a = streamlinedPlanFingerprint({ context: fixture.context, challenge, items, batches: [items] });
    const b = streamlinedPlanFingerprint({ context: fixture.context, challenge, items: changed, batches: [changed] });
    expect(a).not.toBe(b);
  });
});
