// Narrow regression reference from FC27 Enhancer 27.0.0.4, vfe/gMt.
// Observed bundle SHA256: 9175465649A6E46CF4AE457F924AE80C9FC6B971865A3790477F0E53B29F9D9F
// Original code remains its authors' property; compatibility evidence only,
// not part of the production userscript or relicensed under FCAT's MIT license.
export function referencePrices(PRICE_TIERS) {
  const UTCurrencyInputControl = { PRICE_TIERS }, JSUtils = { find: (rows, fn) => rows.find(fn) };
  var n = 14999e3, i = (v, b, y = 0) => {
    const w = Math.round(v / b) * b;
    return Math.max(Math.min(w, n), y);
  }, a = (v) => {
    if (v === UTCurrencyInputControl.PRICE_TIERS[0]) return n;
    const b = UTCurrencyInputControl.PRICE_TIERS.indexOf(v) - 1;
    return (UTCurrencyInputControl.PRICE_TIERS[b]?.min ?? 0) - 1;
  }, s = (v) => JSUtils.find(UTCurrencyInputControl.PRICE_TIERS, ({ min: b }) => v(b)), o = (v, b) => {
    if (b === 0) return v;
    const y = b > 0 ? 1 : -1, w = s((C) => y > 0 ? v >= C : v > C);
    if (!w) return v;
    let P;
    if (y > 0 ? P = Math.floor((a(w) - v) / w.inc) + 1 : (P = Math.floor((v - w.min) / w.inc), v % w.inc !== 0 && (P += 1)), Math.abs(b) <= P) return i(v + b * w.inc, w.inc, w.min);
    const T = b - y * P, k = v + y * P * w.inc;
    return o(k, T);
  }, u = (v, b = 0) => {
    const y = s((w) => v >= w);
    return y ? i(v, y.inc, b) : Math.max(v, b);
  };
  return { step: o, round: u };
}

// EA publicly loaded UTCurrencyInputControl.PRICE_TIERS (2026-09-17 capture).
export const priceTiers = [
  { min: 100000, inc: 1000 }, { min: 50000, inc: 500 }, { min: 10000, inc: 250 },
  { min: 1000, inc: 100 }, { min: 150, inc: 50 }, { min: 0, inc: 150 },
];
