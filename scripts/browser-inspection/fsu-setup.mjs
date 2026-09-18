import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { readFile, realpath, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFsuPreview } from '../build-fc27-fsu-preview.mjs';
import { fsuSetupOptions } from './options.mjs';
import { loadLocalFsuBaseline } from './fsu-setup-actions.mjs';

const { preview = false, ...setupOptions } = fsuSetupOptions(process.argv.slice(2));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireTools = createRequire(path.join(root, 'tools/browser-inspection/package.json'));
const { chromium } = requireTools('playwright-core');
const profile = path.join(os.homedir(), '.fcat-browser-inspection/profile');
const marker = JSON.parse(await readFile(path.join(profile, 'fcat-profile.json'), 'utf8'));
if (marker.purpose !== 'fcat-inspection') throw new Error('Unowned inspection profile');
const resolved = await realpath(profile);
const relative = path.relative(await realpath(root), resolved);
if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Profile must be outside repository');
const extensionId = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';
const storeUrl = `https://chromewebstore.google.com/detail/tampermonkey/${extensionId}`;
const webUrl = 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
const navigationError = error => /\bERR_[A-Z_]+\b/.exec(String(error?.message || ''))?.[0] || 'NAVIGATION_INCOMPLETE';
const loadArtifact = () => preview ? buildFsuPreview() : loadLocalFsuBaseline(root);
let artifact = await loadArtifact();
const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== `/${artifact.userFile}`) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  response.end(artifact.source);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const installUrl = `http://127.0.0.1:${server.address().port}/${artifact.userFile}`;
let context;
let terminal;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, viewport: { width: 1280, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'], ...setupOptions });
  terminal = createInterface({ input: process.stdin, output: process.stdout });
  const first = context.pages()[0] || await context.newPage();
  const navigate = async url => {
    const page = await context.newPage();
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
    catch (error) { console.log(`Navigation incomplete: ${navigationError(error)}; no retry or raw error exported.`); }
    return page;
  };
  if (first.url() === 'about:blank') {
    try { await first.goto(storeUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
    catch (error) { console.log(`Store navigation incomplete: ${navigationError(error)}.`); }
  }
  console.log(`Setup ready. Official Tampermonkey ID: ${extensionId}. Local artifact: ${artifact.version}.`);
  console.log(setupOptions.proxy ? `Dedicated browser proxy: ${setupOptions.proxy.server}; loopback bypassed.` : 'Dedicated browser proxy: direct.');
  console.log('Commands: status, store, extensions, extension-status, manager, scripts, install, confirm-install, web, reload-web, baseline, inspect, snapshot, q. Preview-only: panel, club, prices. Browser permission and policy approval remain manual.');
  while (true) {
    const command = (await terminal.question('fsu-setup > ')).trim();
    if (command === 'q') break;
    try {
      if (command === 'store') await navigate(storeUrl);
      else if (command === 'extensions') await navigate(`chrome://extensions/?id=${extensionId}`);
      else if (command === 'manager') await navigate(`chrome-extension://${extensionId}/options.html`);
      else if (command === 'install') { artifact = await loadArtifact(); await navigate(installUrl); }
      else if (command === 'web') await navigate(webUrl);
      else if (command === 'status') {
        console.log(JSON.stringify({ pages: context.pages().map(page => {
          const url = new URL(page.url());
          return url.protocol === 'chrome-extension:' ? { kind: 'extension', id: url.hostname, path: url.pathname }
            : { kind: url.hostname === 'chromewebstore.google.com' ? 'store'
              : url.hostname === '127.0.0.1' ? 'local-install' : url.hostname === 'www.ea.com' ? 'ea' : url.protocol, path: url.pathname };
        }), workers: context.serviceWorkers().map(worker => {
          const url = new URL(worker.url()); return { id: url.hostname, path: url.pathname };
        }) }));
      } else if (command === 'inspect') {
        const pages = context.pages().filter(page => page.url().startsWith(webUrl));
        if (pages.length !== 1) { console.log('Exactly one EA tab required.'); continue; }
        console.log(JSON.stringify(await pages[0].evaluate(() => {
          const bridge = Object.getOwnPropertyDescriptor(globalThis, 'FSULocalRunnerBridge')?.value;
          const description = typeof bridge?.describe === 'function' ? bridge.describe() : null;
          return { bridge: !!bridge, status: description?.status ?? null, capabilities: description?.capabilities ?? null,
            installation: description?.installation ?? null, panel: !!globalThis.document.getElementById('fsu-fc27-local'),
            season: Object.getOwnPropertyDescriptor(globalThis, 'APP_YEAR_SHORT')?.value ?? null };
        })));
      } else if (command === 'snapshot') {
        const pages = context.pages().filter(page => page.url().startsWith('chrome-extension:') || page.url().startsWith(storeUrl));
        const page = pages.at(-1);
        if (!page) { console.log('No extension/setup tab.'); continue; }
        console.log(JSON.stringify(await page.locator('body').innerText().then(text => text.slice(0, 10000))));
        const out = path.join(root, 'artifacts/fc27-browser');
        await mkdir(out, { recursive: true });
        await page.screenshot({ path: path.join(out, 'fsu-extension-setup.png') });
      } else {
        const { runFsuSetupAction } = await import(`./fsu-setup-actions.mjs?revision=${Date.now()}`);
        console.log(JSON.stringify(await runFsuSetupAction({ context, command, version: artifact.version, installUrl, userFile: artifact.userFile })));
      }
    } catch (error) {
      const reason = /^FSU_[A-Z_]+$/.test(error?.message) ? error.message : 'FSU_SETUP_ACTION_UNAVAILABLE';
      console.log(`Setup action unavailable: ${reason}; no raw error exported.`);
    }
  }
} finally {
  terminal?.close();
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
