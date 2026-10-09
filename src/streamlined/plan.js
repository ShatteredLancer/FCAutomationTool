import { streamlinedPlanFingerprint, streamlinedProgress, same, deepFreeze, integer, fail } from './contract.js';
import { scoreStreamlinedItems } from './scoring.js';

function validPlanContents(plan) {
  const { challenge, items, batches } = plan;
  if (plan.execution && (!integer(plan.execution.purchaseAttempts, 1)
      || !integer(plan.execution.partialWaitMs, 0, 3600000))) return false;
  if (!challenge || challenge.mechanism !== 'streamlined' || !integer(challenge.targetScore, 1)
      || !integer(challenge.submittedScore) || challenge.remainingScore !== Math.max(0, challenge.targetScore - challenge.submittedScore)
      || !integer(challenge.selectionLimit, 1, 1000) || !['lowest-value', 'lowest-coins', 'fewest-cards'].includes(plan.objective)
      || !['ready', 'partial'].includes(plan.status) || !Array.isArray(items) || !items.length || items.length > 20000
      || !Array.isArray(batches) || batches.some(b => !Array.isArray(b) || !b.length || b.length > challenge.selectionLimit)
      || !same(batches.flat(), items) || new Set(items.map(i => i?.key)).size !== items.length) return false;
  if (items.some(i => !integer(i?.definitionId, 1) || !integer(i.points, 1) || i.scoreVerified !== true
      || (i.source === 'inventory' ? !integer(i.id, 1) || i.key !== `item:${i.id}` || !['club', 'storage'].includes(i.pile)
        : i.source !== 'market' || i.id !== null || !new RegExp(`^market:${i.definitionId}:(0|[1-9]\\d*)$`).test(i.key)
          || !integer(i.price, 1, 15000000)))) return false;
  const score = scoreStreamlinedItems(items).total, progress = streamlinedProgress(challenge, score);
  const inventory = items.filter(i => i.source === 'inventory');
  const value = inventory.some(i => !integer(i.price, 1, 15000000)) ? null : inventory.reduce((sum, i) => sum + i.price, 0);
  return plan.score === score && same(plan.progress, progress) && (plan.status === 'ready') === progress.reached
    && plan.purchaseCost === items.filter(i => i.source === 'market').reduce((sum, i) => sum + i.price, 0)
    && plan.materialValue === value;
}

export function createStreamlinedPlan({ context, challenge, policy, result, objective = 'lowest-value', execution = null } = {}) {
  if (!same(context, challenge?.context) || !['ready', 'partial'].includes(result?.status)
      || !Array.isArray(result.items) || !result.items.length || result.items.length > 20000
      || !Array.isArray(result.batches) || !integer(challenge.selectionLimit, 1, 1000)) fail('PLAN_UNCONFIRMED');
  const items = structuredClone(result.items), batches = structuredClone(result.batches);
  if (!validPlanContents({ ...result, challenge, objective, items, batches, execution })) fail('PLAN_UNCONFIRMED');
  const route = result.route ? structuredClone(result.route) : null;
  const fingerprint = streamlinedPlanFingerprint({ context, challenge, policy, objective, execution,
    status: result.status, score: result.score, progress: result.progress,
    purchaseCost: result.purchaseCost, materialValue: result.materialValue,
    searchComplete: result.searchComplete === true, items, batches, route });
  return deepFreeze({ schema: 1, context, challenge, policy, objective, status: result.status,
    score: result.score, progress: result.progress, purchaseCost: result.purchaseCost, materialValue: result.materialValue,
    items, batches, ...(route ? { route } : {}), ...(execution ? { execution: structuredClone(execution) } : {}), fingerprint,
    searchComplete: result.searchComplete === true, liveExecutionEnabled: false });
}

export function assertStreamlinedPlan(plan) {
  if (plan?.schema !== 1 || !same(plan.context, plan.challenge?.context)
      || !validPlanContents(plan) || plan.fingerprint !== streamlinedPlanFingerprint({ ...plan, route: plan.route })) fail('PLAN_CHANGED');
  return plan;
}
