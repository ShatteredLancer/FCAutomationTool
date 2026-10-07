import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/streamlined-83-upgrade.json';
import { normalizeStreamlinedChallenge } from '../../src/streamlined/contract.js';
import { safeItem } from '../helpers/streamlined.js';
import { createStreamlinedEligibility, filterStreamlinedItems } from '../../src/streamlined/eligibility.js';
import { planStreamlined, planStreamlinedSteps } from '../../src/streamlined/planner.js';

const challenge = normalizeStreamlinedChallenge({ ...fixture.challenge, context: fixture.context });
const items = fixture.items.map(safeItem);
const eligible = createStreamlinedEligibility({ rules: [], matcher: () => true });
const policy = { maxRating: 90, goldRange: [75, 99], excludedLeagueIds: [], onlyUntradeable: true,
  protectFsuLockedPlayers: false, protectActiveSquad: false, storageFirst: false };

describe('Streamlined local planner', () => {
  it('keeps protected and unknown eligibility items out of the plan', () => {
    const result = filterStreamlinedItems([...items, { ...items[0], id: 999, key: 'item:999', locked: true }], { eligibility: eligible, policy: { ...policy, protectFsuLockedPlayers: true } });
    expect(result.status).toBe('observed');
    expect(result.excluded.locked).toBe(1);
  });
  it('uses inventory before market and separates market purchase cost', () => {
    const result = planStreamlined({ challenge, inventory: items.slice(0, 4), market: [items[4]], eligibility: eligible, policy, maxNodes: 1000, maxStates: 1000, maxMs: 1000, quoteAt: 200 });
    expect(result.status).toBe('ready');
    expect(result.score).toBeGreaterThanOrEqual(2500);
    expect(result.purchaseCost).toBe(3500);
    expect(result.materialValue).toBe(2200);
    expect(result.batches).toHaveLength(1);
  });
  it('splits a low-score target into multiple bounded contribution batches', () => {
    const low = normalizeStreamlinedChallenge({ ...fixture.challenge, context: fixture.context, scoreRequirement: 2500, selectionLimit: 30 });
    const copper = Array.from({ length: 130 }, (_, index) => safeItem({ id: 2000 + index, definitionId: 7000 + index }));
    const result = planStreamlined({ challenge: low, inventory: copper, eligibility: eligible, policy, maxNodes: 100, maxStates: 1000, maxMs: 1000, objective: 'lowest-coins', quoteAt: 200 });
    expect(result.status).toBe('ready');
    expect(result.batches.map(batch => batch.length)).toEqual([30, 30, 30, 30, 5]);
    expect(result.score).toBe(2500);
  });
  it('reports a bounded partial result instead of claiming no solution', () => {
    const iterator = planStreamlinedSteps({ challenge, inventory: items.slice(0, 2), eligibility: eligible, policy, maxNodes: 100, maxStates: 1000, maxMs: 1000, quoteAt: 200 });
    let next = iterator.next(); while (!next.done) next = iterator.next();
    expect(next.value.status).toBe('partial');
  });
});
