import { expect, it } from 'vitest';
import { createPurchasePriceApproval, validatePurchasePriceApproval, purchaseApprovedPrice } from '../../src/fc27/purchase-price-approval.js';
export function approvalFixture(ids = [10, 11], price = 200, now = 1000) {
  const policy = { source: 'futgg', premiumMode: 'fixed', premium: 0, purchaseAttempts: 3 };
  const references = Object.fromEntries(ids.map(definitionId => [definitionId, { definitionId, season: '27', platform: 'pc',
    quotes: Object.fromEntries(['futgg', 'futbin'].map(source => [source, { schema: 2, source, season: '27', platform: 'pc',
      definitionId, price: source === 'futgg' ? price : 250, fetchedAt: 900, sourceUpdatedAt: null, expiresAt: 300900, error: null }])) }]));
  return { scope: 'account', definitionIds: ids, references, policy, season: '27', platform: 'pc', now };
}
it('freezes exact versions, both quote provenances and original per-card caps', () => {
  const input = approvalFixture(); const approval = createPurchasePriceApproval(input);
  input.references[10].quotes.futgg.price = 600;
  expect(purchaseApprovedPrice(approval, 10)).toMatchObject({ estimate: 200, maxBuy: 200 });
  expect(approval.rows[0].quotes.futbin.price).toBe(250);
  expect(validatePurchasePriceApproval(JSON.parse(JSON.stringify(approval)), 'account', [10,11])).toBeUndefined();
  expect(() => validatePurchasePriceApproval(approval, 'another-account', [10,11])).toThrow('FC27_BUY_PRICE_APPROVAL_INVALID');
  expect(() => purchaseApprovedPrice(approval, 99)).toThrow('FC27_BUY_PRICE_APPROVAL_REQUIRED');
});
it('records missing or expired selected sources without substituting another source or EA', () => {
  const input = approvalFixture(); input.references[10].quotes.futgg.price = null;
  input.references[11].quotes.futgg.expiresAt = 999;
  const approval = createPurchasePriceApproval(input);
  expect(purchaseApprovedPrice(approval, 10)).toMatchObject({ estimate: null, maxBuy: null, reason: 'FC27_BUY_REFERENCE_PRICE_UNAVAILABLE' });
  expect(purchaseApprovedPrice(approval, 11)).toMatchObject({ maxBuy: null, reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED' });
});

it.each([['futbinEnabled'], ['futbinRefresh'], ['quoteValidityMinutes'], ['futbinEnabled', 'futbinRefresh', 'quoteValidityMinutes']])('validates legacy approvals missing %j without rewriting their frozen source or caps', (...fields) => {
  const approval = createPurchasePriceApproval(approvalFixture());
  for (const field of fields) delete approval.policy[field];
  const before = structuredClone(approval);
  expect(() => validatePurchasePriceApproval(approval, 'account', [10,11])).not.toThrow();
  expect(approval).toEqual(before);
  approval.rows[0].maxBuy = 900;
  expect(() => validatePurchasePriceApproval(approval, 'account', [10,11])).toThrow('FC27_BUY_PRICE_APPROVAL_INVALID');
});
it('rejects mismatched quote identity, forged caps and duplicate/foreign versions', () => {
  for (const field of ['definitionId', 'platform', 'season', 'source']) {
    const input = approvalFixture(); input.references[10].quotes.futgg[field] = 'wrong';
    expect(() => createPurchasePriceApproval(input)).toThrow('FC27_BUY_PRICE_APPROVAL_INVALID');
  }
  const approval = createPurchasePriceApproval(approvalFixture()); approval.rows[0].maxBuy = 900;
  expect(() => validatePurchasePriceApproval(approval, 'account', [10,11])).toThrow('FC27_BUY_PRICE_APPROVAL_INVALID');
  expect(() => createPurchasePriceApproval({ ...approvalFixture(), definitionIds: [10,10] })).toThrow();
});
it('keeps caps recoverable after expiry without interpreting persisted quotes as freshly read', () => {
  const approval = createPurchasePriceApproval(approvalFixture());
  expect(purchaseApprovedPrice(approval, 10, { now: 400000 })).toMatchObject({ maxBuy: null, reason: 'FC27_BUY_REFERENCE_PRICE_EXPIRED', approvedCap: 200 });
  expect(purchaseApprovedPrice(approval, 10, { now: 400000, fresh: approvalFixture([10], 600, 400000).references[10] }).maxBuy).toBeNull();
  const fresh = approvalFixture([10], 600).references[10];
  fresh.quotes.futgg.fetchedAt = 399900; fresh.quotes.futgg.expiresAt = 700000;
  expect(purchaseApprovedPrice(approval, 10, { now: 400000, fresh })).toMatchObject({ maxBuy: 200, estimate: 600, approvedCap: 200 });
  fresh.quotes.futgg.price = 150;
  expect(purchaseApprovedPrice(approval, 10, { now: 400000, fresh }).maxBuy).toBe(150);
});
it('allows an explicit retry override above the account default while requiring a fresh quote', () => {
  const input = approvalFixture([10], 200);
  const approval = createPurchasePriceApproval({ ...input, overrides: { 10: 300 }, now: 1000 });
  expect(purchaseApprovedPrice(approval, 10)).toMatchObject({ estimate: 200, maxBuy: 300 });
  expect(purchaseApprovedPrice(approval, 10, { now: 400000 }).maxBuy).toBeNull();
});
