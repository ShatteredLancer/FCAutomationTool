// A priced traversal hint only. Never discard candidates or infer native
// feasibility from these ordinary-position costs; the full solver validates.
export function pricedPuzzleGroupStarts({ candidates, rules, formation, brickIndices, costOf, resolveClub }) {
  if (!Array.isArray(formation?.positions) || !Array.isArray(brickIndices)) return [];
  const slots = formation.positions.filter((_position, index) => !brickIndices.includes(index));
  if (!slots.length || slots.length > 11) return [];
  const counts = new Uint8Array(1 << slots.length);
  for (let mask = 1; mask < counts.length; mask++) counts[mask] = counts[mask >>> 1] + (mask & 1);
  const ranked = [];
  for (const rule of rules.filter(rule => rule.kind.startsWith('same-') && rule.mode !== 'max' && rule.value >= 2)) {
    const strategy = { 'same-nation': 'nation', 'same-league': 'league', 'same-club': 'club' }[rule.kind];
    if (!strategy || rule.value > slots.length) continue;
    const groups = new Map();
    for (const card of candidates) {
      const key = strategy === 'club' ? resolveClub?.(card.teamId ?? card.clubId) : card[strategy === 'nation' ? 'nationId' : 'leagueId'];
      if (!Number.isSafeInteger(key) || key < 1) continue;
      if (!groups.has(key)) groups.set(key, new Map());
      const old = groups.get(key).get(card.definitionId);
      if (!old || costOf(card) < costOf(old)) groups.get(key).set(card.definitionId, card);
    }
    for (const [groupId, byId] of groups) {
      if (byId.size < rule.value) continue;
      let states = new Map([[0, 0]]);
      for (const card of byId.values()) {
        const cost = costOf(card);
        if (!Number.isSafeInteger(cost) || cost < 0) continue;
        const fits = slots.reduce((mask, position, index) => mask | (card.positions?.includes(position) ? 1 << index : 0), 0);
        const next = new Map(states);
        for (const [mask, spent] of states) {
          if (counts[mask] >= rule.value) continue;
          for (let free = fits & ~mask; free; free &= free - 1) {
            const target = mask | (free & -free), price = spent + cost;
            if (price < (next.get(target) ?? Infinity)) next.set(target, price);
          }
        }
        states = next;
      }
      const cost = Math.min(Infinity, ...[...states].filter(([mask]) => counts[mask] === rule.value).map(([, price]) => price));
      const average = cost / rule.value;
      if (Number.isFinite(cost)) ranked.push({ hint: { strategy, groupId }, costFirst: true, average });
    }
  }
  const seen = new Set();
  return ranked.sort((a, b) => a.average - b.average).filter(row => {
    const key = `${row.hint.strategy}:${row.hint.groupId}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 2).map(row => ({ hint: row.hint, costFirst: true }));
}
