// Public version facts, price observations, and EA auctions are separate data.
// This module accepts reviewed provider snapshots, never an unversioned ID lane.
export const FC27_CATALOG_LIMIT = 50000;
export const FC27_QUOTE_TTL = 600000;
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const id = v => integer(v, 1, Number.MAX_SAFE_INTEGER);
const label = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(v);
const fail = reason => ({ status: 'blocked', reason });

export function normalizeFc27PlayerCatalog(value, now) {
  if (!id(now) || value?.schema !== 1 || value.season !== '27'
      || !label(value.source) || !label(value.revision)
      || !['observed-response', 'season-route', 'synthetic-fixture'].includes(value.seasonEvidence)
      || typeof value.complete !== 'boolean' || !id(value.observedAt) || value.observedAt > now
      || now - value.observedAt > 86400000 || !Array.isArray(value.entries)
      || value.entries.length > FC27_CATALOG_LIMIT) return fail('FC27_CATALOG_UNVERIFIED');
  const seen = new Set(); const entries = [];
  for (const row of value.entries) {
    if (!id(row?.definitionId) || seen.has(row.definitionId) || !integer(row.rating, 1, 99)
        || ![row.nationId, row.leagueId, row.teamId].every(id)
        || !integer(row.rarity, 0, 10000) || typeof row.marketable !== 'boolean'
        || ['special', 'evolution', 'cosmetic'].some(key => typeof row[key] !== 'boolean')
        || !Array.isArray(row.positions) || !row.positions.length || row.positions.length > 28
        || Array.from(row.positions).some(p => !integer(p, 0, 27))
        || new Set(row.positions).size !== row.positions.length
        || row.groups !== null && (!Array.isArray(row.groups) || row.groups.length > 256
          || Array.from(row.groups).some(g => !integer(g, 0, 10000))
          || new Set(row.groups).size !== row.groups.length)) return fail('FC27_CATALOG_ENTRY_INVALID');
    seen.add(row.definitionId);
    entries.push(Object.freeze({ catalogRef: `fc27:${row.definitionId}`, definitionId: row.definitionId,
      rating: row.rating, nationId: row.nationId, leagueId: row.leagueId, teamId: row.teamId,
      rarity: row.rarity, positions: Object.freeze([...row.positions]), groups: row.groups === null ? null : Object.freeze([...row.groups]),
      marketable: row.marketable, special: row.special, evolution: row.evolution, cosmetic: row.cosmetic }));
  }
  return { status: 'ready', catalog: Object.freeze({ schema: 1, season: '27', source: value.source,
    revision: value.revision, seasonEvidence: value.seasonEvidence, observedAt: value.observedAt,
    complete: value.complete, entries: Object.freeze(entries) }) };
}

export function indexFc27MarketQuotes(quotes, { now, platform, maxUnitPrice } = {}) {
  if (!id(now) || typeof platform !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(platform)
      || !integer(maxUnitPrice, 0, 10000000) || !Array.isArray(quotes) || quotes.length > FC27_CATALOG_LIMIT * 3) return null;
  const map = new Map();
  for (const quote of quotes) {
    if (quote?.season !== '27' || quote.platform !== platform || !id(quote.definitionId)
        || !integer(quote.price, 1, 10000000) || !label(quote.source)
        || !id(quote.observedAt) || quote.observedAt > now || now - quote.observedAt > FC27_QUOTE_TTL) continue;
    const old = map.get(quote.definitionId);
    // Newest observation wins; equal-time conflicts use the conservative price.
    if (!old || old.observedAt < quote.observedAt || old.observedAt === quote.observedAt && old.price < quote.price) {
      map.set(quote.definitionId, Object.freeze({ season: '27', platform, definitionId: quote.definitionId,
        price: quote.price, observedAt: quote.observedAt, source: quote.source }));
    }
  }
  for (const [definitionId, quote] of map) if (quote.price > maxUnitPrice) map.delete(definitionId);
  return map;
}

// Index once, query locally; the model never receives the full corpus. Filters
// are explicit query hints, not an assertion that every SBC slot needs them.
export function createFc27CatalogIndex(catalog) {
  const checked = normalizeFc27PlayerCatalog(catalog, catalog?.observedAt);
  if (checked.status !== 'ready') return checked;
  const entries = checked.catalog.entries; const maps = Object.create(null);
  for (const field of ['definitionId', 'nationId', 'leagueId', 'teamId', 'rarity', 'rating']) {
    const index = new Map();
    for (const entry of entries) { const key = entry[field]; if (!index.has(key)) index.set(key, []); index.get(key).push(entry); }
    maps[field] = index;
  }
  return Object.freeze({ query({ filters = {}, limit = 32, offset = 0 } = {}) {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)
        || Object.entries(filters).some(([key, value]) => !maps[key] || !integer(value, 0, Number.MAX_SAFE_INTEGER))
        || !integer(limit, 1, 64) || !integer(offset, 0, FC27_CATALOG_LIMIT)) return fail('FC27_CATALOG_QUERY_INVALID');
    const lanes = Object.entries(filters).map(([key, value]) => maps[key].get(value) ?? []);
    const source = lanes.length ? lanes.reduce((a, b) => a.length < b.length ? a : b) : entries;
    const matches = source.filter(entry => Object.entries(filters).every(([key, value]) => entry[key] === value));
    return { status: 'observed', total: matches.length, truncated: offset + limit < matches.length,
      entries: matches.slice(offset, offset + limit).map(entry => ({ ...entry,
        positions: [...entry.positions], groups: entry.groups === null ? null : [...entry.groups] })) };
  } });
}
