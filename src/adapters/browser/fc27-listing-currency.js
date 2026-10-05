// Enhancer-compatible typed SELL commits. Arrows use the user-approved
// adjacent EA tier policy (2026-10-05), not Enhancer's fixed +/-250.
const tiers = [[100000, 1000], [50000, 500], [10000, 250], [1000, 100], [150, 50], [0, 150]];
export function committedListingCurrency(value, minimum = 200, maximum = 15000000) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return null;
  const bounded = Math.max(minimum, Math.min(maximum, Number(value)));
  const increment = tiers.find(([min]) => bounded >= min)?.[1] ?? 1;
  return Math.round(bounded / increment) * increment;
}

// One arrow click means one legal EA price tier. This is shared by listing
// prices and purchase retry ceilings; it never starts a repeating timer.
export function moveListingCurrencyPrice(value, direction, minimum = 200, maximum = 15000000) {
  if (![1, -1].includes(direction) || !Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  const legalMinimum = Math.max(150, minimum), legalMaximum = Math.min(15000000, maximum);
  if (legalMaximum < legalMinimum) return null;
  const empty = value === '' || value == null, current = Number(value);
  if (!empty && !Number.isFinite(current)) return null;
  let low = Infinity, high = -Infinity, next = direction > 0 ? Infinity : -Infinity;
  // At most six tier intervals, even at 15m; never enumerate prices.
  tiers.forEach(([min, increment], index) => {
    const first = Math.ceil(Math.max(min, legalMinimum) / increment) * increment;
    const last = Math.floor(Math.min(legalMaximum, index ? tiers[index - 1][0] - 1 : 15000000) / increment) * increment;
    if (first > last) return;
    low = Math.min(low, first); high = Math.max(high, last);
    const candidate = direction > 0 ? Math.max(first, (Math.floor(current / increment) + 1) * increment)
      : Math.min(last, (Math.ceil(current / increment) - 1) * increment);
    if (candidate >= first && candidate <= last) next = direction > 0 ? Math.min(next, candidate) : Math.max(next, candidate);
  });
  if (!Number.isFinite(low)) return null;
  return empty ? low : Number.isFinite(next) ? next : direction > 0 ? high : low;
}

// Enhance existing numeric fields without changing their typed-value policy.
// BUY callers keep raw text and validation; only a deliberate arrow moves it.
export function bindCurrencyArrows({ document, input, label, limits = () => ({}), enabled = () => !input.disabled, onStep }) {
  const wrap = document.createElement('div'); wrap.className = 'listing-currency'; input.before(wrap); wrap.append(input);
  input.step = 'any';
  const buttons = document.createElement('div'); wrap.append(buttons);
  const step = sign => {
    if (!enabled() || input.disabled) return;
    const { minimum = 150, maximum = 15000000 } = limits();
    const next = moveListingCurrencyPrice(input.value, sign, minimum, maximum);
    if (next !== null && (input.value === '' || Number(input.value) !== next)) onStep(next);
  };
  input.addEventListener('keydown', event => {
    if (!event.isTrusted || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); if (!event.repeat) step(event.key === 'ArrowUp' ? 1 : -1);
  });
  input.addEventListener('wheel', event => { if (event.isTrusted) event.preventDefault(); }, { passive: false });
  for (const sign of [1, -1]) {
    const button = document.createElement('button'); button.type = 'button';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
    svg.setAttribute('aria-hidden', 'true'); svg.style.pointerEvents = 'none';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', sign > 0 ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path); button.append(svg);
    button.setAttribute('aria-label', `${label} ${sign > 0 ? '增加' : '减少'}`); buttons.append(button);
    // Do not blur/round the draft before the arrow sees it (275 up is 300).
    button.addEventListener('pointerdown', event => { if (event.isTrusted) event.preventDefault(); });
    button.addEventListener('keydown', event => { if (event.repeat) event.preventDefault(); });
    button.addEventListener('click', event => { if (event.isTrusted) step(sign); });
  }
  return wrap;
}

export const currencyInputStyles = `
  .listing-currency{display:flex;min-width:0;max-width:100%;width:134px;height:40px;align-items:center;border:1px solid #888;border-radius:4px;overflow:hidden;background:#45494c}
  .listing-currency>input{flex:1;width:70px!important;min-width:0!important;height:40px!important;min-height:0!important;appearance:textfield;border:0!important;border-radius:0!important;background:transparent!important;padding:6px!important;box-sizing:border-box}
  .listing-currency>input::-webkit-inner-spin-button,.listing-currency>input::-webkit-outer-spin-button{-webkit-appearance:none;appearance:none;margin:0}
  .listing-currency>div{display:flex;height:40px;flex-direction:column;border-left:1px solid #888}
  .listing-currency button{height:20px!important;min-height:0!important;width:24px!important;padding:0!important;margin:0!important;line-height:0;border:0!important;border-radius:0!important;display:flex;align-items:center;justify-content:center;background:transparent;color:inherit}
  .listing-currency button svg{width:15px;height:15px;flex-shrink:0}
`;

export function mountListingCurrency({ document, parent, label, value = null, limits = () => ({}), enabled, onCommit }) {
  const input = document.createElement('input'); input.type = 'number'; input.setAttribute('aria-label', label); parent.append(input);
  let committed = value;
  // t1e uses AUCTION_MIN_BUY (200) for BOTH fields. Automatic starting bids
  // are calculated separately and may still be 150.
  const bounds = () => ({ minimum: Math.max(200, limits()?.minimum ?? 200), maximum: limits()?.maximum ?? 15000000 });
  const render = next => {
    committed = next; input.value = next == null ? '' : String(next);
    const { minimum, maximum } = bounds(); input.min = String(minimum); input.max = String(maximum);
  };
  const commit = raw => {
    if (!enabled()) return;
    const { minimum, maximum } = bounds(), next = committedListingCurrency(raw, minimum, maximum);
    const changed = next !== committed;
    render(next);
    if (changed) onCommit(next);
  };
  input.addEventListener('blur', event => { if (event.isTrusted) commit(input.value); });
  input.addEventListener('keydown', event => { if (event.isTrusted && event.key === 'Enter') { event.preventDefault(); commit(input.value); } });
  bindCurrencyArrows({ document, input, label, limits: bounds, enabled, onStep: commit });
  render(value);
  return { input, setValue: render, getValue: () => committed };
}
