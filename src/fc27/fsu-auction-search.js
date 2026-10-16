/*!
 * Adapted from FSU 26.09 events.readAuctionPrices / buyConceptPlayer.
 * Copyright (c) Futcd_kcka
 * Copyright (c) 2026 ShatteredLancer (local modifications)
 * MIT License
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Same bounded price walk as FSU: no results -> one price tick up; full page ->
// one tick down; partial page -> done. Never query a price twice in one pass.
// Runtime, pacing and authorization are injected; no FSU globals or callbacks.
function spreadIntervalCount(attempts) {
  return Math.max(1, attempts - 1);
}

function floorLegalPrice(value, priceTiers) {
  if (!Array.isArray(priceTiers) || !priceTiers.length) return value;
  const tier = priceTiers.find(row => Number.isSafeInteger(row?.min) && Number.isSafeInteger(row?.inc)
    && row.inc > 0 && value >= row.min);
  return tier ? tier.min + Math.floor((value - tier.min) / tier.inc) * tier.inc : value;
}

function nextSpreadPrice(initial, ceiling, attempts, nextIndex, current, priceTiers, above) {
  if (nextIndex >= attempts - 1) return ceiling;
  const slots = spreadIntervalCount(attempts);
  const target = initial + ((ceiling - initial) * nextIndex) / slots;
  let candidate = Math.min(ceiling, floorLegalPrice(target, priceTiers));
  if (candidate <= current && typeof above === 'function') candidate = above(current);
  return Math.min(ceiling, candidate);
}

export async function readFsuStyleAuctionPrices({ search, above, below, initial, ceiling = Infinity, attempts = 5,
  wait = async () => {}, onResults = () => {}, onSearchFailure = () => {}, spreadCeiling = false, priceTiers = null }) {
  if (!Number.isSafeInteger(attempts) || attempts <= 0) return [];
  const attemptLimit = attempts;
  const boundedInitial = Math.min(initial, ceiling);
  let price = spreadCeiling && Number.isFinite(ceiling) && ceiling > boundedInitial && attempts === 1
    ? ceiling : boundedInitial;
  let spreadActive = spreadCeiling && Number.isFinite(ceiling) && ceiling > boundedInitial;
  const queried = new Set(); let items = [];
  while (attempts-- > 0) {
    if (price > ceiling || queried.has(price)) break;
    const response = await search(price);
    const reply = Array.isArray(response) ? { success: true, data: { items: response } } : response;
    if (!reply.success) { onSearchFailure(reply); break; }
    onResults();
    const page = reply.data.items;
    items = items.concat(page);
    queried.add(price);
    if (!page.length) {
      price = spreadActive
        ? nextSpreadPrice(boundedInitial, ceiling, attemptLimit, queried.size, price, priceTiers, above)
        : above(price);
    }
    else if (page.length === 21) { spreadActive = false; price = below(price); }
    else break;
    if (attempts > 0) await wait(0.2, 0.5);
  }
  return items;
}
