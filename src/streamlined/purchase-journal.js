import { contextKey } from '../fc27/prelaunch-contract.js';
import { integer, same, fail } from './contract.js';
import { assertStreamlinedPlan } from './plan.js';

export const streamlinedPurchaseKey = context => contextKey(context, 'streamlined-market-run');
export function validateStreamlinedPurchase(record, context) {
  if (record?.plan?.schema === 1) {
    assertStreamlinedPlan(record.plan);
    if (record.plan.fingerprint !== record.fingerprint || !same(record.plan.context, context)
        || !same(record.plan.route, record.route) || !same(record.plan.challenge, record.challenge)
        || !same(record.plan.policy, record.policy)) fail('PURCHASE_JOURNAL_INVALID');
  }
  if (!record || record.schema !== 1 || !same(record.context, context) || typeof record.operationId !== 'string'
      || !record.operationId || !integer(record.revision, 1) || !record.route?.groups?.length
      || typeof record.fingerprint !== 'string' || !record.fingerprint
      || !integer(record.budget) || !integer(record.spent) || record.spent > record.budget
      || !integer(record.submittedScore) || !integer(record.challenge?.id, 1) || !integer(record.challenge?.setId, 1)
      || typeof record.completed !== 'boolean'
      || record.confirmedBatches !== undefined && !integer(record.confirmedBatches)
      || !integer(record.challenge?.targetScore, 1) || !integer(record.challenge?.selectionLimit, 1, 1000)
      || !Array.isArray(record.entries) || record.entries.length > 20000
      || !Array.isArray(record.consumedIds) || !Array.isArray(record.fulfilled)
      || record.fulfilled.length !== record.route.groups.length
      || record.fulfilled.some((n,i) => !integer(n, 0, record.route.groups[i]?.quantity ?? -1))
      || new Set(record.consumedIds).size !== record.consumedIds.length
      || record.consumedIds.some(id => !integer(id, 1))) fail('PURCHASE_JOURNAL_INVALID');
  for (const group of record.route.groups) {
    if (!['inventory', 'market'].includes(group.source) || !integer(group.quantity, 1, 20000)
        || !Array.isArray(group.items) || !group.items.length
        || !integer(group.item?.points, 1) || group.items.some(item => !integer(item?.definitionId, 1) || item?.points !== group.item.points
          || group.source === 'market' && (!integer(item.price, 150, 15000000)
            || !integer(item.purchaseMaxBuy, 150, 15000000) || item.purchaseMaxBuy < item.price)
          || group.source === 'inventory' && !integer(item.id, 1))) fail('PURCHASE_JOURNAL_INVALID');
  }
  const keys = new Set(), items = new Set(); let spent = 0;
  for (const entry of record.entries) {
    const group = record.route.groups[entry.groupIndex];
    if (!group || typeof entry.key !== 'string' || keys.has(entry.key)
        || !['ready', 'waiting', 'buy-pending', 'bought', 'move-pending', 'club', 'rejected', 'consumed'].includes(entry.state)
        || !integer(entry.definitionId, 1) || !group.items.some(i => i.definitionId === entry.definitionId)
        || !integer(entry.groupIndex, 0, record.route.groups.length - 1)
        || entry.source !== group.source) fail('PURCHASE_JOURNAL_INVALID');
    keys.add(entry.key);
    if (entry.source === 'inventory') {
      if (!integer(entry.itemId, 1) || entry.price !== null || entry.cap !== null || entry.tradeId !== null
          || !group.items.slice(0, group.quantity).some(item => item.id === entry.itemId && item.definitionId === entry.definitionId)
          || !['ready', 'consumed'].includes(entry.state) || items.has(entry.itemId)) fail('PURCHASE_JOURNAL_INVALID');
      items.add(entry.itemId); continue;
    }
    if (['buy-pending', 'bought', 'move-pending', 'club', 'consumed', 'rejected'].includes(entry.state)) {
      if (!integer(entry.itemId, 1) || !integer(entry.cap, 150, group.items.find(item => item.definitionId === entry.definitionId).purchaseMaxBuy)
          || !integer(entry.price, 150, entry.cap) || typeof entry.tradeId !== 'string'
          || !/^[1-9]\d{0,19}$/.test(entry.tradeId) || items.has(entry.itemId)) fail('PURCHASE_JOURNAL_INVALID');
      items.add(entry.itemId);
      if (['bought', 'move-pending', 'club', 'consumed'].includes(entry.state)) spent += entry.price;
    } else if (entry.cap !== null && !integer(entry.cap, 150, 15000000)) fail('PURCHASE_JOURNAL_INVALID');
    if (entry.state === 'waiting' && (entry.itemId !== null || entry.price !== null || entry.tradeId !== null)) fail('PURCHASE_JOURNAL_INVALID');
  }
  if (spent !== record.spent) fail('PURCHASE_JOURNAL_INVALID');
  if (record.consumedIds.length !== record.entries.filter(e => e.state === 'consumed').length
      || record.entries.some(e => (e.state === 'consumed') !== record.consumedIds.includes(e.itemId))
      || record.fulfilled.some((n, i) => n !== record.entries.filter(e => e.groupIndex === i && e.state === 'consumed').length)) fail('PURCHASE_JOURNAL_INVALID');
  if (record.contribution) {
    const material = record.contribution.material;
    if (!Array.isArray(material) || !material.length || material.length > record.challenge.selectionLimit
        || new Set(material.map(row => row.item?.id)).size !== material.length
        || material.some(row => !record.entries.some(entry => ['ready', 'club'].includes(entry.state)
          && entry.groupIndex === row.groupIndex && entry.itemId === row.item?.id && entry.definitionId === row.item?.definitionId)
          || row.item?.points !== record.route.groups[row.groupIndex]?.item.points)) fail('PURCHASE_JOURNAL_INVALID');
  }
  return record;
}

export function createStreamlinedPurchaseJournal({ get, set, assertHeld = () => {} }) {
  const read = async context => {
    let record;
    try { record = await get(streamlinedPurchaseKey(context), null); } catch { fail('PURCHASE_JOURNAL_READ_FAILED'); }
    return record == null ? null : structuredClone(validateStreamlinedPurchase(record, context));
  };
  const write = async (record, previousRevision = record.revision) => {
    assertHeld();
    const old = await read(record.context);
    if ((old?.revision ?? 0) !== previousRevision) fail('PURCHASE_JOURNAL_CHANGED');
    const next = validateStreamlinedPurchase({ ...structuredClone(record), revision: previousRevision + 1 }, record.context);
    try {
      assertHeld(); await set(streamlinedPurchaseKey(record.context), next); assertHeld();
      if (!same(next, await get(streamlinedPurchaseKey(record.context), null))) fail('PURCHASE_JOURNAL_WRITE_FAILED');
    } catch { fail('PURCHASE_JOURNAL_WRITE_FAILED'); }
    return structuredClone(next);
  };
  return Object.freeze({ read, write });
}

export async function verifyStreamlinedPurchasedItem(get, context, item, challenge = null) {
  const proof = item?.purchaseReceipt;
  if (!proof || proof.itemId !== item.id || proof.definitionId !== item.definitionId) return false;
  const journal = createStreamlinedPurchaseJournal({ get });
  const record = await journal.read(context);
  if (!record || record.operationId !== proof.operationId) return false;
  if (!challenge || record.challenge.id !== challenge.id || record.challenge.setId !== challenge.setId
      || record.challenge.targetScore !== challenge.targetScore) return false;
  const entry = record.entries.find(row => row.itemId === item.id && row.definitionId === item.definitionId);
  return entry?.state === 'club' && entry.tradeId === proof.tradeId && entry.price === proof.price;
}
