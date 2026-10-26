import { normalizeGalleryCatalog } from './catalog.js';
import { galleryCumulativeRewardQuantity } from './catalog-rewards.js';

const invalid = () => { throw Error('FC27_FODDER_REFERENCE_INVALID'); };
const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
const key = (category, slug) => `${category}/${slug}`;
const signature = set => JSON.stringify([set.slug, set.name, set.requiredCards,
  set.grades.map(grade => [grade.name, grade.threshold, galleryCumulativeRewardQuantity(set, grade.threshold, 'event_token_1')])]);

// Public, empty-collection proposals only. These prices never become quotes
// or spending authority; the local account is not an input to this parser.
export function normalizeFodderPlanningReference(index, input, { platform, fetchedAt } = {}) {
  if (!['pc', 'console'].includes(platform) || !integer(fetchedAt) || !Array.isArray(input?.sets) || input.sets.length > 4096) invalid();
  const catalog = normalizeGalleryCatalog('fodder', index), sets = [], seen = new Set();
  const definitions = new Map(catalog.categories.flatMap(category => category.sets.map(set => [key(category.slug, set.slug), set])));
  for (const row of input.sets) {
    const id = key(row?.category, row?.slug), set = definitions.get(id);
    if (!set || seen.has(id) || row.required !== set.requiredCards || row.count !== 0 || row.total !== 0 || row.full !== false
        || !Array.isArray(row.grades) || row.grades.length !== 5) invalid();
    seen.add(id); const grades = [], names = new Set();
    for (const grade of row.grades) {
      const definition = set.grades.find(g => g.name === grade?.grade);
      if (!definition || names.has(grade.grade) || grade.tokens !== (definition.rewards[0]?.value ?? 0)) invalid();
      names.add(grade.grade);
      if (grade.cost === null) { grades.push({ grade: grade.grade, cost: null, ids: [] }); continue; }
      if (!integer(grade.cost, 1, 1000000000) || !integer(grade.total, 0, 10000000000)
          || !Array.isArray(grade.ids) || grade.ids.length < set.requiredCards || grade.ids.length > 2000
          || grade.ids.some(id => !integer(id, 1)) || new Set(grade.ids).size !== grade.ids.length
          || !Array.isArray(grade.prices) || grade.prices.length !== grade.ids.length
          || grade.prices.some(price => !integer(price, 150, 15000000))
          || grade.prices.reduce((sum, price) => sum + price, 0) !== grade.cost) invalid();
      grades.push({ grade: grade.grade, cost: grade.cost, total: grade.total, ids: [...grade.ids], prices: [...grade.prices] });
    }
    sets.push({ key: id, set, grades });
  }
  return { source: 'fodder', basis: 'empty-collection-public-reference', platform, fetchedAt,
    expiresAt: fetchedAt + 300000, marketObservedAt: null, sets };
}

export function attachFodderPlanningReferences(targets, snapshot, now = Date.now()) {
  if (snapshot?.basis !== 'empty-collection-public-reference' || snapshot.expiresAt <= now) return targets;
  const groups = new Map();
  for (const row of snapshot.sets) { const s = signature(row.set); groups.set(s, [...(groups.get(s) ?? []), row]); }
  const localCounts = new Map();
  for (const target of targets) { const s = signature(target.set); localCounts.set(s, (localCounts.get(s) ?? 0) + 1); }
  return targets.map(target => {
    const s = signature(target.set), matches = groups.get(s);
    return matches?.length === 1 && localCounts.get(s) === 1 ? { ...target,
      publicReference: { source: snapshot.source, basis: snapshot.basis, platform: snapshot.platform,
        fetchedAt: snapshot.fetchedAt, expiresAt: snapshot.expiresAt, marketObservedAt: null, grades: matches[0].grades } } : target;
  });
}

// Forecast-only prices. Keep them out of freshPrices, approval and per-club
// quote stores. Conflicting observations of an exact version use the higher
// value consistently across all sets; an unknown value is never zero.
export function forecastFodderReferencePrices(targets, now = Date.now()) {
  const prices = {}, conflicts = new Set(), platforms = new Set();
  let expiresAt = Infinity, fetchedAt = Infinity;
  for (const target of targets) {
    const reference = target.publicReference;
    if (reference?.basis !== 'empty-collection-public-reference' || reference.expiresAt <= now) continue;
    platforms.add(reference.platform); expiresAt = Math.min(expiresAt, reference.expiresAt); fetchedAt = Math.min(fetchedAt, reference.fetchedAt);
    for (const grade of reference.grades) {
      if (grade.cost == null) continue;
      if (!Array.isArray(grade.prices) || grade.prices.length !== grade.ids.length
          || grade.prices.some(price => !integer(price, 150, 15000000))) invalid();
      grade.ids.forEach((id, i) => {
        if (!integer(id, 1)) invalid();
        if (prices[id] != null && prices[id] !== grade.prices[i]) conflicts.add(id);
        prices[id] = Math.max(prices[id] ?? 0, grade.prices[i]);
      });
    }
  }
  if (platforms.size > 1) invalid();
  return targets.map(target => ({ ...target, priceSnapshot: null,
    prices: target.publicReference?.expiresAt > now ? { ...prices } : {}, forecastPriceBasis: 'fodder-public-estimate',
    forecastPriceExpiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    forecastPriceFetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null, forecastPriceConflictCount: conflicts.size }));
}
