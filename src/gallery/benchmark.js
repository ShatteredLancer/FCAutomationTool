import { planGalleryGradeSteps } from './planner.js';

// Compare plans on the same frozen input. Rewards are intentionally not
// converted to coins: the benchmark only reports card reuse and spend.
export function benchmarkGalleryPlans({ jointPlan, individualPlans = [] } = {}) {
  if (!jointPlan || !Array.isArray(jointPlan.items) || !Array.isArray(individualPlans)) {
    return { status: 'unavailable', reason: 'benchmark-input-invalid' };
  }
  const jointIds = new Set(jointPlan.items.map(item => item.eaId));
  if (jointPlan.totalPrice == null || individualPlans.some(plan => plan?.totalPrice == null)) {
    return { status: 'partial', reason: 'price-unknown', sharedVersions: 0, savings: null };
  }
  const separate = individualPlans.reduce((sum, plan) => sum + plan.totalPrice, 0);
  const memberships = new Map();
  for (const plan of individualPlans) for (const item of plan.items ?? []) memberships.set(item.eaId, (memberships.get(item.eaId) ?? 0) + 1);
  const uniqueSeparate = new Set(individualPlans.flatMap(plan => (plan.items ?? []).map(item => item.eaId)));
  return { status: 'observed', jointPrice: jointPlan.totalPrice, separatePrice: separate,
    savings: separate - jointPlan.totalPrice, sharedVersions: [...memberships.values()].filter(value => value > 1).length,
    jointCardCount: jointIds.size, separateCardCount: uniqueSeparate.size, equivalentInput: true };
}

// Sequential baseline makes each earlier purchase available to later sets.
// This prevents claiming savings merely by charging for a version twice.
export function* planGallerySequentialSteps({ targets = [] } = {}) {
  const acquired = new Map(), plans = [];
  for (const target of targets) {
    const progress = { ...target.progress, rows: target.progress.rows.map(row => acquired.has(row.eaId) && row.collected === false
      ? { ...row, collected: true, firstOwned: false, gradingScore: acquired.get(row.eaId).score } : row) };
    const result = yield* planGalleryGradeSteps({ ...target, progress, maxPlans: 1 });
    if (result.status === 'achieved') { plans.push({ items: [], totalPrice: 0 }); continue; }
    const candidate = result.plans?.[0];
    if (result.status !== 'ready' || !candidate || candidate.totalPrice == null) return { status: 'partial', reason: result.reason ?? 'price-unknown', plans };
    plans.push(candidate);
    for (const item of candidate.items) acquired.set(item.eaId, item);
    if (yield { completed: plans.length, total: targets.length }) return { status: 'partial', reason: 'search-time-exhausted', plans };
  }
  return { status: 'observed', plans, totalPrice: plans.reduce((sum, plan) => sum + plan.totalPrice, 0), order: targets.map(target => target.set.id) };
}
