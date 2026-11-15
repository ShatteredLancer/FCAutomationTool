import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Explicit inspector command only: one authenticated read, no task startup,
// account data export, market search, purchase, movement or listing.
export async function checkMarketSession(page, directory) {
  const bundle = await build({ stdin: { resolveDir: path.resolve(import.meta.dirname, '../..'),
    contents: "export { createFc27MarketReadTransport } from './src/adapters/ea/fc27-market-read.js';" },
  bundle: true, write: false, format: 'iife', globalName: 'SessionCheck' });
  const result = await page.evaluate(`(async () => { ${bundle.outputFiles[0].text}
    try {
      const reader = await SessionCheck.createFc27MarketReadTransport(globalThis, { quotesOnly: true, maxRequests: 1 });
      const result = await reader.readSessionHealth({ beforeDispatch: () => {} });
      return { ...result, requests: reader.getRequestCount(), marketSearches: 0, eaMutations: 0 };
    } catch (error) {
      return { status: 'blocked', reason: /^FC27_MARKET_[A-Z0-9_]+$/.test(error.message) ? error.message : 'UNVERIFIED',
        httpStatus: error.marketFailure?.httpStatus ?? null, eaCode: error.marketFailure?.eaCode ?? null };
    }
  })()`);
  await writeFile(path.join(directory, 'market-session-live.json'), JSON.stringify(result, null, 2));
  return result;
}
