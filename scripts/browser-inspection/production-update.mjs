import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildFc27Production } from '../build-fc27-production.mjs';
import { TAMPERMONKEY_URL, installedScripts, installVerifiedUserscript, confirmVerifiedInstaller } from './tampermonkey-installation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(root, 'tools/browser-inspection/package.json'))('playwright-core');
const profile = path.join(os.homedir(), '.fcat-browser-inspection/profile');
if (JSON.parse(await readFile(path.join(profile, 'fcat-profile.json'), 'utf8')).purpose !== 'fcat-inspection') throw new Error('Unowned profile');
const artifact = await buildFc27Production();
const hits = { seed: 0, metadata: 0, full: 0 };
let seed; let metadata;
const server = createServer((request, response) => {
  const route = new Map([['/seed.user.js', ['seed', seed]], ['/FCAutomationTool.meta.js', ['metadata', metadata]],
    ['/FCAutomationTool.user.js', ['full', artifact.script]]]).get(new URL(request.url, 'http://127.0.0.1').pathname);
  if (request.method !== 'GET' || !route) { response.writeHead(404); response.end(); return; }
  hits[route[0]]++;
  response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }); response.end(route[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// Synthetic older metadata only, never a published release or a production version source.
metadata = artifact.metadata.replace(/^\/\/ @updateURL\s+.*$/m, `// @updateURL    ${base}/FCAutomationTool.meta.js`)
  .replace(/^\/\/ @downloadURL\s+.*$/m, `// @downloadURL  ${base}/FCAutomationTool.user.js`);
seed = artifact.script.replace(artifact.metadata, metadata.replace(/^\/\/ @version\s+.*$/m, '// @version      26.99.99'));
const report = { schema: 1, version: artifact.version, sha256: artifact.manifest.sha256, syntheticOlderVersion: '26.99.99',
  actualTampermonkeyUpdater: true, localTransportOnly: true, githubDeliveryVerified: false, liveEnabled: false };
let context; let seeded = false; let restored = false;
let stage = 'launch';
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, ignoreDefaultArgs: ['--disable-extensions'], proxy: { server: 'http://127.0.0.1:1080', bypass: 'localhost,127.0.0.1,[::1]' } });
  let manager = await installedScripts(context);
  const acceptance = manager.getByText('FC Automation Tool Acceptance', { exact: true });
  if (await acceptance.count() === 1) {
    const toggle = acceptance.locator('xpath=ancestor::tr[1]').locator('.enabler');
    const className = await toggle.getAttribute('class');
    if (className.split(/\s+/).includes('enabler_enabled')) {
      await toggle.locator('i.on').click();
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  await manager.close();
  seeded = true;
  stage = 'install-seed';
  await installVerifiedUserscript(context, { source: seed, url: `${base}/seed.user.js`, allowDowngrade: true });
  stage = 'read-seed';
  manager = await installedScripts(context);
  const row = manager.getByText('FC Automation Tool', { exact: true }).locator('xpath=ancestor::tr[1]');
  if (!(await row.innerText()).includes('26.99.99')) throw new Error('UPDATE_SEED_UNVERIFIED');
  const before = { ...hits };
  const previous = new Set(context.pages());
  stage = 'check-update';
  await row.locator('span[title="\u68c0\u67e5\u66f4\u65b0"],span[title="Check for updates"],span[title="\u5e94\u7528\u66f4\u65b0"],span[title="Apply update"]').click();
  stage = 'wait-update';
  for (let i = 0; i < 100; i++) {
    const apply = row.locator('span[title="\u5e94\u7528\u66f4\u65b0"],span[title="Apply update"]');
    if (await apply.count() === 1) { await apply.click(); report.updateApplyRequired = true; }
    const installer = context.pages().find(page => !previous.has(page) && page.url().startsWith(`${TAMPERMONKEY_URL}/ask.html`));
    if (installer) {
      previous.add(installer);
      await confirmVerifiedInstaller(installer, { source: artifact.script });
      report.updateConfirmationRequired = true;
    }
    if ((await row.innerText()).includes(artifact.version) && hits.metadata > before.metadata && hits.full > before.full) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!(await row.innerText()).includes(artifact.version) || hits.metadata <= before.metadata || hits.full <= before.full) {
    report.updateRow = await row.innerText();
    report.updateDialogs = await manager.locator('[role="dialog"]').allTextContents();
    report.updatePages = context.pages().map(page => { const url = new URL(page.url()); return { protocol: url.protocol, path: url.pathname }; });
    await manager.screenshot({ path: path.join(root, 'artifacts/fc27-browser/production-update-failure.png') });
    throw new Error('TAMPERMONKEY_UPDATE_UNCONFIRMED');
  }
  await manager.getByText('FC Automation Tool', { exact: true }).click();
  const sources = await manager.locator('.CodeMirror').evaluateAll(editors => editors.map(editor => editor.CodeMirror?.getValue?.()));
  const normalize = value => value.replaceAll('\r\n', '\n').trimEnd();
  restored = sources.some(value => typeof value === 'string' && normalize(value) === normalize(artifact.script));
  if (!restored) throw new Error('UPDATED_PRODUCTION_SOURCE_UNVERIFIED');
  report.updated = true; report.finalSourceMatches = true; report.finalGithubMetadataRestored = true;
} catch (error) {
  console.error(String(error?.message).slice(0, 1500));
  report.failedStage = stage;
  report.failure = /^[A-Z_]+$/.test(error?.message) ? error.message : 'UPDATE_CHECK_INCOMPLETE'; process.exitCode = 1;
} finally {
  if (context && seeded && !restored) {
    try { await installVerifiedUserscript(context, { source: artifact.script, url: `${base}/FCAutomationTool.user.js` }); report.finalSourceRestoredByInstaller = true; }
    catch (error) { console.error(String(error?.message).split('\n')[0].slice(0, 180)); report.finalSourceRestoredByInstaller = false; }
  }
  report.requests = hits;
  await mkdir(path.join(root, 'artifacts/fc27-browser'), { recursive: true });
  await writeFile(path.join(root, 'artifacts/fc27-browser/production-update.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  await context?.close(); await new Promise(resolve => server.close(resolve));
}
