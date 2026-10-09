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
  it('uses total material value by default while preserving purchase-only and fewest-card objectives', () => {
    const target = normalizeStreamlinedChallenge({ ...fixture.challenge, context: fixture.context, scoreRequirement: 100 });
    const inventory = [safeItem({ points: 100, price: 30000 })];
    const market = [safeItem({ source: 'market', definitionId: 901, points: 100, price: 8000,
      quote: { definitionId: 901, source: 'futgg', price: 8000, fetchedAt: 1, expiresAt: 1000 } })];
    const value = { challenge: target, inventory, market, policy, eligibility: eligible, quoteAt: 10 };
    expect(planStreamlined(value)).toMatchObject({ purchaseCost: 8000, materialValue: 0 });
    expect(planStreamlined({ ...value, objective: 'lowest-coins' })).toMatchObject({ purchaseCost: 0, materialValue: 30000 });
    expect(planStreamlined({ ...value, objective: 'fewest-cards' })).toMatchObject({ purchaseCost: 0, materialValue: 30000 });
    expect(planStreamlined({ ...value, inventory: [safeItem({ points: 100, price: null })] }))
      .toMatchObject({ purchaseCost: 8000, materialValue: 0, unknownValueCount: 0 });
  });
  it('keeps protected and unknown eligibility items out of the plan', () => {
    const result = filterStreamlinedItems([...items, { ...items[0], id: 999, key: 'item:999', locked: true }], { eligibility: eligible, policy: { ...policy, protectFsuLockedPlayers: true } });
    expect(result.status).toBe('observed');
    expect(result.excluded.locked).toBe(1);
  });
  it('uses compliant tradeable inventory when FSU Only Untradeable is disabled', () => {
    const tradeable = safeItem({ id: 800, definitionId: 1800, points: 100, tradeable: true });
    const result = filterStreamlinedItems([tradeable], { eligibility: eligible,
      policy: { ...policy, onlyUntradeable: false } });
    expect(result.items).toHaveLength(1);
    expect(result.excluded.untradeable).toBeUndefined();
    expect(filterStreamlinedItems([tradeable], { eligibility: eligible, policy }).excluded.untradeable).toBe(1);
  });
  it('can choose an allowed Club/Storage card instead of buying the same score', () => {
    const inventory = [safeItem({ id: 801, definitionId: 1801, points: 100, price: 1200, tradeable: true, pile: 'club' })];
    const market = [safeItem({ source: 'market', definitionId: 1802, points: 100, price: 2000,
      quote: { source: 'futgg', definitionId: 1802, price: 2000, fetchedAt: 1, expiresAt: 1000 } })];
    const result = planStreamlined({ challenge: normalizeStreamlinedChallenge({ ...fixture.challenge,
      context: fixture.context, scoreRequirement: 100 }), inventory, market, eligibility: eligible,
      policy: { ...policy, onlyUntradeable: false }, quoteAt: 10 });
    expect(result).toMatchObject({ purchaseCost: 0, materialValue: 1200 });
    expect(result.items[0].source).toBe('inventory');
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
