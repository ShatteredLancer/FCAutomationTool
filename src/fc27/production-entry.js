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

// A new Tampermonkey identity: no legacy or Acceptance storage migration.
const dependencies = { root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  gmRequest: GM_xmlhttpRequest,
  lockManager: unsafeWindow.navigator.locks, liveEnabled: __FCAT_LIVE_ENABLED__ };
let session;
const current = () => session ??= createFc27AcceptanceSession(dependencies);
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
