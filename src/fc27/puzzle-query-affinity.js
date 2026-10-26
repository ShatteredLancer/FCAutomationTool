const quality = rating => rating < 65 ? 1 : rating < 75 ? 2 : 3;
const level = tier => ({ 1: 'bronze', 2: 'silver', 3: 'gold' })[tier];

// Rank only a read-only catalog lane, never require these cards in the squad.
// Chemistry comes from in-position players: a populous nation of midfielders
// is a weak anchor when those formation slots are bricks. Maximum matching
// also prevents a flexible card being counted as several covered positions.
export function planPuzzleNationalityAffinity({ candidates, material, formation, brickIndices, usedQueries = [] }) {
  if (!Array.isArray(formation?.positions) || formation.positions.length !== 11
      || !Array.isArray(brickIndices)) return null;
  const required = material.filter(rule => rule.count > 0).sort((a, b) => b.count - a.count);
  if (required.length < 2) return null;
  const slots = formation.positions.filter((_position, index) => !brickIndices.includes(index));
  const groups = new Map();
  for (const item of candidates) {
    if (!required.some(rule => rule.qualities[0] === quality(item.rating))
        || !item.positions.some(position => slots.includes(position))) continue;
    if (!groups.has(item.nationId)) groups.set(item.nationId, new Map());
    groups.get(item.nationId).set(item.definitionId, item);
  }
  const ranked = [];
  for (const [nation, byId] of groups) {
    const items = [...byId.values()];
    // An unrelated single-quality cluster must not displace the existing
    // league fallback. Both the filler and dominant tier need a real anchor.
    if (!required.every(rule => items.some(item => quality(item.rating) === rule.qualities[0]))) continue;
    const assigned = slots.map(() => -1);
    const augment = (index, visited) => {
      for (let slot = 0; slot < slots.length; slot++) {
        if (visited.has(slot) || !items[index].positions.includes(slots[slot])) continue;
        visited.add(slot);
        if (assigned[slot] === -1 || augment(assigned[slot], visited)) {
          assigned[slot] = index; return true;
        }
      }
      return false;
    };
    items.forEach((_item, index) => augment(index, new Set()));
    ranked.push({ nation, matched: assigned.filter(index => index !== -1).length, count: items.length });
  }
  ranked.sort((a, b) => b.matched - a.matched || b.count - a.count || a.nation - b.nation);
  return ranked.map(({ nation }) => ({ start: 0, count: 20, level: level(required[0].qualities[0]), nation }))
    .find(query => !usedQueries.some(used => JSON.stringify(used) === JSON.stringify(query))) ?? null;
}
