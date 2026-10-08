import { integer, fail, deepFreeze } from './contract.js';

// Pure just-in-time allocation. Callers supply reconciled holdings and settled
// group counts, not guessed ownership or market availability. A market demand
// never reserves a duplicate Club version twice in the same wave.
export function nextStreamlinedWave(route, { limit, submittedScore, targetScore, consumedIds = [],
  fulfilled = [], heldDefinitions = [], ready = [], freeSlots, blockedDefinitions = [] } = {}) {
  if (!Array.isArray(route?.groups) || !integer(limit, 1, 1000) || !integer(submittedScore)
      || !integer(targetScore, 1) || !integer(freeSlots, 0, 20000)
      || ![consumedIds, heldDefinitions, blockedDefinitions].every(rows => Array.isArray(rows) && rows.every(id => integer(id, 1)))
      || !Array.isArray(fulfilled) || fulfilled.some(n => !integer(n)) || !Array.isArray(ready)
      || ready.length > limit || new Set(ready.map(r => r.item?.id)).size !== ready.length) fail('WAVE_INPUT_INVALID');
  const material = [], purchases = [], blocked = new Set([...heldDefinitions, ...blockedDefinitions]);
  let points = submittedScore, capacity = freeSlots;
  const append = row => { material.push(row); points += row.item.points; };
  for (const row of ready) {
    const group = route.groups[row.groupIndex];
    if (!group || !integer(row.item?.id, 1) || !integer(row.item.points, 1) || row.item.points !== group.item.points
        || !group.items.some(item => item.definitionId === row.item.definitionId)) fail('WAVE_RECEIPT_INVALID');
    append(row); blocked.add(row.item.definitionId);
  }
  // Existing inventory first. A full Club can still make progress by consuming
  // an approved stock batch before buying: do not require freeSlots >= 1 here.
  for (let i = 0; i < route.groups.length && material.length < limit && points < targetScore; i++) {
    const group = route.groups[i];
    if (group.source !== 'inventory') continue;
    for (const item of group.items.slice(0, group.quantity)) {
      if (consumedIds.includes(item.id) || material.some(row => row.item.id === item.id)) continue;
      append({ groupIndex: i, item });
      if (material.length >= limit || points >= targetScore) break;
    }
  }
  if (points < targetScore) {
    for (let i = 0; i < route.groups.length && material.length + purchases.length < limit; i++) {
      const group = route.groups[i];
      if (group.source !== 'market') continue;
      const pending = group.quantity - (fulfilled[i] ?? 0) - ready.filter(row => row.groupIndex === i).length;
      if (pending < 0) fail('WAVE_QUANTITY_CHANGED');
      let count = 0;
      for (const item of group.items) {
        if (count >= pending || capacity <= 0 || points >= targetScore || material.length + purchases.length >= limit) break;
        if (blocked.has(item.definitionId)) continue;
        purchases.push({ groupIndex: i, item, ordinal: (fulfilled[i] ?? 0) + count });
        blocked.add(item.definitionId); capacity--; count++; points += item.points;
      }
    }
  }
  const inventoryUnlock = material.length > 0 && purchases.length === 0;
  return deepFreeze({ status: submittedScore >= targetScore ? 'completed' : material.length || purchases.length ? 'ready' : 'waiting',
    material, purchases, projectedScore: points, capacityAfterPurchase: capacity,
    reason: inventoryUnlock ? 'inventory-first' : material.length || purchases.length ? null : 'no-available-route',
    maxCards: limit });
}

// Soft scarcity can close a partial batch. Stop/auth/unknown transaction states
// take precedence, and never imply permission to contribute after stopping.
export function streamlinedWaveDisposition({ readyCount, readyPoints, remainingScore, limit,
  searchedAll = false, noProgressMs = 0, idleMs = 60000, capacityReached = false,
  stopped = false, uncertain = false, interrupted = false } = {}) {
  if (![readyCount, readyPoints, remainingScore, noProgressMs].every(n => integer(n))
      || !integer(limit, 1, 1000) || readyCount > limit || !integer(idleMs, 0, 3600000)) fail('WAVE_INPUT_INVALID');
  if (uncertain) return 'recover';
  if (stopped || interrupted) return 'stop';
  if (remainingScore === 0) return 'completed';
  if (!readyCount) return searchedAll ? 'pause' : 'search';
  if (readyCount === limit || readyPoints >= remainingScore || capacityReached || searchedAll && noProgressMs >= idleMs) return 'contribute';
  return 'search';
}
