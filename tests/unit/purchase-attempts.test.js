import { expect, it } from 'vitest';
import { createPurchasePriceApproval, purchaseApprovedPrice } from '../../src/fc27/purchase-price-approval.js';
import { validatePurchaseAttempts, beginPurchaseAttempt, finishPurchaseAttempt, purchaseRetryKey, applyPurchaseRetry,
  recordPurchaseSearch, freezePurchaseSearchCap } from '../../src/fc27/purchase-attempts.js';
import { priceTiers } from '../fixtures/enhancer-listing-price-reference.js';

function fixture(limit = 3) {
  const references = Object.fromEntries([10,11].map(definitionId => [definitionId, { definitionId, season: '27', platform: 'pc',
    quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, { schema: 2, definitionId, season: '27', platform: 'pc',
      source, price: 200, fetchedAt: 900, expiresAt: 300000, sourceUpdatedAt: null, error: null }])) }]));
  const policy = { source: 'futgg', premiumMode: 'fixed', premium: 0, purchaseAttempts: limit };
  const record = { scope: 'account', operationId: 'one', entries: [10,11].map(definitionId => ({ definitionId, state: 'waiting' })),
    priceApproval: createPurchasePriceApproval({ scope: 'account', definitionIds: [10,11], references, policy, season: '27', platform: 'pc', now: 1000 }) };
  const exhaust = () => { for (const id of [10,11]) while (beginPurchaseAttempt(record, id)) finishPurchaseAttempt(record, id, { reason: 'FC27_BUY_NO_LISTING' }); };
  const retry = () => ({ operationId: 'one', key: purchaseRetryKey(record), items: [{ definitionId: 10, maxBuy: 300 }], references, policy });
  return { record, exhaust, retry, constraints: { priceTiers, balance: 1000, remainingBudget: 1000, absoluteCap: null } };
}
it.each([1,2,3,7])('persists an exact %i-attempt allowance including the first and retains history on retry', limit => {
  const f = fixture(limit); f.exhaust();
  expect(f.record.attempts[10]).toMatchObject({ used: limit, total: limit, failed: true });
  const defaults = structuredClone(f.record.priceApproval);
  applyPurchaseRetry(f.record, f.retry(), f.constraints, 1001);
  expect(f.record.attempts[10]).toMatchObject({ used: 0, total: limit, round: 2, failed: false });
  expect(f.record.attempts[11]).toMatchObject({ used: limit, round: 1, failed: true });
  expect(f.record.priceApproval).toEqual(defaults);
  expect(purchaseApprovedPrice(f.record.priceOverrides[10], 10).maxBuy).toBe(300);
  validatePurchaseAttempts(JSON.parse(JSON.stringify(f.record)));
});
it.each([['non-tier', { maxBuy: 275 }], ['zero', { maxBuy: 0 }], ['foreign', { definitionId: 99, maxBuy: 300 }]])('rejects %s retry without partially rewriting authority', (_label, edit) => {
  const f = fixture(); f.exhaust(); const old = structuredClone(f.record), retry = f.retry(); Object.assign(retry.items[0], edit);
  expect(() => applyPurchaseRetry(f.record, retry, f.constraints, 1001)).toThrow(); expect(f.record).toEqual(old);
});
it.each(['balance', 'remainingBudget', 'absoluteCap'])('rejects amounts above %s before a new attempt', field => {
  const f = fixture(); f.exhaust(); const old = structuredClone(f.record);
  expect(() => applyPurchaseRetry(f.record, f.retry(), { ...f.constraints, [field]: 200 }, 1001)).toThrow('FC27_BUY_RETRY_CAP_INVALID');
  expect(f.record).toEqual(old);
});
it('rejects the aggregate budget even when each selected cap fits', () => {
  const f = fixture(); f.exhaust(); const retry = f.retry(); retry.items.push({ definitionId: 11, maxBuy: 300 });
  expect(() => applyPurchaseRetry(f.record, retry, { ...f.constraints, remainingBudget: 500 }, 1001)).toThrow('FC27_BUY_RETRY_BUDGET_EXCEEDED');
  expect(f.record.priceOverrides).toBeUndefined();
});
it.each(['club', 'buy-pending', 'bought', 'move-pending', 'move-rejected'])('never grants rebuy for a %s receipt', state => {
  const f = fixture(); f.exhaust(); f.record.entries[0].state = state;
  expect(() => applyPurchaseRetry(f.record, f.retry(), f.constraints, 1001)).toThrow('FC27_BUY_RETRY_CHANGED');
});
it('rejects expired/missing selected quotes and old retry buttons', () => {
  const f = fixture(); f.exhaust(); const retry = f.retry();
  expect(() => applyPurchaseRetry(f.record, retry, f.constraints, 400000)).toThrow('FC27_BUY_REFERENCE_PRICE_EXPIRED');
  retry.references[10].quotes.futgg.price = null;
  expect(() => applyPurchaseRetry(f.record, retry, f.constraints, 1001)).toThrow('FC27_BUY_REFERENCE_PRICE_UNAVAILABLE');
  retry.references[10].quotes.futgg.price = 200;
  applyPurchaseRetry(f.record, retry, f.constraints, 1001);
  expect(() => applyPurchaseRetry(f.record, retry, f.constraints, 1001)).toThrow('FC27_BUY_RETRY_CHANGED');
});
it.each([null, [], 3, 'bad'])('rejects malformed attempt/override maps: %j', value => {
  const f = fixture();
  expect(() => validatePurchaseAttempts({ ...f.record, attempts: value })).toThrow('FC27_BUY_ATTEMPTS_INVALID');
  expect(() => validatePurchaseAttempts({ ...f.record, priceOverrides: value })).toThrow('FC27_BUY_ATTEMPTS_INVALID');
});
it('tracks inner queries separately and only an explicit retry can replace a prior lower cap', () => {
  const f = fixture(); beginPurchaseAttempt(f.record, 10);
  recordPurchaseSearch(f.record, 10); recordPurchaseSearch(f.record, 10);
  expect(f.record.attempts[10]).toMatchObject({ used: 1, queries: 2 });
  expect(freezePurchaseSearchCap(f.record, 10, 150)).toBe(150);
  expect(freezePurchaseSearchCap(f.record, 10, 200)).toBe(150);
  f.exhaust(); applyPurchaseRetry(f.record, f.retry(), f.constraints, 1001);
  expect(freezePurchaseSearchCap(f.record, 10, 300)).toBe(300);
  expect(f.record.attempts[10]).toMatchObject({ used: 0, queries: 2, round: 2 });
});
