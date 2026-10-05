import { createPurchasePriceApproval, validatePurchasePriceApproval, purchasePriceApprovalFor } from './purchase-price-approval.js';
import { purchasePriceCap } from '../gallery/public-price-policy.js';

const fail = reason => { throw Error(reason); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
const repeatable = new Set(['FC27_BUY_NO_LISTING', 'FC27_GALLERY_NO_LISTING', 'FC27_BUY_LISTING_CHANGED', 'FC27_BUY_LISTING_UNAVAILABLE']);
export function validatePurchaseAttempts(record) {
  for (const value of [record.attempts, record.priceOverrides, record.searchCeilings]) {
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) fail('FC27_BUY_ATTEMPTS_INVALID');
  }
  for (const [key, value] of Object.entries(record.attempts ?? {})) {
    if (!record.entries.some(entry => entry.definitionId === Number(key)) || !value || !integer(value.used) || !integer(value.total)
        || !integer(value.limit) || value.limit < 1 || value.used > value.limit || value.total < value.used
        || !integer(value.round) || value.round < 1 || value.round >= Number.MAX_SAFE_INTEGER || typeof value.failed !== 'boolean'
        || value.queries !== undefined && !integer(value.queries)
        || value.reason !== null && !/^FC27_[A-Z0-9_]+$/.test(value.reason)) fail('FC27_BUY_ATTEMPTS_INVALID');
  }
  for (const [key, cap] of Object.entries(record.searchCeilings ?? {})) {
    if (!record.entries.some(entry => entry.definitionId === Number(key)) || !integer(cap) || cap < 150 || cap > 15000000) fail('FC27_BUY_PRICE_APPROVAL_INVALID');
  }
  for (const [key, approval] of Object.entries(record.priceOverrides ?? {})) {
    if (!record.entries.some(entry => entry.definitionId === Number(key)) || !record.attempts?.[key]) fail('FC27_BUY_PRICE_APPROVAL_INVALID');
    validatePurchasePriceApproval(approval, record.scope, [Number(key)]);
  }
}
export function beginPurchaseAttempt(record, definitionId) {
  const approval = purchasePriceApprovalFor(record, definitionId);
  if (!approval) return true; // Legacy inspection fixtures retain one pass.
  record.attempts ??= {};
  const value = record.attempts[definitionId] ??= { used: 0, total: 0, round: 1, limit: approval.policy.purchaseAttempts, reason: null, failed: false };
  if (value.failed || value.used >= value.limit) return false;
  if (value.total >= Number.MAX_SAFE_INTEGER) fail('FC27_BUY_ATTEMPTS_INVALID');
  value.used++; value.total++; value.reason = null;
  return true;
}
export function finishPurchaseAttempt(record, definitionId, result) {
  const value = record.attempts?.[definitionId];
  if (!value) return false;
  value.reason = result.reason;
  const again = repeatable.has(result.reason) && ![401,403,429].includes(result.httpStatus) && value.used < value.limit;
  value.failed = !again;
  return again;
}
export function failPurchaseWithoutAttempt(record, definitionId, reason) {
  const approval = purchasePriceApprovalFor(record, definitionId);
  if (!approval) return;
  record.attempts ??= {};
  record.attempts[definitionId] ??= { used: 0, total: 0, round: 1, limit: approval.policy.purchaseAttempts };
  Object.assign(record.attempts[definitionId], { reason, failed: true });
}
export function purchaseRetryKey(record) {
  return JSON.stringify([record.operationId, record.entries.map(entry => [entry.definitionId, entry.state,
    record.attempts?.[entry.definitionId]?.total ?? 0, record.attempts?.[entry.definitionId]?.round ?? 0])]);
}
export function purchaseAttemptResults(record) {
  return record.entries.map(entry => {
    const approval = purchasePriceApprovalFor(record, entry.definitionId), price = approval?.rows.find(row => row.definitionId === entry.definitionId);
    return { definitionId: entry.definitionId, slot: entry.slot, state: entry.state,
      name: (record.plan ?? record.base?.purchases)?.find(row => row.definitionId === entry.definitionId)?.name ?? '',
      price: ['waiting', 'buy-pending', 'collected'].includes(entry.state) ? null : entry.price,
      attempt: record.attempts?.[entry.definitionId] ? { ...record.attempts[entry.definitionId] } : null,
      reference: price ? { ...structuredClone(price), maxBuy: price.maxBuy === null ? null
        : Math.min(price.maxBuy, record.searchCeilings?.[entry.definitionId] ?? Infinity),
        policy: { ...approval.policy }, season: approval.season, platform: approval.platform } : null,
      reason: record.attempts?.[entry.definitionId]?.reason
        ?? record.lastResult?.failures?.find(row => row.definitionId === entry.definitionId)?.reason ?? null };
  });
}
export function purchaseRetryContext(record, constraints = {}) {
  return record.priceApproval ? { ...constraints, operationId: record.operationId,
    key: purchaseRetryKey(record), policy: record.priceApproval.policy } : null;
}
export function recordPurchaseSearch(record, definitionId) {
  const attempt = record.attempts?.[definitionId];
  if (attempt) attempt.queries = (attempt.queries ?? 0) + 1;
}
export function freezePurchaseSearchCap(record, definitionId, cap) {
  if (!record.priceApproval) return cap;
  record.searchCeilings ??= {};
  const effective = Math.min(cap, record.searchCeilings[definitionId] ?? cap);
  if (integer(effective) && effective >= 150) record.searchCeilings[definitionId] = effective;
  return effective;
}
// UI validates the same constraints locally; this check is repeated under the
// account lock before changing any grant or starting the first retry search.
export function applyPurchaseRetry(record, retry, constraints, now = Date.now()) {
  if (!retry || retry.key !== purchaseRetryKey(record) || retry.operationId !== record.operationId
      || !Array.isArray(retry.items) || !retry.items.length || retry.items.length > 256
      || new Set(retry.items.map(item => item.definitionId)).size !== retry.items.length
      || record.entries.some(entry => ['buy-pending','bought','move-pending','move-rejected'].includes(entry.state))
      || record.phase === 'save-pending') fail('FC27_BUY_RETRY_CHANGED');
  if (!Number.isSafeInteger(constraints?.balance) || constraints.balance < 0) fail('FC27_BUY_BALANCE_UNVERIFIED');
  const approvals = {}; let total = 0;
  for (const item of retry.items) {
    const entry = record.entries.find(entry => entry.definitionId === item.definitionId);
    if (entry?.state !== 'waiting' || record.attempts?.[item.definitionId]?.failed !== true) fail('FC27_BUY_RETRY_CHANGED');
    const base = purchasePriceApprovalFor(record, item.definitionId);
    const approval = createPurchasePriceApproval({ scope: record.scope, season: base.season, platform: base.platform,
      definitionIds: [item.definitionId], references: retry.references, policy: retry.policy,
      overrides: { [item.definitionId]: item.maxBuy }, now });
    if (approval.rows[0].maxBuy === null) fail(approval.rows[0].reason);
    const legal = purchasePriceCap({ maxBuy: item.maxBuy, priceTiers: constraints.priceTiers,
      absoluteCap: constraints.absoluteCap, remainingBudget: constraints.remainingBudget, balance: constraints.balance });
    if (legal !== item.maxBuy) fail('FC27_BUY_RETRY_CAP_INVALID');
    total += legal; approvals[item.definitionId] = approval;
  }
  if (total > (constraints.remainingBudget ?? Infinity) || total > (constraints.balance ?? Infinity)) fail('FC27_BUY_RETRY_BUDGET_EXCEEDED');
  record.priceOverrides = { ...record.priceOverrides, ...approvals };
  for (const item of retry.items) {
    const previous = record.attempts[item.definitionId];
    record.attempts[item.definitionId] = { used: 0, total: previous.total, round: previous.round + 1,
      ...(previous.queries === undefined ? {} : { queries: previous.queries }),
      limit: approvals[item.definitionId].policy.purchaseAttempts, failed: false, reason: null };
    if (record.searchCeilings) delete record.searchCeilings[item.definitionId];
  }
}
