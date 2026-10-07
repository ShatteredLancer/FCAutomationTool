import { normalizeStreamlinedItem, integer, fail, deepFreeze } from './contract.js';
import { assertStreamlinedPlan } from './plan.js';

// Bounded quantities are explicit inputs from a reviewed provider. The local
// planner does not infer SBC points from OVR, Gallery points or a price table.
export function expandStreamlinedMarket({ versions, remainingScore, maxCopies = 1000, maxCandidates = 20000 } = {}) {
  if (!Array.isArray(versions) || !integer(remainingScore, 1, 1e9) || !integer(maxCopies, 1, 1000)
      || !integer(maxCandidates, 1, 20000) || versions.length > 20000) fail('MARKET_INPUT_INVALID');
  const market = [], seen = new Set(); let truncated = false, unknown = 0;
  for (const version of versions) {
    if (!integer(version?.definitionId, 1) || seen.has(version.definitionId)) fail('IDENTITY_CONFLICT');
    seen.add(version.definitionId);
    if (!integer(version.points, 1, 1e9) || version.scoreVerified !== true || !integer(version.availableCopies, 1, 1000)) { unknown++; continue; }
    const needed = Math.ceil(remainingScore / version.points);
    const count = Math.min(needed, maxCopies, version.availableCopies, maxCandidates - market.length);
    if (count < Math.min(needed, version.availableCopies)) truncated = true;
    for (let copy = 0; copy < count; copy++) market.push(normalizeStreamlinedItem({ ...version, source: 'market', copy }));
  }
  return deepFreeze({ market, truncated, unknown, poolComplete: false });
}

// Pure route simulation. Until a native adapter supplies explicit pile and
// capacity evidence this cannot authorize a purchase. Duplicate versions are
// never assumed to fit in Club or to be accepted by Storage.
export function planStreamlinedPurchaseWaves(plan, route) {
  assertStreamlinedPlan(plan);
  const blocked = reason => ({ status: 'blocked', reason: `FC27_STREAMLINED_${reason}`, waves: [] });
  if (route?.verified !== true || route.destination !== 'club' || !integer(route.freeSlots, 1, 20000)
      || !integer(route.maxCopiesPerDefinition, 1, 1000) || !Array.isArray(route.clubItems)
      || route.clubItems.some(i => !integer(i?.id, 1) || !integer(i?.definitionId, 1))
      || new Set(route.clubItems.map(i => i.id)).size !== route.clubItems.length) return blocked('PURCHASE_ROUTE_UNVERIFIED');
  const held = new Map(route.clubItems.map(i => [i.id, i.definitionId]));
  let free = route.freeSlots;
  const waves = [];
  for (let index = 0; index < plan.batches.length; index++) {
    const batch = plan.batches[index], purchases = batch.filter(i => i.source === 'market');
    if (purchases.length > free) return blocked('PURCHASE_CAPACITY_SHORTAGE');
    const copies = new Map();
    for (const definitionId of held.values()) copies.set(definitionId, (copies.get(definitionId) ?? 0) + 1);
    for (const item of purchases) {
      const count = (copies.get(item.definitionId) ?? 0) + 1;
      if (count > route.maxCopiesPerDefinition) return blocked('PURCHASE_DUPLICATE_ROUTE_UNVERIFIED');
      copies.set(item.definitionId, count);
    }
    waves.push({ batchIndex: index, afterConfirmedBatch: index ? index - 1 : null,
      purchases: purchases.map(i => ({ key: i.key, definitionId: i.definitionId, estimatedPrice: i.price })),
      contributionKeys: batch.map(i => i.key), freeBeforePurchase: free });
    // Purchased entities enter and leave in this wave, net zero capacity.
    // Only exact pre-existing Club entities in the batch free another slot.
    for (const item of batch.filter(i => i.source === 'inventory' && i.pile === 'club')) {
      if (held.get(item.id) !== item.definitionId) return blocked('PURCHASE_INVENTORY_CHANGED');
      held.delete(item.id); free++;
    }
  }
  return deepFreeze({ status: 'planned', waves, requiresSeparatePurchaseAndContributionApproval: true, liveExecutionEnabled: false });
}
