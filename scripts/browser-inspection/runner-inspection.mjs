import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageKind } from './probe.mjs';
import { buildFc27Preview } from '../build-fc27-preview.mjs';

export async function showRunnerPanel(page) {
  if (pageKind(page.url()) !== 'web-app') return { reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  const { script } = await buildFc27Preview();
  await page.evaluate(`(() => { const unsafeWindow = globalThis; ${script}\n })()`);
  const panel = page.locator('#fcat-fc27-preview');
  if (!(await panel.locator('details').evaluate(node => node.open))) await panel.locator('summary').click();
  return { panelVisible: await panel.isVisible(), liveExecutionEnabled: false, persistentInstallation: false };
}

export async function captureRunnerPanel(page) {
  if (pageKind(page.url()) !== 'web-app') return { reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  const directory = path.join(root, 'artifacts/fc27-browser');
  await mkdir(directory, { recursive: true });
  await page.locator('#fcat-fc27-preview').screenshot({ path: path.join(directory, 'runner-panel-live.png'), timeout: 5000 });
  return { screenshot: 'artifacts/fc27-browser/runner-panel-live.png', liveExecutionEnabled: false };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function buildRunnerInspection({ contract = false } = {}) {
  const result = await build({ entryPoints: [path.join(root, contract ? 'src/adapters/ea/fc27-sbc-contract.js' : 'src/adapters/ea/fc27-fsu-read.js')],
    bundle: true, write: false, metafile: true, target: 'chrome120', format: 'iife',
    globalName: 'FC27RunnerReadOnly', legalComments: 'none' });
  const inputs = Object.keys(result.metafile.inputs).map(name => path.relative(root, path.resolve(name)).replaceAll('\\', '/')).sort();
  const allowed = new Set(['src/adapters/ea/fc27-fsu-read.js', 'src/adapters/ea/fc27-local-read.js',
    'src/adapters/ea/fc27-fsu-diagnostics.js', 'src/adapters/ea/fc27-sbc-contract.js',
    'src/adapters/ea/fc27-traditional-read.js', 'src/adapters/ea/fc27-sbc-read.js', 'src/adapters/ea/fc27-challenge-catalog.js',
    'src/fc27/prelaunch-contract.js', 'src/fc27/traditional-preview.js', 'src/domain/player-rarity.js']);
  if (inputs.some(name => !allowed.has(name))) throw new Error('Unreviewed Runner inspection dependency');
  return { source: result.outputFiles[0].text, inputs };
}

export async function inspectRunnerInputs(page) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  const { source } = await buildRunnerInspection();
  // Local reviewed source only; the wrapper leaves no installed globals or runtime hooks.
  return page.evaluate(`(() => { ${source}\nreturn FC27RunnerReadOnly.inspectFc27RunnerInputs(globalThis); })()`);
}

export async function inspectRunnerCatalog(page, setId) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  if (!Number.isSafeInteger(setId) || setId <= 0 || setId >= 1e9) throw new Error('FSU_CATALOG_SET_INVALID');
  const { source } = await buildRunnerInspection();
  return page.evaluate(`(() => { ${source}\nreturn FC27RunnerReadOnly.inspectFc27ChallengeCatalog(globalThis, { setId: ${setId} }); })()`);
}

export async function inspectRunnerContract(page, setId) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  if (!Number.isSafeInteger(setId) || setId <= 0 || setId >= 1e9) throw new Error('FSU_CATALOG_SET_INVALID');
  const { source } = await buildRunnerInspection({ contract: true });
  return page.evaluate(`(() => { ${source}\nreturn FC27RunnerReadOnly.inspectFc27SbcContract(globalThis, { setId: ${setId} }); })()`);
}

export async function previewRunnerSquad(page, setId, maxRating = 74) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  if (!Number.isSafeInteger(setId) || setId <= 0 || setId >= 1e9) throw new Error('FSU_CATALOG_SET_INVALID');
  if (![74, 83].includes(maxRating)) throw new Error('FSU_PREVIEW_POLICY_UNAPPROVED');
  const { source } = await buildRunnerInspection();
  return page.evaluate(`(() => { ${source}\nreturn FC27RunnerReadOnly.previewFc27RunnerSquad(globalThis, { setId: ${setId}, maxRating: ${maxRating} }); })()`);
}

export async function inspectRunnerSupport(page, { validateSample = false, settings = false } = {}) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  const { source } = await buildRunnerInspection();
  const method = settings ? 'inspectFc27FsuSettings' : validateSample ? 'validateFc27FsuSample' : 'inspectFc27FsuSupport';
  return page.evaluate(`(() => { ${source}\nreturn FC27RunnerReadOnly.${method}(globalThis); })()`);
}
