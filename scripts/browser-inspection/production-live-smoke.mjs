import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function exerciseProductionLivePanel(context, directory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-acceptance-panel.js'],
    bundle: true, write: false, format: 'iife', globalName: 'LivePanelSmoke', target: 'chrome120' });
  const nativeBundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/fc27-puzzle-native-button.js'],
    bundle: true, write: false, format: 'iife', globalName: 'NativePuzzleSmoke', target: 'chrome120' });
  const pageBundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/ea/fc27-puzzle-page.js'],
    bundle: true, write: false, format: 'iife', globalName: 'NativePuzzlePageSmoke', target: 'chrome120' });
  const logBundle = await build({ absWorkingDir: root, entryPoints: ['src/diagnostics/fcat-diagnostic-log.js'],
    bundle: true, write: false, format: 'iife', globalName: 'DiagnosticLogSmoke', target: 'chrome120' });
  const effectsBundle = await build({ absWorkingDir: root, entryPoints: ['src/adapters/browser/user-effects.js'],
    bundle: true, write: false, format: 'iife', globalName: 'DownloadEffectsSmoke', target: 'chrome120' });
  const page = await context.newPage();
  let externalRequests = 0;
  await page.route('**/*', route => { externalRequests++; return route.abort(); });
  try {
    await page.setContent('<!doctype html><title>FC27 synthetic Live confirmation</title><body></body>');
    // Open only this offline fixture's shadow root so Playwright can inspect controls.
    await page.evaluate(() => {
      const attach = globalThis.Element.prototype.attachShadow;
      globalThis.Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.addScriptTag({ content: nativeBundle.outputFiles[0].text });
    await page.addScriptTag({ content: pageBundle.outputFiles[0].text });
    await page.addScriptTag({ content: logBundle.outputFiles[0].text });
    await page.addScriptTag({ content: effectsBundle.outputFiles[0].text });
    await page.evaluate(() => {
      const state = globalThis.livePanelSmoke = { prepares: 0, catalogReads: 0, puzzleReads: 0, executions: [], fills: [], exports: 0, fillReady: false, shortage: false, finish: null, puzzleCap: 82, quoteCeiling: null, policySaves: 0, policyReads: 0 };
      const diagnosticStore = new Map();
      const diagnosticLog = globalThis.DiagnosticLogSmoke.createFcatDiagnosticLog({ gmGetValue: key => diagnosticStore.get(key),
        gmSetValue: (key, value) => diagnosticStore.set(key, value), version: '27.0.2' });
      for (const status of ['started', 'failed', 'success']) void diagnosticLog.record({ area: 'gallery', event: 'catalog-request',
        source: 'futgg', status, reason: status === 'failed' ? 'HTTP 403' : undefined, token: 'must-not-export' });
      const effects = globalThis.DownloadEffectsSmoke.createUserEffectsAdapter(globalThis, globalThis.document);
      const mount = liveEnabled => globalThis.LivePanelSmoke.mountFc27AcceptancePanel({ document: globalThis.document,
        hostId: 'live-smoke', title: 'FC Automation Tool', liveEnabled,
        targets: () => [{ setId: 4, name: 'Synthetic upgrade' }],
        inspectPuzzlePolicy: async () => { state.policyReads++; return { status: 'observed', maxRating: state.puzzleCap, quoteCeiling: state.quoteCeiling }; },
        setPuzzleMaxRating: async value => { state.policySaves++; state.puzzleCap = value; return { status: 'observed', maxRating: value }; },
        setPuzzlePolicy: async value => {
          state.policySaves++; state.puzzleCap = value.maxRating; state.quoteCeiling = value.quoteCeiling;
          return { status: 'observed', ...value };
        },
        exportDiagnostics: async () => {
          if (state.exportFailure) throw new Error('private download error');
          state.exports++;
          const payload = await diagnosticLog.exportPayload();
          effects.downloadText(JSON.stringify(payload, null, 2), 'diagnostics.json');
          return { count: payload.entries.length, filename: 'diagnostics.json' };
        },
        inspectCatalog: async ({ setId }) => {
          state.catalogReads++;
          return { status: 'observed', reason: 'FC27_CHALLENGE_CATALOG_READ', setId, setName: 'Synthetic upgrade',
            challenges: [{ id: 16, name: 'Synthetic upgrade', status: 'IN_PROGRESS', eligibilityOperation: 'AND', requirements: [
              { count: -1, scope: 2, pairs: [{ key: 3, values: [1] }] },
            ] }] };
        },
        inspectPuzzle: async ({ setId, challengeId = 16 }) => {
          state.puzzleReads++;
          return { status: 'preview', reason: 'READ_ONLY_PLAN', setId, challengeId, fillReady: state.fillReady,
            policy: { maxRating: 74 }, rules: [], plan: { required: 11, selectedCount: 11, ratings: Array(11).fill(60),
              slots: Array.from({ length: 11 }, (_, slot) => slot), teamFacts: { teamRating: 60, chemistry: 33 },
              exactValidation: { status: 'verified' }, fillPreflight: { status: 'verified' } } };
        },
        prepare: async ({ setId, maxRating }) => {
          state.prepares++;
          return state.shortage ? { status: 'blocked', reason: 'SAFE_MATERIAL_SHORTAGE' }
            : { status: 'prepared', liveEnabled: true, setId, challengeId: 16, setName: 'Synthetic upgrade',
              maxRating, selectedCount: 11, ratings: Array(11).fill(60), packId: 509, packCount: 0 };
        },
        execute: approval => {
          state.executions.push(approval);
          return new Promise(resolve => { state.finish = () => resolve({ status: 'completed', submitted: true }); });
        },
        fillPuzzle: async approval => { state.fills.push(approval); return { status: 'filled', saved: true, submitted: false }; },
        inspectRecovery: async () => ({ status: 'idle' }), resolveRecovery: async () => ({ status: 'resolved' }),
        checkInstallation: async () => ({ status: 'verified', synthetic: true }),
      });
      state.mount = mount; state.panel = mount(true);
    });
    const host = page.locator('#live-smoke');
    const button = id => host.locator(`#${id}`);
    assert.equal(await host.isVisible(), false);
    // The same panel is embedded in an EA-owned page without rebuilding its
    // state or covering the navigation rail. Leaving that page hides it.
    await page.evaluate(() => {
      const container = globalThis.document.createElement('div'); container.id = 'native-workbench-page';
      globalThis.document.body.append(container); globalThis.livePanelSmoke.panel.open(container);
    });
    assert.equal(await host.getAttribute('data-navigation-page'), 'true');
    assert.equal(await host.evaluate(node => globalThis.getComputedStyle(node).position), 'relative');
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await host.locator('.workbench > details > summary').isVisible(), false);
    assert.equal(await host.locator('[data-sbc-advanced] > summary').isVisible(), true);
    assert.equal(await host.locator('.workbench > details').getAttribute('open'), '');
    await page.locator('#native-workbench-page').evaluate(node => { node.style.display = 'none'; });
    assert.equal(await host.isVisible(), false);
    await page.locator('#native-workbench-page').evaluate(node => { node.style.display = ''; });
    assert.equal(await host.isVisible(), true);
    await page.evaluate(() => globalThis.livePanelSmoke.panel.open());
    assert.equal(await host.isVisible(), true);
    assert.equal(await button('execute').isDisabled(), true);
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await button('puzzle-rating').inputValue(), '82');
    assert.equal(await button('puzzle-quote-ceiling').inputValue(), '');
    assert.equal(await host.getAttribute('data-active-tab'), 'sbc');
    assert.equal(await host.getByRole('tab').count(), 9);
    const beforeTabs = await page.evaluate(() => ({ ...globalThis.livePanelSmoke, mount: null, panel: null }));
    await button('puzzle-rating').fill('81');
    for (const id of ['gallery', 'market', 'trading', 'inventory', 'routine', 'rolling', 'activity', 'settings', 'sbc']) {
      await button(`tab-${id}`).click();
      assert.equal(await host.getAttribute('data-active-tab'), id);
      assert.equal(await host.locator('[role=tabpanel]:visible').count(), 1);
      assert.equal(await button(`page-${id}`).isVisible(), true);
      if (['market', 'trading', 'inventory', 'routine', 'rolling'].includes(id)) {
        assert.equal(await button(`page-${id}`).locator('button,input,select').count(), 0);
      }
      if (id === 'gallery') {
        assert.equal(await button('gallery-refresh').isDisabled(), true);
        assert.match(await button('gallery-status').innerText(), /未接入公开目录/);
      }
    }
    assert.equal(await button('puzzle-rating').inputValue(), '81');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.policyReads), beforeTabs.policyReads);
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.catalogReads), 0);
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.prepares), 0);
    await button('tab-sbc').press('End');
    assert.equal(await host.getAttribute('data-active-tab'), 'settings');
    await button('tab-settings').press('ArrowRight');
    assert.equal(await host.getAttribute('data-active-tab'), 'sbc');
    await button('tab-sbc').press('ArrowLeft');
    assert.equal(await host.getAttribute('data-active-tab'), 'settings');
    await button('tab-settings').press('Home');
    assert.equal(await host.getAttribute('data-active-tab'), 'sbc');
    await button('tab-settings').click();
    assert.equal(await button('export-diagnostics').isEnabled(), true);
    await button('export-diagnostics').evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.exports), 0);
    const downloadPromise = page.waitForEvent('download');
    await button('export-diagnostics').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'diagnostics.json');
    const exportFile = path.join(directory, 'diagnostic-export-smoke.json');
    await download.saveAs(exportFile);
    const exportedText = await readFile(exportFile, 'utf8');
    const exported = JSON.parse(exportedText);
    assert.equal(exported.entries.length, 3);
    assert.equal(exported.version, '27.0.2');
    assert.equal(exported.entries[1].reason, 'HTTP 403');
    assert.equal(exportedText.includes('must-not-export'), false);
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.exports), 1);
    assert.equal(await button('status').innerText(), 'FC27_DIAGNOSTICS_EXPORTED');
    assert.match(await button('diagnostic-export-status').innerText(), /3/);
    await page.evaluate(() => { globalThis.livePanelSmoke.exportFailure = true; });
    await button('export-diagnostics').click();
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await button('status').innerText(), 'FC27_DIAGNOSTICS_EXPORT_FAILED');
    assert.equal(await button('export-diagnostics').isEnabled(), true);
    await page.evaluate(() => { globalThis.livePanelSmoke.exportFailure = false; });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await host.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await page.screenshot({ path: path.join(directory, `diagnostic-settings-${width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await button('tab-sbc').click();
    await button('puzzle-rating').fill('83');
    await button('puzzle-quote-ceiling').fill('7500');
    await button('puzzle-policy-save').evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.policySaves), 0);
    await button('puzzle-policy-save').click();
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.puzzleCap), 83);
    assert.match(await button('status').innerText(), /83/);
    const readsBeforeReopen = await page.evaluate(() => globalThis.livePanelSmoke.policyReads);
    await page.evaluate(() => globalThis.livePanelSmoke.panel.open());
    // The details toggle is dispatched asynchronously. Wait for this open's
    // settings read, not the idle flag left over from the previous save.
    await page.waitForFunction(reads => globalThis.livePanelSmoke.policyReads > reads
      && globalThis.document.getElementById('live-smoke').dataset.busy === 'false', readsBeforeReopen);
    assert.equal(await button('puzzle-rating').inputValue(), '83');
    assert.equal(await button('puzzle-quote-ceiling').inputValue(), '7500');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.quoteCeiling), 7500);
    await button('puzzle-quote-ceiling').fill(''); await button('puzzle-policy-save').click();
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.quoteCeiling), null);
    assert.match(await button('status').innerText(), /不限/);
    await host.locator('[data-sbc-advanced] > summary').click();
    await button('catalog').click();
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.catalogReads), 1);
    assert.match(await host.locator('#requirements').innerText(), /All players/);
    await button('prepare').evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.prepares), 0);
    const prepare = async () => {
      if (!(await host.locator('[data-sbc-advanced]').evaluate(node => node.open))) await host.locator('[data-sbc-advanced] > summary').click();
      await button('prepare').click();
      await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    };
    await prepare();
    assert.equal(await button('execute').isEnabled(), true);
    await button('puzzle').evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.puzzleReads), 0);
    await button('puzzle').click();
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.puzzleReads), 1);
    assert.equal(await button('execute').isDisabled(), true);
    assert.equal(await host.locator('#squad li').count(), 11);
    assert.match(await host.locator('#squad').innerText(), /chemistry 33/);
    assert.match(await host.locator('#requirements').innerText(), /Preview only/);
    assert.equal(await button('fill').isDisabled(), true);
    await page.evaluate(() => { globalThis.livePanelSmoke.fillReady = true; });
    await button('puzzle').click();
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await button('fill').isEnabled(), true);
    await button('fill').click();
    assert.match(await button('approval').innerText(), /No SBC submission/);
    await button('cancel').click();
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.fills.length), 0);
    await button('fill').evaluate(node => node.click());
    assert.equal(await host.locator('dialog').evaluate(node => node.open), false);
    await button('fill').click();
    await button('confirm').click();
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.deepEqual(await page.evaluate(() => globalThis.livePanelSmoke.fills), [
      { approved: true, action: 'fill-only', count: 1, setId: 4, challengeId: 16, maxPlayers: 11, maxRating: 74 },
    ]);
    assert.equal(await button('fill').isDisabled(), true);
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.executions.length), 0);
    await page.evaluate(() => {
      const document = globalThis.document;
      const section = document.createElement('section'); section.id = 'native-sbc';
      const anchor = document.createElement('button'); anchor.textContent = 'EA submit'; section.append(anchor); document.body.append(section);
      const state = globalThis.livePanelSmoke; state.nativePlans = [];
      state.target = { setId: 19, challengeId: 43, anchor };
      class SquadController {}
      class DetailController {}
      const nativeRoot = { document, UTSBCSquadSplitViewController: SquadController, UTSBCSquadDetailPanelViewController: DetailController,
        getAppMain: () => ({ getRootViewController: () => ({ getPresentedViewController: () => null,
          currentController: { currentController: { currentController: state.target ? Object.assign(new SquadController(), {
            _set: { id: state.target.setId }, _challengeId: state.target.challengeId,
            _challengeDetailsController: { currentController: Object.assign(new DetailController(), {
              _set: { id: state.target.setId }, _challenge: { id: state.target.challengeId, setId: state.target.setId },
              getView: () => ({ _btnExchange: { getRootElement: () => state.target.anchor } }),
            }) },
          }) : null } },
        }) }) };
      state.cleanup = globalThis.NativePuzzleSmoke.mountFc27PuzzleNativeButton({ document,
        readTarget: () => globalThis.NativePuzzlePageSmoke.readFc27PuzzlePage(nativeRoot),
        onFill: async (target, callbacks) => {
          state.nativePlans.push(target); state.nativeCallbacks = callbacks;
          callbacks.onProgress('validating');
          if (state.holdNative) await new Promise(resolve => { state.releaseNative = resolve; });
          return state.nativeResult ?? { status: 'filled', saved: true, submitted: false };
        },
        schedule: update => { state.updateNative = update; return 1; }, unschedule: () => {} });
    });
    const nativeButton = page.locator('#fcat-fc27-puzzle-native');
    assert.equal(await nativeButton.count(), 1);
    assert.equal(await nativeButton.evaluate(node => node.nextSibling.textContent), 'EA submit');
    await page.evaluate(() => globalThis.livePanelSmoke.panel.close());
    await nativeButton.evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.nativePlans.length), 0);
    await nativeButton.click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-fc27-puzzle-native').disabled);
    assert.deepEqual(await page.evaluate(() => globalThis.livePanelSmoke.nativePlans), [{ setId: 19, challengeId: 43 }]);
    assert.match(await page.locator('#fcat-fc27-puzzle-status').innerText(), /阵容已保存/);
    assert.equal(await host.locator('.workbench > details').evaluate(node => node.open), false);
    assert.equal(await host.locator('dialog').evaluate(node => node.open), false);
    // Replace target object to model navigation between periodic observations.
    await page.evaluate(() => {
      globalThis.livePanelSmoke.nativeResult = { status: 'blocked', reason: 'SAFE_MATERIAL_SHORTAGE',
        purchaseSuggestion: { status: 'blocked', reason: 'FC27_PURCHASE_REPAIR_NO_PLAN', diagnostics: {
          stage: 'local-market-search', route: 'joint', catalogPages: 3, catalogCandidates: 48,
          usableCandidates: 20, localReason: 'FC27_PUZZLE_SEARCH_LIMIT', nodes: 50000, truncated: true,
          catalogAttempts: 0, quoteAttempts: 0, cacheHits: 3,
        } } };
    });
    await nativeButton.click();
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-fc27-puzzle-native').disabled);
    assert.match(await page.locator('#fcat-fc27-puzzle-status').innerText(), /FC27_PURCHASE_REPAIR_NO_PLAN/);
    assert.match(await page.locator('#fcat-fc27-puzzle-status').innerText(), /FC27_PUZZLE_SEARCH_LIMIT/);
    assert.equal(await page.locator('#fcat-fc27-puzzle-status').evaluate(node => globalThis.getComputedStyle(node).whiteSpace), 'pre-line');
    assert.equal(await host.locator('.workbench > details').evaluate(node => node.open), false);
    await page.evaluate(() => { globalThis.livePanelSmoke.nativeResult = null; });
    await page.evaluate(() => { const state = globalThis.livePanelSmoke; state.target = { ...state.target, challengeId: 45 }; });
    await nativeButton.click();
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.nativePlans.length), 2);
    await nativeButton.click();
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.nativePlans.at(-1).challengeId), 45);
    await page.waitForFunction(() => !globalThis.document.getElementById('fcat-fc27-puzzle-native').disabled);
    await page.evaluate(() => { globalThis.livePanelSmoke.holdNative = true; });
    await nativeButton.click();
    assert.equal(await nativeButton.isDisabled(), true);
    await nativeButton.evaluate(node => node.click());
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.nativePlans.length), 4);
    await page.evaluate(() => { const state = globalThis.livePanelSmoke; state.target = null; state.updateNative(); });
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.nativeCallbacks.isCurrent()), false);
    assert.equal(await nativeButton.count(), 0);
    await page.evaluate(() => globalThis.livePanelSmoke.releaseNative());
    await page.evaluate(() => globalThis.livePanelSmoke.cleanup());
    await page.evaluate(() => globalThis.livePanelSmoke.panel.open());
    await prepare();
    assert.equal(await button('execute').isEnabled(), true);
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.executions.length), 0);
    await button('rating').selectOption('83');
    assert.equal(await button('execute').isDisabled(), true);
    await button('rating').selectOption('74');
    await prepare();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await host.locator('.workbench > details').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.equal(await host.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await button('tab-settings').click(); await button('tab-sbc').click();
      await page.screenshot({ path: path.join(directory, `production-live-panel-${width}.png`) });
    }
    await button('execute').click();
    assert.match(await button('approval').innerText(), /11 players, max OVR 74, once/);
    await page.screenshot({ path: path.join(directory, 'production-live-confirm-390.png') });
    await button('cancel').click();
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.executions.length), 0);
    await button('execute').click();
    await button('confirm').click();
    assert.equal(await button('execute').isDisabled(), true);
    assert.equal(await button('confirm').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => globalThis.livePanelSmoke.executions), [
      { approved: true, count: 1, setId: 4, challengeId: 16, maxRating: 74, maxPlayers: 11 },
    ]);
    await button('tab-gallery').click();
    assert.equal(await host.getAttribute('data-active-tab'), 'gallery');
    assert.equal(await page.evaluate(() => globalThis.livePanelSmoke.executions.length), 1);
    await button('tab-sbc').click();
    await page.evaluate(() => globalThis.livePanelSmoke.finish());
    await page.waitForFunction(() => globalThis.document.getElementById('live-smoke').dataset.busy === 'false');
    assert.equal(await button('execute').isDisabled(), true);
    await page.evaluate(() => { globalThis.livePanelSmoke.shortage = true; });
    await prepare();
    assert.equal(await button('status').innerText(), 'SAFE_MATERIAL_SHORTAGE');
    assert.equal(await button('execute').isDisabled(), true);
    await page.evaluate(() => {
      globalThis.document.getElementById('live-smoke').remove();
      globalThis.livePanelSmoke.shortage = false; globalThis.livePanelSmoke.panel = globalThis.livePanelSmoke.mount(false);
    });
    await page.evaluate(() => globalThis.livePanelSmoke.panel.open());
    assert.equal(await button('status').innerText(), 'Live execution disabled');
    await prepare();
    assert.equal(await button('execute').isDisabled(), true);
    assert.equal(externalRequests, 0);
    await writeFile(path.join(directory, 'production-live-panel-self-test.json'), JSON.stringify({ schema: 1,
      source: 'synthetic callbacks only; no EA or Tampermonkey', userConfirmationRequired: true,
      cancelWithoutExecution: true, exactSingleApproval: true, staleUiPlanCleared: true,
      shortageBlocked: true, readonlyPanelBlocked: true, puzzleClearsSubmit: true,
      puzzleSaveConfirmation: true, nativeTargetNavigation: true, nativeOneClickNoPanel: true, nativeDuplicateClickBlocked: true, externalRequests }, null, 2));
    console.log('Production Live panel smoke passed: confirmation, cancel, single use, Puzzle preview, shortage and read-only isolation. Synthetic only.');
  } finally { await page.close(); }
}
