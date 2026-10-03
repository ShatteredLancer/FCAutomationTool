import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FC27_MARKET_READ_METHODS } from '../../src/adapters/ea/fc27-market-read.js';
import { FC27_SBC_EXECUTION_METHODS, FC27_SBC_CACHE_METHODS } from '../../src/adapters/ea/fc27-traditional-provider.js';
import { FC27_PUZZLE_SYNC_METHODS } from '../../src/adapters/ea/fc27-puzzle-page.js';
import { FC27_BUY_SERVICE_METHODS } from '../../src/adapters/ea/fc27-puzzle-buy.js';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireTools = createRequire(path.join(root, 'tools/browser-inspection/package.json'));
const puzzleReview = process.argv.includes('--puzzle');
const buyReview = process.argv.includes('--buy');
const definitions = buyReview ? FC27_BUY_SERVICE_METHODS.map(([name, hash]) => [`UTItemService.prototype.${name}`, hash])
  : puzzleReview ? [...FC27_MARKET_READ_METHODS, ...FC27_SBC_EXECUTION_METHODS,
  ...FC27_SBC_CACHE_METHODS.filter(([name]) => !name.startsWith('events.')), ...FC27_PUZZLE_SYNC_METHODS,
  ['UTSquadEntity.prototype.setPlayers']] : FC27_MARKET_READ_METHODS;
const { chromium } = requireTools('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, proxy: { server: 'http://127.0.0.1:1080' },
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'FCAT_LLM_API_KEY')) });
const report = { schema: 1, observedAt: new Date().toISOString(), authenticated: false, requests: [], versions: {} };
try {
  for (const version of ['baseline', 'current']) {
    const context = await browser.newContext();
    // No persistent profile, extensions, login, or authenticated EA API calls.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/ut/')) return route.abort();
      const match = url.pathname.match(/^\/ea-sports-fc\/ultimate-team\/web-app\/js\/(ocompiled|compiled_[1-4])\.js$/);
      if (version === 'baseline' && match) {
        return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(root, `artifacts/fc27-browser/ea-${match[1]}.js`)) });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('response', async response => {
      const url = new URL(response.url());
      if (!/\/(ocompiled|compiled_[1-4])\.js$/.test(url.pathname)) return;
      const bytes = await response.body().catch(() => null);
      if (bytes) report.requests.push({ version, path: url.pathname, status: response.status(),
        sha256: createHash('sha256').update(bytes).digest('hex') });
    });
    await page.goto('https://www.ea.com/ea-sports-fc/ultimate-team/web-app/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof globalThis.UTHttpRequest === 'function'
      && typeof globalThis.Identification === 'function', { timeout: 60000 });
    report.versions[version] = await page.evaluate(paths => {
      const constructorSource = Function.prototype.toString.call(globalThis.UTHttpRequest);
      const defaultDecoder = globalThis[constructorSource.match(/=(a0_0x[\da-f]+)/)?.[1]];
      return paths.map(methodPath => {
      const fn = methodPath.split('.').reduce((value, key) => value?.[key], globalThis);
      if (typeof fn !== 'function') return { path: methodPath, missing: true };
      const source = Function.prototype.toString.call(fn).replace(/\r\n/g, '\n');
      if (source.length > 20000) return { path: methodPath, oversized: true };
      // Decode only public obfuscator string constants for human review. Never
      // execute a reviewed method or resolve its runtime auth dependencies.
      let decoded = source;
      const aliases = new Map([...source.matchAll(/(_0x[\da-f]+)=(a0_0x[\da-f]+)/g)].map(match => [match[1], match[2]]));
      decoded = decoded.replace(/(_0x[\da-f]+|a0_0x[\da-f]+)\((0x[\da-f]+)\)/g, (call, name, number) => {
        const decoder = globalThis[aliases.get(name) ?? name] ?? defaultDecoder;
        return typeof decoder === 'function' ? JSON.stringify(decoder(Number(number))) : call;
      });
      return { path: methodPath, source, decoded };
      });
    }, definitions.map(([methodPath]) => methodPath));
    for (const method of report.versions[version]) if (method.source) {
      method.sha256 = createHash('sha256').update(method.source).digest('hex');
    }
    if (buyReview) {
      const bundle = await build({ stdin: { resolveDir: root, contents: `
        import { verifyFc27Methods } from './src/adapters/ea/fc27-transaction-transport.js';
        import { FC27_BUY_SERVICE_METHODS, FC27_BUY_COMPATIBLE_HASHES } from './src/adapters/ea/fc27-puzzle-buy.js';
        export async function inspect(root) {
          const assertRuntime = await verifyFc27Methods({ service: root.UTItemService.prototype, crypto: root.crypto },
            FC27_BUY_SERVICE_METHODS.map(([name, hash]) => ['service.' + name, hash]), FC27_BUY_COMPATIBLE_HASHES);
          assertRuntime(); return { verified: true, writes: 0, authenticated: false };
        }
      ` },
        bundle: true, write: false, format: 'iife', globalName: 'FCATBuyReview', target: 'chrome120' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      // Native methods are inspected, never invoked; no identity or login used.
      report.versions[`${version}Adapter`] = await page.evaluate(() => globalThis.FCATBuyReview.inspect(globalThis));
    }
    await context.close();
  }
  if (buyReview) {
    const normalize = source => {
      const names = new Map();
      return source.replace(/(?:_0x|a0_0x)[0-9a-f]+/g, name => {
        if (!names.has(name)) names.set(name, `v${names.size}`);
        return names.get(name);
      });
    };
    report.comparison = report.versions.current.map((method, index) => ({ path: method.path,
      decodedEquivalent: normalize(method.decoded) === normalize(report.versions.baseline[index].decoded) }));
  }
  const destination = path.join(root, `artifacts/fc27-browser/${buyReview ? 'buy' : puzzleReview ? 'puzzle' : 'market'}-runtime-review-${buyReview ? '2026-10-03' : '2026-10-02'}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ saved: destination, methods: report.versions.current.map(method => ({ path: method.path, sha256: method.sha256, missing: method.missing })) }));
} finally { await browser.close(); }
