import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageKind } from './probe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stop = reason => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false });

// Challenge-driven, read-only route. It queries only the planner's bounded
// catalog lanes and stops after candidate planning; it never creates EA item
// entities, reads unused quotes, or sends a buy order.
export async function inspectPuzzleMarketLive(page, setId, challengeId) {
  if (pageKind(page.url()) !== 'web-app') return stop('WEB_APP_REQUIRED');
  if (![setId, challengeId].every(id => Number.isSafeInteger(id) && id > 0 && id < 1e9)) {
    return stop('FC27_MARKET_ROUTE_INPUT_INVALID');
  }
  const source = `
    export { inspectFc27PuzzlePlan } from './src/adapters/ea/fc27-puzzle-read.js';
    export { createFc27MarketReadTransport, marketReadReason } from './src/adapters/ea/fc27-market-read.js';
    export { planFc27PuzzleShortageQueries, suggestFc27PuzzleJointPurchasesCooperatively } from './src/fc27/puzzle-procurement.js';`;
  const bundle = await build({ absWorkingDir: root,
    stdin: { contents: source, resolveDir: root, sourcefile: 'puzzle-market-live.js' },
    bundle: true, write: false, metafile: true, format: 'iife', globalName: 'MarketRoute', target: 'chrome120' });
  const allowed = new Set(['puzzle-market-live.js', 'src/adapters/ea/fc27-puzzle-read.js',
    'src/adapters/ea/fc27-item-factory-observer.js',
    'src/adapters/ea/fc27-market-read.js', 'src/adapters/ea/fc27-club-read.js',
    'src/adapters/ea/fc27-local-read.js', 'src/adapters/ea/fc27-fsu-read.js',
    'src/adapters/ea/fc27-fsu-diagnostics.js', 'src/adapters/ea/fc27-traditional-read.js',
    'src/adapters/ea/fc27-challenge-catalog.js', 'src/adapters/ea/fc27-sbc-read.js',
    'src/domain/player-rarity.js', 'src/fc27/prelaunch-contract.js', 'src/fc27/sbc-requirements.js',
    'src/fc27/traditional-preview.js', 'src/fc27/puzzle-preview.js', 'src/fc27/puzzle-evaluator.js',
    'src/fc27/market-query-route.js', 'src/fc27/puzzle-material-policy.js', 'src/fc27/puzzle-procurement-policy.js',
    'src/fc27/puzzle-procurement.js']);
  if (Object.keys(bundle.metafile.inputs).some(name => !allowed.has(name.replaceAll('\\', '/')))) {
    throw new Error('Unreviewed puzzle market route dependency');
  }
  return page.evaluate(`(() => { ${bundle.outputFiles[0].text}
    return MarketRoute.inspectFc27PuzzlePlan(globalThis, { setId: ${setId}, challengeId: ${challengeId} }, async inputs => {
      const route = MarketRoute.planFc27PuzzleShortageQueries(inputs);
      if (route.status !== 'ready') return route;
      try {
        const transport = await MarketRoute.createFc27MarketReadTransport(globalThis);
        const pages = [];
        for (const query of route.queries) pages.push(await transport.readCatalogPage(query));
        const entries = [...new Map(pages.flatMap(page => page.entries).map(item => [item.definitionId, item])).values()];
        const suggestion = await MarketRoute.suggestFc27PuzzleJointPurchasesCooperatively(inputs, entries);
        const selected = { definitionIds: suggestion.plans?.[0]?.purchases.map(item => item.definitionId) ?? [] };
        // Catalog/solver inspection stops before quotes: no unused versions are
        // quoted. The production session quotes only complete valid plans.
        const quotes = [];
        return { status: 'blocked', reason: 'FC27_MARKET_ROUTE_OBSERVED', safeCandidates: 0,
          nodes: 0, marketRoute: { queries: route.queries, pages, selected, quotes,
            suggestion: { status: suggestion.status, reason: suggestion.reason, nodes: suggestion.nodes,
              marketCandidates: suggestion.marketCandidates, plans: (suggestion.plans ?? []).map(plan => ({
                purchaseCount: plan.purchaseCount, teamFacts: plan.teamFacts,
                purchases: plan.purchases.map(item => ({ definitionId: item.definitionId, rating: item.rating, slot: item.slot })),
                ownedCount: plan.selectedOwned.length })) },
            requests: transport.getRequestCount(), complete: false, executable: false,
            materialPolicyBlocked: inputs.policy.onlyUntradeable === true },
          pending: ['EXPLICIT_PURCHASE_APPROVAL', 'LIVE_PURCHASE_AND_FILL_ACCEPTANCE'] };
      } catch (error) { return { status: 'blocked', reason: MarketRoute.marketReadReason(error) }; }
    }); })()`);
}
