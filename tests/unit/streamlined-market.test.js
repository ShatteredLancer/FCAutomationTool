import { expect, it } from 'vitest';
import { expandStreamlinedMarket, planStreamlinedPurchaseWaves } from '../../src/streamlined/market.js';
import { testPlan, safeItem, challenge } from '../helpers/streamlined.js';

const version = { ...safeItem(), availableCopies: 3, price: 200,
  quote: { source: 'futgg', definitionId: 2, price: 200, fetchedAt: 0, expiresAt: 1000 } };
it('expands only verified scores into distinct bounded purchase slots', () => {
  const result = expandStreamlinedMarket({ versions: [version], remainingScore: 60 });
  expect(result.market.map(i => i.key)).toEqual(['market:2:0', 'market:2:1', 'market:2:2']);
  expect(expandStreamlinedMarket({ versions: [version], remainingScore: 60, maxCopies: 1 }).truncated).toBe(true);
  expect(expandStreamlinedMarket({ versions: [{ ...version, scoreVerified: false }], remainingScore: 60 })).toMatchObject({ market: [], unknown: 1 });
});
it('routes repeated purchases as separate contribution waves without assuming duplicate storage', () => {
  const { market } = expandStreamlinedMarket({ versions: [version], remainingScore: 60 });
  const plan = testPlan({ challenge: challenge({ scoreRequirement: 60, selectionLimit: 1 }), inventory: [], market, quoteAt: 20 });
  const route = { verified: true, destination: 'club', maxCopiesPerDefinition: 1, freeSlots: 1, clubItems: [] };
  const result = planStreamlinedPurchaseWaves(plan, route);
  expect(result.status).toBe('planned');
  expect(result.waves.map(w => w.afterConfirmedBatch)).toEqual([null, 0, 1]);
  expect(result.waves.every(w => w.purchases.length === 1 && w.freeBeforePurchase === 1)).toBe(true);
  expect(planStreamlinedPurchaseWaves(plan, { ...route, clubItems: [{ id: 555, definitionId: 2 }] }).reason).toContain('DUPLICATE_ROUTE');
  expect(planStreamlinedPurchaseWaves(plan, { ...route, verified: false }).reason).toContain('ROUTE_UNVERIFIED');
});
it('rejects an inexpensive combination that cannot be staged in a single batch', () => {
  const { market } = expandStreamlinedMarket({ versions: [version], remainingScore: 60 });
  const plan = testPlan({ challenge: challenge({ scoreRequirement: 60, selectionLimit: 30 }), inventory: [], market, quoteAt: 20 });
  const route = { verified: true, destination: 'club', maxCopiesPerDefinition: 1, freeSlots: 30, clubItems: [] };
  expect(planStreamlinedPurchaseWaves(plan, route).reason).toContain('DUPLICATE_ROUTE');
  expect(planStreamlinedPurchaseWaves(plan, { ...route, freeSlots: 1 }).reason).toContain('CAPACITY_SHORTAGE');
});
