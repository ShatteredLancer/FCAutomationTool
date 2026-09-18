export const TAMPERMONKEY_URL = 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo';

export async function confirmVerifiedInstaller(installer, { source, allowDowngrade = false }) {
  const normalize = value => value.replaceAll('\r\n', '\n').trimEnd();
  if (!source.includes('liveEnabled: false') || !source.startsWith('// ==UserScript==')) throw new Error('INSTALLATION_SOURCE_UNSAFE');
  await installer.waitForLoadState('domcontentloaded');
  if (await installer.locator('.CodeMirror').count() === 0) {
    await installer.getByText(/^(Source|Source code|\u6e90\u4ee3\u7801)$/).click();
  }
  await installer.locator('.CodeMirror').first().waitFor({ state: 'attached', timeout: 15000 });
  const sources = await installer.locator('.CodeMirror').evaluateAll(editors => editors.map(editor => editor.CodeMirror?.getValue?.()));
  if (!sources.some(value => typeof value === 'string' && normalize(value) === normalize(source))) throw new Error('INSTALLER_SOURCE_MISMATCH');
  const pattern = allowDowngrade ? /^(Install|Reinstall|Update|Downgrade|\u5b89\u88c5|\u91cd\u65b0\u5b89\u88c5|\u66f4\u65b0|\u964d\u7ea7)$/
    : /^(Install|Reinstall|Update|\u5b89\u88c5|\u91cd\u65b0\u5b89\u88c5|\u66f4\u65b0)$/;
  const button = installer.getByRole('button', { name: pattern });
  if (await button.count() !== 1) throw new Error('INSTALLER_BUTTON_AMBIGUOUS');
  await button.click();
  for (let i = 0; i < 50 && !installer.isClosed(); i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (!installer.isClosed()) {
    console.log(JSON.stringify({ installerAfterClick: (await installer.locator('body').innerText()).slice(0, 2400) }));
    throw new Error('INSTALLER_CONFIRMATION_INCOMPLETE');
  }
}

export async function installVerifiedUserscript(context, { source, url, allowDowngrade = false }) {
  const manager = await context.newPage();
  await manager.goto(`${TAMPERMONKEY_URL}/options.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await manager.getByText(/^(Utilities|\u5b9e\u7528\u5de5\u5177)$/).click();
  const previous = new Set(context.pages());
  await manager.locator('#input_dXRpbHNfdXRpbHM_url').fill(url);
  await manager.locator('#input_dXRpbHNfdXRpbHNfaV91cmw_bu').click();
  let installer;
  for (let i = 0; i < 50; i++) {
    installer = context.pages().find(page => !previous.has(page) && page.url().startsWith(`${TAMPERMONKEY_URL}/ask.html`));
    if (installer) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!installer) throw new Error('INSTALLER_ABSENT');
  await installer.waitForLoadState('domcontentloaded');
  if (!(await installer.locator('body').innerText()).includes('// ==UserScript==')) {
    await installer.getByText(/^(Source|Source code|\u6e90\u4ee3\u7801)$/).click();
  }
  await confirmVerifiedInstaller(installer, { source, allowDowngrade });
  await manager.close();
}

export async function installedScripts(context) {
  const manager = await context.newPage();
  await manager.goto(`${TAMPERMONKEY_URL}/options.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await manager.getByText(/^(Installed Userscripts|\u5df2\u5b89\u88c5\u811a\u672c)$/).click();
  await manager.waitForFunction(() => {
    const controls = [...globalThis.document.querySelectorAll('.enabler')];
    return controls.length > 0 && controls.every(control => control.title);
  }, {}, { timeout: 10000 });
  return manager;
}
