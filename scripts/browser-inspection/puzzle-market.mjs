import { build } from 'esbuild';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFc27PlayerCatalog, indexFc27MarketQuotes } from '../../src/fc27/market-catalog.js';
import { normalizeFc27MarketPolicy } from '../../src/fc27/puzzle-market.js';
import { readPuzzleAiEnvironment } from './puzzle-ai.mjs';
import { buildFc27LlmRequest, runFc27LlmAssistant } from '../../src/fc27/llm-assistant.js';
import { createFc27LlmFetchTransport } from '../../src/adapters/browser/fc27-llm-http.js';
import { pageKind } from './probe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stop = reason => ({ status: 'blocked', reason, executable: false, liveExecutionEnabled: false });
const MAX_BYTES = 24 * 1024 * 1024;

// Temporary reviewed-provider snapshot seam. No guessed FUTNext season label,
// automatic full-corpus scraping, credentials, or model/network calls here.
export function validatePuzzleMarketData(value, now = Date.now()) {
  if (!value || Object.keys(value).sort().join() !== 'catalog,marketPolicy,platform,quotes,schema'
      || value.schema !== 1 || !normalizeFc27MarketPolicy(value.marketPolicy)) return stop('FC27_MARKET_INPUT_INVALID');
  const normalized = normalizeFc27PlayerCatalog(value.catalog, now);
  if (normalized.status !== 'ready') return stop(normalized.reason);
  if (normalized.catalog.seasonEvidence === 'synthetic-fixture') return stop('FC27_MARKET_SYNTHETIC_DATA_REJECTED');
  const quotes = indexFc27MarketQuotes(value.quotes, { now, platform: value.platform, maxUnitPrice: value.marketPolicy.maxUnitPrice });
  if (!quotes?.size) return stop('FC27_MARKET_QUOTES_UNAVAILABLE');
  return { status: 'ready', data: { schema: 1, platform: value.platform, catalog: normalized.catalog,
    quotes: [...quotes.values()], marketPolicy: { ...value.marketPolicy } } };
}

export async function readPuzzleMarketData({ file = process.env.FCAT_MARKET_INPUT_FILE || path.join(root, 'artifacts/fc27-market/input.json'), now = Date.now() } = {}) {
  let handle;
  try {
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) return stop('FC27_MARKET_INPUT_LIMIT');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) return stop('FC27_MARKET_INPUT_CHANGED');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || offset !== stat.size || after.mtimeMs !== stat.mtimeMs
        || after.ctimeMs !== stat.ctimeMs) return stop('FC27_MARKET_INPUT_CHANGED');
    return validatePuzzleMarketData(JSON.parse(bytes.toString('utf8')), now);
  } catch (error) { return stop(error?.code === 'ENOENT' ? 'FC27_MARKET_DATA_REQUIRED' : 'FC27_MARKET_INPUT_INVALID'); }
  finally { await handle?.close(); }
}

// Key stays in Node. A short-lived page closure holds owned item refs; only
// purchase-version hypotheses and aggregate plan output reach the local report.
export async function inspectPuzzleMarket(page, setId, challengeId, options = {}) {
  const withAi = options.withAi === true;
  const settings = withAi ? options.settings ?? readPuzzleAiEnvironment() : null;
  if (withAi && settings.status !== 'ready') return stop(settings.reason ?? 'FC27_LLM_DISABLED');
  if (withAi && (!settings.approved || options.marketApproved !== true && process.env.FCAT_LLM_SHARE_MARKET !== 'true')) {
    return stop('FC27_LLM_MARKET_DATA_APPROVAL_REQUIRED');
  }
  if (withAi) {
    const preflight = buildFc27LlmRequest(settings.config, settings.credential, { synthetic: true });
    if (preflight.status !== 'ready') return preflight;
  }
  if (pageKind(page.url()) !== 'web-app' || ![setId, challengeId].every(id => Number.isSafeInteger(id) && id > 0 && id < 1e9)) return stop('FC27_LLM_INPUT_INVALID');
  const loaded = options.data ? validatePuzzleMarketData(options.data) : await readPuzzleMarketData();
  if (loaded.status !== 'ready') return loaded;
  const source = `export { inspectFc27PuzzlePlan } from './src/adapters/ea/fc27-puzzle-read.js';
    export { createFc27PuzzleMarketSession, summarizeFc27MarketPlan } from './src/fc27/puzzle-market-session.js';
    export { previewFc27PuzzleMarket } from './src/fc27/puzzle-market.js';
    export { readFc27Context, readFc27CachedClub } from './src/adapters/ea/fc27-local-read.js';
    export { readFc27RunnerPolicy } from './src/adapters/ea/fc27-fsu-read.js';`;
  const bundle = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, sourcefile: 'puzzle-market-inspection.js' },
    bundle: true, write: false, metafile: true, format: 'iife', globalName: 'MarketRead', target: 'chrome120' });
  const allowed = new Set(['puzzle-market-inspection.js', 'src/fc27/puzzle-market-session.js', 'src/fc27/market-catalog.js', 'src/fc27/puzzle-market.js',
    'src/adapters/ea/fc27-puzzle-read.js', 'src/adapters/ea/fc27-local-read.js', 'src/adapters/ea/fc27-fsu-read.js',
    'src/adapters/ea/fc27-fsu-diagnostics.js', 'src/adapters/ea/fc27-traditional-read.js', 'src/adapters/ea/fc27-challenge-catalog.js',
    'src/adapters/ea/fc27-sbc-read.js', 'src/domain/player-rarity.js', 'src/fc27/prelaunch-contract.js',
    'src/fc27/traditional-preview.js', 'src/fc27/sbc-requirements.js', 'src/fc27/puzzle-preview.js', 'src/fc27/puzzle-material-policy.js', 'src/fc27/puzzle-evaluator.js']);
  if (Object.keys(bundle.metafile.inputs).some(name => !allowed.has(name.replaceAll('\\', '/')))) throw new Error('Unreviewed market inspection dependency');
  const key = `__fcat_market_${randomUUID().replaceAll('-', '')}`;
  try {
    await page.evaluate(`(() => { ${bundle.outputFiles[0].text}
      globalThis[${JSON.stringify(key)}] = { start: async (data, setId, challengeId) => {
        let session; let plan;
        const fingerprint = () => JSON.stringify({ context: MarketRead.readFc27Context(globalThis),
          policy: MarketRead.readFc27RunnerPolicy(globalThis, 74), club: MarketRead.readFc27CachedClub(globalThis) });
        const report = await MarketRead.inspectFc27PuzzlePlan(globalThis, { setId, challengeId }, input => {
          if (input.context.platform !== data.platform) return { status: 'blocked', reason: 'FC27_MARKET_PLATFORM_MISMATCH' };
          const inputs = { ...input, ...data, now: Date.now() };
          session = MarketRead.createFc27PuzzleMarketSession(inputs);
          plan = session.status === 'ready' ? session.result() : MarketRead.previewFc27PuzzleMarket(inputs);
          return plan;
        });
        if (!plan || report.reason === 'FC27_RUNNER_INPUTS_CHANGED') return { report };
        const signature = fingerprint();
        const unchanged = () => { if (signature !== fingerprint()) throw new Error('FC27_LLM_INPUT_CHANGED'); };
        const summary = () => {
          unchanged(); const current = session?.status === 'ready' ? session.result() : plan;
          return { ...report, status: current.status, reason: current.reason,
            plan: MarketRead.summarizeFc27MarketPlan(current), purchases: current.purchases ?? [],
            coverage: current.coverage, optimization: current.optimization,
            balanceSource: 'reviewed-input-not-live', marketAvailabilityVerified: false, executable: false,
            pending: [...(report.pending ?? []), ...(current.pending ?? [])] };
        };
        globalThis[${JSON.stringify(key)}].observe = () => { unchanged(); return session.observe(); };
        globalThis[${JSON.stringify(key)}].run = hint => { unchanged(); return session.run(hint); };
        globalThis[${JSON.stringify(key)}].result = summary;
        return { report: summary(), observation: session?.status === 'ready' ? session.observe() : null };
      } };
      const timer = setTimeout(() => { delete globalThis[${JSON.stringify(key)}]; }, 180000);
      globalThis[${JSON.stringify(key)}].close = () => clearTimeout(timer);
    })()`);
    const initial = await page.evaluate(({ key, data, setId, challengeId }) => globalThis[key].start(data, setId, challengeId),
      { key, data: loaded.data, setId, challengeId });
    if (!withAi || !initial.observation) return initial.report;
    const session = {
      observe: () => page.evaluate(key => globalThis[key].observe(), key),
      run: hint => page.evaluate(({ key, hint }) => globalThis[key].run(hint), { key, hint }),
    };
    const assistant = await runFc27LlmAssistant({ config: settings.config, credential: settings.credential,
      approved: settings.approved, session, transport: options.transport ?? createFc27LlmFetchTransport() });
    try { return { ...await page.evaluate(key => globalThis[key].result(), key), assistant }; }
    catch { return { ...stop('FC27_LLM_INPUT_CHANGED'), assistant }; }
  } finally { await page.evaluate(key => { globalThis[key]?.close(); delete globalThis[key]; }, key).catch(() => {}); }
}

export const inspectPuzzleMarketWithAi = (page, setId, challengeId, options = {}) =>
  inspectPuzzleMarket(page, setId, challengeId, { ...options, withAi: true });
