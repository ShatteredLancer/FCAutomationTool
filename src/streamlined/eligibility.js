import { integer } from './contract.js';

export function createStreamlinedEligibility({ matcher = null, rules = null } = {}) {
  const known = Array.isArray(rules) && (rules.length === 0 || typeof matcher === 'function');
  return Object.freeze({ known, matches(item) {
    if (!known) return { status: 'unknown', reason: 'FC27_STREAMLINED_ELIGIBILITY_UNVERIFIED' };
    try {
      const result = rules.length ? matcher(item, rules) : true;
      return { status: result === true ? 'eligible' : result === false ? 'ineligible' : 'unknown' };
    } catch { return { status: 'unknown' }; }
  } });
}

export function filterStreamlinedItems(items, { eligibility, policy } = {}) {
  const blocked = reason => ({ status: 'blocked', reason: `FC27_STREAMLINED_${reason}`, items: [], excluded: {}, excludedRows: [] });
  if (!Array.isArray(items) || items.length > 20000 || !eligibility?.known) return blocked('ELIGIBILITY_UNVERIFIED');
  if (!policy || !integer(policy.maxRating, 1, 99) || !Array.isArray(policy.goldRange) || policy.goldRange.length !== 2
      || policy.goldRange.some(v => !integer(v, 75, 99)) || policy.goldRange[0] > policy.goldRange[1]
      || !Array.isArray(policy.excludedLeagueIds) || policy.excludedLeagueIds.some(v => !integer(v, 1))
      || ['onlyUntradeable', 'protectFsuLockedPlayers', 'protectActiveSquad', 'storageFirst'].some(key => typeof policy[key] !== 'boolean')) return blocked('POLICY_UNVERIFIED');
  const excluded = {}, excludedRows = [], accepted = [], keys = new Set(), ids = new Set();
  for (const item of items) {
    if (!item || !integer(item.definitionId, 1) || !['inventory', 'market'].includes(item.source)
        || typeof item.key !== 'string' || keys.has(item.key)
        || item.source === 'inventory' && (!integer(item.id, 1) || ids.has(item.id))) return blocked('IDENTITY_CONFLICT');
    keys.add(item.key); if (item.source === 'inventory') ids.add(item.id);
    const checks = [
      ['points-unknown', integer(item.points, 1, 1e9) && item.scoreVerified === true],
      ['rating', integer(item.rating, 1, policy.maxRating)],
      ['fsu-gold-range', item.rating < 75 || integer(item.rating, ...policy.goldRange)],
      ['special', item.special === false], ['evolution', item.evolution === false], ['cosmetic', item.cosmetic === false],
      ['academy', item.academyEnrolled === false], ['protected', item.protected === false],
      ['league', integer(item.leagueId, 1) && !policy.excludedLeagueIds.includes(item.leagueId)],
    ];
    if (item.source === 'inventory') checks.push(
      ['pile', ['club', 'storage'].includes(item.pile)], ['concept', item.concept === false],
      ['trade', item.activeTrade === false], ['loan', item.limitedUse === false && item.loans === -1],
      ['untradeable', typeof item.tradeable === 'boolean' && (!policy.onlyUntradeable || item.tradeable === false)],
      ['locked', !policy.protectFsuLockedPlayers || item.locked === false],
      ['active-squad', !policy.protectActiveSquad || item.activeSquad === false]);
    let reason = checks.find(([, passed]) => !passed)?.[0];
    if (!reason) { const result = eligibility.matches(item); if (result.status !== 'eligible') reason = `eligibility-${result.status}`; }
    if (reason) { excluded[reason] = (excluded[reason] ?? 0) + 1; excludedRows.push({ key: item.key, reason }); }
    else accepted.push(item);
  }
  return { status: 'observed', items: accepted, excluded, excludedRows };
}
