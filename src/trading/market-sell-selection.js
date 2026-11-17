export const MARKET_SELL_SCAN_INTERVAL = 300000;
export function normalizeMarketSellSelection(value, mode) {
  if (value == null) return null;
  if (mode !== 'sell' || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k=>!['ratingMin','ratingMax','pile'].includes(k))
    || !Number.isSafeInteger(value.ratingMin) || !Number.isSafeInteger(value.ratingMax)
    || value.ratingMin<1 || value.ratingMax>99 || value.ratingMin>value.ratingMax
    || !['all','club','transfer','unassigned'].includes(value.pile)) throw Error('TASKS_SELL_SELECTION_INVALID');
  return {ratingMin:value.ratingMin,ratingMax:value.ratingMax,pile:value.pile};
}
export function marketSellMatches(selection, item, { moved = false } = {}) {
  return Boolean(selection && Number.isSafeInteger(item.rating) && item.rating>=selection.ratingMin && item.rating<=selection.ratingMax
    && ['club','transfer','unassigned'].includes(item.pile) && (moved || selection.pile==='all' || selection.pile===item.pile));
}
