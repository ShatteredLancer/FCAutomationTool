import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildFc27Acceptance } from '../build-fc27-acceptance.mjs';
import { buildFc27Production } from '../build-fc27-production.mjs';
import { installedScripts } from './tampermonkey-installation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.slice(2).some(arg => !['--install', '--live-read', '--production'].includes(arg))) throw new Error('Unknown acceptance option');
const production = process.argv.includes('--production');
const hostId = production ? 'fcat-fc27-production' : 'fcat-fc27-acceptance';
const artifactPrefix = production ? 'production' : 'acceptance';
const requireTools = createRequire(path.join(root, 'tools/browser-inspection/package.json'));
const { chromium } = requireTools('playwright-core');
const profile = path.join(os.homedir(), '.fcat-browser-inspection/profile');
if (JSON.parse(await readFile(path.join(profile, 'fcat-profile.json'), 'utf8')).purpose !== 'fcat-inspection') throw new Error('Unowned profile');
const artifact = await (production ? buildFc27Production() : buildFc27Acceptance());
const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== `/${artifact.userFile}`) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(artifact.script);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const installUrl = `http://127.0.0.1:${server.address().port}/${artifact.userFile}`;
const extension = 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo';
const web = 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
let context;
const report = { schema: 1, version: artifact.version, sha256: artifact.manifest.sha256 ?? null,
  identity: production ? 'production' : 'acceptance', liveExecutionEnabled: false, installed: false, gm: {}, reads: null };
const output = path.join(root, 'artifacts/fc27-browser');
await mkdir(output, { recursive: true });
async function clickPanel(page, id) {
  const cdp = await context.newCDPSession(page);
  try {
    const { root: doc } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: `#${hostId}` });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.find(value => value.shadowRootType === 'closed');
    if (!shadow) throw new Error('ACCEPTANCE_PANEL_ABSENT');
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'acceptance' });
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
      functionDeclaration: `function(id) { const details=this.querySelector('details'); details.open=true;
        if(id==='prepare') { this.getElementById('target').value='4'; this.getElementById('rating').value='74'; }
        const button=this.getElementById(id); if(!button || button.disabled)return null;
        const r=button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; }`, arguments: [{ value: id }] });
    const point = result.result.value; if (!point) throw new Error('ACCEPTANCE_CONTROL_UNAVAILABLE');
    await page.mouse.click(point.x, point.y);
  } finally { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'acceptance' }).catch(() => {}); await cdp.detach(); }
}
async function result(page) {
  await page.waitForFunction(id => globalThis.document.getElementById(id)?.dataset.busy === 'false', hostId, { timeout: 15000 });
  return page.locator(`#${hostId}`).evaluate(host => JSON.parse(host.dataset.result));
}
async function offlinePage() {
  const page = await context.newPage();
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>FC27 installation acceptance</title><body></body>' }) : route.abort());
  await page.goto(`${web}fcat-acceptance-test.html`, { waitUntil: 'domcontentloaded' });
  await page.locator(`#${hostId}`).waitFor({ state: 'attached', timeout: 20000 });
  if (production && await page.locator(`#${hostId}`).getAttribute('data-version') !== artifact.version) throw new Error('PRODUCTION_VERSION_MISMATCH');
  return page;
}
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1280, height: 800 },
    proxy: { server: 'http://127.0.0.1:1080', bypass: 'localhost,127.0.0.1,[::1]' } });
  if (process.argv.includes('--install')) {
    const manager = await context.newPage();
    await manager.goto(`${extension}/options.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const page = await context.newPage(); await page.goto(installUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    let installer;
    for (let i = 0; i < 50; i++) {
      installer = context.pages().find(page => page.url().startsWith(`${extension}/ask.html`));
      if (installer) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!installer) {
      const utilities = manager.getByText(/^(Utilities|\u5b9e\u7528\u5de5\u5177)$/);
      if (await utilities.count() === 1) await utilities.click();
      await manager.locator('#input_dXRpbHNfdXRpbHM_url').fill(installUrl);
      await manager.locator('#input_dXRpbHNfdXRpbHNfaV91cmw_bu').click();
      for (let i = 0; i < 50; i++) {
        installer = context.pages().find(page => page.url().startsWith(`${extension}/ask.html`));
        if (installer) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    if (!installer) {
      report.installPages = context.pages().map(page => { const url = new URL(page.url()); return { protocol: url.protocol, host: url.hostname, path: url.pathname }; });
      await page.screenshot({ path: path.join(output, 'acceptance-install-failure.png') });
      throw new Error('ACCEPTANCE_INSTALLER_ABSENT');
    }
    let text = await installer.locator('body').innerText();
    if (!text.includes('// ==UserScript==')) {
      await installer.getByText(/^(Source|Source code|\u6e90\u4ee3\u7801)$/).click();
      text = await installer.locator('body').innerText();
    }
    const editorSources = await installer.locator('.CodeMirror').evaluateAll(editors => editors.map(editor => editor.CodeMirror?.getValue?.()).filter(value => typeof value === 'string'));
    const normalize = value => value.replaceAll('\r\n', '\n').trimEnd();
    const exactSource = editorSources.find(source => normalize(source) === normalize(artifact.script)) ?? '';
    const checks = { exactSource: !!exactSource,
      name: exactSource.includes(`// @name         FC Automation Tool${production ? '\n' : ' Acceptance'}`),
      namespace: exactSource.includes(`// @namespace    https://github.com/ShatteredLancer/FCAutomationTool${production ? '\n' : '/acceptance'}`),
      version: exactSource.includes(`// @version      ${artifact.version}`), disabled: exactSource.includes('liveEnabled: false') };
    if (Object.values(checks).some(value => !value)) {
      console.log(JSON.stringify({ installerChecks: checks, editorCount: editorSources.length }));
      await installer.screenshot({ path: path.join(output, 'acceptance-identity-failure.png') });
      throw new Error('ACCEPTANCE_IDENTITY_UNVERIFIED');
    }
    const button = installer.getByRole('button', { name: /^(Install|Reinstall|Update|\u5b89\u88c5|\u91cd\u65b0\u5b89\u88c5|\u66f4\u65b0)$/ });
    if (await button.count() !== 1) throw new Error('ACCEPTANCE_INSTALL_BUTTON_AMBIGUOUS');
    await button.click();
    console.log(`${artifactPrefix} userscript installation clicked; Live remains disabled.`);
  }
  if (production) {
    const manager = await installedScripts(context);
    const name = manager.getByText('FC Automation Tool', { exact: true });
    if (!(await name.locator('xpath=ancestor::tr[1]').innerText()).includes(artifact.version)) throw new Error('PRODUCTION_INSTALLED_VERSION_MISMATCH');
    await name.click();
    const sources = await manager.locator('.CodeMirror').evaluateAll(editors => editors.map(editor => editor.CodeMirror?.getValue?.()));
    const normalize = value => value.replaceAll('\r\n', '\n').trimEnd();
    if (!sources.some(value => typeof value === 'string' && normalize(value) === normalize(artifact.script))) throw new Error('PRODUCTION_INSTALLED_SOURCE_MISMATCH');
    report.exactInstalledSource = true;
    await manager.close();
  }
  const first = await offlinePage(); report.installed = true;
  await clickPanel(first, 'gm'); report.gm.initial = await result(first);
  await first.reload({ waitUntil: 'domcontentloaded' }); await first.locator(`#${hostId}`).waitFor({ state: 'attached' });
  await clickPanel(first, 'gm'); report.gm.reload = await result(first);
  const second = await offlinePage();
  await clickPanel(first, 'hold'); await clickPanel(second, 'gm'); report.gm.contending = await result(second);
  await result(first); await clickPanel(second, 'gm'); report.gm.afterRelease = await result(second);
  await clickPanel(first, 'hold');
  await first.waitForFunction(async () => (await navigator.locks.query()).held.some(lock => lock.name === 'fca-fc27-traditional-sbc-v1'), {}, { timeout: 2000 });
  await first.close();
  await clickPanel(second, 'gm'); report.gm.ownerClosed = await result(second);
  await second.screenshot({ path: path.join(output, `${artifactPrefix}-1280.png`) });
  await second.setViewportSize({ width: 390, height: 844 });
  await second.screenshot({ path: path.join(output, `${artifactPrefix}-390.png`) });
  if (!report.gm.reload.persistedPreviously || report.gm.contending.reason !== 'FC27_EXCLUSIVE_ACCESS_UNAVAILABLE'
      || report.gm.ownerClosed.phase !== 'save-pending') throw new Error('ACCEPTANCE_GM_CHECK_FAILED');
  await second.close();
  console.log(JSON.stringify({ installed: report.installed, gm: report.gm }));
  if (process.argv.includes('--live-read')) {
    const page = context.pages().find(page => page.url().startsWith(web)) ?? await context.newPage();
    await page.goto(web, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const fsuReady = () => {
      const base = globalThis.info?.base;
      return base?.initialized === true && (['trusted-provisional', 'validating', 'validation-failed'].includes(base.clubCache?.status)
        || base.state === true && ['ready', 'finalizing'].includes(base.clubCache?.status));
    };
    await page.waitForFunction(fsuReady, {}, { timeout: 55000 }).catch(() => {});
    const ready = await page.evaluate(fsuReady);
    if (!ready) report.reads = { status: 'blocked', reason: 'LOGIN_OR_FSU_REQUIRED' };
    else {
      const bundle = await build({ stdin: { contents: `export { createFc27TraditionalProvider } from './src/adapters/ea/fc27-traditional-provider.js';
        export { createFc27TransactionTransport } from './src/adapters/ea/fc27-transaction-transport.js';`,
        resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'probe', target: 'chrome120' });
      const script = bundle.outputFiles[0].text;
      report.reads = await page.evaluate(`(async () => { ${script}
        let provider; try {
          provider = await probe.createFc27TraditionalProvider(globalThis);
          const input = await provider.prepareInputs({setId:4,maxRating:74});
          const baseline = await provider.readRewardBaseline({rewards:input.contract.rewards});
          const sample = input.inventory.items.filter(item=>item.rating<=74 && item.special===false && item.evolution===false && item.cosmetic===false).slice(0,2);
          const exact = await provider.validateItems({selected:sample});
          return { status:'observed',methodsVerified:provider.capabilities.verified, liveAcceptanceVerified:false,
            unassignedClear:input.unassignedClear,cachedPlayers:input.inventory.items.length,
            sampleRequested:sample.length,sampleMatched:exact.items.length,fresh:exact.fresh,packId:baseline.packId,packCount:baseline.count };
        } catch(error) {
          let packShape;
          if(error?.message==='FC27_REWARD_BASELINE_UNVERIFIED') {
            const transport=await probe.createFc27TransactionTransport(globalThis);
            try {
              const reply=await transport.request('packs'); const data=reply.response;
              packShape={status:reply.status,groupConstant:globalThis.PurchaseDisplayGroup?.MYPACKS,
                purchaseArray:Array.isArray(data?.purchase),keys:Object.keys(data??{}).slice(0,20),
                samples:Array.isArray(data?.purchase)?data.purchase.slice(0,3).map(pack=>({
                  group:pack.displayGroup?.value,packType:pack.packType,idType:typeof pack.id,
                  quantityType:typeof pack.quantity,untradeableType:typeof pack.untradeable})):[]};
            } finally { transport.cancel(); }
          }
          return {status:'blocked',reason:/^FC27_[A-Z_]+$/.test(error?.message)?error.message:'FC27_READ_UNCONFIRMED',packShape}; }
        finally { provider?.cancel(); }
      })()`);
      await clickPanel(page, 'refresh');
      await clickPanel(page, 'prepare');
      report.panel = await result(page);
      console.log(JSON.stringify({ installedPanel: report.panel }));
      await page.screenshot({ path: path.join(output, `${artifactPrefix}-live-read.png`) });
    }
    console.log(JSON.stringify({ reads: report.reads }));
  }
} catch (error) {
  report.failure = /^[A-Z_]+$/.test(error?.message) ? error.message : 'ACCEPTANCE_CHECK_INCOMPLETE';
  console.log(JSON.stringify({ failure: report.failure })); process.exitCode = 1;
} finally {
  await writeFile(path.join(output, `${artifactPrefix}-installation.json`), `${JSON.stringify(report, null, 2)}\n`);
  await context?.close(); await new Promise(resolve => server.close(resolve));
}
