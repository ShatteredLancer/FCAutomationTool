import { validateFc27PuzzleConceptDraft } from './puzzle-concept-draft.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new Error('FC27_BUY_MATERIAL_UNVERIFIED'); };

// The only tradable exception is an exact, confirmed purchase for this draft.
// Never modify Only Untradeable or admit unrelated tradable Club players.
export function materializePurchasedPuzzleDraft(base, current, entries, fresh) {
  if (!Array.isArray(entries) || !Array.isArray(fresh) || entries.length > 11
      || new Set(entries.map(e => e.itemId)).size !== entries.length
      || new Set(entries.map(e => e.definitionId)).size !== entries.length) fail();
  const original = base.owned.map(ref => fresh.find(item => item.id === ref.id && item.definitionId === ref.definitionId));
  if (original.some(item => !item)
      || validateFc27PuzzleConceptDraft(base, current, original).status !== 'verified') fail();
  const acquired = entries.map(entry => {
    const concept = base.slots[entry.slot];
    const expected = base.purchases.find(item => item.definitionId === entry.definitionId);
    const item = fresh.find(item => item.id === entry.itemId && item.definitionId === entry.definitionId);
    if (entry.state !== 'club' || concept?.kind !== 'concept' || concept.definitionId !== entry.definitionId
        || !expected || !item || item.pile !== 'club' || item.state !== 'free' || item.tradeable !== true
        || item.concept !== false || item.evolution !== false || item.special !== false || item.cosmetic !== false
        || item.academyEnrolled !== false || item.activeTrade !== false || item.limitedUse !== false
        || item.loans !== -1 || item.protected !== false
        || current.policy.protectFsuLockedPlayers && item.locked !== false
        || current.policy.protectActiveSquad && item.activeSquad !== false
        || ['rating', 'rarity', 'nationId', 'leagueId', 'teamId', 'positions', 'groups'].some(key => !same(item[key], expected[key]))) fail();
    return { ...item, slot: entry.slot };
  });
  if (fresh.length !== original.length + acquired.length) fail();
  return { ...base, slots: base.slots.map(slot => {
    const item = slot && acquired.find(item => item.slot === slot.slot);
    return item ? { kind: 'owned', slot: item.slot, id: item.id, definitionId: item.definitionId, rating: item.rating, pile: 'club' } : slot;
  }), owned: [...original, ...acquired], purchases: base.purchases.filter(item => !acquired.some(card => card.definitionId === item.definitionId)),
  purchaseCount: base.purchaseCount - acquired.length };
}
