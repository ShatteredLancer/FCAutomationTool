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
// @grant        GM_xmlhttpRequest
// @connect      www.futbin.org
// @connect      www.fut.gg
// @connect      fodder.gg
// @run-at       document-end
// ==/UserScript==

import { createFc27AcceptanceSession, checkFc27GmInstallation } from '../adapters/browser/fc27-acceptance-session.js';
import { mountFc27AcceptancePanel } from '../adapters/browser/fc27-acceptance-panel.js';
import { readFc27ChallengeTargets } from '../adapters/ea/fc27-fsu-read.js';
import { mountFc27PuzzleNativeButton } from '../adapters/browser/fc27-puzzle-native-button.js';
import { readFc27PuzzlePage } from '../adapters/ea/fc27-puzzle-page.js';
import { readFc27PurchasePageSlots } from '../adapters/ea/fc27-puzzle-page.js';
import { mountFc27PuzzleBuyButton } from '../adapters/browser/fc27-puzzle-buy-button.js';
import { mountFc27WorkbenchNavigation } from '../adapters/browser/fc27-workbench-navigation.js';
import { createFc27GalleryCatalogProvider, createFc27GalleryTransport, normalizeFc27GalleryProxy } from '../adapters/browser/fc27-gallery-catalog.js';
import { createFc27GalleryProgressReader } from '../adapters/ea/fc27-gallery-progress.js';
import { createFc27GallerySync } from '../adapters/browser/fc27-gallery-sync.js';
import { createFc27GalleryPurchase } from '../adapters/browser/fc27-gallery-purchase.js';
import { createFc27GalleryListing } from '../adapters/browser/fc27-gallery-listing.js';
import { createFc27GalleryNativeRenderer } from '../adapters/ea/fc27-gallery-card.js';
import { readFc27Context } from '../adapters/ea/fc27-local-read.js';
import { mergeGalleryAccountProgress } from '../gallery/progress.js';
import { readCachedGalleryPrice } from '../gallery/prices.js';
import { planGalleryGrade } from '../gallery/planner.js';
import { createGalleryTargetStore } from '../gallery/targets.js';
import { createGalleryPlanStore } from '../gallery/plans.js';
import { createGalleryMarketComparison } from '../gallery/market-comparison.js';
import { createFc27MarketReadTransport } from '../adapters/ea/fc27-market-read.js';
import { createFcatDiagnosticLog } from '../diagnostics/fcat-diagnostic-log.js';
import { createUserEffectsAdapter } from '../adapters/browser/user-effects.js';

// A new Tampermonkey identity: no legacy or Acceptance storage migration.
const dependencies = { root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  gmRequest: GM_xmlhttpRequest,
  lockManager: unsafeWindow.navigator.locks, liveEnabled: __FCAT_LIVE_ENABLED__ };
const FC27_GALLERY_PROXY_KEY = 'fcat-fc27-gallery-futgg-proxy-v1';
let galleryProxy = '';
try { galleryProxy = normalizeFc27GalleryProxy(GM_getValue(FC27_GALLERY_PROXY_KEY, '') || ''); } catch { galleryProxy = ''; }
const readGalleryProxy = () => galleryProxy;
const diagnosticLog = createFcatDiagnosticLog({ gmGetValue: GM_getValue, gmSetValue: GM_setValue, version: __FCAT_VERSION__ });
const userEffects = createUserEffectsAdapter(unsafeWindow, unsafeWindow.document);
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
  category: (slug, name = '') => {
    const key = `${String(slug ?? '')} ${String(name ?? '')}`.toLocaleLowerCase();
    const rarityCategory = key.includes('rarit');
    const ids = key.includes('england') || key.includes('premier') || key.includes('wsl')
      ? [13, 2216]
      : key.includes('spain') || key.includes('laliga') || key.includes('liga-f') || key.includes('la-liga')
        ? [53, 2222]
      : key.includes('germany') || key.includes('bundesliga') ? [19, 2215]
          : key.includes('france') || key.includes('ligue') || key.includes('arkema') ? [16, 2218]
            : key.includes('italy') || key.includes('serie-a') || key.includes('serie a') ? [31]
              : key.includes('leagues') || key === 'league' ? [13, 53, 19, 2215, 16, 31]
                : rarityCategory ? [1, 3, 4, 5, 6] : [];
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
const setGalleryProxy = async value => {
  const normalized = normalizeFc27GalleryProxy(value);
  await GM_setValue(FC27_GALLERY_PROXY_KEY, normalized);
  galleryProxy = normalized;
  return { status: 'observed', proxy: normalized };
};
const galleryCatalog = createFc27GalleryCatalogProvider({ http: createFc27GalleryTransport(GM_xmlhttpRequest, { getProxy: readGalleryProxy, diagnosticLog }),
  gmGetValue: GM_getValue, gmSetValue: GM_setValue, diagnosticLog });
const galleryProgress = createFc27GalleryProgressReader(unsafeWindow, { gmGetValue: GM_getValue, gmSetValue: GM_setValue, diagnosticLog });
const gallerySync = createFc27GallerySync({ provider: galleryCatalog, reader: galleryProgress, diagnosticLog });
const galleryComparison = createGalleryMarketComparison({ scope: galleryProgress.scope,
  createTransport: options => createFc27MarketReadTransport(unsafeWindow, options), diagnosticLog });
const galleryPurchase = createFc27GalleryPurchase({ root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  gmRequest: GM_xmlhttpRequest, reader: galleryProgress, liveEnabled: dependencies.liveEnabled,
  readSettings: () => current().inspectPuzzlePolicy(), diagnosticLog });
const galleryListing = createFc27GalleryListing({ root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  purchase: galleryPurchase, liveEnabled: dependencies.liveEnabled,
  loadPrices: ids => {
    const context = readFc27Context(unsafeWindow);
    const platform = /^pc:/i.test(context.platform) ? 'pc' : 'console';
    return galleryCatalog.loadPriceSnapshot(ids, { platform });
  }, diagnosticLog });
// T4 schedule drafts are persisted separately. Production activation awaits
// the shared Scheduler's finite authorization/lease/continuation integration.
// Manual Bulk List approval must not implicitly authorize a background job.
if (!galleryProgress.install()) {
  const factoryReady = unsafeWindow.setInterval(() => {
    if (galleryProgress.install()) unsafeWindow.clearInterval(factoryReady);
  }, 1000);
}
const galleryNativeRenderer = createFc27GalleryNativeRenderer(unsafeWindow, { document: unsafeWindow.document, diagnosticLog });
let session;
const current = () => session ??= createFc27AcceptanceSession({ ...dependencies, diagnosticLog });
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
const acceptancePanel = mountFc27AcceptancePanel({ document: unsafeWindow.document,
  hostId: 'fcat-fc27-production', title: `FC Automation Tool ${__FCAT_VERSION__}`, version: __FCAT_VERSION__,
  liveEnabled: dependencies.liveEnabled,
  galleryCatalog,
  galleryProxy: readGalleryProxy,
  setGalleryProxy,
  galleryAccountScope: galleryProgress.scope,
  gallerySync,
  galleryAssets,
  galleryNativeRenderer,
  galleryDiagnosticLog: diagnosticLog,
  galleryFirstOwnerHistory: (definitionId, firstOwned) => galleryProgress.updateFirstOwner(definitionId, firstOwned),
  purchaseGallery: galleryPurchase,
  galleryListing,
  gradePlanner: planGalleryGrade,
  galleryPrices,
  galleryMarketCompare: galleryComparison.compare,
  galleryPriceLoader: ids => {
    const context = readFc27Context(unsafeWindow);
    const platform = /^pc:/i.test(context.platform) ? 'pc' : 'console';
    return galleryCatalog.loadPriceSnapshot(ids, { platform });
  },
  galleryTargetStore: createGalleryTargetStore({ get: GM_getValue, set: GM_setValue }),
  galleryPlanStore: createGalleryPlanStore({ get: GM_getValue, set: GM_setValue }),
  exportDiagnostics: async () => {
    const payload = await diagnosticLog.exportPayload();
    const stamp = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-');
    const filename = `FCAutomationTool-FC27-diagnostics-${stamp}.json`;
    userEffects.downloadText(JSON.stringify(payload, null, 2), filename);
    return { count: payload.entries.length, filename };
  },
  gallerySetLoader: async ({ source, setId, force = false, onProgress = null }) => {
    const pool = await galleryCatalog.loadPool({ source, setId, force });
    if (pool.status !== 'observed' || !pool.pool) return pool;
    gallerySync.remember(pool.pool);
    const progress = await galleryProgress.load(pool.pool, { force, onProgress });
    // Prices are a single, de-duplicated public FUT.GG read for the cards in
    // the selected pool.  Keep it beside the pool result so the view never
    // falls back to one request per card.
    let prices = Object.freeze({});
    let priceError = null;
    let priceSnapshot = null;
    let platform = null;
    try {
      const context = readFc27Context(unsafeWindow);
      platform = /^pc:/i.test(context.platform) ? 'pc' : 'console';
      priceSnapshot = await galleryCatalog.loadPriceSnapshot(pool.pool.items.map(item => item.eaId), { platform });
      prices = priceSnapshot.prices;
    } catch (error) {
      priceError = /^FC27_[A-Z_]+$/.test(error?.message) || /^HTTP \d{3}$/.test(error?.message)
        ? error.message : 'FC27_GALLERY_PRICE_UNAVAILABLE';
    }
    if (platform) priceError ??= galleryCatalog.priceError?.(pool.pool.items.map(item => item.eaId), { platform }) ?? null;
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
  checkInstallation: hold => checkFc27GmInstallation({ ...dependencies, hold }),
});
mountFc27WorkbenchNavigation({ document: unsafeWindow.document, runtime: unsafeWindow, onOpen: container => acceptancePanel?.open?.(container) });
mountFc27PuzzleNativeButton({ document: unsafeWindow.document,
  onFill: (target, callbacks) => current().solveAndFillPuzzle(target, callbacks),
  readTarget: () => readFc27PuzzlePage(unsafeWindow),
});
mountFc27PuzzleBuyButton({ document: unsafeWindow.document,
  readTarget: () => {
    const target = readFc27PuzzlePage(unsafeWindow);
    const slots = target ? readFc27PurchasePageSlots(unsafeWindow, target) : null;
    return target ? { ...target, slots, squadSignature: JSON.stringify(slots) } : null;
  },
  inspect: target => current().inspectPuzzlePurchases(target),
  buy: (target, approval, callbacks) => current().buyPuzzlePlayers(target, approval, callbacks),
  stop: () => current().stopPuzzlePurchases(),
  foregroundProgress: foregroundPurchaseProgress,
});
