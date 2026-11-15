import assert from 'node:assert/strict';
import { build } from 'esbuild';

export async function exerciseGalleryEnhancerHistory(context) {
  const page = await context.newPage();
  try {
    await page.route('https://gallery-history.test/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Offline history</title>' }));
    await page.goto('https://gallery-history.test/');
    const bundle = await build({ entryPoints: ['src/adapters/browser/fc27-gallery-enhancer-history.js'],
      bundle: true, write: false, format: 'iife', globalName: 'GalleryHistory', target: 'chrome120' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const { indexedDB, GalleryHistory } = globalThis;
      const read = () => GalleryHistory.readEnhancerGalleryHistory(indexedDB, '1002');
      const absent = await read();
      const afterAbsent = (await indexedDB.databases()).map(db => db.name);
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('fce-27', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('setting');
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      const value = JSON.stringify({ version: 2, state: { playersByPersonaId: { 1002: { 2001: true, 2002: false } } } });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('setting', 'readwrite');
        tx.objectStore('setting').put(value, 'gallery-collected-players-state');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
      const history = await read(), other = await GalleryHistory.readEnhancerGalleryHistory(indexedDB, '1003');
      const after = await indexedDB.databases();
      return { absent, afterAbsent, history: [...history], other, version: after.find(row => row.name === 'fce-27').version };
    });
    assert.deepEqual(result, { absent: null, afterAbsent: [], history: [[2001, true], [2002, false]], other: null, version: 1 });
    console.log('Offline Gallery Enhancer history: absent DB remains absent, exact persona/readonly history and version preserved.');
  } finally { await page.close(); }
}
