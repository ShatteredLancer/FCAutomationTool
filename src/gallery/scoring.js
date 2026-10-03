// Independent implementation of observed public Gallery scoring behavior.
// FUT.GG supplies definitions; Fodder supplies lineup/bonus behavior. A local
// grade and provisional Club evidence do not confirm EA reward state.
const fields = Object.freeze({ NATION: 'nationEaId', CLUB: 'clubEaId', LEAGUEID: 'leagueEaId',
  BASE_DEF_ID: 'playerEaId', LEVEL: 'overall', RARE: 'rarityEaId', HYPER_COSMETIC_TYPE: 'holographic',
  FIRST_OWNED: 'firstOwned', POSSIBLE_POSITIONS: 'positions', WEAK_FOOT: 'weakFoot', SKILL_MOVES: 'skillMoves' });
const grouped = new Set(['NATION', 'CLUB', 'LEAGUEID', 'BASE_DEF_ID']);
const fail = reason => ({ status: 'unavailable', reason, grade: null });
const validScore = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
const sum = rows => rows.reduce((total, row) => total + row.gradingScore, 0);
const order = (a, b) => b.gradingScore - a.gradingScore || a.eaId - b.eaId;
const bonusFor = (score, percent) => Math.floor(score * percent / 100);
const tierFor = (tiers, count) => tiers.filter(tier => count >= tier.at).at(-1);

export function compileGalleryScoringRules({ source, tags } = {}) {
  if (source !== 'futgg' || !Array.isArray(tags) || !tags.length || tags.length > 256) return fail('rules-unavailable');
  const result = [], ids = new Set();
  for (const tag of tags) {
    const rule = tag?.rules?.length === 1 ? tag.rules[0] : null;
    if (!Number.isSafeInteger(tag?.id) || ids.has(tag.id) || !rule || !fields[rule.attribute]
        || tag.bonusType !== 'ITEM_SCORE_PERCENTAGE' || tag.thresholdType !== 'ITEM_COUNT'
        || rule.target !== (rule.attribute === 'BASE_DEF_ID' ? 'BASE_DEF_ID' : 'ATTRIBUTE')
        || !Array.isArray(rule.values) || !rule.values.length) return fail('unknown-rule');
    const isGroup = grouped.has(rule.attribute), isMinimum = ['WEAK_FOOT', 'SKILL_MOVES'].includes(rule.attribute);
    if (isGroup ? !['MAX_COUNT_ALL_SAME', 'COUNT_DIFF'].includes(rule.type)
      : isMinimum ? rule.type !== 'MIN_COUNT' : !['COUNT', 'COUNT_ANY'].includes(rule.type)) return fail('unknown-rule');
    const values = rule.values.map(String);
    if (isMinimum && (values.length !== 1 || !/^\d+$/.test(values[0]))
        || isGroup && (values.length !== 1 || values[0] !== '0')
        || rule.attribute === 'FIRST_OWNED' && (values.length !== 1 || values[0] !== '1')
        || rule.attribute === 'HYPER_COSMETIC_TYPE' && (values.length !== 2 || !values.includes('0') || !values.includes('1'))
        || rule.attribute === 'LEVEL' && values.some(value => !['gold', 'silver', 'bronze'].includes(value))) return fail('unknown-values');
    if (!Array.isArray(tag.tiers) || !tag.tiers.length) return fail('tiers-unavailable');
    const tiers = tag.tiers.map(tier => ({ at: tier.minItems, pct: tier.bonus })).sort((a, b) => a.at - b.at);
    if (tiers.some((tier, i) => !Number.isSafeInteger(tier.at) || tier.at < 1 || !Number.isFinite(tier.pct)
      || tier.pct < 0 || tier.pct > 100000 || i > 0 && (tier.at === tiers[i - 1].at || tier.pct < tiers[i - 1].pct))) return fail('tiers-invalid');
    ids.add(tag.id);
    result.push({ id: tag.id, name: tag.name, field: fields[rule.attribute],
      mode: isGroup ? rule.type === 'COUNT_DIFF' ? 'different' : 'same' : isMinimum ? 'minimum' : 'match',
      values, threshold: isMinimum ? Number(values[0]) + (rule.attribute === 'SKILL_MOVES' ? 1 : 0) : null, tiers });
  }
  return { status: 'ready', tags: result };
}

function attribute(row, field) {
  const value = row[field];
  if (value == null) return null;
  if (field === 'overall') return value >= 75 ? 'gold' : value >= 65 ? 'silver' : 'bronze';
  return value;
}
function matches(row, tag) {
  const value = attribute(row, tag.field);
  if (value == null) return null;
  if (['firstOwned', 'holographic'].includes(tag.field)) return value === true;
  if (tag.mode === 'minimum') return Number(value) >= tag.threshold;
  return (Array.isArray(value) ? value : [value]).some(item => tag.values.includes(String(item)));
}
// Membership keys for cost-planning seeds use exactly the scoring matcher.
// In particular LEVEL means bronze/silver/gold, not each individual rating.
export function galleryRuleKeys(row, tags) {
  return tags.flatMap(tag => {
    if (tag.mode === 'same' || tag.mode === 'different') {
      const value = attribute(row, tag.field);
      return value == null ? [] : [`${tag.id}:${value}`];
    }
    return matches(row, tag) === true ? [`${tag.id}:match`] : [];
  });
}
function groupsOf(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = attribute(row, field);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}
function matchTag(rows, tag, { unknown = 'low', groupMode = 'fodder' } = {}) {
  const unknownRows = rows.filter(row => attribute(row, tag.field) == null);
  if (!['same', 'different'].includes(tag.mode)) {
    const cards = rows.filter(row => matches(row, tag) ?? unknown === 'high');
    return { count: cards.length, cards, unknown: unknownRows.length };
  }
  const groups = groupsOf(rows, tag.field);
  // A loose high scenario for unknown grouping fields, never an invented ID.
  if (unknown === 'high' && unknownRows.length) return { count: rows.length, cards: rows, unknown: unknownRows.length };
  if (tag.mode === 'different') return { count: groups.length,
    cards: groups.map(group => group.slice().sort(order)[0]), unknown: unknownRows.length };
  if (tag.field === 'playerEaId' && groupMode === 'fodder') {
    const qualifying = groups.filter(group => group.length >= tag.tiers[0].at);
    if (qualifying.length) return { count: Math.max(...qualifying.map(group => group.length)), cards: qualifying.flat(), unknown: unknownRows.length };
  }
  const value = group => bonusFor(sum(group), tierFor(tag.tiers, group.length)?.pct ?? 0);
  groups.sort((a, b) => (groupMode === 'fodder' ? value(b) - value(a) : 0) || b.length - a.length || sum(b) - sum(a));
  return { count: groups[0]?.length ?? 0, cards: groups[0] ?? [], unknown: unknownRows.length };
}

export function evaluateGalleryLineup(rows, compiled, options = {}) {
  if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row.eaId) || row.eaId < 1 || !validScore(row.gradingScore))
      || new Set(rows.map(row => row.eaId)).size !== rows.length) throw Error('FC27_GALLERY_SCORING_INPUT_INVALID');
  if (compiled?.status !== 'ready') return fail(compiled?.reason ?? 'rules-unavailable');
  const tags = compiled.tags.map(tag => {
    const match = matchTag(rows, tag, options), tier = tierFor(tag.tiers, match.count);
    const next = tag.tiers.find(step => match.count < step.at);
    return { id: tag.id, name: tag.name, count: match.count, matched: sum(match.cards),
      pct: tier?.pct ?? 0, bonus: bonusFor(sum(match.cards), tier?.pct ?? 0),
      unknown: match.unknown, counted: false, matchedEaIds: match.cards.map(row => row.eaId),
      next: next ? { ...next, needed: next.at - match.count } : null };
  });
  const paid = tags.filter(tag => tag.bonus > 0).sort((a, b) => b.bonus - a.bonus).slice(0, 10);
  for (const tag of paid) tag.counted = true;
  const base = sum(rows), bonus = paid.reduce((total, tag) => total + tag.bonus, 0);
  return { base, bonus, total: base + bonus, tags, lineupIds: rows.map(row => row.eaId) };
}

// Reference behavior: top-base/tag-tier seeds; top60 plus high-bonus candidates;
// top six seeds and single-card improvement. The 8000 evaluation budget is
// checked between complete passes, as in the observed reference implementation.
function* chooseLineupSteps(rows, required, compiled) {
  const base = rows.slice().sort((a, b) => b.gradingScore - a.gradingScore || b.overall - a.overall || a.eaId - b.eaId).slice(0, required);
  if (rows.length <= required || !compiled.tags.length) return base;
  const ranked = rows.slice().sort(order), groups = [];
  for (const tag of compiled.tags) {
    const tiers = tag.tiers.filter(tier => tier.at <= required);
    if (!tiers.length) continue;
    if (tag.mode === 'same') {
      const candidates = groupsOf(ranked, tag.field).sort((a, b) => sum(b.slice(0, required)) - sum(a.slice(0, required))).slice(0, 3);
      for (const cards of candidates) groups.push({ cards, tiers });
    } else if (tag.mode !== 'different') {
      const cards = matchTag(ranked, tag).cards.slice().sort(order);
      if (cards.length) groups.push({ cards, tiers });
    }
  }
  const candidateSet = new Set(ranked.slice(0, 60));
  for (const group of groups) if (group.tiers.at(-1).pct >= 10) {
    for (const row of group.cards.slice(0, group.tiers.at(-1).at)) candidateSet.add(row);
  }
  const candidates = [...candidateSet].sort(order), seeds = [base];
  const key = cards => cards.map(row => row.eaId).sort().join(',');
  const seen = new Set([key(base)]);
  for (const group of groups) for (const tier of group.tiers) {
    if (group.cards.length < tier.at) break;
    const cards = group.cards.slice(0, tier.at), ids = new Set(cards.map(row => row.eaId));
    for (const row of ranked) { if (cards.length >= required) break; if (!ids.has(row.eaId)) { cards.push(row); ids.add(row.eaId); } }
    const identity = key(cards); if (!seen.has(identity)) { seen.add(identity); seeds.push(cards); }
  }
  const score = cards => evaluateGalleryLineup(cards, compiled).total;
  const scoredSeeds = [];
  for (const cards of seeds) { scoredSeeds.push({ cards, total: score(cards) }); yield; }
  const starts = scoredSeeds.sort((a, b) => b.total - a.total).slice(0, 6);
  if (!starts.some(seed => seed.cards === base)) starts.push({ cards: base, total: score(base) });
  let evaluated = 0, best = null;
  for (const seed of starts) {
    let cards = seed.cards.slice(), total = seed.total, improved = true;
    while (improved && evaluated < 8000) {
      improved = false; const ids = new Set(cards.map(row => row.eaId));
      for (let slot = 0; slot < cards.length; slot++) for (const row of candidates) {
        if (ids.has(row.eaId)) continue;
        const next = cards.slice(); next[slot] = row; const value = score(next); evaluated++; yield;
        if (value > total) { ids.delete(cards[slot].eaId); ids.add(row.eaId); cards = next; total = value; improved = true; break; }
      }
    }
    if (!best || total > best.total) best = { cards, total };
  }
  return best.cards.slice().sort(order);
}

export function* summarizeGalleryScoreSteps({ set, catalog, progress }) {
  if (!set || !progress || !Array.isArray(progress.rows) || catalog?.source !== 'futgg'
      || set.id !== `futgg:${progress.setId}` || progress.season !== '27'
      || !Number.isSafeInteger(set.requiredCards) || set.requiredCards < 1) return fail('input-invalid');
  const compiled = compileGalleryScoringRules(catalog);
  if (compiled.status !== 'ready') return compiled;
  const collected = progress.rows.filter(row => row.collected === true);
  const collectionUnknown = !progress.complete || progress.rows.some(row => row.collected == null);
  const scoreUnknown = collected.some(row => !validScore(row.gradingScore));
  if (scoreUnknown) return { status: 'partial', reason: 'base-score-unknown', full: false, grade: null };
  if (new Set(progress.rows.map(row => row.eaId)).size !== progress.rows.length) return fail('duplicate-version');
  // The reference excludes collected versions with zero gradingScore from
  // scoring lineups. Keep them in collection progress, not in grade fullness.
  const rows = collected.filter(row => row.gradingScore > 0);
  const lineup = yield* chooseLineupSteps(rows, set.requiredCards, compiled), full = lineup.length >= set.requiredCards;
  const low = evaluateGalleryLineup(lineup, compiled), high = evaluateGalleryLineup(lineup, compiled, { unknown: 'high' });
  const comparison = evaluateGalleryLineup(lineup, compiled, { groupMode: 'futgg' });
  const comparisonHigh = evaluateGalleryLineup(lineup, compiled, { groupMode: 'futgg', unknown: 'high' });
  const ruleDifference = comparison.total !== low.total || comparisonHigh.total !== high.total;
  const unknownFields = [...new Set(compiled.tags.filter(tag => lineup.some(row => attribute(row, tag.field) == null)).map(tag => tag.field))];
  const grades = [...set.grades].sort((a, b) => a.threshold - b.threshold);
  const gradeFor = total => full ? grades.filter(g => total >= g.threshold).at(-1)?.name ?? null : null;
  const next = grades.find(g => low.total < g.threshold) ?? null;
  const uncertain = collectionUnknown || low.total !== high.total || ruleDifference;
  return { status: collectionUnknown ? 'partial' : uncertain ? 'uncertain' : 'calculated', full,
    lineup, selection: rows.length > set.requiredCards ? 'bounded-search' : 'all-collected', low, high,
    grade: uncertain ? null : gradeFor(low.total), lowGrade: gradeFor(low.total), highGrade: gradeFor(high.total),
    nextGrade: next?.name ?? null, pointsToNext: next ? next.threshold - low.total : null,
    missingCards: Math.max(0, set.requiredCards - rows.length), zeroScoreCards: collected.length - rows.length, unknownFields, collectionUnknown,
    ruleDifference, comparison: ruleDifference ? { low: comparison, high: comparisonHigh } : null };
}

// Existing planners keep their synchronous API and identical evaluation order.
export function summarizeGalleryScore(input) {
  const steps = summarizeGalleryScoreSteps(input);
  let next;
  do { next = steps.next(); } while (!next.done);
  return next.value;
}
