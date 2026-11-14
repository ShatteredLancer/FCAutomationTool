import { it, expect, vi } from 'vitest';
import { marketNativeRuntime } from '../helpers/market-native-runtime.js';
import { createFc27MarketTaskExecution } from '../../src/adapters/browser/fc27-market-task-execution.js';
import { createFc27MarketTaskNative } from '../../src/adapters/browser/fc27-market-task-native.js';
import { createTradingTaskStore } from '../../src/adapters/browser/fc27-trading-task-store.js';
import { createMarketCoordinator } from '../../src/adapters/browser/fc27-market-coordinator.js';
import { traditionalJournalScope } from '../../src/fc27/traditional-journal.js';
import { readFc27Context } from '../../src/adapters/ea/fc27-local-read.js';
import { defaultTradingTaskSettings } from '../../src/trading/task-model.js';

async function fixture() {
  const f = marketNativeRuntime(), data = new Map(), context = { scope: traditionalJournalScope(readFc27Context(f.root)), season: '27', platform: 'pc' };
  const get = async (key, fallback) => structuredClone(data.get(key) ?? fallback), set = async (key, value) => data.set(key, structuredClone(value));
  const locks = { request: async (name, _options, callback) => callback({ name, mode: 'exclusive' }) };
  const store = createTradingTaskStore({ context: () => context, get, set, locks, now: f.now, id: () => 'sell' });
  const coordinator = createMarketCoordinator({ context: () => context, get, set, locks });
  f.makeCard(201, 901, 'transfer');
  const snapshot = await store.saveTask({ ...await store.read(), input: { name: 'Synthetic sale', mode: 'sell',
    settings: { ...defaultTradingTaskSettings(), sellRule: 'fixed', sellValue: 700 }, players: [], excluded: [],
    owned: [{ itemId: '201', definitionId: 901, name: 'Synthetic', pile: 'transfer' }] } });
  const gmRequest = vi.fn(() => { throw Error('unexpected public request'); });
  const createNative = vi.fn(options => createFc27MarketTaskNative({ ...options, ...f }));
  const runtime = createFc27MarketTaskExecution({ root: f.root, get, set, taskStore: store, coordinator, gmRequest,
    readCatalog: () => [], transport: {}, liveEnabled: true, now: f.now, createNative });
  return { ...f, data, store, coordinator, snapshot, runtime, gmRequest, createNative };
}
it('composes production protections/store/provider/native through selected Transfer sale, with no fake purchase or eager request', async () => {
  const f = await fixture(); expect(f.createNative).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  f.runtime.subscribe(s => { if (s.evidence?.some(e => e.counts[1] === 1) && s.tasks.some(t => ['queued', 'running'].includes(t.state))) f.runtime.pauseAll(); });
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  const ledger = (await f.coordinator.inspect()).ledger;
  expect(ledger.holdings).toMatchObject([{ itemId: '201', phase: 'listed', cost: null }]);
  expect(f.calls.filter(c => ['bid', 'move', 'list'].includes(c[0]))).toEqual([['list', 201, 700, 700, 3600]]);
  await f.runtime.recover(); expect(f.calls.filter(c => c[0] === 'list')).toHaveLength(1);
  expect(f.gmRequest).not.toHaveBeenCalled();
});
it('blocks protected selected cards in the actual production composition without dispatch or deleting the task', async () => {
  const f = await fixture(); f.root.info.lock.push(201);
  await f.runtime.run({ approved: true, snapshot: f.snapshot, taskIds: ['sell'] });
  expect(f.calls.filter(c => ['bid', 'move', 'list'].includes(c[0]))).toEqual([]);
  expect(f.runtime.inspect().reason).toBe('MARKET_HOLDING_PROTECTED');
  expect((await f.store.read()).store.tasks).toHaveLength(1);
  expect((await f.coordinator.inspect()).ledger.intents).toEqual([]);
});
