import { createSeasonContext, ownData } from '../../fc27/prelaunch-contract.js';
import { isSpecialPlayerCard } from '../../domain/player-rarity.js';

const identity = value => Number.isSafeInteger(value) && value > 0;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const at = (value, keys) => keys.reduce((next, key) => ownData(next, key), value);

// FC27 UTItemEntity keeps a few ownership-independent fields on the loaded
// static DTO. Read only data descriptors from the entity first, then the
// observed _data/_staticData containers; never execute a model getter.
const itemData = (item, key) => {
  const direct = ownData(item, key);
  if (direct !== undefined) return direct;
  for (const container of [ownData(item, '_data'), ownData(item, '_staticData')]) {
    const value = ownData(container, key);
    if (value !== undefined) return value;
  }
  return undefined;
};

// FC27's live UTItemEntity does not expose `type` as an own data field. The
// native entity contract exposes the pure `isPlayer()` predicate instead.
// Prefer the explicit DTO field when present, then use that observed method;
// unknown entities remain non-player rather than being guessed as players.
export function isFc27PlayerItem(item) {
  const type = ownData(item, 'type');
  if (type === 'player') return true;
  if (type !== undefined && type !== null) return false;
  try { return typeof item?.isPlayer === 'function' && item.isPlayer() === true; }
  catch { return false; }
}
function numbers(value, limit, min, max) {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result = Array.from({ length: value.length }, (_, index) => integer(ownData(value, String(index)), min, max));
  return result.includes(null) || new Set(result).size !== result.length ? null : Object.freeze(result);
}

// Verified 2026-09-17 against the selected User -> Persona -> SKU -> Club chain.
// Returned identities stay inside the provider; diagnostic reports export booleans only.
export function readFc27Context(root) {
  const service = at(root, ['services', 'User']);
  const userId = ownData(service, 'currentUserId');
  const user = at(service, ['repository', '_collection', String(userId)]);
  const personaId = ownData(user, 'selectedPersona');
  const persona = at(user, ['_personas', '_collection', String(personaId)]);
  const sku = ownData(persona, '_sku');
  const club = at(persona, ['clubs', '_collection', String(sku)]);
  const platform = ownData(club, 'platform');
  if (![27, '27'].includes(ownData(root, 'APP_YEAR_SHORT')) || ownData(root, 'APP_YEAR') !== 2027
      || !identity(userId) || ownData(user, 'id') !== userId
      || !identity(personaId) || ownData(persona, 'id') !== personaId
      || typeof sku !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(sku) || ownData(club, 'sku') !== sku
      || ownData(club, 'year') !== 2027 || typeof platform !== 'string'
      || !/^[A-Za-z0-9_-]{1,24}$/.test(platform) || /^(none|unknown|default)$/i.test(platform)) {
    throw new Error('FC27_CONTEXT_UNAVAILABLE');
  }
  return createSeasonContext({ season: '27', accountScope: `ea:${userId}:${personaId}`, platform: `${platform}:${sku}` });
}

function entries(value) {
  for (let i = 0; i < 3 && ownData(value, '_collection') !== undefined; i++) value = ownData(value, '_collection');
  if (!value || typeof value !== 'object' || !Array.isArray(value)
      && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('FC27_COLLECTION_UNAVAILABLE');
  const keys = Object.getOwnPropertyNames(value).filter(key => key !== 'length');
  if (keys.length > 20000) throw new Error('FC27_COLLECTION_LIMIT');
  return keys.map(key => {
    const item = ownData(value, key);
    if (!item || typeof item !== 'object') throw new Error('FC27_COLLECTION_UNAVAILABLE');
    return item;
  });
}

export function snapshotFc27ClubPlayer(item, root) {
  const get = key => ownData(item, key);
  const id = get('id');
  const definitionId = get('definitionId');
  if (!identity(id) || !identity(definitionId)) throw new Error('FC27_CACHED_ITEM_IDENTITY_CONFLICT');
  const upgrades = get('upgrades');
  const noUpgrades = upgrades === null;
  const pile = get('utasPile');
  const clubPile = at(root, ['ItemPile', 'CLUB']);
  const evolutionPile = at(root, ['ItemPile', 'EVOLUTION']);
  const baseRarity = integer(get('_rareflag'), 0, 10000);
  const common = at(root, ['ItemRarity', 'NONE']);
  const rare = at(root, ['ItemRarity', 'RARE']);
  const cosmetics = get('cosmetics');
  const hyper = get('_hyperCosmeticDTOs');
  const cosmetic = Array.isArray(cosmetics) && hyper && typeof hyper === 'object'
    && !Array.isArray(hyper) ? cosmetics.length > 0 || Object.getOwnPropertyNames(hyper).length > 0 : null;
  const limitedType = integer(get('limitedUseType'), 0, 100);
  const none = at(root, ['LimitedUseType', 'NONE']);
  const startTime = integer(get('startTime'), -1, Number.MAX_SAFE_INTEGER);
  const endTime = integer(get('endTime'), -1, Number.MAX_SAFE_INTEGER);
  const auctionState = ownData(get('_auction'), '_tradeState');
  const inactive = at(root, ['AuctionTradeStateEnum', 'INACTIVE']);
  const active = at(root, ['AuctionTradeStateEnum', 'ACTIVE']);
  const snapshot = { id, definitionId, type: 'player',
    pile: clubPile !== undefined && pile === clubPile ? 'club' : null,
    rating: noUpgrades ? integer(get('_rating'), 1, 99) : null,
    rarity: noUpgrades ? baseRarity : null,
    special: noUpgrades && baseRarity !== null && common === 0 && rare === 1
      ? isSpecialPlayerCard({ rareflag: baseRarity }) : null,
    evolution: evolutionPile !== undefined && pile === evolutionPile ? true : noUpgrades ? false : upgrades === undefined ? null : true,
    cosmetic, concept: boolean(get('concept')),
    academyEnrolled: noUpgrades ? false : boolean(ownData(upgrades, 'enrolled')),
    // In the live FC27 payload `tradable` is absent on the entity and is
    // exposed by its loaded static DTO. Preserve null when all observed data
    // layers omit it so Only Untradeable remains fail-closed.
    tradeable: boolean(itemData(item, 'tradable')), loans: integer(get('loans'), -1, 10000),
    limitedUse: limitedType !== null && Number.isInteger(none) && startTime !== null && endTime !== null
      ? limitedType !== none || startTime !== -1 || endTime !== -1 : null,
    leagueId: integer(get('leagueId'), 1, 1e9),
    // Observed FC27 data properties. No getters or upgrade-position fallback.
    nationId: integer(get('nationId'), 1, 1e9), teamId: integer(get('teamId'), 1, 1e9),
    positions: noUpgrades ? numbers(get('basePossiblePositions'), 28, 0, 27) : null,
    groups: noUpgrades ? numbers(get('groups'), 128, 0, 1e9) : null,
    state: typeof get('state') === 'string' && get('state').length <= 32 ? get('state') : null,
    activeTrade: auctionState === active && active === 'active' ? true
      : auctionState === inactive && inactive === 'inactive' && get('state') === 'free' ? false : null,
    // These need explicit FSU/active-squad policy evidence, not cached defaults.
    locked: null, activeSquad: null, protected: null };
  // Display-only quote: not a safety fingerprint or an executable sale price.
  const marketAverage = integer(get('_marketAverage'), 1, 15000000);
  return Object.freeze({ ...snapshot, safetyFingerprint: JSON.stringify(snapshot), marketAverage });
}

export function readFc27CachedClub(root) {
  const context = readFc27Context(root);
  const playerType = at(root, ['ItemType', 'PLAYER']);
  if (playerType !== 'player') throw new Error('FC27_PLAYER_TYPE_UNVERIFIED');
  const cached = entries(at(root, ['repositories', 'Item', 'club', 'items']));
  const items = cached.filter(item => ownData(item, 'type') === playerType || isFc27PlayerItem(item))
    .map(item => snapshotFc27ClubPlayer(item, root));
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('FC27_CACHED_ITEM_IDENTITY_CONFLICT');
  if (JSON.stringify(readFc27Context(root)) !== JSON.stringify(context)) throw new Error('FC27_CONTEXT_CHANGED');
  return Object.freeze({ schema: 1, context, kind: 'cached-club-inspection', status: 'partial',
    complete: false, liveExecutionEnabled: false, cachedEntries: cached.length, items: Object.freeze(items) });
}
