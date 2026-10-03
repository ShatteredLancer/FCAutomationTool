import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectPageReport, createNetworkCollector, pageKind } from './probe.mjs';
import { WEB_APP_URL } from './automatic.mjs';
import { panelCall, waitForPanel, openProductionPanel, selectPanelTab, clickPanelControl } from './production-panel-inspection.mjs';

const PRODUCTION_PANEL_ID = 'fcat-fc27-production';

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

export async function readProductionGallery(context, page, setName = 'Arsenal') {
  await openProductionPanel(context, page);
  await selectPanelTab(context, page, 'gallery');
  for (let level = 0; level < 2; level++) {
    const backVisible = await panelCall(context, page, function () {
      return this.getElementById('gallery-back')?.checkVisibility() === true;
    });
    if (!backVisible) break;
    await clickPanelControl(context, page, '#gallery-back');
  }
  const deadline = Date.now() + 25000;
  let overview = null;
  let categorySelectors = [];
  let categoryIndex = 0;
  while (Date.now() < deadline) {
    overview = await panelCall(context, page, function (requestedName) {
      const status = this.getElementById('gallery-status')?.textContent ?? '';
      const source = this.getElementById('gallery-source')?.textContent ?? '';
      const cards = [...this.querySelectorAll('#gallery-set-list .gallery-set')].map(card => ({
        name: card.querySelector('h4')?.textContent?.trim() ?? '',
        progress: card.querySelector('small')?.textContent?.trim() ?? '',
        button: !!card.querySelector('.gallery-open-set'),
      }));
      const target = cards.find(card => card.name.toLowerCase() === requestedName.toLowerCase());
      return { status, source, activeTab: this.host?.dataset?.activeTab ?? null,
        tabSelected: this.getElementById('tab-gallery')?.getAttribute('aria-selected') ?? null,
        pageHidden: this.getElementById('page-gallery')?.hidden ?? null,
        categories: this.querySelectorAll('#gallery-categories button[data-category-id]:not([data-category-id=""])').length,
        categorySelectors: [...this.querySelectorAll('#gallery-categories button[data-category-id]:not([data-category-id=""])')]
          .map(button => `#gallery-categories [data-category-id="${globalThis.CSS.escape(button.dataset.categoryId)}"]`),
        categoryButtons: this.querySelectorAll('#gallery-categories button').length,
        sets: cards.length, target, loaded: cards.length > 0 };
    }, [setName]);
    if (overview?.loaded && overview.target) break;
    // Gallery now intentionally opens at the category page.  Walk the
    // rendered categories until the requested set is visible; this keeps the
    // inspection aligned with the production navigation instead of relying on
    // hidden set cards from the old all-sets home view.
    if (overview?.categorySelectors?.length && categorySelectors.length === 0) {
      categorySelectors = overview.categorySelectors;
    }
    if (categoryIndex < categorySelectors.length) {
      if (categoryIndex > 0) await clickPanelControl(context, page, '#gallery-back');
      await clickPanelControl(context, page, categorySelectors[categoryIndex++]);
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!overview?.loaded || !overview.target) return { status: 'blocked', reason: 'FC27_GALLERY_SET_UNAVAILABLE', overview };
  const click = await panelCall(context, page, function (requestedName) {
    const card = [...this.querySelectorAll('#gallery-set-list .gallery-set')].find(value =>
      value.querySelector('h4')?.textContent?.trim()?.toLowerCase() === requestedName.toLowerCase());
    const button = card?.querySelector('.gallery-open-set');
    if (!button) return null;
    return `[data-set-id="${globalThis.CSS.escape(card.dataset.setId)}"] .gallery-open-set`;
  }, [setName]);
  if (!click) return { status: 'blocked', reason: 'FC27_GALLERY_SET_BUTTON_UNAVAILABLE', overview };
  await clickPanelControl(context, page, click);
  let detail = null;
  while (Date.now() < deadline + 25000) {
    detail = await panelCall(context, page, function () {
      const root = this.getElementById('gallery-set-detail');
      const text = root?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const cards = root ? root.querySelectorAll('.gallery-card').length : 0;
      const filters = root ? [...root.querySelectorAll('button')].map(button => button.textContent?.trim()) : [];
      return { visible: !!root && !root.hidden, name: root?.querySelector('h3')?.textContent, text: text.slice(0, 1600), cards, filters,
        loading: text.includes('正在读取卡池') };
    });
    if (detail?.visible && !detail.loading && detail.cards > 0) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!detail?.visible || detail.loading || detail.cards === 0) return { status: 'blocked', reason: 'FC27_GALLERY_DETAIL_UNAVAILABLE', overview, detail };
  if (detail.name?.toLowerCase() !== setName.toLowerCase()) return { status: 'blocked', reason: 'FC27_GALLERY_DETAIL_MISMATCH', overview, detail };
  const filtered = await panelCall(context, page, function () {
    const root = this.getElementById('gallery-set-detail');
    const button = [...(root?.querySelectorAll('button') ?? [])].find(value => value.textContent?.trim() === '已收集');
    if (!button) return null;
    return `#gallery-set-detail .gallery-card-filters button:nth-child(${[...button.parentElement.children].indexOf(button) + 1})`;
  });
  if (!filtered) return { status: 'blocked', reason: 'FC27_GALLERY_FILTER_UNAVAILABLE', overview, detail };
  await clickPanelControl(context, page, filtered);
  await waitForPanel(context, page, function (selector) {
    return this.querySelector(selector)?.getAttribute('aria-pressed') === 'true';
  }, [filtered]);
  const collected = await panelCall(context, page, function () {
    const root = this.getElementById('gallery-set-detail');
    return { text: root?.textContent?.replace(/\s+/g, ' ').trim()?.slice(0, 800) ?? '', cards: root?.querySelectorAll('.gallery-card').length ?? 0 };
  });
  const back = await panelCall(context, page, function () {
    // The production UI keeps the return control in the sticky browse nav so
    // it remains visible while the detail card list scrolls.  Older smoke
    // code searched inside the detail body and therefore rejected the valid
    // pinned arrow button.
    const button = this.getElementById('gallery-back');
    if (!button) return null;
    return '#gallery-back';
  });
  if (!back) return { status: 'blocked', reason: 'FC27_GALLERY_RETURN_UNAVAILABLE', overview, detail, collected };
  await clickPanelControl(context, page, back);
  const returned = await waitForPanel(context, page, function () {
    return this.querySelector('#gallery-set-detail')?.hidden === true && this.querySelector('#gallery-sets')?.checkVisibility();
  });
  return { status: 'observed', overview, detail, collected, returned };
}

// One bounded read-only pass over every public Gallery pool. This is separate
// from gallery-read because the latter intentionally exercises one lazy-loaded
// set only; the command records the production sync result and visible counts.
export async function syncProductionGallery(context, page) {
  // Warm the production panel through the already-verified single-set path;
  // this also closes any stale detail view left by the user's last inspection.
  const warmup = await readProductionGallery(context, page, 'Arsenal');
  if (warmup.status !== 'observed') throw new Error('FC27_GALLERY_PANEL_UNAVAILABLE');
  await openProductionPanel(context, page);
  await selectPanelTab(context, page, 'gallery');
  const control = await waitForPanel(context, page, function () {
    const button = this.getElementById('gallery-sync');
    return button ? { hidden: button.hidden, disabled: button.disabled, visible: button.checkVisibility?.() ?? null,
      activeTab: this.host?.dataset?.activeTab ?? null } : null;
  }, [], 15000);
  if (control.hidden || control.disabled || control.visible === false) throw new Error('FC27_GALLERY_SYNC_CONTROL_UNAVAILABLE');
  await clickPanelControl(context, page, '#gallery-sync', 5000);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = await panelCall(context, page, function () {
      const dialog = this.getElementById('gallery-sync-dialog');
      const cards = [...this.querySelectorAll('#gallery-set-list .gallery-set')].map(card => ({
        name: card.querySelector('h4')?.textContent?.trim() ?? '',
        progress: card.querySelector('small')?.textContent?.trim() ?? '',
      }));
      return { open: !!dialog?.open, message: this.getElementById('gallery-sync-message')?.textContent ?? '',
        note: this.getElementById('gallery-progress-note')?.textContent ?? '',
        cards, status: this.getElementById('gallery-status')?.textContent ?? '' };
    });
    if (state && !state.open) return { status: 'observed', ...state };
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { status: 'blocked', reason: 'FC27_GALLERY_SYNC_TIMEOUT' };
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
    console.log('Login/2FA manually if requested. Commands: inspect, tabs, home, navigation-probe, provider, club, market-probe, diagnostics-export, sbc, set <id>, squad <set-id> <challenge-id>, panel-catalog [set-id], gallery-read [set-name], gallery-sync, puzzle <set-id> <challenge-id>, puzzle-market <set-id> <challenge-id>, puzzle-market-live <set-id> <challenge-id>, ai-test, puzzle-ai <set-id> <challenge-id>, puzzle-market-ai <set-id> <challenge-id>, q.');
    console.log('gallery-fallback temporarily changes the local Gallery proxy, tests the public catalog fallback, then restores the original setting; no EA write.');
    while (true) {
      const command = (await terminal.question('agent > ')).trim();
      if (command === 'q') break;
      if (!/^(inspect|tabs|home|navigation-probe|provider|club|market-probe|diagnostics-export|sbc|ai-test|gallery-fallback|gallery-sync|set [1-9]\d{0,8}|squad [1-9]\d{0,8} [1-9]\d{0,8}|panel-catalog(?: [1-9]\d{0,8})?|gallery-read(?: [^\s]{1,80})?|puzzle(?:-ai)? [1-9]\d{0,8} [1-9]\d{0,8}|puzzle-market(?:-ai)? [1-9]\d{0,8} [1-9]\d{0,8}|puzzle-market-live [1-9]\d{0,8} [1-9]\d{0,8})$/.test(command)) { console.log('Unsupported read-only command.'); continue; }
      if (command === 'tabs') {
        const tabs = [];
        for (const [index, candidate] of context.pages().entries()) tabs.push({ index, url: candidate.url(),
          title: await candidate.title().catch(() => '') });
        console.log(JSON.stringify(tabs));
        continue;
      }
      if (command === 'ai-test') {
        try { const { testPuzzleAiConnection } = await loadHelpers(Date.now()); console.log(JSON.stringify(await testPuzzleAiConnection())); }
        catch { console.log('AI connection test unavailable; raw exception omitted.'); }
        continue;
      }
      const targets = context.pages().filter(target => pageKind(target.url()) === 'web-app');
      let target = targets.length === 1 ? targets[0] : null;
      if (!target && targets.length > 1) {
        // Repeated inspection launches can leave a login redirect beside the
        // live Web App tab. Select one readable, non-login tab without closing
        // or mutating any user page; remain fail-closed if still ambiguous.
        const candidates = [];
        for (const candidate of targets) {
          try {
            const text = await candidate.locator('body').innerText({ timeout: 1000 });
            if (!/\b(?:Login|Sign in|Signed Into Another Device)\b/i.test(text)) candidates.push(candidate);
          } catch { /* Closed or transitional tab. */ }
        }
        if (candidates.length === 1) target = candidates[0];
      }
      if (!target) { console.log('Exactly one readable Web App tab required.'); continue; }
      try {
        // Reload diagnostic helpers between inspections, without restarting the login session.
        const revision = Date.now();
        const { observeRuntime, observePageUi, enterNativeSbc, enterNativeSet, inspectInProgressSquad, inspectNativeProvider, inspectPuzzlePlan, inspectPuzzleWithAi, inspectPuzzleMarket, inspectPuzzleMarketWithAi, inspectPuzzleMarketLive, inspectFc27MarketRuntime, inspectFc27Navigation } = await loadHelpers(revision);
        const report = await collectPageReport(target);
        const runtime = await target.evaluate(observeRuntime);
        if (command === 'home') {
          let action = 'HOME_NAVIGATION_UNCONFIRMED';
          try {
            await target.goto(WEB_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await target.waitForTimeout(1000);
            action = 'HOME_NAVIGATION_REQUESTED';
          } catch { /* Keep the page open for the next explicit inspection. */ }
          console.log(JSON.stringify({ saved: reportFile, action, season: report.season, ui: await observePageUi(target) }));
          continue;
        }
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
        if (command.startsWith('gallery-read')) {
          const requested = command.split(' ').slice(1).join(' ') || 'Arsenal';
          observation.gallery = await readProductionGallery(context, target, requested);
          observation.action = observation.gallery.status === 'observed' ? 'PRODUCTION_GALLERY_READ' : observation.gallery.reason;
        }
        if (command === 'gallery-sync') {
          observation.gallery = await syncProductionGallery(context, target);
          observation.action = observation.gallery.status === 'observed' ? 'PRODUCTION_GALLERY_SYNC' : observation.gallery.reason;
        }
        if (command === 'gallery-fallback') {
          const { inspectGalleryFallback } = await import(`./gallery-proxy-inspection.mjs?revision=${revision}`);
          observation.gallery = await inspectGalleryFallback(context, target);
          observation.action = observation.gallery.reason;
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
        if (command === 'diagnostics-export') {
          await openProductionPanel(context, target);
          await selectPanelTab(context, target, 'settings');
          const downloadPromise = target.waitForEvent('download', { timeout: 10000 });
          await clickPanelControl(context, target, '#export-diagnostics', 10000);
          const download = await downloadPromise;
          const destination = path.join(directory, `diagnostics-captured-${Date.now()}.json`);
          await download.saveAs(destination);
          observation.diagnosticsExport = { status: 'observed', path: destination,
            suggestedFilename: download.suggestedFilename() };
          observation.action = 'FC27_DIAGNOSTICS_CAPTURED';
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
      } catch (error) {
        const message = typeof error?.message === 'string' && /^FC27_[A-Z0-9_]+$/.test(error.message)
          ? error.message : 'FC27_INSPECTION_COMMAND_FAILED';
        console.log(`Inspection unavailable: ${message}`);
      }
    }
  } finally { network.stop(); }
}
