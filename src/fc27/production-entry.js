// ==UserScript==
// @name         FC Automation Tool
// @namespace    https://github.com/ShatteredLancer/FCAutomationTool
// @version      __DLR_VERSION__
// @description  FC27 traditional SBC preparation, confirmed single submission and recovery.
// @homepageURL  https://github.com/ShatteredLancer/FCAutomationTool
// @supportURL   https://github.com/ShatteredLancer/FCAutomationTool/issues
// @updateURL    https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FCAutomationTool.meta.js
// @downloadURL  https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FCAutomationTool.user.js
// @license      MIT
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @connect      www.futbin.org
// @connect      www.fut.gg
// @connect      fodder.gg
// @run-at       document-end
// ==/UserScript==

import { createFc27AcceptanceSession } from '../adapters/browser/fc27-acceptance-session.js';
import { mountFc27AcceptancePanel } from '../adapters/browser/fc27-acceptance-panel.js';
import { readFc27ChallengeTargets } from '../adapters/ea/fc27-fsu-read.js';
import { mountFc27PuzzleNativeButton } from '../adapters/browser/fc27-puzzle-native-button.js';
import { readFc27PuzzlePage } from '../adapters/ea/fc27-puzzle-page.js';
import { readFc27PurchasePageSlots } from '../adapters/ea/fc27-puzzle-page.js';
import { mountFc27PuzzleBuyButton } from '../adapters/browser/fc27-puzzle-buy-button.js';
import { readFc27MarketPlayerName } from '../adapters/ea/fc27-market-read.js';
import { mountFc27WorkbenchNavigation } from '../adapters/browser/fc27-workbench-navigation.js';
import { createFc27GalleryCatalogProvider, createFc27GalleryTransport } from '../adapters/browser/fc27-gallery-catalog.js';
import { createFc27GalleryProgressReader } from '../adapters/ea/fc27-gallery-progress.js';
import { compactGalleryCollectionCaches } from '../adapters/browser/fc27-gallery-cache-migration.js';
import { compactGalleryPublicCaches } from '../adapters/browser/fc27-gallery-public-cache-migration.js';
import { createFc27GallerySync } from '../adapters/browser/fc27-gallery-sync.js';
import { createFc27GalleryPurchase } from '../adapters/browser/fc27-gallery-purchase.js';
import { createFc27GalleryAccounting } from '../adapters/browser/fc27-gallery-accounting.js';
import { createFc27GalleryListing } from '../adapters/browser/fc27-gallery-listing.js';
import { withFodderGalleryPools } from '../adapters/browser/fc27-fodder-gallery.js';
import { createFc27GalleryRelist } from '../adapters/browser/fc27-gallery-relist.js';
import { startGalleryTradingPoll } from '../adapters/browser/fc27-gallery-trading-poll.js';
import { createFc27GalleryNativeRenderer } from '../adapters/ea/fc27-gallery-card.js';
import { readFc27Context } from '../adapters/ea/fc27-local-read.js';
import { mergeGalleryAccountProgress } from '../gallery/progress.js';
import { readCachedGalleryPrice } from '../gallery/prices.js';
import { planGalleryGrade } from '../gallery/planner.js';
import { loadGalleryPriceSnapshot } from '../gallery/planning-prices.js';
import { createGalleryTargetStore } from '../gallery/targets.js';
import { createGalleryPlanStore } from '../gallery/plans.js';
import { createGalleryScoreCache } from '../gallery/score-cache.js';
import { createGalleryTradePreferences } from '../gallery/trade-preferences.js';
import { createGalleryPlanningSettings } from '../gallery/planning-settings.js';
import { createGalleryMarketComparison } from '../gallery/market-comparison.js';
import { createFc27MarketReadTransport } from '../adapters/ea/fc27-market-read.js';
import { createFcatDiagnosticLog } from '../diagnostics/fcat-diagnostic-log.js';
import { downloadFc27Diagnostics } from '../adapters/browser/fc27-diagnostic-download.js';
import { createFc27PublicPrices } from '../adapters/browser/fc27-public-prices.js';
import { mountFc27StreamlinedPanel } from '../adapters/browser/fc27-streamlined-panel.js';
import { createFc27StreamlinedSession } from '../adapters/browser/fc27-streamlined-session.js';
import { createFc27StreamlinedCatalog } from '../adapters/browser/fc27-streamlined-catalog.js';
import { createFc27StreamlinedMarket } from '../adapters/ea/fc27-streamlined-market.js';
import { createFc27StreamlinedExecution } from '../adapters/browser/fc27-streamlined-execution.js';
import { recoverFc27Streamlined } from '../adapters/browser/fc27-streamlined-recovery.js';
import { maintainFc27PuzzlePurchases } from '../adapters/browser/fc27-puzzle-buy-lifecycle.js';
import { locateFc27StreamlinedPage, projectFc27StreamlinedChallenge, readFc27StreamlinedInputs } from '../adapters/ea/fc27-streamlined-read.js';

// A new Tampermonkey identity: no legacy or Acceptance storage migration.
const dependencies = { root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  gmRequest: GM_xmlhttpRequest,
  lockManager: unsafeWindow.navigator.locks, liveEnabled: __FCAT_LIVE_ENABLED__ };
const diagnosticLog = createFcatDiagnosticLog({ gmGetValue: GM_getValue, gmSetValue: GM_setValue, version: __FCAT_VERSION__ });
const bootFailures = [];
const safeBoot = (label, action, fallback = null) => {
  try { return action(); } catch (error) {
    const reason = /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'FC27_BOOT_OPTIONAL_FAILED';
    bootFailures.push({ label, reason });
    bootFailures.splice(0, Math.max(0, bootFailures.length - 20));
    try { unsafeWindow.__FCAT_BOOT_FAILURES__ = bootFailures.map(row => ({ ...row })); } catch { /* Diagnostics only. */ }
    try { Promise.resolve(diagnosticLog.record({ area: 'runtime', event: 'boot-failure', phase: label, reason })).catch(() => {}); } catch { /* Optional. */ }
    return fallback;
  }
};
// Gallery presentation may reuse EA's already loaded static image routes. It
// uses the browser cache for league/club/nation emblems. Player cards are
// rendered by the separate EA native view adapter below.
const galleryAssets = Object.freeze({
  reward: type => {
    try {
      // Reuse loaded EA token definitions and the same rendered icon route
      // as Enhancer; rendering the catalogue does not request definitions.
      const token = unsafeWindow.services?.EventToken?.repository?._definitions?.find(row =>
        String(row.currencyName).toLowerCase() === String(type).toLowerCase());
      return token ? unsafeWindow.AssetLocationUtils?.getEventTokenIconUri(
        token.assetId, unsafeWindow.EventTokenIconVariant?.RENDERED) || '' : '';
    } catch { return ''; }
  },
  filter: (kind, id) => {
    try { const value = Number(id), util = unsafeWindow.AssetLocationUtils;
      const type = util?.FILTER?.[String(kind).toUpperCase()];
      return Number.isSafeInteger(value) && value > 0 && type ? util.getFilterImage(type, value) : '';
    } catch { return ''; }
  },
  club: id => { try { const u = unsafeWindow.AssetLocationUtils; return u?.getFilterImage(u.FILTER.CLUB, Number(id)) || ''; } catch { return ''; } },
  league: id => { try { const u = unsafeWindow.AssetLocationUtils; return u?.getFilterImage(u.FILTER.LEAGUE, Number(id)) || ''; } catch { return ''; } },
  rarity: id => {
    try {
      const rarity = unsafeWindow.repositories?.Rarity?.get?.(Number(id));
      const u = unsafeWindow.AssetLocationUtils;
      if (!rarity || typeof u?.getShellUri !== 'function') return '';
      // Enhancer Qce/getItemShell: player shell, large size, rarity tier/guid.
      const size = unsafeWindow.ItemViewSize?.LARGE;
      const tier = rarity.levels ? unsafeWindow.ItemRatingTier?.GOLD : unsafeWindow.ItemRatingTier?.NONE;
      if (size == null || tier == null || typeof rarity.getGuid !== 'function') return '';
      return u.getShellUri(size, 1, Number(rarity.id ?? id), tier, rarity.getGuid()) || '';
    } catch { return ''; }
  },
  nation: id => { try { const u = unsafeWindow.AssetLocationUtils; return u?.getFilterImage(u.FILTER.NATION, Number(id)) || ''; } catch { return ''; } },
  category: (slug, name = '', sets = []) => {
    const key = `${String(slug ?? '')} ${String(name ?? '')}`.toLocaleLowerCase();
    const rarityCategory = key.includes('rarit');
    if (rarityCategory) return [...new Set(sets.flatMap(set => galleryAssets.set(set.name, { slug: 'rarities' }, set)))];
    const ids = key.includes('england') || key.includes('premier') || key.includes('wsl')
      ? [13, 2216]
      : key.includes('spain') || key.includes('laliga') || key.includes('liga-f') || key.includes('la-liga')
        ? [53, 2222]
      : key.includes('germany') || key.includes('bundesliga') ? [19, 2215]
          : key.includes('france') || key.includes('ligue') || key.includes('arkema') ? [16, 2218]
            : key.includes('italy') || key.includes('serie-a') || key.includes('serie a') ? [31]
              : key.includes('leagues') || key === 'league' ? [13, 53, 19, 2215, 16, 31]
                : [];
    // Enhancer uses the rendered player shell for rarity/foil icons (Qce),
    // while league categories use the EA filter emblem route.
    return ids.map(id => rarityCategory ? galleryAssets.rarity(id) : galleryAssets.league(id)).filter(Boolean);
  },
  set: (name, category = {}, set = {}, pool = []) => {
    try {
      // Enhancer exe/gPt uses the set's filter kind, not an arbitrary club
      // from its players. Public catalogue aliases bridge FUT.GG's missing IDs.
      const kind = category.slug === 'leagues' ? 'LEAGUE' : category.slug === 'rarities' ? 'RARITY' : 'CLUB';
      const idsFor = values => [...new Set((values ?? []).map(Number))].filter(id => Number.isSafeInteger(id) && id > 0);
      const explicit = idsFor(set.conditions?.[kind === 'LEAGUE' ? 'leagues' : kind === 'RARITY' ? 'rareflags' : 'clubs']);
      if (kind === 'RARITY' && (set.slug === 'holographics' || set.conditions?.holo === true)) {
        return [galleryAssets.rarity(12)].filter(Boolean); // Enhancer foil: Qce(12).
      }
      if (explicit.length) return explicit.map(id => kind === 'RARITY' ? galleryAssets.rarity(id) : galleryAssets.filter(kind, id)).filter(Boolean);
      if (kind !== 'CLUB') {
        const leagueIds = { 'premier-league': [13], 'barclays-wsl': [2216], 'ligue-1-mcdonalds': [16],
          'arkema-pl': [2218], 'laliga-ea-sports': [53], 'liga-f-moeve': [2222],
          'serie-a-enilive': [31], bundesliga: [19], 'frauen-bundesliga': [2215] };
        const rarityIds = { totw: [3], heroes: [72],
          'squad-foundations': [87], 'season-1': [150, 22, 71] };
        const known = (kind === 'LEAGUE' ? leagueIds : rarityIds)[set.slug];
        const field = kind === 'LEAGUE' ? 'leagueEaId' : 'rarityEaId';
        const observed = idsFor(pool.map(item => item[field]));
        const uniform = observed.length === 1 && pool.every(item => Number(item[field]) === observed[0]);
        let loaded = [];
        if (kind === 'LEAGUE') {
          const rows = unsafeWindow.factories?.DataProvider?.getLeagueDP?.() ?? unsafeWindow.repositories?.League?.getAll?.() ?? [];
          const normalize = value => String(value ?? '').toLocaleLowerCase().replace(/[.'’_-]+/g, ' ').replace(/\s+/g, ' ').trim();
          const wanted = normalize(set.slug), nameValue = normalize(name);
          loaded = (Array.isArray(rows) ? rows : Object.values(rows)).filter(row => {
            const rowName = normalize(row?.label ?? row?.name ?? row?.sortName);
            return rowName === nameValue || rowName === wanted;
          }).map(row => Number(row?.id ?? row?.leagueId ?? row?.eaId)).filter(id => Number.isSafeInteger(id) && id > 0);
        }
        const ids = known ?? (loaded.length ? [...new Set(loaded)] : uniform ? observed : []);
        return ids.map(id => kind === 'RARITY' ? galleryAssets.rarity(id) : galleryAssets.filter(kind, id)).filter(Boolean);
      }
      const raw = unsafeWindow.repositories?.TeamConfig?.getTeams?.() ?? [];
      const teams = Array.isArray(raw) ? raw
        : raw && typeof raw[Symbol.iterator] === 'function' ? [...raw]
          : Object.values(raw);
      const normalize = value => String(value ?? '').toLocaleLowerCase()
        .replace(/[.'’_-]+/g, ' ').replace(/\s+(women|wfc|fc)$/i, '').replace(/\s+/g, ' ').trim();
      const needle = normalize(name);
      const rows = teams.map(team => ({ team, value: normalize(team?.name ?? team?.sortName ?? team?.label) }))
        .filter(row => row.value && row.value === needle);
      const ids = rows.map(({ team }) => Number(team?.id ?? team?.teamId ?? team?.eaId))
        .filter(value => Number.isSafeInteger(value) && value > 0).slice(0, 3);
      return (ids.length ? [...new Set(ids)] : idsFor(pool.slice(0, 3).map(item => item.clubEaId)))
        .map(id => galleryAssets.club(id)).filter(Boolean);
    } catch { return []; }
  },
});
// Presentation only: use a price already loaded by FSU. Gallery never
// triggers one price request per card and missing cache entries stay unknown.
const galleryPrices = id => readCachedGalleryPrice(unsafeWindow, id);
const galleryTransport = createFc27GalleryTransport(GM_xmlhttpRequest, { diagnosticLog });
const publicPrices = createFc27PublicPrices({ root: unsafeWindow, get: GM_getValue, set: GM_setValue, gmRequest: GM_xmlhttpRequest,
  transport: galleryTransport, diagnosticLog });
const galleryCacheMigration = compactGalleryCollectionCaches({
  list: typeof GM_listValues === 'function' ? GM_listValues : null, get: GM_getValue, set: GM_setValue,
  locks: unsafeWindow.navigator.locks,
  onProgress: report => { unsafeWindow.__FCAT_CACHE_MIGRATION__ = report; },
}).then(report => {
  try { console.info('[FCAT_CACHE_MIGRATION]', JSON.stringify(report)); } catch { /* Diagnostics only. */ }
  return report;
});
const galleryPublicCacheMigration = compactGalleryPublicCaches({
  list: typeof GM_listValues === 'function' ? GM_listValues : null, get: GM_getValue, set: GM_setValue,
  locks: unsafeWindow.navigator.locks,
}).then(report => {
  unsafeWindow.__FCAT_PUBLIC_CACHE_MIGRATION__ = report;
  try { console.info('[FCAT_PUBLIC_CACHE_MIGRATION]', JSON.stringify(report)); } catch { /* Diagnostics only. */ }
  return report;
});
const publicGalleryCatalog = createFc27GalleryCatalogProvider({ http: galleryTransport,
  gmGetValue: GM_getValue, gmSetValue: GM_setValue, diagnosticLog, cacheMigration: galleryPublicCacheMigration });
const galleryProgress = createFc27GalleryProgressReader(unsafeWindow, { gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  diagnosticLog, cacheMigration: galleryCacheMigration });
const galleryCatalog = withFodderGalleryPools(publicGalleryCatalog, galleryProgress);
const gallerySync = createFc27GallerySync({ provider: galleryCatalog, reader: galleryProgress, diagnosticLog,
  gmGetValue: GM_getValue, gmSetValue: GM_setValue });
const galleryComparison = createGalleryMarketComparison({ scope: galleryProgress.scope,
  createTransport: options => createFc27MarketReadTransport(unsafeWindow, options), diagnosticLog });
const galleryAccounting = createFc27GalleryAccounting({ root: unsafeWindow, get: GM_getValue, set: GM_setValue });
const galleryTradePreferences = createGalleryTradePreferences({ scope: () => publicPrices.scope(), get: GM_getValue, set: GM_setValue });
const galleryPlanningSettings = createGalleryPlanningSettings({ scope: galleryProgress.scope, get: GM_getValue, set: GM_setValue });
const galleryPurchase = createFc27GalleryPurchase({ root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  gmRequest: GM_xmlhttpRequest, reader: galleryProgress, liveEnabled: dependencies.liveEnabled,
  readSettings: () => current().inspectPuzzlePolicy(), publicPrices, tradePreferences: galleryTradePreferences, diagnosticLog, accounting: galleryAccounting });
const galleryListing = createFc27GalleryListing({ root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  purchase: galleryPurchase, liveEnabled: dependencies.liveEnabled,
  schedulingEnabled: dependencies.liveEnabled === true,
  loadPrices: (ids, options) => publicPrices.load(ids, { ...options, purpose: 'listing' }), diagnosticLog, accounting: galleryAccounting });
const galleryRelist = createFc27GalleryRelist({ root: unsafeWindow, get: GM_getValue, set: GM_setValue,
  purchase: galleryPurchase, liveEnabled: dependencies.liveEnabled, diagnosticLog,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) });
// Poll only the durable relist record. An absent/disarmed record returns
// without EA requests; an armed record is executed only after its explicit
// user approval and due time. The page must remain open and authenticated.
const galleryTradingPoll = startGalleryTradingPoll({ timers: unsafeWindow, listing: galleryListing, relist: galleryRelist });
unsafeWindow.addEventListener?.('beforeunload', () => galleryTradingPoll.dispose(), { once: true });
// Schedule creation and execution still require a separate explicit save and
// enable click in the Bulk List dialog; loading the page never arms a job.
safeBoot('gallery-progress-install', () => {
  if (!galleryProgress.install()) {
    const factoryReady = unsafeWindow.setInterval(() => {
      try {
        if (galleryProgress.install()) unsafeWindow.clearInterval(factoryReady);
      } catch { unsafeWindow.clearInterval(factoryReady); }
    }, 1000);
  }
});
const galleryNativeRenderer = createFc27GalleryNativeRenderer(unsafeWindow, { document: unsafeWindow.document, diagnosticLog });
let session;
const current = () => session ??= createFc27AcceptanceSession({ ...dependencies, publicPrices, diagnosticLog });
// Reconcile an old Puzzle purchase marker in a bounded, read-only-first
// maintenance pass. It never buys, moves or saves a squad. A retired target is
// archived only after its history is durably written; unknown receipts remain
// historical and no longer block unrelated Gallery/Streamlined work.
let puzzleLifecycleBusy = false;
const puzzleLifecyclePoll = unsafeWindow.setInterval(async () => {
  if (puzzleLifecycleBusy) return;
  puzzleLifecycleBusy = true;
  try { await maintainFc27PuzzlePurchases(unsafeWindow, { get: GM_getValue, set: GM_setValue, diagnosticLog }); }
  catch { /* lifecycle diagnostics are fail-closed and never affect page UI */ }
  finally { puzzleLifecycleBusy = false; }
}, 15000);
unsafeWindow.addEventListener?.('beforeunload', () => unsafeWindow.clearInterval(puzzleLifecyclePoll), { once: true });
// FSU's buyConceptPlayer presents one foreground loader while the batch runs.
// FCAT keeps its own transaction and journal, but mirrors the same page-level
// progress callbacks when the reviewed FSU event bridge is available.
let fallbackPurchaseProgress = null;
const foregroundPurchaseProgress = {
  start: () => {
    try {
      const events = unsafeWindow.events;
      if (typeof events?.showLoader === 'function') { events.showLoader(); return; }
    } catch { /* Use the independent fallback below. */ }
    const document = unsafeWindow.document;
    if (!document?.body || document.getElementById('fcat-fc27-foreground-progress')) return;
    fallbackPurchaseProgress = document.createElement('div');
    fallbackPurchaseProgress.id = 'fcat-fc27-foreground-progress';
    fallbackPurchaseProgress.setAttribute('role', 'status');
    fallbackPurchaseProgress.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:100003;min-width:280px;max-width:calc(100vw - 32px);padding:16px 20px;border:1px solid #67736c;border-radius:8px;background:#202724;color:#edf1ef;box-shadow:0 14px 60px #000b;text-align:center;font:600 14px/1.45 Arial,sans-serif';
    fallbackPurchaseProgress.textContent = '正在准备购买…';
    document.body.append(fallbackPurchaseProgress);
  },
  update: progress => {
    try {
      const events = unsafeWindow.events;
      if (fallbackPurchaseProgress) {
        const label = progress.phase === 'search' ? '正在查价' : progress.phase === 'price-ready' ? '价格已确认' : progress.phase === 'buying' ? '正在买入' : progress.phase === 'moving' ? '正在移入 Club' : progress.phase === 'completed' ? '已完成' : '正在处理';
        fallbackPurchaseProgress.textContent = `${label} ${progress.index}/${progress.total}`;
      }
      if (typeof events?.changeLoadingText !== 'function' || !Number.isSafeInteger(progress?.index)) return;
      const info = ['readauction.progress', progress.index, progress.total];
      if (progress.phase === 'search') events.changeLoadingText('readauction.progress', info);
      else if (['price-ready', 'buying', 'bought', 'moving', 'completed'].includes(progress.phase)) {
        events.changeLoadingText('buyplayer.loadingclose', info);
      }
    } catch { /* UI only. */ }
  },
  end: () => {
    try { unsafeWindow.events?.hideLoader?.(); } catch { /* UI only. */ }
    fallbackPurchaseProgress?.remove?.(); fallbackPurchaseProgress = null;
  },
};
const acceptancePanel = safeBoot('acceptance-panel', () => mountFc27AcceptancePanel({ document: unsafeWindow.document,
  hostId: 'fcat-fc27-production', title: `FC Automation Tool ${__FCAT_VERSION__}`, version: __FCAT_VERSION__,
  liveEnabled: dependencies.liveEnabled,
  galleryCatalog,
  galleryAccountScope: galleryProgress.scope,
  gallerySync,
  galleryAssets,
  galleryNativeRenderer,
  galleryDiagnosticLog: diagnosticLog,
  galleryFirstOwnerHistory: (definitionId, firstOwned) => galleryProgress.updateFirstOwner(definitionId, firstOwned),
  purchaseGallery: galleryPurchase,
  galleryListing,
  galleryRelist,
  gradePlanner: planGalleryGrade,
  galleryPrices,
  galleryMarketCompare: galleryComparison.compare,
  galleryPriceLoader: ids => publicPrices.load(ids, { purpose: 'display' }),
  publicPrices,
  galleryPlanningPrices: (ids, options = {}) => publicPrices.load(ids, options),
  galleryTargetStore: createGalleryTargetStore({ get: GM_getValue, set: GM_setValue }),
  galleryPlanStore: createGalleryPlanStore({ get: GM_getValue, set: GM_setValue }),
  galleryScoreCache: createGalleryScoreCache({ get: GM_getValue, set: GM_setValue }),
  galleryAccounting, galleryTradePreferences, galleryPlanningSettings,
  exportDiagnostics: async () => {
    const payload = await diagnosticLog.exportPayload();
    const stamp = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-');
    const filename = `FCAutomationTool-FC27-diagnostics-${stamp}.json`;
    downloadFc27Diagnostics(unsafeWindow, unsafeWindow.document, JSON.stringify(payload, null, 2), filename);
    return { count: payload.entries.length, filename };
  },
  gallerySetLoader: async ({ source, setId, force = false, onProgress = null }) => {
    const pool = await galleryCatalog.loadPool({ source, setId, force, onProgress });
    if (pool.status !== 'observed' || !pool.pool) return pool;
    gallerySync.remember(pool.pool);
    const progress = await galleryProgress.load(pool.pool, { force: source === 'fodder' ? false : force, onProgress });
    // Share the account source policy and exact-version quote cache with plans.
    publicPrices.remember(pool.pool.items);
    let prices = Object.freeze({});
    let priceError = null;
    let priceSnapshot = null;
    let platform = null;
    try {
      const context = readFc27Context(unsafeWindow);
      platform = /^pc:/i.test(context.platform) ? 'pc' : 'console';
      const priceScope = publicPrices.scope();
      priceSnapshot = await loadGalleryPriceSnapshot(pool.pool.items, {
        load: (ids, options) => publicPrices.load(ids, { ...options, purpose: 'display' }),
        current: () => publicPrices.scope() === priceScope,
      });
      prices = priceSnapshot.prices;
    } catch (error) {
      priceError = /^FC27_[A-Z_]+$/.test(error?.message) || /^HTTP \d{3}$/.test(error?.message)
        ? error.message : 'FC27_GALLERY_PRICE_UNAVAILABLE';
    }
    if (platform) priceError ??= Object.values(priceSnapshot?.references ?? {}).find(ref => ref.quotes?.[priceSnapshot.policy.source]?.error)?.quotes[priceSnapshot.policy.source].error ?? null;
    return {
      ...progress,
      progress: progress.progress ?? mergeGalleryAccountProgress(pool.pool),
      prices,
      priceSnapshot,
      priceError,
      poolStale: pool.stale === true,
    };
  },
  targets: () => readFc27ChallengeTargets(unsafeWindow),
  inspectCatalog: options => current().inspectCatalog(options),
  inspectPuzzle: options => current().inspectPuzzle(options),
  inspectPuzzlePolicy: () => current().inspectPuzzlePolicy(),
  setPuzzleMaxRating: value => current().setPuzzleMaxRating(value),
  setPuzzlePolicy: value => current().setPuzzlePolicy(value),
  prepare: options => current().prepare(options), execute: approval => current().execute(approval),
  fillPuzzle: approval => current().fillPuzzle(approval),
  inspectRecovery: () => current().inspectRecovery(), resolveRecovery: approved => current().resolveRecovery(approved),
}));
safeBoot('workbench-navigation', () => mountFc27WorkbenchNavigation({ document: unsafeWindow.document, runtime: unsafeWindow, onOpen: container => acceptancePanel?.open?.(container) }));
safeBoot('puzzle-fill-button', () => mountFc27PuzzleNativeButton({ document: unsafeWindow.document,
  onFill: (target, callbacks) => current().solveAndFillPuzzle(target, callbacks),
  readTarget: () => readFc27PuzzlePage(unsafeWindow),
}));
safeBoot('puzzle-buy-button', () => mountFc27PuzzleBuyButton({ document: unsafeWindow.document,
  readPlayerName: definitionId => readFc27MarketPlayerName(unsafeWindow, definitionId),
  readTarget: () => {
    const target = readFc27PuzzlePage(unsafeWindow);
    const slots = target ? readFc27PurchasePageSlots(unsafeWindow, target) : null;
    return target ? { ...target, slots, squadSignature: JSON.stringify(slots) } : null;
  },
  inspect: target => current().inspectPuzzlePurchases(target),
  buy: (target, approval, callbacks) => current().buyPuzzlePlayers(target, approval, callbacks),
  stop: () => current().stopPuzzlePurchases(),
  refreshPrices: (ids, options) => publicPrices.load(ids, options),
  foregroundProgress: foregroundPurchaseProgress,
}));
const streamlinedSession = createFc27StreamlinedSession({
  inspect: () => { const page = locateFc27StreamlinedPage(unsafeWindow); if (!page) return null;
    const context = readFc27Context(unsafeWindow); return { context, challenge: projectFc27StreamlinedChallenge(page, context) }; },
  readInputs: settings => readFc27StreamlinedInputs(unsafeWindow, settings),
  readMarketCandidates: createFc27StreamlinedMarket(unsafeWindow, {
    catalog: createFc27StreamlinedCatalog({ gmRequest: GM_xmlhttpRequest }), prices: publicPrices }),
  get: GM_getValue, set: GM_setValue, prices: publicPrices, diagnosticLog,
  createExecution: (context, plan) => createFc27StreamlinedExecution(unsafeWindow, { context, plan,
    get: GM_getValue, set: GM_setValue, prices: publicPrices, lockManager: unsafeWindow.navigator.locks,
    canWrite: () => __FCAT_LIVE_ENABLED__ }),
});
const streamlinedPanel = safeBoot('streamlined-panel', () => mountFc27StreamlinedPanel({ document: unsafeWindow.document,
  readTarget: () => locateFc27StreamlinedPage(unsafeWindow), session: streamlinedSession, nativeRenderer: galleryNativeRenderer }));
// One attempt per account/session, only once the existing FSU cache is ready.
// No pending journal means no EA request. Failed checks remain recoverable.
const streamlinedRecoveryAccounts = new Set();
const streamlinedRecoveryTimer = unsafeWindow.setInterval(() => {
  try {
    if (unsafeWindow.info?.base?.initialized !== true
        || !['ready', 'trusted-provisional'].includes(unsafeWindow.info?.base?.clubCache?.status)) return;
    const context = readFc27Context(unsafeWindow), key = JSON.stringify(context);
    if (streamlinedRecoveryAccounts.has(key)) return;
    streamlinedRecoveryAccounts.add(key);
    void recoverFc27Streamlined(unsafeWindow, { get: GM_getValue, set: GM_setValue, lockManager: unsafeWindow.navigator.locks })
      .then(result => diagnosticLog.record({ area: 'streamlined', event: 'recovery', ...result })).catch(() => {});
  } catch { /* Wait for login; do not query or mutate an unknown account. */ }
}, 1500);
unsafeWindow.addEventListener?.('beforeunload', () => unsafeWindow.clearInterval(streamlinedRecoveryTimer), { once: true });
unsafeWindow.addEventListener?.('beforeunload', () => streamlinedPanel?.dispose?.(), { once: true });
