import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectPageReport, createNetworkCollector, pageKind } from './probe.mjs';
import { WEB_APP_URL } from './automatic.mjs';

// Local stdin only: no debug port, arbitrary JS command, or account mutation API.
export async function runAgentSession({ context, terminal, root, withExtensions,
  loadHelpers = async revision => ({
    ...await import(`./runtime-observation.mjs?revision=${revision}`),
    ...await import(`./navigation.mjs?revision=${revision}`),
    ...await import(`../../src/adapters/ea/fc27-sbc-read.js?revision=${revision}`),
    ...await import(`./native-provider.mjs?revision=${revision}`),
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
    console.log('Login/2FA manually if requested. Commands: inspect, provider, club, sbc, set <id>, squad <set-id> <challenge-id>, q.');
    while (true) {
      const command = (await terminal.question('agent > ')).trim();
      if (command === 'q') break;
      if (!/^(inspect|provider|club|sbc|set [1-9]\d{0,8}|squad [1-9]\d{0,8} [1-9]\d{0,8})$/.test(command)) { console.log('Unsupported read-only command.'); continue; }
      const targets = context.pages().filter(target => pageKind(target.url()) === 'web-app');
      if (targets.length !== 1) { console.log('Exactly one Web App tab required.'); continue; }
      try {
        // Reload diagnostic helpers between inspections, without restarting the login session.
        const revision = Date.now();
        const { observeRuntime, observePageUi, enterNativeSbc, enterNativeSet, inspectInProgressSquad, inspectNativeProvider } = await loadHelpers(revision);
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
        await writeFile(reportFile, JSON.stringify(observation, null, 2));
        console.log(JSON.stringify({ saved: reportFile, action, season: report.season, ui: observation.ui,
          setCount: runtime.sbc.sets.count, clubCachedEntries: runtime.inventory.club.count }));
      } catch { console.log('Inspection unavailable; raw exception omitted.'); }
    }
  } finally { network.stop(); }
}
