import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageKind } from './probe.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { armStreamlinedReceiptCapture } from './streamlined-receipt-capture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Read-only inspector for the native One Click work area. The dependency
// allow-list prevents this command from importing a writer or page service.
export async function inspectStreamlined(page, { recover = false } = {}) {
  if (pageKind(page.url()) !== 'web-app') return { status: 'blocked', reason: 'WEB_APP_REQUIRED', liveExecutionEnabled: false };
  // A same-version replacement still needs one reload. Keep this marker on the
  // owned Playwright page (not the EA page) across hot-loaded helper modules.
  if (typeof page.reload === 'function') {
    const installed = JSON.parse(await readFile(path.join(root, 'artifacts/fc27-browser/current-install.json'), 'utf8'));
    const hash = createHash('sha256').update(await readFile(path.join(root, 'FCAutomationTool.user.js'))).digest('hex');
    if (!installed.installed || !installed.exactSource || installed.sha256 !== hash) return { status: 'blocked', reason: 'CURRENT_INSTALLATION_REQUIRED' };
    const marker = Symbol.for('fcat.streamlined.checked-build');
    if (page[marker] !== hash) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      page[marker] = hash;
      await page.waitForTimeout(2000);
    }
  }
  const result = await build({ absWorkingDir: root, stdin: { contents: `
    export { inspectFc27Streamlined, readFc27StreamlinedInputs, locateFc27StreamlinedPage } from './src/adapters/ea/fc27-streamlined-read.js';
    export { filterStreamlinedItems } from './src/streamlined/eligibility.js';
    export { inspectFc27StreamlinedFresh } from './src/adapters/ea/fc27-streamlined-inspection.js';`,
    resolveDir: root, sourcefile: 'streamlined-inspection.js' }, bundle: true, write: false,
    metafile: true, format: 'iife', globalName: 'FC27StreamlinedRead', target: 'chrome120' });
  const allowed = new Set(['streamlined-inspection.js', 'src/adapters/ea/fc27-streamlined-read.js',
    'src/adapters/ea/fc27-local-read.js', 'src/adapters/ea/fc27-fsu-read.js',
    'src/adapters/ea/fc27-club-read.js', 'src/fc27/prelaunch-contract.js',
    'src/domain/player-rarity.js',
    'src/streamlined/contract.js', 'src/streamlined/eligibility.js',
    'src/adapters/ea/fc27-streamlined-inspection.js', 'src/adapters/ea/fc27-streamlined-progress.js',
    'src/adapters/ea/fc27-streamlined-validation.js', 'src/adapters/ea/fc27-item-factory-observer.js',
    'src/adapters/ea/fc27-streamlined-storage-read.js', 'src/adapters/ea/fc27-transaction-transport.js',
    'src/streamlined/planner.js', 'src/streamlined/scoring.js', 'src/streamlined/plan.js']);
  if (Object.keys(result.metafile.inputs).some(name => !allowed.has(name.replaceAll('\\', '/')))) {
    throw new Error('Unreviewed Streamlined inspection dependency');
  }
  const report = await page.evaluate(`(() => { ${result.outputFiles[0].text}
    const report = FC27StreamlinedRead.inspectFc27Streamlined(globalThis);
    if (report.status === 'observed') {
      try {
        const inputs = FC27StreamlinedRead.readFc27StreamlinedInputs(globalThis);
        const filtered = FC27StreamlinedRead.filterStreamlinedItems(inputs.inventory, inputs);
        report.candidates = { status: filtered.status, reason: filtered.reason,
          cached: inputs.inventory.length, accepted: filtered.items.length,
          excluded: filtered.excluded, points: filtered.items.reduce((sum, item) => sum + item.points, 0),
          complete: inputs.inventoryComplete };
      } catch (error) { report.candidates = { status: 'blocked', reason: /^FC27_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'FC27_STREAMLINED_INPUTS_UNAVAILABLE' }; }
    }
    return report; })()`);
  if (!report || typeof report !== 'object' || Array.isArray(report)
      || Object.hasOwn(report, 'context') || Object.hasOwn(report, 'inventory')) {
    return { status: 'blocked', reason: 'FC27_STREAMLINED_REPORT_UNAVAILABLE', liveExecutionEnabled: false };
  }
  const navigation = await page.evaluate(() => ({
    runtime: Array.from(globalThis.document.querySelectorAll('[id^="fcat-"]')).slice(0, 25).map(node => ({ id: node.id, version: node.dataset.version ?? null })),
  }));
  const methods = await page.evaluate(readStreamlinedMethodSources);
  const preview = report.status === 'observed' && typeof page.context === 'function'
    ? await inspectStreamlinedPreview(page, { recover }) : null;
  // Latest installed preview must be verified before fresh read acceptance.
  const fresh = preview?.status === 'observed'
    ? await page.evaluate(`(async () => { ${result.outputFiles[0].text}
        return FC27StreamlinedRead.inspectFc27StreamlinedFresh(globalThis); })()`) : null;
  const receiptCapture = fresh?.status === 'verified' && typeof page.on === 'function'
    ? armStreamlinedReceiptCapture(page, { setId: report.challenge.setId, challengeId: report.challenge.id,
      destination: path.join(root, 'artifacts/fc27-browser/streamlined-native-receipts.json') }) : null;
  return { ...report, navigation, preview, fresh, receiptCapture, methods: Array.isArray(methods) ? methods.map(row => ({ ...row,
    sha256: createHash('sha256').update(row.source).digest('hex') })) : [] };
}

// Only the installed preview's entry/Solve/Close may be clicked here. No save,
// selection, purchase or contribution controls, and no injected planner.
export async function inspectStreamlinedPreview(page, { recover = false } = {}) {
  const installed = JSON.parse(await readFile(path.join(root, 'artifacts/fc27-browser/current-install.json'), 'utf8'));
  const source = await readFile(path.join(root, 'FCAutomationTool.user.js'));
  if (!installed.installed || !installed.exactSource || createHash('sha256').update(source).digest('hex') !== installed.sha256) {
    return { status: 'blocked', reason: 'CURRENT_INSTALLATION_REQUIRED' };
  }
  const cdp = await page.context().newCDPSession(page);
  let objectId;
  const call = async (fn, args = []) => {
    const result = await cdp.send('Runtime.callFunctionOn', { objectId, returnByValue: true,
      functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })) });
    if (result.exceptionDetails) throw Error('STREAMLINED_PANEL_READ_FAILED');
    return result.result?.value;
  };
  const click = async selector => {
    if (!['[data-solve]', '[data-close]', ...(recover ? ['[data-recover]'] : [])].includes(selector)) throw Error('PREVIEW_CONTROL_ONLY');
    const point = await call(function (selector) {
      const button = this.querySelector(selector);
      if (!button || button.disabled || !button.checkVisibility()) return null;
      button.scrollIntoView({ block: 'center' });
      const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (this.elementFromPoint(x, y) !== button) return null;
      return { x, y };
    }, [selector]);
    if (!point) throw Error('PREVIEW_CONTROL_UNAVAILABLE');
    await page.mouse.click(point.x, point.y);
  };
  try {
    const version = await page.locator('#fcat-fc27-production').getAttribute('data-version');
    if (version !== installed.version) return { status: 'blocked', reason: 'CURRENT_RUNTIME_REQUIRED' };
    const { root: document } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: document.nodeId, selector: '#fcat-streamlined-panel' });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.find(value => value.shadowRootType === 'closed');
    if (!shadow) throw Error('PREVIEW_SHADOW_UNAVAILABLE');
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'streamlined-preview' });
    objectId = object.objectId;
    const current = await call(function () {
      if (!this.querySelector('dialog')?.open) return null;
      return { target: this.querySelector('[data-target]')?.textContent,
        message: this.querySelector('[data-status]')?.textContent,
        summary: this.querySelector('.result-summary')?.textContent,
        contributionDisabled: this.querySelector('[data-contribute]')?.disabled,
        notes: Array.from(this.querySelectorAll('[data-result] small')).map(node => node.textContent.slice(0, 600)).slice(0, 8) };
    });
    if (current && !recover) return { status: 'existing-panel-observed', installedSha256: installed.sha256,
      runtimeVersion: version, ...current, eaMutationsPerformed: false };
    if (!current) await page.locator('#fcat-streamlined-entry').click({ timeout: 5000 });
    for (let n = 0; n < 50; n++) {
      if (await call(function () { return !this.querySelector('[data-solve]').disabled; })) break;
      await page.waitForTimeout(100);
    }
    await click(recover ? '[data-recover]' : '[data-solve]');
    let snapshot;
    for (let n = 0; n < 240; n++) {
      snapshot = await call(function () { return {
        busy: this.querySelector('[data-solve]').disabled,
        target: this.querySelector('[data-target]').textContent,
        message: this.querySelector('[data-status]').textContent,
        summary: this.querySelector('.result-summary')?.textContent ?? null,
        selection: this.querySelector('[data-selection]')?.textContent ?? null,
        rows: this.querySelectorAll('.player-row').length,
        cards: this.host.querySelectorAll('.gallery-native-card').length,
        batches: this.querySelectorAll('summary input').length,
        contributionDisabled: this.querySelector('[data-contribute]').disabled,
        notes: Array.from(this.querySelectorAll('[data-result] small')).map(node => node.textContent.slice(0, 600)).slice(0, 8),
      }; });
      if (!snapshot.busy) break;
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: path.join(root, 'artifacts/fc27-browser/streamlined-preview.png') });
    await click('[data-close]');
    return { status: snapshot.busy ? 'timeout' : snapshot.summary ? 'observed' : 'blocked', installedSha256: installed.sha256,
      runtimeVersion: version, ...snapshot, eaMutationsPerformed: false };
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'streamlined-preview' }).catch(() => {});
    await cdp.detach();
  }
}

// Static function descriptors only: never invoke a service, getter, selection or
// contribution. Sources are public method bodies, not instance fields/credentials.
export function readStreamlinedMethodSources() {
  const names = ['UTHttpRequest', 'EAHttpRequest', 'EAObservable', 'UTSBCService', 'UTSBCDAO', 'UTOneClickSBCWorkAreaViewModel',
    'UTOneClickSBCWorkAreaViewController', 'UTItemEntity'];
  const rows = [];
  for (const name of names) {
    const type = Object.getOwnPropertyDescriptor(globalThis, name)?.value;
    let proto = type?.prototype;
    for (let depth = 0; proto && depth < 4; depth++, proto = Object.getPrototypeOf(proto)) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (!(/HttpRequest$/.test(name) && ['setPath', 'setUrlVariables'].includes(key))
            && !(name === 'EAObservable' && key === 'notify') && !/OneClick|sbsScore|submit|SelectionLimit|SelectedItems|calculateScore|_updateSbcProgress|_evictSubmittedItems|removeItemsById|requestChallenge|requestSet/i.test(key)) continue;
        const d = Object.getOwnPropertyDescriptor(proto, key);
        const fn = d.value ?? d.get;
        if (typeof fn !== 'function' || rows.some(row => row.owner === name && row.name === key)) continue;
        const source = Function.prototype.toString.call(fn);
        if (source.length > 24000 || rows.length >= 45) continue;
        rows.push({ owner: name, name: key, getter: !!d.get, source });
      }
    }
  }
  // Some builds no longer expose the DAO/entity constructor under a global
  // name. Walk only prototypes of the known native objects, never own fields.
  const instances = [['SBCDAO.instance', globalThis.services?.SBC?.sbcDAO],
    ['ItemDAO.instance', globalThis.services?.Item?.itemDao],
    ['ItemService.instance', globalThis.services?.Item],
    ['SquadService.instance', globalThis.services?.Squad],
    ['SBCService.instance', globalThis.services?.SBC],
    ['ItemEntity.instance', Object.values(globalThis.repositories?.Item?.club?.items ?? {})
      .flatMap(value => value && typeof value === 'object' ? Object.values(value) : [])
      .find(value => value?.type === 'player')]];
  for (const [owner, instance] of instances) {
    let proto = instance && Object.getPrototypeOf(instance);
    for (let depth = 0; proto && depth < 6; depth++, proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (!/OneClick|sbsScore|submitPlayers|_updateSbcProgress|requestChallenge|getChallengesForSet|getHub|resetSquadsCache|removeItemsById|storage/i.test(name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(proto, name), fn = descriptor.value ?? descriptor.get;
        if (typeof fn !== 'function' || rows.some(row => row.owner === owner && row.name === name)) continue;
        const source = Function.prototype.toString.call(fn);
        if (source.length <= 24000 && rows.length < 60) rows.push({ owner, name, getter: !!descriptor.get, source });
      }
    }
  }
  // Decode public method string-table lookups only, never instance fields.
  const constructorSource = Function.prototype.toString.call(globalThis.UTHttpRequest);
  const defaultDecoder = globalThis[constructorSource.match(/=(a0_0x[\da-f]+)/)?.[1]];
  return rows.map(row => {
    const aliases = new Map([...row.source.matchAll(/(_0x[\da-f]+)=(_0x[\da-f]+|a0_0x[\da-f]+)/g)].map(match => [match[1], match[2]]));
    const resolve = name => { for (let n = 0; aliases.has(name) && n < 8; n++) name = aliases.get(name); return globalThis[name]; };
    const decoded = row.source.replace(/(_0x[\da-f]+|a0_0x[\da-f]+)\((0x[\da-f]+)\)/g, (call, name, number) => {
      const decoder = resolve(name) ?? defaultDecoder;
      return typeof decoder === 'function' ? JSON.stringify(decoder(Number(number))) : call;
    });
    return { ...row, decoded };
  });
}
