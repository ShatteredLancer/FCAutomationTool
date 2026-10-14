import { integer, same, fail, deepFreeze } from './contract.js';
import { groupStreamlinedCandidates, runStreamlinedRoutes } from './routes.js';

// This is an authorization envelope, not evidence of auction supply. Only the
// selected stock IDs are consumable; the separately displayed market pool can
// be replanned within its frozen per-version caps and the approved total budget.
export function createStreamlinedPurchaseScope(input) {
  const { groups } = groupStreamlinedCandidates({ ...input, inventory: [], mode: 'market' });
  const scope = { schema: 1, quotedAt: input.quoteAt, groups };
  // Legacy/read-only candidate providers without purchase caps keep their
  // existing route-only preview; missing authorization is never manufactured.
  return validStreamlinedPurchaseScope(scope) ? deepFreeze(scope) : null;
}

export function validStreamlinedPurchaseScope(scope) {
  if (!scope || scope.schema !== 1 || !integer(scope.quotedAt) || !Array.isArray(scope.groups)
      || !scope.groups.length || scope.groups.length > 2000) return false;
  const ids = new Set(), keys = new Set();
  return scope.groups.every(group => group.source === 'market' && integer(group.quantity, 1, 20000)
    && typeof group.key === 'string' && !keys.has(group.key) && !!keys.add(group.key)
    && Array.isArray(group.items) && group.items.length > 0
    && same(group.item, group.items[0]) && group.items.every(item => {
      const q = item.quote;
      if (ids.has(item.definitionId) || !integer(item.definitionId, 1) || item.source !== 'market'
          || item.id !== null || item.scoreVerified !== true || !integer(item.points, 1)
          || item.points !== group.item.points || item.price !== group.item.price
          || !integer(item.price, 150, 15000000) || !integer(item.purchaseMaxBuy, item.price, 15000000)
          || !['futgg', 'futbin'].includes(q?.source) || q.definitionId !== item.definitionId
          || q.price !== item.price || q.error || !integer(q.fetchedAt, 0, scope.quotedAt)
          || !integer(q.expiresAt, scope.quotedAt + 1)) return false;
      ids.add(item.definitionId); return true;
    })) && ids.size <= 2000;
}

export function approvedStreamlinedPurchaseRoute(plan) {
  const scope = plan.execution?.purchaseScope;
  if (!scope) return plan.route;
  if (!validStreamlinedPurchaseScope(scope)) fail('PURCHASE_SCOPE_INVALID');
  const stock = plan.route.groups.filter(group => group.source === 'inventory');
  for (const group of plan.route.groups.filter(group => group.source === 'market')) {
    if (!group.items.every(item => scope.groups.some(allowed => allowed.items.some(row => same(row, item))))) fail('PURCHASE_SCOPE_INVALID');
  }
  return { ...plan.route, groups: structuredClone([...stock, ...scope.groups]) };
}

export function initialStreamlinedPurchaseDemand(plan, route) {
  return route.groups.map(group => plan.route.groups.find(selected => selected.key === group.key)?.quantity ?? 0);
}

export function streamlinedDemandRoute(record) {
  return record.demand ? { ...record.route, groups: record.route.groups.map((group, index) =>
    ({ ...group, quantity: record.demand[index] })) } : record.route;
}

// Reuse the existing economic solver rather than replacing ad's objective with
// a greedy fastest-batch heuristic. The eligibility adapter here can only match
// exact candidates already admitted by the live eligibility/policy projection.
export async function replanStreamlinedPurchaseDemand(record, { heldDefinitions = [], blockedDefinitions = [], now, stopped } = {}) {
  const scope = record.plan.execution?.purchaseScope;
  if (!scope) return null;
  const blocked = new Set([...heldDefinitions, ...blockedDefinitions]);
  const ready = record.entries.filter(entry => ['ready', 'club'].includes(entry.state));
  const credit = ready.reduce((sum, entry) => sum + record.route.groups[entry.groupIndex].item.points, 0);
  const remainingScore = Math.max(0, record.challenge.targetScore - record.submittedScore - credit);
  if (!remainingScore) return null;
  const market = scope.groups.flatMap(group => group.items).filter(item => !blocked.has(item.definitionId));
  if (!market.length) return null;
  const allowed = new Set(market.map(item => item.definitionId));
  const result = await runStreamlinedRoutes({ challenge: { ...record.challenge, remainingScore },
    policy: record.policy, eligibility: { known: true, matches: item => ({ status: allowed.has(item.definitionId) ? 'eligible' : 'ineligible' }) },
    inventory: [], market, mode: 'market', objective: record.plan.objective,
    // Frozen valuations are not renewed here. find() refreshes the selected
    // version's actual quote before any search/bid and never raises its cap.
    quoteSource: market[0].quote.source, quoteAt: scope.quotedAt },
  { budget: record.budget - record.spent, now, stopped, maxMs: 1000 });
  const selected = result.routes?.[0];
  if (!selected || stopped?.()) return null;
  return record.route.groups.map((group, index) => (record.fulfilled[index] ?? 0)
    + ready.filter(entry => entry.groupIndex === index).length
    + (selected.groups.find(candidate => candidate.key === group.key)?.quantity ?? 0));
}
