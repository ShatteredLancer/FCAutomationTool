import { createSeasonContext } from '../fc27/prelaunch-contract.js';

export const STREAMLINED_SCHEMA = 1;
export const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const fail = code => { throw Error(`FC27_STREAMLINED_${code}`); };
export const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
export const isStreamlinedChallenge = value => value?.isOneClick === true;

export function normalizeStreamlinedChallenge(value = {}) {
  const context = createSeasonContext(value.context);
  if (context.season !== '27' || !isStreamlinedChallenge(value) || !integer(value.id, 1) || !integer(value.setId, 1)
      || !integer(value.scoreRequirement, 1, 1e9) || !integer(value.submittedScore, 0, 1e9)
      || !['IN_PROGRESS', 'NOT_STARTED', 'COMPLETED'].includes(value.status)) fail('CONTRACT_UNVERIFIED');
  if (!Array.isArray(value.eligibility) || value.eligibility.length > 32
      || !['AND', 'OR'].includes(value.eligibilityOperation ?? 'AND')) fail('ELIGIBILITY_UNVERIFIED');
  const eligibility = value.eligibility.map(rule => {
    if (!rule || !integer(rule.count, -1, 1000) || !integer(rule.scope, -1, 1000)
        || !Array.isArray(rule.pairs) || !rule.pairs.length || rule.pairs.length > 32) fail('ELIGIBILITY_UNVERIFIED');
    const pairs = rule.pairs.map(pair => {
      if (!integer(pair.key, 0, 100000) || !Array.isArray(pair.values) || !pair.values.length || pair.values.length > 128
          || pair.values.some(v => !integer(v, 0, 1e9))) fail('ELIGIBILITY_UNVERIFIED');
      return { key: pair.key, values: [...pair.values] };
    }).sort((a, b) => a.key - b.key);
    if (new Set(pairs.map(p => p.key)).size !== pairs.length) fail('ELIGIBILITY_UNVERIFIED');
    return { count: rule.count, scope: rule.scope, pairs };
  });
  return deepFreeze({ schema: 1, mechanism: 'streamlined', context, id: value.id, setId: value.setId,
    name: typeof value.name === 'string' ? value.name.slice(0, 160) : null, status: value.status,
    targetScore: value.scoreRequirement, submittedScore: value.submittedScore,
    remainingScore: Math.max(0, value.scoreRequirement - value.submittedScore),
    selectionLimit: integer(value.selectionLimit, 1, 1000) ? value.selectionLimit : null,
    eligibility, eligibilityOperation: value.eligibilityOperation ?? 'AND',
    repeats: integer(value.repeats) ? value.repeats : null,
    repeatabilityMode: typeof value.repeatabilityMode === 'string' ? value.repeatabilityMode : null,
    endTime: integer(value.endTime) ? value.endTime : null,
    isOneClick: true, scoreSource: 'ea-sbsScore', writeContractVerified: false });
}

// Absence of a protection field is never interpreted as false.
export function normalizeStreamlinedItem(value = {}) {
  const source = value.source === 'market' ? 'market' : 'inventory';
  if (!integer(value.definitionId, 1) || source === 'inventory' && !integer(value.id, 1)) return null;
  const item = { source, id: source === 'inventory' ? value.id : null, definitionId: value.definitionId,
    key: source === 'inventory' ? `item:${value.id}` : `market:${value.definitionId}:${value.copy ?? 0}`,
    points: integer(value.sbsScore ?? value.points, 1, 1e9) ? value.sbsScore ?? value.points : null,
    scoreVerified: value.scoreVerified === true, rating: integer(value.rating, 1, 99) ? value.rating : null,
    pile: ['club', 'storage'].includes(value.pile) ? value.pile : null,
    name: typeof value.name === 'string' ? value.name.slice(0, 160) : null,
    leagueId: integer(value.leagueId, 1) ? value.leagueId : null,
    loans: integer(value.loans, -1) ? value.loans : null,
    price: integer(value.price, 1, 15000000) ? value.price : null,
    quote: value.quote ? structuredClone(value.quote) : null };
  for (const key of ['tradeable', 'special', 'concept', 'evolution', 'cosmetic', 'academyEnrolled', 'activeTrade',
    'limitedUse', 'locked', 'activeSquad', 'protected', 'eligible']) item[key] = typeof value[key] === 'boolean' ? value[key] : null;
  return deepFreeze(item);
}

export function streamlinedProgress(challenge, added = 0) {
  if (!integer(challenge?.targetScore, 1) || !integer(challenge?.submittedScore) || !integer(added)) fail('PROGRESS_UNKNOWN');
  const total = challenge.submittedScore + added;
  return { target: challenge.targetScore, submitted: challenge.submittedScore, added, total,
    remaining: Math.max(0, challenge.targetScore - total), excess: Math.max(0, total - challenge.targetScore), reached: total >= challenge.targetScore };
}

// Exact canonical binding, not a security hash. Never exported as diagnostics.
export function streamlinedPlanFingerprint({ context, challenge, policy = null, objective = null,
  status = null, score = null, progress = null, purchaseCost = null, materialValue = null,
  searchComplete = null, items = [], batches = [], route = null, execution = null } = {}) {
  const keyOf = item => typeof item?.key === 'string' ? item.key
    : integer(item?.id, 1) ? `item:${item.id}`
      : integer(item?.definitionId, 1) ? `definition:${item.definitionId}` : 'unknown';
  return JSON.stringify({ schema: 1, context: createSeasonContext(context), challenge, policy, objective,
    status, score, progress, purchaseCost, materialValue, searchComplete, ...(execution ? { execution } : {}),
    items: items.map(item => ({ ...item, key: keyOf(item) })).sort((a, b) => a.key.localeCompare(b.key)),
    batches: batches.map(batch => batch.map(keyOf)), ...(route ? { route } : {}) });
}
