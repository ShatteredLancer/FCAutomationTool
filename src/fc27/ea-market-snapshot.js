import { FC27_QUOTE_TTL, normalizeFc27PlayerCatalog, indexFc27MarketQuotes } from './market-catalog.js';

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const id = value => integer(value, 1, Number.MAX_SAFE_INTEGER);
const stop = reason => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false,
  marketAvailabilityVerified: false });

function validCatalogEntry(entry) {
  return id(entry?.definitionId) && integer(entry.rating, 1, 99)
    && [entry.nationId, entry.leagueId, entry.teamId].every(id)
    && integer(entry.rarity, 0, 10000)
    && Array.isArray(entry.positions) && entry.positions.length > 0 && entry.positions.length <= 28
    && Array.from(entry.positions).every(position => integer(position, 0, 27))
    && new Set(entry.positions).size === entry.positions.length
    && (entry.groups === null || Array.isArray(entry.groups) && entry.groups.length <= 256
      && Array.from(entry.groups).every(group => integer(group, 0, 10000)) && new Set(entry.groups).size === entry.groups.length)
    && [entry.special, entry.evolution, entry.cosmetic].every(value => typeof value === 'boolean');
}

function validQuote(quote, { now, platform, catalogIds, catalogObservedAt }) {
  if (!quote || quote.status !== 'observed' || quote.season !== '27' || quote.platform !== platform
      || quote.source !== 'ea-visible-buy-now' || !id(quote.definitionId)
      || !catalogIds.has(quote.definitionId) || !id(quote.observedAt) || quote.observedAt > now
      || quote.observedAt < catalogObservedAt || !integer(quote.returned, 0, 20)
      || !integer(quote.eligible, 0, quote.returned)
      || (quote.eligible === 0 ? quote.price !== null : !integer(quote.price, 150, 2000))
      || quote.complete !== false || quote.executable !== false || quote.marketAvailabilityVerified !== false) return false;
  return true;
}

// Convert the deliberately aggregated market probe into the reviewed input
// contract consumed by the pure joint planner. Only versions with a valid
// active-auction observation enter the planning catalog; an unquoted /defid
// version is not guessed to be tradable.
export function projectFc27EaMarketSnapshot(probe, { now = Date.now(), platform } = {}) {
  if (!id(now) || typeof platform !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(platform)
      || probe?.status !== 'observed' || probe.reason !== 'FC27_MARKET_SAMPLE_OBSERVED'
      || probe.executable !== false || probe.liveExecutionEnabled !== false
      || probe.catalog?.status !== 'observed' || probe.catalog.season !== '27'
      || probe.catalog.source !== 'ea-defid' || probe.catalog.complete !== false
      || !id(probe.catalog.observedAt) || probe.catalog.observedAt > now
      || now - probe.catalog.observedAt > 86400000 || !Array.isArray(probe.catalog.entries)
      || probe.catalog.entries.length > 20
      || probe.catalog.query?.start !== 0 || probe.catalog.query.count !== 20
      || probe.catalog.query.level !== 'silver'
      || probe.catalog.pageEndObserved !== (probe.catalog.entries.length < probe.catalog.query.count)
      || !Array.isArray(probe.quotes) || probe.quotes.length > 3
      || probe.requests !== probe.quotes.length + 1) {
    return stop('FC27_MARKET_PROBE_UNVERIFIED');
  }
  const catalog = []; const ids = new Set();
  for (const entry of probe.catalog.entries) {
    if (!validCatalogEntry(entry) || ids.has(entry.definitionId)) return stop('FC27_MARKET_CATALOG_INVALID');
    ids.add(entry.definitionId); catalog.push(entry);
  }
  const seenQuotes = new Set();
  for (const quote of probe.quotes) {
    if (!validQuote(quote, { now, platform, catalogIds: ids, catalogObservedAt: probe.catalog.observedAt })
        || seenQuotes.has(quote.definitionId)) {
      return stop('FC27_MARKET_QUOTES_UNVERIFIED');
    }
    seenQuotes.add(quote.definitionId);
  }
  const freshQuotes = probe.quotes.filter(quote => now - quote.observedAt <= FC27_QUOTE_TTL);
  const quoted = new Map(freshQuotes.filter(quote => quote.eligible > 0)
    .map(quote => [quote.definitionId, quote]));
  if (!quoted.size) return stop('FC27_MARKET_QUOTES_UNAVAILABLE');
  const entries = catalog.filter(entry => quoted.has(entry.definitionId)).map(entry => ({
    ...entry, marketable: true, groups: entry.groups === null ? null : [...entry.groups], positions: [...entry.positions],
  }));
  const quotes = [...quoted.values()].map(quote => ({ season: '27', platform, definitionId: quote.definitionId,
    price: quote.price, observedAt: quote.observedAt, source: quote.source }));
  const data = { schema: 1, platform,
    catalog: { schema: 1, season: '27', source: 'ea-defid', revision: 'fc27-runtime',
      seasonEvidence: 'season-route', observedAt: probe.catalog.observedAt, complete: false, entries }, quotes };
  const checked = normalizeFc27PlayerCatalog(data.catalog, now);
  const indexed = indexFc27MarketQuotes(quotes, { now, platform, maxUnitPrice: 10000 });
  if (checked.status !== 'ready' || !indexed || indexed.size !== entries.length) return stop('FC27_MARKET_SNAPSHOT_INVALID');
  return { status: 'ready', data: { schema: 1, platform, catalog: checked.catalog, quotes: [...indexed.values()] },
    coverage: { catalogEntries: catalog.length, queriedVersions: probe.quotes.length,
      quotedVersions: entries.length, unquotedVersions: catalog.length - probe.quotes.length,
      emptyQuoteVersions: freshQuotes.filter(quote => quote.eligible === 0).length,
      expiredQuoteVersions: probe.quotes.length - freshQuotes.length, catalogComplete: false },
    executable: false, liveExecutionEnabled: false, marketAvailabilityVerified: false };
}
