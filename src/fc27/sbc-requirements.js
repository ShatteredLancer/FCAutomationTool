// FC27 SBC eligibility facts and pure matching.
//
// The numeric ids below are the EA runtime contract observed in the FC27
// compiled bundle.  This module never uses names or challenge titles as a
// substitute for those ids.  Unknown ids stay in the returned contract and
// make executable matching unsupported until a later observation reviews them.

export const FC27_SBC_SCOPE = Object.freeze({ GREATER: 0, LOWER: 1, EXACT: 2 });

export const FC27_SBC_KEY = Object.freeze({
  QUALITY: 3,
  SAME_NATION: 4,
  SAME_LEAGUE: 5,
  SAME_CLUB: 6,
  DISTINCT_NATIONS: 7,
  DISTINCT_LEAGUES: 8,
  DISTINCT_CLUBS: 9,
  NATION_ID: 10,
  LEAGUE_ID: 11,
  CLUB_ID: 12,
  RARE: 18,
  TEAM_RATING: 19,
  RARITY_GROUP: 25,
  MIN_OVR: 26,
  EXACT_OVR: 27,
  MAX_OVR: 28,
  LEVEL: 17,
  CHEMISTRY: 35,
});

const qualityBounds = Object.freeze({
  1: Object.freeze([1, 64]),
  2: Object.freeze([65, 74]),
  3: Object.freeze([75, 99]),
});

const integer = value => Number.isSafeInteger(value);
const nonnegative = value => integer(value) && value >= 0;
const positive = value => integer(value) && value > 0;
const valuesOf = pair => Array.isArray(pair?.values) ? pair.values.filter(integer) : [];
const firstPair = rule => Array.isArray(rule?.pairs) && rule.pairs.length === 1 ? rule.pairs[0] : null;

function normalizedScope(scope) {
  return [0, 1, 2].includes(scope) ? scope : null;
}

const countMode = scope => scope === 0 ? 'min' : scope === 1 ? 'max' : 'exact';

function relationKind(key) {
  return ({
    4: 'same-nation', 5: 'same-league', 6: 'same-club',
    7: 'distinct-nations', 8: 'distinct-leagues', 9: 'distinct-clubs',
  })[key] ?? null;
}

function relationRule(key, value, scope, required) {
  const kind = relationKind(key);
  if (!kind || !positive(value) || normalizedScope(scope) === null) return null;
  const mode = scope === FC27_SBC_SCOPE.GREATER ? 'min'
    : scope === FC27_SBC_SCOPE.LOWER ? 'max' : 'exact';
  return { kind, value, mode, count: required, source: { key, scope, values: [value], count: -1 } };
}

function requirementSource(rule, pair, required) {
  return Object.freeze({ key: pair?.key ?? null, scope: rule?.scope ?? null,
    values: Array.isArray(pair?.values) ? [...pair.values] : [],
    pairs: Array.isArray(rule?.pairs) ? rule.pairs.map(value => ({
      key: value?.key ?? null, values: Array.isArray(value?.values) ? [...value.values] : [],
    })) : [], count: rule?.count ?? null, required });
}

function unsupported(rule, pair, required, reason = 'unknown-key') {
  return { kind: 'unsupported', key: pair?.key ?? null, reason,
    source: requirementSource(rule, pair, required) };
}

/**
 * Parse the raw catalog representation into stable pure rules.
 * `required` is the number of playable slots, not a guess from a title.
 */
export function parseFc27SbcRequirements(rawRequirements, required) {
  if (!Array.isArray(rawRequirements) || !rawRequirements.length || rawRequirements.length > 16
      || !positive(required) || required > 11) {
    return { status: 'blocked', reason: 'FC27_REQUIREMENTS_UNVERIFIED', rules: [], unsupported: [] };
  }
  const rules = [];
  const unsupportedRules = [];
  for (const raw of rawRequirements) {
    const pair = firstPair(raw);
    const scope = normalizedScope(raw?.scope);
    const values = valuesOf(pair);
    const source = requirementSource(raw, pair, required);
    let parsed = null;
    if (!pair || !integer(pair.key) || scope === null || values.length !== (pair.values?.length ?? -1)
        || !values.length || values.length > 32 || new Set(values).size !== values.length) {
      parsed = unsupported(raw, pair, required, 'shape');
    } else {
      const key = pair.key;
      const count = nonnegative(raw.count) && raw.count <= required ? raw.count : null;
      const mode = countMode(scope);
      const value = values[0];
      switch (key) {
        case FC27_SBC_KEY.QUALITY: {
          const bounds = qualityBounds[value];
          if (!bounds || values.length !== 1 || raw.count !== -1) parsed = unsupported(raw, pair, required, 'quality-shape');
          else if (scope === FC27_SBC_SCOPE.EXACT) {
            parsed = { kind: 'all-quality', quality: value, minRating: bounds[0], maxRating: bounds[1], count: required, source };
          } else if (scope === FC27_SBC_SCOPE.GREATER) {
            parsed = { kind: 'min-quality', quality: value, count: required, minRating: bounds[0], source };
          } else {
            parsed = { kind: 'max-quality', quality: value, count: required, maxRating: bounds[1], source };
          }
          break;
        }
        case FC27_SBC_KEY.LEVEL:
          parsed = count !== null && values.every(v => qualityBounds[v])
            ? { kind: 'quality-count', qualities: [...values], mode: scope === FC27_SBC_SCOPE.GREATER ? 'min'
              : scope === FC27_SBC_SCOPE.LOWER ? 'max' : 'exact', count, source }
            : unsupported(raw, pair, required, 'quality-count-shape');
          break;
        case FC27_SBC_KEY.MIN_OVR:
        case FC27_SBC_KEY.EXACT_OVR:
        case FC27_SBC_KEY.MAX_OVR:
          parsed = count !== null && values.length === 1 && value >= 1 && value <= 99
            ? { kind: key === 26 ? 'player-min-overall' : key === 27 ? 'player-exact-overall' : 'player-max-overall', value, count, mode, source }
            : unsupported(raw, pair, required, 'overall-shape');
          break;
        case FC27_SBC_KEY.NATION_ID:
        case FC27_SBC_KEY.LEAGUE_ID:
        case FC27_SBC_KEY.CLUB_ID:
          parsed = count !== null && values.every(positive)
            ? { kind: key === 10 ? 'from-nations' : key === 11 ? 'from-leagues' : 'from-clubs', ids: [...values], count,
              mode: scope === FC27_SBC_SCOPE.GREATER ? 'min' : scope === FC27_SBC_SCOPE.LOWER ? 'max' : 'exact', source }
            : unsupported(raw, pair, required, 'identity-shape');
          break;
        case FC27_SBC_KEY.RARE:
          parsed = count !== null && values.length === 1 && value === 1
            ? { kind: 'rare', count, mode, source } : unsupported(raw, pair, required, 'rare-shape');
          break;
        case FC27_SBC_KEY.RARITY_GROUP:
          parsed = count !== null && values.length === 1 && positive(value)
            ? { kind: 'rarity-group', groupId: value, count, mode, source } : unsupported(raw, pair, required, 'group-shape');
          break;
        case FC27_SBC_KEY.TEAM_RATING:
          parsed = raw.count === -1 && values.length === 1 && value >= 1 && value <= 99
            ? { kind: `${mode}-team-rating`, value, source }
            : unsupported(raw, pair, required, 'team-rating-shape');
          break;
        case FC27_SBC_KEY.CHEMISTRY:
          parsed = raw.count === -1 && values.length === 1 && value >= 0 && value <= 33
            ? { kind: `${mode}-chemistry`, value, source } : unsupported(raw, pair, required, 'chemistry-shape');
          break;
        default: {
          const relation = raw.count === -1 && values.length === 1 && value <= required
            ? relationRule(key, value, scope, required) : null;
          parsed = relation ? { ...relation, source } : unsupported(raw, pair, required);
        }
      }
    }
    rules.push(parsed);
    if (parsed.kind === 'unsupported') unsupportedRules.push(parsed);
  }
  return { status: unsupportedRules.length ? 'unsupported' : 'observed', reason: unsupportedRules.length ? 'FC27_REQUIREMENT_UNSUPPORTED' : 'FC27_REQUIREMENTS_PARSED', rules, unsupported: unsupportedRules };
}

function itemValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (integer(value)) return value;
  }
  return null;
}

function itemQuality(item) {
  if ([1, 2, 3].includes(item?.quality)) return item.quality;
  const rating = itemValue(item, ['rating', 'overall', 'ovr']);
  if (!integer(rating) || rating < 1 || rating > 99) return null;
  return rating <= 64 ? 1 : rating <= 74 ? 2 : 3;
}

function relationResult(values, rule) {
  if (values.some(value => value === null)) return null;
  const count = new Map();
  for (const value of values) if (value !== null) count.set(value, (count.get(value) ?? 0) + 1);
  const observed = rule.kind.startsWith('distinct-') ? count.size : Math.max(0, ...count.values());
  if (rule.mode === 'min') return observed >= rule.value;
  if (rule.mode === 'max') return observed <= rule.value;
  return observed === rule.value;
}

function compareCount(actual, expected, mode) {
  return mode === 'min' ? actual >= expected : mode === 'max' ? actual <= expected : actual === expected;
}

// Complete observed TeamConfig links are required for club semantics. An explicit
// empty list is valid; missing/truncated data must not mean "no linked teams".
export function createFc27ClubResolver(clubLinks) {
  if (clubLinks?.schema !== 1 || clubLinks.complete !== true || !Array.isArray(clubLinks.links)
      || clubLinks.links.length > 20000 || clubLinks.links.some(pair => !Array.isArray(pair)
        || pair.length !== 2 || !pair.every(positive))) return null;
  const links = new Map(clubLinks.links);
  if (links.size !== clubLinks.links.length) return null;
  return id => positive(id) ? links.get(id) ?? id : null;
}

// Individual predicates are shared by constraint propagation and the final matcher.
// Relations and team facts deliberately have no single-player interpretation.
export function matchFc27SbcItemRule(rule, item, groupMatcher, clubResolver) {
  if (!['all-quality', 'min-quality', 'max-quality', 'quality-count', 'player-min-overall',
    'player-exact-overall', 'player-max-overall', 'from-nations', 'from-leagues', 'from-clubs',
    'rare', 'rarity-group'].includes(rule?.kind)) return null;
  return ruleResult({ ...rule, count: 1, mode: 'min' }, [item], { groupMatcher, clubResolver });
}

function ruleResult(rule, squad, options) {
  const players = squad;
  const ids = keys => players.map(item => {
    const value = itemValue(item, keys);
    return positive(value) ? value : null;
  });
  const countMatches = (values, predicate) => values.some(value => value === null) ? null
    : compareCount(values.filter(predicate).length, rule.count, rule.mode ?? 'min');
  const clubIds = () => typeof options.clubResolver === 'function'
    ? ids(['teamId', 'clubId']).map(options.clubResolver) : players.map(() => null);
  switch (rule.kind) {
    case 'all-quality': return countMatches(players.map(itemQuality), value => value === rule.quality);
    case 'min-quality': return countMatches(players.map(itemQuality), value => value >= rule.quality);
    case 'quality-count': {
      const qualities = players.map(itemQuality);
      if (qualities.some(value => value === null)) return null;
      const matches = qualities.filter(quality => {
        return rule.qualities.includes(quality);
      }).length;
      return compareCount(matches, rule.count, rule.mode);
    }
    case 'max-quality': return countMatches(players.map(itemQuality), value => value <= rule.quality);
    case 'player-min-overall':
    case 'player-exact-overall':
    case 'player-max-overall': return countMatches(players.map(item => {
      const rating = itemValue(item, ['rating', 'overall', 'ovr']);
      return integer(rating) && rating >= 1 && rating <= 99 ? rating : null;
    }), value => rule.kind === 'player-min-overall' ? value >= rule.value
      : rule.kind === 'player-max-overall' ? value <= rule.value : value === rule.value);
    case 'from-nations': return countMatches(ids(['nationId', 'nation']), value => rule.ids.includes(value));
    case 'from-leagues': return countMatches(ids(['leagueId', 'league']), value => rule.ids.includes(value));
    case 'from-clubs': {
      if (typeof options.clubResolver !== 'function') return null;
      const allowed = new Set([...rule.ids, ...rule.ids.map(options.clubResolver)]);
      return countMatches(clubIds(), value => allowed.has(value));
    }
    case 'rare': return countMatches(players.map(item => {
      const rarity = itemValue(item, ['rarity', 'rareflag']);
      return nonnegative(rarity) ? rarity === 1 : null;
    }), value => value === true);
    case 'rarity-group': return countMatches(players.map(item => {
      if (typeof options.groupMatcher === 'function') {
        try {
          const result = options.groupMatcher(item, rule.groupId);
          return typeof result === 'boolean' ? result : null;
        } catch { return null; }
      }
      return Array.isArray(item?.groups) && item.groups.every(nonnegative)
        ? item.groups.includes(rule.groupId) : null;
    }), value => value === true);
    case 'min-team-rating':
    case 'max-team-rating':
    case 'exact-team-rating': return integer(options.teamRating) && options.teamRating >= 0 && options.teamRating <= 99
      ? compareCount(options.teamRating, rule.value, rule.kind.split('-')[0]) : null;
    case 'min-chemistry':
    case 'max-chemistry':
    case 'exact-chemistry': return integer(options.chemistry) && options.chemistry >= 0 && options.chemistry <= 33
      ? compareCount(options.chemistry, rule.value, rule.kind.split('-')[0]) : null;
    case 'same-nation': return relationResult(ids(['nationId', 'nation']), rule);
    case 'same-league': return relationResult(ids(['leagueId', 'league']), rule);
    case 'same-club': return relationResult(clubIds(), rule);
    case 'distinct-nations': return relationResult(ids(['nationId', 'nation']), rule);
    case 'distinct-leagues': return relationResult(ids(['leagueId', 'league']), rule);
    case 'distinct-clubs': return relationResult(clubIds(), rule);
    default: return null;
  }
}

export function matchFc27SbcRequirements({ requirements, squad, chemistry, teamRating, groupMatcher, clubLinks } = {}) {
  if (!Array.isArray(requirements) || !requirements.length || !Array.isArray(squad)
      || !squad.length || squad.length > 11 || Array.from(squad).some(item => !item || typeof item !== 'object')
      || requirements.some(rule => !rule || rule.source?.required !== squad.length)) {
    return { status: 'blocked', reason: 'FC27_REQUIREMENTS_UNVERIFIED', satisfied: false, failures: [] };
  }
  const unsupportedRules = requirements.filter(rule => rule?.kind === 'unsupported');
  if (unsupportedRules.length) return { status: 'unsupported', reason: 'FC27_REQUIREMENT_UNSUPPORTED', satisfied: false, failures: unsupportedRules };
  const options = { chemistry, teamRating, groupMatcher, clubResolver: createFc27ClubResolver(clubLinks) };
  const failures = requirements.map((rule, index) => ({ rule, index, result: ruleResult(rule, squad, options) }))
    .filter(entry => entry.result !== true);
  const unavailable = failures.filter(entry => entry.result === null);
  return { status: unavailable.length ? 'blocked' : failures.length ? 'unsatisfied' : 'satisfied',
    reason: unavailable.length ? 'FC27_REQUIREMENT_VALUE_UNAVAILABLE' : failures.length ? 'FC27_REQUIREMENTS_NOT_MET' : null,
    satisfied: !failures.length, failures: failures.map(({ rule, index }) => ({ index, rule })) };
}
