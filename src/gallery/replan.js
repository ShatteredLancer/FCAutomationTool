import { planGalleryGradeSteps } from './planner.js';
import { planGalleryJointSteps } from './joint-planner.js';

const validId = value => Number.isSafeInteger(value) && value > 0;
const validPrice = value => Number.isSafeInteger(value) && value >= 150 && value <= 15000000;
const safeFailures = new Set(['FC27_GALLERY_NO_LISTING', 'FC27_BUY_NO_LISTING', 'FC27_GALLERY_BUDGET_EXCEEDED',
  'FC27_BUY_LISTING_CHANGED', 'FC27_BUY_LISTING_UNAVAILABLE', 'FC27_BUY_REJECTED', 'FC27_BUY_INSUFFICIENT_COINS']);
const noListing = new Set(['FC27_GALLERY_NO_LISTING', 'FC27_BUY_NO_LISTING']);
const blocked = reason => ({ status: 'blocked', reason, plans: [] });

// The dialog can offer replanning only for settled, explicit market failures.
// The generator below additionally checks exact versions and cumulative cost.
export function isGalleryPurchaseReplanSafe(outcome = {}) {
  if (outcome?.status !== 'partial' || outcome?.collection?.status !== 'confirmed'
      || !Array.isArray(outcome.results) || !outcome.failures?.length
      || !safeFailures.has(outcome.reason)) return false;
  const resultIds = new Set();
  for (const result of outcome.results) {
    if (!validId(result?.definitionId) || resultIds.has(result.definitionId)
        || !['waiting', 'club', 'unassigned', 'acquired', 'collected'].includes(result.state)) return false;
    resultIds.add(result.definitionId);
  }
  return outcome.failures.every(failure => resultIds.has(failure.definitionId)
    && safeFailures.has(failure.reason)
    && outcome.results.some(result => result.definitionId === failure.definitionId && result.state === 'waiting'))
    && Number.isSafeInteger(outcome.spent) && outcome.spent >= 0;
}

export function replanableGalleryFailures(outcome = {}) {
  if (!isGalleryPurchaseReplanSafe(outcome)) return [];
  return outcome.failures.map(row => row.definitionId)
    .filter((id, index, values) => values.indexOf(id) === index);
}

export function projectGalleryPurchaseProgress({ progress, items = [], outcome } = {}) {
  if (!progress || !Array.isArray(progress.rows) || !isGalleryPurchaseReplanSafe(outcome)) {
    return { status: 'blocked', reason: 'purchase-recovery-required', progress: null, acquiredIds: [] };
  }
  const allowed = new Set(items.map(item => item?.eaId ?? item?.definitionId).filter(validId));
  const acquired = new Set(outcome.results.filter(result => ['club', 'unassigned', 'acquired', 'collected'].includes(result.state))
    .map(result => result.definitionId));
  if ([...acquired].some(id => !allowed.has(id))) {
    return { status: 'blocked', reason: 'purchase-result-mismatch', progress: null, acquiredIds: [] };
  }
  const rows = progress.rows.map(row => acquired.has(row.eaId)
    ? { ...row, collected: true, purchaseProjected: true, firstOwned: false }
    : { ...row });
  return { status: 'observed', progress: { ...progress, rows }, acquiredIds: [...acquired] };
}

export function remainingGalleryBudget(budget, outcome = {}) {
  if (budget == null) return null;
  if (!Number.isSafeInteger(budget) || budget < 0 || !Number.isSafeInteger(outcome.spent) || outcome.spent < 0) return null;
  return Math.max(0, budget - outcome.spent);
}

export function galleryReplanBinding(binding, outcome = {}, items = []) {
  const base = typeof binding === 'string' && binding ? binding : 'gallery';
  const ids = items.map(item => item?.eaId ?? item?.definitionId).filter(validId).sort((a, b) => a - b);
  const operation = typeof outcome.operationId === 'string' && outcome.operationId ? outcome.operationId : 'partial';
  return `${base}:replan:${operation}:${ids.join(',')}`.slice(0, 12000);
}

// A projected acquisition is planner input, never an EA collection receipt.
// The ledger survives multiple replacement plans in this dialog; pending
// receipts always remain the responsibility of the original Journal.
export function* planGalleryRemainderSteps({ targets, outcome, ledger = {}, budget = null,
  mode = 'single', searchOptions = {} } = {}) {
  if (!['single', 'joint'].includes(mode) || !Array.isArray(targets) || !targets.length
      || mode === 'single' && targets.length !== 1
      || targets.some(target => !Array.isArray(target?.progress?.rows))) return blocked('target-input-invalid');
  if (!isGalleryPurchaseReplanSafe(outcome)) {
    return blocked('purchase-recovery-required');
  }
  if (budget !== null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 165000000)) return blocked('budget-invalid');
  const rows = new Map(targets.flatMap(target => target.progress.rows).map(row => [row.eaId, row]));
  // Historical ledger.quotes contained EA offers, not public estimates. Never
  // restore those overrides into planner costs; actual receipts remain valid.
  const receipts = new Map(), exclusions = new Set(ledger.excludedIds ?? []);
  for (const entry of ledger.receipts ?? []) {
    if (!validId(entry.definitionId) || !rows.has(entry.definitionId) || receipts.has(entry.definitionId)
        || entry.price !== 0 && !validPrice(entry.price)) return blocked('purchase-ledger-invalid');
    receipts.set(entry.definitionId, { ...entry });
  }
  let attemptSpent = 0;
  for (const entry of outcome.results) {
    if (!rows.has(entry.definitionId)) return blocked('purchase-result-mismatch');
    if (entry.state === 'waiting') continue;
    const purchased = ['club', 'unassigned', 'acquired'].includes(entry.state);
    const price = purchased ? entry.price : 0;
    if (purchased && !validPrice(price)) return blocked('purchase-result-mismatch');
    attemptSpent += price;
    const previous = receipts.get(entry.definitionId);
    if (previous && previous.price !== price) return blocked('purchase-result-mismatch');
    receipts.set(entry.definitionId, { definitionId: entry.definitionId, price });
  }
  if (attemptSpent !== outcome.spent || new Set(outcome.results.map(row => row.definitionId)).size !== outcome.results.length) {
    return blocked('purchase-result-mismatch');
  }
  for (const failure of outcome.failures) {
    if (!outcome.results.some(row => row.definitionId === failure.definitionId && row.state === 'waiting')) return blocked('purchase-result-mismatch');
    if (noListing.has(failure.reason)) exclusions.add(failure.definitionId);
    if (failure.observedPrice != null) {
      if (!validPrice(failure.observedPrice)) return blocked('purchase-result-mismatch');
    }
  }
  if ([...exclusions].some(id => !validId(id))) return blocked('purchase-ledger-invalid');
  const spent = [...receipts.values()].reduce((sum, row) => sum + row.price, 0);
  if (budget !== null && spent > budget) return blocked('purchase-ledger-invalid');
  const remainingBudget = budget === null ? null : budget - spent;
  const nextTargets = targets.map(target => ({ ...target, prices: { ...target.prices },
    progress: { ...target.progress, rows: target.progress.rows.map(row => {
        const receipt = receipts.get(row.eaId);
        if (!receipt || row.collected === true) return { ...row };
        const score = row.gradingScore ?? row.galleryScore;
        return { ...row, collected: true, gradingScore: score, firstOwned: false, purchaseProjected: true };
      }) } }));
  const nextLedger = { receipts: [...receipts.values()], excludedIds: [...exclusions] };
  const searchTargets = nextTargets.map(target => ({ ...target, progress: { ...target.progress,
    rows: target.progress.rows.filter(row => !exclusions.has(row.eaId) || row.collected) } }));
  const result = mode === 'single'
    ? yield* planGalleryGradeSteps({ ...searchTargets[0], ...searchOptions })
    : yield* planGalleryJointSteps({ targets: searchTargets, ...searchOptions, budget: remainingBudget });
  const common = { ...result, targets: nextTargets, ledger: nextLedger, spent, remainingBudget };
  if (result.status !== 'ready' || remainingBudget === null) return common;
  const plans = result.plans.filter(plan => plan.totalPrice !== null && plan.totalPrice <= remainingBudget);
  return plans.length ? { ...common, plans } : { ...common, status: 'partial',
    reason: result.plans.some(plan => plan.totalPrice === null) ? 'price-unknown' : 'budget-unreachable', plans: [] };
}
