import { assertStreamlinedPlan } from './plan.js';
import { validateStreamlinedPurchase, streamlinedPurchaseNeedsRecovery } from './purchase-journal.js';
import { integer, same, fail } from './contract.js';

// Isolation is not settlement. Another target's unknown transactions stay
// durable; only disjoint Club/Storage contributions spend no coins or reserved
// entities. Call again under the shared write lock before each native dispatch.
export function assertStreamlinedRecoveryIsolation(plan, refs, purchase) {
  assertStreamlinedPlan(plan);
  if (!purchase) return true;
  validateStreamlinedPurchase(purchase, plan.context);
  if (!streamlinedPurchaseNeedsRecovery(purchase)) return true;
  if (purchase.challenge.setId === plan.challenge.setId && purchase.challenge.id === plan.challenge.id
      || plan.execution?.purchaseScope || plan.route && (!Array.isArray(plan.route.groups) || plan.route.groups.some(group => group.source === 'market'))
      || plan.items.some(item => item.source !== 'inventory' || !['club', 'storage'].includes(item.pile) || item.purchaseReceipt)) {
    fail('FOREIGN_PURCHASE_SCOPE_BLOCKED');
  }
  const planned = new Map(plan.items.map(item => [item.id, item]));
  if (!Array.isArray(refs) || !refs.length || refs.length > 20000 || refs.some(ref => {
    const item = planned.get(ref.id);
    return !item || item.definitionId !== ref.definitionId || item.points !== ref.points || item.pile !== ref.pile || ref.executionPile;
  })) fail('PLAN_CHANGED');
  const reserved = new Set();
  for (const entry of purchase.entries) {
    if (!['ready', 'buy-pending', 'bought', 'move-pending', 'club'].includes(entry.state)) continue;
    if (!integer(entry.itemId, 1)) fail('FOREIGN_PURCHASE_SCOPE_UNVERIFIED');
    reserved.add(entry.itemId);
  }
  if (purchase.contribution) {
    const { batchPlan, material } = purchase.contribution;
    try { assertStreamlinedPlan(batchPlan); } catch { fail('FOREIGN_PURCHASE_SCOPE_UNVERIFIED'); }
    if (!same(batchPlan.context, purchase.context) || batchPlan.challenge.setId !== purchase.challenge.setId
        || batchPlan.challenge.id !== purchase.challenge.id || batchPlan.challenge.targetScore !== purchase.challenge.targetScore
        || batchPlan.challenge.submittedScore !== purchase.submittedScore
        || !same(batchPlan.items, material.map(row => row.item))) fail('FOREIGN_PURCHASE_SCOPE_UNVERIFIED');
    for (const item of batchPlan.items) reserved.add(item.id);
  }
  if (refs.some(ref => reserved.has(ref.id))) fail('FOREIGN_PURCHASE_MATERIAL_RESERVED');
  return true;
}
