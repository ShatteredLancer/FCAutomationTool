import { integer, fail } from './contract.js';

export function scoreStreamlinedItems(items = []) {
  if (!Array.isArray(items) || items.some(item => !integer(item?.points, 1))) fail('SCORE_UNKNOWN');
  const total = items.reduce((sum, item) => sum + item.points, 0);
  if (!integer(total)) fail('SCORE_UNKNOWN');
  return { status: 'observed', total, count: items.length };
}

export function compareStreamlinedPlans(a, b, objective = 'lowest-coins') {
  // Balanced's private weights are unknown and are not invented here.
  if (objective === 'fewest-cards' && a.count !== b.count) return a.count - b.count;
  return a.purchaseCost - b.purchaseCost || a.unknownValue - b.unknownValue || a.materialValue - b.materialValue
    || a.score - b.score || a.count - b.count || a.storagePenalty - b.storagePenalty;
}
