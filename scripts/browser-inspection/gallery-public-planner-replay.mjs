import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { normalizeGalleryCatalog } from '../../src/gallery/catalog.js';
import { normalizeGalleryPool } from '../../src/gallery/pool.js';
import { createFc27GalleryTransport } from '../../src/adapters/browser/fc27-gallery-catalog.js';
import { parseGalleryPriceResponse } from '../../src/gallery/prices.js';
import { planGalleryGrade } from '../../src/gallery/planner.js';
import { createGalleryPlanReplay } from '../../src/gallery/plan-replay.js';

// Public-only diagnostic: no EA session, credentials, writes or trade APIs.
const base = 'artifacts/fc27-browser';
const catalog = normalizeGalleryCatalog('futgg', JSON.parse(await readFile(`${base}/gallery-public-catalog.json`, 'utf8')));
const pool = normalizeGalleryPool('futgg', JSON.parse(await readFile(`${base}/gallery-public-holo-pool.json`, 'utf8')), 113);
const transport = createFc27GalleryTransport(options => {
  try {
    const args = ['-sS', '--max-time', '25', '--proxy', 'http://127.0.0.1:1080', '-X', options.method];
    for (const [key, value] of Object.entries(options.headers ?? {})) args.push('-H', `${key}: ${value}`);
    if (options.data) args.push('--data-binary', '@-');
    args.push(options.url);
    const text = execFileSync('curl.exe', args, { input: options.data, encoding: 'utf8', windowsHide: true });
    options.onload({ status: 200, responseText: text });
  } catch { options.onerror(); }
});
const prices = {};
for (let start = 0; start < pool.items.length; start += 50) {
  const ids = pool.items.slice(start, start + 50).map(row => row.eaId);
  const response = await transport.getPrices(ids, { platform: 'pc' });
  Object.assign(prices, parseGalleryPriceResponse(JSON.parse(response.text), ids, 'pc'));
  console.log(`Public quotes ${Math.min(start + 50, pool.items.length)}/${pool.items.length}`);
}
const input = { set: catalog.categories.flatMap(category => category.sets).find(set => set.id === 'futgg:113'), catalog,
  progress: { season: '27', setId: 113, complete: true, rows: pool.items.map(row => ({ ...row,
    gradingScore: row.score, galleryScore: row.score, collected: false, firstOwned: false })) }, prices, targetGrade: 'S' };
const replay = createGalleryPlanReplay(input);
await writeFile(`${base}/gallery-public-holo-replay.json`, JSON.stringify(replay, null, 2));
const start = performance.now(), result = planGalleryGrade(input);
console.log(JSON.stringify({ ms: performance.now() - start, status: result.status, quoted: Object.keys(prices).length,
  evaluations: result.evaluations, plans: result.plans.map(plan => ({ cost: plan.totalPrice, score: plan.score,
    items: plan.items.map(row => ({ id: row.eaId, name: row.cardName, price: row.price })) })) }));
