// Pure Gallery card selection helpers. The view owns the user-facing state;
// these functions keep exact EA version IDs stable across filters and pages.
import { isGalleryOwned } from './planner.js';
const validId = value => Number.isSafeInteger(value) && value > 0;
const keyOf = row => validId(row?.eaId) ? String(row.eaId) : null;
const textOf = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
const priceOf = (prices, id) => {
  const value = prices?.[id] ?? prices?.[Number(id)];
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

export function galleryCardKey(row) {
  return keyOf(row);
}

export function filterGalleryCards(rows, { filter = 'all', query = '', order = 'catalog', prices = {}, lineupIds = [] } = {}) {
  const needle = textOf(query);
  const lineup = new Set(lineupIds);
  const output = (Array.isArray(rows) ? rows : []).filter(row => {
    if (!keyOf(row)) return false;
    if (filter === 'lineup' ? !lineup.has(row.eaId) : filter === 'firstOwned' ? row.firstOwned !== true
      : filter === 'held' ? row.held !== true : filter === 'selected' ? false
        : filter !== 'all' && row.status !== filter) return false;
    return !needle || textOf(`${row.name ?? ''} ${row.version ?? ''} ${row.overall ?? ''}`).includes(needle);
  });
  const name = (a, b) => textOf(a.name).localeCompare(textOf(b.name)) || Number(a.eaId) - Number(b.eaId);
  if (order === 'name') output.sort(name);
  else if (order === 'score') output.sort((a, b) => (b.galleryScore ?? -Infinity) - (a.galleryScore ?? -Infinity) || name(a, b));
  else if (order === 'price') output.sort((a, b) => {
    const x = priceOf(prices, a.eaId), y = priceOf(prices, b.eaId);
    return (x == null) - (y == null) || (x ?? Infinity) - (y ?? Infinity) || name(a, b);
  });
  return output;
}

export function paginateGalleryCards(rows, { page = 1, pageSize = 24 } = {}) {
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 24;
  const total = Array.isArray(rows) ? rows.length : 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  return { rows: (rows ?? []).slice((current - 1) * size, current * size), page: current, pages, total, pageSize: size };
}

export function reconcileGallerySelection(selection, rows) {
  const allowed = new Map((Array.isArray(rows) ? rows : [])
    .filter(row => !isGalleryOwned(row) && row?.collected === false && keyOf(row))
    .map(row => [keyOf(row), row]));
  const next = new Map();
  for (const [id, value] of selection instanceof Map ? selection : []) {
    if (allowed.has(String(id))) next.set(String(id), { ...value, eaId: Number(id), name: allowed.get(String(id)).name });
  }
  return next;
}

export function selectCheapestGalleryCards(rows, count, prices) {
  if (!Number.isSafeInteger(count) || count < 1) return [];
  return (Array.isArray(rows) ? rows : []).filter(row => !isGalleryOwned(row) && row?.collected === false && priceOf(prices, row.eaId) != null)
    .slice().sort((a, b) => priceOf(prices, a.eaId) - priceOf(prices, b.eaId)
      || (b.galleryScore ?? -Infinity) - (a.galleryScore ?? -Infinity) || Number(a.eaId) - Number(b.eaId)).slice(0, count);
}

export function summarizeGallerySelection(selection, rows, prices = {}) {
  const rowMap = new Map((Array.isArray(rows) ? rows : []).map(row => [keyOf(row), row]));
  const selected = [];
  let total = 0, unknownPrice = false, score = 0;
  for (const [id] of selection instanceof Map ? selection : []) {
    const row = rowMap.get(String(id));
    if (!row || isGalleryOwned(row) || row.collected !== false) continue;
    selected.push(row);
    const price = priceOf(prices, id);
    if (price == null) unknownPrice = true; else total += price;
    const value = Number.isSafeInteger(row.gradingScore) ? row.gradingScore : row.galleryScore;
    if (Number.isSafeInteger(value)) score += value;
  }
  return { selected, count: selected.length, totalPrice: unknownPrice ? null : total, unknownPrice, score };
}
