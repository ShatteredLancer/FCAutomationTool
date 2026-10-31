// Price filters affect planning only; they never authorize spending coins.
export const DEFAULT_PUZZLE_QUOTE_CEILING = null;
export const MAX_PUZZLE_QUOTE_PRICE = 15000000;
// Three base pages; with public prices, at most two scoped coverage pages.
// The legacy auction-quote route keeps its original read budget unchanged.
// Successful reads persist so a later click can continue without rereading them.
export const PUZZLE_MARKET_READ_LIMIT = 25;
export const isPuzzleQuoteCeiling = value => value === null
  || Number.isSafeInteger(value) && value >= 150 && value <= MAX_PUZZLE_QUOTE_PRICE;
