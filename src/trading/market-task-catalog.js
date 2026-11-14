import { taskCandidateAllowed, yieldTaskCatalog } from './task-catalog.js';

const positions = ['GK','SW','RWB','RB','RCB','CB','LCB','LB','LWB','RDM','CDM','LDM','RM','RCM','CM','LCM','LM','RAM','CAM','LAM','RF','CF','LF','RW','RS','ST','LS','LW'];
const positive = n => Number.isSafeInteger(n) && n > 0 ? n : null;
const text = value => typeof value === 'string' ? value.slice(0, 100) : '';
const pause = yieldTaskCatalog;
export function normalizeTaskCatalogCard(row) {
  if (!row || !positive(row.definitionId) || !Number.isSafeInteger(row.rating) || row.rating < 1 || row.rating > 99
    || row.evolution === true || row.cosmetic === true) return null;
  const rarity = Number.isSafeInteger(row.rarity) && row.rarity >= 0 ? row.rarity : null;
  const quality = ['bronze','silver','gold','special'].includes(row.quality) ? row.quality
    : rarity === null ? null : rarity > 1 ? 'special' : row.rating >= 75 ? 'gold' : row.rating >= 65 ? 'silver' : 'bronze';
  const position = typeof row.preferredPosition === 'string' ? positions.indexOf(row.preferredPosition) : row.preferredPosition;
  return Object.freeze({ definitionId: row.definitionId, name: text(row.name) || `EA ${row.definitionId}`, rating: row.rating,
    playerId: positive(row.playerId), quality, rarity, leagueId: positive(row.leagueId), nationId: positive(row.nationId),
    teamId: positive(row.teamId), preferredPosition: Number.isSafeInteger(position) && position >= 0 && position <= 27 ? position : null,
    version: text(row.version) });
}

// No IO until explicit read. Content equality, not array length, defines a
// revision. Snapshots are immutable public facts, never EA owned entities.
export function createMarketTaskCatalog({ readRows, context, yieldControl = pause }) {
  let previous = null, revision = 0, generation = 0;
  const read = async ({ isCurrent = () => true } = {}) => {
    const captured = JSON.stringify(context()), ticket = ++generation;
    const check = () => { if (!isCurrent() || captured !== JSON.stringify(context())) throw Error('TASKS_CONTEXT_CHANGED'); };
    check(); const input = await readRows({ isCurrent: () => { check(); return true; } }); check();
    if (!Array.isArray(input) || input.length > 100000) throw Error('MARKET_CATALOG_UNAVAILABLE');
    const rows = [], byId = new Map();
    for (let i = 0; i < input.length; i++) {
      const card = normalizeTaskCatalogCard(input[i]);
      if (card) {
        const old = byId.get(card.definitionId);
        if (old === undefined) { byId.set(card.definitionId, rows.length); rows.push(card); }
        // Conflicting versions are not silently overwritten by a weaker source.
        else if (rows[old]) {
          const prior = rows[old], keys = ['rating','playerId','quality','rarity','leagueId','nationId','teamId','preferredPosition'];
          if (keys.some(k => prior[k] !== null && card[k] !== null && prior[k] !== card[k])) rows[old] = null;
          else rows[old] = Object.freeze({ ...prior, ...Object.fromEntries(keys.map(k => [k, prior[k] ?? card[k]])) });
        }
      }
      if ((i + 1) % 256 === 0) { await yieldControl(); check(); }
    }
    const unique = rows.filter(Boolean);
    let equal = previous?.context === captured && unique.length === previous.rows.length;
    for (let i = 0; equal && i < unique.length; i++) {
      equal = JSON.stringify(unique[i]) === JSON.stringify(previous.rows[i]);
      if ((i + 1) % 256 === 0) { await yieldControl(); check(); }
    }
    if (equal) return previous;
    const lanes = new Map();
    for (let i = 0; i < unique.length; i++) {
      const card = unique[i]; if (!lanes.has(card.rating)) lanes.set(card.rating, []); lanes.get(card.rating).push(card);
      if ((i + 1) % 256 === 0) { await yieldControl(); check(); }
    }
    const ordered = [...lanes.keys()].sort((a,b) => a-b).flatMap(rating => lanes.get(rating));
    const definitions = new Map(unique.map(row => [row.definitionId, row]));
    const result = Object.freeze({ revision: `local-${++revision}`, context: captured, complete: false,
      rows: Object.freeze(unique), candidates: Object.freeze(ordered), find: id => definitions.get(id) });
    check(); if (ticket === generation) previous = result;
    return result;
  };
  return Object.freeze({ read, async lookup(ids) {
    const snapshot = previous?.context === JSON.stringify(context()) ? previous : await read();
    return ids.map(id => snapshot.find(id)).filter(Boolean);
  } });
}

export async function taskCandidatePage(snapshot, task, { cursor = 0, limit = 20, isCurrent = () => true, yieldControl = pause } = {}) {
  const rows = [], source = snapshot.candidates; let next = cursor, scanned = 0;
  if (cursor === 0) {
    let end = source.length;
    while (next < end) { const mid = (next + end) >>> 1; if (source[mid].rating < task.settings.ratingMin) next = mid + 1; else end = mid; }
  }
  for (; next < source.length; next++) {
    if (!isCurrent()) throw Error('MARKET_USER_STOP');
    const card = source[next]; scanned++;
    if (card.rating > task.settings.ratingMax) { next = source.length; break; }
    if (taskCandidateAllowed(card, task)) rows.push(card);
    if (rows.length === limit) { next++; break; }
    if (scanned % 256 === 0) { await yieldControl(); if (!isCurrent()) throw Error('MARKET_USER_STOP'); }
  }
  return { rows, next, done: next >= source.length };
}
