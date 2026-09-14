// ==UserScript==
// @name         FC Automation Tool Preview
// @namespace    https://github.com/ShatteredLancer/DailyLoopRunner/preview
// @version      __DLR_VERSION__
// @description  Prelaunch read-only environment inspection. No EA account mutations.
// @license      MIT
// @match        https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*
// @match        https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

import { inspectFc27Environment } from '../adapters/browser/fc27-inspection.js';
import { inspectPrelaunchRuntime } from './runtime.js';

const state = Object.freeze({
  product: 'FC Automation Tool Preview',
  runtime: inspectPrelaunchRuntime(),
  environment: inspectFc27Environment(unsafeWindow, 'web-app'),
});
console.info('[FC Automation Tool Preview]', state);
