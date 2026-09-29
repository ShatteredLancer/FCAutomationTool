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
export async function readFsuStyleAuctionPrices({ search, above, below, initial, ceiling = Infinity, attempts = 5,
  wait = async () => {}, onResults = () => {}, onSearchFailure = () => {} }) {
  let price = Math.min(initial, ceiling);
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
    if (!page.length) price = above(price);
    else if (page.length === 21) price = below(price);
    else break;
    if (attempts > 0) await wait(0.2, 0.5);
  }
  return items;
}
