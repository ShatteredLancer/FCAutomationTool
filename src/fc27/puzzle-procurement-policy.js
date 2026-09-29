// Price filters affect planning only; they never authorize spending coins.
export const DEFAULT_PUZZLE_QUOTE_CEILING = null;
export const MAX_PUZZLE_QUOTE_PRICE = 15000000;
// Three catalog pages, up to eleven missing slots and eleven substitutions.
// Successful reads persist so a later click can continue without rereading them.
export const PUZZLE_MARKET_READ_LIMIT = 25;
export const isPuzzleQuoteCeiling = value => value === null
  || Number.isSafeInteger(value) && value >= 150 && value <= MAX_PUZZLE_QUOTE_PRICE;
