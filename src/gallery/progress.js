const validId = value => Number.isSafeInteger(value) && value > 0;
const booleanOrUnknown = value => typeof value === 'boolean' ? value : null;
const scoreOrUnknown = value => Number.isFinite(value) && value >= 0 && value <= 100000000 ? Number(value) : null;

function accountRow(item, concept, club, clubKnown, history, held) {
  const collected = booleanOrUnknown(concept?.isCollected);
  const inClub = club ? true : clubKnown ? false : null;
  // Concept owners are not ownership evidence for an account. Use held entities.
  const observedFirstOwned = history?.collectedOwners === 1 || club?.some(row => row.owners === 1) ? true
    : Number.isSafeInteger(history?.collectedOwners) && history.collectedOwners > 1 ? false
    : club?.every(row => Number.isSafeInteger(row.owners) && row.owners > 1) ? false : null;
  const firstOwned = typeof history?.firstOwned === 'boolean' ? history.firstOwned : observedFirstOwned;
  return Object.freeze({
    eaId: item.eaId, playerEaId: item.playerEaId, name: item.cardName,
    version: item.rarityName, overall: item.overall, galleryScore: item.score,
    cardImageUrl: item.cardImageUrl, simpleCardImageUrl: item.simpleCardImageUrl,
    nationEaId: item.nationEaId, clubEaId: item.clubEaId, leagueEaId: item.leagueEaId,
    rarityEaId: item.rarityEaId, positions: item.positions, weakFoot: item.weakFoot,
    skillMoves: item.skillMoves, holographic: item.holographic,
    gradingScore: scoreOrUnknown(concept?.gradingScore), collected, inClub,
    // Club remains the authoritative submission pile. Other piles are
    // display-only evidence and never change collected or inClub semantics.
    held: inClub === true || held === true ? true : null, firstOwned, observedFirstOwned,
    firstOwnedSource: typeof history?.firstOwned === 'boolean' ? 'local-history' : firstOwned !== null ? 'ea-observed' : null,
    status: collected === true ? 'collected' : collected === false ? 'missing' : 'unknown',
  });
}

// Merge exact Gallery version identities. A base playerEaId never substitutes
// for a special version eaId; unknown account facts remain unknown.
export function mergeGalleryAccountProgress(pool, { conceptItems = [], clubItems = [], clubKnown = false, collectionHistory = [], heldItems = [] } = {}) {
  if (!pool || !Array.isArray(pool.items)) throw new TypeError('FC27_GALLERY_PROGRESS_INPUT_INVALID');
  const concepts = new Map();
  const allowed = new Set(pool.items.map(item => item.eaId));
  for (const raw of conceptItems) {
    const id = raw?.definitionId ?? raw?.resourceId;
    if (!validId(id) || !allowed.has(id)) throw new Error('FC27_GALLERY_CONCEPT_ID_UNVERIFIED');
    if (concepts.has(id)) throw new Error('FC27_GALLERY_PROGRESS_DUPLICATE_CONCEPT');
    concepts.set(id, raw);
  }
  const club = new Map();
  for (const raw of clubItems) {
    if (!validId(raw?.definitionId)) continue;
    if (!allowed.has(raw.definitionId)) continue;
    if (!club.has(raw.definitionId)) club.set(raw.definitionId, []);
    club.get(raw.definitionId).push(raw);
  }
  const history = new Map();
  for (const row of collectionHistory) history.set(row.definitionId, { ...history.get(row.definitionId), ...row });
  const held = new Set(heldItems.map(row => row?.definitionId).filter(validId));
  const rows = pool.items.map(item => accountRow(item, concepts.get(item.eaId), club.get(item.eaId), clubKnown, history.get(item.eaId), held.has(item.eaId)));
  const count = key => rows.filter(row => row[key] === true).length;
  return Object.freeze({ schema: 1, source: 'ea-gallery-progress', season: pool.season,
    setId: pool.setId, poolRevision: pool.revision, complete: concepts.size === pool.items.length,
    poolComplete: pool.complete === true, candidateOnly: pool.candidateOnly === true,
    poolSize: pool.poolSize, candidateLimit: pool.candidateLimit ?? pool.items.length,
    clubKnown: clubKnown === true, rows: Object.freeze(rows), totals: Object.freeze({
      total: rows.length, collected: count('collected'), inClub: count('inClub'), firstOwned: count('firstOwned'),
      missing: rows.filter(row => row.collected === false).length,
      unknown: rows.filter(row => row.collected === null).length,
      clubUnknown: rows.filter(row => row.inClub === null).length,
      firstOwnedUnknown: rows.filter(row => row.firstOwned === null).length,
    }) });
}
