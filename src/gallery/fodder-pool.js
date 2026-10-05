// Behavioral reference: Fodder 1.2.9 OB/LB/DB. OR within each filter,
// AND across filters; native query by club first, league second, rarity last.
import { readPlayerRareFlag } from '../domain/player-rarity.js';

export function fodderPoolQueries(set) {
  const value = set?.conditions;
  if (!value || Object.keys(value).some(key => !['clubs', 'leagues', 'rareflags', 'holo'].includes(key))
    || typeof value.holo !== 'boolean' || ['clubs', 'leagues', 'rareflags'].some(key =>
      !Array.isArray(value[key]) || value[key].length > 256 || value[key].some(id => !Number.isSafeInteger(id) || id < 0))) {
    throw Error('FC27_GALLERY_FODDER_CONDITIONS_UNSUPPORTED');
  }
  const rarities = value.rareflags.length ? { rarities: [...value.rareflags] } : {};
  if (value.clubs.length) return value.clubs.map(club => ({ club, ...rarities }));
  if (value.leagues.length) return value.leagues.map(league => ({ league, ...rarities }));
  if (value.rareflags.length) return [rarities];
  throw Error('FC27_GALLERY_FODDER_CONDITIONS_UNSUPPORTED');
}

export function matchesFodderPool(set, item) {
  const c = set.conditions;
  return (!c.clubs.length || c.clubs.includes(Number(item.teamId)))
    && (!c.leagues.length || c.leagues.includes(Number(item.leagueId)))
    && (!c.rareflags.length || c.rareflags.includes(readPlayerRareFlag(item)))
    && (!c.holo || Object.keys(item._hyperCosmeticDTOs || item.hyperCosmeticDTOs || {}).length > 0);
}

export function fodderPoolItem(item, root) {
  const call = (name, fallback = null) => { try { return item[name]?.() ?? fallback; } catch { return fallback; } };
  const positions = (item.possiblePositions ?? []).map(value => typeof value === 'string' ? value : root.PlayerPosition?.[value]).filter(value => typeof value === 'string');
  return { eaId: item.definitionId, playerEaId: item.definitionId % 16777216,
    score: Number.isFinite(item.gradingScore) ? item.gradingScore : 0, overall: Number(item.rating), clubEaId: Number(item.teamId) || 0,
    leagueEaId: Number(item.leagueId) || 0, nationEaId: Number(item.nationId ?? item.nation) || 0, rarityEaId: readPlayerRareFlag(item),
    cardName: String(item.knownAs || [item.firstName, item.lastName].filter(Boolean).join(' ') || item.definitionId),
    rarityName: String(readPlayerRareFlag(item)), positions, weakFoot: call('getWeakFoot'), skillMoves: call('getSkillMoves'),
    holographic: Object.keys(item._hyperCosmeticDTOs || item.hyperCosmeticDTOs || {}).length > 0 };
}
