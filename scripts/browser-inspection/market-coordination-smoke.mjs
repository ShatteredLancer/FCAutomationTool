import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

export async function exerciseMarketCoordination(context, directory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
    export * from './src/adapters/browser/fc27-market-coordinator.js';
    export * from './src/trading/market-coordination.js';
    export { defaultTradingPublicSettings } from './src/trading/task-model.js';
    export { FC27_TRADITIONAL_WEB_LOCK } from './src/fc27/traditional-lock.js';
  ` }, bundle: true, write: false, format: 'iife', globalName: 'CoordinationSmoke', target: 'chrome120' });
  const values = new Map([['legacy-journal', { unknown: true }]]), pages = [], errors = [];
  const url = 'https://fcat-offline.invalid/market-coordination'; let externalRequests = 0;
  const install = async page => {
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const api = globalThis.CoordinationSmoke;
      const account = { scope: 'coordination-smoke', season: '27', platform: 'console' };
      const coordinator = api.createMarketCoordinator({ context: () => account,
        get: globalThis.coordinationGet, set: globalThis.coordinationSet, locks: globalThis.navigator.locks });
      globalThis.coordination = { api, account, coordinator, entered: false, calls: 0,
        settings: { ...api.defaultTradingPublicSettings(), gapMin: 7, gapMax: 7 },
        buy: { id: 'buy', taskId: 'A', kind: 'buy', itemId: '100', definitionId: 1001, tradeId: '500', coins: 800, at: 1000 },
        funds: { balance: 1000, reserve: null, totalCap: null, taskCap: null, spendCap: null, freeSlots: 1 } };
    });
  };
  const newPage = async () => {
    const page = await context.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() === url) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Market coordination fixture</title>' });
      externalRequests++; return route.abort();
    });
    await page.exposeFunction('coordinationGet', (key, fallback) => structuredClone(values.get(key) ?? fallback));
    await page.exposeFunction('coordinationSet', (key, value) => { values.set(key, structuredClone(value)); });
    await page.goto(url); await install(page); return page;
  };
  try {
    const first = await newPage(), second = await newPage();
    await first.evaluate(() => {
      const s = globalThis.coordination;
      s.pending = s.coordinator.withOwner(async session => {
        await session.turn(['A', 'B'], async turn => {
          await turn.checkpoint(state => s.api.reserveMarketSearch(state, { requestId: 'search-A', now: 0, settings: s.settings, random: () => 0 }));
          await turn.checkpoint(state => s.api.settleMarketSearch(state, 'search-A', 'sent'));
        });
        s.entered = true; await new Promise(resolve => { s.release = resolve; });
      });
    });
    await first.waitForFunction(() => globalThis.coordination.entered);
    assert.equal(await second.evaluate(async () => {
      const s = globalThis.coordination;
      return (await s.coordinator.withOwner(() => { s.calls++; })).status;
    }), 'busy');
    await first.evaluate(async () => { const s = globalThis.coordination; s.release(); await s.pending; });
    const secondTurn = await second.evaluate(async () => {
      const s = globalThis.coordination;
      return s.coordinator.withOwner(session => session.turn(['A', 'B'], turn => ({ taskId: turn.taskId,
        gate: s.api.marketSearchGate(turn.inspect(), s.settings, 0) })));
    });
    assert.equal(secondTurn.taskId, 'B'); assert.equal(secondTurn.gate.hour, 1); assert.equal(secondTurn.gate.nextAt, 7000);

    // The shared old transaction lock excludes this new task coordinator too.
    await first.evaluate(() => {
      const s = globalThis.coordination; s.entered = false;
      s.pending = globalThis.navigator.locks.request(s.api.FC27_TRADITIONAL_WEB_LOCK, async () => {
        s.entered = true; await new Promise(resolve => { s.release = resolve; });
      });
    });
    await first.waitForFunction(() => globalThis.coordination.entered);
    assert.equal(await second.evaluate(async () => {
      const s = globalThis.coordination;
      return (await s.coordinator.withOwner(session => session.turn(['A'], () => { s.calls++; }))).status;
    }), 'busy');
    await first.evaluate(async () => { const s = globalThis.coordination; s.release(); await s.pending; });

    await first.evaluate(() => {
      const s = globalThis.coordination; s.entered = false;
      s.pending = s.coordinator.withOwner(async session => {
        await session.turn(['A'], async turn => {
          await turn.checkpoint(state => s.api.reserveMarketWrite(state, s.buy, s.funds));
          s.entered = true; await new Promise(() => {}); // Simulated lost response.
        });
      });
    });
    await first.waitForFunction(() => globalThis.coordination.entered);
    await first.close();
    await second.waitForFunction(async () => {
      const s = globalThis.coordination;
      const result = await s.coordinator.withOwner(session => session.turn(['B'], turn => ({ taskId: turn.taskId, recoveryOnly: turn.recoveryOnly })));
      return result.taskId === 'A' && result.recoveryOnly === true;
    });
    await second.reload(); await install(second);
    const afterReload = await second.evaluate(async () => {
      const s = globalThis.coordination, state = (await s.coordinator.inspect()).ledger;
      return { pending: state.intents.filter(i => i.phase === 'pending').length, calls: s.calls,
        gate: s.api.marketSearchGate(state, s.settings, 0), reserved: s.api.marketOccupancy(state).reservedCoins };
    });
    assert.equal(afterReload.pending, 1); assert.equal(afterReload.calls, 0); assert.equal(afterReload.reserved, 800);
    assert.equal(afterReload.gate.hour, 1); assert.deepEqual(values.get('legacy-journal'), { unknown: true });
    assert.equal(externalRequests, 0); assert.deepEqual(errors, []);
    await writeFile(path.join(directory, 'market-coordination-self-test.json'), JSON.stringify({ passed: true,
      webLocks: 'native Chrome', storage: 'simulated GM', twoTabOwner: true, shortRoundFairness: true,
      legacyLockExclusion: true, reloadRetainsQuotaAndPending: true, ownerCloseRecoveryOnly: true,
      realEaRequests: 0, externalRequests, errors }, null, 2));
    console.log('Market coordination P2 foundation Chrome passed: native two-tab locks, fair rounds, shared cooldown, legacy exclusion, owner-close/reload pending recovery, old evidence retained; simulated GM, no EA/HTTP.');
  } finally { for (const page of pages) if (!page.isClosed()) await page.close(); }
}
