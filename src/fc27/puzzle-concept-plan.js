const positive = value => Number.isSafeInteger(value) && value > 0;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

const blocked = reason => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false });

// Convert a joint owned/market preview into the serializable squad contract
// used by the later EA concept-card and purchase adapters. Market entries are
// deliberately concepts, never fake owned item identities.
export function prepareFc27PuzzleConceptPlan({ challenge, plan } = {}) {
  if (!challenge || !plan || plan.status !== 'preview'
      || !positive(challenge.setId) || !positive(challenge.id)
      || plan.setId !== challenge.setId || plan.challengeId !== challenge.id
      || !integer(challenge.slotCount, 1, 11) || !Array.isArray(challenge.brickIndices)
      || challenge.brickIndices.length >= challenge.slotCount
      || new Set(challenge.brickIndices).size !== challenge.brickIndices.length
      || challenge.brickIndices.some(index => !integer(index, 0, challenge.slotCount - 1))) {
    return blocked('FC27_PUZZLE_CONCEPT_INPUT_UNVERIFIED');
  }
  const required = challenge.slotCount - challenge.brickIndices.length;
  if (!Array.isArray(plan.selectedOwned) || !Array.isArray(plan.purchases)
      || [...plan.selectedOwned, ...plan.purchases].some(item => !item || typeof item !== 'object')) {
    return blocked('FC27_PUZZLE_CONCEPT_PLAN_INVALID');
  }
  const owned = plan.selectedOwned;
  const purchases = plan.purchases;
  const entries = [...owned.map(item => ({ ...item, kind: 'owned' })),
    ...purchases.map(item => ({ ...item, kind: 'concept' }))];
  if (entries.length !== required || new Set(entries.map(item => item.slot)).size !== required
      || entries.some(item => !integer(item.slot, 0, challenge.slotCount - 1)
        || challenge.brickIndices.includes(item.slot) || !positive(item.definitionId)
        || !integer(item.rating, 1, 99))
      || new Set(entries.map(item => item.definitionId)).size !== required
      || owned.some(item => !positive(item.id) || item.pile !== 'club' || item.catalogRef !== undefined)
      || new Set(owned.map(item => item.id)).size !== owned.length
      || purchases.some(item => item.id !== undefined || item.pile !== undefined
        || item.catalogRef !== `fc27:${item.definitionId}` || item.quantity !== 1
        || !integer(item.observedBuyNow ?? item.estimatedUnitPrice, 150, 15000000))
      || (plan.purchaseCount ?? purchases.length) !== purchases.length) {
    return blocked('FC27_PUZZLE_CONCEPT_PLAN_INVALID');
  }
  const slots = Array.from({ length: challenge.slotCount }, (_, slot) => {
    const item = entries.find(entry => entry.slot === slot);
    return item ? {
      slot, kind: item.kind, definitionId: item.definitionId, rating: item.rating,
      ...(item.kind === 'owned' ? { id: item.id, pile: item.pile } : {
        catalogRef: item.catalogRef, quantity: item.quantity ?? 1,
        estimatedUnitPrice: item.estimatedUnitPrice ?? null,
        observedBuyNow: item.observedBuyNow ?? null,
      }),
    } : null;
  });
  if (slots.some((item, slot) => !challenge.brickIndices.includes(slot) && !item)) {
    return blocked('FC27_PUZZLE_CONCEPT_PLAN_INVALID');
  }
  return Object.freeze({ status: 'prepared', kind: 'puzzle-concept', schema: 1,
    executable: false, liveExecutionEnabled: false, setId: challenge.setId,
    challengeId: challenge.id, required, purchaseCount: purchases.length,
    estimatedCost: purchases.reduce((sum, item) => sum + (item.observedBuyNow ?? item.estimatedUnitPrice ?? 0), 0),
    slots: Object.freeze(slots.map(item => item && Object.freeze(item))),
    pending: Object.freeze(purchases.length ? ['CONCEPT_SQUAD_DISPLAY', 'EXPLICIT_PURCHASE_APPROVAL',
      'LIVE_AUCTION_RECHECK', 'EXACT_PURCHASE_RECEIPTS', 'FRESH_INVENTORY_REPLAN']
      : ['CONCEPT_SQUAD_DISPLAY']),
  });
}
