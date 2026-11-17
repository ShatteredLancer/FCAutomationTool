// Optional filter-task policy. No quote fallback for an unconfigured rating.
import { marketTaskAutoLists } from './market-task-policy.js';
export const marketRatingStep = value => value < 1000 ? 50 : value < 10000 ? 100 : value < 50000 ? 250 : value < 100000 ? 500 : 1000;
export const validMarketRatingPrice = value => Number.isSafeInteger(value) && value >= 150 && value <= 15000000 && value % marketRatingStep(value) === 0;
export const marketRatingRow = (task, rating) => task.mode === 'filter' && task.ratingPrices
  ? task.ratingPrices[String(rating)] ?? null : null;
export const completeMarketRatingRow = (row, task = null) => ((task?.settings.buyMode??'bin')==='bid'||validMarketRatingPrice(row?.buy))
  && ((task?.settings.buyMode??'bin')==='bin'||validMarketRatingPrice(row?.bid))
  && (task && !marketTaskAutoLists(task) || validMarketRatingPrice(row?.sell));
export function normalizeMarketRatingPrices(input, mode, settings) {
  if (input == null) return null;
  const fail = () => { throw Error('TASKS_RATING_PRICES_INVALID'); };
  if (mode !== 'filter' || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 99) fail();
  const result = {};
  for (const [key,row] of Object.entries(input)) {
    if (!/^[1-9]\d?$/.test(key) || !row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some(k=>!['buy','sell','bid'].includes(k)) || !Object.hasOwn(row,'buy') || !Object.hasOwn(row,'sell')) fail();
    for (const side of ['buy','sell',...(Object.hasOwn(row,'bid')?['bid']:[])]) if (row[side] !== null && !validMarketRatingPrice(row[side])) fail();
    result[key] = { buy: row.buy, sell: row.sell, ...(Object.hasOwn(row,'bid')?{bid:row.bid}:{}) };
  }
  if (!Object.entries(result).some(([r,row]) => Number(r) >= settings.ratingMin && Number(r) <= settings.ratingMax && completeMarketRatingRow(row,{mode,settings}))) fail();
  return result;
}
