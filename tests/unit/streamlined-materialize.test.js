import { expect, it } from 'vitest';
import { materializeStreamlinedPurchases } from '../../src/streamlined/materialize.js';
import { testPlan, safeItem } from '../helpers/streamlined.js';
const market = (copy = 0) => safeItem({ source: 'market', copy, points: 20, price: 350,
  quote: { source: 'futgg', definitionId: 2, price: 350, fetchedAt: 0, expiresAt: 1000 } });
const receiptFor = (plan, item = plan.items.find(i => i.source === 'market')) => ({ itemId: 999,
  definitionId: item.definitionId, plannedKey: item.key, points: item.points, pile: 'club', confirmed: true,
  actualPrice: 300, approvedCap: 350, receiptId: 'synthetic-receipt', context: plan.context, planFingerprint: plan.fingerprint });
const approvalFor = plan => ({ approved: true, context: plan.context, planFingerprint: plan.fingerprint,
  items: plan.items.filter(i => i.source === 'market').map(i => ({ key: i.key, definitionId: i.definitionId, cap: 350 })) });

it('replaces every market placeholder by an exact confirmed entity', () => {
  const plan = testPlan({ inventory: [safeItem({ points: 20 })], market: [market()], quoteAt: 20 });
  const receipt = receiptFor(plan);
  const result = materializeStreamlinedPurchases(plan, [receipt], approvalFor(plan));
  expect(result.items.every(item => item.source === 'inventory')).toBe(true);
  expect(result.replacements[0].to).toMatchObject({ id: 999, key: 'item:999', purchaseConfirmed: true, price: 350, actualPurchasePrice: 300 });
  expect(result.contributionReady).toBe(false);
});
it('fails closed on missing, duplicate, wrong-version, unconfirmed or wrong-pile receipts', () => {
  const plan = testPlan({ inventory: [], market: [market()], quoteAt: 20 });
  const valid = receiptFor(plan);
  for (const receipt of [{ ...valid, confirmed: false }, { ...valid, definitionId: 3 }, { ...valid, pile: 'transfer' }, { ...valid, itemId: 0 },
    { ...valid, actualPrice: 400 }, { ...valid, context: {} }, { ...valid, planFingerprint: 'other' }]) {
    expect(() => materializeStreamlinedPurchases(plan, [receipt], approvalFor(plan))).toThrow(/^FC27_STREAMLINED_PURCHASE_/);
  }
  expect(() => materializeStreamlinedPurchases(plan, [valid, valid], approvalFor(plan))).toThrow('PURCHASE_RECEIPTS_INCOMPLETE');
  expect(() => materializeStreamlinedPurchases(plan, [valid])).toThrow('PURCHASE_APPROVAL_REQUIRED');
  expect(() => materializeStreamlinedPurchases(plan, [{ ...valid, approvedCap: 600, actualPrice: 600 }], approvalFor(plan))).toThrow('PURCHASE_RECEIPT_MISMATCH');
});
it('binds repeated versions by purchase slot and never reuses a confirmed item', () => {
  const plan = testPlan({ inventory: [], market: [market(0), market(1)], quoteAt: 20 });
  const receipts = plan.items.map((item, i) => ({ ...receiptFor(plan, item), itemId: 1000 + i, receiptId: `synthetic-${i}` }));
  expect(materializeStreamlinedPurchases(plan, receipts, approvalFor(plan)).spent).toBe(600);
  receipts[1].itemId = receipts[0].itemId;
  expect(() => materializeStreamlinedPurchases(plan, receipts, approvalFor(plan))).toThrow('PURCHASE_RECEIPTS_INCOMPLETE');
});
