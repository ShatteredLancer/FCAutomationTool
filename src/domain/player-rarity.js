function callBoolean(item, method) {
  try {
    const value = item?.[method]?.();
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

const PLAYER_CARD_HOLDERS = ['_data', 'data', '_staticData', 'staticData'];
const PLAYER_DATABASE_ID_FIELDS = ['databaseId', 'databaseID', 'databaseid', '_databaseId'];
const PLAYER_DEFINITION_ID_FIELDS = ['definitionId', 'definitionID', 'definitionid', 'defId'];

function cardHolders(item = {}) {
  return [item, item?.ref, ...PLAYER_CARD_HOLDERS.map((field) => item?.[field])]
    .filter((holder) => holder && typeof holder === 'object');
}

function firstPositiveInteger(holders, fields) {
  for (const holder of holders) {
    for (const field of fields) {
      const value = Number(holder?.[field]);
      if (Number.isSafeInteger(value) && value > 0) return value;
    }
  }
  return 0;
}

export function readPlayerDatabaseId(item = {}) {
  const holders = cardHolders(item);
  const direct = firstPositiveInteger(holders, PLAYER_DATABASE_ID_FIELDS);
  if (direct) return direct;
  const definitionId = firstPositiveInteger(holders, PLAYER_DEFINITION_ID_FIELDS);
  return definitionId ? definitionId % 0x01000000 : 0;
}

function meaningfulCardState(value, options = {}) {
  if (value === null || value === undefined || value === false) return false;
  if (Array.isArray(value)) return options.allowEmptyArray === true || value.length > 0;
  if (typeof value === 'object') return options.allowEmptyObject === true || Object.keys(value).length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && !['0', '-1', 'false', 'none', 'null'].includes(normalized);
  }
  return value === true;
}

export function readExplicitPlayerRareFlag(item = {}) {
  const explicitValues = [
    item.rareflag,
    item.rareFlag,
    item._rareflag,
    item._data?.rareflag,
    item._data?.rareFlag,
    item._staticData?.rareflag,
    item._staticData?.rareFlag,
  ].map(Number).filter(Number.isFinite);
  return explicitValues.length ? Math.max(0, ...explicitValues) : null;
}

export function readPlayerRareFlag(item = {}) {
  const explicitRareFlag = readExplicitPlayerRareFlag(item);
  if (explicitRareFlag !== null) return explicitRareFlag;
  if (item.special === true || callBoolean(item, 'isSpecial') === true) return 2;
  if (item.rare === true || callBoolean(item, 'isRare') === true) return 1;
  return 0;
}

function playerDefinitionId(item = {}) {
  return Number(item.definitionId ?? item.ref?.definitionId ?? item._data?.definitionId ?? item._staticData?.definitionId ?? 0);
}

function playerRating(item = {}) {
  return Number(item.rating ?? item._rating ?? item._data?.rating ?? item._staticData?.rating ?? 0);
}

export function hasPlayerUpgrades(item = {}) {
  return cardHolders(item).some((holder) => meaningfulCardState(holder?.upgrades, {
    // EA/FSU use null for a base card; an allocated upgrades collection marks a modified card.
    allowEmptyArray: true,
    allowEmptyObject: true,
  }));
}

export function hasPlayerCosmetics(item = {}) {
  if (item.cosmetic === true) return true;
  return cardHolders(item).some((holder) => meaningfulCardState(holder?.cosmetics));
}

export function isPlayerEvolutionCard(item = {}) {
  if (item.evolution === true) return true;
  if (callBoolean(item, 'isEvolution') === true || callBoolean(item, 'isEvo') === true) return true;
  if (hasPlayerUpgrades(item)) return true;
  const evolutionFields = ['isEvolution', 'isEvo', 'evolutionId', 'evoId', 'evolutionLevel', 'evolutionStatus'];
  return cardHolders(item).some((holder) => evolutionFields.some((field) => (
    typeof holder?.[field] !== 'function' && meaningfulCardState(holder?.[field])
  )));
}

export function isSamePlayerCardVersion(item = {}, candidate = {}) {
  const definitionId = playerDefinitionId(item);
  if (!definitionId || definitionId !== playerDefinitionId(candidate)) return false;

  const rating = playerRating(item);
  const candidateRating = playerRating(candidate);
  if (rating > 0 && candidateRating > 0 && rating !== candidateRating) return false;

  if (isPlayerEvolutionCard(item) !== isPlayerEvolutionCard(candidate)) return false;
  if (hasPlayerCosmetics(item) !== hasPlayerCosmetics(candidate)) return false;

  return readPlayerRareFlag(item) === readPlayerRareFlag(candidate);
}

export function isRarePlayerCard(item = {}) {
  return readPlayerRareFlag(item) > 0;
}

export function isSpecialPlayerCard(item = {}) {
  return readPlayerRareFlag(item) > 1;
}

// FC27 11502: EA's item.raretype3 localization explicitly names Team of the
// Week. Only use this with a verified FC27 requirement and normalized DTOs.
export const FC27_TOTW_RARITY = 3;
export const isFc27TotwCard = item => item?.rarity === FC27_TOTW_RARITY && item?.special === true;

export function normalPlayerRarity(item = {}) {
  if (isSpecialPlayerCard(item)) return 'special';
  return isRarePlayerCard(item) ? 'rare' : 'common';
}
