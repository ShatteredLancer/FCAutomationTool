import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

export async function exerciseCacheCompression(context, out, root = process.cwd()) {
  const config = JSON.parse(await readFile(path.join(root, 'FSU_mod/fsu-mod.config.json'), 'utf8'));
  const fsu = await readFile(path.join(root, 'FSU_mod', config.modifiedFile), 'utf8');
  const start = fsu.indexOf('    function createFsuClubCacheCodec(');
  const end = fsu.indexOf('    const fsuClubCacheCodec = ', start);
  assert(start >= 0 && end > start);
  const artifact = await build({ stdin: { contents: `
    import * as codec from './src/adapters/browser/fc27-gallery-cache-codec.js';
    import { compactGalleryPublicCaches } from './src/adapters/browser/fc27-gallery-public-cache-migration.js';
    import { futggGalleryPool } from './tests/fixtures/fc27-gallery.js';
    import { compactFc27Storage } from './src/adapters/browser/fc27-storage-maintenance.js';
    import { decodeStoredValue } from './src/runtime/compact-storage.js';
    import { createStreamlinedJournal, streamlinedJournalKey } from './src/streamlined/journal.js';
    import { testPlan } from './tests/helpers/streamlined.js';
    import { FC27_TRADITIONAL_WEB_LOCK } from './src/fc27/traditional-lock.js';
    globalThis.cacheCompressionTest = { ...codec, compactGalleryPublicCaches, futggGalleryPool,
      compactFc27Storage, decodeStoredValue, createStreamlinedJournal, streamlinedJournalKey, testPlan, FC27_TRADITIONAL_WEB_LOCK };
  `, resolveDir: root }, bundle: true, format: 'iife', write: false });
  const page = await context.newPage();
  try {
    const url = 'https://fcat-offline.invalid/storage';
    await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline lossless cache test</title>' }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: artifact.outputFiles[0].text });
    await page.addScriptTag({ content: fsu.slice(start, end) + '\nglobalThis.fsuCodec = createFsuClubCacheCodec();' });
    const report = await page.evaluate(async () => {
      const api = globalThis.cacheCompressionTest;
      const payload = Array.from({ length: 250 }, (_, id) => ({ id, resourceId: 123456 + id,
        rating: 84, untradeable: true, attributes: Array(200).fill(80), native: 'retain all fields'.repeat(30) }));
      const times = {};
      let start = performance.now();
      const encoded = await globalThis.fsuCodec.encode(payload);
      times.fsuEncodeMs = Math.round(performance.now() - start);
      start = performance.now();
      const decoded = await globalThis.fsuCodec.decode(encoded);
      times.fsuDecodeMs = Math.round(performance.now() - start);
      const store = new Map([
        ['fsu_club_entities_v2_27_fixture_slot0_0', JSON.stringify(payload)],
        ['fsu_club_entities_v2_27_other_slot1_0', JSON.stringify(payload)], ['lock', 'untouched'],
      ]);
      globalThis.GM_listValues = () => [...store.keys()];
      globalThis.GM_getValue = (key, fallback) => store.get(key) ?? fallback;
      globalThis.GM_setValue = (key, value) => store.set(key, value);
      const fsuMigration = await globalThis.fsuCodec.compact();
      const value = { schema: 3, concepts: payload, native: payload };
      const packed = await api.encodeGalleryCacheValue(value);
      const restored = await api.decodeGalleryCacheValue(packed);
      const base = 'fcat-fc27-gallery-pools:27:public';
      const poolPayload = api.futggGalleryPool(30); poolPayload.extra = payload;
      const legacy = { schema: 1, season: '27', scope: 'public', entries: [{ setId: 30, fetchedAt: 1000, payload: poolPayload }] };
      const pools = new Map([[base, legacy], [`${base}:set:30:checked`, { untouched: true }]]);
      const poolMigration = await api.compactGalleryPublicCaches({ list: () => [...pools.keys()],
        get: (key, fallback) => pools.get(key) ?? fallback, set: (key, val) => pools.set(key, val) });
      const copy = await api.decodeGalleryCacheValue(pools.get(`${base}:set:30`));
      const nativeStore = new Map(), nativeIo = { list: () => [...nativeStore.keys()],
        get: (key, fallback) => nativeStore.get(key) ?? fallback, set: (key, value) => nativeStore.set(key, value) };
      const plan = api.testPlan(), journal = api.createStreamlinedJournal(nativeIo);
      const record = await journal.begin(plan);
      record.batches[0].state = 'unknown'; record.completeEvidence = payload;
      const durable = await journal.write(plan.context, record, record.revision);
      const reloaded = await api.createStreamlinedJournal(nativeIo).read(plan.context);
      let unknownStillBlocks = false;
      try { await api.createStreamlinedJournal(nativeIo).begin(plan); } catch (error) {
        unknownStillBlocks = error.message.includes('RECOVERY_REQUIRED');
      }
      const key = api.streamlinedJournalKey(plan.context), compressedJournal = nativeStore.get(key);
      nativeStore.set(key, durable); nativeStore.set('lock_26', 'preserved');
      let releaseLock, acquired;
      const ready = new Promise(resolve => { acquired = resolve; });
      const holding = navigator.locks.request(api.FC27_TRADITIONAL_WEB_LOCK, async () => {
        acquired(); await new Promise(resolve => { releaseLock = resolve; });
      });
      await ready;
      const busyMigration = await api.compactFc27Storage({ ...nativeIo, locks: navigator.locks });
      const busyRetained = JSON.stringify(nativeStore.get(key)) === JSON.stringify(durable);
      releaseLock(); await holding;
      const journalMigration = await api.compactFc27Storage({ ...nativeIo, locks: navigator.locks });
      const journalRoundtrip = JSON.stringify(await api.decodeStoredValue(nativeStore.get(key))) === JSON.stringify(durable)
        && JSON.stringify(reloaded) === JSON.stringify(durable);
      nativeStore.set(key, { ...compressedJournal, bytes: 1 });
      let corruptJournalBlocked = false;
      try { await api.createStreamlinedJournal(nativeIo).read(plan.context); } catch { corruptJournalBlocked = true; }
      let corruptRejected = false;
      try { await globalThis.fsuCodec.decode('{"format":"fsu-club-gzip-v1","data":"corrupt"}'); }
      catch { corruptRejected = true; }
      return { fsuVersion: '26.09.10', fsuBefore: JSON.stringify(payload).length, fsuAfter: encoded.length,
        losslessFsu: JSON.stringify(decoded) === JSON.stringify(payload),
        losslessGallery: JSON.stringify(restored) === JSON.stringify(value),
        legacyPoolRetainedFields: JSON.stringify(copy.payload) === JSON.stringify(poolPayload),
        aggregateCleared: pools.get(base) === null, checkedUntouched: pools.get(`${base}:set:30:checked`).untouched,
        fsuMigration, poolMigration, corruptRejected, times, journalMigration, journalRoundtrip,
        busyRetained, busyMigration, nativeWebLocks: true,
        unknownStillBlocks, corruptJournalBlocked, lockUntouched: nativeStore.get('lock_26') === 'preserved',
        eaRequests: 0, syntheticOnly: true };
    });
    for (const flag of ['losslessFsu', 'losslessGallery', 'legacyPoolRetainedFields', 'aggregateCleared', 'checkedUntouched', 'corruptRejected',
      'journalRoundtrip', 'unknownStillBlocks', 'corruptJournalBlocked', 'lockUntouched', 'busyRetained']) assert.equal(report[flag], true, flag);
    assert.equal(report.fsuMigration.compacted, 2); assert.equal(report.fsuMigration.failed, 0);
    assert.equal(report.poolMigration.migrated, 1); assert.equal(report.poolMigration.failed, 0);
    assert.equal(report.journalMigration.compacted, 1); assert.equal(report.journalMigration.failed, 0);
    assert.equal(report.busyMigration.deferred, 1); assert.equal(report.busyMigration.compacted, 0);
    await writeFile(path.join(out, 'cache-compression-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log('Chrome lossless cache smoke passed: FSU/Gallery, full journals, unknown recovery, corruption/migration; no EA calls.');
    return report;
  } finally { await page.close(); }
}
