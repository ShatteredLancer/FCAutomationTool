import { integer, fail } from './contract.js';

export function scoreStreamlinedItems(items = []) {
  if (!Array.isArray(items) || items.some(item => !integer(item?.points, 1))) fail('SCORE_UNKNOWN');
  const total = items.reduce((sum, item) => sum + item.points, 0);
  if (!integer(total)) fail('SCORE_UNKNOWN');
  return { status: 'observed', total, count: items.length };
}

export function streamlinedResourceCost(plan) {
  return unknownValue(plan) > 0 || plan.materialValue == null ? Infinity : plan.purchaseCost + plan.materialValue;
}

const unknownValue = plan => plan.unknownValue ?? plan.unknownValueCount ?? Number(plan.materialValue == null);

export function compareStreamlinedPlans(a, b, objective = 'lowest-value') {
  // Balanced's private weights are unknown and are not invented here.
  if (objective === 'fewest-cards' && a.count !== b.count) return a.count - b.count;
  if (objective === 'lowest-value') {
    const cost = streamlinedResourceCost(a) - streamlinedResourceCost(b);
    if (cost) return cost;
  }
  return a.purchaseCost - b.purchaseCost || unknownValue(a) - unknownValue(b) || (a.materialValue ?? 0) - (b.materialValue ?? 0)
    || a.score - b.score || a.count - b.count || (a.storagePenalty ?? 0) - (b.storagePenalty ?? 0);
}
