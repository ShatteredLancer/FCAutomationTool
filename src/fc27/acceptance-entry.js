// ==UserScript==
// @name         FC Automation Tool Acceptance
// @namespace    https://github.com/ShatteredLancer/FCAutomationTool/acceptance
// @version      __DLR_VERSION__
// @description  Isolated FC27 acceptance. Live execution disabled in the default build.
// @license      MIT
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// ==/UserScript==

import { createFc27AcceptanceSession, checkFc27GmInstallation } from '../adapters/browser/fc27-acceptance-session.js';
import { mountFc27AcceptancePanel } from '../adapters/browser/fc27-acceptance-panel.js';
import { readFc27RunnerPanel } from '../adapters/ea/fc27-fsu-read.js';

const dependencies = { root: unsafeWindow, gmGetValue: GM_getValue, gmSetValue: GM_setValue,
  lockManager: unsafeWindow.navigator.locks, liveEnabled: false };
let session;
const current = () => session ??= createFc27AcceptanceSession(dependencies);
mountFc27AcceptancePanel({ document: unsafeWindow.document,
  targets: () => readFc27RunnerPanel(unsafeWindow).targets,
  prepare: options => current().prepare(options),
  execute: approval => current().execute(approval),
  inspectRecovery: () => current().inspectRecovery(),
  resolveRecovery: approved => current().resolveRecovery(approved),
  checkInstallation: hold => checkFc27GmInstallation({ ...dependencies, hold }),
});
