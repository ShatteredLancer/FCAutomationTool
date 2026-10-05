import { galleryCanonical } from './catalog.js';

const fail = () => { throw new Error('FC27_GALLERY_POOL_INVALID'); };
export const GALLERY_TOP_CANDIDATE_LIMIT = 100;
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max;
const optionalText = (value, max = 1000) => value == null ? null : text(value, max) ? value : fail();
const bool = value => typeof value === 'boolean' ? value : null;

function item(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail();
  const eaId = row.eaId;
  const playerEaId = row.playerEaId;
  if (!integer(eaId, 1) || !integer(playerEaId, 1) || !integer(row.score, 0, 100000000)
      || !integer(row.overall, 1, 99) || !integer(row.clubEaId, 0, 100000000)
      || !integer(row.leagueEaId, 0, 100000000) || !integer(row.nationEaId, 0, 100000000)
      || !integer(row.rarityEaId, 0, 100000000) || !text(row.cardName, 200)
      || !text(row.rarityName, 200) || !Array.isArray(row.positions) || row.positions.length > 32
      || row.positions.some(position => !text(position, 30))) fail();
  return Object.freeze({
    eaId, playerEaId, score: row.score, overall: row.overall, gender: integer(row.gender, 0, 10) ? row.gender : null,
    clubEaId: row.clubEaId, leagueEaId: row.leagueEaId, nationEaId: row.nationEaId,
    rarityEaId: row.rarityEaId, positions: Object.freeze([...row.positions]),
    weakFoot: integer(row.weakFoot, 0, 10) ? row.weakFoot : null,
    skillMoves: integer(row.skillMoves, 0, 10) ? row.skillMoves : null,
    holographic: bool(row.holographic), cardName: row.cardName, commonName: optionalText(row.commonName, 200),
    rarityName: row.rarityName, cardImageUrl: optionalText(row.cardImageUrl),
    simpleCardImageUrl: optionalText(row.simpleCardImageUrl), url: optionalText(row.url), index,
  });
}

export function normalizeGalleryPool(source, input, setId, season = '27') {
  if (!['futgg', 'fodder'].includes(source) || season !== '27' || typeof setId !== 'string' && !integer(setId, 1)) fail();
  const data = input?.data ?? input;
  if (source === 'fodder') {
    if (!data || data.schemaVersion !== 1 || data.game !== `fc${season}` || data.setId !== setId
      || !integer(data.requiredCards, 1) || !integer(data.poolSize, 0, 100000)
      || typeof data.isTruncated !== 'boolean' || !Array.isArray(data.items) || data.items.length > 100000
      || data.items.length > data.poolSize) fail();
    const rawItems = data.items.map(item);
    if (new Set(rawItems.map(row => row.eaId)).size !== rawItems.length) fail();
    const candidateOnly = data.isTruncated === true;
    const items = candidateOnly ? rawItems.slice(0, GALLERY_TOP_CANDIDATE_LIMIT) : rawItems;
    if (candidateOnly && items.length < data.requiredCards) fail();
    const pool = { schema: 1, source, season, setId, requiredCards: data.requiredCards,
      poolSize: data.poolSize, generatedAt: data.generatedAt ?? null, complete: !candidateOnly,
      candidateOnly, candidateLimit: candidateOnly ? items.length : null, items: Object.freeze(items) };
    const content = galleryCanonical({ ...pool, generatedAt: null });
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619) >>> 0;
    return Object.freeze({ ...pool, revision: `p1-${hash.toString(16)}-${content.length}` });
  }
  if (!data || data.schemaVersion !== 1 || data.game !== `fc${season}` || data.setId !== setId
      || !integer(data.requiredCards, 1) || !integer(data.poolSize, 0, 100000)
      || typeof data.isTruncated !== 'boolean' || !Array.isArray(data.items) || data.items.length > 100000
      || data.items.length > data.poolSize || (data.isTruncated === false && data.poolSize !== data.items.length)
      || (data.isTruncated === true && data.poolSize <= data.items.length)) fail();
  const rawItems = data.items.map(item);
  // FUT.GG's large Starter Set response is a bounded, score-descending prefix.
  // It is sufficient for the top-card filler but must never be presented as a
  // complete collection pool.
  if (data.isTruncated && rawItems.some((row, index) => index > 0 && row.score > rawItems[index - 1].score)) fail();
  const sourceIds = rawItems.map(row => row.eaId);
  if (new Set(sourceIds).size !== sourceIds.length) fail();
  const candidateOnly = data.isTruncated === true;
  const items = (candidateOnly ? rawItems.slice(0, GALLERY_TOP_CANDIDATE_LIMIT) : rawItems);
  if (candidateOnly && items.length < data.requiredCards) fail();
  const generatedAt = data.generatedAt == null ? null : data.generatedAt;
  if (generatedAt !== null && (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt)))) fail();
  const pool = { schema: 1, source, season, setId, requiredCards: data.requiredCards,
    poolSize: data.poolSize, generatedAt, complete: !candidateOnly, candidateOnly,
    candidateLimit: candidateOnly ? items.length : null, items: Object.freeze(items) };
  const content = galleryCanonical({ ...pool, generatedAt: null });
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619) >>> 0;
  return Object.freeze({ ...pool, revision: `p1-${hash.toString(16)}-${content.length}` });
}

export function galleryPoolCachePayload(pool) {
  return { data: { schemaVersion: 1, game: `fc${pool.season}`, setId: pool.setId,
    requiredCards: pool.requiredCards, poolSize: pool.poolSize, generatedAt: pool.generatedAt,
    isTruncated: !pool.complete, items: pool.items.map(({ index, ...row }) => row) } };
}
