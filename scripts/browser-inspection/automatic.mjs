import { setTimeout as delay } from 'node:timers/promises';
import { collectPageReport, collectRuntimeObservation, pageKind } from './probe.mjs';
import { observePageUi, enterNativeSbc } from './navigation.mjs';

export const WEB_APP_URL = 'https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';

// Bounded passive observations, not a readiness poll or an automatic login flow.
export async function collectAutomatically({ context, network, durationSeconds, save, notify = () => {},
  now = Date.now, wait = delay, environment = collectPageReport, runtime = collectRuntimeObservation,
  ui = observePageUi, navigate = enterNativeSbc, extensionsDisabled = false }) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 600) throw new Error('Invalid duration');
  const deadline = now() + durationSeconds * 1000;
  const samples = [];
  let lastSignature = null;
  let observations = 0;
  let last;
  let closed = false;
  let navigation = 'NOT_REQUESTED';
  const onClose = () => { closed = true; };
  context.on('close', onClose);
  try {
    while (!closed && now() < deadline) {
      const targets = context.pages().filter(page => pageKind(page.url()) === 'web-app');
      if (targets.length !== 1) {
        last = { state: targets.length ? 'AMBIGUOUS_WEB_APP_TABS' : 'WEB_APP_TAB_UNAVAILABLE' };
      } else {
        try {
          last = { state: 'OBSERVED', report: await environment(targets[0]), runtime: await runtime(targets[0]),
            ui: await ui(targets[0]) };
          if (extensionsDisabled && navigation === 'NOT_REQUESTED' && last.report.season === '27'
              && (last.ui?.home === true || last.ui?.homeView === true
                || last.ui?.homeSbcTile === true && last.ui?.homeObjectiveTile === true)
              && last.ui?.sbcTab === true && last.ui?.modal === false) {
            navigation = await navigate(targets[0], { extensionsDisabled });
          }
        } catch { last = { state: 'OBSERVATION_UNAVAILABLE' }; }
      }
      observations++;
      const signature = JSON.stringify(last);
      if (signature !== lastSignature) {
        samples.push({ elapsedMs: durationSeconds * 1000 - Math.max(0, deadline - now()), ...last });
        if (samples.length > 20) samples.shift();
        lastSignature = signature;
        notify(last.state);
      }
      await save({ schema: 1, mode: 'passive-auto', status: 'collecting', observations,
        liveExecutionEnabled: false, navigation, last, samples: [...samples], network: network.snapshot() });
      if (!closed) await wait(Math.max(0, Math.min(3000, deadline - now())));
    }
    const result = { schema: 1, mode: 'passive-auto', status: closed ? 'browser-closed' : 'window-ended',
      observations, liveExecutionEnabled: false, navigation, last: last ?? null, samples, network: network.snapshot() };
    await save(result);
    return result;
  } finally { context.off('close', onClose); }
}
