import { filterStreamlinedItems } from './eligibility.js';
import { splitStreamlinedBatches } from './planner.js';
import { deepFreeze, integer, streamlinedProgress } from './contract.js';

const external = item => ['transfer', 'unassigned'].includes(item.pile);
const blocked = code => ({ status: 'blocked', reason: `FC27_STREAMLINED_${code}`, liveExecutionEnabled: false });

// A provisional cache view, never permission to move. The existing materializer
// fresh-reads the exact source and Club again before any write.
export function readStreamlinedExternalRows({ inventory, policy, eligibility, challenge, reservedIds = [] }) {
  const filtered = filterStreamlinedItems(inventory, { policy, eligibility });
  if (filtered.status !== 'observed') return filtered;
  const reserved = new Set(reservedIds), reasons = new Map(filtered.excludedRows.map(row => [row.key, row.reason]));
  const clubs = new Map();
  for (const item of inventory) {
    if (item.source !== 'inventory') return blocked('IDENTITY_CONFLICT');
    if (item.pile === 'club') {
      const copies = clubs.get(item.definitionId) ?? [];
      copies.push(item); clubs.set(item.definitionId, copies);
    }
    if (reserved.has(item.id)) reasons.set(item.key, 'history-reserved');
  }
  const rows = inventory.filter(external).map(item => {
    const copies = clubs.get(item.definitionId) ?? [], prerequisite = copies.length === 1 ? copies[0] : null;
    let reason = reasons.get(item.key) ?? null;
    if (!reason && (copies.length > 1 || item.duplicateId != null && (!prerequisite || item.duplicateId !== prerequisite.id))) reason = 'duplicate-unverified';
    if (!reason && prerequisite && reasons.has(prerequisite.key)) reason = `prerequisite-${reasons.get(prerequisite.key)}`;
    return { item, prerequisite, selectable: !reason, reason };
  });
  return deepFreeze(structuredClone({ status: 'observed', rows, challenge, policy }));
}

// Explicit selection is not an economic solve: never replace a chosen physical
// copy with another card/version. Add only exact Club prerequisites.
export function planStreamlinedExternalSelection(snapshot, keys) {
  if (snapshot?.status !== 'observed' || !Array.isArray(keys) || !keys.length || keys.length > 20000
      || new Set(keys).size !== keys.length) return blocked('EXTERNAL_SELECTION_INVALID');
  const { challenge } = snapshot;
  if (!integer(challenge?.selectionLimit, 1, 1000)) return blocked('BATCH_LIMIT_UNKNOWN');
  if (!challenge.remainingScore || challenge.status === 'COMPLETED') return { status: 'completed', items: [], batches: [] };
  const byKey = new Map(snapshot.rows.map(row => [row.item.key, row]));
  const selected = keys.map(key => byKey.get(key));
  if (selected.some(row => !row?.selectable)) return blocked('EXTERNAL_SELECTION_INVALID');
  const all = new Map();
  for (const row of selected) if (row.prerequisite) all.set(row.prerequisite.key, row.prerequisite);
  const prerequisiteKeys = new Set(all.keys());
  for (const row of selected) all.set(row.item.key, row.item);
  const batches = []; let score = 0;
  for (const batch of splitStreamlinedBatches([...all.values()], challenge.selectionLimit)) {
    const next = [];
    for (const item of batch) { if (score >= challenge.remainingScore) break; next.push(item); score += item.points; }
    if (next.length) batches.push(next);
    if (score >= challenge.remainingScore) break;
  }
  const items = batches.flat(), progress = streamlinedProgress(challenge, score);
  const unknownValueCount = items.filter(item => item.price == null).length;
  return { status: progress.reached ? 'ready' : 'partial', reason: 'FC27_STREAMLINED_EXTERNAL_SELECTION',
    items, batches, score, progress, purchaseCost: 0,
    materialValue: unknownValueCount ? null : items.reduce((sum, item) => sum + item.price, 0),
    unknownValueCount, searchComplete: true, poolComplete: false, optimalWithinPricedPool: false,
    externalSelection: true, selectedCount: selected.length,
    prerequisiteCount: items.filter(item => prerequisiteKeys.has(item.key)).length,
    omittedExternalCount: selected.length - items.filter(external).length, liveExecutionEnabled: false };
}
