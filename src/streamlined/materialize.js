import { integer, same, fail, deepFreeze } from './contract.js';
import { assertStreamlinedPlan } from './plan.js';

// Convert only confirmed purchase receipts into the exact inventory entities
// referenced by a plan. A definition ID alone is never enough: each receipt
// must carry a stable EA item ID and the planned definition/version.
export function materializeStreamlinedPurchases(plan, receipts = [], approval = null) {
  assertStreamlinedPlan(plan);
  if (!Array.isArray(receipts)) fail('PURCHASE_PLAN_INVALID');
  const pending = plan.items.filter(item => item.source === 'market');
  if (approval?.approved !== true || approval.planFingerprint !== plan.fingerprint || !same(approval.context, plan.context)
      || !Array.isArray(approval.items) || approval.items.length !== pending.length
      || new Set(approval.items.map(i => i?.key)).size !== pending.length
      || approval.items.some(i => !pending.some(p => p.key === i.key && p.definitionId === i.definitionId)
        || !integer(i.cap, 150, 15000000))) fail('PURCHASE_APPROVAL_REQUIRED');
  const approvedCaps = new Map(approval.items.map(i => [i.key, i.cap]));
  if (receipts.length !== pending.length || new Set(receipts.map(r => r?.itemId)).size !== receipts.length) fail('PURCHASE_RECEIPTS_INCOMPLETE');
  const byKey = new Map(pending.map(item => [item.key, item]));
  const replacements = receipts.map(receipt => {
    if (!integer(receipt?.itemId, 1) || !integer(receipt?.definitionId, 1) || !integer(receipt?.points, 1)) fail('PURCHASE_RECEIPT_IDENTITY_UNKNOWN');
    const planned = byKey.get(receipt.plannedKey);
    if (!planned || receipt.definitionId !== planned.definitionId || receipt.points !== planned.points || receipt.confirmed !== true
        || !same(receipt.context, plan.context) || receipt.planFingerprint !== plan.fingerprint
        || !integer(receipt.actualPrice, 150, 15000000) || !integer(receipt.approvedCap, 150, 15000000)
        || receipt.approvedCap !== approvedCaps.get(planned.key) || receipt.actualPrice > approvedCaps.get(planned.key)
        || typeof receipt.receiptId !== 'string' || !receipt.receiptId
        || receipt.pile !== 'club' && receipt.pile !== 'storage') fail('PURCHASE_RECEIPT_MISMATCH');
    byKey.delete(receipt.plannedKey);
    return { from: planned.key, to: { ...planned, source: 'inventory', id: receipt.itemId,
      key: `item:${receipt.itemId}`, pile: receipt.pile, price: planned.price,
      // Purchase evidence is not a fresh safety/qualification check. A native
      // adapter must project this exact entity again before contribution.
      concept: null, tradeable: null, activeTrade: null, limitedUse: null, loans: null,
      actualPurchasePrice: receipt.actualPrice, receiptId: receipt.receiptId, requiresFreshValidation: true,
      quote: planned.quote, purchaseConfirmed: true } };
  });
  if (byKey.size || new Set(receipts.map(r => r.receiptId)).size !== receipts.length) fail('PURCHASE_RECEIPTS_INCOMPLETE');
  const items = plan.items.map(item => replacements.find(row => row.from === item.key)?.to ?? item);
  if (new Set(items.map(item => item.key)).size !== items.length || items.some(item => item.source === 'market')) fail('PURCHASE_REPLACEMENT_INCOMPLETE');
  return deepFreeze({ schema: 1, planFingerprint: plan.fingerprint, items, replacements,
    spent: receipts.reduce((sum, r) => sum + r.actualPrice, 0), contributionReady: false });
}
