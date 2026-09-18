import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { collectPageReport, collectRuntimeObservation, createNetworkCollector, pageKind } from './probe.mjs';
import { inspectionOptions } from './options.mjs';
import { collectAutomatically, WEB_APP_URL } from './automatic.mjs';
import { runAgentSession } from './agent-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireTools = createRequire(path.join(root, 'tools/browser-inspection/package.json'));
const { help, selfTest, auto, agent, durationSeconds, withExtensions, executable } = inspectionOptions(process.argv.slice(2));
if (help) {
  console.log('node scripts/browser-inspection/run.mjs --self-test|--interactive|--auto|--agent [--browser <executable>]');
  console.log('Interactive mode uses a dedicated profile. Login is manual. EA responses are counted from startup; Enter captures fixed read-only fields; q closes.');
  console.log('Auto opens the official Web App, saves passive reports without Enter, then closes. Login/2FA remain manual.');
  console.log('Auto options: --duration-seconds 1..600 (default 120), --with-extensions (default: native baseline, extensions disabled).');
  console.log('Agent mode keeps one session until q; local stdin commands only, login/2FA manual, extensions disabled by default.');
} else {
  const { chromium } = requireTools('playwright-core');
  const candidates = executable ? [executable] : process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : [];
  let browserPath;
  for (const candidate of candidates) {
    try { if ((await stat(candidate)).isFile()) { browserPath = candidate; break; } } catch { /* Try next installed browser. */ }
  }
  if (!browserPath) throw new Error('No browser found; specify --browser');
  const profile = selfTest ? await mkdtemp(path.join(os.tmpdir(), 'fcat-browser-smoke-'))
    : path.join(os.homedir(), '.fcat-browser-inspection', 'profile');
  await mkdir(profile, { recursive: true });
  const resolved = await realpath(profile);
  const repo = await realpath(root);
  const relative = path.relative(repo, resolved);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('Profile must remain outside the repository');
  const marker = path.join(profile, 'fcat-profile.json');
  try {
    const existing = JSON.parse(await readFile(marker, 'utf8'));
    if (existing.purpose !== 'fcat-inspection') throw new Error('Unexpected profile owner');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Never take ownership of an existing browser profile.
    const { readdir } = await import('node:fs/promises');
    if ((await readdir(profile)).length) throw new Error('Unowned profile is not empty');
    await writeFile(marker, JSON.stringify({ purpose: 'fcat-inspection', schema: 1 }), { flag: 'wx' });
  }
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: browserPath, headless: selfTest, viewport: { width: 1280, height: 800 },
    // Playwright controls this owned browser through a pipe, not a public CDP listener.
    ignoreDefaultArgs: !selfTest && (!(auto || agent) || withExtensions) ? ['--disable-extensions'] : [],
  });
  let terminal;
  try {
    const page = context.pages()[0] || await context.newPage();
    if (selfTest) {
      await context.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><title>FCAT offline fixture</title><h1>FCAT offline fixture</h1>');
      await page.evaluate(() => {
        globalThis.APP_YEAR_SHORT = 27;
        globalThis.privateAccount = 'must-not-export';
        Object.defineProperty(globalThis, 'services', { get() { throw new Error('must-not-execute'); } });
      });
      const report = await collectPageReport(page, { fixture: true });
      const runtime = await collectRuntimeObservation(page, { fixture: true });
      if (report.observed.services !== 'accessor' || report.season !== '27'
          || runtime.inventory.club.count !== null
          || JSON.stringify({ report, runtime }).includes('must-not-export')) throw new Error('Probe contract failed');
      const out = path.join(root, 'artifacts/fc27-browser');
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, 'self-test.json'), JSON.stringify({ browserVersion: context.browser()?.version(), report, runtime }, null, 2));
      console.log('Offline browser probe passed; no EA page, account or mutation used.');
      const { exerciseFsuPanel } = await import('./fsu-panel-smoke.mjs');
      await exerciseFsuPanel(page, out);
      const { exerciseRunnerPanel } = await import('./runner-panel-smoke.mjs');
      await exerciseRunnerPanel(page, out);
      const { exerciseTraditionalPersistence } = await import('./traditional-persistence-smoke.mjs');
      await exerciseTraditionalPersistence(context, out);
    } else if (agent) {
      terminal = createInterface({ input: process.stdin, output: process.stdout });
      await runAgentSession({ context, terminal, root, withExtensions });
    } else if (auto) {
      const network = createNetworkCollector(context);
      const out = path.join(root, 'artifacts/fc27-browser');
      await mkdir(out, { recursive: true });
      const reportFile = path.join(out, `inspection-${new Date().toISOString().replaceAll(':', '-')}.json`);
      const metadata = { browserVersion: context.browser()?.version() ?? null,
        extensionMode: withExtensions ? 'existing-extensions' : 'disabled-native-baseline' };
      const save = async report => {
        const text = JSON.stringify({ ...report, metadata }, null, 2);
        await writeFile(reportFile, text);
      };
      console.log(`Automatic passive observation: ${durationSeconds}s. Login/2FA manually if requested; no terminal input needed.`);
      console.log(`Local report: ${reportFile}`);
      try {
        if (!context.pages().some(target => pageKind(target.url()) === 'web-app') && page.url() === 'about:blank') {
          try { await page.goto(WEB_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
          catch { console.log('Navigation incomplete; observing existing page without automatic retry.'); }
        }
        const result = await collectAutomatically({ context, network, durationSeconds, save, extensionsDisabled: !withExtensions,
          notify: state => console.log(`Observation: ${state}. This does not authorize live execution.`) });
        console.log(`Inspection ${result.status}; ${result.observations} observations saved.`);
      } finally { network.stop(); }
    } else {
      terminal = createInterface({ input: process.stdin, output: process.stdout });
      console.log('Open the EA Web App manually in this dedicated browser and log in. Do not enable old automation.');
      const network = createNetworkCollector(context);
      try {
        while (true) {
          const command = await terminal.question('Enter: inspect current Web App, q: close > ');
          if (command.trim() === 'q') break;
          const targets = context.pages().filter(target => pageKind(target.url()) === 'web-app');
          if (targets.length !== 1) { console.log('Exactly one Web App tab is required.'); continue; }
          const target = targets[0];
          try {
            const report = await collectPageReport(target);
            const runtime = await collectRuntimeObservation(target);
            console.log(JSON.stringify({ report, runtime, network: network.snapshot() }, null, 2));
            console.log('No login/readiness/eligibility confirmation is implied by object presence.');
          } catch { console.log('Inspection unavailable; no raw exception was exported.'); }
        }
      } finally {
        network.stop();
      }
    }
  } finally {
    terminal?.close();
    await context.close();
  }
}
