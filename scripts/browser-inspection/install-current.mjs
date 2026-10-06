import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildFc27Production } from '../build-fc27-production.mjs';
import { TAMPERMONKEY_URL, installedScripts, installVerifiedUserscript } from './tampermonkey-installation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const profile = path.join(os.homedir(), '.fcat-browser-inspection', 'profile');
const { chromium } = createRequire(path.join(root, 'tools/browser-inspection/package.json'))('playwright-core');

const marker = JSON.parse(await readFile(path.join(profile, 'fcat-profile.json'), 'utf8'));
if (marker.purpose !== 'fcat-inspection') throw new Error('Unowned profile');

const artifact = await buildFc27Production();
const expectedHash = createHash('sha256').update(artifact.script).digest('hex');
if (expectedHash !== artifact.manifest.sha256) throw new Error('CURRENT_BUILD_HASH_MISMATCH');

const hits = { script: 0 };
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (request.method !== 'GET' || pathname !== '/FCAutomationTool.user.js') {
    response.writeHead(404); response.end(); return;
  }
  hits.script++;
  response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(artifact.script);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/FCAutomationTool.user.js`;
const report = {
  schema: 1,
  version: artifact.version,
  sha256: expectedHash,
  bytes: artifact.manifest.bytes,
  source: 'current-local-production-build',
  localTransportOnly: true,
  eaMutationsPerformed: false,
  liveEnabled: artifact.manifest.liveExecutionEnabled,
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    proxy: { server: 'http://127.0.0.1:1080', bypass: 'localhost,127.0.0.1,[::1]' },
  });
  await installVerifiedUserscript(context, { source: artifact.script, url });
  const manager = await installedScripts(context);
  const row = manager.getByText('FC Automation Tool', { exact: true }).locator('xpath=ancestor::tr[1]');
  if (await row.count() !== 1) throw new Error('CURRENT_SCRIPT_ROW_UNAVAILABLE');
  const rowText = await row.innerText();
  if (!rowText.includes(artifact.version)) throw new Error('CURRENT_SCRIPT_VERSION_UNVERIFIED');
  const toggle = row.locator('.enabler');
  const enabled = (await toggle.getAttribute('class') ?? '').split(/\s+/).includes('enabler_enabled');
  if (!enabled) await toggle.click();
  await manager.getByText('FC Automation Tool', { exact: true }).click();
  const normalize = value => value.replaceAll('\r\n', '\n').trimEnd();
  const sources = await manager.locator('.CodeMirror').evaluateAll(editors => editors.map(editor => editor.CodeMirror?.getValue?.()));
  const exactSource = sources.some(value => typeof value === 'string' && normalize(value) === normalize(artifact.script));
  if (!exactSource) throw new Error('CURRENT_SCRIPT_SOURCE_UNVERIFIED');
  report.installed = true;
  report.enabled = true;
  report.exactSource = true;
  report.row = rowText;
  report.requests = hits;
  await manager.close();
} catch (error) {
  report.installed = false;
  report.failure = /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'CURRENT_INSTALLATION_INCOMPLETE';
  report.requests = hits;
  process.exitCode = 1;
} finally {
  await mkdir(path.join(root, 'artifacts/fc27-browser'), { recursive: true });
  await writeFile(path.join(root, 'artifacts/fc27-browser/current-install.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
