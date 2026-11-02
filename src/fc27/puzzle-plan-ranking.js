// Pure, deterministic ordering for detached Puzzle plans.  Search routes may
// be truncated, so every route must preserve the best incumbent with the same
// objective and stable tie-breaks.
const finite = value => Number.isFinite(value) ? value : Infinity;
const count = (plan, predicate) => [
  ...(Array.isArray(plan?.selectedOwned) ? plan.selectedOwned : []),
  ...(Array.isArray(plan?.purchases) ? plan.purchases : []),
].filter(item => predicate(item?.rating)).length;
const qualityVector = plan => [
  count(plan, rating => Number.isInteger(rating) && rating >= 75),
  count(plan, rating => Number.isInteger(rating) && rating >= 65 && rating < 75),
  count(plan, rating => Number.isInteger(rating) && rating < 65),
];
const idVector = plan => [...(
  Array.isArray(plan?.selectedOwned) ? plan.selectedOwned : []
), ...(
  Array.isArray(plan?.purchases) ? plan.purchases : []
)].map(item => Number.isSafeInteger(item?.definitionId) ? item.definitionId
  : Number.isSafeInteger(item?.id) ? item.id : 0).sort((a, b) => a - b);
const lex = (left, right) => {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0, b = right[index] ?? 0;
    if (a !== b) return a - b;
  }
  return 0;
};

export function comparePuzzlePlans(a, b, objective = 'additional-coins') {
  if (a === b) return 0;
  const aAdded = finite(a?.estimatedCost ?? a?.cost);
  const bAdded = finite(b?.estimatedCost ?? b?.cost);
  const aMaterial = finite(a?.materialValue ?? (objective === 'material-value' ? a?.cost : null));
  const bMaterial = finite(b?.materialValue ?? (objective === 'material-value' ? b?.cost : null));
  const aPurchases = Number.isSafeInteger(a?.purchaseCount) ? a.purchaseCount
    : Array.isArray(a?.purchases) ? a.purchases.length : Infinity;
  const bPurchases = Number.isSafeInteger(b?.purchaseCount) ? b.purchaseCount
    : Array.isArray(b?.purchases) ? b.purchases.length : Infinity;
  const primary = objective === 'material-value' ? aMaterial - bMaterial : aAdded - bAdded;
  if (primary) return primary;
  const secondary = objective === 'material-value' ? aAdded - bAdded : aPurchases - bPurchases;
  if (secondary) return secondary;
  if (objective === 'material-value' && aPurchases !== bPurchases) return aPurchases - bPurchases;
  const aInventory = finite(a?.inventoryValue);
  const bInventory = finite(b?.inventoryValue);
  if (aInventory !== bInventory) return aInventory - bInventory;
  const quality = lex(qualityVector(a), qualityVector(b));
  // Cash-first planning has no mandate to consume lower-tier material when
  // cash spend ties. Retain higher-tier material as a conservative tie-break;
  // material-value mode explicitly optimizes in the other direction.
  if (quality) return objective === 'material-value' ? quality : -quality;
  return lex(idVector(a), idVector(b));
}

export function sortPuzzlePlans(plans, objective = 'additional-coins') {
  return [...plans].sort((a, b) => comparePuzzlePlans(a, b, objective));
}
