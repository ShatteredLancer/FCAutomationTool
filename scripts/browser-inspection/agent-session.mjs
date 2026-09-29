import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectPageReport, createNetworkCollector, pageKind } from './probe.mjs';
import { WEB_APP_URL } from './automatic.mjs';

const PRODUCTION_PANEL_ID = 'fcat-fc27-production';

async function panelCall(context, page, fn, args = []) {
  const cdp = await context.newCDPSession(page);
  try {
    const { root: documentNode } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: documentNode.nodeId, selector: `#${PRODUCTION_PANEL_ID}`,
    });
    if (!nodeId) return null;
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.find(value => value.shadowRootType === 'closed');
    if (!shadow) return null;
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: shadow.backendNodeId, objectGroup: 'agent-panel' });
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId, returnByValue: true,
      functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })),
    });
    return result.result?.value ?? null;
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'agent-panel' }).catch(() => {});
    await cdp.detach();
  }
}

async function readProductionPanel(context, page, setId = null) {
  const entry = page.locator('.ut-tab-bar .fcat-navigation-entry');
  if (await entry.count() === 1) await entry.click();
  const tab = await panelCall(context, page, function () {
    const button = this.getElementById('tab-sbc');
    if (!button) return null;
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (tab) await page.mouse.click(tab.x, tab.y);
  const deadline = Date.now() + 15000;
  let target = null;
  let reloaded = false;
  const refresh = await panelCall(context, page, function () {
    this.querySelector('details').open = true;
    const advanced = this.querySelector('[data-sbc-advanced]'); if (advanced) advanced.open = true;
    const button = this.getElementById('refresh');
    if (!button || button.disabled) return null;
    button.scrollIntoView({ block: 'nearest' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (refresh) await page.mouse.click(refresh.x, refresh.y);
  while (Date.now() < deadline) {
    target = await panelCall(context, page, function (requestedSetId) {
      this.querySelector('details').open = true;
      const select = this.getElementById('target');
      if (!select || !select.options.length) return { status: 'waiting', options: [] };
      if (requestedSetId !== null && [...select.options].some(option => option.value === String(requestedSetId))) {
        select.value = String(requestedSetId);
      }
      return { status: 'ready', options: [...select.options].map(option => ({ setId: Number(option.value), name: option.textContent })),
        selectedSetId: Number(select.value), selectedName: select.selectedOptions[0]?.textContent ?? null };
    }, [setId]);
    if (target?.status === 'ready') break;
    if (!reloaded && target === null) {
      reloaded = true;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (target?.status !== 'ready') return { status: 'blocked', reason: 'FC27_PANEL_TARGETS_UNAVAILABLE', reloaded };
  const click = await panelCall(context, page, function () {
    this.querySelector('details').open = true;
    const advanced = this.querySelector('[data-sbc-advanced]'); if (advanced) advanced.open = true;
    const button = this.getElementById('catalog');
    if (!button || button.disabled) return null;
    button.scrollIntoView({ block: 'nearest' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (!click) return { status: 'blocked', reason: 'FC27_PANEL_CATALOG_UNAVAILABLE', target, reloaded };
  await page.mouse.click(click.x, click.y);
  try {
    await page.waitForFunction(id => globalThis.document.getElementById(id)?.dataset.busy === 'false', PRODUCTION_PANEL_ID, { timeout: 20000 });
  } catch { return { status: 'blocked', reason: 'FC27_PANEL_CATALOG_TIMEOUT', target, reloaded }; }
  const result = await page.locator(`#${PRODUCTION_PANEL_ID}`).evaluate(host => {
    try { return JSON.parse(host.dataset.result ?? '{}'); } catch { return { status: 'blocked', reason: 'FC27_PANEL_RESULT_INVALID' }; }
  });
  return { status: 'observed', target, result, reloaded };
}

// Local stdin only: no debug port, arbitrary JS command, or account mutation API.
export async function runAgentSession({ context, terminal, root, withExtensions,
  loadHelpers = async revision => ({
    ...await import(`./runtime-observation.mjs?revision=${revision}`),
    ...await import(`./navigation.mjs?revision=${revision}`),
    ...await import(`../../src/adapters/ea/fc27-sbc-read.js?revision=${revision}`),
    ...await import(`./native-provider.mjs?revision=${revision}`),
    ...await import(`./puzzle-inspection.mjs?revision=${revision}`),
    ...await import(`./puzzle-ai.mjs?revision=${revision}`),
    ...await import(`./puzzle-market.mjs?revision=${revision}`),
    ...await import(`./puzzle-market-live.mjs?revision=${revision}`),
    ...await import(`./market-probe.mjs?revision=${revision}`),
    ...await import(`./navigation-probe.mjs?revision=${revision}`),
  }) }) {
  const network = createNetworkCollector(context);
  const directory = path.join(root, 'artifacts/fc27-browser');
  await mkdir(directory, { recursive: true });
  const reportFile = path.join(directory, `agent-${new Date().toISOString().replaceAll(':', '-')}.json`);
  const page = context.pages()[0] || await context.newPage();
  const squadReads = [];
  const clubReads = [];
  try {
    if (page.url() === 'about:blank') {
      try { await page.goto(WEB_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
      catch { console.log('Navigation incomplete; no automatic retry.'); }
    }
    console.log(`Agent session ready. Local report: ${reportFile}`);
    console.log('Login/2FA manually if requested. Commands: inspect, navigation-probe, provider, club, market-probe, sbc, set <id>, squad <set-id> <challenge-id>, panel-catalog [set-id], puzzle <set-id> <challenge-id>, puzzle-market <set-id> <challenge-id>, puzzle-market-live <set-id> <challenge-id>, ai-test, puzzle-ai <set-id> <challenge-id>, puzzle-market-ai <set-id> <challenge-id>, q.');
    while (true) {
      const command = (await terminal.question('agent > ')).trim();
      if (command === 'q') break;
      if (!/^(inspect|navigation-probe|provider|club|market-probe|sbc|ai-test|set [1-9]\d{0,8}|squad [1-9]\d{0,8} [1-9]\d{0,8}|panel-catalog(?: [1-9]\d{0,8})?|puzzle(?:-ai)? [1-9]\d{0,8} [1-9]\d{0,8}|puzzle-market(?:-ai)? [1-9]\d{0,8} [1-9]\d{0,8}|puzzle-market-live [1-9]\d{0,8} [1-9]\d{0,8})$/.test(command)) { console.log('Unsupported read-only command.'); continue; }
      if (command === 'ai-test') {
        try { const { testPuzzleAiConnection } = await loadHelpers(Date.now()); console.log(JSON.stringify(await testPuzzleAiConnection())); }
        catch { console.log('AI connection test unavailable; raw exception omitted.'); }
        continue;
      }
      const targets = context.pages().filter(target => pageKind(target.url()) === 'web-app');
      if (targets.length !== 1) { console.log('Exactly one Web App tab required.'); continue; }
      try {
        // Reload diagnostic helpers between inspections, without restarting the login session.
        const revision = Date.now();
        const { observeRuntime, observePageUi, enterNativeSbc, enterNativeSet, inspectInProgressSquad, inspectNativeProvider, inspectPuzzlePlan, inspectPuzzleWithAi, inspectPuzzleMarket, inspectPuzzleMarketWithAi, inspectPuzzleMarketLive, inspectFc27MarketRuntime, inspectFc27Navigation } = await loadHelpers(revision);
        const target = targets[0];
        const report = await collectPageReport(target);
        const runtime = await target.evaluate(observeRuntime);
        let action = 'NONE';
        let squadRead = null;
        let nativeProvider = null;
        if (report.season === '27' && !withExtensions) {
          if (command === 'provider' || command === 'club') {
            const ui = await observePageUi(target);
            if (ui?.login === false && ui.modal === false && ui.loading === false
                && (ui.challenges === true || ui.sbc === true || ui.homeSbcTile === true && ui.homeObjectiveTile === true)) {
              nativeProvider = await inspectNativeProvider(target, { fresh: command === 'club' });
              action = nativeProvider.status === 'observed' ? 'NATIVE_PROVIDER_OBSERVED' : 'NATIVE_PROVIDER_UNVERIFIED';
              if (command === 'club') {
                clubReads.push({ observedAt: new Date().toISOString(), ...nativeProvider });
                if (clubReads.length > 10) clubReads.shift();
              }
            } else action = 'NATIVE_SESSION_NOT_CONFIRMED';
          }
          if (command === 'sbc') action = await enterNativeSbc(target, { extensionsDisabled: true });
          if (command.startsWith('set ')) action = await enterNativeSet(target, runtime, Number(command.slice(4)), { extensionsDisabled: true });
          if (command.startsWith('squad ')) {
            const ui = await observePageUi(target);
            if (ui?.challenges === true && ui.modal === false && ui.loading === false) {
              const [, setId, challengeId] = command.split(' ').map(Number);
              squadRead = await target.evaluate(inspectInProgressSquad, { setId, challengeId });
              action = squadRead.reason;
              squadReads.push({ observedAt: new Date().toISOString(), ...squadRead });
              if (squadReads.length > 10) squadReads.shift();
            } else action = 'NATIVE_CHALLENGES_NOT_CONFIRMED';
          }
        }
        const observation = { schema: 1, mode: 'agent', observedAt: new Date().toISOString(),
          metadata: { browserVersion: context.browser()?.version() ?? null,
            extensionMode: withExtensions ? 'existing-extensions' : 'disabled-native-baseline' },
          report, runtime, ui: await observePageUi(target), action, squadRead, squadReads, clubReads, nativeProvider,
          network: network.snapshot(), liveExecutionEnabled: false };
        if (command.startsWith('panel-catalog')) {
          const requested = command.split(' ')[1];
          observation.panel = await readProductionPanel(context, target, requested ? Number(requested) : null);
          observation.action = observation.panel.status === 'observed' ? 'PRODUCTION_PANEL_CATALOG_READ' : observation.panel.reason;
        }
        if (command.startsWith('puzzle ') || command.startsWith('puzzle-ai ')) {
          const ui = observation.ui;
          if (report.season !== '27' || ui?.login !== false || ui.modal !== false || ui.loading !== false) {
            observation.action = 'PUZZLE_SESSION_NOT_CONFIRMED';
          } else {
            const [, setId, challengeId] = command.split(' ').map(Number);
            observation.puzzle = command.startsWith('puzzle-ai ') ? await inspectPuzzleWithAi(target, setId, challengeId)
              : await inspectPuzzlePlan(target, setId, challengeId);
            observation.action = observation.puzzle.reason;
          }
        }
        if (command.startsWith('puzzle-market-live ')) {
          const ui = observation.ui;
          if (report.season !== '27' || ui?.login !== false || ui.modal !== false || ui.loading !== false) {
            observation.action = 'PUZZLE_MARKET_SESSION_NOT_CONFIRMED';
          } else {
            const [, setId, challengeId] = command.split(' ').map(Number);
            observation.puzzleMarket = await inspectPuzzleMarketLive(target, setId, challengeId);
            observation.action = observation.puzzleMarket.reason ?? observation.puzzleMarket.status;
          }
        }
        if (command.startsWith('puzzle-market ') || command.startsWith('puzzle-market-ai ')) {
          const ui = observation.ui;
          if (report.season !== '27' || ui?.login !== false || ui.modal !== false || ui.loading !== false) {
            observation.action = 'PUZZLE_MARKET_SESSION_NOT_CONFIRMED';
          } else {
            const [, setId, challengeId] = command.split(' ').map(Number);
            const inspect = command.startsWith('puzzle-market-ai ') ? inspectPuzzleMarketWithAi : inspectPuzzleMarket;
            observation.puzzleMarket = await inspect(target, setId, challengeId);
            observation.action = observation.puzzleMarket.reason ?? observation.puzzleMarket.status;
          }
        }
        if (command === 'market-probe') {
          const ui = observation.ui;
          if (report.season !== '27' || ui?.login !== false || ui.modal !== false || ui.loading !== false) {
            observation.action = 'MARKET_SESSION_NOT_CONFIRMED';
          } else {
            observation.marketProbe = await inspectFc27MarketRuntime(target);
            observation.action = observation.marketProbe.reason ?? observation.marketProbe.status;
          }
        }
        if (command === 'navigation-probe') {
          observation.navigation = await target.evaluate(inspectFc27Navigation);
          observation.action = 'NAVIGATION_READ_ONLY_INSPECTED';
        }
        // Include the requests made by this command, not only earlier traffic.
        observation.network = network.snapshot();
        await writeFile(reportFile, JSON.stringify(observation, null, 2));
        console.log(JSON.stringify({ saved: reportFile, action: observation.action, season: report.season, ui: observation.ui,
          setCount: runtime.sbc.sets.count, clubCachedEntries: runtime.inventory.club.count }));
      } catch { console.log('Inspection unavailable; raw exception omitted.'); }
    }
  } finally { network.stop(); }
}
