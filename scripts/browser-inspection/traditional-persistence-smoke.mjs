import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function exerciseTraditionalPersistence(context, directory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-transaction-persistence.js'],
    bundle: true, write: false, format: 'iife', globalName: 'PersistenceSmoke', target: 'chrome120' });
  const values = new Map();
  const pages = [];
  const url = 'https://fcat-offline.invalid/persistence';
  let externalRequests = 0;
  const install = async page => {
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const context = { schema: 1, season: '27', accountScope: 'synthetic-smoke', platform: 'pc' };
      const scope = 'fcat:[1,"27","synthetic-smoke","pc","traditional-sbc-journal"]';
      const provider = globalThis.PersistenceSmoke.createFc27TransactionPersistence({ context,
        gmGetValue: globalThis.persistenceSmokeGet, gmSetValue: globalThis.persistenceSmokeSet,
        lockManager: globalThis.navigator.locks });
      globalThis.persistenceSmoke = { provider, scope, calls: 0, holding: false,
        record: { schema: 1, scope, operationId: 'smoke-operation', setId: 4, challengeId: 16,
          itemRefs: [{ id: 1, definitionId: 101, pile: 'club' }],
          reward: { scope: 'set', type: 'pack', value: 509, count: 1, tradable: false },
          rewardBaselineCount: 0, phase: 'save-pending', updatedAt: 1000, submitted: false } };
    });
    assert.equal((await page.evaluate(() => globalThis.persistenceSmoke.provider.inspect())).lockSupported, true);
  };
  const newPage = async () => {
    const page = await context.newPage(); pages.push(page);
    await page.route('**/*', route => {
      if (route.request().url() === url) return route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><title>FC27 persistence fixture</title>' });
      externalRequests++;
      return route.abort();
    });
    // This shared binding store simulates GM persistence; it is not Tampermonkey.
    await page.exposeFunction('persistenceSmokeGet', (key, fallback) => values.has(key) ? structuredClone(values.get(key)) : fallback);
    await page.exposeFunction('persistenceSmokeSet', (key, value) => { values.set(key, structuredClone(value)); });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await install(page);
    return page;
  };
  try {
    const first = await newPage(); const second = await newPage();
    await first.evaluate(() => {
      const state = globalThis.persistenceSmoke;
      state.pending = state.provider.exclusive(state.scope, async () => {
        await state.provider.journal.write(state.scope, state.record);
        state.holding = true;
        await new Promise(resolve => { state.release = resolve; });
      });
    });
    await first.waitForFunction(() => globalThis.persistenceSmoke.holding, { }, { timeout: 10000 });
    const collision = await second.evaluate(async () => {
      const state = globalThis.persistenceSmoke;
      const result = await state.provider.exclusive(state.scope, () => { state.calls++; });
      return { denied: result === null, calls: state.calls };
    });
    assert.deepEqual(collision, { denied: true, calls: 0 });
    await first.evaluate(async () => { const state = globalThis.persistenceSmoke; state.release(); await state.pending; });

    await first.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }); await install(first);
    const restored = await first.evaluate(async () => {
      const state = globalThis.persistenceSmoke;
      return state.provider.exclusive(state.scope, async () => {
        const record = await state.provider.journal.read(state.scope);
        try {
          await state.provider.journal.write(state.scope, { ...state.record, operationId: 'new-operation' });
          return { phase: record.phase, blocked: false };
        } catch (error) { return { phase: record.phase, blocked: error.message === 'FC27_JOURNAL_TRANSITION_UNVERIFIED' }; }
      });
    });
    assert.deepEqual(restored, { phase: 'save-pending', blocked: true });

    await first.evaluate(() => {
      const state = globalThis.persistenceSmoke;
      state.pending = state.provider.exclusive(state.scope, async () => {
        state.holding = true; await new Promise(() => {});
      });
    });
    await first.waitForFunction(() => globalThis.persistenceSmoke.holding, {}, { timeout: 10000 });
    await first.close();
    const afterClose = await second.evaluate(async () => {
      const state = globalThis.persistenceSmoke;
      return state.provider.exclusive(state.scope, async () => (await state.provider.journal.read(state.scope)).phase);
    });
    assert.equal(afterClose, 'save-pending');
    assert.equal(values.size, 1);
    assert.equal(externalRequests, 0);
    await writeFile(path.join(directory, 'traditional-persistence-self-test.json'), JSON.stringify({ schema: 1,
      webLocks: 'native-browser', storage: 'simulated-GM-bindings', crossTabExclusion: true,
      reloadRetainsPending: true, ownerCloseReleasesLock: true, pendingOverwriteBlocked: true,
      externalRequests, liveExecutionEnabled: false }, null, 2));
    console.log('Traditional persistence offline smoke passed: native Web Locks, two tabs, reload and owner close. GM simulated; no EA or installation validation.');
  } finally {
    for (const page of pages) if (!page.isClosed()) await page.close();
  }
}
