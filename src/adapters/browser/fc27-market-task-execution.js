import { createMarketTaskRuntime } from '../../trading/market-task-runtime.js';
import { createMarketTaskScheduler } from '../../trading/market-task-scheduler.js';
import { createMarketTaskProvider } from '../../trading/market-task-provider.js';
import { createFc27MarketTaskNative } from './fc27-market-task-native.js';
import { createFc27MarketTaskGuards } from './fc27-market-task-guards.js';
import { createFc27MarketTaskQuotes } from './fc27-market-task-quotes.js';

export function createFc27MarketTaskExecution({ root, get, set, gmRequest, transport, taskStore, coordinator,
  readCatalog, liveEnabled = false, diagnosticLog = null, now = () => Date.now(),
  createNative = createFc27MarketTaskNative }) {
  const quotes = createFc27MarketTaskQuotes({ root, get, set, gmRequest, transport, taskStore, readCatalog, diagnosticLog, now });
  return createMarketTaskRuntime({ context: taskStore.context, enabled: liveEnabled === true,
    createScheduler: async ({ context, assertCurrent }) => {
      const guards = createFc27MarketTaskGuards({ root, get, context, assertCurrent });
      const native = await createNative({ root, assertCurrent, ...guards, now }); assertCurrent();
      const provider = createMarketTaskProvider({ context, native, assertCurrent, now,
        loadQuotes: (ids, options) => quotes.load(ids, { ...options, isCurrent: () => { assertCurrent(); return true; } }) });
      return createMarketTaskScheduler({ taskStore, coordinator, provider, enabled: liveEnabled === true, now,
        onDiagnostic: fields => diagnosticLog?.record?.(fields) });
    },
  });
}
