import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const extensionId = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';
const extensionBase = `chrome-extension://${extensionId}`;
const webUrl = 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';

function runnerInspection() {
  const url = new URL('./runner-inspection.mjs', import.meta.url);
  url.searchParams.set('revision', String(Date.now()));
  return import(url.href);
}

export async function loadLocalFsuBaseline(root) {
  const directory = path.join(root, 'FSU_mod');
  const config = JSON.parse(await readFile(path.join(directory, 'fsu-mod.config.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(directory, 'fsu-mod-manifest.json'), 'utf8'));
  if (path.basename(config.modifiedFile) !== config.modifiedFile || config.releaseUserFile !== 'FSU-Local.user.js'
      || config.localVersion !== manifest.localVersion || config.modifiedFile !== manifest.modifiedFile) throw new Error('FSU_BASELINE_CONFIG_INVALID');
  const source = await readFile(path.join(directory, config.modifiedFile), 'utf8');
  const sha256 = createHash('sha256').update(source).digest('hex').toUpperCase();
  if (sha256 !== manifest.modifiedSha256 || !source.includes(`// @version      ${config.localVersion}`)) {
    throw new Error('FSU_BASELINE_HASH_MISMATCH');
  }
  return { source, version: config.localVersion, userFile: config.releaseUserFile, sha256 };
}

export function previewInstallerMatches({ url, text, version, installUrl, userFile = 'FSU-FC27-Preview.user.js' }) {
  try {
    const current = new URL(url);
    const source = new URL(installUrl);
    return current.protocol === 'chrome-extension:' && current.hostname === extensionId && current.pathname === '/ask.html'
      && source.protocol === 'http:' && source.hostname === '127.0.0.1' && !!source.port
      && ['FSU-FC27-Preview.user.js', 'FSU-Local.user.js'].includes(userFile)
      && source.pathname === `/${userFile}` && !source.search && !source.hash
      && text.includes(installUrl) && /^\d+(?:\.\d+){1,5}$/.test(version)
      && text.includes(`// @version      ${version}\n`)
      && text.includes('// @namespace    https://futcd.com/')
      && text.includes('// @name         \u3010FSU\u3011EAFC FUT WEB \u589e\u5f3a\u5668');
  } catch { return false; }
}

async function panelAction(context, page, action) {
  const session = await context.newCDPSession(page);
  try {
    const document = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#fsu-fc27-local' });
    if (!nodeId) throw new Error('FSU_PANEL_ABSENT');
    const { node } = await session.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.find(root => root.shadowRootType === 'closed');
    if (!shadow) throw new Error('FSU_PANEL_SHADOW_UNVERIFIED');
    const { object } = await session.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'fsu-setup' });
    const call = async (fn, args = []) => {
      const result = await session.send('Runtime.callFunctionOn', { objectId: object.objectId,
        functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: true });
      if (result.exceptionDetails) throw new Error('FSU_PANEL_READ_FAILED');
      return result.result.value;
    };
    const click = async selector => {
      const bounds = await call(function(selector) {
        const element = this.querySelector(selector);
        if (!element || element.disabled) return null;
        element.scrollIntoView({ block: 'center' });
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
      }, [selector]);
      if (!bounds) throw new Error('FSU_PANEL_CONTROL_UNAVAILABLE');
      await page.mouse.click(bounds.x, bounds.y);
    };
    if (!(await call(function() { return this.querySelector('details').open; }))) {
      await click('summary');
      await page.waitForTimeout(100);
    }
    if (action !== 'panel') {
      await click(action === 'club' ? '#club' : '#prices');
      for (let attempt = 0; attempt < 180; attempt++) {
        if (await call(function() { return this.querySelector('#status').textContent !== 'Reading...'; })) break;
        await page.waitForTimeout(1000);
      }
    }
    return await call(function() {
      const raw = this.querySelector('#status').textContent;
      const allowed = /^(?:FSU|FC27|PRICE)_[A-Z_0-9]+$/.test(raw)
        || /^(?:Club: \d+ players; provisional|Policy review required|Policy reviewed; inventory provisional|Reading\.\.\.|FUT\.GG FC27: [a-zA-Z_0-9-]+)$/.test(raw);
      const rows = [...this.querySelectorAll('#items tr')];
      return { status: allowed ? raw : 'UNCLASSIFIED_PANEL_STATUS', displayedRows: rows.length,
        eaAverages: rows.filter(row => row.cells[2]?.textContent.startsWith('EA avg ')).length,
        ggQuotes: rows.filter(row => row.cells[2]?.textContent.startsWith('GG ')).length,
        missingPrices: rows.filter(row => row.cells[2]?.textContent === 'N/A').length };
    });
  } finally {
    await session.send('Runtime.releaseObjectGroup', { objectGroup: 'fsu-setup' }).catch(() => {});
    await session.detach();
  }
}

export async function runFsuSetupAction({ context, command, version, installUrl, userFile }) {
  if (command === 'confirm-install') {
    const pages = context.pages().filter(page => page.url().startsWith(`${extensionBase}/ask.html`));
    if (pages.length !== 1) throw new Error('FSU_INSTALLER_AMBIGUOUS');
    const page = pages[0];
    let text = await page.locator('body').innerText();
    if (!text.includes('// ==UserScript==')) {
      const sourceTab = page.getByText(/^(Source|Source code|\u6e90\u4ee3\u7801)$/);
      if (await sourceTab.count() === 1) {
        await sourceTab.click();
        text = await page.locator('body').innerText();
      }
    }
    if (!previewInstallerMatches({ url: page.url(), text, version, installUrl, userFile })) throw new Error('FSU_INSTALLER_IDENTITY_UNVERIFIED');
    const install = page.getByRole('button', { name: userFile === 'FSU-Local.user.js'
      ? /^(Install|Reinstall|Update|Downgrade|\u5b89\u88c5|\u91cd\u65b0\u5b89\u88c5|\u66f4\u65b0|\u964d\u7ea7)$/
      : /^(Install|Reinstall|Update|\u5b89\u88c5|\u91cd\u65b0\u5b89\u88c5|\u66f4\u65b0)$/ });
    if (await install.count() !== 1) return { reason: 'FSU_INSTALL_BUTTON_AMBIGUOUS',
      buttons: await page.getByRole('button').evaluateAll(elements => elements.slice(0, 8).map(element =>
        String(element.textContent || element.value || '').slice(0, 80))) };
    await install.click();
    return { installClicked: true, version, installed: 'unverified-until-page-load' };
  }
  if (command === 'extension-status') {
    const page = context.pages().find(page => page.url() === `chrome://extensions/?id=${extensionId}`);
    if (!page) throw new Error('FSU_EXTENSION_SETTINGS_NOT_OPEN');
    await page.bringToFront();
    const detail = page.locator('extensions-detail-view');
    return { detailVisible: await detail.isVisible(), userScripts: await detail.locator('#allow-user-scripts').count()
      ? await detail.locator('#allow-user-scripts').evaluate(element => ({ tag: element.tagName,
        checked: typeof element.checked === 'boolean' ? element.checked : null,
        toggle: element.shadowRoot?.querySelector('cr-toggle')?.checked ?? null })) : null };
  }
  if (command === 'scripts' || command === 'scripts-refresh') {
    const page = context.pages().find(page => page.url().startsWith(`${extensionBase}/options.html`));
    if (!page) throw new Error('FSU_MANAGER_NOT_OPEN');
    if (command === 'scripts-refresh') await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    const tab = page.getByText(/^(Installed Userscripts|\u5df2\u5b89\u88c5\u811a\u672c)$/);
    if (await tab.count() !== 1) throw new Error('FSU_MANAGER_TAB_AMBIGUOUS');
    await tab.click();
    return { managerText: (await page.locator('body').innerText()).slice(0, 3000) };
  }
  if (command === 'baseline') {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    return pages[0].evaluate(() => {
      const data = (object, key) => Object.getOwnPropertyDescriptor(object ?? {}, key)?.value;
      const info = data(globalThis, 'info');
      const events = data(globalThis, 'events');
      const base = data(info, 'base');
      const settings = data(info, 'set');
      return { season: data(globalThis, 'APP_YEAR_SHORT') ?? null, info: !!info, events: !!events,
        preview: !!globalThis.document.getElementById('fsu-fc27-local'),
        initialized: data(base, 'initialized') === true, clubReady: data(base, 'state') === true,
        clubCacheStatus: ['ready', 'trusted-provisional', 'validating', 'validation-failed', 'miss'].includes(data(data(base, 'clubCache'), 'status'))
          ? data(data(base, 'clubCache'), 'status') : null,
        priceFunction: typeof data(events, 'getPriceForUrl') === 'function',
        fillCriteriaFunction: typeof data(events, 'oneFillCreationGF') === 'function',
        fillFunction: typeof data(events, 'playerListFillSquad') === 'function',
        settings: { cardPrice: data(settings, 'card_price') ?? null, autoFill: data(settings, 'sbc_autofill') ?? null },
        priceElements: globalThis.document.querySelectorAll('.fsu-PriceBar,.fsu-cards-price').length };
    });
  }
  if (command === 'runtime' || command === 'runtime-ui') {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const { observeRuntime } = await import('./runtime-observation.mjs');
    const { observePageUi } = await import('./navigation.mjs');
    if (command === 'runtime-ui') return observePageUi(pages[0]);
    return { runtime: await pages[0].evaluate(observeRuntime), ui: await observePageUi(pages[0]) };
  }
  if (command === 'runner') {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const { inspectRunnerInputs } = await runnerInspection();
    return inspectRunnerInputs(pages[0]);
  }
  if (command === 'runner-panel' || command === 'runner-panel-snapshot') {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const { showRunnerPanel, captureRunnerPanel } = await runnerInspection();
    return command === 'runner-panel' ? showRunnerPanel(pages[0]) : captureRunnerPanel(pages[0]);
  }
  if (/^runner-panel-preview [1-9]\d{0,8}(?: (?:74|83))?$/.test(command)) {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const panel = pages[0].locator('#fcat-fc27-preview');
    const [, setId, maxRating = '74'] = command.split(' ');
    await panel.locator('#target').selectOption(setId, { timeout: 3000 });
    await panel.locator('#rating').selectOption(maxRating, { timeout: 3000 });
    await panel.getByRole('button', { name: 'Preview squad' }).click({ timeout: 3000 });
    await panel.locator('#refresh').waitFor({ state: 'visible', timeout: 3000 });
    await pages[0].waitForFunction(() => !globalThis.document.getElementById('fcat-fc27-preview')?.shadowRoot.getElementById('refresh').disabled,
      null, { timeout: 40000 });
    return { reason: await panel.locator('#status').innerText(), counts: await panel.locator('#counts').innerText(), liveExecutionEnabled: false };
  }
  if (['runner-support', 'runner-validate', 'runner-settings'].includes(command)) {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const { inspectRunnerSupport } = await runnerInspection();
    return inspectRunnerSupport(pages[0], { validateSample: command === 'runner-validate', settings: command === 'runner-settings' });
  }
  if (/^runner-catalog [1-9]\d{0,8}$/.test(command)) {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const { inspectRunnerCatalog } = await runnerInspection();
    return inspectRunnerCatalog(pages[0], Number(command.split(' ')[1]));
  }
  if (/^runner-contract [1-9]\d{0,8}$/.test(command)) {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const { inspectRunnerContract } = await runnerInspection();
    return inspectRunnerContract(pages[0], Number(command.split(' ')[1]));
  }
  if (/^runner-preview [1-9]\d{0,8}(?: (?:74|83))?$/.test(command)) {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    const { previewRunnerSquad } = await runnerInspection();
    const [, setId, maxRating] = command.split(' ');
    return previewRunnerSquad(pages[0], Number(setId), maxRating === undefined ? 74 : Number(maxRating));
  }
  if (['panel', 'club', 'prices', 'reload-web', 'focus-web'].includes(command)) {
    const pages = context.pages().filter(page => page.url().startsWith(webUrl));
    if (pages.length !== 1) throw new Error('FSU_EA_TAB_AMBIGUOUS');
    if (command === 'focus-web') {
      await pages[0].bringToFront();
      await pages[0].waitForTimeout(8000);
      return runFsuSetupAction({ context, command: 'baseline' });
    }
    if (command === 'reload-web') {
      await pages[0].reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      return { reloaded: true };
    }
    return panelAction(context, pages[0], command);
  }
  return { unsupported: true };
}
