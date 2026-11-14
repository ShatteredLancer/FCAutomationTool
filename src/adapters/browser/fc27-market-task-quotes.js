import { createFc27PublicPrices } from './fc27-public-prices.js';
import { normalizeGalleryPricePolicy } from '../../gallery/public-price-policy.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// No IO at construction; shares exact public quote/mapping keys, not source
// preferences. Executable prices always use the actual account platform.
export function createFc27MarketTaskQuotes({ taskStore, readCatalog, ...options }) {
  const prices = createFc27PublicPrices({ ...options, policyReader: async scope => {
    const snapshot = await taskStore.read();
    if (snapshot.context.scope !== scope || !same(snapshot.context, taskStore.context())) throw Error('TASKS_CONTEXT_CHANGED');
    const source = snapshot.store.settings.source;
    return normalizeGalleryPricePolicy({ readSources: source, source: source === 'futgg' ? 'futgg' : 'futbin',
      futbinPlatform: snapshot.context.platform === 'pc' ? 'pc' : 'ps' });
  } });
  return Object.freeze({ async load(ids, { source, context, rows: suppliedRows = null, isCurrent = () => true }) {
    const check = async () => {
      if (!isCurrent() || !same(context, prices.context()) || !same(context, taskStore.context())) throw Error('TASKS_CONTEXT_CHANGED');
      const snapshot = await taskStore.read();
      if (!same(snapshot.context, context) || snapshot.store.settings.source !== source) throw Error('TASKS_AUTHORIZATION_CHANGED');
    };
    await check();
    const rows = suppliedRows ?? await readCatalog(ids); await check();
    const policy = await prices.readSettings(); await check();
    const result = await prices.load(ids, { policy, purpose: 'purchase', rows,
      sources: source === 'both' ? ['futbin', 'futgg'] : [source],
      deadlineAt: (options.now?.() ?? Date.now()) + 30000,
      isCurrent: () => isCurrent() && same(context, taskStore.context()) });
    await check();
    return Object.fromEntries(ids.map(id => [id, result.references[id]?.quotes ?? {}]));
  } });
}
