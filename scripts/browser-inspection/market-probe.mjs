import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageKind } from './probe.mjs';
import { projectFc27EaMarketSnapshot } from '../../src/fc27/ea-market-snapshot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function inspectFc27MarketRuntime(page) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  const bundle = await build({ absWorkingDir: root, stdin: {
    contents: "export { probeFc27MarketRuntime } from './src/adapters/ea/fc27-market-read.js';",
    resolveDir: root, sourcefile: 'fc27-market-probe.js',
  }, bundle: true, metafile: true, write: false, format: 'iife', globalName: 'MarketProbe', target: 'chrome120' });
  const allowed = new Set(['fc27-market-probe.js', 'src/adapters/ea/fc27-market-read.js',
    'src/adapters/ea/fc27-club-read.js', 'src/adapters/ea/fc27-local-read.js',
    'src/fc27/prelaunch-contract.js', 'src/domain/player-rarity.js', 'src/fc27/puzzle-procurement-policy.js']);
  if (Object.keys(bundle.metafile.inputs).some(name => !allowed.has(name.replaceAll('\\', '/')))) {
    throw new Error('Unreviewed market probe dependency');
  }
  const probe = await page.evaluate(`(() => { ${bundle.outputFiles[0].text}
    return MarketProbe.probeFc27MarketRuntime(globalThis);
  })()`);
  if (probe.status !== 'observed') return probe;
  // Project in Node, not in the EA page. Preserve observation timestamps and
  // require all quote platforms to agree; never invent a budget or coin balance.
  return { ...probe, planningSnapshot: projectFc27EaMarketSnapshot(probe, { platform: probe.quotes?.[0]?.platform }) };
}
