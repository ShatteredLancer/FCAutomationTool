// Display-only projections of the reviewed FC27 rule codes. These labels never
// authorize planning: the fresh contract parser and transaction remain authoritative.
export function describeCatalogRule(rule) {
  const raw = `count=${rule.count ?? '?'}, scope=${rule.scope ?? '?'}, pairs=${JSON.stringify(rule.pairs)}`;
  const pair = rule.pairs?.length === 1 ? rule.pairs[0] : null;
  const value = pair?.values?.length === 1 ? pair.values[0] : null;
  let label = null;
  if (pair?.key === 3 && rule.count === -1 && [1, 2, 3].includes(value)
      && (rule.scope === 2 || rule.scope === 0 && value === 3)) {
    label = `All players: ${['Bronze', 'Silver', 'Gold'][value - 1]} quality`;
  } else if ([26, 28].includes(pair?.key) && Number.isInteger(value) && value >= 1 && value <= 99
      && Number.isInteger(rule.count) && rule.count > 0 && rule.count <= 11 && [0, 2].includes(rule.scope)) {
    label = `${rule.scope === 0 ? 'At least' : 'Exactly'} ${rule.count} players: ${pair.key === 26 ? 'minimum' : 'maximum'} OVR ${value}`;
  }
  return { label: label ?? 'Unsupported requirement — retained for inspection', raw, recognized: label !== null };
}

export function describeCatalogRewards(rewards) {
  if (!Array.isArray(rewards)) return 'Unknown rewards';
  if (!rewards.length) return 'No rewards at this level';
  return rewards.map(reward => `${reward.count ?? '?'} × ${reward.type ?? 'unknown'} ${reward.value ?? '?'} (${reward.tradable === true
    ? 'tradeable' : reward.tradable === false ? 'untradeable' : 'tradeability unknown'})`).join('; ');
}

export function describePreparedRequirement(rule) {
  if (rule.kind === 'player-count') return `${rule.count} players`;
  return `${rule.count} players: ${rule.kind === 'player-min-overall' ? 'minimum' : 'maximum'} OVR ${rule.value}`;
}
