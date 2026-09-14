import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { collectPageReport, createNetworkSummary, pageKind } from './probe.mjs';
import { inspectionOptions } from './options.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireTools = createRequire(path.join(root, 'tools/browser-inspection/package.json'));
const { help, selfTest, executable } = inspectionOptions(process.argv.slice(2));
if (help) {
  console.log('node scripts/browser-inspection/run.mjs --self-test|--interactive [--browser <executable>]');
  console.log('Interactive mode uses a dedicated profile. Login is manual. Enter captures fixed read-only fields; q closes.');
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
    ignoreDefaultArgs: ['--disable-extensions'],
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
      if (report.observed.services !== 'accessor' || report.season !== '27'
          || JSON.stringify(report).includes('must-not-export')) throw new Error('Probe contract failed');
      const out = path.join(root, 'artifacts/fc27-browser');
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, 'self-test.json'), JSON.stringify({ browserVersion: context.browser()?.version(), report }, null, 2));
      console.log('Offline browser probe passed; no EA page, account or mutation used.');
    } else {
      terminal = createInterface({ input: process.stdin, output: process.stdout });
      console.log('Open the EA Web App manually in this dedicated browser and log in. Do not enable old automation.');
      while (true) {
        const command = await terminal.question('Enter: inspect current Web App, q: close > ');
        if (command.trim() === 'q') break;
        const targets = context.pages().filter(target => pageKind(target.url()) === 'web-app');
        if (targets.length !== 1) { console.log('Exactly one Web App tab is required.'); continue; }
        const target = targets[0];
        const network = createNetworkSummary(target);
        try {
          const report = await collectPageReport(target);
          console.log(JSON.stringify({ report, network: network.snapshot() }, null, 2));
          console.log('No login/readiness/eligibility confirmation is implied by object presence.');
        } catch { console.log('Inspection unavailable; no raw exception was exported.'); }
        finally { network.stop(); }
      }
    }
  } finally {
    terminal?.close();
    await context.close();
  }
}
