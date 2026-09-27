import { parseFc27SbcRequirements } from './sbc-requirements.js';

const validId = value => Number.isSafeInteger(value) && value > 0;
const levels = Object.freeze([{ level: 'bronze', min: 1, max: 64 },
  { level: 'silver', min: 65, max: 74 }, { level: 'gold', min: 75, max: 99 }]);
const stop = reason => ({ status: 'blocked', reason, queries: [], complete: false, executable: false });

// A route is a bounded sample, not a proof that the market contains every
// solution. The first lane targets an explicit requirement; another lane
// retains general fillers for chemistry and position combinations.
export function planFc27MarketQueryRoute({ challenge, policy } = {}) {
  const required = challenge?.slotCount - (challenge?.brickIndices?.length ?? NaN);
  const parsed = parseFc27SbcRequirements(challenge?.rawRequirements, required);
  if (parsed.status !== 'observed') return stop(parsed.reason);
  if (!Number.isSafeInteger(policy?.maxRating) || policy.maxRating < 1 || policy.maxRating > 99
      || !Array.isArray(policy.excludedLeagueIds)) return stop('FC27_MARKET_POLICY_UNVERIFIED');

  const allowed = levels.filter(({ min, max }) => min <= policy.maxRating
    && !parsed.rules.some(rule => rule.kind === 'all-quality' && (max < rule.minRating || min > rule.maxRating)
      || rule.kind === 'min-quality' && max < rule.minRating
      || rule.kind === 'max-quality' && min > rule.maxRating));
  if (!allowed.length) return stop('FC27_MARKET_QUALITY_UNAVAILABLE');
  const priority = level => {
    const quality = level === 'bronze' ? 1 : level === 'silver' ? 2 : 3;
    return Math.max(0, ...parsed.rules.filter(rule => rule.kind === 'quality-count' && rule.mode === 'min'
      && rule.qualities.includes(quality)).map(rule => rule.count));
  };
  allowed.sort((a, b) => priority(b.level) - priority(a.level) || a.min - b.min);

  const identities = parsed.rules.filter(rule => rule.mode === 'min' && rule.count > 0
    && ['from-nations', 'from-leagues', 'from-clubs'].includes(rule.kind));
  const fields = { 'from-nations': 'nation', 'from-leagues': 'league', 'from-clubs': 'team' };
  const anchors = identities.flatMap(rule => rule.ids.filter(validId).slice(0, 2)
    .map(id => ({ [fields[rule.kind]]: id })));
  const queries = [];
  const add = query => { if (queries.length < 3 && !queries.some(old => JSON.stringify(old) === JSON.stringify(query))) queries.push(query); };
  for (const anchor of anchors.slice(0, 2)) add({ start: 0, count: 20, level: allowed[0].level, ...anchor });
  for (const { level } of allowed) add({ start: 0, count: 20, level });
  return { status: 'ready', queries, complete: false, executable: false,
    reasons: ['BOUNDED_CATALOG_SAMPLE', 'MARKET_QUOTES_NOT_YET_READ'] };
}

export function selectFc27MarketQuoteVersions({ pages, inventory, policy, limit = 4 } = {}) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 3
      || !Array.isArray(inventory?.items) || !Array.isArray(policy?.excludedLeagueIds)
      || !Number.isSafeInteger(policy.maxRating) || !Number.isSafeInteger(limit) || limit < 1 || limit > 4) {
    return stop('FC27_MARKET_ROUTE_INPUT_INVALID');
  }
  const owned = new Set(inventory.items.map(item => item.definitionId));
  const nationCounts = new Map(); const leagueCounts = new Map();
  for (const item of inventory.items) {
    if (validId(item.nationId)) nationCounts.set(item.nationId, (nationCounts.get(item.nationId) ?? 0) + 1);
    if (validId(item.leagueId)) leagueCounts.set(item.leagueId, (leagueCounts.get(item.leagueId) ?? 0) + 1);
  }
  const seen = new Set(); const candidates = [];
  for (const page of pages) {
    if (page?.status !== 'observed' || page.season !== '27' || page.source !== 'ea-defid'
        || !Array.isArray(page.entries) || page.entries.length > 20 || page.complete !== false) {
      return stop('FC27_MARKET_CATALOG_UNVERIFIED');
    }
    for (const item of page.entries) {
      if (!validId(item?.definitionId) || seen.has(item.definitionId)) continue;
      seen.add(item.definitionId);
      if (owned.has(item.definitionId) || item.special !== false || item.evolution !== false
          || item.cosmetic !== false || ![0, 1].includes(item.rarity)
          || !Number.isSafeInteger(item.rating) || item.rating > policy.maxRating
          || !validId(item.nationId) || !validId(item.leagueId) || !validId(item.teamId)
          || policy.excludedLeagueIds.includes(item.leagueId)
          || !Array.isArray(item.positions) || !item.positions.length || !Array.isArray(item.groups)) continue;
      candidates.push(item);
    }
  }
  candidates.sort((a, b) => (nationCounts.get(b.nationId) ?? 0) - (nationCounts.get(a.nationId) ?? 0)
    || (leagueCounts.get(b.leagueId) ?? 0) - (leagueCounts.get(a.leagueId) ?? 0)
    || a.rating - b.rating || a.definitionId - b.definitionId);
  // Retain a representative of each queried requirement lane before filling
  // the remaining quote budget by affinity. Otherwise generic fillers can
  // crowd out every version from the very requirement that drove the query.
  // This is sampling diversity, not evidence that a purchase is needed.
  const selected = new Set();
  const fields = { nation: 'nationId', league: 'leagueId', team: 'teamId' };
  for (const page of pages) {
    if (selected.size >= limit) break;
    const filters = Object.entries(fields).filter(([key]) => validId(page.query?.[key]));
    if (!filters.length) continue;
    const ids = new Set(page.entries.map(item => item.definitionId));
    const representative = candidates.find(item => ids.has(item.definitionId)
      && filters.every(([key, field]) => item[field] === page.query[key]));
    if (representative) selected.add(representative.definitionId);
  }
  for (const item of candidates) {
    if (selected.size >= limit) break;
    selected.add(item.definitionId);
  }
  return { status: 'ready', definitionIds: [...selected],
    observedVersions: seen.size, eligibleVersions: candidates.length, queriedVersions: Math.min(limit, candidates.length),
    complete: false, executable: false };
}
